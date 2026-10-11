"use client";

// 어젯밤 회상: 감시자·추적자가 본 것을 글 대신 마을 안에서 다시 보여 준다.
// 서버가 준 장면(me.scenes)을 그대로 재생할 뿐이라 정신병자의 가짜 장면도 똑같이 보인다.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { COLORS } from "./colors";
import { turn } from "./Dusk";
import { play } from "./sound";
import { stage, type Flash } from "./stage";
import { lift, type Plan } from "./Terrain";
import { Body, type Seat } from "./Village";

type V = THREE.Vector3;
type Spot = { house: V; door: V };
// 배우가 t0~t1 동안 a에서 b로 가며 clip을 한다. 구간 밖에서는 보이지 않는다.
// round면 곧장 가로지르지 않고 광장을 끼고 둥글게 돌아간다 (모닥불을 뚫고 가지 않게).
type Seg = { t0: number; t1: number; a: V; b: V; clip: string; s0?: number; s1?: number; face?: V; round?: boolean };
type Part = { seat: Seat; color: string; segs: Seg[] };
type Script = { cast: Part[]; pos: V; look: V; follow: number; knocks: number[]; sum: number; total: number };

const IN = 1; // 카메라가 자리를 잡는 시간
const SUM = 2; // 본 것을 정리해 보여 주는 시간
const OUT = 0.8; // 카메라가 돌아오는 시간
const PACE = 3.2; // 살금살금 걷는 속도
const angle = (v: V) => Math.atan2(v.x, v.z);
const turnTo = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from)); // 가까운 쪽으로 도는 각
const smooth = (x: number) => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * (3 - 2 * u);
};

function write(flash: Flash, seats: Seat[], spots: Spot[], sizes: number[]): Script | null {
  const index = (id: string) => seats.findIndex((s) => s.id === id);
  const part = (i: number, segs: Seg[]): Part => ({ seat: { ...seats[i], alive: true, won: false, done: false }, color: COLORS[i % COLORS.length], segs });
  const out = (i: number) => spots[i].house.clone().normalize(); // 광장에서 집 쪽
  const sill = (i: number) => spots[i].house.clone().addScaledVector(out(i), -sizes[i] * 0.6); // 문턱
  const step = (i: number) => spots[i].house.clone().addScaledVector(out(i), -sizes[i] - 0.5); // 문 앞
  // 집 모퉁이 뒤에 숨어 문 앞을 어깨 너머로 본다
  const shot = (i: number) => {
    const d = out(i);
    const side = new THREE.Vector3(d.z, 0, -d.x);
    const hide = spots[i].house.clone().addScaledVector(side, sizes[i] + 0.8).addScaledVector(d, 0.9);
    const pos = spots[i].house.clone().addScaledVector(d, 3.4).addScaledVector(side, sizes[i] + 5.2).setY(2.7);
    const look = step(i).addScaledVector(side, 0.4).setY(0.7);
    return { hide, pos, look };
  };
  const me = index(seats.find((s) => s.isMe)?.id ?? "");
  if (me < 0) return null;

  if (flash.kind === "lookout") {
    const h = index(flash.house);
    if (h < 0) return null;
    const { hide, pos, look } = shot(h);
    const knocks: number[] = [];
    let end = IN + 2.4;
    const cast = flash.visitors.flatMap((id, k) => {
      const v = index(id);
      if (v < 0) return [];
      // 자기 집 쪽에서 오되, 멀리서부터 걸어오느라 지루하지 않게 마지막 몇 걸음만 보여 준다
      const ring = step(h).length();
      const sweep = turnTo(angle(step(h)), angle(spots[v].house));
      const arc = Math.min(Math.abs(sweep), 6.5 / ring);
      const start = step(h).applyAxisAngle(UP, Math.sign(sweep) * arc);
      const t0 = IN + 0.2 + k * 1.3;
      const t1 = t0 + (arc * ring) / PACE;
      knocks.push(t1 + 0.15);
      end = Math.max(end, t1 + 1.4);
      return [
        part(v, [
          { t0, t1, a: start, b: step(h), clip: "sneak", round: true },
          { t0: t1, t1: t1 + 0.9, a: step(h), b: step(h), clip: "knock", face: spots[h].house },
          { t0: t1 + 0.9, t1: t1 + 1.4, a: step(h), b: sill(h), clip: "walk", s1: 0 },
        ]),
      ];
    });
    const sum = end + 0.3;
    const total = sum + SUM + OUT;
    // 아무도 안 오면 두리번거린다
    const watch: Seg[] = cast.length
      ? [{ t0: 0, t1: total, a: hide, b: hide, clip: "peek", face: step(h) }]
      : [
          { t0: 0, t1: IN + 1.2, a: hide, b: hide, clip: "peek", face: step(h) },
          { t0: IN + 1.2, t1: total, a: hide, b: hide, clip: "turn", face: step(h) },
        ];
    return { cast: [part(me, watch), ...cast], pos, look, follow: -1, knocks, sum, total };
  }

  const w = index(flash.who);
  if (w < 0) return null;
  const { hide, pos, look } = shot(w);
  pos.add(pos.clone().sub(look).setY(0).multiplyScalar(0.35)).setY(6.5); // 따라다니려면 나무에 가리지 않게 더 높고 멀리서
  const segs: Seg[] = [];
  const knocks: number[] = [];
  let t = IN + 0.3;
  let at = step(w);
  if (flash.out) {
    segs.push({ t0: t, t1: t + 0.5, a: sill(w), b: at, clip: "walk", s0: 0 });
    t += 0.5;
    const stops = flash.went.map(index).filter((i) => i >= 0);
    for (const i of stops) {
      const to = step(i);
      const t1 = t + Math.min(2.2, Math.max(0.8, at.distanceTo(to) / PACE));
      segs.push({ t0: t, t1, a: at, b: to, clip: "sneak", round: true }, { t0: t1, t1: t1 + 0.9, a: to, b: to, clip: "knock", face: spots[i].house });
      knocks.push(t1 + 0.15);
      t = t1 + 0.9;
      at = to;
    }
    if (!stops.length) {
      // 나갔지만 들른 집이 없다: 마을 안쪽으로 몇 걸음 나갔다 멈춘다
      const to = at.clone().multiplyScalar(0.45);
      const t1 = t + at.distanceTo(to) / PACE;
      segs.push({ t0: t, t1, a: at, b: to, clip: "sneak" });
      t = t1;
      at = to;
    }
    segs.push({ t0: t, t1: 1e9, a: at, b: at, clip: "idle" });
  } else t += 2.2; // 나오지 않았다: 불 켜진 집만 조용히
  const sum = t + 0.4;
  const total = sum + SUM + OUT;
  const cast = [part(me, [{ t0: 0, t1: total, a: hide, b: hide, clip: "peek", face: step(w) }])];
  if (segs.length) cast.push(part(w, segs));
  return { cast, pos, look, follow: segs.length ? 1 : -1, knocks, sum, total };
}

