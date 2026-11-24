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
import { hash, MeshBuilder } from '../core/mesh-builder.js';
import { due } from '../core/jobs.js';
import { grassAtlas } from '../landscape/grass-cards.js';
import { decorateTreeMaterial } from '../packs/northern-rockies.js';
import { ForestLife } from '../life/forest-life.js';
import { NearTrunks, NearPlants, flareGeometry, flareMaterial } from './near-trunks.js';
import { NEAR_TRUNK, NEAR_PLANT } from './tree-engine.js';

export const OG = { old: 30, forest: 31, meadow: 32, blow: 33 };
const isWood = (c) => c === OG.old || c === OG.forest || c === OG.blow;
const BAND = 30;            // m: the skirt reaches this far from a trail's centre
const TREAD = .11;          // m: the floor at the trail's line, over its height (the rider rides ROAD_LIFT .12 over it)
const CELL = 2;             // m: the skirt's cells
const BLOCK = 128;          // m: the near pieces are built in squares this size
const SKIRT_NEAR = 420, SKIRT_FAR = 620;   // m: build within, drop beyond
const FIN_NEAR = 300, FIN_FAR = 420;     // m: the meadow's far grass (fins) built within, dropped beyond
const BLADE_R = { low: 32, balanced: 55, high: 70 };   // m: the meadow's near grass (3D blade clumps) drawn within
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

/** A way's curve (Catmull-Rom through its samples, the ends' own line carried on: as graph-world draws it and the
 *  rider rides it), `sub` points a sample: { e, n, x, z, y } (heights straight between samples, as the rider's). */
function curveOf(e, sub) {
  const X = [], Z = [], Y = [], n = e.n;
  const at = (v, k) => (k < 0 ? 2 * v[0] - v[Math.min(1, n)] : k > n ? 2 * v[n] - v[Math.max(0, n - 1)] : v[k]);
  const cr = (v, i, t) => { const p0 = at(v, i - 1), p1 = v[i], p2 = at(v, i + 1), p3 = at(v, i + 2); return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t); };
  for (let i = 0; i < n; i++) for (let q = 0; q < sub; q++) { const t = q / sub; X.push(cr(e.x, i, t)); Z.push(cr(e.z, i, t)); Y.push(e.ele[i] + (e.ele[i + 1] - e.ele[i]) * t); }
  X.push(e.x[n]); Z.push(e.z[n]); Y.push(e.ele[n]);
  return { e, n: X.length - 1, x: X, z: Z, y: Y };
}

