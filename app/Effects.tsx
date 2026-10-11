"use client";

// 역할별 능력 연출. 전부 집 한 채를 기준(집 중심이 원점, 문은 +z)으로 그린다.
// 기본 도형만 쓰는 장식이라 게임 규칙과는 무관하다.
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";

const TAU = Math.PI * 2;
// i번째 조각이 0→1을 되풀이하는 진행도 (조각마다 엇갈린다)
const loop = (t: number, speed: number, i: number, n: number) => (t * speed + i / n) % 1;

type Place = (i: number, t: number, piece: THREE.Object3D) => void;

// 같은 조각 여러 개를 매 프레임 place로 배치한다
function Motes({ count, place, children }: { count: number; place: Place; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => ref.current?.children.forEach((piece, i) => place(i, state.clock.elapsedTime, piece)));
  return (
    <group ref={ref}>
      {Array.from({ length: count }, (_, i) => (
        <group key={i}>{children}</group>
      ))}
    </group>
  );
}

function Glow({ color, strength = 2 }: { color: string; strength?: number }) {
  return <meshStandardMaterial color={color} emissive={color} emissiveIntensity={strength} />;
}

const ball = (size: number, color: string, strength?: number) => (
  <mesh>
    <sphereGeometry args={[size, 8, 6]} />
    <Glow color={color} strength={strength} />
  </mesh>
);

// 머리나 집 위에 뜨는 역할 그림 (그림 파일이 없으면 아무것도 띄우지 않는다)
export function RoleIcon({ role, y, size = 0.6 }: { role: string; y: number; size?: number }) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const ref = useRef<THREE.Sprite>(null);
  useEffect(() => {
    let alive = true;
    new THREE.TextureLoader().load(
      `/roles/${role}.png`,
      (loaded) => {
        loaded.colorSpace = THREE.SRGBColorSpace;
        if (alive) setTexture(loaded);
      },
      undefined,
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [role]);
  useFrame((state) => {
    if (ref.current) ref.current.position.y = y + Math.sin(state.clock.elapsedTime * 4) * 0.06;
  });
  if (!texture) return null;
  return (
    <sprite ref={ref} scale={[size, size, 1]} renderOrder={11}>
      <spriteMaterial map={texture} depthTest={false} transparent />
    </sprite>
  );
}

// 의사: 초록 십자가가 집 둘레로 떠오른다
function Heal() {
  return (
    <Motes
      count={7}
      place={(i, t, o) => {
        const p = loop(t, 0.45, i, 7);
        o.position.set(Math.sin(i * 2.4) * 1.5, 0.3 + p * 2.8, Math.cos(i * 2.4) * 1.5);
        o.scale.setScalar(Math.sin(p * Math.PI));
        o.rotation.y = t * 1.5 + i;
      }}
    >
      <mesh>
        <boxGeometry args={[0.3, 0.1, 0.1]} />
        <Glow color="#4ade80" />
      </mesh>
      <mesh>
        <boxGeometry args={[0.1, 0.3, 0.1]} />
        <Glow color="#4ade80" />
      </mesh>
    </Motes>
  );
}

// 경찰관: 문 앞을 X자로 막은 차단목
function Barricade() {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (ref.current) ref.current.position.y = Math.abs(Math.sin(state.clock.elapsedTime * 3)) * 0.04;
  });
  return (
    <group ref={ref} position={[0, 0, 1.55]}>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 0.6, 0.5, 0]} castShadow>
          <boxGeometry args={[0.12, 1, 0.12]} />
          <meshStandardMaterial color="#5b3a21" />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[0, 0.6, 0.08]} rotation-z={side * 0.6} castShadow>
          <boxGeometry args={[1.5, 0.16, 0.06]} />
          <meshStandardMaterial color={side > 0 ? "#facc15" : "#1f1f24"} />
        </mesh>
      ))}
    </group>
  );
}

// 감시자: 위에서 내리비추는 빛기둥과 집 둘레를 도는 빛점
function Watch() {
  const beam = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (beam.current) beam.current.rotation.z = Math.sin(state.clock.elapsedTime * 1.2) * 0.12;
  });
  return (
    <>
      <mesh ref={beam} position={[0, 3.2, 0.6]}>
        <coneGeometry args={[2.4, 6.4, 24, 1, true]} />
        <meshBasicMaterial color="#bfdbfe" transparent opacity={0.16} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <Motes
        count={8}
        place={(i, t, o) => {
          const a = t * 1.1 + (i / 8) * TAU;
          o.position.set(Math.cos(a) * 2.3, 0.25, Math.sin(a) * 2.3);
        }}
      >
        {ball(0.07, "#93c5fd", 3)}
      </Motes>
    </>
  );
}

