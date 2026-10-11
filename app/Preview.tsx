"use client";

// 꾸미기 창의 내 캐릭터 미리보기. 마을과 같은 모델·색칠 규칙을 쓴다.
import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useRef } from "react";
import type * as THREE from "three";
import { Model } from "./Village";

const CALM = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Look = { skin: string; hat: string; color: string };

// pose가 있으면 돌지 않고 그 동작을 한다 (결과 화면)
function Figure({ skin, hat, color, pose, face = pose === "cheer" ? "happy" : "default" }: Look & { pose?: string; face?: string }) {
  const turn = useRef<THREE.Group>(null);
  const clip = useRef(pose ?? "idle");
  useFrame((state) => {
    if (turn.current && !CALM && !pose) turn.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.7) * 0.6;
  });
  const top = hat !== "none" && (
    <Suspense fallback={null}>
      <Model file={`hat-${hat}`} scale={skin === "blob" ? 1 : 0.8} />
    </Suspense>
  );
  return (
    <group ref={turn} position={[0, pose ? 0 : -0.6, 0]}>
      <Suspense fallback={null}>
        {skin === "blob" ? (
          <Model file="character-2" clip={clip} face={face} overhead={top} paint={(name, m) => name === "Body" && m.color.set(color)} />
        ) : (
          <Model file={`skins/${skin}`} clip={clip} face={face} overhead={top} />
        )}
      </Suspense>
    </group>
  );
}

// 결과 화면의 사람들. 캔버스 하나를 카드들 위에 덮고, 카드마다 비워 둔 자리([data-pic])에 그 사람의 캐릭터를 세운다.
// (카드마다 캔버스를 따로 두면 WebGL 컨텍스트가 모자라 마을 화면이 꺼질 수 있다)
function Spots({ people }: { people: (Look & { won: boolean })[] }) {
  const groups = useRef<(THREE.Group | null)[]>([]);
  useFrame((state) => {
    const box = state.gl.domElement.getBoundingClientRect();
    const pics = state.gl.domElement.closest("[data-lineup]")?.querySelectorAll("[data-pic]") ?? [];
    people.forEach((_, i) => {
      const g = groups.current[i];
      const r = pics[i]?.getBoundingClientRect();
      if (!g || !r) return;
      g.position.set(r.left + r.width / 2 - box.left - box.width / 2, box.top + box.height / 2 - r.bottom, 0);
      g.scale.setScalar(r.height / 1.55); // 모자까지 자리에 들어오게
    });
  });
  return people.map((p, i) => (
    <group
      key={i}
      ref={(g) => {
        groups.current[i] = g;
      }}
    >
      <Figure skin={p.skin} hat={p.hat} color={p.color} pose={p.won ? "cheer" : "sad"} />
    </group>
  ));
}
export function Lineup({ people }: { people: (Look & { won: boolean })[] }) {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <Canvas orthographic dpr={[1, 2]} camera={{ zoom: 1, position: [0, 0, 500], near: 1, far: 2000 }} gl={{ alpha: true }}>
        <ambientLight intensity={1.6} />
        <directionalLight position={[3, 5, 4]} intensity={1.8} />
        <Spots people={people} />
      </Canvas>
    </div>
  );
}

// 밀고자의 지목: 화면을 가로지르는 컷인 두 장. 먼저 밀고자가 팔을 들고 느낌표가 찍히고, 이어서 지목당한 사람의 당황한 얼굴이 나온다.
function Shot({ who, pose, face }: { who: Look; pose: string; face?: string }) {
  return (
    <Canvas dpr={[1, 2]} camera={{ fov: 30, position: [0, 0, 3] }} gl={{ alpha: true }}>
      <ambientLight intensity={1.7} />
      <directionalLight position={[3, 5, 4]} intensity={1.8} />
      {/* 카메라는 원점을 본다. 발이 칸의 아랫선 바로 위에 오도록 내려 세운다 */}
      <group position-y={-0.7}>
        <Figure {...who} pose={pose} face={face} />
      </group>
    </Canvas>
  );
}
// still이면 두 장을 멈춘 채 위아래로 나란히 둔다 (모양을 맞출 때 쓴다)
export function CutIn({ by, who, still = false }: { by: Look; who: Look; still?: boolean }) {
  return (
    <div className={`cutin ${still ? "still" : ""}`} aria-hidden>
      <div className="cut a" style={{ "--c": by.color } as React.CSSProperties}>
        <div className="fig">
          <Shot who={by} pose="vote" />
        </div>
        <b className="bang">!</b>
      </div>
      <div className="cut b" style={{ "--c": who.color } as React.CSSProperties}>
        <div className="fig">
          <Shot who={who} pose="startle" face="scared" />
        </div>
      </div>
    </div>
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
