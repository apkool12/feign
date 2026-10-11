"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import pkg from "../package.json";
import { COLORS } from "./colors";
import { setFx, useFx } from "./fx";
import { play, setVolume, useGameSound, useUiSound, volume } from "./sound";
import { said, typing } from "./talk";
import { periodsOf } from "./timeline";
import type { Period, Step } from "./timeline";
import { ambience } from "./sound";
import { useVoiceOn, voice } from "./voice";
import { flashOf, stage, type Call, type Exile, type Flash } from "./stage";
import type { Positions, Seat } from "./Village";
import { DAY_CHOICES, HATS, HOUSES, INSANE, MAX_PLAYERS, MIN_PLAYERS, POOL, ROLES, SKINS, SKIP, TEAM_NAME } from "../game";
import type { Hat, HistoryEntry, House, Mode, Role, Skin, Slot, Team, View } from "../game";

const SKIN_NAME: Record<Skin, string> = { blob: "기본", chiikawa: "치이카와", hachiware: "하치와레", usagi: "우사기" };
const HOUSE_NAME: Record<House, string> = {
  house: "기본",
  "house-1": "오두막",
  "house-2": "통나무집",
  "house-3": "초가집",
  "house-4": "버섯집",
  "house-5": "돌탑집",
  "house-6": "과자집",
  "house-7": "호박집",
  "house-8": "풍차집",
};
const HAT_NAME: Record<Hat, string> = { none: "없음", straw: "밀짚모자", wizard: "마법사 모자", top: "중절모", bow: "리본" };

// WebGL은 브라우저에서만 돌므로 서버 렌더링에서 뺀다
const Preview = dynamic(() => import("./Preview"), { ssr: false });
const CutIn = dynamic(() => import("./Preview").then((m) => m.CutIn), { ssr: false });
const Lineup = dynamic(() => import("./Preview").then((m) => m.Lineup), { ssr: false });
const Village = dynamic(() => import("./Village"), {
  ssr: false,
  loading: () => <p className="out p-4">마을 불러오는 중…</p>,
});

// ponytail: sessionStorage라 탭마다 다른 사람이고(한 PC에서 여러 탭으로 테스트 가능),
// 새로고침은 버티지만 탭을 닫으면 자리를 잃는다 — 불편하면 localStorage로.
type Saved = { token: string; name?: string; code?: string };
const KEY = "feign";

function loadSaved(): Saved {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    if (s?.token) return s;
  } catch {}
  // randomUUID는 https/localhost에서만 되므로 getRandomValues를 쓴다
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return { token: Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") };
}

function store(s: Saved) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}

// 방 밖에서도 기억하는 것: 이름, 꾸미기, 마지막 방, 목록으로 보기. 탭끼리 같이 쓴다.
type Prefs = { name: string; skin: Skin; house: House; hat: Hat; last: string; list: boolean };
const PREFS: Prefs = { name: "", skin: "blob", house: "house", hat: "none", last: "", list: false };
function loadPrefs(): Prefs {
  try {
    const p = { ...PREFS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
    if (SKINS.includes(p.skin) && HOUSES.includes(p.house) && HATS.includes(p.hat)) return p;
  } catch {}
  return PREFS;
}
function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {}
}
// 초대 링크(/?room=ABCD)의 방 코드
const invited = () => (new URLSearchParams(location.search).get("room") ?? "").toUpperCase().slice(0, 4);

const icon = (d: React.ReactNode) => (
  <svg viewBox="0 0 24 24" aria-hidden>
    {d}
  </svg>
);
const ICON = {
  fx: icon(<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />),
  list: icon(
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.5" cy="6" r="1" />
      <circle cx="4.5" cy="12" r="1" />
      <circle cx="4.5" cy="18" r="1" />
    </>,
  ),
  mic: icon(<path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4" />),
  gear: icon(
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
    </>,
  ),
  close: icon(<path d="M6 6l12 12M18 6L6 18" />),
  check: icon(<path d="M5 13l5 5 9-11" />),
  pen: icon(<path d="M4 20l1-4L16 5l3 3L8 19Z" />),
  grave: icon(
    <>
      <path d="M7 21V10a5 5 0 0 1 10 0v11Z" />
      <path d="M4 21h16M12 9v5M10 11h4" />
    </>,
  ),
  crown: icon(<path d="M4 18h16l1-10-5 4-4-7-4 7-5-4Z" />),
  out: icon(
    <>
      <path d="M10 4H5v16h5" />
      <path d="M13 8l5 4-5 4M18 12H9" />
    </>,
  ),
  to: icon(<path d="M5 12h14M13 6l6 6-6 6" />),
  skip: icon(
    <>
      <path d="M5 5l9 7-9 7Z" />
      <path d="M18 5v14" />
    </>,
  ),
  knife: icon(
    <>
      <path d="M14 3c4 2 6 6 5 11l-7-5Z" />
      <path d="M11 10l-7 9M8 11l4 4" />
    </>,
  ),
  shield: icon(<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6Z" />),
};
const speaker = (v: number) =>
  icon(
    <>
      <path d="M3 9.5v5h4l5 4v-13l-5 4Z" />
      {v === 0 && <path d="M16 9.5l5 5M21 9.5l-5 5" />}
      {v > 0 && <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5" />}
      {v > 0.34 && <path d="M18 7a7 7 0 0 1 0 10" />}
      {v > 0.67 && <path d="M20.5 4.5a10.5 10.5 0 0 1 0 15" />}
    </>,
  );

// 역할 패에 새기는 한 글자
const ROLE_MARK: Record<Slot["role"], string> = {
  insane: "정",
  doctor: "의",
  blocker: "경",
  lookout: "감",
  investigator: "수",
  trapper: "덫",
  snitch: "밀",
  provoker: "선",
  tracker: "추",
  cleaner: "청",
  blamer: "탓",
  survivor: "생",
  serialKiller: "살",
  bomber: "폭",
  thief: "도",
  sorcerer: "마",
  haunter: "무",
};

// 연출만 따로 보기: /?demo=cutin (밀고자 지목 컷인을 되풀이한다)
function CutInDemo({ still }: { still: boolean }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (still) return;
    const timer = setInterval(() => setN((x) => x + 1), 3600);
    return () => clearInterval(timer);
  }, [still]);
  const looks = [
    { skin: "blob", hat: "wizard", color: COLORS[0] },
    { skin: "blob", hat: "straw", color: COLORS[3] },
    { skin: "blob", hat: "none", color: COLORS[5] },
  ];
  return (
    <main className="fixed inset-0" style={{ background: "var(--sky)" }}>
      <CutIn key={n} by={looks[n % 3]} who={looks[(n + 1) % 3]} still={still} />
    </main>
  );
}

function demoSeat(id: string, skin: Skin, house: House, hat: Hat, i: number): Seat {
  return {
    id,
    name: "",
    skin,
    house,
    hat,
    done: false,
    alive: true,
    isMe: i === 0,
    ally: true,
    mayor: false,
    enabled: false,
    mark: null,
    effect: null,
    status: "",
    bombed: false,
    marked: false,
    won: false,
  };
}

function ActVillageDemo({ demo }: { demo: string }) {
  const params = new URLSearchParams(location.search);
  const skin = SKINS.includes(params.get("skin") as Skin) ? (params.get("skin") as Skin) : "blob";
  const held = params.get("held") !== "0";
  const action = demo === "act-doctor" ? "doctor" : demo === "act-cleaner" ? "cleaner" : null;
  const positions = useRef<Positions>(new Map());
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!action) return;
    const timer = setInterval(() => setN((x) => x + 1), 9000);
    return () => clearInterval(timer);
  }, [action]);
  const seats = [
    demoSeat("demo-me", skin, "house-1", "none", 0),
    demoSeat("demo-target", "hachiware", "house-4", "straw", 1),
    demoSeat("demo-2", "usagi", "house-6", "bow", 2),
    demoSeat("demo-3", "blob", "house-8", "wizard", 3),
  ];
  if (action) seats[1].effect = action;
  const replay: Flash = [{ kind: "doctor", who: "demo-target", saved: true }];
  const call: Call = { events: [{ kind: "death", who: "demo-target", reveal: "의사(시민)", blast: true, bolt: false }], mine: [] };
  return (
    <main className="fixed inset-0" style={{ background: "var(--sky)" }}>
      {action ? (
        <Village
          key={n}
          seats={seats}
          scene="night"
          going="demo-target"
          iconRole={action}
          shield={false}
          actKind={action}
          standKind={action}
          positions={positions}
          demo
          hud={false}
          heldTools={held}
          onPick={() => {}}
          onMove={() => {}}
        />
      ) : demo === "recall-doctor-saved" ? (
        <Village
          key={n}
          seats={seats}
          scene="day"
          going={null}
          iconRole={null}
          shield={false}
          positions={positions}
          demo
          hud={false}
          replay={replay}
          onReplayEnd={() => setN((x) => x + 1)}
          onPick={() => {}}
          onMove={() => {}}
        />
      ) : (
        <Village
          key={n}
          seats={seats}
          scene="day"
          going={null}
          iconRole={null}
          shield={false}
          positions={positions}
          demo
          hud={false}
          call={call}
          onCallEnd={() => setN((x) => x + 1)}
          burnt={["demo-target"]}
          onPick={() => {}}
          onMove={() => {}}
        />
      )}
    </main>
  );
}

