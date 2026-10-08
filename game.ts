// 게임 규칙. 서버만 실행하고, 클라이언트는 view()가 걸러 준 결과만 받는다.
// view()는 화면과 무관한 상태 스냅숏이라, 2D 화면이든 나중의 3D 마을이든 같은 값을 그리면 된다.
// (플레이어 = 집 한 채, 밤 행동 = 그 집을 방문)

export type Team = "innocent" | "imposter" | "neutral";
export type Role =
  | "doctor"
  | "blocker"
  | "lookout"
  | "investigator"
  | "trapper"
  | "snitch"
  | "provoker"
  | "tracker"
  | "cleaner"
  | "blamer"
  | "survivor"
  | "serialKiller"
  | "bomber"
  | "thief"
  | "sorcerer"
  | "haunter";
export type Mode = "ability" | "kill" | "detonate" | "armor" | "rest";
export type Phase = "lobby" | "night" | "day" | "ended";
export type Winner = Team | "solo" | "draw";
export type Rng = () => number;
export type Channel = "all" | "imposter" | "dead"; // 대화가 보이는 범위

export const SKIP = "skip";
export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 10;
export const ELECTION_MS = 60_000;
export const NIGHT_MS = 90_000;
export const DAY_MS = 180_000;
const MAYOR_BONUS = 1; // 시장의 추가 표, 0.1표 단위 (표 계산은 전부 0.1표 단위 정수로 한다)

// action: 밤에 능력을 쓸 때 버튼에 적는 말
export const ROLES: Record<Role, { name: string; action: string; desc: string }> = {
  doctor: {
    name: "의사",
    action: "치료",
    desc: "밤에 한 명을 치료해 그날 밤 공격받아도 살려 냅니다. 자신과, 어젯밤 치료한 사람은 고를 수 없습니다.",
  },
  blocker: {
    name: "경찰관",
    action: "외출 통제",
    desc: "밤에 한 명이 집 밖으로 못 나가게 막고, 나가려 했는지 알아냅니다. 이틀 연속으로는 쓸 수 없습니다.",
  },
  lookout: { name: "감시자", action: "감시", desc: "밤에 한 명의 집을 지켜보고 누가 찾아왔는지 알아냅니다." },
  investigator: {
    name: "수사관",
    action: "수사",
    desc: "밤에 한 명을 수사해 역할 후보 두 개를 얻습니다. 하나는 진짜, 하나는 가짜입니다.",
  },
  trapper: {
    name: "트래퍼",
    action: "덫 설치",
    desc: "밤에 한 명의 집 앞에 덫을 놓습니다. 그 집을 찾아온 사람 중 한 명이 걸려 그날 밤 행동하지 못합니다.",
  },
  snitch: { name: "밀고자", action: "밀고", desc: "게임 중 한 번, 한 명의 역할을 정확히 알아냅니다." },
  provoker: {
    name: "선동꾼",
    action: "선동",
    desc: "게임 중 두 번, 한 명이 다음 낮 투표를 2표 받은 채 시작하게 합니다. 선동 표만으로는 추방되지 않습니다.",
  },
  tracker: { name: "추적자", action: "추적", desc: "밤에 한 명을 추적해 그 사람이 누구 집에 갔는지 알아냅니다." },
  cleaner: {
    name: "청소부",
    action: "청소",
    desc: "고른 사람이 죽거나 추방될 때 역할이 '알 수 없음'으로 가려지게 합니다.",
  },
  blamer: {
    name: "남탓쟁이",
    action: "누명 씌우기",
    desc: "고른 사람이 죽거나 추방될 때 임포스터 역할로 공개되게 합니다.",
  },
  survivor: {
    name: "생존자",
    action: "",
    desc: "게임이 끝날 때 살아 있으면 승리합니다. 밤 공격을 막는 갑옷을 세 번 쓸 수 있습니다.",
  },
  serialKiller: {
    name: "연쇄 살인범",
    action: "살해",
    desc: "밤마다 한 명을 죽입니다. 막히지도 들키지도 않고, 공격당한 사람은 그날 밤 행동하지 못합니다. 혼자 남으면 승리합니다.",
  },
  bomber: {
    name: "폭파범",
    action: "폭탄 설치",
    desc: "밤마다 한 집에 폭탄을 설치하거나, 설치한 폭탄을 전부 터뜨립니다. 혼자 남으면 승리합니다.",
  },
  thief: {
    name: "도둑",
    action: "훔치기",
    desc: "한 명을 죽이고 그 역할과 진영을 빼앗습니다. 빼앗은 진영이 이기면 함께 승리합니다.",
  },
  sorcerer: {
    name: "마법사",
    action: "저주",
    desc: "한 명의 역할을 맞히면 그 사람이 죽고, 틀리면 자신이 죽습니다. 혼자 남으면 승리합니다.",
  },
  haunter: {
    name: "무속인",
    action: "양초 두기",
    desc: "밤에 한 명에게 양초를 둡니다. 투표로 추방당하면 다음 밤 그 사람을 죽이고 승리합니다.",
  },
};
export const TEAM_NAME: Record<Team, string> = { innocent: "시민", imposter: "임포스터", neutral: "중립" };