// 수사관: 집 둘레를 돌며 들여다보는 돋보기
function Inspect() {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    const g = ref.current;
    if (!g) return;
    const a = state.clock.elapsedTime * 1.3;
    g.position.set(Math.sin(a) * 2.1, 1.3 + Math.sin(a * 2) * 0.25, Math.cos(a) * 2.1);
    g.rotation.y = a;
  });
  return (
    <group ref={ref}>
      <mesh>
        <torusGeometry args={[0.32, 0.06, 8, 20]} />
        <meshStandardMaterial color="#2b2118" />
      </mesh>
      <mesh>
        <circleGeometry args={[0.3, 20]} />
        <meshBasicMaterial color="#bae6fd" transparent opacity={0.45} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0.3, -0.42, 0]} rotation-z={0.6}>
        <cylinderGeometry args={[0.05, 0.05, 0.45, 8]} />
        <meshStandardMaterial color="#7a4a2a" />
      </mesh>
    </group>
  );
}

// 트래퍼: 문 앞에 놓인 이빨 달린 덫. 이빨이 딸깍거린다.
function Trap() {
  const teeth = useRef<THREE.Group>(null);
  useFrame((state) => {
    const snap = 0.7 + Math.abs(Math.sin(state.clock.elapsedTime * 2.5)) * 0.5;
    teeth.current?.children.forEach((tooth) => tooth.scale.setY(snap));
  });
  return (
    <group position={[0, 0.06, 2.05]}>
      <mesh rotation-x={Math.PI / 2}>
        <torusGeometry args={[0.38, 0.05, 6, 20]} />
        <meshStandardMaterial color="#6b7280" metalness={0.6} roughness={0.4} />
      </mesh>
      <group ref={teeth}>
        {Array.from({ length: 10 }, (_, i) => (
          <mesh key={i} position={[Math.cos((i / 10) * TAU) * 0.38, 0.1, Math.sin((i / 10) * TAU) * 0.38]}>
            <coneGeometry args={[0.05, 0.2, 5]} />
            <meshStandardMaterial color="#d1d5db" metalness={0.6} roughness={0.4} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

// 밀고자: 지붕 위에서 튀는 느낌표
function Exclaim() {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    ref.current.position.y = 3.3 + Math.abs(Math.sin(t * 4)) * 0.4;
    ref.current.rotation.y = t * 2;
  });
  return (
    <group ref={ref}>
      <mesh position={[0, 0.25, 0]}>
        <boxGeometry args={[0.16, 0.5, 0.16]} />
        <Glow color="#facc15" />
      </mesh>
      <mesh position={[0, -0.15, 0]}>
        <sphereGeometry args={[0.1, 10, 8]} />
        <Glow color="#facc15" />
      </mesh>
    </group>
  );
}

// 선동꾼: 문을 향해 퍼져 가는 소리 고리
function Shout() {
  return (
    <Motes
      count={3}
      place={(i, t, o) => {
        const p = loop(t, 0.8, i, 3);
        o.position.set(0, 0.95, 3.2 - p * 1.8);
        o.scale.setScalar((0.25 + p * 0.9) * (p < 0.9 ? 1 : (1 - p) * 10));
      }}
    >
      <mesh>
        <torusGeometry args={[0.6, 0.045, 6, 24]} />
        <Glow color="#fb923c" />
      </mesh>
    </Motes>
  );
}

// 추적자: 문 앞으로 하나씩 찍히는 발자국
function Footprints() {
  return (
    <Motes
      count={6}
      place={(i, t, o) => {
        const shown = (t * 1.2) % 8 > i; // 차례로 나타났다가 한꺼번에 지워진다
        o.position.set(i % 2 ? 0.16 : -0.16, 0.03, 1.7 + i * 0.36);
        o.scale.set(shown ? 1 : 0.001, 0.2, shown ? 1.5 : 0.001);
      }}
    >
      <mesh>
        <sphereGeometry args={[0.1, 8, 6]} />
        <meshStandardMaterial color="#3f2a1c" />
      </mesh>
    </Motes>
  );
}

// 청소부: 문 앞을 좌우로 쓰는 먼지
function Sweep() {
  return (
    <Motes
      count={6}
      place={(i, t, o) => {
        o.position.set(Math.sin(t * 3 + i * 0.5) * 1.1, 0.12 + Math.abs(Math.sin(t * 6 + i)) * 0.22, 1.7 + (i % 3) * 0.2);
        o.scale.setScalar(0.7 + Math.sin(t * 5 + i) * 0.3);
      }}
    >
      <mesh>
        <sphereGeometry args={[0.13, 8, 6]} />
        <meshBasicMaterial color="#e7e5e4" transparent opacity={0.7} depthWrite={false} />
      </mesh>
    </Motes>
  );
}

// 남탓쟁이: 지붕에 튄 페인트와 처마에서 떨어지는 방울
function Paint() {
  const spots: [number, number, number][] = [
    [0.55, 2.15, 0.75],
    [-0.6, 2.05, 0.85],
    [0.1, 2.35, 0.5],
    [-0.2, 1.85, 1.15],
  ];
  return (
    <>
      {spots.map(([x, y, z], i) => (
        <mesh key={i} position={[x, y, z]} rotation-x={-0.75} scale={[1, 0.25, 1]}>
          <sphereGeometry args={[0.22 + (i % 2) * 0.08, 10, 8]} />
          <meshStandardMaterial color="#7f1d1d" roughness={0.3} />
        </mesh>
      ))}
      <Motes
        count={4}
        place={(i, t, o) => {
          const p = loop(t, 0.7, i, 4);
          o.position.set(-0.9 + i * 0.6, 1.45 - p * 1.4, 1.42);
          o.scale.setScalar(1 - p * 0.5);
        }}
      >
        <mesh scale={[1, 1.6, 1]}>
          <sphereGeometry args={[0.06, 8, 6]} />
          <meshStandardMaterial color="#7f1d1d" roughness={0.3} />
        </mesh>
      </Motes>
    </>
  );
}

// 살해: 문 앞을 가르는 붉은 칼자국 두 줄
function Slash() {
  return (
    <group position={[0, 1.1, 1.5]}>
      <Motes
        count={2}
        place={(i, t, o) => {
          const p = (t * 1.1 + i * 0.18) % 1;
          o.rotation.z = i ? -0.8 : 0.8;
          o.scale.set(p < 0.25 ? p * 4 : Math.max(0.001, 1 - (p - 0.25) * 2.2), 1, 1);
        }}
      >
        <mesh>
          <boxGeometry args={[2.6, 0.07, 0.05]} />
          <Glow color="#ef4444" strength={4} />
        </mesh>
      </Motes>
    </group>
  );
}

// 도둑: 집을 감아 오르는 금빛 반짝임
function Sparkle() {
  return (
    <Motes
      count={9}
      place={(i, t, o) => {
        const p = loop(t, 0.5, i, 9);
        const a = t * 2.2 + i * 0.7;
        o.position.set(Math.cos(a) * 1.5, 0.2 + p * 2.8, Math.sin(a) * 1.5);
        o.scale.setScalar(Math.sin(p * Math.PI));
        o.rotation.set(t * 3, t * 2, 0);
      }}
    >
      <mesh>
        <octahedronGeometry args={[0.1]} />
        <Glow color="#fbbf24" strength={3} />
      </mesh>
    </Motes>
  );
}

// 마법사: 하늘에서 내리치는 보라색 번개와 맴도는 기운
function Curse() {
  const bolt = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (bolt.current) bolt.current.visible = state.clock.elapsedTime % 1.3 < 0.18;
  });
  const bends: [number, number, number][] = [
    [0.25, 5.4, 0.35],
    [-0.3, 4.5, -0.4],
    [0.2, 3.6, 0.4],
    [-0.1, 2.8, -0.3],
  ];
  return (
    <>
      <group ref={bolt}>
        {bends.map(([x, y, tilt], i) => (
          <mesh key={i} position={[x, y, 0.3]} rotation-z={tilt}>
            <boxGeometry args={[0.1, 1.1, 0.1]} />
            <Glow color="#c084fc" strength={6} />
          </mesh>
        ))}
        <pointLight position={[0, 3, 0.5]} color="#c084fc" intensity={30} distance={8} />
      </group>
      <Motes
        count={7}
        place={(i, t, o) => {
          const a = -t * 1.8 + (i / 7) * TAU;
          o.position.set(Math.cos(a) * 1.9, 0.8 + Math.sin(t * 2 + i) * 0.5, Math.sin(a) * 1.9);
        }}
      >
        {ball(0.08, "#a855f7", 3)}
      </Motes>
    </>
  );
}

// 무속인: 양초 곁에서 피어오르는 혼불
function Wisps() {
  return (
    <Motes
      count={5}
      place={(i, t, o) => {
        const p = loop(t, 0.3, i, 5);
        o.position.set(1.5 + Math.sin(p * 6 + i) * 0.35, 0.5 + p * 2.4, 1.5 + Math.cos(p * 5 + i) * 0.35);
        o.scale.setScalar(Math.sin(p * Math.PI) * 1.2);
      }}
    >
      <mesh>
        <sphereGeometry args={[0.1, 8, 6]} />
        <meshBasicMaterial color="#bae6fd" transparent opacity={0.75} depthWrite={false} />
      </mesh>
    </Motes>
  );
}

// 폭파범: 폭탄 도화선의 불꽃. 터뜨리기로 했으면 더 급하게 튄다.
function Fuse({ fast = false }: { fast?: boolean }) {
  return (
    <group position={[-1.5, 0.42, 1.5]}>
      <Motes
        count={6}
        place={(i, t, o) => {
          const p = loop(t, fast ? 3 : 1.2, i, 6);
          o.position.set(Math.sin(i * 2.1) * p * 0.3, p * (fast ? 0.6 : 0.35), Math.cos(i * 2.1) * p * 0.3);
          o.scale.setScalar(1 - p);
        }}
      >
        {ball(0.04, fast ? "#ef4444" : "#fde047", 5)}
      </Motes>
    </group>
  );
}

// 폭탄이 터지는 순간: 불덩이가 사방으로 튀고 번쩍인다 (한 번 재생하고 사라진다)
export function Burst() {
  const ref = useRef<THREE.Group>(null);
  const light = useRef<THREE.PointLight>(null);
  const start = useRef(-1);
  useFrame((state) => {
    if (start.current < 0) start.current = state.clock.elapsedTime;
    const p = Math.min(1, (state.clock.elapsedTime - start.current) / 0.9);
    if (ref.current) ref.current.visible = p < 1;
    if (light.current) light.current.intensity = 60 * (1 - p);
    ref.current?.children.forEach((piece, i) => {
      if (!(piece instanceof THREE.Mesh)) return;
      const a = (i / 12) * TAU;
      const up = i % 3;
      piece.position.set(Math.cos(a) * p * 3, 0.8 + up * p * 1.6 - p * p * 1.2, Math.sin(a) * p * 3);
      piece.scale.setScalar(Math.max(0.001, (0.45 + up * 0.15) * (1 - p)));
    });
  });
  return (
    <group ref={ref}>
      {Array.from({ length: 12 }, (_, i) => (
        <mesh key={i}>
          <sphereGeometry args={[1, 8, 6]} />
          <Glow color={i % 2 ? "#fb923c" : "#fde047"} strength={4} />
        </mesh>
      ))}
      <pointLight ref={light} position={[0, 1.5, 0]} color="#fb923c" distance={14} />
    </group>
  );
}

// 생존자: 내 캐릭터를 감싸는 보호막 (캐릭터 기준 좌표)
export function Shield() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    ref.current.scale.setScalar(1 + Math.sin(t * 3) * 0.04);
    ref.current.rotation.y = t;
  });
  return (
    <mesh ref={ref} position={[0, 0.55, 0]}>
      <icosahedronGeometry args={[0.85, 1]} />
      <meshStandardMaterial color="#7dd3fc" emissive="#38bdf8" emissiveIntensity={0.8} transparent opacity={0.28} flatShading depthWrite={false} />
    </mesh>
  );
}

const EFFECTS: Record<string, () => ReactNode> = {
  doctor: () => <Heal />,
  blocker: () => <Barricade />,
  lookout: () => <Watch />,
  investigator: () => <Inspect />,
  trapper: () => <Trap />,
  snitch: () => <Exclaim />,
  provoker: () => <Shout />,
  tracker: () => <Footprints />,
  cleaner: () => <Sweep />,
  blamer: () => <Paint />,
  kill: () => <Slash />,
  serialKiller: () => <Slash />,
  thief: () => <Sparkle />,
  sorcerer: () => <Curse />,
  haunter: () => <Wisps />,
  bomber: () => <Fuse />,
  detonate: () => <Fuse fast />,
};

// kind: 역할 id, 또는 "kill"(임포스터의 살해), "detonate"(폭파 직전)
export function AbilityEffect({ kind }: { kind: string }) {
  return EFFECTS[kind]?.() ?? null;
}
