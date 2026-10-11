"use client";

// 역할별 능력 연출. 전부 집 한 채를 기준(집 중심이 원점, 문은 +z)으로 그린다.
// 소품은 여기서 도형으로 빚는다(먹색 외곽선 껍데기 포함). 게임 규칙과는 무관한 장식이고,
// 이 연출을 누구에게 보여 줄지는 부르는 쪽(Village의 seat.effect, 회상 장면)이 정한다.
import { useFrame, useThree, type ThreeElements } from "@react-three/fiber";
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import * as THREE from "three";
import { play, SFX, type Sfx } from "./sound";

const TAU = Math.PI * 2;
const INK = "#2b2118";
const CALM = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// i번째 조각이 0→1을 되풀이하는 진행도 (조각마다 엇갈린다)
const loop = (t: number, speed: number, i: number, n: number) => (t * speed + i / n) % 1;
const c01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
// t가 a→b를 지나는 동안 0→1
const seg = (t: number, a: number, b: number) => c01((t - a) / (b - a));
// 살짝 넘쳤다 돌아오는 등장
const pop = (p: number) => (p <= 0 ? 0.001 : 1 + (p - 1) ** 2 * (2.7 * (p - 1) + 1.7));
// 높이 h에서 떨어져 통통 튀다 멎는다
const drop = (p: number, h: number) => h * (1 - p) ** 2 * Math.abs(Math.cos(p * Math.PI * 2.5));
const rnd = (seed: number, i: number) => {
  const x = Math.sin(seed * 91.7 + i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};
// 소리 이름이 아직 없으면 비슷한 것으로 대신한다
const sfx = (name: string, or: Sfx, gain = 1) => play((SFX as string[]).includes(name) ? (name as Sfx) : or, gain);

// 등장한 뒤 흐른 시간(초). 움직임 줄이기면 다 끝난 자세로 멈춰 있는다.
function useAge() {
  const born = useRef(-1);
  return (now: number) => {
    if (CALM) return 60;
    if (born.current < 0) born.current = now;
    return now - born.current;
  };
}

// 이름 붙인 부품들을 매 프레임 움직이려고 모아 둔다
function useParts() {
  const parts = useRef<Record<string, THREE.Object3D>>({});
  const refs = useRef<Record<string, (o: THREE.Object3D | null) => void>>({});
  const at = (name: string) =>
    (refs.current[name] ??= (o) => {
      if (o) parts.current[name] = o;
    });
  return [parts.current, at] as const;
}

// 화면 흔들기. 카메라 자리는 건드리지 않고 화면만 몇 픽셀 민다(카메라를 쥔 쪽과 다투지 않는다).
export function useShake() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const clock = useThree((s) => s.clock);
  const k = useRef({ until: 0, power: 0, on: false });
  useFrame(() => {
    if (!k.current.on) return;
    const left = k.current.until - clock.elapsedTime;
    if (left <= 0) {
      k.current.on = false;
      camera.clearViewOffset();
      return;
    }
    const a = k.current.power * Math.min(1, left * 4);
    camera.setViewOffset(size.width, size.height, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a, size.width, size.height);
  });
  useEffect(() => () => camera.clearViewOffset(), [camera]);
  return (power: number, secs: number) => {
    if (!CALM) k.current = { until: clock.elapsedTime + secs, power, on: true };
  };
}

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

// 먹색 외곽선: 뒷면만 그리는 껍데기를 법선 쪽으로 살짝 부풀린다 (집·캐릭터 모델과 같은 방식)
const OUT = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
OUT.onBeforeCompile = (s) => {
  s.vertexShader = s.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed += normalize(normal) * 0.026;");
};

const box = (w: number, h: number, d: number) => <boxGeometry args={[w, h, d]} />;
const cyl = (top: number, bottom: number, h: number, n = 10, open = false) => <cylinderGeometry args={[top, bottom, h, n, 1, open]} />;
const orb = (r: number, n = 10) => <sphereGeometry args={[r, n, Math.max(6, n - 2)]} />;
const lump = (r: number) => <icosahedronGeometry args={[r, 1]} />;
const cone = (r: number, h: number, n = 8) => <coneGeometry args={[r, h, n]} />;
const tor = (R: number, r: number, arc = TAU) => <torusGeometry args={[R, r, 6, 20, arc]} />;

// 소품 한 조각: 끊어 칠한 면 + 외곽선
type PieceProps = { g: ReactElement; c: string; glow?: number } & ThreeElements["group"];
function P({ g, c, glow = 0, ...rest }: PieceProps) {
  return (
    <group {...rest}>
      <mesh castShadow>
        {g}
        <meshToonMaterial color={c} emissive={c} emissiveIntensity={glow} />
      </mesh>
      <mesh material={OUT}>{g}</mesh>
    </group>
  );
}

// 빛나는 조각: 조명과 무관하게 제 색으로 보인다 (낮에도 읽히게)
type LightProps = { g: ReactElement; c: string; o?: number; add?: boolean } & ThreeElements["mesh"];
function L({ g, c, o = 1, add = false, ...rest }: LightProps) {
  return (
    <mesh {...rest}>
      {g}
      <meshBasicMaterial color={c} transparent={o < 1 || add} opacity={o} depthWrite={o >= 1 && !add} blending={add ? THREE.AdditiveBlending : THREE.NormalBlending} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  );
}
const fade = (o: THREE.Object3D | undefined, opacity: number) => {
  if (o) ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = opacity;
};

// 네 갈래 별 (반짝임)
function Star({ c = "#fff7c2", s = 1 }: { c?: string; s?: number }) {
  return (
    <group scale={s}>
      <L g={<octahedronGeometry args={[0.16]} />} c={c} scale={[1, 0.22, 0.22]} />
      <L g={<octahedronGeometry args={[0.16]} />} c={c} scale={[0.22, 1, 0.22]} />
    </group>
  );
}

// 뭉게뭉게 덩이 (연기·먼지·폭발 구름)
function Puff({ c, r = 0.3 }: { c: string; r?: number }) {
  return (
    <>
      <mesh>
        {lump(r)}
        <meshBasicMaterial color={c} toneMapped={false} />
      </mesh>
      <mesh scale={1.1}>
        {lump(r)}
        <meshBasicMaterial color={INK} side={THREE.BackSide} />
      </mesh>
    </>
  );
}

// 불꽃 한 가닥: 붉은 겉, 주황, 노란 심지
function Flame({ s = 1 }: { s?: number }) {
  const ref = useRef<THREE.Group>(null);
  const seed = useRef(Math.random() * 9);
  useFrame((state) => {
    if (!ref.current || CALM) return;
    const t = state.clock.elapsedTime * 9 + seed.current;
    ref.current.scale.set(s * (1 + Math.sin(t * 1.3) * 0.12), s * (1 + Math.sin(t) * 0.22), s);
    ref.current.rotation.z = Math.sin(t * 0.6) * 0.18;
  });
  return (
    <group ref={ref} scale={s}>
      <L g={cone(0.17, 0.52)} c="#e2461c" position={[0, 0.26, 0]} />
      <L g={cone(0.115, 0.4)} c="#ff9a2e" position={[0, 0.21, 0.04]} />
      <L g={cone(0.06, 0.26)} c="#ffe36b" position={[0, 0.15, 0.07]} />
    </group>
  );
}

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

type FxProps = { h: number }; // h: 집 지붕 높이

// 의사: 구급 가방이 떨어져 열리고 붕대와 주사기가 떠오른다. 초록 방패 돔이 집을 감싼다.
function Heal({ h }: FxProps) {
  const [p, at] = useParts();
  const age = useAge();
  useFrame((s) => {
    const T = s.clock.elapsedTime;
    const t = age(T);
    if (!p.dome) return;
    p.kit.position.y = drop(seg(t, 0, 0.55), 1.4);
    p.lid.rotation.x = -2.1 * seg(t, 0.55, 0.85);
    const up = seg(t, 0.8, 1.4);
    p.roll.scale.setScalar(pop(up) * 1);
    p.roll.position.set(-0.2, 0.3 + up * 0.6 + Math.sin(T * 2) * 0.05, 0);
    p.roll.rotation.z = T * 1.4;
    p.shot.scale.setScalar(pop(seg(t, 1, 1.6)));
    p.shot.position.set(0.22, 0.3 + seg(t, 1, 1.6) * 0.75 + Math.cos(T * 2) * 0.05, 0);
    p.shot.rotation.z = -0.5 + Math.sin(T * 1.5) * 0.15;
    const d = seg(t, 1.3, 2.1);
    p.dome.scale.setScalar(pop(d) * (1 + Math.sin(T * 2.5) * 0.015));
    p.sign.scale.setScalar(pop(seg(t, 1.8, 2.3)));
    p.sign.position.y = h + 1.1 + Math.sin(T * 2) * 0.1;
    p.sign.rotation.y = T * 0.9;
  });
  return (
    <>
      <group ref={at("kit")} position={[1.15, 0, 2.05]} rotation-y={-0.35}>
        <P g={box(0.56, 0.3, 0.36)} c="#f4f1e8" position={[0, 0.15, 0]} />
        <P g={box(0.58, 0.07, 0.38)} c="#e5484d" position={[0, 0.1, 0]} />
        <L g={box(0.2, 0.07, 0.02)} c="#3fbf6a" position={[0, 0.2, 0.185]} />
        <L g={box(0.07, 0.2, 0.02)} c="#3fbf6a" position={[0, 0.2, 0.186]} />
        <group ref={at("lid")} position={[0, 0.3, -0.18]}>
          <P g={box(0.56, 0.08, 0.36)} c="#f4f1e8" position={[0, 0.04, 0.18]} />
          <P g={tor(0.09, 0.022, Math.PI)} c={INK} position={[0, 0.08, 0.18]} />
        </group>
        <group ref={at("roll")}>
          <P g={cyl(0.1, 0.1, 0.12, 12)} c="#fffaf0" rotation-x={Math.PI / 2} />
          <P g={box(0.04, 0.22, 0.11)} c="#fffaf0" position={[0.1, -0.1, 0]} />
        </group>
        <group ref={at("shot")}>
          <P g={cyl(0.045, 0.045, 0.26, 8)} c="#bfe6ff" />
          <P g={cyl(0.07, 0.07, 0.03, 8)} c="#8b97a8" position={[0, 0.14, 0]} />
          <P g={cone(0.014, 0.16, 6)} c="#d9dee6" position={[0, -0.2, 0]} rotation-x={Math.PI} />
        </group>
      </group>
      <group ref={at("dome")}>
        <L g={<sphereGeometry args={[h * 0.62 + 1.1, 20, 8, 0, TAU, 0, Math.PI / 2]} />} c="#58e08a" o={0.16} />
        <L g={tor(h * 0.62 + 1.1, 0.045)} c="#58e08a" rotation-x={Math.PI / 2} position={[0, 0.05, 0]} />
        <L g={tor(h * 0.62 + 1.1, 0.03, Math.PI)} c="#b9f5cf" o={0.7} />
        <L g={tor(h * 0.62 + 1.1, 0.03, Math.PI)} c="#b9f5cf" o={0.7} rotation-y={Math.PI / 2} />
      </group>
      <group ref={at("sign")}>
        <P g={box(0.62, 0.2, 0.14)} c="#3fbf6a" glow={0.6} />
        <P g={box(0.2, 0.62, 0.14)} c="#3fbf6a" glow={0.6} />
      </group>
      <Motes
        count={5}
        place={(i, t, o) => {
          const q = loop(t, 0.4, i, 5);
          o.position.set(Math.sin(i * 2.4) * 1.6, 0.4 + q * (h + 0.4), Math.cos(i * 2.4) * 1.6);
          o.scale.setScalar(Math.sin(q * Math.PI) * 0.8);
        }}
      >
        <L g={orb(0.09)} c="#ff8fab" position={[-0.07, 0.04, 0]} />
        <L g={orb(0.09)} c="#ff8fab" position={[0.07, 0.04, 0]} />
        <L g={cone(0.15, 0.2, 4)} c="#ff8fab" position={[0, -0.09, 0]} rotation-x={Math.PI} scale={[1, 1, 0.55]} />
      </Motes>
    </>
  );
}

