// [w2-align] ground-drape: a coarse ground mesh kept off a level street cut across a steep slope
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groundDrape } from '../js/world/ground-drape.js';

// A 40 % slope rising to +z, with an 8 m street (+2.5 m sidewalks) cut level across it at z ≈ 40, running at 30°
// to the mesh (so its edges cross the 6 m cells diagonally — the sawtooth case).
const S = 16, cell = 6, N = S + 1, a = Math.PI / 6;
const along = (x, z) => Math.cos(a) * x + Math.sin(a) * z;
const across = (x, z) => -Math.sin(a) * x + Math.cos(a) * z - 40;          // signed metres from the street's centre line
const street = (x, z) => .4 * (along(x, z) * Math.sin(a) + 40 * Math.cos(a));   // level across: the slope at its centre line
const ground = (x, z) => {
  const c = across(x, z), slope = .4 * z, level = street(x, z) - .1;
  const edge = Math.abs(c) - 6.5;                                          // flat 6.5 m past the carriageway, easing out by 18 m
  if (edge <= 0) return level;
  const k = Math.min(1, edge / 11.5), s = k * k * (3 - 2 * k);
  return level + (slope - level) * s;
};
const mesh = (h) => (x, z) => {
  const u = x / cell, w = z / cell, i = Math.min(S - 1, Math.floor(u)), j = Math.min(S - 1, Math.floor(w)), fu = u - i, fw = w - j;
  const A = h[j * N + i], B = h[j * N + i + 1], D = h[(j + 1) * N + i], E = h[(j + 1) * N + i + 1];
  return fu + fw <= 1 ? A + (B - A) * fu + (D - A) * fw : E + (D - E) * (1 - fu) + (B - E) * (1 - fw);
};
const points = [];
for (let t = -20; t <= 120; t += 2) for (const o of [-6.5, -4, 0, 4, 6.5]) {
  const x = Math.cos(a) * t - Math.sin(a) * (40 + o), z = Math.sin(a) * t + Math.cos(a) * (40 + o);
  if (x >= 0 && z >= 0 && x <= 96 && z <= 96) points.push({ x, z });
}
const heights = () => { const h = new Float64Array(N * N); for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) h[j * N + i] = ground(i * cell, j * cell); return h; };
const poke = (h) => Math.max(...points.map((p) => mesh(h)(p.x, p.z) - ground(p.x, p.z)));

test('drape: the mesh no longer covers the street; vertices at or below street level stay', () => {
  const h = heights(), before = h.slice();
  assert.ok(poke(h) > .5, `the plain mesh pokes over the street (${poke(h).toFixed(2)} m)`);
  const n = groundDrape(h, 0, 0, cell, S, ground, { last: (x, z) => Math.abs(across(x, z)) <= 6.5 });
  n.add(points); n.apply();
  assert.ok(poke(h) < .01, `draped: ${poke(h).toFixed(3)} m`);
  for (let k = 0; k < h.length; k++) {
    assert.ok(h[k] <= before[k] + 1e-9, 'only lowers');
    const x = (k % N) * cell, z = Math.floor(k / N) * cell;
    if (before[k] <= street(x, z) - .1 + 1e-6) assert.equal(h[k], before[k], 'street-level and downhill vertices stay');
  }
});

test('drape: maxDrop caps the lowering; fixed vertices never move', () => {
  const h = heights(), before = h.slice();
  const d = groundDrape(h, 0, 0, cell, S, ground, { maxDrop: .5, fixed: (x) => x < 30 });
  d.add(points);
  const { max } = d.apply();
  assert.ok(max <= .5 + 1e-9);
  for (let k = 0; k < h.length; k++) if ((k % N) * cell < 30) assert.equal(h[k], before[k]);
});
