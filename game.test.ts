// 실행: npm test
import assert from "node:assert/strict";
import {
  turnOf,
  pass,
  act as rawAct,
  advance,
  allPicked,
  canStart,
  channel,
  configure,
  deal,
  emoteTo,
  hears,
  newPlayer,
  newRoom,
  pick,
  QUIET_MAX,
  ROLES,
  say,
  setHat,
  setHouse,
  SKIP,
  start,
  toLobby,
  view,
} from "./game.ts";
import type { Player, Role, Room, Team } from "./game.ts";

const NEUTRAL = ["survivor", "serialKiller", "bomber", "thief", "sorcerer", "haunter"];
const USES: Record<string, number> = { snitch: 1, provoker: 2, survivor: 3 };

// 고정된 난수열 (상수 난수는 "다른 값이 나올 때까지 뽑기"를 끝내지 못한다)
function seq() {
  let k = 0;
  return () => (k = (k + 0.37) % 1);
}

// "doctor" = 시민, "imp:blocker" = 임포스터, "mad:lookout" = 정신병자, 중립 역할은 자동으로 중립. 1일차 밤에서 시작.
function room(...specs: string[]): Room {
  const r = newRoom("TEST");
  r.players = specs.map((spec, i) => {
    const [role, flag] = spec.split(":").reverse();
    const p = newPlayer(`p${i}`, `secret${i}`, `P${i}`);
    p.role = role as Role;
    p.team = (flag === "imp" ? "imposter" : NEUTRAL.includes(role) ? "neutral" : "innocent") as Team;
    p.insane = flag === "mad";
    p.uses = USES[role] ?? null;
    return p;
  });
  r.roster = r.players.map((p) => p.role);
  r.phase = "night";
  r.day = 1;
  return r;
}
// 밤 행동을 넣고 정산한다. 값은 "kill p3", "ability p3", "ability p3 doctor", "rest", "armor", "detonate"
const act = (r: Room, p: Player, ...rest: string[]) => ((r.turn = Math.max(0, turnOf(r, p))), rawAct(r, p, ...(rest as [string])));
function night(r: Room, map: Record<number, string>) {
  r.phase = "night";
  for (const [i, s] of Object.entries(map)) {
    const [mode, target, guess] = s.split(" ");
    assert.equal(act(r, r.players[+i], mode, target, guess), null, s);
  }
  advance(r, seq());
}
// 낮 투표를 넣고 정산한다
function day(r: Room, map: Record<number, string>) {
  r.phase = "day";
  for (const [i, t] of Object.entries(map)) assert.equal(pick(r, r.players[+i], t), null);
  advance(r, seq());
}
const notes = (p: Player) => p.notes.join("\n");

// 역할 배분: 인원수와 맞고, 임포스터가 과반이 아니고, 의사가 있고, 5명부터 정신병자가 한 명
for (let n = 4; n <= 10; n++) {
  const hands = deal(n, seq());
  assert.equal(hands.length, n);
  assert.ok(hands.filter((h) => h.team === "imposter").length * 2 < n);
  assert.equal(hands.filter((h) => h.role === "doctor").length, 1);
  assert.equal(hands.filter((h) => h.insane).length, n >= 5 ? 1 : 0);
  assert.ok(hands.every((h) => !h.insane || h.team === "innocent"));
}

// view: 남의 역할과 토큰이 새지 않고, 정신병자는 자기 정체를 모르고, 임포스터끼리는 서로를 안다
{
  const r = room("doctor", "doctor", "doctor", "doctor", "doctor", "doctor", "doctor");
  start(r);
  assert.equal(r.day, 0);
  // 선거 중에는 아직 역할이 없다
  assert.equal(view(r, r.players[0]).me.role, null);
  assert.ok(view(r, r.players[0]).players.every((p) => p.label === null && !p.ally));
  r.players.forEach((p) => pick(r, p, "p1"));
  advance(r, seq());
  assert.equal(r.mayor, "p1");
  assert.equal(r.phase, "night");
  assert.equal(r.day, 1);
  assert.ok(view(r, r.players[0]).players[1].mayor);
  assert.ok(view(r, r.players[0]).me.role);
  const mad = r.players.find((p) => p.insane)!;
  const v = view(r, mad);
  assert.ok(!JSON.stringify(v).includes("secret"));
  assert.ok(!JSON.stringify(v).includes("정신병자"));
  assert.equal(v.players.filter((p) => p.label !== null).length, 1);
  const imp = r.players.find((p) => p.team === "imposter")!;
  assert.equal(view(r, imp).players.filter((p) => p.label !== null).length, 2);
}

// 시장의 0.1표가 동률을 가른다
{
  const make = () => room("imp:cleaner", "doctor", "lookout", "tracker", "snitch", "provoker");
  const tie = { 1: "p0", 2: "p0", 3: "p0", 0: "p1", 4: "p1", 5: "p1" };

  const r = make();
  r.mayor = "p1";
  day(r, tie); // 3.1표 대 3표
  assert.equal(r.players[0].alive, false);
  assert.ok(r.log.includes("1일차 득표: P0 3표, P1 3표")); // 시장의 0.1표는 알리지 않는다
  assert.ok(!r.log.some((l) => l.includes("→"))); // 누가 누구를 찍었는지는 알리지 않는다
  assert.equal(r.winner, "innocent");

  const r2 = make(); // 시장이 없으면 3표 대 3표는 과반이 아니다
  day(r2, tie);
  assert.ok(r2.players.every((p) => p.alive));
  day(r2, { 1: "p0", 2: "p0" }); // 최다 득표여도 과반이 아니면 추방되지 않는다
  assert.ok(r2.players.every((p) => p.alive));
}

