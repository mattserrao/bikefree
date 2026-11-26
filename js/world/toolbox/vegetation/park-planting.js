// Park planting along the ways (user, 25 Nov 2026 — the Zwift reference, Central Park Loop): two passes a map turns on
// in its profile, both along the ways of the kinds it names, tile by tile, through the city's own placing rules:
//
//   avenue      { kinds: ['drive'], every: 11, offset: [4.5, 8], lean: .09, gap: .18, role: 'avenue' }
//               a row of big trees each side of the way, one every ~`every` m (jittered, a few gaps), `offset` m out
//               from its edge (past any sidewalk), each leaning out over the way (lean: the top's offset per metre of
//               height) and let to reach over it — the canopy tunnel ("trunks lean in, branches arch over the road").
//               Where a tree already stands within ~5 m (OSM's mapped rows) none is added.
//   understory  { kinds: ['drive', 'path'], band: [2.2, 9], step: 1.7, density: .55, mix: [[name, weight]…] }
//               bushes in continuous drifts along the way's sides: a slow noise along each side decides where a drift
//               runs (density: the share of the side in drifts), and in a drift a bush every ~`step` m somewhere in the
//               band (m out from the edge), the odd fern or sapling among them ("a continuous understory band").
//
// planParkPlanting(ctx) is a generator (it yields when the slice is used: jobs.js due()). ctx: { pieces, half(e),
// walk(e), tree(x, z, role, seed, age, extra), under(x, z, name, seed, s), occupied(x, z, r), landOk(x, z),
// avenue, understory }.
import { hash } from '../core/mesh-builder.js';
import { due } from '../core/jobs.js';

const vnoise1 = (x, seed) => {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  const a = hash(i * 127.1 + seed * 311.7), b = hash((i + 1) * 127.1 + seed * 311.7);
  return a + (b - a) * u;
};
const pick = (mix, r) => { let tot = 0; for (const [, w] of mix) tot += w; let a = 0; for (const [n, w] of mix) { a += w / tot; if (r <= a) return n; } return mix[mix.length - 1][0]; };
export const BUSH_MIX = [['bushGreen', 34], ['bushLow', 20], ['bushYellow', 16], ['bushRed', 12], ['bushHedge', 12], ['fern', 4], ['sapling', 2]];

export function* planParkPlanting(ctx) {
  const { pieces, avenue, understory } = ctx;
  const done = new Set();
  for (const { e, a, b } of pieces) {
    if (due()) yield;
    const id = `${e.id}:${a}`; if (done.has(id)) continue; done.add(id);
    const half = ctx.half(e), walk = ctx.walk(e) || 0;
    const along = (i, f, side, off) => {
      const i0 = Math.min(e.n - 1, i), dx = e.x[i0 + 1] - e.x[i0], dz = e.z[i0 + 1] - e.z[i0], l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l * side, nz = dx / l * side;
      const x = e.x[i0] + dx * f, z = e.z[i0] + dz * f;
      return { x: x + nx * off, z: z + nz * off, nx, nz };
    };
    const lenEnd = e.n * 10;
    // ---- the avenue trees
    if (avenue && avenue.kinds.includes(e.kind)) {
      const every = avenue.every ?? 11, [o0, o1] = avenue.offset || [4.5, 8], lean = avenue.lean ?? .09;
      for (const side of [-1, 1]) {
        // stations every `every` m (by the way's own metres, so a tile's pieces agree at their seams)
        const s0 = Math.ceil(a * 10 / every) * every, s1 = b * 10;
        for (let s = s0; s < s1; s += every) {
          if (s < 14 || s > lenEnd - 14) continue;   // (clear of the junctions at the ends)
          const seed = Math.round(s * 13.7 + side * 71 + e.n * 3.1 + e.x[0] * .37);
          if (hash(seed * 1.3) < (avenue.gap ?? .18)) continue;
          const sj = s + (hash(seed * 2.1) - .5) * every * .5, i = Math.floor(sj / 10), f = sj / 10 - i;
          if (i < 0 || i >= e.n || e._deck?.[i]) continue;
          const off = half + walk + o0 + hash(seed * 3.3) * (o1 - o0);
          const p = along(i, f, side, off);
          if (!ctx.landOk(p.x, p.z) || ctx.occupied(p.x, p.z, 5)) continue;
          const lk = lean * (.6 + hash(seed * 4.7) * .8);
          ctx.tree(p.x, p.z, avenue.role || 'avenue', seed, .9 + hash(seed * 5.9) * .35, { lean: [-p.nx * lk, -p.nz * lk], overhang: true });
        }
      }
    }
    // ---- the understory drifts
    if (understory && understory.kinds.includes(e.kind)) {
      const step = understory.step ?? 1.7, [b0, b1] = understory.band || [2.2, 9], dens = understory.density ?? .55, mix = understory.mix || BUSH_MIX;
      for (const side of [-1, 1]) {
        const seedSide = (e.n * 31 + Math.round(e.x[0] * 7 + e.z[0] * 3)) % 9973 + side * 5;
        const s0 = Math.ceil(a * 10 / step) * step, s1 = b * 10;
        for (let s = s0; s < s1; s += step) {
          if (s < 8 || s > lenEnd - 8) continue;
          // a drift: a slow wander along the side (~40 m swells), with breaks
          const drift = vnoise1(s / 38, seedSide) * .7 + vnoise1(s / 11, seedSide + 3) * .3;
          if (drift < 1 - dens) continue;
          const seed = Math.round(s * 17.3 + side * 53 + seedSide * 1.7);
          const i = Math.floor(s / 10), f = s / 10 - i;
          if (i < 0 || i >= e.n || e._deck?.[i]) continue;
          // thicker in the middle of a drift: a second bush a step out
          const n = drift > 1 - dens * .45 ? 2 : 1;
          for (let k = 0; k < n; k++) {
            const r = hash(seed * 1.7 + k * 9.1);
            const off = half + walk + b0 + Math.pow(hash(seed * 2.9 + k * 3.7), 1.4) * (b1 - b0) + k * 1.8;
            const p = along(i, f + (hash(seed * 5.1 + k) - .5) * step / 10, side, off);
            if (!ctx.landOk(p.x, p.z)) continue;
            ctx.under(p.x, p.z, pick(mix, r), seed + k * 101, .62 + hash(seed * 7.7 + k) * .38);
          }
        }
      }
    }
  }
}
