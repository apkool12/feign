// 승률 측정 시뮬레이터. 실행: npm run sim [인원수마다 돌릴 판 수, 기본 3000]
// 단순한 봇끼리 돌려 구성(deal)별 승률을 비교한다. 사람이 하는 판의 승률이 아니라
// "임포스터 0%"나 "교착 20%" 같은 쏠림을 잡는 용도다.
//
// 봇의 규칙과 한계:
// - 봇은 view()로 자기에게 보이는 것만 본다. 조사 결과는 me.scenes로 읽는다.
// - 시민 편(정신병자 포함)은 조사 결과를 거짓 없이 공개 게시판(sus)에 점수로 올린다. 밀고·수사로 임포스터나
//   살인 중립으로 나오면 가점, 감시·추적으로 그날 밤 죽은 집에 간 사람도 가점. 점수가 3 이상인 사람이 있으면 모두 그 사람에게 투표한다.
//   없으면 25% 확률로 아무에게나, 나머지는 기권.
// - 임포스터는 밤마다 무작위로 살해(혼자 남으면 능력도 무작위로 함께)하고, 낮에는 대세를 따르되 같은 편은 찍지 않는다.
//   거짓 주장, 역할 사칭, 변호는 하지 않는다.
// - 시민은 말·표의 흐름으로 추리하지 않고 증거 없이는 거의 추방하지 않으며, 정신병자의 가짜 결과를 그대로 믿는다.
//   사람보다 훨씬 소극적이라 시민 승률이 실제보다 낮게(임포스터 승률은 높게) 나온다. 절대값보다 구성 간 차이를 볼 것.
// - 중립: 연쇄 살인범·도둑은 무작위 공격, 폭파범은 두 집에 설치하면(4명 이하면 한 집) 터뜨림, 마법사는 밤마다 50%로
//   이번 판 역할 중 하나를 찍어 저주(대부분 틀려 죽는다), 무속인은 양초만 두고 추방을 노리지 않음, 생존자는 40%로 갑옷.
// - 의사·경찰관·조사 역할은 대상을 무작위로 고른다. 시장 선거도 무작위.
import { act, advance, turnOf, newPlayer, newRoom, pick, POOL, SKIP, start, view } from "./game.ts";
import type { Rng, Role, Room, Seen, Slot, Team } from "./game.ts";

const KILLER: Role[] = ["serialKiller", "bomber", "sorcerer", "thief"];
const BENIGN: Role[] = ["survivor", "haunter"];
const evil = (s: Seen) => s.team === "imposter" || KILLER.includes(s.role);