// 시민과 임포스터 양쪽에 나올 수 있는 역할
const COMMON: Role[] = ["blocker", "lookout", "investigator", "trapper", "snitch", "provoker", "tracker"];
const IMPOSTER_ONLY: Role[] = ["cleaner", "blamer"];
const NEUTRAL: Role[] = ["survivor", "serialKiller", "bomber", "thief", "sorcerer", "haunter"];
const INNOCENT: Role[] = ["doctor", ...COMMON];
const USES: Partial<Record<Role, number>> = { snitch: 1, provoker: 2, survivor: 3 }; // 횟수 제한
const KILLERS: Role[] = ["serialKiller", "bomber", "sorcerer", "thief"]; // 살아 있으면 게임이 안 끝나는 중립
const UNSEEN: Role[] = ["serialKiller", "sorcerer"]; // 막히지 않고 감시에도 보이지 않는다

export interface Act {
  mode: Mode;
  target: string | null;
  guess: Role | null; // 마법사가 맞히려는 역할
  extra: string | null; // 혼자 남은 임포스터가 살해와 함께 쓰는 능력의 대상
}

export interface Player {
  id: string; // 공개 id
  token: string; // 재접속용 비밀 값, 절대 view에 넣지 않는다
  name: string;
  connected: boolean;
  alive: boolean;
  role: Role; // 광인이면 본인이 믿는 역할
  team: Team;
  insane: boolean; // 광인: 능력이 전부 가짜인 시민. 본인은 모른다
  uses: number | null; // 남은 능력 횟수 (제한 없으면 null)
  act: Act | null; // 오늘 밤 행동
  pick: string | null; // 낮 투표 대상
  last: string | null; // 어젯밤 능력 대상 (의사·경찰관의 연속 지목 금지용)
  bombed: boolean; // 집에 폭탄이 설치됨
  cleaned: boolean; // 청소부가 다녀감
  blamed: Role | null; // 남탓쟁이가 씌운 역할
  provoked: boolean; // 다음 투표를 2표 안고 시작
  mark: string | null; // 무속인이 양초를 둔 대상
  haunting: boolean; // 추방된 무속인: 다음 밤에 양초 대상을 죽인다
  reveal: string | null; // 죽은 뒤 모두에게 공개되는 역할 표시
  will: boolean; // 밤에 죽으면 다음 낮에 모두에게 유언 한마디를 남길 수 있다
  stole: boolean; // 도둑이었다가 남의 역할을 빼앗음
  won: boolean;
  notes: string[]; // 본인만 보는 결과
  news: string[]; // notes 중 방금 정산에서 생긴 것
}

export interface Room {
  code: string;
  phase: Phase;
  day: number; // 0일차 낮은 시장 선거
  players: Player[];
  mayor: string | null;
  log: string[];
  news: string[]; // log 중 방금 정산에서 생긴 것
  chat: { name: string; text: string; to: Channel }[]; // name이 ""이면 시스템 안내
  winner: Winner | null;
  result: string; // 승패 문구
  deadline: number | null; // 현재 페이즈가 자동으로 넘어가는 시각 (서버가 관리)
}

export function newRoom(code: string): Room {
  return {
    code,
    phase: "lobby",
    day: 0,
    players: [],
    mayor: null,
    log: [],
    news: [],
    chat: [],
    winner: null,
    result: "",
    deadline: null,
  };
}

export function newPlayer(id: string, token: string, name: string): Player {
  return {
    id,
    token,
    name,
    connected: true,
    alive: true,
    role: "doctor",
    team: "innocent",
    insane: false,
    uses: null,
    act: null,
    pick: null,
    last: null,
    bombed: false,
    cleaned: false,
    blamed: null,
    provoked: false,
    mark: null,
    haunting: false,
    reveal: null,
    will: false,
    stole: false,
    won: false,
    notes: [],
    news: [],
  };
}

