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
// 고를 수 있는 캐릭터 생김새. 규칙과는 무관하다.
export const SKINS = ["blob", "chiikawa", "hachiware", "usagi"] as const;
export type Skin = (typeof SKINS)[number];
// 고를 수 있는 집 모양. 첫 번째가 기본 집이고 규칙과는 무관하다.
export const HOUSES = ["house", "house-1", "house-2", "house-3", "house-4", "house-5", "house-6", "house-7", "house-8"] as const;
export type House = (typeof HOUSES)[number];
export const HATS = ["none", "straw", "wizard", "top", "bow"] as const;
export type Hat = (typeof HATS)[number];
export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 10;
export const ELECTION_MS = 60_000;
export const TURN_MS = 15_000; // 밤에 역할마다 돌아오는 차례의 길이
export const DUSK_MS = 6_000; // 밤마다 더 주는 시간 (집으로 돌아가는 연출 동안은 집을 누를 수 없다)
export const EXILE_MS = 8_000; // 추방 연출이 도는 밤에 더 주는 시간
export const FIRST_NIGHT_MS = 30_000; // 1일차 밤에만 더 주는 시간 (역할을 읽을 시간)
export const CLOSE_MS = 5_000; // 기다릴 사람이 없어지면 이만큼 뒤에 마감한다
export const QUIET_MAX = 6; // 밤낮을 합쳐 이만큼 연속으로 아무도 안 죽으면 무승부
// 방장이 고를 수 있는 밤·낮 제한 시간(초)
export const NIGHT_CHOICES = [45, 60, 90, 120];
export const DAY_CHOICES = [120, 180, 300];
const MAYOR_BONUS = 1; // 시장의 추가 표, 0.1표 단위 (표 계산은 전부 0.1표 단위 정수로 한다)

// action: 밤에 능력을 쓸 때 버튼에 적는 말
export const ROLES: Record<Role, { name: string; action: string; desc: string }> = {
  doctor: {
    name: "의사",
    action: "치료",
    desc: "밤에 한 명을 치료해 그날 밤 공격받아도 살려 냅니다. 자신도 치료할 수 있지만, 어젯밤 치료한 사람은 고를 수 없습니다.",
  },
  blocker: {
    name: "경찰관",
    action: "외출 통제",
    desc: "밤에 한 명이 집 밖으로 못 나가게 막고, 나가려 했는지 알아냅니다. 어젯밤 막은 사람은 고를 수 없습니다.",
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
    desc: "게임 중 두 번, 한 명이 다음 낮 투표를 2표 받은 채 시작하게 합니다. 선동 표만으로는 추방되지 않고, 남은 사람이 적으면 선동 표가 줄어듭니다.",
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
    desc: "밤마다 한 명을 죽입니다. 막히지도 들키지도 않고, 공격당한 사람은 그날 밤 행동하지 못하며 죽으면 역할이 가려집니다. 혼자 남으면 승리합니다.",
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
    desc: "한 명의 역할을 맞히면 그 사람이 죽고, 틀리면 자신이 죽습니다. 막히지도 감시에 보이지도 않고, 저주와 양초 말고는 밤 공격에 죽지 않습니다. 혼자 남으면 승리합니다.",
  },
  haunter: {
    name: "무속인",
    action: "양초 두기",
    desc: "밤에 한 명에게 양초를 둡니다. 투표로 추방당하면 다음 밤 그 사람을 습격하고, 그 밤이 오면 상대가 살아남아도 승리합니다.",
  },
};
export const TEAM_NAME: Record<Team, string> = { innocent: "시민", imposter: "임포스터", neutral: "중립" };
export const INSANE = { name: "정신병자", desc: "자신이 다른 시민 역할이라고 믿지만 능력은 전부 가짜입니다." };

// 시민과 임포스터 양쪽에 나올 수 있는 역할
const COMMON: Role[] = ["blocker", "lookout", "investigator", "trapper", "snitch", "provoker", "tracker"];
const IMPOSTER_ONLY: Role[] = ["cleaner", "blamer"];
const NEUTRAL: Role[] = ["survivor", "serialKiller", "bomber", "thief", "sorcerer", "haunter"];
const INNOCENT: Role[] = ["doctor", ...COMMON];
// 진영별로 넣을 수 있는 역할. 정신병자는 역할이 아니라 "가짜 능력을 가진 시민"이지만 판을 짤 때는 한 칸을 차지한다.
export type Slot = { role: Role | "insane"; team: Team };
export const POOL: Record<Team, Slot["role"][]> = {
  innocent: ["doctor", "insane", ...COMMON],
  imposter: [...IMPOSTER_ONLY, ...COMMON],
  neutral: NEUTRAL,
};
const teamsOf = (role: Slot["role"]) => (Object.keys(POOL) as Team[]).filter((team) => POOL[team].includes(role));

// 방장이 대기실에서 정하는 판 설정
export interface Setup {
  auto: boolean; // 인원수에 맞춰 알아서 뽑는다
  slots: Slot[]; // 직접 고른 역할들 (auto가 아닐 때 쓴다)
  night: number; // 밤 제한 시간(초)
  day: number;
  calm: boolean; // 첫 밤 평화: 1일차 밤에는 어떤 공격으로도 죽지 않는다
}

const USES: Partial<Record<Role, number>> = { snitch: 1, provoker: 2, survivor: 3 }; // 횟수 제한
const KILLERS: Role[] = ["serialKiller", "bomber", "sorcerer", "thief"]; // 살아 있으면 게임이 안 끝나는 중립
const UNSEEN: Role[] = ["serialKiller", "sorcerer"]; // 막히지 않고 감시에도 보이지 않는다

