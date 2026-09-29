import { useMemo, useRef } from "react";
import * as THREE from "three";
import { Text } from "@react-three/drei";
import {
  AISLE_XS,
  CELL,
  DROPOFFS,
  CHARGERS,
  GRID_H,
  GRID_W,
  PICKUPS,
  RACK_RUNS,
  WAREHOUSE_DEPTH,
  WAREHOUSE_WIDTH,
  gridToWorld,
} from "@/sim/grid";
import { makeCartonTexture, makeConcreteTexture, makeWallTexture } from "./textures";

const STEEL = "#3f4855";
const RACK_ORANGE = "#c2560f";
const DECK = "#8f6c3f";

function RackRun({ x, z0, z1 }: { x: number; z0: number; z1: number }) {
  const [wx0, wz0] = gridToWorld(x, z0);
  const [, wz1] = gridToWorld(x, z1);
  const length = Math.abs(wz1 - wz0) + CELL;
  const width = CELL * 2;
  const cx = wx0 + CELL / 2;
  const cz = (wz0 + wz1) / 2;
  const levels = [0.95, 2.05, 3.15];

  return (
    <group position={[cx, 0, cz]}>
      {/* uprights */}
      {[-width / 2 + 0.12, width / 2 - 0.12].map((ox) =>
        Array.from({ length: Math.round(length / CELL) + 1 }).map((_, i) => (
          <mesh
            key={`${ox}-${i}`}
            position={[ox, 2.1, -length / 2 + i * CELL]}
            castShadow
          >
            <boxGeometry args={[0.16, 4.2, 0.16]} />
            <meshStandardMaterial color={RACK_ORANGE} roughness={0.55} metalness={0.35} />
          </mesh>
        )),
      )}
      {/* beams + decks */}
      {levels.map((y) => (
        <group key={y}>
          <mesh position={[0, y, 0]} receiveShadow castShadow>
            <boxGeometry args={[width - 0.3, 0.07, length - 0.1]} />
            <meshStandardMaterial color={DECK} roughness={0.85} />
          </mesh>
          {[-width / 2 + 0.14, width / 2 - 0.14].map((ox) => (
            <mesh key={ox} position={[ox, y + 0.06, 0]} castShadow>
              <boxGeometry args={[0.12, 0.16, length]} />
              <meshStandardMaterial color={"#1f4f8b"} roughness={0.5} metalness={0.4} />
            </mesh>
          ))}
        </group>
      ))}
      {/* back mesh panel */}
      <mesh position={[0, 2.1, 0]}>
        <boxGeometry args={[0.05, 4, length - 0.2]} />
        <meshStandardMaterial color={STEEL} roughness={0.7} metalness={0.3} transparent opacity={0.35} />
      </mesh>
    </group>
  );
}

function Cartons() {
  const tex = useMemo(() => makeCartonTexture(), []);
  const ref = useRef<THREE.InstancedMesh>(null);
  const items = useMemo(() => {
    const out: Array<{ p: [number, number, number]; s: [number, number, number]; r: number }> = [];
    let seed = 7;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (const run of RACK_RUNS) {
      const [wx] = gridToWorld(run.x, run.z0);
      const [, z0] = gridToWorld(run.x, run.z0);
      const [, z1] = gridToWorld(run.x, run.z1);
      for (const y of [0.95, 2.05, 3.15]) {
        for (let z = z0 - 0.6; z < z1 + 0.6; z += 1.15) {
          if (rnd() < 0.22) continue;
          const w = 0.7 + rnd() * 0.35;
          const h = 0.55 + rnd() * 0.35;
          out.push({
            p: [wx + CELL / 2 + (rnd() - 0.5) * 1.3, y + h / 2 + 0.04, z + rnd() * 0.2],
            s: [w, h, 0.8 + rnd() * 0.25],
            r: (rnd() - 0.5) * 0.12,
          });
        }
      }
    }
    return out;
  }, []);

  useMemo(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const d = new THREE.Object3D();
    items.forEach((it, i) => {
      d.position.set(...it.p);
      d.scale.set(...it.s);
      d.rotation.set(0, it.r, 0);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [items, ref.current]);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, items.length]} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial map={tex} roughness={0.9} />
    </instancedMesh>
  );
}

function Station({
  cell,
  label,
  color,
}: {
  cell: { x: number; y: number };
  label: string;
  color: string;
}) {
  const [x, z] = gridToWorld(cell.x, cell.y);
  return (
    <group position={[x, 0, z]}>
      <mesh rotation-x={-Math.PI / 2} position-y={0.02} receiveShadow>
        <planeGeometry args={[CELL * 0.95, CELL * 0.95]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.03}>
        <ringGeometry args={[CELL * 0.33, CELL * 0.4, 32]} />
        <meshStandardMaterial color="#12161c" />
      </mesh>
      {/* conveyor stub */}
      <mesh position={[0, 0.45, 0]} castShadow>
        <boxGeometry args={[1.1, 0.12, 1.5]} />
        <meshStandardMaterial color={STEEL} metalness={0.6} roughness={0.4} />
      </mesh>
      {[-0.5, 0.5].map((ox) => (
        <mesh key={ox} position={[ox, 0.22, 0]} castShadow>
          <boxGeometry args={[0.1, 0.44, 1.4]} />
          <meshStandardMaterial color="#20262f" metalness={0.5} roughness={0.5} />
        </mesh>
      ))}
      <Text
        position={[0, 0.06, CELL * 0.32]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.42}
        color="#101418"
        anchorX="center"
      >
        {label}
      </Text>
    </group>
  );
}