type Props = {
  flash: Flash;
  seats: Seat[];
  spots: Spot[];
  sizes: number[]; // 집마다의 반경
  land: Plan;
  calm: boolean; // 모션 줄이기: 장면 없이 정리만 보여 준다
  controls: RefObject<OrbitControls | null>;
  onSum: () => void;
  onEnd: () => void;
};

const UP = new THREE.Vector3(0, 1, 0);
const eye = new THREE.Vector3();
const aim = new THREE.Vector3();
const here = new THREE.Vector3();

export function Replay({ flash, seats, spots, sizes, land, calm, controls, onSum, onEnd }: Props) {
  // 장면은 시작할 때의 마을 그대로 끝까지 간다
  const script = useMemo(() => write(flash, seats, spots, sizes), []); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useRef<(THREE.Group | null)[]>([]);
  const clips = useMemo(() => (script?.cast ?? []).map(() => ({ current: "idle" })), [script]);
  const clock = useRef({ t: calm && script ? script.sum : 0, summed: false, over: false, knocked: 0 });
  const home = useRef<{ pos: V; look: V } | null>(null);
  const track = useRef<V | null>(null);
  const done = useRef(onEnd);
  done.current = onEnd;
  const camera = useThree((three) => three.camera);

  useEffect(() => {
    if (!script) return done.current();
    stage.hold((script.total - clock.current.t) * 1000);
    // 낮에 다시 볼 때도 해가 천천히 지지 않고 바로 밤이다 (해 질 녘 연출은 이 장면이 끝나기를 기다리며 멈춰 있다)
    if (!calm) Object.assign(turn, { at: -Infinity, waiting: false, cast: false });
    // 한 번 누르면 정리로, 한 번 더 누르면 끝으로
    const skip = (e: Event) => {
      const el = e.target as HTMLElement;
      if (e instanceof KeyboardEvent ? e.code !== "Space" || el.tagName === "INPUT" : el.tagName !== "CANVAS") return;
      const c = clock.current;
      c.t = c.t < script.sum ? script.sum : Math.max(c.t, script.total - OUT);
    };
    addEventListener("keydown", skip);
    addEventListener("pointerdown", skip);
    return () => {
      removeEventListener("keydown", skip);
      removeEventListener("pointerdown", skip);
      stage.release();
      // 도중에 끊겨도(페이즈가 넘어가는 등) 카메라는 제자리로 돌려놓는다
      const c = controls.current;
      if (!c) return;
      if (home.current) {
        camera.position.copy(home.current.pos);
        c.target.copy(home.current.look);
        home.current = null;
      }
      c.enabled = true;
      c.update();
    };
  }, [script, controls, camera]);

  useFrame((state, dt) => {
    const c = clock.current;
    if (!script || c.over) return;
    c.t += dt;
    const t = c.t;
    if (!c.summed && t >= script.sum) {
      c.summed = true;
      onSum();
    }
    while (!calm && c.knocked < script.knocks.length && t >= script.knocks[c.knocked]) {
      c.knocked++;
      play("knock", 0.7);
    }

    script.cast.forEach((part, i) => {
      const g = groups.current[i];
      if (!g) return;
      const seg = part.segs.find((s) => t >= s.t0 && t < s.t1);
      g.visible = !calm && !!seg;
      if (!seg) return;
      const u = (t - seg.t0) / (seg.t1 - seg.t0);
      const before = here.copy(g.position);
      if (seg.round) {
        const a0 = angle(seg.a);
        const turn = a0 + turnTo(a0, angle(seg.b)) * u;
        g.position.set(Math.sin(turn), 0, Math.cos(turn)).multiplyScalar(seg.a.length() + (seg.b.length() - seg.a.length()) * u);
      } else g.position.lerpVectors(seg.a, seg.b, u);
      g.position.y = lift(land, g.position.x, g.position.z);
      g.scale.setScalar((seg.s0 ?? 1) + ((seg.s1 ?? 1) - (seg.s0 ?? 1)) * u);
      // 걷는 동안은 가는 쪽을 본다
      const dx = seg.face ? seg.face.x - g.position.x : seg.round ? g.position.x - before.x : seg.b.x - seg.a.x;
      const dz = seg.face ? seg.face.z - g.position.z : seg.round ? g.position.z - before.z : seg.b.z - seg.a.z;
      if (dx * dx + dz * dz > 1e-8 && (u > 0.02 || !seg.round)) g.rotation.y = Math.atan2(dx, dz);
      clips[i].current = seg.clip;
    });

    const orbit = controls.current;
    if (calm || !orbit) {
      if (t >= script.total) end();
      return;
    }
    if (!home.current) {
      home.current = { pos: state.camera.position.clone(), look: orbit.target.clone() };
    }
    orbit.enabled = false;
    // 따라가는 배우가 있으면 카메라가 같은 거리에서 뒤따른다
    aim.copy(script.look);
    eye.copy(script.pos);
    const star = groups.current[script.follow];
    if (star?.visible) {
      track.current ??= star.position.clone();
      track.current.lerp(star.position, 1 - Math.exp(-dt * 3));
      here.copy(track.current).sub(script.cast[script.follow].segs[0].b);
      aim.add(here);
      eye.add(here);
    }
    const u = Math.min(smooth(t / IN), 1 - smooth((t - (script.total - OUT)) / OUT));
    state.camera.position.lerpVectors(home.current.pos, eye, u);
    orbit.target.lerpVectors(home.current.look, aim, u);
    state.camera.lookAt(orbit.target);
    if (t >= script.total) {
      end(); // 카메라는 이 장면이 내려갈 때 제자리로 돌아간다
    }
  });
  function end() {
    clock.current.over = true;
    done.current();
  }

  return (
    <>
      {script?.cast.map((part, i) => (
        <group
          key={part.seat.id}
          visible={false}
          ref={(g) => {
            groups.current[i] = g;
          }}
        >
          <Body seat={part.seat} color={part.color} clip={clips[i]} />
        </group>
      ))}
    </>
  );
}