function mulberry(seed: number): Rng {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 기획 브리프의 구성 개편안 (실험용. game.ts의 deal()은 그대로다)
// 살인 중립은 최대 1명: 6명은 비살인 중립만, 7~8명은 반반, 9명은 살인 1 + 비살인 1, 10명은 임포스터 3 + 살인 중립 1.
// 정신병자는 의사 칸을 차지하지 않는다(진짜 의사가 항상 있다).
// ponytail: 판 설정의 "직접 고르기"로 넣으므로 정신병자가 믿는 역할은 엔진이 무작위로 정한다(의사라고 믿을 수도, 다른 시민과 겹칠 수도 있다).
function proposal(n: number, rng: Rng): Slot[] {
  const any = <T>(a: T[]) => a[Math.floor(rng() * a.length)];
  const some = <T>(a: T[], k: number) => {
    const left = [...a];
    return Array.from({ length: k }, () => left.splice(Math.floor(rng() * left.length), 1)[0]);
  };
  const imposters = n >= 10 ? 3 : n >= 7 ? 2 : 1;
  const killer = n >= 9 || (n >= 7 && rng() < 0.5);
  const benign = n === 9 || (n >= 6 && n <= 8 && !killer);
  const neutral = [...(killer ? [any(KILLER)] : []), ...(benign ? [any(BENIGN)] : [])];
  const insane = n >= 5 ? 1 : 0;
  const common = POOL.innocent.filter((r) => r !== "doctor" && r !== "insane");
  const slot = (team: Team) => (role: Slot["role"]) => ({ role, team });
  return [
    ...some(POOL.imposter, imposters).map(slot("imposter")),
    ...neutral.map(slot("neutral")),
    ...["doctor" as const, ...(insane ? ["insane" as const] : []), ...some(common, n - imposters - neutral.length - 1 - insane)].map(
      slot("innocent"),
    ),
  ];
}

function play(n: number, rng: Rng, slots: Slot[] | null, calm: boolean): Room {
  const any = <T>(a: T[]) => a[Math.floor(rng() * a.length)];
  const room = newRoom("SIM");
  for (let i = 0; i < n; i++) room.players.push(newPlayer(`p${i}`, `t${i}`, `P${i}`));
  room.setup = { ...room.setup, auto: !slots, slots: slots ?? [], calm };
  start(room);
  const sus = new Map<string, number>(); // 공개 게시판: 사람마다 쌓인 의심 점수
  const blame = (id: string, n: number) => sus.set(id, (sus.get(id) ?? 0) + n);

  while (room.phase !== "ended") {
    const alive = room.players.filter((p) => p.alive);
    const ids = alive.map((p) => p.id);

    if (room.phase === "day" && room.day === 0) {
      for (const p of alive) pick(room, p, any(ids));
    } else if (room.phase === "day") {
      // 시민 편이 지난밤 결과를 공개한다
      for (const p of alive) {
        const v = view(room, p);
        if (v.me.team !== "innocent") continue;
        for (const s of v.me.scenes) {
          if (s.kind === "snitch" && s.role && s.team) blame(s.who, evil({ role: s.role, team: s.team }) ? 10 : -5);
          if (s.kind === "investigator") blame(s.who, [-2, 1.5, 4][s.options.filter(evil).length]);
          if (s.kind === "lookout" && !ids.includes(s.house)) for (const id of s.visitors) blame(id, 3);
          if (s.kind === "tracker" && s.went.some((id) => !ids.includes(id))) blame(s.who, 4);
          if (s.kind === "blocker" && s.tried) blame(s.who, 0.5);
        }
      }
      const ranked = ids.filter((id) => (sus.get(id) ?? 0) >= 3).sort((a, b) => sus.get(b)! - sus.get(a)!);
      for (const p of alive) {
        const v = view(room, p);
        const mine = (id: string) => id === p.id || v.players.find((q) => q.id === id)!.ally;
        const target = ranked.find((id) => !mine(id));
        const open = ids.filter((id) => !mine(id));
        pick(room, p, target ?? (rng() < 0.25 && open.length ? any(open) : SKIP));
      }
    } else {
      for (const p of alive) {
        room.turn = turnOf(room, p);
        const v = view(room, p);
        const { modes, role } = v.me;
        const others = ids.filter((id) => id !== p.id);
        const foes = others.filter((id) => !v.players.find((q) => q.id === id)!.ally);
        const ability = () => act(room, p, "ability", any(others.filter((id) => id !== v.me.blocked)));
        let err: string | null;
        if (modes.includes("kill")) err = act(room, p, "kill", any(foes), "", v.me.both ? any(others) : "");
        else if (role === "survivor") err = act(room, p, modes.includes("armor") && rng() < 0.4 ? "armor" : "rest");
        else if (role === "bomber") {
          const set = v.players.filter((q) => q.alive && q.bombed).length;
          const free = others.filter((id) => !v.players.find((q) => q.id === id)!.bombed);
          err = set >= 2 || (set && ids.length <= 4) || !free.length ? act(room, p, "detonate") : act(room, p, "ability", any(free));
        } else if (role === "sorcerer")
          err = rng() < 0.5 ? act(room, p, "ability", any(others), any(v.roster.filter((r) => r !== "sorcerer"))) : act(room, p, "rest");
        else if (role === "haunter") err = v.players.some((q) => q.marked) ? act(room, p, "rest") : ability();
        else err = modes.includes("ability") ? ability() : act(room, p, "rest");
        if (err) act(room, p, "rest");
      }
    }
    advance(room, rng);
  }
  return room;
}

const games = Number(process.argv[2]) || 3000;
const pct = (n: number) => `${((100 * n) / games).toFixed(1)}%`.padStart(6);

function table(title: string, slots: ((n: number, rng: Rng) => Slot[]) | null, calm: boolean) {
  console.log(`\n${title} — 인원수마다 ${games}판`);
  console.log("인원 |   시민 | 임포스터 | 중립 단독 | 무승부 | (그중 교착) | 평균 일수 | 살인 중립 있는 판");
  for (let n = 4; n <= 10; n++) {
    const rng = mulberry(n * 1000 + (calm ? 1 : 0));
    const won = { innocent: 0, imposter: 0, neutral: 0, solo: 0, draw: 0 };
    let stuck = 0;
    let days = 0;
    let killers = 0;
    for (let g = 0; g < games; g++) {
      const room = play(n, rng, slots && slots(n, rng), calm);
      won[room.winner!]++;
      if (room.why.includes("연속")) stuck++;
      days += room.day;
      if (room.roster.some((r) => KILLER.includes(r))) killers++;
    }
    console.log(
      `${String(n).padStart(4)} | ${pct(won.innocent)} |   ${pct(won.imposter)} |    ${pct(won.solo)} | ${pct(won.draw)} |      ${pct(stuck)} | ${(days / games).toFixed(2).padStart(9)} | ${pct(killers)}`,
    );
  }
}

table("현재 deal()", null, false);
table("개편안", proposal, false);
table("현재 deal() + 첫 밤 평화", null, true);
table("개편안 + 첫 밤 평화", proposal, true);