// 경찰관: 줄무늬 차단목이 쿵 내려앉고, 경광등이 돌고, 출입 금지 띠가 문을 가로지른다.
function Barricade() {
  const [p, at] = useParts();
  const age = useAge();
  const kick = useShake();
  const hit = useRef(false);
  useFrame((s) => {
    const T = s.clock.elapsedTime;
    const t = age(T);
    if (!p.bar) return;
    p.bar.position.y = drop(seg(t, 0, 0.6), 2.6);
    if (t > 0.13 && !hit.current) {
      hit.current = true;
      kick(5, 0.2);
    }
    p.tape.scale.x = Math.max(0.001, seg(t, 0.6, 1.0));
    p.lamp.rotation.y = T * 6;
    const blink = Math.sin(T * 8) > 0;
    ((p.bulb as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(blink ? "#ff5a4d" : "#8f1d16");
    (p.beam as THREE.PointLight).intensity = t > 0.5 && blink ? 7 : 0;
    p.dust.children.forEach((d, i) => {
      const q = seg(t, 0.13, 0.7);
      d.position.set((i - 2.5) * 0.45, 0.1 + q * 0.3, 0.2 + q * 0.5);
      d.scale.setScalar(Math.sin(q * Math.PI) * 0.9 + 0.001);
    });
  });
  return (
    <group position={[0, 0, 1.85]}>
      <group ref={at("bar")}>
        {[-1, 1].map((x) => (
          <group key={x} position={[x * 0.82, 0, 0]}>
            <P g={box(0.13, 1.0, 0.13)} c="#f4f1e8" position={[0, 0.5, 0]} />
            <P g={box(0.34, 0.08, 0.5)} c="#5b3a21" position={[0, 0.04, 0]} />
          </group>
        ))}
        <P g={box(1.9, 0.24, 0.08)} c="#ffd23f" position={[0, 0.72, 0.09]} />
        {[-3, -1, 1, 3].map((i) => (
          <L key={i} g={box(0.17, 0.235, 0.085)} c={INK} position={[i * 0.21, 0.72, 0.092]} />
        ))}
        <P g={box(1.9, 0.12, 0.06)} c="#f4f1e8" position={[0, 0.36, 0.08]} />
        <group position={[0.82, 1.0, 0]}>
          <P g={cyl(0.1, 0.12, 0.07, 10)} c="#3a3f4a" position={[0, 0.035, 0]} />
          <L ref={at("bulb")} g={<sphereGeometry args={[0.1, 10, 6, 0, TAU, 0, Math.PI / 2]} />} c="#ff5a4d" position={[0, 0.07, 0]} />
          <group ref={at("lamp")} position={[0, 0.12, 0]}>
            <L g={cone(0.22, 0.9, 10)} c="#ff5a4d" o={0.35} rotation-z={Math.PI / 2} position={[0.45, 0, 0]} />
          </group>
          <pointLight ref={at("beam")} color="#ff5a4d" distance={6} position={[0, 0.3, 0]} />
        </group>
      </group>
      {/* 출입 금지 띠: 왼쪽 문설주에서 오른쪽으로 쭉 당겨진다 */}
      <group ref={at("tape")} position={[-0.95, 1.05, -0.38]}>
        <L g={box(1.9, 0.13, 0.015)} c="#ffd23f" position={[0.95, 0, 0]} />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <L key={i} g={box(0.08, 0.13, 0.017)} c={INK} position={[0.18 + i * 0.31, 0, 0]} rotation-z={0.5} />
        ))}
      </group>
      <group ref={at("dust")}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <group key={i}>
            <Puff c="#e7dcc4" r={0.16} />
          </group>
        ))}
      </group>
    </group>
  );
}

// 감시자: 덤불이 불쑥 솟고 그 위로 쌍안경이 올라와 집을 훑는다. 렌즈가 반짝인다.
function Watch() {
  const [p, at] = useParts();
  const age = useAge();
  useFrame((s) => {
    const T = s.clock.elapsedTime;
    const t = age(T);
    if (!p.bush) return;
    p.bush.scale.setScalar(pop(seg(t, 0, 0.5)));
    p.bush.rotation.z = Math.sin(T * 7) * 0.03 * (t < 1.2 ? 1 : 0.3);
    const up = seg(t, 0.6, 1.1);
    p.eyes.position.y = 0.25 + pop(up) * 0.62;
    const pan = Math.sin(T * 0.9) * 0.4;
    p.eyes.rotation.y = 0.64 + pan;
    p.glint.scale.setScalar(t > 1.1 ? Math.max(0.001, 1 - Math.abs(pan) * 4) * 1.4 : 0.001);
    p.glint.rotation.z = T * 2;
    fade(p.ray, t > 1.1 ? 0.1 + Math.sin(T * 3) * 0.03 : 0);
  });
  return (
    <group position={[2.1, 0, 2.8]}>
      <group ref={at("bush")}>
        <P g={lump(0.5)} c="#3f9b4a" position={[0, 0.36, 0]} />
        <P g={lump(0.38)} c="#2f7d3b" position={[-0.42, 0.26, 0.1]} />
        <P g={lump(0.36)} c="#4fae58" position={[0.4, 0.24, -0.05]} />
        <P g={lump(0.22)} c="#4fae58" position={[0.1, 0.7, 0.1]} />
      </group>
      <group ref={at("eyes")}>
        {[-0.11, 0.11].map((x) => (
          <group key={x} position={[x, 0, 0]}>
            <P g={cyl(0.095, 0.075, 0.34, 10)} c="#3a3f4a" rotation-x={Math.PI / 2} />
            <P g={cyl(0.105, 0.105, 0.05, 10)} c="#c9a24a" rotation-x={Math.PI / 2} position={[0, 0, -0.17]} />
            <L g={<circleGeometry args={[0.08, 12]} />} c="#bfe6ff" position={[0, 0, -0.2]} />
          </group>
        ))}
        <P g={box(0.12, 0.05, 0.1)} c="#3a3f4a" />
        <group ref={at("glint")} position={[0.11, 0.04, -0.24]}>
          <Star c="#ffffff" s={1.1} />
        </group>
        <L ref={at("ray")} g={cone(1.5, 3.6, 16)} c="#cfe8ff" o={0.1} add rotation-x={Math.PI / 2} position={[0, 0, -2]} />
      </group>
    </group>
  );
}

