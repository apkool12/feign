// 효과음. 파일 없이 전부 여기서 합성한다(나무·실로폰·종이 느낌의 짧고 둥근 소리).
// 위쪽(합성)은 브라우저 없이도 돈다 — 검증: sound.test.ts (npm test)
import { useEffect, useRef } from "react";
import type { Role, View } from "../game.ts";

export const SR = 44100;
export const PEAK = 0.7; // -3dB. 모든 소리를 이 크기로 맞춘 뒤 level로 줄인다.
type Buf = Float32Array;

// 같은 소리가 매번 똑같이 나오도록 씨앗이 고정된 난수
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 음 하나. h를 주면 4배음을 얹어 실로폰처럼 들린다. to를 주면 음높이가 미끄러진다.
function tone(b: Buf, at: number, d: number, f: number, g: number, o: { to?: number; h?: number; tri?: boolean; vib?: number; a?: number } = {}) {
  const { to = f, h = 0, tri = false, vib = 0, a = 0.004 } = o;
  let ph = 0;
  const n = Math.min(b.length - ((at * SR) | 0), (d * SR) | 0);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const hz = f * (to / f) ** (t / d) * (1 + vib * Math.sin(2 * Math.PI * 7 * t));
    ph += hz / SR;
    const env = Math.min(1, t / a) * Math.exp((-5 * t) / d);
    const wave = tri ? (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * ph)) : Math.sin(2 * Math.PI * ph);
    b[((at * SR) | 0) + i] += g * env * (wave + h * Math.exp((-20 * t) / d) * Math.sin(8 * Math.PI * ph));
  }
}

// 걸러 낸 잡음. band면 f 근처만, 아니면 f 아래만 남긴다.
function noise(b: Buf, at: number, d: number, f: number, g: number, o: { to?: number; q?: number; low?: boolean; seed?: number } = {}) {
  const { to = f, q = 0.5, low = false, seed = 1 } = o;
  const rand = rng(seed);
  let lo = 0;
  let band = 0;
  const n = Math.min(b.length - ((at * SR) | 0), (d * SR) | 0);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const fc = 2 * Math.sin((Math.PI * Math.min(f * (to / f) ** (t / d), 9000)) / SR);
    lo += fc * band;
    band += fc * (rand() * 2 - 1 - lo - q * band);
    b[((at * SR) | 0) + i] += g * Math.min(1, t / 0.003) * Math.exp((-5 * t) / d) * (low ? lo : band);
  }
}

const knock = (b: Buf, at: number, g = 1) => {
  tone(b, at, 0.09, 210, g, { to: 140, h: 0.3 });
  noise(b, at, 0.03, 1800, g * 0.5, { seed: 7 });
};
// 말랑한 발소리 하나: 음높이가 뚝 떨어지는 둥근 몸통에, 눌리는 느낌의 낮은 잡음을 살짝
const pat = (b: Buf, f: number, squish: number) => {
  tone(b, 0, b.length / SR, f, 1, { to: f * 0.62 });
  noise(b, 0, 0.04, 700, squish, { low: true, seed: f });
};
// 만화 하품: 부드럽게 올라갔다가 길게 내려가는 하-암, 끝에 숨 빠지는 옅은 잡음
const yawn = (b: Buf, f: number) => {
  const d = b.length / SR;
  tone(b, 0, 0.35, f * 0.75, 0.6, { to: f * 1.05, a: 0.12, tri: true });
  tone(b, 0.22, d - 0.22, f * 1.05, 1, { to: f * 0.55, a: 0.1, vib: 0.015 });
  noise(b, d * 0.55, d * 0.45, 500, 0.15, { low: true, seed: f });
};
// 음 이름 대신 반음 수(0 = 가온 다, C5 = 12)
const hz = (semi: number) => 261.63 * 2 ** (semi / 12);
const notes = (b: Buf, semis: number[], gap: number, d: number, o = { h: 0.35 }) =>
  semis.forEach((s, i) => tone(b, i * gap, d, hz(s), 1, o));

