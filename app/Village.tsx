"use client";

// 3D 마을. 서버가 준 상태(좌석 목록)를 그리고, 집이나 캐릭터를 누르면 onPick을 부를 뿐 게임 규칙은 모른다.
// 모델은 Blender에서 만든 것(원본: assets/village.blend → public/models/*.glb).
import { Canvas, createPortal, useFrame, useLoader, useThree, type ThreeElements, type ThreeEvent } from "@react-three/fiber";
import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { Bubble } from "./Bubble";
import { COLORS } from "./colors";
import { bedtime, casting, doorOpen, Doorway, DOORS, hinge, indoors, late, sky, tick, turn, useDark, useTurn } from "./Dusk";
import { AbilityEffect, Bomb, Burning, Burst, Candle, HeldBroom, RoleIcon, Shield } from "./Effects";
import { Fire } from "./Fire";
import { Post, Veil, toon } from "./Look";
import { Replay, ReplayHud } from "./Scenes";
import { play } from "./sound";
import { lean, type Call, type Exile, type Flash } from "./stage";
import { collider, lift, plan, Terrain, type Circle, type Plan } from "./Terrain";
import type { Mode, Role } from "../game";

export type Scene = "lobby" | "night" | "day" | "ended";
export type Positions = Map<string, { x: number; z: number }>;

export interface Seat {
  id: string;
  name: string;
  skin: string; // "blob"이면 기본 캐릭터, 아니면 public/models/skins/<skin>.glb
  house: string; // public/models/<house>.glb
  hat: string; // "none"이면 없음, 아니면 public/models/hat-<hat>.glb
  done: boolean; // 이번 페이즈의 선택을 마쳤다 (집 위 체크 딱지)
  alive: boolean;
  isMe: boolean;
  ally: boolean;
  mayor: boolean;
  enabled: boolean; // 지금 누를 수 있는가
  mark: "kill" | "aim" | "vote" | null; // 내가 고른 대상 표시
  effect: string | null; // 이 집에서 보여 줄 내 능력 연출 (역할 id, "kill", "detonate")
  status: string;
  bombed: boolean;
  marked: boolean;
  won: boolean;
}

interface Props {
  seats: Seat[];
  scene: Scene;
  going: string | null; // 오늘 밤 내가 찾아가는 집
  iconRole: string | null; // 능력을 쓰는 동안 머리 위에 띄울 역할 그림
  shield: boolean; // 오늘 밤 갑옷을 입기로 했다
  actKind?: string | null; // 내 차례가 지난 뒤 보여 줄 몸짓
  standKind?: string | null; // 고른 집 앞에서 어느 자리로 설지
  positions: RefObject<Positions>; // 다른 플레이어들이 보내 온 위치
  demo?: boolean; // 메뉴 배경: 조작 없이 카메라가 스스로 돈다 (이름이 빈 자리는 이름표도 없다)
  hud?: boolean; // 회상·발표 밑의 글을 보일지
  heldTools?: boolean; // 손에 쥐는 도구 견본을 쓸지
  replay?: Flash | null; // 어젯밤 회상: 이 장면이 도는 동안 마을은 밤으로 돌아가고 평소의 캐릭터들은 물러난다
  onReplayEnd?: () => void;
  exile?: Exile | null; // 추방: 풍선에 실려 날아가고 묘비가 떨어진다 (낮이 끝난 직후, 모두가 본다)
  onExileEnd?: () => void;
  call?: Call | null; // 아침 발표: 회상이 끝난 뒤, 모두가 광장에 모여 밤사이 공개된 일을 본다
  onCallEnd?: () => void;
  burnt?: string[]; // 어젯밤 폭탄에 터진 집들 (낮 동안 그을음과 가는 연기가 남는다)
  unseen?: string[]; // 밤사이 죽었지만 아직 발표되지 않은 사람들 (집이 멀쩡해 보여야 한다)
  onSeen?: (id: string) => void;
  onPick: (id: string) => void;
  onMove: (x: number, z: number) => void;
}

const MARK = { kill: "#ef4444", aim: "#60a5fa", vote: "#facc15" };
const SKY = { day: new THREE.Color("#8ecae6"), night: new THREE.Color("#0b1026") };
const SUN = { day: new THREE.Color("#fff1d0"), night: new THREE.Color("#8fa8ff") };
const AMBIENT = { day: new THREE.Color("#ffffff"), night: new THREE.Color("#6f7fd0") };
const SPEED = 5; // 초당 이동 거리
const REACH = 8; // 집들 바깥으로 걸어 나갈 수 있는 거리
const EDGE = 2.5; // 마을 끝에서 이만큼 안쪽부터 걸음이 느려진다
const UP = new THREE.Vector3(0, 1, 0);
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const shift = new THREE.Vector3();

const ringRadius = (n: number) => 5.5 + n * 0.45;

// 집은 광장을 둘러싸고 문이 광장을 향한다
function layout(n: number) {
  const radius = ringRadius(n);
  return Array.from({ length: n }, (_, i) => {
    const angle = (i / n) * Math.PI * 2;
    const dir = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
    return {
      angle,
      house: dir.clone().multiplyScalar(radius),
      door: dir.clone().multiplyScalar(radius - 2.8), // 지붕에 가리지 않게 문에서 조금 떨어져 선다
      plaza: dir.clone().multiplyScalar(1.7 + n * 0.12),
    };
  });
}
type Spot = ReturnType<typeof layout>[number];

// 모션 줄이기를 켠 사람에게는 흔들림·일렁임 같은 배경 움직임을 끈다
const CALM = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// 바람에 흔들리는 나무와 덤불
function Sway({ amount, phase, children }: { amount: number; phase: number; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!ref.current || CALM) return;
    const t = state.clock.elapsedTime;
    ref.current.rotation.z = Math.sin(t * 1.3 + phase) * amount;
    ref.current.rotation.x = Math.cos(t * 1.05 + phase * 1.7) * amount * 0.6;
  });
  return <group ref={ref}>{children}</group>;
}

// 나타날 때 통 튀어나온다 (묘비, 왕관)
function Pop({ children }: { children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const start = useRef(-1);
  useFrame((state) => {
    if (!ref.current) return;
    if (start.current < 0) start.current = state.clock.elapsedTime;
    const q = Math.min(1, (state.clock.elapsedTime - start.current) / 0.45) - 1;
    ref.current.scale.setScalar(Math.max(0.001, 1 + 2.70158 * q ** 3 + 1.70158 * q ** 2));
  });
  return (
    <group ref={ref} scale={0.001}>
      {children}
    </group>
  );
}

// 두근거리듯 커졌다 작아진다 (폭탄, 양초)
function Throb({ speed, amount, children }: { speed: number; amount: number; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (ref.current && !CALM) ref.current.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * speed) * amount);
  });
  return <group ref={ref}>{children}</group>;
}

// 내가 고른 집 바닥의 고리. 고르는 순간 한 번 퍼져 나가고, 그 뒤로 은은하게 뛴다.
function Ring({ color }: { color: string }) {
  const ring = useRef<THREE.Mesh>(null);
  const wave = useRef<THREE.Mesh>(null);
  const start = useRef(-1);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (start.current < 0) start.current = t;
    ring.current?.scale.setScalar(1 + Math.sin(t * 4) * 0.03);
    if (wave.current) {
      const p = Math.min(1, (t - start.current) / 0.7);
      wave.current.scale.setScalar(1 + p * 0.9);
      (wave.current.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - p);
    }
  });
  return (
    <group position={[0, 0.04, 0]} rotation-x={-Math.PI / 2}>
      <mesh ref={ring}>
        <ringGeometry args={[2.15, 2.45, 48]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh ref={wave}>
        <ringGeometry args={[2.3, 2.5, 48]} />
        <meshBasicMaterial color={color} transparent />
      </mesh>
    </group>
  );
}

