"use client";

// 어젯밤 회상: 밤사이 내가 알게 된 것(me.scenes)을 글 대신 마을 안에서 다시 보여 준다.
// 서버가 준 장면을 그대로 재생할 뿐이라 정신병자의 가짜 장면도 똑같이 보인다.
// 서버가 알려 주지 않은 사람(덫에 걸린 사람, 습격한 사람 등)은 누구인지 알 수 없는 검은 그림자로만 나온다.
import { useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ROLES, TEAM_NAME, type Dawn, type Role, type Scene, type Team } from "../game";
import { COLORS } from "./colors";
import { turn } from "./Dusk";
import { AbilityEffect, Burst, RoleIcon, Shield, Trap, useShake } from "./Effects";
import { play, SFX, type Sfx } from "./sound";
import { lean, stage, type Call, type Exile, type Flash } from "./stage";
import { lift, type Plan } from "./Terrain";
import { Body, Model, type Seat } from "./Village";

type V = THREE.Vector3;
type Spot = { house: V; door: V; plaza: V; angle: number };
// 배우가 t0~t1 동안 a에서 b로 가며 clip을 한다. 구간 밖에서는 보이지 않는다.
// round면 곧장 가로지르지 않고 광장을 끼고 둥글게 돌아간다 (모닥불을 뚫고 가지 않게).
// up이면 땅에서 그 높이만큼 뜬다(처음→끝). sway면 좌우로 흔들린다.
type Seg = { t0: number; t1: number; a: V; b: V; clip: string; s0?: number; s1?: number; face?: V; round?: boolean; up?: [number, number]; sway?: boolean; yaw?: number };
type Part = { seat: Seat | null; color: string; segs: Seg[]; prop?: string; balloons?: number; rise?: number; tip?: { at: number; by: number } }; // rise는 떠오르기 시작하는 때(끈이 휜다), tip은 박힌 뒤 건들거리다 기우는 묘비 // seat이 null이면 누구인지 모르는 그림자, prop이면 소품 모델. balloons는 풍선이 달리기 시작하는 때
// 능력 효과 (집 기준으로 놓인다). h는 그 집 지붕 높이, door는 문의 앞뒤 위치. kind가 "trap"이면 덫: armed면 이미 놓여 있고, snap은 닫히는 때.
type Fx = { t0: number; t1: number; at: V; rot: number; kind: string; h?: number; door?: number; armed?: boolean; snap?: number };
type Icon = { t0: number; t1: number; at: V; role: string }; // 떠오르는 역할 패
type Cue = { t: number; name: Sfx };
// 장면 하나. 시간은 장면이 시작된 때부터 잰다 (처음 LEAD초는 카메라가 자리를 잡는다).
type Act = { len: number; cast: Part[]; fx?: Fx[]; icons?: Icon[]; cues?: Cue[]; pos: V; look: V; follow?: number };
type Shot = { t0: number; pos: V; look: V; follow: number; base: V | null };
// sum부터는 건너뛰기로 넘어갈 수 있는 끝부분이고, 배우들은 sum + hold까지 보인다. beats는 화면 아래 글이 바뀌는 때, marks는 죽음이 드러나는 때.
type Script = { cast: Part[]; fx: Fx[]; icons: Icon[]; cues: Cue[]; shots: Shot[]; beats: number[]; marks: { t: number; id: string }[]; shakes?: number[]; sum: number; hold: number; total: number };

const LEAD = 0.9; // 카메라가 자리를 잡는 시간
const SUM = 2; // 본 것을 정리해 보여 주는 시간
const OUT = 0.8; // 카메라가 돌아오는 시간
const PACE = 3.2; // 살금살금 걷는 속도
const MOST = 8.5; // 장면이 여럿이면 뒤의 것을 줄여 장면들을 이 시간 안에 (정리까지 12초쯤)
const UP = new THREE.Vector3(0, 1, 0);
const angle = (v: V) => Math.atan2(v.x, v.z);
const turnTo = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from)); // 가까운 쪽으로 도는 각
const smooth = (x: number) => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * (3 - 2 * u);
};

