// game.ts가 내는 소식 문구를 화면이 그림으로 읽어 내는지 본다
import assert from "node:assert/strict";
import { periodsOf } from "./app/timeline.ts";

const p = periodsOf([
  "게임을 시작합니다. 먼저 시장을 뽑습니다. 역할은 선거가 끝나면 정해집니다.",
  "두리 님이 시장이 되었습니다. 시장의 표는 1.1표입니다.",
  "역할이 정해졌습니다. 자신의 역할을 확인하세요.",
  "1일차 밤: 여울 님이 사망했습니다. (경찰관(시민))",
  "1일차 득표: 세찌 2표, 하나 1표",
  "세찌 님이 추방당했습니다. (선동꾼(임포스터))",
  "2일차 밤: 아무도 죽지 않았습니다.",
  "2일차 밤: 하나 님이 두리 님을 지목했습니다.",
  "모르는 줄",
]);
assert.deepEqual(p.map((x) => [x.label, x.night, x.steps.map((s) => s.kind).join()]), [
  ["시장 선거", false, "mayor"],
  ["1일차 밤", true, "dead"],
  ["1일차 낮", false, "votes,out"],
  ["2일차 밤", true, "text,point,text"],
]);
assert.deepEqual(p[1].steps[0], { kind: "dead", who: "여울", reveal: "경찰관(시민)" });
const votes = p[2].steps[0];
assert.ok(votes.kind === "votes" && votes.ballots.length === 0 && votes.tally["세찌"] === 2 && votes.tally["하나"] === 1);
assert.deepEqual(p[3].steps[1], { kind: "point", by: "하나", who: "두리" });
console.log("timeline ok");
