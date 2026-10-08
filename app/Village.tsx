"use client";

// 3D 마을. 서버가 준 상태(좌석 목록)를 그리고, 집이나 캐릭터를 누르면 onPick을 부를 뿐 게임 규칙은 모른다.
// ponytail: 집과 캐릭터는 기본 도형. Blender 모델이 생기면 House와 Body 안쪽만 useGLTF로 바꾸면 된다.
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { COLORS } from "./colors";

export type Scene = "lobby" | "night" | "day" | "ended";
export type Positions = Map<string, { x: number; z: number }>;

export interface Seat {
  id: string;
  name: string;
  alive: boolean;
  isMe: boolean;
  ally: boolean;
  mayor: boolean;
  enabled: boolean; // 지금 누를 수 있는가
  mark: "kill" | "aim" | "vote" | null; // 내가 고른 대상 표시
  status: string;
  bombed: boolean;
  marked: boolean;
  won: boolean;
}

interface Props {
  seats: Seat[];
  scene: Scene;
  going: string | null; // 오늘 밤 내가 찾아가는 집
  positions: RefObject<Positions>; // 다른 플레이어들이 보내 온 위치
  onPick: (id: string) => void;
  onMove: (x: number, z: number) => void;
}

const MARK = { kill: "#ef4444", aim: "#60a5fa", vote: "#facc15" };
const SKY = { day: new THREE.Color("#8ecae6"), night: new THREE.Color("#0b1026") };
const SUN = { day: new THREE.Color("#fff4d6"), night: new THREE.Color("#8fa8ff") };
const SPEED = 5; // 초당 이동 거리
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

// 누를 수 있는 대상에 붙이는 포인터 처리
function pickable(seat: Seat, onPick: (id: string) => void, setHover?: (on: boolean) => void) {
  return {
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      if (seat.enabled) onPick(seat.id);
    },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      setHover?.(true);
      if (seat.enabled) document.body.style.cursor = "pointer";
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
function Camera({ radius, controls }: { radius: number; controls: RefObject<OrbitControls | null> }) {
  const { camera, gl } = useThree();
  useEffect(() => {
    const made = new OrbitControls(camera, gl.domElement);
    made.enablePan = false;
    made.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    made.minPolarAngle = 0.35;
    made.maxPolarAngle = 1.3;
    made.minDistance = 5;
    camera.position.set(made.target.x, 16, made.target.z + 10); // 집에 가리지 않게 높이서 내려다본다
    made.update();
    controls.current = made;
    return () => {
      controls.current = null;
      made.dispose();
    };
  }, [camera, gl, controls]);
  useEffect(() => {
    if (controls.current) controls.current.maxDistance = radius * 4;
  }, [radius, controls]);
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

// 낮과 밤 사이를 부드럽게 오간다
function Atmosphere({ night }: { night: boolean }) {
  const ambient = useRef<THREE.AmbientLight>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const [sky] = useState(() => SKY[night ? "night" : "day"].clone());
  useFrame((state, dt) => {
    const k = 1 - Math.exp(-dt * 3);
    const time = night ? "night" : "day";
    sky.lerp(SKY[time], k);
    state.scene.background = sky;
    if (ambient.current) ambient.current.intensity += ((night ? 0.65 : 1) - ambient.current.intensity) * k;
    if (sun.current) {
      sun.current.intensity += ((night ? 0.5 : 1.8) - sun.current.intensity) * k;
      sun.current.color.lerp(SUN[time], k);
    }
  });
  return (
    <>
      <ambientLight ref={ambient} intensity={1} />
      <directionalLight ref={sun} position={[6, 12, 4]} intensity={1.8} />
    </>
  );
}

function Scenery({ n, night }: { n: number; night: boolean }) {
  const radius = ringRadius(n);
  const trees = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => {
        const a = (i / 18) * Math.PI * 2 + 0.2;
        const r = radius + 4.5 + (i % 3) * 1.2;
        return { x: Math.sin(a) * r, z: Math.cos(a) * r, s: 0.8 + (i % 4) * 0.15 };
      }),
    [radius],
  );
  return (
    <>
      <mesh rotation-x={-Math.PI / 2}>
        <circleGeometry args={[radius + 30, 64]} />
        <meshStandardMaterial color="#5a9e4b" />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[2.6 + n * 0.14, 32]} />
        <meshStandardMaterial color="#c9b79c" />
      </mesh>
      {/* 광장의 모닥불 */}
      <mesh position={[0, 0.25, 0]}>
        <coneGeometry args={[0.3, 0.5, 6]} />
        <meshStandardMaterial color="#ff8a3d" emissive="#ff6a00" emissiveIntensity={night ? 2 : 0.4} />
      </mesh>
      <pointLight position={[0, 1, 0]} color="#ff9a4d" intensity={night ? 12 : 0} distance={9} />
      {trees.map((t, i) => (
        <group key={i} position={[t.x, 0, t.z]} scale={t.s}>
          <mesh position={[0, 0.4, 0]}>
            <cylinderGeometry args={[0.15, 0.2, 0.8, 6]} />
            <meshStandardMaterial color="#6b4a2e" />
          </mesh>
          <mesh position={[0, 1.5, 0]}>
            <coneGeometry args={[0.9, 1.8, 7]} />
            <meshStandardMaterial color="#2f6b3a" flatShading />
          </mesh>
        </group>
      ))}
    </>
  );
}