export type Seen = { role: Role; team: Team };
// 방금 지난 밤에 내가 본 것. notes의 글자 결과와 같은 내용을 화면이 장면으로 그릴 수 있게 담는다.
// 정신병자는 글자 결과와 똑같은 가짜 장면을 받는다.
export type Scene =
  | { kind: "lookout"; house: string; visitors: string[] } // house 집에 찾아온 사람들
  | { kind: "tracker"; who: string; went: string[]; out: boolean } // out인데 went가 비면 외출했지만 들른 집이 없다(폭파)
  | { kind: "blocker"; who: string; tried: boolean }
  | { kind: "trapper"; house: string; caught: boolean }
  | { kind: "investigator"; who: string; options: [Seen, Seen] }
  | { kind: "snitch"; who: string; role: Role | null; team: Team | null } // 대상이 죽어 밀고하지 못하면 null
  | { kind: "doctor"; who: string; saved: boolean }
  | { kind: "thief"; who: string; stolen: Seen | null } // 훔치지 못하면 null
  // 당한 쪽: 경찰관에게 막힘, 덫에 걸림, 습격으로 행동 못 함, 의사가 다녀감, 선동당함
  | { kind: "blocked" | "trapped" | "raided" | "healed" | "provoked" };

// 방금 지난 밤의 일 가운데 아침에 모두가 보게 되는 것. 모든 사람에게 같은 내용이 간다.
// 원작에서 공개되는 것만 담는다: 누가 죽었고 어떤 역할로 드러났는지, 폭탄으로 죽었는지(집이 터진다),
// 밀고자가 광장에 나와 누구를 지목했는지(알아낸 역할은 밀고자만 본다). 그 밖의 살해 수단은 담지 않는다.
export type Dawn =
  | { kind: "death"; who: string; reveal: string; blast: boolean; bolt: boolean } // blast는 폭탄, bolt는 마법사의 번개(모두가 본다). reveal은 players[].label과 같은 글
  | { kind: "snitch"; by: string; who: string };

export type HitKind = "curse" | "sk" | "bomb" | "kill" | "thief" | "haunt";
export type Stop = "sk" | "blocker" | "trap"; // 행동이 무효가 된 까닭
// 복기용 기록. 게임이 끝난 뒤에만 view로 내려간다.
export type HistoryEntry =
  | {
      kind: "night";
      day: number;
      // 살아 있던 전원의 행동. mode가 kill이면 target은 살해 대상이고 extra는 함께 쓴 능력의 대상. fake는 정신병자의 가짜 능력
      acts: {
        by: string;
        role: Role;
        fake: boolean;
        mode: Mode;
        target: string | null;
        extra: string | null;
        guess: Role | null;
        stopped: Stop | null;
      }[];
      hits: { by: string; victim: string; kind: HitKind; died: boolean }[]; // 공격과 그 결과
    }
  // day가 0이면 시장 선거. chosen은 추방된 사람(선거면 뽑힌 시장), votes는 표 수(선동 표 포함)
  | { kind: "day"; day: number; ballots: { by: string; to: string }[]; tally: { id: string; votes: number }[]; chosen: string | null };

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
  skin: Skin;
  house: House;
  hat: Hat;
  connected: boolean;
  alive: boolean;
  role: Role; // 정신병자면 본인이 믿는 역할
  team: Team;
  insane: boolean; // 정신병자: 능력이 전부 가짜인 시민. 본인은 모른다
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
  scenes: Scene[]; // 방금 지난 밤에 본 것 (다음 밤이 되면 비운다)
}

export interface Room {
  code: string;
  phase: Phase;
  day: number; // 0일차 낮은 시장 선거
  players: Player[];
  setup: Setup;
  mayor: string | null;
  turn: number; // 밤: 지금 몇 번째 차례인가
  roster: Role[]; // 이번 판에 들어간 역할들 (누가 무엇인지는 알 수 없게 정렬해 둔다)
  log: string[];
  news: string[]; // log 중 방금 정산에서 생긴 것
  chat: { name: string; text: string; to: Channel }[]; // name이 ""이면 시스템 안내
  winner: Winner | null;
  result: string; // 승패 문구
  why: string; // 왜 끝났는지 한 줄
  dawn: Dawn[]; // 방금 지난 밤의 공개 사건 (다음 밤이 되면 비운다)
  quiet: number; // 아무도 죽거나 추방되지 않은 밤낮이 연속 몇 번인가
  history: HistoryEntry[];
  deadline: number | null; // 현재 페이즈가 자동으로 넘어가는 시각 (서버가 관리)
}

export function newRoom(code: string): Room {
  return {
    code,
    phase: "lobby",
    day: 0,
    players: [],
    setup: { auto: true, slots: [], night: 90, day: 180, calm: false },
    mayor: null,
    turn: 0,
    roster: [],
    log: [],
    news: [],
    chat: [],
    winner: null,
    result: "",
    why: "",
    dawn: [],
    quiet: 0,
    history: [],
    deadline: null,
  };
}

