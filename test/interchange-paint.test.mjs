// [audit-E2] Road paint and ramps at interchanges: no zebra on or across a highway or a ramp, no centre line on a
// one-way or a ramp, and a ramp levelled with its carriageway where it merges (so the overlap pass makes a gore,
// not two ribbons over each other with their paint crossing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planJunctions, junctionPaint } from '../js/world/toolbox/city/junctions.js';
import { flushBranches, resolveOverlaps } from '../js/world/toolbox/city/road-meets.js';
import { streetPaint } from '../js/world/toolbox/city/city.js';
import { ROAD_WIDTH } from '../js/world/pose.js';

const P = (x, z, y = 100) => ({ x, z, y });
const line = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => P(a.x + (b.x - a.x) * i / n, a.z + (b.z - a.z) * i / n, a.y + (b.y - a.y) * i / n));
const mk = (pts, nodeIdx, cls = 5, width = 9.5, oneway = 0) => ({ cls, width, bridge: false, oneway, layer: 0, pts, nodes: nodeIdx.map((i) => pts[i]), nodeIdx });

// a plus-shaped crossing at (0, 0) far from a straight route along z = 400 (tests/junctions.test.mjs's setup)
function crossing(clsB, widthB) {
  const A = mk(line(P(-60, 0), P(60, 0), 12), [0, 6, 12]);
  const B = mk(line(P(0, -60), P(0, 60), 12), [0, 6, 12], clsB, widthB, clsB <= 1 ? 1 : 0);
  const n = 60, route = { dist: [], ele: [], turnIdx: n }, xs = [], zs = [];
  for (let i = 0; i <= n; i++) { route.dist.push(i * 10); route.ele.push(100); xs.push(-200 + i * 10); zs.push(400); }
  const index = { xs, zs, nearest: (x, z, r) => { let best = null; for (let i = 0; i <= n; i++) { const d = Math.hypot(xs[i] - x, zs[i] - z); if (d < r && (!best || d < best.d)) best = { i, d }; } return best; } };
  const routeDist = (x, z) => (x > -200 && x < 400 && Math.abs(z - 400) < 30 ? { d: Math.abs(z - 400), i: Math.floor((x + 200) / 10), y: 100 } : null);
  const streets = [A, B], ctx = { route, index, end: n, routeDist, roadWidth: ROAD_WIDTH };
  const plan = planJunctions(streets, ctx, true);
  return junctionPaint(plan, streets, ctx);
}

test('interchange paint: a street crossing gets crosswalks; one with a ramp or highway arm gets none', () => {
  const street = crossing(5, 9.5);
  assert.ok(street.quads.filter((q) => q.kind === 'crosswalk').length > 0, 'an ordinary crossing keeps its zebras');
  for (const [cls, w] of [[1, 7.5], [0, 15]]) {
    const ix = crossing(cls, w);
    assert.equal(ix.quads.filter((q) => q.kind === 'crosswalk' || q.kind === 'stop').length, 0, `no crosswalk or stop line where a cls ${cls} road crosses`);
    assert.ok(ix.bad.some((b) => /interchange/.test(b.why)), 'left out by rule');
  }
});

test('interchange paint: one-ways and ramps never use the centre-line style', () => {
  const centre = (st) => Math.min(...streetPaint(st)) < .25;   // u 0–.25: two-way, double yellow centre line
  for (const cls of [0, 1, 2, 3, 4, 5, 7]) for (const oneway of [1, -1]) for (const width of [5, 7.5, 13, 15])
    assert.ok(!centre({ cls, oneway, width }), `one-way cls ${cls} w ${width}`);
  assert.ok(!centre({ cls: 1, oneway: 0, width: 7.5 }), 'a ramp tagged two-way: edge lines only');
  assert.ok(centre({ cls: 5, oneway: 0, width: 7.5 }), 'an ordinary two-way street keeps its centre line');
});

test('interchange merge: a ramp leaving its carriageway is level with it while they overlap, then eases back', () => {
  // a highway west→east at y 100; a ramp leaving it at (0, 0) at a shallow slant, drawn 1.5 m high over the overlap
  const hw = mk(line(P(-100, 0), P(200, 0), 60), [0, 20, 60], 0, 15, 1);
  const rampPts = [];
  for (let i = 0; i <= 40; i++) { const x = i * 5, z = -Math.min(40, (x * x) / 500); rampPts.push(P(x, z, 100 + 1.5 * Math.min(1, x / 15))); }
  rampPts[0] = { ...hw.pts[20] };   // (the shared node: the same place)
  const ramp = mk(rampPts, [0, 40], 1, 7.5, 1);
  const streets = [hw, ramp], lift = () => .1;
  const before = ramp.pts.map((p) => p.y), far = ramp.pts.at(-1).y;
  assert.equal(flushBranches(streets, lift), 1, 'one branch levelled');
  // while the two ribbons overlap (centrelines < 11.25 − .3 m apart) the ramp is at the highway's height
  let levelled = 0;
  for (const p of ramp.pts) if (Math.abs(p.z) < 7.5 + 3.75 - .3) { assert.ok(Math.abs(p.y - 100) < 1e-6, `ramp at ${p.x} level with the highway (${p.y.toFixed(2)})`); levelled++; }
  assert.ok(levelled >= 5, `${levelled} points levelled`);
  assert.equal(ramp.pts.at(-1).y, far, 'the far end keeps its height');
  assert.ok(ramp.pts.some((p, i) => p.y !== before[i]));
  // no crease: grade changes stay gentle
  for (let i = 1; i < ramp.pts.length - 1; i++) {
    const a = ramp.pts[i - 1], b = ramp.pts[i], c = ramp.pts[i + 1];
    const g1 = (b.y - a.y) / Math.hypot(b.x - a.x, b.z - a.z), g2 = (c.y - b.y) / Math.hypot(c.x - b.x, c.z - b.z);
    assert.ok(Math.abs(g2 - g1) < .18, `grade change at ${b.x}: ${(g2 - g1).toFixed(3)}`);
  }
  // …so the overlap pass trims the ramp to the gore: wholly inside the highway it isn't drawn, alongside it loses its inner side
  resolveOverlaps(streets, { city: {} }, { final: false });
  const inside = ramp.pts.filter((p) => Math.abs(p.z) < 7.5 - 3.75 - .2 && p.x > 0);
  assert.ok(inside.length && inside.every((p) => (p.tl || 0) + (p.tr || 0) >= 7.5 - 1e-6), 'the ramp is not drawn over the highway');
});