function assign(p: Player, role: Role, team: Team, insane = false) {
  p.role = role;
  p.team = team;
  p.insane = insane;
  p.uses = USES[role] ?? null;
  p.last = null;
}

function shuffle<T>(a: T[], rng: Rng): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 인원수에 맞춰 역할을 뽑는다. 임포스터 1~2명, 5명부터 광인 1명, 6명부터 중립 1명, 9명부터 중립 2명.
// ponytail: 구성은 자동. 방장이 직업을 고르는 설정은 필요해지면 추가.
export function deal(n: number, rng: Rng = Math.random): { role: Role; team: Team; insane: boolean }[] {
  const imposters = n >= 7 ? 2 : 1;
  const neutrals = n >= 9 ? 2 : n >= 6 ? 1 : 0;
  const innocents = n - imposters - neutrals;
  const out = [
    ...shuffle([...IMPOSTER_ONLY, ...COMMON], rng)
      .slice(0, imposters)
      .map((role) => ({ role, team: "imposter" as Team, insane: false })),
    ...shuffle([...NEUTRAL], rng)
      .slice(0, neutrals)
      .map((role) => ({ role, team: "neutral" as Team, insane: false })),
    ...(["doctor", ...shuffle([...COMMON], rng).slice(0, innocents - 1)] as Role[]).map((role) => ({
      role,
      team: "innocent" as Team,
      insane: false,
    })),
  ];
  if (n >= 5) out[imposters + neutrals + Math.floor(rng() * innocents)].insane = true;
  return shuffle(out, rng);
}

// 기록에 남기고 대화 흐름에도 안내로 끼워 넣는다
function announce(room: Room, line: string) {
  room.log.push(line);
  room.chat.push({ name: "", text: line, to: "all" });
}

// 역할은 시장 선거가 끝난 뒤에 정한다 (역할을 알고 뽑으면 출마만으로 의심받는다)
export function start(room: Room) {
  for (const p of room.players) Object.assign(p, newPlayer(p.id, p.token, p.name), { connected: p.connected });
  room.day = 0;
  room.mayor = null;
  room.log = [];
  room.news = [];
  room.winner = null;
  room.result = "";
  room.phase = "day";
  announce(room, "게임을 시작합니다. 먼저 시장을 뽑습니다. 역할은 선거가 끝나면 정해집니다.");
}

// 오늘 밤 고를 수 있는 행동. 경찰관은 이틀 연속으로 능력을 쓸 수 없다.
function modes(p: Player): Mode[] {
  const out: Mode[] = [];
  if (p.team === "imposter") out.push("kill");
  if (p.role === "survivor") {
    if (p.uses) out.push("armor");
  } else if (p.uses !== 0 && !(p.role === "blocker" && p.last)) out.push("ability");
  if (p.role === "bomber") out.push("detonate");
  out.push("rest");
  return out;
}

// 혼자 남은 임포스터는 한 밤에 살해와 능력을 함께 쓸 수 있다
function canDoBoth(room: Room, p: Player): boolean {
  const imposters = room.players.filter((q) => q.alive && q.team === "imposter");
  return imposters.length === 1 && imposters[0] === p && modes(p).includes("ability");
}

// 능력의 대상
const aimId = (p: Player) => (p.act?.mode === "ability" ? p.act.target : (p.act?.extra ?? null));

// 밤 행동을 기록한다. extra는 살해와 함께 쓰는 능력의 대상. 실패하면 사유를 돌려준다.
export function act(room: Room, p: Player, mode: string, target = "", guess = "", extra = ""): string | null {
  if (room.phase !== "night") return "지금은 행동할 수 없어요";
  if (!p.alive) return "죽은 사람은 행동할 수 없어요";
  if (!modes(p).includes(mode as Mode)) {
    if (mode === "ability" && p.uses === 0) return "능력 횟수를 모두 썼어요";
    if (mode === "ability" && p.role === "blocker" && p.last) return "경찰관은 이틀 연속으로 능력을 쓸 수 없어요";
    return "쓸 수 없는 행동이에요";
  }
  if (mode !== "kill" && mode !== "ability") {
    p.act = { mode: mode as Mode, target: null, guess: null, extra: null };
    return null;
  }
  const t = room.players.find((x) => x.id === target);
  if (!t || !t.alive) return "고를 수 없는 대상이에요";
  if (t === p) return "자기 자신은 고를 수 없어요";
  if (mode === "kill" && t.team === "imposter") return "같은 편은 죽일 수 없어요";
  const curse = mode === "ability" && p.role === "sorcerer";
  if (mode === "ability") {
    if (p.role === "doctor" && t.id === p.last) return "이틀 연속 같은 사람은 고를 수 없어요";
    if (curse && !Object.hasOwn(ROLES, guess)) return "맞힐 역할을 골라 주세요";
  }
  if (extra) {
    if (mode !== "kill" || !canDoBoth(room, p)) return "살해와 능력을 함께 쓸 수 없어요";
    if (extra === p.id || !room.players.some((x) => x.id === extra && x.alive)) return "고를 수 없는 대상이에요";
  }
  p.act = { mode, target: t.id, guess: curse ? (guess as Role) : null, extra: extra || null };
  return null;
}

