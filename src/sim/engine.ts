// Core warehouse simulation. Framework-agnostic: the renderer and dashboard
// only read from this, so the same engine can later be driven by a backend.

import {
  CHARGERS,
  DROPOFFS,
  PICKUPS,
  aStar,
  inBounds,
  isRack,
  key,
  manhattan,
  type Vec2,
} from "./grid";
import type {
  ConflictRecord,
  Obstacle,
  Robot,
  SimEvent,
  Snapshot,
  Task,
} from "./types";

const ROBOT_SPEED = 1.7; // cells / second
const ARRIVE_EPS = 0.06;
const BATTERY_DRAIN = 0.42; // % per second while moving
const BATTERY_CHARGE = 9; // % per second on a charger
const LOW_BATTERY = 18;
const HANDLE_TIME = 1.1; // seconds spent picking / dropping
const YIELD_REPLAN_AFTER = 2.6;

const START_CELLS: Vec2[] = [
  { x: 2, y: 19 },
  { x: 7, y: 19 },
  { x: 12, y: 19 },
];

export const SCENARIOS = [
  { id: 1, name: "Normal Operation", blurb: "All three AMRs pick, carry and deliver continuously." },
  { id: 2, name: "Task Allocation", blurb: "8 tasks scored by distance, battery, urgency and workload." },
  { id: 3, name: "Path Planning", blurb: "A* routes through the aisles, drawn live per robot." },
  { id: 4, name: "Conflict Resolution", blurb: "Robots meet at a shared intersection; priority decides." },
  { id: 5, name: "Dynamic Rerouting", blurb: "An aisle is blocked mid-run; routes are recomputed." },
  { id: 6, name: "Obstacle Avoidance", blurb: "Moving workers and pallets must be detected and avoided." },
  { id: 7, name: "Robot Failure", blurb: "AMR-02 fails safely; the fleet keeps working." },
  { id: 8, name: "Task Reallocation", blurb: "A failed robot's open tasks are reassigned automatically." },
] as const;

interface ScriptStep {
  at: number;
  done: boolean;
  run: (sim: Simulation) => void;
}

let taskSeq = 0;
let eventSeq = 0;
let obstacleSeq = 0;

export class Simulation {
  time = 0;
  running = false;
  speed = 1;
  scenario = 1;
  robots: Robot[] = [];
  tasks: Task[] = [];
  obstacles: Obstacle[] = [];
  blocked = new Set<string>();
  events: SimEvent[] = [];
  conflicts: ConflictRecord[] = [];
  private handleTimers = new Map<string, number>();
  private scripts: ScriptStep[] = [];
  private allocTimer = 0;
  version = 0;

  constructor() {
    this.loadScenario(1);
  }

  /* ------------------------------------------------------------------ setup */

  private makeRobot(i: number): Robot {
    return {
      id: `R${i + 1}`,
      name: `AMR-0${i + 1}`,
      pos: { ...START_CELLS[i] },
      yaw: 0,
      battery: 100,
      status: "idle",
      path: [],
      pathIndex: 0,
      taskId: null,
      carrying: false,
      dest: null,
      waitTimer: 0,
      speed: ROBOT_SPEED,
      wheelSpin: 0,
      lidarSpin: 0,
      distance: 0,
      tasksDone: 0,
      reroutes: 0,
      conflicts: 0,
      lastEvent: "Standing by",
    };
  }