// [길이(초), 크기(0~1), 그리는 법]
const SOUNDS = {
  // UI
  click: [0.08, 0.35, (b) => tone(b, 0, 0.07, 620, 1, { to: 520, h: 0.3 })],
  tab: [0.08, 0.3, (b) => tone(b, 0, 0.07, 780, 1, { h: 0.25 })],
  open: [0.22, 0.4, (b) => (noise(b, 0, 0.14, 500, 0.6, { to: 2200, q: 0.9 }), tone(b, 0.07, 0.14, hz(16), 0.8, { h: 0.3 }))],
  close: [0.2, 0.35, (b) => (noise(b, 0, 0.14, 2200, 0.6, { to: 500, q: 0.9 }), tone(b, 0.06, 0.12, hz(9), 0.8, { h: 0.3 }))],
  confirm: [0.3, 0.5, (b) => notes(b, [16, 21], 0.08, 0.2)],
  error: [0.32, 0.45, (b) => (tone(b, 0, 0.14, hz(-3), 1, { tri: true }), tone(b, 0.13, 0.18, hz(-5), 1, { tri: true }))],
  // 진행
  day: [1.3, 0.6, (b) => notes(b, [12, 16, 19, 24], 0.11, 0.9)],
  night: [2.2, 0.6, (b) => (tone(b, 0, 2.2, hz(-5), 1, { h: 0.15 }), tone(b, 0.02, 2, hz(2), 0.5), tone(b, 0, 1.6, hz(-5) * 2.01, 0.2))],
  reveal: [1.1, 0.6, (b) => (noise(b, 0, 0.16, 900, 0.7, { to: 3200, q: 0.8 }), notes(b.subarray((0.14 * SR) | 0), [24, 28, 31, 36], 0.07, 0.7))],
  mayor: [1, 0.55, (b) => (notes(b, [12, 12], 0.13, 0.2), tone(b, 0.3, 0.7, hz(19), 1, { h: 0.35 }), tone(b, 0.3, 0.7, hz(16), 0.5))],
  tick: [0.06, 0.3, (b) => tone(b, 0, 0.05, 1050, 1, { to: 900, h: 0.2 })],
  vote: [0.22, 0.5, (b) => (tone(b, 0, 0.16, 150, 1, { to: 80 }), noise(b, 0, 0.09, 1400, 0.5, { seed: 3 }))],
  exile: [1.1, 0.6, (b) => (notes(b, [7, 4, 0], 0.16, 0.4, { h: 0.3 }), tone(b, 0.5, 0.5, 110, 1, { to: 60 }), noise(b, 0.5, 0.2, 400, 0.6, { low: true }))],
  death: [2, 0.55, (b) => (tone(b, 0, 2, hz(-10), 1, { h: 0.1 }), tone(b, 0.25, 1.7, hz(-7), 0.7), tone(b, 0.5, 1.4, hz(-15), 0.6))],
  win: [1.6, 0.65, (b) => (notes(b, [12, 16, 19, 24, 28], 0.12, 0.5), tone(b, 0.6, 1, hz(24), 0.6, { h: 0.2 }), tone(b, 0.6, 1, hz(19), 0.4))],
  lose: [1.7, 0.55, (b) => notes(b, [7, 3, 0, -5], 0.28, 0.9, { h: 0.15 })],
  // 마을
  // 발소리: 작고 말랑한 톡. 같은 소리가 반복되지 않게 높이·길이·눌림이 조금씩 다른 다섯 가지를 둔다.
  step: [0.08, 0.26, (b) => pat(b, 440, 0.2)],
  step2: [0.07, 0.26, (b) => pat(b, 478, 0.3)],
  step3: [0.1, 0.26, (b) => pat(b, 405, 0.15)],
  step4: [0.09, 0.26, (b) => pat(b, 460, 0.25)],
  step5: [0.075, 0.26, (b) => pat(b, 420, 0.2)],
  // 연출: 밤이 될 때 하품, 집 문 여닫기. 여럿이 겹치므로 작게.
  yawn: [0.9, 0.25, (b) => yawn(b, 330)],
  yawn2: [0.8, 0.25, (b) => yawn(b, 392)],
  yawn3: [1, 0.25, (b) => yawn(b, 294)],
  door: [0.22, 0.3, (b) => (tone(b, 0, 0.15, 180, 0.6, { to: 260, tri: true, vib: 0.05, a: 0.02 }), tone(b, 0.15, 0.05, 700, 0.5, { to: 500, h: 0.2 }))],
  doorShut: [0.12, 0.3, (b) => (tone(b, 0, 0.1, 160, 1, { to: 90 }), noise(b, 0, 0.04, 600, 0.4, { low: true, seed: 6 }))],
  knock: [0.5, 0.55, (b) => (knock(b, 0), knock(b, 0.16, 0.85), knock(b, 0.32, 0.95))],
  chat: [0.1, 0.35, (b) => tone(b, 0, 0.09, 420, 1, { to: 900 })],
  join: [0.3, 0.4, (b) => notes(b, [7, 14], 0.09, 0.2)],
  leave: [0.3, 0.35, (b) => notes(b, [14, 7], 0.09, 0.2)],
  // 능력 (계열별)
  heal: [0.9, 0.5, (b) => (notes(b, [12, 16, 19], 0.12, 0.6, { h: 0.15 }), tone(b, 0.3, 0.6, hz(31), 0.3, { vib: 0.01 }))],
  look: [0.5, 0.45, (b) => (tone(b, 0, 0.08, 700, 1, { h: 0.2 }), tone(b, 0.1, 0.08, 700, 1, { h: 0.2 }), tone(b, 0.2, 0.3, 500, 0.8, { to: 1100 }))],
  trap: [0.4, 0.5, (b) => (noise(b, 0, 0.05, 3000, 1, { seed: 9 }), tone(b, 0.01, 0.2, 330, 1, { to: 150, h: 0.4 }), knock(b, 0.2, 0.6))],
  attack: [0.5, 0.55, (b) => (noise(b, 0, 0.2, 600, 0.8, { to: 3500, q: 0.7 }), tone(b, 0.18, 0.3, 140, 1, { to: 55 }), noise(b, 0.18, 0.15, 500, 0.7, { low: true, seed: 4 }))],
  hex: [1.1, 0.5, (b) => (tone(b, 0, 1.1, hz(15), 1, { to: hz(8), vib: 0.03 }), tone(b, 0.1, 1, hz(21), 0.5, { to: hz(14), vib: 0.03 }))],
} satisfies Record<string, [number, number, (b: Buf) => void]>;