// the stands' make-up (DEC: the old stand ~83 % sugar maple and ~13 % beech; the mature and younger woods ~90 % maple by
// count with beech, bitternut hickory, white ash and basswood)
const MIX = {
  [OG.old]: [['sugarmapleF', 80], ['beechF', 14], ['hickory', 3], ['basswood', 3]],
  [OG.forest]: [['sugarmapleF', 62], ['beechF', 14], ['hickory', 8], ['basswood', 7], ['whiteash', 9]],
  [OG.blow]: [['sugarmapleF', 70], ['beechF', 30]],
};
const MID = [['sugarmapleF', 55], ['beechF', 35], ['hickory', 10]];
const YOUNG = [['sugarmaple', 30], ['redmaple', 20], ['whiteash', 20], ['blackcherry', 20], ['birch', 10]];
// the dominants' spacing (user, 24 Nov, with a photo of an open beech–maple stand: "Tree density should be lower in the
// forest portion. More cathedral like"): big trunks ~16–20 m apart, the floor almost bare between them; in a few
// stretches (MIXED) the woods of their other photo — poles, a snag, logs, some brush away from the path
const SPACING = { [OG.old]: 18, [OG.forest]: 15.5, [OG.blow]: 34 };
const mixedAt = (x, z) => vnoise(x * .011 + 4.2, z * .011 - 1.3) > .62;
// the dominants within this of a trail (m) get a near 3D bark trunk (the camera rides the trail: NEAR_TRUNK's far end
// and a margin for the bends)
const TRUNK_D = NEAR_TRUNK[1] + 10;
// a dominant's trunk radius at 1.3 m, its butt swell in (upstate-trees FOREST_FORMS trunkR × BEEF 2, tapered ~5 % by
// 1.3 m; near-trunks.js's swell ×1.06): the root flares, the ground's mound and its root tops all sized by it
const TRUNK_R = { sugarmapleF: .5, beechF: .48, hickory: .42, basswood: .46, whiteash: .42 };
const baseR = (t) => (TRUNK_R[t.name] || .45) * 2 * .95 * 1.06 * t.k;
// a foot's colour against the maple bark it's drawn in (beech greyer and paler, hickory warmer)
const FLARE_TONE = (name) => new THREE.Color(name === 'beechF' ? '#c4c6c8' : name === 'hickory' ? '#ffffff' : '#ffffff').multiplyScalar(name === 'beechF' ? 1.1 : 1);
const TRUNK = { sugarmapleF: '#5a4d42', beechF: '#7f7c75', hickory: '#6a6259', basswood: '#655c52', whiteash: '#6b6259' };

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
    // each trail as the curve it's drawn and ridden on (graph-world _curve, pose.js routePoint: Catmull-Rom through the
    // 10 m samples, the ends' own line carried on), at 1 m; and a grid of its segments (16 m cells) for "the trail
    // near here" — so the floor, the wear and everything kept clear of the tread follow the very line the bike rides
    this.curves = this.trails.map((e) => curveOf(e, 10));
    this.grid = new Map();
    const C = 16;
    for (const c of this.curves) for (let i = 0; i < c.n; i++) {
      const ax = Math.min(c.x[i], c.x[i + 1]), bx = Math.max(c.x[i], c.x[i + 1]), az = Math.min(c.z[i], c.z[i + 1]), bz = Math.max(c.z[i], c.z[i + 1]);
      for (let gx = Math.floor(ax / C); gx <= Math.floor(bx / C); gx++) for (let gz = Math.floor(az / C); gz <= Math.floor(bz / C); gz++) {
        const k = `${gx},${gz}`; let a = this.grid.get(k); if (!a) this.grid.set(k, (a = [])); a.push(c, i);
      }
    }
    // the god rays' few places (user, 24 Nov: "Reduce the number of areas with god rays" → 3–5 hero spots)
    this.raySpots = (data.rays || []).map(([la, lo, r = 16]) => ({ ...P.toLocal(la, lo), r }));
    this.tunnel = data.tunnel?.edge ? world.G.byId.get(data.tunnel.edge) : null;
    this.apples = (data.apples || []).map(([la, lo]) => P.toLocal(la, lo));
    // the blocks the trails pass through (the near pieces)
    this.blocks = new Map();
    for (const e of this.trails) for (let i = 0; i <= e.n; i++) {
      for (const [ox, oz] of [[-BAND, -BAND], [BAND, -BAND], [-BAND, BAND], [BAND, BAND], [0, 0]]) {
        const k = `${Math.floor((e.x[i] + ox) / BLOCK)},${Math.floor((e.z[i] + oz) / BLOCK)}`;
        if (!this.blocks.has(k)) { const [bi, bj] = k.split(',').map(Number); this.blocks.set(k, { key: k, i: bi, j: bj, cx: (bi + .5) * BLOCK, cz: (bj + .5) * BLOCK, skirt: null, fins: null }); }
      }
    }
    this.group = new THREE.Group(); this.group.name = 'Old growth (hero area)';
    city.host.group.add(this.group);
    this.uTime = city.treeTime;
    this.stats = { skirtBlocks: 0, finBlocks: 0, blades: 0, canopyCards: 0, rays: 0 };
    const q = world.qualityKey;
    this.q = { cell: q === 'low' ? 2.5 : CELL, rays: q !== 'low', bladeS: q === 'low' ? .68 : q === 'high' ? .46 : .52, bladeR: BLADE_R[q] || BLADE_R.balanced };
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
        const c = arr[k], i = arr[k + 1], ax = c.x[i], az = c.z[i], dx = c.x[i + 1] - ax, dz = c.z[i + 1] - az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
        if (d > r || (best && d >= best.d)) continue;
        const l = Math.sqrt(l2);
        // side: + to the right of the way's own direction
        best = { d, y: c.y[i] + (c.y[i + 1] - c.y[i]) * t, e: c.e, c, i, t, dx: dx / l, dz: dz / l, px, pz, side: Math.sign((x - px) * -dz / l + (z - pz) * dx / l) || 1 };
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
    let y = nat + (surf - nat) * toEdge + (this.relief(x, z, code) + this.mound(x, z)) * (1 - toEdge);
    const w = sstep(this.half + .6, this.half + 5, r.d);
    y = (r.y + TREAD) + (y - (r.y + TREAD)) * w;
    return Math.max(y, surf + .04);
  }
  /**
   * The ground swollen round a big tree's foot (user, 24 Nov: "the ground swollen slightly near their base" → big trees
   * near the trail, "Scaled to trunk size"): a rise ~0.26 × the trunk's radius high, out to ~3.2 radii, for each
   * dominant within 16 m of a trail. The trees, flares and trunks stand on it (groundY).
   */
  mound(x, z) {
    if (!this.city.land) return 0;   // (not before the land is in: the dominants need it)
    const G = this._moundGrid || this._buildMounds(), S = 12;
    const l = G.get(Math.floor(x / S) * 100003 + Math.floor(z / S)); if (!l) return 0;
    let h = 0;
    for (const m of l) {
      const d = Math.hypot(x - m.x, z - m.z) / (m.R * 3.2); if (d >= 1) continue;
      const f = 1 - d * d; h = Math.max(h, m.R * .26 * f * f);
    }
    return h;
  }
  _buildMounds() {
    const G = new Map(), S = 12;
    this._mounds = [];
    for (const t of this.dominants()) {
      if (t.snag || t.d > 16 || !TRUNK[t.name]) continue;
      const R = baseR(t);
      // (seed: the shader's ridges on the 3D roots' own bearings)
      const m = { x: t.x, z: t.z, R, seed: 3 * t.rot }; this._mounds.push(m);
      const reach = R * 3.2;
      for (let i = Math.floor((m.x - reach) / S); i <= Math.floor((m.x + reach) / S); i++) for (let j = Math.floor((m.z - reach) / S); j <= Math.floor((m.z + reach) / S); j++) {
        const k = i * 100003 + j; (G.get(k) || G.set(k, []).get(k)).push(m);
      }
    }
    return (this._moundGrid = G);
  }
  /** The ground shader's root tops and bare soil round the big trees nearest the camera (graph-world uRoots). */
  _drawRootGround(cx, cz) {
    const U = this.world.mats?.ground?.userData?.land; if (!U?.uRoots || !this.city.land) return;
    if (!this._mounds) this._buildMounds();
    const near = this._mounds.map((m) => ({ m, d: Math.hypot(m.x - cx, m.z - cz) })).filter((a) => a.d < 90).sort((a, b) => a.d - b.d).slice(0, U.uRoots.value.length);
    near.forEach(({ m }, i) => U.uRoots.value[i].set(m.x, m.z, m.R, m.seed));
    U.uRootN.value = near.length;
  }
  /** A spot's floor: the skirt's where it is, else the world's ground. */
  groundY(x, z) { return this.floorH(x, z) ?? this.world._groundH(x, z); }

  // ------------------------------------------------------------------ placement (the tree engine's trees)
  /**
   * The area's dominant trees, all of them (they're needed whole for the root flares): one per cell of each stand's
   * grid — the cell's land must be the stand's — jittered within the middle of the cell, so the big trunks stand
   * evenly apart as in a cathedral stand. { x, z, name, k, sy, v, rot, seed, snag, code, d (from the trail) }.
   */
  dominants() {
    if (this._doms) return this._doms;
    if (!this.city.land) return [];   // (not cached: the stands come from the land)
    const out = [], b = this.box, half = this.half, kit = this.city.treeKit?.species || {};
    const variantOf = (name, r) => (kit[name]?.variants.length > 1 ? (r < .7 ? 0 : 1) : 0);
    for (const code of [OG.old, OG.forest, OG.blow]) {
      const S = SPACING[code];
      for (let i = Math.floor(b.x0 / S); i <= Math.ceil(b.x1 / S); i++) for (let j = Math.floor(b.z0 / S); j <= Math.ceil(b.z1 / S); j++) {
        const x = (i + .3 + h2(i, j, code) * .4) * S, z = (j + .3 + h2(i, j, code + 50) * .4) * S;
        if (this.land(x, z) !== code) continue;
        const r = this.trailNear(x, z, 30), d = r ? r.d : 99;
        if (d < half + 1.0 || (d < 3.5 && h2(i, j, 31) > .4)) continue;   // a few right at the tread's edge, most a step back
        const r1 = h2(i, j, 21), r2 = h2(i, j, 22), r3 = h2(i, j, 23), mixed = mixedAt(x, z);
        const snag = r3 < (mixed ? .08 : .03);
        const name = snag ? 'snag' : pick(MIX[code], r1);
        const k = snag ? 1.2 + r2 * .35 : code === OG.old ? 1.02 + r2 * .26 : code === OG.blow ? .95 + r2 * .2 : .9 + r2 * .22;
        out.push({ x, z, name, k, sy: k * (.95 + r3 * .1), v: snag ? Math.floor(r1 * 3) % 3 : variantOf(name, h2(i, j, 25)), rot: h2(i, j, 24) * 6.283, seed: i * 7919 + j * 131 + code, snag, code, d });
      }
    }
    return (this._doms = out);
  }
  domNear(x, z, R) {
    for (const code of [OG.old, OG.forest, OG.blow]) {
      const S = SPACING[code], ci = Math.floor(x / S), cj = Math.floor(z / S);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const i = ci + a, j = cj + b, px = (i + .3 + h2(i, j, code) * .4) * S, pz = (j + .3 + h2(i, j, code + 50) * .4) * S;
        if (Math.hypot(px - x, pz - z) < R && this.land(px, pz) === code) return true;
      }
    }
    return false;
  }

  /**
   * A tile's trees and understory in the hero area, pushed onto out as the tree engine takes them
   * ({ x, y, z, sp, v, s, sy, rot, tint, deep }). `clear(x, z, r)`: the city's own test (water, buildings, …).
   * The cathedral stand mostly (big trunks far apart, a bare floor of leaves, now and then a pole or a fern), the mixed
   * woods in stretches (poles, snags, saplings and ferns away from the path, more logs), the blowdown's thicket, the
   * meadows' edges.
   */
  *treesJob(x0, z0, size, out, kit, clear = () => true) {
    const self = this, sp = kit.species, us = kit.understory, half = this.half;
    const inTile = (x, z) => x >= x0 && x < x0 + size && z >= z0 && z < z0 + size;
    const trunks = [], plants = [], nt = self.nearTrunks(), np = self.nearPlants();
    const put = (x, z, name, s, rot, seed, { sy = s, v = 0, deep = false, under = false } = {}) => {
      if (!(sp[name] || us[name])) return false;
      const rd = self.roadNear(x, z); if (rd && rd.d - rd.half < (under ? 2.5 : 4)) return false;   // (Thompson Road: the city's own rules)
      const tr = { x, y: self.groundY(x, z) - (under ? .04 : .12), z, sp: name, v, s, sy, rot, tint: .9 + h2(seed, 3, 9) * .18, deep };
      // the hero woods' colour grade (tree-engine.js TREE_GRADE): its trees even gold, shaded below; the understory muted
      tr.grade = under ? 2 : isWood(self.land(x, z)) ? 1 : 0;
      // a fern or herb near a trail: 3D near the camera, its card farther off (near-trunks.js NearPlants)
      if (under && np.has(name) && (name.startsWith('fern') || name === 'herb')) { const r = self.trailNear(x, z, 24); if (r && r.d < 24) { tr.cut = -1; plants.push({ x, y: tr.y, z, rot, s, name, tint: tr.tint }); } }
      // a canopy tree or a pole near a trail: its card's trunk below the cut gives way to a 3D one near the camera
      // (near-trunks.js); the trunk listed for drawing
      const cut = under || name === 'snag' ? 0 : nt.cutOf(name, v);
      if (cut && s > .45) { const r = self.trailNear(x, z, TRUNK_D); if (r && r.d < TRUNK_D) { tr.cut = cut * sy; trunks.push({ x, y: tr.y, z, rot, s, sy, name, v, tint: tr.tint }); } }
      out.push(tr);
      return true;
    };
    // (nothing leafy at eye level within ~9–10 m of the tread: a 2D card that close is all magnified blur; a forest-
    //  grown tree, its crown high, may stand close)
    const trailOk = (x, z, minD) => { const r = self.trailNear(x, z, minD + 1); return !r || r.d >= half + minD; };
    const variantOf = (name, r) => (sp[name]?.variants.length > 1 ? (sp[name].forest ? (r < .7 ? 0 : 1) : (r < .66 ? 0 : r < .86 ? 1 : 2)) % sp[name].variants.length : 0);
    // ---- the dominants
    for (const t of this.dominants()) {
      if (!inTile(t.x, t.z) || !clear(t.x, t.z, 3)) continue;
      put(t.x, t.z, t.name, t.k, t.rot, t.seed, { sy: t.sy, v: t.v, deep: t.d > 30 });
    }
    if (due()) yield;
    // ---- poles, saplings, the floor's plants; the woods' edge against the meadows
    const S2 = 6.5;
    for (let i = Math.floor(x0 / S2); i < Math.ceil((x0 + size) / S2); i++) {
      if (due()) yield;
      for (let j = Math.floor(z0 / S2); j < Math.ceil((z0 + size) / S2); j++) {
        const x = (i + .15 + h2(i, j, 41) * .7) * S2, z = (j + .15 + h2(i, j, 42) * .7) * S2;
        if (!inTile(x, z)) continue;
        const code = self.land(x, z);
        if (!isWood(code) && code !== OG.meadow) continue;
        const r = self.trailNear(x, z, 70), d = r ? r.d : 99, seed = i * 6151 + j * 89, mixed = mixedAt(x, z);
        // the woods' edge against a meadow: a thick wall of young trees and shrubs (user: "meadows, bordered by thick tree stands")
        let edge = false;
        if (isWood(code)) for (const [ox, oz] of [[12, 0], [-12, 0], [0, 12], [0, -12]]) if (self.land(x + ox, z + oz) === OG.meadow) { edge = true; break; }
        if (edge) {
          // (fewer shrubs — user, 24 Nov: bushes "mute colours, smoother, fewer bushes")
          for (let q = 0; q < 3; q++) {
            if (q === 2 && h2(i, j, 59) < .7) continue;
            const qx = x + (h2(i, j, 60 + q) - .5) * S2, qz = z + (h2(i, j, 63 + q) - .5) * S2, rr = h2(i, j, 66 + q);
            if (!inTile(qx, qz) || !trailOk(qx, qz, 10) || !clear(qx, qz, 1.5)) continue;
            if (rr < .45) put(qx, qz, pick(YOUNG, h2(i, j, 70 + q)), .4 + h2(i, j, 73 + q) * .4, h2(i, j, 76 + q) * 6.28, seed + q, { v: variantOf('sugarmaple', h2(i, j, 79 + q)) });
            else if (rr < .8) put(qx, qz, rr < .66 ? 'buckthorn' : rr < .76 ? 'dogwood' : 'sumac', .8 + h2(i, j, 82 + q) * .5, h2(i, j, 85 + q) * 6.28, seed + q, { under: true });
          }
          continue;
        }
        if (code === OG.meadow) {
          // the meadow side of a woods' edge: brush creeping out; goldenrod in drifts away from the trail
          let near = false; for (const [ox, oz] of [[5, 0], [-5, 0], [0, 5], [0, -5]]) if (isWood(self.land(x + ox, z + oz))) { near = true; break; }
          if (near && h2(i, j, 90) < .3 && trailOk(x, z, 9)) put(x, z, h2(i, j, 91) < .65 ? 'goldenrod' : 'dogwood', .8 + h2(i, j, 92) * .4, h2(i, j, 93) * 6.28, seed, { under: true });
          else if (d > 9 && vnoise(x * .05, z * .05) > .66 && h2(i, j, 94) < .35) put(x, z, 'goldenrod', 1.1 + h2(i, j, 95) * .4, h2(i, j, 96) * 6.28, seed, { under: true });
          continue;
        }
        if (!clear(x, z, 1.5)) continue;
        if (code === OG.blow) {
          // the blowdown's sun: a thicket of poles and saplings fighting up through raspberry and brush
          for (let q = 0; q < 4; q++) {
            const qx = x + (h2(i, j, 100 + q) - .5) * S2, qz = z + (h2(i, j, 104 + q) - .5) * S2, rr = h2(i, j, 108 + q);
            if (!inTile(qx, qz)) continue;
            if (rr >= .3 && !trailOk(qx, qz, 9)) continue;
            if (rr < .3) { if (trailOk(qx, qz, 2.6)) put(qx, qz, h2(i, j, 112 + q) < .7 ? 'sugarmapleF' : 'beechF', .36 + h2(i, j, 116 + q) * .16, h2(i, j, 120 + q) * 6.28, seed + q, { v: h2(i, j, 124 + q) < .75 ? 0 : 1 }); }
            else if (rr < .62) put(qx, qz, rr < .48 ? 'sapling' : 'beechSapling', .7 + h2(i, j, 128 + q) * .6, h2(i, j, 132 + q) * 6.28, seed + q, { under: true });
            else if (rr < .72) put(qx, qz, rr < .68 ? 'buckthorn' : 'dogwood', .7 + h2(i, j, 136 + q) * .5, h2(i, j, 140 + q) * 6.28, seed + q, { under: true });
          }
          continue;
        }
        // poles: a few in the cathedral, more in the mixed woods — under no dominant's crown
        if (h2(i, j, 43) < (mixed ? .45 : .07) && !self.domNear(x, z, SPACING[code] * .45) && trailOk(x, z, 1.6)) {
          const name = pick(MID, h2(i, j, 44)), k = .55 + h2(i, j, 45) * .27;
          put(x, z, name, k, h2(i, j, 46) * 6.28, seed, { sy: k * (1 + h2(i, j, 47) * .12), v: variantOf(name, h2(i, j, 48)), deep: d > 30 });
          continue;
        }
        // the shade: saplings trying to break through (user: "a few, small saplings") — the mixed woods mostly
        if (d < 45 && h2(i, j, 49) < (mixed ? .22 : .03) && trailOk(x, z, 9)) put(x, z, h2(i, j, 50) < .55 ? 'beechSapling' : 'sapling', .55 + h2(i, j, 51) * .6, h2(i, j, 52) * 6.28, seed, { under: true });
      }
    }
    // ---- the floor near the trails: ferns and herbs in the mixed woods and damp spots (the cathedral's floor is mostly
    // bare leaves), seedlings; stumps and stones
    const S3 = 3;
    for (let i = Math.floor(x0 / S3); i < Math.ceil((x0 + size) / S3); i++) {
      if (due()) yield;
      for (let j = Math.floor(z0 / S3); j < Math.ceil((z0 + size) / S3); j++) {
        const x = (i + h2(i, j, 141)) * S3, z = (j + h2(i, j, 142)) * S3;
        if (!inTile(x, z)) continue;
        const code = self.land(x, z); if (!isWood(code)) continue;
        const r = self.trailNear(x, z, 40); if (!r || r.d < half + .7) continue;
        const damp = vnoise(x * .07 + 9, z * .07 - 4), q = h2(i, j, 143), seed = i * 3301 + j * 17, m = mixedAt(x, z) || code === OG.blow ? 1 : .25;
        if (q < (damp * .7 - .1) * m) put(x, z, h2(i, j, 144) < .55 ? (h2(i, j, 145) < .5 ? 'fern' : 'fern2') : 'herb', .7 + damp * .6, h2(i, j, 146) * 6.28, seed, { under: true });
        else if (r.d < 22 && q > (m < 1 ? .97 : .9)) put(x, z, 'seedling', .45 + h2(i, j, 147) * .35, h2(i, j, 148) * 6.28, seed, { under: true });
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
        const p = this._logP(x, z, code), q = h2(i, j, 153);
        if (q < p) { /* a log: _logs */ } else if (q < p + .04 && r.d > 2) put(x, z, q < p + .02 ? 'stump2' : 'rock2', .8 + h2(i, j, 157) * .5, h2(i, j, 158) * 6.28, i * 31 + j, { under: true });
      }
    }
    // ---- the green tunnel: two rows of trees along the trail across the meadow, their crowns meeting over it
    if (this.tunnel) {
      const e = this.tunnel;
      for (let i = 1; i < e.n; i++) for (const side of [-1, 1]) {
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
    (this._tileTrunks ||= new Map()).set(`${x0},${z0}`, trunks); this._trunks = null; this._trunkAt = null;
    (this._tilePlants ||= new Map()).set(`${x0},${z0}`, plants); this._plants = null;
  }
  /** A 9 m cell's chance of a fallen trunk: the blowdown's many, the mixed woods' some, the cathedral's few. */
  _logP(x, z, code) { return code === OG.blow ? .5 : mixedAt(x, z) ? (code === OG.old ? .32 : .2) : .06; }

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
      const p = this._logP(x, z, code), q = h2(i, j, 153);
      if (q >= p) continue;
      const t = h2(i, j, 154);
      // (no tip-ups: their root plates read as tents from some angles — user, 24 Nov: "Remove tip-ups")
      const name = code === OG.blow ? 'bigLog' : code === OG.old ? (t < .55 ? 'bigLog' : 'nurseLog') : (t < .5 ? 'bigLog' : t < .75 ? 'log' : 'nurseLog');
      const s = name === 'log' ? 1.2 : .8 + h2(i, j, 155) * .4;
      const rot = code === OG.blow ? FALL_YAW + (h2(i, j, 156) - .5) * .8 : h2(i, j, 156) * 6.28;
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

  // ------------------------------------------------------------------ near bark trunks (3D)
  nearTrunks() { return (this._nt ||= new NearTrunks(this.group, this.city.treeKit)); }
  /** The trees that get a near 3D trunk, { x, y, z, rot, s, sy, name, v, tint } as their cards stand: each tile's, as
   *  treesJob placed them (a tile placed again replaces its own). */
  trunkList() {
    if (!this._trunks) { this._trunks = []; for (const l of (this._tileTrunks ||= new Map()).values()) this._trunks.push(...l); }
    return this._trunks;
  }
  nearPlants() { return (this._np ||= new NearPlants(this.group, this.city.treeKit)); }
  plantList() {
    if (!this._plants) { this._plants = []; for (const l of (this._tilePlants ||= new Map()).values()) this._plants.push(...l); }
    return this._plants;
  }
  _drawPlants(cx, cz) {
    const R = NEAR_PLANT[1] + 3;
    this.stats.plants = this.nearPlants().draw(this.plantList().filter((t) => Math.abs(t.x - cx) < R && Math.abs(t.z - cz) < R && Math.hypot(t.x - cx, t.z - cz) < R));
  }
  _drawTrunks(cx, cz) {
    const R = NEAR_TRUNK[1] + 6;
    this.stats.trunks = this.nearTrunks().draw(this.trunkList().filter((t) => Math.abs(t.x - cx) < R && Math.abs(t.z - cz) < R && Math.hypot(t.x - cx, t.z - cz) < R));
  }

  // ------------------------------------------------------------------ root flares (3D)
  /**
   * The big trees' feet near the path (user, 24 Nov, with an illustration of two trunks on splayed roots: "Yes, 3D root
   * flares"): a dominant within 16 m of a trail gets a 3D base — the trunk swelling into the ground, five or six roots
   * running out over the leaves and diving in — in its bark's colour; the card stands above it. A handful cross the tread.
   */
  _flareGeometry() {
    // unit: the trunk's radius 1 at 1.3 m up (the card's trunk), +y up, roots out in all directions
    const M = new MeshBuilder();
    const seg = 14;
    // the swelling foot: a flared cylinder, three rings
    for (const [y0, y1, r0, r1, c] of [[-.25, .15, 1.75, 1.45, '#e8e2d8'], [.15, .55, 1.45, 1.15, '#efe9df'], [.55, 1.35, 1.15, 1.02, '#f6f2ea']]) { M.color(c); M.cylinder(0, y0, 0, r0, y1 - y0, seg, r1); }
    // the roots: tapered, bending down into the ground as they go out
    const rand = (k) => hash(k * 97 + 13);
    for (let k = 0; k < 6; k++) {
      // (every 60°: the ground shader's root tops run on out along the same bearings — graph-world uRoots; the roots
      //  low, their tops just breaking through the litter)
      const a = k / 6 * 6.283, L = 1.1 + rand(k + 7) * 1.2, ca = Math.cos(a), sa = Math.sin(a);
      const p0 = new THREE.Vector3(ca * .85, .42, sa * .85), p1 = new THREE.Vector3(ca * (1.2 + L * .4), .16, sa * (1.2 + L * .4)), p2 = new THREE.Vector3(ca * (1.2 + L), -.14, sa * (1.2 + L));
      M.color('#e6dfd3'); M.beam(p0, p1, .55, .45); M.color('#ddd6ca'); M.beam(p1, p2, .38, .3);
    }
    return M.geometry();
  }
  flares() {
    if (this._flares) return this._flares;
    const out = [], half = this.half;
    for (const t of this.dominants()) {
      if (t.snag || t.d > 16 || !TRUNK[t.name]) continue;
      const sp = this.city.treeKit?.species?.[t.name]; if (!sp) continue;
      // the card's trunk: the species' base radius (upstate-trees: trunkR) at this tree's scale
      // (the 3D trunk's radius at 1.3 m, swell and all — near-trunks.js — so the flare meets the bark it grows from)
      const R = baseR(t);
      out.push({ x: t.x, z: t.z, y: this.groundY(t.x, t.z) - .08, R, rot: t.rot, color: FLARE_TONE(t.name).multiplyScalar(.92 + h2(t.seed, 1, 5) * .14) });   // (the bark texture's tone carries the colour)
    }
    void half;
    return (this._flares = out);
  }
  _drawFlares(cx, cz) {
    const RR = 170, list = this.flares().filter((f) => Math.abs(f.x - cx) < RR && Math.abs(f.z - cz) < RR && Math.hypot(f.x - cx, f.z - cz) < RR);
    if (!this.flareMesh || this.flareMesh.instanceMatrix.count < list.length) {
      if (this.flareMesh) { this.group.remove(this.flareMesh); this.flareMesh.dispose(); }
      this.flareGeo ||= flareGeometry();
      this.flareMat ||= flareMaterial();
      const im = new THREE.InstancedMesh(this.flareGeo, this.flareMat, Math.max(64, Math.ceil(list.length * 1.4)));
      im.name = 'Old growth root flares'; im.frustumCulled = false; im.receiveShadow = true; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(im); this.flareMesh = im;
    }
    const im = this.flareMesh, m = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), sc = new THREE.Vector3();
    list.forEach((f, k) => { q.setFromAxisAngle(Y, f.rot); p.set(f.x, f.y, f.z); sc.set(f.R, Math.max(.75, f.R * .9), f.R); im.setMatrixAt(k, m.compose(p, q, sc)); im.setColorAt(k, f.color); });
    im.count = list.length; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    this.stats.flares = list.length;
  }

  // ------------------------------------------------------------------ wildlife
  /**
   * The woods' and fields' life (user, 24 Nov: no hikers — "Wildlife instead"): a doe and yearlings among the trunks
   * a little way off the path, two more at a woods' edge, a flock of turkeys out in a meadow, chipmunks on the logs by
   * the path, crows circling over the high fields. Fixed spots, picked once along the trails.
   */
  _placeLife() {
    if (this.life) return;
    this.life = new ForestLife(this.group, { uTime: this.uTime });
    const list = [], circles = [];
    let deerGroups = 0, turkeyFlocks = 0, along = 0;
    for (const c of this.curves) for (let i = 30; i < c.n - 30; i += 25) {
      along += 25;
      if (along % 400 > 25) continue;   // a spot every ~400 m of trail
      const dx = c.x[i + 1] - c.x[i], dz = c.z[i + 1] - c.z[i], l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l, side = h2(i, c.n, 3) < .5 ? -1 : 1;
      const off = 22 + h2(i, c.n, 4) * 14, x = c.x[i] + nx * off * side, z = c.z[i] + nz * off * side, code = this.land(x, z);
      if (isWood(code) && deerGroups < 3) {
        deerGroups++;
        for (let k = 0; k < 2 + (deerGroups % 2); k++) {
          const px = x + (h2(i, k, 5) - .5) * 7, pz = z + (h2(i, k, 6) - .5) * 7, r = this.trailNear(px, pz, 12);
          if (r && r.d < 12) continue;
          list.push({ kind: 'deer', x: px, y: this.groundY(px, pz), z: pz, yaw: h2(i, k, 7) * 6.28, s: k ? .8 + h2(i, k, 8) * .12 : 1 });
        }
      } else if (code === OG.meadow && turkeyFlocks < 2) {
        turkeyFlocks++;
        for (let k = 0; k < 7; k++) {
          const px = x + (h2(i, k, 9) - .5) * 9, pz = z + (h2(i, k, 10) - .5) * 9;
          if (this.land(px, pz) !== OG.meadow) continue;
          list.push({ kind: 'turkey', x: px, y: this.groundY(px, pz) + .25, z: pz, yaw: h2(i, k, 11) * 6.28, s: .9 + h2(i, k, 12) * .2 });
        }
        circles.push({ x, y: this.world.ground.at(x, z) + 34, z, r: 28, n: 3 });
      }
    }
    // chipmunks on the logs nearest the paths
    let chips = 0;
    for (const L of this._logList()) {
      if (chips >= 10) break;
      const r = this.trailNear(L.x, L.z, 10); if (!r || h2(Math.round(L.x), Math.round(L.z), 13) > .5) continue;
      const f = .35 + h2(Math.round(L.x), 2, 14) * .3, len = (L.name === 'log' ? 0 : (L.name === 'nurseLog' ? 13 : 16) * L.s * f);
      const px = L.x + Math.cos(L.rot) * len, pz = L.z - Math.sin(L.rot) * len, top = (L.name === 'nurseLog' ? .6 : .52) * L.s * 1.8;
      list.push({ kind: 'chipmunk', x: px, y: L.y + top, z: pz, yaw: h2(Math.round(L.x), 3, 15) * 6.28, s: 1 }); chips++;
    }
    this.life.place(list, circles);
    this.stats.life = list.length;
  }

  // ------------------------------------------------------------------ the near pieces
  /** Everything near the camera built now (a snapshot; the first frame of a ride). */
  prepare(camera) { this._last = null; this._logAt = null; this._bladeAt = null; this.tick(camera, this.uTime?.value ?? 0); }
  tick(camera, time) {
    const cx = camera.position.x, cz = camera.position.z;
    if (!this.contains(cx, cz, 900)) {
      if (this.canopy) this._dropCanopy();
      for (const B of this.blocks.values()) { this._dropSkirt(B); this._dropFins(B); }
      if (this.blades) for (const im of Object.values(this.blades)) im.count = 0;
      { const U = this.world.mats?.ground?.userData?.land; if (U?.uRootN) U.uRootN.value = 0; }
      this._nt?.hide(); this._np?.hide(); this._trunkAt = null;
      return;
    }
    const ready = this.world.ground && this.city.land;
    if (!ready) return;
    if (!this.canopy) this._buildCanopy();
    if (!this.life) this._placeLife();
    this.life.tick(time);
    if (!this._logAt || Math.hypot(cx - this._logAt.x, cz - this._logAt.z) > 20) { this._logAt = { x: cx, z: cz }; this._logs(cx, cz); this._drawFlares(cx, cz); this._drawRootGround(cx, cz); }
    if (!this._bladeAt || Math.hypot(cx - this._bladeAt.x, cz - this._bladeAt.z) > 5) { this._bladeAt = { x: cx, z: cz }; this._drawBlades(cx, cz); }
    if (!this._trunkAt || Math.hypot(cx - this._trunkAt.x, cz - this._trunkAt.z) > 2) { this._trunkAt = { x: cx, z: cz }; this._drawTrunks(cx, cz); this._drawPlants(cx, cz); }
    // all at once while loading, or when the camera has jumped (a new ride, a snapshot); else a piece a frame
    const jumped = !this._last || Math.hypot(cx - this._last.x, cz - this._last.z) > 150;
    this._last = { x: cx, z: cz };
    let budget = this.world._preload || jumped ? 999 : 1;
    const list = [...this.blocks.values()].map((B) => ({ B, d: Math.hypot(B.cx - cx, B.cz - cz) - BLOCK * .71 })).sort((a, b) => a.d - b.d);
    for (const { B, d } of list) {
      if (d > SKIRT_FAR) this._dropSkirt(B); else if (d < SKIRT_NEAR && !B.skirt && budget > 0) { this._buildSkirt(B); budget--; }
      if (d > FIN_FAR) this._dropFins(B); else if (d < FIN_NEAR && !B.fins && budget > 0) { this._buildFins(B); budget--; }
    }
    if (this.rayMat) this.rayMat.uniforms.uTime.value = time;
  }

  /** The skirt: a fine ground along the trails (BAND either side), the land shader's own material, with the trail worn
   *  into it (aTread: each vertex's signed distance from the line the bike rides, + 50 — the ground shader wears the
   *  floor through to packed earth along it); and the roots across the tread in the woods. */
  _buildSkirt(B) {
    const W = this.world, cell = this.q.cell, n = Math.round(BLOCK / cell), n1 = n + 1, x0 = B.i * BLOCK, z0 = B.j * BLOCK;
    const pos = new Float32Array(n1 * n1 * 3), col = new Float32Array(n1 * n1 * 3), lw = new Float32Array(n1 * n1), tr = new Float32Array(n1 * n1), inside = new Uint8Array(n1 * n1);
    const grass = new THREE.Color('#89a868');
    for (let j = 0, k = 0; j <= n; j++) for (let i = 0; i <= n; i++, k++) {
      const x = x0 + i * cell, z = z0 + j * cell, r = this.trailNear(x, z, BAND + 1);
      const rd = r && this.roadNear(x, z);   // (not over a road the trail meets: the road keeps its own ground)
      if (!r || r.d > BAND || (rd && rd.d < rd.half + 7)) { pos[3 * k] = x; pos[3 * k + 2] = z; continue; }
      inside[k] = 1;
      pos[3 * k] = x; pos[3 * k + 1] = this.floorH(x, z, r); pos[3 * k + 2] = z;
      col[3 * k] = grass.r; col[3 * k + 1] = grass.g; col[3 * k + 2] = grass.b; lw[k] = 1;
      // (the trail's end at a road: its wear fades out into the road's mouth)
      tr[k] = 50 + Math.max(-BAND, Math.min(BAND, r.d * r.side)) + (rd && rd.d < rd.half + 9 ? 20 : 0);
    }
    const idx = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = j * n1 + i, b = a + 1, c = a + n1, d = c + 1;
      if (inside[a] && inside[b] && inside[c] && inside[d]) idx.push(a, c, b, b, c, d);
    }
    if (!idx.length) { B.skirt = new THREE.Object3D(); return; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aLandW', new THREE.BufferAttribute(lw, 1)); g.setAttribute('aTread', new THREE.BufferAttribute(tr, 1));
    g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, W.mats.ground); m.name = `Old growth floor ${B.key}`; m.receiveShadow = true;
    this.group.add(m); B.skirt = m;
    // roots across the tread in the woods: a half-buried root now and then, askew, and a stone
    const P = [], C = [], I = [];
    const root = new THREE.Color('#5e4a37'), stone = new THREE.Color('#8b897f');
    const box = (cx, cy, cz, ux, uz, len, wid, hgt, c) => {
      const vx = -uz, vz = ux, base = P.length / 3;
      for (const [s, t, h] of [[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]) {
        P.push(cx + ux * s * len / 2 + vx * t * wid / 2, cy + h * hgt - .03, cz + uz * s * len / 2 + vz * t * wid / 2); C.push(c.r, c.g, c.b);
      }
      for (const q of [[4, 5, 6, 4, 6, 7], [0, 1, 5, 0, 5, 4], [1, 2, 6, 1, 6, 5], [2, 3, 7, 2, 7, 6], [3, 0, 4, 3, 4, 7]]) for (const v of q) I.push(base + v);
    };
    for (const c of this.curves) for (let i = 0; i < c.n; i += 3) {
      const x = c.x[i], z = c.z[i];
      if (x < x0 || x >= x0 + BLOCK || z < z0 || z >= z0 + BLOCK || !isWood(this.land(x, z))) continue;
      const r = h2(i, c.n, c.e.id.length * 7); if (r > .1) continue;   // (a root every ~30 m)
      const dx = c.x[i + 1] - x, dz = c.z[i + 1] - z, l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l, y = c.y[i] + TREAD;
      const a = (h2(i, 1, 4) - .5) * .9, ax = Math.cos(a) * -uz - Math.sin(a) * ux, az = Math.cos(a) * ux + Math.sin(a) * -uz;   // across the tread, askew
      if (r < .08) box(x, y, z, ax, az, this.half * 2 + .6, .09 + r, .05 + r * .3, root);
      else box(x + ux * .1, y, z + uz * .1, ux, uz, .2, .16, .06, stone);
    }
    if (I.length) {
      const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); rg.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); rg.setIndex(I); rg.computeVertexNormals();
      this.rootMat ||= new THREE.MeshLambertMaterial({ vertexColors: true });
      const rm = new THREE.Mesh(rg, this.rootMat); rm.name = `Old growth roots ${B.key}`; rm.receiveShadow = true; this.group.add(rm); B.roots = rm;
    }
    this.stats.skirtBlocks++;
  }
  _dropSkirt(B) { for (const k of ['skirt', 'roots']) { const m = B[k]; if (!m) continue; this.group.remove(m); m.geometry?.dispose(); B[k] = null; } }

  // ------------------------------------------------------------------ the meadows' grass
  /**
   * The tall grass right at the path (user, 24 Nov: "Grass should be closer in to the bike path and taller … Grass
   * area has poor performance" → "Near wall + far shell", 1.4–1.8 m, from 0.3 m off the tread): 3D clumps of real
   * blades — no see-through cards, so no overdraw — on a jittered 0.5 m grid from 0.3 m off the tread out to 8 m,
   * instanced (one draw call a detail level: a fuller clump within 22 m, a sparser one out to BLADE_R), refilled as
   * the camera moves. Swaying, gusts rolling over from the west.
   */
  _bladeGeometry(blades, segs) {
    const P = [], N = [], C = [], H = [], I = [];
    // hay at the end of September: olive-brown at the foot, tan and straw above, a few blades still dull green
    const PAL = [['#5d5a32', '#9c8a55', '#cdb67e'], ['#655c35', '#a78e58', '#c9a96c'], ['#4f5a2e', '#7f8746', '#aba468'], ['#6a5f3a', '#b09a66', '#dcc897']];
    const tmp = new THREE.Color();
    for (let b = 0; b < blades; b++) {
      const a = b * 2.39996, d = .03 + (b % 4) * .05, bx = Math.cos(a) * d, bz = Math.sin(a) * d;
      const pal = PAL[Math.floor(h2(b, blades, 5) * PAL.length)].map((c) => new THREE.Color(c)), [base, mid, tip] = pal;
      const yaw = h2(b, blades, 1) * 6.28, lean = .12 + h2(b, blades, 2) * .32, hgt = .62 + h2(b, blades, 3) * .38, w = .011 + h2(b, blades, 4) * .009;
      const ox = Math.cos(a), oz = Math.sin(a), sx = Math.cos(yaw), sz = Math.sin(yaw), v0 = P.length / 3;
      for (let k = 0; k <= segs; k++) {
        const t = k / segs, y = hgt * t, out = lean * t * t, ww = w * (1 - t * .85);
        const cx = bx + ox * out, cz = bz + oz * out;
        for (const s of [-1, 1]) {
          P.push(cx + sx * ww * s, y, cz + sz * ww * s); N.push(ox * .3, 1, oz * .3);
          tmp.copy(t < .5 ? base : mid).lerp(t < .5 ? mid : tip, t < .5 ? t * 2 : (t - .5) * 2); C.push(tmp.r, tmp.g, tmp.b); H.push(t);
        }
        if (k) { const q = v0 + (k - 1) * 2; I.push(q, q + 1, q + 3, q, q + 3, q + 2); }
      }
      // a seed head on every other blade: a short, pale plume
      if (b % 3 === 0) {
        const t = 1, cx = bx + ox * lean, cz = bz + oz * lean, q = P.length / 3, hc = tmp.set(h2(b, 7, 6) < .5 ? '#a8895a' : '#8f7a55');
        for (const [px, py, pz] of [[cx - sx * .012, hgt - .03, cz - sz * .012], [cx + sx * .012, hgt - .03, cz + sz * .012], [cx + ox * .04 + sx * .008, hgt + .14, cz + oz * .04 + sz * .008], [cx + ox * .04 - sx * .008, hgt + .14, cz + oz * .04 - sz * .008]]) {
          P.push(px, py, pz); N.push(ox * .3, 1, oz * .3); C.push(hc.r, hc.g, hc.b); H.push(t);
        }
        I.push(q, q + 1, q + 2, q, q + 2, q + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setAttribute('aH', new THREE.Float32BufferAttribute(H, 1)); g.setIndex(I);
    g.computeBoundingSphere();
    return g;
  }
  _bladeMat() {
    if (this.bladeMat) return this.bladeMat;
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uTime;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; attribute float aH;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          // the blade bends from its foot: its own sway, and gusts rolling over the field from the west
          vec3 ip = vec3(0.);
          #ifdef USE_INSTANCING
            ip = instanceMatrix[3].xyz;
          #endif
          float k = aH * aH;
          float gust = .5 + .5 * sin(dot(ip.xz, vec2(.09, .03)) - uTime * 1.3) * sin(dot(ip.xz, vec2(.021, -.05)) - uTime * .55);
          vec2 sw = vec2(sin(uTime * 1.9 + ip.x * .53 + ip.z * .31 + aH * 1.3), cos(uTime * 1.4 + ip.z * .47)) * .06 + vec2(.2, .07) * gust;
          transformed.xz += sw * k; transformed.y -= dot(sw, sw) * k * 1.2;`);
    };
    m.customProgramCacheKey = () => 'old-growth-blades-2';
    return (this.bladeMat = m);
  }
  /** The clumps of one 32 m cell along the meadow trails (computed once): Float32Array of [x, y, z, yaw, scale, tint]. */
  _bladeCell(ci, cj) {
    const key = `${ci},${cj}`, cache = (this._bladeCells ||= new Map());
    if (cache.has(key)) return cache.get(key);
    const out = [], S = this.q.bladeS, x0 = ci * 32, z0 = cj * 32, half = this.half;
    for (let i = Math.floor(x0 / S); i < Math.ceil((x0 + 32) / S); i++) for (let j = Math.floor(z0 / S); j < Math.ceil((z0 + 32) / S); j++) {
      const x = (i + h2(i, j, 401)) * S, z = (j + h2(i, j, 402)) * S;
      if (x < x0 || x >= x0 + 32 || z < z0 || z >= z0 + 32) continue;
      const r = this.trailNear(x, z, 8.5); if (!r || r.d < half + .3 || r.d > 8.5) continue;
      if (this.land(x, z) !== OG.meadow) continue;
      // taller with distance from the tread's edge (the edge brushed down a little by passing bikes)
      const sc = (1.4 + h2(i, j, 403) * .4) * (r.d < half + .9 ? .82 : 1);
      out.push(x, this.groundY(x, z) - .03, z, h2(i, j, 404) * 6.28, sc, .86 + h2(i, j, 405) * .26);
    }
    const a = new Float32Array(out); cache.set(key, a); return a;
  }
  _drawBlades(cx, cz) {
    const R = this.q.bladeR, NEAR = 22;
    if (!this.blades) {
      const mat = this._bladeMat(), mk = (g, name) => { const im = new THREE.InstancedMesh(g, mat, 512); im.count = 0; im.name = name; im.frustumCulled = false; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.add(im); return im; };
      this.blades = { near: mk(this._bladeGeometry(16, 3), 'Old growth meadow grass (near)'), far: mk(this._bladeGeometry(7, 2), 'Old growth meadow grass (mid)') };
    }
    const near = [], far = [];
    for (let ci = Math.floor((cx - R) / 32); ci <= Math.floor((cx + R) / 32); ci++) for (let cj = Math.floor((cz - R) / 32); cj <= Math.floor((cz + R) / 32); cj++) {
      if (!this.contains((ci + .5) * 32, (cj + .5) * 32, 40)) continue;
      const a = this._bladeCell(ci, cj);
      for (let k = 0; k < a.length; k += 6) { const d = Math.hypot(a[k] - cx, a[k + 2] - cz); if (d < NEAR) near.push(k, a); else if (d < R) far.push(k, a); }
    }
    const fill = (name, list) => {
      let im = this.blades[name]; const n = list.length / 2;
      if (n > im.instanceMatrix.count) {
        const nim = new THREE.InstancedMesh(im.geometry, im.material, Math.ceil(n * 1.3)); nim.name = im.name; nim.frustumCulled = false; nim.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.remove(im); im.dispose(); this.group.add(nim); this.blades[name] = im = nim;
      }
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), sc = new THREE.Vector3(), c = new THREE.Color();
      for (let i = 0; i < n; i++) {
        const k = list[2 * i], a = list[2 * i + 1];
        q.setFromAxisAngle(Y, a[k + 3]); p.set(a[k], a[k + 1], a[k + 2]); sc.set(1, a[k + 4], 1);
        im.setMatrixAt(i, m.compose(p, q, sc)); im.setColorAt(i, c.setScalar(a[k + 5]));
      }
      im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    };
    fill('near', near); fill('far', far);
    this.stats.blades = (near.length + far.length) / 2;
  }

  /** The meadow's grass beyond the near clumps (8–30 m from a trail): fins — long picture cards of the tall grass,
   *  stood in rows along the trail, staggered, so from the path the field reads as a deep wall of hay-coloured grass
   *  at a fraction of the cost; swaying with the blades. Built per block. */
  _buildFins(B) {
    const x0 = B.i * BLOCK, z0 = B.j * BLOCK, half = this.half;
    const P = [], U = [], C = [], K = [], I = [];
    const u0 = (256 + 8) / 1024, u1 = (512 - 3) / 1024;
    const S = 2.2;
    for (let i = Math.floor(x0 / S); i < Math.ceil((x0 + BLOCK) / S); i++) for (let j = Math.floor(z0 / S); j < Math.ceil((z0 + BLOCK) / S); j++) {
      const x = (i + h2(i, j, 501)) * S, z = (j + h2(i, j, 502)) * S;
      if (x < x0 || x >= x0 + BLOCK || z < z0 || z >= z0 + BLOCK) continue;
      const r = this.trailNear(x, z, 30); if (!r || r.d < 7 + half || r.d > 30) continue;
      if (this.land(x, z) !== OG.meadow) continue;
      const y = this.groundY(x, z), w = 2.4 + h2(i, j, 503) * 1.4, h = 1.45 + h2(i, j, 504) * .4;
      const yaw = Math.atan2(r.dz, r.dx) + (h2(i, j, 505) - .5) * .5, c = Math.cos(yaw) * w / 2, s = Math.sin(yaw) * w / 2;
      const t = .84 + h2(i, j, 506) * .3, base = P.length / 3;
      P.push(x - c, y - .05, z - s, x + c, y - .05, z + s, x + c, y + h, z + s, x - c, y + h, z - s);
      U.push(u0, .03, u1, .03, u1, .99, u0, .99);
      for (let q = 0; q < 4; q++) { C.push(1.1 * t, .96 * t, .68 * t); K.push(q < 2 ? 0 : h); }
      I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    if (!I.length) { B.fins = new THREE.Object3D(); return; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setAttribute('aTall', new THREE.Float32BufferAttribute(K, 1));
    g.setIndex(I); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this._grassMat()); m.name = `Old growth meadow fins ${B.key}`; m.userData.bake = false;
    this.group.add(m); B.fins = m; this.stats.finBlocks = (this.stats.finBlocks || 0) + 1;
  }
  _dropFins(B) { const m = B.fins; if (!m) return; this.group.remove(m); m.geometry?.dispose(); B.fins = null; }
  _grassMat() {
    if (this.grassMat) return this.grassMat;
    const r = this.world.renderer, msaa = !!(r.getContextAttributes?.()?.antialias);
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, map: grassAtlas(r), alphaTest: msaa ? .35 : .5, alphaToCoverage: msaa });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uTime;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; attribute float aTall;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          if (aTall > 0.) { vec3 wp = (modelMatrix * vec4(position, 1.)).xyz; float k = aTall * aTall / 2.5;
            float gust = .5 + .5 * sin(dot(wp.xz, vec2(.09, .03)) - uTime * 1.3) * sin(dot(wp.xz, vec2(.021, -.05)) - uTime * .55);
            vec2 sw = vec2(sin(uTime * 1.7 + wp.x * .41 + wp.z * .23), cos(uTime * 1.3 + wp.z * .37)) * .07 + vec2(.2, .07) * gust;
            transformed.xz += sw * k; }`)
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = vec3(0., 1., 0.);');
    };
    m.customProgramCacheKey = () => `old-growth-grass-2-${msaa}`;
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
        // (god rays only at a few hero spots — user, 24 Nov: "Reduce the number of areas with god rays": the data's
        //  `rays` places; the canopy opens over each, and its light comes down there and nowhere else)
        const spot = this.raySpots.find((q) => Math.hypot(q.x - x, q.z - z) < q.r);
        const gap = spot ? Math.hypot(spot.x - x, spot.z - z) < spot.r * .75 || h2(gi, gj, 301) < .5
          : code === OG.blow ? h2(gi, gj, 301) < .6 : vnoise(x * .045 + 2.3, z * .045 - 7.1) > .74 || h2(gi, gj, 302) < .02;
        if (gap) {
          if (spot && r.d < 22 && h2(gi, gj, 303) < .8) rays.push({ x: x + (h2(gi, gj, 304) - .5) * 3, z: z + (h2(gi, gj, 305) - .5) * 3, y: y0 + 2, w: 1.6 + h2(gi, gj, 306) * 2.4, code });
          continue;
        }
        const cards = code === OG.old ? 2 : 1 + (h2(gi, gj, 307) < .5 ? 1 : 0);
        for (let q = 0; q < cards; q++) {
          const cx = x + (h2(gi, gj, 310 + q) - .5) * S * .8, cz = z + (h2(gi, gj, 312 + q) - .5) * S * .8, cy = y0 + q * 2.8 + h2(gi, gj, 314 + q) * 3;
          const hs = 3 + h2(gi, gj, 316 + q) * 1.8, yaw = h2(gi, gj, 318 + q) * 6.28, tilt = (h2(gi, gj, 320 + q) - .5) * .7;
          // the colour: the woods at peak, lit through from above (user, 24 Nov, photos of a golden beech–maple stand):
          // gold and yellow mostly, orange here and there, a few crowns still yellow-green or green
          const t = h2(gi, gj, 322 + q);
          // (matched to the crowns' even gold, no greens: user, 24 Nov — "Match overhead leaf layer"; a crown's underside,
          //  a shade deeper than its sunlit top)
          const hex = t < .4 ? '#c99428' : t < .66 ? '#d6a634' : t < .82 ? '#be7a26' : t < .92 ? '#b58a2e' : '#a8682a';
          const c = tmpC.set(hex).multiplyScalar(.82 + h2(gi, gj, 330 + q) * .22).toArray();
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
          diffuseColor.rgb *= .78 + .3 * diffuseColor.a;`)
        // (the leaf texture's own colour dropped — its greens read as specks on the gold: only its light and shade kept)
        .replace('#include <map_fragment>', `
          vec4 texelColor = texture2D(map, vMapUv);
          diffuseColor.rgb *= vec3(.4 + 1.1 * dot(texelColor.rgb, vec3(.3, .59, .11)));
          diffuseColor.a *= texelColor.a;`);
    };
    mat.customProgramCacheKey = () => 'old-growth-canopy-3';
    this.canopy = new THREE.Mesh(g, mat); this.canopy.name = 'Old growth canopy'; this.canopy.frustumCulled = false; this.canopy.userData.bake = false; this.canopy.castShadow = false;
    this.group.add(this.canopy);
    this.stats.canopyCards = I.length / 6;
    if (this.q.rays && rays.length) this._buildRays(rays, pools, sunAz);
  }
  _dropCanopy() {
    for (const k of ['canopy', 'rays', 'pools']) { const m = this[k]; if (!m) continue; this.group.remove(m); m.geometry.dispose(); m.material.dispose(); this[k] = null; }
    for (const im of Object.values(this.logMeshes || {})) im.count = 0;
    if (this.flareMesh) this.flareMesh.count = 0;
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
          float a = across * along * shimmer * vFade * .42;
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
      fragmentShader: 'uniform vec3 uColor; varying vec2 vP; varying float vD; void main() { float r = dot(vP, vP); float a = (1. - smoothstep(.15, 1., r)) * .4 * (1. - smoothstep(120., 200., vD)); if (a < .003) discard; gl_FragColor = vec4(uColor * a, 1.); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.pools = new THREE.Mesh(pg, pm); this.pools.name = 'Old growth sun pools'; this.pools.userData.bake = false; this.pools.renderOrder = 4;
    this.group.add(this.pools);
    this.stats.rays = rays.length;
  }
}
