// 효과음 검증: 무음이 아니고, -3dB를 넘지 않고, 끝에서 튀지 않는지. 귀로 듣는 검사는 아니다.
import assert from "node:assert";
import { LOOPS, PEAK, SFX, SR, render, renderLoop } from "./app/sound.ts";

function stat(name: string, b: Float32Array) {
  let peak = 0;
  let sum = 0;
  for (const s of b) {
    assert(Number.isFinite(s), `${name}: 숫자가 아닌 값`);
    peak = Math.max(peak, Math.abs(s));
    sum += s * s;
  }
  const db = (x: number) => (20 * Math.log10(x)).toFixed(1).padStart(6);
  if (process.argv.includes("-v"))
    console.log(`${name.padEnd(10)} ${(b.length / SR).toFixed(2)}s  peak ${db(peak)}dB  rms ${db(Math.sqrt(sum / b.length))}dB`);
  assert(peak > 0.05, `${name}: 무음`);
  assert(peak <= PEAK + 1e-6, `${name}: -3dB 초과`);
}

for (const name of SFX) {
  const b = render(name);
  stat(name, b);
  assert(Math.abs(b[b.length - 1]) < 1e-3, `${name}: 끝에서 딱 소리`);
}
for (const name of LOOPS) {
  const b = renderLoop(name);
  stat(`~${name}`, b);
  assert(Math.abs(b[0] - b[b.length - 1]) < 0.2, `${name}: 고리 이음매가 튐`);
}
console.log(`sound ok (${SFX.length} + ${LOOPS.length})`);
