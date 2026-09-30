// Core warehouse simulation. Framework-agnostic: the renderer and dashboard
// only read from this, so the same engine can later be driven by a backend.

import {
  CELL,
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
  ScenarioNarrative,
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
      pos: { ...START_CELLS[i]! },
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
      leftWheelSpin: 0,
      rightWheelSpin: 0,
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
        for (let i = 0; i < 4; i++) this.addTask(PICKUPS[i]!, DROPOFFS[i]!, 1 + (i % 2));
        this.log("info", "Continuous fleet logistics: AMRs assigned routine retrieval & delivery missions");
        break;
      }
      case 2: {
        for (let i = 0; i < 8; i++) {
          this.addTask(PICKUPS[i % 4]!, DROPOFFS[(i + 2) % 4]!, (i % 3) + 1);
        }
        this.robots[1]!.battery = 44;
        this.robots[2]!.battery = 76;
        this.log("info", "Fleet batteries differ — Dispatch Cost Matrix accounts for battery drain & urgency");
        break;
      }
      case 3: {
        this.addTask(PICKUPS[0]!, DROPOFFS[3]!, 2);
        this.addTask(PICKUPS[3]!, DROPOFFS[0]!, 2);
        this.addTask(PICKUPS[1]!, DROPOFFS[2]!, 1);
        this.log("info", "A* search live trajectories computed avoiding static racks and warehouse walls");
        break;
      }
      case 4: {
        // Direct head-on collision convergence on central cross-aisle y=10.
        // AMR-01 at (7, 10) heading East to (26, 10) — High Priority (Urgency 3)
        // AMR-02 at (21, 10) heading West to (2, 10) — Low Priority (Urgency 1)
        // AMR-03 at (14, 2) heading South to (14, 18) — Transverse cross traffic
        this.robots[0]!.pos = { x: 7, y: 10 };
        this.robots[0]!.carrying = true;
        this.robots[0]!.battery = 98;
        const t1 = this.addTask({ x: 7, y: 10 }, { x: 26, y: 10 }, 3);
        t1.status = "carrying";
        t1.assignedTo = "R1";
        this.robots[0]!.taskId = t1.id;
        this.setDestination(this.robots[0]!, t1.dropoff, "to_dropoff");

        this.robots[1]!.pos = { x: 21, y: 10 };
        this.robots[1]!.carrying = true;
        this.robots[1]!.battery = 84;
        const t2 = this.addTask({ x: 21, y: 10 }, { x: 2, y: 10 }, 1);
        t2.status = "carrying";
        t2.assignedTo = "R2";
        this.robots[1]!.taskId = t2.id;
        this.setDestination(this.robots[1]!, t2.dropoff, "to_dropoff");

        this.robots[2]!.pos = { x: 14, y: 2 };
        this.robots[2]!.carrying = false;
        this.robots[2]!.battery = 90;
        const t3 = this.addTask({ x: 14, y: 2 }, { x: 14, y: 18 }, 2);
        t3.status = "assigned";
        t3.assignedTo = "R3";
        this.robots[2]!.taskId = t3.id;
        this.setDestination(this.robots[2]!, t3.dropoff, "to_dropoff");

        this.log("info", "Head-on collision convergence configured on cross-aisle y=10");
        break;
      }
      case 5: {
        this.addTask(PICKUPS[0]!, DROPOFFS[0]!, 2);
        this.addTask(PICKUPS[2]!, DROPOFFS[2]!, 1);
        this.scripts.push({
          at: 6,
          done: false,
          run: (s) => s.blockAisle(14, true),
        });
        this.scripts.push({
          at: 17,
          done: false,
          run: (s) => s.blockAisle(14, false),
        });
        this.log("info", "Corridor Aisle 14 scheduled for maintenance closure at t=6s");
        break;
      }
      case 6: {
        // Scenario 6: Obstacle Avoidance
        this.obstacles = [];

        // AMR-01: Cross-aisle corridor transit on y=10 from West (x=3) to East (x=26)
        this.robots[0]!.pos = { x: 3, y: 10 };
        this.robots[0]!.carrying = true;
        this.robots[0]!.battery = 95;
        const t1 = this.addTask({ x: 3, y: 10 }, { x: 26, y: 10 }, 2);
        t1.assignedTo = "R1";
        t1.status = "carrying";
        this.robots[0]!.taskId = t1.id;
        this.setDestination(this.robots[0]!, t1.dropoff, "to_dropoff");

        // AMR-02: North-to-South transit on aisle x=7 from y=3 to y=18
        this.robots[1]!.pos = { x: 7, y: 3 };
        this.robots[1]!.carrying = true;
        this.robots[1]!.battery = 90;
        const t2 = this.addTask({ x: 7, y: 3 }, { x: 7, y: 18 }, 2);
        t2.assignedTo = "R2";
        t2.status = "carrying";
        this.robots[1]!.taskId = t2.id;
        this.setDestination(this.robots[1]!, t2.dropoff, "to_dropoff");

        // AMR-03: South-to-North transit on aisle x=19 from y=18 to y=3
        this.robots[2]!.pos = { x: 19, y: 18 };
        this.robots[2]!.carrying = true;
        this.robots[2]!.battery = 88;
        const t3 = this.addTask({ x: 19, y: 18 }, { x: 19, y: 3 }, 2);
        t3.assignedTo = "R3";
        t3.status = "carrying";
        this.robots[2]!.taskId = t3.id;
        this.setDestination(this.robots[2]!, t3.dropoff, "to_dropoff");

        // Dynamic Obstacle 1: Moving warehouse worker crossing aisle y=10 at x=14
        // Starts at (14, 7), walking South into AMR-01's transit corridor
        this.obstacles.push({
          id: "O1",
          pos: { x: 14, y: 7 },
          kind: "worker",
          moving: true,
          dir: { x: 0, y: 1 },
          speed: 0.65,
        });

        // Dynamic Obstacle 2: Pallet obstacle placed in Aisle 7 at (7, 12) blocking AMR-02
        this.obstacles.push({
          id: "O2",
          pos: { x: 7, y: 12 },
          kind: "pallet",
          moving: false,
          dir: { x: 0, y: 0 },
          speed: 0,
        });

        // Dynamic Obstacle 3: Moving worker in East warehouse approaching x=19, y=9
        this.obstacles.push({
          id: "O3",
          pos: { x: 19, y: 9 },
          kind: "worker",
          moving: true,
          dir: { x: 0, y: 1 },
          speed: 0.5,
        });

        this.log("info", "Obstacle Avoidance active: 360° LiDAR envelope configured for moving workers & pallets");
        break;
      }
      case 7: {
        // Scenario 7: Robot Failure & Safety Interlock
        // AMR-02: Leading unit driving along central cross aisle y=10
        this.robots[1]!.pos = { x: 7, y: 10 };
        this.robots[1]!.carrying = true;
        this.robots[1]!.battery = 85;
        const t2 = this.addTask({ x: 7, y: 10 }, { x: 26, y: 10 }, 2);
        t2.assignedTo = "R2";
        t2.status = "carrying";
        this.robots[1]!.taskId = t2.id;
        this.setDestination(this.robots[1]!, t2.dropoff, "to_dropoff");

        // AMR-01: Following unit driving behind AMR-02 towards (26, 10)
        // Path passes right through (14, 10) where AMR-02 will fault!
        this.robots[0]!.pos = { x: 2, y: 10 };
        this.robots[0]!.carrying = false;
        this.robots[0]!.battery = 94;
        const t1 = this.addTask({ x: 3, y: 10 }, { x: 26, y: 10 }, 2);
        t1.assignedTo = "R1";
        t1.status = "assigned";
        this.robots[0]!.taskId = t1.id;
        this.setDestination(this.robots[0]!, t1.pickup, "to_pickup");

        // AMR-03: South warehouse cross traffic
        this.robots[2]!.pos = { x: 14, y: 18 };
        this.robots[2]!.carrying = false;
        this.robots[2]!.battery = 91;
        const t3 = this.addTask({ x: 14, y: 18 }, { x: 26, y: 18 }, 1);
        t3.assignedTo = "R3";
        t3.status = "assigned";
        this.robots[2]!.taskId = t3.id;
        this.setDestination(this.robots[2]!, t3.pickup, "to_pickup");

        // At t=4.8s, AMR-02 reaches center intersection (14, 10) and suffers hardware failure!
        this.scripts.push({
          at: 4.8,
          done: false,
          run: (s) => s.failRobot("R2"),
        });

        // At t=19.0s, recover AMR-02
        this.scripts.push({
          at: 19.0,
          done: false,
          run: (s) => s.recoverRobot("R2"),
        });

        this.log("info", "Hardware drive fault scheduled for AMR-02 at t=4.8s at center intersection (14, 10)");
        break;
      }
      case 8: {
        // Scenario 8: Task Reallocation
        // High-priority Task T01 assigned explicitly to AMR-02
        this.robots[1]!.pos = { x: 7, y: 10 };
        this.robots[1]!.carrying = false;
        this.robots[1]!.battery = 88;
        const t1 = this.addTask({ x: 18, y: 4 }, { x: 4, y: 18 }, 3); // High priority Lv.3
        t1.assignedTo = "R2";
        t1.status = "assigned";
        this.robots[1]!.taskId = t1.id;
        this.setDestination(this.robots[1]!, t1.pickup, "to_pickup");

        // AMR-01: Standing by at south staging area (2, 18), ready for reallocation
        this.robots[0]!.pos = { x: 2, y: 18 };
        this.robots[0]!.carrying = false;
        this.robots[0]!.battery = 98;
        this.robots[0]!.status = "idle";
        this.robots[0]!.path = [];
        this.robots[0]!.dest = null;
        this.robots[0]!.taskId = null;
        this.robots[0]!.lastEvent = "Standing by — ready for task allocation";

        // AMR-03: Routine mission in East wing
        this.robots[2]!.pos = { x: 26, y: 18 };
        this.robots[2]!.carrying = false;
        this.robots[2]!.battery = 90;
        const t3 = this.addTask({ x: 26, y: 17 }, { x: 26, y: 4 }, 1);
        t3.assignedTo = "R3";
        t3.status = "assigned";
        this.robots[2]!.taskId = t3.id;
        this.setDestination(this.robots[2]!, t3.pickup, "to_pickup");

        // At t=4.2s, while AMR-02 is en route to Task T01 pickup, AMR-02 suffers hardware fault!
        this.scripts.push({
          at: 4.2,
          done: false,
          run: (s) => s.failRobot("R2"),
        });

        // At t=19.0s, recover AMR-02
        this.scripts.push({
          at: 19.0,
          done: false,
          run: (s) => s.recoverRobot("R2"),
        });

        this.log("info", "Task Reallocation active: High-priority Task T01 assigned to AMR-02; failure at t=4.2s");
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
    const p = PICKUPS[Math.floor(Math.random() * PICKUPS.length)]!;
    const d = DROPOFFS[Math.floor(Math.random() * DROPOFFS.length)]!;
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
      dir: dirs[Math.floor(Math.random() * dirs.length)]!,
      speed: kind === "worker" ? 0.9 : 0.5,
    });
    this.log("obstacle", `${kind === "worker" ? "Worker" : "Pallet"} detected at ${cellName(pos)}`);
    this.version++;
  }

  addObstacleNearFleet() {
    // Drop an obstacle a few cells ahead of a busy robot so avoidance triggers.
    const busy = this.robots.find((r) => r.path.length > 3 && r.status !== "failed");
    if (busy) {
      const cell = busy.path[Math.min(busy.pathIndex + 3, busy.path.length - 1)]!;
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
    r.lastEvent = "🛑 E-Stop: Motor Controller Fault";
    this.log("failure", `🛑 ${r.name} failed and stopped safely — emergency stop engaged`);

    let revokedTask: Task | null = null;
    if (r.taskId) {
      const task = this.tasks.find((t) => t.id === r.taskId);
      if (task && task.status !== "done") {
        task.status = "pending";
        task.assignedTo = null;
        task.reassignments += 1;
        revokedTask = task;
        this.log("task", `⚡ Task ${task.id} automatically revoked from ${r.name} for reallocation`);
      }
      r.taskId = null;
      r.carrying = false;
    }

    // Safety broadcast: any active robot whose planned route passes within 1.2 cells of the failed robot
    // must immediately calculate a detour around it!
    for (const other of this.robots) {
      if (other.id !== r.id && other.status !== "failed" && other.dest) {
        const passesNear = other.path.slice(other.pathIndex).some(
          (c) => Math.hypot(c.x - r.pos.x, c.y - r.pos.y) <= 1.2,
        );
        if (passesNear) {
          this.replan(other, `disabled ${r.name}`);
        }
      }
    }

    // Immediately trigger allocation so any revoked task is reassigned right away
    if (revokedTask) {
      this.allocate();
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

    this.checkConflictResolutions();

    // In Scenario 1 (Normal Operation), keep replenishing tasks so the fleet is never idle
    if (this.scenario === 1 && this.tasks.filter((t) => t.status !== "done").length < 3) {
      this.addRandomTask();
    }

    // Age out resolved conflicts after 4.5s
    this.conflicts = this.conflicts.filter((c) => !c.resolved || this.time - c.t < 4.5);
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
      if (this.blocked.has(key(r.path[i]!.x, r.path[i]!.y))) return true;
    }
    return false;
  }

  private obstacleAt(cell: Vec2, radius = 0.65) {
    return this.obstacles.some(
      (o) => Math.hypot(o.pos.x - cell.x, o.pos.y - cell.y) < radius,
    );
  }

  /** Priority: urgency, then carrying, then battery, then id — higher wins right of way. */
  private priority(r: Robot) {
    const task = this.tasks.find((t) => t.id === r.taskId);
    const urgency = task?.urgency ?? 1;
    return urgency * 10 + (r.carrying ? 5 : 0) + r.battery * 0.1 + (3 - Number(r.id.slice(1)));
  }

  private conflictFor(r: Robot, next: Vec2): Robot | null {
    for (const other of this.robots) {
      if (other.id === r.id || other.status === "failed") continue;
      const oc = { x: Math.round(other.pos.x), y: Math.round(other.pos.y) };
      const on = other.path[other.pathIndex];
      const sameCell = oc.x === next.x && oc.y === next.y;
      const sameTarget = Boolean(on && on.x === next.x && on.y === next.y);

      // In Scenario 4, head-on corridor approaches are specifically detected within 3.5 cells
      if (this.scenario === 4) {
        const rx = Math.round(r.pos.x);
        const ry = Math.round(r.pos.y);
        const isHeadOnX =
          ry === oc.y &&
          Math.abs(rx - oc.x) <= 3.5 &&
          ((oc.x - rx) * (next.x - r.pos.x) > 0);
        const isHeadOnY =
          rx === oc.x &&
          Math.abs(ry - oc.y) <= 3.5 &&
          ((oc.y - ry) * (next.y - r.pos.y) > 0);

        if (isHeadOnX || isHeadOnY) {
          return other;
        }
      }

      if (sameCell || sameTarget) {
        return other;
      }
    }
    return null;
  }

  private takeSidePath(yielding: Robot, proceeding: Robot): boolean {
    if (!yielding.dest) return false;

    const start = { x: Math.round(yielding.pos.x), y: Math.round(yielding.pos.y) };
    const detourBlocks = this.dynamicBlocks(yielding);

    // Block proceeding robot's current cell
    const procCell = { x: Math.round(proceeding.pos.x), y: Math.round(proceeding.pos.y) };
    detourBlocks.add(key(procCell.x, procCell.y));

    // Block proceeding robot's forward corridor path cells (next 4 waypoints)
    for (let i = proceeding.pathIndex; i < Math.min(proceeding.path.length, proceeding.pathIndex + 4); i++) {
      const p = proceeding.path[i];
      if (p) detourBlocks.add(key(p.x, p.y));
    }

    // If head-on on the same corridor row/col, block the corridor cells in between
    if (procCell.y === start.y) {
      const minX = Math.min(procCell.x, start.x);
      const maxX = Math.max(procCell.x, start.x);
      for (let x = minX; x <= maxX; x++) {
        detourBlocks.add(key(x, start.y));
      }
    } else if (procCell.x === start.x) {
      const minY = Math.min(procCell.y, start.y);
      const maxY = Math.max(procCell.y, start.y);
      for (let y = minY; y <= maxY; y++) {
        detourBlocks.add(key(start.x, y));
      }
    }

    // Candidate adjacent side-step neighbors (e.g. into the vertical aisle or adjacent open cell)
    const neighbors: Vec2[] = [
      { x: start.x, y: start.y + 1 },
      { x: start.x, y: start.y - 1 },
      { x: start.x + 1, y: start.y },
      { x: start.x - 1, y: start.y },
    ];

    let bestSidePath: Vec2[] | null = null;
    for (const n of neighbors) {
      if (!inBounds(n.x, n.y) || isRack(n.x, n.y) || detourBlocks.has(key(n.x, n.y))) continue;
      const p = aStar(n, yielding.dest, detourBlocks);
      if (p.length > 0) {
        bestSidePath = [n, ...p];
        break;
      } else if (!bestSidePath) {
        // Standby side cell even if long-range A* doesn't immediately reach goal while corridor is blocked
        bestSidePath = [n];
      }
    }

    if (!bestSidePath) {
      const p = aStar(start, yielding.dest, detourBlocks);
      if (p.length > 0) bestSidePath = p;
    }

    if (bestSidePath && bestSidePath.length > 0) {
      yielding.path = bestSidePath;
      yielding.pathIndex = 0;
      yielding.reroutes += 1;
      yielding.status = "avoiding";
      yielding.waitTimer = 0;
      const firstHop = bestSidePath[0]!;
      yielding.lastEvent = `Yielding to ${proceeding.name} — side path via (${firstHop.x}, ${firstHop.y})`;
      this.log(
        "reroute",
        `↪️ ${yielding.name} yielded to ${proceeding.name} (Priority) — taking side-path detour via (${firstHop.x}, ${firstHop.y})`,
      );
      this.version++;
      return true;
    }

    return false;
  }

  private noteConflict(yielding: Robot, proceeding: Robot, cell: Vec2) {
    if (this.scenario !== 4) return;
    const id = `${yielding.id}-${proceeding.id}`;
    let c = this.conflicts.find((x) => x.id === id);
    const midCell = {
      x: Math.round((yielding.pos.x + proceeding.pos.x) / 2),
      y: Math.round((yielding.pos.y + proceeding.pos.y) / 2),
    };
    if (!c) {
      c = {
        id,
        cell: midCell,
        yielding: yielding.name,
        proceeding: proceeding.name,
        yieldingId: yielding.id,
        proceedingId: proceeding.id,
        yieldingPos: { ...yielding.pos },
        proceedingPos: { ...proceeding.pos },
        phase: "diverting",
        reason: `${proceeding.name} holds Priority Right-of-Way — ${yielding.name} taking side path`,
        resolved: false,
        t: this.time,
      };
      this.conflicts.push(c);
      yielding.conflicts += 1;
      this.log(
        "conflict",
        `🚨 Collision Zone: ${yielding.name} yields to ${proceeding.name} (Priority) — taking side-path detour`,
      );
      this.version++;
    } else {
      c.cell = midCell;
      c.yieldingPos = { ...yielding.pos };
      c.proceedingPos = { ...proceeding.pos };
      c.t = this.time;
      if (!c.resolved) {
        c.phase = "diverting";
      }
    }
  }

  private checkConflictResolutions() {
    for (const c of this.conflicts) {
      if (c.resolved) continue;
      const yielding = this.robots.find((r) => r.name === c.yielding);
      const proceeding = this.robots.find((r) => r.name === c.proceeding);
      if (!yielding || !proceeding) continue;

      const dist = Math.hypot(yielding.pos.x - proceeding.pos.x, yielding.pos.y - proceeding.pos.y);
      const diffRow = Math.abs(yielding.pos.y - proceeding.pos.y) > 0.8;
      const diffCol = Math.abs(yielding.pos.x - proceeding.pos.x) > 0.8;

      if (dist > 3.2 || (diffRow && dist > 1.4) || (diffCol && dist > 1.4)) {
        c.resolved = true;
        c.phase = "resolved";
        this.log("conflict", `✅ Conflict resolved: ${c.proceeding} passed; ${c.yielding} cleared corridor`);
        this.version++;
      }
    }
  }

  private resolveConflicts(r: Robot) {
    for (const c of this.conflicts) {
      if (c.yielding === r.name && !c.resolved) {
        c.resolved = true;
        c.phase = "resolved";
        this.log("conflict", `${r.name} cleared the collision zone at ${cellName(c.cell)}`);
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
      const charger = CHARGERS[Number(r.id.slice(1)) - 1]! ?? CHARGERS[0]!;
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
    const next = r.path[r.pathIndex]!;
    if (!next) {
      this.arrive(r);
      return;
    }

    // Check if next waypoint is near a failed robot — detour safely
    const failedBlocker = this.robots.find(
      (other) => other.status === "failed" && Math.hypot(other.pos.x - next.x, other.pos.y - next.y) < 0.95,
    );
    if (failedBlocker) {
      r.status = "avoiding";
      r.lastEvent = `Disabled ${failedBlocker.name} ahead — routing around`;
      this.replan(r, `disabled ${failedBlocker.name}`);
      return;
    }

    // LiDAR-style forward check for dynamic obstacles.
    if (this.obstacleAt(next, 0.75)) {
      r.status = "avoiding";
      r.waitTimer += dt;
      r.lastEvent = `Obstacle ahead at ${cellName(next)} — avoiding`;
      if (r.waitTimer > 0.6) {
        r.waitTimer = 0;
        this.replan(r, "dynamic obstacle");
      }
      return;
    }

    const blocker = this.conflictFor(r, next);
    if (blocker) {
      const myPriority = this.priority(r);
      const otherPriority = this.priority(blocker);

      if (this.scenario === 4) {
        if (myPriority >= otherPriority) {
          // High priority robot (holds right-of-way)
          this.noteConflict(blocker, r, next);

          // Tell lower priority robot to take side path if not already avoiding
          if (blocker.status !== "avoiding") {
            this.takeSidePath(blocker, r);
          }

          // If blocker is still physically on my next cell, pause briefly
          const blockerCell = { x: Math.round(blocker.pos.x), y: Math.round(blocker.pos.y) };
          if (blockerCell.x === next.x && blockerCell.y === next.y) {
            r.status = "waiting";
            r.waitTimer += dt;
            r.lastEvent = `Waiting for ${blocker.name} to vacate corridor`;
            return;
          }
          // Lane is clear or blocker is stepping aside: continue forward!
        } else {
          // Low priority robot (yielding robot)
          this.noteConflict(r, blocker, next);
          r.status = "avoiding";
          r.waitTimer += dt;
          this.takeSidePath(r, blocker);
          return;
        }
      } else {
        // In other scenarios, courtesy yielding without false-alarm Collision Red Zones
        if (myPriority < otherPriority) {
          r.status = "waiting";
          r.waitTimer += dt;
          r.lastEvent = `Holding for ${blocker.name}`;
          if (r.waitTimer > 1.5) {
            r.waitTimer = 0;
            this.replan(r, "traffic clearance");
          }
          return;
        }
      }
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
    const prevYaw = r.yaw;
    r.yaw = lerpAngle(r.yaw, targetYaw, 1 - Math.exp(-9 * dt));
    const yawDelta = Math.atan2(Math.sin(r.yaw - prevYaw), Math.cos(r.yaw - prevYaw));

    const stepLen = Math.min(r.speed * dt, dist);
    r.pos.x += (dx / dist) * stepLen;
    r.pos.y += (dy / dist) * stepLen;
    r.distance += stepLen;

    // Physical wheel rolling:
    // Distance in world meters is stepLen * CELL (CELL = 2m).
    // Wheel radius = 0.3m. Forward roll (rad) = (stepLen * CELL) / 0.3
    // Half track width = 0.68m. Turning roll (rad) = (yawDelta * 0.68) / 0.3
    const forwardRoll = (stepLen * CELL) / 0.3;
    const turnRoll = (yawDelta * 0.68) / 0.3;
    r.wheelSpin += forwardRoll;
    r.leftWheelSpin = (r.leftWheelSpin ?? 0) + forwardRoll + turnRoll;
    r.rightWheelSpin = (r.rightWheelSpin ?? 0) + forwardRoll - turnRoll;
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

  getScenarioNarrative(): ScenarioNarrative {
    const s = this.scenario;
    const t = this.time;
    const activeConflict = this.conflicts.find((c) => !c.resolved);

    switch (s) {
      case 1: {
        const doneCount = this.tasks.filter((tk) => tk.status === "done").length;
        let step = 1;
        let liner = "Fleet Initialized: 3 AMRs standing by at charging and pickup docks.";
        if (t > 2 && t <= 9) {
          step = 2;
          liner = "Autonomous Transit: AMRs navigating optimal routes between rack storage bays and dropoffs.";
        } else if (t > 9 && t <= 20) {
          step = 3;
          liner = "Synchronized Logistics: AMRs carrying pallets across aisles with speed & heading regulation.";
        } else if (t > 20) {
          step = 4;
          liner = `Continuous Fleet Flow: ${doneCount} deliveries completed. Replenishment queue active.`;
        }
        return {
          scenarioId: 1,
          title: "Scenario 01: Normal Operation",
          subtitle: "Multi-AMR steady-state logistics fleet with continuous pick, carry & delivery cycles.",
          currentLiner: liner,
          activeStep: step,
          steps: [
            { id: 1, label: "Fleet Dispatch", status: step > 1 ? "completed" : "active" },
            { id: 2, label: "Rack Retrieval", status: step > 2 ? "completed" : step === 2 ? "active" : "pending" },
            { id: 3, label: "Synchronized Transit", status: step > 3 ? "completed" : step === 3 ? "active" : "pending" },
            { id: 4, label: "Continuous Dropoff", status: step === 4 ? "active" : "pending" },
          ],
          alert: null,
        };
      }
      case 2: {
        let step = 1;
        let liner = "Order Ingestion: 8 tasks loaded with varying urgencies (Levels 1 to 3).";
        if (t > 2 && t <= 8) {
          step = 2;
          liner = "Cost Matrix Evaluation: Dispatcher evaluates Score = Distance + (100 - Battery)×0.12 + Load×9 - Urgency×5.";
        } else if (t > 8 && t <= 18) {
          step = 3;
          liner = "Battery-Aware Allocation: AMR-01 (100% batt) takes urgent tasks; AMR-02 (44% batt) takes local low-drain tasks.";
        } else if (t > 18) {
          step = 4;
          liner = "Workload Balanced: Fleet executing missions with optimized battery conservation.";
        }
        return {
          scenarioId: 2,
          title: "Scenario 02: Task Allocation",
          subtitle: "Multi-factor dispatch scoring accounting for distance, battery %, workload, and urgency.",
          currentLiner: liner,
          activeStep: step,
          steps: [
            { id: 1, label: "Queue Ingest", status: step > 1 ? "completed" : "active" },
            { id: 2, label: "Heuristic Scoring", status: step > 2 ? "completed" : step === 2 ? "active" : "pending" },
            { id: 3, label: "Optimal Assignment", status: step > 3 ? "completed" : step === 3 ? "active" : "pending" },
            { id: 4, label: "Execution", status: step === 4 ? "active" : "pending" },
          ],
          alert: {
            type: "info",
            title: "Dispatcher Heuristic",
            text: "Cost = Dist(1.0) + (100-Batt)*0.12 + Load*9 - Urgency*5",
          },
        };
      }
      case 3: {
        let step = 1;
        let liner = "Grid Space Mapping: 29×21 grid cells analyzed for static storage racks and travel corridors.";
        if (t > 2 && t <= 8) {
          step = 2;
          liner = "A* Search Compute: Manhattan distance heuristic evaluating shortest collision-free paths.";
        } else if (t > 8 && t <= 16) {
          step = 3;
          liner = "Waypoint Generation: Discrete grid cells translated to smooth continuous robot trajectories.";
        } else if (t > 16) {
          step = 4;
          liner = "Closed-Loop Tracking: AMRs executing dynamic steering & velocity profiling along planned paths.";
        }
        return {
          scenarioId: 3,
          title: "Scenario 03: Path Planning",
          subtitle: "Real-time A* search through warehouse cross-aisles with color-coded trajectories.",
          currentLiner: liner,
          activeStep: step,
          steps: [
            { id: 1, label: "Grid Graph", status: step > 1 ? "completed" : "active" },
            { id: 2, label: "A* Heuristic", status: step > 2 ? "completed" : step === 2 ? "active" : "pending" },
            { id: 3, label: "Waypoints", status: step > 3 ? "completed" : step === 3 ? "active" : "pending" },
            { id: 4, label: "Path Following", status: step === 4 ? "active" : "pending" },
          ],
          alert: null,
        };
      }
      case 4: {
        let step = 1;
        let liner = "Converging on Aisle 10: AMR-01 (Urgent Lv.3) and AMR-02 (Routine Lv.1) heading directly towards each other.";
        let alert: ScenarioNarrative["alert"] = null;

        if (activeConflict) {
          if (activeConflict.phase === "diverting") {
            step = 4;
            liner = `🚨 RED ZONE: Collision risk detected at ${cellName(activeConflict.cell)}! AMR-01 holds Right-of-Way. AMR-02 yields and takes Side-Path Detour!`;
            alert = {
              type: "danger",
              title: "Collision Hazard Active",
              text: "AMR-01 holds priority right-of-way (Score 46.8 > 24.4). AMR-02 diverting to side path!",
            };
          } else {
            step = 3;
            liner = `⚠️ Conflict Detected at ${cellName(activeConflict.cell)}: Priority Arbiter evaluating right-of-way.`;
            alert = {
              type: "warning",
              title: "Priority Arbitration",
              text: "AMR-01 (Urgent Cargo) granted priority over AMR-02 (Routine).",
            };
          }
        } else if (t >= 7) {
          step = 5;
          liner = "✅ Conflict Resolved: Deadlock averted! AMR-01 proceeded forward uninterrupted; AMR-02 bypassed through side aisle.";
          alert = {
            type: "success",
            title: "Deadlock Prevented",
            text: "AMR-02 side-path detour successful. Both AMRs completing missions.",
          };
        } else if (t > 2.5) {
          step = 2;
          liner = "Proximity Alert: Robots within 4 cells on shared aisle y=10. Collision safety zone activating.";
          alert = {
            type: "warning",
            title: "Proximity Warning",
            text: "AMR-01 and AMR-02 converging head-on.",
          };
        }

        return {
          scenarioId: 4,
          title: "Scenario 04: Collision Resolution & Priority Side Path",
          subtitle: "Head-on collision detection with priority right-of-way and automatic side-path detour.",
          currentLiner: liner,
          activeStep: step,
          steps: [
            { id: 1, label: "Head-On Convergence", status: step > 1 ? "completed" : "active" },
            { id: 2, label: "Red Zone Warning", status: step > 2 ? "completed" : step === 2 ? "active" : "pending" },
            { id: 3, label: "Priority Arbiter", status: step > 3 ? "completed" : step === 3 ? "active" : "pending" },
            { id: 4, label: "Side-Path Detour", status: step > 4 ? "completed" : step === 4 ? "active" : "pending" },
            { id: 5, label: "Corridor Cleared", status: step === 5 ? "completed" : "pending" },
          ],
          alert,
        };
      }
      case 5: {
        const isBlocked = this.blocked.size > 0;
        let step = 1;
        let liner = "Normal Corridor Transit: AMRs scheduled to pass through central vertical Aisle 14.";
        let alert: ScenarioNarrative["alert"] = null;

        if (isBlocked) {
          step = 3;
          liner = "⚠️ Aisle 14 Blocked: Maintenance cones deployed! AMRs dynamically recalculating A* routes around obstruction.";
          alert = {
            type: "warning",
            title: "Corridor Obstructed",
            text: "Aisle x=14 closed. Dynamic rerouting engaged via Aisle 10 & 18.",
          };
        } else if (t > 17) {
          step = 4;
          liner = "Corridor Cleared: Maintenance cones removed. Standard shortest paths restored.";
          alert = {
            type: "success",
            title: "Corridor Reopened",
            text: "Nominal A* paths active.",
          };
        } else if (t > 4) {
          step = 2;
          liner = "Traffic Approaching Aisle 14: Central crossing under high utilization.";
        }

        return {
          scenarioId: 5,
          title: "Scenario 05: Dynamic Rerouting",
          subtitle: "Sudden corridor blockage triggering instantaneous A* path recalculation across the fleet.",
          currentLiner: liner,
          activeStep: step,
          steps: [
            { id: 1, label: "Normal Transit", status: step > 1 ? "completed" : "active" },
            { id: 2, label: "Hazard Warning", status: step > 2 ? "completed" : step === 2 ? "active" : "pending" },
            { id: 3, label: "Dynamic Replanning", status: step > 3 ? "completed" : step === 3 ? "active" : "pending" },
            { id: 4, label: "Corridor Reopened", status: step === 4 ? "completed" : "pending" },
          ],
          alert,
        };
      }
      case 6: {
        const avoiding = this.robots.some((r) => r.status === "avoiding");
        const anyDelivered = this.tasks.some((t) => t.status === "done");
        let step = 1;
        let liner = "Virtual LiDAR Active: 360° LiDAR safety zones (0.7m radius) monitoring pedestrian and pallet corridors.";
        let alert: ScenarioNarrative["alert"] = null;

        if (avoiding) {
          step = 3;
          liner = "🚶 LiDAR Detection: Dynamic obstacle detected in safety corridor! AMR executing dynamic A* detour around obstruction.";
          alert = {
            type: "warning",
            title: "LiDAR Safety Evasion",
            text: "Pedestrian / pallet in safety envelope. AMR holding & maneuvering around obstacle.",
          };
        } else if (anyDelivered || t > 12) {
          step = 4;
          liner = "Dynamic Avoidance Successful: AMRs safely negotiated around moving warehouse workers and delivered cargo.";
          alert = {
            type: "success",
            title: "Avoidance Verified",
            text: "All dynamic obstacles cleared safely with zero collisions.",
          };
        } else if (t > 3) {
          step = 2;
          liner = "Workers in Cross-Transit: Pedestrians and pallets moving across active robot lanes.";
        }

        return {
          scenarioId: 6,
          title: "Scenario 06: Obstacle Avoidance",
          subtitle: "Dynamic pedestrian and pallet detection with LiDAR safety envelope and evasive steering.",
          currentLiner: liner,
          activeStep: step,
          steps: [
            { id: 1, label: "LiDAR Scanning", status: step > 1 ? "completed" : "active" },
            { id: 2, label: "Obstacle En Route", status: step > 2 ? "completed" : step === 2 ? "active" : "pending" },
            { id: 3, label: "Safety Stop / Evasion", status: step > 3 ? "completed" : step === 3 ? "active" : "pending" },
            { id: 4, label: "Safe Clearance", status: step === 4 ? "completed" : "pending" },
          ],
          alert,
        };
      }
      case 7: {
        const r2 = this.robots.find((r) => r.id === "R2");
        const failed = r2?.status === "failed";
        const anyDelivered = this.tasks.some((t) => t.status === "done");
        let step = 1;
        let liner = "Fleet In Nominal Operation: 3 AMRs actively servicing warehouse inventory routes.";
        let alert: ScenarioNarrative["alert"] = null;

        if (failed) {
          step = 3;
          liner = "🛑 Emergency Stop: AMR-02 suffered hardware drive fault! E-Stop engaged; fleet routing safely around disabled unit.";
          alert = {
            type: "danger",
            title: "Hardware Fault: AMR-02",
            text: "Motor controller fault detected. AMR-02 halted; fleet dynamically routing around disabled unit.",
          };
        } else if (t > 17 || anyDelivered) {
          step = 4;
          liner = "Fleet Resilience: AMR-01 and AMR-03 continuing operations smoothly around disabled unit.";
          alert = {
            type: "success",
            title: "Fleet Continuity",
            text: "Zero delivery loss; fleet adapted around disabled unit.",
          };
        } else if (t > 3) {
          step = 2;
          liner = "AMR-02 Drive Telemetry: Motor controller reporting temperature warning.";
        }

        return {
          scenarioId: 7,
          title: "Scenario 07: Robot Failure",
          subtitle: "Emergency stop fault injection on AMR-02, verifying safety isolation and fleet continuity.",
          currentLiner: liner,
          activeStep: step,
          steps: [
            { id: 1, label: "Nominal Flow", status: step > 1 ? "completed" : "active" },
            { id: 2, label: "Fault Detection", status: step > 2 ? "completed" : step === 2 ? "active" : "pending" },
            { id: 3, label: "Safe E-Stop Isolation", status: step > 3 ? "completed" : step === 3 ? "active" : "pending" },
            { id: 4, label: "Fleet Adaptation", status: step === 4 ? "completed" : "pending" },
          ],
          alert,
        };
      }
      case 8: {
        const r2 = this.robots.find((r) => r.id === "R2");
        const reallocatedTask = this.tasks.find((tk) => tk.reassignments > 0);
        const taskDone = reallocatedTask?.status === "done";
        let step = 1;
        let liner = "Mission Dispatched: AMR-02 assigned high-priority Task T01.";
        let alert: ScenarioNarrative["alert"] = null;

        if (taskDone) {
          step = 4;
          liner = "Mission Saved: Reallocated Task T01 successfully retrieved and delivered by AMR-01 with zero loss.";
          alert = {
            type: "success",
            title: "Delivery Saved",
            text: "Zero delivery loss despite hardware failure on AMR-02.",
          };
        } else if (r2?.status === "failed" && reallocatedTask && reallocatedTask.assignedTo) {
          step = 3;
          liner = `⚡ Automatic Reallocation: AMR-02 faulted! Task ${reallocatedTask.id} automatically revoked and reassigned to ${reallocatedTask.assignedTo}.`;
          alert = {
            type: "warning",
            title: "Task Reallocated",
            text: `Task ${reallocatedTask.id} revoked from faulted AMR-02 and reassigned to ${reallocatedTask.assignedTo}.`,
          };
        } else if (t > 3) {
          step = 2;
          liner = "AMR-02 en route to retrieve high-priority Task T01.";
        }

        return {
          scenarioId: 8,
          title: "Scenario 08: Task Reallocation",
          subtitle: "Automatic revocation and reassignment of active tasks when a carrier AMR faults.",
          currentLiner: liner,
          activeStep: step,
          steps: [
            { id: 1, label: "Mission In Flight", status: step > 1 ? "completed" : "active" },
            { id: 2, label: "Fault Event", status: step > 2 ? "completed" : step === 2 ? "active" : "pending" },
            { id: 3, label: "Task Reallocation", status: step > 3 ? "completed" : step === 3 ? "active" : "pending" },
            { id: 4, label: "Mission Fulfilled", status: step === 4 ? "completed" : "pending" },
          ],
          alert,
        };
      }
      default:
        return {
          scenarioId: s,
          title: `Scenario ${s}`,
          subtitle: "Simulation running.",
          currentLiner: "Simulation running.",
          activeStep: 1,
          steps: [],
          alert: null,
        };
    }
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
      narrative: this.getScenarioNarrative(),
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