export type Sfx = keyof typeof SOUNDS;
export const SFX = Object.keys(SOUNDS) as Sfx[];

// 환경음: 4초짜리 고리. 끝 0.5초를 앞에 겹쳐 이음매를 없앤다.
const LOOP = 4;
const AMBIENT = {
  fire: (b) => {
    noise(b.fill(0), 0, 99, 220, 0.25, { low: true, seed: 11 });
    const rand = rng(12);
    for (let i = 0; i < 44; i++) noise(b, rand() * 4.4, 0.02 + rand() * 0.03, 1500 + rand() * 2500, 0.3 + rand() * 0.7, { seed: 20 + i });
  },
  crickets: (b) => {
    for (const [f, off, every] of [[4300, 0, 0.5], [3900, 0.27, 0.75]] as const)
      for (let at = off; at < 4.4; at += every) for (let k = 0; k < 3; k++) tone(b, at + k * 0.03, 0.022, f, 1);
  },
  water: (b) => {
    noise(b, 0, 99, 900, 1, { q: 1.2, seed: 31 });
    noise(b, 0, 99, 2400, 0.4, { q: 1.4, seed: 32 });
    for (let i = 0; i < b.length; i++) b[i] *= 0.75 + 0.25 * Math.sin((2 * Math.PI * i) / SR / 2);
  },
} satisfies Record<string, (b: Buf) => void>;
export type Amb = keyof typeof AMBIENT;
export const LOOPS = Object.keys(AMBIENT) as Amb[];

function normalize(b: Buf, peak: number) {
  let max = 0;
  for (const s of b) max = Math.max(max, Math.abs(s));
  if (max) for (let i = 0; i < b.length; i++) b[i] *= peak / max;
  return b;
}