// 의사의 치료와 제약, 추적자, 같은 편의 행동 표시
{
  const r = room("imp:cleaner", "doctor", "lookout", "tracker", "imp:blamer", "snitch", "provoker");
  const [imp, doc, seen, tracker, imp2] = r.players;
  assert.ok(act(r, seen, "ability", "p2")); // 의사가 아니면 자신을 고를 수 없다
  assert.ok(act(r, imp, "kill", "p4")); // 같은 편은 죽일 수 없다
  assert.ok(act(r, doc, "kill", "p0")); // 시민은 살해를 고를 수 없다
  assert.equal(act(r, imp, "kill", "p2"), null);
  assert.equal(view(r, imp2).players[0].doing, "살해 → P2");
  assert.equal(view(r, doc).players[0].doing, null);
  night(r, { 1: "ability p2", 3: "ability p0" });
  assert.equal(seen.alive, true);
  assert.match(notes(doc), /P2 님을 공격에서 지켜냈습니다/);
  assert.match(notes(seen), /공격을 받았지만 의사가 살려 냈습니다/);
  assert.match(notes(tracker), /P0 님은 P2 님 집에 갔습니다/);
  assert.deepEqual(view(r, doc).news, ["1일차 밤: 아무도 죽지 않았습니다.", doc.notes[0]]);
  r.phase = "night";
  assert.ok(act(r, doc, "ability", "p2")); // 이틀 연속 같은 사람은 안 된다
  assert.equal(view(r, doc).me.blocked, "p2");
}

// 경찰관은 외출을 막고, 감시자는 방문자를 보고, 덫은 방문자를 잡는다
{
  const r = room("imp:blamer", "blocker", "lookout", "trapper", "doctor");
  night(r, { 0: "kill p4", 1: "ability p0", 2: "ability p1", 3: "ability p4", 4: "ability p1" });
  assert.equal(r.players[4].alive, true);
  assert.match(notes(r.players[1]), /P0 님은 외출을 시도했습니다/);
  assert.match(notes(r.players[0]), /경찰관에게 막혀/);
  assert.match(notes(r.players[2]), /P1 님 집에 P4 님이 찾아왔습니다/);
  assert.match(notes(r.players[3]), /아무도 걸리지 않았습니다/);
  r.phase = "night";
  // 경찰관은 어젯밤 막은 집만 연달아 못 막는다
  assert.ok(act(r, r.players[1], "ability", "p0"));
  assert.equal(act(r, r.players[1], "ability", "p2"), null);
  // 의사는 자신을 치료할 수 있지만 연달아는 안 되고, 자기 치료는 외출이 아니다
  const doc = r.players[4];
  assert.equal(act(r, doc, "ability", "p4"), null);
  assert.ok(act(r, r.players[2], "ability", "p2")); // 다른 역할은 자신을 고를 수 없다
  night(r, { 1: "ability p4", 4: "ability p4" });
  assert.match(r.players[1].notes.at(-1)!, /P4 님은 외출을 시도하지 않았습니다/);
  r.phase = "night";
  assert.ok(act(r, doc, "ability", "p4"));
  night(r, { 4: "ability p0" });
  night(r, { 0: "kill p4", 4: "ability p4" });
  assert.equal(doc.alive, true);

  const r2 = room("imp:blamer", "trapper", "doctor", "lookout", "tracker");
  night(r2, { 0: "kill p2", 1: "ability p2" });
  assert.equal(r2.players[2].alive, true);
  assert.match(notes(r2.players[1]), /누군가 걸렸습니다/);
  assert.match(notes(r2.players[0]), /덫에 걸려 오늘 밤 행동하지 못했습니다/);
}

// 연쇄 살인범: 막히지 않고, 감시에 안 보이고, 당한 사람은 행동하지 못하고, 죽은 사람의 역할은 가려진다
{
  const r = room("serialKiller", "imp:cleaner", "blocker", "doctor", "lookout");
  night(r, { 0: "ability p1", 1: "kill p3", 2: "ability p0", 4: "ability p1" });
  assert.equal(r.players[1].alive, false);
  assert.equal(r.players[1].reveal, "알 수 없음");
  assert.equal(r.players[3].alive, true);
  assert.match(notes(r.players[4]), /아무도 오지 않았습니다/);
  assert.equal(r.winner, null); // 연쇄 살인범이 살아 있으면 끝나지 않는다

  const r2 = room("serialKiller", "doctor", "lookout");
  night(r2, { 0: "ability p1" });
  assert.equal(r2.winner, "solo"); // 1:1이 되면 단독 승리
  assert.match(r2.result, /P0 님 단독 승리/);
  assert.deepEqual(r2.players.map((p) => p.won), [true, false, false]);
}

// 선동 표만으로는 추방되지 않는다 (3명이면 과반이 1.5표인데 선동은 1.5표까지만)
{
  const r = room("imp:provoker", "doctor", "lookout");
  r.players[1].provoked = true;
  day(r, {});
  assert.equal(r.players[1].alive, true);
  assert.ok(r.log.includes("1일차 득표: P1 1.5표"));
}

// 연쇄 살인범에게 죽어 역할이 가려져도 같은 편은 정체를 안다
{
  const r = room("serialKiller", "imp:cleaner", "imp:blamer", "doctor", "lookout", "tracker", "snitch");
  night(r, { 0: "ability p1" });
  assert.equal(r.players[1].reveal, "알 수 없음");
  assert.equal(view(r, r.players[2]).players[1].label, "청소부(임포스터)");
  assert.equal(view(r, r.players[3]).players[1].label, "알 수 없음");
}

