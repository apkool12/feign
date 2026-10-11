// 누가 방금 무슨 말을 했고 누가 입력 중인지. 말풍선(Bubble)이 매 프레임 읽는다.
// three를 끌어오지 않게 따로 둔다 (page.tsx가 서버에서도 불러온다).
type Talk = { text: string; at: number; typing: number };
export const talk = new Map<string, Talk>();
const entry = (id: string) => talk.get(id) ?? talk.set(id, { text: "", at: -1e9, typing: 0 }).get(id)!;

export function said(id: string, text: string) {
  Object.assign(entry(id), { text, at: performance.now(), typing: 0 });
}
export function typing(id: string, on: boolean) {
  entry(id).typing = on ? performance.now() : 0;
}
