// Building kit: ground dressing round the houses near the road — the things that make a house lived in.
// Pots and a bench by the door, bins at the corner, shrubs along the front, a woodpile under the eaves, a
// vegetable garden and a washing line out the back, hay bales by the barn, a stone trough in a village
// square, a satellite dish. Planned here (pure: positions only, checked clear of the road and of other
// buildings), drawn into the near detail mesh by kit.js.
import { randomSequence } from '../../core/random.js';
import { frontSegment } from './assemble.js';
import { ROAD_HALF } from './recipe.js';

/** Items for one building: { kind, x, z, yaw (radians, along the item's length), size: [len, depth, height], … }. */
export function planDressing(R, ctx) {
  if (!R.dress || !R.rects.length) return [];
  const D = R.style.dressing, rand = randomSequence(Math.floor(R.seed * 1e9) ^ 0x5bd1e995);
  const f = frontSegment(R); if (!f) return [];
  const r = R.rects[0];
  const items = [];
  const at = (u, out) => [f.p[0] + f.t[0] * u + f.n[0] * out, f.p[1] + f.t[1] * u + f.n[1] * out];
  const yawT = Math.atan2(f.t[1], f.t[0]);
  const ok = (x, z, rr) => !ctx.index.nearest(x, z, ROAD_HALF + 1.2 + rr) && !ctx.blocked(x, z, rr, R);
  const add = (kind, x, z, yaw, size, rr, extra = {}) => { if (ok(x, z, rr)) { items.push({ kind, x, z, yaw, size, ...extra }); return true; } return false; };
  const door = R.parts.stair ? null : (doorU(R, f));
  const po = R.parts.frontPorch ? R.parts.frontPorch.depth + .15 : 0;   // in front of a porch
  // by the door
  if (door != null && rand() < D.pots) for (const s of [-1, 1]) { const [x, z] = at(door + s * .95, po + .45); add('pot', x, z, yawT, [.38, .38, .42], .3, { tone: rand() }); }
  if (door != null && rand() < D.bench) { const s = rand() < .5 ? -1 : 1; const [x, z] = at(door + s * 2.1, po ? po * .45 : .5); const extra = po ? { porch: true } : {}; if (po) { if (!ctx.blocked(x, z, .5, R)) items.push({ kind: 'bench', x, z, yaw: yawT, size: [1.4, .45, .9], ...extra }); } else add('bench', x, z, yawT, [1.4, .45, .9], .8); }
  // bins at a front corner
  if (rand() < D.bins) {
    const end = rand() < .5 ? .7 : f.len - .7, [x, z] = at(end, po + 1.0);
    add('bins', x, z, yawT, [1.3, .65, 1.05], .8, { tone: rand() });
  }
  // shrubs along the front, away from the door
  if (rand() < D.shrubs) {
    const n = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const u = rand() * f.len;
      if (door != null && Math.abs(u - door) < 1.6) continue;
      const [x, z] = at(u, po + .8 + rand() * .5);
      add('shrub', x, z, rand() * 6.28, [.7 + rand() * .7, .7 + rand() * .7, .6 + rand() * .7], .7, { tone: rand() });
    }
  }
  // the end walls: a woodpile against one, hay bales off a barn end
  const ends = [1, 3].map((i) => {
    const s = i === 1 ? 1 : -1;
    return { i, s, c: [r.cx + r.ux * s * r.hu, r.cz + r.uz * s * r.hu], n: [r.ux * s, r.uz * s], t: [r.vx * s, r.vz * s] };
  });
  const wpEnd = ends[rand() < .5 ? 0 : 1];
  const annexed = (e) => R.parts.leanTo?.end === e.i || R.parts.garage?.end === e.i;
  if (rand() < (R.style.woodpile ?? .3) && R.archetype !== 'block' && (!annexed(wpEnd) || R.parts.leanTo?.open)) {
    const len = Math.min(3.2, r.hv * 1.2), out = annexed(wpEnd) ? .6 : .38;
    const x = wpEnd.c[0] + wpEnd.n[0] * out, z = wpEnd.c[1] + wpEnd.n[1] * out;
    add('woodpile', x, z, Math.atan2(wpEnd.t[1], wpEnd.t[0]), [len, .5, 1.1 + rand() * .6], 1);
  }
  if (R.barnEnd && rand() < D.hay) {
    const e = ends[R.barnEnd > 0 ? 0 : 1];
    const n = 2 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const off = (k - (n - 1) / 2) * 1.5, out = 3 + rand() * 1.5;
      add('hay', e.c[0] + e.n[0] * out + e.t[0] * off, e.c[1] + e.n[1] * out + e.t[1] * off, Math.atan2(e.t[1], e.t[0]) + (rand() - .5) * .5, [1.2, 1.2, 1.2], .9);
    }
  }
  // out the back: a vegetable garden with a low fence, a washing line
  const back = { c: [r.cx - f.n[0] * (R.front % 2 === 0 ? r.hv : r.hu), r.cz - f.n[1] * (R.front % 2 === 0 ? r.hv : r.hu)], n: [-f.n[0], -f.n[1]], t: [-f.t[0], -f.t[1]] };
  if (rand() < D.garden && R.archetype !== 'block') {
    const out = 3.2 + rand(), gx = back.c[0] + back.n[0] * out, gz = back.c[1] + back.n[1] * out;
    add('garden', gx, gz, Math.atan2(back.t[1], back.t[0]), [3.5 + rand() * 2, 2.6 + rand(), .12], 2.6, { fence: rand() < D.fence * 2 });
  }
  if (rand() < D.laundry) {
    const out = 2.4, off = (rand() - .5) * 3;
    add('laundry', back.c[0] + back.n[0] * out + back.t[0] * off, back.c[1] + back.n[1] * out + back.t[1] * off, Math.atan2(back.t[1], back.t[0]), [3, .1, 1.8], 1.6, { tone: rand() });
  }
  // a dish on a side wall, a trough in a village square
  if (rand() < D.dish && R.floors >= 2) {
    const e = ends[rand() < .5 ? 0 : 1];
    add('dish', e.c[0] + e.n[0] * .25 + e.t[0] * (rand() - .5) * r.hv, e.c[1] + e.n[1] * .25 + e.t[1] * (rand() - .5) * r.hv, Math.atan2(e.n[1], e.n[0]), [.6, .2, .6], .2, { y: R.floorH * 1.6 });
  }
  if (R.dens >= 6 && R.archetype === 'village' && rand() < D.trough * .35 && ctx.claimTrough(R.x, R.z)) {
    const [x, z] = at(f.len + 1.8, 2.2);
    add('trough', x, z, yawT, [2.1, .75, .75], 1.4);
  }
  return items;
}

/** The door's u along the front segment (null: none). */
function doorU(R, f) {
  if (['church', 'works', 'ruin'].includes(R.archetype)) return null;
  const n = f.bays.n;
  const k = R.shop ? Math.floor(n / 2) : R.archetype === 'village' ? Math.floor(R.seed * 97 % 1 * n) : Math.floor(n / 2);
  return (k + .5) * f.bays.w;
}
