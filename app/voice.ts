// 음성 대화. 브라우저끼리 직접 잇고(WebRTC), 서버는 연결을 맺는 쪽지만 전한다. 마이크를 켠 사람끼리만 이어진다.
// ponytail: 모두가 모두와 직접 잇는 그물이라 열 명까지만 버틴다. 공유기에 따라 안 이어질 수 있다(TURN 없음) — 그런 친구가 나오면 TURN 서버를 둔다.
// ponytail: 누구 말이 들릴지는 듣는 쪽 화면이 정한다(소리를 끌 뿐이다). 친구끼리라 믿는다. 진짜로 막으려면 서버가 소리를 중계해야 한다.
import { useSyncExternalStore } from "react";

// 목소리 설정. 사람별 크기는 이름으로 기억한다 (방을 옮겨도 남게).
export type VoicePrefs = { mic: number; out: number; ptt: boolean; quiet: boolean; peers: Record<string, number> };
const KEY = "feign-voice";
const BASE: VoicePrefs = { mic: 1, out: 1, ptt: false, quiet: true, peers: {} };
let prefs: VoicePrefs = BASE;
try {
  if (typeof localStorage !== "undefined") prefs = { ...BASE, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
} catch {
  // 저장된 값이 없거나 깨졌으면 기본값
}

type Note = { hello?: 1; re?: 1; bye?: 1; sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit };
type Peer = { pc: RTCPeerConnection; audio: HTMLAudioElement; gain: GainNode | null };

let send: (m: object) => void = () => {};
let me = "";
let stream: MediaStream | null = null; // 상대에게 보내는 소리 (마이크 크기를 거친 것)
let raw: MediaStream | null = null; // 마이크 원본
let ctx: AudioContext | null = null;
let micGain: GainNode | null = null;
let speak = true;
let pressed = false; // 눌러서 말하기 단추(V)를 누르고 있는가
let hears: (id: string) => boolean = () => true;
let names: Record<string, string> = {};

// 설정과 규칙을 지금 연결에 적용한다
function apply() {
  if (micGain) micGain.gain.value = prefs.mic;
  stream?.getAudioTracks().forEach((t) => (t.enabled = speak && (!prefs.ptt || pressed)));
  for (const [id, p] of peers) {
    const level = hears(id) ? prefs.out * (prefs.peers[names[id] ?? ""] ?? 1) : 0;
    if (p.gain) p.gain.gain.value = level;
    else p.audio.volume = Math.min(1, level);
    p.audio.muted = p.gain ? true : level === 0; // 크기 조절을 거칠 때는 원본 소리를 끈다
  }
}
const typingNow = () => ["INPUT", "TEXTAREA", "SELECT"].includes((document.activeElement as HTMLElement | null)?.tagName ?? "");
const onKey = (e: KeyboardEvent) => {
  if (e.code !== "KeyV" || e.repeat || (e.type === "keydown" && typingNow())) return;
  pressed = e.type === "keydown";
  apply();
};
const peers = new Map<string, Peer>();
const subs = new Set<() => void>();
const tell = () => subs.forEach((f) => f());
const note = (to: string, data: Note) => send({ t: "rtc", to, data });

function drop(id: string) {
  const p = peers.get(id);
  if (!p) return;
  p.pc.close();
  p.gain?.disconnect();
  p.audio.srcObject = null;
  peers.delete(id);
}

function peer(id: string): Peer {
  drop(id);
  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  const audio = new Audio();
  audio.muted = true;
  const made: Peer = { pc, audio, gain: null };
  for (const track of stream!.getTracks()) pc.addTrack(track, stream!);
  pc.onicecandidate = (e) => e.candidate && note(id, { ice: e.candidate.toJSON() });
  pc.ontrack = (e) => {
    // 소리는 크기 조절(100%를 넘겨 키울 수도 있다)을 거쳐 나간다. 브라우저에 따라 audio 요소에도 물려 둬야 소리가 흐른다.
    audio.srcObject = e.streams[0];
    void audio.play().catch(() => {});
    if (ctx && !made.gain) {
      made.gain = ctx.createGain();
      ctx.createMediaStreamSource(e.streams[0]).connect(made.gain).connect(ctx.destination);
    }
    apply();
  };
  pc.onconnectionstatechange = () => (pc.connectionState === "failed" || pc.connectionState === "closed") && peers.get(id)?.pc === pc && drop(id);
  peers.set(id, made);
  return made;
}

async function offer(id: string) {
  const { pc } = peer(id);
  await pc.setLocalDescription(await pc.createOffer());
  note(id, { sdp: pc.localDescription! });
}

export const voice = {
  // 마이크를 쓸 수 있는 곳인가 (https나 localhost에서만 된다)
  able: () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia,
  on: () => stream !== null,
  attach(sender: (m: object) => void) {
    send = sender;
  },
  async start() {
    if (stream) return;
    raw = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: prefs.quiet, autoGainControl: true } });
    // 마이크 → 크기 조절 → 보내는 소리
    ctx ??= new AudioContext();
    void ctx.resume();
    micGain = ctx.createGain();
    const out = ctx.createMediaStreamDestination();
    ctx.createMediaStreamSource(raw).connect(micGain).connect(out);
    stream = out.stream;
    addEventListener("keydown", onKey);
    addEventListener("keyup", onKey);
    apply();
    note("*", { hello: 1 }); // 이미 켜 둔 사람들과 잇는다
    tell();
  },
  stop() {
    if (!stream) return;
    note("*", { bye: 1 });
    [...peers.keys()].forEach(drop);
    removeEventListener("keydown", onKey);
    removeEventListener("keyup", onKey);
    raw?.getTracks().forEach((t) => t.stop());
    micGain?.disconnect();
    raw = stream = micGain = null;
    pressed = false;
    tell();
  },
  // 서버가 전해 준 쪽지. 둘 중 id가 앞서는 쪽이 먼저 건다(서로 동시에 걸지 않게).
  async handle(from: string, data: Note) {
    if (!stream || !data) return;
    try {
      if (data.bye) drop(from);
      else if (data.hello) me < from ? await offer(from) : !data.re && note(from, { hello: 1, re: 1 });
      else if (data.sdp) {
        const { pc } = data.sdp.type === "offer" ? peer(from) : (peers.get(from) ?? peer(from));
        await pc.setRemoteDescription(data.sdp);
        if (data.sdp.type === "offer") {
          await pc.setLocalDescription(await pc.createAnswer());
          note(from, { sdp: pc.localDescription! });
        }
      } else if (data.ice) await peers.get(from)?.pc.addIceCandidate(data.ice);
    } catch {
      drop(from); // 어긋난 연결은 버린다. 상대가 다시 켜면 새로 잇는다.
    }
  },
  // 지금 내가 말해도 되는지, 누구 말이 들려도 되는지 (대화 규칙과 같다)
  rule(id: string, canSpeak: boolean, audible: (id: string) => boolean, nameOf: Record<string, string> = {}) {
    me = id;
    speak = canSpeak;
    hears = audible;
    names = nameOf;
    apply();
  },
  prefs: () => prefs,
  // 설정을 바꾼다. 잡음 줄이기는 마이크를 다시 켤 때부터 적용된다.
  set(patch: Partial<VoicePrefs>) {
    prefs = { ...prefs, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      // 저장이 막힌 브라우저에서는 이번 접속 동안만 유지된다
    }
    apply();
    tell();
  },
  // 이 사람의 목소리 크기 (1이 기본, 0이면 안 들림)
  setPeer(name: string, level: number) {
    voice.set({ peers: { ...prefs.peers, [name]: level } });
  },
};

export function useVoicePrefs() {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    voice.prefs,
    () => BASE,
  );
}

export function useVoiceOn() {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    voice.on,
    () => false,
  );
}