// 수사관·밀고자·선동꾼
{
  const r = room("imp:cleaner", "investigator", "snitch", "provoker", "doctor");
  const [imp, inv, snitch, provoker] = r.players;
  night(r, { 1: "ability p0", 2: "ability p0", 3: "ability p0" });
  assert.match(notes(inv), /P0 님은 .*청소부\(임포스터\).*입니다/);
  assert.match(notes(snitch), /P0 님의 역할은 청소부\(임포스터\)입니다/);
  assert.equal(snitch.uses, 0);
  assert.equal(provoker.uses, 1);
  assert.ok(view(r, imp).players[0].provoked);
  r.phase = "night";
  assert.ok(!view(r, snitch).me.modes.includes("ability")); // 한 번 쓰면 끝
  assert.equal(act(r, snitch, "ability", "p0"), "능력 횟수를 모두 썼어요");
  day(r, { 4: "p0" }); // 선동 2표 + 1표 = 5명 중 과반
  assert.equal(imp.reveal, "청소부(임포스터)");
  assert.equal(r.winner, "innocent");
}

// 청소부는 역할을 가리고, 남탓쟁이는 임포스터로 보이게 한다
{
  const r = room("imp:cleaner", "imp:blamer", "doctor", "lookout", "tracker", "snitch", "provoker");
  night(r, { 0: "ability p2", 1: "ability p3" });
  night(r, { 0: "kill p2", 1: "kill p3" }); // 임포스터마다 한 명씩 죽일 수 있다
  assert.equal(r.players[2].reveal, "알 수 없음");
  assert.match(r.players[3].reveal!, /\(임포스터\)$/);
}

// 도둑은 죽인 상대의 역할과 진영을 빼앗는다
{
  const r = room("thief", "imp:cleaner", "doctor", "lookout", "tracker");
  night(r, { 0: "ability p1" });
  assert.equal(r.players[1].alive, false);
  assert.equal(r.players[0].role, "cleaner");
  assert.equal(r.players[0].team, "imposter");
  assert.equal(r.winner, null);
}

// 폭파범: 설치한 폭탄을 나중에 한꺼번에 터뜨린다
{
  const r = room("bomber", "imp:cleaner", "doctor", "lookout");
  night(r, { 0: "ability p1" });
  assert.equal(r.players[1].alive, true);
  assert.ok(view(r, r.players[0]).players[1].bombed); // 폭파범만 설치한 집을 본다
  assert.ok(!view(r, r.players[2]).players[1].bombed);
  night(r, { 0: "ability p2" });
  night(r, { 0: "detonate" });
  assert.deepEqual(r.players.map((p) => p.alive), [true, false, false, true]);
  assert.equal(r.winner, "solo");
}

// 폭탄을 터뜨리러 나가는 것도 외출이라 경찰관이 막을 수 있다
{
  const r = room("bomber", "blocker", "doctor", "lookout", "imp:cleaner");
  night(r, { 0: "ability p2" });
  night(r, { 0: "detonate", 1: "ability p0" });
  assert.equal(r.players[2].alive, true);
  assert.match(notes(r.players[1]), /P0 님은 외출을 시도했습니다/);
}

// 혼자 남은 임포스터는 살해와 능력을 함께 쓸 수 있다
{
  const two = room("imp:cleaner", "imp:blamer", "doctor", "lookout", "tracker", "snitch", "provoker");
  assert.ok(act(two, two.players[0], "kill", "p2", "", "p3"));
  const r = room("imp:cleaner", "doctor", "lookout", "tracker");
  assert.ok(view(r, r.players[0]).me.both);
  assert.equal(act(r, r.players[0], "kill", "p1", "", "p2"), null);
  assert.equal(act(r, r.players[3], "ability", "p0"), null);
  advance(r, seq());
  assert.match(notes(r.players[3]), /P0 님은 P1, P2 님 집에 갔습니다/); // 추적자는 두 집을 모두 본다
  assert.equal(r.players[1].alive, false);
  assert.equal(r.players[2].cleaned, true);
}

// 유언: 밤에 죽은 사람은 다음 낮에 모두에게 한마디를 남길 수 있고, 그 전에는 비밀을 볼 수 없다
{
  const r = room("imp:cleaner", "snitch", "doctor", "lookout", "tracker");
  const dead = r.players[1];
  night(r, { 0: "kill p1", 1: "ability p0" });
  assert.equal(dead.alive, false);
  assert.match(notes(dead), /청소부\(임포스터\)/); // 죽은 밤의 결과는 받는다
  assert.equal(view(r, dead).players[0].label, null);
  assert.equal(say(r, dead, "P0가 임포스터"), null);
  assert.deepEqual(view(r, r.players[2]).chat.at(-1), { name: "P1", text: "(유언) P0가 임포스터", to: "all" });
  assert.ok(view(r, dead).players[0].label);
  assert.equal(say(r, dead, "한 번 더"), null);
  assert.equal(r.chat.at(-1)!.to, "dead");
}

// 마법사: 맞히면 상대가(치료 불가), 틀리면 자신이 죽는다
{
  {
    // 마법사의 차례가 지나면 번개 맞은 집이 모두에게 보인다 (틀리면 자기 집)
    const b = room("sorcerer", "imp:cleaner", "doctor", "lookout");
    assert.equal(act(b, b.players[0], "ability", "p2", "doctor"), null);
    assert.deepEqual(view(b, b.players[3]).bolts, []);
    pass(b);
    assert.deepEqual(view(b, b.players[3]).bolts, ["p2"]);
    b.players[0].act!.guess = "lookout";
    assert.deepEqual(view(b, b.players[3]).bolts, ["p0"]);
  }
  const r = room("sorcerer", "imp:cleaner", "doctor", "lookout");
  assert.ok(act(r, r.players[0], "ability", "p1")); // 역할을 골라야 한다
  night(r, { 0: "ability p1 cleaner", 2: "ability p1" });
  assert.equal(r.players[1].alive, false);
  night(r, { 0: "ability p2 lookout" });
  assert.equal(r.players[0].alive, false);
  assert.equal(r.winner, "innocent");
}