export default function Page() {
  const [demo, setDemo] = useState<string | null>(null);
  useEffect(() => setDemo(new URLSearchParams(location.search).get("demo") ?? ""), []);
  const [view, setView] = useState<View | null>(null);
  const [due, setDue] = useState<number | null>(null); // 페이즈가 끝나는 시각 (이 기기 시계 기준)
  const [error, setError] = useState("");
  const [online, setOnline] = useState(false);
  useUiSound();
  const ws = useRef<WebSocket | null>(null);
  const saved = useRef<Saved>({ token: "" });
  const positions = useRef<Positions>(new Map()); // 다른 플레이어들의 위치. 매 프레임 읽으므로 state에 두지 않는다
  const heard = useRef<{ code: string; n: number; last: unknown }>({ code: "", n: 0, last: null }); // 말풍선으로 이미 띄운 대화의 끝
  const [prefs, setPrefs] = useState(PREFS);
  const mine = useRef(PREFS); // 소켓 핸들러가 읽는 최신 prefs
  const fresh = useRef(false); // 메뉴에서 방금 들어갔다 (자리 복귀가 아니다)
  const [invite, setInvite] = useState("");
  const update = (patch: Partial<Prefs>) => {
    mine.current = { ...mine.current, ...patch };
    savePrefs(mine.current);
    setPrefs(mine.current);
  };
  const join = (code: string) => {
    fresh.current = true;
    saved.current.name = mine.current.name;
    send({ t: "join", token: saved.current.token, name: mine.current.name, code });
  };

  const send = (m: object) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(m));
  };

  useEffect(() => {
    if (demo !== "") return;
    voice.attach(send);
    saved.current = loadSaved();
    mine.current = loadPrefs();
    setPrefs(mine.current);
    setInvite(invited());
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const open = () => {
      const sock = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
      let joined = false;
      ws.current = sock;
      sock.onopen = () => {
        setOnline(true);
        // 초대 링크로 다른 방에 왔으면 전에 있던 방으로 돌아가지 않는다
        const other = invited() && invited() !== saved.current.code;
        if (saved.current.code && !other) sock.send(JSON.stringify({ t: "join", ...saved.current }));
        else if (invited() && mine.current.name) join(invited()); // 초대 링크로 왔고 이름이 있으면 메뉴를 건너뛴다
      };
      sock.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === "state") {
          const state: View = m.state;
          joined = true;
          // 새로 온 말을 그 사람 머리 위에 띄운다. 처음 받은 대화나 한꺼번에 풀린 비밀 대화는 띄우지 않는다.
          const h = heard.current;
          const tail = state.chat.at(-1);
          // ponytail: 대화가 200줄로 찬 뒤에는 길이가 그대로라 끝 줄이 바뀐 것만 본다(한 번에 한 줄)
          const added = state.code !== h.code ? 0 : state.chat.length > h.n ? state.chat.length - h.n : tail && JSON.stringify(tail) !== h.last ? 1 : 0;
          if (added > 0 && added <= 3)
            for (const c of state.chat.slice(-added)) {
              const who = c.name && state.players.find((p) => p.name === c.name);
              if (who) said(who.id, c.text);
            }
          heard.current = { code: state.code, n: state.chat.length, last: tail ? JSON.stringify(tail) : null };
          saved.current.code = state.code;
          store(saved.current);
          if (fresh.current) {
            fresh.current = false;
            const { skin, house, hat } = mine.current;
            // 메뉴에서 골라 둔 꾸미기. 서버는 대기실에서만 받는다.
            if (state.phase === "lobby") for (const m of [{ t: "skin", skin }, { t: "house", house }, { t: "hat", hat }]) sock.send(JSON.stringify(m));
            update({ last: state.code });
            history.replaceState(null, "", location.pathname);
            setInvite("");
          }
          setView(state);
          setDue(state.remaining === null ? null : Date.now() + state.remaining);
          setError("");
        } else if (m.t === "typing") {
          typing(m.id, m.on);
        } else if (m.t === "rtc") {
          void voice.handle(m.from, m.data);
        } else if (m.t === "pos") {
          positions.current.set(m.id, { x: m.x, z: m.z });
        } else {
          play("error");
          setError(m.msg);
          if (!joined) {
            // 입장 실패: 저장된 방을 잊고 입장 화면으로
            delete saved.current.code;
            store(saved.current);
            fresh.current = false;
            setView(null);
          }
        }
      };
      sock.onclose = (e) => {
        setOnline(false);
        if (e.code === 4000) setError("다른 탭에서 접속해 이 탭의 연결이 끊겼어요.");
        else if (!stopped) timer = setTimeout(open, 1000);
      };
    };
    open();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ws.current?.close();
    };
  }, [demo]);

  const leave = () => {
    try {
      sessionStorage.removeItem(KEY);
    } catch {}
    location.reload();
  };

  if (demo === null) return <main className="flex flex-1 flex-col" />;
  if (demo.startsWith("cutin")) return <CutInDemo still={demo === "cutin-still"} />;
  if (demo === "act-doctor" || demo === "recall-doctor-saved" || demo === "dawn-blast" || demo === "act-cleaner") return <ActVillageDemo demo={demo} />;
  return (
    <main className="flex flex-1 flex-col">
      <div className="pointer-events-none fixed inset-x-0 top-24 z-30 flex flex-col items-center gap-2 px-3">
        {error && view && (
          <p role="alert" className="toast paper" key={error} style={{ borderColor: "var(--blood)" }}>
            {error}
          </p>
        )}
        {!online && <p className="chip">서버 연결 중…</p>}
      </div>
      {view ? (
        <Game view={view} due={due} positions={positions} send={send} leave={leave} />
      ) : (
        <Menu online={online} error={error} prefs={prefs} update={update} invite={invite} onJoin={join} />
      )}
    </main>
  );
}

// 메뉴 배경에 서 있는 마을 사람들 (이름이 없어 이름표도 없다)
const EXTRAS: Seat[] = (
  [
    ["blob", "house-1", "straw"],
    ["chiikawa", "house-4", "none"],
    ["blob", "house-8", "none"],
    ["hachiware", "house-2", "none"],
    ["usagi", "house-6", "bow"],
    ["blob", "house-7", "wizard"],
  ] as const
).map(([skin, house, hat], i) => ({
  id: `extra-${i}`,
  name: "",
  skin,
  house,
  hat,
  done: false,
  alive: true,
  isMe: false,
  ally: true, // 밤에도 보이게
  mayor: false,
  enabled: false,
  mark: null,
  effect: null,
  status: "",
  bombed: false,
  marked: false,
  won: false,
}));
const HOWTO = ["밤: 한 집을 골라 찾아간다", "낮: 모여서 누가 수상한지 얘기한다", "투표로 한 명을 추방한다", "우리 편이 끝까지 살아남으면 승리"];
// 서버의 거절 문구를 메뉴에 맞게 줄인다
const SHORT = [
  ["없는 방", "그런 방 없어요"],
  ["이미 시작", "벌써 시작했어요"],
  ["이미 있는 닉네임", "그 이름은 이미 있어요"],
  ["닉네임을", "이름부터 정해요"],
];
const short = (msg: string) => SHORT.find(([k]) => msg.startsWith(k))?.[1] ?? msg;

type MenuProps = {
  online: boolean;
  error: string;
  prefs: Prefs;
  update: (patch: Partial<Prefs>) => void;
  invite: string; // 초대 링크로 받은 방 코드
  onJoin: (code: string) => void; // 빈 코드면 새 방
};

