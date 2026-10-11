"use client";

// 해 질 녘과 새벽. 낮과 밤이 바뀌는 몇 초의 시간표를 한곳에 둔다:
// 하늘빛(sky), 캐릭터의 귀가와 기상(bedtime), 문(DOORS·hinge·Doorway·doorOpen), 늦게 켜지는 불(useDelayed).
// 규칙과는 무관한 연출이라 각자의 화면에서 따로 재생된다(서로 똑같을 필요가 없다).
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { stage } from "./stage";

const STILL = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const DUSK = 5.6; // 해가 지는 데 걸리는 시간(초)
export const DAWN = 4.6;
const YAWN = 1.6; // 하품 한 번
const HOME = 4.1; // 해 질 녘: 이때까지 문 앞에 닿는다
const ENTER = 0.6; // 문턱을 넘는 시간
const OUT = 0.4; // 새벽: 문이 열리고 나오기 시작하는 때
const SILL = 0.6; // 문 앞 자리에서 집 한가운데 쪽으로 이만큼(비율) 간 곳이 문턱

// 지금(또는 마지막으로) 일어난 전환. cast면 캐릭터들도 움직인다. waiting은 다른 연출(회상)이 끝나기를 기다리는 새벽.
export const turn = { at: -Infinity, night: false, cast: false, waiting: false };
const now = () => performance.now() / 1000;
const age = () => (turn.waiting ? 0 : now() - turn.at);
const ramp = (x: number, from: number, to: number) => THREE.MathUtils.smoothstep(x, from, to);

// 귀가·기상 연출이 돌고 있는가. 카메라가 캐릭터를 따라 움직이는 동안이라 집을 누르면 엉뚱한 집이 잡힌다.
export const casting = () => turn.cast && age() < (turn.night ? DUSK : DAWN);

// 사람마다 조금씩 늦게 움직인다 (다 같이 움직이면 기계 같다)
export const late = (i: number) => (i * 0.37) % 0.45;

// 장면이 바뀌는 것을 지켜보다가 전환을 시작한다. cast가 false면(메뉴 배경 등) 하늘만 바뀐다.
export function useTurn(scene: string, cast: boolean) {
  const was = useRef(scene);
  useLayoutEffect(() => {
    const from = was.current;
    was.current = scene;
    const night = scene === "night";
    if (STILL || night === (from === "night")) return;
    turn.night = night;
    turn.cast = cast && (night ? from === "day" : scene === "day");
    turn.at = now();
    if (!turn.cast) return;
    // 다른 연출(역할 카드, 어젯밤 회상)이 화면을 쓰고 있으면 끝난 뒤에 시작한다.
    // 그쪽이 화면을 잡는 것은 이 다음 순간이라 한 박자 쉬고 묻는다.
    turn.waiting = true;
    const begin = () => {
      if (stage.busy()) return void (id = setTimeout(begin, 150));
      turn.waiting = false;
      turn.at = now();
    };
    let id = setTimeout(begin, 60);
    return () => {
      clearTimeout(id);
      turn.waiting = false;
    };
  }, [scene, cast]);
}

// 하늘의 상태. night는 밤의 정도(0~1), glow는 노을·새벽놀의 정도(0~1). 매 프레임 tick이 한 번 갱신하고 조명·물·산·색 보정이 읽는다.
export const sky = { night: 0, glow: 0 };
export function tick(night: boolean) {
  const length = turn.night ? DUSK : DAWN;
  const u = age() / length;
  if (turn.night !== night || u >= 1) {
    sky.night = night ? 1 : 0;
    sky.glow = 0;
    return;
  }
  sky.night = turn.night ? ramp(u, 0.25, 1) : 1 - ramp(u, 0, 0.75);
  sky.glow = ramp(u, 0, 0.35) * (1 - ramp(u, 0.6, 1));
}

// 하늘이 반 넘게 어두워졌는가. 모닥불 불빛이나 화면 가장자리 그늘처럼 딱 한 번 바뀌는 것들이 쓴다.
export function useDark(night: boolean) {
  const [dark, setDark] = useState(night);
  useEffect(() => {
    const id = setInterval(() => setDark(sky.night > 0.5), 200);
    return () => clearInterval(id);
  }, []);
  return dark;
}

// 이 집 창문에 불이 켜져 있을 때인가: 저녁에는 주인이 들어간 뒤부터, 아침에는 나오기 전까지
export function indoors(night: boolean, wait: number) {
  if (!turn.cast || turn.night !== night) return night;
  return night ? age() >= HOME + ENTER + 0.3 + wait : age() < OUT + wait;
}

type Spot = { house: THREE.Vector3; door: THREE.Vector3 };
const sill = new THREE.Vector3();

function put(g: THREE.Group, a: THREE.Vector3, b: THREE.Vector3, k: number, dt: number) {
  g.position.x = a.x + (b.x - a.x) * k;
  g.position.z = a.z + (b.z - a.z) * k;
  const d = Math.atan2(b.x - a.x, b.z - a.z) - g.rotation.y;
  if (a !== b) g.rotation.y += Math.atan2(Math.sin(d), Math.cos(d)) * Math.min(1, dt * 10);
}

