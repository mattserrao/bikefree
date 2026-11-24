// Toolbox vegetation: an old-growth hero area — the Camillus Forest Unique Area on CNY first (user, 24 Nov 2026:
// "Camillus unique area - captured in the understory - riding through lush meadows … We really want to push the tree
// engine here … so this is a highlight 'hero' area"; plan in the bikefree Project doc claude/camillus-forest.md).
// Portable: everything is driven by a small data file (tools/cny_forest.py → routes/cities/<map>-oldgrowth.json: the
// boundary, the trail edges, the green tunnel, the old apple trees) and the land codes inside the boundary
// (30 old growth, 31 woods, 32 tall meadow, 33 blowdown). What it adds to a road-graph map:
//
//   placement   lifelike rules for the tree engine (trees stay 2D cards — user's choice): dominant canopy trees on a
//               jittered grid (crown competition: an old stand's giants ~12 m apart, the younger woods ~10 m),
//               intermediates only where no dominant is near, a few shade-tolerant saplings (beech, sugar maple)
//               struggling in the shade and a thicket of them in the blowdown's sun, ~6 % snags, the forest-grown
//               forms (long clean boles, high narrow crowns); thick tree walls where the woods meet a meadow; the
//               green tunnel's two rows; old apple trees in the meadow
//   the floor   a fine skirt of ground (2 m cells) along the trails (the 12.8 m grid can't carry it): old growth's
//               pit-and-mound undulations (tip-up mounds, the hollows their root plates tore up, a slow roll), worn
//               earth on the tread's edge; on it big fallen trunks, nurse logs with seedlings on their backs, tip-ups
//               with their root plates on end, ferns, herbs, seedlings, roots across the tread
//   overhead    a leaf layer over the trails in the woods (user: "lush canopies joining together above"): leaf-cluster
//               cards 20–30 m up, closing the sky, with gaps where the light comes through
//   god rays    shafts of sun down through the gaps (user: "God rays through the overstory to the understory"), soft and
//               additive, and the warm pools of light they leave on the floor
//   meadows     tall, swaying, hay-coloured grass up to the trail's edge, the trail a narrow mown slit through it
//
//   const og = new OldGrowth({ world, city, data })
//   og.floorH(x, z)                 the ground as the skirt draws it (null outside the trails' band)
//   yield* og.treesJob(x0, z0, size, out, kit)   a tile's trees and understory for the tree engine
//   og.tick(camera, time)          builds / drops the near pieces as the rider moves
import * as THREE from '../../../../vendor/three.module.min.js';
import { hash } from '../core/mesh-builder.js';
import { due } from '../core/jobs.js';
import { grassAtlas } from '../landscape/grass-cards.js';
import { decorateTreeMaterial } from '../packs/northern-rockies.js';

export const OG = { old: 30, forest: 31, meadow: 32, blow: 33 };
const isWood = (c) => c === OG.old || c === OG.forest || c === OG.blow;
const BAND = 30;            // m: the skirt reaches this far from a trail's centre
const CELL = 2;             // m: the skirt's cells
const BLOCK = 128;          // m: the near pieces are built in squares this size
const SKIRT_NEAR = 420, SKIRT_FAR = 620;   // m: build within, drop beyond
const GRASS_NEAR = 230, GRASS_FAR = 330;
const CANOPY_LO = { [OG.old]: 25, [OG.forest]: 20.5, [OG.blow]: 23 };
// the 1998 Labor Day storm came out of the west-north-west: its windthrow lies toward the east-south-east
const FALL_YAW = -0.35;     // radians about +y: +x turned this far (three.js: +x → (cos, 0, −sin))

// ---- small deterministic helpers
const h2 = (i, j, k = 0) => hash((Math.imul(i | 0, 73856093) ^ Math.imul(j | 0, 19349663) ^ Math.imul(k | 0, 83492791)) >>> 0);
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function vnoise(x, z) {
  const i = Math.floor(x), j = Math.floor(z), u = x - i, v = z - j, f = (t) => t * t * (3 - 2 * t);
  const a = h2(i, j, 7), b = h2(i + 1, j, 7), c = h2(i, j + 1, 7), d = h2(i + 1, j + 1, 7), fu = f(u), fv = f(v);
  return a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv;
}
const pick = (mix, r) => { let a = 0, tot = 0; for (const [, w] of mix) tot += w; for (const [n, w] of mix) { a += w / tot; if (r <= a) return n; } return mix[mix.length - 1][0]; };
const pip = (ring, x, z) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c; } return c; };

// the stands' make-up (DEC: the old stand ~83 % sugar maple and ~13 % beech; the mature and younger woods ~90 % maple by
// count with beech, bitternut hickory, white ash and basswood)
const MIX = {
  [OG.old]: [['sugarmapleF', 80], ['beechF', 14], ['hickory', 3], ['basswood', 3]],
  [OG.forest]: [['sugarmapleF', 62], ['beechF', 14], ['hickory', 8], ['basswood', 7], ['whiteash', 9]],
  [OG.blow]: [['sugarmapleF', 70], ['beechF', 30]],
};
const MID = [['sugarmapleF', 55], ['beechF', 35], ['hickory', 10]];
const YOUNG = [['sugarmaple', 30], ['redmaple', 20], ['whiteash', 20], ['blackcherry', 20], ['birch', 10]];
const SPACING = { [OG.old]: 12.5, [OG.forest]: 10, [OG.blow]: 34 };