function write(flash: Flash, seats: Seat[], spots: Spot[], sizes: number[], heights: number[], doors: number[]): Script | null {
  const index = (id: string) => seats.findIndex((s) => s.id === id);
  const part = (i: number, segs: Seg[]): Part => ({ seat: { ...seats[i], alive: true, won: false, done: false }, color: COLORS[i % COLORS.length], segs });
  const shade = (segs: Seg[]): Part => ({ seat: null, color: "", segs });
  const out = (i: number) => spots[i].house.clone().normalize(); // 광장에서 집 쪽
  const side = (i: number) => new THREE.Vector3(out(i).z, 0, -out(i).x);
  const sill = (i: number) => spots[i].house.clone().addScaledVector(out(i), -sizes[i] * 0.6); // 문턱
  const step = (i: number) => spots[i].house.clone().addScaledVector(out(i), -sizes[i] - 0.5); // 문 앞
  const wall = (i: number) => spots[i].house.clone().addScaledVector(side(i), sizes[i] + 0.45); // 옆벽에 붙은 자리
  const far = (i: number, sign = 1, reach = 6) => step(i).applyAxisAngle(UP, (sign * reach) / step(i).length()); // 광장을 끼고 문 앞으로 오는 길의 시작
  const walk = (a: V, b: V) => (Math.abs(turnTo(angle(a), angle(b))) * b.length()) / PACE;
  const fx = (i: number, kind: string, t0: number, t1: number): Fx => ({ t0, t1, at: spots[i].house, rot: spots[i].angle + Math.PI, kind, h: heights[i], door: doors[i] });
  // 집 모퉁이 뒤에 숨어 문 앞을 어깨 너머로 본다
  const behind = (i: number) => ({
    hide: spots[i].house.clone().addScaledVector(side(i), sizes[i] + 0.8).addScaledVector(out(i), 0.9),
    pos: spots[i].house.clone().addScaledVector(out(i), 3.4).addScaledVector(side(i), sizes[i] + 5.2).setY(2.7),
    look: step(i).addScaledVector(side(i), 0.4).setY(0.7),
  });
  // 광장 쪽에서 문 앞을 본다
  const front = (i: number) => ({
    pos: spots[i].house.clone().addScaledVector(out(i), -sizes[i] - 3.8).addScaledVector(side(i), 4.4).setY(2.4),
    look: step(i).addScaledVector(out(i), 0.6).setY(0.9),
  });
  // 옆에서 벽과 지붕 위를 본다
  const beside = (i: number) => ({
    pos: spots[i].house.clone().addScaledVector(side(i), sizes[i] + 6.5).addScaledVector(out(i), -1.2).setY(2.6),
    look: spots[i].house.clone().setY(3.1), // 지붕 위로 떠오르는 패까지 화면에 들어오게
  });
  const me = seats.findIndex((s) => s.isMe);
  if (me < 0) return null;
  const pop = (i: number, t: number, at = sill(i)): Seg => ({ t0: t, t1: t + 0.35, a: at, b: at, clip: "idle", s0: 0, face: step(i).multiplyScalar(0.6) }); // 문에서 나타난다
  // 그림자가 광장을 끼고 문 앞까지 온다. 도착하는 때를 돌려준다.
  const creep = (i: number, t: number, segs: Seg[], sign = -1, reach = 5) => {
    const t1 = t + walk(far(i, sign, reach), step(i));
    segs.push({ t0: t, t1, a: far(i, sign, reach), b: step(i), clip: "sneak", round: true });
    return t1;
  };
  const flee = (i: number, t: number, sign = -1): Seg => ({ t0: t, t1: t + 0.7, a: step(i), b: far(i, sign, 4), clip: "walk", round: true, s1: 0.4 });

  function act(scene: Scene): Act | null {
    const L = LEAD;
    switch (scene.kind) {
      case "lookout": {
        const h = index(scene.house);
        if (h < 0) return null;
        const { hide, pos, look } = behind(h);
        const cues: Cue[] = [];
        let end = L + 2.4;
        const cast = scene.visitors.flatMap((id, k) => {
          const v = index(id);
          if (v < 0) return [];
          // 자기 집 쪽에서 오되, 멀리서부터 걸어오느라 지루하지 않게 마지막 몇 걸음만 보여 준다
          const sweep = turnTo(angle(step(h)), angle(spots[v].house));
          const start = far(h, Math.sign(sweep), Math.min(Math.abs(sweep) * step(h).length(), 6.5));
          const t0 = L + 0.2 + k * 1.3;
          const t1 = t0 + walk(start, step(h));
          cues.push({ t: t1 + 0.15, name: "knock" });
          end = Math.max(end, t1 + 1.4);
          return [
            part(v, [
              { t0, t1, a: start, b: step(h), clip: "sneak", round: true },
              { t0: t1, t1: t1 + 0.9, a: step(h), b: step(h), clip: "knock", face: spots[h].house },
              { t0: t1 + 0.9, t1: t1 + 1.4, a: step(h), b: sill(h), clip: "walk", s1: 0 },
            ]),
          ];
        });
        const len = end + 0.3;
        // 아무도 안 오면 두리번거린다
        const watch: Seg[] = cast.length
          ? [{ t0: 0, t1: len, a: hide, b: hide, clip: "peek", face: step(h) }]
          : [
              { t0: 0, t1: L + 1.2, a: hide, b: hide, clip: "peek", face: step(h) },
              { t0: L + 1.2, t1: len, a: hide, b: hide, clip: "turn", face: step(h) },
            ];
        cues.push({ t: L, name: "lookout" });
        return { len, cast: [part(me, watch), ...cast], cues, pos, look };
      }
      case "tracker": {
        const w = index(scene.who);
        if (w < 0) return null;
        const { hide, pos, look } = behind(w);
        pos.add(pos.clone().sub(look).setY(0).multiplyScalar(0.35)).setY(6.5); // 따라다니려면 나무에 가리지 않게 더 높고 멀리서
        const segs: Seg[] = [];
        const cues: Cue[] = [];
        let t = L + 0.3;
        let at = step(w);
        if (scene.out) {
          segs.push({ t0: t, t1: t + 0.5, a: sill(w), b: at, clip: "walk", s0: 0 });
          t += 0.5;
          const stops = scene.went.map(index).filter((i) => i >= 0);
          for (const i of stops) {
            const to = step(i);
            const t1 = t + Math.min(2.2, Math.max(0.8, at.distanceTo(to) / PACE));
            segs.push({ t0: t, t1, a: at, b: to, clip: "sneak", round: true }, { t0: t1, t1: t1 + 0.9, a: to, b: to, clip: "knock", face: spots[i].house });
            cues.push({ t: t1 + 0.15, name: "knock" });
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
        } else t += 2.2; // 나오지 않았다: 불 켜진 집만 조용히
        const len = t + 0.4;
        if (segs.length) segs.push({ t0: t, t1: len, a: at, b: at, clip: "idle" });
        const cast = [part(me, [{ t0: 0, t1: len, a: hide, b: hide, clip: "peek", face: step(w) }])];
        if (segs.length) cast.push(part(w, segs));
        cues.push({ t: L, name: "tracker" });
        return { len, cast, cues, pos, look, follow: segs.length ? 1 : undefined };
      }
      case "blocker": {
        // 내가 문 앞을 막아선다. 대상이 나오려 했으면 문에서 나를 보고 멈칫했다 들어간다.
        const w = index(scene.who);
        if (w < 0) return null;
        const post = step(w).addScaledVector(side(w), -0.9); // 카메라가 문을 가리지 않는 쪽
        const len = L + (scene.tried ? 3 : 2.4);
        const cast = [part(me, [{ t0: 0, t1: len, a: post, b: post, clip: "idle", face: sill(w) }])];
        if (scene.tried)
          cast.push(
            part(w, [
              pop(w, L + 0.7),
              { t0: L + 1.05, t1: L + 2, a: sill(w), b: sill(w), clip: "startle", face: post },
              { t0: L + 2, t1: L + 2.4, a: sill(w), b: sill(w), clip: "idle", s1: 0, face: post },
            ]),
          );
        return { len, cast, fx: [fx(w, "blocker", 0.3, len)], cues: [{ t: 0.3, name: "blocker" }, ...(scene.tried ? [{ t: L + 0.7, name: "door" as Sfx }] : [])], ...front(w) };
      }
      case "trapper": {
        // 내가 문 앞에 덫을 놓고 모퉁이로 물러난다. 걸렸으면 그림자 하나가 다가오다 펄쩍 뛰어 달아난다.
        const h = index(scene.house);
        if (h < 0) return null;
        const set = step(h).addScaledVector(side(h), -0.8);
        const hide = spots[h].house.clone().addScaledVector(side(h), -sizes[h] - 1).addScaledVector(out(h), -0.6);
        const mine: Seg[] = [
          { t0: 0, t1: L + 0.9, a: set, b: set, clip: "cast", face: step(h) },
          { t0: L + 0.9, t1: L + 1.5, a: set, b: hide, clip: "sneak" },
        ];
        const cast = [part(me, mine)];
        const cues: Cue[] = [{ t: L + 0.4, name: "trapper" }];
        let snap: number | undefined;
        let len = L + 3.2;
        if (scene.caught) {
          const segs: Seg[] = [];
          const t = creep(h, L + 1.5, segs);
          segs.push({ t0: t, t1: t + 0.7, a: step(h), b: step(h), clip: "startle", face: spots[h].house }, flee(h, t + 0.7));
          cast.push(shade(segs));
          snap = t; // 닫히는 소리와 흔들림은 덫이 스스로 낸다
          len = t + 1.6;
        }
        mine.push({ t0: L + 1.5, t1: len, a: hide, b: hide, clip: "peek", face: step(h) });
        return { len, cast, fx: [{ ...fx(h, "trap", L + 0.5, len), snap }], cues, ...front(h) };
      }
      case "investigator":
      case "snitch": {
        // 옆벽에 붙어 들여다본다(엿듣는다). 알아낸 역할 패가 지붕 위로 떠오른다.
        const w = index(scene.who);
        if (w < 0) return null;
        const len = L + 3.3;
        const top = (shift: number) => spots[w].house.clone().addScaledVector(out(w), shift).setY(4.5);
        const found = scene.kind === "investigator" ? scene.options.map((o) => o.role) : scene.role ? [scene.role] : [];
        const icons = found.map((role, k): Icon => ({ t0: L + 1.1, t1: len, at: top((k - (found.length - 1) / 2) * 1.5), role }));
        return {
          len,
          cast: [part(me, [{ t0: 0, t1: len, a: wall(w), b: wall(w), clip: "peek", face: spots[w].house }])],
          fx: [fx(w, scene.kind, L + 0.3, len)],
          icons,
          cues: [{ t: L + 0.3, name: scene.kind }],
          ...beside(w),
        };
      }
      case "doctor": {
        // 내가 집 안으로 들어가 지킨다. 살렸으면 그림자가 문 앞까지 왔다가 방패 빛에 놀라 물러난다.
        const w = index(scene.who);
        if (w < 0) return null;
        const cast = [
          part(me, [
            { t0: 0, t1: L + 0.3, a: step(w), b: step(w), clip: "idle", face: spots[w].house },
            { t0: L + 0.3, t1: L + 0.8, a: step(w), b: sill(w), clip: "walk", s1: 0 },
          ]),
        ];
        const effects = [fx(w, "doctor", L + 0.8, 1e9)];
        const cues: Cue[] = [
          { t: L + 0.3, name: "door" },
          { t: L + 0.9, name: "doctor" },
        ];
        let len = L + 2.8;
        if (scene.saved) {
          const segs: Seg[] = [];
          const t = creep(w, L + 1.1, segs);
          segs.push({ t0: t, t1: t + 0.7, a: step(w), b: step(w), clip: "startle", face: spots[w].house }, flee(w, t + 0.7));
          cast.push(shade(segs));
          effects.push({ t0: t - 0.1, t1: t + 1.1, at: step(w), rot: 0, kind: "shield" });
          cues.push({ t, name: "kill" });
          len = t + 1.6;
        }
        effects[0].t1 = len;
        return { len, cast, fx: effects, cues, ...front(w) };
      }
      case "thief": {
        // 살금살금 들어갔다 나온다. 훔쳤으면 역할 패가 내 머리 위로 떠오른다.
        const w = index(scene.who);
        if (w < 0) return null;
        const segs: Seg[] = [];
        const t = creep(w, L, segs, 1, 4);
        const back = t + 1.3;
        const len = back + 1.9;
        segs.push(
          { t0: t, t1: t + 0.4, a: step(w), b: sill(w), clip: "sneak", s1: 0 },
          { t0: back, t1: back + 0.4, a: sill(w), b: step(w), clip: "sneak", s0: 0 },
          { t0: back + 0.4, t1: len, a: step(w), b: step(w), clip: scene.stolen ? "cheer" : "sad", face: step(w).multiplyScalar(0.5) },
        );
        return {
          len,
          cast: [part(me, segs)],
          fx: [fx(w, "thief", t + 0.3, back + 0.2)],
          icons: scene.stolen ? [{ t0: back + 0.5, t1: len, at: step(w).setY(2.1), role: scene.stolen.role }] : [],
          cues: [
            { t, name: "door" },
            { t: t + 0.5, name: "thief" },
          ],
          ...front(w),
        };
      }
      case "blocked": {
        // 내 집 앞을 누군가 막고 있다. 나가려다 멈칫한다.
        const len = L + 2.6;
        const post = step(me).addScaledVector(side(me), -0.9);
        return {
          len,
          cast: [
            shade([{ t0: 0, t1: len, a: post, b: post, clip: "idle", face: sill(me) }]),
            part(me, [pop(me, L + 0.5), { t0: L + 0.85, t1: L + 1.7, a: sill(me), b: sill(me), clip: "startle", face: post }, { t0: L + 1.7, t1: len, a: sill(me), b: sill(me), clip: "sad", face: post }]),
          ],
          fx: [fx(me, "blocker", 0.3, len)],
          cues: [
            { t: 0.3, name: "blocker" },
            { t: L + 0.5, name: "door" },
          ],
          ...front(me),
        };
      }
      case "raided": {
        // 누군가 내 집에 들이닥쳤다
        const segs: Seg[] = [];
        const t = creep(me, L, segs, -1, 3);
        const len = t + 2;
        segs.push({ t0: t, t1: len, a: step(me), b: step(me), clip: "idle", face: sill(me) });
        return {
          len,
          cast: [shade(segs), part(me, [pop(me, t + 0.2), { t0: t + 0.55, t1: len, a: sill(me), b: sill(me), clip: "startle", face: step(me) }])],
          fx: [fx(me, "kill", t, len)],
          cues: [
            { t: t - 0.1, name: "door" },
            { t: t + 0.2, name: "kill" },
          ],
          ...front(me),
        };
      }
      case "healed": {
        // 누군가 내 집에 들어와 돌봐 주고 갔다
        const segs: Seg[] = [];
        const t = creep(me, L, segs, 1, 3);
        segs.push({ t0: t, t1: t + 0.4, a: step(me), b: sill(me), clip: "walk", s1: 0 });
        const len = t + 2.6;
        return {
          len,
          cast: [shade(segs), part(me, [pop(me, t + 1.2, step(me)), { t0: t + 1.55, t1: len, a: step(me), b: step(me), clip: "cheer", face: step(me).multiplyScalar(0.5) }])],
          fx: [fx(me, "doctor", t + 0.4, len)],
          cues: [
            { t, name: "door" },
            { t: t + 0.5, name: "doctor" },
          ],
          ...front(me),
        };
      }
      case "provoked": {
        // 누군가 내 집 앞에서 확성기로 떠들었다
        const len = L + 2.9;
        return {
          len,
          cast: [
            shade([{ t0: 0, t1: len, a: step(me), b: step(me), clip: "cast", face: sill(me) }]),
            part(me, [pop(me, L + 0.9), { t0: L + 1.25, t1: L + 2, a: sill(me), b: sill(me), clip: "startle", face: step(me) }, { t0: L + 2, t1: len, a: sill(me), b: sill(me), clip: "sad", face: step(me) }]),
          ],
          fx: [fx(me, "provoker", L + 0.2, len)],
          cues: [{ t: L + 0.2, name: "provoker" }],
          ...front(me),
        };
      }
      case "trapped": {
        // 어느 집 앞이었는지는 알 수 없으므로, 집이 보이지 않게 마을 밖을 등지고 가까이서 잡는다
        const way = new THREE.Vector3(0, 0, 1).applyAxisAngle(UP, spots[me].angle + Math.PI / seats.length);
        const at = way.clone().multiplyScalar(step(me).length() + 1.2);
        const from = way.clone().multiplyScalar(step(me).length() - 1.4);
        const len = L + 2.9;
        return {
          len,
          cast: [
            part(me, [
              { t0: L, t1: L + 0.8, a: from, b: at, clip: "sneak" },
              { t0: L + 0.8, t1: L + 1.6, a: at, b: at, clip: "startle", face: from },
              { t0: L + 1.6, t1: len, a: at, b: at, clip: "sad", face: from },
            ]),
          ],
          fx: [{ t0: 0, t1: len, at: at.clone().add(new THREE.Vector3(0, 0, -2.05)), rot: 0, kind: "trap", armed: true, snap: L + 0.8 }], // 덫 그림은 기준점에서 2.05 앞에 놓여 있다. 닫히는 소리는 덫이 낸다.
          pos: way.clone().multiplyScalar(step(me).length() - 3.4).setY(1.5),
          look: at.clone().setY(0.6),
        };
      }
    }
  }

  const acts = flash.map(act).filter((a) => a !== null);
  if (!acts.length) return null;
  // 뒤의 장면들을 줄여 전체 길이를 맞춘다
  const rest = acts.slice(1).reduce((sum, a) => sum + a.len, 0);
  const quick = rest > 0 ? Math.min(1, Math.max(0.55, (MOST - acts[0].len) / rest)) : 1;
  const script: Script = { cast: [], fx: [], icons: [], cues: [], shots: [], beats: [], marks: [], sum: 0, hold: 0, total: 0 };
  let off = 0;
  acts.forEach((a, n) => {
    const k = n ? quick : 1;
    const last = n === acts.length - 1;
    const at = (t: number) => (last && t >= a.len ? 1e9 : off + Math.min(t, a.len) * k); // 마지막 장면의 사람들은 정리가 끝날 때까지 남는다
    const base = a.follow === undefined ? null : a.cast[a.follow].segs[0].b;
    script.shots.push({ t0: off, pos: a.pos, look: a.look, follow: a.follow === undefined ? -1 : script.cast.length + a.follow, base });
    script.cast.push(...a.cast.map((p) => ({ ...p, segs: p.segs.map((s) => ({ ...s, t0: at(s.t0), t1: at(s.t1) })) })));
    script.fx.push(...(a.fx ?? []).map((f) => ({ ...f, t0: at(f.t0), t1: at(f.t1) })));
    script.icons.push(...(a.icons ?? []).map((i) => ({ ...i, t0: at(i.t0), t1: at(i.t1) })));
    script.cues.push(...(a.cues ?? []).map((c) => ({ ...c, t: off + c.t * k })));
    off += a.len * k;
  });
  script.cues.sort((a, b) => a.t - b.t);
  script.sum = off + 0.2;
  script.hold = SUM + (acts.length - 1) * 0.6;
  script.total = script.sum + script.hold + OUT;
  script.beats = [script.sum];
  return script;
}

const GATHER = 2.6; // 문에서 나와 광장에 모이는 시간
const CALL = 12; // 아침 발표는 사건이 많아도 이 안에 끝낸다
const ZERO = new THREE.Vector3();

// 아침 발표: 모두 문에서 나와 모닥불 가에 모이고, 밤사이 모두에게 공개된 일을 서버가 준 순서대로 하나씩 본다.
// 죽음은 폭발이 아니면 전부 같은 모습(문에서 나오다 쓰러짐)이다. 어떻게 죽었는지, 누가 했는지는 알 수 없다.
function announce(events: Dawn[], seats: Seat[], spots: Spot[], sizes: number[]): Script {
  const index = (id: string) => seats.findIndex((s) => s.id === id);
  const out = (i: number) => spots[i].house.clone().normalize();
  const side = (i: number) => new THREE.Vector3(out(i).z, 0, -out(i).x);
  const sill = (i: number) => spots[i].house.clone().addScaledVector(out(i), -sizes[i] * 0.6);
  const step = (i: number) => spots[i].house.clone().addScaledVector(out(i), -sizes[i] - 0.5);
  const part = (i: number, segs: Seg[]): Part => ({ seat: { ...seats[i], alive: true, won: false, done: false }, color: COLORS[i % COLORS.length], segs });
  const raw = events.map((e) => (e.kind === "death" ? 3.2 : 3));
  const all = raw.reduce((sum, x) => sum + x, 0);
  const k = all ? Math.min(1, Math.max(0.4, (CALL - GATHER - OUT - 0.4) / all)) : 1;
  const end = GATHER + (all ? all * k : 2); // 아무 일 없던 밤은 잠깐 둘러보고 끝낸다
  const script: Script = { cast: [], fx: [], icons: [], cues: [], shots: [], beats: [], marks: [], sum: end, hold: OUT, total: end + OUT };
  const me = Math.max(0, seats.findIndex((s) => s.isMe));
  script.shots.push({ t0: 0, pos: out(me).multiplyScalar(9).setY(7), look: new THREE.Vector3(0, 0.6, 0), follow: -1, base: null });

  // 살아 있는 사람들: 문에서 나와 광장의 제자리로
  const crowd = seats.map((_, i) => i).filter((i) => seats[i].alive);
  const lines = new Map<number, Seg[]>();
  for (const i of crowd) {
    const wait = (i * 0.37) % 0.45;
    lines.set(i, [
      { t0: wait, t1: wait + 0.35, a: sill(i), b: sill(i), clip: "idle", s0: 0.3, face: spots[i].plaza },
      { t0: wait + 0.35, t1: GATHER - 0.2, a: sill(i), b: spots[i].plaza, clip: "walk" },
    ]);
  }
  const stand = (i: number, t0: number, t1: number, clip: string, face: V, at = spots[i].plaza) => lines.get(i)?.push({ t0, t1, a: at, b: at, clip, face });
  let t = GATHER - 0.2;
  const wait = (to: number) => {
    for (const i of crowd) stand(i, t, to, "idle", ZERO);
    t = to;
  };

  events.forEach((e, n) => {
    wait(GATHER + raw.slice(0, n).reduce((sum, x) => sum + x, 0) * k);
    const len = raw[n] * k;
    script.beats.push(t);
    if (e.kind === "death") {
      const h = index(e.who);
      if (h < 0) return;
      script.shots.push({ t0: t, pos: out(h).multiplyScalar(-2.4).addScaledVector(side(h), 5.6).setY(4.6), look: step(h).multiplyScalar(0.72).setY(0.6), follow: -1, base: null });
      const fall = t + (e.blast ? 0.6 : 1.3) * k; // 모두가 알아차리는 때
      if (e.blast) {
        script.fx.push({ t0: fall, t1: fall + 2.4, at: spots[h].house, rot: 0, kind: "burst" }); // 소리와 흔들림은 폭발이 스스로 낸다
      } else {
        script.cast.push(
          part(h, [
            { t0: t + 0.3 * k, t1: t + 0.65 * k, a: sill(h), b: sill(h), clip: "idle", s0: 0.3, face: step(h) },
            { t0: t + 0.65 * k, t1: fall, a: sill(h), b: step(h), clip: "walk" },
            { t0: fall, t1: t + len, a: step(h), b: step(h), clip: "die" },
          ]),
        );
        script.cues.push({ t: fall + 0.2, name: "death" });
      }
      script.marks.push({ t: fall + 0.9 * k, id: e.who });
      for (const i of crowd) {
        stand(i, t, fall, "idle", spots[h].house);
        stand(i, fall, fall + 0.8 * k, "startle", spots[h].house);
        stand(i, fall + 0.8 * k, t + len, "sad", spots[h].house);
      }
    } else {
      // 밀고자가 한 걸음 나와 대상을 가리킨다. 알아낸 역할은 모두에게 공개되지 않으므로 띄우지 않는다.
      const by = index(e.by);
      const who = index(e.who);
      const point = t + 1 * k;
      const seen = crowd.includes(who) ? spots[who].plaza : who >= 0 ? spots[who].house : ZERO;
      const from = crowd.includes(by) ? spots[by].plaza : out(me).multiplyScalar(3);
      script.shots.push({ t0: t, pos: from.clone().multiplyScalar(2.4).addScaledVector(new THREE.Vector3(from.z, 0, -from.x).normalize(), 1.8).setY(2.7), look: seen.clone().setY(0.9), follow: -1, base: null });
      script.cues.push({ t: point, name: "snitch" });
      for (const i of crowd) {
        if (i === by) {
          const fore = spots[i].plaza.clone().multiplyScalar(0.8);
          lines.get(i)!.push({ t0: t, t1: t + 0.6 * k, a: spots[i].plaza, b: fore, clip: "walk" });
          stand(i, t + 0.6 * k, t + len, "vote", seen, fore);
        } else if (i === who) {
          stand(i, t, point, "idle", from);
          stand(i, point, point + 0.8 * k, "startle", from);
          stand(i, point + 0.8 * k, t + len, "sad", from);
        } else {
          stand(i, t, point, "idle", from);
          stand(i, point, t + len, "idle", seen);
        }
      }
    }
    t += len;
  });
  if (!events.length) script.beats.push(GATHER); // "조용한 밤" 한 줄
  wait(end);
  for (const i of crowd) stand(i, end, 1e9, "idle", ZERO);
  for (const i of crowd) script.cast.push(part(i, lines.get(i)!));
  script.cues.sort((a, b) => a.t - b.t);
  script.marks.sort((a, b) => a.t - b.t);
  return script;
}

// 공개된 정체 글("의사(시민)", "알 수 없음" 등)에서 역할과 편을 읽는다. 역할 이름이 아니면 null.
function known(reveal: string): { role: Role; team: Team | null } | null {
  const m = reveal.match(/^(.+)\((.+)\)$/);
  const role = m && (Object.keys(ROLES) as Role[]).find((r) => ROLES[r].name === m[1]);
  const team = m && (Object.keys(TEAM_NAME) as Team[]).find((t) => TEAM_NAME[t] === m[2]);
  return role ? { role, team: team ?? null } : null;
}
const sound = (name: string, or: Sfx): Sfx => (SFX.includes(name as Sfx) ? (name as Sfx) : or); // 아직 없는 소리는 있는 것으로

// 추방: 풍선이 하나씩 달려 부풀고, 둥실 떠올라 하늘로 사라진 뒤, 묘비가 떨어져 그 사람 집 앞에 박힌다.
function banish(exile: Exile, seats: Seat[], spots: Spot[], sizes: number[]): Script | null {
  const w = seats.findIndex((s) => s.id === exile.who);
  if (w < 0) return null;
  const out = spots[w].house.clone().normalize();
  const side = new THREE.Vector3(out.z, 0, -out.x);
  const at = spots[w].plaza;
  // 집이 묘비를 세우는 바로 그 자리 (끝나면 집의 묘비가 이어받는다)
  const tomb = new THREE.Vector3(1.75, 0, 1.9).applyAxisAngle(UP, spots[w].angle + Math.PI).add(spots[w].house);
  const yaw = spots[w].angle + Math.PI + 0.3; // 집이 세우는 묘비와 같은 방향
  const T = { tie: 0.9, lift: 2.1, gone: 3.5, drop: 4.2, land: 4.5, end: 5.9 };
  const part = (i: number, segs: Seg[]): Part => ({ seat: { ...seats[i], alive: true, won: false, done: false }, color: COLORS[i % COLORS.length], segs });
  const script: Script = { cast: [], fx: [], icons: [], cues: [], shots: [], beats: [T.land], marks: [{ t: T.end - 0.05, id: exile.who }], shakes: [T.land], sum: T.end, hold: 0, total: T.end + 0.5 };
  // 나머지는 둥글게 물러서서 올려다보고 손을 든다
  seats.forEach((seat, i) => {
    if (i === w || !seat.alive) return;
    const back = spots[i].plaza.clone().multiplyScalar(1.4);
    script.cast.push(
      part(i, [
        { t0: 0, t1: 0.3, a: spots[i].plaza, b: spots[i].plaza, clip: "idle", face: at },
        { t0: 0.3, t1: T.tie, a: spots[i].plaza, b: back, clip: "walk", face: at },
        { t0: T.tie, t1: T.lift + 0.3, a: back, b: back, clip: "idle", face: at },
        { t0: T.lift + 0.3, t1: T.gone + 0.4, a: back, b: back, clip: "vote", face: at },
        { t0: T.gone + 0.4, t1: T.land, a: back, b: back, clip: "idle", face: tomb },
        { t0: T.land, t1: 1e9, a: back, b: back, clip: "startle", face: tomb },
      ]),
    );
  });
  script.cast.push({
    ...part(w, [
      { t0: 0, t1: T.tie, a: at, b: at, clip: "idle", face: at.clone().multiplyScalar(2) },
      { t0: T.tie, t1: T.lift, a: at, b: at, clip: "startle", face: at.clone().multiplyScalar(2) },
      { t0: T.lift, t1: T.gone, a: at, b: at, clip: "walk", face: at.clone().multiplyScalar(2), up: [0, 11], sway: true }, // 허공에서 버둥거린다
    ]),
    balloons: T.tie,
    rise: T.lift,
  });
  script.cast.push({
    seat: null,
    color: "",
    prop: "grave",
    tip: { at: T.land + 0.36, by: lean(exile.who) }, // 집의 묘비와 같은 기울기로 멈춘다
    segs: [
      { t0: T.drop, t1: T.land, a: tomb, b: tomb, clip: "", up: [14, 0], yaw },
      { t0: T.land, t1: T.land + 0.18, a: tomb, b: tomb, clip: "", up: [0, 0.35], yaw },
      { t0: T.land + 0.18, t1: T.land + 0.36, a: tomb, b: tomb, clip: "", up: [0.35, 0], yaw },
      { t0: T.land + 0.36, t1: T.end, a: tomb, b: tomb, clip: "", yaw },
    ],
  });
  // 풍선 하나가 뒤늦게 팔랑팔랑 내려온다
  const stray = tomb.clone().addScaledVector(side, 0.7);
  script.cast.push({ seat: null, color: "", prop: "balloon", segs: [{ t0: T.land + 0.1, t1: T.end, a: stray, b: stray, clip: "", up: [6, 0.5], sway: true, yaw }] });
  script.fx.push({ t0: T.land, t1: T.land + 0.7, at: tomb, rot: 0, kind: "dust" });
  const role = known(exile.reveal);
  if (role) script.icons.push({ t0: T.land + 0.4, t1: T.end, at: tomb.clone().setY(2.2), role: role.role });
  for (const k of [0, 1, 2]) script.cues.push({ t: T.tie + k * 0.32, name: sound("balloon", "click") });
  script.cues.push({ t: T.lift, name: sound("whoosh", "exile") }, { t: T.drop, name: sound("whoosh", "exile") }, { t: T.land, name: sound("thud", "exile") });
  const near = at.clone().multiplyScalar(2.7).addScaledVector(new THREE.Vector3(at.z, 0, -at.x).normalize(), 1.6).setY(2.4);
  script.shots.push(
    { t0: 0, pos: near, look: at.clone().setY(1), follow: -1, base: null },
    { t0: T.lift, pos: near.clone().setY(1.6), look: at.clone().setY(6.5), follow: -1, base: null }, // 올려다본다
    { t0: T.gone - 0.2, pos: spots[w].house.clone().addScaledVector(out, -sizes[w] - 5).addScaledVector(side, 3.4).setY(2.8), look: tomb.clone().setY(0.7), follow: -1, base: null },
  );
  return script;
}

type Props = {
  flash?: Flash | null; // 내 회상
  call?: Dawn[] | null; // 아침 발표
  exile?: Exile | null; // 추방
  seats: Seat[];
  spots: Spot[];
  sizes: number[]; // 집마다의 반경
  heights: number[]; // 집마다의 지붕 높이
  doors: number[]; // 집마다 문의 앞뒤 위치
  land: Plan;
  calm: boolean; // 모션 줄이기: 장면 없이 정리만 보여 준다
  controls: RefObject<OrbitControls | null>;
  onBeat: (n: number) => void; // 화면 아래 글이 n번째로 넘어간다 (회상은 정리 줄 하나뿐)
  onMark?: (id: string) => void; // 이 사람의 죽음이 방금 드러났다
  onEnd: () => void;
};

const eye = new THREE.Vector3();
const aim = new THREE.Vector3();
const here = new THREE.Vector3();
const DARK = new THREE.Color("#17131c");

// 묘비가 박힐 때 퍼지는 먼지 고리
function Dust() {
  const ref = useRef<THREE.Mesh>(null);
  const age = useRef(0);
  useFrame((_, dt) => {
    age.current += dt;
    const u = Math.min(1, age.current / 0.6);
    ref.current?.scale.setScalar(0.4 + u * 2.2);
    if (ref.current) (ref.current.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - u);
  });
  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2} position-y={0.06}>
      <ringGeometry args={[0.55, 0.8, 24]} />
      <meshBasicMaterial color="#e9dcc0" transparent depthWrite={false} />
    </mesh>
  );
}

