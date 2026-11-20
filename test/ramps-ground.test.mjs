// [audit-E1] Raised roads and the ground around them: ramps with no room for a bank become decks (rampDecksJob),
// and the ground mesh is held up at a bank's top (ground-drape.js `up` points).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rampDecksJob, BANK_SLOPE } from '../js/world/toolbox/city/landscape.js';
import { groundDrape } from '../js/world/toolbox/landscape/ground-drape.js';
import { drain } from '../js/world/toolbox/core/jobs.js';

// a straight street along x at z, from x0 to x1, height y(x), points every 6 m (each an OSM node at the ends only)
const street = (cls, width, z, x0, x1, y) => {
  const pts = [];
  for (let x = x0; x <= x1 + 1e-9; x += 6) pts.push({ x, z, y: y(x) });
  return { cls, width, bridge: false, oneway: 1, layer: 0, pts, nodes: [pts[0], pts[pts.length - 1]], nodeIdx: [0, pts.length - 1] };
};

test('rampDecks: a ramp climbing beside its carriageway with no room for a bank becomes a deck there', () => {
  const highway = street(0, 15, 0, 0, 300, () => 100);
  // a link 4 m beside the highway (edge to edge), level with it at first, climbing to 7 m over it in the middle
  const ramp = street(1, 7.5, 15 / 2 + 4 + 7.5 / 2, 0, 300, (x) => 100 + 7 * Math.sin(Math.PI * x / 300));
  const streets = [highway, ramp];
  drain(rampDecksJob(streets));
  const decks = streets.filter((s) => s.rampDeck), ground = streets.filter((s) => s.cls === 1 && !s.bridge);
  assert.ok(decks.length === 1, `one deck (${decks.length})`);
  assert.ok(decks[0].bridge, 'the deck is a bridge street (the bridge kit draws its slab, railings and piers)');
  assert.equal(ground.length, 2, 'the low ends stay ground streets');
  const d = decks[0].pts;
  assert.ok(d[0].x > 0 && d[d.length - 1].x < 300, 'the deck lies within the ramp');
  // where it is a deck, a 1:2 bank between the two would not fit; where it stays ground, it would (with the 1.2 m allowed)
  for (const p of d.slice(2, -2)) assert.ok(p.y - 100 - (4 - 2) * BANK_SLOPE > 1.2, `deck point at ${p.x} m has room for a bank`);
  // the pieces meet end to end (shared coordinates, the OSM-style node at each cut), and the highway is untouched
  const [g0, g1] = ground.sort((a, b) => a.pts[0].x - b.pts[0].x);
  assert.equal(g0.pts[g0.pts.length - 1].x, d[0].x);
  assert.equal(g1.pts[0].x, d[d.length - 1].x);
  for (const s of [g0, decks[0], g1]) { assert.equal(s.nodeIdx[0], 0); assert.equal(s.nodeIdx[s.nodeIdx.length - 1], s.pts.length - 1); }
  assert.ok(!highway.bridge && highway.pts.length === 51);
});

test('rampDecks: a raised road with room for its bank, or a low one, stays on the ground (an embankment)', () => {
  const highway = street(0, 15, 0, 0, 300, () => 100);
  const far = street(1, 7.5, 15 / 2 + 16 + 7.5 / 2, 0, 300, () => 106);    // 6 m up, 16 m away: a 1:2 bank fits
  const low = street(1, 7.5, -(15 / 2 + 3 + 7.5 / 2), 0, 300, () => 101);  // 1 m up, 3 m away
  const streets = [highway, far, low];
  drain(rampDecksJob(streets));
  assert.equal(streets.length, 3);
  assert.ok(streets.every((s) => !s.bridge && !s.rampDeck));
});

test('rampDecks: residential streets never become decks', () => {
  const lowSt = street(5, 7.5, 0, 0, 120, () => 100), highSt = street(5, 7.5, 10, 0, 120, () => 108);
  const streets = [lowSt, highSt];
  drain(rampDecksJob(streets));
  assert.ok(streets.every((s) => !s.bridge));
});

test('drape: a bank-top point lifts the sagging mesh under a raised street, but a clear point below still wins', () => {
  // a street on an embankment (level 10) to z = 19, a steep bank down to 0 by z = 29 (the 6 m mesh can't follow it)
  const S = 10, cell = 6, N = S + 1;
  const ground = (x, z) => (z <= 19 ? 10 : Math.max(0, 10 - (z - 19)));
  const h = new Float64Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) h[j * N + i] = ground(i * cell, j * cell);
  const mesh = (x, z) => {
    const u = x / cell, w = z / cell, i = Math.min(S - 1, Math.floor(u)), j = Math.min(S - 1, Math.floor(w)), fu = u - i, fw = w - j;
    const A = h[j * N + i], B = h[j * N + i + 1], D = h[(j + 1) * N + i], E = h[(j + 1) * N + i + 1];
    return fu + fw <= 1 ? A + (B - A) * fu + (D - A) * fw : E + (D - E) * (1 - fu) + (B - E) * (1 - fw);
  };
  const top = [];
  for (let x = 1; x < 59; x += 2) top.push({ x, z: 19.5, up: true });
  const sag = () => Math.max(...top.map((p) => ground(p.x, p.z) - mesh(p.x, p.z)));
  assert.ok(sag() > .5, `the plain mesh sags under the bank's top (${sag().toFixed(2)} m)`);
  const before = h.slice();
  const d = groundDrape(h, 0, 0, cell, S, ground, { upTol: .3 });
  d.add(top);
  const { drop } = d.apply();
  assert.ok(sag() <= .3 + 1e-6, `held up: ${sag().toFixed(3)} m`);
  for (let k = 0; k < h.length; k++) {
    const x = (k % N) * cell, z = Math.floor(k / N) * cell;
    assert.ok(h[k] <= Math.max(before[k], 10) + 1e-9, 'never over the street');
    assert.ok(h[k] - before[k] <= 3 + 1e-9, 'lifted at most maxLift');
    assert.ok(Math.abs(drop[k] - Math.abs(h[k] - before[k])) < 1e-9 && drop[k] >= 0, 'drop: how far each vertex moved');
    if (z < 19) assert.equal(h[k], before[k], 'the street stays');
    void x;
  }
  // with a lower street's clear point at the vertex just past the top, the clear point wins (the lower street isn't buried)
  const h2 = new Float64Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) h2[j * N + i] = ground(i * cell, j * cell);
  const d2 = groundDrape(h2, 0, 0, cell, S, ground, { upTol: .3 });
  const clear = [{ x: 30, z: 24 }];
  d2.add([...top, ...clear]); d2.apply();
  const m2 = (x, z) => {
    const u = x / cell, w = z / cell, i = Math.min(S - 1, Math.floor(u)), j = Math.min(S - 1, Math.floor(w)), fu = u - i, fw = w - j;
    const A = h2[j * N + i], B = h2[j * N + i + 1], D = h2[(j + 1) * N + i], E = h2[(j + 1) * N + i + 1];
    return fu + fw <= 1 ? A + (B - A) * fu + (D - A) * fw : E + (D - E) * (1 - fu) + (B - E) * (1 - fw);
  };
  assert.ok(m2(30, 24) <= ground(30, 24) + 1e-6, 'the clear point is kept clear');
});