// 낮 투표(0일차에는 시장 선거)를 기록한다. 실패하면 사유를 돌려준다.
export function pick(room: Room, p: Player, target: string): string | null {
  if (room.phase !== "day") return "지금은 투표할 수 없어요";
  if (!p.alive) return "죽은 사람은 투표할 수 없어요";
  if (target !== SKIP && !room.players.some((x) => x.id === target && x.alive)) return "고를 수 없는 대상이에요";
  p.pick = target;
  return null;
}

// 게임 중 죽은 사람은 죽은 사람끼리만, 밤에는 임포스터 편끼리만 대화한다. 그 외에는 전체 대화.
export function say(room: Room, p: Player, text: string): string | null {
  text = text.trim().slice(0, 200);
  if (!text) return "내용을 입력해 주세요";
  const playing = room.phase === "night" || room.phase === "day";
  let to: Channel = "all";
  if (playing && !p.alive) {
    if (p.will && room.phase === "day") {
      p.will = false;
      text = `(유언) ${text}`;
    } else to = "dead";
  } else if (room.phase === "night") {
    if (p.team !== "imposter") return "밤에는 대화할 수 없어요";
    to = "imposter";
  }
  room.chat.push({ name: p.name, text, to });
  if (room.chat.length > 200) room.chat.shift();
  return null;
}

// 아직 고르지 않은 사람들
function pending(room: Room): Player[] {
  const night = room.phase === "night";
  return room.players.filter((p) => p.alive && (night ? p.act : p.pick) === null);
}

export function allPicked(room: Room): boolean {
  return pending(room).length === 0;
}

// 최다 득표 대상들 (동률이면 여러 개)
function tops(count: Map<string, number>): string[] {
  const max = Math.max(0, ...count.values());
  return max ? [...count].filter(([, c]) => c === max).map(([x]) => x) : [];
}

const tag = (role: Role, team: Team) => `${ROLES[role].name}(${TEAM_NAME[team]})`;
// 본인도 모르는 것까지 포함한 진짜 정체
const truth = (p: Player) => `${p.insane ? "광인·" : ""}${tag(p.role, p.team)}${p.stole ? "·원래 도둑" : ""}`;

function die(p: Player, hidden = false) {
  p.alive = false;
  p.reveal =
    hidden || p.cleaned
      ? "알 수 없음"
      : p.blamed
        ? tag(p.blamed, "imposter")
        : p.insane
          ? `광인(${TEAM_NAME.innocent})`
          : tag(p.role, p.team);
}