function Balloon({ color }: { color: string }) {
  return (
    <group scale={[1, 1.18, 1]}>
      <mesh>
        <sphereGeometry args={[0.34, 16, 12]} />
        <meshToonMaterial color={color} />
      </mesh>
      <mesh scale={1.09}>
        <sphereGeometry args={[0.34, 16, 12]} />
        <meshBasicMaterial color="#2b2118" side={THREE.BackSide} />
      </mesh>
      <mesh position={[0, -0.36, 0]}>
        <coneGeometry args={[0.06, 0.09, 6]} />
        <meshBasicMaterial color="#2b2118" />
      </mesh>
    </group>
  );
}

// 몸에 묶인 풍선 셋. from부터 하나씩 부풀어 오르고, rise부터는 떠오르는 힘에 끈이 휘며 출렁인다.
const BALLOONS = [
  { color: "#e5484d", x: -0.42, y: 2.25, z: 0 },
  { color: "#ffc53d", x: 0.05, y: 2.55, z: -0.1 },
  { color: "#3d8fd6", x: 0.46, y: 2.2, z: 0.05 },
];
const KNOT = 0.75; // 몸에 묶인 높이
const JOINTS = 6; // 끈의 마디 수
const THICK = 0.016;
// 끈은 십자로 겹친 리본 두 장이라 어느 쪽에서 봐도 굵기가 보인다. 마디마다 꼭짓점 넷.
const STRING_INDEX = Array.from({ length: JOINTS - 1 }, (_, j) => [0, 2].flatMap((o) => [j * 4 + o, j * 4 + o + 1, j * 4 + o + 4, j * 4 + o + 1, j * 4 + o + 5, j * 4 + o + 4])).flat();
function Balloons({ clock, from, rise }: { clock: RefObject<{ t: number }>; from: number; rise: number }) {
  const tops = useRef<(THREE.Group | null)[]>([]);
  const strings = useMemo(
    () =>
      BALLOONS.map(() => {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(JOINTS * 4 * 3), 3));
        g.setIndex(STRING_INDEX);
        return g;
      }),
    [],
  );
  useEffect(() => () => strings.forEach((g) => g.dispose()), [strings]);
  useFrame(() => {
    const t = clock.current.t;
    const pull = smooth((t - rise) / 0.5); // 떠오르는 힘
    BALLOONS.forEach((b, k) => {
      const top = tops.current[k];
      if (!top) return;
      const u = smooth((t - from - k * 0.32) / 0.28);
      top.visible = u > 0;
      top.scale.setScalar(Math.max(0.001, u * (1 + 0.12 * Math.sin(u * Math.PI)))); // 뽁 하고 살짝 넘쳤다 돌아온다
      // 풍선마다 따로 흔들리고 기운다. 떠오를 때는 위로 더 당겨지며 서로 벌어진다.
      const x = b.x * (1 + 0.25 * pull) + Math.sin(t * 2.3 + k * 1.7) * 0.07;
      const y = b.y + 0.18 * pull + Math.sin(t * 3.1 + k) * 0.04;
      const z = b.z + Math.cos(t * 1.9 + k * 2.3) * 0.07;
      top.position.set(x, y, z);
      top.rotation.z = -x * 0.35 + Math.sin(t * 2.4 + k * 2) * 0.12;
      top.rotation.x = Math.sin(t * 2 + k) * 0.1;
      // 끈: 묶인 곳에서 매듭까지. 가운데가 늘어졌다가 당겨지면 펴지고, 출렁임이 끝으로 번진다.
      const at = strings[k].attributes.position as THREE.BufferAttribute;
      const knot = y - 0.42 * top.scale.y;
      for (let j = 0; j < JOINTS; j++) {
        const s = j / (JOINTS - 1);
        const slack = Math.sin(s * Math.PI) * (0.16 * (1 - pull) + 0.05);
        const px = x * s + Math.sin(t * 6 - s * 4 + k) * slack * 0.6 + Math.sign(b.x || 1) * slack * 0.5;
        const py = (KNOT + (knot - KNOT) * s) * (u > 0 ? 1 : 0) - slack * 0.25;
        const pz = z * s + Math.cos(t * 5 - s * 3 + k) * slack * 0.4;
        at.setXYZ(j * 4, px - THICK, py, pz);
        at.setXYZ(j * 4 + 1, px + THICK, py, pz);
        at.setXYZ(j * 4 + 2, px, py, pz - THICK);
        at.setXYZ(j * 4 + 3, px, py, pz + THICK);
      }
      at.needsUpdate = true;
    });
  });
  return (
    <>
      {BALLOONS.map((b, k) => (
        <group key={b.color}>
          <mesh geometry={strings[k]} frustumCulled={false}>
            <meshBasicMaterial color="#2b2118" side={THREE.DoubleSide} />
          </mesh>
          <group
            visible={false}
            ref={(g) => {
              tops.current[k] = g;
            }}
          >
            <Balloon color={b.color} />
          </group>
        </group>
      ))}
    </>
  );
}

