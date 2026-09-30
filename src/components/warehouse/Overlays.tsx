import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import { CELL, GRID_H, GRID_W, gridToWorld } from "@/sim/grid";
import { getSim } from "@/sim/engine";
import { useSimStore } from "@/sim/store";
import type { ConflictRecord, Robot } from "@/sim/types";

const ROBOT_COLORS = ["#ffb300", "#ff6b35", "#ffd166"];
const PATH_COLORS = ["#38bdf8", "#a3e635", "#f472b6"];

export function PathLines() {
  const snap = useSimStore((s) => s.snap);
  const showPaths = useSimStore((s) => s.showPaths);
  if (!showPaths) return null;

  return (
    <group>
      {snap.robots.map((r, i) => {
        if (r.path.length < 1) return null;
        const pts: [number, number, number][] = [
          [...gridToWorld(r.pos.x, r.pos.y)].slice(0, 1).length
            ? [gridToWorld(r.pos.x, r.pos.y)[0], 0.09, gridToWorld(r.pos.x, r.pos.y)[1]]
            : [0, 0.09, 0],
          ...r.path.slice(r.pathIndex).map((c) => {
            const [x, z] = gridToWorld(c.x, c.y);
            return [x, 0.09, z] as [number, number, number];
          }),
        ];
        if (pts.length < 2) return null;
        const dest = pts[pts.length - 1];
        if (!dest) return null;
        const pathColor = PATH_COLORS[i] ?? "#38bdf8";
        return (
          <group key={r.id}>
            <Line points={pts} color={pathColor} lineWidth={3} dashed dashSize={0.5} gapSize={0.3} />
            <mesh position={[dest[0], 0.1, dest[2]]} rotation-x={-Math.PI / 2}>
              <ringGeometry args={[0.55, 0.78, 28]} />
              <meshBasicMaterial color={pathColor} transparent opacity={0.9} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

export function BlockedCells() {
  const snap = useSimStore((s) => s.snap);
  return (
    <group>
      {snap.blockedCells.map((k) => {
        const parts = k.split(",").map(Number);
        const gx = parts[0] ?? 0;
        const gy = parts[1] ?? 0;
        const [x, z] = gridToWorld(gx, gy);
        return (
          <group key={k} position={[x, 0, z]}>
            <mesh rotation-x={-Math.PI / 2} position-y={0.03}>
              <planeGeometry args={[CELL * 0.95, CELL * 0.95]} />
              <meshStandardMaterial color="#b3261e" transparent opacity={0.45} />
            </mesh>
            <mesh position={[0, 0.5, 0]} castShadow>
              <coneGeometry args={[0.32, 0.9, 16]} />
              <meshStandardMaterial color="#ff5a1f" roughness={0.6} />
            </mesh>
            <mesh position={[0, 0.04, 0]}>
              <boxGeometry args={[0.8, 0.08, 0.8]} />
              <meshStandardMaterial color="#1b1e22" />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function ObstacleMesh({ id, kind }: { id: string; kind: "worker" | "pallet" }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const o = getSim().obstacles.find((x) => x.id === id);
    const g = ref.current;
    if (!g) return;
    if (!o) {
      g.visible = false;
      return;
    }
    g.visible = true;
    g.position.set(
      (o.pos.x - (GRID_W - 1) / 2) * CELL,
      0,
      (o.pos.y - (GRID_H - 1) / 2) * CELL,
    );
    g.rotation.y = Math.atan2(o.dir.x, -o.dir.y);
  });

  if (kind === "worker") {
    return (
      <group ref={ref}>
        <mesh position={[0, 0.45, 0]} castShadow>
          <cylinderGeometry args={[0.22, 0.26, 0.9, 14]} />
          <meshStandardMaterial color="#2b3a55" roughness={0.8} />
        </mesh>
        <mesh position={[0, 1.05, 0]} castShadow>
          <cylinderGeometry args={[0.3, 0.3, 0.52, 14]} />
          <meshStandardMaterial color="#f5f13a" roughness={0.6} />
        </mesh>
        <mesh position={[0, 1.42, 0]} castShadow>
          <sphereGeometry args={[0.2, 16, 12]} />
          <meshStandardMaterial color="#d9a06b" roughness={0.9} />
        </mesh>
        <mesh position={[0, 1.55, 0]} castShadow>
          <sphereGeometry args={[0.24, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#ff7a18" roughness={0.5} />
        </mesh>
      </group>
    );
  }
  return (
    <group ref={ref}>
      <mesh position={[0, 0.09, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.15, 0.18, 1.15]} />
        <meshStandardMaterial color="#9a7340" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[1, 0.72, 1]} />
        <meshStandardMaterial color="#c08b4a" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.9, 0]}>
        <boxGeometry args={[1.02, 0.1, 1.02]} />
        <meshStandardMaterial color="#e0e4e8" transparent opacity={0.55} />
      </mesh>
    </group>
  );
}

export function Obstacles() {
  const snap = useSimStore((s) => s.snap);
  return (
    <group>
      {snap.obstacles.map((o) => (
        <ObstacleMesh key={o.id} id={o.id} kind={o.kind} />
      ))}
    </group>
  );
}

function ConflictZoneMarker({ conflict }: { conflict: ConflictRecord }) {
  const [x, z] = gridToWorld(conflict.cell.x, conflict.cell.y);
  const pulseRef = useRef<THREE.Mesh>(null);
  const beaconRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (pulseRef.current) {
      const s = 1 + Math.sin(t * 5) * 0.12;
      pulseRef.current.scale.set(s, s, 1);
    }
    if (beaconRef.current) {
      beaconRef.current.rotation.y = t * 1.5;
    }
  });

  const isResolved = conflict.resolved;

  return (
    <group position={[x, 0, z]}>
      {/* Red Zone Warning Ground Disk */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.04}>
        <circleGeometry args={[2.5, 36]} />
        <meshBasicMaterial
          color={isResolved ? "#10b981" : "#ef4444"}
          transparent
          opacity={isResolved ? 0.2 : 0.32}
        />
      </mesh>

      {/* Pulsing Outer Hazard Ring */}
      <mesh ref={pulseRef} rotation-x={-Math.PI / 2} position-y={0.06}>
        <ringGeometry args={[2.3, 2.55, 36]} />
        <meshBasicMaterial
          color={isResolved ? "#34d399" : "#ff2222"}
          transparent
          opacity={isResolved ? 0.6 : 0.85}
        />
      </mesh>

      {/* Inner Hazard Perimeter */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.07}>
        <ringGeometry args={[1.3, 1.45, 32]} />
        <meshBasicMaterial
          color={isResolved ? "#059669" : "#f59e0b"}
          transparent
          opacity={0.7}
        />
      </mesh>

      {/* Vertical Warning Light Column */}
      {!isResolved && (
        <mesh ref={beaconRef} position-y={1.4}>
          <cylinderGeometry args={[1.8, 2.2, 2.8, 16, 1, true]} />
          <meshBasicMaterial
            color="#ef4444"
            transparent
            opacity={0.12}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      )}

      {/* 3D Floating Industrial Status Badge */}
      <Html position={[0, 2.8, 0]} center distanceFactor={28} style={{ pointerEvents: "none" }}>
        <div className="flex flex-col items-center gap-1 min-w-[270px] select-none pointer-events-none">
          {!isResolved ? (
            <>
              <div className="flex items-center gap-1.5 rounded-full border border-rose-500/80 bg-rose-950/90 px-3 py-1 shadow-xl shadow-rose-950/70 backdrop-blur-md animate-pulse">
                <span className="h-2 w-2 rounded-full bg-rose-400 animate-ping" />
                <span className="font-mono text-[11px] font-black tracking-wider text-rose-200">
                  ⚠️ COLLISION RED ZONE
                </span>
              </div>
              <div className="rounded-lg border border-rose-500/40 bg-[#12161f]/95 p-2 shadow-2xl backdrop-blur-md text-center">
                <div className="flex items-center justify-between gap-3 text-[10px] font-mono">
                  <span className="text-emerald-400 font-bold">PROCEEDING: {conflict.proceeding}</span>
                  <span className="text-amber-400 font-bold">YIELDING: {conflict.yielding}</span>
                </div>
                <div className="mt-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-mono font-medium text-amber-300">
                  {conflict.reason || "Priority Right-of-Way — Side Path Engaged"}
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-1.5 rounded-full border border-emerald-500 bg-emerald-950/90 px-3 py-1 shadow-xl shadow-emerald-950/70 backdrop-blur-md">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="font-mono text-[11px] font-bold text-emerald-300">
                ✅ CONFLICT RESOLVED — SIDE PATH ENGAGED
              </span>
            </div>
          )}
        </div>
      </Html>
    </group>
  );
}

function LidarAvoidanceMarker({ robot }: { robot: Robot }) {
  const [x, z] = gridToWorld(robot.pos.x, robot.pos.y);
  const ringRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ringRef.current) {
      const s = 1 + Math.sin(clock.elapsedTime * 6) * 0.08;
      ringRef.current.scale.set(s, s, 1);
    }
  });

  return (
    <group position={[x, 0, z]}>
      {/* 360 LiDAR Safety Ground Disk */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.05}>
        <circleGeometry args={[1.5, 32]} />
        <meshBasicMaterial color="#06b6d4" transparent opacity={0.16} />
      </mesh>
      {/* Pulsing Outer LiDAR Scan Ring */}
      <mesh ref={ringRef} rotation-x={-Math.PI / 2} position-y={0.06}>
        <ringGeometry args={[1.4, 1.55, 32]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.75} />
      </mesh>
      <Html position={[0, 2.3, 0]} center distanceFactor={28} style={{ pointerEvents: "none" }}>
        <div className="flex items-center gap-1.5 rounded-full border border-sky-400/80 bg-sky-950/90 px-3 py-1 shadow-xl shadow-sky-950/70 backdrop-blur-md select-none pointer-events-none">
          <span className="h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
          <span className="font-mono text-[10px] font-bold text-cyan-200">
            🚶 LiDAR DETECTION — AVOIDING OBSTACLE
          </span>
        </div>
      </Html>
    </group>
  );
}

function FailedRobotMarker({ robot }: { robot: Robot }) {
  const [x, z] = gridToWorld(robot.pos.x, robot.pos.y);
  const ringRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ringRef.current) {
      const s = 1 + Math.sin(clock.elapsedTime * 4) * 0.06;
      ringRef.current.scale.set(s, s, 1);
    }
  });

  return (
    <group position={[x, 0, z]}>
      {/* Danger Ground Disk */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.05}>
        <circleGeometry args={[1.8, 36]} />
        <meshBasicMaterial color="#ef4444" transparent opacity={0.25} />
      </mesh>
      {/* Outer Hazard Warning Ring */}
      <mesh ref={ringRef} rotation-x={-Math.PI / 2} position-y={0.06}>
        <ringGeometry args={[1.65, 1.85, 36]} />
        <meshBasicMaterial color="#ff2222" transparent opacity={0.85} />
      </mesh>
      <Html position={[0, 2.7, 0]} center distanceFactor={28} style={{ pointerEvents: "none" }}>
        <div className="flex flex-col items-center gap-1 select-none pointer-events-none min-w-[240px]">
          <div className="flex items-center gap-1.5 rounded-full border border-rose-500/90 bg-rose-950/95 px-3 py-1 shadow-xl shadow-rose-950/80 backdrop-blur-md animate-pulse">
            <span className="h-2 w-2 rounded-full bg-rose-400 animate-ping" />
            <span className="font-mono text-[11px] font-black tracking-wider text-rose-200">
              🛑 {robot.name} E-STOP: FAULT ISOLATED
            </span>
          </div>
          <div className="rounded border border-rose-500/40 bg-[#12161f]/95 px-2 py-0.5 text-[9px] font-mono text-zinc-300">
            Fleet Routing Safely Around Disabled Unit
          </div>
        </div>
      </Html>
    </group>
  );
}

function ReallocatedTaskMarker({ robot, taskId }: { robot: Robot; taskId: string }) {
  const [x, z] = gridToWorld(robot.pos.x, robot.pos.y);
  return (
    <group position={[x, 0, z]}>
      <Html position={[0, 2.4, 0]} center distanceFactor={28} style={{ pointerEvents: "none" }}>
        <div className="flex items-center gap-1.5 rounded-full border border-amber-500/90 bg-[#161a23]/95 px-3 py-1 shadow-xl shadow-amber-950/70 backdrop-blur-md select-none pointer-events-none">
          <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
          <span className="font-mono text-[10px] font-bold text-amber-300">
            ⚡ REALLOCATED MISSION ({taskId}) → {robot.name}
          </span>
        </div>
      </Html>
    </group>
  );
}

export function ConflictMarkers() {
  const snap = useSimStore((s) => s.snap);
  const avoidingRobots = snap.robots.filter((r) => r.status === "avoiding");
  const failedRobots = snap.robots.filter((r) => r.status === "failed");
  const reallocatedTasks = snap.tasks.filter((t) => t.reassignments > 0 && t.assignedTo && t.status !== "done");

  return (
    <group>
      {/* Collision resolution markers only in Scenario 4 */}
      {snap.scenario === 4 && snap.conflicts.map((c) => (
        <ConflictZoneMarker key={c.id} conflict={c} />
      ))}

      {/* Scenario 6: Obstacle Avoidance Visual Overlays */}
      {avoidingRobots.map((r) => (
        <LidarAvoidanceMarker key={`avoid-${r.id}`} robot={r} />
      ))}

      {/* Scenario 7 & 8: Emergency Stop & Fault Isolation Overlays */}
      {failedRobots.map((r) => (
        <FailedRobotMarker key={`failed-${r.id}`} robot={r} />
      ))}

      {/* Scenario 8: Task Reallocation Overlays */}
      {reallocatedTasks.map((t) => {
        const assignedRobot = snap.robots.find((r) => r.id === t.assignedTo);
        if (!assignedRobot) return null;
        return <ReallocatedTaskMarker key={`realloc-${t.id}`} robot={assignedRobot} taskId={t.id} />;
      })}
    </group>
  );
}

export function SelectionRing() {
  const selected = useSimStore((s) => s.selected);
  const ref = useRef<THREE.Mesh>(null);
  const index = useMemo(() => (selected ? Number(selected.slice(1)) - 1 : -1), [selected]);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    if (index < 0) {
      m.visible = false;
      return;
    }
    const r = getSim().robots[index];
    if (!r) return;
    m.visible = true;
    m.position.set(
      (r.pos.x - (GRID_W - 1) / 2) * CELL,
      0.07,
      (r.pos.y - (GRID_H - 1) / 2) * CELL,
    );
    const s = 1 + Math.sin(clock.elapsedTime * 3) * 0.06;
    m.scale.setScalar(s);
  });
  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2} visible={false}>
      <ringGeometry args={[1.05, 1.3, 40]} />
      <meshBasicMaterial color={ROBOT_COLORS[0] ?? "#ffb300"} transparent opacity={0.85} />
    </mesh>
  );
}