// 수사관: 돋보기가 문과 창을 훑으면 지문과 발자국이 떠오른다. 곁에는 수첩과 연필.
function Inspect() {
  const [p, at] = useParts();
  const age = useAge();
  const spots: [number, number][] = [
    [0, 0.8],
    [0.72, 1.3],
    [-0.72, 1.25],
  ];
  useFrame((s) => {
    const T = s.clock.elapsedTime;
    const t = age(T);
    if (!p.glass) return;
    p.glass.scale.setScalar(pop(seg(t, 0, 0.4)));
    const x = Math.sin(T * 0.9) * 0.85;
    const y = 1.05 + Math.sin(T * 1.8 + 1) * 0.35;
    p.glass.position.set(x, y, 0.22);
    p.glass.rotation.z = Math.sin(T * 0.9) * 0.3;
    p.marks.children.forEach((m, i) => {
      const near = Math.max(0, 1 - Math.hypot(spots[i][0] - x, spots[i][1] - y) * 1.6);
      m.scale.setScalar(pop(seg(t, 0.7 + i * 0.7, 1.1 + i * 0.7)) * (1 + near * 0.35));
    });
    p.book.scale.setScalar(pop(seg(t, 0.3, 0.8)));
    p.pen.position.set(0.1 + Math.sin(T * 9) * 0.06, 0.3 + Math.abs(Math.sin(T * 9)) * 0.02, 0.02 + Math.cos(T * 7) * 0.04);
  });
  return (
    <group position={[0, 0, 1.5]}>
      <group ref={at("glass")}>
        <P g={tor(0.3, 0.05)} c="#7a4a2a" />
        <L g={<circleGeometry args={[0.28, 20]} />} c="#bfe6ff" o={0.4} />
        <L g={box(0.05, 0.2, 0.01)} c="#ffffff" o={0.8} position={[-0.12, 0.08, 0.01]} rotation-z={0.6} />
        <P g={cyl(0.05, 0.06, 0.5, 8)} c="#7a4a2a" position={[0.3, -0.42, 0]} rotation-z={0.62} />
      </group>
      <group ref={at("marks")}>
        {spots.map(([x, y], i) => (
          <group key={i} position={[x, y, 0.02]}>
            {[0.05, 0.1, 0.15].map((r) => (
              <L key={r} g={tor(r, 0.012, TAU * 0.82)} c="#d7ff5e" scale={[0.8, 1, 1]} rotation-z={r * 20} />
            ))}
          </group>
        ))}
      </group>
      <Motes
        count={5}
        place={(i, t, o) => {
          const shown = (t * 1.1) % 7 > i;
          o.position.set(i % 2 ? 0.17 : -0.17, 0.03, 0.5 + i * 0.36);
          o.scale.setScalar(shown ? 1 : 0.001);
        }}
      >
        <L g={orb(0.1, 8)} c="#d7ff5e" o={0.85} scale={[0.8, 0.12, 1.4]} />
        <L g={orb(0.06, 8)} c="#d7ff5e" o={0.85} scale={[0.9, 0.12, 0.9]} position={[0, 0, -0.17]} />
      </Motes>
      <group ref={at("book")} position={[-1.35, 0, 0.6]} rotation-y={0.5}>
        <P g={box(0.3, 0.03, 0.4)} c="#b9814a" position={[-0.15, 0.2, 0]} rotation-z={0.25} />
        <P g={box(0.3, 0.03, 0.4)} c="#b9814a" position={[0.15, 0.2, 0]} rotation-z={-0.25} />
        <L g={box(0.26, 0.012, 0.36)} c="#fffaf0" position={[-0.14, 0.225, 0]} rotation-z={0.25} />
        <L g={box(0.26, 0.012, 0.36)} c="#fffaf0" position={[0.14, 0.225, 0]} rotation-z={-0.25} />
        {[0, 1, 2].map((i) => (
          <L key={i} g={box(0.16, 0.014, 0.012)} c={INK} position={[0.14, 0.232, -0.1 + i * 0.09]} rotation-z={-0.25} />
        ))}
        <group ref={at("pen")} rotation-z={-0.5}>
          <P g={cyl(0.025, 0.025, 0.3, 6)} c="#ffd23f" position={[0, 0.17, 0]} />
          <P g={cone(0.025, 0.07, 6)} c="#f1d3a8" position={[0, -0.01, 0]} rotation-x={Math.PI} />
        </group>
      </group>
    </group>
  );
}

// 트래퍼: 문 앞의 톱니 덫. stage를 주면 그 단계로 가고(set 놓임 → armed 벌린 채 대기 → snap 철컥),
// 안 주면 놓였다가 벌린 채 기다린다.
export function Trap({ stage }: { stage?: "set" | "armed" | "snap" }) {
  const [p, at] = useParts();
  const age = useAge();
  const kick = useShake();
  const snapped = useRef(-1);
  useEffect(() => {
    snapped.current = stage === "snap" ? -2 : -1; // -2: 다음 프레임에 닫힌다
  }, [stage]);
  useFrame((s) => {
    const T = s.clock.elapsedTime;
    const t = stage && stage !== "set" ? 9 : age(T); // 놓는 장면이 아니면 이미 놓여 있다
    if (!p.a) return;
    if (snapped.current === -2) {
      snapped.current = T;
      sfx("snap", "trap");
      kick(7, 0.25);
    }
    const since = snapped.current < 0 ? -1 : CALM ? 9 : T - snapped.current;
    p.trap.position.y = drop(seg(t, 0, 0.45), 0.9);
    // 놓일 때는 닫힌 채 떨어져 힘겹게 벌어지고, 밟히면 단숨에 닫히며 한 번 튄다
    let open = pop(seg(t, 0.45, 0.95));
    if (since >= 0) open = since < 0.06 ? 1 - since / 0.06 : Math.max(0, 0.12 * Math.cos(since * 30) * (1 - seg(since, 0.06, 0.4)));
    const shut = (1 - Math.min(1.08, open)) * 1.42;
    p.a.rotation.x = -shut;
    p.b.rotation.x = shut;
    p.glint.position.x = ((T * 0.5) % 1.6) - 0.5;
    p.glint.scale.setScalar(since < 0 && t > 1 ? Math.max(0.001, Math.sin(Math.min(1, ((T * 0.5) % 1.6) / 1) * Math.PI)) : 0.001);
    const q = since < 0 ? 1 : seg(since, 0, 0.7);
    p.burst.visible = since >= 0 && q < 1;
    p.burst.children.forEach((piece, i) => {
      const a = (i / 7) * TAU;
      piece.position.set(Math.cos(a) * q * 0.9, 0.15 + Math.sin(q * Math.PI) * 0.5, Math.sin(a) * q * 0.9);
      piece.scale.setScalar(Math.max(0.001, 1 - q));
    });
    p.bang.visible = since >= 0 && since < 1.1;
    p.bang.position.y = 0.9 + pop(seg(since, 0, 0.25)) * 0.35;
    p.bang.scale.setScalar(pop(seg(since, 0, 0.25)) * (1 - seg(since, 0.8, 1.1)) + 0.001);
  });
  const jaw = (side: number, name: string) => (
    <group ref={at(name)}>
      <P g={tor(0.4, 0.045, Math.PI)} c="#8b97a8" rotation-x={(side * Math.PI) / 2} />
      {[0.35, 0.95, 1.57, 2.19, 2.79].map((a) => (
        <P key={a} g={cone(0.055, 0.2, 4)} c="#e3e8ef" position={[Math.cos(a) * 0.4, 0.1, side * Math.sin(a) * 0.4]} />
      ))}
    </group>
  );
  return (
    <group position={[0, 0.06, 2.05]} scale={1.25}>
      <group ref={at("trap")}>
        <P g={cyl(0.2, 0.22, 0.05, 10)} c="#5c6470" />
        <P g={box(0.86, 0.04, 0.09)} c="#5c6470" />
        <P g={tor(0.07, 0.02)} c="#5c6470" position={[0.56, 0, 0]} rotation-x={Math.PI / 2} />
        {jaw(1, "a")}
        {jaw(-1, "b")}
        <group ref={at("glint")} position={[0, 0.12, 0.38]}>
          <Star c="#ffffff" s={0.7} />
        </group>
      </group>
      <group ref={at("burst")} visible={false}>
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <group key={i}>{i % 2 ? <Star c="#ffd23f" s={1.1} /> : <Puff c="#e7dcc4" r={0.14} />}</group>
        ))}
      </group>
      <group ref={at("bang")} visible={false}>
        <P g={box(0.11, 0.34, 0.11)} c="#ffd23f" glow={0.5} position={[0, 0.2, 0]} />
        <P g={orb(0.075)} c="#ffd23f" glow={0.5} position={[0, -0.08, 0]} />
      </group>
    </group>
  );
}

// 밀고자: 귀 나팔을 벽에 바짝 대면 집 안의 말이 말풍선으로 새어 나온다.
function Exclaim() {
  const [p, at] = useParts();
  const age = useAge();
  useFrame((s) => {
    const T = s.clock.elapsedTime;
    const t = age(T);
    if (!p.horn) return;
    const press = seg(t, 0, 0.5);
    p.horn.position.set(0.85, 1.0 + Math.sin(T * 3) * 0.03, 2.4 - pop(press) * 0.72);
    p.horn.rotation.z = Math.sin(T * 5) * 0.06;
    p.horn.scale.setScalar(1 + Math.max(0, Math.sin(T * 5.2)) * 0.06);
    p.bang.scale.setScalar(t > 1.6 ? 0.8 + Math.abs(Math.sin(T * 4)) * 0.4 : 0.001);
    p.bang.position.y = 1.75 + Math.abs(Math.sin(T * 4)) * 0.15;
  });
  return (
    <>
      <group ref={at("horn")}>
        <P g={cyl(0.07, 0.3, 0.6, 12, true)} c="#d9a441" rotation-x={Math.PI / 2} />
        <L g={cyl(0.06, 0.28, 0.58, 12, true)} c="#8a5a1c" rotation-x={Math.PI / 2} />
        <P g={tor(0.3, 0.03)} c="#f2c96a" position={[0, 0, -0.3]} />
        <P g={cyl(0.05, 0.07, 0.16, 8)} c="#7a4a2a" rotation-x={Math.PI / 2} position={[0, 0, 0.36]} />
      </group>
      {/* 새어 나오는 말풍선: 벽에서 나팔을 타고 나와 떠오르다 톡 터진다 */}
      <Motes
        count={3}
        place={(i, t, o) => {
          const q = loop(t, 0.45, i, 3);
          o.position.set(0.85 + Math.sin(q * 5 + i) * 0.25, 1.15 + q * 1.3, 1.6 + q * 1.1);
          o.scale.setScalar(CALM ? 0.8 : q < 0.85 ? 0.35 + q * 0.75 : (1 - q) * 6.5);
        }}
      >
        <P g={orb(0.24, 12)} c="#fffaf0" scale={[1.25, 0.9, 0.5]} />
        <P g={cone(0.07, 0.16, 4)} c="#fffaf0" position={[-0.14, -0.22, 0]} rotation-z={2.6} scale={[1, 1, 0.5]} />
        {[-0.1, 0, 0.1].map((x) => (
          <L key={x} g={orb(0.03, 6)} c={INK} position={[x, 0, 0.13]} />
        ))}
      </Motes>
      <group ref={at("bang")} position={[0.85, 1.75, 2.45]}>
        <P g={box(0.12, 0.36, 0.12)} c="#ffd23f" glow={0.6} position={[0, 0.2, 0]} />
        <P g={orb(0.08)} c="#ffd23f" glow={0.6} position={[0, -0.1, 0]} />
      </group>
    </>
  );
}