// 굴뚝에서 피어오르는 연기. at은 굴뚝 꼭대기.
function Smoke({ at }: { at: readonly [number, number, number] }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    ref.current?.children.forEach((puff, i) => {
      const p = (state.clock.elapsedTime * 0.22 + i / 3) % 1;
      puff.position.set(at[0] + Math.sin(p * 4 + i) * 0.12, at[1] + p * 1.5, at[2] + p * 0.25);
      puff.scale.setScalar(0.1 + p * 0.22);
      ((puff as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - p);
    });
  });
  if (CALM) return null;
  return (
    <group ref={ref}>
      {[0, 1, 2].map((i) => (
        <mesh key={i}>
          <sphereGeometry args={[1, 8, 6]} />
          <meshBasicMaterial color="#e9e6df" transparent depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

// 광장의 모닥불: 장작과 돌은 모델, 불꽃·불티·불빛은 Fire가 그린다 (모델에 든 불꽃은 숨긴다)
const noFlame: Paint = (name, material) => {
  if (name.startsWith("Flame")) material.visible = false;
};
function Campfire({ night }: { night: boolean }) {
  return <Fire night={night} calm={CALM} />;
}

type Paint = (name: string, material: THREE.MeshStandardMaterial) => void;

type ActKind = Role | Extract<Mode, "kill" | "detonate" | "armor"> | "doctorSaved" | "healed" | "snitchTarget";

// 역할/행동별 몸짓. 없는 클립은 Model에서 cast로 대신한다.
export const ACT_CLIP = {
  doctor: "medic",
  doctorSaved: "cpr",
  healed: "cheer",
  blocker: "halt",
  lookout: "spy",
  investigator: "inspect",
  trapper: "settrap",
  snitch: "peek",
  snitchTarget: "flinch",
  provoker: "shout",
  tracker: "track",
  cleaner: "sweep",
  blamer: "paint",
  survivor: "brace",
  serialKiller: "stab",
  bomber: "plant",
  thief: "steal",
  sorcerer: "conjure",
  haunter: "candle",
  kill: "stab",
  detonate: "press",
  armor: "brace",
} as const satisfies Record<ActKind, string>;

const LOOP_ACT_CLIPS = new Set(["cpr", "halt", "spy", "shout", "sweep", "paint", "brace", "steal"]);
export function actClip(kind: string | null | undefined) {
  return kind && Object.hasOwn(ACT_CLIP, kind) ? ACT_CLIP[kind as ActKind] : "cast";
}
function actSecs(kind: string | null | undefined) {
  return LOOP_ACT_CLIPS.has(actClip(kind)) ? 6 : 2;
}

const ACT_STAND: Partial<Record<ActKind, { x: number; z: number }>> = {
  doctor: { x: 0.4, z: 2.6 },
  blocker: { x: 0, z: 2.8 },
  investigator: { x: 0, z: 2.3 },
  trapper: { x: 0, z: 2.8 },
  snitch: { x: 0.85, z: 2.3 },
  provoker: { x: 0.5, z: 3.9 },
  cleaner: { x: 0, z: 2.6 },
  blamer: { x: 0.9, z: 2.9 },
  serialKiller: { x: 0, z: 2.4 },
  bomber: { x: -1.5, z: 2.3 },
  thief: { x: 0.6, z: 2.5 },
  sorcerer: { x: 0, z: 2.8 },
  haunter: { x: 0, z: 3.1 },
  kill: { x: 0, z: 2.4 },
};

function actStand(kind: string | null | undefined, spot: Spot, house: string) {
  const p = kind && Object.hasOwn(ACT_STAND, kind) ? ACT_STAND[kind as ActKind] : null;
  if (!p) return spot.door;
  const z = p.z + ((DOORS[house]?.z ?? 1.09) - 1.09);
  return new THREE.Vector3(p.x, 0, z).applyAxisAngle(UP, spot.angle + Math.PI).add(spot.house);
}

// glb 모델 하나. 인스턴스마다 재질을 따로 가져서, paint로 재질 이름별 색을 바꿀 수 있다
// (지붕·몸을 플레이어 색으로, 창문을 밤에 밝게 등). paint는 매번 원래 색에서 다시 칠한다.
// 뼈대가 있는 모델(캐릭터)은 clip이 가리키는 동작을 재생하고, 표정 하나만 보이며(동작에 짝지은 표정이 face보다 먼저다), overhead를 머리 위 기준점에 붙인다.
type ModelProps = { file: string; paint?: Paint; clip?: RefObject<string>; face?: string; overhead?: ReactNode; held?: ReactNode; door?: RefObject<number> }; // held는 오른팔 뼈(armR)에 붙는다
const ONCE = new Set(["vote", "startle", "turn", "die", "cast", "yawn", ...Object.values(ACT_CLIP).filter((name) => !LOOP_ACT_CLIPS.has(name))]); // 한 번 하고 마지막 자세로 멈추는 동작
const FACE: Record<string, string> = { cheer: "happy", startle: "surprised", die: "dead", sad: "scared", yawn: "sleepy", revive: "surprised", flinch: "scared", press: "scared", paint: "happy", steal: "happy" }; // 동작과 짝인 표정
const STEP = 1 / 60; // 자세 갱신 간격 (클립 키 사이는 보간된다)
const THIN = 0.025; // 집 외곽선 껍데기(두께 약 0.045)를 이만큼 안으로 당긴다

export function Model({ file, paint, clip, face = "default", overhead, held, door, ...props }: ModelProps & ThreeElements["group"]) {
  const gltf = useLoader(GLTFLoader, `/models/${file}.glb`);
  const scene = useMemo(() => {
    const copy = clone(gltf.scene); // 뼈대까지 따로 복제한다
    copy.getObjectByName("rig")?.position.set(0, 0, 0); // Blender에서 나란히 세워 둔 자리가 딸려 온다
    copy.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.castShadow = file !== "ghost"; // 유령은 그림자가 없다
      o.receiveShadow = true;
      const mine = toon(o.material as THREE.Material);
      mine.userData.base = mine.color.clone();
      mine.userData.glow = mine.emissiveIntensity;
      o.material = mine;
      if (mine.name === "Outline" && file.startsWith("house")) {
        // 껍데기의 법선은 안쪽을 본다
        const g = o.geometry.clone();
        const at = g.attributes.position;
        const n = g.attributes.normal;
        for (let i = 0; i < at.count; i++) at.setXYZ(i, at.getX(i) + n.getX(i) * THIN, at.getY(i) + n.getY(i) * THIN, at.getZ(i) + n.getZ(i) * THIN);
        o.geometry = g;
      }
    });
    return copy;
  }, [gltf, file]);
  useLayoutEffect(() => {
    scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const m = o.material as THREE.MeshStandardMaterial;
      m.color.copy(m.userData.base);
      m.emissiveIntensity = m.userData.glow;
      m.transparent = false;
      m.opacity = 1;
      paint?.(m.name, m);
    });
  });
  // 풍차 날개(blades 노드)는 천천히 돈다. 문짝은 door가 가리키는 만큼 열린다.
  const blades = useMemo(() => scene.getObjectByName("blades"), [scene]);
  const hinged = useMemo(() => (DOORS[file]?.swing ? hinge(scene) : undefined), [scene, file]);
  useFrame((_, dt) => {
    if (blades && !CALM) blades.rotation.z += dt * 0.7;
    if (hinged && door) hinged.rotation.y = -1.9 * door.current;
  });
  const mixer = useMemo(() => new THREE.AnimationMixer(scene), [scene]);
  const playing = useRef<THREE.AnimationAction | null>(null);
  const asked = useRef("");
  const wait = useRef(0);
  const shown = useRef<{ scene: THREE.Object3D; face: string } | null>(null);
  useFrame((_, dt) => {
    if (!clip) return;
    // 표정 노드는 face-<표정> 또는 face-<표정>-<캐릭터>
    const want = FACE[clip.current] ?? face;
    if (shown.current?.scene !== scene || shown.current.face !== want) {
      shown.current = { scene, face: want };
      scene.traverse((o) => {
        if (o.name.startsWith("face-")) o.visible = o.name === `face-${want}` || o.name.startsWith(`face-${want}-`);
      });
    }
    const requested = clip.current;
    const found = THREE.AnimationClip.findByName(gltf.animations, requested) ?? (requested === "cast" ? undefined : THREE.AnimationClip.findByName(gltf.animations, "cast"));
    if (!found) return;
    const next = mixer.clipAction(found);
    if (next !== playing.current || asked.current !== requested) {
      asked.current = requested;
      if (ONCE.has(found.name)) {
        next.setLoop(THREE.LoopOnce, 1);
        next.clampWhenFinished = true;
      } else {
        next.setLoop(THREE.LoopRepeat, Infinity);
        next.clampWhenFinished = false;
      }
      next.reset().fadeIn(0.15).play();
      playing.current?.fadeOut(0.15);
      playing.current = next;
    }
    wait.current += dt;
    if (wait.current < STEP) return;
    mixer.update(wait.current);
    wait.current = 0;
  });
  const top = useMemo(() => {
    let found: THREE.Object3D | undefined;
    scene.traverse((o) => {
      if (o.name.startsWith("overhead")) found = o;
    });
    return found;
  }, [scene]);
  const hand = useMemo(() => scene.getObjectByName("handR") ?? scene.getObjectByName("hand.R") ?? scene.getObjectByName("armR") ?? scene.getObjectByName("arm.R"), [scene]);
  return (
    <>
      <primitive object={scene} {...props} />
      {overhead && (top ? createPortal(overhead, top) : <group position={[0, 0.9, 0]}>{overhead}</group>)}
      {held && hand && createPortal(held, hand)}
    </>
  );
}

