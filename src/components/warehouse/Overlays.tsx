import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import { CELL, GRID_H, GRID_W, gridToWorld } from "@/sim/grid";
import { getSim } from "@/sim/engine";
import { useSimStore } from "@/sim/store";

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
        return (
          <group key={r.id}>
            <Line points={pts} color={PATH_COLORS[i]} lineWidth={3} dashed dashSize={0.5} gapSize={0.3} />
            <mesh position={[dest[0], 0.1, dest[2]]} rotation-x={-Math.PI / 2}>
              <ringGeometry args={[0.55, 0.78, 28]} />
              <meshBasicMaterial color={PATH_COLORS[i]} transparent opacity={0.9} />
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
        const [gx, gy] = k.split(",").map(Number);
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

export function ConflictMarkers() {
  const snap = useSimStore((s) => s.snap);
  const active = snap.conflicts.filter((c) => !c.resolved);
  return (
    <group>
      {active.map((c) => {
        const [x, z] = gridToWorld(c.cell.x, c.cell.y);
        return (
          <mesh key={c.id} position={[x, 0.08, z]} rotation-x={-Math.PI / 2}>
            <ringGeometry args={[0.7, 1.0, 32]} />
            <meshBasicMaterial color="#ff3b30" transparent opacity={0.8} />
          </mesh>
        );
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
      <meshBasicMaterial color={ROBOT_COLORS[0]} transparent opacity={0.85} />
    </mesh>
  );
}