// 메인 메뉴. 뒤에서는 마을이 혼자 돌아간다.
function Menu({ online, error, prefs, update, invite, onJoin }: MenuProps) {
  const [open, setOpen] = useState<"join" | "how" | "custom" | "settings" | "name" | null>(null);
  const [pending, setPending] = useState<string | null>(null); // 이름을 정하면 들어갈 방
  const [code, setCode] = useState("");
  const [night, setNight] = useState(false);
  const nobody = useRef<Positions>(new Map());

  useEffect(() => {
    document.title = "Feign";
    const timer = setInterval(() => setNight((n) => !n), 40_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    ambience(night ? { fire: 0.3, crickets: 0.5, water: 0.2 } : { fire: 0.5, water: 0.35 });
    return () => ambience({});
  }, [night]);

  const go = (to: string) => {
    if (prefs.name) return onJoin(to);
    setPending(to);
    setOpen("name");
  };
  // 초대 링크로 왔는데 이름이 없으면 이름만 묻는다
  useEffect(() => {
    if (!invite || prefs.name) return;
    setPending(invite);
    setOpen("name");
  }, [invite, prefs.name]);

  const alert = error && (
    <p role="alert" className="chip" key={error} style={{ background: "var(--blood)" }}>
      {short(error)}
    </p>
  );

  return (
    <div className="menu">
      <div className="bg" aria-hidden>
        <Village seats={EXTRAS} scene={night ? "night" : "day"} going={null} iconRole={null} shield={false} positions={nobody} demo onPick={() => {}} onMove={() => {}} />
      </div>
      <div className="veil" />
      <div className="left">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="logo" src="/logo.png" alt="Feign" />
        <button className="btn go big" disabled={!online} onClick={() => go("")}>
          방 만들기
        </button>
        <button className="btn big" disabled={!online} onClick={() => setOpen("join")}>
          참가
        </button>
        <button className="btn" onClick={() => setOpen("how")}>
          게임 방법
        </button>
        {open !== "join" && alert}
      </div>
      <div className="right">
        <div className="me">
          <Preview skin={prefs.skin} hat={prefs.hat} color={COLORS[0]} />
        </div>
        <button className="btn" aria-label="이름 바꾸기" onClick={() => setOpen("name")}>
          {prefs.name || "이름"}
          <span className="gl">{ICON.pen}</span>
        </button>
        <button className="btn" onClick={() => setOpen("custom")}>
          꾸미기
        </button>
      </div>
      <button className="ib gear" aria-label="설정" onClick={() => setOpen("settings")}>
        {ICON.gear}
      </button>
      <small className="ver">v{pkg.version}</small>

      {open && (
        <Modal
          key={open}
          label={{ join: "참가", how: "게임 방법", custom: "꾸미기", settings: "설정", name: "이름" }[open]}
          width={{ join: 440, how: 960, custom: 1000, settings: 400, name: 380 }[open]}
          onClose={() => {
            setOpen(null);
            setPending(null);
          }}
        >
          {open === "join" && (
            <form
              className="flex flex-col items-center gap-5"
              onSubmit={(e) => {
                e.preventDefault();
                if (code.length === 4) go(code);
              }}
            >
              <label className="code" aria-label="방 코드">
                <input
                  autoFocus
                  value={code}
                  maxLength={4}
                  autoComplete="off"
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
                />
                {[0, 1, 2, 3].map((i) => (
                  <b key={i} data-on={i === Math.min(code.length, 3)}>
                    {code[i]}
                  </b>
                ))}
              </label>
              {alert}
              <button className="btn go big" disabled={!online || code.length < 4}>
                들어가기
              </button>
              {prefs.last && (
                <button type="button" className="btn" disabled={!online} onClick={() => go(prefs.last)}>
                  방금 그 방 {prefs.last}
                </button>
              )}
            </form>
          )}
          {open === "how" && (
            <div className="flex flex-col items-center gap-6">
              <ol className="how">
                {HOWTO.map((line, i) => (
                  <li key={line}>
                    <div data-n={i}>{[<i key="m" className="moon" />, <i key="s" className="sun" />, <span key="v" className="gl">{ICON.check}</span>, <RoleTile key="r" role="survivor" size="lg" />][i]}</div>
                    {line}
                  </li>
                ))}
              </ol>
              <button className="btn go" onClick={() => setOpen(null)}>
                확인
              </button>
            </div>
          )}
          {open === "custom" && (
            <Custom
              skin={prefs.skin}
              house={prefs.house}
              hat={prefs.hat}
              color={COLORS[0]}
              onSkin={(skin) => update({ skin })}
              onHouse={(house) => update({ house })}
              onHat={(hat) => update({ hat })}
            />
          )}
          {open === "settings" && (
            <div className="flex flex-col gap-1">
              <Volume />
          <Fx />
              <div className="row">
                <span className="gl w-12">{ICON.list}</span>
                <b className="d flex-1 text-lg font-normal">목록으로 보기</b>
                <button role="switch" aria-checked={prefs.list} aria-label="목록으로 보기" className="sw" onClick={() => update({ list: !prefs.list })} />
              </div>
            </div>
          )}
          {open === "name" && (
            <form
              className="flex flex-col items-center gap-5"
              onSubmit={(e) => {
                e.preventDefault();
                const name = String(new FormData(e.currentTarget).get("name")).trim();
                if (!name) return;
                update({ name });
                setOpen(null);
                // 초대받은 방에 이름이 겹쳐 못 들어갔다면 고친 이름으로 다시 간다
                const to = pending ?? (invite || null);
                if (to !== null) onJoin(to);
                setPending(null);
              }}
            >
              <input name="name" aria-label="이름" autoFocus required maxLength={12} autoComplete="off" defaultValue={prefs.name} placeholder="이름" className="field w-full text-center" />
              <button className="btn go">확인</button>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}

type GameProps = {
  view: View;
  due: number | null;
  positions: React.RefObject<Positions>;
  send: (m: object) => void;
  leave: () => void;
};

const ROLE_BY_NAME = Object.fromEntries((Object.keys(ROLES) as Role[]).map((r) => [ROLES[r].name, r]));
// 서버가 주는 표기("의사(시민)", "정신병자·감시자(시민)")에서 그림으로 쓸 역할을 찾는다
function roleOf(label: string | null): Slot["role"] | null {
  if (!label) return null;
  if (label.startsWith(INSANE.name)) return "insane";
  return ROLE_BY_NAME[label.split("(")[0]] ?? null;
}

type Open = "info" | "menu" | "custom" | "setup" | "history" | null;

// 화면은 view를 그리고 send로 행동을 보내기만 한다.
function Game({ view, due, positions, send, leave }: GameProps) {
  const { me, phase, players } = view;
  const isHost = view.hostId === me.id;
  const night = phase === "night";
  const playing = night || phase === "day";
  const election = phase === "day" && view.day === 0;

  const title = {
    lobby: "대기실",
    night: `${view.day}일차 밤`,
    day: election ? "시장 선거" : `${view.day}일차 낮`,
    ended: view.result || "게임 종료",
  }[phase];

  const [open, setOpen] = useState<Open>(null);
  const [asList, setList] = useState(() => loadPrefs().list);
  const setAsList = (list: boolean) => {
    setList(list);
    savePrefs({ ...loadPrefs(), list });
  };
  const [copied, setCopied] = useState(false);
  const [shut, setShut] = useState(""); // 결과 화면을 닫아 둔 판

  // 페이즈가 바뀌면 탭 제목으로 알린다 (소리는 useGameSound)
  const phaseKey = `${phase}-${view.day}`;
  useEffect(() => {
    document.title = `${title} · Feign`;
  }, [title]);
  useGameSound(view, due);

  // 음성 대화의 들리는 범위는 채팅과 같다
  const talking = useVoiceOn();
  useEffect(() => {
    const live = phase === "night" || phase === "day";
    voice.rule(me.id, !live || !me.alive || phase === "day" || me.team === "imposter", (id) => {
      const p = players.find((x) => x.id === id);
      if (!p) return false;
      if (!live) return true;
      if (!p.alive) return !me.alive;
      return phase === "day" || (p.ally && me.team === "imposter");
    });
  });
  useEffect(() => () => voice.stop(), []);

  // 역할이 정해지는 순간 한 번 크게 보여 준다
  const hadRole = useRef(me.role !== null);
  const [reveal, setReveal] = useState(false);
  useEffect(() => {
    if (me.role && !hadRole.current) setReveal(true);
    hadRole.current = me.role !== null;
  }, [me.role]);
  useEffect(() => {
    if (!reveal) return;
    stage.hold(8000); // 역할 카드가 화면을 가리는 동안 해 질 녘 연출은 기다린다
    const timer = setTimeout(() => setReveal(false), 8000);
    return () => {
      clearTimeout(timer);
      stage.release();
    };
  }, [reveal]);

  // 밤이 끝나면 어젯밤 본 것(감시·추적)을 마을 안에서 다시 보여 준다
  const flash = flashOf(me.scenes);
  // 마을이 낮을 한 순간도 먼저 보지 않게, 페이즈가 바뀐 그 렌더에서 바로 정한다
  const [before, setBefore] = useState(phase);
  const [replay, setReplay] = useState<Flash | null>(null);
  // 그 뒤에 모두가 보는 아침 발표가 이어진다. 발표가 닿기 전까지 밤사이 죽은 사람의 집은 멀쩡해 보인다.
  const [call, setCall] = useState<Call | null>(null);
  const [unseen, setUnseen] = useState<string[]>([]);
  const [told, setTold] = useState(""); // 발표로 다 보여 준 아침 (같은 내용의 소식 딱지는 띄우지 않는다)
  // 낮이 추방으로 끝나면 쫓겨나는 장면부터 본다 (결과 화면도 그 뒤에)
  const [exile, setExile] = useState<Exile | null>(null);
  const [living, setLiving] = useState(() => players.filter((p) => p.alive).map((p) => p.id)); // 지난 페이즈가 시작될 때 살아 있던 사람들
  if (before !== phase) {
    const dawn = before === "night" && phase === "day" && !asList;
    // 낮 동안 사라진 사람이 추방된 사람이다 (게임이 그 추방으로 끝나도 같다)
    const out = before === "day" && !asList ? players.find((p) => !p.alive && living.includes(p.id)) : undefined;
    setLiving(players.filter((p) => p.alive).map((p) => p.id));
    setBefore(phase);
    setReplay(dawn ? flash : null);
    setCall(dawn ? { events: view.dawn, mine: me.scenes } : null);
    setExile(out ? { who: out.id, reveal: out.label ?? "" } : null);
    if (out) stage.hold(6500); // 해 질 녘 귀가는 추방 장면이 끝난 뒤에 (마을이 이 렌더에서 바로 전환을 시작하므로 여기서 잡아 둔다)
    setUnseen(dawn ? view.dawn.flatMap((e) => (e.kind === "death" ? [e.who] : [])) : out ? [out.id] : []);
  }

  // 연출이 어떤 까닭으로든 끝나지 않으면 화면을 돌려준다
  useEffect(() => {
    if (!replay && !call && !exile) return;
    const timer = setTimeout(() => {
      setReplay(null);
      setCall(null);
      setExile(null);
      setUnseen([]);
    }, 16000);
    return () => clearTimeout(timer);
  }, [replay, call, exile]);

  // Tab: 마을 사람과 기록, Enter: 말하기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      const tag = e.target instanceof HTMLElement ? e.target.tagName : "";
      const typing = tag === "INPUT" || tag === "SELECT";
      // 단추에 포커스가 있으면 Tab은 원래대로 다음 단추로 간다 (Shift+Tab으로 언제든 포커스를 잡을 수 있다)
      if (e.key === "Tab" && !e.shiftKey && (e.target === document.body || tag === "CANVAS")) {
        e.preventDefault();
        setOpen("info");
      } else if (e.key === "Enter" && !typing && tag !== "BUTTON") {
        const input = document.getElementById("chat-in");
        if (input) {
          e.preventDefault();
          input.focus();
        }
      } else if (e.key === "Escape" && typing) (e.target as HTMLElement).blur();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  // 밤에 집(카드)을 누르면 실행할 행동. 임포스터는 살해와 능력 중에서 고른다.
  const targeted: Mode[] = me.modes.filter((m) => m === "kill" || m === "ability");
  const [wanted, setWanted] = useState<Mode>("kill");
  const mode = targeted.includes(wanted) ? wanted : targeted[0];
  // 쉬기처럼 집을 고르지 않는 행동을 고른 날. 그날은 집을 고르는 단추를 눌린 모양으로 두지 않는다.
  const [idleDay, setIdleDay] = useState<number | null>(() => (me.act && !targeted.includes(me.act.mode) ? view.day : null));
  const resting = idleDay === view.day;
  // 오늘 밤 마지막으로 집을 골라 보낸 행동. 쉬기를 눌렀다가 마음을 바꾸면 이것을 다시 보낸다.
  const aim = useRef<{ day: number; act: NonNullable<typeof me.act> } | null>(null);
  useEffect(() => {
    if (me.act && targeted.includes(me.act.mode)) aim.current = { day: view.day, act: me.act };
  });
  const [guess, setGuess] = useState<Role>("doctor");
  const role = me.role ? ROLES[me.role] : null;
  const uses = me.uses === null ? "" : ` ${me.uses}`;
  const MODE: Record<Mode, { label: string; img: string | null }> = {
    kill: { label: "살해", img: "serialKiller" },
    ability: { label: `${role?.action}${uses}`, img: me.role },
    armor: { label: `갑옷${uses}`, img: "survivor" },
    detonate: { label: "터뜨리기", img: "bomber" },
    rest: { label: "쉬기", img: null },
  };

  // 능력을 쓸 수 없는 밤이면 이유를 알려 준다
  const idle =
    !night || !me.alive || me.role === "survivor" || me.modes.includes("ability")
      ? ""
      : me.uses === 0
        ? "능력을 다 썼다"
        : "";
  const hint =
    playing && !me.alive
      ? me.will
        ? "죽었다 · 낮에 유언 한마디"
        : "죽었다"
      : me.both
          ? "혼자 남았다 · 살해와 능력 둘 다"
          : idle;

  // 밤에 집을 골랐을 때. 혼자 남은 임포스터는 살해 대상과 능력 대상을 따로 고른다.
  const visit = (id: string) => {
    setIdleDay(null);
    if (!me.both) return send({ t: "act", mode, target: id, guess });
    const killed = mode === "kill" ? id : me.act?.mode === "kill" ? me.act.target : null;
    const aimed = mode === "ability" ? id : me.act?.mode === "ability" ? me.act.target : (me.act?.extra ?? null);
    send(killed ? { t: "act", mode: "kill", target: killed, extra: aimed ?? "" } : { t: "act", mode: "ability", target: aimed });
  };

  // 좌석별 표시 정보. 마을(3D)과 목록(2D)이 같은 값을 그린다.
  const acted = night && !view.turn?.mine; // 오늘 밤 내 차례가 지나갔다
  const actKind =
    acted && me.alive && me.act
      ? me.act.mode === "ability"
        ? me.role
        : me.act.mode === "kill" || me.act.mode === "detonate" || me.act.mode === "armor"
          ? me.act.mode
          : null
      : null;
  const standKind =
    night && me.alive && me.act
      ? me.act.mode === "ability"
        ? me.role
        : me.act.mode === "kill" || me.act.mode === "detonate" || me.act.mode === "armor"
          ? me.act.mode
          : null
      : null;
  const seats = players.map((p) => {
    const isMe = p.id === me.id;
    const usable = night
      ? !!mode && (!isMe || (mode === "ability" && me.role === "doctor")) && !(mode === "kill" && p.ally) && !(mode === "ability" && me.blocked === p.id)
      : phase === "day";
    const killing = night && me.act?.mode === "kill" && me.act.target === p.id;
    const aiming = night && (me.act?.mode === "ability" ? me.act.target : me.act?.extra) === p.id;
    const voting = !night && me.pick === p.id;
    // 집 위 이름표 밑에 붙는 말. 고른 사람은 집 위 딱지(done)로만 알린다.
    const done = playing && p.alive && p.picked;
    const status = [
      !(isMe && playing && me.alive) && p.label,
      !p.connected && "끊김",
      p.doing,
      p.provoked && "+2표",
      night && me.blocked === p.id && (me.role === "doctor" ? "어제 치료" : "어제 막음"),
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      id: p.id,
      name: p.name,
      skin: p.skin,
      house: p.house,
      hat: p.hat,
      done,
      alive: p.alive,
      isMe,
      ally: p.ally,
      mayor: p.mayor,
      enabled: me.alive && p.alive && usable && !replay && !call && !exile, // 연출이 카메라를 쓰는 동안은 누르지 못한다
      mark: killing ? ("kill" as const) : aiming ? ("aim" as const) : voting ? ("vote" as const) : null,
      // 이 집에서 보여 줄 내 능력 연출
      // 내 차례가 끝난 뒤에 나온다 (고르는 동안은 표시만). 번개는 마법사의 차례가 끝나면 모두가 보고, 폭발은 아침에 본다.
      effect: view.bolts.includes(p.id) ? "sorcerer" : !acted ? null : killing ? "kill" : aiming && me.role !== "sorcerer" ? me.role : null,
      status,
      bombed: p.bombed,
      marked: p.marked,
      won: p.won,
    };
  });
  const pickSeat = (id: string) => (night ? visit(id) : send({ t: "pick", target: id }));
  const colorOf = Object.fromEntries(players.map((p, i) => [p.name, COLORS[i % COLORS.length]]));
  const canStart = players.length >= MIN_PLAYERS && (view.setup.auto || view.setup.slots.length === players.length);

  // 밤 행동 고르기. round면 그림 단추(마을 화면), 아니면 글 단추(목록 화면)
  const modes = (round: boolean) =>
    night &&
    me.alive && (
      <>
        {me.modes.map((m) => {
          const aimed = m === "kill" || m === "ability";
          const pressed = aimed ? !resting && m === mode : resting && me.act?.mode === m;
          const choose = () => {
            const back = aimed && resting && aim.current?.day === view.day && aim.current.act.mode === m ? aim.current.act : null;
            // 되돌릴 집이 없으면 집을 고를 때까지 서버에는 쉬기가 남으므로, 단추도 쉬기를 눌린 채로 둔다
            if (!aimed) setIdleDay(view.day);
            else if (back || !resting) setIdleDay(null);
            if (aimed) setWanted(m);
            if (back) send({ t: "act", ...back });
            else if (!aimed) send({ t: "act", mode: m });
          };
          return round ? (
            <button key={m} aria-pressed={pressed} onClick={choose} className="round out">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <span className="o">{MODE[m].img ? <img src={`/roles/${MODE[m].img}.png`} alt="" /> : <span className="moon" />}</span>
              {MODE[m].label}
            </button>
          ) : (
            <button key={m} aria-pressed={pressed} onClick={choose} className="btn">
              {MODE[m].label}
            </button>
          );
        })}
        {me.role === "sorcerer" && (
          <select aria-label="맞힐 역할" value={guess} onChange={(e) => setGuess(e.target.value as Role)} className="field">
            {(Object.keys(ROLES) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLES[r].name}
              </option>
            ))}
          </select>
        )}
      </>
    );
  const abstain = phase === "day" && me.alive && (
    <button className="btn" aria-pressed={me.pick === SKIP} onClick={() => send({ t: "pick", target: SKIP })}>
      기권
    </button>
  );
  const lobbyBtns = phase === "lobby" && (
    <>
      <button className="btn" onClick={() => setOpen("custom")}>
        꾸미기
      </button>
      <button className="btn" onClick={() => setOpen("setup")}>
        판 짜기
      </button>
      <button
        className="btn"
        onClick={() => {
          void navigator.clipboard?.writeText(`${location.origin}/?room=${view.code}`);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "복사했어요" : "초대 링크"}
      </button>
      {isHost && (
        <button className="btn go big" disabled={!canStart} onClick={() => send({ t: "start" })}>
          시작
        </button>
      )}
    </>
  );

  const modal = open && (
    <Modal
      key={open}
      label={{ info: "마을 사람과 기록", menu: "설정", custom: "꾸미기", setup: "판 짜기", history: "기록" }[open]}
      width={{ info: 860, menu: 400, custom: 1000, setup: 760, history: 640 }[open]}
      onClose={() => setOpen(null)}
    >
      {open === "info" && (
        <Info
          view={view}
          colors={colorOf}
          onReplay={
            flash && phase === "day" && !asList
              ? () => {
                  setOpen(null);
                  setReplay(flash);
                }
              : undefined
          }
        />
      )}
      {open === "custom" && (
        <Custom
          skin={players.find((p) => p.id === me.id)!.skin}
          house={players.find((p) => p.id === me.id)!.house}
          hat={players.find((p) => p.id === me.id)!.hat}
          color={COLORS[players.findIndex((p) => p.id === me.id) % COLORS.length]}
          onSkin={(skin) => send({ t: "skin", skin })}
          onHouse={(house) => send({ t: "house", house })}
          onHat={(hat) => send({ t: "hat", hat })}
        />
      )}
      {open === "setup" && <SetupBoard view={view} isHost={isHost} send={send} />}
      {open === "history" && <History view={view} colors={colorOf} />}
      {open === "menu" && (
        <div className="flex flex-col gap-1">
          <Volume />
          <Fx />
          <div className="row">
            <span className="gl w-12">{ICON.list}</span>
            <b className="d flex-1 text-lg font-normal">목록으로 보기</b>
            <button role="switch" aria-checked={asList} aria-label="목록으로 보기" className="sw" onClick={() => setAsList(!asList)} />
          </div>
          <div className="hr" />
          <ul className="keys" aria-label="조작법">
            <li>
              <kbd>W</kbd>
              <kbd>A</kbd>
              <kbd>S</kbd>
              <kbd>D</kbd>
              <em>걷기</em>
            </li>
            <li>
              <i className="mouse l" />
              <em>고르기</em>
            </li>
            <li>
              <i className="mouse r" />
              <em>시점</em>
            </li>
            <li>
              <kbd>Tab</kbd>
              <em>사람들</em>
            </li>
            <li>
              <kbd>Enter</kbd>
              <em>말하기</em>
            </li>
          </ul>
          <div className="hr" />
          <div className="flex gap-3">
            {isHost && playing && (
              <button
                className="btn flex-1"
                onClick={() => {
                  send({ t: "next" });
                  setOpen(null);
                }}
              >
                <span className="gl">{ICON.skip}</span>
                넘기기
              </button>
            )}
            <button className="btn flex-1" onClick={leave}>
              <span className="gl">{ICON.out}</span>
              나가기
            </button>
          </div>
        </div>
      )}
    </Modal>
  );

  if (asList)
    return (
      <div className="paper mx-auto my-4 flex w-full max-w-3xl flex-col gap-4 p-4">
        <header className="flex items-center justify-between gap-2">
          <h1 className="d text-3xl">
            {title} {playing && due !== null && <Countdown due={due} />}
          </h1>
          <div className="flex gap-2">
            <button className="ib" aria-label="마을 사람과 기록" onClick={() => setOpen("info")}>
              {ICON.list}
            </button>
            <button className="ib" aria-label="설정" onClick={() => setOpen("menu")}>
              {ICON.gear}
            </button>
          </div>
        </header>
        {phase !== "lobby" && view.news.length > 0 && (
          <section aria-live="polite" className="d text-lg">
            {view.news.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </section>
        )}
        {hint && <p className="d">{hint}</p>}
        <div className="flex flex-wrap items-center gap-2">{modes(false)}</div>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {seats.map((s) => (
            <li key={s.id}>
              <button
                disabled={!s.enabled}
                aria-pressed={!!s.mark}
                onClick={() => pickSeat(s.id)}
                className={`btn w-full flex-col !items-start !gap-0 text-left ${s.alive ? "" : "line-through"}`}
              >
                <span>
                  {s.mayor && "시장 "}
                  {s.name}
                  {s.isMe && " (나)"}
                </span>
                <span className="text-xs">{[s.status, s.done && "✓"].filter(Boolean).join(" · ") || " "}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          {abstain}
          {lobbyBtns}
          {isHost && phase === "ended" && (
            <button className="btn go" onClick={() => send({ t: "lobby" })}>
              대기실로
            </button>
          )}
          {phase === "ended" && (
            <button className="btn" onClick={() => setOpen("history")}>
              기록 보기
            </button>
          )}
        </div>
        <Chat view={view} send={send} colors={colorOf} />
        {modal}
      </div>
    );

  // 소식은 결과만 띄운다. 누가 누구를 찍었는지 같은 긴 줄은 Tab 창의 지난 일에 있다.
  const brief = view.news.filter((line) => !line.includes("→") && !line.startsWith("역할이 정해졌"));
  // 마을이 화면 전체를 채우고, HUD는 가장자리에 꼭 필요한 것만 얹는다. 나머지는 Tab 창에 있다.
  const wash = { innocent: "79 165 74", imposter: "217 68 58", neutral: "61 143 214", solo: "61 143 214", draw: "140 140 140" };
  return (
    <div className="fixed inset-0 z-10">
      <Village
        seats={seats}
        scene={phase}
        going={night ? (me.act?.target ?? me.act?.extra ?? null) : null}
        iconRole={acted && me.alive && me.role !== "sorcerer" && (me.act?.mode === "ability" || me.act?.extra) ? me.role : null}
        shield={acted && me.act?.mode === "armor"}
        actKind={actKind}
        standKind={standKind}
        positions={positions}
        replay={replay}
        onReplayEnd={() => setReplay(null)}
        exile={exile}
        onExileEnd={() => {
          setExile(null);
          setUnseen([]);
          setTold(phaseKey);
        }}
        call={call}
        onCallEnd={() => {
          setCall(null);
          setUnseen([]);
          setTold(phaseKey);
        }}
        burnt={phase === "day" ? view.dawn.flatMap((e) => (e.kind === "death" && (e.blast || e.bolt) ? [e.who] : [])) : []}
        unseen={unseen}
        onSeen={(id) => setUnseen((ids) => ids.filter((x) => x !== id))}
        onPick={pickSeat}
        onMove={(x, z) => send({ t: "move", x, z })}
      />
      {/* 회상이 도는 동안은 시계와 대화만 남긴다 */}
      <div className={`pointer-events-none absolute inset-0 *:pointer-events-auto ${replay || call || exile ? "replaying" : ""}`}>
        <div className="keep !pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center gap-2">
          {phase !== "ended" && (
            <div className="clock paper">
              {playing && <div className={night ? "moon" : "sun"} aria-hidden />}
              <div>
                <small>{phase === "lobby" ? `방 · ${players.length}/${MAX_PLAYERS}` : title}</small>
                <div className="t">{phase === "lobby" ? view.code : due !== null && <Countdown due={due} />}</div>
                {/* 밤은 역할마다 차례대로 고른다 */}
                {view.turn && <small style={{ marginTop: 5, opacity: view.turn.mine ? 1 : undefined }}>{view.turn.mine ? "내 차례" : `${view.turn.names.join("·")} 차례`}</small>}
              </div>
            </div>
          )}
          {playing && !replay && !call && !exile && told !== phaseKey && brief.length > 0 && (
            <section key={phaseKey} aria-live="polite" className="toast paper max-w-[min(36rem,90vw)]">
              {brief.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </section>
          )}
        </div>

        {playing && !replay && !call && !exile && view.roster.length > 0 && (
          <ul className="roster" aria-label="이번 판 역할">
            {/* 정신병자가 섞여 있을 수 있어, 누가 죽어도 패를 끄지 않는다 */}
            {view.roster.map((r, i) => (
              <li key={i}>
                <RoleTile role={r} />
              </li>
            ))}
          </ul>
        )}

        <div className="absolute right-4 top-3.5 flex gap-2.5">
          {/* 음성 대화. 마이크를 켠 사람끼리 이어지고, 들리는 범위는 채팅과 같다 (밤에는 임포스터끼리, 죽으면 죽은 사람끼리) */}
          {voice.able() && (
            <button className="ib" aria-label="마이크" aria-pressed={talking} onClick={() => (talking ? voice.stop() : void voice.start().catch(() => {}))}>
              {ICON.mic}
            </button>
          )}
          <button className="ib" aria-label="마을 사람과 기록 (Tab)" onClick={() => setOpen("info")}>
            {ICON.list}
          </button>
          <button className="ib" aria-label="설정" onClick={() => setOpen("menu")}>
            {ICON.gear}
          </button>
        </div>

        <div className="keep absolute bottom-4 left-4 w-[360px] max-w-[45vw]">
          <Chat view={view} send={send} colors={colorOf} hud />
        </div>

        <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 flex-col items-center gap-3">
          {hint && <p className="chip">{hint}</p>}
          <div className="flex items-end gap-4">
            {modes(true)}
            {abstain}
            {lobbyBtns}
            {phase === "ended" && (
              <button className="btn go" onClick={() => setShut("")}>
                결과
              </button>
            )}
          </div>
        </div>

        {role && me.role && (
          <button
            className="absolute bottom-4 right-4 flex flex-col items-center gap-1.5"
            aria-label={`내 역할 ${role.name}, 자세히 보기`}
            onClick={() => setOpen("info")}
          >
            <RoleTile role={me.role} size="lg" />
            <span className="out text-xl">{role.name}</span>
          </button>
        )}

        {reveal && role && me.role && (
          <div className="reveal absolute inset-0 z-20 flex flex-col items-center justify-center gap-10 p-6">
            <div className="wash" style={{ "--w1": `rgb(${wash[me.team]} / .55)`, "--w2": "rgb(255 201 60 / .32)" } as React.CSSProperties} />
            <div className="paper relative flex w-[360px] max-w-full -rotate-1 flex-col items-center gap-3.5 !border-[5px] px-6 py-7 text-center !shadow-[0_12px_0_var(--ink),0_30px_60px_rgb(0_0_0/.45)]">
              <RoleTile role={me.role} size="xl" />
              <h1 className="d text-7xl leading-none">{role.name}</h1>
              <span className={`tag ${me.team} !px-5 !text-xl`}>{TEAM_NAME[me.team]}</span>
              <p className="leading-relaxed">{role.desc}</p>
            </div>
            <button autoFocus className="btn go big relative" onClick={() => setReveal(false)}>
              확인
            </button>
          </div>
        )}

        {phase === "ended" && !exile && shut !== phaseKey && (
          <div className="absolute inset-0 z-20 flex flex-col items-center gap-7 overflow-y-auto px-6 py-[8vh]">
            <div
              className="wash !fixed"
              style={{ "--w1": `rgb(${wash[view.winner ?? "draw"]} / .5)`, "--w2": "rgb(255 201 60 / .45)" } as React.CSSProperties}
            />
            {Array.from({ length: 24 }, (_, i) => (
              <span
                key={i}
                aria-hidden
                className="bit"
                style={{
                  left: `${(i * 37 + 5) % 96}%`,
                  top: `${(i * 53) % 36}%`,
                  rotate: `${((i * 47) % 120) - 60}deg`,
                  background: ["#ffc93c", "#4fa54a", "#f6ecd0", "#3d8fd6", "#d9443a"][i % 5],
                }}
              />
            ))}
            <h1 className="title relative">{view.result}</h1>
            {view.why && <p className="out relative text-xl">{view.why}</p>}
            <div data-lineup className="relative">
            <ul className="flex flex-wrap justify-center gap-3.5">
              {players.map((p, i) => {
                const r = roleOf(p.label);
                return (
                  <li key={p.id} className={`pc paper ${p.won ? "" : "lose"}`}>
                    <div data-pic className="pic" style={{ "--c": COLORS[i % COLORS.length] } as React.CSSProperties} />
                    <b>{p.name}</b>
                    {r && <RoleTile role={r} />}
                    <span className="d">{p.label?.split("(")[0]}</span>
                  </li>
                );
              })}
            </ul>
              {/* 카드의 빈 자리에 그 사람의 캐릭터가 선다: 이기면 환호, 지면 풀이 죽는다 */}
              <Lineup people={players.map((p, i) => ({ skin: p.skin, hat: p.hat, color: COLORS[i % COLORS.length], won: p.won }))} />
            </div>
            <div className="relative flex flex-wrap items-center justify-center gap-4">
              <button className="btn" onClick={() => setOpen("history")}>
                기록 보기
              </button>
              {isHost && (
                <button className="btn go big" onClick={() => send({ t: "lobby" })}>
                  대기실로
                </button>
              )}
              <button className="btn" onClick={() => setShut(phaseKey)}>
                마을 보기
              </button>
            </div>
          </div>
        )}
      </div>
      {modal}
    </div>
  );
}

// 소리 크기. 0이면 끔.
// 설정의 화면 효과 스위치. 끄면 색 보정·번짐·테두리 그늘 없이 그린다.
function Fx() {
  const on = useFx();
  return (
    <div className="row">
      <span className="gl w-12">{ICON.fx}</span>
      <b className="d flex-1 text-lg font-normal">화면 효과</b>
      <button role="switch" aria-checked={on} aria-label="화면 효과" className="sw" onClick={() => setFx(!on)} />
    </div>
  );
}

function Volume() {
  const [v, setV] = useState(volume);
  const set = (next: number) => {
    setVolume(next);
    setV(next);
  };
  return (
    <div className="row">
      <button className="ib" aria-label={v ? "소리 끄기" : "소리 켜기"} onClick={() => set(v ? 0 : 0.6)}>
        {speaker(v)}
      </button>
      <input
        type="range"
        aria-label="소리 크기"
        min={0}
        max={1}
        step={0.05}
        value={v}
        onChange={(e) => set(Number(e.target.value))}
        onPointerUp={() => play("confirm")}
        className="vol"
        style={{ "--v": `${v * 100}%` } as React.CSSProperties}
      />
    </div>
  );
}

// 가운데 뜨는 창. dialog라서 Esc로 닫히고 포커스가 안에 갇힌다.
function Modal({ label, width, onClose, children }: { label: string; width: number; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
    ref.current?.querySelector("input")?.focus(); // 입력칸이 있는 창은 닫기 단추 말고 거기서 시작한다
    play("open");
    return () => play("close");
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      className="sheet paper"
      style={{ width }}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <button className="ib x" aria-label="닫기" onClick={onClose}>
        {ICON.close}
      </button>
      <div className="body">{children}</div>
    </dialog>
  );
}

// 역할 패. public/roles/<역할 id>.png 그림이 없으면 한 글자를 보여 준다.
function RoleTile({ role, size = "", off = false }: { role: Slot["role"]; size?: "" | "sm" | "lg" | "xl"; off?: boolean }) {
  const [missing, setMissing] = useState(false);
  const info = role === "insane" ? INSANE : ROLES[role];
  return (
    <span className={`tile ${size} ${off ? "off" : ""}`} title={`${info.name}: ${info.desc}`}>
      {missing ? (
        ROLE_MARK[role]
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/roles/${role}.png`} alt={info.name} onError={() => setMissing(true)} />
      )}
    </span>
  );
}

type Colors = Record<string, string>;

// 색 머리와 이름. bare면 머리만.
function Face({ name, colors, bare = false }: { name: string; colors: Colors; bare?: boolean }) {
  return (
    <span className="face" title={name}>
      <i style={{ background: colors[name] ?? "#8b8d98" }} />
      {bare ? <span className="sr-only">{name}</span> : name}
    </span>
  );
}

// 죽거나 쫓겨나며 드러난 정체: 역할 패와 편
function Reveal({ label }: { label?: string }) {
  if (!label) return null;
  const role = roleOf(label);
  return (
    <>
      {role && <RoleTile role={role} size="sm" />}
      <span className="text-xs opacity-75">{role ? (label.match(/\((.+)\)/)?.[1] ?? "") : label}</span>
    </>
  );
}

function StepRow({ step, colors }: { step: Step; colors: Colors }) {
  if (step.kind === "text") return <li className="opacity-75">{step.text}</li>;
  if (step.kind === "point")
    return (
      <li>
        <Face name={step.by} colors={colors} />
        <span className="gl" title="지목">
          {ICON.to}
        </span>
        <Face name={step.who} colors={colors} />
      </li>
    );
  if (step.kind !== "votes" && step.kind !== "go" && step.kind !== "hit")
    return (
      <li>
        <Face name={step.who} colors={colors} />
        <span className="gl" title={{ dead: "사망", out: "추방", mayor: "시장" }[step.kind]}>
          {{ dead: ICON.grave, out: ICON.out, mayor: ICON.crown }[step.kind]}
        </span>
        <Reveal label={step.reveal} />
      </li>
    );
  if (step.kind === "go")
    return (
      <li className={step.off ? "off" : undefined} title={step.title}>
        <Face name={step.by} colors={colors} />
        {step.role ? <RoleTile role={step.role as Slot["role"]} size="sm" /> : <span className="gl">{ICON.knife}</span>}
        {step.fake && <span className="text-xs opacity-75">가짜</span>}
        {step.to && (
          <>
            <span className="gl">{ICON.to}</span>
            <Face name={step.to} colors={colors} />
          </>
        )}
        {step.off && <span className="text-xs">막힘</span>}
      </li>
    );
  if (step.kind === "hit")
    return (
      <li title={step.title}>
        <Face name={step.to} colors={colors} />
        <span className="gl" title={step.died ? "사망" : "살았다"}>
          {step.died ? ICON.grave : ICON.shield}
        </span>
      </li>
    );
  // 표: 받은 사람별로 모아, 던진 사람들의 머리 → 받은 사람 + 표 수
  const to = [...new Set([...step.ballots.map((b) => b.to), ...Object.keys(step.tally)])].sort((a, b) => (step.tally[b ?? ""] ?? -1) - (step.tally[a ?? ""] ?? -1));
  return (
    <>
      {to.map((t) => (
        <li key={t ?? ""} className={t ? undefined : "opacity-60"}>
          <span className="heads">
            {step.ballots
              .filter((b) => b.to === t)
              .map((b) => (
                <Face key={b.by} name={b.by} colors={colors} bare />
              ))}
          </span>
          <span className="gl">{ICON.to}</span>
          {t ? <Face name={t} colors={colors} /> : "기권"}
          {t && step.tally[t] !== undefined && <b className="cnt">{step.tally[t]}</b>}
        </li>
      ))}
    </>
  );
}

// 지난 일: 밤과 낮이 번갈아 놓이는 칸
function Timeline({ periods, colors }: { periods: Period[]; colors: Colors }) {
  if (!periods.length) return <p className="text-[15px] opacity-60">아직 없다</p>;
  return (
    <ol className="flex flex-col gap-2">
      {periods.map((p, i) => (
        <li key={i} className={`per ${p.night ? "night" : ""}`}>
          <div className="when">
            <i className={p.night ? "moon" : "sun"} />
            {p.label}
          </div>
          <ol>
            {p.steps.map((s, j) => (
              <StepRow key={j} step={s} colors={colors} />
            ))}
          </ol>
        </li>
      ))}
    </ol>
  );
}

// Tab 창: 늘 띄워 두지 않는 정보를 한곳에 모은다
function Info({ view, colors, onReplay }: { view: View; colors: Colors; onReplay?: () => void }) {
  const { me, phase } = view;
  const playing = phase === "night" || phase === "day";
  const role = me.role ? ROLES[me.role] : null;
  const periods = periodsOf(view.chat.filter((c) => c.name === "").map((c) => c.text));
  return (
    <div className="grid gap-8 sm:grid-cols-[260px_1fr]">
      <div>
        <h3>
          마을 사람{playing && view.pending > 0 && ` · ${view.pending}명 남음`}
        </h3>
        {view.players.map((p) => (
          <div key={p.id} className={`pl ${phase !== "lobby" && !p.alive ? "dead" : ""}`}>
            <i className="h-6 w-6 flex-none rounded-full border-[2.5px] border-[var(--ink)]" style={{ background: colors[p.name] }} />
            <b className="min-w-0 flex-1 truncate">
              {p.name}
              {p.id === me.id && " (나)"}
            </b>
            {p.mayor && (
              <span className="gl" title="시장">
                {ICON.crown}
              </span>
            )}
            <span className="text-xs opacity-70">{[p.id === view.hostId && "방장", !p.connected && "끊김"].filter(Boolean).join(" · ")}</span>
            <Reveal label={p.label ?? undefined} />
            {playing && p.alive && p.picked && (
              <b className="cnt" aria-label="골랐음">
                ✓
              </b>
            )}
          </div>
        ))}
        <p className="d mt-4 opacity-60">방 {view.code}</p>
      </div>
      <div>
        {role && me.role && (
          <div className="flex items-center gap-3.5">
            <RoleTile role={me.role} size="lg" />
            <div>
              <p className="d text-3xl">
                {role.name} <span className={`tag ${me.team} align-middle !text-xs`}>{TEAM_NAME[me.team]}</span>
              </p>
              <p className="mt-1.5 text-[15px] leading-relaxed">
                {role.desc}
                {me.uses !== null && ` (${me.uses}회 남음)`}
              </p>
            </div>
          </div>
        )}
        {view.roster.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="이번 판 역할">
            {view.roster.map((r, i) => (
              <li key={i}>
                <RoleTile role={r} size="sm" />
              </li>
            ))}
          </ul>
        )}
        {(role || view.roster.length > 0) && <div className="hr" />}
        {me.notes.length > 0 && (
          <>
            <h3>나만 아는 것</h3>
            <ol className="memo">
              {me.notes.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ol>
            {onReplay && (
              <button className="btn mt-2" onClick={onReplay}>
                어젯밤 다시 보기
              </button>
            )}
            <div className="hr" />
          </>
        )}
        <h3>지난 일</h3>
        <Timeline periods={periods} colors={colors} />
      </div>
    </div>
  );
}

// 꾸미기 창: 내 캐릭터와 집. 방 밖(메뉴)에서도 열 수 있게 값과 콜백만 받는다.
type CustomProps = {
  skin: Skin;
  house: House;
  hat: Hat;
  color: string; // 기본 캐릭터 몸에 칠할 내 색
  onSkin: (skin: Skin) => void;
  onHouse: (house: House) => void;
  onHat: (hat: Hat) => void;
};
function Custom({ skin, house, hat, color, onSkin, onHouse, onHat }: CustomProps) {
  const [tab, setTab] = useState<"skin" | "house" | "hat">("skin");
  const mine = { skin, house, hat };
  const thumb = (h: House) => (h === "house" ? null : `/models/thumbs/${h}.png`);
  return (
    <>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "skin"} onClick={() => setTab("skin")}>
          캐릭터
        </button>
        <button role="tab" aria-selected={tab === "house"} onClick={() => setTab("house")}>
          집
        </button>
        <button role="tab" aria-selected={tab === "hat"} onClick={() => setTab("hat")}>
          모자
        </button>
      </div>
      <div className="grid gap-7 md:grid-cols-[1fr_290px]">
        <div className="flex min-h-[446px] flex-wrap content-start gap-4">
          {tab === "skin"
            ? SKINS.map((skin) => (
                <button key={skin} className="opt" aria-label={SKIN_NAME[skin]} aria-pressed={mine.skin === skin} onClick={() => onSkin(skin)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/models/thumbs/skin-${skin}.png`} alt="" />
                </button>
              ))
            : tab === "hat"
              ? HATS.map((h) => (
                  <button key={h} className="opt" aria-label={HAT_NAME[h]} aria-pressed={mine.hat === h} onClick={() => onHat(h)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {h === "none" ? HAT_NAME[h] : <img src={`/models/thumbs/hat-${h}.png`} alt="" />}
                  </button>
                ))
              : HOUSES.map((h) => (
                <button key={h} className="opt" aria-label={HOUSE_NAME[h]} aria-pressed={mine.house === h} onClick={() => onHouse(h)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {thumb(h) ? <img src={thumb(h)!} alt="" /> : HOUSE_NAME[h]}
                </button>
              ))}
        </div>
        <div className="flex flex-col items-center gap-4">
          {/* 어느 탭에서든 내 캐릭터가 보이고, 고른 집은 그 밑에 작게 */}
          <div className="opt !h-60 !w-full">
            <Preview skin={mine.skin} hat={mine.hat} color={color} />
          </div>
          <div className="h-20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {thumb(mine.house) && <img src={thumb(mine.house)!} alt={HOUSE_NAME[mine.house]} className="h-20 w-20" />}
          </div>
        </div>
      </div>
    </>
  );
}

// 판 짜기 창. 방장은 이번 판에 넣을 역할과 시간을 고르고, 나머지는 지켜본다.
// ponytail: 역할마다 켜고 끄기만 한다(같은 역할 두 장 불가). 필요해지면 패마다 개수 조절을.
function SetupBoard({ view, isHost, send }: { view: View; isHost: boolean; send: (m: object) => void }) {
  const { setup } = view;
  const [tab, setTab] = useState<"roles" | "time">("roles");
  const change = (next: Partial<View["setup"]>) => send({ t: "setup", ...setup, ...next });
  const count = (team: Team) => setup.slots.filter((s) => s.team === team).length;
  // 같은 역할이 시민 편에도 임포스터 편에도 있으므로 편까지 맞춰 본다
  const has = (role: Slot["role"], team: Team) => setup.slots.some((s) => s.role === role && s.team === team);
  const toggle = (role: Slot["role"], team: Team) =>
    change({
      auto: false,
      slots: has(role, team) ? setup.slots.filter((s) => !(s.role === role && s.team === team)) : [...setup.slots, { role, team }],
    });

  return (
    <>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "roles"} onClick={() => setTab("roles")}>
          역할
        </button>
        <button role="tab" aria-selected={tab === "time"} onClick={() => setTab("time")}>
          시간
        </button>
      </div>
      {tab === "roles" ? (
        <>
          <div className={`flex flex-col gap-5 ${setup.auto ? "opacity-50" : ""}`}>
            {(Object.keys(POOL) as Team[]).map((team) => (
              <div key={team} className="flex flex-wrap items-center gap-3" role="group" aria-label={TEAM_NAME[team]}>
                <span className={`tag ${team} w-20 text-center`}>{TEAM_NAME[team]}</span>
                {POOL[team].map((role) => (
                  <button
                    key={role}
                    disabled={!isHost || (!has(role, team) && setup.slots.length >= MAX_PLAYERS)}
                    aria-pressed={!setup.auto && has(role, team)}
                    aria-label={`${TEAM_NAME[team]} ${role === "insane" ? INSANE.name : ROLES[role].name}`}
                    onClick={() => toggle(role, team)}
                  >
                    <RoleTile role={role} off={setup.auto || !has(role, team)} />
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="hr" />
          <div className="flex flex-wrap items-center gap-2.5">
            {!setup.auto && (
              <>
                {(Object.keys(POOL) as Team[]).map((team) => (
                  <span key={team} className={`tag ${team}`} aria-label={`${TEAM_NAME[team]} ${count(team)}`}>
                    {count(team)}
                  </span>
                ))}
                <span className="d ml-1" style={{ color: setup.slots.length === view.players.length ? undefined : "var(--blood)" }}>
                  {setup.slots.length} / {view.players.length}명
                </span>
              </>
            )}
            <span className="flex-1" />
            <button className="btn" disabled={!isHost} aria-pressed={setup.auto} onClick={() => change({ auto: !setup.auto })}>
              알아서 섞기
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-5">
          {/* 밤은 역할마다 15초씩 차례로 돌아서 길이를 고르지 않는다 */}
          <div className="flex flex-wrap items-center gap-3" role="group" aria-label="낮 시간">
            <span className="sun" aria-hidden />
            {DAY_CHOICES.map((sec) => (
              <button key={sec} className="btn" disabled={!isHost} aria-pressed={setup.day === sec} onClick={() => change({ day: sec })}>
                {sec}초
              </button>
            ))}
          </div>
          <button className="btn self-start" disabled={!isHost} aria-pressed={setup.calm} onClick={() => change({ calm: !setup.calm })}>
            첫 밤은 아무도 안 죽기
          </button>
        </div>
      )}
    </>
  );
}

const HIT: Record<string, string> = { curse: "저주", sk: "살해", bomb: "폭발", kill: "살해", thief: "도둑질", haunt: "양초" };

// 끝난 판의 기록. 밤마다 누가 누구 집에 갔고 낮마다 표가 어디로 갔는지.
function History({ view, colors }: { view: View; colors: Colors }) {
  const who = (id: string | null) => view.players.find((p) => p.id === id);
  const name = (id: string | null) => who(id)?.name ?? "?";
  const periods: Period[] = (view.history ?? []).map((h) => {
    if (h.kind === "day") {
      const chosen = who(h.chosen);
      return {
        night: false,
        label: h.day === 0 ? "시장 선거" : `${h.day}일차 낮`,
        steps: [
          {
            kind: "votes",
            ballots: h.ballots.map((b) => ({ by: name(b.by), to: who(b.to)?.name ?? null })),
            tally: Object.fromEntries(h.tally.map((t) => [name(t.id), t.votes])),
          },
          chosen
            ? { kind: h.day === 0 ? "mayor" : "out", who: chosen.name, reveal: h.day === 0 ? undefined : (chosen.label ?? undefined) }
            : { kind: "text", text: h.day === 0 ? "시장 없음" : "추방 없음" },
        ],
      };
    }
    const steps: Step[] = h.acts
      .filter((a) => a.mode !== "rest")
      .flatMap((a) => {
        const doing = a.mode === "kill" ? "살해" : a.mode === "ability" ? ROLES[a.role].action : a.mode === "armor" ? "갑옷" : "폭파";
        const go = (role: string | null, to: string | null, title: string): Step => ({
          kind: "go",
          by: name(a.by),
          role,
          to: to && name(to),
          off: a.stopped !== null,
          fake: a.fake,
          title,
        });
        const role = a.mode === "kill" ? null : a.mode === "armor" ? "survivor" : a.mode === "detonate" ? "bomber" : a.role;
        // 혼자 남은 임포스터는 살해와 능력을 함께 쓴다
        return [go(role, a.target, doing), ...(a.mode === "kill" && a.extra ? [go(a.role, a.extra, ROLES[a.role].action)] : [])];
      });
    for (const x of h.hits) steps.push({ kind: "hit", by: name(x.by), to: name(x.victim), died: x.died, title: `${name(x.by)}의 ${HIT[x.kind]}` });
    return { night: true, label: `${h.day}일차 밤`, steps: steps.length ? steps : [{ kind: "text", text: "조용했다" }] };
  });
  return <Timeline periods={periods} colors={colors} />;
}

function Countdown({ due }: { due: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.ceil((due - now) / 1000));
  return (
    <span className="tabular-nums" style={{ color: left <= 10 ? "var(--blood)" : undefined }}>
      {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
    </span>
  );
}

type ChatProps = { view: View; send: (m: object) => void; colors: Record<string, string>; hud?: boolean };

// hud: 마을 위에 얹는 모양. 사람이 한 말만 풀밭 위에 쌓이고, 알림 줄은 Tab 창에 있다.
function Chat({ view, send, colors, hud = false }: ChatProps) {
  const list = useRef<HTMLOListElement>(null);
  const [wide, setWide] = useState(false); // 입력칸에 들어가 있는 동안 지난 대화를 펼친다
  const told = useRef(0); // 입력 중이라고 마지막으로 알린 때 (0이면 알리지 않은 상태)
  // 글자가 있는 동안 3초마다 입력 중임을 알리고, 비우거나 보내거나 나가면 끈다. 내 머리 위 점은 바로 띄운다.
  const tell = (on: boolean) => {
    if (on ? Date.now() - told.current < 3000 : !told.current) return;
    told.current = on ? Date.now() : 0;
    typing(view.me.id, on);
    send({ t: "typing", on });
  };
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [view.chat.length, wide]);

  const { me, phase } = view;
  const playing = phase === "night" || phase === "day";
  const dead = playing && !me.alive;
  const blocked = phase === "night" && me.alive && me.team !== "imposter";
  const willing = dead && me.will && phase === "day";
  const hint = blocked
    ? "밤에는 말 못 한다"
    : willing
      ? "유언 한마디 (한 번뿐)"
      : dead
        ? "죽은 사람끼리"
        : phase === "night"
          ? me.both
            ? "죽은 동료만 본다"
            : "임포스터끼리"
          : "Enter로 말하기";
  const brief = hud && !wide;

  return (
    <section className={hud && wide ? "chat-wide" : undefined}>
      <ol
        key={brief ? view.chat.length : "all"}
        ref={list}
        aria-live="polite"
        onMouseDown={(e) => hud && e.preventDefault() /* 눌러도 입력칸에서 안 나가게 */}
        className={`flex flex-col items-start gap-1.5 ${brief ? "chat-brief" : hud ? "max-h-[50vh] overflow-y-auto" : "max-h-64 overflow-y-auto"}`}
      >
        {view.chat
          .filter((c) => !brief || c.name !== "")
          .slice(brief ? -1 : 0) // 접혀 있을 때는 방금 온 한 줄만
          .map((c, i) =>
            c.name === "" ? (
              <li key={i} className="text-sm opacity-70">
                {c.text}
              </li>
            ) : (
              <li key={i} className={hud ? "say quiet" : "say"} style={hud ? undefined : { background: `color-mix(in srgb, ${colors[c.name] ?? "#8b8d98"} 38%, #fff7e6)` }}>
                <i aria-hidden style={{ background: colors[c.name] ?? "#8b8d98" }} />
                <span>
                  <b className="d mr-1.5 font-normal" style={hud ? { color: `color-mix(in srgb, ${colors[c.name] ?? "#8b8d98"} 55%, #fff)` } : undefined}>{c.name} </b>
                  {c.to !== "all" && <span className="mr-1.5 text-xs opacity-70">{c.to === "dead" ? "저승" : "임포스터"}</span>}
                  {c.text}
                </span>
              </li>
            ),
          )}
      </ol>
      <form
        className="mt-2"
        onSubmit={(e) => {
          e.preventDefault();
          const input = e.currentTarget.elements.namedItem("text") as HTMLInputElement;
          if (!input.value.trim()) input.blur(); // 빈 채로 Enter면 접는다
          else if (!blocked) send({ t: "chat", text: input.value });
          tell(false);
          input.value = "";
          if (hud) input.blur(); // 보내면 접는다
        }}
      >
        <input
          id={hud ? "chat-in" : undefined}
          name="text"
          aria-label="메시지"
          maxLength={200}
          readOnly={blocked}
          onFocus={() => setWide(true)}
          onBlur={() => {
            setWide(false);
            tell(false);
          }}
          onInput={(e) => !blocked && tell(e.currentTarget.value.trim() !== "")}
          placeholder={hint}
          autoComplete="off"
          className={hud ? "chat-in" : "field w-full"}
        />
      </form>
    </section>
  );
}