const GRAY = new THREE.Color("#7d7a76");
const SOOT = new THREE.Color("#3f3a36");

// 모델 파일이 없을 때(예: 저장소에 올리지 않는 캐릭터) 대신 보여 줄 것을 정한다
class Fallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// 누를 수 있는 대상에 붙이는 포인터 처리
function pickable(seat: Seat, onPick: (id: string) => void, setHover?: (on: boolean) => void) {
  return {
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      if (seat.enabled && !casting()) onPick(seat.id);
    },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      setHover?.(true);
      if (seat.enabled && !casting()) document.body.style.cursor = "pointer";
    },
    onPointerOut: () => {
      setHover?.(false);
      document.body.style.cursor = "";
    },
  };
}

// 지금 눌려 있는 키. 채팅을 치는 동안에는 받지 않는다.
function useKeys() {
  const keys = useRef(new Set<string>());
  useEffect(() => {
    const typing = () => {
      const el = document.activeElement;
      return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
    };
    const down = (e: KeyboardEvent) => {
      if (typing()) return;
      if (e.code.startsWith("Arrow")) e.preventDefault();
      keys.current.add(e.code);
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    const clear = () => keys.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, []);
  return keys;
}

// 카메라는 내 캐릭터를 따라다닌다. 오른쪽 버튼으로 끌면 돌려 보고, 휠로 당기고 민다.
// (왼쪽 버튼은 집과 캐릭터를 누르는 데 쓴다)
function Camera({ radius, controls, demo }: { radius: number; controls: RefObject<OrbitControls | null>; demo: boolean }) {
  const { camera, gl } = useThree();
  useEffect(() => {
    const made = new OrbitControls(camera, gl.domElement);
    made.enablePan = false;
    made.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    made.minPolarAngle = 0.35;
    made.maxPolarAngle = 1.3;
    made.minDistance = 5;
    camera.position.set(made.target.x, 14.5, made.target.z + 12.1); // 집에 가리지 않을 만큼 높게, 화면 위쪽에 먼 산이 걸릴 만큼 낮게
    if (demo) {
      // 메뉴 배경: 손은 못 대고 마을 둘레를 천천히 돈다
      made.enabled = false;
      made.autoRotate = !CALM;
      made.autoRotateSpeed = 0.5;
      camera.position.set(0, 9, radius + 9);
    }
    made.update();
    controls.current = made;
    return () => {
      controls.current = null;
      made.dispose();
    };
  }, [camera, gl, controls, demo, radius]);
  useEffect(() => {
    if (controls.current) controls.current.maxDistance = radius * 4;
  }, [radius, controls]);
  useFrame(() => {
    if (demo) controls.current?.update();
  });
  return null;
}

// 이름표. 글자를 2D 캔버스에 그려 텍스처로 쓴다 (한글도 시스템 글꼴로 나온다).
function Label({ title, status = "", y, size = 1 }: { title: string; status?: string; y: number; size?: number }) {
  // HUD와 같은 글꼴을 쓴다. 글꼴이 늦게 도착하면 그때 다시 그린다.
  const [loaded, setLoaded] = useState(false);
  const family = `${getComputedStyle(document.documentElement).getPropertyValue("--font-display") || "system-ui"}, system-ui, sans-serif`;
  useEffect(() => {
    let alive = true;
    document.fonts.load(`52px ${family}`, title + status).then(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [family, title, status]);
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 768;
    canvas.height = 160;
    const ctx = canvas.getContext("2d")!;
    ctx.textAlign = "center";
    // 굵은 먹색 외곽선을 두른 글자
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#2b2118";
    ctx.fillStyle = "#f4ecd2";
    const write = (text: string, px: number, yy: number) => {
      ctx.font = `${px}px ${family}`;
      ctx.lineWidth = px / 5;
      ctx.strokeText(text, 384, yy, 740);
      ctx.fillText(text, 384, yy, 740);
    };
    write(title, 54, status ? 64 : 100); // 한 줄이면 가운데에
    write(status, 34, 124);
    const made = new THREE.CanvasTexture(canvas);
    made.colorSpace = THREE.SRGBColorSpace;
    return made;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, status, family, loaded]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <sprite position={[0, y, 0]} scale={[0.26 * size, 0.054 * size, 1]} renderOrder={10}>
      <spriteMaterial map={texture} sizeAttenuation={false} depthTest={false} transparent />
    </sprite>
  );
}

// 낮과 밤 사이를 오간다. 바뀌는 동안에는 노을(새벽놀)을 거치고 해가 기울어 그림자가 길어진다.
const GLOW = { sky: new THREE.Color("#f3a57c"), sun: new THREE.Color("#ff9a55"), ambient: new THREE.Color("#ffd0ae") };
const HEMI = { day: [new THREE.Color("#cfe8ff"), new THREE.Color("#f0d9a8")], night: [new THREE.Color("#4a5fc0"), new THREE.Color("#2a2440")] };
function Atmosphere({ night }: { night: boolean }) {
  const ambient = useRef<THREE.AmbientLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const [color] = useState(() => new THREE.Color());
  useFrame((state) => {
    tick(night);
    const { night: p, glow } = sky;
    const mix = THREE.MathUtils.lerp;
    color.lerpColors(SKY.day, SKY.night, p).lerp(GLOW.sky, glow * 0.8);
    state.scene.background = color;
    if (!state.scene.fog) state.scene.fog = new THREE.Fog(color, 55, 170); // 먼 풀밭이 하늘색으로 스며든다
    (state.scene.fog as THREE.Fog).color.copy(color);
    if (ambient.current) {
      ambient.current.intensity = mix(0.35, 0.5, p);
      ambient.current.color.lerpColors(AMBIENT.day, AMBIENT.night, p).lerp(GLOW.ambient, glow * 0.6);
    }
    if (hemi.current) {
      // 위에서는 푸른 하늘빛, 아래에서는 따뜻한 땅빛: 그늘진 면이 푸르게, 밑면이 따뜻하게 돈다
      hemi.current.intensity = mix(0.9, 0.45, p);
      hemi.current.color.lerpColors(HEMI.day[0], HEMI.night[0], p);
      hemi.current.groundColor.lerpColors(HEMI.day[1], HEMI.night[1], p);
    }
    if (sun.current) {
      sun.current.intensity = mix(2.4, 0.7, p);
      sun.current.color.lerpColors(SUN.day, SUN.night, p).lerp(GLOW.sun, glow);
      sun.current.position.y = 22 - 13 * glow;
    }
  });
  return (
    <>
      <ambientLight ref={ambient} intensity={0.35} />
      <hemisphereLight ref={hemi} />
      <directionalLight
        ref={sun}
        position={[14, 22, 9]}
        intensity={1.8}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-28}
        shadow-camera-right={28}
        shadow-camera-top={28}
        shadow-camera-bottom={-28}
        shadow-camera-far={80}
        shadow-bias={-0.0005}
        shadow-normalBias={0.05} // 둥근 몸에 자기 그림자 줄무늬가 지지 않게
      />
    </>
  );
}

type Prop = { file: string; x: number; z: number; s: number; turn: number };

// 마을을 둘러싼 나무·덤불·바위. 자리는 번호로 정해 두어 매번 같은 마을이 되고, 물과 길은 피한다.
function scatter(radius: number, land: Plan): Prop[] {
  return Array.from({ length: 54 }, (_, i) => {
    const a = (i / 54) * Math.PI * 2 + 0.15 + (i % 5) * 0.02;
    const r = radius + 4 + ((i * 7) % 9) * 1.6;
    const file = ["tree", "pine", "tree", "bush", "pine", "rock", "tree"][i % 7];
    return { file, x: Math.sin(a) * r, z: Math.cos(a) * r, s: 0.85 + ((i * 3) % 5) * 0.12, turn: i * 1.7 };
  })
    .concat(border(radius + REACH))
    .filter((t) => !land.blocked(t.x, t.z));
}

// 마을 끝을 두르는 울타리와 그 뒤의 숲. 여기까지만 갈 수 있다는 것이 눈에 보이게 한다.
function border(limit: number): Prop[] {
  const ring = (r: number, gap: number, make: (i: number, a: number) => Omit<Prop, "x" | "z">) => {
    const count = Math.round((Math.PI * 2 * r) / gap);
    return Array.from({ length: count }, (_, i) => {
      const a = (i / count) * Math.PI * 2;
      return { ...make(i, a), x: Math.sin(a) * r, z: Math.cos(a) * r };
    });
  };
  return [
    ...ring(limit + 0.7, 1.66, (_, a) => ({ file: "fence", s: 1, turn: a })), // 울타리는 길이 1.63, 둘레를 따라 눕힌다
    ...ring(limit + 2.4, 2.3, (i) => ({ file: ["tree", "bush", "pine", "tree", "rock"][i % 5], s: 1 + ((i * 3) % 4) * 0.12, turn: i * 2.1 })),
  ];
}

function Scenery({ n, night, land, props }: { n: number; night: boolean; land: Plan; props: Prop[] }) {
  return (
    <>
      <Terrain n={n} p={land} night={night} />
      {/* 땅은 바로 그리고, 모델은 도착하는 대로 얹는다 */}
      <Suspense fallback={null}>
        <Campfire night={night} />
      </Suspense>
      <Suspense fallback={null}>
        {props.map((t, i) => (
          <group key={i} position={[t.x, 0, t.z]}>
            <Sway amount={t.file === "rock" || t.file === "fence" ? 0 : t.file === "bush" ? 0.02 : 0.035} phase={i * 1.3}>
              <Model file={t.file} scale={t.s} rotation-y={t.turn} />
            </Sway>
          </group>
        ))}
      </Suspense>
    </>
  );
}

// 집 모양마다 다른 값: 높이(이름표 자리), 반지름(부딪히는 범위), 굴뚝 꼭대기(없으면 연기도 없다)
type Shape = { h: number; r: number; smoke?: readonly [number, number, number] };
const SHAPES: Record<string, Shape> = {
  house: { h: 2.73, r: 1.4, smoke: [0.62, 2.8, -0.45] },
  "house-1": { h: 3.05, r: 1.5, smoke: [0.72, 3.0, -0.45] },
  "house-2": { h: 3.47, r: 1.55, smoke: [0.63, 3.4, -0.6] },
  "house-3": { h: 3.36, r: 1.6 },
  "house-4": { h: 3.32, r: 1.55, smoke: [0.87, 3.3, -0.5] },
  "house-5": { h: 4.15, r: 1.35 },
  "house-6": { h: 4.03, r: 1.55 },
  "house-7": { h: 2.84, r: 1.45 },
  "house-8": { h: 3.7, r: 1.4 },
};
const shapeOf = (house: string) => SHAPES[house] ?? SHAPES.house;

// 선택을 마친 집 위에 뜨는 노란 체크 딱지
let doneTexture: THREE.CanvasTexture | undefined;
function Done({ y }: { y: number }) {
  const texture = (doneTexture ??= (() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.lineWidth = 10;
    ctx.strokeStyle = "#2b2118";
    ctx.fillStyle = "#ffc93c";
    ctx.beginPath();
    ctx.arc(64, 64, 54, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 14;
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(38, 68);
    ctx.lineTo(57, 86);
    ctx.lineTo(90, 44);
    ctx.stroke();
    const made = new THREE.CanvasTexture(canvas);
    made.colorSpace = THREE.SRGBColorSpace;
    return made;
  })());
  return (
    <Pop>
      {/* 이름표와 같은 자리에서 화면상 바로 위로 올려, 어느 각도에서도 이름을 가리지 않는다 */}
      <sprite position={[0, y, 0]} center={[0.5, -0.45]} scale={0.045} renderOrder={11}>
        <spriteMaterial map={texture} sizeAttenuation={false} depthTest={false} transparent />
      </sprite>
    </Pop>
  );
}

function House({ seat, color, spot, night, wait, burnt = false, heldTools = true, onPick }: { seat: Seat; color: string; spot: Spot; night: boolean; wait: number; burnt?: boolean; heldTools?: boolean; onPick: (id: string) => void }) {
  const [hover, setHover] = useState(false);
  // 창문 불은 주인이 들어간 뒤에 켜지고, 아침에는 나오기 전에 꺼진다
  const [home, setHome] = useState(night);
  const lit = home && seat.alive;
  const door = useRef(0);
  useFrame(() => {
    if (indoors(night, wait) !== home) setHome(!home);
    const open = seat.alive ? doorOpen(wait) : 0;
    // 내 집 문소리는 또렷하게, 남의 집은 멀리서 들리듯 작게
    if (open > 0.05 && door.current <= 0.05) play("door", seat.isMe ? 0.8 : 0.2);
    if (open < 0.5 && door.current >= 0.5) play("doorShut", seat.isMe ? 0.8 : 0.2);
    door.current = open;
  });
  // 설치해 둔 폭탄이 사라지는 순간(터뜨린 다음 날 아침) 폭발을 보여 준다
  const hadBomb = useRef(seat.bombed);
  const [booms, setBooms] = useState(0);
  useEffect(() => {
    if (hadBomb.current && !seat.bombed && !burnt) setBooms((n) => n + 1);
    hadBomb.current = seat.bombed;
  }, [seat.bombed, burnt]);
  const shape = shapeOf(seat.house);
  const paint: Paint = (name, m) => {
    if (name === "Outline") return; // 외곽선 껍데기는 늘 먹색
    if (name === "Roof") m.color.set(color);
    if (name === "Window") {
      m.emissive.set("#ffc94d");
      m.emissiveIntensity = lit ? 1.8 : 0;
      if (lit) m.color.set("#ffe9a3");
    }
    if (!seat.alive) m.color.lerp(GRAY, 0.75); // 주인이 죽은 집은 빛이 바랜다
    if (burnt) {
      m.color.lerp(SOOT, name === "Roof" ? 0.7 : 0.55);
      if (name === "Window") m.emissiveIntensity *= 0.15;
    }
  };
  const model = (file: string) => (
    <Model file={file} scale={hover && seat.enabled ? 1.05 : 1} {...pickable(seat, onPick, setHover)} paint={paint} door={door} />
  );
  return (
    <group position={spot.house} rotation-y={spot.angle + Math.PI}>
      {/* 집 모델이 늦게 와도 이름표와 표시는 먼저 보인다 */}
      <Suspense fallback={null}>
        <Fallback key={seat.house} fallback={model("house")}>
          {model(seat.house)}
        </Fallback>
        <Doorway house={seat.house} open={door} />
        {!seat.alive && (
          <Pop>
            <Model file="grave" position={[1.75, 0, 1.9]} rotation={[0, 0.3, lean(seat.id)]} />
          </Pop>
        )}
      </Suspense>
      {seat.mark && <Ring key={seat.mark} color={MARK[seat.mark]} />}
      {seat.effect && <AbilityEffect kind={seat.effect} h={shape.h} door={DOORS[seat.house]?.z} held={heldTools && seat.effect === "cleaner"} />}
      {burnt && <Burning h={shape.h} flames={false} />}
      {seat.effect && seat.effect !== "kill" && seat.effect !== "detonate" && <RoleIcon role={seat.effect} y={shape.h + 2.9} size={0.85} />}
      {booms > 0 && <Burst key={booms} />}
      {seat.alive && shape.smoke && <Smoke at={shape.smoke} />}
      {seat.done && <Done y={shape.h + 0.75} />}
      {seat.bombed && (
        <group position={[-1.5, 0, 1.5]}>
          <Bomb hot={seat.effect === "detonate"} />
        </group>
      )}
      {seat.marked && (
        <group position={[1.5, 0, 1.5]}>
          <Candle />
        </group>
      )}
      {seat.name && <Label title={`${seat.mayor ? "시장 " : ""}${seat.name}${seat.isMe ? " (나)" : ""}`} status={seat.status} y={shape.h + 0.75} />}
      {/* 캐릭터가 안 보이는 사람(밤의 남, 죽은 사람)의 말은 집 위에 뜬다 */}
      {!(seat.isMe || (seat.alive && (!night || seat.ally))) && <Bubble id={seat.id} y={shape.h + 1.15} />}
    </group>
  );
}

const TINT = new THREE.Color();

// 캐릭터의 생김새. ghost면 죽은 뒤의 내 모습(나에게만 보인다)인 유령을 그린다.
export function Body({ seat, color, clip, ghost = false, held }: { seat: Seat; color: string; clip: RefObject<string>; ghost?: boolean; held?: ReactNode }) {
  if (ghost)
    return (
      <>
        <Suspense fallback={null}>
          <Model
            file="ghost"
            clip={clip}
            paint={(name, m) => {
              if (name === "Body") m.color.lerp(TINT.set(color), 0.25); // 누구의 유령인지 알 수 있게 옅게 물들인다
              m.transparent = true;
              m.opacity = 0.8;
            }}
          />
        </Suspense>
        {seat.name && <Label title={seat.name} y={1.45} size={0.75} />}
        <Bubble id={seat.id} y={1.8} />
      </>
    );
  // 기본 캐릭터는 몸을 플레이어 색으로 칠한다
  // 머리 위: 시장은 왕관, 아니면 고른 모자
  const top = seat.mayor ? "crown" : seat.hat !== "none" ? `hat-${seat.hat}` : null;
  const crown = top && (
    <Suspense fallback={null}>
      <Pop key={top}>
        {/* 모자는 기본 캐릭터 머리에 맞춘 크기라 머리가 작은 스킨에서는 줄인다 */}
        <Model file={top} scale={seat.skin === "blob" || seat.mayor ? 1 : 0.8} />
      </Pop>
    </Suspense>
  );
  const look = { clip, overhead: crown, held, face: !seat.alive ? "dead" : seat.won ? "happy" : "default" };
  const blob = (
    <Model
      file="character-2"
      {...look}
      paint={(name, m) => {
        if (name === "Body") m.color.set(color);
      }}
    />
  );
  return (
    <>
      {/* 캐릭터 모델이 늦게 와도 이름표는 먼저 보인다 */}
      <Suspense fallback={null}>
        {/* 발이 길과 광장의 덧칠(땅보다 조금 높다)에 묻히지 않게 살짝 띄운다 */}
        <group position-y={0.13}>
          {seat.skin === "blob" ? (
            blob
          ) : (
            <Fallback key={seat.skin} fallback={blob}>
              <Model file={`skins/${seat.skin}`} {...look} />
            </Fallback>
          )}
        </group>
      </Suspense>
      {seat.name && <Label title={seat.name} y={1.45} size={0.75} />}
      <Bubble id={seat.id} y={1.8} />
    </>
  );
}

// 가까운 쪽으로 돌아서 부드럽게 방향을 바꾼다
function turnTo(g: THREE.Group, angle: number, k: number) {
  const d = angle - g.rotation.y;
  g.rotation.y += Math.atan2(Math.sin(d), Math.cos(d)) * k;
}

// (x, z)를 향해 걸어간다. 걷는 중이면 true.
function walk(g: THREE.Group, x: number, z: number, dt: number, quick: number) {
  const dx = x - g.position.x;
  const dz = z - g.position.z;
  const moving = Math.hypot(dx, dz) > 0.08;
  const k = 1 - Math.exp(-dt * quick);
  g.position.x += dx * k;
  g.position.z += dz * k;
  if (moving) turnTo(g, Math.atan2(dx, dz), Math.min(1, dt * 10));
  return moving;
}

function samePoint(a: THREE.Vector3, b: THREE.Vector3) {
  return Math.hypot(a.x - b.x, a.z - b.z) < 0.04;
}

// 캐릭터가 가만히 있을 때의 동작을 고른다.
// 끼어드는 한 번짜리 동작(투표, 놀람, 문 두드리기, 능력) > 결과의 환호·낙담 > 가끔 두리번거리기 > 대기
type Act = { name: string; until: number; done: boolean; shock: number; fidget: number };
const newAct = (seat: Seat, shock: number): Act => ({ name: "", until: -1, done: seat.done, shock, fidget: -1 });
function cut(a: Act, name: string, t: number, secs: number) {
  a.name = name;
  a.until = t + secs;
}
function acting(a: Act, seat: Seat, shock: number, sad: boolean, t: number, moving: boolean, night: boolean) {
  if (seat.done && !a.done && !night) cut(a, "vote", t, 1.4); // 표를 던진 순간
  if (shock > a.shock && seat.alive && !night) cut(a, "startle", t, 1.2); // 밤사이 누가 죽었다
  a.done = seat.done;
  a.shock = shock;
  if (moving) {
    a.until = a.fidget = -1;
    return night ? "sneak" : "walk";
  }
  if (t < a.until) return a.name;
  if (seat.won) return "cheer";
  if (sad) return "sad";
  if (a.fidget < 0) a.fidget = t + 5 + ((seat.id.charCodeAt(0) + t * 7) % 9); // 사람마다 다른 때에
  if (t > a.fidget && !CALM) {
    const peek = Math.floor(t) % 2 === 0;
    cut(a, peek ? "peek" : "turn", t, peek ? 2 : 1.2);
    a.fidget = -1;
    return a.name;
  }
  return "idle";
}

const DYING = 1.5; // 쓰러지는 연출의 길이(초). die 동작(1초)이 끝나고 잠깐 누워 있는다.

// 죽는 순간을 알아챈다. 0~1은 연출 중, 1 이상은 끝남.
function useDeath(alive: boolean) {
  const was = useRef(alive);
  const at = useRef(-1);
  return (t: number) => {
    const just = was.current && !alive;
    if (just) at.current = t;
    was.current = alive;
    return { just, progress: at.current < 0 ? 2 : (t - at.current) / DYING };
  };
}

// 죽은 자리에서 퍼지는 연기
function Puff({ group }: { group: RefObject<THREE.Group | null> }) {
  return (
    <group ref={group} visible={false}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <mesh key={i}>
          <sphereGeometry args={[1, 8, 6]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.85} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

function spread(puff: THREE.Group | null, progress: number) {
  if (!puff) return;
  puff.visible = progress < 1.5;
  puff.children.forEach((ball, i) => {
    const a = (i / 6) * Math.PI * 2;
    ball.position.set(Math.cos(a) * progress * 0.8, 0.3 + progress * 0.5, Math.sin(a) * progress * 0.8);
    ball.scale.setScalar(Math.max(0.01, 0.28 * (1 - progress / 1.5)));
  });
}

type VillagerProps = {
  start?: THREE.Vector3; // 처음 나타날 자리 (없으면 to)
  seat: Seat;
  color: string;
  to: THREE.Vector3;
  spot: Spot;
  wait: number; // 귀가·기상 연출에서 이 사람이 늦는 시간
  visible: boolean;
  land: Plan;
  positions: RefObject<Positions>;
  night: boolean;
  shock: number; // 지금까지 죽은 사람 수. 낮에 늘어나면 놀란다.
  sad: boolean; // 판이 끝났는데 졌다
  bodies: RefObject<Map<string, THREE.Vector3>>; // 지금 화면에 서 있는 캐릭터들의 자리 (서로 부딪히는 데 쓴다)
  onPick: (id: string) => void;
};

// 다른 플레이어. 위치를 보내 왔으면 거기로, 아니면 제자리(to)로 간다.
function Villager({ seat, color, to, start, spot, wait, visible, land, positions, night, shock, sad, bodies, onPick }: VillagerProps) {
  const ref = useRef<THREE.Group>(null);
  const clip = useRef("idle");
  const bed = useRef({ at: turn.at, from: new THREE.Vector3(), quiet: false });
  const act = useRef(newAct(seat, shock));
  const puff = useRef<THREE.Group>(null);
  const death = useDeath(seat.alive);
  const [gone, setGone] = useState(!seat.alive); // 쓰러지는 연출이 끝나면 유령이다 (죽은 사람 눈에만 보인다)
  useLayoutEffect(() => {
    ref.current?.position.set((start ?? to).x, 0, (start ?? to).z);
    const all = bodies.current;
    return () => void all.delete(seat.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useFrame((state, dt) => {
    const g = ref.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    const { just, progress } = death(t);
    const b = bed.current;
    if (gone !== (!seat.alive && (progress >= 1 || b.quiet))) setGone(!gone);
    if (seat.alive) b.quiet = false;
    else if (just && turn.cast && !turn.night) b.quiet = true; // 밤사이 죽은 사람은 아침에 집에서 나오지 않는다 (묘비만 선다)
    if (just) puff.current?.position.copy(g.position);
    if (!b.quiet) spread(puff.current, progress);
    // 보이지 않는 사람(밤의 남들, 죽은 사람)과는 부딪히지 않는다. 부딪히면 어디 있는지 들킨다.
    if (visible && seat.alive) bodies.current.set(seat.id, g.position);
    else bodies.current.delete(seat.id);
    if (b.at !== turn.at) {
      b.at = turn.at;
      b.from.copy(g.position);
    }
    const show = seat.alive ? bedtime(g, spot, b.from, wait, dt) : null;
    if (show) {
      // 해 질 녘에는 하품하고 집으로, 새벽에는 집에서 나와 기지개
      if (show === "yawn" && clip.current !== "yawn") play("yawn", 0.25);
      clip.current = show;
      g.position.y = lift(land, g.position.x, g.position.z);
      return;
    }
    if (progress < 1 && !b.quiet) {
      // 쓰러졌다가 사라진다
      g.visible = true;
      clip.current = "die";
      return;
    }
    g.visible = visible;
    const live = positions.current.get(seat.id);
    const moving = walk(g, live?.x ?? to.x, live?.z ?? to.z, dt, live ? 10 : 2.5);
    clip.current = seat.alive ? acting(act.current, seat, shock, sad, t, moving, night) : moving ? "walk" : "idle";
    g.position.y = lift(land, g.position.x, g.position.z);
  });
  return (
    <>
      <group ref={ref} {...pickable(seat, onPick)}>
        <Body seat={seat} color={color} clip={clip} ghost={gone} />
      </group>
      <Puff group={puff} />
    </>
  );
}

type MeProps = {
  start?: THREE.Vector3;
  seat: Seat;
  color: string;
  to: THREE.Vector3;
  spot: Spot;
  wait: number;
  limit: number;
  acting: boolean; // 오늘 밤 누군가의 집을 골랐다
  night: boolean;
  shock: number;
  sad: boolean;
  iconRole: string | null;
  shield: boolean;
  actKind: string | null;
  heldTools: boolean;
  land: Plan;
  collide: (position: THREE.Vector3, solid: boolean) => void; // 건물·나무·물·다른 캐릭터에 겹치지 않게 밀어낸다
  controls: RefObject<OrbitControls | null>;
  onActStart: () => void;
  onMove: (x: number, z: number) => void;
};

// 내 캐릭터. WASD나 방향키로 직접 움직이고, 페이즈가 바뀌거나 집을 고르면 그리로 알아서 걸어간다.
function Me({ seat, color, to, start, spot, wait, limit, acting: visiting, night, shock, sad, iconRole, shield, actKind, heldTools, land, collide, controls, onActStart, onMove }: MeProps) {
  const ref = useRef<THREE.Group>(null);
  const bed = useRef({ at: turn.at, from: new THREE.Vector3() });
  const puff = useRef<THREE.Group>(null);
  const keys = useKeys();
  const manual = useRef(false);
  const lastTo = useRef(to.clone());
  const clip = useRef("idle");
  const act = useRef(newAct(seat, shock));
  const knock = useRef({ cast: -1, done: new THREE.Vector3(Infinity, 0, Infinity), act: null as string | null }); // 고른 집에 도착하면 문을 두드리고, 능력이면 이어서 몸짓을 한다
  const pace = useRef(0); // 다음 발소리가 날 시각
  const sent = useRef({ x: Infinity, z: Infinity, t: 0 }); // 마지막으로 보낸 위치
  const death = useDeath(seat.alive);
  const [gone, setGone] = useState(!seat.alive);
  const held = useRef<string | null>(null);
  const [heldKind, setHeldKind] = useState<string | null>(null);
  const showHeld = (kind: string | null) => {
    const next = heldTools && kind === "cleaner" ? kind : null;
    if (held.current === next) return;
    held.current = next;
    setHeldKind(next);
  };
  const startAct = (kind: string, t: number) => {
    knock.current.act = kind;
    knock.current.cast = -1;
    cut(act.current, actClip(kind), t, actSecs(kind));
    showHeld(kind);
    onActStart();
  };
  useLayoutEffect(() => {
    ref.current?.position.set((start ?? to).x, 0, (start ?? to).z);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useFrame((state, dt) => {
    const g = ref.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    const { just, progress } = death(t);
    if (just) puff.current?.position.copy(g.position);
    spread(puff.current, progress);

    if (!samePoint(lastTo.current, to)) {
      lastTo.current.copy(to);
      manual.current = false; // 새 목적지가 생기면 다시 알아서 걷는다
    }
    const k = keys.current;
    const ahead = +(k.has("KeyW") || k.has("ArrowUp")) - +(k.has("KeyS") || k.has("ArrowDown"));
    const side = +(k.has("KeyD") || k.has("ArrowRight")) - +(k.has("KeyA") || k.has("ArrowLeft"));
    let moving = false;
    if (bed.current.at !== turn.at) {
      bed.current.at = turn.at;
      bed.current.from.copy(g.position);
    }
    // 해 질 녘·새벽 연출 중에는 직접 걷지 못한다 (집은 누를 수 있다)
    const show = seat.alive && progress >= 1 ? bedtime(g, spot, bed.current.from, wait, dt) : null;
    if (!show) g.visible = true;
    if (progress < 1) {
      // 죽는 순간: 쓰러졌다가 유령이 되어 떠오른다
    } else if (show) {
      if (show === "yawn" && clip.current !== "yawn") play("yawn", 0.6);
      manual.current = false;
      moving = show === "walk";
    } else if (ahead || side) {
      manual.current = true;
      // 카메라가 보는 방향을 기준으로 움직인다
      state.camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      right.crossVectors(forward, UP);
      const dx = forward.x * ahead + right.x * side;
      const dz = forward.z * ahead + right.z * side;
      const len = Math.hypot(dx, dz) || 1;
      let sx = (dx / len) * SPEED * dt;
      let sz = (dz / len) * SPEED * dt;
      // 마을 끝에 가까워지면 바깥으로 나가는 걸음만 점점 느려진다 (울타리를 따라 걷는 것은 그대로)
      const from = Math.hypot(g.position.x, g.position.z) || 1;
      const out = (sx * g.position.x + sz * g.position.z) / from;
      if (out > 0) {
        const cut = out * (1 - THREE.MathUtils.clamp((limit - from) / EDGE, 0, 1));
        sx -= (g.position.x / from) * cut;
        sz -= (g.position.z / from) * cut;
      }
      g.position.x += sx;
      g.position.z += sz;
      const far = Math.hypot(g.position.x, g.position.z);
      if (far > limit) {
        g.position.x *= limit / far;
        g.position.z *= limit / far;
      }
      collide(g.position, seat.alive);
      turnTo(g, Math.atan2(dx, dz), Math.min(1, dt * 12));
      moving = true;
    } else if (!manual.current) {
      moving = walk(g, to.x, to.z, dt, 2.5);
      collide(g.position, seat.alive); // 알아서 걸을 때도 건물과 사람을 돌아서 간다
      if (!moving && visiting && !samePoint(knock.current.done, to)) {
        knock.current.done.copy(to);
        if (actKind) startAct(actKind, t);
        else {
          knock.current.act = null;
          knock.current.cast = -1;
          cut(act.current, "knock", t, 1.1);
          play("knock");
        }
      }
    }
    const arrived = knock.current;
    if (moving) {
      arrived.cast = -1;
      showHeld(null);
    }
    if (!actKind) {
      arrived.act = null;
      arrived.cast = -1;
      showHeld(null);
    } else if (!moving && arrived.act !== actKind && (!visiting || samePoint(g.position, to))) {
      startAct(actKind, t);
    }
    if (arrived.cast > 0 && t > arrived.cast) {
      arrived.cast = -1;
      if (actKind) startAct(actKind, t); // 능력을 쓴다
    }
    const calm = show ?? acting(act.current, seat, shock, sad, t, moving, night);
    clip.current = progress < 1 ? "die" : !seat.alive ? (moving ? "walk" : "idle") : calm; // 죽은 뒤는 유령의 동작
    if (held.current && (moving || t >= act.current.until || act.current.name !== actClip(actKind))) showHeld(null);
    if (gone !== (!seat.alive && progress >= 1)) setGone(!gone); // 쓰러지는 연출이 끝나면 유령으로 바뀐다
    g.position.y = lift(land, g.position.x, g.position.z);
    if (moving && seat.alive && g.visible && t > pace.current) {
      // 걷기 클립 한 바퀴(0.5초, 살금살금 0.83초)에 두 걸음. 박자는 거의 일정하게, 변주는 소리 쪽에서 한다.
      pace.current = t + (night ? 0.417 : 0.25) * (0.95 + Math.random() * 0.1);
      night ? play("step", 0.45, 0.9) : play("step"); // 밤에는 작고 조금 낮게
    }

    const c = controls.current;
    if (c) {
      // 캐릭터에 못 박지 않고 부드럽게 뒤따른다 (방향을 꺾을 때 화면이 덜컥거리지 않게)
      shift.set(g.position.x - c.target.x, 0, g.position.z - c.target.z).multiplyScalar(1 - Math.exp(-dt * 5));
      state.camera.position.add(shift);
      c.target.add(shift);
      c.update();
    }
    if (t - sent.current.t > 0.1 && Math.hypot(g.position.x - sent.current.x, g.position.z - sent.current.z) > 0.02) {
      sent.current = { x: g.position.x, z: g.position.z, t };
      onMove(g.position.x, g.position.z);
    }
  });
  return (
    <>
      <group ref={ref}>
        <Body seat={seat} color={color} clip={clip} ghost={gone} held={heldKind === "cleaner" ? <HeldBroom /> : null} />
        {iconRole && <RoleIcon role={iconRole} y={2} />}
        {shield && <Shield />}
      </group>
      <Puff group={puff} />
    </>
  );
}

export default function Village({ seats, scene, going, iconRole, shield, actKind = null, standKind = null, positions, demo = false, hud = true, heldTools = true, replay = null, onReplayEnd, call = null, onCallEnd, exile = null, onExileEnd, unseen = [], burnt = [], onSeen, onPick, onMove }: Props) {
  const n = seats.length;
  const spots = useMemo(() => layout(n), [n]);
  const [beat, setBeat] = useState(-1); // 회상·발표의 화면 아래 글이 어디까지 넘어갔나
  useEffect(() => setBeat(-1), [replay, call, exile]);
  const [actReady, setActReady] = useState(false);
  useEffect(() => setActReady(false), [scene, going, actKind, standKind]);
  // 추방 장면이 끝나면 사람들은 장면의 마지막 자리(물러선 광장)에서 이어받아, 거기서부터 집으로 돌아간다
  const scattered = useRef(false);
  if (exile) scattered.current = true;
  useEffect(() => {
    if (!exile) scattered.current = false;
  });
  const night = scene === "night" || (!!replay && !CALM);
  useTurn(night ? "night" : scene, !demo); // 회상이 도는 동안은 아직 밤이다. 끝나면 아침이 온다.
  const dark = useDark(night); // 모닥불 불빛과 화면 가장자리 그늘은 하늘이 반쯤 넘어갔을 때 바뀐다
  const radius = ringRadius(n);
  const goingIndex = seats.findIndex((s) => s.id === going);
  const goingTo = spots[goingIndex];
  const controls = useRef<OrbitControls | null>(null);
  const bodies = useRef(new Map<string, THREE.Vector3>());
  const land = useMemo(() => plan(n, radius), [n, radius]);
  const props = useMemo(() => scatter(radius, land), [radius, land]);
  const shock = seats.filter((s) => !s.alive).length;
  const houses = seats.map((s) => s.house).join(","); // 집 모양이 바뀔 때만 충돌 범위를 다시 잡는다
  // 지나갈 수 없는 것들: 집, 모닥불, 나무와 바위 (덤불은 헤치고 지나간다)
  const collide = useMemo(() => {
    const solids: Circle[] = [
      ...spots.map((spot, i) => ({ x: spot.house.x, z: spot.house.z, r: shapeOf(houses.split(",")[i]).r })),
      { x: 0, z: 0, r: 0.55 },
      ...props.filter((t) => t.file !== "bush").map((t) => ({ x: t.x, z: t.z, r: (t.file === "rock" ? 0.5 : 0.32) * t.s })),
    ];
    const terrain = collider(land, solids);
    // 살아 있는 내 캐릭터는 다른 캐릭터와도 겹치지 않는다 (유령은 사람을 통과한다)
    return (position: THREE.Vector3, solid: boolean) => {
      if (solid) {
        for (const other of bodies.current.values()) {
          const dx = position.x - other.x;
          const dz = position.z - other.z;
          const d = Math.hypot(dx, dz);
          if (d >= 0.6 || d < 1e-4) continue;
          position.x = other.x + (dx / d) * 0.6;
          position.z = other.z + (dz / d) * 0.6;
        }
      }
      terrain(position);
    };
  }, [land, props, spots, houses]);

  // 페이즈가 바뀌면 모두 제자리로 돌아가므로 받아 둔 위치는 버린다
  useEffect(() => {
    positions.current.clear();
  }, [scene, positions]);

  return (
    <>
    <Canvas shadows camera={{ fov: 45 }} dpr={[1, 2]} aria-label="마을" onContextMenu={(e) => e.preventDefault()}>
      <Camera radius={radius} controls={controls} demo={demo} />
      <Atmosphere night={night} />
      <Post night={night} />
      <Scenery n={n} night={dark} land={land} props={props} />
      {seats.map((seat, i) => {
        const hidden = night && !!actKind && seat.id === going && !!seat.effect && !actReady;
        const shown = { ...seat, ...(unseen.includes(seat.id) ? { alive: true } : {}), ...(hidden ? { effect: null } : {}) };
        return <House key={seat.id} seat={shown} color={COLORS[i % COLORS.length]} spot={spots[i]} night={night} wait={late(i)} burnt={burnt.includes(seat.id) && !unseen.includes(seat.id)} heldTools={heldTools} onPick={onPick} />;
      })}
      {replay && (
        <Replay
          flash={replay}
          seats={seats}
          spots={spots}
          sizes={seats.map((s) => shapeOf(s.house).r)}
          heights={seats.map((s) => shapeOf(s.house).h)}
          doors={seats.map((s) => DOORS[s.house]?.z ?? 1.09)}
          land={land}
          calm={CALM}
          controls={controls}
          onBeat={setBeat}
          onEnd={() => onReplayEnd?.()}
        />
      )}
      {exile && (
        <Replay
          exile={exile}
          seats={seats}
          spots={spots}
          sizes={seats.map((s) => shapeOf(s.house).r)}
          heights={seats.map((s) => shapeOf(s.house).h)}
          doors={seats.map((s) => DOORS[s.house]?.z ?? 1.09)}
          land={land}
          calm={CALM}
          controls={controls}
          onBeat={setBeat}
          onMark={onSeen}
          onEnd={() => onExileEnd?.()}
        />
      )}
      {!replay && !exile && call && (
        <Replay
          call={call.events}
          seats={seats}
          spots={spots}
          sizes={seats.map((s) => shapeOf(s.house).r)}
          heights={seats.map((s) => shapeOf(s.house).h)}
          doors={seats.map((s) => DOORS[s.house]?.z ?? 1.09)}
          land={land}
          calm={CALM}
          controls={controls}
          onBeat={setBeat}
          onMark={onSeen}
          onEnd={() => onCallEnd?.()}
        />
      )}
      {!replay && !call && !exile && seats.map((seat, i) => {
        const color = COLORS[i % COLORS.length];
        // 밤에는 집 앞(내가 고른 집이 있으면 그 집 앞), 낮에는 광장에 모인다
        const home = scene === "lobby" || night ? spots[i].door : spots[i].plaza;
        if (seat.isMe) {
          const targetHouse = goingIndex >= 0 ? seats[goingIndex].house : seat.house;
          const to = night && goingTo ? actStand(standKind ?? actKind, goingTo, targetHouse) : home;
          return (
            <Me
              start={scattered.current ? spots[i].plaza.clone().multiplyScalar(1.4) : undefined}
              key={seat.id}
              seat={seat}
              color={color}
              to={to}
              spot={spots[i]}
              wait={late(i)}
              limit={radius + REACH}
              acting={night && !!goingTo}
              night={night}
              shock={shock}
              sad={scene === "ended" && !seat.won}
              iconRole={iconRole}
              shield={shield}
              actKind={actKind}
              heldTools={heldTools}
              land={land}
              collide={collide}
              controls={controls}
              onActStart={() => setActReady(true)}
              onMove={onMove}
            />
          );
        }
        // 밤에 남들이 어디 있는지는 알 수 없다
        // 유령끼리는 서로 보인다
        const visible = seat.alive ? !night || seat.ally : !seats.find((s) => s.isMe)?.alive;
        return <Villager key={seat.id} start={scattered.current ? spots[i].plaza.clone().multiplyScalar(1.4) : undefined} seat={seat} color={color} to={home} spot={spots[i]} wait={late(i)} visible={visible} land={land} positions={positions} night={night} shock={shock} sad={scene === "ended" && !seat.won} bodies={bodies} onPick={onPick} />;
      })}
    </Canvas>
    <Veil night={dark} />
    {hud && (replay || call || exile) && <ReplayHud flash={replay} call={call} exile={exile} seats={seats} beat={beat} calm={CALM} />}
    </>
  );
}