const within = (x: { t0: number; t1: number }, t: number) => t >= x.t0 && t < x.t1;

export function Replay({ flash, call, exile, seats, spots, sizes, heights, doors, land, calm, controls, onBeat, onMark, onEnd }: Props) {
  // 장면은 시작할 때의 마을 그대로 끝까지 간다
  const script = useMemo(() => (exile ? banish(exile, seats, spots, sizes) : call ? announce(call, seats, spots, sizes) : flash ? write(flash, seats, spots, sizes, heights, doors) : null), []); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useRef<(THREE.Group | null)[]>([]);
  const clips = useMemo(() => (script?.cast ?? []).map(() => ({ current: "idle" })), [script]);
  // 모션 줄이기면 장면 없이 글만: 회상은 정리부터, 발표는 3초 동안 전부 띄워 둔다
  const clock = useRef({ t: calm && script ? script.sum - (flash ? 0 : 3) : 0, beat: 0, mark: 0, over: false, cue: 0, shake: 0 });
  const shake = useShake();
  // 효과와 역할 패는 제때 태어나야 처음부터 재생된다. 지금 떠 있는 것들의 목록(덫은 닫혔는지까지)을 글로 들고 있다가 바뀔 때만 다시 그린다.
  const [live, setLive] = useState("");
  const home = useRef<{ pos: V; look: V } | null>(null);
  const track = useRef<V | null>(null);
  const done = useRef(onEnd);
  done.current = onEnd;
  const camera = useThree((three) => three.camera);

  useEffect(() => {
    if (!script) return done.current();
    if (flash || exile) {
      // 회상이 끝나야 새벽이, 추방이 끝나야 해 질 녘이 온다. 발표는 새벽과 함께 가므로 무대를 잡지 않는다.
      stage.hold((script.total - clock.current.t) * 1000);
    }
    if (flash) {
      // 낮에 다시 볼 때도 해가 천천히 지지 않고 바로 밤이다 (해 질 녘 연출은 이 장면이 끝나기를 기다리며 멈춰 있다)
      if (!calm) Object.assign(turn, { at: -Infinity, waiting: false, cast: false });
    }
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
      if (flash || exile) stage.release();
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
  }, [script, controls, camera, calm, flash, exile]);

  useFrame((state, dt) => {
    const c = clock.current;
    if (!script || c.over) return;
    c.t += dt;
    const t = c.t;
    for (; c.beat < script.beats.length && (calm || t >= script.beats[c.beat]); c.beat++) onBeat(c.beat);
    for (; c.mark < script.marks.length && (calm || t >= script.marks[c.mark].t); c.mark++) onMark?.(script.marks[c.mark].id);
    for (; c.shake < (script.shakes?.length ?? 0) && t >= script.shakes![c.shake]; c.shake++) if (!calm) shake(9, 0.3);
    const showing = calm || t >= script.sum + script.hold ? "" : [...script.fx, ...script.icons].map((x, i) => (within(x, t) ? `${i}${"snap" in x && x.snap !== undefined && t >= x.snap ? "!" : ""}` : "")).join(",");
    if (showing !== live) setLive(showing);
    for (; c.cue < script.cues.length && t >= script.cues[c.cue].t; c.cue++) {
      // 건너뛰어 지나친 소리는 내지 않는다
      if (!calm && t - script.cues[c.cue].t < 0.5) play(script.cues[c.cue].name, 0.7);
    }

    script.cast.forEach((part, i) => {
      const g = groups.current[i];
      if (!g) return;
      const seg = calm || t >= script.sum + script.hold ? undefined : part.segs.find((s) => within(s, t));
      g.visible = !!seg;
      if (!seg) return;
      const u = Math.min(1, (t - seg.t0) / (seg.t1 - seg.t0));
      const before = here.copy(g.position);
      if (seg.round) {
        const a0 = angle(seg.a);
        const turned = a0 + turnTo(a0, angle(seg.b)) * u;
        g.position.set(Math.sin(turned), 0, Math.cos(turned)).multiplyScalar(seg.a.length() + (seg.b.length() - seg.a.length()) * u);
      } else g.position.lerpVectors(seg.a, seg.b, u);
      g.position.y = lift(land, g.position.x, g.position.z) + (seg.up ? seg.up[0] + (seg.up[1] - seg.up[0]) * (seg.up[0] > seg.up[1] ? u * u : u) : 0); // 떨어질 때는 점점 빠르게
      if (seg.sway) g.position.x += Math.sin(t * 3.2) * 0.35 * u;
      g.scale.setScalar(Math.max(0.001, (seg.s0 ?? 1) + ((seg.s1 ?? 1) - (seg.s0 ?? 1)) * u));
      // 걷는 동안은 가는 쪽을 본다
      const dx = seg.face ? seg.face.x - g.position.x : seg.round ? g.position.x - before.x : seg.b.x - seg.a.x;
      const dz = seg.face ? seg.face.z - g.position.z : seg.round ? g.position.z - before.z : seg.b.z - seg.a.z;
      if (seg.yaw !== undefined) g.rotation.y = seg.yaw;
      else if (dx * dx + dz * dz > 1e-8 && (u > 0.02 || !seg.round)) g.rotation.y = Math.atan2(dx, dz);
      if (part.tip) {
        // 박힌 뒤 두어 번 건들거리다 한쪽으로 기운 채 멈춘다
        const since = (t - part.tip.at) / 0.9;
        g.rotation.z = since <= 0 ? 0 : part.tip.by * (1 - Math.exp(-4 * since) * Math.cos(since * Math.PI * 4));
      }
      clips[i].current = seg.clip;
    });

    const orbit = controls.current;
    if (calm || !orbit) {
      if (t >= script.total) end();
      return;
    }
    home.current ??= { pos: state.camera.position.clone(), look: orbit.target.clone() };
    orbit.enabled = false;
    // 지금 장면의 자리로. 앞 장면(처음이면 원래 자리)에서 넘어온다.
    const n = script.shots.findLastIndex((shot) => t >= shot.t0);
    const shot = script.shots[n];
    aim.copy(shot.look);
    eye.copy(shot.pos);
    // 따라가는 배우가 있으면 카메라가 같은 거리에서 뒤따른다
    const star = groups.current[shot.follow];
    if (star?.visible && shot.base) {
      track.current ??= star.position.clone();
      track.current.lerp(star.position, 1 - Math.exp(-dt * 3));
      here.copy(track.current).sub(shot.base).setY(0);
      aim.add(here);
      eye.add(here);
    }
    const from = n ? script.shots[n - 1] : { pos: home.current.pos, look: home.current.look };
    const u = smooth((t - shot.t0) / LEAD);
    eye.lerpVectors(from.pos, eye, u);
    aim.lerpVectors(from.look, aim, u);
    const back = smooth((t - (script.total - OUT)) / OUT);
    state.camera.position.lerpVectors(eye, home.current.pos, back);
    orbit.target.lerpVectors(aim, home.current.look, back);
    state.camera.lookAt(orbit.target);
    if (t >= script.total) end(); // 카메라는 이 장면이 내려갈 때 제자리로 돌아간다
  });
  function end() {
    clock.current.over = true;
    done.current();
  }

  return (
    <>
      {script?.cast.map((part, i) => (
        <group
          key={i}
          visible={false}
          ref={(g) => {
            groups.current[i] = g;
          }}
        >
          {part.balloons !== undefined && <Balloons clock={clock} from={part.balloons} rise={part.rise ?? 1e9} />}
          {part.prop === "balloon" ? (
            <Balloon color="#ffc53d" />
          ) : part.prop ? (
            <Suspense fallback={null}>
              <Model file={part.prop} />
            </Suspense>
          ) : part.seat ? (
            <Body seat={part.seat} color={part.color} clip={clips[i]} />
          ) : (
            // 누구인지 모르는 사람: 생김새도 색도 이름도 없는 검은 그림자
            <Suspense fallback={null}>
              <Model file="character-2" clip={clips[i]} paint={(_, m) => m.color.copy(DARK)} />
            </Suspense>
          )}
        </group>
      ))}
      {script?.fx.map((f, i) => {
        const on = live.split(",")[i];
        if (!on) return null;
        return (
          <group key={i} position={f.at} rotation-y={f.rot}>
            {f.kind === "burst" ? (
              <Burst />
            ) : f.kind === "dust" ? (
              <Dust />
            ) : f.kind === "shield" ? (
              <group scale={1.5}>
                <Shield />
              </group>
            ) : f.kind === "trap" ? (
              <group position-z={(f.door ?? 1.09) - 1.09}>
                <Trap stage={on.endsWith("!") ? "snap" : f.armed ? "armed" : undefined} />
              </group>
            ) : (
              <AbilityEffect kind={f.kind} h={f.h} door={f.door} />
            )}
          </group>
        );
      })}
      {script?.icons.map((icon, i) =>
        live.split(",")[script.fx.length + i] ? (
          <group key={i} position={icon.at}>
            <RoleIcon role={icon.role} y={0} size={1.15} />
          </group>
        ) : null,
      )}
    </>
  );
}

