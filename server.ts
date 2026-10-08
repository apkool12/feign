// Next + WebSocket 서버. 방 상태는 이 프로세스 메모리에만 있다.
// ponytail: 프로세스 하나 전제. 재시작하면 진행 중인 판이 사라지고 다중 인스턴스 불가 — 필요해지면 Redis로.
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
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

function schedule(room: G.Room) {
  clearTimeout(timers.get(room));
  timers.delete(room);
  // TIMER_SCALE: 시뮬레이션처럼 천천히 진행해야 할 때 제한 시간을 늘린다
  const scale = Number(process.env.TIMER_SCALE) || 1;
  const ms =
    scale *
    (room.phase === "night" ? G.NIGHT_MS : room.phase !== "day" ? 0 : room.day === 0 ? G.ELECTION_MS : G.DAY_MS);
  room.deadline = ms ? Date.now() + ms : null;
  if (!ms) return;
  const timer = setTimeout(() => {
    advance(room);
    broadcast(room);
  }, ms);
  timers.set(room, timer);
}

function advance(room: G.Room) {
  G.advance(room);
  schedule(room);
}

function newCode(): string {
  for (;;) {
    const code = Array.from(randomBytes(4), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ"[b % 24]).join("");
    if (!rooms.has(code)) return code;
  }
}

function join(ws: WebSocket, m: Record<string, unknown>): string | void {
  const name = String(m.name ?? "").trim().slice(0, 12);
  const token = String(m.token ?? "");
  if (!name || token.length < 16) return "닉네임을 입력해 주세요";

  const code = String(m.code ?? "").trim().toUpperCase();
  let room = rooms.get(code);
  if (!code) {
    room = G.newRoom(newCode());
    rooms.set(room.code, room);
  }
  if (!room) return "없는 방이에요";

  let player = room.players.find((p) => p.token === token);
  if (!player) {
    if (room.phase !== "lobby") return "이미 시작된 방이에요";
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
      if (room.players.length < G.MIN_PLAYERS) return `최소 ${G.MIN_PLAYERS}명이 필요해요`;
      G.start(room);
      schedule(room);
      break;
    case "act":
    case "pick": {
      const err =
        m.t === "act"
          ? G.act(room, player, String(m.mode), String(m.target ?? ""), String(m.guess ?? ""), String(m.extra ?? ""))
          : G.pick(room, player, String(m.target));
      if (err) return err;
      if (G.allPicked(room)) advance(room);
      break;
    }
    case "chat": {
      const err = G.say(room, player, String(m.text ?? ""));
      if (err) return err;
      break;
    }
    case "next": // 자리 비운 사람을 기다리지 않고 넘기기
      if (!isHost) return "방장만 넘길 수 있어요";
      advance(room);
      break;
    case "lobby":
      if (!isHost) return "방장만 할 수 있어요";
      if (room.phase !== "ended") return "게임이 끝난 뒤에 할 수 있어요";
      room.phase = "lobby";
      room.players = room.players.filter((p) => p.connected);
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
    let m: unknown;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (typeof m !== "object" || m === null) return;
    const err = onMessage(ws, m as Record<string, unknown>);
    if (err) send(ws, { t: "error", msg: err });
  });
  ws.on("close", () => leave(ws));
  ws.on("error", () => ws.close());
});

await app.prepare();
const server = createServer((req, res) => handle(req, res));
// /ws만 직접 받는다. 나머지 업그레이드(dev HMR)는 Next가 스스로 붙이는 리스너가 처리한다.
server.on("upgrade", (req, socket, head) => {
  if (req.url === "/ws") wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});
server.listen(port, () => console.log(`> http://localhost:${port} (${dev ? "dev" : "production"})`));
