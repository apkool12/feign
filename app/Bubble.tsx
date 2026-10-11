"use client";

// 머리 위 말풍선. 누가 말했는지/입력 중인지는 React 밖의 표(talk)에 두고 매 프레임 읽는다
// (말 한 줄 때문에 마을 전체를 다시 그리지 않으려고).
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { talk } from "./talk";

const SHOW = 4500; // 말풍선이 떠 있는 시간(ms)
const FADE = 500;
const TYPING = 5000; // 입력 중 신호가 끊기면 이만큼 뒤에 끈다
const W = 560;
const H = 200;
const PX = (0.26 / 768) * 1.2; // 이름표(Label)보다 조금 크게
const CALM = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// 두 줄까지 줄바꿈하고 넘치면 말줄임
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const lines = [""];
  for (const ch of text) {
    const last = lines.length - 1;
    if (ctx.measureText(lines[last] + ch).width <= max) lines[last] += ch;
    else if (lines.length < 2) lines.push(ch.trim());
    else {
      while (lines[1] && ctx.measureText(lines[1] + "…").width > max) lines[1] = lines[1].slice(0, -1);
      lines[1] += "…";
      break;
    }
  }
  return lines;
}

// 종이색 면에 먹색 외곽선, 아래 꼬리. 캔버스 아래 가운데가 꼬리 끝이다.
function box(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const x = (W - w) / 2;
  const y = H - 22 - h;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 24);
  ctx.moveTo(W / 2 - 14, y + h - 2);
  ctx.lineTo(W / 2, H - 4);
  ctx.lineTo(W / 2 + 14, y + h - 2);
  ctx.lineJoin = "round";
  ctx.lineWidth = 7;
  ctx.strokeStyle = "#2b2118";
  ctx.fillStyle = "#f6ecd0";
  ctx.stroke();
  ctx.fill();
  return y;
}

export function Bubble({ id, y }: { id: string; y: number }) {
  const sprite = useRef<THREE.Sprite>(null);
  const drawn = useRef(""); // 지금 캔버스에 그려 둔 것
  const { texture, ctx } = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const made = new THREE.CanvasTexture(canvas);
    made.colorSpace = THREE.SRGBColorSpace;
    return { texture: made, ctx: canvas.getContext("2d")! };
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);

  useFrame(() => {
    const s = sprite.current;
    const t = talk.get(id);
    if (!s) return;
    const now = performance.now();
    const age = t ? now - t.at : Infinity;
    const dots = !!t && age > SHOW && now - t.typing < TYPING;
    if (!t || (age > SHOW && !dots)) return void (s.visible = false);

    // 점은 차례로 튀므로 초당 12장쯤 다시 그리고, 말은 바뀔 때만 그린다
    const key = dots ? `…${CALM ? 0 : Math.floor(now / 80)}` : t.text;
    if (key !== drawn.current) {
      drawn.current = key;
      ctx.clearRect(0, 0, W, H);
      if (dots) {
        const top = box(ctx, 120, 64);
        ctx.fillStyle = "#2b2118";
        for (let i = 0; i < 3; i++) {
          const hop = CALM ? 0 : Math.max(0, Math.sin(now / 160 - i * 0.9)) * 9;
          ctx.beginPath();
          ctx.arc(W / 2 + (i - 1) * 30, top + 36 - hop, 8, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        const family = getComputedStyle(document.documentElement).getPropertyValue("--font-display") || "system-ui";
        ctx.font = `38px ${family}, system-ui, sans-serif`;
        const lines = wrap(ctx, t.text, W - 80);
        const w = Math.max(96, ...lines.map((l) => ctx.measureText(l).width)) + 56;
        const top = box(ctx, w, lines.length * 46 + 30);
        ctx.fillStyle = "#2b2118";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        lines.forEach((l, i) => ctx.fillText(l, W / 2, top + 38 + i * 46));
      }
      texture.needsUpdate = true;
    }
    const pop = dots || CALM ? 1 : Math.min(1, age / 150); // 살짝 튀어나온다
    const k = 0.6 + 0.4 * pop * (2 - pop);
    s.visible = true;
    s.scale.set(W * PX * k, H * PX * k, 1);
    s.material.opacity = dots ? 1 : Math.min(1, (SHOW - age) / FADE);
  });

  return (
    <sprite ref={sprite} position={[0, y, 0]} center={[0.5, 0]} visible={false} renderOrder={11}>
      <spriteMaterial map={texture} sizeAttenuation={false} depthTest={false} transparent />
    </sprite>
  );
}
