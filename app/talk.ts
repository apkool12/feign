// 누가 방금 무슨 말을 했고 누가 입력 중인지. 말풍선(Bubble)이 매 프레임 읽는다.
// three를 끌어오지 않게 따로 둔다 (page.tsx가 서버에서도 불러온다).
import type { Skin } from "../game";

export const EMOTE_MS = 2500;
export type EmoteId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

type EmotePose = {
  name: string;
  clip: string;
  fallback: string;
  ready: boolean;
  face: string;
};
type EmoteSlot = EmotePose & { direction: string; custom?: Partial<Record<Skin, EmotePose>> };

// 칸별 몸짓 표. ready가 false인 줄은 클립이 아직 없어 fallback으로 대신한다.
export const EMOTES = [
  { direction: "위", name: "동의", clip: "nod", fallback: "vote", ready: true, face: "happy" },
  { direction: "오른쪽 위", name: "웃음", clip: "laugh", fallback: "cheer", ready: true, face: "happy" },
  { direction: "오른쪽", name: "억울", clip: "plead", fallback: "flinch", ready: true, face: "scared" },
  {
    direction: "오른쪽 아래",
    name: "하품",
    clip: "yawn",
    fallback: "yawn",
    ready: true,
    face: "sleepy",
    custom: {
      chiikawa: { name: "훌쩍", clip: "sob_chiikawa", fallback: "sad", ready: true, face: "scared" },
      hachiware: { name: "흥얼", clip: "hum_hachiware", fallback: "cheer", ready: true, face: "happy" },
      usagi: { name: "날뛰기", clip: "rampage_usagi", fallback: "cheer", ready: true, face: "happy" },
    },
  },
  { direction: "아래", name: "반대", clip: "nope", fallback: "sad", ready: true, face: "default" },
  { direction: "왼쪽 아래", name: "깜짝", clip: "startle", fallback: "startle", ready: true, face: "surprised" },
  { direction: "왼쪽", name: "의심", clip: "point", fallback: "point", ready: true, face: "default" },
  { direction: "왼쪽 위", name: "인사", clip: "wave", fallback: "vote", ready: true, face: "happy" },
] as const satisfies readonly EmoteSlot[];

export function isEmoteId(k: unknown): k is EmoteId {
  return Number.isInteger(k) && (k as number) >= 0 && (k as number) < EMOTES.length;
}

export function emoteInfo(skin: string, k: EmoteId): EmotePose {
  const base = EMOTES[k] as EmoteSlot;
  return (base.custom?.[skin as Skin] ?? base) as EmotePose;
}

export function emoteClip(skin: string, k: EmoteId) {
  const e = emoteInfo(skin, k);
  return e.ready ? e.clip : e.fallback;
}

export function emoteFace(skin: string, k: EmoteId) {
  return emoteInfo(skin, k).face;
}

type Talk = { text: string; at: number; typing: number; emote: { k: EmoteId; at: number } | null };
export const talk = new Map<string, Talk>();
const entry = (id: string) => talk.get(id) ?? talk.set(id, { text: "", at: -1e9, typing: 0, emote: null }).get(id)!;

export function said(id: string, text: string) {
  Object.assign(entry(id), { text, at: performance.now(), typing: 0 });
}
export function typing(id: string, on: boolean) {
  entry(id).typing = on ? performance.now() : 0;
}
export function emoted(id: string, k: EmoteId) {
  entry(id).emote = { k, at: performance.now() };
}
