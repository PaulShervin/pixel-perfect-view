import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import { CELL, GRID_H, GRID_W } from "@/sim/grid";
import { getSim } from "@/sim/engine";

const BODY_YELLOW = "#f2a417";
const BODY_DARK = "#26292e";

function Wheel({
  position,
  side,
  innerRef,
}: {
  position: [number, number, number];
  side: "left" | "right";
  innerRef: React.Ref<THREE.Group>;
}) {
  const isLeft = side === "left";
  const rimFaceX = isLeft ? -0.118 : 0.118;
  const boltFaceX = isLeft ? -0.126 : 0.126;

  return (
    <group position={position}>
      {/* Static axle mount to chassis */}
      <mesh position={[isLeft ? 0.07 : -0.07, 0, 0]}>
        <boxGeometry args={[0.06, 0.14, 0.16]} />
        <meshStandardMaterial color="#1a1d22" roughness={0.8} />
      </mesh>

      {/* Rotating wheel group — spins around its own local X-axis */}
      <group ref={innerRef}>
        {/* Main rubber tire */}
        <mesh rotation-z={Math.PI / 2} castShadow>
          <cylinderGeometry args={[0.3, 0.3, 0.22, 24]} />
          <meshStandardMaterial color="#141619" roughness={0.95} />
        </mesh>

        {/* Outer tire tread profile accent */}
        <mesh rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.303, 0.303, 0.08, 24]} />
          <meshStandardMaterial color="#1f2329" roughness={0.9} />
        </mesh>

        {/* Metallic alloy rim */}
        <mesh rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.18, 0.18, 0.235, 18]} />
          <meshStandardMaterial color="#8b94a0" metalness={0.85} roughness={0.25} />
        </mesh>

        {/* Inner rim recess */}
        <mesh position={[rimFaceX, 0, 0]} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.15, 0.15, 0.02, 18]} />
          <meshStandardMaterial color="#2a303a" metalness={0.7} roughness={0.4} />
        </mesh>

        {/* Center hub cap */}
        <mesh position={[rimFaceX, 0, 0]} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.06, 0.06, 0.03, 16]} />
          <meshStandardMaterial color="#181c22" metalness={0.5} roughness={0.5} />
        </mesh>

        {/* 5 Wheel rim lug nuts in circular pattern */}
        {Array.from({ length: 5 }).map((_, k) => {
          const a = (k * 2 * Math.PI) / 5;
          return (
            <mesh
              key={k}
              position={[boltFaceX, Math.sin(a) * 0.1, Math.cos(a) * 0.1]}
              rotation-z={Math.PI / 2}
            >
              <cylinderGeometry args={[0.016, 0.016, 0.016, 6]} />
              <meshStandardMaterial color="#d8dee9" metalness={0.95} roughness={0.2} />
            </mesh>
          );
        })}

        {/* Spoke accent notches */}
        {Array.from({ length: 4 }).map((_, k) => {
          const a = (k * Math.PI) / 2;
          return (
            <mesh
              key={`spoke-${k}`}
              position={[rimFaceX, Math.sin(a) * 0.12, Math.cos(a) * 0.12]}
              rotation-x={a}
            >
              <boxGeometry args={[0.018, 0.035, 0.035]} />
              <meshStandardMaterial color="#353c47" metalness={0.8} roughness={0.3} />
            </mesh>
          );
        })}

        {/* Valve stem marker on outer rim lip for crisp visual rotation */}
        <mesh position={[boltFaceX, 0.22, 0]} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.012, 0.012, 0.02, 8]} />
          <meshStandardMaterial color="#ffaa00" emissive="#ffaa00" emissiveIntensity={0.8} />
        </mesh>
      </group>
    </group>
  );
}

