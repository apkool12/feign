"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { COLORS } from "./colors";
import type { Positions } from "./Village";
import { DAY_CHOICES, INSANE, MAX_PLAYERS, MIN_PLAYERS, NIGHT_CHOICES, POOL, ROLES, SKIP, TEAM_NAME } from "../game";
import type { Mode, Role, Slot, Team, View } from "../game";

// WebGL은 브라우저에서만 돌므로 서버 렌더링에서 뺀다
const Village = dynamic(() => import("./Village"), {
  ssr: false,
  loading: () => <p className="p-4 text-sm opacity-80">마을을 불러오는 중…</p>,
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

// 페이즈가 바뀔 때 알림음. 브라우저가 소리를 막으면 조용히 넘어간다.
function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 660;
    gain.gain.value = 0.1;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
    osc.onended = () => ctx.close();
  } catch {}
}

const btn = "hud-btn hud-btn-go"; // 판을 진행시키는 버튼
const subBtn = "hud-btn";

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

export default function Page() {
  const [view, setView] = useState<View | null>(null);
  const [due, setDue] = useState<number | null>(null); // 페이즈가 끝나는 시각 (이 기기 시계 기준)
  const [error, setError] = useState("");
  const [online, setOnline] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  const saved = useRef<Saved>({ token: "" });
  const positions = useRef<Positions>(new Map()); // 다른 플레이어들의 위치. 매 프레임 읽으므로 state에 두지 않는다

  const send = (m: object) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(m));
  };

  useEffect(() => {
    saved.current = loadSaved();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const open = () => {
      const sock = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
      let joined = false;
      ws.current = sock;
      sock.onopen = () => {
        setOnline(true);
        if (saved.current.code) sock.send(JSON.stringify({ t: "join", ...saved.current }));
      };
      sock.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === "state") {
          const state: View = m.state;
          joined = true;
          saved.current.code = state.code;
          store(saved.current);
          setView(state);
          setDue(state.remaining === null ? null : Date.now() + state.remaining);
          setError("");
        } else if (m.t === "pos") {
          positions.current.set(m.id, { x: m.x, z: m.z });
        } else {
          setError(m.msg);
          if (!joined) {
            // 입장 실패: 저장된 방을 잊고 입장 화면으로
            delete saved.current.code;
            store(saved.current);
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
  }, []);

  const leave = () => {
    try {
      sessionStorage.removeItem(KEY);
    } catch {}
    location.reload();
  };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4">
      <div className="pointer-events-none fixed inset-x-0 top-3 z-30 flex flex-col items-center gap-2 px-3">
        {error && (
          <p role="alert" className="hud-chip border-2 border-[var(--blood)]">
            {error}
          </p>
        )}
        {!online && <p className="hud-chip text-sm">서버에 연결하는 중…</p>}
      </div>
      {view ? (
        <Game view={view} due={due} positions={positions} send={send} leave={leave} />
      ) : (
        <form
          className="m-auto flex w-full max-w-xs flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const name = String(fd.get("name")).trim();
            saved.current.name = name;
            send({ t: "join", token: saved.current.token, name, code: String(fd.get("code")) });
          }}
        >
          <h1 className="hud-display text-6xl">Feign</h1>
          <label className="flex flex-col gap-1 text-sm">
            닉네임
            <input name="name" required maxLength={12} className="hud-field text-base" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            방 코드 (비우면 새 방을 만듭니다)
            <input
              name="code"
              maxLength={4}
              autoCapitalize="characters"
              autoComplete="off"
              className="hud-field text-base uppercase"
            />
          </label>
          <button className={btn} disabled={!online}>
            입장
          </button>
        </form>
      )}
    </main>
  );
}

type GameProps = {
  view: View;
  due: number | null;
  positions: React.RefObject<Positions>;
  send: (m: object) => void;
  leave: () => void;
};

