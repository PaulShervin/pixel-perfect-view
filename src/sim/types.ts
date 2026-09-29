import type { Vec2 } from "./grid";

export type RobotStatus =
  | "idle"
  | "to_pickup"
  | "to_dropoff"
  | "waiting"
  | "avoiding"
  | "charging"
  | "failed";

export interface Robot {
  id: string;
  name: string;
  /** Continuous grid-space position (x = column, y = row). */
  pos: { x: number; y: number };
  yaw: number;
  battery: number;
  status: RobotStatus;
  path: Vec2[];
  pathIndex: number;
  taskId: string | null;
  carrying: boolean;
  dest: Vec2 | null;
  waitTimer: number;
  speed: number;
  wheelSpin: number;
  lidarSpin: number;
  distance: number;
  tasksDone: number;
  reroutes: number;
  conflicts: number;
  lastEvent: string;
}

export type TaskStatus = "pending" | "assigned" | "carrying" | "done";

export interface Task {
  id: string;
  label: string;
  pickup: Vec2;
  dropoff: Vec2;
  /** 1 = routine, 3 = urgent. */
  urgency: number;
  status: TaskStatus;
  assignedTo: string | null;
  reassignments: number;
  createdAt: number;
}

export interface Obstacle {
  id: string;
  pos: { x: number; y: number };
  kind: "worker" | "pallet";
  moving: boolean;
  dir: Vec2;
  speed: number;
}

export type EventKind =
  | "info"
  | "task"
  | "assign"
  | "delivery"
  | "conflict"
  | "reroute"
  | "failure"
  | "obstacle"
  | "battery";

export interface SimEvent {
  id: number;
  t: number;
  kind: EventKind;
  message: string;
}

export interface ConflictRecord {
  id: string;
  cell: Vec2;
  yielding: string;
  proceeding: string;
  resolved: boolean;
  t: number;
}

export interface Snapshot {
  time: number;
  running: boolean;
  scenario: number;
  robots: Robot[];
  tasks: Task[];
  obstacles: Obstacle[];
  blockedCells: string[];
  events: SimEvent[];
  conflicts: ConflictRecord[];
}
