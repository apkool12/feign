"use client";

// 마을의 땅과 물: 길을 그려 넣은 바닥, 연못, 폭포, 시냇물, 나무다리.
// 인원수(집의 수)에 따라 길과 다리 위치가 달라지므로 plan()으로 한 번 계산해 같이 쓴다.
import { useFrame, useLoader } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { sky } from "./Dusk";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const RAD = Math.PI / 180;
// 각도(도)와 거리로 바닥 위의 한 점을 구한다. 0도는 화면 아래쪽(+z), 90도는 오른쪽(+x).
const polar = (deg: number, r: number) => new THREE.Vector3(Math.sin(deg * RAD) * r, 0, Math.cos(deg * RAD) * r);

// 매번 같은 마을이 되도록 씨앗이 고정된 난수
function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

export interface Plan {
  radius: number; // 집들이 선 원의 반지름
  plaza: number; // 광장의 반지름
  loop: number; // 집 문 앞을 잇는 순환로의 반지름
  pond: THREE.Vector3;
  cliffDeg: number;
  cliff: THREE.Vector3;
  bridgeDeg: number; // 마을에서 나가는 길(과 다리)의 방향
  bridge: THREE.Vector3;
  stream: THREE.CatmullRomCurve3;
  blocked: (x: number, z: number) => boolean; // 나무·꽃을 놓으면 안 되는 자리
}

export function plan(n: number, radius: number): Plan {
  const gap = 360 / n;
  // 나가는 길은 오른쪽(90도)에 가장 가까운 "집과 집 사이"로 낸다
  let bridgeDeg = gap / 2;
  for (let i = 0; i < n; i++) {
    const mid = (i + 0.5) * gap;
    if (Math.abs(mid - 90) < Math.abs(bridgeDeg - 90)) bridgeDeg = mid;
  }
  const cliffDeg = 138;
  const cliff = polar(cliffDeg, radius + 13.5);
  const pond = polar(258, radius + 9);
  const bridge = polar(bridgeDeg, radius + 8.8);
  const away = bridgeDeg > cliffDeg ? 1 : -1;
  const stream = new THREE.CatmullRomCurve3([
    polar(cliffDeg, radius + 10.2), // 폭포 아래 웅덩이
    polar((cliffDeg + bridgeDeg) / 2 + 6, radius + 9.4),
    bridge,
    // 절벽에서 다리로 오던 방향 그대로 마을 밖으로 흘러 나간다 (되돌아가면 물길이 겹친다)
    polar(bridgeDeg + away * 24, radius + 9.6),
    polar(bridgeDeg + away * 44, radius + 14),
    polar(bridgeDeg + away * 54, radius + 26),
  ]);
  const samples = stream.getPoints(40);
  const blocked = (x: number, z: number) => {
    if (Math.hypot(x - pond.x, z - pond.z) < 4.8) return true;
    if (Math.hypot(x - cliff.x, z - cliff.z) < 6.5) return true;
    if (samples.some((p) => Math.hypot(x - p.x, z - p.z) < 2.4)) return true;
    // 나가는 길 위
    const along = x * Math.sin(bridgeDeg * RAD) + z * Math.cos(bridgeDeg * RAD);
    const across = x * Math.cos(bridgeDeg * RAD) - z * Math.sin(bridgeDeg * RAD);
    return along > radius - 3 && Math.abs(across) < 1.6;
  };
  return { radius, plaza: 2.6 + n * 0.14, loop: radius - 2.9, pond, cliffDeg, cliff, bridgeDeg, bridge, stream, blocked };
}

// ---------- 걸을 수 없는 곳 ----------

const POND = { a: 3.2, b: 2.4, turn: 0.35 }; // 연못의 반지름 둘과 돌아간 각도
const BODY = 0.3; // 캐릭터의 반지름
const archOf = (along: number) => 0.32 * Math.cos((along / 1.7) * (Math.PI / 2));

// 다리를 기준으로 한 좌표: along은 다리를 건너는 방향, across는 옆 방향
function onBridge(p: Plan, x: number, z: number) {
  const dx = x - p.bridge.x;
  const dz = z - p.bridge.z;
  const sin = Math.sin(p.bridgeDeg * RAD);
  const cos = Math.cos(p.bridgeDeg * RAD);
  return { along: dx * sin + dz * cos, across: dx * cos - dz * sin };
}

// 다리 위에 서 있으면 다리 높이만큼 올라선다
export function lift(p: Plan, x: number, z: number) {
  const { along, across } = onBridge(p, x, z);
  return Math.abs(along) < 1.7 && Math.abs(across) < 0.8 ? 0.2 + archOf(along) : 0;
}

export type Circle = { x: number; z: number; r: number };

// 캐릭터를 막는 것들을 모아, 위치를 받아 걸을 수 있는 곳으로 밀어내는 함수를 만든다.
// 집·나무 같은 둥근 장애물(solids)에 더해 절벽, 웅덩이, 연못, 시냇물(다리 위는 제외)을 막는다.
export function collider(p: Plan, solids: Circle[]) {
  const pool = polar(p.cliffDeg, p.radius + 10.2);
  const circles: Circle[] = [...solids, { x: p.cliff.x, z: p.cliff.z, r: 4.6 }, { x: pool.x, z: pool.z, r: 2.0 }];
  const sin = Math.sin(p.bridgeDeg * RAD);
  const cos = Math.cos(p.bridgeDeg * RAD);
  for (const along of [-1.6, -0.8, 0, 0.8, 1.6]) {
    for (const side of [-1, 1]) {
      // 다리 난간: 옆으로 떨어지지 않게 한다
      circles.push({ x: p.bridge.x + along * sin + side * 0.95 * cos, z: p.bridge.z + along * cos - side * 0.95 * sin, r: 0.12 });
    }
  }
  const water = p.stream.getSpacedPoints(110).filter((s) => Math.abs(onBridge(p, s.x, s.z).along) > 1.3);
  const pc = Math.cos(POND.turn);
  const ps = Math.sin(POND.turn);
  const push = (pos: THREE.Vector3, x: number, z: number, r: number) => {
    const dx = pos.x - x;
    const dz = pos.z - z;
    const d = Math.hypot(dx, dz);
    if (d >= r || d < 1e-4) return;
    pos.x = x + (dx / d) * r;
    pos.z = z + (dz / d) * r;
  };
  return (pos: THREE.Vector3) => {
    for (const c of circles) push(pos, c.x, c.z, c.r + BODY);
    if (lift(p, pos.x, pos.z) === 0) for (const s of water) push(pos, s.x, s.z, 0.75 + BODY * 0.5);
    // 연못은 기울어진 타원이라, 연못 기준 좌표로 옮겨서 가장자리까지 밀어낸다
    const dx = pos.x - p.pond.x;
    const dz = pos.z - p.pond.z;
    const lx = dx * pc + dz * ps;
    const lz = -dx * ps + dz * pc;
    const inside = Math.hypot(lx / (POND.a + BODY), lz / (POND.b + BODY));
    if (inside < 1 && inside > 1e-4) {
      pos.x = p.pond.x + (lx * pc - lz * ps) / inside;
      pos.z = p.pond.z + (lx * ps + lz * pc) / inside;
    }
  };
}

// ---------- 바닥 ----------