// 선동꾼: 확성기가 집을 향해 쩌렁쩌렁 울리고, 화난 팻말들이 솟아 들썩인다.
function Shout() {
  const [p, at] = useParts();
  const age = useAge();
  useFrame((s) => {
    const T = s.clock.elapsedTime;
    const t = age(T);
    if (!p.horn) return;
    p.horn.scale.setScalar(pop(seg(t, 0, 0.4)));
    const yell = Math.max(0, Math.sin(T * 5));
    p.cone.scale.set(1 + yell * 0.14, 1 + yell * 0.14, 1 - yell * 0.1);
    p.signs.children.forEach((sign, i) => {
      sign.position.y = (pop(seg(t, 0.5 + i * 0.3, 0.9 + i * 0.3)) - 1) * 1.3 + Math.abs(Math.sin(T * 7 + i * 2)) * 0.16;
      sign.rotation.z = Math.sin(T * 7 + i * 2) * 0.16;
    });
  });
  const at3: [number, number, number][] = [
    [-1.7, 0, 2.5],
    [1.7, 0, 2.6],
    [-0.9, 0, 3.7],
  ];
  return (
    <>
      <group ref={at("horn")} position={[0.5, 0, 3.3]} rotation-y={-0.15}>
        <P g={cyl(0.03, 0.03, 0.85, 6)} c="#5b3a21" position={[0, 0.42, 0]} />
        <P g={cyl(0.2, 0.26, 0.06, 8)} c="#5b3a21" position={[0, 0.03, 0]} />
        <group ref={at("cone")} position={[0, 0.95, 0]} rotation-x={-0.12}>
          <P g={cyl(0.36, 0.1, 0.62, 14, true)} c="#e5484d" rotation-x={-Math.PI / 2} />
          <L g={cyl(0.34, 0.09, 0.6, 14, true)} c="#fffaf0" rotation-x={-Math.PI / 2} />
          <P g={tor(0.36, 0.03)} c="#fffaf0" position={[0, 0, -0.31]} />
          <P g={cyl(0.11, 0.11, 0.2, 10)} c="#3a3f4a" rotation-x={Math.PI / 2} position={[0, 0, 0.38]} />
          <P g={box(0.06, 0.22, 0.08)} c="#3a3f4a" position={[0, -0.18, 0.36]} />
        </group>
      </group>
      <Motes
        count={3}
        place={(i, t, o) => {
          const q = loop(t, 0.8, i, 3);
          o.position.set(0.5 - q * 0.45, 1.0, 2.9 - q * 1.5);
          o.scale.setScalar((0.35 + q * 0.9) * (q < 0.9 ? 1 : (1 - q) * 10));
        }}
      >
        <L g={tor(0.6, 0.05)} c="#ff9a2e" />
      </Motes>
      <group ref={at("signs")}>
        {at3.map((spot, i) => (
          <group key={i} position={spot}>
            <P g={box(0.06, 1.0, 0.06)} c="#8a5a30" position={[0, 0.5, 0]} />
            <P g={box(0.62, 0.42, 0.06)} c="#fffaf0" position={[0, 1.1, 0]} />
            {/* 화난 표시 */}
            {[0, 1].map((k) => (
              <group key={k} position={[0, 1.1, 0.04]} rotation-z={k * (Math.PI / 2) + 0.4}>
                <L g={box(0.3, 0.06, 0.01)} c="#d9443a" position={[0, 0.09, 0]} />
                <L g={box(0.3, 0.06, 0.01)} c="#d9443a" position={[0, -0.09, 0]} />
              </group>
            ))}
          </group>
        ))}
      </group>
    </>
  );
}

// 추적자: 문 곁에 꽂은 등불이 흔들리고, 문에서부터 빛나는 발자국이 하나씩 이어진다.
function Footprints() {
  const [p, at] = useParts();
  const age = useAge();
  useFrame((s) => {
    const T = s.clock.elapsedTime;
    const t = age(T);
    if (!p.pole) return;
    p.pole.scale.setScalar(pop(seg(t, 0, 0.45)));
    p.lamp.rotation.z = Math.sin(T * 2.2) * 0.22;
    (p.shine as THREE.PointLight).intensity = t > 0.4 ? 5 + Math.sin(T * 11) * 0.8 : 0;
    p.steps.children.forEach((step, i) => {
      const wave = 1 + Math.max(0, Math.sin(T * 3 - i * 0.7)) * 0.3;
      step.scale.setScalar(pop(seg(t, 0.6 + i * 0.28, 0.85 + i * 0.28)) * wave);
    });
  });
  return (
    <>
      <group ref={at("pole")} position={[1.0, 0, 1.95]} rotation-z={-0.12}>
        <P g={cyl(0.035, 0.045, 1.45, 6)} c="#5b3a21" position={[0, 0.72, 0]} />
        <P g={box(0.42, 0.05, 0.05)} c="#5b3a21" position={[-0.18, 1.42, 0]} />
        <group ref={at("lamp")} position={[-0.36, 1.4, 0]}>
          <P g={tor(0.05, 0.015)} c="#3a3f4a" position={[0, -0.06, 0]} />
          <P g={cone(0.17, 0.12, 4)} c="#3a3f4a" position={[0, -0.16, 0]} rotation-y={Math.PI / 4} />
          <L g={cyl(0.1, 0.1, 0.24, 8)} c="#ffe08a" position={[0, -0.34, 0]} />
          {[0, 1, 2, 3].map((i) => (
            <L key={i} g={box(0.02, 0.26, 0.02)} c="#3a3f4a" position={[Math.cos(i * 1.57 + 0.78) * 0.115, -0.34, Math.sin(i * 1.57 + 0.78) * 0.115]} />
          ))}
          <P g={box(0.24, 0.05, 0.24)} c="#3a3f4a" position={[0, -0.49, 0]} />
          <pointLight ref={at("shine")} color="#ffd98a" distance={6} position={[0, -0.34, 0]} />
        </group>
      </group>
      <group ref={at("steps")}>
        {Array.from({ length: 8 }, (_, i) => (
          <group key={i} position={[(i % 2 ? 0.17 : -0.17) + Math.sin(i * 0.5) * 0.5, 0.04, 1.6 + i * 0.4]} rotation-y={Math.cos(i * 0.5) * 0.35}>
            <L g={orb(0.1, 8)} c="#7df0d0" scale={[0.8, 0.12, 1.4]} />
            <L g={orb(0.065, 8)} c="#7df0d0" scale={[0.9, 0.12, 0.9]} position={[0, 0, -0.18]} />
          </group>
        ))}
      </group>
    </>
  );
}

// 청소부: 빗자루가 문 앞을 쓸고, 바닥의 흔적이 하나씩 지워지며 반짝인다. 곁에는 물 양동이.
function Sweep() {
  const [p, at] = useParts();
  const age = useAge();
  useFrame((s) => {
    const T = s.clock.elapsedTime;
    const t = age(T);
    if (!p.broom) return;
    p.broom.scale.setScalar(pop(seg(t, 0, 0.4)));
    p.broom.rotation.z = Math.sin(T * 4.2) * 0.55;
    p.broom.position.x = Math.sin(T * 1.1) * 0.5;
    p.pail.scale.setScalar(pop(seg(t, 0.2, 0.6)));
    p.water.rotation.z = Math.sin(T * 3) * 0.12;
    p.stains.children.forEach((stain, i) => stain.scale.setScalar(Math.max(0.001, 1 - seg(t, 1 + i * 0.6, 1.5 + i * 0.6))));
    p.shine.children.forEach((star, i) => {
      const on = seg(t, 1.5 + i * 0.6, 1.8 + i * 0.6);
      star.scale.setScalar(on * (0.6 + Math.abs(Math.sin(T * 3 + i * 2)) * 0.6) + 0.001);
      star.rotation.z = T * 1.5 + i;
    });
  });
  const marks: [number, number][] = [
    [-0.55, 0.15],
    [0.1, 0.5],
    [0.6, 0.05],
  ];
  return (
    <group position={[0, 0, 1.9]}>
      <group ref={at("broom")} position={[0, 1.5, 0.25]}>
        <P g={cyl(0.03, 0.03, 1.25, 6)} c="#b9814a" position={[0, -0.6, 0]} />
        <P g={box(0.5, 0.1, 0.14)} c="#8a5a30" position={[0, -1.22, 0]} />
        <P g={box(0.46, 0.24, 0.12)} c="#e8c25a" position={[0, -1.38, 0]} />
        {[-0.14, 0, 0.14].map((x) => (
          <L key={x} g={box(0.014, 0.22, 0.125)} c="#a8822c" position={[x, -1.38, 0]} />
        ))}
      </group>
      <group ref={at("pail")} position={[-1.3, 0, 0.2]}>
        <P g={cyl(0.24, 0.18, 0.36, 12, true)} c="#7fa3c7" position={[0, 0.18, 0]} />
        <P g={cyl(0.18, 0.18, 0.03, 12)} c="#5f84a8" position={[0, 0.015, 0]} />
        <L ref={at("water")} g={<circleGeometry args={[0.22, 14]} />} c="#bfe6ff" rotation-x={-Math.PI / 2} position={[0, 0.31, 0]} />
        <P g={tor(0.24, 0.016, Math.PI)} c="#3a3f4a" position={[0, 0.36, 0]} />
      </group>
      {/* 쓸려 나가는 흔적 */}
      <group ref={at("stains")}>
        {marks.map(([x, z], i) => (
          <L key={i} g={orb(0.13, 8)} c={i === 1 ? "#8f1d16" : "#3f2a1c"} o={0.85} scale={[1, 0.08, 1.5]} position={[x, 0.03, z]} rotation-y={i} />
        ))}
      </group>
      <group ref={at("shine")}>
        {marks.map(([x, z], i) => (
          <group key={i} position={[x, 0.22, z]}>
            <Star c="#ffffff" s={0.9} />
          </group>
        ))}
      </group>
      <Motes
        count={5}
        place={(i, t, o) => {
          const q = loop(t, 0.7, i, 5);
          const a = q * 5 + i;
          o.position.set(Math.sin(t * 1.1) * 0.5 + Math.cos(a) * q * 0.7, 0.12 + q * 0.5, 0.25 + Math.sin(a) * q * 0.5);
          o.scale.setScalar(Math.sin(q * Math.PI) * 0.9 + 0.001);
        }}
      >
        <Puff c="#efe6d2" r={0.11} />
      </Motes>
    </group>
  );
}