// 밤 정산. 원작의 발동 순서를 따른다:
// 마법사 → 연쇄 살인범 → 경찰관 → 트래퍼 → 폭파범 → 임포스터 → 도둑 → 의사 → 생존자·선동꾼 → 수사관·밀고자 → 감시자·추적자
function resolveNight(room: Room, rng: Rng) {
  const night = `${room.day}일차 밤`;
  const all = room.players;
  const alive = all.filter((p) => p.alive);
  const byId = (id: string | null) => all.find((p) => p.id === id);
  const target = (p: Player) => byId(aimId(p))!; // 능력의 대상
  const goes = (p: Player) => [p.act?.target, p.act?.extra].filter((id) => id != null); // 찾아가는 집들
  const oneOf = <T>(a: T[]) => a[Math.floor(rng() * a.length)];
  const note = (p: Player, text: string) => p.notes.push(`${night}: ${text}`);
  // 같은 순서 안에서는 무작위로 발동한다
  const users = (role: Role) =>
    shuffle(
      alive.filter((p) => p.role === role && aimId(p)),
      rng,
    );

  const stopped = new Set<Player>(); // 막히거나 덫에 걸려 행동이 무효가 된 사람
  const hits: { victim: Player; kind: "curse" | "sk" | "bomb" | "kill" | "thief" | "haunt" }[] = [];
  // 광인은 실제로 움직이지 않는다 (의사인 줄 아는 광인만 예외로 찾아간다)
  const visiting = (p: Player) => !stopped.has(p) && goes(p).length > 0 && (!p.insane || p.role === "doctor");
  const visitors = (house: Player, except: Player) =>
    alive.filter((q) => q !== except && visiting(q) && goes(q).includes(house.id) && !UNSEEN.includes(q.role));
  // 광인에게 줄 그럴듯한 가짜 이름 (없을 수도 있다)
  const someone = (...not: Player[]) => {
    const others = alive.filter((q) => !not.includes(q));
    return others.length && rng() < 0.5 ? oneOf(others) : null;
  };

  // 추방된 무속인의 양초
  for (const p of all) {
    if (!p.haunting) continue;
    p.haunting = false;
    p.won = true;
    const t = byId(p.mark);
    if (t?.alive) hits.push({ victim: t, kind: "haunt" });
  }

  for (const p of users("sorcerer")) {
    hits.push({ victim: p.act!.guess === target(p).role ? target(p) : p, kind: "curse" });
  }

  // 연쇄 살인범에게 공격당한 사람은 그날 밤 행동하지 못한다
  for (const p of users("serialKiller")) {
    hits.push({ victim: target(p), kind: "sk" });
    if (UNSEEN.includes(target(p).role)) continue;
    stopped.add(target(p));
    note(target(p), "습격을 받아 오늘 밤 행동하지 못했습니다.");
  }

  for (const p of users("blocker")) {
    if (stopped.has(p)) continue;
    const t = target(p);
    // 폭탄을 터뜨리러 나가는 것도 외출이다
    const tried = p.insane ? rng() < 0.5 : goes(t).length > 0 || t.act?.mode === "detonate";
    note(p, `${t.name} 님은 외출을 시도${tried ? "했습니다" : "하지 않았습니다"}.`);
    if (p.insane) continue;
    if (UNSEEN.includes(t.role)) continue;
    stopped.add(t);
    note(t, "경찰관에게 막혀 집 밖으로 나가지 못했습니다.");
  }

  for (const p of users("trapper")) {
    if (stopped.has(p)) continue;
    const t = target(p);
    const caught = p.insane ? [] : visitors(t, p);
    if (caught.length) {
      const victim = oneOf(caught);
      stopped.add(victim);
      note(victim, "덫에 걸려 오늘 밤 행동하지 못했습니다.");
    }
    const sprung = p.insane ? rng() < 0.3 : caught.length > 0;
    note(p, `${t.name} 님 집 앞의 덫에 ${sprung ? "누군가 걸렸습니다" : "아무도 걸리지 않았습니다"}.`);
  }

  // 여기서부터는 막힌 사람과 광인의 능력이 발동하지 않는다
  const works = (p: Player) => !stopped.has(p) && !p.insane;

  for (const p of users("haunter")) if (works(p)) p.mark = target(p).id;

  for (const p of alive) {
    if (p.role !== "bomber" || !works(p)) continue;
    if (p.act?.mode === "ability") target(p).bombed = true;
    if (p.act?.mode !== "detonate") continue;
    for (const q of alive) {
      if (!q.bombed) continue;
      q.bombed = false;
      hits.push({ victim: q, kind: "bomb" });
    }
  }

  const imposterRoles = all.filter((p) => p.team === "imposter").map((p) => p.role);
  for (const p of alive) {
    if (p.act?.mode === "kill" && !stopped.has(p)) hits.push({ victim: byId(p.act.target)!, kind: "kill" });
  }
  for (const p of users("cleaner")) if (works(p)) target(p).cleaned = true;
  for (const p of users("blamer")) if (works(p)) target(p).blamed = oneOf(imposterRoles);

  const thefts: [Player, Player][] = [];
  for (const p of users("thief")) {
    if (!works(p)) continue;
    const t = target(p);
    if (t.role === "survivor" || t.role === "sorcerer") {
      note(p, `${t.name} 님에게서는 훔칠 수 없었습니다.`);
      continue;
    }
    hits.push({ victim: t, kind: "thief" });
    thefts.push([p, t]);
  }

  const healed = new Set<Player>();
  for (const p of users("doctor")) {
    if (stopped.has(p)) continue;
    note(target(p), "의사가 다녀갔습니다.");
    if (!p.insane) healed.add(target(p));
  }

  const armored = new Set<Player>();
  for (const p of alive) {
    if (p.act?.mode !== "armor" || stopped.has(p)) continue;
    armored.add(p);
    p.uses!--;
  }

  // 사망 판정. 저주는 치료할 수 없고, 마법사는 저주와 양초로만 죽는다.
  const dying = new Set(
    hits
      .filter(
        (h) =>
          !armored.has(h.victim) &&
          !(h.kind !== "curse" && healed.has(h.victim)) &&
          !(h.victim.role === "sorcerer" && h.kind !== "curse" && h.kind !== "haunt"),
      )
      .map((h) => h.victim),
  );
  const attacked = new Set(hits.map((h) => h.victim));

  for (const p of users("doctor")) {
    if (stopped.has(p)) continue;
    const t = target(p);
    // 광인은 아무도 죽지 않은 밤이면 자기가 살렸다고 믿는다
    const believes = p.insane ? dying.size === 0 : attacked.has(t) && !dying.has(t);
    if (believes) note(p, `${t.name} 님을 공격에서 지켜냈습니다.`);
  }

  for (const p of users("provoker")) {
    if (stopped.has(p) || dying.has(target(p))) continue; // 대상이 죽으면 횟수가 줄지 않는다
    p.uses!--;
    if (p.insane) continue;
    target(p).provoked = true;
    note(target(p), "누군가 집 앞에서 확성기로 떠들었습니다.");
  }

  const teamsOf = (role: Role): Team[] =>
    role === "doctor"
      ? ["innocent"]
      : COMMON.includes(role)
        ? ["innocent", "imposter"]
        : IMPOSTER_ONLY.includes(role)
          ? ["imposter"]
          : ["neutral"];
  const fake = (not: string): string => {
    for (;;) {
      const role = oneOf(Object.keys(ROLES) as Role[]);
      const made = tag(role, oneOf(teamsOf(role)));
      if (made !== not) return made;
    }
  };

  for (const p of users("investigator")) {
    if (stopped.has(p)) continue;
    const t = target(p);
    const a = p.insane ? fake("") : tag(t.role, t.team);
    const b = fake(a);
    note(p, `${t.name} 님은 ${rng() < 0.5 ? `${a} 또는 ${b}` : `${b} 또는 ${a}`}입니다.`);
  }

  for (const p of users("snitch")) {
    if (stopped.has(p)) continue;
    const t = target(p);
    if (dying.has(t)) {
      note(p, `${t.name} 님이 죽어 밀고하지 못했습니다. 횟수는 줄지 않습니다.`);
      continue;
    }
    p.uses!--;
    note(p, `${t.name} 님의 역할은 ${p.insane || t.insane ? fake("") : tag(t.role, t.team)}입니다.`);
  }

  for (const p of users("lookout")) {
    if (stopped.has(p)) continue;
    const t = target(p);
    const seen = (p.insane ? [someone(p, t)].filter((q) => q !== null) : visitors(t, p)).map((q) => q.name);
    note(p, `${t.name} 님 집에 ${seen.length ? `${seen.join(", ")} 님이 찾아왔습니다` : "아무도 오지 않았습니다"}.`);
  }

  for (const p of users("tracker")) {
    if (stopped.has(p)) continue;
    const t = target(p);
    // 살해와 능력을 함께 쓴 사람은 두 집 모두 드러난다
    const went = p.insane
      ? [someone(p, t)].filter((q) => q !== null)
      : visiting(t) && !UNSEEN.includes(t.role)
        ? [...new Set(goes(t))].map((id) => byId(id)!)
        : [];
    const houses = went.map((q) => q.name).join(", ");
    note(p, `${t.name} 님은 ${houses ? `${houses} 님 집에 갔습니다` : "외출하지 않았습니다"}.`);
  }

  for (const p of all) p.last = p.alive ? aimId(p) : null;

  // 연쇄 살인범에게 죽은 사람의 역할은 가려진다
  const hidden = new Set(hits.filter((h) => h.kind === "sk").map((h) => h.victim));
  for (const p of all) {
    if (!dying.has(p)) continue;
    die(p, hidden.has(p));
    p.will = true;
    announce(room, `${night}: ${p.name} 님이 사망했습니다. (${p.reveal})`);
  }
  if (!dying.size) announce(room, `${night}: 아무도 죽지 않았습니다.`);

  // 도둑은 죽이는 데 성공해야 역할을 빼앗는다
  for (const [thief, t] of thefts) {
    if (!dying.has(t) || dying.has(thief)) continue;
    assign(thief, t.insane ? oneOf(INNOCENT) : t.role, t.team);
    thief.stole = true;
    note(thief, `${t.name} 님의 역할을 빼앗았습니다. 이제 ${tag(thief.role, thief.team)}입니다.`);
  }
}

