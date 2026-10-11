"use client";

// 화면 전체의 그림풍. 모델을 끊어 칠하는 재질(toon), 화면을 한 벌로 묶는 후처리(Post), 캔버스 위에 얹는 테두리 그늘(Veil).
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { useFx } from "./fx";

// 명암 세 단계: 그늘, 중간, 볕
const STEPS = new THREE.DataTexture(new Uint8Array([120, 195, 255]), 3, 1, THREE.RedFormat);
STEPS.minFilter = STEPS.magFilter = THREE.NearestFilter;
STEPS.needsUpdate = true;

// 모델 재질을 끊어 칠하는 재질로 바꾼다. 색·빛남·투명도는 그대로라 paint가 전처럼 동작한다. 외곽선 껍데기는 건드리지 않는다.
export function toon(from: THREE.Material): THREE.MeshStandardMaterial {
  const m = from as THREE.MeshStandardMaterial;
  if (m.name === "Outline" || !m.isMeshStandardMaterial) return m.clone();
  const made = new THREE.MeshToonMaterial({
    name: m.name,
    color: m.color,
    map: m.map,
    emissive: m.emissive,
    emissiveMap: m.emissiveMap,
    emissiveIntensity: m.emissiveIntensity,
    transparent: m.transparent,
    opacity: m.opacity,
    alphaTest: m.alphaTest,
    side: m.side,
    vertexColors: m.vertexColors,
    gradientMap: STEPS,
  });
  return made as unknown as THREE.MeshStandardMaterial;
}

// 색 보정. 화면은 흐리지 않는다.
const GRADE = {
  uniforms: { tDiffuse: { value: null }, tint: { value: new THREE.Color(1, 1, 1) }, sat: { value: 1 } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec3 tint; uniform float sat; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      gl_FragColor = vec4(mix(vec3(l), c, sat) * tint, 1.0);
    }`,
};
const TINT = { day: new THREE.Color(1.05, 1.0, 0.93), night: new THREE.Color(0.84, 0.93, 1.14) };

// 캔버스 안에 둔다. 켜져 있으면 이 부품이 화면을 대신 그린다.
export function Post({ night }: { night: boolean }) {
  const { gl, scene, camera, size, viewport } = useThree();
  const on = useFx();
  const made = useMemo(() => {
    const composer = new EffectComposer(gl, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0, 0.4, 0.9);
    composer.addPass(bloom);
    const grade = new ShaderPass(GRADE);
    composer.addPass(grade);
    composer.addPass(new OutputPass());
    return { composer, bloom, grade };
  }, [gl, scene, camera]);
  useEffect(() => () => made.composer.dispose(), [made]);
  useEffect(() => {
    made.composer.setPixelRatio(viewport.dpr);
    made.composer.setSize(size.width, size.height);
  }, [made, size, viewport.dpr]);
  useFrame((_, dt) => {
    if (!on) return gl.render(scene, camera);
    const k = 1 - Math.exp(-dt * 3);
    const u = made.grade.uniforms;
    (u.tint.value as THREE.Color).lerp(TINT[night ? "night" : "day"], k);
    u.sat.value += ((night ? 0.95 : 1.12) - u.sat.value) * k;
    // 번짐은 밤의 불과 창문에만. 낮에는 끈다(볕 받은 흰 면이 뿌예진다).
    made.bloom.strength += ((night ? 0.4 : 0) - made.bloom.strength) * k;
    made.bloom.enabled = made.bloom.strength > 0.02;
    made.composer.render(dt);
  }, 1);
  return null;
}

// 캔버스 바로 뒤에 둔다(HUD보다 아래). 화면 가장자리를 살짝 눌러 가운데로 눈이 가게 한다.
export function Veil({ night }: { night: boolean }) {
  const on = useFx();
  if (!on) return null;
  const edge = night ? "rgb(6 8 30 / 0.5)" : "rgb(43 33 24 / 0.22)";
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        transition: "background 1s",
        background: `radial-gradient(ellipse at 50% 52%, transparent 55%, ${edge} 120%)`,
        mixBlendMode: "multiply",
      }}
    />
  );
}
