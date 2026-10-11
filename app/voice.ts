// 음성 대화. 브라우저끼리 직접 잇고(WebRTC), 서버는 연결을 맺는 쪽지만 전한다. 마이크를 켠 사람끼리만 이어진다.
// ponytail: 모두가 모두와 직접 잇는 그물이라 열 명까지만 버틴다. 공유기에 따라 안 이어질 수 있다(TURN 없음) — 그런 친구가 나오면 TURN 서버를 둔다.
// ponytail: 누구 말이 들릴지는 듣는 쪽 화면이 정한다(소리를 끌 뿐이다). 친구끼리라 믿는다. 진짜로 막으려면 서버가 소리를 중계해야 한다.
import { useSyncExternalStore } from "react";

type Note = { hello?: 1; re?: 1; bye?: 1; sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit };
type Peer = { pc: RTCPeerConnection; audio: HTMLAudioElement };

let send: (m: object) => void = () => {};
let me = "";
let stream: MediaStream | null = null;
let speak = true;
let hears: (id: string) => boolean = () => true;
const peers = new Map<string, Peer>();
const subs = new Set<() => void>();
const tell = () => subs.forEach((f) => f());
const note = (to: string, data: Note) => send({ t: "rtc", to, data });

function drop(id: string) {
  const p = peers.get(id);
  if (!p) return;
  p.pc.close();
  p.audio.srcObject = null;
  peers.delete(id);
}

function peer(id: string): Peer {
  drop(id);
  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  const audio = new Audio();
  audio.muted = !hears(id);
  for (const track of stream!.getTracks()) pc.addTrack(track, stream!);
  pc.onicecandidate = (e) => e.candidate && note(id, { ice: e.candidate.toJSON() });
  pc.ontrack = (e) => {
    audio.srcObject = e.streams[0];
    void audio.play().catch(() => {});
  };
  pc.onconnectionstatechange = () => (pc.connectionState === "failed" || pc.connectionState === "closed") && peers.get(id)?.pc === pc && drop(id);
  const made = { pc, audio };
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
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    stream.getAudioTracks().forEach((t) => (t.enabled = speak));
    note("*", { hello: 1 }); // 이미 켜 둔 사람들과 잇는다
    tell();
  },
  stop() {
    if (!stream) return;
    note("*", { bye: 1 });
    [...peers.keys()].forEach(drop);
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
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
  rule(id: string, canSpeak: boolean, audible: (id: string) => boolean) {
    me = id;
    speak = canSpeak;
    hears = audible;
    stream?.getAudioTracks().forEach((t) => (t.enabled = canSpeak));
    for (const [who, p] of peers) p.audio.muted = !audible(who);
  },
};

export function useVoiceOn() {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    voice.on,
    () => false,
  );
}
