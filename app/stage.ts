// 화면을 통째로 쓰는 연출(어젯밤 회상 등)이 지금 돌고 있는지. 다른 연출은 이것이 비기를 기다렸다가 시작한다.
// three를 끌어오지 않게 따로 둔다 (page.tsx가 서버에서도 불러온다).
import type { Scene } from "../game";

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

// 마을 안에서 장면으로 다시 보여 줄 수 있는 것
export type Flash = Extract<Scene, { kind: "lookout" | "tracker" }>;
export const flashOf = (scenes: Scene[]): Flash | null => scenes.find((s): s is Flash => s.kind === "lookout" || s.kind === "tracker") ?? null;