function resolveDay(room: Room, rng: Rng) {
  const alive = room.players.filter((p) => p.alive);
  const nameOf = (id: string) => (id === SKIP ? "기권" : room.players.find((p) => p.id === id)!.name);
  const votes = alive.map((p) => p.pick ?? SKIP);
  const ballots = alive.map((p, i) => `${p.name}→${nameOf(votes[i])}`).join(", ");
  const count = new Map<string, number>(); // 0.1표 단위
  const add = (id: string, n: number) => id !== SKIP && count.set(id, (count.get(id) ?? 0) + n);

  if (room.day === 0) {
    announce(room, `시장 선거: ${ballots}`);
    votes.forEach((v) => add(v, 10));
    const t = tops(count);
    if (!t.length) return announce(room, "시장이 뽑히지 않았습니다.");
    room.mayor = t[Math.floor(rng() * t.length)];
    announce(room, `${nameOf(room.mayor)} 님이 시장이 되었습니다.${t.length > 1 ? " (동률이라 추첨)" : ""} 시장의 표는 1.1표입니다.`);
    return;
  }

  const provoked = alive.filter((p) => p.provoked);
  // 선동은 2표. 다만 사람이 적을 때 선동 표만으로 과반이 되지 않도록 과반 직전까지만 준다.
  const bonus = Math.min(20, alive.length * 5);
  for (const p of provoked) {
    add(p.id, bonus);
    p.provoked = false;
  }
  alive.forEach((p, i) => add(votes[i], p.id === room.mayor ? 10 + MAYOR_BONUS : 10));
  announce(room, `${room.day}일차 투표: ${ballots}`);
  if (provoked.length) announce(room, `선동으로 ${bonus / 10}표를 안고 시작: ${provoked.map((p) => p.name).join(", ")}`);
  if (count.size) announce(room, `득표: ${[...count].sort((a, b) => b[1] - a[1]).map(([id, n]) => `${nameOf(id)} ${n / 10}표`).join(", ")}`);

  // 과반 득표여야 추방된다. 동률이면 시장의 0.1표가 가른다.
  const t = tops(count);
  if (t.length !== 1 || count.get(t[0])! * 2 <= alive.length * 10) {
    announce(room, "과반을 얻은 사람이 없어 아무도 추방되지 않았습니다.");
    return;
  }
  const out = room.players.find((p) => p.id === t[0])!;
  die(out);
  announce(room, `${out.name} 님이 추방당했습니다. (${out.reveal})`);
  if (out.role === "haunter" && out.mark) out.haunting = true;
}

