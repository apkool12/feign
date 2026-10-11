"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useRef } from "react";
import type { CSSProperties } from "react";
import type * as THREE from "three";
import { Figure } from "./Preview";
import { EMOTES, emoteClip, emoteFace, type EmoteId } from "./talk";

type Look = { skin: string; hat: string; color: string };
type Point = { x: number; y: number };

function Spots({ look, selected, nonce }: { look: Look; selected: EmoteId | null; nonce: number }) {
  const groups = useRef<(THREE.Group | null)[]>([]);
  useFrame((state) => {
    const box = state.gl.domElement.getBoundingClientRect();
    const pics = state.gl.domElement.closest("[data-emote-wheel]")?.querySelectorAll("[data-emote-pic]") ?? [];
    for (let i = 0; i < pics.length; i++) {
      const g = groups.current[i];
      const r = pics[i]?.getBoundingClientRect();
      if (!g || !r) continue;
      // 캐릭터 키(귀·모자 빼고 1.06쯤)의 한가운데가 칸의 한가운데에 오게 세운다
      const scale = r.height / 1.5;
      g.position.set(r.left + r.width / 2 - box.left - box.width / 2, box.top + box.height / 2 - (r.top + r.height / 2) - 0.53 * scale, 0);
      g.scale.setScalar(scale);
      g.rotation.x = 0.25; // 마을처럼 살짝 위에서 내려다본다
    }
  });
  return (
    <>
      {EMOTES.map((_, k) => {
        const id = k as EmoteId;
        return (
          <group
            key={`${id}-${selected === id ? nonce : "pose"}`}
            ref={(g) => {
              groups.current[k] = g;
            }}
          >
            <Figure {...look} pose={emoteClip(look.skin, id)} face={emoteFace(look.skin, id)} />
          </group>
        );
      })}
      <group
        ref={(g) => {
          groups.current[EMOTES.length] = g;
        }}
      >
        <Figure {...look} pose="idle" />
      </group>
    </>
  );
}

export function EmoteWheel({
  open,
  center,
  selected,
  look,
  cooldown,
  nonce,
}: {
  open: boolean;
  center: Point;
  selected: EmoteId | null;
  look: Look;
  cooldown: boolean;
  nonce: number;
}) {
  if (!open) return null;
  const w = typeof window === "undefined" ? 420 : window.innerWidth;
  const h = typeof window === "undefined" ? 420 : window.innerHeight;
  const scale = Math.max(0.72, Math.min(1, (w - 24) / 420, (h - 24) / 420));
  const pad = 210 * scale;
  const x = Math.max(pad, Math.min(w - pad, center.x));
  const y = Math.max(pad, Math.min(h - pad, center.y));
  return (
    <div className="emote-layer" aria-hidden>
      <div
        data-emote-wheel
        className={`emote-wheel ${cooldown ? "cool" : ""}`}
        style={{ left: x, top: y, transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        {EMOTES.map((e, k) => (
          <div
            key={e.name}
            data-emote-slot={k}
            className={`emote-slot ${selected === k ? "on" : ""}`}
            style={{ "--a": `${k * 45}deg` } as CSSProperties}
          >
            <span data-emote-pic className="emote-pic" />
          </div>
        ))}
        <div className="emote-hub">
          <span data-emote-pic className="emote-pic" />
        </div>
        {selected !== null && <div className="emote-nub" style={{ "--a": `${selected * 45}deg` } as CSSProperties} />}
        <div className="emote-canvas">
          <Canvas orthographic dpr={[1, 2]} camera={{ zoom: 1, position: [0, 0, 500], near: 1, far: 2000 }} gl={{ alpha: true }}>
            <ambientLight intensity={1.6} />
            <directionalLight position={[3, 5, 4]} intensity={1.8} />
            <Suspense fallback={null}>
              <Spots look={look} selected={selected} nonce={nonce} />
            </Suspense>
          </Canvas>
        </div>
      </div>
    </div>
  );
}