export class OldGrowth {
  constructor({ world, city, data }) {
    this.world = world; this.city = city; this.data = data;
    const P = world.proj;
    this.ring = data.boundary.map(([la, lo]) => P.toLocal(la, lo));
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of this.ring) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    this.box = { x0: x0 - 60, x1: x1 + 60, z0: z0 - 60, z1: z1 + 60 };
    this.trails = data.trails.map((id) => world.G.byId.get(id)).filter(Boolean);
    this.half = this.trails.length ? world.wOf(this.trails[0]) / 2 : .45;
    // a grid of the trails' segments (16 m cells) for "the trail near here"
    this.grid = new Map();
    const C = 16;
    for (const e of this.trails) for (let i = 0; i < e.n; i++) {
      const ax = Math.min(e.x[i], e.x[i + 1]), bx = Math.max(e.x[i], e.x[i + 1]), az = Math.min(e.z[i], e.z[i + 1]), bz = Math.max(e.z[i], e.z[i + 1]);
      for (let gx = Math.floor(ax / C); gx <= Math.floor(bx / C); gx++) for (let gz = Math.floor(az / C); gz <= Math.floor(bz / C); gz++) {
        const k = `${gx},${gz}`; let a = this.grid.get(k); if (!a) this.grid.set(k, (a = [])); a.push(e, i);
      }
    }
    this.tunnel = data.tunnel?.edge ? world.G.byId.get(data.tunnel.edge) : null;
    this.apples = (data.apples || []).map(([la, lo]) => P.toLocal(la, lo));
    // the blocks the trails pass through (the near pieces)
    this.blocks = new Map();
    for (const e of this.trails) for (let i = 0; i <= e.n; i++) {
      for (const [ox, oz] of [[-BAND, -BAND], [BAND, -BAND], [-BAND, BAND], [BAND, BAND], [0, 0]]) {
        const k = `${Math.floor((e.x[i] + ox) / BLOCK)},${Math.floor((e.z[i] + oz) / BLOCK)}`;
        if (!this.blocks.has(k)) { const [bi, bj] = k.split(',').map(Number); this.blocks.set(k, { key: k, i: bi, j: bj, cx: (bi + .5) * BLOCK, cz: (bj + .5) * BLOCK, skirt: null, grass: null, meadow: false }); }
      }
    }
    this.group = new THREE.Group(); this.group.name = 'Old growth (hero area)';
    city.host.group.add(this.group);
    this.uTime = city.treeTime;
    this.stats = { skirtBlocks: 0, grassBlocks: 0, canopyCards: 0, rays: 0 };
    const q = world.qualityKey;
    this.q = { grass: q === 'low' ? .5 : q === 'high' ? 1.15 : 1, cell: q === 'low' ? 2.5 : CELL, rays: q !== 'low' };
  }

  /** Inside the hero area (its boundary, with a margin). */
  contains(x, z, margin = 0) {
    const b = this.box;
    if (x < b.x0 - margin || x > b.x1 + margin || z < b.z0 - margin || z > b.z1 + margin) return false;
    return margin > 0 ? true : pip(this.ring, x, z);
  }
  touches(x0, z0, size) { const b = this.box; return !(x0 > b.x1 || x0 + size < b.x0 || z0 > b.z1 || z0 + size < b.z0); }

  /** The nearest trail point within r: { d (from the centre line), y (its height), e, i, t, dx, dz } or null. */
  trailNear(x, z, r = 8) {
    const C = 16, R = Math.ceil(r / C), gx = Math.floor(x / C), gz = Math.floor(z / C);
    let best = null;
    for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) {
      const arr = this.grid.get(`${gx + a},${gz + b}`); if (!arr) continue;
      for (let k = 0; k < arr.length; k += 2) {
        const e = arr[k], i = arr[k + 1], ax = e.x[i], az = e.z[i], dx = e.x[i + 1] - ax, dz = e.z[i + 1] - az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
        if (d > r || (best && d >= best.d)) continue;
        const l = Math.sqrt(l2);
        best = { d, y: e.ele[i] + (e.ele[i + 1] - e.ele[i]) * t, e, i, t, dx: dx / l, dz: dz / l, px, pz };
      }
    }
    return best;
  }
  land(x, z) { return this.city.landAt(x, z); }
  /** The nearest way that isn't one of the area's trails (a road it meets) within ~20 m: { d, half } or null. */
  roadNear(x, z) {
    const G = this.city._segGrid, w = this.world, gx = Math.floor(x / 20), gz = Math.floor(z / 20); let best = null;
    if (!G) return null;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const arr = G.get((gx + a + 0x8000) * 0x10000 + (gz + b + 0x8000)); if (!arr) continue;
      for (let k = 0; k < arr.length; k += 2) {
        const e = arr[k], i = arr[k + 1]; if (e._cf) continue;
        const ax = e.x[i], az = e.z[i], dx = e.x[i + 1] - ax, dz = e.z[i + 1] - az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), d = Math.hypot(x - ax - dx * t, z - az - dz * t);
        if (!best || d < best.d) best = { d, half: w.wOf(e) / 2 };
      }
    }
    return best;
  }

  /**
   * Old growth's floor relief (m): pit-and-mound — on a 7 m grid some cells hold a tip-up's mound (a rounded hump
   * 1.3–2.7 m across, 0.3–0.75 m high) with its pit beside it on the windward side — over a slow roll. Strongest in the
   * old stand and the blowdown, gentle in the younger woods, none in the meadows.
   */
  relief(x, z, code = this.land(x, z)) {
    const amp = code === OG.old ? 1 : code === OG.blow ? 1.25 : code === OG.forest ? .5 : 0;
    if (!amp) return 0;
    let h = (vnoise(x * .06, z * .06) - .5) * .7 + (vnoise(x * .17 + 3.1, z * .17 - 1.7) - .5) * .25;
    const S = 7, ci = Math.floor(x / S), cj = Math.floor(z / S), fx = Math.cos(FALL_YAW), fz = -Math.sin(FALL_YAW);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const i = ci + a, j = cj + b, r0 = h2(i, j, 11);
      if (r0 > (code === OG.blow ? .62 : code === OG.old ? .45 : .25)) continue;
      const mx = (i + .25 + h2(i, j, 12) * .5) * S, mz = (j + .25 + h2(i, j, 13) * .5) * S;
      const R = 1.3 + h2(i, j, 14) * 1.4, Hm = .3 + h2(i, j, 15) * .45;
      const d = Math.hypot(x - mx, z - mz) / R; if (d < 1) h += Hm * (1 - d * d) ** 2;
      // the pit: where the root plate came up, beside the mound toward where the wind came from
      const px = mx - fx * R * 1.3, pz = mz - fz * R * 1.3, dp = Math.hypot(x - px, z - pz) / (R * .9);
      if (dp < 1) h -= Hm * .7 * (1 - dp * dp) ** 2;
    }
    return h * amp;
  }

  /** The floor as the skirt draws it at (x, z): on the trail its tread's height, out from it the ground with its relief,
   *  never under the coarse ground's mesh (null beyond the trails' band). */
  floorH(x, z, r = this.trailNear(x, z, BAND)) {
    if (!r) return null;
    const W = this.world, code = this.land(x, z);
    const nat = W.ground.at(x, z), surf = W.surfaceH(x, z);
    // out toward the band's edge: the coarse mesh's own height (no step where the skirt ends)
    const toEdge = sstep(BAND - 8, BAND, r.d);
    let y = nat + (surf - nat) * toEdge + this.relief(x, z, code) * (1 - toEdge);
    const w = sstep(this.half + .6, this.half + 5, r.d);
    y = (r.y + .02) + (y - (r.y + .02)) * w;
    return Math.max(y, surf + .04);
  }
  /** A spot's floor: the skirt's where it is, else the world's ground. */
  groundY(x, z) { return this.floorH(x, z) ?? this.world._groundH(x, z); }

  // ------------------------------------------------------------------ placement (the tree engine's trees)
  /**
   * A tile's trees and understory in the hero area, pushed onto out as the tree engine takes them
   * ({ x, y, z, sp, v, s, sy, rot, tint, deep }). `clear(x, z, r)`: the city's own test (water, buildings, …).
   */
  *treesJob(x0, z0, size, out, kit, clear = () => true) {
    const self = this, sp = kit.species, us = kit.understory, half = this.half;
    const inTile = (x, z) => x >= x0 && x < x0 + size && z >= z0 && z < z0 + size;
    const put = (x, z, name, s, rot, seed, { sy = s, v = 0, deep = false, under = false } = {}) => {
      if (!(sp[name] || us[name])) return false;
      const rd = self.roadNear(x, z); if (rd && rd.d - rd.half < (under ? 2.5 : 4)) return false;   // (Thompson Road: the city's own rules)
      out.push({ x, y: self.groundY(x, z) - (under ? .04 : .12), z, sp: name, v, s, sy, rot, tint: .9 + h2(seed, 3, 9) * .18, deep });
      return true;
    };
    // a trunk's clearance from the tread (and a crown card mustn't hide the trail at the rider's eye: the forest-grown
    // forms carry their crowns high, so they may stand close; a younger tree keeps a little farther off)
    const trailOk = (x, z, minD) => { const r = self.trailNear(x, z, minD + 1); return !r || r.d >= half + minD; };
    const variantOf = (name, r) => (sp[name]?.variants.length > 1 ? (sp[name].forest ? (r < .7 ? 0 : 1) : (r < .66 ? 0 : r < .86 ? 1 : 2)) % sp[name].variants.length : 0);
    // ---- the dominants: one per cell of each stand's grid (the cell's code must be the stand's), jittered within it
    const dom = (S, code, i, j) => {
      const x = (i + .2 + h2(i, j, code) * .6) * S, z = (j + .2 + h2(i, j, code + 50) * .6) * S;
      return self.land(x, z) === code ? { x, z } : null;
    };
    const domNear = (x, z, R) => {
      for (const code of [OG.old, OG.forest, OG.blow]) {
        const S = SPACING[code], ci = Math.floor(x / S), cj = Math.floor(z / S);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const p = dom(S, code, ci + a, cj + b); if (p && Math.hypot(p.x - x, p.z - z) < R) return true; }
      }
      return false;
    };
    for (const code of [OG.old, OG.forest, OG.blow]) {
      const S = SPACING[code];
      for (let i = Math.floor(x0 / S) - 1; i <= Math.floor((x0 + size) / S) + 1; i++) {
        if (due()) yield;
        for (let j = Math.floor(z0 / S) - 1; j <= Math.floor((z0 + size) / S) + 1; j++) {
          const p = dom(S, code, i, j); if (!p || !inTile(p.x, p.z) || !clear(p.x, p.z, 3)) continue;
          const r = self.trailNear(p.x, p.z, 4);
          if (r && (r.d < half + 1.0 || (r.d < 3.5 && h2(i, j, 31) > .4))) continue;   // a few right at the tread's edge, most a step back
          const seed = i * 7919 + j * 131 + code, r1 = h2(i, j, 21), r2 = h2(i, j, 22), r3 = h2(i, j, 23);
          const snag = r3 < .06;
          const name = snag ? 'snag' : pick(MIX[code], r1);
          const k = snag ? 1.2 + r2 * .35 : code === OG.old ? .98 + r2 * .27 : code === OG.blow ? .95 + r2 * .2 : .82 + r2 * .22;
          put(p.x, p.z, name, k, h2(i, j, 24) * 6.283, seed, { sy: k * (.95 + r3 * .1), v: snag ? Math.floor(r1 * 3) % 3 : variantOf(name, h2(i, j, 25)), deep: !self.trailNear(p.x, p.z, 30) });
        }
      }
    }
    // ---- intermediates (younger trees of the shade-tolerant kinds, where no dominant's crown is over them), saplings,
    // seedlings, the floor's plants and the coarse woody debris; the woods' edge against the meadows
    const S2 = 6.5;
    for (let i = Math.floor(x0 / S2); i < Math.ceil((x0 + size) / S2); i++) {
      if (due()) yield;
      for (let j = Math.floor(z0 / S2); j < Math.ceil((z0 + size) / S2); j++) {
        const x = (i + .15 + h2(i, j, 41) * .7) * S2, z = (j + .15 + h2(i, j, 42) * .7) * S2;
        if (!inTile(x, z)) continue;
        const code = self.land(x, z);
        if (!isWood(code) && code !== OG.meadow) continue;
        const r = self.trailNear(x, z, 70), d = r ? r.d : 99, seed = i * 6151 + j * 89;
        // the woods' edge against a meadow: a thick wall of young trees and shrubs (user: "meadows, bordered by thick tree stands")
        let edge = false;
        if (isWood(code)) for (const [ox, oz] of [[12, 0], [-12, 0], [0, 12], [0, -12]]) if (self.land(x + ox, z + oz) === OG.meadow) { edge = true; break; }
        if (edge) {
          for (let q = 0; q < 3; q++) {
            const qx = x + (h2(i, j, 60 + q) - .5) * S2, qz = z + (h2(i, j, 63 + q) - .5) * S2, rr = h2(i, j, 66 + q);
            if (!inTile(qx, qz) || !trailOk(qx, qz, 10) || !clear(qx, qz, 1.5)) continue;   // (a low crown never right over the tread)
            if (rr < .45) put(qx, qz, pick(YOUNG, h2(i, j, 70 + q)), .4 + h2(i, j, 73 + q) * .4, h2(i, j, 76 + q) * 6.28, seed + q, { v: variantOf('sugarmaple', h2(i, j, 79 + q)) });
            else put(qx, qz, rr < .65 ? 'buckthorn' : rr < .82 ? 'dogwood' : rr < .92 ? 'sumac' : 'sapling', .8 + h2(i, j, 82 + q) * .5, h2(i, j, 85 + q) * 6.28, seed + q, { under: true });
          }
          continue;
        }
        if (code === OG.meadow) {
          // the meadow side of a woods' edge: brush creeping out; goldenrod in drifts away from the trail
          let near = false; for (const [ox, oz] of [[5, 0], [-5, 0], [0, 5], [0, -5]]) if (isWood(self.land(x + ox, z + oz))) { near = true; break; }
          if (near && h2(i, j, 90) < .45 && trailOk(x, z, 9)) put(x, z, h2(i, j, 91) < .5 ? 'goldenrod' : 'dogwood', .8 + h2(i, j, 92) * .4, h2(i, j, 93) * 6.28, seed, { under: true });
          else if (d > 5 && vnoise(x * .05, z * .05) > .66 && h2(i, j, 94) < .35) put(x, z, 'goldenrod', .9 + h2(i, j, 95) * .4, h2(i, j, 96) * 6.28, seed, { under: true });
          continue;
        }
        if (!clear(x, z, 1.5)) continue;
        // intermediates: under no dominant's crown
        if (code !== OG.blow && h2(i, j, 43) < .5 && !domNear(x, z, SPACING[code] * .5) && trailOk(x, z, 1.6)) {
          const name = pick(MID, h2(i, j, 44)), k = .55 + h2(i, j, 45) * .27;
          put(x, z, name, k, h2(i, j, 46) * 6.28, seed, { sy: k * (1 + h2(i, j, 47) * .12), v: variantOf(name, h2(i, j, 48)), deep: d > 30 });
          continue;
        }
        if (code === OG.blow) {
          // the blowdown's sun: a thicket of saplings and young trees fighting up through raspberry and brush
          for (let q = 0; q < 4; q++) {
            const qx = x + (h2(i, j, 100 + q) - .5) * S2, qz = z + (h2(i, j, 104 + q) - .5) * S2, rr = h2(i, j, 108 + q);
            if (!inTile(qx, qz)) continue;
            // (28 years on, the regrowth is a stand of poles 10–15 m tall, their crowns over the rider's head; the
            //  saplings and brambles under them)
            // (nothing leafy at eye level within ~9 m of the tread: a 2D card that close is all magnified blur — the poles,
            //  their crowns overhead, may stand nearer)
            if (rr >= .3 && !trailOk(qx, qz, 9)) continue;
            if (rr < .3) { if (trailOk(qx, qz, 2.6)) put(qx, qz, h2(i, j, 112 + q) < .7 ? 'sugarmapleF' : 'beechF', .36 + h2(i, j, 116 + q) * .16, h2(i, j, 120 + q) * 6.28, seed + q, { v: h2(i, j, 124 + q) < .75 ? 0 : 1 }); }
            else if (rr < .62) put(qx, qz, rr < .48 ? 'sapling' : 'beechSapling', .7 + h2(i, j, 128 + q) * .6, h2(i, j, 132 + q) * 6.28, seed + q, { under: true });
            else if (rr < .85) put(qx, qz, rr < .74 ? 'buckthorn' : 'dogwood', .7 + h2(i, j, 136 + q) * .5, h2(i, j, 140 + q) * 6.28, seed + q, { under: true });
          }
        } else if (d < 45 && h2(i, j, 49) < .22 && trailOk(x, z, 9)) {
          // the shade: a few saplings trying to break through (user: "a few, small saplings trying to break their way through")
          put(x, z, h2(i, j, 50) < .55 ? 'beechSapling' : 'sapling', .55 + h2(i, j, 51) * .6, h2(i, j, 52) * 6.28, seed, { under: true });
        }
      }
    }
    // ---- the floor near the trails: plants and seedlings (3 m grid), and the coarse woody debris (9 m grid)
    const S3 = 3;
    for (let i = Math.floor(x0 / S3); i < Math.ceil((x0 + size) / S3); i++) {
      if (due()) yield;
      for (let j = Math.floor(z0 / S3); j < Math.ceil((z0 + size) / S3); j++) {
        const x = (i + h2(i, j, 141)) * S3, z = (j + h2(i, j, 142)) * S3;
        if (!inTile(x, z)) continue;
        const code = self.land(x, z); if (!isWood(code)) continue;
        const r = self.trailNear(x, z, 40); if (!r || r.d < half + .7) continue;
        const damp = vnoise(x * .07 + 9, z * .07 - 4), q = h2(i, j, 143), seed = i * 3301 + j * 17;
        if (q < damp * .7 - .1) put(x, z, h2(i, j, 144) < .55 ? (h2(i, j, 145) < .5 ? 'fern' : 'fern2') : 'herb', .7 + damp * .6, h2(i, j, 146) * 6.28, seed, { under: true });
        else if (r.d < 22 && q > .9) put(x, z, 'seedling', .45 + h2(i, j, 147) * .35, h2(i, j, 148) * 6.28, seed, { under: true });
      }
    }
    const S4 = 9;
    for (let i = Math.floor(x0 / S4); i < Math.ceil((x0 + size) / S4); i++) {
      if (due()) yield;
      for (let j = Math.floor(z0 / S4); j < Math.ceil((z0 + size) / S4); j++) {
        const x = (i + .1 + h2(i, j, 151) * .8) * S4, z = (j + .1 + h2(i, j, 152) * .8) * S4;
        if (!inTile(x, z)) continue;
        const code = self.land(x, z); if (!isWood(code)) continue;
        const r = self.trailNear(x, z, 75); if (!r) continue;
        // (the logs themselves are 3D, not cards: _logs — a 16 m log turned to face the camera swung across the view)
        const p = code === OG.blow ? .5 : code === OG.old ? .3 : .14, q = h2(i, j, 153);
        if (q < p) { /* a log: _logs */ } else if (q < p + .08 && r.d > 2) put(x, z, q < p + .04 ? 'stump2' : 'rock2', .8 + h2(i, j, 157) * .5, h2(i, j, 158) * 6.28, i * 31 + j, { under: true });
      }
    }
    // ---- the green tunnel: two rows of trees along the trail across the meadow, their crowns meeting over it
    if (this.tunnel) {
      const e = this.tunnel;
      for (let i = 1; i < e.n; i++) for (const side of [-1, 1]) {
        if (i % 1 !== 0) continue;
        const dx = e.x[i + 1] - e.x[i - 1], dz = e.z[i + 1] - e.z[i - 1], l = Math.hypot(dx, dz) || 1;
        for (const f of [0, .5]) {
          const x = e.x[i] + (e.x[i + 1] - e.x[i]) * f - dz / l * side * (3.3 + h2(i, side, 160) * .9), z = e.z[i] + (e.z[i + 1] - e.z[i]) * f + dx / l * side * (3.3 + h2(i, side, 161) * .9);
          if (!inTile(x, z) || self.land(x, z) !== OG.meadow) continue;
          const name = pick([['sugarmaple', 40], ['blackcherry', 25], ['whiteash', 20], ['redoak', 15]], h2(i * 2 + (f ? 1 : 0), side, 162));
          put(x, z, name, .72 + h2(i, side, 163) * .2, h2(i, side, 164) * 6.28, i * 13 + side, { v: variantOf(name, h2(i, side, 165)) });
        }
      }
    }
    // ---- the old orchard's apple trees (DEC: ~100 left from the farm days; a crab apple, grown old and big)
    for (const a of this.apples) {
      if (!inTile(a.x, a.z) || self.land(a.x, a.z) !== OG.meadow || !trailOk(a.x, a.z, 3)) continue;
      const k = 1.2 + h2(Math.round(a.x), Math.round(a.z), 170) * .35;
      put(a.x, a.z, 'crabapple', k, h2(Math.round(a.x), 1, 171) * 6.28, Math.round(a.x * 3), { sy: k * 1.05, v: h2(Math.round(a.z), 1, 172) < .7 ? 0 : 1 });
    }
  }

  // ------------------------------------------------------------------ the coarse woody debris (3D)
  /**
   * The fallen trunks (user: "dead logs … nurse logs and life"): on a 9 m grid within 75 m of a trail — the blowdown's
   * tip-ups and trunks lying the storm's way, the old stand's big logs and nurse logs, the younger woods' fewer — never
   * across the tread. 3D models (the kit's bigLog, nurseLog, tipup, log), not cards; drawn within LOG_R of the camera.
   */
  _logList() {
    if (this.logList) return this.logList;
    const out = [], S4 = 9, b = this.box, half = this.half;
    for (let i = Math.floor(b.x0 / S4); i <= Math.ceil(b.x1 / S4); i++) for (let j = Math.floor(b.z0 / S4); j <= Math.ceil(b.z1 / S4); j++) {
      const x = (i + .1 + h2(i, j, 151) * .8) * S4, z = (j + .1 + h2(i, j, 152) * .8) * S4;
      const code = this.land(x, z); if (!isWood(code)) continue;
      const r = this.trailNear(x, z, 75); if (!r) continue;
      const p = code === OG.blow ? .5 : code === OG.old ? .3 : .14, q = h2(i, j, 153);
      if (q >= p) continue;
      const t = h2(i, j, 154);
      const name = code === OG.blow ? (t < .55 ? 'tipup' : 'bigLog') : code === OG.old ? (t < .45 ? 'bigLog' : t < .8 ? 'nurseLog' : 'tipup') : (t < .5 ? 'bigLog' : t < .75 ? 'log' : 'nurseLog');
      const s = name === 'log' ? 1.2 : .8 + h2(i, j, 155) * .4;
      const rot = (code === OG.blow || name === 'tipup') ? FALL_YAW + (h2(i, j, 156) - .5) * .8 : h2(i, j, 156) * 6.28;
      const L = (name === 'log' ? 7 : name === 'nurseLog' ? 13 : name === 'tipup' ? 17 : 16) * s, cx = Math.cos(rot), cz = -Math.sin(rot);
      // (the log model 'log' lies centred on its origin; the others run out along +x from the root end)
      const a0 = name === 'log' ? -.5 : 0;
      let ok = true, y = Infinity;
      for (let k = 0; k <= 8 && ok; k++) {
        const f = a0 + k / 8, px = x + cx * L * f, pz = z + cz * L * f, rr = this.trailNear(px, pz, half + 1.4);
        if (rr && rr.d < half + 1.1) ok = false;
        else if (k % 4 === 0) y = Math.min(y, this.groundY(px, pz));
      }
      if (ok) out.push({ x, z, y: y - .06, rot, s, name });
    }
    return (this.logList = out);
  }
  _logs(cx, cz) {
    const R = 240, kit = this.city.treeKit?.logs; if (!kit) return;
    if (!this.logMeshes) {
      this.logMat = decorateTreeMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95 }), { uTime: this.uTime });
      this.logMeshes = {};
      for (const name of ['bigLog', 'nurseLog', 'tipup', 'log']) {
        const g = kit[name]; if (!g?.isBufferGeometry) continue;
        const im = new THREE.InstancedMesh(g, this.logMat, 64); im.count = 0; im.frustumCulled = false; im.name = `Old growth ${name}`; im.receiveShadow = true;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.add(im); this.logMeshes[name] = im;
      }
    }
    const near = {}, m = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), sc = new THREE.Vector3();
    for (const L of this._logList()) if (Math.abs(L.x - cx) < R && Math.abs(L.z - cz) < R && Math.hypot(L.x - cx, L.z - cz) < R) (near[L.name] ||= []).push(L);
    for (const [name, im0] of Object.entries(this.logMeshes)) {
      let im = im0; const list = near[name] || [];
      if (list.length > im.instanceMatrix.count) {
        const nim = new THREE.InstancedMesh(im.geometry, im.material, Math.ceil(list.length * 1.4)); nim.frustumCulled = false; nim.name = im.name; nim.receiveShadow = true;
        nim.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.remove(im); im.dispose(); this.group.add(nim); this.logMeshes[name] = im = nim;
      }
      list.forEach((L, k) => { q.setFromAxisAngle(Y, L.rot); p.set(L.x, L.y, L.z); sc.setScalar(L.s); im.setMatrixAt(k, m.compose(p, q, sc)); });
      im.count = list.length; im.instanceMatrix.needsUpdate = true;
    }
    this.stats.logs = Object.values(near).reduce((a, l) => a + l.length, 0);
  }

  // ------------------------------------------------------------------ the near pieces
  /** Everything near the camera built now (a snapshot; the first frame of a ride). */
  prepare(camera) { this._last = null; this._logAt = null; this.tick(camera, this.uTime?.value ?? 0); }
  tick(camera, time) {
    const cx = camera.position.x, cz = camera.position.z;
    if (!this.contains(cx, cz, 900)) {
      if (this.canopy) this._dropCanopy();
      for (const B of this.blocks.values()) { this._dropSkirt(B); this._dropGrass(B); }
      return;
    }
    if (!this.canopy && this.world.ground && this.city.land) this._buildCanopy();
    if (this.world.ground && this.city.land && (!this._logAt || Math.hypot(cx - this._logAt.x, cz - this._logAt.z) > 20)) { this._logAt = { x: cx, z: cz }; this._logs(cx, cz); }
    // all at once while loading, or when the camera has jumped (a new ride, a snapshot); else a piece a frame
    const jumped = !this._last || Math.hypot(cx - this._last.x, cz - this._last.z) > 150;
    this._last = { x: cx, z: cz };
    let budget = this.world._preload || jumped ? 999 : 1;
    // nearest first
    const list = [...this.blocks.values()].map((B) => ({ B, d: Math.hypot(B.cx - cx, B.cz - cz) - BLOCK * .71 })).sort((a, b) => a.d - b.d);
    for (const { B, d } of list) {
      if (d > SKIRT_FAR) this._dropSkirt(B); else if (d < SKIRT_NEAR && !B.skirt && budget > 0 && this.world.ground) { this._buildSkirt(B); budget--; }
      if (d > GRASS_FAR) this._dropGrass(B); else if (d < GRASS_NEAR && !B.grass && budget > 0 && this.city.land) { this._buildGrass(B); budget--; }
    }
    if (this.rayMat) this.rayMat.uniforms.uTime.value = time;
  }

  /** The skirt: a fine ground along the trails (BAND either side), the land shader's own material; and the roots
   *  across the tread in the woods. */
  _buildSkirt(B) {
    const W = this.world, cell = this.q.cell, n = Math.round(BLOCK / cell), n1 = n + 1, x0 = B.i * BLOCK, z0 = B.j * BLOCK;
    const pos = new Float32Array(n1 * n1 * 3), col = new Float32Array(n1 * n1 * 3), lw = new Float32Array(n1 * n1), inside = new Uint8Array(n1 * n1);
    const grass = new THREE.Color('#89a868'), earth = new THREE.Color('#7a6248'), mown = new THREE.Color('#93ad62'), tmp = new THREE.Color();
    for (let j = 0, k = 0; j <= n; j++) for (let i = 0; i <= n; i++, k++) {
      const x = x0 + i * cell, z = z0 + j * cell, r = this.trailNear(x, z, BAND + 1);
      const rd = r && this.roadNear(x, z);   // (not over a road the trail meets: the road keeps its own ground)
      if (!r || r.d > BAND || (rd && rd.d < rd.half + 7)) { pos[3 * k] = x; pos[3 * k + 2] = z; continue; }
      inside[k] = 1;
      const y = this.floorH(x, z, r), code = this.land(x, z);
      pos[3 * k] = x; pos[3 * k + 1] = y; pos[3 * k + 2] = z;
      // the tread's worn edge: bare earth in the woods, a mown strip in the meadow (the vertex colour shows through the
      // land's colour there)
      const wear = 1 - sstep(this.half + .3, this.half + 1.3, r.d);
      tmp.copy(grass); let w = 1;
      if (wear > 0) { if (code === OG.meadow) { tmp.lerp(mown, wear); w = 1 - wear * .8; } else if (isWood(code)) { tmp.lerp(earth, wear); w = 1 - wear * .6; } }
      col[3 * k] = tmp.r; col[3 * k + 1] = tmp.g; col[3 * k + 2] = tmp.b; lw[k] = w;
    }
    const idx = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = j * n1 + i, b = a + 1, c = a + n1, d = c + 1;
      if (inside[a] && inside[b] && inside[c] && inside[d]) idx.push(a, c, b, b, c, d);
    }
    if (!idx.length) { B.skirt = new THREE.Object3D(); return; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aLandW', new THREE.BufferAttribute(lw, 1));
    g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, W.mats.ground); m.name = `Old growth floor ${B.key}`; m.receiveShadow = true;
    this.group.add(m); B.skirt = m;
    // roots across the tread (the woods): a dark, half-buried root every so often, and a stone
    const P = [], C = [], I = [];
    const root = new THREE.Color('#5e4a37'), stone = new THREE.Color('#8b897f');
    const box = (cx, cy, cz, ux, uz, len, wid, hgt, c) => {
      const vx = -uz, vz = ux, base = P.length / 3;
      for (const [s, t, h] of [[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]) {
        P.push(cx + ux * s * len / 2 + vx * t * wid / 2, cy + h * hgt - .02, cz + uz * s * len / 2 + vz * t * wid / 2); C.push(c.r, c.g, c.b);
      }
      for (const q of [[4, 5, 6, 4, 6, 7], [0, 1, 5, 0, 5, 4], [1, 2, 6, 1, 6, 5], [2, 3, 7, 2, 7, 6], [3, 0, 4, 3, 4, 7]]) for (const v of q) I.push(base + v);
    };
    for (const e of this.trails) for (let i = 0; i < e.n; i++) {
      const mx = (e.x[i] + e.x[i + 1]) / 2, mz = (e.z[i] + e.z[i + 1]) / 2;
      if (mx < x0 || mx >= x0 + BLOCK || mz < z0 || mz >= z0 + BLOCK || !isWood(this.land(mx, mz))) continue;
      const dx = e.x[i + 1] - e.x[i], dz = e.z[i + 1] - e.z[i], l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
      for (let q = 0; q < 3; q++) {
        const r = h2(i, e.n + q, e.id.length * 7); if (r > .45) continue;
        const f = (q + h2(i, q, 3)) / 3, x = e.x[i] + dx * f, z = e.z[i] + dz * f, y = e.ele[i] + (e.ele[i + 1] - e.ele[i]) * f + .02;
        const a = (h2(i, q, 4) - .5) * .9, cx_ = Math.cos(a) * -uz - Math.sin(a) * ux, cz_ = Math.cos(a) * ux + Math.sin(a) * -uz;   // across the tread, askew
        if (r < .36) box(x, y, z, cx_, cz_, this.half * 2 + .5, .08 + r * .1, .06 + r * .05, root);
        else box(x + ux * .1, y, z + uz * .1, ux, uz, .22, .18, .07, stone);
      }
    }
    if (I.length) {
      const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); rg.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); rg.setIndex(I); rg.computeVertexNormals();
      this.rootMat ||= new THREE.MeshLambertMaterial({ vertexColors: true });
      const rm = new THREE.Mesh(rg, this.rootMat); rm.name = `Old growth roots ${B.key}`; rm.receiveShadow = true; this.group.add(rm); B.roots = rm;
    }
    this.stats.skirtBlocks++;
  }
  _dropSkirt(B) {
    for (const k of ['skirt', 'roots']) { const m = B[k]; if (!m) continue; this.group.remove(m); m.geometry?.dispose(); B[k] = null; }
    if (B.skirt === null && this.stats.skirtBlocks > 0) {}
  }

  /** The meadow's tall grass along the trails: hay-coloured, past the knee to the hip, swaying, right to the mown slit
   *  the trail cuts through it (user: "the grass is tall and swaying … the bike path is a narrow slit through the
   *  grasses"). Two crossed picture cards a plant (grass-cards.js's atlas: the tall-grass and turf cells). */
  _buildGrass(B) {
    const x0 = B.i * BLOCK, z0 = B.j * BLOCK, half = this.half, dens = this.q.grass;
    const P = [], U = [], C = [], K = [], I = [];
    const W = 1024, CW = 256;
    const card = (x, y, z, cell, w, h, yaw, r, g, b) => {
      const u0 = (cell * CW + 8) / W, u1 = ((cell + 1) * CW - 3) / W;
      for (const a of [yaw, yaw + Math.PI / 2]) {
        const c = Math.cos(a) * w / 2, s = Math.sin(a) * w / 2, base = P.length / 3;
        P.push(x - c, y - .05, z - s, x + c, y - .05, z + s, x + c, y + h, z + s, x - c, y + h, z - s);
        U.push(u0, .03, u1, .03, u1, .99, u0, .99);
        for (let q = 0; q < 4; q++) { C.push(r, g, b); K.push(q < 2 ? 0 : h); }
        I.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    };
    // the hay's tints over the atlas's greens: straw, tan, olive, a dull green at the foot of the stand
    const TINT = [[1.08, .9, .62], [.98, .8, .55], [.86, .82, .55], [.74, .78, .5], [1.1, .96, .7]];
    for (const [S, d0, d1, cellK] of [[.75 / Math.sqrt(dens), 0, 7, 1], [1.15 / Math.sqrt(dens), 7, 15, 1], [1.7 / Math.sqrt(dens), 15, 26, 1]]) {
      const n = Math.ceil(BLOCK / S);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const gi = Math.floor(x0 / S) + i, gj = Math.floor(z0 / S) + j;
        const x = (gi + h2(gi, gj, 201)) * S, z = (gj + h2(gi, gj, 202)) * S;
        if (x < x0 || x >= x0 + BLOCK || z < z0 || z >= z0 + BLOCK) continue;
        if (this.land(x, z) !== OG.meadow) continue;
        const r = this.trailNear(x, z, d1 + 1); if (!r || r.d < d0 || r.d >= d1) continue;
        const y = this.floorH(x, z, r) ?? this.world._groundH(x, z);
        if (r.d < half + .08) continue;
        const t = TINT[Math.floor(h2(gi, gj, 203) * TINT.length)], v = .9 + h2(gi, gj, 204) * .2;
        if (r.d < half + .95) {   // the mown strip: low turf either side of the tread
          card(x, y, z, 0, .5 + h2(gi, gj, 205) * .2, .22 + h2(gi, gj, 206) * .12, h2(gi, gj, 207) * 6.28, .78 * v, .86 * v, .62 * v);
          continue;
        }
        // the stand: taller away from the edge (a mown edge's regrowth is shorter), leaning a little over the slit
        const tall = 1.0 + h2(gi, gj, 208) * .55 - (r.d < half + 2 ? .25 : 0);
        card(x, y, z, cellK, 1.05 + h2(gi, gj, 209) * .4, tall, h2(gi, gj, 210) * 6.28, t[0] * v, t[1] * v, t[2] * v);
      }
    }
    if (!I.length) { B.grass = new THREE.Object3D(); return; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setAttribute('aTall', new THREE.Float32BufferAttribute(K, 1));
    g.setIndex(I); g.computeVertexNormals(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this._grassMat()); m.name = `Old growth meadow ${B.key}`; m.userData.bake = false;
    this.group.add(m); B.grass = m; this.stats.grassBlocks++;
  }
  _dropGrass(B) { const m = B.grass; if (!m) return; this.group.remove(m); m.geometry?.dispose(); B.grass = null; }
  _grassMat() {
    if (this.grassMat) return this.grassMat;
    const r = this.world.renderer, msaa = !!(r.getContextAttributes?.()?.antialias);
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95, side: THREE.DoubleSide, map: grassAtlas(r), alphaTest: msaa ? .35 : .5, alphaToCoverage: msaa });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uTime;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; attribute float aTall;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          // tall grass swaying (user: "the grass is tall and swaying"): each plant on its own, and gusts rolling across
          // the meadow in waves from the west; the top moves, the foot stays
          if (aTall > 0.) { vec3 wp = (modelMatrix * vec4(position, 1.)).xyz; float k = aTall * aTall;
            float gust = .5 + .5 * sin(dot(wp.xz, vec2(.09, .03)) - uTime * 1.3) * sin(dot(wp.xz, vec2(.021, -.05)) - uTime * .55);
            vec2 sw = vec2(sin(uTime * 1.7 + wp.x * .41 + wp.z * .23), cos(uTime * 1.3 + wp.z * .37)) * .07 + vec2(.17, .06) * gust;
            transformed.xz += sw * k; transformed.y -= length(sw) * k * .25; }`)
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = vec3(0., 1., 0.);');
    };
    m.customProgramCacheKey = () => `old-growth-grass-1-${msaa}`;
    return (this.grassMat = m);
  }

  /**
   * The leaf layer over the trails in the woods (user: "the tops of the trees extend high and cover the sky, with lush
   * canopies joining together above"): leaf-cluster cards on a 5 m grid 20–30 m up, lying near flat, unlit (lit from
   * behind by the sky: the leaves' own colour, a little glow), with gaps — the light comes through those (the god rays).
   * Drawn within ~170 m of the camera (beyond, the trees in front hide it): one draw call for the whole area.
   */
  _buildCanopy() {
    const S = 5, half = BAND - 4, P = [], U = [], C = [], I = [], rays = [], pools = [], seen = new Set(), tmpC = new THREE.Color();
    const sunAz = Math.atan2(this.world.sunDir?.z ?? .3, this.world.sunDir?.x ?? -.9);
    for (const e of this.trails) for (let i = 0; i <= e.n; i++) {
      const gi0 = Math.floor((e.x[i] - half) / S), gi1 = Math.floor((e.x[i] + half) / S), gj0 = Math.floor((e.z[i] - half) / S), gj1 = Math.floor((e.z[i] + half) / S);
      for (let gi = gi0; gi <= gi1; gi++) for (let gj = gj0; gj <= gj1; gj++) {
        const key = gi * 100003 + gj; if (seen.has(key)) continue;
        const x = (gi + .5) * S, z = (gj + .5) * S;
        const r = this.trailNear(x, z, half); if (!r) continue;
        seen.add(key);
        const code = this.land(x, z); if (!isWood(code)) continue;
        const nat = this.world.ground.at(x, z), y0 = nat + CANOPY_LO[code];
        // a gap: patches of open sky (~12 % in the stands, most of the blowdown), the light coming down through them
        const gap = code === OG.blow ? h2(gi, gj, 301) < .72 : vnoise(x * .045 + 2.3, z * .045 - 7.1) > .7 || h2(gi, gj, 302) < .03;
        if (gap) {
          if (r.d < 24 && h2(gi, gj, 303) < (code === OG.blow ? .25 : .55)) rays.push({ x: x + (h2(gi, gj, 304) - .5) * 3, z: z + (h2(gi, gj, 305) - .5) * 3, y: y0 + 2, w: 1.2 + h2(gi, gj, 306) * 2.2, code });
          continue;
        }
        const cards = code === OG.old ? 2 : 1 + (h2(gi, gj, 307) < .5 ? 1 : 0);
        for (let q = 0; q < cards; q++) {
          const cx = x + (h2(gi, gj, 310 + q) - .5) * S * .8, cz = z + (h2(gi, gj, 312 + q) - .5) * S * .8, cy = y0 + q * 2.8 + h2(gi, gj, 314 + q) * 3;
          const hs = 3 + h2(gi, gj, 316 + q) * 1.8, yaw = h2(gi, gj, 318 + q) * 6.28, tilt = (h2(gi, gj, 320 + q) - .5) * .7;
          // the colour: a canopy's greens lit through, here and there a maple's crown turning (CNY's early fall)
          const t = h2(gi, gj, 322 + q);
          const hex = t < .12 ? '#c8651e' : t < .19 ? '#c99a2c' : t < .23 ? '#a3401b' : t < .5 ? '#4e6f2c' : t < .78 ? '#5b7d31' : '#6b8a38';
          const c = tmpC.set(hex).multiplyScalar(.85 + h2(gi, gj, 330 + q) * .3).toArray();
          const ax = Math.cos(yaw), az = Math.sin(yaw), bx = -az * Math.cos(tilt), by = Math.sin(tilt), bz = ax * Math.cos(tilt);
          const base = P.length / 3, u0 = Math.floor(h2(gi, gj, 324 + q) * 2) * .5, v0 = Math.floor(h2(gi, gj, 326 + q) * 2) * .5;
          for (const [s, tt] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            P.push(cx + ax * s * hs + bx * tt * hs, cy + by * tt * hs, cz + az * s * hs + bz * tt * hs);
            U.push(u0 + (s + 1) * .25, v0 + (tt + 1) * .25); C.push(...c);
          }
          I.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
    }
    // the trail's own pools of light: dapples along the tread under the gaps and in the blowdown
    for (const r of rays) pools.push(r);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    g.setIndex(I); g.computeBoundingSphere();
    const tex = this.city.forest?.leafTexture;
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, map: tex, alphaTest: .42, side: THREE.DoubleSide, fog: true });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uTime;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; varying float vCanD;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          { vec3 wp = (modelMatrix * vec4(position, 1.)).xyz; vCanD = length(wp.xz - cameraPosition.xz);
            transformed.xz += vec2(sin(uTime * .9 + wp.x * .07), cos(uTime * .7 + wp.z * .06)) * .35;
            if (vCanD > 190.) transformed = vec3(0.); }`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vCanD;')
        .replace('#include <alphatest_fragment>', `
          // (fades out past ~150 m in a dither: the trees in front take over)
          float cdz = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))));
          if (smoothstep(140., 185., vCanD) > cdz) discard;
          #include <alphatest_fragment>
          diffuseColor.rgb *= .78 + .3 * diffuseColor.a;`);
    };
    mat.customProgramCacheKey = () => 'old-growth-canopy-1';
    this.canopy = new THREE.Mesh(g, mat); this.canopy.name = 'Old growth canopy'; this.canopy.frustumCulled = false; this.canopy.userData.bake = false; this.canopy.castShadow = false;
    this.group.add(this.canopy);
    this.stats.canopyCards = I.length / 6;
    if (this.q.rays && rays.length) this._buildRays(rays, pools, sunAz);
  }
  _dropCanopy() {
    for (const k of ['canopy', 'rays', 'pools']) { const m = this[k]; if (!m) continue; this.group.remove(m); m.geometry.dispose(); m.material.dispose(); this[k] = null; }
    for (const im of Object.values(this.logMeshes || {})) im.count = 0;
    this._logAt = null;
  }

  /**
   * God rays (user: "God rays through the overstory to the understory"): from each gap a shaft of light slanting
   * down away from the sun (its azimuth; steeper than the low golden-hour sun, ~38°, so a shaft lands near its gap
   * and reads as one), turned about its own axis to face the camera, soft at its edges, brightest under the leaves and
   * fading toward the floor, shimmering a little; and the warm pool each leaves on the floor. Additive, no depth write.
   */
  _buildRays(rays, pools, sunAz) {
    const el = 38 * Math.PI / 180, dx = -Math.cos(sunAz) * Math.cos(el), dy = -Math.sin(el), dz = -Math.sin(sunAz) * Math.cos(el);
    const A = [], B = [], S = [], Wd = [], I = [];
    const PA = [], PU = [], PI = [];
    for (const r of rays) {
      const floor = this.groundY(r.x, r.z), L = (r.y - floor) / -dy;
      const bx = r.x + dx * L, bz = r.z + dz * L, by = this.groundY(bx, bz);
      const base = A.length / 3;
      for (const [u, s] of [[0, -1], [0, 1], [1, 1], [1, -1]]) { A.push(r.x, r.y, r.z); B.push(bx, by, bz); S.push(s, u); Wd.push(r.w); }
      I.push(base, base + 1, base + 2, base, base + 2, base + 3);
      // the pool where it lands: an ellipse along the sun's azimuth, draped on the floor (5 × 5)
      const ln = r.w * 2.4, wd = r.w * 1.1, ux = Math.cos(sunAz), uz = Math.sin(sunAz), pb = PA.length / 3;
      for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) {
        const s = (i / 4 - .5) * 2, t = (j / 4 - .5) * 2, x = bx + ux * s * ln - uz * t * wd, z = bz + uz * s * ln + ux * t * wd;
        PA.push(x, this.groundY(x, z) + .05, z); PU.push(s, t);
      }
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const a = pb + j * 5 + i; PI.push(a, a + 1, a + 6, a, a + 6, a + 5); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(A, 3)); g.setAttribute('aB', new THREE.Float32BufferAttribute(B, 3));
    g.setAttribute('aS', new THREE.Float32BufferAttribute(S, 2)); g.setAttribute('aW', new THREE.Float32BufferAttribute(Wd, 1)); g.setIndex(I);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3((this.box.x0 + this.box.x1) / 2, 150, (this.box.z0 + this.box.z1) / 2), 2000);
    this.rayMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(1, .84, .58) } },
      vertexShader: /* glsl */`
        attribute vec3 aB; attribute vec2 aS; attribute float aW; uniform float uTime;
        varying float vU; varying float vS; varying float vFade; varying float vSeed;
        void main() {
          vec3 top = (modelMatrix * vec4(position, 1.)).xyz, bot = (modelMatrix * vec4(aB, 1.)).xyz;
          vec3 axis = normalize(bot - top), p = mix(top, bot, aS.y);
          vec3 side = normalize(cross(axis, normalize(cameraPosition - p)));
          p += side * aS.x * aW * (1. + aS.y * .7);
          float d = length(p - cameraPosition);
          vFade = smoothstep(3., 16., d) * (1. - smoothstep(130., 240., d));
          vU = aS.y; vS = aS.x; vSeed = top.x * .13 + top.z * .07;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; uniform float uTime; varying float vU; varying float vS; varying float vFade; varying float vSeed;
        void main() {
          float across = 1. - abs(vS); across *= across;
          float along = smoothstep(0., .12, vU) * (1. - smoothstep(.45, 1., vU));
          float shimmer = .75 + .25 * sin(uTime * .8 + vSeed + vU * 3.) * sin(uTime * 1.3 + vSeed * 1.7);
          float a = across * along * shimmer * vFade * .28;
          if (a < .004) discard;
          gl_FragColor = vec4(uColor * a, 1.);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.rays = new THREE.Mesh(g, this.rayMat); this.rays.name = 'Old growth god rays'; this.rays.frustumCulled = false; this.rays.userData.bake = false; this.rays.renderOrder = 5;
    this.group.add(this.rays);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute(PA, 3)); pg.setAttribute('aP', new THREE.Float32BufferAttribute(PU, 2)); pg.setIndex(PI); pg.computeBoundingSphere();
    const pm = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(1, .82, .52) } },
      vertexShader: 'attribute vec2 aP; varying vec2 vP; varying float vD; void main() { vP = aP; vec4 w = modelMatrix * vec4(position, 1.); vD = length(w.xyz - cameraPosition); gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: 'uniform vec3 uColor; varying vec2 vP; varying float vD; void main() { float r = dot(vP, vP); float a = (1. - smoothstep(.15, 1., r)) * .28 * (1. - smoothstep(120., 200., vD)); if (a < .003) discard; gl_FragColor = vec4(uColor * a, 1.); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.pools = new THREE.Mesh(pg, pm); this.pools.name = 'Old growth sun pools'; this.pools.userData.bake = false; this.pools.renderOrder = 4;
    this.group.add(this.pools);
    this.stats.rays = rays.length;
  }
}