function finish(room: Room, winner: Winner, solo?: Player) {
  room.winner = winner;
  room.phase = "ended";
  room.result =
    winner === "draw"
      ? "무승부"
      : winner === "solo"
        ? `${solo!.name} 님 단독 승리 (${ROLES[solo!.role].name})`
        : `${TEAM_NAME[winner]} 승리`;
  for (const p of room.players) {
    // 무속인은 이미 won이 켜져 있고, 생존자는 살아만 있으면 함께 이긴다
    if (winner === "solo" ? p === solo : p.team === winner) p.won = true;
    if (p.role === "survivor" && p.alive) p.won = true;
  }
  // 무승부여도 무속인·생존자처럼 자기 조건을 채운 사람은 따로 이긴다
  const solos = room.players.filter((p) => p.won).map((p) => p.name);
  if (winner === "draw" && solos.length) room.result = `무승부 (${solos.join(", ")} 님은 개인 승리)`;
  announce(room, `${room.result}!`);
}

// 생존자는 누구의 승패에도 영향을 주지 않으므로 세지 않는다
function checkWin(room: Room) {
  const live = room.players.filter((p) => p.alive && p.role !== "survivor");
  const imposters = live.filter((p) => p.team === "imposter").length;
  const killers = live.filter((p) => p.team === "neutral" && KILLERS.includes(p.role));
  const rest = live.length - imposters - killers.length;
  if (!live.length) finish(room, "draw");
  else if (!imposters && !killers.length) finish(room, "innocent");
  else if (!killers.length && imposters >= rest) finish(room, "imposter");
  else if (!imposters && killers.length === 1 && rest <= 1) finish(room, "solo", killers[0]);
}