// 귀가·기상 연출 중이면 캐릭터 g를 직접 움직이고 그 순간의 동작 이름을 돌려준다. 연출이 없으면 null.
// from은 전환이 시작될 때 서 있던 자리, wait는 이 사람이 늦는 시간.
export function bedtime(g: THREE.Group, spot: Spot, from: THREE.Vector3, wait: number, dt: number): string | null {
  g.scale.setScalar(1);
  if (!turn.cast || age() >= (turn.night ? DUSK : DAWN)) return null;
  const a = age() - wait;
  sill.lerpVectors(spot.door, spot.house, SILL);
  g.visible = true;
  if (turn.night) {
    // 하품 → 집으로 걸어감 → 문턱을 넘으며 작아져 사라짐
    if (a < YAWN) return put(g, from, from, 0, dt), a < 0 ? "idle" : "yawn";
    if (a < HOME) return put(g, from, spot.door, (a - YAWN) / (HOME - YAWN), dt), "walk";
    const k = Math.min(1, (a - HOME) / ENTER);
    put(g, spot.door, sill, k, dt);
    g.scale.setScalar(1 - 0.7 * k);
    g.visible = k < 1;
    return "walk";
  }
  // 문에서 나옴 → 기지개 → (그 뒤는 평소대로 광장으로)
  if (a < OUT + ENTER) {
    const k = Math.max(0, (a - OUT) / ENTER);
    put(g, sill, spot.door, k, dt);
    g.scale.setScalar(0.3 + 0.7 * k);
    g.visible = k > 0;
    return "walk";
  }
  if (a < OUT + ENTER + YAWN) return put(g, spot.door, spot.door, 0, dt), "yawn";
  return null;
}

// 문이 열린 정도(0~1)
export function doorOpen(wait: number) {
  if (!turn.cast || age() >= (turn.night ? DUSK : DAWN)) return 0;
  const a = age() - wait;
  const [open, shut] = turn.night ? [HOME - 0.35, HOME + ENTER + 0.1] : [OUT - 0.3, OUT + ENTER + 0.2];
  return ramp(a, open, open + 0.35) * (1 - ramp(a, shut, shut + 0.3));
}

// 집마다 문이 있는 자리(집 기준 좌표): 반폭, 아래·위 높이, 앞면 z. swing이면 문짝이 따로 떨어진 메시라 경첩으로 돌린다.
type Door = { w: number; y0: number; y1: number; z: number; swing?: boolean };
export const DOORS: Record<string, Door> = {
  house: { w: 0.26, y0: 0.17, y1: 1.15, z: 1.09 },
  "house-1": { w: 0.31, y0: 0.2, y1: 1.19, z: 1.0, swing: true },
  "house-2": { w: 0.33, y0: 0.18, y1: 1.22, z: 1.28 },
  "house-3": { w: 0.3, y0: 0.15, y1: 1.09, z: 0.98, swing: true },
  "house-4": { w: 0.29, y0: 0, y1: 0.94, z: 0.96, swing: true },
  "house-5": { w: 0.28, y0: 0, y1: 0.94, z: 0.91, swing: true },
  "house-6": { w: 0.3, y0: 0.1, y1: 1.04, z: 1.16 },
  "house-7": { w: 0.31, y0: 0, y1: 0.99, z: 1.28, swing: true },
  "house-8": { w: 0.29, y0: 0.05, y1: 0.99, z: 0.93, swing: true },
};

// 문이 열리면 드러나는 어두운 집 안. 문짝이 안 돌아가는 집은 이것만으로 열림을 보여 준다.
export function Doorway({ house, open }: { house: string; open: RefObject<number> }) {
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const d = DOORS[house] ?? DOORS.house;
  useFrame(() => {
    if (!material.current) return;
    material.current.opacity = open.current;
    material.current.visible = open.current > 0.01;
  });
  return (
    <mesh position={[0, (d.y0 + d.y1) / 2, d.z]}>
      <planeGeometry args={[d.w * 2, d.y1 - d.y0]} />
      <meshBasicMaterial ref={material} color="#1c120b" transparent opacity={0} visible={false} />
    </mesh>
  );
}

// 집 모델에서 문짝(재질 이름이 Door…인 메시)을 찾아 왼쪽 모서리를 축으로 돌 수 있게 만든다. 손잡이도 함께 붙인다.
export function hinge(root: THREE.Object3D): THREE.Object3D | undefined {
  let door: THREE.Mesh | undefined;
  const knobs: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const name = (o.material as THREE.Material).name;
    if (name.startsWith("Door")) door = o;
    else if (name === "Knob") knobs.push(o);
  });
  if (!door) return;
  root.updateMatrixWorld(true);
  door.geometry = door.geometry.clone();
  door.geometry.computeBoundingBox();
  const box = door.geometry.boundingBox!.clone();
  const x = box.min.x;
  const z = (box.min.z + box.max.z) / 2;
  door.geometry.translate(-x, 0, -z);
  door.position.x += x;
  door.position.z += z;
  door.updateMatrixWorld(true);
  const size = new THREE.Vector3();
  const mid = new THREE.Vector3();
  for (const knob of knobs) {
    knob.geometry.computeBoundingBox();
    knob.geometry.boundingBox!.getSize(size);
    knob.geometry.boundingBox!.getCenter(mid);
    // 문에 달린 작은 손잡이만 (같은 재질의 다른 장식은 그대로 둔다)
    if (Math.max(size.x, size.y, size.z) < 0.35 && mid.x > box.min.x - 0.05 && mid.x < box.max.x + 0.05 && mid.z > box.min.z - 0.1) door.attach(knob);
  }
  return door;
}
