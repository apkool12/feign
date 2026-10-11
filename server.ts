// Next + WebSocket 서버. 방 상태는 이 프로세스 메모리에만 있다.
// ponytail: 프로세스 하나 전제. 재시작하면 진행 중인 판이 사라지고 다중 인스턴스 불가 — 필요해지면 Redis로.
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import next from "next";
import { type WebSocket, WebSocketServer } from "ws";
import * as G from "./game.ts";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT) || 3000;
const app = next({ dev });
const handle = app.getRequestHandler();

const rooms = new Map<string, G.Room>();
const sockets = new Map<WebSocket, { room: G.Room; player: G.Player }>();

const send = (ws: WebSocket, msg: object) => ws.send(JSON.stringify(msg));
const hasConnection = (room: G.Room) => room.players.some((p) => p.connected);

function broadcast(room: G.Room) {
  for (const [ws, s] of sockets) if (s.room === room) send(ws, { t: "state", state: G.view(room, s.player) });
}

// 페이즈 제한 시간이 지나면 자동으로 정산한다
const timers = new Map<G.Room, NodeJS.Timeout>();

// ms 뒤에 현재 페이즈를 마감한다
function arm(room: G.Room, ms: number) {
  clearTimeout(timers.get(room));
  room.deadline = Date.now() + ms;
  const timer = setTimeout(() => {
    advance(room);
    broadcast(room);
  }, ms);
  timers.set(room, timer);
}

function schedule(room: G.Room, extra = 0) {
  clearTimeout(timers.get(room));
  timers.delete(room);
  // TIMER_SCALE: 시뮬레이션처럼 천천히 진행해야 할 때 제한 시간을 늘린다
  const scale = Number(process.env.TIMER_SCALE) || 1;
  const { day } = room.setup;
  const ms =
    scale *
    (room.phase === "night" ? G.TURN_MS : room.phase !== "day" ? 0 : room.day === 0 ? G.ELECTION_MS : day * 1000);
  room.deadline = null;
  // 1일차 밤에는 역할을 읽을 시간을 더 준다
  // 밤은 차례마다 시간을 잰다. 첫 차례에는 연출이 쓰는 시간도 더 준다
  if (ms) arm(room, ms + (room.phase === "night" && room.turn === 0 ? G.DUSK_MS + extra + (room.day === 1 ? G.FIRST_NIGHT_MS : 0) : 0));
}

// 기다릴 사람이 없으면 곧 마감한다. 바로 넘기지 않는 것은 잘못 누른 선택을 바꿀 틈을 주기 위해서다.
function closeSoon(room: G.Room) {
  // 밤의 차례는 일찍 닫지 않는다 (차례가 빨리 끝나면 그 역할이 살아 있다는 것이 드러난다)
  if (room.phase === "night" || room.deadline === null || !G.allPicked(room)) return;
  if (room.deadline - Date.now() > G.CLOSE_MS) arm(room, G.CLOSE_MS);
}

function advance(room: G.Room) {
  if (G.pass(room)) return schedule(room); // 밤의 다음 차례
  const alive = () => room.players.filter((p) => p.alive).length;
  const voting = room.phase === "day";
  const before = alive();
  G.advance(room);
  schedule(room, voting && alive() < before ? G.EXILE_MS : 0); // 추방 연출 동안 밤 시간이 줄지 않게
}