// 무속인: 양초를 두고 추방당하면 다음 밤 그 사람을 죽이고 함께 승리한다
{
  const r = room("haunter", "imp:cleaner", "doctor", "lookout", "tracker");
  night(r, { 0: "ability p1" });
  assert.ok(view(r, r.players[0]).players[1].marked);
  day(r, { 1: "p0", 2: "p0", 3: "p0", 4: "p0" });
  assert.equal(r.players[0].alive, false);
  night(r, {});
  assert.equal(r.players[1].alive, false);
  assert.equal(r.winner, "innocent");
  assert.deepEqual(r.players.map((p) => p.won), [true, false, true, true, true]);
}

// 생존자: 갑옷으로 공격을 막고, 누가 이기든 살아 있으면 함께 승리한다
{
  const r = room("survivor", "imp:cleaner", "doctor", "lookout");
  night(r, { 0: "armor", 1: "kill p0" });
  assert.equal(r.players[0].alive, true);
  assert.equal(r.players[0].uses, 2);
  night(r, { 1: "kill p2" });
  assert.equal(r.winner, "imposter");
  assert.deepEqual(r.players.map((p) => p.won), [true, true, false, false]);
}

// 정신병자의 능력은 전부 가짜지만 본인에게는 그럴듯한 결과가 온다
{
  const r = room("imp:cleaner", "mad:doctor", "mad:blocker", "lookout");
  night(r, { 0: "kill p3", 1: "ability p3", 2: "ability p0" });
  assert.equal(r.players[3].alive, false);
  assert.equal(r.players[3].reveal, "감시자(시민)");
  assert.match(notes(r.players[2]), /P0 님은 외출을 시도/);
  day(r, { 0: "p1", 2: "p1" });
  assert.equal(r.players[1].reveal, "정신병자(시민)"); // 죽어야 정신병자임이 드러난다
  assert.equal(r.winner, "imposter");
}

// 입력 중 표시도 말과 같은 청중 규칙을 쓴다: 밤의 시민은 범위가 없고, 임포스터의 것은 임포스터만, 죽은 사람의 것은 죽은 사람만
{
  const r = room("imp:cleaner", "imp:blamer", "doctor", "lookout", "tracker", "snitch", "provoker");
  const [imp, imp2, doc, dead] = r.players;
  assert.equal(channel(r, doc), null);
  assert.equal(channel(r, imp), "imposter");
  assert.ok(hears(r, imp2, "imposter") && !hears(r, doc, "imposter"));
  dead.alive = false;
  dead.will = false;
  assert.equal(channel(r, dead), "dead");
  assert.ok(!hears(r, doc, "dead") && !hears(r, imp, "dead") && hears(r, dead, "dead"));
  r.phase = "day";
  assert.equal(channel(r, doc), "all");
  dead.will = true; // 유언을 쓰기 전에는 저승 대화를 못 보고, 쓰는 말은 모두에게 간다
  assert.equal(channel(r, dead), "all");
  assert.ok(!hears(r, dead, "dead"));
}

// 감정표현은 유언과 무관하다: 낮·대기실·종료 뒤는 전체, 밤은 금지, 죽은 사람은 죽은 사람끼리만
{
  const r = room("imp:cleaner", "doctor", "lookout", "tracker");
  const [, doc, dead] = r.players;
  assert.equal(emoteTo(r, doc), null);
  r.phase = "lobby";
  assert.equal(emoteTo(r, doc), "all");
  r.phase = "day";
  assert.equal(emoteTo(r, doc), "all");
  dead.alive = false;
  dead.will = true;
  assert.equal(emoteTo(r, dead), "dead");
  r.phase = "ended";
  assert.equal(emoteTo(r, doc), "all");
  assert.equal(emoteTo(r, dead), "all");
}

// 대화: 밤에는 임포스터 편끼리만, 죽은 사람은 죽은 사람끼리만 보인다
{
  const r = room("imp:cleaner", "imp:blamer", "doctor", "lookout", "tracker", "snitch", "provoker");
  const [imp, imp2, doc, dead] = r.players;
  const seen = (p: Player) => view(r, p).chat.map((c) => c.text);
  assert.ok(say(r, doc, "안녕")); // 밤에 시민 편은 말할 수 없다
  assert.equal(say(r, imp, "  P2 죽이자  "), null);
  dead.alive = false;
  assert.equal(say(r, dead, "범인은 P0"), null);
  r.phase = "day";
  assert.equal(say(r, doc, "좋은 아침"), null);
  assert.deepEqual(seen(doc), ["좋은 아침"]);
  assert.deepEqual(seen(imp2), ["P2 죽이자", "좋은 아침"]);
  assert.deepEqual(seen(dead), ["범인은 P0", "좋은 아침"]);
  r.phase = "ended";
  assert.equal(seen(doc).length, 3);
}

// 폭탄을 터뜨리러 나간 것은 추적자에게도 외출이다 (들른 집은 없다)
{
  const r = room("bomber", "tracker", "doctor", "lookout", "imp:cleaner");
  night(r, { 0: "ability p2" });
  night(r, { 0: "detonate", 1: "ability p0", 2: "ability p3" });
  assert.match(notes(r.players[1]), /P0 님은 외출했지만 들른 집은 없습니다/);
  assert.deepEqual(view(r, r.players[1]).me.scenes, [{ kind: "tracker", who: "p0", went: [], out: true }]);
}

// 연쇄 살인범의 습격에도 갑옷은 발동한다. 경찰관에게 막히면 못 쓴다.
{
  const r = room("survivor", "serialKiller", "imp:blocker", "doctor", "lookout");
  night(r, { 0: "armor", 1: "ability p0" });
  assert.equal(r.players[0].alive, true);
  assert.equal(r.players[0].uses, 2);
  assert.doesNotMatch(notes(r.players[0]), /습격/);
  night(r, { 0: "armor", 1: "ability p0", 2: "ability p0" });
  assert.equal(r.players[0].alive, false);
}