function House({ seat, color, spot, night, onPick }: { seat: Seat; color: string; spot: Spot; night: boolean; onPick: (id: string) => void }) {
  const [hover, setHover] = useState(false);
  const lit = night && seat.alive;
  return (
    <group position={spot.house} rotation-y={spot.angle + Math.PI}>
      <group scale={hover && seat.enabled ? 1.06 : 1} {...pickable(seat, onPick, setHover)}>
        <mesh position={[0, 0.75, 0]}>
          <boxGeometry args={[2, 1.5, 2]} />
          <meshStandardMaterial color={seat.alive ? "#f3e9d8" : "#77736c"} />
        </mesh>
        <mesh position={[0, 2.05, 0]} rotation-y={Math.PI / 4}>
          <coneGeometry args={[1.75, 1.1, 4]} />
          <meshStandardMaterial color={seat.alive ? color : "#4b4b4b"} flatShading />
        </mesh>
        <mesh position={[0, 0.5, 1.01]}>
          <boxGeometry args={[0.5, 1, 0.05]} />
          <meshStandardMaterial color="#5b3a21" />
        </mesh>
        {[-0.65, 0.65].map((x) => (
          <mesh key={x} position={[x, 0.95, 1.01]}>
            <boxGeometry args={[0.4, 0.4, 0.05]} />
            <meshStandardMaterial color={lit ? "#ffe9a3" : "#39424e"} emissive="#ffc94d" emissiveIntensity={lit ? 1.6 : 0} />
          </mesh>
        ))}
      </group>

      {seat.mark && (
        <mesh position={[0, 0.04, 0]} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[1.9, 2.2, 48]} />
          <meshBasicMaterial color={MARK[seat.mark]} />
        </mesh>
      )}
      {!seat.alive && (
        <mesh position={[1.5, 0.35, 1.4]}>
          <boxGeometry args={[0.5, 0.7, 0.15]} />
          <meshStandardMaterial color="#9aa0a6" />
        </mesh>
      )}
      {seat.bombed && (
        <mesh position={[-1.3, 0.2, 1.3]}>
          <sphereGeometry args={[0.2, 12, 12]} />
          <meshStandardMaterial color="#1c1c1c" />
        </mesh>
      )}
      {seat.marked && (
        <mesh position={[1.3, 0.2, 1.3]}>
          <cylinderGeometry args={[0.07, 0.07, 0.4, 8]} />
          <meshStandardMaterial color="#fff3c4" emissive="#ffb300" emissiveIntensity={1.5} />
        </mesh>
      )}
      <Label title={`${seat.mayor ? "시장 " : ""}${seat.name}${seat.isMe ? " (나)" : ""}`} status={seat.status} y={3.3} />
    </group>
  );
}

// 캐릭터의 생김새. ghost는 죽은 내 모습(나에게만 보인다).
function Body({ seat, color, ghost = false }: { seat: Seat; color: string; ghost?: boolean }) {
  return (
    <>
      <mesh position={[0, 0.5, 0]}>
        <capsuleGeometry args={[0.28, 0.4, 6, 12]} />
        <meshStandardMaterial color={color} transparent={ghost} opacity={ghost ? 0.35 : 1} />
      </mesh>
      {[-0.1, 0.1].map((x) => (
        <mesh key={x} position={[x, 0.72, 0.25]}>
          <sphereGeometry args={[0.045, 8, 8]} />
          <meshBasicMaterial color="#111" />
        </mesh>
      ))}
      {seat.mayor && (
        <mesh position={[0, 1.12, 0]}>
          <coneGeometry args={[0.2, 0.25, 5]} />
          <meshStandardMaterial color="#ffd43b" emissive="#b8860b" emissiveIntensity={0.4} />
        </mesh>
      )}
      <Label title={seat.name} y={1.3} size={0.75} />
    </>
  );
}

// (x, z)를 향해 걸어간다. 걷는 동안은 가는 쪽을 보고 통통 튄다.
function walk(g: THREE.Group, x: number, z: number, dt: number, quick: number, t: number, won: boolean) {
  const dx = x - g.position.x;
  const dz = z - g.position.z;
  const dist = Math.hypot(dx, dz);
  const k = 1 - Math.exp(-dt * quick);
  g.position.x += dx * k;
  g.position.z += dz * k;
  if (dist > 0.08) g.rotation.y = Math.atan2(dx, dz);
  g.position.y = dist > 0.08 ? Math.abs(Math.sin(t * 9)) * 0.12 : won ? Math.abs(Math.sin(t * 5)) * 0.5 : 0;
}

type VillagerProps = { seat: Seat; color: string; to: THREE.Vector3; visible: boolean; positions: RefObject<Positions>; onPick: (id: string) => void };