// 현재 페이즈를 정산하고 다음으로 넘긴다. 고르지 않은 사람은 무행동/기권 처리.
export function advance(room: Room, rng: Rng = Math.random) {
  if (room.phase !== "night" && room.phase !== "day") return;
  const logFrom = room.log.length;
  const notesFrom = room.players.map((p) => p.notes.length);

  if (room.phase === "night") {
    resolveNight(room, rng);
    room.phase = "day";
  } else {
    resolveDay(room, rng);
    if (room.day === 0) {
      const hands = deal(room.players.length, rng);
      room.players.forEach((p, i) => assign(p, hands[i].role, hands[i].team, hands[i].insane));
      announce(room, "역할이 정해졌습니다. 자신의 역할을 확인하세요.");
    }
    for (const p of room.players) p.will = false; // 유언은 죽은 다음 낮에만 남길 수 있다
    room.phase = "night";
    room.day++;
  }
  checkWin(room);

  room.news = room.log.slice(logFrom);
  room.players.forEach((p, i) => {
    p.news = p.notes.slice(notesFrom[i]);
    p.act = null;
    p.pick = null;
  });
}

// me에게 보여도 되는 정보만 담는다. 직업 유출을 막는 유일한 관문.
export function view(room: Room, me: Player, now = Date.now()) {
  const night = room.phase === "night";
  const playing = night || room.phase === "day";
  const unknown = room.phase === "lobby" || (room.phase === "day" && room.day === 0); // 아직 역할이 없다
  const ally = (p: Player) => !unknown && p !== me && me.team === "imposter" && p.team === "imposter";
  const spoiled = !me.alive && !me.will; // 유언을 남길 수 있는 동안에는 비밀을 볼 수 없다
  const byId = (id: string | null) => room.players.find((p) => p.id === id);
  // p의 역할이 me에게 어떻게 보이는가
  const label = (p: Player): string | null => {
    if (unknown) return null;
    if (room.phase === "ended" || spoiled) return truth(p); // 끝났거나 내가 죽었으면 전부 보인다
    if (!p.alive) return ally(p) ? truth(p) : p.reveal; // 같은 편의 정체는 가려져도 안다
    if (p === me) return tag(me.role, me.team); // 광인은 자기가 광인인 줄 모른다
    return ally(p) ? truth(p) : null;
  };
  const doing = (p: Player): string | null => {
    if (!p.act) return null;
    const to = byId(p.act.target)?.name;
    if (p.act.mode === "kill") return `살해 → ${to}`;
    if (p.act.mode === "ability") return `${ROLES[p.role].action} → ${to}`;
    return p.act.mode === "detonate" ? "폭파" : "쉼";
  };
  return {
    code: room.code,
    phase: room.phase,
    day: room.day,
    winner: room.winner,
    result: room.result,
    remaining: room.deadline === null ? null : Math.max(0, room.deadline - now),
    pending: playing ? pending(room).length : 0,
    news: [...room.news, ...me.news],
    // 끝나면 비밀 대화도 전부 공개한다
    chat: room.chat.filter(
      (c) =>
        c.to === "all" ||
        room.phase === "ended" ||
        (c.to === "dead" && spoiled) ||
        (c.to === "imposter" && me.team === "imposter"),
    ),
    hostId: room.players.find((p) => p.connected)?.id ?? null,
    me: {
      id: me.id,
      alive: me.alive,
      role: unknown ? null : me.role,
      team: me.team,
      uses: me.uses,
      modes: night && me.alive ? modes(me) : [],
      both: night && me.alive && canDoBoth(room, me),
      will: playing && me.will,
      act: me.act,
      pick: me.pick,
      // 오늘 밤 능력 대상으로 고를 수 없는 사람
      blocked: night && me.role === "doctor" ? me.last : null,
      notes: me.notes,
    },
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      alive: p.alive,
      connected: p.connected,
      mayor: p.id === room.mayor,
      label: label(p),
      ally: ally(p),
      doing: night && ally(p) ? doing(p) : null, // 같은 편의 오늘 밤 행동
      picked: playing ? (night ? p.act : p.pick) !== null : false,
      provoked: room.phase === "day" && p.provoked,
      bombed: me.role === "bomber" && p.bombed, // 폭파범에게만: 폭탄을 설치해 둔 집
      marked: me.role === "haunter" && me.mark === p.id, // 무속인에게만: 양초를 둔 사람
      won: room.phase === "ended" && p.won,
    })),
  };
}

export type View = ReturnType<typeof view>;