// 장면: 글자 결과와 같은 내용이 구조화되어 본인에게만 간다
{
  const r = room("imp:blamer", "blocker", "lookout", "trapper", "doctor", "tracker", "investigator", "snitch");
  night(r, { 0: "kill p4", 1: "ability p0", 2: "ability p1", 3: "ability p4", 4: "ability p1", 5: "ability p4", 6: "ability p0", 7: "ability p0" });
  const scenes = (i: number) => view(r, r.players[i]).me.scenes;
  assert.deepEqual(scenes(0), [{ kind: "blocked" }]);
  assert.deepEqual(scenes(1), [{ kind: "blocker", who: "p0", tried: true }, { kind: "healed" }]);
  assert.deepEqual(scenes(2), [{ kind: "lookout", house: "p1", visitors: ["p4"] }]);
  assert.deepEqual(scenes(3), [{ kind: "trapper", house: "p4", caught: true }]);
  assert.deepEqual(scenes(4), [{ kind: "doctor", who: "p1", saved: false }]);
  assert.deepEqual(scenes(5), [{ kind: "trapped" }]); // 덫에 걸린 추적자는 아무것도 보지 못한다
  const [inv] = scenes(6);
  assert.ok(inv.kind === "investigator" && inv.options.some((o) => o.role === "blamer" && o.team === "imposter"));
  assert.deepEqual(scenes(7), [{ kind: "snitch", who: "p0", role: "blamer", team: "imposter" }]);
  assert.equal(view(r, r.players[1]).history, null); // 복기 기록은 끝나기 전에는 내려가지 않는다
  day(r, {});
  assert.deepEqual(scenes(2), []); // 다음 밤이 되면 지난 장면은 비운다
}

// 장면: 의사는 치료 결과를, 치료받은 사람은 다녀간 것을 안다
{
  const r = room("imp:cleaner", "doctor", "lookout", "tracker", "snitch");
  night(r, { 0: "kill p2", 1: "ability p2" });
  assert.deepEqual(view(r, r.players[1]).me.scenes, [{ kind: "doctor", who: "p2", saved: true }]);
  assert.deepEqual(view(r, r.players[2]).me.scenes, [{ kind: "rescued" }]); // 공격받고 살아난 사람은 그것을 안다
}

// 당한 쪽이 보는 장면: 죽은 사람은 수단과 상관없이 똑같은 것 하나만, 살아난 사람은 진짜 의사가 살렸을 때만
{
  const seenBy = (r: Room, i: number) => view(r, r.players[i]).me.scenes;
  const slain = [{ kind: "slain" }];
  // 임포스터의 칼
  let r = room("imp:cleaner", "doctor", "lookout", "tracker", "snitch");
  night(r, { 0: "kill p2" });
  assert.deepEqual(seenBy(r, 2), slain);
  // 연쇄 살인범: 습격 장면과 소식이 남지 않는다
  r = room("serialKiller", "doctor", "lookout", "tracker", "imp:cleaner");
  night(r, { 0: "ability p2" });
  assert.deepEqual(seenBy(r, 2), slain);
  assert.ok(!notes(r.players[2]).includes("습격"));
  // 도둑
  r = room("thief", "imp:cleaner", "doctor", "lookout", "tracker");
  night(r, { 0: "ability p3" });
  assert.deepEqual(seenBy(r, 3), slain);
  // 정신병자 의사가 다녀간 사람이 죽으면 의사가 왔다는 것을 모른다 (알면 그 의사가 가짜임이 드러난다)
  r = room("imp:cleaner", "mad:doctor", "lookout", "tracker", "snitch");
  night(r, { 0: "kill p2", 1: "ability p2" });
  assert.deepEqual(seenBy(r, 2), slain);
  assert.ok(!notes(r.players[2]).includes("의사"));
  // 폭탄과 번개는 모두가 발표로 본다. 개인 장면이 없다.
  r = room("bomber", "imp:cleaner", "doctor", "lookout", "tracker");
  night(r, { 0: "ability p3" });
  advance(r, seq());
  night(r, { 0: "detonate" });
  assert.deepEqual(seenBy(r, 3), []);
  r = room("sorcerer", "imp:cleaner", "doctor", "lookout");
  night(r, { 0: "ability p3 lookout" });
  assert.equal(r.players[3].alive, false);
  assert.deepEqual(seenBy(r, 3), []);
  // 공격이 없었으면 의사가 다녀간 것만 안다. 정신병자 의사도 똑같이 보인다.
  r = room("imp:cleaner", "doctor", "lookout", "tracker", "snitch");
  night(r, { 1: "ability p2" });
  assert.deepEqual(seenBy(r, 2), [{ kind: "healed" }]);
  r = room("imp:cleaner", "mad:doctor", "lookout", "tracker", "snitch");
  night(r, { 1: "ability p2" });
  assert.deepEqual(seenBy(r, 2), [{ kind: "healed" }]);
  // 갑옷으로 산 사람은 구조된 것이 아니다
  r = room("survivor", "imp:cleaner", "doctor", "lookout", "tracker");
  night(r, { 0: "armor", 1: "kill p0", 2: "ability p0" });
  assert.equal(r.players[0].alive, true);
  assert.deepEqual(seenBy(r, 0), [{ kind: "healed" }]);
  // 평화로운 첫 밤에는 구조도 없다
  r = room("imp:cleaner", "doctor", "lookout", "tracker", "snitch");
  r.setup.calm = true;
  night(r, { 0: "kill p2", 1: "ability p2" });
  assert.deepEqual(seenBy(r, 2), [{ kind: "healed" }]);
}