export function newPlayer(id: string, token: string, name: string): Player {
  return {
    id,
    token,
    name,
    skin: "blob",
    house: "house",
    hat: "none",
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
    scenes: [],
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

// 인원수에 맞춰 역할을 뽑는다. 임포스터 1~2명, 5명부터 정신병자 1명, 6명부터 중립 1명, 9명부터 중립 2명.
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

// 방장이 고른 역할들을 나눠 준다. 정신병자는 무작위 시민 역할을 받은 줄 안다.
function dealSlots(slots: Slot[], rng: Rng) {
  const hands = slots.map((s) =>
    s.role === "insane"
      ? { role: INNOCENT[Math.floor(rng() * INNOCENT.length)], team: "innocent" as Team, insane: true }
      : { role: s.role, team: s.team, insane: false },
  );
  return shuffle(hands, rng);
}

// 판 설정을 바꾼다. 받은 값은 믿지 않고 하나씩 확인한다. 실패하면 사유를 돌려준다.
// calm은 예전 클라이언트가 보내지 않으므로 없으면 지금 값을 둔다.
export function configure(
  room: Room,
  auto: unknown,
  slots: unknown,
  night: unknown,
  day: unknown,
  calm: unknown = room.setup.calm,
): string | null {
  if (room.phase !== "lobby") return "대기실에서만 바꿀 수 있어요";
  if (typeof auto !== "boolean" || typeof calm !== "boolean" || !Array.isArray(slots)) return "잘못된 설정이에요";
  if (slots.length > MAX_PLAYERS) return "역할은 열 개까지 넣을 수 있어요";
  const clean: Slot[] = [];
  for (const s of slots) {
    const role = s?.role as Slot["role"];
    const team = s?.team as Team;
    if (!teamsOf(role).includes(team)) return "넣을 수 없는 역할이에요";
    clean.push({ role, team });
  }
  if (!NIGHT_CHOICES.includes(night as number) || !DAY_CHOICES.includes(day as number)) return "고를 수 없는 시간이에요";
  room.setup = { auto, slots: clean, night: night as number, day: day as number, calm };
  return null;
}

// 캐릭터 생김새를 바꾼다. 실패하면 사유를 돌려준다.
export function setSkin(p: Player, skin: unknown): string | null {
  if (!SKINS.includes(skin as Skin)) return "고를 수 없는 캐릭터예요";
  p.skin = skin as Skin;
  return null;
}

// 집 모양을 바꾼다. 실패하면 사유를 돌려준다.
export function setHouse(p: Player, house: unknown): string | null {
  if (!HOUSES.includes(house as House)) return "고를 수 없는 집이에요";
  p.house = house as House;
  return null;
}

// 모자를 바꾼다. 실패하면 사유를 돌려준다.
export function setHat(p: Player, hat: unknown): string | null {
  if (!HATS.includes(hat as Hat)) return "고를 수 없는 모자예요";
  p.hat = hat as Hat;
  return null;
}

// 지금 설정으로 시작할 수 있는가. 안 되면 사유를 돌려준다.
export function canStart(room: Room): string | null {
  const n = room.players.length;
  if (n < MIN_PLAYERS) return `최소 ${MIN_PLAYERS}명이 필요해요`;
  const { auto, slots } = room.setup;
  if (auto) return null;
  if (slots.length !== n) return `역할은 ${slots.length}개인데 사람은 ${n}명이에요. 수를 맞춰 주세요`;
  if (!slots.some((s) => s.team === "imposter")) return "임포스터가 한 명은 있어야 해요";
  const end = verdict(slots);
  if (end) return `이 구성은 시작하자마자 끝나요 (${end.why})`;
  return null;
}

// 기록에 남기고 대화 흐름에도 안내로 끼워 넣는다
function announce(room: Room, line: string) {
  room.log.push(line);
  room.chat.push({ name: "", text: line, to: "all" });
}

// 역할은 시장 선거가 끝난 뒤에 정한다 (역할을 알고 뽑으면 출마만으로 의심받는다)
// 지난 판의 흔적(사망, 결과, 메모, 대화, 시장 등)을 지운다. 판 설정과 생김새·집은 남긴다.
function reset(room: Room) {
  for (const p of room.players) {
    Object.assign(p, newPlayer(p.id, p.token, p.name), { connected: p.connected, skin: p.skin, house: p.house, hat: p.hat });
  }
  Object.assign(room, newRoom(room.code), { players: room.players, setup: room.setup });
}

// 끝난 판을 치우고 대기실로 돌아간다. 접속이 끊긴 사람은 내보낸다.
export function toLobby(room: Room) {
  room.players = room.players.filter((p) => p.connected);
  reset(room);
}

export function start(room: Room) {
  reset(room);
  room.phase = "day";
  announce(room, "게임을 시작합니다. 먼저 시장을 뽑습니다. 역할은 선거가 끝나면 정해집니다.");
}

// 밤의 차례. 발동 순서대로 한 차례씩 돌고, 자기 차례에만 행동을 고른다 (정산은 밤이 끝날 때 한꺼번에).
// 임포스터 편은 어떤 역할이든 임포스터 차례에 살해와 능력을 고른다.
const TURNS: (Role | "imposter")[][] = [
  ["haunter"],
  ["sorcerer"],
  ["serialKiller"],
  ["blocker"],
  ["trapper"],
  ["bomber"],
  ["imposter"],
  ["thief"],
  ["doctor"],
  ["survivor", "provoker"],
  ["investigator", "snitch"],
  ["lookout", "tracker"],
];
// 이번 판에 도는 차례들. 판에 들어간 역할 목록만으로 정한다 — 누가 죽었든 누가 임포스터든 차례는 그대로 돌아서, 차례의 유무와 길이로 새는 것이 없다.
const turns = (room: Room) => TURNS.filter((t) => t.includes("imposter") || t.some((r) => room.roster.includes(r as Role)));
// p가 고르는 차례 (없으면 -1)
export const turnOf = (room: Room, p: Player) => turns(room).findIndex((t) => t.includes(p.team === "imposter" ? "imposter" : p.role));
// 다음 차례로 넘긴다. 마지막 차례였으면 false (밤을 정산할 때다)
export function pass(room: Room): boolean {
  if (room.phase !== "night" || room.turn >= turns(room).length - 1) return false;
  room.turn++;
  return true;
}

// 오늘 밤 고를 수 있는 행동
function modes(p: Player): Mode[] {
  const out: Mode[] = [];
  if (p.team === "imposter") out.push("kill");
  if (p.role === "survivor") {
    if (p.uses) out.push("armor");
  } else if (p.uses !== 0) out.push("ability");
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
  if (turnOf(room, p) !== room.turn) return "지금은 내 차례가 아니에요";
  if (!modes(p).includes(mode as Mode)) {
    if (mode === "ability" && p.uses === 0) return "능력 횟수를 모두 썼어요";
    return "쓸 수 없는 행동이에요";
  }
  if (mode !== "kill" && mode !== "ability") {
    p.act = { mode: mode as Mode, target: null, guess: null, extra: null };
    return null;
  }
  const t = room.players.find((x) => x.id === target);
  if (!t || !t.alive) return "고를 수 없는 대상이에요";
  // 능력 대상 검사. 의사만 자신을 고를 수 있고, 의사와 경찰관은 어젯밤 고른 사람을 연달아 고르지 못한다 (자기 치료도 연달아는 안 된다).
  const aimed = (id: string) =>
    id === p.id && p.role !== "doctor"
      ? "자기 자신은 고를 수 없어요"
      : (p.role === "doctor" || p.role === "blocker") && id === p.last
        ? "이틀 연속 같은 사람은 고를 수 없어요"
        : null;
  if (mode === "kill" && t === p) return "자기 자신은 고를 수 없어요";
  if (mode === "kill" && t.team === "imposter") return "같은 편은 죽일 수 없어요";
  const curse = mode === "ability" && p.role === "sorcerer";
  if (mode === "ability") {
    const bad = aimed(t.id);
    if (bad) return bad;
    if (curse && !Object.hasOwn(ROLES, guess)) return "맞힐 역할을 골라 주세요";
  }
  if (extra) {
    if (mode !== "kill" || !canDoBoth(room, p)) return "살해와 능력을 함께 쓸 수 없어요";
    if (!room.players.some((x) => x.id === extra && x.alive)) return "고를 수 없는 대상이에요";
    const bad = aimed(extra);
    if (bad) return bad;
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
// 대화의 청중 규칙은 이 두 함수에만 있다 (말, 입력 중 표시가 함께 쓴다).
// 지금 p가 말하면 나가는 범위. null이면 말할 수 없다.
export function channel(room: Room, p: Player): Channel | null {
  const playing = room.phase === "night" || room.phase === "day";
  if (playing && !p.alive) return p.will && room.phase === "day" ? "all" : "dead"; // 유언은 모두에게
  if (room.phase === "night") return p.team === "imposter" ? "imposter" : null;
  return "all";
}

// me가 그 범위의 말을 볼 수 있는가. 끝나면 비밀 대화도 전부 공개한다.
export function hears(room: Room, me: Player, to: Channel): boolean {
  const spoiled = !me.alive && !me.will; // 유언을 남길 수 있는 동안에는 비밀을 볼 수 없다
  return to === "all" || room.phase === "ended" || (to === "dead" && spoiled) || (to === "imposter" && me.team === "imposter");
}

export function say(room: Room, p: Player, text: string): string | null {
  text = text.trim().slice(0, 200);
  if (!text) return "내용을 입력해 주세요";
  const to = channel(room, p);
  if (!to) return "밤에는 대화할 수 없어요";
  if (!p.alive && to === "all" && room.phase === "day") {
    p.will = false;
    text = `(유언) ${text}`;
  }
  room.chat.push({ name: p.name, text, to });
  if (room.chat.length > 200) room.chat.shift();
  return null;
}

// 아직 고르지 않은 사람들. 접속이 끊긴 사람은 기다리지 않는다 (정산 때 무행동/기권이 된다).
function pending(room: Room): Player[] {
  const night = room.phase === "night";
  return room.players.filter((p) => p.alive && p.connected && (night ? p.act : p.pick) === null);
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
const truth = (p: Player) => `${p.insane ? "정신병자·" : ""}${tag(p.role, p.team)}${p.stole ? "·원래 도둑" : ""}`;

function die(p: Player, hidden = false) {
  p.alive = false;
  p.reveal =
    hidden || p.cleaned
      ? "알 수 없음"
      : p.blamed
        ? tag(p.blamed, "imposter")
        : p.insane
          ? `정신병자(${TEAM_NAME.innocent})`
          : tag(p.role, p.team);
}

// 밤 정산. 원작의 발동 순서를 따른다:
// 무속인 → 마법사 → 연쇄 살인범 → 경찰관 → 트래퍼 → 폭파범 → 임포스터(살해·청소부·남탓쟁이) → 도둑 → 의사 → 생존자·선동꾼 → 수사관·밀고자 → 감시자·추적자
// (추적자는 원작 순서표에 없어 감시자와 같은 자리에 둔다)
function resolveNight(room: Room, rng: Rng) {
  const night = `${room.day}일차 밤`;
  const all = room.players;
  const alive = all.filter((p) => p.alive);
  const byId = (id: string | null) => all.find((p) => p.id === id);
  const target = (p: Player) => byId(aimId(p))!; // 능력의 대상
  const goes = (p: Player) => [p.act?.target, p.act?.extra].filter((id): id is string => id != null && id !== p.id); // 찾아가는 집들 (자기 치료는 외출이 아니다)
  const oneOf = <T>(a: T[]) => a[Math.floor(rng() * a.length)];
  // 본인만 보는 결과. scene은 같은 내용을 화면이 장면으로 그리기 위한 것
  const note = (p: Player, text: string, scene?: Scene) => {
    p.notes.push(`${night}: ${text}`);
    if (scene) p.scenes.push(scene);
  };
  // 같은 순서 안에서는 무작위로 발동한다
  const users = (role: Role) =>
    shuffle(
      alive.filter((p) => p.role === role && aimId(p)),
      rng,
    );

  const stopped = new Map<Player, Stop>(); // 막히거나 덫에 걸려 행동이 무효가 된 사람
  const hits: { victim: Player; kind: HitKind; by: Player }[] = [];
  // 정신병자는 실제로 움직이지 않는다 (의사인 줄 아는 정신병자만 예외로 찾아간다)
  const visiting = (p: Player) => !stopped.has(p) && goes(p).length > 0 && (!p.insane || p.role === "doctor");
  const visitors = (house: Player, except: Player) =>
    alive.filter((q) => q !== except && visiting(q) && goes(q).includes(house.id) && !UNSEEN.includes(q.role));
  // 정신병자에게 줄 그럴듯한 가짜 이름 (없을 수도 있다)
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
    if (t?.alive) hits.push({ victim: t, kind: "haunt", by: p });
  }
  // 양초는 가장 먼저 놓인다. 습격·경찰관·덫보다 앞이라 막히지 않는다.
  for (const p of users("haunter")) if (!p.insane) p.mark = target(p).id;

  for (const p of users("sorcerer")) {
    hits.push({ victim: p.act!.guess === target(p).role ? target(p) : p, kind: "curse", by: p });
  }

  // 연쇄 살인범에게 공격당한 사람은 그날 밤 행동하지 못한다
  for (const p of users("serialKiller")) {
    const t = target(p);
    hits.push({ victim: t, kind: "sk", by: p });
    // 갑옷은 집 안에서 쓰는 방어라 습격을 받아도 발동한다
    if (UNSEEN.includes(t.role) || t.act?.mode === "armor") continue;
    stopped.set(t, "sk");
    note(t, "습격을 받아 오늘 밤 행동하지 못했습니다.", { kind: "raided" });
  }

  for (const p of users("blocker")) {
    if (stopped.has(p)) continue;
    const t = target(p);
    // 폭탄을 터뜨리러 나가는 것도 외출이다
    const tried = p.insane ? rng() < 0.5 : goes(t).length > 0 || t.act?.mode === "detonate";
    note(p, `${t.name} 님은 외출을 시도${tried ? "했습니다" : "하지 않았습니다"}.`, { kind: "blocker", who: t.id, tried });
    if (p.insane) continue;
    if (UNSEEN.includes(t.role)) continue;
    stopped.set(t, "blocker");
    note(t, "경찰관에게 막혀 집 밖으로 나가지 못했습니다.", { kind: "blocked" });
  }

  for (const p of users("trapper")) {
    if (stopped.has(p)) continue;
    const t = target(p);
    const caught = p.insane ? [] : visitors(t, p);
    if (caught.length) {
      const victim = oneOf(caught);
      stopped.set(victim, "trap");
      note(victim, "덫에 걸려 오늘 밤 행동하지 못했습니다.", { kind: "trapped" });
    }
    const sprung = p.insane ? rng() < 0.3 : caught.length > 0;
    note(p, `${t.name} 님 집 앞의 덫에 ${sprung ? "누군가 걸렸습니다" : "아무도 걸리지 않았습니다"}.`, {
      kind: "trapper",
      house: t.id,
      caught: sprung,
    });
  }

  // 여기서부터는 막힌 사람과 정신병자의 능력이 발동하지 않는다
  const works = (p: Player) => !stopped.has(p) && !p.insane;

  for (const p of alive) {
    if (p.role !== "bomber" || !works(p)) continue;
    if (p.act?.mode === "ability") target(p).bombed = true;
    if (p.act?.mode !== "detonate") continue;
    for (const q of alive) {
      if (!q.bombed) continue;
      q.bombed = false;
      hits.push({ victim: q, kind: "bomb", by: p });
    }
  }

  const imposterRoles = all.filter((p) => p.team === "imposter").map((p) => p.role);
  for (const p of alive) {
    if (p.act?.mode === "kill" && !stopped.has(p)) hits.push({ victim: byId(p.act.target)!, kind: "kill", by: p });
  }
  for (const p of users("cleaner")) if (works(p)) target(p).cleaned = true;
  for (const p of users("blamer")) if (works(p)) target(p).blamed = oneOf(imposterRoles);

  const thefts: [Player, Player][] = [];
  for (const p of users("thief")) {
    if (!works(p)) continue;
    const t = target(p);
    if (t.role === "survivor" || t.role === "sorcerer") {
      note(p, `${t.name} 님에게서는 훔칠 수 없었습니다.`, { kind: "thief", who: t.id, stolen: null });
      continue;
    }
    hits.push({ victim: t, kind: "thief", by: p });
    thefts.push([p, t]);
  }

  const healed = new Set<Player>();
  for (const p of users("doctor")) {
    if (stopped.has(p)) continue;
    if (target(p) !== p) note(target(p), "의사가 다녀갔습니다.", { kind: "healed" });
    if (!p.insane) healed.add(target(p));
  }

  const armored = new Set<Player>();
  for (const p of alive) {
    if (p.act?.mode !== "armor" || stopped.has(p)) continue;
    armored.add(p);
    p.uses!--;
  }

  // 사망 판정. 저주는 치료할 수 없고, 마법사는 저주와 양초로만 죽는다. 평화로운 첫 밤에는 아무도 죽지 않는다.
  const calm = room.setup.calm && room.day === 1;
  const dying = new Set<Player>(
    (calm ? [] : hits)
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
    // 정신병자는 아무도 죽지 않은 밤이면 자기가 살렸다고 믿는다
    const believes = p.insane ? dying.size === 0 : attacked.has(t) && !dying.has(t);
    if (believes) note(p, `${t.name} 님을 공격에서 지켜냈습니다.`);
    p.scenes.push({ kind: "doctor", who: t.id, saved: believes });
  }

  for (const p of users("provoker")) {
    if (stopped.has(p) || dying.has(target(p))) continue; // 대상이 죽으면 횟수가 줄지 않는다
    p.uses!--;
    if (p.insane) continue;
    target(p).provoked = true;
    note(target(p), "누군가 집 앞에서 확성기로 떠들었습니다.", { kind: "provoked" });
  }

  const real = (p: Player): Seen => ({ role: p.role, team: p.team });
  const name = (s: Seen) => tag(s.role, s.team);
  const fake = (not?: Seen): Seen => {
    for (;;) {
      const role = oneOf(Object.keys(ROLES) as Role[]);
      const made = { role, team: oneOf(teamsOf(role)) };
      if (made.role !== not?.role || made.team !== not.team) return made;
    }
  };

  for (const p of users("investigator")) {
    if (stopped.has(p)) continue;
    const t = target(p);
    const a = p.insane ? fake() : real(t);
    const b = fake(a);
    const options: [Seen, Seen] = rng() < 0.5 ? [a, b] : [b, a];
    note(p, `${t.name} 님은 ${name(options[0])} 또는 ${name(options[1])}입니다.`, { kind: "investigator", who: t.id, options });
  }

  const pointed: [Player, Player][] = [];
  for (const p of users("snitch")) {
    if (stopped.has(p)) continue;
    const t = target(p);
    if (dying.has(t)) {
      note(p, `${t.name} 님이 죽어 밀고하지 못했습니다. 횟수는 줄지 않습니다.`, { kind: "snitch", who: t.id, role: null, team: null });
      continue;
    }
    p.uses!--;
    // 정신병자를 조사하면 그가 믿는 역할로 보인다 (수사관과 같다)
    const found = p.insane ? fake() : real(t);
    note(p, `${t.name} 님의 역할은 ${name(found)}입니다.`, { kind: "snitch", who: t.id, ...found });
    // 아침에 광장으로 나와 대상을 지목한다. 가짜 밀고자도 똑같이 지목한다.
    if (!dying.has(p)) pointed.push([p, t]);
  }

  for (const p of users("lookout")) {
    if (stopped.has(p)) continue;
    const t = target(p);
    const seen = p.insane ? [someone(p, t)].filter((q) => q !== null) : visitors(t, p);
    const names = seen.map((q) => q.name).join(", ");
    note(p, `${t.name} 님 집에 ${names ? `${names} 님이 찾아왔습니다` : "아무도 오지 않았습니다"}.`, {
      kind: "lookout",
      house: t.id,
      visitors: seen.map((q) => q.id),
    });
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
    // 폭탄을 터뜨리러 나간 것도 외출이지만 들른 집은 없다 (경찰관의 결과와 맞춘다)
    const out = went.length > 0 || (!p.insane && t.act?.mode === "detonate" && !stopped.has(t));
    note(
      p,
      `${t.name} 님은 ${houses ? `${houses} 님 집에 갔습니다` : out ? "외출했지만 들른 집은 없습니다" : "외출하지 않았습니다"}.`,
      { kind: "tracker", who: t.id, went: went.map((q) => q.id), out },
    );
  }

  for (const p of all) p.last = p.alive ? aimId(p) : null;

  // 연쇄 살인범과 도둑에게 죽은 사람의 역할은 가려진다
  const hidden = new Set(hits.filter((h) => h.kind === "sk" || h.kind === "thief").map((h) => h.victim));
  // 폭탄은 밤이 끝나기 직전에 집이 터지므로 먼저, 나머지는 발동 순서대로 (아침에 집에서 나오다 쓰러진다)
  const blasted = new Set(hits.filter((h) => h.kind === "bomb").map((h) => h.victim));
  const struck = new Set(hits.filter((h) => h.kind === "curse").map((h) => h.victim)); // 번개도 모두가 본다
  const dead = [...new Set(hits.map((h) => h.victim))].filter((p) => dying.has(p));
  for (const p of [...dead.filter((p) => blasted.has(p)), ...dead.filter((p) => !blasted.has(p))]) {
    die(p, hidden.has(p));
    p.will = true;
    announce(room, `${night}: ${p.name} 님이 사망했습니다. (${p.reveal})`);
    room.dawn.push({ kind: "death", who: p.id, reveal: p.reveal!, blast: blasted.has(p), bolt: !blasted.has(p) && struck.has(p) });
  }
  if (!dying.size) announce(room, `${night}: 아무도 죽지 않았습니다.`);
  for (const [p, t] of pointed) {
    announce(room, `${night}: ${p.name} 님이 ${t.name} 님을 지목했습니다.`);
    room.dawn.push({ kind: "snitch", by: p.id, who: t.id });
  }

  room.history.push({
    kind: "night",
    day: room.day,
    acts: alive.map((p) => ({
      by: p.id,
      role: p.role,
      fake: p.insane,
      mode: p.act?.mode ?? "rest",
      target: p.act?.target ?? null,
      extra: p.act?.extra ?? null,
      guess: p.act?.guess ?? null,
      stopped: stopped.get(p) ?? null,
    })),
    hits: hits.map((h) => ({ by: h.by.id, victim: h.victim.id, kind: h.kind, died: dying.has(h.victim) })),
  });

  // 도둑은 죽이는 데 성공해야 역할을 빼앗는다
  for (const [thief, t] of thefts) {
    if (!dying.has(t) || dying.has(thief)) continue;
    assign(thief, t.insane ? oneOf(INNOCENT) : t.role, t.team);
    thief.stole = true;
    note(thief, `${t.name} 님의 역할을 빼앗았습니다. 이제 ${tag(thief.role, thief.team)}입니다.`, {
      kind: "thief",
      who: t.id,
      stolen: { role: thief.role, team: thief.team },
    });
  }
}

function resolveDay(room: Room, rng: Rng) {
  const alive = room.players.filter((p) => p.alive);
  const nameOf = (id: string) => (id === SKIP ? "기권" : room.players.find((p) => p.id === id)!.name);
  const votes = alive.map((p) => p.pick ?? SKIP);
  // 투표는 익명이다. 누가 누구에게 던졌는지는 알리지 않고(판이 끝난 뒤의 기록에만 남는다), 받은 표 수만 알린다.
  const shown = new Map<string, number>(); // 알리는 표 수. 시장의 0.1표는 빼서 시장이 누구를 찍었는지 드러나지 않게 한다.
  const count = new Map<string, number>(); // 0.1표 단위
  const add = (id: string, n: number) => id !== SKIP && count.set(id, (count.get(id) ?? 0) + n);
  const record = (chosen: string | null) =>
    room.history.push({
      kind: "day",
      day: room.day,
      ballots: alive.map((p, i) => ({ by: p.id, to: votes[i] })),
      tally: [...count].map(([id, n]) => ({ id, votes: n / 10 })),
      chosen,
    });

  if (room.day === 0) {
    votes.forEach((v) => add(v, 10));
    const t = tops(count);
    if (!t.length) {
      record(null);
      return announce(room, "시장이 뽑히지 않았습니다.");
    }
    room.mayor = t[Math.floor(rng() * t.length)];
    record(room.mayor);
    announce(room, `${nameOf(room.mayor)} 님이 시장이 되었습니다.${t.length > 1 ? " (동률이라 추첨)" : ""} 시장의 표는 1.1표입니다.`);
    return;
  }

  const provoked = alive.filter((p) => p.provoked);
  // 선동은 2표. 다만 사람이 적을 때 선동 표만으로 과반이 되지 않도록 과반 직전까지만 준다.
  const bonus = Math.min(20, alive.length * 5);
  for (const p of provoked) {
    add(p.id, bonus);
    shown.set(p.id, bonus);
    p.provoked = false;
  }
  alive.forEach((p, i) => add(votes[i], p.id === room.mayor ? 10 + MAYOR_BONUS : 10));
  for (const v of votes) if (v !== SKIP) shown.set(v, (shown.get(v) ?? 0) + 10);
  if (provoked.length) announce(room, `선동으로 ${bonus / 10}표를 안고 시작: ${provoked.map((p) => p.name).join(", ")}`);
  if (count.size) announce(room, `${room.day}일차 득표: ${[...count].sort((a, b) => b[1] - a[1]).map(([id]) => `${nameOf(id)} ${shown.get(id)! / 10}표`).join(", ")}`);

  // 과반 득표여야 추방된다. 동률이면 시장의 0.1표가 가른다.
  const t = tops(count);
  if (t.length !== 1 || count.get(t[0])! * 2 <= alive.length * 10) {
    announce(room, "과반을 얻은 사람이 없어 아무도 추방되지 않았습니다.");
    record(null);
    return;
  }
  const out = room.players.find((p) => p.id === t[0])!;
  record(out.id);
  die(out);
  announce(room, `${out.name} 님이 추방당했습니다. (${out.reveal})`);
  if (out.role === "haunter" && out.mark) out.haunting = true;
}

function finish(room: Room, winner: Winner, why: string, solo?: Player) {
  room.winner = winner;
  room.why = why;
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
  announce(room, `${room.result}! ${why}.`);
}

// 남은 사람들로 승패가 갈렸는가. 생존자는 누구의 승패에도 영향을 주지 않으므로 세지 않는다.
// 판 구성(Slot)에도 그대로 쓴다: 시작하자마자 끝나는 구성을 걸러 낸다.
function verdict<T extends Slot>(all: T[]): { winner: Winner; why: string; solo?: T } | null {
  const live = all.filter((p) => p.role !== "survivor");
  const imposters = live.filter((p) => p.team === "imposter").length;
  const killers = live.filter((p) => p.team === "neutral" && KILLERS.includes(p.role as Role));
  const rest = live.length - imposters - killers.length;
  if (!live.length) return { winner: "draw", why: "아무도 살아남지 못했습니다" };
  if (!imposters && !killers.length) return { winner: "innocent", why: "임포스터와 살인 중립이 모두 사라졌습니다" };
  if (!killers.length && imposters >= rest) return { winner: "imposter", why: "임포스터가 남은 사람의 절반 이상입니다" };
  if (!imposters && killers.length === 1 && rest <= 1)
    return { winner: "solo", why: "임포스터가 사라지고 다른 사람이 한 명 이하로 남았습니다", solo: killers[0] };
  return null;
}

// 현재 페이즈를 정산하고 다음으로 넘긴다. 고르지 않은 사람은 무행동/기권 처리.
export function advance(room: Room, rng: Rng = Math.random) {
  if (room.phase !== "night" && room.phase !== "day") return;
  const logFrom = room.log.length;
  const notesFrom = room.players.map((p) => p.notes.length);
  const living = () => room.players.filter((p) => p.alive);
  const before = living().length;
  const election = room.phase === "day" && room.day === 0;

  if (room.phase === "night") {
    resolveNight(room, rng);
    room.phase = "day";
  } else {
    resolveDay(room, rng);
    if (room.day === 0) {
      const hands = room.setup.auto ? deal(room.players.length, rng) : dealSlots(room.setup.slots, rng);
      room.players.forEach((p, i) => assign(p, hands[i].role, hands[i].team, hands[i].insane));
      const order = Object.keys(ROLES);
      room.roster = hands.map((h) => h.role).sort((a, b) => order.indexOf(a) - order.indexOf(b));
      announce(room, "역할이 정해졌습니다. 자신의 역할을 확인하세요.");
    }
    for (const p of room.players) {
      p.will = false; // 유언은 죽은 다음 낮에만 남길 수 있다
      p.scenes = [];
    }
    room.dawn = [];
    room.turn = 0;
    room.phase = "night";
    room.day++;
  }
  // 교착 무승부: 서로 이길 수 없는 사람들만 남아 판이 끝나지 않는 것을 막는다
  if (!election) room.quiet = living().length < before ? 0 : room.quiet + 1;
  const end = verdict(living());
  if (end) finish(room, end.winner, end.why, end.solo);
  else if (room.quiet >= QUIET_MAX) finish(room, "draw", `${QUIET_MAX}번 연속으로 아무도 죽거나 추방되지 않았습니다`);

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
    if (p === me) return tag(me.role, me.team); // 정신병자는 자기가 정신병자인 줄 모른다
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
    why: room.why,
    history: room.phase === "ended" ? room.history : null, // 복기용. 진행 중에는 절대 내려보내지 않는다
    roster: room.roster,
    dawn: room.dawn,
    setup: room.setup,
    remaining: room.deadline === null ? null : Math.max(0, room.deadline - now),
    pending: room.phase === "day" ? pending(room).length : 0, // 밤에는 누가 골랐는지가 곧 역할이라 알리지 않는다
    // 밤: 마법사의 차례가 지나면 번개가 떨어진 집을 모두가 본다. 맞혔으면 대상의 집, 틀렸으면 마법사 자신의 집.
    bolts:
      night && room.turn > turns(room).findIndex((t) => t.includes("sorcerer"))
        ? room.players
            .filter((p) => p.alive && p.role === "sorcerer" && p.act?.mode === "ability")
            .map((p) => (p.act!.guess === byId(p.act!.target)?.role ? p.act!.target! : p.id))
        : [],
    // 밤: 지금 누구 차례인가
    turn: night
      ? {
          names: (turns(room)[room.turn] ?? []).filter((r) => r === "imposter" || room.roster.includes(r)).map((r) => (r === "imposter" ? "임포스터" : ROLES[r].name)),
          mine: me.alive && turnOf(room, me) === room.turn,
        }
      : null,
    news: [...room.news, ...me.news],
    chat: room.chat.filter((c) => hears(room, me, c.to)),
    hostId: room.players.find((p) => p.connected)?.id ?? null,
    me: {
      id: me.id,
      alive: me.alive,
      role: unknown ? null : me.role,
      team: me.team,
      uses: me.uses,
      modes: night && me.alive && turnOf(room, me) === room.turn ? modes(me) : [],
      both: night && me.alive && canDoBoth(room, me),
      will: playing && me.will,
      act: me.act,
      pick: me.pick,
      // 오늘 밤 능력 대상으로 고를 수 없는 사람
      blocked: night && (me.role === "doctor" || me.role === "blocker") ? me.last : null,
      notes: me.notes,
      scenes: me.scenes,
    },
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      skin: p.skin,
      house: p.house,
      hat: p.hat,
      alive: p.alive,
      connected: p.connected,
      mayor: p.id === room.mayor,
      label: label(p),
      ally: ally(p),
      doing: night && ally(p) ? doing(p) : null, // 같은 편의 오늘 밤 행동
      picked: playing ? (night ? p === me && p.act !== null : p.pick !== null) : false, // 밤에는 차례가 역할을 말해 주므로 남이 골랐는지는 알리지 않는다
      provoked: room.phase === "day" && p.provoked,
      bombed: me.role === "bomber" && p.bombed, // 폭파범에게만: 폭탄을 설치해 둔 집
      marked: me.role === "haunter" && me.mark === p.id, // 무속인에게만: 양초를 둔 사람
      won: room.phase === "ended" && p.won,
    })),
  };
}

export type View = ReturnType<typeof view>;
