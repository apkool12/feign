"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_PLAYERS, MIN_PLAYERS, ROLES, SKIP, TEAM_NAME, type Mode, type Role, type View } from "../game";

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

const btn = "rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500 disabled:opacity-40";
const subBtn = "rounded-lg border border-zinc-700 px-4 py-2 text-zinc-200 hover:bg-zinc-800 disabled:opacity-40";

export default function Page() {
  const [view, setView] = useState<View | null>(null);
  const [due, setDue] = useState<number | null>(null); // 페이즈가 끝나는 시각 (이 기기 시계 기준)
  const [error, setError] = useState("");
  const [online, setOnline] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  const saved = useRef<Saved>({ token: "" });

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
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 bg-zinc-950 p-4 text-zinc-100">
      {error && (
        <p role="alert" className="rounded-lg bg-red-950 px-3 py-2 text-red-200">
          {error}
        </p>
      )}
      {!online && <p className="text-sm text-zinc-400">서버에 연결하는 중…</p>}
      {view ? (
        <Game view={view} due={due} send={send} leave={leave} />
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
          <h1 className="text-3xl font-bold">Feign</h1>
          <label className="flex flex-col gap-1 text-sm">
            닉네임
            <input name="name" required maxLength={12} className="rounded-lg bg-zinc-800 px-3 py-2 text-base" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            방 코드 (비우면 새 방을 만듭니다)
            <input
              name="code"
              maxLength={4}
              autoCapitalize="characters"
              autoComplete="off"
              className="rounded-lg bg-zinc-800 px-3 py-2 text-base uppercase"
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

type GameProps = { view: View; due: number | null; send: (m: object) => void; leave: () => void };

// 화면은 view를 그리고 send로 행동을 보내기만 한다. 3D 마을로 바꿀 때 갈아 끼울 자리가 이 컴포넌트다.
function Game({ view, due, send, leave }: GameProps) {
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

  return (
    <>
      <header className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">
            {title}
            {playing && due !== null && <Countdown due={due} />}
          </h1>
          <p className="text-sm text-zinc-400">
            방 코드 <span className="font-mono text-base text-zinc-100">{view.code}</span>
            {role && (
              <>
                {" · 내 역할 "}
                <b className="text-zinc-100">
                  {role.name} ({TEAM_NAME[me.team]})
                </b>
              </>
            )}
          </p>
          {role && <p className="text-sm text-zinc-400">{role.desc}</p>}
        </div>
        <button className={subBtn} onClick={leave}>
          나가기
        </button>
      </header>

      {phase !== "lobby" && view.news.length > 0 && (
        <section aria-live="polite" className="rounded-lg border border-amber-500/60 bg-amber-950/40 px-4 py-3">
          {view.news.map((line, i) => (
            <p key={i} className="text-lg font-medium text-amber-100">
              {line}
            </p>
          ))}
        </section>
      )}

      {prompt && (
        <p className="rounded-lg bg-zinc-900 px-3 py-2">
          {prompt}
          {idle}
        </p>
      )}

      {night && me.alive && (
        <div className="flex flex-wrap items-center gap-2">
          {me.modes.map((m) =>
            m === "kill" || m === "ability" ? (
              <button key={m} className={m === mode ? btn : subBtn} aria-pressed={m === mode} onClick={() => setWanted(m)}>
                {modeLabel(m)}
              </button>
            ) : (
              <button
                key={m}
                className={me.act?.mode === m ? btn : subBtn}
                aria-pressed={me.act?.mode === m}
                onClick={() => send({ t: "act", mode: m })}
              >
                {modeLabel(m)}
              </button>
            ),
          )}
          {me.role === "sorcerer" && (
            <label className="flex items-center gap-2 text-sm text-zinc-400">
              맞힐 역할
              <select
                value={guess}
                onChange={(e) => setGuess(e.target.value as Role)}
                className="rounded-lg bg-zinc-800 px-2 py-2 text-base text-zinc-100"
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
      )}

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {players.map((p) => {
          const isMe = p.id === me.id;
          const usable = night
            ? !!mode && !isMe && !(mode === "kill" && p.ally) && !(mode === "ability" && me.blocked === p.id)
            : phase === "day";
          const killing = night && me.act?.mode === "kill" && me.act.target === p.id;
          const aiming = night && (me.act?.mode === "ability" ? me.act.target : me.act?.extra) === p.id;
          const selected = night ? killing || aiming : me.pick === p.id;
          return (
            <li key={p.id}>
              <button
                disabled={!me.alive || !p.alive || !usable}
                aria-pressed={selected}
                onClick={() => (night ? visit(p.id) : send({ t: "pick", target: p.id }))}
                className={`flex w-full flex-col items-start rounded-lg border px-3 py-2 text-left disabled:cursor-default ${
                  selected ? "border-indigo-400 bg-indigo-950" : "border-zinc-800 bg-zinc-900"
                } ${p.alive ? "enabled:hover:border-zinc-500" : "opacity-40"}`}
              >
                <span className="font-medium">
                  {p.name}
                  {isMe && " (나)"}
                  {p.mayor && " · 시장"}
                </span>
                <span className="text-xs text-zinc-400">
                  {[
                    // 살아 있는 내 역할은 상단에 있으니 카드에서는 뺀다
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
                    .join(" · ") || "\u00a0"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        {phase === "day" && me.alive && (
          <button
            className={me.pick === SKIP ? btn : subBtn}
            aria-pressed={me.pick === SKIP}
            onClick={() => send({ t: "pick", target: SKIP })}
          >
            기권
          </button>
        )}
        {playing && <span className="text-sm text-zinc-400">{view.pending}명의 선택을 기다리는 중</span>}
        {phase === "lobby" && (
          <span className="text-sm text-zinc-400">
            {players.length}/{MAX_PLAYERS}명 · 최소 {MIN_PLAYERS}명
            {!isHost && " · 방장이 시작하기를 기다리는 중"}
          </span>
        )}
        <span className="flex-1" />
        {isHost && phase === "lobby" && (
          <button className={btn} disabled={players.length < MIN_PLAYERS} onClick={() => send({ t: "start" })}>
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

      <Chat view={view} send={send} />

      {me.notes.length > 0 && (
        <section>
          <h2 className="mb-1 text-sm font-medium text-zinc-400">나만 보는 결과</h2>
          <ol className="flex flex-col gap-1 rounded-lg bg-zinc-900 px-3 py-2 text-sm">
            {me.notes.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}

function Countdown({ due }: { due: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  const s = Math.max(0, Math.ceil((due - now) / 1000));
  return (
    <span className={`ml-3 font-mono text-lg ${s <= 10 ? "text-red-400" : "text-zinc-400"}`}>
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
    </span>
  );
}

function Chat({ view, send }: { view: View; send: (m: object) => void }) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [view.chat.length]);

  const { me, phase } = view;
  const playing = phase === "night" || phase === "day";
  const dead = playing && !me.alive;
  const blocked = phase === "night" && me.alive && me.team !== "imposter";
  const hint = blocked
    ? "밤에는 대화할 수 없어요"
    : dead
      ? me.will && phase === "day"
        ? "유언 한마디 (모두에게 보이고, 한 번뿐입니다)"
        : "죽은 사람끼리만 보여요"
      : phase === "night"
        ? me.both
          ? "혼자 남았습니다. 죽은 동료만 볼 수 있어요"
          : "임포스터 편끼리만 보여요"
        : "메시지 입력";
  const willing = dead && me.will && phase === "day";

  return (
    <section>
      <h2 className="mb-1 text-sm font-medium text-zinc-400">대화와 기록</h2>
      <ol
        ref={list}
        aria-live="polite"
        className="flex h-64 flex-col gap-1 overflow-y-auto rounded-lg bg-zinc-900 px-3 py-2 text-sm"
      >
        {view.chat.map((c, i) =>
          c.name === "" ? (
            <li key={i} className="py-1 text-center text-xs text-amber-200/80">
              {c.text}
            </li>
          ) : (
            <li key={i}>
              <b className="mr-2 text-indigo-300">{c.name}</b>
              {c.to !== "all" && (
                <span className="mr-2 text-xs text-zinc-500">{c.to === "dead" ? "사망자끼리" : "임포스터끼리"}</span>
              )}
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
        <input
          name="text"
          aria-label="메시지"
          maxLength={200}
          disabled={blocked}
          placeholder={hint}
          autoComplete="off"
          className="min-w-0 flex-1 rounded-lg bg-zinc-800 px-3 py-2 disabled:opacity-50"
        />
        <button className={willing ? btn : subBtn} disabled={blocked}>
          {willing ? "유언 남기기" : "보내기"}
        </button>
      </form>
    </section>
  );
}