// 남탓쟁이: 페인트 통에 붓을 찍어 홱홱 뿌리면 벽과 지붕에 얼룩이 철퍽 붙고 흘러내린다.
function Paint({ h }: FxProps) {
  const [p, at] = useParts();
  const age = useAge();
  const spots: [number, number, number][] = [
    [0.55, 1.35, 1.48],
    [-0.6, 1.0, 1.5],
    [0.1, h * 0.72, 1.05],
  ];
  useFrame((s) => {
    const T = s.clock.elapsedTime;
    const t = age(T);
    if (!p.can) return;
    p.can.position.y = drop(seg(t, 0, 0.45), 0.9);
    const swing = Math.max(0, ...[0.6, 1.15, 1.7].map((at0) => Math.sin(seg(t, at0, at0 + 0.28) * Math.PI)));
    p.brush.rotation.x = -0.3 - swing * 1.5;
    p.brush.position.y = 0.75 + swing * 0.35;
    p.blobs.children.forEach((blob, i) => {
      const q = seg(t, 0.72 + i * 0.55, 0.98 + i * 0.55);
      blob.visible = q > 0 && q < 1;
      blob.position.set(1.25 + (spots[i][0] - 1.25) * q, 0.9 + (spots[i][1] - 0.9) * q + Math.sin(q * Math.PI) * 0.6, 2.2 + (spots[i][2] - 2.2) * q);
    });
    p.splats.children.forEach((splat, i) => {
      const q = seg(t, 0.98 + i * 0.55, 1.2 + i * 0.55);
      splat.scale.setScalar(pop(q));
      splat.children[4].scale.y = 1 + seg(t, 1.2 + i * 0.55, 3 + i * 0.55) * 0.9; // 흘러내리는 줄기
    });
  });
  return (
    <>
      <group ref={at("can")} position={[1.25, 0, 2.2]}>
        <P g={cyl(0.2, 0.2, 0.36, 12)} c="#c9ccd3" position={[0, 0.18, 0]} />
        <L g={<circleGeometry args={[0.18, 14]} />} c="#b3261e" rotation-x={-Math.PI / 2} position={[0, 0.365, 0]} />
        <P g={orb(0.07)} c="#b3261e" scale={[1, 1.6, 0.6]} position={[0.1, 0.27, 0.19]} />
        <P g={orb(0.05)} c="#b3261e" scale={[1, 2, 0.6]} position={[-0.08, 0.24, 0.19]} />
        <P g={tor(0.2, 0.014, Math.PI)} c="#3a3f4a" position={[0, 0.36, 0]} />
        <group ref={at("brush")} position={[0, 0.75, 0]} rotation-x={-0.3}>
          <P g={cyl(0.03, 0.035, 0.42, 6)} c="#b9814a" position={[0, 0.2, 0]} />
          <P g={box(0.16, 0.07, 0.06)} c="#c9ccd3" position={[0, -0.04, 0]} />
          <P g={box(0.15, 0.16, 0.05)} c="#b3261e" position={[0, -0.15, 0]} />
        </group>
      </group>
      <group ref={at("blobs")}>
        {spots.map((_, i) => (
          <group key={i} visible={false}>
            <P g={orb(0.1)} c="#b3261e" />
          </group>
        ))}
      </group>
      <group ref={at("splats")}>
        {spots.map((spot, i) => (
          <group key={i} position={spot} rotation-x={i === 2 ? -0.8 : 0} scale={0.001}>
            <P g={orb(0.26, 10)} c="#b3261e" scale={[1, 0.9, 0.16]} />
            <P g={orb(0.12, 8)} c="#b3261e" scale={[1, 1, 0.16]} position={[0.26, 0.16, 0]} />
            <P g={orb(0.1, 8)} c="#b3261e" scale={[1, 1, 0.16]} position={[-0.27, 0.1, 0]} />
            <P g={orb(0.08, 8)} c="#b3261e" scale={[1, 1, 0.16]} position={[0.12, -0.26, 0]} />
            <group position={[-0.06, -0.2, 0]}>
              <P g={cyl(0.035, 0.045, 0.22, 6)} c="#b3261e" position={[0, -0.11, 0]} scale={[1, 1, 0.4]} />
            </group>
          </group>
        ))}
      </group>
    </>
  );
}

// 살해: 칼이 번뜩이며 두 번 긋고 문에 꽂혀 떤다. heavy면 연쇄 살인범의 도끼가 두 번 내리찍는다.
function Slash({ heavy = false }: { heavy?: boolean }) {
  const [p, at] = useParts();
  const age = useAge();
  const kick = useShake();
  const hits = useRef(0);
  const cuts = heavy ? [0.7, 1.4] : [0.5, 0.85];
  const len = heavy ? 0.22 : 0.16;
  useFrame((s) => {
    const T = s.clock.elapsedTime;
    const t = age(T);
    const k = p.blade;
    if (!k) return;
    const n = cuts.filter((c) => t >= c + len).length;
    if (n > hits.current) {
      hits.current = n;
      kick(heavy ? 9 : 4, 0.2);
    }
    const stab = cuts[1] + len + 0.25;
    if (t < cuts[0]) {
      // 허공에서 번쩍 나타나 돈다
      k.position.set(0.5, 2.0, 0.9);
      k.rotation.set(0, 0, t * 13);
      k.scale.setScalar(pop(seg(t, 0, 0.3)) * (heavy ? 1.3 : 1.6));
    } else if (t < stab) {
      const i = t < cuts[1] ? 0 : 1;
      const q = seg(t, cuts[i], cuts[i] + len);
      const dir = i ? -1 : 1;
      k.position.set(dir * (-0.65 + q * 1.3), 1.75 - q * 1.15, 0.4 - Math.sin(q * Math.PI) * 0.2);
      k.rotation.set(heavy ? -0.6 + q * 1.6 : 0, 0, dir * 2.3);
    } else {
      const q = seg(t, stab, stab + 0.12);
      const since = t - stab - 0.12;
      k.position.set(heavy ? -0.15 : 0.18, heavy ? 1.55 : 1.25, 1.2 - q * (heavy ? 0.9 : 1.02));
      k.rotation.set(heavy ? 0.9 : -Math.PI / 2, since > 0 ? Math.sin(since * 38) * 0.22 * Math.exp(-since * 5) : 0, heavy ? 0.3 : 0);
    }
    cuts.forEach((c, i) => {
      const q = seg(t, c, c + len);
      p[`trail${i}`].scale.set(q < 1 ? Math.max(0.001, q) : Math.max(0.001, 1 - seg(t, c + len, c + len + 0.25)), 1, 1);
      p[`scar${i}`].scale.x = Math.max(0.001, q);
    });
    p.glint.scale.setScalar(Math.max(0.001, Math.sin(seg(t, 0.1, 0.4) * Math.PI) * 1.6));
    p.chips.visible = heavy && t > cuts[0] + len;
  });
  const red = heavy ? "#8f1d16" : "#d9443a";
  return (
    <group position={[0, 0, 1.5]}>
      {[0, 1].map((i) => (
        <group key={i} position={[0, 1.15, 0.03]} rotation-z={i ? 0.72 : -0.72}>
          <group ref={at(`scar${i}`)}>
            <L g={box(heavy ? 1.9 : 1.5, heavy ? 0.09 : 0.05, 0.02)} c="#3b1410" />
          </group>
          <group ref={at(`trail${i}`)} position={[0, 0, 0.3]}>
            <L g={box(heavy ? 2.6 : 2.2, heavy ? 0.2 : 0.09, 0.02)} c={heavy ? red : "#ffffff"} o={0.9} add={!heavy} />
            <L g={box(heavy ? 2.6 : 2.2, 0.04, 0.03)} c={heavy ? "#ff8a80" : red} />
          </group>
        </group>
      ))}
      <group ref={at("blade")}>
        {heavy ? (
          <>
            <P g={cyl(0.04, 0.05, 1.1, 6)} c="#7a4a2a" position={[0, -0.2, 0]} />
            <P g={box(0.42, 0.34, 0.07)} c="#aab4c2" position={[0.2, 0.25, 0]} />
            <L g={box(0.06, 0.36, 0.075)} c="#b3261e" position={[0.42, 0.25, 0]} />
            <P g={box(0.14, 0.2, 0.09)} c="#5c6470" position={[-0.05, 0.25, 0]} />
          </>
        ) : (
          <>
            <P g={cone(0.09, 0.62, 4)} c="#dfe5ee" position={[0, 0.34, 0]} scale={[1, 1, 0.28]} />
            <L g={box(0.02, 0.5, 0.03)} c="#ffffff" position={[0.02, 0.3, 0.02]} />
            <P g={box(0.26, 0.05, 0.08)} c="#3a3f4a" />
            <P g={cyl(0.04, 0.045, 0.26, 6)} c="#7a4a2a" position={[0, -0.15, 0]} />
          </>
        )}
        <group ref={at("glint")} position={[0, 0.55, 0.06]}>
          <Star c="#ffffff" s={0.9} />
        </group>
      </group>
      <group ref={at("chips")} visible={false}>
        <Motes
          count={6}
          place={(i, t, o) => {
            const q = loop(t, 0.9, i, 6);
            o.position.set(Math.sin(i * 2.1) * q * 0.9, 1.3 + Math.sin(q * Math.PI) * 0.5 - q * 0.9, 0.2 + q * 0.7);
            o.rotation.set(t * 5 + i, t * 4, 0);
            o.scale.setScalar(Math.max(0.001, 1 - q));
          }}
        >
          <P g={box(0.12, 0.04, 0.05)} c="#b9814a" />
        </Motes>
      </group>
    </group>
  );
}