// 다른 플레이어. 위치를 보내 왔으면 거기로, 아니면 제자리(to)로 간다.
function Villager({ seat, color, to, visible, positions, onPick }: VillagerProps) {
  const ref = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    ref.current?.position.set(to.x, 0, to.z);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useFrame((state, dt) => {
    if (!ref.current) return;
    const live = positions.current.get(seat.id);
    walk(ref.current, live?.x ?? to.x, live?.z ?? to.z, dt, live ? 10 : 2.5, state.clock.elapsedTime, seat.won);
  });
  return (
    <group ref={ref} visible={visible} {...pickable(seat, onPick)}>
      <Body seat={seat} color={color} />
    </group>
  );
}

type MeProps = {
  seat: Seat;
  color: string;
  to: THREE.Vector3;
  limit: number;
  controls: RefObject<OrbitControls | null>;
  onMove: (x: number, z: number) => void;
};

// 내 캐릭터. WASD나 방향키로 직접 움직이고, 페이즈가 바뀌거나 집을 고르면 그리로 알아서 걸어간다.
function Me({ seat, color, to, limit, controls, onMove }: MeProps) {
  const ref = useRef<THREE.Group>(null);
  const keys = useKeys();
  const manual = useRef(false);
  const lastTo = useRef(to);
  const sent = useRef({ x: Infinity, z: Infinity, t: 0 }); // 마지막으로 보낸 위치
  useLayoutEffect(() => {
    ref.current?.position.set(to.x, 0, to.z);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useFrame((state, dt) => {
    const g = ref.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    if (lastTo.current !== to) {
      lastTo.current = to;
      manual.current = false; // 새 목적지가 생기면 다시 알아서 걷는다
    }
    const k = keys.current;
    const ahead = +(k.has("KeyW") || k.has("ArrowUp")) - +(k.has("KeyS") || k.has("ArrowDown"));
    const side = +(k.has("KeyD") || k.has("ArrowRight")) - +(k.has("KeyA") || k.has("ArrowLeft"));
    if (ahead || side) {
      manual.current = true;
      // 카메라가 보는 방향을 기준으로 움직인다
      state.camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      right.crossVectors(forward, UP);
      const dx = forward.x * ahead + right.x * side;
      const dz = forward.z * ahead + right.z * side;
      const len = Math.hypot(dx, dz) || 1;
      g.position.x += (dx / len) * SPEED * dt;
      g.position.z += (dz / len) * SPEED * dt;
      const far = Math.hypot(g.position.x, g.position.z);
      if (far > limit) g.position.multiplyScalar(limit / far);
      g.rotation.y = Math.atan2(dx, dz);
      g.position.y = Math.abs(Math.sin(t * 9)) * 0.12;
    } else if (manual.current) {
      g.position.y = seat.won ? Math.abs(Math.sin(t * 5)) * 0.5 : 0;
    } else {
      walk(g, to.x, to.z, dt, 2.5, t, seat.won);
    }

    const c = controls.current;
    if (c) {
      shift.set(g.position.x - c.target.x, 0, g.position.z - c.target.z);
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
    <group ref={ref}>
      <Body seat={seat} color={color} ghost={!seat.alive} />
    </group>
  );
}

export default function Village({ seats, scene, going, positions, onPick, onMove }: Props) {
  const n = seats.length;
  const spots = useMemo(() => layout(n), [n]);
  const night = scene === "night";
  const radius = ringRadius(n);
  const goingTo = spots[seats.findIndex((s) => s.id === going)];
  const controls = useRef<OrbitControls | null>(null);

  // 페이즈가 바뀌면 모두 제자리로 돌아가므로 받아 둔 위치는 버린다
  useEffect(() => {
    positions.current.clear();
  }, [scene, positions]);

  return (
    <Canvas camera={{ fov: 45 }} dpr={[1, 2]} aria-label="마을" onContextMenu={(e) => e.preventDefault()}>
      <Camera radius={radius} controls={controls} />
      <Atmosphere night={night} />
      <Scenery n={n} night={night} />
      {seats.map((seat, i) => (
        <House key={seat.id} seat={seat} color={COLORS[i % COLORS.length]} spot={spots[i]} night={night} onPick={onPick} />
      ))}
      {seats.map((seat, i) => {
        const color = COLORS[i % COLORS.length];
        // 밤에는 집 앞(내가 고른 집이 있으면 그 집 앞), 낮에는 광장에 모인다
        const home = scene === "lobby" || night ? spots[i].door : spots[i].plaza;
        if (seat.isMe) {
          const to = night && goingTo ? goingTo.door : home;
          return <Me key={seat.id} seat={seat} color={color} to={to} limit={radius + 8} controls={controls} onMove={onMove} />;
        }
        // 밤에 남들이 어디 있는지는 알 수 없다
        const visible = seat.alive && (!night || seat.ally);
        return <Villager key={seat.id} seat={seat} color={color} to={home} visible={visible} positions={positions} onPick={onPick} />;
      })}
    </Canvas>
  );
}
