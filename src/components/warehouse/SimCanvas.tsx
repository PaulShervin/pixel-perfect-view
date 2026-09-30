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
      camera={{ position: [0, 36, 46], fov: 46 }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={["#141820"]} />
      <fog attach="fog" args={["#141820", 90, 240]} />

      <hemisphereLight args={["#cdd7e2", "#4a4d52", 0.55]} />
      <ambientLight intensity={0.45} />
      <directionalLight
        position={[32, 48, 24]}
        intensity={1.35}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-48}
        shadow-camera-right={48}
        shadow-camera-top={42}
        shadow-camera-bottom={-42}
        shadow-bias={-0.0005}
      />
      <directionalLight position={[-26, 28, -20]} intensity={0.45} color="#b9c6d6" />

      <Environment>
        <Lightformer intensity={1.6} position={[0, 22, 0]} scale={[48, 36, 1]} />
        <Lightformer
          intensity={0.8}
          color="#cfe0f0"
          position={[-25, 10, 0]}
          rotation-y={Math.PI / 2}
          scale={[50, 6, 1]}
        />
        <Lightformer
          intensity={0.8}
          color="#f2e2c6"
          position={[25, 10, 0]}
          rotation-y={-Math.PI / 2}
          scale={[50, 6, 1]}
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
        target={[0, 1, 0]}
        minDistance={6}
        maxDistance={145}
        maxPolarAngle={Math.PI / 2.08}
        enableDamping
        dampingFactor={0.08}
      />
    </Canvas>
  );
}