// 폭탄(지속 소품). hot이면 곧 터질 듯 급하게 깜빡인다. 바닥 중심이 원점.
export function Bomb({ hot = false }: { hot?: boolean }) {
  const [p, at] = useParts();
  useFrame((s) => {
    const T = CALM ? 0 : s.clock.elapsedTime;
    if (!p.body) return;
    const beat = hot ? 14 : 5;
    p.body.scale.setScalar(1 + Math.max(0, Math.sin(T * beat)) * (hot ? 0.1 : 0.04));
    p.dot.visible = Math.sin(T * beat) > 0;
    p.spark.rotation.z = T * 9;
    p.spark.scale.setScalar(0.7 + Math.abs(Math.sin(T * 17)) * 0.6);
    const q = (T * (hot ? 2.4 : 0.9)) % 1;
    p.tick.scale.setScalar(0.3 + q * (hot ? 2.2 : 1.3));
    fade(p.tick, (1 - q) * 0.8);
  });
  return (
    <group>
      <group ref={at("body")} position={[0, 0.25, 0]}>
        <P g={orb(0.25, 14)} c="#2c2c36" />
        <L g={orb(0.05, 8)} c="#ffffff" o={0.7} position={[-0.1, 0.12, 0.17]} />
        <L ref={at("dot")} g={orb(0.045, 8)} c="#ff3b1f" position={[0.08, 0.02, 0.235]} />
        <P g={cyl(0.08, 0.09, 0.08, 8)} c="#5c6470" position={[0, 0.26, 0]} />
        <P g={cyl(0.018, 0.018, 0.14, 5)} c="#c9a24a" position={[0.02, 0.36, 0]} rotation-z={-0.3} />
        <P g={cyl(0.018, 0.018, 0.14, 5)} c="#c9a24a" position={[0.09, 0.46, 0]} rotation-z={-0.9} />
        <group ref={at("spark")} position={[0.16, 0.5, 0]}>
          <Star c="#ffe36b" s={0.8} />
        </group>
      </group>
      <L ref={at("tick")} g={tor(0.3, 0.02)} c={hot ? "#ff3b1f" : "#ffd23f"} o={0.8} rotation-x={Math.PI / 2} position={[0, 0.03, 0]} />
    </group>
  );
}