export function render(name: Sfx): Buf {
  const [d, level, draw] = SOUNDS[name];
  const b = new Float32Array(Math.ceil(d * SR));
  draw(b);
  // 끝을 5ms 동안 0으로 내려 딱 소리를 막는다
  for (let i = 0; i < 220; i++) b[b.length - 1 - i] *= i / 220;
  return normalize(b, PEAK * level);
}

export function renderLoop(name: Amb): Buf {
  const fade = 0.5 * SR;
  const raw = new Float32Array((LOOP + 0.5) * SR);
  // noise()의 감쇠를 끄려고 길이를 99초로 준 것 — 버퍼 길이에서 잘린다
  AMBIENT[name](raw);
  const b = raw.slice(0, LOOP * SR);
  for (let i = 0; i < fade; i++) b[i] = b[i] * (i / fade) + raw[LOOP * SR + i] * (1 - i / fade);
  return normalize(b, PEAK);
}

// ── 여기부터 브라우저 ──

const VOL = "feign-volume";
let ctx: AudioContext | null = null;
let master: GainNode;
let amb: Partial<Record<Amb, GainNode>> = {};
const cache = new Map<string, AudioBuffer>();

export function volume(): number {
  try {
    const v = Number(localStorage.getItem(VOL) ?? 0.6);
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.6;
  } catch {
    return 0.6;
  }
}

export function setVolume(v: number) {
  try {
    localStorage.setItem(VOL, String(v));
  } catch {}
  if (ctx) master.gain.value = v;
}

function buffer(key: string, make: () => Buf) {
  let buf = cache.get(key);
  if (!buf) {
    const data = make();
    buf = ctx!.createBuffer(1, data.length, SR);
    buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
    cache.set(key, buf);
  }
  return buf;
}

// 브라우저는 사용자가 한 번 누르기 전에는 소리를 막는다. 첫 입력 때 켠다.
function unlock() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = volume();
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume().then(() => ambience(wanted));
}

// 여러 번 겹쳐 나는 소리는 직전과 다른 변주를 골라 크기와 빠르기를 흔든다 — 기계처럼 들리지 않게
// [변주들, 크기 흔들림, 빠르기 흔들림]
const VARIED: Partial<Record<Sfx, [Sfx[], number, number]>> = {
  step: [["step", "step2", "step3", "step4", "step5"], 0.12, 0.04],
  yawn: [["yawn", "yawn2", "yawn3"], 0.15, 0.12], // 빠르기 ±12% ≈ 음높이 ±2반음, 길이 ±10%
};
const lastPick: Partial<Record<Sfx, number>> = {};
export function play(name: Sfx, gain = 1, rate = 1) {
  if (!ctx || ctx.state !== "running" || !volume()) return;
  const varied = VARIED[name];
  if (varied) {
    const [names, g, r] = varied;
    const pick = ((lastPick[name] ?? 0) + 1 + Math.floor(Math.random() * (names.length - 1))) % names.length;
    lastPick[name] = pick;
    name = names[pick];
    gain *= 1 + (Math.random() * 2 - 1) * g;
    rate *= 1 + (Math.random() * 2 - 1) * r;
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer(name, () => render(name));
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g).connect(master);
  src.start();
}

// 환경음 크기를 정한다. 처음 부를 때 고리를 틀고, 이후에는 천천히 섞는다.
const AMB_LEVEL = 0.12; // 환경음은 아주 작게
let wanted: Partial<Record<Amb, number>> = {};
export function ambience(levels: Partial<Record<Amb, number>>) {
  wanted = levels;
  if (!ctx || ctx.state !== "running") return;
  for (const name of Object.keys(AMBIENT) as Amb[]) {
    const level = document.hidden ? 0 : (levels[name] ?? 0) * AMB_LEVEL;
    let g = amb[name];
    if (!g) {
      if (!level) continue;
      g = amb[name] = ctx.createGain();
      g.gain.value = 0;
      const src = ctx.createBufferSource();
      src.buffer = buffer(`loop-${name}`, () => renderLoop(name));
      src.loop = true;
      src.connect(g).connect(master);
      src.start();
    }
    g.gain.setTargetAtTime(level, ctx.currentTime, 0.8);
  }
}

