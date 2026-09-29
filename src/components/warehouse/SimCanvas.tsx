import { Suspense, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { getSim } from "@/sim/engine";
import { useSimStore } from "@/sim/store";
import { WAREHOUSE_DEPTH, WAREHOUSE_WIDTH } from "@/sim/grid";
import { Warehouse } from "./Warehouse";
import { Amr } from "./Amr";
import {
  BlockedCells,
  ConflictMarkers,
  Obstacles,
  PathLines,
  SelectionRing,
} from "./Overlays";

function Ticker() {
  const acc = useRef(0);
  useFrame((_, dt) => {
    const sim = getSim();
    sim.step(dt);
    acc.current += dt;
    if (acc.current >= 0.1) {
      acc.current = 0;
      useSimStore.getState().refresh();
    }
  });
  return null;
}

export function SimCanvas() {
  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={{ position: [0, 34, 40], fov: 48 }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={["#1a1f27"]} />
      <fog attach="fog" args={["#1a1f27", 70, 150]} />

      <hemisphereLight args={["#cdd7e2", "#4a4d52", 0.55]} />
      <ambientLight intensity={0.45} />
      <directionalLight
        position={[26, 34, 18]}
        intensity={1.35}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-45}
        shadow-camera-right={45}
        shadow-camera-top={35}
        shadow-camera-bottom={-35}
        shadow-bias={-0.0005}
      />
      <directionalLight position={[-24, 20, -16]} intensity={0.45} color="#b9c6d6" />

      <Environment>
        <Lightformer intensity={1.6} position={[0, 12, 0]} scale={[30, 20, 1]} />
        <Lightformer
          intensity={0.8}
          color="#cfe0f0"
          position={[-20, 6, 0]}
          rotation-y={Math.PI / 2}
          scale={[40, 4, 1]}
        />
        <Lightformer
          intensity={0.8}
          color="#f2e2c6"
          position={[20, 6, 0]}
          rotation-y={-Math.PI / 2}
          scale={[40, 4, 1]}
        />
      </Environment>

      <Suspense fallback={null}>
        <Warehouse />
        <Amr index={0} />
        <Amr index={1} />
        <Amr index={2} />
        <Obstacles />
        <BlockedCells />
        <PathLines />
        <ConflictMarkers />
        <SelectionRing />
        <ContactShadows
          position={[0, 0.02, 0]}
          scale={Math.max(WAREHOUSE_WIDTH, WAREHOUSE_DEPTH)}
          opacity={0.4}
          blur={2.4}
          far={6}
          resolution={1024}
        />
      </Suspense>

      <Ticker />
      <OrbitControls
        makeDefault
        target={[0, 0, 0]}
        minDistance={8}
        maxDistance={95}
        maxPolarAngle={Math.PI / 2.15}
        enableDamping
        dampingFactor={0.08}
      />
    </Canvas>
  );
}
