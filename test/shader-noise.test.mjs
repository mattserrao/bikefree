// [review 27 Nov] One copy of the GLSL hashes and value noise (materials/glsl-noise.js HASH_GLSL): the toolbox's
// shaders carried ~14 private copies, ten on fract(sin(dot(p, k)) * 43758.5), which loses its bits for large arguments
// (GPU sin is only accurate near 0; world metres × 127 ≈ 1e5: repeats and correlated jitter far from the origin).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { HASH_GLSL, NOISE_GLSL } from '../js/world/toolbox/materials/glsl-noise.js';

const TOOLBOX = new URL('../js/world/toolbox/', import.meta.url).pathname;
const files = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? files(p) : p.endsWith('.js') ? [p] : []; });
// ground-cover.js belongs to another area; race-day's crowd hash wraps its input (mod 1009) and the post pass hashes
// screen uv: both stay small
// materials/graph-road.js: the graph maps' roads and ground keep their own gwH / gwN (GW_NOISE_GLSL) — moved there from
// graph-world.js unchanged (W13, 27 Nov); swapping the hash would move every grain of those maps: a look change, not a refactor
const SKIP = ['landscape/ground-cover.js', 'life/race-day.js', 'atmosphere/post.js', 'materials/graph-road.js'];
const src = Object.fromEntries(files(TOOLBOX).map((f) => [f.slice(TOOLBOX.length), readFileSync(f, 'utf8')]).filter(([f]) => !SKIP.includes(f)));
const f32 = Math.fround, fract = (x) => f32(x - Math.floor(x));

test('HASH_GLSL is guarded and gives hw21, hw31, hw22, vn2, vn3 (vn2: exactly the old private copies\' hash and fade)', () => {
  assert.match(HASH_GLSL, /^\s*#ifndef BF_HASH_GLSL\s+#define BF_HASH_GLSL[\s\S]*#endif\s*$/);
  for (const fn of ['float hw21(vec2 p)', 'float hw31(vec3 p)', 'vec2 hw22(vec2 p)', 'float vn2(vec2 p)', 'float vn3(vec3 p)']) assert.ok(HASH_GLSL.includes(fn), fn);
  assert.ok(HASH_GLSL.includes('float hw21(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }'));
  assert.ok(HASH_GLSL.includes('mix(mix(hw21(i), hw21(i + vec2(1., 0.)), f.x), mix(hw21(i + vec2(0., 1.)), hw21(i + 1.), f.x), f.y)'));
  assert.ok(!/\bsin\(/.test(HASH_GLSL));
  assert.ok(!/\b(hw21|vn2)\b/.test(NOISE_GLSL), 'no clash with the sky\'s h21 / vn / fbm');
});

test('no toolbox shader hashes with fract(sin(…)) or defines its own value noise', () => {
  const sinHash = Object.entries(src).filter(([f, s]) => f !== 'materials/glsl-noise.js' && /fract\(\s*sin\(/.test(s)).map(([f]) => f);
  assert.deepEqual(sinHash, []);
  const own = Object.entries(src).filter(([f, s]) => f !== 'materials/glsl-noise.js' && /float \w+\(vec[23] p\) \{\s*vec[23] i = floor\(p\), f = fract\(p\);/.test(s)).map(([f]) => f);
  assert.deepEqual(own, []);
});

test('every kit that calls the shared noise includes it (vista.js: into the ground shader that includes it)', () => {
  const callers = Object.entries(src).filter(([f, s]) => f !== 'materials/glsl-noise.js' && /\b(hw21|hw31|hw22|vn2|vn3)\(/.test(s));
  assert.ok(callers.length >= 18, `${callers.length} callers`);
  for (const [f, s] of callers) assert.ok(s.includes('HASH_GLSL') || (f === 'atmosphere/vista.js' && src['materials/surfaces.js'].includes('${HASH_GLSL}')), f);
});

test('the sin-free hash stays spread out far from the origin, in float32 as a GPU runs it', () => {
  const hw21 = (x, y) => { let a = fract(f32(x * f32(.1031))), b = fract(f32(y * f32(.1031))), c = a; const d = f32(f32(a * f32(b + 33.33)) + f32(b * f32(c + 33.33)) + f32(c * f32(a + 33.33))); a = f32(a + d); b = f32(b + d); c = f32(c + d); return fract(f32(f32(a + b) * c)); };
  const v = []; for (let i = 0; i < 400; i++) v.push(hw21(f32(81234 + i), f32(-60311 + i * 3)));   // cells ~100 km out
  const mean = v.reduce((a, b) => a + b) / v.length, sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  assert.ok(new Set(v.map((x) => x.toFixed(3))).size > 300 && Math.abs(mean - .5) < .06 && Math.abs(sd - .289) < .04, `mean ${mean}, sd ${sd}`);
});