// 화면은 view를 그리고 send로 행동을 보내기만 한다. 3D 마을로 바꿀 때 갈아 끼울 자리가 이 컴포넌트다.
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

  // 페이즈가 바뀌면 탭 제목과 소리로 알린다
  const phaseKey = `${phase}-${view.day}`;
  const lastPhase = useRef(phaseKey);
  useEffect(() => {
    document.title = `${title} · Feign`;
    if (lastPhase.current !== phaseKey) {
      lastPhase.current = phaseKey;
      beep();
    }
  }, [phaseKey, title]);

  // 밤에 집(카드)을 누르면 실행할 행동. 임포스터는 살해와 능력 중에서 고른다.
  const targeted: Mode[] = me.modes.filter((m) => m === "kill" || m === "ability");
  const [wanted, setWanted] = useState<Mode>("kill");
  const mode = targeted.includes(wanted) ? wanted : targeted[0];
  const [guess, setGuess] = useState<Role>("doctor");
  const role = me.role ? ROLES[me.role] : null;
  const usesLeft = me.uses === null ? "" : ` (${me.uses}회 남음)`;
  const modeLabel = (m: Mode) =>
    m === "kill"
      ? "살해"
      : m === "ability"
        ? `${role?.action}${usesLeft}`
        : m === "armor"
          ? `갑옷 입기${usesLeft}`
          : m === "detonate"
            ? "폭탄 전부 터뜨리기"
            : "아무것도 안 하기";

  const prompt = !playing
    ? ""
    : !me.alive
      ? me.will
        ? "사망했습니다. 오늘 낮에 모두에게 유언 한마디를 남길 수 있습니다. 남기거나 낮이 끝나면 모든 역할이 보입니다."
        : "사망했습니다. 이제 모든 역할이 보입니다."
      : election
        ? "시장으로 뽑을 사람에게 투표하세요. 시장은 이후 추방 투표에서 1.1표를 행사합니다. 역할은 선거가 끝나면 정해집니다."
        : !night
          ? "추방할 사람에게 투표하세요. 과반을 얻어야 추방됩니다."
          : !mode
            ? "오늘 밤 할 행동을 고르세요."
            : me.both
              ? `${modeLabel(mode)}: 찾아갈 집을 고르세요. 혼자 남았으니 살해와 능력을 둘 다 쓸 수 있습니다.`
              : `${modeLabel(mode)}: 찾아갈 집을 고르세요.`;

  // 능력을 쓸 수 없는 밤이면 이유를 알려 준다
  const idle =
    !night || !me.alive || me.role === "survivor" || me.modes.includes("ability")
      ? ""
      : me.uses === 0
        ? " 능력 횟수는 모두 썼습니다."
        : me.role === "blocker"
          ? " 어젯밤 능력을 써서 오늘은 쓸 수 없습니다."
          : "";

  // 밤에 집을 골랐을 때. 혼자 남은 임포스터는 살해 대상과 능력 대상을 따로 고른다.
  const visit = (id: string) => {
    if (!me.both) return send({ t: "act", mode, target: id, guess });
    const killed = mode === "kill" ? id : me.act?.mode === "kill" ? me.act.target : null;
    const aimed = mode === "ability" ? id : me.act?.mode === "ability" ? me.act.target : (me.act?.extra ?? null);
    send(killed ? { t: "act", mode: "kill", target: killed, extra: aimed ?? "" } : { t: "act", mode: "ability", target: aimed });
  };

  // 좌석별 표시 정보. 마을(3D)과 목록(2D)이 같은 값을 그린다.
  const [asList, setAsList] = useState(false);
  const seats = players.map((p) => {
    const isMe = p.id === me.id;
    const usable = night
      ? !!mode && !isMe && !(mode === "kill" && p.ally) && !(mode === "ability" && me.blocked === p.id)
      : phase === "day";
    const killing = night && me.act?.mode === "kill" && me.act.target === p.id;
    const aiming = night && (me.act?.mode === "ability" ? me.act.target : me.act?.extra) === p.id;
    const voting = !night && me.pick === p.id;
    const status = [
      // 살아 있는 내 역할은 상단에 있으니 뺀다
      !(isMe && playing && me.alive) && p.label,
      p.won && "승리",
      phase !== "lobby" && !p.alive && "사망",
      p.id === view.hostId && "방장",
      !p.connected && "연결 끊김",
      p.doing,
      killing && "살해 대상",
      aiming && `${role?.action} 대상`,
      p.provoked && "선동 +2표",
      p.bombed && "폭탄 설치됨",
      p.marked && "양초를 둠",
      night && me.blocked === p.id && "어젯밤 치료",
      playing && p.alive && (p.picked ? "선택 완료" : "고민 중"),
    ]
      .filter(Boolean)
      .join(", ");
    return {
      id: p.id,
      name: p.name,
      alive: p.alive,
      isMe,
      ally: p.ally,
      mayor: p.mayor,
      enabled: me.alive && p.alive && usable,
      mark: killing ? ("kill" as const) : aiming ? ("aim" as const) : voting ? ("vote" as const) : null,
      status,
      bombed: p.bombed,
      marked: p.marked,
      won: p.won,
    };
  });
  const pickSeat = (id: string) => (night ? visit(id) : send({ t: "pick", target: id }));

  const head = (
    <div>
      <h1 className="hud-display text-3xl">
        {title}
        {playing && due !== null && <Countdown due={due} />}
      </h1>
      <p className="text-sm opacity-80">
        방 코드 <span className="font-mono text-base ">{view.code}</span>
        {role && (
          <>
            {" · 내 역할 "}
            <b className="">
              {role.name} ({TEAM_NAME[me.team]})
            </b>
          </>
        )}
      </p>
      {role && <p className="text-sm opacity-80">{role.desc}</p>}
    </div>
  );
  const corner = (
    <div className="flex shrink-0 items-center gap-2">
      <button className="px-2 text-sm  underline hover:text-white" onClick={() => setAsList(!asList)}>
        {asList ? "마을로 보기" : "목록으로 보기"}
      </button>
      <button className={subBtn} onClick={leave}>
        나가기
      </button>
    </div>
  );
  const news = phase !== "lobby" && view.news.length > 0 && (
    <section aria-live="polite" className="hud-chip px-4 py-3">
      {view.news.map((line, i) => (
        <p key={i} className="hud-display text-lg">
          {line}
        </p>
      ))}
    </section>
  );
  const promptBox = prompt && (
    <p className="hud-glass px-3 py-2">
      {prompt}
      {idle}
    </p>
  );
  const nightModes = night && me.alive && (
    <div className="flex flex-wrap items-center gap-2">
      {me.modes.map((m) =>
        m === "kill" || m === "ability" ? (
          <button
            key={m}
            className={m === "kill" ? "hud-btn hud-btn-danger" : "hud-btn"}
            aria-pressed={m === mode}
            onClick={() => setWanted(m)}
          >
            {modeLabel(m)}
          </button>
        ) : (
          <button
            key={m}
            className="hud-btn"
            aria-pressed={me.act?.mode === m}
            onClick={() => send({ t: "act", mode: m })}
          >
            {modeLabel(m)}
          </button>
        ),
      )}
      {me.role === "sorcerer" && (
        <label className="flex items-center gap-2 text-sm opacity-80">
          맞힐 역할
          <select
            value={guess}
            onChange={(e) => setGuess(e.target.value as Role)}
            className="hud-field text-base"
          >
            {(Object.keys(ROLES) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLES[r].name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
  const controlsRow = (
    <div className="flex flex-wrap items-center gap-2">
      {phase === "day" && me.alive && (
        <button
          className="hud-btn"
          aria-pressed={me.pick === SKIP}
          onClick={() => send({ t: "pick", target: SKIP })}
        >
          기권
        </button>
      )}
      {playing && <span className="text-sm opacity-80">{view.pending}명의 선택을 기다리는 중</span>}
      {phase === "lobby" && (
        <span className="text-sm opacity-80">
          {players.length}/{MAX_PLAYERS}명 · 최소 {MIN_PLAYERS}명
          {!isHost && " · 방장이 시작하기를 기다리는 중"}
        </span>
      )}
      <span className="flex-1" />
      {isHost && phase === "lobby" && (
        <button
          className={btn}
          disabled={players.length < MIN_PLAYERS || (!view.setup.auto && view.setup.slots.length !== players.length)}
          onClick={() => send({ t: "start" })}
        >
          게임 시작
        </button>
      )}
      {isHost && playing && (
        <button className={subBtn} onClick={() => send({ t: "next" })}>
          기다리지 않고 넘기기
        </button>
      )}
      {isHost && phase === "ended" && (
        <button className={btn} onClick={() => send({ t: "lobby" })}>
          대기실로
        </button>
      )}
    </div>
  );
  const notesBox = me.notes.length > 0 && (
    <section>
      <h2 className="mb-1 text-sm font-medium opacity-80">나만 보는 결과</h2>
      <ol className="hud-glass flex max-h-32 flex-col gap-1 overflow-y-auto px-3 py-2 text-sm">
        {me.notes.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ol>
    </section>
  );

  if (asList)
    return (
      <>
        <header className="flex items-start justify-between gap-2">
          {head}
          {corner}
        </header>
        {news}
        {promptBox}
        {phase === "lobby" && <SetupBoard view={view} isHost={isHost} send={send} />}
        {nightModes}
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {seats.map((s) => (
            <li key={s.id}>
              <button
                disabled={!s.enabled}
                aria-pressed={!!s.mark}
                onClick={() => pickSeat(s.id)}
                className={`hud-glass flex w-full flex-col items-start border-2 px-3 py-2 text-left disabled:cursor-default ${
                  s.mark ? "border-[var(--sun)]" : "border-transparent"
                } ${s.alive ? "enabled:hover:border-[var(--parchment)]" : "opacity-40"}`}
              >
                <span className="font-medium">
                  {s.mayor && "시장 "}
                  {s.name}
                  {s.isMe && " (나)"}
                </span>
                <span className="text-xs opacity-80">{s.status || "\u00a0"}</span>
              </button>
            </li>
          ))}
        </ul>
        {controlsRow}
        <Chat view={view} send={send} />
        {notesBox}
      </>
    );

  // 마을이 화면 전체를 채우고, HUD는 가장자리에만 얹는다. 빈 곳을 누르면 마을이 눌린다.
  // 구성은 원작을 따른다: 위에 역할 패·시계·메뉴, 아래에 대화·행동·내 패.
  const colorOf = Object.fromEntries(players.map((p, i) => [p.name, COLORS[i % COLORS.length]]));
  return (
    <div className="fixed inset-0 z-10">
      <Village
        seats={seats}
        scene={phase}
        going={night ? (me.act?.target ?? me.act?.extra ?? null) : null}
        positions={positions}
        onPick={pickSeat}
        onMove={(x, z) => send({ t: "move", x, z })}
      />
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between gap-3 p-3">
        <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-3">
          <div>
            {view.roster.length > 0 && (
              <ul aria-label="이번 판의 역할" className="hud-glass pointer-events-auto inline-flex max-w-full flex-wrap gap-1 p-1.5">
                {view.roster.map((r, i) => (
                  <li key={i}>
                    <RoleTile role={r} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col items-center gap-2">
            <div className="hud-glass hud-display flex items-center gap-2.5 px-4 py-1 text-3xl leading-none">
              {playing && due !== null && <Countdown due={due} />}
              {playing && <span className={night ? "hud-moon" : "hud-sun"} aria-hidden />}
              <span className="text-lg">{title}</span>
            </div>
            {phase !== "lobby" && view.news.length > 0 && (
              <section key={phaseKey} aria-live="polite" className="hud-sign pointer-events-auto max-w-xl px-4 py-2 text-center">
                {view.news.map((line, i) => (
                  <p key={i} className="hud-display text-lg leading-snug">
                    {line}
                  </p>
                ))}
              </section>
            )}
          </div>

          <div className="pointer-events-auto flex items-center justify-end gap-2">
            <span className="hud-glass hud-display px-3 py-1.5">방 {view.code}</span>
            <button className="hud-btn" onClick={() => setAsList(true)}>
              목록
            </button>
            <button className="hud-btn" onClick={leave}>
              나가기
            </button>
          </div>
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
          <div className="pointer-events-auto w-80 max-w-full">
            <Chat view={view} send={send} colors={colorOf} hud />
          </div>

          <div className="pointer-events-auto flex max-w-2xl flex-col items-center gap-2">
            {prompt && (
              <p className="hud-chip hud-display px-3 py-1 text-center text-base">
                {prompt}
                {idle}
              </p>
            )}
            {phase === "lobby" && <SetupBoard view={view} isHost={isHost} send={send} />}
            {nightModes}
            <div className="hud-shadow">{controlsRow}</div>
          </div>

          <div className="flex justify-end">
            <aside className="hud-glass pointer-events-auto w-64 max-w-full p-2.5">
              {role && me.role ? (
                <>
                  <div className="flex items-center gap-2.5">
                    <RoleTile role={me.role} big />
                    <div>
                      <p className="hud-display text-xl leading-tight">{role.name}</p>
                      <p className="text-xs">
                        {TEAM_NAME[me.team]} 편{me.uses !== null && `, 능력 ${me.uses}회 남음`}
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 text-xs leading-5">{role.desc}</p>
                </>
              ) : (
                <p className="hud-display">{phase === "lobby" ? "친구들을 기다리는 중" : "역할은 선거 뒤에 정해집니다"}</p>
              )}
              {me.notes.length > 0 && (
                <details open className="mt-2 border-t border-[var(--parchment)]/30 pt-2">
                  <summary className="hud-display cursor-pointer text-sm">나만 아는 것 {me.notes.length}</summary>
                  <ol className="mt-1 flex max-h-28 flex-col gap-1 overflow-y-auto text-xs leading-5">
                    {me.notes.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ol>
                </details>
              )}
              <details className="mt-2 border-t border-[var(--parchment)]/30 pt-2">
                <summary className="hud-display cursor-pointer text-sm">조작법</summary>
                <p className="mt-1 text-xs leading-5">
                  WASD나 방향키로 걷고, 집이나 사람을 눌러 고릅니다. 오른쪽 버튼을 끌면 시점이 돌고 휠로 당겨 봅니다.
                </p>
              </details>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

// 역할 패. public/roles/<역할 id>.png 그림이 있으면 그것을, 없으면 한 글자를 보여 준다.
function RoleTile({ role, big = false }: { role: Slot["role"]; big?: boolean }) {
  const [missing, setMissing] = useState(false);
  const info = role === "insane" ? INSANE : ROLES[role];
  return (
    <span
      className={`hud-tile overflow-hidden ${missing ? "" : "hud-tile-img"} ${big ? "!h-12 !w-12 !text-2xl" : ""}`}
      title={`${info.name}: ${info.desc}`}
    >
      {missing ? (
        ROLE_MARK[role]
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/roles/${role}.png`} alt={info.name} className="h-full w-full object-cover" onError={() => setMissing(true)} />
      )}
    </span>
  );
}

const TEAM_COLOR: Record<Team, string> = { innocent: "#46a758", imposter: "#d9443a", neutral: "#0090ff" };

// 대기실의 판 짜기. 방장은 이번 판에 넣을 역할과 시간을 고르고, 나머지는 지켜본다.
function SetupBoard({ view, isHost, send }: { view: View; isHost: boolean; send: (m: object) => void }) {
  const { setup } = view;
  const people = view.players.length;
  const change = (next: Partial<View["setup"]>) => send({ t: "setup", ...setup, ...next });
  const count = (team: Team) => setup.slots.filter((s) => s.team === team).length;

  return (
    <section className="hud-glass w-full max-w-2xl p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="hud-display text-xl">이번 판에 넣을 역할</h2>
        {isHost ? (
          <div className="flex gap-2">
            <button className="hud-btn" aria-pressed={setup.auto} onClick={() => change({ auto: true })}>
              알아서 뽑기
            </button>
            <button className="hud-btn" aria-pressed={!setup.auto} onClick={() => change({ auto: false })}>
              직접 고르기
            </button>
          </div>
        ) : (
          <span className="text-sm">방장이 정합니다</span>
        )}
      </div>

      {setup.auto ? (
        <p className="mt-2 text-sm">인원수에 맞춰 무작위로 뽑습니다.</p>
      ) : (
        <>
          <ul className="mt-3 flex min-h-10 flex-wrap gap-1.5">
            {setup.slots.map((slot, i) => (
              <li key={i}>
                <button
                  disabled={!isHost}
                  aria-label={`${slot.role === "insane" ? INSANE.name : ROLES[slot.role].name} 빼기`}
                  onClick={() => change({ slots: setup.slots.filter((_, j) => j !== i) })}
                  className="block rounded-lg border-b-4 pb-0.5 disabled:cursor-default"
                  style={{ borderColor: TEAM_COLOR[slot.team] }}
                >
                  <RoleTile role={slot.role} />
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-sm">
            역할 {setup.slots.length}개 (시민 {count("innocent")}, 임포스터 {count("imposter")}, 중립 {count("neutral")}), 지금 {people}명.
            {setup.slots.length !== people && " 수가 같아야 시작할 수 있어요."}
          </p>
          {isHost &&
            (Object.keys(POOL) as Team[]).map((team) => (
              <div key={team} className="mt-2 flex items-center gap-2">
                <span className="hud-display w-20 shrink-0 border-b-4 text-sm" style={{ borderColor: TEAM_COLOR[team] }}>
                  {TEAM_NAME[team]}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {POOL[team].map((role) => (
                    <button
                      key={role}
                      disabled={setup.slots.length >= MAX_PLAYERS}
                      aria-label={`${role === "insane" ? INSANE.name : ROLES[role].name} 넣기`}
                      onClick={() => change({ slots: [...setup.slots, { role, team }] })}
                      className="disabled:opacity-40"
                    >
                      <RoleTile role={role} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
        </>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
        {(["night", "day"] as const).map((key) => (
          <label key={key} className="flex items-center gap-2">
            {key === "night" ? "밤 시간" : "낮 시간"}
            <select
              className="hud-field py-1"
              disabled={!isHost}
              value={setup[key]}
              onChange={(e) => change({ [key]: Number(e.target.value) })}
            >
              {(key === "night" ? NIGHT_CHOICES : DAY_CHOICES).map((sec) => (
                <option key={sec} value={sec}>
                  {sec}초
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </section>
  );
}

function Countdown({ due }: { due: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.ceil((due - now) / 1000));
  return (
    <span className={`tabular-nums ${left <= 10 ? "text-[var(--blood)]" : ""}`}>
      {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
    </span>
  );
}

type ChatProps = { view: View; send: (m: object) => void; colors?: Record<string, string>; hud?: boolean };

// hud: 마을 위에 얹는 모양 (말풍선이 풀밭 위에 쌓인다)
function Chat({ view, send, colors = {}, hud = false }: ChatProps) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [view.chat.length]);

  const { me, phase } = view;
  const playing = phase === "night" || phase === "day";
  const dead = playing && !me.alive;
  const blocked = phase === "night" && me.alive && me.team !== "imposter";
  const willing = dead && me.will && phase === "day";
  const hint = blocked
    ? "밤에는 말할 수 없어요"
    : willing
      ? "유언 한마디 (모두에게 보이고, 한 번뿐)"
      : dead
        ? "죽은 사람끼리만 보여요"
        : phase === "night"
          ? me.both
            ? "혼자 남았어요. 죽은 동료만 봅니다"
            : "임포스터끼리만 보여요"
          : "할 말을 적으세요";

  return (
    <section className={hud ? "hud-glass p-2" : ""}>
      {!hud && <h2 className="hud-display mb-1 text-sm">대화와 기록</h2>}
      <ol
        ref={list}
        aria-live="polite"
        className={`flex flex-col items-start gap-1 overflow-y-auto text-sm ${hud ? "max-h-44" : "hud-glass h-64 p-2"}`}
      >
        {view.chat.map((c, i) =>
          c.name === "" ? (
            <li key={i} className="hud-shadow w-full px-1 text-xs leading-5">
              {c.text}
            </li>
          ) : (
            <li key={i} className="hud-chip max-w-full break-words">
              <span aria-hidden className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full border border-[var(--ink)]" style={{ background: colors[c.name] ?? "#8b8d98" }} />
              <b className="hud-display mr-1.5 font-normal">{c.name}</b>
              {c.to !== "all" && <span className="mr-1.5 text-xs opacity-70">{c.to === "dead" ? "저승에서" : "임포스터끼리"}</span>}
              {c.text}
            </li>
          ),
        )}
      </ol>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const input = e.currentTarget.elements.namedItem("text") as HTMLInputElement;
          if (input.value.trim()) send({ t: "chat", text: input.value });
          input.value = "";
        }}
      >
        <input name="text" aria-label="메시지" maxLength={200} disabled={blocked} placeholder={hint} autoComplete="off" className="hud-field min-w-0 flex-1 text-sm" />
        <button className={willing ? btn : subBtn} disabled={blocked}>
          {willing ? "유언 남기기" : "보내기"}
        </button>
      </form>
    </section>
  );
}