function Charger({ cell, label }: { cell: { x: number; y: number }; label: string }) {
  const [x, z] = gridToWorld(cell.x, cell.y);
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.55, -0.7]} castShadow>
        <boxGeometry args={[1, 1.1, 0.35]} />
        <meshStandardMaterial color="#2b323c" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.95, -0.5]}>
        <boxGeometry args={[0.5, 0.25, 0.06]} />
        <meshStandardMaterial color="#39d98a" emissive="#39d98a" emissiveIntensity={1.4} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
        <planeGeometry args={[CELL * 0.9, CELL * 0.9]} />
        <meshStandardMaterial color="#2f6f4a" roughness={0.7} />
      </mesh>
      <Text
        position={[0, 0.05, 0.6]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.36}
        color="#0d1216"
      >
        {label}
      </Text>
    </group>
  );
}

function AisleMarkings() {
  return (
    <group>
      {AISLE_XS.map((x) => {
        const [wx] = gridToWorld(x, 0);
        return (
          <mesh key={x} rotation-x={-Math.PI / 2} position={[wx, 0.012, 0]} receiveShadow>
            <planeGeometry args={[0.1, WAREHOUSE_DEPTH - 6]} />
            <meshStandardMaterial color="#d8c33a" roughness={0.8} />
          </mesh>
        );
      })}
      {/* cross aisle + perimeter safety lanes */}
      {[10, 1, GRID_H - 2].map((y) => {
        const [, wz] = gridToWorld(0, y);
        return (
          <mesh key={y} rotation-x={-Math.PI / 2} position={[0, 0.012, wz]}>
            <planeGeometry args={[WAREHOUSE_WIDTH - 4, 0.12]} />
            <meshStandardMaterial color="#d8c33a" roughness={0.8} />
          </mesh>
        );
      })}
    </group>
  );
}

function Shell() {
  const wallTex = useMemo(() => makeWallTexture(), []);
  const w = WAREHOUSE_WIDTH + 4;
  const d = WAREHOUSE_DEPTH + 4;
  const h = 9;
  return (
    <group>
      {/* walls */}
      {[
        { p: [0, h / 2, -d / 2] as [number, number, number], r: 0, len: w },
        { p: [0, h / 2, d / 2] as [number, number, number], r: Math.PI, len: w },
        { p: [-w / 2, h / 2, 0] as [number, number, number], r: Math.PI / 2, len: d },
        { p: [w / 2, h / 2, 0] as [number, number, number], r: -Math.PI / 2, len: d },
      ].map((wall, i) => (
        <mesh key={i} position={wall.p} rotation-y={wall.r} receiveShadow>
          <planeGeometry args={[wall.len, h]} />
          <meshStandardMaterial
            map={wallTex}
            color="#8b939c"
            side={THREE.DoubleSide}
            roughness={0.75}
            metalness={0.15}
          />
        </mesh>
      ))}
      {/* roof */}
      <mesh position={[0, h, 0]} rotation-x={Math.PI / 2}>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color="#20252c" side={THREE.DoubleSide} roughness={0.9} />
      </mesh>
      {/* trusses + light fixtures */}
      {Array.from({ length: 7 }).map((_, i) => {
        const z = -d / 2 + 4 + i * ((d - 8) / 6);
        return (
          <group key={i} position={[0, 0, z]}>
            <mesh position={[0, h - 0.6, 0]}>
              <boxGeometry args={[w - 1, 0.25, 0.25]} />
              <meshStandardMaterial color="#4a525c" metalness={0.5} roughness={0.5} />
            </mesh>
            {[-16, 0, 16].map((x) => (
              <group key={x} position={[x, h - 1.2, 0]}>
                <mesh>
                  <boxGeometry args={[3.2, 0.18, 0.5]} />
                  <meshStandardMaterial
                    color="#f6f2e4"
                    emissive="#fff4d6"
                    emissiveIntensity={1.7}
                  />
                </mesh>
                <mesh position={[0, 0.16, 0]}>
                  <boxGeometry args={[3.4, 0.2, 0.7]} />
                  <meshStandardMaterial color="#2e343c" metalness={0.4} />
                </mesh>
              </group>
            ))}
          </group>
        );
      })}
    </group>
  );
}

export function Warehouse() {
  const floorTex = useMemo(() => makeConcreteTexture(), []);
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[WAREHOUSE_WIDTH + 4, WAREHOUSE_DEPTH + 4]} />
        <meshStandardMaterial map={floorTex} roughness={0.55} metalness={0.05} color="#9a9ea4" />
      </mesh>
      <AisleMarkings />
      <Shell />
      {RACK_RUNS.map((r) => (
        <RackRun key={`${r.x}-${r.z0}`} {...r} />
      ))}
      <Cartons />
      {PICKUPS.map((c, i) => (
        <Station key={`p${i}`} cell={c} label={`PICK-0${i + 1}`} color="#3d7fd6" />
      ))}
      {DROPOFFS.map((c, i) => (
        <Station key={`d${i}`} cell={c} label={`DROP-0${i + 1}`} color="#2f9e6a" />
      ))}
      {CHARGERS.map((c, i) => (
        <Charger key={`c${i}`} cell={c} label={`CHG-0${i + 1}`} />
      ))}
      {/* grid extents guide */}
      <gridHelper
        args={[Math.max(GRID_W, GRID_H) * CELL, Math.max(GRID_W, GRID_H), "#5b6069", "#555a62"]}
        position={[0, 0.005, 0]}
      />
    </group>
  );
}