// 정신병자는 글자 결과와 똑같은 가짜 장면을 받는다
{
  const r = room("imp:cleaner", "mad:lookout", "mad:blocker", "mad:investigator", "doctor", "tracker");
  night(r, { 0: "kill p5", 1: "ability p4", 2: "ability p0", 3: "ability p0" });
  const name = (id: string) => r.players.find((p) => p.id === id)!.name;
  const [look] = view(r, r.players[1]).me.scenes;
  assert.ok(look.kind === "lookout" && look.house === "p4");
  assert.match(notes(r.players[1]), look.visitors.length ? new RegExp(`${name(look.visitors[0])} 님이 찾아왔습니다`) : /아무도 오지 않았습니다/);
  const [block] = view(r, r.players[2]).me.scenes;
  assert.ok(block.kind === "blocker" && block.who === "p0");
  assert.match(notes(r.players[2]), block.tried ? /시도했습니다/ : /시도하지 않았습니다/);
  assert.deepEqual(view(r, r.players[0]).me.scenes, []); // 가짜 경찰관은 아무도 막지 못한다
  const [inv] = view(r, r.players[3]).me.scenes;
  assert.ok(inv.kind === "investigator");
  for (const o of inv.options) assert.ok(notes(r.players[3]).includes(ROLES[o.role].name));
}

// 첫 밤 평화: 켜면 1일차 밤에는 아무도 죽지 않지만 능력과 정보는 그대로다. 2일차부터는 평소대로.
{
  const r = room("imp:cleaner", "serialKiller", "doctor", "lookout", "tracker", "snitch");
  r.setup.calm = true;
  night(r, { 0: "kill p2", 1: "ability p3", 4: "ability p0" });
  assert.ok(r.players.every((p) => p.alive));
  assert.match(notes(r.players[4]), /P0 님은 P2 님 집에 갔습니다/);
  assert.match(notes(r.players[3]), /습격을 받아/);
  r.day = 2;
  night(r, { 0: "kill p2" });
  assert.equal(r.players[2].alive, false);
}

// 교착 무승부: 서로 이길 수 없는 사람들만 남아도 판이 끝난다. 종료 사유가 남는다.
{
  const r = room("imp:cleaner", "sorcerer"); // 마법사는 살해에 죽지 않는다
  for (let i = 1; i < QUIET_MAX; i++) {
    if (i % 2) night(r, { 0: "kill p1" });
    else day(r, {});
    assert.equal(r.winner, null);
  }
  day(r, {});
  assert.equal(r.winner, "draw");
  assert.match(r.why, /6번 연속으로 아무도 죽거나 추방되지 않았습니다/);
  assert.match(r.log.at(-1)!, /무승부.*6번 연속/);

  const r2 = room("imp:cleaner", "doctor", "lookout", "tracker", "snitch");
  for (let i = 0; i < QUIET_MAX - 1; i++) day(r2, {});
  night(r2, { 0: "kill p1" }); // 누가 죽으면 다시 센다
  assert.equal(r2.winner, null);
  assert.equal(r2.quiet, 0);
}

// 승리 사유
{
  const r = room("imp:cleaner", "doctor", "lookout");
  night(r, { 0: "kill p1" });
  assert.equal(view(r, r.players[0]).why, "임포스터가 남은 사람의 절반 이상입니다");
  const r2 = room("imp:cleaner", "doctor", "lookout");
  day(r2, { 1: "p0", 2: "p0" });
  assert.equal(r2.why, "임포스터와 살인 중립이 모두 사라졌습니다");
}

// 복기 기록: 밤과 낮마다 쌓이고, 끝난 뒤에만 내려간다
{
  const r = room("imp:cleaner", "doctor", "mad:lookout", "tracker", "snitch");
  night(r, { 0: "kill p3", 1: "ability p3", 2: "ability p0" });
  assert.ok(r.players.every((p) => view(r, p).history === null));
  day(r, { 1: "p0", 2: "p0", 3: "p0" });
  assert.equal(r.winner, "innocent");
  const h = view(r, r.players[4]).history!;
  assert.equal(h.length, 2);
  assert.ok(h[0].kind === "night" && h[1].kind === "day");
  if (h[0].kind === "night") {
    assert.deepEqual(h[0].acts[0], { by: "p0", role: "cleaner", fake: false, mode: "kill", target: "p3", extra: null, guess: null, stopped: null });
    assert.equal(h[0].acts[2].fake, true);
    assert.equal(h[0].acts[4].mode, "rest");
    assert.deepEqual(h[0].hits, [{ by: "p0", victim: "p3", kind: "kill", died: false }]);
  }
  if (h[1].kind === "day") {
    assert.equal(h[1].chosen, "p0");
    assert.deepEqual(h[1].tally, [{ id: "p0", votes: 3 }]);
    assert.deepEqual(h[1].ballots[4], { by: "p4", to: SKIP });
  }
}

// 밤의 차례: 발동 순서대로 돌고, 자기 차례에만 고른다. 임포스터 편은 역할과 상관없이 임포스터 차례다.
{
  const r = room("imp:blocker", "doctor", "lookout", "blocker");
  const [imp, doc, seen, cop] = r.players;
  r.turn = 0; // 경찰관 → 임포스터 → 의사 → 감시자
  assert.deepEqual(view(r, doc).turn, { names: ["경찰관"], mine: false });
  assert.equal(view(r, cop).turn!.mine, true);
  assert.deepEqual(view(r, doc).me.modes, []);
  assert.equal(rawAct(r, doc, "ability", "p2"), "지금은 내 차례가 아니에요");
  assert.equal(rawAct(r, imp, "ability", "p1"), "지금은 내 차례가 아니에요"); // 임포스터 경찰관은 경찰관 차례에 고르지 않는다
  assert.equal(rawAct(r, cop, "ability", "p0"), null);
  assert.equal(view(r, doc).players[3].picked, false); // 남이 골랐는지는 보이지 않는다
  assert.equal(view(r, cop).players[3].picked, true);
  assert.equal(pass(r), true);
  assert.deepEqual(view(r, doc).turn, { names: ["임포스터"], mine: false });
  assert.equal(rawAct(r, imp, "kill", "p1"), null);
  assert.equal(rawAct(r, cop, "ability", "p1"), "지금은 내 차례가 아니에요"); // 지나간 차례는 바꿀 수 없다
  cop.alive = false; // 죽은 역할의 차례도 그대로 돈다
  assert.equal(pass(r), true);
  assert.equal(rawAct(r, doc, "ability", "p1"), null);
  assert.equal(pass(r), true);
  assert.deepEqual(view(r, seen).turn, { names: ["감시자"], mine: true });
  assert.equal(pass(r), false);
}

