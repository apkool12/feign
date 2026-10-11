"use client";

// 꾸미기 창의 내 캐릭터 미리보기. 마을과 같은 모델·색칠 규칙을 쓴다.
import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useRef } from "react";
import type * as THREE from "three";
import { Model } from "./Village";

const CALM = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function Figure({ skin, hat, color }: { skin: string; hat: string; color: string }) {
  const turn = useRef<THREE.Group>(null);
  const clip = useRef("idle");
  useFrame((state) => {
    if (turn.current && !CALM) turn.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.7) * 0.6;
  });
  const top = hat !== "none" && (
    <Suspense fallback={null}>
      <Model file={`hat-${hat}`} scale={skin === "blob" ? 1 : 0.8} />
    </Suspense>
  );
  return (
    <group ref={turn} position={[0, -0.6, 0]}>
      <Suspense fallback={null}>
        {skin === "blob" ? (
          <Model file="character-2" clip={clip} overhead={top} paint={(name, m) => name === "Body" && m.color.set(color)} />
        ) : (
          <Model file={`skins/${skin}`} clip={clip} overhead={top} />
        )}
      </Suspense>
    </group>
  );
}

export default function Preview(props: { skin: string; hat: string; color: string }) {
  return (
    <Canvas style={{ placeSelf: "stretch" }} dpr={1} camera={{ fov: 30, position: [0, 0.35, 3.3] }} gl={{ alpha: true }} aria-label="내 캐릭터">
      <ambientLight intensity={1.6} />
      <directionalLight position={[3, 5, 4]} intensity={1.8} />
      <Figure {...props} />
    </Canvas>
  );
}