function newCode(): string {
  for (;;) {
    const code = Array.from(randomBytes(4), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ"[b % 24]).join("");
    if (!rooms.has(code)) return code;
  }
}

// 받은 값은 믿지 않는다. 문자열이 아니면 빈 값으로 보고 뒤의 검사에서 거부한다.
// (String()은 toString이 망가진 객체를 받으면 예외를 던진다)
const str = (v: unknown) => (typeof v === "string" ? v : "");

function join(ws: WebSocket, m: Record<string, unknown>): string | void {
  const name = str(m.name).trim().slice(0, 12);
  const token = str(m.token);
  if (!name || token.length < 16) return "닉네임을 입력해 주세요";

  const code = str(m.code).trim().toUpperCase();
  let room = rooms.get(code);
  if (!code) {
    room = G.newRoom(newCode());
    rooms.set(room.code, room);
  }
  if (!room) return "없는 방이에요";

  let player = room.players.find((p) => p.token === token);
  // 자리 되찾기: 탭을 닫아 token을 잃은 사람은 접속이 끊긴 자기 닉네임의 자리를 이어받는다
  // ponytail: 닉네임만 맞으면 되므로 끊긴 사람의 자리를 남이 가로챌 수 있다. 친구끼리 쓰는 전제 — 공개 서비스가 되면 계정이나 비밀번호로.
  if (!player && room.phase !== "lobby") {
    player = room.players.find((p) => p.name === name && !p.connected);
    if (!player) return "이미 시작된 방이에요. 끊긴 자리와 같은 닉네임이면 다시 들어올 수 있어요";
    player.token = token;
  }
  if (!player) {
    if (room.players.length >= G.MAX_PLAYERS) return "방이 꽉 찼어요";
    if (room.players.some((p) => p.name === name)) return "이미 있는 닉네임이에요";
    player = G.newPlayer(randomBytes(4).toString("hex"), token, name);
    room.players.push(player);
  }
  // 같은 사람이 다시 들어오면 이전 연결은 끊는다
  for (const [old, o] of sockets) {
    if (o.player === player) {
      sockets.delete(old);
      old.close(4000); // 클라이언트는 4000이면 재접속하지 않는다
    }
  }
  player.connected = true;
  sockets.set(ws, { room, player });
  broadcast(room);
}

function onMessage(ws: WebSocket, m: Record<string, unknown>): string | void {
  const s = sockets.get(ws);
  if (m.t === "join") return s ? undefined : join(ws, m);
  if (!s) return "먼저 입장해 주세요";

  const { room, player } = s;
  const isHost = room.players.find((p) => p.connected) === player;
  switch (m.t) {
    case "start":
      if (!isHost) return "방장만 시작할 수 있어요";
      if (room.phase !== "lobby") return "이미 시작했어요";
      {
        const err = G.canStart(room);
        if (err) return err;
      }
      G.start(room);
      schedule(room);
      break;
    case "act":
    case "pick": {
      const err =
        m.t === "act"
          ? G.act(room, player, str(m.mode), str(m.target), str(m.guess), str(m.extra))
          : G.pick(room, player, str(m.target));
      if (err) return err;
      closeSoon(room);
      break;
    }
    case "chat": {
      const err = G.say(room, player, str(m.text));
      if (err) return err;
      break;
    }
    case "typing": {
      // 입력 중 표시. 그 말을 듣게 될 사람에게만 전하고 저장하지 않는다.
      const to = G.channel(room, player);
      if (!to || typeof m.on !== "boolean") return;
      const msg = JSON.stringify({ t: "typing", id: player.id, on: m.on });
      for (const [other, o] of sockets) if (o.room === room && other !== ws && G.hears(room, o.player, to)) other.send(msg);
      return;
    }
    case "setup": {
      if (!isHost) return "방장만 바꿀 수 있어요";
      const err = G.configure(room, m.auto, m.slots, m.night, m.day, m.calm);
      if (err) return err;
      break;
    }
    case "skin":
    case "house":
    case "hat": {
      // 규칙과 무관한 꾸밈이지만 게임 중에 바뀌면 헷갈리므로 대기실에서만
      if (room.phase !== "lobby") return "대기실에서만 바꿀 수 있어요";
      const err = m.t === "skin" ? G.setSkin(player, m.skin) : m.t === "house" ? G.setHouse(player, m.house) : G.setHat(player, m.hat);
      if (err) return err;
      break;
    }
    case "move": {
      // 마을에서 걸어다니는 위치를 같은 방 사람들에게 전한다. 규칙과 무관한 연출이라 저장하지 않는다.
      // 밤의 이동은 비밀이라 전하지 않는다. 죽은 사람(유령)의 위치는 죽은 사람끼리만 본다.
      const { x, z } = m;
      if (typeof x !== "number" || typeof z !== "number") return;
      const ghost = !player.alive && (room.phase === "night" || room.phase === "day");
      if ((room.phase === "night" && !ghost) || !Number.isFinite(x) || !Number.isFinite(z)) return;
      const clamp = (n: number) => Math.max(-40, Math.min(40, n));
      const msg = JSON.stringify({ t: "pos", id: player.id, x: clamp(x), z: clamp(z) });
      for (const [other, o] of sockets) if (o.room === room && other !== ws && (!ghost || !o.player.alive)) other.send(msg);
      return;
    }
    case "rtc": {
      // 음성 연결을 맺는 쪽지. 내용은 보지 않고 같은 방의 받는 사람에게만 전한다 (to가 "*"면 모두에게).
      const to = str(m.to);
      if (typeof m.data !== "object" || !m.data || JSON.stringify(m.data).length > 20_000) return;
      const msg = JSON.stringify({ t: "rtc", from: player.id, data: m.data });
      for (const [other, o] of sockets) if (o.room === room && other !== ws && (to === "*" || o.player.id === to)) other.send(msg);
      return;
    }
    case "next": // 자리 비운 사람을 기다리지 않고 넘기기
      if (!isHost) return "방장만 넘길 수 있어요";
      advance(room);
      break;
    case "lobby":
      if (!isHost) return "방장만 할 수 있어요";
      if (room.phase !== "ended") return "게임이 끝난 뒤에 할 수 있어요";
      G.toLobby(room);
      break;
    default:
      return;
  }
  broadcast(room);
}

function leave(ws: WebSocket) {
  const s = sockets.get(ws);
  if (!s) return;
  sockets.delete(ws);
  const { room, player } = s;
  player.connected = false;
  if (room.phase === "lobby") room.players = room.players.filter((p) => p !== player);
  else closeSoon(room); // 끊긴 사람은 기다리지 않는다
  if (!hasConnection(room)) {
    setTimeout(() => {
      if (hasConnection(room)) return;
      clearTimeout(timers.get(room));
      timers.delete(room);
      rooms.delete(room.code);
    }, 10 * 60_000).unref();
  }
  broadcast(room);
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    // 무엇이 오든 예외가 연결을 망가뜨리지 않게 한다 (close 처리가 살아 있어야 유령 접속자가 안 남는다)
    try {
      const m: unknown = JSON.parse(String(raw));
      if (typeof m !== "object" || m === null) return;
      const err = onMessage(ws, m as Record<string, unknown>);
      if (err) send(ws, { t: "error", msg: err });
    } catch (e) {
      if (!(e instanceof SyntaxError)) console.error(e);
    }
  });
  ws.on("close", () => leave(ws));
  ws.on("error", () => ws.close());
});

await app.prepare();
const server = createServer((req, res) => handle(req, res));
// /ws만 직접 받는다. 나머지 업그레이드(dev HMR)는 Next가 스스로 붙이는 리스너가 처리한다.
server.on("upgrade", (req, socket, head) => {
  if (req.url === "/ws") return wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  // 아무도 받지 않은 업그레이드는 끊는다. 걸린 채 두면 Chrome이 같은 호스트로 가는 다음 웹소켓을 전부 그 뒤에 줄 세워서
  // 새 탭이 "서버 연결 중"에서 멈춘다.
  setTimeout(() => {
    if ((socket as Socket).bytesWritten) return;
    console.warn("받는 곳 없는 업그레이드를 끊음:", req.url);
    socket.destroy();
  }, 3000);
});
server.listen(port, () => console.log(`> http://localhost:${port} (${dev ? "dev" : "production"})`));
