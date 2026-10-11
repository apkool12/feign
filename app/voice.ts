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

// who는 "누가 마이크를 켜 두었나"를 묻는 쪽지, here는 그 대답. mute는 보내는 사람의 음소거 여부.
type Note = { hello?: 1; re?: 1; bye?: 1; who?: 1; here?: 1; mute?: boolean; sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit };
type Peer = { pc: RTCPeerConnection; audio: HTMLAudioElement; gain: GainNode | null; ear: AnalyserNode | null };

let send: (m: object) => void = () => {};
let me = "";
let stream: MediaStream | null = null; // 상대에게 보내는 소리 (마이크 크기를 거친 것)
let raw: MediaStream | null = null; // 마이크 원본
let ctx: AudioContext | null = null;
let micGain: GainNode | null = null;
let speak = true;
let pressed = false; // 눌러서 말하기 단추(V)를 누르고 있는가
let mutedMe = false; // 음소거(M)
let myEar: AnalyserNode | null = null;
// 이름 옆 마이크 표시용: 마이크를 켠 사람들, 음소거한 사람들, 지금 말하는 사람들
// ponytail: 창을 그냥 닫은 사람은 bye를 못 보내 켠 채로 남는다. 방에 다시 들어오면 다시 묻는다.
const live = new Set<string>();
const muted = new Set<string>();
const talking = new Set<string>();
let meter: ReturnType<typeof setInterval> | null = null;
const loud = (a: AnalyserNode | null) => {
  if (!a) return false;
  const buf = new Uint8Array(a.fftSize);
  a.getByteTimeDomainData(buf);
  let sum = 0;
  for (const b of buf) sum += (b - 128) * (b - 128);
  return Math.sqrt(sum / buf.length) / 128 > 0.035;
};
// 0.12초마다 누가 말하는지 잰다. 내게 들리지 않는 사람(밤의 임포스터 등)은 말해도 표시하지 않는다.
function measure() {
  let changed = false;
  const put = (id: string, on: boolean) => {
    if (on === talking.has(id)) return;
    on ? talking.add(id) : talking.delete(id);
    changed = true;
  };
  if (me) put(me, !!stream && !mutedMe && speak && (!prefs.ptt || pressed) && loud(myEar));
  for (const [id, p] of peers) put(id, hears(id) && !muted.has(id) && loud(p.ear));
  for (const id of talking) if (id !== me && !peers.has(id)) put(id, false);
  if (changed) tell();
}
let hears: (id: string) => boolean = () => true;
let names: Record<string, string> = {};

// 설정과 규칙을 지금 연결에 적용한다
function apply() {
  if (micGain) micGain.gain.value = prefs.mic;
  stream?.getAudioTracks().forEach((t) => (t.enabled = speak && !mutedMe && (!prefs.ptt || pressed)));
  for (const [id, p] of peers) {
    const level = hears(id) ? prefs.out * (prefs.peers[names[id] ?? ""] ?? 1) : 0;
    if (p.gain) p.gain.gain.value = level;
    else p.audio.volume = Math.min(1, level);
    p.audio.muted = p.gain ? true : level === 0; // 크기 조절을 거칠 때는 원본 소리를 끈다
  }
}
const typingNow = () => ["INPUT", "TEXTAREA", "SELECT"].includes((document.activeElement as HTMLElement | null)?.tagName ?? "");
const onKey = (e: KeyboardEvent) => {
  if (e.code === "KeyM" && e.type === "keydown" && !e.repeat && !typingNow()) return voice.mute(); // M: 음소거
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
  const made: Peer = { pc, audio, gain: null, ear: null };
  for (const track of stream!.getTracks()) pc.addTrack(track, stream!);
  pc.onicecandidate = (e) => e.candidate && note(id, { ice: e.candidate.toJSON() });
  pc.ontrack = (e) => {
    // 소리는 크기 조절(100%를 넘겨 키울 수도 있다)을 거쳐 나간다. 브라우저에 따라 audio 요소에도 물려 둬야 소리가 흐른다.
    audio.srcObject = e.streams[0];
    void audio.play().catch(() => {});
    if (ctx && !made.gain) {
      made.gain = ctx.createGain();
      made.ear = ctx.createAnalyser();
      made.ear.fftSize = 256;
      const from = ctx.createMediaStreamSource(e.streams[0]);
      from.connect(made.gain).connect(ctx.destination);
      from.connect(made.ear);
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
    myEar = ctx.createAnalyser();
    myEar.fftSize = 256;
    micGain.connect(myEar);
    stream = out.stream;
    meter ??= setInterval(measure, 120);
    addEventListener("keydown", onKey);
    addEventListener("keyup", onKey);
    apply();
    note("*", { hello: 1, mute: mutedMe }); // 이미 켜 둔 사람들과 잇는다
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
    raw = stream = micGain = myEar = null;
    pressed = false;
    if (meter) clearInterval(meter);
    meter = null;
    talking.clear();
    tell();
  },
  // 서버가 전해 준 쪽지. 둘 중 id가 앞서는 쪽이 먼저 건다(서로 동시에 걸지 않게).
  async handle(from: string, data: Note) {
    if (!data) return;
    // 누가 켰고 누가 음소거했는지는 내 마이크가 꺼져 있어도 받아 적는다
    if (data.hello || data.here) live.add(from);
    if (data.bye) (live.delete(from), muted.delete(from), talking.delete(from));
    if (typeof data.mute === "boolean") data.mute ? muted.add(from) : muted.delete(from);
    if (data.who && stream) note(from, { here: 1, mute: mutedMe });
    if (data.hello || data.here || data.bye || typeof data.mute === "boolean") tell();
    if (!stream) return;
    try {
      if (data.bye) drop(from);
      else if (data.hello) me < from ? await offer(from) : !data.re && note(from, { hello: 1, re: 1, mute: mutedMe });
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
    if (id !== me) {
      // 새 방에 들어왔다: 누가 마이크를 켜 두었는지 묻는다
      me = id;
      live.clear();
      muted.clear();
      talking.clear();
      note("*", { who: 1 });
    }
    speak = canSpeak;
    hears = audible;
    names = nameOf;
    apply();
  },
  // 음소거를 켜고 끈다 (마이크는 켜 둔 채 내 소리만 안 나간다)
  mute() {
    if (!stream) return;
    mutedMe = !mutedMe;
    apply();
    note("*", { mute: mutedMe });
    tell();
  },
  // 이름 옆에 그릴 마이크 표시. 방에서 아무도 음성을 안 쓰면 빈 글(표시 없음).
  mark(id: string): "" | "off" | "on" | "muted" | "talk" {
    if (!stream && !live.size) return "";
    if (id === me) return !stream ? "off" : mutedMe ? "muted" : talking.has(id) ? "talk" : "on";
    return !live.has(id) ? "off" : muted.has(id) ? "muted" : talking.has(id) ? "talk" : "on";
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

export function useVoiceMark(id: string) {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => voice.mark(id),
    () => "" as const,
  );
}

export function useVoiceOn() {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    voice.on,
    () => false,
  );
}