// 접속이 끊긴 사람은 기다리지 않는다. 고르지 않았으면 무행동/기권으로 정산된다.
{
  const r = room("imp:cleaner", "doctor", "lookout", "tracker");
  r.players[3].connected = false;
  for (const i of [0, 1]) act(r, r.players[i], "rest");
  assert.equal(allPicked(r), false);
  assert.equal(view(r, r.players[0]).pending, 0); // 밤에는 몇 명이 골랐는지 알리지 않는다
  act(r, r.players[2], "rest");
  assert.equal(allPicked(r), true);
  advance(r, seq());
  assert.equal(r.phase, "day");
}

// 새 판과 대기실 복귀: 지난 판의 흔적이 남지 않고, 판 설정과 생김새·집은 남는다
{
  const r = room("imp:cleaner", "doctor", "lookout", "tracker");
  assert.equal(configure(r, true, [], 60, 300), "대기실에서만 바꿀 수 있어요");
  r.setup = { auto: true, slots: [], night: 60, day: 300, calm: true };
  r.mayor = "p1";
  r.players[1].skin = "usagi";
  assert.ok(setHouse(r.players[1], "castle"));
  assert.equal(setHouse(r.players[1], "house-3"), null);
  assert.ok(setHat(r.players[1], "helmet"));
  assert.equal(setHat(r.players[1], "wizard"), null);
  assert.equal(say(r, r.players[0], "임포스터끼리만"), null);
  night(r, { 0: "kill p1", 3: "ability p0" }); // 평화로운 첫 밤
  day(r, {});
  night(r, { 0: "kill p1" });
  assert.equal(say(r, r.players[1], "유언"), null);
  assert.equal(say(r, r.players[1], "저승에서"), null);
  night(r, { 0: "kill p2" });
  assert.equal(r.phase, "ended");
  r.players[2].connected = false;
  toLobby(r);
  assert.deepEqual(r.players.map((p) => p.id), ["p0", "p1", "p3"]);
  const v = view(r, r.players[1]);
  assert.equal(v.phase, "lobby");
  assert.deepEqual([v.chat, v.news, v.roster, v.me.notes, v.me.scenes], [[], [], [], [], []]);
  assert.deepEqual([v.winner, v.result, v.why, v.history, v.day], [null, "", "", null, 0]);
  assert.ok(v.players.every((p) => p.alive && !p.mayor && !p.won && p.label === null));
  assert.deepEqual([v.players[1].skin, v.players[1].house, v.players[0].house], ["usagi", "house-3", "house"]);
  assert.deepEqual(v.setup, { auto: true, slots: [], night: 60, day: 300, calm: true });

  r.chat.push({ name: "P0", text: "지난 판 비밀", to: "imposter" });
  start(r); // 대기실을 거치지 않고 시작해도 대화가 남지 않는다
  assert.ok(!JSON.stringify(r.chat).includes("지난 판 비밀"));
  assert.equal(r.players[1].house, "house-3");
  assert.equal(view(r, r.players[0]).players[1].hat, "wizard"); // 모자도 판이 바뀌어도 남는다
}