  loadScenario(id: number) {
    this.scenario = id;
    this.time = 0;
    this.robots = [0, 1, 2].map((i) => this.makeRobot(i));
    this.tasks = [];
    this.obstacles = [];
    this.blocked = new Set();
    this.events = [];
    this.conflicts = [];
    this.handleTimers.clear();
    this.scripts = [];
    this.allocTimer = 0;
    taskSeq = 0;
    obstacleSeq = 0;
    const meta = SCENARIOS.find((s) => s.id === id);
    this.log("info", `Scenario ${id} loaded — ${meta?.name}`);

    switch (id) {
      case 1: {
        for (let i = 0; i < 4; i++) this.addTask(PICKUPS[i], DROPOFFS[i], 1 + (i % 2));
        break;
      }
      case 2: {
        for (let i = 0; i < 8; i++) {
          this.addTask(PICKUPS[i % 4], DROPOFFS[(i + 2) % 4], (i % 3) + 1);
        }
        this.robots[1].battery = 46;
        this.robots[2].battery = 72;
        this.log("info", "Fleet batteries differ — allocation must account for it");
        break;
      }
      case 3: {
        this.addTask(PICKUPS[0], DROPOFFS[3], 2);
        this.addTask(PICKUPS[3], DROPOFFS[0], 2);
        this.addTask(PICKUPS[1], DROPOFFS[2], 1);
        this.log("info", "Planned A* routes are drawn as coloured lines on the floor");
        break;
      }
      case 4: {
        // Deliberately routed so two robots converge on the mid cross aisle.
        this.addTask({ x: 1, y: 10 }, { x: 27, y: 10 }, 3);
        this.addTask({ x: 27, y: 10 }, { x: 1, y: 10 }, 3);
        this.addTask({ x: 14, y: 2 }, { x: 14, y: 18 }, 2);
        break;
      }
      case 5: {
        this.addTask(PICKUPS[0], DROPOFFS[0], 2);
        this.addTask(PICKUPS[2], DROPOFFS[2], 1);
        this.scripts.push({
          at: 7,
          done: false,
          run: (s) => s.blockAisle(14, true),
        });
        this.scripts.push({
          at: 18,
          done: false,
          run: (s) => s.blockAisle(14, false),
        });
        break;
      }
      case 6: {
        for (let i = 0; i < 3; i++) this.addTask(PICKUPS[i], DROPOFFS[3 - i], 2);
        this.spawnObstacle({ x: 11, y: 6 }, true, "worker");
        this.spawnObstacle({ x: 19, y: 14 }, true, "worker");
        this.spawnObstacle({ x: 7, y: 12 }, true, "pallet");
        this.spawnObstacle({ x: 23, y: 5 }, true, "worker");
        break;
      }
      case 7: {
        for (let i = 0; i < 4; i++) this.addTask(PICKUPS[i], DROPOFFS[i], 2);
        this.scripts.push({ at: 9, done: false, run: (s) => s.failRobot("R2") });
        break;
      }
      case 8: {
        for (let i = 0; i < 6; i++) this.addTask(PICKUPS[i % 4], DROPOFFS[(i + 1) % 4], (i % 3) + 1);
        this.scripts.push({ at: 8, done: false, run: (s) => s.failRobot("R2") });
        this.scripts.push({ at: 20, done: false, run: (s) => s.recoverRobot("R2") });
        break;
      }
    }
    this.version++;
  }

  reset() {
    this.running = false;
    this.loadScenario(this.scenario);
  }

  /* ---------------------------------------------------------------- commands */

  start() {
    this.running = true;
    this.log("info", "Simulation started");
  }
  pause() {
    this.running = false;
    this.log("info", "Simulation paused");
  }
  resume() {
    this.running = true;
    this.log("info", "Simulation resumed");
  }
  setSpeed(v: number) {
    this.speed = v;
  }

  addTask(pickup: Vec2, dropoff: Vec2, urgency = 1): Task {
    taskSeq += 1;
    const task: Task = {
      id: `T${String(taskSeq).padStart(2, "0")}`,
      label: `T${String(taskSeq).padStart(2, "0")}`,
      pickup: { ...pickup },
      dropoff: { ...dropoff },
      urgency,
      status: "pending",
      assignedTo: null,
      reassignments: 0,
      createdAt: this.time,
    };
    this.tasks.push(task);
    this.log(
      "task",
      `${task.id} created — pick ${cellName(pickup)} → drop ${cellName(dropoff)} (urgency ${urgency})`,
    );
    this.version++;
    return task;
  }

  addRandomTask() {
    const p = PICKUPS[Math.floor(Math.random() * PICKUPS.length)];
    const d = DROPOFFS[Math.floor(Math.random() * DROPOFFS.length)];
    return this.addTask(p, d, 1 + Math.floor(Math.random() * 3));
  }