const EDGE = 13; // 그림을 그려 넣는 바닥이 집들 바깥으로 얼마나 더 나가는가

// 풀밭, 돌바닥 광장, 흙길, 물가의 모래를 한 장의 그림으로 그린다
function paintGround(n: number, p: Plan) {
  const W = 2048;
  const span = (p.radius + EDGE) * 2;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = W;
  const ctx = canvas.getContext("2d")!;
  const rand = seeded(11 + n);
  const px = (v: { x: number; z: number }) => [(v.x / span + 0.5) * W, (v.z / span + 0.5) * W] as const;
  const u = W / span; // 1칸(월드 단위)이 몇 픽셀인가

  // 풀밭: 바탕색 위에 밝고 어두운 얼룩과 풀포기
  ctx.fillStyle = "#6aa84f";
  ctx.fillRect(0, 0, W, W);
  for (let i = 0; i < 700; i++) {
    ctx.fillStyle = ["#7dbb5a", "#5c9a45", "#86c260", "#62a34a"][i % 4];
    ctx.globalAlpha = 0.1;
    ctx.beginPath();
    ctx.arc(rand() * W, rand() * W, 20 + rand() * 90, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = "#4f8f3e";
  ctx.lineWidth = 2;
  for (let i = 0; i < 2600; i++) {
    const x = rand() * W;
    const y = rand() * W;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 6, y - 5 - rand() * 6);
    ctx.stroke();
  }
  // 들꽃
  ctx.globalAlpha = 1;
  for (let i = 0; i < 420; i++) {
    ctx.fillStyle = ["#ffffff", "#ffe066", "#ff9db0", "#c4b5fd"][i % 4];
    ctx.beginPath();
    ctx.arc(rand() * W, rand() * W, 2.5 + rand() * 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // 물가의 모래
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const sand = (color: string, extra: number) => {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = (1.7 + extra) * u;
    ctx.beginPath();
    p.stream.getPoints(60).forEach((pt, i) => (i ? ctx.lineTo(...px(pt)) : ctx.moveTo(...px(pt))));
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(...px(p.pond), (3.5 + extra) * u, (2.7 + extra) * u, 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(...px(polar(p.cliffDeg, p.radius + 10.2)), (2.2 + extra) * u, 0, Math.PI * 2);
    ctx.fill();
  };
  sand("#b9a676", 1.5);
  sand("#d8c794", 0.9);

  // 흙길: 어두운 테두리를 먼저 긋고 그 위에 밝은 길을 얹는다
  const roads = (color: string, width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width * u;
    ctx.beginPath();
    ctx.arc(W / 2, W / 2, p.loop * u, 0, Math.PI * 2); // 집 문 앞을 잇는 순환로
    ctx.stroke();
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.moveTo(...px(polar((i / n) * 360, p.plaza - 0.3)));
      ctx.lineTo(...px(polar((i / n) * 360, p.radius - 1.2)));
      ctx.stroke();
    }
    ctx.beginPath(); // 마을에서 나가는 길
    ctx.moveTo(...px(polar(p.bridgeDeg, p.loop)));
    ctx.lineTo(...px(polar(p.bridgeDeg, p.radius + EDGE)));
    ctx.stroke();
  };
  roads("#8f6f43", 1.3); // 손으로 그은 듯한 짙은 테두리
  roads("#dcbd7c", 1.08); // 따뜻한 황토색 흙길
  // 길 위의 한 점: across는 길 한가운데에서 옆으로 벗어난 거리. 길이 뻗은 방향(도)도 함께 준다.
  // 순환로, 집으로 가는 길, 다리로 나가는 길 가운데 길이에 비례해 고른다.
  const loopLen = Math.PI * 2 * p.loop;
  const spokeLen = p.radius - 1.2 - p.plaza;
  const exitLen = p.radius + EDGE - p.loop;
  const roadLen = loopLen + spokeLen * n + exitLen;
  const share = roadLen / (loopLen + spokeLen * n); // 나가는 길이 더해진 만큼 획 수를 늘린다
  const onRoad = (across: number): readonly [THREE.Vector3, number] => {
    const pick = rand() * roadLen;
    if (pick < loopLen) {
      const deg = rand() * 360;
      return [polar(deg, p.loop + across), deg + 90];
    }
    if (pick < loopLen + spokeLen * n) {
      const spoke = Math.floor(rand() * n) * (360 / n);
      return [polar(spoke, p.plaza + rand() * spokeLen).add(polar(spoke + 90, across)), spoke];
    }
    const far = p.loop + rand() * exitLen;
    // 다리와 시냇물 둑 위에는 그리지 않는다 (다시 뽑는다)
    if (Math.abs(far - (p.radius + 8.8)) < 2.1) return onRoad(across);
    return [polar(p.bridgeDeg, far).add(polar(p.bridgeDeg + 90, across)), p.bridgeDeg];
  };
  // 붓 자국: 길을 따라 그은 밝고 어두운 짧은 획
  ctx.lineWidth = 0.09 * u;
  for (let i = 0; i < 520 * share; i++) {
    const [at, deg] = onRoad((rand() - 0.5) * 0.8);
    const half = polar(deg + (rand() - 0.5) * 24, 0.2 + rand() * 0.35);
    ctx.strokeStyle = rand() < 0.5 ? "#e9d09a" : "#c9a565";
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(...px({ x: at.x - half.x, z: at.z - half.z }));
    ctx.lineTo(...px({ x: at.x + half.x, z: at.z + half.z }));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // 잔돌 몇 개
  for (let i = 0; i < 260 * share; i++) {
    const [at] = onRoad((rand() - 0.5) * 0.85);
    ctx.fillStyle = rand() < 0.5 ? "#b99a63" : "#efe0b6";
    ctx.beginPath();
    ctx.ellipse(...px(at), 2.5 + rand() * 3, 2 + rand() * 2, rand() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // 길가로 파고든 풀: 칼같이 곧은 가장자리를 울퉁불퉁하게 만든다
  for (let i = 0; i < 1500 * share; i++) {
    const [at] = onRoad((rand() < 0.5 ? -1 : 1) * (0.56 + rand() * 0.14));
    ctx.fillStyle = ["#6aa84f", "#7dbb5a", "#62a34a"][i % 3];
    ctx.beginPath();
    ctx.arc(...px(at), (0.05 + rand() * 0.09) * u, 0, Math.PI * 2);
    ctx.fill();
  }

  // 광장: 사람들이 밟아 다져진 둥근 흙마당. 길과 같은 흙에 같은 테두리를 쓰고, 납작한 디딤돌을 불규칙하게 놓는다.
  const C = W / 2;
  // 살짝 울퉁불퉁한 원 (완전한 원이면 접시처럼 보인다)
  const yard = (r: number) => {
    ctx.beginPath();
    for (let i = 0; i <= 90; i++) {
      const a = (i / 90) * Math.PI * 2;
      const bumpy = r * (1 + 0.022 * Math.sin(a * 3 + 1) + 0.018 * Math.sin(a * 7 + 2) + 0.01 * Math.sin(a * 13));
      ctx.lineTo(C + Math.cos(a) * bumpy * u, C + Math.sin(a) * bumpy * u);
    }
    ctx.fill();
  };
  // 길이 들어오는 입구: 마당 테두리를 흙으로 덮어 길과 이어 준다
  const mouths = (r: number) => {
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.arc(...px(polar((i / n) * 360, p.plaza + 0.12)), r * u, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  ctx.fillStyle = "#8f6f43";
  yard(p.plaza + 0.12);
  ctx.fillStyle = "#dcbd7c";
  yard(p.plaza);
  mouths(0.64);
  // 붓 자국
  ctx.lineWidth = 0.09 * u;
  ctx.globalAlpha = 0.55;
  for (let i = 0; i < 40 * p.plaza * p.plaza; i++) {
    const at = polar(rand() * 360, Math.sqrt(rand()) * (p.plaza - 0.25));
    const half = polar(rand() * 360, 0.2 + rand() * 0.3);
    ctx.strokeStyle = rand() < 0.5 ? "#e9d09a" : "#c9a565";
    ctx.beginPath();
    ctx.moveTo(...px({ x: at.x - half.x, z: at.z - half.z }));
    ctx.lineTo(...px({ x: at.x + half.x, z: at.z + half.z }));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // 모닥불 밑의 그을린 흙
  const soot = ctx.createRadialGradient(C, C, 0, C, C, 1.25 * u);
  soot.addColorStop(0, "rgba(96, 72, 46, 0.6)");
  soot.addColorStop(0.7, "rgba(120, 92, 58, 0.35)");
  soot.addColorStop(1, "rgba(120, 92, 58, 0)");
  ctx.fillStyle = soot;
  ctx.beginPath();
  ctx.arc(C, C, 1.25 * u, 0, Math.PI * 2);
  ctx.fill();
  // 디딤돌: 크기와 모양이 제각각이고, 서로 겹치지 않으며, 가운데로 갈수록 듬성듬성하다
  const stones: { x: number; z: number; r: number }[] = [];
  for (let tries = 0; tries < 2400; tries++) {
    const far = 1.35 + rand() * (p.plaza - 1.7);
    if (rand() > (far / p.plaza) ** 1.6) continue;
    const at = polar(rand() * 360, far);
    const r = 0.17 + rand() * 0.13;
    if (stones.some((o) => Math.hypot(o.x - at.x, o.z - at.z) < (o.r + r) * 1.12)) continue;
    stones.push({ x: at.x, z: at.z, r });
    const [sx, sy] = px(at);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(rand() * Math.PI);
    ctx.beginPath();
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const lumpy = r * (0.86 + 0.14 * Math.sin(a * 2 + far * 9) + 0.06 * Math.sin(a * 3 + r * 40));
      ctx.lineTo(Math.cos(a) * lumpy * u, Math.sin(a) * lumpy * 0.74 * u);
    }
    ctx.closePath();
    ctx.fillStyle = ["#e4d6b4", "#d2c19a", "#c7b48a", "#ddcba6", "#cfc3a8"][Math.floor(rand() * 5)];
    ctx.fill();
    ctx.strokeStyle = "#8f7850";
    ctx.lineWidth = 0.022 * u;
    ctx.stroke();
    // 옅은 하이라이트
    ctx.strokeStyle = "rgba(255, 250, 232, 0.6)";
    ctx.lineWidth = 0.03 * u;
    ctx.beginPath();
    ctx.ellipse(-r * 0.15 * u, -r * 0.2 * u, r * 0.5 * u, r * 0.28 * u, 0, Math.PI * 1.05, Math.PI * 1.7);
    ctx.stroke();
    ctx.restore();
  }
  // 마당 가장자리로 파고든 풀
  for (let i = 0; i < 36 * p.plaza; i++) {
    const deg = rand() * 360;
    const gap = 360 / n;
    if (Math.abs(((deg + gap / 2) % gap) - gap / 2) * RAD * p.plaza < 0.9) continue; // 길이 들어오는 입구는 비워 둔다
    const at = polar(deg, p.plaza + 0.02 + rand() * 0.14);
    ctx.fillStyle = ["#6aa84f", "#7dbb5a", "#62a34a"][i % 3];
    ctx.beginPath();
    ctx.arc(...px(at), (0.05 + rand() * 0.09) * u, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

const FAR = 260; // 먼 풀밭의 반지름

// 마을 밖 풀밭에 깔 풀 무늬 한 장. 이어 붙여도 티가 나지 않게 가장자리를 넘는 것은 반대쪽에도 그린다.
// 마을 바닥 그림과 같은 색·같은 크기(한 칸에 u픽셀)로 그려야 경계가 보이지 않는다.
function paintGrass(u: number) {
  const T = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = T;
  const ctx = canvas.getContext("2d")!;
  const rand = seeded(3);
  const scale = (T / 2048) ** 2; // 넓이에 맞춘 개수
  const wrapped = (x: number, y: number, draw: (x: number, y: number) => void) => {
    for (const dx of [0, -T, T]) for (const dy of [0, -T, T]) draw(x + dx, y + dy);
  };
  ctx.fillStyle = "#6aa84f";
  ctx.fillRect(0, 0, T, T);
  for (let i = 0; i < 700 * scale; i++) {
    ctx.fillStyle = ["#7dbb5a", "#5c9a45", "#86c260", "#62a34a"][i % 4];
    ctx.globalAlpha = 0.1;
    const r = 20 + rand() * 90;
    wrapped(rand() * T, rand() * T, (x, y) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = "#4f8f3e";
  ctx.lineWidth = 2;
  for (let i = 0; i < 2600 * scale; i++) {
    const x = rand() * T;
    const y = rand() * T;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 6, y - 5 - rand() * 6);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < 420 * scale; i++) {
    ctx.fillStyle = ["#ffffff", "#ffe066", "#ff9db0", "#c4b5fd"][i % 4];
    ctx.beginPath();
    ctx.arc(4 + rand() * (T - 8), 4 + rand() * (T - 8), 2.5 + rand() * 2, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.repeat.setScalar((FAR * 2 * u) / T); // 원의 지름을 몇 장으로 덮는가
  return texture;
}

function Ground({ n, p }: { n: number; p: Plan }) {
  const texture = useMemo(() => paintGround(n, p), [n, p]);
  const grass = useMemo(() => paintGrass(2048 / ((p.radius + EDGE) * 2)), [p]);
  useEffect(() => () => texture.dispose(), [texture]);
  useEffect(() => () => grass.dispose(), [grass]);
  return (
    <>
      {/* 숲으로 이어지는 먼 풀밭 */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, 0]} receiveShadow>
        <circleGeometry args={[FAR, 48]} />
        <meshStandardMaterial map={grass} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[(p.radius + EDGE) * 2, (p.radius + EDGE) * 2]} />
        <meshStandardMaterial map={texture} />
      </mesh>
    </>
  );
}

// ---------- 물 ----------

// 화면에 있는 물 재질들. 매 프레임 여기 등록된 재질의 시간과 밤낮 값을 직접 갱신한다.
const WATERS = new Set<THREE.ShaderMaterial>();
function useWater(extra: Record<string, number> = {}) {
  const ref = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({ uTime: { value: 0 }, uNight: { value: 0 }, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, { value: v }])) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => {
    const material = ref.current;
    if (!material) return;
    WATERS.add(material);
    return () => void WATERS.delete(material);
  }, []);
  return { ref, uniforms };
}
const SPLASH = new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }); // 폭포 밑의 거품과 물방울
const CALM = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const VERTEX = "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";
// 손그림 화풍에 맞춘 물: 끊어 칠한 서너 가지 색과 흰 선만 쓴다 (꿈틀대는 노이즈 무늬는 쓰지 않는다)
const TOON = `
  uniform float uTime; uniform float uNight; varying vec2 vUv;
  const vec3 DEEP = vec3(0.24, 0.6, 0.83);
  const vec3 MID = vec3(0.39, 0.73, 0.89);
  const vec3 SHALLOW = vec3(0.63, 0.88, 0.94);
  const vec3 FOAM = vec3(0.97, 0.99, 1.0);
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec3 dusk(vec3 c) { return mix(c, (0.55 + 0.45 * c) * vec3(0.022, 0.045, 0.13), uNight * 0.96); } // 밤에는 주변 땅보다 어두운 남청. 흰 거품도 물색에서 조금만 밝다
  // 경계가 계단지지 않게 한 픽셀 폭으로만 풀어 주는 step
  float cut(float edge, float x) { float w = fwidth(x); return smoothstep(edge - w, edge + w, x); }
  // 붓으로 그은 듯한 길쭉한 흰 줄. 칸(p의 정수부)마다 keep 확률로 하나씩, p.y 방향으로 길고 양끝이 가늘다.
  float strokes(vec2 p, float keep) {
    vec2 id = floor(p), f = fract(p);
    float len = 0.26 + 0.18 * hash(id + 7.0);
    float along = abs(f.y - 0.5) / len;
    float across = abs(f.x - 0.5 - (hash(id + 3.0) - 0.5) * 0.5);
    return step(keep, hash(id)) * (1.0 - cut(0.13 * (1.0 - along * along), across)) * step(along, 1.0);
  }
`;
// 고인 물: 가운데가 깊고, 물가에 흰 거품 띠가 천천히 숨쉬고, 짧은 반짝임이 드문드문 떴다 진다.
// uRipple이 1이면 (uCx, uCy)에서 동심원이 번진다 (폭포 아래 웅덩이).
const STILL = `${TOON}
  uniform float uRipple; uniform float uCx; uniform float uCy; uniform float uGap; uniform float uGapW; uniform float uFlow;
  void main() {
    vec2 q = vUv - 0.5;
    float d = length(q) * 2.0;
    float a = atan(q.y, q.x);
    float wob = 0.02 * sin(a * 3.0 + uTime * 0.25) + 0.015 * sin(a * 7.0 - uTime * 0.18);
    vec3 col = mix(DEEP, MID, cut(0.5 + wob * 2.0, d));
    col = mix(col, SHALLOW, cut(0.78 + wob, d));
    // 반짝임: 칸마다 살짝 휜 짧은 선이 천천히 길어졌다 사라진다
    vec2 p = vUv * vec2(5.0, 9.0) + vec2(uTime * 0.03, 0.0);
    vec2 id = floor(p), f = fract(p);
    float h = hash(id);
    float grow = 0.3 * smoothstep(0.2, 0.8, sin(uTime * 0.5 + h * 6.283) * 0.5 + 0.5);
    float gx = abs(f.x - 0.5);
    float gy = abs(f.y - 0.5 - 0.15 * cos((f.x - 0.5) * 3.14));
    float glint = step(0.72, h) * step(gx, grow) * (1.0 - cut(0.09 * (1.0 - gx / 0.31), gy));
    col = mix(col, FOAM, glint * 0.85 * step(d, 0.7));
    // 연못의 느린 흐름: 옅은 흰 줄이 한쪽으로 천천히 떠간다
    float drift = strokes(vec2(vUv.y * 6.0, (vUv.x - uTime * 0.025) * 3.5), 0.62) * uFlow * step(d, 0.74);
    col = mix(col, FOAM, drift * 0.5);
    float r = distance(vUv, vec2(uCx, uCy)) * 2.0;
    float ring = cut(0.8, fract(r * 2.5 - uTime * 0.45)) * smoothstep(0.95, 0.25, r) * uRipple;
    col = mix(col, FOAM, ring * 0.75);
    // 물가 안쪽의 끊어진 거품 선과 가장자리 거품 띠
    // 물길이 드나드는 쪽(uGap 방향, 반폭 uGapW)은 거품을 끊어 물이 이어져 보이게 한다
    float off = abs(atan(sin(a - uGap), cos(a - uGap)));
    float shore = 1.0 - (1.0 - smoothstep(uGapW * 0.75, uGapW, off)) * step(0.001, uGapW);
    float dash = (1.0 - cut(0.012, abs(d - (0.86 + wob)))) * step(0.45, fract(a * 2.2 + uTime * 0.03));
    col = mix(col, FOAM, dash * 0.85 * shore);
    col = mix(col, FOAM, cut(0.94 + wob * 0.6 + 0.008 * sin(uTime * 0.9), d) * shore);
    gl_FragColor = vec4(dusk(col), 1.0);
    #include <colorspace_fragment>
  }`;
// 흐르는 물: v가 늘어나는 쪽으로 흐른다. uLength는 물길의 실제 길이라 무늬가 늘어나지 않는다.
// 시냇물은 가운데가 깊고 기슭에 거품 선이 있다. 웅덩이에서 나오는 어귀(uMouth 지점)에서는 웅덩이 색으로 시작해 흰 줄이 서서히 생긴다.
// uFall이 1이면 폭포: 세로 띠마다 빠르기가 다르고, 벼랑 끝(uLip)을 넘으면 떨어질수록 빨라지며 줄이 길게 찢어진다.
const FLOWING = `${TOON}
  uniform float uSpeed; uniform float uLength; uniform float uFall; uniform float uLip; uniform float uMouth;
  void main() {
    float s = vUv.y * uLength;
    // 자유 낙하: 간 거리의 제곱근이 흐른 시간이다. 이 좌표에 무늬를 그리면 아래로 갈수록 빠르고 길어진다.
    float y = mix(s, uLip + 2.3 * sqrt(max(s - uLip, 0.0)), uFall * step(uLip, s));
    float c = abs(vUv.x - 0.5) * 2.0;
    float lanes = mix(4.0, 6.0, uFall);
    float lane = floor(vUv.x * lanes);
    float t = uTime * uSpeed * (0.8 + 0.45 * hash(vec2(lane, 1.0)));
    float settled = mix(smoothstep(uMouth - 0.2, uMouth + 2.4, s), 1.0, step(uMouth, 0.001)); // 어귀에서 0, 흘러가며 1
    vec3 brook = mix(DEEP, MID, cut(0.42 + 0.05 * sin(y * 1.3 + uTime * 0.4), c));
    brook = mix(brook, SHALLOW, cut(0.72, c));
    brook = mix(SHALLOW, brook, settled);
    vec3 fall = mix(MID, SHALLOW, step(0.5, hash(vec2(lane, 2.0))));
    vec3 col = mix(brook, fall, uFall);
    float white = strokes(vec2(vUv.x * lanes, (y - t) * mix(0.42, 0.5, uFall) + hash(vec2(lane, 5.0)) * 10.0), mix(0.5, 0.3, uFall));
    col = mix(col, FOAM, white * 0.9 * step(c, 0.8) * settled);
    float edge = mix(0.86, 0.78, uFall) + 0.04 * sin(y * 2.2 - uTime * uSpeed * 0.6) + 0.03 * sin(y * 5.1 + uTime * 0.3);
    col = mix(col, FOAM, cut(edge, c));
    if (uFall > 0.5) {
      if (c > 0.93 + 0.06 * sin(y * 3.0 - uTime * uSpeed)) discard; // 물결치는 옆선
      col = mix(col, FOAM, smoothstep(0.92, 0.985, vUv.y));          // 떨어진 자리의 물거품
    }
    gl_FragColor = vec4(dusk(col), 1.0);
    #include <colorspace_fragment>
  }`;

function StillWater({ ripple, gap, flow = false }: { ripple?: [number, number]; gap?: [number, number]; flow?: boolean }) {
  const { ref, uniforms } = useWater({ uRipple: ripple ? 1 : 0, uCx: ripple?.[0] ?? 0.5, uCy: ripple?.[1] ?? 0.5, uGap: gap?.[0] ?? 0, uGapW: gap?.[1] ?? 0, uFlow: flow ? 1 : 0 });
  return <shaderMaterial ref={ref} vertexShader={VERTEX} fragmentShader={STILL} uniforms={uniforms} />;
}
function FlowingWater({ speed, length, lip = 0, mouth = 0 }: { speed: number; length: number; lip?: number; mouth?: number }) {
  const { ref, uniforms } = useWater({ uSpeed: speed, uLength: length, uFall: lip ? 1 : 0, uLip: lip, uMouth: mouth });
  return <shaderMaterial ref={ref} vertexShader={VERTEX} fragmentShader={FLOWING} uniforms={uniforms} side={THREE.DoubleSide} />;
}

const stone = (key: number, position: [number, number, number], size: number, color = "#8d8a84") => (
  <mesh key={key} position={position} rotation={[key * 1.3, key * 2.1, key]} scale={[size, size * 0.7, size * 0.9]} castShadow receiveShadow>
    <dodecahedronGeometry args={[1, 0]} />
    <meshStandardMaterial color={color} flatShading />
  </mesh>
);

const LILIES: [number, number][] = [
  [-1.2, 0.5],
  [0.9, -0.7],
  [1.6, 0.6],
  [-0.3, -1.1],
  [0.2, 0.9],
];

function Pond({ p }: { p: Plan }) {
  const pads = useRef<THREE.Group>(null);
  useFrame((state) => {
    pads.current?.children.forEach((pad, i) => {
      const t = state.clock.elapsedTime * (CALM ? 0.15 : 1);
      // 연잎이 물결에 살짝 떠밀렸다 돌아온다
      pad.position.set(LILIES[i][0] + Math.sin(t * 0.25 + i * 1.9) * 0.14, 0.09 + Math.sin(t * 1.3 + i * 2) * 0.012, LILIES[i][1] + Math.cos(t * 0.21 + i) * 0.1);
      pad.rotation.y = Math.sin(t * 0.4 + i) * 0.3;
    });
  });
  const rim = Array.from({ length: 11 }, (_, i) => (i / 11) * Math.PI * 2 + 0.3);
  return (
    <group position={[p.pond.x, 0, p.pond.z]} rotation-y={-POND.turn}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.06, 0]} scale={[POND.a, POND.b, 1]}>
        <circleGeometry args={[1, 48]} />
        <StillWater flow />
      </mesh>
      {rim.map((a, i) => (i % 4 === 3 ? null : stone(i, [Math.cos(a) * 3.35, 0.12, Math.sin(a) * 2.55], 0.3 + (i % 3) * 0.12)))}
      <group ref={pads}>
        {LILIES.map(([x, z], i) => (
          <group key={i} position={[x, 0.09, z]}>
            <mesh rotation-x={-Math.PI / 2}>
              <circleGeometry args={[0.3 + (i % 2) * 0.08, 14, 0.4, Math.PI * 2 - 0.8]} />
              <meshStandardMaterial color={i % 2 ? "#4f9d4a" : "#3c7f3d"} />
            </mesh>
            {i % 2 === 0 && (
              <mesh position={[0.05, 0.07, 0]}>
                <sphereGeometry args={[0.09, 8, 6]} />
                <meshStandardMaterial color="#ff9db0" />
              </mesh>
            )}
          </group>
        ))}
      </group>
      {/* 물가의 부들 */}
      {[0, 1, 2, 3].map((i) => (
        <group key={i} position={[-3.1 + i * 0.22, 0, 1.2 + (i % 2) * 0.3]} rotation-z={(i - 1.5) * 0.06}>
          <mesh position={[0, 0.5, 0]}>
            <cylinderGeometry args={[0.02, 0.02, 1, 5]} />
            <meshStandardMaterial color="#5c7f3a" />
          </mesh>
          <mesh position={[0, 0.95, 0]}>
            <cylinderGeometry args={[0.05, 0.05, 0.28, 6]} />
            <meshStandardMaterial color="#6b4423" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// 폭포 물줄기가 지나는 길: 절벽 위 샘에서 나와 벼랑 끝을 둥글게 넘고, 바위에 묻히지 않게 포물선으로 웅덩이에 떨어진다
const LIP = new THREE.Vector3(0, 5.62, 1.2);
const FALL = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 5.74, -1),
  new THREE.Vector3(0, 5.74, 0.55),
  LIP,
  ...[5.0, 3.7, 2.1, 0.09].map((y) => new THREE.Vector3(0, y, 1.2 + 0.6 * Math.sqrt(LIP.y - y))),
]);
const LANDING = 1.2 + 0.6 * Math.sqrt(LIP.y - 0.09); // 물이 떨어지는 자리의 z
const POOL = { z: 3.3, r: 2.1 }; // 폭포 아래 웅덩이
const LIP_AT = FALL.getLengths(300)[100]; // 샘에서 벼랑 끝(일곱 점 중 셋째)까지 흘러온 거리
const ACROSS = new THREE.Vector3(1, 0, 0);

// 바위 절벽에서 떨어지는 폭포와 그 아래 웅덩이. 폭포는 마을 쪽(+z)을 바라본다.
function Waterfall({ p }: { p: Plan }) {
  const foam = useRef<THREE.Group>(null);
  const spray = useRef<THREE.Group>(null);
  const sheet = useMemo(() => ribbon(FALL, () => 1.5, 48, ACROSS), []);
  // 웅덩이에서 시냇물이 나가는 방향을 웅덩이 원의 각도로 (이 모둠의 회전을 되돌리고, 눕힌 원의 y는 -z다)
  const out = useMemo(() => {
    const d = p.stream.getPointAt(0.06).sub(p.stream.getPointAt(0));
    const turn = p.cliffDeg * RAD + Math.PI;
    return Math.atan2(-(d.x * Math.sin(turn) + d.z * Math.cos(turn)), d.x * Math.cos(turn) - d.z * Math.sin(turn));
  }, [p]);
  useFrame((state) => {
    const t = state.clock.elapsedTime * (CALM ? 0.15 : 1);
    SPLASH.color.setRGB(1 - 0.9 * sky.night, 1 - 0.84 * sky.night, 1 - 0.62 * sky.night); // 밤에는 물보라도 물색으로 가라앉는다
    // 떨어진 자리에 뭉게뭉게 이는 거품
    foam.current?.children.forEach((puff, i) => puff.scale.setScalar((0.34 + (i % 3) * 0.08) * (1 + Math.sin(t * 3 + i * 1.7) * 0.14)));
    // 통통 튀어 오르는 물방울
    spray.current?.children.forEach((drop, i) => {
      const q = (t * 0.9 + i / 8) % 1;
      drop.position.set(Math.sin(i * 2.3) * 0.7 + Math.sin(i) * q * 0.5, 0.15 + Math.sin(q * Math.PI) * (0.5 + (i % 3) * 0.25), LANDING + 0.1 + q * (0.5 + (i % 2) * 0.3));
      drop.scale.setScalar(0.1 * (1 - q) + 0.03);
    });
  });
  const rocks: [number, number, number, number, string][] = [
    [0, 1.6, -0.6, 3.3, "#8a7a66"],
    [-2.6, 1.3, -0.3, 2.6, "#9b8c78"],
    [2.7, 1.5, -0.4, 2.8, "#93836f"],
    [-1.2, 3.6, -1, 2.5, "#9b8c78"],
    [1.4, 3.8, -1.1, 2.6, "#8a7a66"],
    [-3.6, 0.5, 1, 1.3, "#93836f"],
    [3.7, 0.5, 1.1, 1.4, "#9b8c78"],
  ];
  return (
    <group position={[p.cliff.x, 0, p.cliff.z]} rotation-y={p.cliffDeg * RAD + Math.PI}>
      {rocks.map(([x, y, z, size, color], i) => stone(i, [x, y, z], size, color))}
      {/* 절벽 위의 풀 */}
      <mesh position={[0, 5.15, -1]} scale={[4.2, 0.5, 2.6]} castShadow>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#5c9a45" flatShading />
      </mesh>
      {/* 절벽 위의 샘: 여기서 물이 나와 벼랑으로 흘러간다 */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 5.76, -1]}>
        <circleGeometry args={[1, 32]} />
        <StillWater gap={[-Math.PI / 2, 0.75]} />
      </mesh>
      {[0.4, 1.5, 2.6, 3.7, 4.8, 5.9].map((a, i) => stone(i + 20, [Math.cos(a) * 1.1, 5.78, -1 - Math.sin(a) * 1.1], 0.2 + (i % 3) * 0.06))}
      <mesh geometry={sheet}>
        <FlowingWater speed={4.2} length={FALL.getLength()} lip={LIP_AT} />
      </mesh>
      {/* 웅덩이: 물줄기가 떨어지는 자리에서 동심원이 번지고, 시냇물이 나가는 쪽은 물가가 트여 있다 */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.07, POOL.z]}>
        <circleGeometry args={[POOL.r, 40]} />
        <StillWater ripple={[0.5, 0.5 + (POOL.z - LANDING) / (POOL.r * 2)]} gap={[out, 0.62]} />
      </mesh>
      <group ref={foam}>
        {[-0.62, -0.3, 0.02, 0.34, 0.64].map((x, i) => (
          <mesh key={i} position={[x, 0.2, LANDING + (i % 2) * 0.16]} material={SPLASH}>
            <sphereGeometry args={[1, 10, 8]} />
          </mesh>
        ))}
      </group>
      {!CALM && (
        <group ref={spray}>
          {Array.from({ length: 8 }, (_, i) => (
            <mesh key={i} material={SPLASH}>
              <sphereGeometry args={[1, 8, 6]} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}

// 굽은 길을 따라 띠를 만든다 (u는 폭, v는 길이 방향이고 길이에 비례한다). wide는 흘러온 거리에 따른 폭. across를 주면 그 방향으로 폭을 벌리고 길의 높이를 그대로 따른다.
function ribbon(curve: THREE.CatmullRomCurve3, wide: (along: number) => number, steps: number, across?: THREE.Vector3) {
  const length = curve.getLength();
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  const side = new THREE.Vector3();
  for (let i = 0; i <= steps; i++) {
    const at = curve.getPointAt(i / steps);
    if (across) side.copy(across);
    else side.crossVectors(curve.getTangentAt(i / steps), new THREE.Vector3(0, 1, 0)).normalize();
    const y = across ? at.y : 0.05;
    const width = wide((i / steps) * length);
    positions.push(at.x - side.x * width * 0.5, y, at.z - side.z * width * 0.5, at.x + side.x * width * 0.5, y, at.z + side.z * width * 0.5);
    uvs.push(0, i / steps, 1, i / steps);
    if (i < steps) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  return geometry;
}

function Stream({ p }: { p: Plan }) {
  // 웅덩이에서 나오는 어귀는 넓게 벌어졌다가 제 폭으로 좁아진다
  const geometry = useMemo(() => ribbon(p.stream, (along) => 1.5 + THREE.MathUtils.smoothstep(POOL.r + 2.2 - along, 0, 2.4), 120), [p]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry}>
      <FlowingWater speed={1.1} length={p.stream.getLength()} mouth={POOL.r} />
    </mesh>
  );
}

// 시냇물 위의 나무다리. 길이 방향이 마을 중심에서 바깥을 향한다.
function Bridge({ p }: { p: Plan }) {
  const arch = archOf;
  const planks = Array.from({ length: 9 }, (_, i) => -1.6 + i * 0.4);
  return (
    <group position={[p.bridge.x, 0, p.bridge.z]} rotation-y={p.bridgeDeg * RAD}>
      {planks.map((z, i) => (
        <mesh key={i} position={[0, 0.16 + arch(z), z]} rotation-x={(-z / 1.7) * 0.28} castShadow receiveShadow>
          <boxGeometry args={[1.5, 0.08, 0.34]} />
          <meshStandardMaterial color={i % 3 ? "#9a6b3f" : "#86592f"} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 0.72, 0, 0]}>
          {[-1.5, 0, 1.5].map((z) => (
            <mesh key={z} position={[0, 0.5 + arch(z), z]} castShadow>
              <boxGeometry args={[0.1, 0.75, 0.1]} />
              <meshStandardMaterial color="#6b4423" />
            </mesh>
          ))}
          {[-0.75, 0.75].map((z) => (
            <mesh key={z} position={[0, 0.78 + arch(z), z]} rotation-x={(-z / 1.7) * 0.35} castShadow>
              <boxGeometry args={[0.07, 0.07, 1.55]} />
              <meshStandardMaterial color="#7a4a2a" />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

// 풀밭에 흩뿌린 꽃송이 (한 번에 그리려고 인스턴스로 묶는다)
function Flowers({ p }: { p: Plan }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const COUNT = 320;
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const rand = seeded(5);
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    let placed = 0;
    for (let tries = 0; placed < COUNT && tries < 2000; tries++) {
      const at = polar(rand() * 360, p.radius + 1.8 + rand() * 34);
      if (p.blocked(at.x, at.z)) continue;
      const size = 0.07 + rand() * 0.05;
      m.makeScale(size, size, size).setPosition(at.x, 0.1, at.z);
      mesh.setMatrixAt(placed, m);
      mesh.setColorAt(placed, color.set(["#ffffff", "#ffe066", "#ff9db0", "#c4b5fd"][placed % 4]));
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [p]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, COUNT]}>
      <icosahedronGeometry args={[1, 0]} />
      <meshStandardMaterial flatShading />
    </instancedMesh>
  );
}

// ---------- 먼 산과 마을 바깥 ----------

// 방향(도)이 center에서 width 안쪽이면 1에서 0으로 부드럽게 떨어진다
function bump(deg: number, center: number, width: number) {
  const off = Math.abs(((deg - center + 540) % 360) - 180);
  return off >= width ? 0 : Math.cos((off / width) * (Math.PI / 2)) ** 2;
}

type Ridge = { radius: number; height: number; fill: string; shade: string; line: string };
// 가까운 겹부터: 숲이 선 초록 언덕, 비탈에 명암이 진 산, 눈 덮인 먼 산
const RIDGES: Ridge[] = [
  { radius: 104, height: 24, fill: "#4f9a52", shade: "#3f8647", line: "#2c6335" },
  { radius: 138, height: 52, fill: "#5fa39a", shade: "#4a8a84", line: "#356b68" },
  { radius: 176, height: 84, fill: "#86b6da", shade: "#6c9fc8", line: "#4d7ea8" },
];
const PW = 4096; // 산 그림의 가로(한 바퀴)와 세로
const PH = 512;

// 산 한 겹을 손그림처럼 그린다. 가로가 마을을 한 바퀴 도는 방향이라 양끝이 이어져야 한다.
// 폭포 절벽 뒤가 가장 높고 험하며, 반대편은 낮고, 다리로 나가는 길 쪽은 고개처럼 꺼진다.
function paintRidge(layer: number, p: Plan) {
  const { fill, shade, line } = RIDGES[layer];
  const canvas = document.createElement("canvas");
  canvas.width = PW;
  canvas.height = PH;
  const ctx = canvas.getContext("2d")!;
  const rand = seeded(41 + layer * 13);
  const lean = [0.3, 0.5, 0.62][layer]; // 절벽 쪽으로 얼마나 솟는가
  const pass = [0.5, 0.32, 0.24][layer]; // 고갯길에서 얼마나 꺼지는가
  const tall = (deg: number) =>
    Math.max(0.14, 1 - lean + lean * bump(deg, p.cliffDeg, 85) - 0.28 * bump(deg, p.cliffDeg + 180, 85) - pass * bump(deg, p.bridgeDeg, 14 + layer * 4));
  // 봉우리들: [자리(0~1), 폭, 높이, 뾰족함]. 가까운 언덕은 둥글고 먼 산은 뾰족하다.
  const peaks = Array.from({ length: [22, 26, 30][layer] }, () => ({
    at: rand(),
    wide: [0.035, 0.028, 0.022][layer] * (0.7 + rand() * 1.1),
    high: 0.45 + rand() * 0.55,
    lopsided: (rand() - 0.5) * 0.5, // 좌우 비대칭
  }));
  const top = (u: number) => {
    let h = 0.2 + 0.06 * Math.sin(u * Math.PI * 2 * 9 + layer) + 0.04 * Math.sin(u * Math.PI * 2 * 23 + 1);
    for (const k of peaks) {
      let d = u - k.at;
      d -= Math.round(d); // 양끝을 넘어 이어진다
      const w = k.wide * (1 + (d > 0 ? k.lopsided : -k.lopsided));
      const t = Math.abs(d) / w;
      if (t >= 1) continue;
      h = Math.max(h, k.high * (layer === 0 ? 0.5 + 0.5 * Math.cos(t * Math.PI) : (1 - t) ** (layer === 2 ? 0.9 : 1.15)));
    }
    return h * tall(u * 360) * 0.92;
  };
  const y = (u: number) => PH - top(u) * PH;
  const outline = () => {
    ctx.beginPath();
    ctx.moveTo(0, PH);
    for (let x = 0; x <= PW; x += 4) ctx.lineTo(x, y(x / PW));
    ctx.lineTo(PW, PH);
    ctx.closePath();
  };
  ctx.lineJoin = "round";
  ctx.lineWidth = 7;
  ctx.strokeStyle = line;
  if (layer === 0) {
    // 능선을 따라 선 숲: 삼각 소나무와 둥근 나무의 실루엣
    for (let i = 0; i < 300; i++) {
      const u = rand();
      const x = u * PW;
      const foot = y(u) + 10;
      const size = 16 + rand() * 18;
      ctx.fillStyle = rand() < 0.5 ? "#2f7a3b" : "#3b8a45";
      ctx.beginPath();
      if (i % 3) {
        ctx.moveTo(x - size * 0.45, foot);
        ctx.lineTo(x, foot - size * 1.7);
        ctx.lineTo(x + size * 0.45, foot);
      } else ctx.arc(x, foot - size * 0.7, size * 0.6, 0, Math.PI * 2);
      ctx.closePath();
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fill();
    }
    ctx.lineWidth = 7;
  }
  outline();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.save();
  ctx.clip();
  if (layer > 0) {
    // 산비탈의 그늘: 봉우리마다 한쪽 면을 어두운 색으로 끊어 칠한다
    ctx.fillStyle = shade;
    for (const k of peaks) {
      const x = k.at * PW;
      const w = k.wide * PW;
      const peakY = y(k.at);
      for (const shift of [-PW, 0, PW]) {
        ctx.beginPath();
        ctx.moveTo(x + shift, peakY - 4);
        ctx.lineTo(x + shift + w * 1.2, PH);
        ctx.lineTo(x + shift + w * 0.1, PH);
        ctx.lineTo(x + shift - w * 0.08, peakY + (PH - peakY) * 0.45);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  if (layer === 2) {
    // 높은 봉우리의 눈: 아래가 톱니처럼 들쭉날쭉하다
    const snow = PH * 0.4;
    ctx.fillStyle = "#f6fbff";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let x = 0; x <= PW; x += 22) ctx.lineTo(x, snow + ((x / 22) % 2 ? 16 : -6) + Math.sin(x * 0.013) * 10);
    ctx.lineTo(PW, 0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  outline();
  ctx.stroke();
  ctx.clearRect(0, PH - 4, PW, 4); // 바닥 선은 지운다
  ctx.fillStyle = fill;
  ctx.fillRect(0, PH - 6, PW, 6);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

const DAYLIGHT = new THREE.Color("#ffffff");
const SUNSET = new THREE.Color("#ffb08a"); // 노을이 지는 동안 산이 물드는 색
const MOONLIGHT = new THREE.Color("#2b3966"); // 밤에는 그림 전체를 남색으로 물들인다
const CLOUDS = Array.from({ length: 8 }, (_, i) => ({ deg: i * 45 + (i % 3) * 13, far: 118 + (i % 4) * 16, high: 30 + ((i * 7) % 5) * 7, size: 5 + (i % 3) * 2 }));

// 마을을 빙 두른 먼 산 세 겹과 그 앞뒤를 천천히 도는 구름. 안개에 묻히면 능선이 사라지므로 안개는 받지 않는다.
function Mountains({ p, night }: { p: Plan; night: boolean }) {
  const tint = useMemo(() => new THREE.MeshBasicMaterial({ color: night ? MOONLIGHT : DAYLIGHT, fog: false, toneMapped: false }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const layers = useMemo(
    () =>
      RIDGES.map((ridge, i) => {
        const material = tint.clone();
        material.map = paintRidge(i, p);
        material.alphaTest = 0.5;
        material.side = THREE.BackSide; // 안쪽에서 본다
        return { ...ridge, material };
      }),
    [p, tint],
  );
  useEffect(() => () => layers.forEach((layer) => (layer.material.map?.dispose(), layer.material.dispose())), [layers]);
  const clouds = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    for (const material of [tint, ...layers.map((layer) => layer.material)]) material.color.lerpColors(DAYLIGHT, MOONLIGHT, sky.night).lerp(SUNSET, sky.glow * 0.55);
    if (clouds.current && !CALM) clouds.current.rotation.y += dt * 0.004;
  });
  return (
    <>
      {layers.map((layer) => (
        <mesh key={layer.radius} material={layer.material} position={[0, layer.height / 2 - 2, 0]}>
          <cylinderGeometry args={[layer.radius, layer.radius, layer.height, 96, 1, true]} />
        </mesh>
      ))}
      <group ref={clouds}>
        {CLOUDS.map((cloud, i) => (
          <group key={i} position={polar(cloud.deg, cloud.far).setY(cloud.high)} rotation-y={cloud.deg * RAD}>
            {[-1.5, -0.5, 0.6, 1.5].map((x, j) => (
              <mesh key={j} material={tint} position={[x * cloud.size, (j % 2) * cloud.size * 0.25, 0]} scale={[cloud.size * (1 + (j % 2) * 0.3), cloud.size * (0.55 + (j % 2) * 0.2), cloud.size * 0.6]}>
                <sphereGeometry args={[1, 12, 8]} />
              </mesh>
            ))}
          </group>
        ))}
      </group>
    </>
  );
}

// glb 모델 하나를 여러 자리에 한 번에 그린다 (모델 안의 조각마다 인스턴스 메시 하나)
function Copies({ file, at }: { file: string; at: THREE.Matrix4[] }) {
  const gltf = useLoader(GLTFLoader, `/models/${file}.glb`);
  const parts = useMemo(() => {
    gltf.scene.updateMatrixWorld(true);
    const found: THREE.InstancedMesh[] = [];
    gltf.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const copies = new THREE.InstancedMesh(o.geometry, o.material, at.length);
      at.forEach((m, i) => copies.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(m, o.matrixWorld)));
      copies.computeBoundingSphere();
      copies.receiveShadow = true;
      found.push(copies);
    });
    return found;
  }, [gltf, at]);
  useEffect(() => () => parts.forEach((part) => part.dispose()), [parts]);
  return (
    <>
      {parts.map((part, i) => (
        <primitive key={i} object={part} />
      ))}
    </>
  );
}

const WOODS = 11.5; // 울타리 바깥 장식이 끝나고 숲이 시작되는 곳 (집들의 원에서 잰 거리)
const DEEP = 72; // 숲이 이어지는 깊이

// 마을을 둘러싼 숲. 울타리 가까이는 덤불·바위·그루터기·버섯과 듬성한 나무이고, 멀어질수록 무리가 커지고 빽빽해진다.
// 갈 수 없는 곳이라 충돌은 없다. 물길, 연못, 절벽, 나가는 길은 비워 둔다.
function Forest({ p }: { p: Plan }) {
  const spots = useMemo(() => {
    const rand = seeded(77);
    const at: Record<string, THREE.Matrix4[]> = { tree: [], pine: [], bush: [], rock: [], stump: [], mushrooms: [] };
    const up = new THREE.Vector3(0, 1, 0);
    const put = (file: string, x: number, z: number, size: number) => {
      if (p.blocked(x, z) || Math.hypot(x, z) < p.radius + WOODS - 1) return;
      at[file].push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(up, rand() * 6.283), new THREE.Vector3(size, size * (0.9 + rand() * 0.25), size)));
    };
    for (let clump = 0; clump < 170; clump++) {
      const depth = rand() ** 0.8; // 0 = 울타리 바로 밖, 1 = 숲 깊은 곳
      const center = polar(rand() * 360, p.radius + WOODS + depth * DEEP);
      const kind = rand() < 0.5 ? "tree" : "pine"; // 무리마다 한 종류가 많다
      const spread = 3.5 + depth * 4;
      for (let i = 0, count = 2 + Math.floor(depth * 9 + rand() * 3); i < count; i++) {
        const x = center.x + (rand() - 0.5) * 2 * spread;
        const z = center.z + (rand() - 0.5) * 2 * spread;
        put(rand() < 0.75 ? kind : kind === "tree" ? "pine" : "tree", x, z, 0.9 + rand() * 0.6 + depth * 0.5);
      }
      // 나무 밑의 작은 것들 (숲 가장자리에 더 많다)
      for (let i = 0, count = Math.floor(rand() * (5 - depth * 3)); i < count; i++) {
        const x = center.x + (rand() - 0.5) * 2 * spread;
        const z = center.z + (rand() - 0.5) * 2 * spread;
        put(["bush", "bush", "rock", "stump", "mushrooms"][Math.floor(rand() * 5)], x, z, 0.8 + rand() * 0.6);
      }
    }
    // 화면 끝에서 빈 땅이 보이지 않게 숲 깊은 곳을 겹겹이 두른다
    for (let row = 0; row < 4; row++) {
      const far = p.radius + WOODS + 34 + row * 11;
      for (let i = 0, count = Math.floor((Math.PI * 2 * far) / 5.2); i < count; i++) {
        const spot = polar((i / count) * 360 + rand() * 3, far + (rand() - 0.5) * 7);
        put((i + row) % 3 ? "pine" : "tree", spot.x, spot.z, 1.3 + rand() * 0.8);
      }
    }
    return at;
  }, [p]);
  return (
    <>
      {Object.entries(spots).map(([file, at]) => (
        <Copies key={file} file={file} at={at} />
      ))}
    </>
  );
}

// 숲 바닥을 살짝 어둡게 눌러, 마을이 숲속 빈터처럼 보이게 한다 (울타리 밖에서 서서히 짙어진다)
function ForestFloor({ p }: { p: Plan }) {
  const shade = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    const clear = (p.radius + WOODS - 3) / FAR; // 여기까지는 그대로
    const full = (p.radius + WOODS + 16) / FAR;
    const fade = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    fade.addColorStop(clear, "rgba(24, 66, 34, 0)");
    fade.addColorStop(full, "rgba(24, 66, 34, 0.3)");
    fade.addColorStop(1, "rgba(24, 66, 34, 0.38)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(canvas);
  }, [p]);
  useEffect(() => () => shade.dispose(), [shade]);
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.015, 0]}>
      <circleGeometry args={[FAR, 64]} />
      <meshBasicMaterial map={shade} transparent depthWrite={false} />
    </mesh>
  );
}

export function Terrain({ n, p, night }: { n: number; p: Plan; night: boolean }) {
  const dark = useRef(night ? 1 : 0);
  useFrame((state, dt) => {
    dark.current = sky.night;
    for (const water of WATERS) {
      water.uniforms.uTime.value = state.clock.elapsedTime * (CALM ? 0.15 : 1);
      water.uniforms.uNight.value = dark.current;
    }
  });
  return (
    <>
      <Ground n={n} p={p} />
      <Pond p={p} />
      <Waterfall p={p} />
      <Stream p={p} />
      <Bridge p={p} />
      <Flowers p={p} />
      <ForestFloor p={p} />
      <Suspense fallback={null}>
        <Forest p={p} />
      </Suspense>
      <Mountains p={p} night={night} />
    </>
  );
}
