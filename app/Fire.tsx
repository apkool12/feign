"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

const OUTLINE = "#2b2118";

const VERTEX = `
  uniform float uTime;
  uniform float uPhase;
  varying float vH;
  void main() {
    vec3 p = position;
    vH = p.y;
    float hold = smoothstep(0.08, 1.0, p.y);
    float sway = hold * p.y * p.y;
    p.x += (sin(uTime * 5.7 + p.y * 4.8 + uPhase) * 0.12 + sin(uTime * 2.4 + uPhase * 1.7) * 0.08) * sway;
    p.z += cos(uTime * 4.9 + p.y * 4.2 + uPhase * 1.4) * 0.1 * sway;
    p.y *= 1.0 + sin(uTime * 8.4 + uPhase) * 0.055 * hold;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;

const FRAGMENT = `
  uniform float uTime;
  uniform float uPhase;
  uniform vec3 uLow;
  uniform vec3 uHigh;
  varying float vH;
  void main() {
    float band = smoothstep(0.2, 0.92, vH + sin(uTime * 4.2 + uPhase) * 0.035);
    vec3 col = mix(uLow, uHigh, band);
    gl_FragColor = vec4(col, 0.98);
    #include <colorspace_fragment>
  }`;

type Vec3 = [number, number, number];
type StoneSpec = { position: Vec3; scale: Vec3; rotation: Vec3; color: string };
type LogSpec = { turn: number; tilt: number; y: number; length: number; radius: number; bark: string };
type SeatSpec = { position: Vec3; radius: number; height: number; bark: string };
type FlameSpec = { position: Vec3; scale: Vec3; low: string; high: string; phase: number; order: number };
type LickSpec = { x: number; z: number; drift: number; width: number; height: number; phase: number; low: string; high: string };
type SparkSpec = { angle: number; radius: number; speed: number; phase: number; height: number; wobble: number };

const STONES: StoneSpec[] = [
  { position: [0, 0.15, 0.84], scale: [0.3, 0.17, 0.24], rotation: [0.1, 0.4, -0.2], color: "#928d83" },
  { position: [0.55, 0.14, 0.64], scale: [0.27, 0.16, 0.31], rotation: [0.3, 1.5, 0.12], color: "#7f8178" },
  { position: [0.82, 0.16, 0.11], scale: [0.32, 0.18, 0.24], rotation: [0.4, 2.3, -0.1], color: "#a19a8a" },
  { position: [0.66, 0.15, -0.48], scale: [0.29, 0.17, 0.28], rotation: [-0.1, 0.9, 0.24], color: "#88877f" },
  { position: [0.24, 0.16, -0.82], scale: [0.33, 0.18, 0.25], rotation: [0.2, 2.8, 0.18], color: "#9b927f" },
  { position: [-0.33, 0.14, -0.78], scale: [0.25, 0.16, 0.31], rotation: [0.2, 3.6, -0.18], color: "#7d8079" },
  { position: [-0.73, 0.16, -0.34], scale: [0.31, 0.18, 0.25], rotation: [-0.28, 2.2, 0.1], color: "#9a978d" },
  { position: [-0.79, 0.15, 0.25], scale: [0.28, 0.17, 0.32], rotation: [0.18, 1.1, -0.28], color: "#85827b" },
  { position: [-0.45, 0.15, 0.69], scale: [0.32, 0.17, 0.23], rotation: [-0.16, 2.7, 0.2], color: "#a49a87" },
];

const LOGS: LogSpec[] = [
  { turn: 0.25, tilt: 0.07, y: 0.24, length: 1.52, radius: 0.13, bark: "#74451f" },
  { turn: 1.82, tilt: -0.06, y: 0.29, length: 1.42, radius: 0.14, bark: "#86512a" },
  { turn: -0.72, tilt: -0.1, y: 0.36, length: 1.28, radius: 0.12, bark: "#6b3d1d" },
  { turn: 0.98, tilt: 0.11, y: 0.43, length: 1.12, radius: 0.105, bark: "#8a562f" },
];

const SEATS: SeatSpec[] = [
  { position: [1.2, 0, 0.38], radius: 0.22, height: 0.28, bark: "#74451f" },
  { position: [-1.08, 0, 0.62], radius: 0.2, height: 0.24, bark: "#81512b" },
  { position: [-1.2, 0, -0.34], radius: 0.21, height: 0.26, bark: "#6f431f" },
  { position: [0.48, 0, -1.17], radius: 0.19, height: 0.23, bark: "#87562e" },
];

const FLAMES: FlameSpec[] = [
  { position: [0, 0.27, 0], scale: [0.43, 1.48, 0.43], low: "#f05a22", high: "#c83417", phase: 0, order: 3 },
  { position: [-0.24, 0.3, 0.06], scale: [0.22, 0.95, 0.22], low: "#f26522", high: "#ce3517", phase: 1.9, order: 3 },
  { position: [0.22, 0.31, -0.05], scale: [0.2, 0.86, 0.2], low: "#f2671f", high: "#d53a18", phase: 3.7, order: 3 },
  { position: [0, 0.33, 0.02], scale: [0.32, 1.12, 0.32], low: "#ffad24", high: "#ff7820", phase: 0.7, order: 4 },
  { position: [-0.15, 0.39, -0.02], scale: [0.15, 0.62, 0.15], low: "#ffad24", high: "#ff8220", phase: 2.8, order: 4 },
  { position: [0.14, 0.4, 0.02], scale: [0.14, 0.58, 0.14], low: "#ffc247", high: "#ff8a22", phase: 4.5, order: 4 },
  { position: [0, 0.43, 0], scale: [0.2, 0.78, 0.2], low: "#fff0a3", high: "#ffd45a", phase: 1.4, order: 5 },
  { position: [0.03, 0.53, 0.02], scale: [0.09, 0.42, 0.09], low: "#fffef4", high: "#fff4bf", phase: 2.2, order: 6 },
];

const LICKS: LickSpec[] = [
  { x: 0.18, z: 0.04, drift: 0.18, width: 0.08, height: 0.38, phase: 0.05, low: "#ff9f1c", high: "#ff6d1f" },
  { x: -0.16, z: -0.07, drift: -0.16, width: 0.075, height: 0.34, phase: 0.36, low: "#f2671f", high: "#d93c17" },
  { x: 0.05, z: -0.18, drift: 0.11, width: 0.065, height: 0.32, phase: 0.64, low: "#ffd45a", high: "#ff9f1c" },
  { x: -0.05, z: 0.16, drift: -0.1, width: 0.06, height: 0.3, phase: 0.82, low: "#ffb22e", high: "#ff7a1f" },
];

const SPARKS: SparkSpec[] = Array.from({ length: 26 }, (_, i) => ({
  angle: i * 2.37,
  radius: 0.1 + ((i * 7) % 11) * 0.018,
  speed: 0.22 + (i % 5) * 0.025,
  phase: i / 26,
  height: 1.25 + (i % 6) * 0.16,
  wobble: 0.16 + (i % 4) * 0.04,
}));

function OutlinedStone({ stone }: { stone: StoneSpec }) {
  return (
    <group position={stone.position} rotation={stone.rotation} scale={stone.scale}>
      <mesh castShadow receiveShadow scale={[1.13, 1.13, 1.13]}>
        <sphereGeometry args={[1, 12, 8]} />
        <meshStandardMaterial color={OUTLINE} roughness={0.95} side={THREE.BackSide} />
      </mesh>
      <mesh castShadow receiveShadow>
        <sphereGeometry args={[1, 12, 8]} />
        <meshStandardMaterial color={stone.color} roughness={0.9} />
      </mesh>
    </group>
  );
}

function Log({ log, index }: { log: LogSpec; index: number }) {
  const end = log.length / 2 + 0.006;
  return (
    <group position={[0, log.y, 0]} rotation={[0, log.turn, log.tilt]}>
      <mesh rotation-z={Math.PI / 2} scale={[log.radius * 1.13, log.length * 1.04, log.radius * 1.13]} castShadow>
        <cylinderGeometry args={[1, 1, 1, 14]} />
        <meshStandardMaterial color={OUTLINE} roughness={0.9} side={THREE.BackSide} />
      </mesh>
      <mesh rotation-z={Math.PI / 2} scale={[log.radius, log.length, log.radius]} castShadow receiveShadow>
        <cylinderGeometry args={[1, 1, 1, 14]} />
        <meshStandardMaterial color={log.bark} roughness={0.78} />
      </mesh>
      <mesh rotation-z={Math.PI / 2} scale={[log.radius * 1.04, 0.42, log.radius * 1.04]} castShadow>
        <cylinderGeometry args={[1, 1, 1, 14]} />
        <meshStandardMaterial color={index % 2 ? "#241812" : "#302018"} roughness={0.95} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side} position={[side * end, 0, 0]} rotation-y={side * Math.PI * 0.5}>
          <mesh scale={[log.radius * 1.02, log.radius * 1.02, 1]}>
            <circleGeometry args={[1, 18]} />
            <meshStandardMaterial color="#e3aa69" roughness={0.8} />
          </mesh>
          <mesh scale={[log.radius * 0.72, log.radius * 0.72, 1]} position={[0, 0, 0.003]}>
            <ringGeometry args={[0.62, 0.72, 18]} />
            <meshBasicMaterial color="#8a552b" transparent opacity={0.58} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Stump({ seat, index }: { seat: SeatSpec; index: number }) {
  const top = seat.height + 0.006;
  return (
    <group position={seat.position} rotation-y={index * 0.9}>
      <mesh position={[0, seat.height / 2, 0]} scale={[seat.radius * 1.12, seat.height * 1.04, seat.radius * 1.12]} castShadow>
        <cylinderGeometry args={[1, 1, 1, 14]} />
        <meshStandardMaterial color={OUTLINE} roughness={0.9} side={THREE.BackSide} />
      </mesh>
      <mesh position={[0, seat.height / 2, 0]} scale={[seat.radius, seat.height, seat.radius]} castShadow receiveShadow>
        <cylinderGeometry args={[1, 1, 1, 14]} />
        <meshStandardMaterial color={seat.bark} roughness={0.82} />
      </mesh>
      <mesh position={[0, top, 0]} rotation-x={-Math.PI / 2} scale={[seat.radius * 1.02, seat.radius * 1.02, 1]} receiveShadow>
        <circleGeometry args={[1, 18]} />
        <meshStandardMaterial color="#dca267" roughness={0.82} />
      </mesh>
      <mesh position={[0, top + 0.004, 0]} rotation-x={-Math.PI / 2} scale={[seat.radius * 0.62, seat.radius * 0.62, 1]}>
        <ringGeometry args={[0.56, 0.68, 18]} />
        <meshBasicMaterial color="#7d4926" transparent opacity={0.58} />
      </mesh>
    </group>
  );
}

export function Fire({ night, calm }: { night: boolean; calm: boolean }) {
  const light = useRef<THREE.PointLight>(null);
  const glow = useRef<THREE.MeshBasicMaterial>(null);
  const sparks = useRef<THREE.InstancedMesh>(null);
  const smoke = useRef<THREE.Group>(null);
  const licks = useRef<THREE.Group>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // 높이 1, 반지름 1짜리 물방울. 여러 겹을 겹쳐 만화 불꽃처럼 보이게 한다.
  const drop = useMemo(
    () => new THREE.LatheGeometry(Array.from({ length: 16 }, (_, i) => new THREE.Vector2(Math.sin(Math.PI * (i / 15) ** 0.52) * (1 - (i / 15) * 0.08), i / 15)), 18),
    [],
  );
  const flameMaterials = useMemo(
    () =>
      [...FLAMES, ...LICKS].map(
        (flame) =>
          new THREE.ShaderMaterial({
            vertexShader: VERTEX,
            fragmentShader: FRAGMENT,
            uniforms: {
              uTime: { value: 0 },
              uPhase: { value: flame.phase },
              uLow: { value: new THREE.Color(flame.low) },
              uHigh: { value: new THREE.Color(flame.high) },
            },
            transparent: true,
            depthWrite: false,
          }),
      ),
    [],
  );

  useFrame((state) => {
    const t = calm ? 0 : state.clock.elapsedTime;
    for (let i = 0; i < flameMaterials.length; i++) flameMaterials[i].uniforms.uTime.value = t;

    const flicker = Math.sin(t * 15.7) * 0.11 + Math.sin(t * 6.8 + 0.6) * 0.08;
    if (light.current) light.current.intensity = (night ? 18 : 3.8) * (1 + flicker);
    if (glow.current) glow.current.opacity = (night ? 0.28 : 0.1) * (1 + flicker * 0.7);

    const lickGroup = licks.current;
    if (lickGroup) {
      for (let i = 0; i < LICKS.length; i++) {
        const lick = LICKS[i];
        const mesh = lickGroup.children[i];
        const p = (t * 0.42 + lick.phase) % 1;
        const rise = Math.max(0.001, Math.sin(p * Math.PI));
        mesh.position.set(lick.x + lick.drift * p + Math.sin(t * 2.2 + i) * 0.025, 0.62 + p * 0.92, lick.z + Math.cos(t * 1.7 + i * 1.3) * 0.025);
        mesh.scale.set(lick.width * rise * (1 - p * 0.25), lick.height * (0.5 + rise * 0.65), lick.width * rise * (1 - p * 0.25));
      }
    }

    const sparkMesh = sparks.current;
    if (sparkMesh) {
      for (let i = 0; i < SPARKS.length; i++) {
        const spark = SPARKS[i];
        const p = (t * spark.speed + spark.phase) % 1;
        const a = spark.angle + Math.sin(t * 0.8 + i) * 0.25;
        const r = spark.radius + p * spark.wobble;
        const s = Math.max(0.004, 0.042 * (1 - p));
        dummy.position.set(Math.sin(a) * r, 0.58 + p * spark.height, Math.cos(a) * r);
        dummy.scale.set(s, s, s);
        dummy.rotation.set(t + i, t * 0.7 + i * 0.3, 0);
        dummy.updateMatrix();
        sparkMesh.setMatrixAt(i, dummy.matrix);
      }
      sparkMesh.instanceMatrix.needsUpdate = true;
    }

    const smokeGroup = smoke.current;
    if (smokeGroup) {
      for (let i = 0; i < smokeGroup.children.length; i++) {
        const puff = smokeGroup.children[i] as THREE.Mesh;
        const p = (t * 0.16 + i / smokeGroup.children.length) % 1;
        puff.position.set(Math.sin(p * 4.1 + i) * (0.1 + p * 0.35), 0.9 + p * 1.45, Math.cos(p * 3.2 + i * 0.7) * (0.08 + p * 0.28));
        puff.scale.setScalar(0.12 + p * 0.42);
        (puff.material as THREE.MeshBasicMaterial).opacity = 0.22 * (1 - p);
      }
    }
  });

  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.036, 0]} receiveShadow>
        <circleGeometry args={[1.18, 40]} />
        <meshStandardMaterial color="#3a281f" roughness={1} transparent opacity={0.82} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.041, 0]}>
        <ringGeometry args={[0.72, 1.14, 42]} />
        <meshBasicMaterial color="#1e1713" transparent opacity={0.2} depthWrite={false} />
      </mesh>

      {STONES.map((stone, i) => (
        <OutlinedStone key={i} stone={stone} />
      ))}
      {LOGS.map((log, i) => (
        <Log key={i} log={log} index={i} />
      ))}
      {SEATS.map((seat, i) => (
        <Stump key={i} seat={seat} index={i} />
      ))}

      {FLAMES.map((flame, i) => (
        <mesh key={i} geometry={drop} material={flameMaterials[i]} position={flame.position} scale={flame.scale} renderOrder={flame.order} />
      ))}
      {!calm && (
        <group ref={licks}>
          {LICKS.map((lick, i) => (
            <mesh key={i} geometry={drop} material={flameMaterials[FLAMES.length + i]} renderOrder={7} />
          ))}
        </group>
      )}

      <pointLight ref={light} position={[0, 1.15, 0]} color="#ff9a4d" distance={11} decay={2} />
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.052, 0]} renderOrder={1}>
        <circleGeometry args={[2.15, 42]} />
        <meshBasicMaterial ref={glow} color="#ff7a28" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>

      {!calm && (
        <>
          <instancedMesh ref={sparks} args={[undefined, undefined, SPARKS.length]}>
            <octahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color="#ffb347" emissive="#ff7a1f" emissiveIntensity={1.6} roughness={0.4} />
          </instancedMesh>
          <group ref={smoke}>
            {Array.from({ length: 8 }, (_, i) => (
              <mesh key={i}>
                <sphereGeometry args={[1, 10, 7]} />
                <meshBasicMaterial color={i % 2 ? "#d9d1c5" : "#eee6d9"} transparent opacity={0} depthWrite={false} />
              </mesh>
            ))}
          </group>
        </>
      )}
    </>
  );
}