  spawnObstacle(pos: Vec2, moving: boolean, kind: Obstacle["kind"] = "pallet") {
    obstacleSeq += 1;
    const dirs: Vec2[] = [
      { x: 0, y: 1 },
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: -1, y: 0 },
    ];
    this.obstacles.push({
      id: `O${obstacleSeq}`,
      pos: { ...pos },
      kind,
      moving,
      dir: dirs[Math.floor(Math.random() * dirs.length)],
      speed: kind === "worker" ? 0.9 : 0.5,
    });
    this.log("obstacle", `${kind === "worker" ? "Worker" : "Pallet"} detected at ${cellName(pos)}`);
    this.version++;
  }

  addObstacleNearFleet() {
    // Drop an obstacle a few cells ahead of a busy robot so avoidance triggers.
    const busy = this.robots.find((r) => r.path.length > 3 && r.status !== "failed");
    if (busy) {
      const cell = busy.path[Math.min(busy.pathIndex + 3, busy.path.length - 1)];
      this.spawnObstacle(cell, Math.random() > 0.5, Math.random() > 0.5 ? "worker" : "pallet");
      return;
    }
    const free: Vec2 = { x: 11, y: 8 };
    this.spawnObstacle(free, true, "worker");
  }

  clearObstacles() {
    this.obstacles = [];
    this.log("obstacle", "All dynamic obstacles cleared");
    this.version++;
  }

  blockAisle(x: number, blockedState: boolean) {
    for (let y = 3; y <= 17; y++) {
      if (isRack(x, y)) continue;
      const k = key(x, y);
      if (blockedState) this.blocked.add(k);
      else this.blocked.delete(k);
    }
    this.log(
      blockedState ? "reroute" : "info",
      blockedState ? `Aisle x=${x} blocked — rerouting affected robots` : `Aisle x=${x} reopened`,
    );
    if (blockedState) {
      for (const r of this.robots) {
        if (r.dest && this.pathHitsBlock(r)) this.replan(r, "aisle blocked");
      }
    }
    this.version++;
  }

  toggleAisle(x: number) {
    const blockedNow = this.blocked.has(key(x, 3)) || this.blocked.has(key(x, 10));
    this.blockAisle(x, !blockedNow);
  }

  failRobot(id: string) {
    const r = this.robots.find((x) => x.id === id);
    if (!r || r.status === "failed") return;
    r.status = "failed";
    r.path = [];
    r.pathIndex = 0;
    r.dest = null;
    r.lastEvent = "Fault — emergency stop";
    this.log("failure", `${r.name} failed and stopped safely — marked unavailable`);
    if (r.taskId) {
      const task = this.tasks.find((t) => t.id === r.taskId);
      if (task && task.status !== "done") {
        task.status = "pending";
        task.assignedTo = null;
        task.reassignments += 1;
        this.log("task", `${task.id} released from ${r.name} for reallocation`);
      }
      r.taskId = null;
      r.carrying = false;
    }
    this.version++;
  }

  recoverRobot(id: string) {
    const r = this.robots.find((x) => x.id === id);
    if (!r) return;
    r.status = "idle";
    r.battery = Math.max(r.battery, 55);
    r.lastEvent = "Recovered and back online";
    this.log("info", `${r.name} recovered — available for tasks`);
    this.version++;
  }

  /* -------------------------------------------------------------------- loop */

  step(rawDt: number) {
    if (!this.running) return;
    const dt = Math.min(rawDt, 0.05) * this.speed;
    this.time += dt;

    for (const s of this.scripts) {
      if (!s.done && this.time >= s.at) {
        s.done = true;
        s.run(this);
      }
    }

    this.updateObstacles(dt);

    this.allocTimer -= dt;
    if (this.allocTimer <= 0) {
      this.allocTimer = 0.5;
      this.allocate();
    }

    for (const r of this.robots) this.updateRobot(r, dt);

    // Age out resolved conflicts.
    this.conflicts = this.conflicts.filter((c) => this.time - c.t < 6);
  }

  private updateObstacles(dt: number) {
    for (const o of this.obstacles) {
      if (!o.moving) continue;
      const nx = o.pos.x + o.dir.x * o.speed * dt;
      const ny = o.pos.y + o.dir.y * o.speed * dt;
      const cx = Math.round(nx);
      const cy = Math.round(ny);
      if (!inBounds(cx, cy) || isRack(cx, cy)) {
        o.dir = { x: -o.dir.x, y: -o.dir.y };
        continue;
      }
      o.pos.x = nx;
      o.pos.y = ny;
    }
  }

  /* -------------------------------------------------------- task allocation */

  private allocate() {
    const pending = this.tasks
      .filter((t) => t.status === "pending")
      .sort((a, b) => b.urgency - a.urgency || a.createdAt - b.createdAt);
    if (pending.length === 0) return;

    for (const task of pending) {
      const candidates = this.robots.filter(
        (r) => r.status !== "failed" && r.status !== "charging" && r.taskId === null && r.battery > LOW_BATTERY,
      );
      if (candidates.length === 0) return;

      let best: Robot | null = null;
      let bestScore = Infinity;
      let bestBreakdown = "";
      for (const r of candidates) {
        const dist = manhattan({ x: Math.round(r.pos.x), y: Math.round(r.pos.y) }, task.pickup);
        const workload = this.tasks.filter((t) => t.assignedTo === r.id && t.status !== "done").length;
        const score = dist * 1 + (100 - r.battery) * 0.12 + workload * 9 - task.urgency * 5;
        if (score < bestScore) {
          bestScore = score;
          best = r;
          bestBreakdown = `dist ${dist}, battery ${Math.round(r.battery)}%, load ${workload}`;
        }
      }
      if (!best) return;

      task.status = "assigned";
      task.assignedTo = best.id;
      best.taskId = task.id;
      best.carrying = false;
      this.setDestination(best, task.pickup, "to_pickup");
      this.log(
        "assign",
        `${task.id} → ${best.name} (score ${bestScore.toFixed(1)}: ${bestBreakdown})`,
      );
      best.lastEvent = `Assigned ${task.id}`;
      if (task.reassignments > 0) {
        this.log("task", `${task.id} reallocated (${task.reassignments}× reassigned)`);
      }
    }
    this.version++;
  }

  /* -------------------------------------------------------------- navigation */

  private dynamicBlocks(self: Robot): Set<string> {
    const set = new Set(this.blocked);
    for (const o of this.obstacles) {
      set.add(key(Math.round(o.pos.x), Math.round(o.pos.y)));
    }
    for (const r of this.robots) {
      if (r.id === self.id) continue;
      if (r.status === "failed") set.add(key(Math.round(r.pos.x), Math.round(r.pos.y)));
    }
    return set;
  }

  private setDestination(r: Robot, dest: Vec2, status: Robot["status"]) {
    r.dest = { ...dest };
    r.status = status;
    const start = { x: Math.round(r.pos.x), y: Math.round(r.pos.y) };
    r.path = aStar(start, dest, this.dynamicBlocks(r));
    r.pathIndex = 0;
    if (r.path.length === 0 && manhattan(start, dest) > 0) {
      r.lastEvent = "No route available — holding";
      r.status = "waiting";
    }
  }

  private replan(r: Robot, reason: string) {
    if (!r.dest) return;
    const before = r.path.length;
    const start = { x: Math.round(r.pos.x), y: Math.round(r.pos.y) };
    const path = aStar(start, r.dest, this.dynamicBlocks(r));
    if (path.length === 0) {
      r.lastEvent = `Blocked (${reason}) — waiting`;
      r.status = "waiting";
      return;
    }
    r.path = path;
    r.pathIndex = 0;
    r.reroutes += 1;
    r.lastEvent = `Rerouted (${reason})`;
    if (r.status === "waiting" || r.status === "avoiding") {
      r.status = r.carrying ? "to_dropoff" : "to_pickup";
    }
    this.log(
      "reroute",
      `${r.name} rerouted around ${reason}: ${before} → ${path.length} cells`,
    );
    this.version++;
  }

  private pathHitsBlock(r: Robot) {
    for (let i = r.pathIndex; i < r.path.length; i++) {
      if (this.blocked.has(key(r.path[i].x, r.path[i].y))) return true;
    }
    return false;
  }

  private obstacleAt(cell: Vec2, radius = 0.65) {
    return this.obstacles.some(
      (o) => Math.hypot(o.pos.x - cell.x, o.pos.y - cell.y) < radius,
    );
  }

  /** Priority: urgency, then battery, then id — higher wins the intersection. */
  private priority(r: Robot) {
    const task = this.tasks.find((t) => t.id === r.taskId);
    const urgency = task?.urgency ?? 0;
    return urgency * 10 + r.battery * 0.1 + (r.carrying ? 3 : 0) + (3 - Number(r.id.slice(1)));
  }

  private conflictFor(r: Robot, next: Vec2): Robot | null {
    for (const other of this.robots) {
      if (other.id === r.id || other.status === "failed") continue;
      const oc = { x: Math.round(other.pos.x), y: Math.round(other.pos.y) };
      const on = other.path[other.pathIndex];
      const sameCell = oc.x === next.x && oc.y === next.y;
      const sameTarget = on && on.x === next.x && on.y === next.y;
      if (!sameCell && !sameTarget) continue;
      if (sameCell) return other; // occupied — always yield
      if (this.priority(other) >= this.priority(r)) return other;
    }
    return null;
  }

  private noteConflict(r: Robot, other: Robot, cell: Vec2) {
    const id = `${r.id}-${other.id}-${cell.x},${cell.y}`;
    if (this.conflicts.some((c) => c.id === id)) return;
    this.conflicts.push({
      id,
      cell: { ...cell },
      yielding: r.name,
      proceeding: other.name,
      resolved: false,
      t: this.time,
    });
    r.conflicts += 1;
    this.log(
      "conflict",
      `Conflict at ${cellName(cell)} — ${r.name} yields to ${other.name} (priority)`,
    );
    this.version++;
  }

  private resolveConflicts(r: Robot) {
    for (const c of this.conflicts) {
      if (c.yielding === r.name && !c.resolved) {
        c.resolved = true;
        this.log("conflict", `${r.name} cleared the intersection at ${cellName(c.cell)}`);
      }
    }
  }

  /* ------------------------------------------------------------------ robots */

  private updateRobot(r: Robot, dt: number) {
    r.lidarSpin += dt * (r.status === "failed" ? 0 : 6);

    if (r.status === "failed") return;

    if (r.status === "charging") {
      r.battery = Math.min(100, r.battery + BATTERY_CHARGE * dt);
      if (r.path.length > 0) {
        this.drive(r, dt);
        return;
      }
      if (r.battery >= 99.5) {
        r.status = "idle";
        r.lastEvent = "Charged — ready";
        this.log("battery", `${r.name} finished charging`);
        this.version++;
      }
      return;
    }

    // Low battery: abandon task, head to a charger.
    if (r.battery <= LOW_BATTERY && r.taskId === null) {
      const charger = CHARGERS[Number(r.id.slice(1)) - 1] ?? CHARGERS[0];
      this.setDestination(r, charger, "charging");
      r.lastEvent = "Low battery — docking";
      this.log("battery", `${r.name} battery ${Math.round(r.battery)}% — heading to charger`);
      return;
    }

    const handling = this.handleTimers.get(r.id);
    if (handling !== undefined) {
      const left = handling - dt;
      if (left > 0) {
        this.handleTimers.set(r.id, left);
        return;
      }
      this.handleTimers.delete(r.id);
      this.finishHandling(r);
      return;
    }

    if (r.taskId === null && r.status !== "idle") {
      r.status = "idle";
      r.path = [];
      r.dest = null;
    }

    if (r.taskId === null) {
      r.lastEvent = r.lastEvent === "Standing by" ? r.lastEvent : "Idle — awaiting task";
      return;
    }

    if (this.pathHitsBlock(r)) {
      this.replan(r, "blocked aisle");
      return;
    }

    this.drive(r, dt);
  }

  private drive(r: Robot, dt: number) {
    const next = r.path[r.pathIndex];
    if (!next) {
      this.arrive(r);
      return;
    }

    // LiDAR-style forward check for dynamic obstacles.
    if (this.obstacleAt(next, 0.7)) {
      r.status = "avoiding";
      r.waitTimer += dt;
      r.lastEvent = `Obstacle ahead at ${cellName(next)} — avoiding`;
      if (r.waitTimer > 0.8) {
        r.waitTimer = 0;
        this.replan(r, "dynamic obstacle");
      }
      return;
    }

    const blocker = this.conflictFor(r, next);
    if (blocker) {
      this.noteConflict(r, blocker, next);
      r.status = "waiting";
      r.waitTimer += dt;
      r.lastEvent = `Holding for ${blocker.name}`;
      if (r.waitTimer > YIELD_REPLAN_AFTER) {
        r.waitTimer = 0;
        this.replan(r, "persistent conflict");
      }
      return;
    }

    if (r.waitTimer > 0) {
      r.waitTimer = 0;
      this.resolveConflicts(r);
    }
    if (r.status === "waiting" || r.status === "avoiding") {
      r.status = r.carrying ? "to_dropoff" : "to_pickup";
    }

    const dx = next.x - r.pos.x;
    const dy = next.y - r.pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist < ARRIVE_EPS) {
      r.pos.x = next.x;
      r.pos.y = next.y;
      r.pathIndex += 1;
      if (r.pathIndex >= r.path.length) this.arrive(r);
      return;
    }

    const targetYaw = Math.atan2(dx, -dy);
    r.yaw = lerpAngle(r.yaw, targetYaw, 1 - Math.exp(-9 * dt));

    const stepLen = Math.min(r.speed * dt, dist);
    r.pos.x += (dx / dist) * stepLen;
    r.pos.y += (dy / dist) * stepLen;
    r.distance += stepLen;
    r.wheelSpin += stepLen * 4;
    r.battery = Math.max(0, r.battery - BATTERY_DRAIN * dt);
  }

  private arrive(r: Robot) {
    r.path = [];
    r.pathIndex = 0;
    if (r.status === "charging") {
      r.lastEvent = "Docked — charging";
      return;
    }
    this.handleTimers.set(r.id, HANDLE_TIME);
    r.lastEvent = r.carrying ? "Unloading" : "Loading item";
  }

  private finishHandling(r: Robot) {
    const task = this.tasks.find((t) => t.id === r.taskId);
    if (!task) {
      r.taskId = null;
      r.carrying = false;
      r.status = "idle";
      return;
    }
    if (!r.carrying) {
      r.carrying = true;
      task.status = "carrying";
      this.log("task", `${r.name} picked up ${task.id} at ${cellName(task.pickup)}`);
      this.setDestination(r, task.dropoff, "to_dropoff");
    } else {
      r.carrying = false;
      r.tasksDone += 1;
      task.status = "done";
      r.taskId = null;
      r.status = "idle";
      r.lastEvent = `Delivered ${task.id}`;
      this.log("delivery", `${r.name} delivered ${task.id} at ${cellName(task.dropoff)}`);
    }
    this.version++;
  }

  /* ------------------------------------------------------------------ output */

  log(kind: SimEvent["kind"], message: string) {
    eventSeq += 1;
    this.events.unshift({ id: eventSeq, t: this.time, kind, message });
    if (this.events.length > 120) this.events.length = 120;
  }

  snapshot(): Snapshot {
    return {
      time: this.time,
      running: this.running,
      scenario: this.scenario,
      robots: this.robots.map((r) => ({ ...r, pos: { ...r.pos }, path: r.path })),
      tasks: this.tasks.map((t) => ({ ...t })),
      obstacles: this.obstacles.map((o) => ({ ...o, pos: { ...o.pos } })),
      blockedCells: [...this.blocked],
      events: this.events.slice(0, 40),
      conflicts: this.conflicts.map((c) => ({ ...c })),
    };
  }
}

function lerpAngle(a: number, b: number, t: number) {
  let diff = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + diff * t;
}

export function cellName(c: Vec2) {
  return `(${c.x}, ${c.y})`;
}

let instance: Simulation | null = null;
/** Lazy singleton — never constructed at module scope (SSR/worker safe). */
export function getSim(): Simulation {
  if (!instance) instance = new Simulation();
  return instance;
}
