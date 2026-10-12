// 화면을 통째로 쓰는 연출(어젯밤 회상 등)이 지금 돌고 있는지. 다른 연출은 이것이 비기를 기다렸다가 시작한다.
// three를 끌어오지 않게 따로 둔다 (page.tsx가 서버에서도 불러온다).
import type { Dawn, Scene } from "../game";

let until = 0;
const subs = new Set<() => void>();
const tell = () => subs.forEach((f) => f());

export const stage = {
  // 지금부터 ms 동안 화면을 차지한다
  hold(ms: number) {
    until = Math.max(until, performance.now() + ms);
    tell();
  },
  // 일찍 끝났다 (건너뛰기)
  release() {
    until = 0;
    tell();
  },
  busy: () => performance.now() < until,
  left: () => Math.max(0, until - performance.now()), // 남은 시간(ms)
  subscribe(f: () => void) {
    subs.add(f);
    return () => void subs.delete(f);
  },
};

// 마을 안에서 다시 보여 줄 어젯밤의 장면들 (없으면 null)
export type Flash = Scene[];
export const flashOf = (scenes: Scene[]): Flash | null => (scenes.length ? scenes : null);

const ROOM_FLASH_KINDS = new Set<Scene["kind"]>(["healed", "rescued", "slain", "raided", "provoked", "blocked"]);
const inRoom = (scene: Scene) => ROOM_FLASH_KINDS.has(scene.kind);
export const roomFlashOf = (scenes: Scene[]): Flash | null => flashOf(scenes.filter(inRoom));
export const villageFlashOf = (scenes: Scene[]): Flash | null => flashOf(scenes.filter((scene) => !inRoom(scene)));

// 아침 발표: 밤사이 모두에게 공개된 일(events)을 광장에서 하나씩 보여 준다. mine은 내가 따로 아는 것(밀고자 본인이 알아낸 역할 등).
export type Call = { events: Dawn[]; mine: Scene[] };

// 추방: 낮 투표로 쫓겨난 사람과 공개된 정체 글
export type Exile = { who: string; reveal: string };

// 묘비가 기운 정도(라디안). 사람마다 방향과 각도가 조금 다르고, 어느 화면에서나 다시 들어와도 같다.
export function lean(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % 2 ? 1 : -1) * ((8 + (h % 400) / 100) * Math.PI) / 180;
}
