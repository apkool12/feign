// 실행: npm test
import assert from "node:assert/strict";
import { act, advance, deal, newPlayer, newRoom, pick, say, SKIP, start, view } from "./game.ts";
import type { Player, Role, Room, Team } from "./game.ts";

const NEUTRAL = ["survivor", "serialKiller", "bomber", "thief", "sorcerer", "haunter"];
const USES: Record<string, number> = { snitch: 1, provoker: 2, survivor: 3 };

// 고정된 난수열 (상수 난수는 "다른 값이 나올 때까지 뽑기"를 끝내지 못한다)
function seq() {
  let k = 0;
  return () => (k = (k + 0.37) % 1);
}

// "doctor" = 시민, "imp:blocker" = 임포스터, "mad:lookout" = 광인, 중립 역할은 자동으로 중립. 1일차 밤에서 시작.
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
  r.phase = "night";
  r.day = 1;
  return r;
}
// 밤 행동을 넣고 정산한다. 값은 "kill p3", "ability p3", "ability p3 doctor", "rest", "armor", "detonate"
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

// 역할 배분: 인원수와 맞고, 임포스터가 과반이 아니고, 의사가 있고, 6명부터 광인이 한 명
for (let n = 4; n <= 10; n++) {
  const hands = deal(n, seq());
  assert.equal(hands.length, n);
  assert.ok(hands.filter((h) => h.team === "imposter").length * 2 < n);
  assert.equal(hands.filter((h) => h.role === "doctor").length, 1);
  assert.equal(hands.filter((h) => h.insane).length, n >= 5 ? 1 : 0);
  assert.ok(hands.every((h) => !h.insane || h.team === "innocent"));
}

// view: 남의 역할과 토큰이 새지 않고, 광인은 자기 정체를 모르고, 임포스터끼리는 서로를 안다
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
  assert.ok(!JSON.stringify(v).includes("광인"));
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
  assert.ok(r.log.includes("득표: P0 3.1표, P1 3표"));
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
  assert.ok(act(r, doc, "ability", "p1")); // 자신은 치료할 수 없다
  assert.ok(act(r, imp, "kill", "p4")); // 같은 편은 죽일 수 없다
  assert.ok(act(r, doc, "kill", "p0")); // 시민은 살해를 고를 수 없다
  assert.equal(act(r, imp, "kill", "p2"), null);
  assert.equal(view(r, imp2).players[0].doing, "살해 → P2");
  assert.equal(view(r, doc).players[0].doing, null);
  night(r, { 1: "ability p2", 3: "ability p0" });
  assert.equal(seen.alive, true);
  assert.match(notes(doc), /P2 님을 공격에서 지켜냈습니다/);
  assert.match(notes(seen), /의사가 다녀갔습니다/);
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
  assert.ok(!view(r, r.players[1]).me.modes.includes("ability")); // 경찰관은 이틀 연속 쓸 수 없다
  night(r, {});
  r.phase = "night";
  assert.ok(view(r, r.players[1]).me.modes.includes("ability"));

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
  assert.ok(r.log.includes("득표: P1 1.5표"));
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

// 광인의 능력은 전부 가짜지만 본인에게는 그럴듯한 결과가 온다
{
  const r = room("imp:cleaner", "mad:doctor", "mad:blocker", "lookout");
  night(r, { 0: "kill p3", 1: "ability p3", 2: "ability p0" });
  assert.equal(r.players[3].alive, false);
  assert.equal(r.players[3].reveal, "감시자(시민)");
  assert.match(notes(r.players[2]), /P0 님은 외출을 시도/);
  day(r, { 0: "p1", 2: "p1" });
  assert.equal(r.players[1].reveal, "광인(시민)"); // 죽어야 광인임이 드러난다
  assert.equal(r.winner, "imposter");
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
        if (p.alive && p.team !== "imposter")
          assert.ok(v.players.every((q) => q.id === p.id || !q.alive || q.label === null));
        if (!p.alive) continue;
        if (r.phase === "day") pick(r, p, rng() < 0.3 ? SKIP : any(alive).id);
        else act(r, p, any(v.me.modes), any(alive).id, any(["doctor", "cleaner", "lookout", "thief"])); // 틀린 선택은 거부되어 무행동이 된다
      }
      advance(r, rng);
    }
    assert.ok(r.result);
  }
}

console.log("ok");