// 방장이 고른 역할 구성: 잘못된 값은 거부하고, 고른 그대로 나눠 준다
{
  const r = newRoom("SET");
  for (let i = 0; i < 5; i++) r.players.push(newPlayer(`p${i}`, `secret${i}`, `P${i}`));
  const good = [
    { role: "blocker", team: "imposter" },
    { role: "doctor", team: "innocent" },
    { role: "insane", team: "innocent" },
    { role: "lookout", team: "innocent" },
    { role: "bomber", team: "neutral" },
  ];
  assert.ok(configure(r, false, [{ role: "doctor", team: "imposter" }], 90, 180)); // 의사는 임포스터가 될 수 없다
  assert.ok(configure(r, false, good, 7, 180)); // 고를 수 없는 시간
  assert.equal(configure(r, false, good.slice(1), 60, 300), null);
  assert.match(canStart(r)!, /역할은 4개인데 사람은 5명/);
  assert.equal(configure(r, false, good.slice(1).concat(good[1]), 60, 300), null);
  assert.match(canStart(r)!, /임포스터가 한 명은/);
  // 시작하자마자 끝나는 구성은 막는다
  const imp = good[0];
  assert.equal(configure(r, false, [imp, imp, imp, good[1], good[3]], 60, 300), null);
  assert.match(canStart(r)!, /시작하자마자 끝나요 \(임포스터가 남은 사람의 절반 이상/);
  const survivor = { role: "survivor", team: "neutral" };
  assert.equal(configure(r, false, [imp, good[1], survivor, survivor, survivor], 60, 300), null);
  assert.match(canStart(r)!, /시작하자마자 끝나요/);
  assert.equal(configure(r, false, good, 60, 300), null);
  assert.equal(canStart(r), null);
  // auto와 calm은 불리언만 받는다. calm을 보내지 않는 예전 클라이언트는 지금 값이 유지된다.
  assert.ok(configure(r, "x", good, 60, 300));
  assert.ok(configure(r, false, "x", 60, 300));
  assert.ok(configure(r, false, good, 60, 300, "yes"));
  assert.equal(r.setup.calm, false); // 기본은 꺼짐
  assert.equal(configure(r, false, good, 60, 300, true), null);
  assert.equal(configure(r, false, good, 60, 300), null);
  assert.equal(r.setup.calm, true);
  assert.deepEqual(r.setup.slots, good);
  assert.equal(configure(r, false, good, 60, 300, false), null);
  start(r);
  advance(r, seq());
  assert.deepEqual(r.players.map((p) => p.team).sort(), ["imposter", "innocent", "innocent", "innocent", "neutral"]);
  assert.equal(r.players.filter((p) => p.insane).length, 1);
  assert.ok(r.roster.includes("blocker") && r.roster.includes("bomber"));
  assert.ok(configure(r, true, [], 90, 180)); // 시작한 뒤에는 못 바꾼다
}

// 무작위로 수백 판을 돌려도 오류 없이 끝나고, 살아 있는 남의 역할은 임포스터끼리만 보인다
{
  let seed = 1;
  const rng = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const any = <T>(a: T[]) => a[Math.floor(rng() * a.length)];
  for (let game = 0; game < 300; game++) {
    const r = newRoom("FUZZ");
    const n = 4 + (game % 7);
    for (let i = 0; i < n; i++) r.players.push(newPlayer(`p${i}`, `secret${i}`, `P${i}`));
    start(r);
    for (let step = 0; r.phase !== "ended"; step++) {
      assert.ok(step < 3000, "게임이 끝나지 않는다");
      const alive = r.players.filter((p) => p.alive);
      for (const p of r.players) {
        const v = view(r, p);
        // 복기 기록은 진행 중에 내려가지 않고, 장면은 자기 능력의 것과 당한 것만 받는다
        assert.equal(v.history, null);
        for (const s of v.me.scenes)
          assert.ok(["blocked", "trapped", "raided", "healed", "provoked", "slain", "rescued", p.role, p.stole && "thief"].includes(s.kind), `${p.role}: ${s.kind}`);
        if (p.alive && p.team !== "imposter")
          assert.ok(v.players.every((q) => q.id === p.id || !q.alive || q.label === null));
        if (!p.alive) continue;
        if (r.phase === "day") pick(r, p, rng() < 0.3 ? SKIP : any(alive).id);
        else act(r, p, any(v.me.modes), any(alive).id, any(["doctor", "cleaner", "lookout", "thief"])); // 틀린 선택은 거부되어 무행동이 된다
      }
      advance(r, rng);
    }
    assert.ok(r.result && r.why);
    assert.ok(view(r, r.players[0]).history!.length > 0);
  }
}


// 아침 공개 목록: 모두에게 같은 내용, 원작이 공개하는 것만
{
  // 밀고자는 아침에 대상을 지목한다(모두가 본다). 알아낸 역할은 밀고자만 안다.
  const r = room("imp:cleaner", "snitch", "doctor", "lookout", "mad:snitch");
  night(r, { 0: "kill p3", 1: "ability p0", 4: "ability p2" });
  const dawns = r.players.map((p) => JSON.stringify(view(r, p).dawn));
  assert.ok(dawns.every((d) => d === dawns[0])); // 좌석마다 같은 내용
  const dawn = view(r, r.players[2]).dawn;
  assert.deepEqual(dawn[0], { kind: "death", who: "p3", reveal: "감시자(시민)", blast: false, bolt: false }); // 죽음이 먼저
  // 같은 순서의 역할끼리는 무작위라 지목 순서는 정해져 있지 않다. 가짜 밀고자도 똑같이 지목한다.
  assert.deepEqual(new Set(dawn.slice(1).map((d) => JSON.stringify(d))), new Set(['{"kind":"snitch","by":"p1","who":"p0"}', '{"kind":"snitch","by":"p4","who":"p2"}']));
  assert.ok(!dawns[0].includes("cleaner") && !dawns[0].includes("청소부")); // 알아낸 역할은 새지 않는다
  assert.ok(r.log.some((l) => l.includes("P1 님이 P0 님을 지목했습니다")));
  advance(r, seq()); // 낮 → 밤
  assert.deepEqual(view(r, r.players[1]).dawn, []);
}
{
  // 지목 대상이 그 밤에 죽으면 지목하지 않는다. 죽은 밀고자도 지목하지 않는다.
  const r = room("imp:cleaner", "snitch", "doctor", "lookout", "imp:blamer", "snitch");
  night(r, { 0: "kill p3", 1: "ability p3", 4: "kill p5", 5: "ability p0" });
  assert.deepEqual(r.dawn.filter((d) => d.kind === "snitch"), []);
}
{
  // 폭탄으로 죽으면 집이 터진 것이 모두에게 보이고, 가장 먼저 나온다
  const r = room("bomber", "imp:cleaner", "doctor", "lookout", "tracker");
  night(r, { 0: "ability p3" });
  advance(r, seq());
  night(r, { 0: "detonate", 1: "kill p4" });
  assert.deepEqual(r.dawn, [
    { kind: "death", who: "p3", reveal: "감시자(시민)", blast: true, bolt: false },
    { kind: "death", who: "p4", reveal: "추적자(시민)", blast: false, bolt: false },
  ]);
}
{
  // 도둑에게 죽은 사람의 역할은 가려진다
  const r = room("thief", "imp:cleaner", "doctor", "lookout", "tracker");
  night(r, { 0: "ability p3" });
  assert.equal(r.players[3].reveal, "알 수 없음");
}
{
  // 양초는 가장 먼저 놓여서 경찰관에게 막히지 않는다
  const r = room("haunter", "blocker", "imp:cleaner", "doctor", "lookout");
  night(r, { 0: "ability p4", 1: "ability p0" });
  assert.equal(r.players[0].mark, "p4");
}
{
  // 정신병자를 밀고하면 그가 믿는 역할로 보인다
  const r = room("imp:cleaner", "snitch", "mad:doctor", "lookout", "tracker");
  night(r, { 1: "ability p2" });
  assert.match(r.players[1].notes.join(), /P2 님의 역할은 의사\(시민\)입니다/);
}

console.log("ok");