// 역할의 능력이 어느 계열 소리를 내는가
const FAMILY: Record<Role, Sfx> = {
  doctor: "heal",
  survivor: "heal",
  lookout: "look",
  investigator: "look",
  tracker: "look",
  snitch: "look",
  blocker: "trap",
  trapper: "trap",
  provoker: "trap",
  cleaner: "trap",
  blamer: "trap",
  thief: "trap",
  serialKiller: "attack",
  bomber: "attack",
  sorcerer: "hex",
  haunter: "hex",
};

// 화면 어디서든: 첫 입력에 소리를 켜고, 버튼을 누르면 딸깍 소리를 낸다
export function useUiSound() {
  useEffect(() => {
    const onDown = () => unlock();
    const onClick = (e: MouseEvent) => {
      const b = e.target instanceof Element ? e.target.closest("button") : null;
      if (b) play(b.closest('[role="tablist"], .tabs') ? "tab" : "click");
    };
    const onHide = () => ambience(wanted);
    addEventListener("pointerdown", onDown, true);
    addEventListener("keydown", onDown, true);
    addEventListener("click", onClick, true);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      removeEventListener("pointerdown", onDown, true);
      removeEventListener("keydown", onDown, true);
      removeEventListener("click", onClick, true);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);
}

// 서버 상태가 바뀐 것을 보고 소리를 낸다. 규칙은 모르고 앞뒤 상태만 비교한다.
export function useGameSound(view: View, due: number | null) {
  const prev = useRef(view);
  useEffect(() => {
    const was = prev.current;
    prev.current = view;
    const { phase, me, players } = view;
    const alive = (v: View) => v.players.filter((p) => p.alive).length;
    const later = (name: Sfx, ms: number) => setTimeout(() => play(name), ms);

    if (was.code !== view.code) return;
    if (phase !== was.phase || view.day !== was.day) {
      if (phase === "night") play("night");
      else if (phase === "day") play("day");
      else if (phase === "ended") play(players.find((p) => p.id === me.id)?.won ? "win" : "lose");
      // 밤사이 죽었으면 낮 종소리 뒤에, 낮에 추방됐으면 밤 종소리 앞에
      if (alive(view) < alive(was) && phase !== "ended") was.phase === "day" ? play("exile") : later("death", 900);
    }
    if (me.role && !was.me.role) later("reveal", 300);
    if (players.some((p) => p.mayor) && !was.players.some((p) => p.mayor)) play("mayor");
    if (phase === "lobby" && was.phase === "lobby" && players.length !== was.players.length)
      play(players.length > was.players.length ? "join" : "leave");

    const last = view.chat.at(-1);
    if (view.chat.length > was.chat.length && last?.name && last.name !== players.find((p) => p.id === me.id)?.name) play("chat");

    if (phase === was.phase) {
      const picked = (v: View) => v.players.filter((p) => p.picked).length;
      if (phase === "day" && me.pick !== was.me.pick && me.pick) play("vote");
      else if (phase === "day" && picked(view) > picked(was)) play("vote", 0.4);
      const act = me.act;
      if (phase === "night" && act && act.mode !== "rest" && (act.mode !== was.me.act?.mode || act.target !== was.me.act?.target))
        play(act.mode === "kill" || act.mode === "detonate" ? "attack" : act.mode === "armor" ? "heal" : me.role ? FAMILY[me.role] : "confirm");
    }
  }, [view]);

  // 낮에는 모닥불과 물소리, 밤에는 풀벌레
  const night = view.phase === "night";
  useEffect(() => {
    ambience(night ? { fire: 0.6, crickets: 1, water: 0.4 } : { fire: 1, water: 0.7 });
    return () => ambience({});
  }, [night]);

  // 마지막 10초는 째깍거린다
  const timed = view.phase === "night" || view.phase === "day";
  useEffect(() => {
    if (!due || !timed) return;
    let last = 99;
    const timer = setInterval(() => {
      const left = Math.ceil((due - Date.now()) / 1000);
      if (left !== last && left > 0 && left <= 10) play("tick", 1, left <= 3 ? 1.2 : 1);
      last = left;
    }, 200);
    return () => clearInterval(timer);
  }, [due, timed]);
}