const SAID: Record<string, string> = { blocked: "문 앞이 막혔다", trapped: "덫에 걸렸다", raided: "습격당했다", healed: "의사가 다녀갔다", provoked: "누가 선동했다" };

// 화면 아래 글. 회상(flash)이면 "어젯밤" 딱지와 끝의 정리 줄들, 아침 발표(call)면 지금 보는 사건 한 줄.
// beat는 지금까지 넘어간 글의 번호(-1이면 아직 없음).
export function ReplayHud({ flash, call, exile, seats, beat, calm }: { flash: Flash | null; call: Call | null; exile?: Exile | null; seats: Seat[]; beat: number; calm: boolean }) {
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
  const tile = (role: Role, team: Team | null, key = 0) => (
    <span key={key} className="flash-who">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/roles/${role}.png`} alt="" width={34} height={34} />
      {ROLES[role].name}
      {team && <span className={`tag ${team}`}>{TEAM_NAME[team]}</span>}
    </span>
  );
  const to = (
    <b key="to" aria-hidden>
      →
    </b>
  );
  const line = (s: Scene) => {
    switch (s.kind) {
      case "lookout":
        return [s.visitors.length ? s.visitors.map(head) : <span key="x">아무도 안 옴</span>, to, head(s.house)];
      case "tracker":
        return [head(s.who), to, s.went.length ? s.went.map(head) : <span key="x">{s.out ? "들른 집 없음" : "안 나감"}</span>];
      case "blocker":
        return [head(s.who), <span key="x">{s.tried ? "나가려 했다" : "조용했다"}</span>];
      case "trapper":
        return [head(s.house), <span key="x">{s.caught ? "덫에 누가 걸렸다" : "덫은 그대로"}</span>];
      case "investigator":
        return [head(s.who), to, tile(s.options[0].role, s.options[0].team, 0), <span key="or">또는</span>, tile(s.options[1].role, s.options[1].team, 1)];
      case "snitch":
        return [head(s.who), to, s.role ? tile(s.role, s.team) : <span key="x">못 들었다</span>];
      case "doctor":
        return [head(s.who), <span key="x">{s.saved ? "지켜냈다" : "조용한 밤"}</span>];
      case "thief":
        return [head(s.who), to, s.stolen ? tile(s.stolen.role, s.stolen.team) : <span key="x">빈손</span>];
      default:
        return [<span key="x">{SAID[s.kind]}</span>];
    }
  };
  if (flash)
    return (
      <div className="flash dim" aria-live="polite">
        <p className="chip flash-tag">어젯밤</p>
        {beat >= 0 && (
          <ul className="paper flash-sum">
            {flash.map((s, i) => (
              <li key={i}>{line(s)}</li>
            ))}
          </ul>
        )}
      </div>
    );
  // 공개된 정체를 패로. 역할 이름이 아니면 글 그대로.
  const shown = (reveal: string) => {
    const found = known(reveal);
    return found ? tile(found.role, found.team) : <span key="x">{reveal}</span>;
  };
  if (exile)
    return (
      <div className="flash" aria-live="polite">
        {beat >= 0 && (
          <ul className="paper flash-sum">
            <li>
              {head(exile.who)}
              <span>추방</span>
              {shown(exile.reveal)}
            </li>
          </ul>
        )}
      </div>
    );
  if (!call) return null;
  const me = seats.find((s) => s.isMe)?.id;
  const told = (e: Dawn) => {
    if (e.kind === "death") return [head(e.who), <span key="d">{e.blast ? "집이 터졌다" : "쓰러졌다"}</span>, shown(e.reveal)];
    // 알아낸 역할은 밀고자 본인만 안다
    const mine = e.by === me ? call.mine.find((s) => s.kind === "snitch" && s.who === e.who) : undefined;
    return [head(e.by), to, head(e.who), mine?.kind === "snitch" && mine.role ? tile(mine.role, mine.team, 9) : null];
  };
  const now = calm ? call.events : call.events.slice(beat, beat + 1);
  return (
    <div className="flash" aria-live="polite">
      {beat >= 0 && (
        <ul className="paper flash-sum" key={calm ? "all" : beat}>
          {call.events.length ? now.map((e, i) => <li key={i}>{told(e)}</li>) : <li>조용한 밤</li>}
        </ul>
      )}
    </div>
  );
}