// 폭파범: 폭탄을 벽 밑에 툭 내려놓는다. fast(터뜨리기로 함)면 놓여 있는 폭탄 위로 불똥이 급하게 튄다.
function Fuse({ fast = false }: { fast?: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const age = useAge();
  useFrame((s) => {
    if (ref.current) ref.current.position.y = drop(seg(age(s.clock.elapsedTime), 0, 0.6), 1.3);
  });
  return (
    <group position={[-1.5, 0, 1.5]}>
      {!fast && (
        <group ref={ref}>
          <Bomb />
        </group>
      )}
      <Motes
        count={fast ? 8 : 4}
        place={(i, t, o) => {
          const q = loop(t, fast ? 3 : 1.2, i, fast ? 8 : 4);
          o.position.set(0.16 + Math.sin(i * 2.1) * q * 0.35, 0.75 + q * (fast ? 0.7 : 0.35), Math.cos(i * 2.1) * q * 0.35);
          o.scale.setScalar(1 - q);
        }}
      >
        <L g={orb(0.045, 6)} c={fast ? "#ff5a4d" : "#ffe36b"} />
      </Motes>
    </group>
  );
}

// 폭탄이 터지는 순간: 번쩍, 뭉게뭉게 불구름, 튀는 판자, 충격 고리, 남는 연기와 그을음 (한 번 재생하고 사라진다)
export function Burst() {
  const [p, at] = useParts();
  const age = useAge();
  const kick = useShake();
  const began = useRef(false);
  useFrame((s) => {
    const t = age(s.clock.elapsedTime);
    if (!p.all) return;
    if (!began.current) {
      began.current = true;
      sfx("boom", "attack");
      kick(16, 0.55);
    }
    p.all.visible = t < 6;
    p.flash.scale.setScalar(t < 0.09 ? 0.6 + t * 12 : 0.001);
    (p.light as THREE.PointLight).intensity = 90 * (1 - seg(t, 0, 0.7));
    const ring = seg(t, 0, 0.5);
    p.ring.scale.setScalar(0.4 + ring * 5.5);
    fade(p.ring, (1 - ring) * 0.9);
    p.cloud.children.forEach((puff, i) => {
      const a = (i / 9) * TAU;
      const q = seg(t, 0, 1.2);
      const out = 1 - (1 - q) ** 3;
      const rise = i % 3;
      puff.position.set(Math.cos(a) * out * (1.2 + rise * 0.3), 1.0 + rise * out * 0.9 + q * 0.5, Math.sin(a) * out * (1.2 + rise * 0.3));
      puff.scale.setScalar(Math.max(0.001, (0.7 + rise * 0.25) * Math.sin(Math.min(1, q * 1.15) * Math.PI) ** 0.6));
    });
    p.planks.children.forEach((plank, i) => {
      const a = (i / 8) * TAU + 0.4;
      const q = seg(t, 0, 1.4);
      plank.position.set(Math.cos(a) * q * 3.6, Math.max(0.05, 1 + (2.6 + (i % 3)) * q - 5.5 * q * q), Math.sin(a) * q * 3.6);
      plank.rotation.set(q * 9 + i, q * 7, i);
      plank.scale.setScalar(q < 1 ? 1 : 0.001);
    });
    p.smoke.children.forEach((puff, i) => {
      const q = seg(t, 0.4 + i * 0.25, 4.6 + i * 0.25);
      puff.position.set(Math.sin(i * 2.3) * 0.5 + Math.sin(q * 4 + i) * 0.3, 1 + q * 4.2, Math.cos(i * 2.3) * 0.5);
      puff.scale.setScalar(Math.max(0.001, Math.sin(q * Math.PI) * (0.9 + i * 0.12)));
    });
    p.soot.scale.setScalar(Math.max(0.001, seg(t, 0.2, 0.5) * (1 - seg(t, 5, 6))));
  });
  if (CALM) return null;
  return (
    <group ref={at("all")}>
      <L ref={at("flash")} g={orb(1.2, 12)} c="#fffbe0" o={0.6} add position={[0, 1.2, 0]} />
      <pointLight ref={at("light")} position={[0, 1.6, 0]} color="#ffb04a" distance={16} />
      <L ref={at("ring")} g={tor(0.6, 0.06)} c="#fff1b8" o={0.9} rotation-x={Math.PI / 2} position={[0, 0.2, 0]} />
      <group ref={at("cloud")}>
        {Array.from({ length: 9 }, (_, i) => (
          <group key={i}>
            <Puff c={i % 3 === 0 ? "#ffe36b" : i % 3 === 1 ? "#ff9a2e" : "#e2461c"} r={0.75} />
          </group>
        ))}
      </group>
      <group ref={at("planks")}>
        {Array.from({ length: 8 }, (_, i) => (
          <group key={i}>
            <P g={box(0.5, 0.07, 0.15)} c={i % 2 ? "#b9814a" : "#8a5a30"} />
          </group>
        ))}
      </group>
      <group ref={at("smoke")}>
        {Array.from({ length: 5 }, (_, i) => (
          <group key={i}>
            <Puff c={i % 2 ? "#5a524c" : "#3f3a36"} r={0.5} />
          </group>
        ))}
      </group>
      <group ref={at("soot")}>
        <Burning h={2.6} flames={false} />
      </group>
    </group>
  );
}

// 도둑: 쇠지렛대로 문틈을 젖히고, 반짝이는 것들이 자루로 쏙쏙 빨려 들어간다.
function Sparkle() {
  const [p, at] = useParts();
  const age = useAge();
  useFrame((s) => {
    const T = s.clock.elapsedTime;
    const t = age(T);
    if (!p.sack) return;
    p.sack.position.y = drop(seg(t, 0, 0.5), 1);
    const pry = t < 1.7 ? Math.sin(seg(t, 0.4, 1.7) * Math.PI * 3) : 0;
    p.bar.scale.setScalar(pop(seg(t, 0.2, 0.5)));
    p.bar.rotation.z = -0.35 + pry * 0.3;
    let gulp = 0;
    p.loot.children.forEach((star, i) => {
      const q = CALM ? 0.5 : seg((t - 1.7 - i * 0.35 + 30 * 2.4) % 2.4, 0, 0.7);
      star.visible = t > 1.7 + i * 0.35 && q < 1;
      star.position.set(0.35 + (1.3 - 0.35) * q, 0.95 + (0.75 - 0.95) * q + Math.sin(q * Math.PI) * 0.9, 1.5 + (2.15 - 1.5) * q);
      star.rotation.z = T * 5 + i;
      if (star.visible && q > 0.8) gulp = 1;
    });
    p.bag.scale.set(1 + gulp * 0.12, 1 - gulp * 0.08, 1 + gulp * 0.12);
  });
  return (
    <>
      <group ref={at("sack")} position={[1.3, 0, 2.15]}>
        <group ref={at("bag")}>
          <P g={orb(0.34, 10)} c="#a9783f" position={[0, 0.3, 0]} scale={[1, 0.95, 0.9]} />
          <P g={orb(0.16, 8)} c="#a9783f" position={[0.2, 0.18, 0.15]} />
          <P g={cyl(0.13, 0.08, 0.14, 8)} c="#a9783f" position={[0, 0.66, 0]} />
          <P g={tor(0.09, 0.025)} c="#e8c25a" position={[0, 0.6, 0]} rotation-x={Math.PI / 2} />
          <P g={box(0.2, 0.16, 0.02)} c="#8a5a30" position={[-0.08, 0.3, 0.3]} rotation-z={0.2} />
        </group>
      </group>
      <group ref={at("bar")} position={[0.38, 0.95, 1.5]}>
        <P g={cyl(0.03, 0.03, 0.9, 6)} c="#4a5a78" position={[0.12, 0.4, 0.12]} rotation-z={-0.2} />
        <P g={box(0.16, 0.05, 0.05)} c="#4a5a78" position={[-0.03, -0.04, 0.1]} rotation-z={0.5} />
      </group>
      <group ref={at("loot")}>
        {[0, 1, 2, 3, 4].map((i) => (
          <group key={i} visible={false}>
            <Star c={i % 2 ? "#ffe36b" : "#fff7c2"} s={1.3} />
          </group>
        ))}
      </group>
      <Motes
        count={4}
        place={(i, t, o) => {
          o.position.set(1.3 + Math.sin(i * 2.2) * 0.5, 0.95 + Math.cos(i * 1.7) * 0.25, 2.15 + Math.cos(i * 2.2) * 0.4);
          o.scale.setScalar(Math.max(0.001, Math.sin(t * 3 + i * 1.6)) * 0.7);
          o.rotation.z = t + i;
        }}
      >
        <Star c="#ffe36b" s={0.7} />
      </Motes>
    </>
  );
}

// 불에 그을린 집: 지붕의 그을음과 잔불, 피어오르는 연기와 날리는 재. flames가 false면 불은 꺼지고 그을음과 가는 연기만 남는다.
export function Burning({ h, flames = true }: FxProps & { flames?: boolean }) {
  const light = useRef<THREE.PointLight>(null);
  useFrame((s) => {
    if (light.current) light.current.intensity = 5 + Math.sin(s.clock.elapsedTime * 13) * 1.5;
  });
  const soot: [number, number, number, number][] = [
    [0.35, -0.3, 0.45, 0.42],
    [-0.5, -0.5, 0.2, 0.36],
    [0, -0.12, -0.2, 0.3],
    [-0.15, -0.75, 0.75, 0.3],
    [0.6, -0.7, -0.1, 0.26],
  ];
  return (
    <group position={[0, h, 0]}>
      {soot.map(([x, y, z, r], i) => (
        <L key={i} g={lump(r)} c="#1c1612" o={0.82} position={[x, y, z]} scale={[1.2, 0.55, 1.2]} />
      ))}
      {flames && (
        <>
          <group position={[0.3, -0.12, 0.35]}>
            <Flame s={0.9} />
          </group>
          <group position={[-0.45, -0.32, 0.15]}>
            <Flame s={0.65} />
          </group>
          <group position={[0.05, 0.02, -0.15]}>
            <Flame s={0.75} />
          </group>
          <pointLight ref={light} color="#ff8a3a" distance={6} position={[0, 0.5, 0]} />
        </>
      )}
      <Motes
        count={flames ? 6 : 2}
        place={(i, t, o) => {
          const q = CALM ? 0.4 + i * 0.1 : loop(t, 0.22, i, flames ? 6 : 2);
          o.position.set(Math.sin(i * 2.3 + q * 3) * 0.35, 0.1 + q * 3.2, Math.cos(i * 1.9) * 0.3);
          o.scale.setScalar(Math.sin(q * Math.PI) * (flames ? 0.9 : 0.45) * (0.6 + q) + 0.001);
        }}
      >
        <mesh>
          {lump(0.3)}
          <meshBasicMaterial color="#4a4440" transparent opacity={0.8} depthWrite={false} />
        </mesh>
      </Motes>
      {flames && (
        <Motes
          count={8}
          place={(i, t, o) => {
            const q = loop(t, 0.35, i, 8);
            o.position.set(Math.sin(i * 2.7 + q * 4) * (0.4 + q), 0.1 + q * 2.4, Math.cos(i * 3.1 + q * 3) * (0.4 + q));
            o.rotation.set(t * 3 + i, t * 2, 0);
            o.scale.setScalar(1 - q);
          }}
        >
          <L g={box(0.05, 0.012, 0.04)} c={INK} />
        </Motes>
      )}
    </group>
  );
}

// 번개 한 줄기를 다시 빚는다: 위에서 지붕으로 꺾이며 내려오고, 곁가지 둘이 갈라진다
const SEG = 9;
const TWIG = 4;
const UP = new THREE.Vector3(0, 1, 0);
const A = new THREE.Vector3();
const B = new THREE.Vector3();
const D = new THREE.Vector3();
const PTS = Array.from({ length: SEG + 1 }, () => new THREE.Vector3());
function lay(o: THREE.Object3D | undefined, a: THREE.Vector3, b: THREE.Vector3, thick: number) {
  if (!o) return;
  o.position.copy(a).add(b).multiplyScalar(0.5);
  D.subVectors(b, a);
  const len = D.length();
  o.quaternion.setFromUnitVectors(UP, D.divideScalar(len));
  o.scale.set(thick, len, thick);
}
function forge(segs: THREE.Object3D[], top: number, bottom: number, seed: number) {
  const x0 = (rnd(seed, 1) - 0.5) * 1.4;
  const x1 = (rnd(seed, 2) - 0.5) * 0.9;
  const z1 = (rnd(seed, 3) - 0.5) * 0.7;
  for (let i = 0; i <= SEG; i++) {
    const f = i / SEG;
    const sway = Math.sin(f * Math.PI);
    PTS[i].set(x0 + (x1 - x0) * f + (rnd(seed, 10 + i) - 0.5) * 1.0 * sway, top + (bottom - top) * f, z1 * f + (rnd(seed, 30 + i) - 0.5) * 0.6 * sway);
  }
  for (let i = 0; i < SEG; i++) lay(segs[i], PTS[i], PTS[i + 1], 1);
  for (let b = 0; b < 2; b++) {
    const side = b ? -1 : 1;
    A.copy(PTS[b ? 5 : 3]);
    for (let i = 0; i < TWIG; i++) {
      const k = 50 + b * 20 + i * 3;
      B.set(A.x + side * (0.2 + rnd(seed, k) * 0.35), A.y - 0.25 - rnd(seed, k + 1) * 0.3, A.z + (rnd(seed, k + 2) - 0.5) * 0.4);
      lay(segs[SEG + b * TWIG + i], A, B, 0.6 - i * 0.1);
      A.copy(B);
    }
  }
}
// 몇 번째 번개까지 쳤는가: 처음엔 쾅, 쾅… 쾅 세 번, 그 뒤로는 가끔 두 번씩
const strikes = (t: number) => {
  if (t < 3) return [1.5, 1.85, 2.5].filter((at0) => t >= at0).length;
  const lap = (t - 3) % 3.8;
  return 3 + Math.floor((t - 3) / 3.8) * 2 + (lap >= 2.4 ? 1 : 0) + (lap >= 2.72 ? 1 : 0);
};

// 마법사: 지팡이를 꽂고 마법서를 펼치면 먹구름이 지붕 위로 모이고, 번개가 쾅쾅 내리꽂혀 집이 그을린다.
function Curse({ h }: FxProps) {
  const [p, at] = useParts();
  const age = useAge();
  const kick = useShake();
  const segs = useRef<THREE.Object3D[]>([]);
  const last = useRef({ n: 0, at: -9, now: -9 });
  const top = h + 4.3;
  useFrame((s) => {
    const T = s.clock.elapsedTime;
    const t = age(T);
    if (!p.cloud) return;
    p.staff.scale.setScalar(pop(seg(t, 0, 0.4)));
    p.gem.rotation.y = T * 2;
    p.gem.scale.setScalar(1 + Math.sin(T * 6) * 0.12);
    p.book.scale.setScalar(pop(seg(t, 0.2, 0.6)));
    p.book.position.y = 1.05 + Math.sin(T * 2) * 0.07;
    p.page.rotation.z = -0.3 + ((T * 1.4) % 1) * 0.6 + 1.25;
    p.rune.rotation.z = T * 0.8;
    p.rune.scale.setScalar(pop(seg(t, 0.4, 0.9)));
    // 먹구름이 사방에서 모여든다
    const gather = seg(t, 0.3, 1.3);
    p.cloud.children.forEach((puff, i) => {
      const a = i * 0.9 + T * 0.12;
      const r = 1.0 + (i % 3) * 0.5 + (1 - gather) ** 2 * 6;
      puff.position.set(Math.cos(a) * r * 1.25, Math.sin(T * 0.9 + i) * 0.07 + (i % 2) * 0.25, Math.sin(a) * r * 0.7);
      puff.scale.setScalar(Math.max(0.001, gather) * (0.8 + (i % 3) * 0.2));
    });
    const k = last.current;
    if (t > 1.2 && k.n === 0 && k.at < -1 && !CALM) {
      k.at = -1; // 예고 섬광은 한 번만
      sfx("zap", "hex", 0.7);
    }
    const n = CALM ? 1 : strikes(t);
    if (n > k.n) {
      k.n = n;
      k.at = t;
      k.now = T;
      forge(segs.current, top - 0.2, h - 0.2, n);
      if (!CALM) {
        sfx("thunder", "attack", n <= 3 ? 1 : 0.6);
        kick(n <= 3 ? 12 : 6, 0.35);
      }
    }
    const since = t - k.at;
    // 번쩍: 두 프레임쯤 세게, 한 번 깜빡이고 스러진다
    p.bolt.visible = k.n > 0 && (CALM || (since < 0.17 && (since < 0.07 || since > 0.1)));
    (p.sky as THREE.AmbientLight).intensity = CALM ? 0 : since < 0.05 ? 2.2 : Math.max(0, 0.45 - since * 3);
    (p.glow as THREE.PointLight).intensity = CALM ? 0 : (since < 0.3 ? 70 * (1 - since / 0.3) : 0) + (t > 1.2 && t < 1.32 ? 14 : 0);
    const ring = seg(since, 0, 0.45);
    p.ring.visible = k.n > 0 && ring < 1 && !CALM;
    p.ring.scale.setScalar(0.3 + ring * 2.6);
    fade(p.ring, 1 - ring);
    p.burn.visible = k.n > 0;
  });
  return (
    <>
      <group ref={at("staff")} position={[1.35, 0, 2.3]} rotation-z={0.12}>
        <P g={cyl(0.04, 0.055, 1.5, 6)} c="#4a3423" position={[0, 0.75, 0]} />
        <P g={tor(0.16, 0.035, Math.PI * 1.4)} c="#c9a24a" position={[0, 1.6, 0]} rotation-z={-0.6} />
        <group ref={at("gem")} position={[0, 1.62, 0]}>
          <L g={<octahedronGeometry args={[0.11]} />} c="#c89bff" />
        </group>
        <pointLight color="#b47bff" intensity={3} distance={4} position={[0, 1.6, 0]} />
      </group>
      <group ref={at("book")} position={[-1.3, 1.05, 2.2]} rotation-y={0.5} rotation-x={0.5}>
        <P g={box(0.34, 0.04, 0.46)} c="#5b3a8c" position={[-0.17, 0, 0]} rotation-z={0.3} />
        <P g={box(0.34, 0.04, 0.46)} c="#5b3a8c" position={[0.17, 0, 0]} rotation-z={-0.3} />
        <L g={box(0.3, 0.015, 0.42)} c="#fffaf0" position={[-0.16, 0.03, 0]} rotation-z={0.3} />
        <L g={box(0.3, 0.015, 0.42)} c="#fffaf0" position={[0.16, 0.03, 0]} rotation-z={-0.3} />
        <group ref={at("page")} position={[0, 0.02, 0]}>
          <L g={box(0.3, 0.008, 0.42)} c="#f1e6c8" position={[0.15, 0, 0]} />
        </group>
        <L g={<octahedronGeometry args={[0.05]} />} c="#c89bff" position={[0, 0.3, 0]} />
      </group>
      <group ref={at("rune")} rotation-x={-Math.PI / 2} position={[0, 0.05, 0]}>
        <L g={tor(2.3, 0.03, TAU * 0.3)} c="#b47bff" o={0.8} />
        <L g={tor(2.3, 0.03, TAU * 0.3)} c="#b47bff" o={0.8} rotation-z={TAU / 3} />
        <L g={tor(2.3, 0.03, TAU * 0.3)} c="#b47bff" o={0.8} rotation-z={(TAU * 2) / 3} />
      </group>
      <group ref={at("cloud")} position={[0, top + 0.3, 0]}>
        {Array.from({ length: 7 }, (_, i) => (
          <group key={i}>
            <Puff c={i % 2 ? "#4a4266" : "#353048"} r={0.85} />
          </group>
        ))}
      </group>
      <group ref={at("bolt")} visible={false}>
        {Array.from({ length: SEG + TWIG * 2 }, (_, i) => (
          <group
            key={i}
            ref={(o) => {
              if (o) segs.current[i] = o;
            }}
          >
            <L g={cyl(0.05, 0.05, 1, 5)} c="#ffffff" />
            <L g={cyl(0.15, 0.15, 1.02, 6)} c="#b98bff" o={0.55} add />
          </group>
        ))}
        <L g={orb(0.5, 10)} c="#f3e8ff" o={0.8} add position={[0, h - 0.1, 0]} />
      </group>
      <ambientLight ref={at("sky")} color="#e9dcff" intensity={0} />
      <pointLight ref={at("glow")} color="#c89bff" distance={14} position={[0, h + 1, 0.5]} intensity={0} />
      <L ref={at("ring")} g={tor(0.6, 0.05)} c="#e9dcff" visible={false} rotation-x={Math.PI / 2} position={[0, h - 0.1, 0]} o={1} add />
      <Motes
        count={10}
        place={(i, T, o) => {
          const q = CALM ? 1 : seg(T - last.current.now, 0, 0.6);
          const a = (i / 10) * TAU + last.current.n;
          o.position.set(Math.cos(a) * q * 1.6, h + Math.sin(q * Math.PI) * 0.9 - q * 0.8, Math.sin(a) * q * 1.6);
          o.scale.setScalar(Math.max(0.001, 1 - q));
        }}
      >
        <L g={orb(0.06, 6)} c="#fff1b8" />
      </Motes>
      <group ref={at("burn")} visible={false}>
        <Burning h={h} />
      </group>
    </>
  );
}

// 양초(지속 소품). 바닥 중심이 원점. 여럿을 세울 때는 하나만 빛을 내게 한다(조명 수를 아낀다).
export function Candle({ glow = true }: { glow?: boolean }) {
  return (
    <group>
      <P g={cyl(0.075, 0.085, 0.4, 8)} c="#fff3c4" position={[0, 0.2, 0]} />
      <P g={orb(0.045, 6)} c="#fff3c4" scale={[1, 1.8, 1]} position={[0.07, 0.3, 0.02]} />
      <P g={cyl(0.13, 0.15, 0.04, 8)} c="#8b97a8" position={[0, 0.02, 0]} />
      <group position={[0, 0.4, 0]}>
        <Flame s={0.45} />
      </group>
      {glow && <pointLight color="#ffb347" intensity={3} distance={4} position={[0, 0.6, 0]} />}
    </group>
  );
}

// 무속인: 촛불 셋이 켜지고 부적이 문에 착 붙는다. 꼬리 달린 혼불이 집을 맴돈다.
function Wisps({ h }: FxProps) {
  const [p, at] = useParts();
  const age = useAge();
  useFrame((s) => {
    const T = s.clock.elapsedTime;
    const t = age(T);
    if (!p.charm) return;
    p.candles.children.forEach((candle, i) => candle.scale.setScalar(pop(seg(t, i * 0.25, 0.35 + i * 0.25))));
    const fly = seg(t, 0.8, 1.2);
    p.charm.position.set(0, 1.55, 3.2 - fly * 1.72);
    p.charm.rotation.set(fly < 1 ? fly * 12 : Math.sin(T * 3) * 0.12, 0, fly < 1 ? fly * 6 : 0);
    p.charm.scale.setScalar(pop(seg(t, 0.7, 0.9)));
  });
  const spots: [number, number, number][] = [
    [-0.8, 0, 2.1],
    [0.8, 0, 2.1],
    [0, 0, 2.55],
  ];
  return (
    <>
      <group ref={at("candles")}>
        {spots.map((spot, i) => (
          <group key={i} position={spot}>
            <Candle glow={i === 2} />
          </group>
        ))}
      </group>
      {/* 부적: 위쪽이 문에 붙고 아래가 팔랑거린다 */}
      <group ref={at("charm")}>
        <P g={box(0.24, 0.6, 0.015)} c="#f2d24b" position={[0, -0.3, 0]} />
        <L g={box(0.14, 0.03, 0.02)} c="#b3261e" position={[0, -0.1, 0.01]} />
        <L g={box(0.03, 0.3, 0.02)} c="#b3261e" position={[0, -0.3, 0.01]} />
        <L g={box(0.14, 0.03, 0.02)} c="#b3261e" position={[0, -0.3, 0.01]} rotation-z={0.5} />
        <L g={box(0.14, 0.03, 0.02)} c="#b3261e" position={[0, -0.48, 0.01]} />
      </group>
      <Motes
        count={5}
        place={(i, t, o) => {
          const a = t * 0.9 + (i / 5) * TAU;
          o.position.set(Math.cos(a) * 2.1, 0.7 + (i / 5) * h * 0.7 + Math.sin(t * 2 + i) * 0.3, Math.sin(a) * 2.1);
          o.rotation.y = -a;
          o.scale.setScalar(0.8 + Math.sin(t * 3 + i) * 0.2);
        }}
      >
        <L g={orb(0.15, 10)} c="#c9f0ff" o={0.9} />
        <L g={cone(0.13, 0.5, 8)} c="#c9f0ff" o={0.5} rotation-x={-Math.PI / 2} position={[0, 0, -0.3]} />
        <L g={orb(0.03, 6)} c={INK} position={[-0.05, 0.02, 0.13]} />
        <L g={orb(0.03, 6)} c={INK} position={[0.05, 0.02, 0.13]} />
      </Motes>
    </>
  );
}

// 생존자: 투구가 머리에 떨어지고 방패가 앞을 철컹 막아선다 (캐릭터 기준 좌표)
export function Shield() {
  const [p, at] = useParts();
  const age = useAge();
  const kick = useShake();
  const hit = useRef(false);
  useFrame((s) => {
    const T = s.clock.elapsedTime;
    const t = age(T);
    if (!p.helm) return;
    p.helm.position.y = 1.02 + drop(seg(t, 0, 0.5), 1.6);
    const swing = seg(t, 0.2, 0.5);
    p.guard.position.set((1 - pop(swing)) * 1.4, 0.5, 0.62);
    p.guard.rotation.y = (1 - swing) * 1.6;
    if (t > 0.5 && !hit.current) {
      hit.current = true;
      kick(5, 0.2);
    }
    const ring = seg(t, 0.5, 0.95);
    p.ring.visible = ring > 0 && ring < 1;
    p.ring.scale.setScalar(0.4 + ring * 2.2);
    fade(p.ring, 1 - ring);
    p.aura.scale.setScalar(1 + Math.sin(T * 3) * 0.04);
    p.aura.rotation.y = T;
  });
  return (
    <>
      <group ref={at("helm")}>
        <P g={<sphereGeometry args={[0.42, 12, 6, 0, TAU, 0, Math.PI / 2]} />} c="#aab4c2" />
        <P g={tor(0.42, 0.04)} c="#c9a24a" rotation-x={Math.PI / 2} />
        <P g={box(0.07, 0.24, 0.05)} c="#aab4c2" position={[0, -0.1, 0.41]} />
        <P g={box(0.07, 0.2, 0.6)} c="#d9443a" position={[0, 0.42, -0.05]} />
      </group>
      <group ref={at("guard")}>
        <P g={cyl(0.42, 0.42, 0.07, 16)} c="#6f8fb8" rotation-x={Math.PI / 2} />
        <P g={tor(0.42, 0.045)} c="#c9a24a" />
        <P g={orb(0.11, 10)} c="#c9a24a" position={[0, 0, 0.06]} />
        <L g={box(0.5, 0.07, 0.01)} c="#e8eef7" position={[0, 0, 0.04]} rotation-z={0.78} />
      </group>
      <L ref={at("ring")} g={tor(0.5, 0.04)} c="#ffffff" visible={false} position={[0, 0.5, 0.66]} o={1} add />
      <mesh ref={at("aura")} position={[0, 0.55, 0]}>
        <icosahedronGeometry args={[0.95, 1]} />
        <meshBasicMaterial color="#8fd0ff" transparent opacity={0.14} depthWrite={false} />
      </mesh>
    </>
  );
}

const EFFECTS: Record<string, (h: number) => ReactNode> = {
  doctor: (h) => <Heal h={h} />,
  blocker: () => <Barricade />,
  lookout: () => <Watch />,
  investigator: () => <Inspect />,
  trapper: () => <Trap />,
  snap: () => <Trap stage="snap" />, // 덫이 철컥 닫히는 순간 (회상 장면용)
  snitch: () => <Exclaim />,
  provoker: () => <Shout />,
  tracker: () => <Footprints />,
  cleaner: () => <Sweep />,
  blamer: (h) => <Paint h={h} />,
  kill: () => <Slash />,
  serialKiller: () => <Slash heavy />,
  thief: () => <Sparkle />,
  sorcerer: (h) => <Curse h={h} />,
  haunter: (h) => <Wisps h={h} />,
  bomber: () => <Fuse />,
  detonate: () => <Fuse fast />,
};

// kind: 역할 id, 또는 "kill"(임포스터의 살해), "detonate"(폭파 직전), "snap"(덫이 닫힘). h는 집 지붕 높이.
// door는 그 집 문의 앞뒤 위치. 효과들은 기본 집의 문(1.09)에 맞춰 놓여 있어서, 문이 더 나오거나 들어간 집에서는 그만큼 민다.
export function AbilityEffect({ kind, h = 2.8, door = 1.09 }: { kind: string; h?: number; door?: number }) {
  const made = EFFECTS[kind]?.(h);
  return made ? <group position-z={door - 1.09}>{made}</group> : null;
}