// 화면 위의 "어젯밤" 딱지와, 끝에 본 것을 색 머리로 정리한 줄
export function ReplayHud({ flash, seats, sum }: { flash: Flash; seats: Seat[]; sum: boolean }) {
  const head = (id: string) => {
    const i = seats.findIndex((s) => s.id === id);
    if (i < 0) return null;
    return (
      <span key={id} className="flash-who">
        <i style={{ background: COLORS[i % COLORS.length] }} />
        {seats[i].name}
      </span>
    );
  };
  const seen = flash.kind === "lookout" ? flash.visitors : flash.went;
  const none = flash.kind === "lookout" ? "아무도 안 옴" : flash.out ? "들른 집 없음" : "안 나감";
  return (
    <div className="flash" aria-live="polite">
      <p className="chip flash-tag">어젯밤</p>
      {sum && (
        <p className="paper flash-sum">
          {flash.kind === "lookout" ? (
            <>
              {seen.length ? seen.map(head) : <span>{none}</span>}
              <b aria-hidden>→</b>
              {head(flash.house)}
            </>
          ) : (
            <>
              {head(flash.who)}
              <b aria-hidden>→</b>
              {seen.length ? seen.map(head) : <span>{none}</span>}
            </>
          )}
        </p>
      )}
    </div>
  );
}