export function Amr({ index }: { index: number }) {
  const group = useRef<THREE.Group>(null);
  const flWheel = useRef<THREE.Group>(null);
  const rlWheel = useRef<THREE.Group>(null);
  const frWheel = useRef<THREE.Group>(null);
  const rrWheel = useRef<THREE.Group>(null);
  const lidar = useRef<THREE.Group>(null);
  const beacon = useRef<THREE.Mesh>(null);
  const crate = useRef<THREE.Group>(null);
  const scan = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const r = getSim().robots[index];
    const g = group.current;
    if (!r || !g) return;
    const x = (r.pos.x - (GRID_W - 1) / 2) * CELL;
    const z = (r.pos.y - (GRID_H - 1) / 2) * CELL;
    g.position.set(x, 0, z);
    g.rotation.y = r.yaw;

    // Correct local-axis rotation for each individual wheel
    const leftSpin = -(r.leftWheelSpin ?? r.wheelSpin);
    const rightSpin = -(r.rightWheelSpin ?? r.wheelSpin);
    if (flWheel.current) flWheel.current.rotation.x = leftSpin;
    if (rlWheel.current) rlWheel.current.rotation.x = leftSpin;
    if (frWheel.current) frWheel.current.rotation.x = rightSpin;
    if (rrWheel.current) rrWheel.current.rotation.x = rightSpin;

    if (lidar.current) lidar.current.rotation.y = r.lidarSpin;
    if (scan.current) {
      scan.current.rotation.z = r.lidarSpin;
      (scan.current.material as THREE.MeshBasicMaterial).opacity =
        r.status === "failed" ? 0 : 0.12;
    }
    if (crate.current) crate.current.visible = r.carrying;
    if (beacon.current) {
      const mat = beacon.current.material as THREE.MeshStandardMaterial;
      const color =
        r.status === "failed"
          ? "#ff3b30"
          : r.status === "waiting" || r.status === "avoiding"
            ? "#ffcc00"
            : r.status === "charging"
              ? "#3d9dff"
              : r.status === "idle"
                ? "#9aa1ab"
                : "#39d98a";
      mat.color.set(color);
      mat.emissive.set(color);
      mat.emissiveIntensity = r.status === "failed" ? 2.6 : 1.5;
    }
  });

  const label = `AMR-0${index + 1}`;

  return (
    <group ref={group}>
      {/* chassis */}
      <mesh position={[0, 0.42, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.25, 0.34, 1.85]} />
        <meshStandardMaterial color={BODY_YELLOW} roughness={0.42} metalness={0.25} />
      </mesh>
      {/* lower skirt with bumpers */}
      <mesh position={[0, 0.2, 0]} castShadow>
        <boxGeometry args={[1.12, 0.22, 1.95]} />
        <meshStandardMaterial color={BODY_DARK} roughness={0.7} />
      </mesh>
      {[-0.95, 0.95].map((z) => (
        <mesh key={z} position={[0, 0.2, z]} castShadow>
          <boxGeometry args={[1.2, 0.18, 0.12]} />
          <meshStandardMaterial color="#111316" roughness={0.9} />
        </mesh>
      ))}
      {/* deck plate */}
      <mesh position={[0, 0.62, -0.1]} castShadow>
        <boxGeometry args={[1.15, 0.08, 1.4]} />
        <meshStandardMaterial color="#2f343b" metalness={0.65} roughness={0.35} />
      </mesh>
      {/* hazard stripes */}
      {[-0.63, 0.63].map((x) => (
        <mesh key={x} position={[x, 0.42, 0]}>
          <boxGeometry args={[0.02, 0.2, 1.7]} />
          <meshStandardMaterial color={BODY_DARK} />
        </mesh>
      ))}

      {/* Wheels with individual spin axes */}
      <Wheel position={[-0.68, 0.3, -0.62]} side="left" innerRef={flWheel} />
      <Wheel position={[0.68, 0.3, -0.62]} side="right" innerRef={frWheel} />
      <Wheel position={[-0.68, 0.3, 0.62]} side="left" innerRef={rlWheel} />
      <Wheel position={[0.68, 0.3, 0.62]} side="right" innerRef={rrWheel} />

      {/* LiDAR tower */}
      <group position={[0, 0.66, -0.62]}>
        <mesh position={[0, 0.12, 0]} castShadow>
          <cylinderGeometry args={[0.16, 0.19, 0.24, 20]} />
          <meshStandardMaterial color="#1b1e22" roughness={0.5} metalness={0.4} />
        </mesh>
        <group ref={lidar} position={[0, 0.3, 0]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.17, 0.17, 0.16, 20]} />
            <meshStandardMaterial color="#2a2e34" metalness={0.6} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0, 0.14]}>
            <boxGeometry args={[0.12, 0.09, 0.05]} />
            <meshStandardMaterial color="#ff4d4d" emissive="#ff2222" emissiveIntensity={2} />
          </mesh>
        </group>
        <mesh position={[0, 0.4, 0]}>
          <cylinderGeometry args={[0.18, 0.18, 0.03, 20]} />
          <meshStandardMaterial color="#14171a" />
        </mesh>
      </group>

      {/* LiDAR scan disc */}
      <mesh ref={scan} position={[0, 0.96, -0.62]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[3.4, 40, 0, Math.PI * 0.8]} />
        <meshBasicMaterial
          color="#5ad1ff"
          transparent
          opacity={0.12}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Jetson Nano compute module */}
      <group position={[0.02, 0.72, 0.28]}>
        <mesh castShadow>
          <boxGeometry args={[0.52, 0.12, 0.46]} />
          <meshStandardMaterial color="#12452f" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.14, 0]} castShadow>
          <boxGeometry args={[0.3, 0.16, 0.3]} />
          <meshStandardMaterial color="#8b9199" metalness={0.85} roughness={0.25} />
        </mesh>
        {[-0.1, 0, 0.1].map((x) => (
          <mesh key={x} position={[x, 0.23, 0]}>
            <boxGeometry args={[0.02, 0.02, 0.28]} />
            <meshStandardMaterial color="#c6ccd4" metalness={0.9} />
          </mesh>
        ))}
        <mesh position={[0.2, 0.08, 0.2]}>
          <boxGeometry args={[0.05, 0.02, 0.05]} />
          <meshStandardMaterial color="#39d98a" emissive="#39d98a" emissiveIntensity={2} />
        </mesh>
        <Text position={[0, 0.07, 0.24]} fontSize={0.09} color="#d7e3dc">
          JETSON
        </Text>
      </group>

      {/* status beacon */}
      <mesh ref={beacon} position={[-0.42, 0.74, -0.2]}>
        <sphereGeometry args={[0.1, 16, 12]} />
        <meshStandardMaterial color="#39d98a" emissive="#39d98a" emissiveIntensity={1.5} />
      </mesh>

      {/* carried payload */}
      <group ref={crate} position={[0, 0.85, -0.05]} visible={false}>
        <mesh castShadow>
          <boxGeometry args={[0.95, 0.6, 1.05]} />
          <meshStandardMaterial color="#b5813f" roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.0, 0.53]}>
          <boxGeometry args={[0.2, 0.55, 0.02]} />
          <meshStandardMaterial color="#e2d8bd" />
        </mesh>
      </group>

      <Text
        position={[0, 1.35, 0.4]}
        fontSize={0.3}
        color="#0f1216"
        outlineWidth={0.03}
        outlineColor="#f2f5f7"
        anchorX="center"
      >
        {label}
      </Text>
    </group>
  );
}
