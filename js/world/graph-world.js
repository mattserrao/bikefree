// The 3D view of a free-ride road graph (PGH, js/graph.js): every street, trail and bridge of the graph, the
// ground round them, the rivers, the rider and the chase camera. No buildings, traffic, people or courses — the
// point is the road network. It answers the app the way js/world/world.js does (start, stop, setPath, setSource,
// readiness, …), so the ride screen, the turn prompt and the loading screen work unchanged.
//
// Streaming: the graph is cut into TILE-metre tiles (each edge in pieces of at most PIECE samples, each junction
// in the tile it sits in); the tiles within NEAR_M of the camera are built (roads, paint, bridge sides and the
// ground), nearest first within a per-frame budget, and the ones beyond FAR_M released.
//
// Ground: the graph's terrain grid (tools/build_pgh.py → <id>-ground.grid.bin.gz, 20 m) on a 12.8 m mesh, cut
// down beside the roads so a street on a hillside never disappears into it (the road's own height is the truth:
// the ground steps down to just under it and eases back up). Anything below the river level is river bed: one
// water plane at the pool level shows through there.
import * as THREE from '../../vendor/three.js';
import { setWind } from './toolbox/atmosphere/wind.js';
import { makeProjection } from './geo.js';
import { decodeTerrain } from './toolbox/landscape/real-terrain.js';
import { CANAL, canalAt } from './toolbox/city/cny-landmarks.js';
import { loadTerrainGrid } from '../terrain-grid.js';
import { lockedChase, CAMERAS, CHASE, DEFAULT_CAMERA, leanAlong, stepLean, ROAD_LIFT, PACER_LANE } from './pose.js';
import { loadRider, RIDER_RIM } from './rider.js';
import { RoadRiders } from './toolbox/life/road-riders.js';   // [gap 15] other riders on the road
import { RoadsideCommerce } from './toolbox/city/roadside-commerce.js';   // [business pass] gas stations, fast food, strip malls
import { FarTerrain } from './toolbox/landscape/far-terrain.js';   // [evidence 27 Nov] the land beyond the ground, out to ~45 km
import { makeSkyDome } from './toolbox/atmosphere/sky-dome.js';
import { PostFX } from './toolbox/atmosphere/post.js';
import { createRenderer, pixelRatioFor, QualityGovernor, GpuTimer, snapShadowBox, teardownWorld } from './render-core.js';
import { litMaterial } from './toolbox/materials/lit.js';
import { GroundCover } from './toolbox/landscape/ground-cover.js';
import { grassMaterial } from './toolbox/landscape/grass-cards.js';
import { loadPbrSets, ROAD_PBR, GROUND_PBR, roadSetFor } from './toolbox/materials/pbr-sets.js';
import { SkyEnvironment } from './toolbox/atmosphere/environment.js';
import { resolveMapDefinition } from './toolbox/map-definition.js';
import { SURFACE_SUN, loadSurfaceDetail } from './toolbox/materials/surface-detail.js';
import { MOBILE, PHONE_UA } from './graph/device.js';
import { inRing, inRingGrown, inPairs } from './graph/poly.js';
import { curvePoint, curve, deckSpans } from './graph/curves.js';
import { planJunctions } from './graph/junction-plan.js';
// [review 27 Nov] W13: the roads' and the ground's shaders live in the toolbox now (pure factories, cache keys as they were)
import { CLOUD_T, roadSurfaceMaterial, wornPaintMaterial, sideMaterial } from './toolbox/materials/graph-road.js';
import { groundMaterial } from './toolbox/materials/graph-ground.js';
/** The clouds' clock (their shadows drifting over the ground and the roads; puddles' glints): seconds. */
export { CLOUD_T };
import { PerfMonitor } from './perf.js';
import { BakedLighting } from './toolbox/atmosphere/baked-light.js';
import { ShaderWarmer } from './toolbox/core/shader-warm.js';
import { runSlice, due } from './toolbox/core/jobs.js';
import { installEffects } from './toolbox/effects/index.js';
import { mapProfile } from './toolbox/map-profile.js';
import { makeParkMaterial } from './toolbox/materials/park-surfaces.js';
import { makeMasonryMaterial } from './toolbox/materials/stonework.js';

export const TILE = 400;            // m: a streaming tile
export const PIECE = 32;            // samples: an edge is cut into pieces of at most this many (320 m) for the tiles
export const NEAR_M = 2400;         // tiles whose centre is within this of the camera are built…
export const FAR_M = 3200;          // …and released beyond this
const REACH_LOW = { near: 1700, far: 2300 };   // Low (phones): fewer tiles, the fog nearer
const GROUND_CELL = 12.8;           // m: the ground mesh's spacing (TILE / 31.25)
const BUDGET_MS = 6, PRELOAD_BUDGET_MS = 40;
const RIDER_LANE = 0.22;
const WATER_ABOVE = 0.35;           // the water plane this far above the pool level
const BED_BELOW = 1.2;              // ground this close above the pool (or under it) is pushed down to river bed
// ([review 27 Nov] the drawing buffer's pixel ratio by quality — 1.5 on a 2× screen with 4× MSAA, the anti-aliasing
//  review of 23 Nov — lives in render-core.js pixelRatioFor; its constant left this file, its comment stayed)
const WANT_STEP = 50;                // m the camera goes before the wanted tiles are sorted again ([review 27 Nov] _stream)
const SPILL_IN = 350, SPILL_OUT = 550;   // the ways' spill strips: built within, dropped past (m from a tile's edge)
const KERB = 0.35;                  // the ground's top this far under the road beside it…
const SHELF = 13;                   // …for this far beyond its edge (a ground cell: no triangle reaches over the road)…
const CUT_EASE = 0.75;              // …then back up at this slope (m per m)
const CLEAR = 7;                    // under a bridge deck the ground is at least this far down (the terrain tiles can hold the deck itself)
const CUT_REACH = 40;               // m from a road's edge: beyond this the ground is left as it is
const FILL_SLOPE = 0.66;            // an embankment's side: down 1 m per 1.5 m out (no skirt hanging over a hollow)
const FILL_REACH = 25;              // m from a road's edge the fill reaches
const ABUT_M = 12;                  // m of a deck from its end that stand on an abutment (the ground filled up to under it)
const BANK_CAP = 22;                // m: a walled bank's promenade, from the wall back
const BANK_SLOPE = 14;              // m: a natural bank, from the water's edge to its top
const BANK_RING_M = 9;              // m round a pool's outline its bank is shaped (pools with a ring: NYC)
const PIER_STEP = 7;                // samples (70 m) between a deck's piers
const PROM_M = 6;                   // m of granite paving along the top of a river wall
// ([review 27 Nov] the comments above had run onto one line in a merge: each back beside its own constant)
const ZERO4 = [0, 0, 0, 3];
const SURF_CODE = { asphalt: 0, brick: 1, sett: 2, concrete: 3, paving: 4, gravel: 5, dirt: 6, wood: 7 };   // ([review 27 Nov] a stray comment for a constant long gone dropped here)

const COLORS = {
  primary: '#4c4e52', secondary: '#4c4e52', tertiary: '#4c4e52', residential: '#4c4e52', alley: '#57554f',
  path: '#5f5d59', plaza: '#8e8a83', side: '#7d7a5e', deck: '#8a8780', rail: '#a29e95', under: '#57544f',
};

const TIMES = {
  morning: { label: 'Morning', elev: 16, az: 105, sky: '#9cc0e6', fog: '#e8dccb', hemiSky: '#f6eedf', hemiGround: '#8e8a78', sun: '#ffe2b8', sunI: 1.5, hemiI: 1.25, exposure: 1.0 },
  midday: { label: 'Midday', elev: 55, az: 200, sky: '#7fb0e0', fog: '#cfdde8', hemiSky: '#ffffff', hemiGround: '#a39b88', sun: '#ffffff', sunI: 1.7, hemiI: 1.25, exposure: 1.0 },
  golden: { label: 'Golden hour', elev: 8, az: 258, sky: '#7d8fbf', fog: '#f0c290', hemiSky: '#ffe6c8', hemiGround: '#8a7a64', sun: '#ffc27a', sunI: 1.6, hemiI: 1.2, exposure: 1.05 },
  night: { label: 'Night', elev: 40, az: 150, sky: '#0d1730', fog: '#1c2440', hemiSky: '#7d8fbf', hemiGround: '#2b2b35', sun: '#b4c6ea', sunI: 0.35, hemiI: 0.55, exposure: 1.2, night: true },
};

// CNY, SKAN's golden hour (fixed, baked): the sun a little higher than the generic golden (16°, not 8°) so it still
// lights the fields and its baked shadows read, stronger and warmer against a softer sky light; long shadows to the ENE
const GOLDEN_UPSTATE = { label: 'Golden hour', elev: 16, az: 250, sky: '#a3b6d6', fog: '#cfd3d4', hemiSky: '#ffe8cf', hemiGround: '#7d725e', sun: '#ffcf92', sunI: 2.7, hemiI: 1.12, exposure: 1.14 };

const _v = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

/** An object that never moves: its matrices set now, never recomputed per frame. */
export function freezeMatrix(o) {
  o.updateMatrixWorld(true);
  o.traverse((c) => { c.matrixAutoUpdate = false; c.matrixWorldAutoUpdate = false; });
  return o;
}
/** A grid cell's number (Map keys: numbers, not strings — these lookups run millions of times as tiles build). */
export const cellKey = (i, j) => (i + 0x8000) * 0x10000 + (j + 0x8000);
/** Spatial hash of road samples, for shaping the ground: cell → [x, z, top, halfWidth, fill, …] (top: the highest the ground may be at the
 *  road's edge; fill: the lowest — an embankment under a road above the ground, an abutment under a deck's end; NaN: none). */
export function roadHash(edges, widths, cell = 32, kerbM = KERB) {
  const grid = new Map(), wf = typeof widths === 'function' ? widths : (e) => widths[e.kind] || 7;
  for (const e of edges) {
    const half = wf(e) / 2 + (e._walk ? e._walk : 0);   // (a sidewalk: the ground keeps under it too)
    // a deck sample this near its deck's end (toEnd) stands on the abutment
    const { deck, toEnd } = deckSpans(e);
    // (a hero area's singletrack: the coarse ground kept well under it — the area's fine floor, old-growth.js, is drawn
    //  over the cut and meets the trail's tread)
    const kerb = e._cf ? 0.6 : kerbM;
    const fillAt = (k) => (!deck[k] ? e.ele[k] - kerb : toEnd[k] <= ABUT_M ? e.ele[k] - 1.2 : NaN);
    for (let i = 0; i <= e.n; i++) {
      // the sample and, between samples, the midpoint (10 m samples: a 5 m cut-off would leave notches)
      const below = (k) => (deck[k] ? CLEAR : kerb);
      const pts = [[e.x[i], e.z[i], e.ele[i] - below(i), fillAt(i)]];
      if (i < e.n) pts.push([(e.x[i] + e.x[i + 1]) / 2, (e.z[i] + e.z[i + 1]) / 2, (e.ele[i] + e.ele[i + 1]) / 2 - Math.max(below(i), below(i + 1)), (fillAt(i) + fillAt(i + 1)) / 2]);
      for (const [x, z, y, f] of pts) {
        const key = cellKey(Math.floor(x / cell), Math.floor(z / cell));
        let arr = grid.get(key);
        if (!arr) grid.set(key, (arr = []));
        arr.push(x, z, y, half, f);
      }
    }
  }
  for (const [k, a] of grid) grid.set(k, Float64Array.from(a));
  return {
    cell, grid,
    /** The samples in cell (i, j): [x, z, y, half, fill, …] or undefined. */
    cellAt: (i, j) => grid.get(cellKey(i, j)),
    /** The highest the ground may be at (x, z): under every road near it (Infinity: no road near). */
    cap(x, z, reach = CUT_REACH) {
      const r = Math.ceil(reach / cell), cx = Math.floor(x / cell), cz = Math.floor(z / cell);
      let cap = Infinity;
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
        const arr = grid.get(cellKey(cx + i, cz + j));
        if (!arr) continue;
        for (let k = 0; k < arr.length; k += 5) {
          const dx = arr[k] - x, dz = arr[k + 1] - z, d = Math.sqrt(dx * dx + dz * dz) - arr[k + 3];
          if (d > reach) continue;
          const c = arr[k + 2] + Math.max(0, d - SHELF) * CUT_EASE;
          if (c < cap) cap = c;
        }
      }
      return cap;
    },
    /** The lowest the ground may be at (x, z): the embankments and abutments of the roads near it (-Infinity: none). */
    fill(x, z) {
      const r = Math.ceil(FILL_REACH / cell), cx = Math.floor(x / cell), cz = Math.floor(z / cell);
      let fill = -Infinity;
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
        const arr = grid.get(cellKey(cx + i, cz + j));
        if (!arr) continue;
        for (let k = 0; k < arr.length; k += 5) {
          const f0 = arr[k + 4];
          if (!(f0 > -Infinity)) continue;
          const dx = arr[k] - x, dz = arr[k + 1] - z, d = Math.sqrt(dx * dx + dz * dz) - arr[k + 3];
          if (d > FILL_REACH) continue;
          const f = f0 - Math.max(0, d) * FILL_SLOPE;
          if (f > fill) fill = f;
        }
      }
      return fill;
    },
  };
}

// [plants phase 3, 27 Nov] the desert's ground cover, tuft by tuft (toolbox/landscape/ground-cover.js, one draw): which
// grass card, its colour and height by the cover under it (claude/desert-plant-life-plan.md) — bunchgrass on the flats
// and benches, cheatgrass thick on the disturbed strip beside the road and in town, fall forbs scattered, Indian
// ricegrass pale on the dunes, a few in the slickrock's cracks
const TUFT = Object.freeze({
  bunch: { cell: 5, h: 2, tint: [.95, .95, .92] }, cheat: { cell: 6, h: 1.25, tint: [1, .96, .95] },
  forb: { cell: 7, h: 2.3, tint: [1, 1, 1] }, rice: { cell: 5, h: 1.7, tint: [1.08, 1.04, .98] }, lawn: { cell: 0, h: 1, tint: [.8, .82, .62] },
  // (the shrubs near the rider, at the cover the ecology reports — big sagebrush 6–20%, Davies et al. 2006: the tree
  //  engine's 3D shrubs, one spot per 8 m, reach ~2%; these fill to the real cover inside the tufts' 48 m, as the
  //  verge's leafy scrub card in each shrub's own colours)
  sage: { cell: 4, h: 2.3, w: 2.2, tint: [.74, .78, .66] }, sageS: { cell: 4, h: 1.6, w: 1.6, tint: [.78, .8, .7] },
  snake: { cell: 4, h: 1.1, w: 1.1, tint: [.78, .74, .36] }, rabbit: { cell: 4, h: 2, w: 1.8, tint: [.8, .76, .42] },
  salt: { cell: 4, h: 2, w: 2, tint: [.82, .83, .74] }, sandsage: { cell: 4, h: 2, w: 2, tint: [.86, .89, .78] },   // (silvery: lighter than they're drawn — the first census shots had them charcoal in the low sun)
  black: { cell: 4, h: 1.4, w: 1.5, tint: [.42, .43, .39] },
});
for (const k of Object.values(TUFT)) Object.freeze(k);
const tuftHash = (x, z) => { const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return v - Math.floor(v); };
// ([review 27 Nov] the answer written into `out` (one object a world, read at once by ground-cover.js) from the frozen
//  kinds: it had spread a new { d, ...kind } for every tuft planted — ~460 a cell, 7–9 cells a crossing)
export function desertTuft(c, x, z, GRASS, out = {}) {
  if (c.onRoad(x, z, 1.2) || c.inWater?.(x, z)) return 0;
  const k = c.landAt(x, z), r = tuftHash(x, z), verge = c.onRoad(x, z, 7);
  let d = GRASS[k] || 0;
  if (verge && k !== 5) d = Math.max(d, .45);   // (the road's disturbed strip: cheatgrass, whatever the cover)
  if (!d) return 0;
  d *= .25 + 1.3 * tuftHash(Math.floor(x / 9) + .31, Math.floor(z / 9) + .17);   // (in patches, not a sown field)
  // (a shrub's share: about a tenth of the spots on the sage flats — 3.2 spots/m² × d × share × ~1 m² a shrub ≈ the
  //  published cover; the plant census, tools/reference/plant_census.py, measures it)
  const s = tuftHash(x * 1.7 + 3.1, z * 1.3 + 7.7);
  const shrub = verge ? (s < .1 ? (s < .07 ? TUFT.snake : TUFT.rabbit) : null)
    : k === 41 ? (s < .13 ? (s < .06 ? TUFT.sage : s < .08 ? TUFT.sageS : s < .1 ? TUFT.rabbit : s < .115 ? TUFT.snake : TUFT.salt) : null)
      : k === 40 ? (s < .08 ? (s < .05 ? TUFT.sage : TUFT.snake) : null)
        : k === 5 ? (s < .35 ? (s < .28 ? TUFT.sandsage : TUFT.rabbit) : null)
          : k === 42 ? (s < .15 ? TUFT.black : null) : null;
  const kind = shrub || (verge ? (r < .7 ? TUFT.cheat : r < .85 ? TUFT.forb : TUFT.bunch)
    : k === 5 ? TUFT.rice : k === 43 ? (r < .5 ? TUFT.cheat : r < .8 ? TUFT.lawn : TUFT.forb)
      : k === 41 ? (r < .6 ? TUFT.bunch : r < .82 ? TUFT.cheat : TUFT.forb) : (r < .75 ? TUFT.bunch : TUFT.forb));
  out.d = d; out.cell = kind.cell; out.h = kind.h; out.w = kind.w; out.tint = kind.tint;
  return out;
}

/** [review 27 Nov] every mesh in `root`, now and as it's added (to root or to any group in it, however deep), takes
 *  the live shadow map — the baked maps' moving shadows (_frame had walked the tiles' and the city's trees every 30
 *  frames to find the new ones: thousands of objects). */
export function receiveOnAdd(root) {
  const hook = (g) => { g.userData._rsAdd = 1; const add = g.add; g.add = function (...objs) { const r = add.apply(this, objs); for (const o of objs) mark(o); return r; }; };
  const mark = (o) => o.traverse((c) => { if (c.isMesh) { if (!c.userData._rs) { c.userData._rs = 1; c.receiveShadow = true; } } else if (!c.userData._rsAdd) hook(c); });
  mark(root);
}

/** [review 27 Nov] the n lamp heads nearest (x, z) within r, from a city's tiles (graph-city.js t.lampHeads: x, y, z),
 *  written to out (x, y, z each), nearest first; the count found. No allocation: the 3 × 3 tiles round the point. */
export function nearestLampHeads(city, x, z, r, out, n) {
  const T = city?.tiles; if (!T) return 0;
  const D = nearestLampHeads.d ||= new Float64Array(16);
  let found = 0;
  const ci = Math.floor(x / TILE), cj = Math.floor(z / TILE), r2 = r * r;
  for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
    const H = T.get(`${i},${j}`)?.lampHeads; if (!H) continue;
    for (let k = 0; k < H.length; k += 3) {
      const dx = H[k] - x, dz = H[k + 2] - z, d = dx * dx + dz * dz;
      if (d >= r2 || (found === n && d >= D[n - 1])) continue;
      let q = found < n ? found++ : n - 1;   // (insertion into the sorted few)
      while (q > 0 && D[q - 1] > d) { D[q] = D[q - 1]; out[q * 3] = out[q * 3 - 3]; out[q * 3 + 1] = out[q * 3 - 2]; out[q * 3 + 2] = out[q * 3 - 1]; q--; }
      D[q] = d; out[q * 3] = H[k]; out[q * 3 + 1] = H[k + 1]; out[q * 3 + 2] = H[k + 2];
    }
  }
  return found;
}

export class GraphWorld {
  /**
   * @param container  the ride view's element
   * @param base       the graph's base route (js/graph.js graphNetwork): `base.graph` is the decoded graph
   * @param opts       { log, quality, path (NetRide) }
   */
  constructor(container, base, opts = {}) {
    this.container = container;
    this.cloudTime = CLOUD_T;   // (seconds: the clouds, ripples)
    this.route = base;
    this.G = base.graph;
    this.json = this.G.json;
    // the map's rules, from its data (toolbox/map-profile.js: CNY's and SKAN's are the defaults; PGH pins "city")
    this.profile = mapProfile(this.json);
    this.def = resolveMapDefinition({ kind: 'graph', json: this.json });   // [map-definition] the one shape every map resolves to
    this.rural = this.profile.dressing === 'country';   // (countryside dressing: graph-city.js)
    this.log = opts.log || (() => {});
    this.path = opts.path || null;
    this.areaSet = null;
    this.graphWorld = true;
    this.p = 0;
    this.crank = 0;
    this.running = false;
    this.source = null;
    this.pacerSource = null;
    this.qualityKey = opts.quality || 'balanced';
    this.weatherKey = 'clear';
    const o = this.json.origin;
    this.proj = makeProjection(o.lat, o.lon);
    this.widths = this.json.widths || {};
    // per edge (js/world/graph-city.js sets them once the city data is in: trail and riverwalk widths, sidewalks)
    this.wOf = (e) => e._w ?? (this.widths[e.kind] || 7);
    this.walkOf = (e) => e._walk || 0;
    this.isRiverwalk = (e) => !!e._rw;

    // the base line in the local frame (NetRide.pose places the rider on it: routePoint reads index.xs / zs)
    const n = base.lat.length, xs = new Float64Array(n), zs = new Float64Array(n);
    for (let i = 0; i < n; i++) { const q = this.proj.toLocal(base.lat[i], base.lon[i]); xs[i] = q.x; zs[i] = q.z; }
    this.index = { xs, zs, nearest: () => null };

    // every edge in the local frame, cut into pieces per tile; junctions per tile
    for (const e of this.G.edges) {
      e.x = new Float64Array(e.n + 1); e.z = new Float64Array(e.n + 1);
      for (let i = 0; i <= e.n; i++) { const q = this.proj.toLocal(e.lat[i], e.lon[i]); e.x[i] = q.x; e.z[i] = q.z; }
    }
    this.tiles = new Map();
    // [review 27 Nov] the tiles with work or meshes, kept as they change (_stream had scanned every tile in the map —
    // PGH: > 1000 — each frame for these): built, waiting for their spill, with a spill mesh
    this._built = new Set(); this._spillWait = new Set(); this._spilled = new Set();
    const tileOf = (x, z) => `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
    const slot = (key) => { let t = this.tiles.get(key); if (!t) this.tiles.set(key, (t = { key, pieces: [], nodes: [], built: false })); return t; };
    for (const e of this.G.edges) {
      for (let a = 0; a < e.n; a += PIECE) {
        const b = Math.min(e.n, a + PIECE), m = (a + b) >> 1;
        slot(tileOf(e.x[m], e.z[m])).pieces.push({ e, a, b });
      }
    }
    this.nodeWidth = new Map();
    this._nodeWidths();
    // the ways into each junction (crosswalks)
    this.arms = new Map();
    for (const e of this.G.edges) for (const [id, end] of [[e.from, 0], [e.to, 1]]) { if (!this.arms.has(id)) this.arms.set(id, []); this.arms.get(id).push({ e, end }); }
    this._planJunctions();
    for (const nd of this.G.nodes.values()) {
      const q = this.proj.toLocal(nd.lat, nd.lon);
      slot(tileOf(q.x, q.z)).nodes.push({ id: nd.id, x: q.x, z: q.z, y: nd.ele });
    }
    for (const [key, t] of this.tiles) { const [i, j] = key.split(',').map(Number); t.cx = (i + 0.5) * TILE; t.cz = (j + 0.5) * TILE; t.i = i; t.j = j; }
    this._grainOn = !this.profile.softCover;   // (tools/qc-park.js)
    this.cut = roadHash(this.G.edges, this.widths, 32, this.profile.edgeFlush ? 0.05 : KERB);   // (NYC: the lawns flush with the paths' edges, no step down)
    this.waterY = (this.json.waterLevelM ?? 216.6) + WATER_ABOVE;
    // upper pools (above a dam: the Allegheny above Lock & Dam 2) — their own water level inside their box
    // (a pool may carry its outline — "ring": NYC's park lakes — and then it's water only inside it, drawn by its shape)
    this.pools = (this.json.pools || []).map((p) => { const a = this.proj.toLocal(p.box[0], p.box[1]), b = this.proj.toLocal(p.box[2], p.box[3]); const ring = p.ring ? p.ring.map(([la, lo]) => this.proj.toLocal(la, lo)) : null; return { level: p.level, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z), west: a.x, dam: p.dam !== false, ring, name: p.name }; });
    // bridges a landmark model draws on a way's own deck (NYC's Bow Bridge, Gapstow): the deck's samples within r of
    // each [lat, lon, r] — no slab sides, parapets, underside or piers of the world's own there (bits 1|2|4)
    this.modelDecks = null;
    for (const [la, lo, r] of this.profile.modelBridges || []) {
      const c = this.proj.toLocal(la, lo);
      for (const e of this.G.edges) for (const [a, b] of e.bridges) {
        let hit = false; for (let i = a; i <= b; i++) if (Math.hypot(e.x[i] - c.x, e.z[i] - c.z) < r) hit = true;
        if (!hit) continue;
        const m = ((this.modelDecks ||= new Map()).get(e.id)) || new Uint8Array(e.n + 1); this.modelDecks.set(e.id, m);
        for (let i = a; i <= b; i++) m[i] |= 7;
      }
    }
    // ground pads (NYC: Bethesda's lower terrace): level ground inside each outline, easing back over blendM outside
    this.pads = (this.json.pads || []).map((q) => { const ring = q.ring.map(([la, lo]) => this.proj.toLocal(la, lo)); let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const p of ring) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); } const m = q.blendM ?? 2; return { ring, y: q.y, m, x0: x0 - m, x1: x1 + m, z0: z0 - m, z1: z1 + m }; });
    // the pools drawn on their outlines (NYC): a grid of their shore segments, for the banks (_ringBank)
    this._bankGrid = null;
    if (this.pools.some((p) => p.ring)) {
      const g = this._bankGrid = new Map(), C = 16;
      for (const p of this.pools) if (p.ring) for (let k = 0; k < p.ring.length; k++) {
        const a = p.ring[k], b = p.ring[(k + 1) % p.ring.length];
        for (let x = Math.floor((Math.min(a.x, b.x) - BANK_RING_M) / C); x <= Math.floor((Math.max(a.x, b.x) + BANK_RING_M) / C); x++)
          for (let z = Math.floor((Math.min(a.z, b.z) - BANK_RING_M) / C); z <= Math.floor((Math.max(a.z, b.z) + BANK_RING_M) / C); z++) { const key = x * 100003 + z; if (!g.has(key)) g.set(key, []); g.get(key).push(p, k); }
      }
    }

    // renderer, scene, light
    // (no logarithmic depth: it writes gl_FragDepth, which turns off a phone GPU's early depth test and hidden-surface
    // removal — every layer of overdraw shaded in full; the near and far planes below keep plain depth precise enough.
    // No MSAA on Low: phones. Both are fixed for the renderer's life: a quality change applies from the next ride.)
    this.renderer = createRenderer({ container, quality: this.qualityKey });
    // [render-core] adaptive resolution (then thinner new tiles, then a shorter shadow box) when frames run long
    this.governor = new QualityGovernor({ quality: this.qualityKey, onScale: () => this._pixelRatio(), onLevel: (l) => { this._govLevel = l; this._reach(); } });
    this.gpuTimer = new GpuTimer(this.renderer);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.6, 9000);   // (the fog ends at 2.6 km; the farthest tile 3.2 km)
    this.camTarget = new THREE.Vector3();
    this._camInit = false;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.scene.fog = new THREE.Fog(0xcfdde8, 900, NEAR_M + 200);
    // CNY, SKAN (user, 22 Nov: "set the time of day to golden hour and remove the option…; pre-baked shadows for the
    // one time of day"): the sun fixed low in the west-southwest, its shadows baked (toolbox/atmosphere/baked-light.js)
    // for the static scenery — ground, roads, houses, barns, trees (each tile's crown proxies) — in a window round the
    // rider that re-bakes as the ride moves on; the live shadow map keeps only the moving things near the rider
    const goldenUpstate = this.profile.light === 'golden-upstate';
    this.fixedTime = goldenUpstate ? 'golden' : null;
    if (goldenUpstate) {
      // (a city's bake — PGH, user 26 Nov: "change the lighting style to match" — on a phone at 3 m cells: a third of
      //  the memory of the 2 m maps, for the map that has run phones out of memory before)
      const phoneCity = this.profile.preset === 'city' && PHONE_UA.test(globalThis.navigator?.userAgent || '');
      this.baked = BakedLighting.create(this._bakeView(), { baked: 'golden', windowM: 3200, windowMoveM: 700, reachM: 900, cellM: phoneCity ? 3 : 2, marginM: 0, dynamicSpanM: 40,
        prepTimeoutS: 45, groundAt: (x, z) => (this.ground ? this._groundH(x, z) : 0) }, { golden: GOLDEN_UPSTATE });
      if (this.baked) {
        const sh = this.sun.shadow; sh.mapSize.set(1024, 1024); sh.bias = -0.0006; sh.normalBias = 0.04; sh.camera.near = 1; sh.camera.far = 12000;
      }
    }
    this._reach();
    this.mats = {
      road: sideMaterial(this.qualityKey === 'low'),
      paint: this.profile.roads === 'worn' ? wornPaintMaterial() : litMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }, 'paint'),
      ground: groundMaterial(this.qualityKey === 'low', this.profile.ground === 'upstate', !!this.profile.softCover, this.profile.ground === 'desert'),
      roadSurface: roadSurfaceMaterial(this.qualityKey === 'low', this.profile.roads === 'worn'),
      spill: roadSurfaceMaterial(this.qualityKey === 'low', this.profile.roads === 'worn', true),
      water: litMaterial({ color: '#4f7f97', transparent: true, opacity: 0.92 }, 'water'),
      // the dressed places and the river walls: textured from world position (toolbox/materials)
      // [review 27 Nov] the dressed places' materials made two-sided here, before they compile (the dressing job had
      // flipped .side on them after, with no needsUpdate — and on the granite the promenade draws one-sided: its own)
      park: Object.fromEntries(['lawn', 'plaza', 'granite', 'walk', 'garden', 'wood', 'scrub', 'fairway', 'green', 'sand'].map((k) => [k, twoSided(makeParkMaterial(k))])),
      promenade: makeParkMaterial('granite'),
      riverWall: makeMasonryMaterial({ stones: ['#8f897d', '#9b9487', '#857f74', '#a29b8e', '#8a8376', '#7f796f'], mortar: '#b3ada1', courseM: 0.45, moss: '#4f5a3c', mossM: 1.2 }),
      parkWall: twoSided(makeMasonryMaterial({ stones: ['#a39a8a', '#958c7c', '#ab9f8c', '#8f8576', '#9c9282', '#b0a693'], mortar: '#c2b9a8', courseM: 0.3, mossM: 0.4 })),
      fountainWater: litMaterial({ color: '#5d93ad', transparent: true, opacity: 0.88, side: THREE.DoubleSide }, 'water'),
      spray: litMaterial({ color: '#f4f8fb', transparent: true, opacity: 0.55, depthWrite: false }),
      trunk: litMaterial({ color: '#5b4636' }, 'wood'),
      crown: litMaterial({ color: '#ffffff', flatShading: true }, 'foliage'),
    };
    // [surfaces] the road's PBR set (KTX2: toolbox/materials/pbr-sets.js), near the camera; not on Phone
    if (this.qualityKey !== 'low') {
      const set = this.def.assets.textures.find((n) => n.startsWith('asphalt')) || roadSetFor(this.profile);
      loadPbrSets(this.renderer, [set, 'turf']).then((t) => {
        if (this.disposed) return;
        if (t[set]) { ROAD_PBR.albedo.value = t[set].albedo; ROAD_PBR.nra.value = t[set].nra; ROAD_PBR.on.value = 1; }
        if (t.turf) { GROUND_PBR.albedo.value = t.turf.albedo; GROUND_PBR.nra.value = t.turf.nra; GROUND_PBR.on.value = 1; }
      })
        .catch((e) => this.log('3d', `road textures: ${e.message}`, 'debug'));
    }
    // the graphics effects this map asks for (toolbox/effects: the JSON's "effects" block; none when absent)
    this.TILE = TILE;
    // where people stay put (fishing, benches, groups, farm stands: toolbox/city/graph-life.js): the landmarks' (fixed)
    // and the city tiles' (keyed by tile)
    this.lifeSpots = []; this.tileSpots = new Map();
    this.effects = installEffects(this, this.json.effects);
    // shader programs compiled behind the loader, then again as new things stream in (no first-draw hitches)
    this.shaders = new ShaderWarmer(this.renderer, this.scene, this.camera);
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(2 * FAR_M + 4000, 2 * FAR_M + 4000).rotateX(-Math.PI / 2), this.mats.water);
    this.water.position.y = this.waterY;
    this.scene.add(this.water);
    this._fixed = [];   // [review 27 Nov] the pools' water and the dams: their geometry freed in dispose()
    for (const p of this.pools) {
      if (p.ring) {   // its shape, grown 2 m (the ground rises from under it at the edge)
        const sh = new THREE.Shape(p.ring.map((q) => new THREE.Vector2(q.x, -q.z)));
        const g = new THREE.ShapeGeometry(sh).rotateX(-Math.PI / 2), cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
        const pos = g.attributes.position;
        for (let i = 0; i < pos.count; i++) { const dx = pos.getX(i) - cx, dz = pos.getZ(i) - cz, d = Math.hypot(dx, dz) || 1; pos.setXYZ(i, pos.getX(i) + dx / d * 2, 0, pos.getZ(i) + dz / d * 2); }
        g.computeVertexNormals();
        const w = new THREE.Mesh(g, this.mats.water); w.name = p.name || 'Pool'; w.position.y = p.level + WATER_ABOVE; this.scene.add(w); this._fixed.push(w);
        continue;
      }
      const w = new THREE.Mesh(new THREE.PlaneGeometry(p.x1 - p.x0, p.z1 - p.z0).rotateX(-Math.PI / 2), this.mats.water);
      w.position.set((p.x0 + p.x1) / 2, p.level + WATER_ABOVE, (p.z0 + p.z1) / 2);
      this.scene.add(w); this._fixed.push(w);
      if (!p.dam) continue;   // (a lake's pieces: SKAN's Skaneateles and Otisco lakes — no dam)
      // the dam: a concrete face across the box's downstream edge, from the lower pool's bed to the upper water
      const lowY = this.waterY - WATER_ABOVE - 3, topY = p.level + WATER_ABOVE + 0.6;
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(p.west, lowY, p.z0), new THREE.Vector3(p.west, lowY, p.z1), new THREE.Vector3(p.west, topY, p.z1), new THREE.Vector3(p.west, topY, p.z0)]);
      g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals();
      const dam = new THREE.Mesh(g, this.mats.dam ||= litMaterial({ color: '#a09c92', side: THREE.DoubleSide }, 'concrete'));   // [review 27 Nov] (one material for every dam, freed with the rest)
      this.scene.add(dam); this._fixed.push(dam);
    }
    this.group = new THREE.Group();
    this.scene.add(this.group);
    // the tiles' meshes never move: their matrices are set once, not recomputed every frame (850 objects: a few ms a
    // frame on a phone)
    { const add = this.group.add.bind(this.group); this.group.add = (...objs) => { for (const o of objs) freezeMatrix(o); return add(...objs); }; }
    if (this.baked) receiveOnAdd(this.group);   // ([review 27 Nov] the live shadow on each mesh as it's added: _frame had walked both trees every 30 frames)

    // the ground grid (fetched; the roads stream without it and the ground follows)
    this.ground = null;
    this.groundFailed = false;
    const url = new URL(`../../${this.json.ground}`, import.meta.url);
    const dressUrl = this.json.dressing ? new URL(`../../${this.json.dressing}`, import.meta.url) : null;
    const dressP = dressUrl ? fetch(dressUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null) : Promise.resolve(null);
    const shoreUrl = this.json.shore ? new URL(`../../${this.json.shore}`, import.meta.url) : null;
    const shoreP = shoreUrl ? fetch(shoreUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null) : Promise.resolve(null);
    fetch(url).then((r) => { if (!r.ok) throw new Error(`${r.status} for ${this.json.ground}`); return r.arrayBuffer(); })
      .then((buf) => Promise.all([loadTerrainGrid(buf), shoreP, dressP])).then(([grid, shore, dressing]) => {
        if (this.disposed) return;
        this.shore = shore ? decodeShore(shore, this.proj) : null;
        this.dressing = dressing ? decodeDressing(dressing, this.proj, TILE) : null;
        this.ground = decodeTerrain(grid, this.proj);
        // the landmarks, the bridges and the city, once the ground is there to stand on
        this._loadHeroes();
        this._loadBridges();
        for (const t of this.tiles.values()) if (t.built && !t.groundMesh) t.needsGround = true;
        this.log('3d', 'PGH ground loaded', 'debug');
      }).catch((err) => { this.groundFailed = true; this.log('3d', `PGH ground: ${err.message}`, 'error'); });

    // rider: a stand-in until the model loads
    this.rider = makeStandIn();
    this.scene.add(this.rider.group);
    this._riderModel = 'loading';
    loadRider().then((r) => {
      this._riderModel = 'ok';
      if (this.disposed) { r.dispose(); return; }
      this.scene.remove(this.rider.group); this.rider.dispose?.();   // [review 27 Nov] (the stand-in's box and material)
      this.rider = r;
      this.scene.add(r.group);
    }).catch((err) => { this._riderModel = 'failed'; this.log('3d', `Using the simple rider: ${err.message}`, 'debug'); });

    this._nightLights();
    this.setTimeOfDay('midday');
    this._resize = () => {
      const w = container.clientWidth || 1, h = container.clientHeight || 1;
      this.renderer.setSize(w, h, false);
      this.post?.setSize(w * this.renderer.getPixelRatio(), h * this.renderer.getPixelRatio());
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    this._ro = new ResizeObserver(this._resize);
    this._ro.observe(container);
    this._resize();
    this._frame = this._frame.bind(this);
    this._last = performance.now();
  }

  // ---------- the app's World API ----------
  setSource(fn) { this.source = fn; }
  setPacerSource(fn) { this.pacerSource = fn; this._pacerInit = false; }
  /** [gap 15] the virtual pacer drawn on the graph maps too (as in the route scenes, world.js): the checker-jersey rider
   *  on its own path through the junctions, a bike-width further in so you can ride alongside or pass. */
  _updatePacer(dt) {
    const src = this.pacerSource ? this.pacerSource() : null;
    if (!src || !this.path) { if (this.pacer) this.pacer.group.visible = false; return; }
    if (!this.pacer) {
      if (!this._pacerLoading && !this._pacerFailed) this._pacerLoading = loadRider({ jersey: 'checker' }).then((r) => {
        if (this.disposed) { r.dispose(); return; } this.pacer = r; this.scene.add(r.group);
      }).catch((err) => { this._pacerFailed = true; this.log('3d', `Pacer model: ${err.message}`, 'debug'); });
      return;
    }
    if (!this._pacerInit) { this.ps = src.pos; this.pacerCrank = 0; this._pacerInit = true; }
    let x = this.ps + (src.speed || 0) * dt;
    const err = src.pos - x;
    this.ps = Math.max(0, Math.abs(err) > 60 ? src.pos : x + err * Math.min(1, dt * 1.5));
    const path = src.path || this.path;
    const lane = this.city ? PACER_LANE * this._laneScale(this.ps) : PACER_LANE;
    const pose = path.pose(this.ps, this.index, lane), P = this._pacerPose ||= { pos: new THREE.Vector3(), fwd: new THREE.Vector3() };
    P.pos.set(pose.pos.x, pose.pos.y, pose.pos.z); P.fwd.set(pose.fwd.x, pose.fwd.y, pose.fwd.z);
    this.pacerCrank += ((src.cadence || 0) / 60) * Math.PI * 2 * dt;
    this.pacer.group.visible = true;
    this.pacer.update(P.pos, P.fwd, this.pacerCrank, src.speed || 0, Math.min(dt, 0.1), src);
  }
  setPath(path) { this.path = path || null; }
  setCourseMarks() {}                             // (no arches on a free ride)
  setPreload(on) { this._preload = !!on; }
  get waitingForArea() { return false; }
  weatherOptions() { return []; }
  setWeather(key) { this.weatherKey = key; }
  timeOptions() { return Object.entries(TIMES).filter(([key]) => !this.fixedTime || key === this.fixedTime).map(([key, t]) => ({ key, label: t.label })); }
  setQuality(key) {
    this.qualityKey = key || 'balanced';
    this._nightLights();   // (off Light: the night's lights, if this map has night)
    this._reach();
    this.governor?.setQuality(this.qualityKey);
    this._pixelRatio();
    if (this.city && this.gfx) this.city.setGfx(this.gfx);
    if (this._postMode !== (this._postOn() ? 'full' : this.qualityKey === 'balanced' ? 'lite' : null)) this._postFor(null);   // [review 27 Nov] (the next frame makes the new level's)
  }
  _pixelRatio() {
    this.governor?.setTarget(this._saving ? 30 : (this.gfx?.fps || 0));
    const scale = (this._saving ? .75 : 1) * (this.governor?.scale ?? 1);
    this.renderer.setPixelRatio(pixelRatioFor(this.qualityKey, scale));
    this._resize();
  }
  /**
   * The graphics menu's finer settings (user, 23 Nov: "additional graphic settings specially for laptops"):
   *   fps       a frame-rate cap: 0 (none), 60 or 30
   *   battery   'off' | 'on' | 'auto' (on while unplugged, where the browser says): 30 fps and 75 % resolution
   *   distance  how far the scenery's built, × (0.7 near, 1 normal, 1.3 far)
   *   trees     how many trees new tiles plant, × (0.6, 1, 1.4)
   *   shadows   the live shadows of moving things (the scenery's are baked)
   *   atmosphere  sun beams, mist, leaves, motes;  verge  roadside grass and brush;  life  people, parked cars, animals
   */
  setGfx(g = {}) {
    this.gfx = { fps: 0, battery: 'off', distance: 1, trees: 1, shadows: true, atmosphere: true, verge: true, life: true, post: true, ...g };
    this._reach();
    if (this.baked) this.sun.castShadow = this.gfx.shadows && !!this.baked.world.terrain.quality.shadows; else { this._sunCasts ??= this.sun.castShadow; this.sun.castShadow = this.gfx.shadows && this._sunCasts; }
    this.effects?.set?.('atmosphere', this.gfx.atmosphere);
    this._treeShadows();
    this.city?.setGfx(this.gfx);
    const apply = (saving) => { if (saving !== this._saving) { this._saving = saving; this._pixelRatio(); } };
    if (this.gfx.battery === 'auto' && globalThis.navigator?.getBattery) {
      // [review 27 Nov] the listener kept (battery, handler) so dispose() takes it off: it held `this` — every finished
      // world kept alive, and a plug-in after a ride called _pixelRatio on a disposed renderer
      navigator.getBattery().then((b) => {
        if (this.disposed) return;
        const f = () => { if (!this.disposed) apply(this.gfx.battery === 'auto' && !b.charging); }; f();
        if (!this._battery) { this._battery = { b, f }; b.addEventListener('chargingchange', f); }
      }).catch(() => apply(false));
    } else apply(this.gfx.battery === 'on');
  }
  setCamera(key) { this.camKey = CAMERAS[key] ? key : DEFAULT_CAMERA; this._camInit = false; }
  setTimeOfDay(key) {
    if (this.fixedTime) key = this.fixedTime;   // (CNY, SKAN: golden hour only, its shadows baked)
    if (!TIMES[key]) key = 'midday';
    let t = this.profile.light === 'golden-upstate' && key === 'golden' ? GOLDEN_UPSTATE : TIMES[key];
    // [zwift-look] a map's key light (the grade effect: a stronger sun against a softer sky light)
    if (this.lightTune && !t.night) t = { ...t, sunI: t.sunI * this.lightTune.sun, hemiI: t.hemiI * this.lightTune.sky, exposure: t.exposure * this.lightTune.exposure };
    // (a map's own sun for its fixed time: NYC's early fall afternoon a little higher than upstate's golden hour)
    if (this.profile.sun && key === this.fixedTime) t = { ...t, ...this.profile.sun };
    this.timeKey = key;
    const el = THREE.MathUtils.degToRad(t.elev), az = THREE.MathUtils.degToRad(t.az);
    this.sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    this.sun.color.set(t.sun); this.sun.intensity = t.sunI;
    this.hemi.color.set(t.hemiSky); this.hemi.groundColor.set(t.hemiGround); this.hemi.intensity = t.hemiI;
    this.renderer.toneMappingExposure = t.exposure;
    RIDER_RIM.value.set(t.sun).multiplyScalar(t.night ? .08 : 1);
    this.scene.background = new THREE.Color(t.sky);
    if (!this.sky) { this.sky = makeSkyDome({ radius: 8500 }); this.scene.add(this.sky.mesh); }
    this.sky.set(t, this.sunDir, this.profile.clouds);
    // [lighting] the sky as environment light (toolbox/atmosphere/environment.js): the PBR scenery's ambient and its
    // reflections come from the sky above and the ground below; the hemisphere light stays as a small fill
    this.env ||= new SkyEnvironment(this.renderer);
    this.scene.environment = this.env.update(this.sky, t.hemiGround);
    this.scene.environmentIntensity = t.hemiI * (t.night ? .4 : .75);   // (tuned against the Lambert look: the sun-to-shade contrast kept, the shade a little cooler)
    this.hemi.intensity = t.hemiI * .3;
    SURFACE_SUN.value.copy(this.sunDir);
    if (this.qualityKey !== 'low') loadSurfaceDetail(this.renderer);
    this.scene.fog.color.set(t.fog);
    setWind(this.profile.wind || [.8, .6], (this.profile.windK ?? 1) * (t.night ? .5 : 1));   // (one wind for the trees and the grass: the map's own)
    this.heroes?.setNight(t.night ? 1 : 0);
    if (this.baked) { this.baked.setLight(t); this.sun.castShadow = (this.gfx?.shadows ?? true) && !!this.baked.world.terrain.quality.shadows; }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.baked?.prepare();   // the first bake behind the loader
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._frame);
  }
  stop() { this.running = false; cancelAnimationFrame(this._raf); }
  renderOnce() { const r = this.running; this.running = true; this._frame(performance.now()); this.running = r; cancelAnimationFrame(this._raf); }

  togglePerf(on, place) {
    this.perf ||= new PerfMonitor(this.renderer, this.container, () => ({ route: this.json.name, quality: this.qualityKey, time: this.timeKey }), place);
    return this.perf.toggle(on);
  }

  /** What the baked lighting reads of a world (toolbox/atmosphere/baked-light.js), for this road graph: the tiles and
   *  the city (two roots), a window round the camera (the whole map's extent as the 'route'), the loading state. */
  _bakeView() {
    const self = this, big = 1e6;
    const terrain = {
      get group() { return self.group; },
      kit: true,
      city: { _pending: [] },
      stats: { get loading() { const c = self.city; return !self.ground || (self.json.cityData && (!c || !c.ready || c.pendingNear(self.camera.position.x, self.camera.position.z, 900))) ? 1 : 0; } },
      get quality() { return { shadows: self.qualityKey !== 'low' }; },
      heightAt: (x, z) => (self.ground ? self._groundH(x, z) : 0),
    };
    return {
      get renderer() { return self.renderer; }, get scene() { return self.scene; }, get camera() { return self.camera; },
      log: (...a) => self.log(...a), area: null, terrain,
      get road() { return self.heroes?.group || null; }, shoulder: null,
      index: { xs: [-big, big], zs: [-big, big] }, route: { minEle: (self.json.waterLevelM ?? 100) - 5 },
      heroPost: false, post: null, get qualityKey() { return self.qualityKey; },
    };
  }

  /** The loading screen: ground, roads round the start, the rider. */
  readiness() {
    const steps = [], add = (key, label, p) => { p = Math.max(0, Math.min(1, p)); steps.push({ key, label, p, done: p >= 1 }); };
    const near = this._nearTiles || [];
    const roads = near.length ? near.filter((t) => t.built).length / near.length : 0;
    const ground = this.groundFailed ? 1 : !this.ground ? 0 : near.length ? near.filter((t) => t.groundMesh || !t.built).length / near.length * roads : 0;
    add('streets', 'Roads', (this._frames || 0) > 0 ? roads : 0);
    add('ground', 'Ground', ground);
    add('riders', 'Rider', this._riderModel !== 'loading' ? 1 : 0);
    // [review 27 Nov] the bridges and the city wait on the ground, not on the landmarks: a failed landmarks load is
    // reported (its step marked failed, and in `degraded`), the rest of the map still loads
    if (this.json.heroes) { add('landmarks', this._heroesState === 'failed' ? 'Landmarks (failed to load)' : 'Landmarks', this._heroesState && this._heroesState !== 'loading' ? 1 : 0); if (this._heroesState === 'failed') steps.at(-1).failed = true; }
    if (this.json.bridges && (this.ground || this.groundFailed)) add('bridges', 'Bridges', this.groundFailed || this._bridgesState && this._bridgesState !== 'loading' ? 1 : 0);
    if (this.json.cityData && (this.ground || this.groundFailed)) {
      const c = this.city, p = this._cityState === 'failed' || this.groundFailed ? 1 : !c ? 0 : !c.ready ? 0.3 : c.pendingNear(this.camera.position.x, this.camera.position.z, 900) ? 0.7 : 1;
      add('city', 'Buildings and trees', p);
    }
    if (this.baked && this.running) add('light', 'Lighting', this.baked.preparing ? this.baked.progress : this.baked.ready || !this.baked.preparing ? 1 : 0);
    // last: the shader programs, once everything above is in the scene
    if (steps.every((s) => s.done)) this._warmStart = true;
    if (this.shaders && this.running) add('shaders', 'Shaders', this._warmStart ? this.shaders.progress : 0);
    const degraded = [['landmarks', this._heroesState], ['bridges', this._bridgesState], ['city', this._cityState]].filter(([, st]) => st === 'failed').map(([k]) => k);
    return { ready: steps.every((s) => s.done), failed: this.groundFailed, degraded, progress: steps.reduce((a, s) => a + s.p, 0) / steps.length, steps };
  }
  get loading() { return (this._queued || 0) > 6 || this.baked?.preparing ? 4 : 0; }

  dispose() {
    if (this.disposed) return;
    this.roadRiders?.dispose(); this.roadRiders = null;
    this.commerce?.dispose(); this.commerce = null;
    if (this.far) { this.scene.remove(this.far.mesh); this.far.dispose(); this.far = null; }
    this.post?.dispose(); this.post = null; this.env?.dispose(); this.groundCover?.dispose(); this.sky?.dispose();
    this.effects?.dispose();
    this.stop();
    this.disposed = true;
    this._ro?.disconnect();
    // [review 27 Nov] the battery listener held this world (and called _pixelRatio on its disposed renderer)
    if (this._battery) { this._battery.b.removeEventListener('chargingchange', this._battery.f); this._battery = null; }
    for (const t of this.tiles.values()) this._release(t);
    if (this.spillAll) { this.spillAll.geometry.dispose(); this.spillAll = null; }
    for (const m of Object.values(this.mats)) { if (m.dispose) m.dispose(); else for (const x of Object.values(m)) x.dispose?.(); }
    this.heroes?.dispose();
    this.bridges?.dispose();
    this.city?.dispose();
    this.water.geometry.dispose();
    // [review 27 Nov] what dispose() had left on the GPU: the pools and dams, the riders, the live shadow map
    for (const m of this._fixed) m.geometry.dispose();
    this.rider?.dispose?.(); this.pacer?.dispose?.(); this.pacer = null;
    for (const l of [this.sun, this.headlight]) if (l?.shadow?.map) { l.shadow.map.dispose(); l.shadow.map = null; }
    this.perf?.dispose?.();
    this.baked?.dispose();
    teardownWorld(this.renderer, this.scene);   // (the rest of the scene, the figures' caches, forceContextLoss)
  }

  // ---------- the frame ----------
  _frame(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._frame);
    // a frame-rate cap (the graphics menu; battery saver: 30): skip the display's frames between ours
    const cap = this._saving ? 30 : this.gfx?.fps || 0;
    if (cap && now - (this._lastDraw || 0) < 1000 / cap - 2) return;
    this._lastDraw = now;
    this._frames = (this._frames || 0) + 1;
    this.perf?.begin(now);
    const dt = Math.min(1.0, (now - this._last) / 1000);
    this._last = now;
    const src = this.source ? this.source() : { pos: 0, speed: 0, cadence: 0, riding: false };
    const out = this._pose ||= { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), flat: new THREE.Vector3() };
    if (this.path) {
      let x = this.p + (src.speed || 0) * dt;
      const err = src.pos - x;
      x = Math.abs(err) > 60 ? src.pos : x + err * Math.min(1, dt * 1.5);
      this.p = Math.max(0, x);
      this._place(this.p, RIDER_LANE, out);
    }
    this.crank += ((src.cadence || 0) / 60) * Math.PI * 2 * dt;
    CLOUD_T.value = now / 1000;
    this.sky?.tick(this.camera, now / 1000);
    this.heroes?.tick(now / 1000, dt);
    this.effects.tick(now / 1000, dt);
    this.city?.tick(this.camera.position, now / 1000, this.path ? out : null, dt);
    this.commerce?.tick(this.camera);
    if (this.far) this.far.tick(this.camera, { sunDir: this.sunDir, sun: this.sun, fogColor: this.scene.fog?.color, ambient: this._farAmb ||= new THREE.Color() });
    if (this.far) this._farAmb.copy(this.hemi.color).multiplyScalar(this.hemi.intensity * .55);
    if ((this._frames & 15) === 0) this.bridges?.tick(this.camera.position, this.qualityKey === 'low' ? 3000 : 4500);
    this.rider.update(out.pos, out.fwd, this.crank, src.speed || 0, Math.min(dt, 0.1), src);
    this._updatePacer(dt);
    // [gap 15] company on the road: a few riders in other kits on the way you ride (none on Light, or where a map says so)
    if (this.path && !this.roadRiders && this.qualityKey !== 'low' && this.profile.riders !== false && !this.gfx?.noRiders)
      this.roadRiders = new RoadRiders(this, { count: { ultra: 8, high: 6, balanced: 4 }[this.qualityKey] ?? 4 });
    this.roadRiders?.tick(dt, this.p, src.speed || 0);
    if (this.path) {
      const tmp = this._leanTmp ||= { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), flat: new THREE.Vector3() };
      this._lean = stepLean(this._lean, leanAlong((s) => this._place(s, RIDER_LANE, tmp), this.p, src.speed || 0, { minS: 0 }), Math.min(dt, 0.1));
      this.rider.setLean?.(this._lean);
    }
    this._updateCamera(out.pos, out.flat, out.fwd, dt);
    // [night lights] the bike's headlight, as in the route scenes (world.js): lights the road and anyone ahead at night
    // ([review 27 Nov] made with the world, dark by day: _nightLights)
    if (this.headlight) {
      const on = this.timeKey === 'night' && this.qualityKey !== 'low';
      this.headlight.intensity = on ? 650 : 0;
      if (on) { this.headlight.position.copy(out.pos).addScaledVector(out.flat, .6).y += 1.1; this.headlight.target.position.copy(out.pos).addScaledVector(out.flat, 22); }
    }
    this._lampLights(out.pos);
    // building as you ride: a few ms a frame (less on Light: phones, whose frames are tighter), all of it while loading
    const low = this.qualityKey === 'low';
    this._stream(this.camera.position.x, this.camera.position.z, this._preload ? PRELOAD_BUDGET_MS : low ? 3 : BUDGET_MS);
    this.city?.stream(this.camera.position.x, this.camera.position.z, this._preload ? 30 : low ? 2.5 : 4);
    this.groundCover?.tick(this.camera.position);
    this.water.position.x = Math.round(this.camera.position.x / 100) * 100;
    this.water.position.z = Math.round(this.camera.position.z / 100) * 100;
    if (!this.baked) { this.sun.position.copy(this.camera.position).addScaledVector(this.sunDir, 5000); this.sun.target.position.copy(this.camera.position); }
    else {
      this.baked.tick(dt);
      // the live shadow map: the moving things in a small box round the rider (the bake has the rest)
      const c = this.sun.shadow.camera, span = this.baked.dynamicSpan;
      if (c.right !== span) { c.left = -span; c.right = span; c.top = span; c.bottom = -span; c.updateProjectionMatrix(); }
      // [review 27 Nov] the box moved in whole texels of the map (render-core.js snapShadowBox, as world.js
      // _placeShadows), not with the rider's every centimetre: the shadows' edges had shimmered as you rode
      const at = snapShadowBox(this.rider.group.position, this.sunDir, span, this.sun.shadow.mapSize.x, this._shadowAt ||= new THREE.Vector3());
      this.sun.position.copy(at).addScaledVector(this.sunDir, 2000); this.sun.target.position.copy(at);
      if ((this._frames % 120) === 7) this._treeShadows();
      if (this.baked.preparing) { this.perf?.end(performance.now()); return; }   // (nothing drawn behind the loader: the bake has the GPU)
    }
    this.shaders?.tick(dt, this._warmStart || this._frames > 600);
    if (this._preload && this._frames % 4) return;
    this.gpuTimer?.begin('frame');
    this._draw();
    this.gpuTimer?.end();
    if ((this._frames & 7) === 0) this.gpuTimer?.poll();
    // the governor reads the GPU's own time where the timer exists, else the frame interval
    if (!this._preload) { const g = this.gpuTimer?.ms.frame; this.governor?.sample(g ?? dt * 1000, dt, g == null); }
    this.perf?.end(performance.now());
  }

  /**
   * Post-processing (user, 24 Nov — Zwift parity, item 3): on High, on a laptop or desktop, and unless switched off in
   * More graphics, the scene draws into an HDR target with 4× MSAA, then the final pass adds contact shading (a
   * depth-only SSAO), a soft bloom on the brightest light and a light grade, and tone-maps. Phones and the other
   * levels draw straight to the canvas as before.
   */
  /** Desktop High with live shadows on: the near trees' leafy shadows in the live map (2048 px, 60 m box). */
  _treeShadows() {
    const on = this._postOn() && (this.gfx?.shadows ?? true) && !!this.baked;
    this.city?.forest?.castShadows(on);
    // (the near cascade — fidelity step 4: the live map is the crisp near one round the rider, the bake the far one;
    //  Ultra's twice the texels over a wider box: ~3.9 cm a texel to 80 m, High's ~5.9 cm to 60 m)
    const ultra = this.qualityKey === 'ultra' && on;
    if (this.baked) { this.baked.dynamicSpan = ultra ? 80 : on ? 60 : this.baked.opts.dynamicSpanM; const sz = ultra ? 4096 : on ? 2048 : 1024; this.sun.shadow.radius = ultra ? 3 : on ? 2.2 : 1.5;   /* (PCF's Vogel disk: softer edges, no stair-steps) */ if (this.sun.shadow.mapSize.x !== sz) { this.sun.shadow.mapSize.set(sz, sz); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; } }
  }
  /** [night lights] the six lamps nearest the rider as real lights (the pools on the ground are decals; these light the
   *  rider, the figures and the cars as they pass under them, as Zwift's lamps do since its 2025 lighting update). */
  _lampLights(at) {
    if (!this._lamps) return;
    const on = this.timeKey === 'night' && this.qualityKey !== 'low';
    if (!on) { if (this._lampT !== -2) { for (const l of this._lamps) l.intensity = 0; this._lampT = -2; } return; }
    if ((this._frames & 31) !== 0 && this._lampT >= 0) return;
    this._lampT = this._frames;
    // ([review 27 Nov] from the city's lamp heads by tile (graph-city.js t.lampHeads), not a walk of the scene for every
    //  lamp instance's matrix and a clone each: the old walk looked for 'Lamp glows', a name the graph city's glows
    //  ('Lamp glows <tile>') never had, so no lamp had ever lit)
    const P = this._lampAt ||= new Float32Array(this._lamps.length * 3), n = nearestLampHeads(this.city, at.x, at.z, 120, P, this._lamps.length);
    this._lamps.forEach((l, i) => { l.intensity = i < n ? 60 : 0; if (i < n) l.position.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); });
  }
  /** [review 27 Nov] the night's lights made with the world, at nothing by day: the headlight and the six lamps had been
   *  added on the first night frame, a change in the light count that recompiles every lit material then (the shader
   *  warm-up had only seen the day). On the maps whose time can't be night (a fixed golden hour) and on Light, none:
   *  seven lights at nothing still cost their loop in every lit pixel. (Visible always: a hidden light leaves the
   *  count too.) */
  _nightLights() {
    if (this.fixedTime || this.qualityKey === 'low' || this._lamps) return;
    this.headlight = new THREE.SpotLight('#fff1d6', 0, 85, .58, 1, 1.5); this.scene.add(this.headlight, this.headlight.target);
    this._lamps = Array.from({ length: 6 }, () => { const l = new THREE.PointLight('#ffd9a0', 0, 22, 2); this.scene.add(l); return l; });
    this._lampT = -1;
  }
  _postOn() { return (this.qualityKey === 'high' || this.qualityKey === 'ultra') && !MOBILE && (this.gfx?.post ?? true); }
  /** [review 27 Nov] the post pass for a mode ('full': High/Ultra's 4× MSAA HDR, the air; 'lite': Balanced's 2×, AO
   *  only), made afresh when the mode changes — a High→Balanced switch had kept the 4× HDR target and drew the air
   *  over the scene's own fog, no longer pushed back (double haze). */
  _postFor(mode) {
    if (this.post && this._postMode === mode) return this.post;
    this.post?.dispose(); this.post = null; this._postMode = mode;
    if (!mode) return null;
    this.post = new PostFX(this.renderer, { samples: mode === 'full' ? 4 : 2 });
    this.post.setAO(mode === 'full' ? { strength: .7, radiusM: .7 } : { strength: .55, radiusM: .6 });
    const w = this.container?.clientWidth || this.renderer.domElement.clientWidth || 1, h = this.container?.clientHeight || this.renderer.domElement.clientHeight || 1;
    this.post.setSize(w * this.renderer.getPixelRatio(), h * this.renderer.getPixelRatio());
    return this.post;
  }
  _draw() {
    const mode = this._postOn() ? 'full' : this._liteOn() ? 'lite' : null;
    this._postFor(mode);
    if (mode === 'full') {
      // [sky] aerial perspective and sun shafts in the post pass; the scene's linear fog stands back (the post is the air)
      const A = this._atmo ||= { sunDir: new THREE.Vector3(), sunColor: new THREE.Color(), haze: new THREE.Color() };
      const sky = this.def?.sky || {};
      A.density = sky.airDensity ?? 4.5e-4; A.falloff = sky.airFalloff ?? 1 / 220; A.baseY = sky.airBaseM ?? (this.waterY ?? 0) - 5;   // (a high map's air from its own valley floor: Out West's at 1,450 m)
      A.strength = 1; A.shafts = sky.shafts ?? .5;   // [review 27 Nov] (was behind the comment above: no sun shafts on any graph map)
      A.sunDir.copy(this.sunDir); A.sunColor.copy(this.sun.color).multiplyScalar(this.sun.intensity * .35); A.haze.copy(this.scene.fog.color).multiplyScalar(.9);
      this.post.setAtmosphere(A);
      const fog = this.scene.fog, near = fog.near, far = fog.far; fog.near = near * 2.2; fog.far = far * 1.6;
      this.post.render(this.scene, this.camera, { bloom: .22, threshold: 1.15, warm: this.timeKey === 'golden' ? 1 : 0 });
      fog.near = near; fog.far = far;
    } else if (mode === 'lite') {
      // [fidelity step 4] Balanced on a laptop or desktop, with headroom: the plain picture through 2× MSAA with the
      // contact shading (the AO's 8 taps, near only) — no HDR, bloom or air; off again the moment the governor steps down
      this.post.render(this.scene, this.camera, { grade: false });
    } else this.renderer.render(this.scene, this.camera);
  }
  /** Balanced's lite post (AO + MSAA): desktop only, More graphics' post on, the governor at full resolution, and the
   *  GPU's measured frame (where the timer exists) under 60 % of the budget (until it passes 80 %). */
  _liteOn() {
    if (this.qualityKey !== 'balanced' || MOBILE || !(this.gfx?.post ?? true) || (this.governor?.level ?? 0) > 0) return false;
    const g = this.gpuTimer?.ms?.frame, b = 10.5;
    if (g == null) return true;   // (no timer — Safari: the governor alone gates it)
    // (hysteresis: on under 60 % of the budget, off over 80 %, so it doesn't flap with its own cost)
    this._lite = this._lite ? g < b * .8 : g < b * .6;
    return this._lite;
  }

  /** The rider's lane on a narrow way (a hero area's singletrack, under ~2 m): the middle of the tread, eased in and out
   *  over ~12 m either side of where it starts and ends (user: "the bike trail is narrow throughout"). */
  _laneScale(p) {
    const P = this.path?.own || this.path; if (!P?.entries || !P.entryAt) return 1;   // (a follower's own path)
    const narrow = (q) => { const x = P.entries[P.entryAt(Math.max(0, q))]; const e = x && this.G.byId.get(x.t.e.id); return e && this.wOf(e) < 2 ? 0 : 1; };
    return (narrow(p - 12) + narrow(p - 6) + 2 * narrow(p) + narrow(p + 6) + narrow(p + 12)) / 6;
  }
  _place(p, lane, out) {
    if (lane && this.city) lane *= this._laneScale(p);
    const pose = this.path.pose(p, this.index, lane);
    out.pos.set(pose.pos.x, pose.pos.y, pose.pos.z);
    out.fwd.set(pose.fwd.x, pose.fwd.y, pose.fwd.z);
    out.flat.set(pose.flat.x, 0, pose.flat.z);
    return out;
  }

  /** Ground height at (x, z) as drawn (the grid, cut under the roads, river bed under the water), or null before it loads. */
  heightAt(x, z) {
    if (!this.ground) return null;
    return this._groundH(x, z);
  }
  /** The pool level at (x, z): an upper pool inside its box, else the main one. */
  poolAt(x, z) {
    for (const p of this.pools || []) if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1 && (!p.ring || inRingGrown(p.ring, x, z, 3))) return p.level;
    return this.waterY - WATER_ABOVE;
  }
  /** The water's surface here (the pool level and the plane's lift above it). */
  waterTop(x, z) { return this.poolAt(x, z) + WATER_ABOVE; }
  /** The ground as its mesh draws it here (the 12.8 m grid's triangles), or the raw height where that tile isn't built. */
  surfaceH(x, z) {
    // ([review 27 Nov] the last tile looked up kept: the ground cover asks ~460 times a cell, all in one tile — a key
    //  string each time. Tiles stay in the map once made, released or not, so a kept one never goes stale)
    const ti = Math.floor(x / TILE), tj = Math.floor(z / TILE), L = this._shTile;
    let tt = L && L.i === ti && L.j === tj ? L : null;
    if (!tt && (tt = this.tiles.get(`${ti},${tj}`))) this._shTile = tt;
    if (!tt || !tt.gridH) return this._groundH(x, z);
    const c = tt.gridCell, n1 = Math.round(TILE / c) + 1, u = (x - tt.i * TILE) / c, v = (z - tt.j * TILE) / c;
    const i = Math.min(n1 - 2, Math.max(0, Math.floor(u))), j = Math.min(n1 - 2, Math.max(0, Math.floor(v))), fu = u - i, fv = v - j;
    const H = tt.gridH, a0 = H[j * n1 + i], b0 = H[j * n1 + i + 1], c0 = H[(j + 1) * n1 + i], d0 = H[(j + 1) * n1 + i + 1];
    return fu + fv <= 1 ? a0 + (b0 - a0) * fu + (c0 - a0) * fv : d0 + (c0 - d0) * (1 - fu) + (b0 - d0) * (1 - fv);
  }
  /** In a ground pad's outline (or its blend)? */
  _inPad(x, z) { return this.pads.some((q) => x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1 && inRingGrown(q.ring, x, z, q.m)); }
  /** The nearest pool outline within BANK_RING_M of (x, z): { p, s } with s the signed distance (m, < 0 in the water). */
  _ringBank(x, z) {
    const list = this._bankGrid?.get(Math.floor(x / 16) * 100003 + Math.floor(z / 16));
    if (!list) return null;
    let best = null;
    for (let q = 0; q < list.length; q += 2) {
      const p = list[q], k = list[q + 1], a = p.ring[k], b = p.ring[(k + 1) % p.ring.length];
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
      const d = Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
      if (d < BANK_RING_M && (!best || d < best.d)) best = { p, d };
    }
    if (!best) return null;
    return { p: best.p, s: inRing(best.p.ring, x, z) ? -best.d : best.d };
  }
  _groundH(x, z) {
    const raw = this.ground.at(x, z);
    let h = raw, rb = null;
    const pool = this.poolAt(x, z);
    const f = this.cut.fill(x, z);
    if (f > h) h = f;   // under a road above the ground: its embankment, a deck's abutment
    // (a pad after the roads' fill: a terrace is cut level right up to its wall, the road's bank stops there)
    for (const q of this.pads) {
      if (x < q.x0 || x > q.x1 || z < q.z0 || z > q.z1) continue;
      const r = q.ring; let d = Infinity; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)); d = Math.min(d, Math.hypot(a.x + dx * t - x, a.z + dz * t - z)); }
      if (inRing(r, x, z)) h = q.y; else if (d < q.m) h = q.y + (h - q.y) * (d / q.m);
    }
    const sh = this.shore ? this.shore.at(x, z) : null;
    if (sh && sh.s > -16 && sh.s < (sh.walled ? BANK_CAP + 12 : BANK_SLOPE)) {
      // the riverbank (tools/pgh_shore.mjs): drawn by the bank mesh; the ground keeps out of its way
      if (sh.walled) {
        if (sh.s < 2) h = pool - 20;                                              // in front of the wall: deep (no sliver of slope pokes out)
        else if (raw > sh.top && sh.s > 8) h = Math.max(h, raw);                  // a hill right behind the promenade stays
        else if (sh.s <= BANK_CAP) h = sh.top - 0.15;                             // the promenade (filled up or cut down to it)
        else { const t = (sh.s - BANK_CAP) / 12; h = (sh.top - 0.15) * (1 - t) + Math.max(h, pool + BED_BELOW) * t; }
      } else if (sh.s < 0) h = Math.min(h, pool - 2.5);
      else h = bankProfile(sh.s, sh.top, sh.pool + WATER_ABOVE, sh.pool) - 0.15;
    } else if (this._bankGrid && (rb = this._ringBank(x, z))) {
      // a pool drawn on its outline (NYC's lakes): its bank one smooth slope through the water's edge — under the water
      // inside (no ground poking up through it), up to the water 1 m out (the water plane reaches 2 m out: its rim
      // is never left standing over a drop), on up at 1 : 2.2, then the ground as it is
      const top = rb.p.level + WATER_ABOVE, want = Math.max(rb.p.level - 2.2, top + (rb.s - 1) * 0.45);
      if (rb.s < 1) h = Math.min(h, want);
      if (rb.s > -0.5) h = Math.max(h, Math.min(want, top + 0.5));   // (a low shore filled to just over the water, no more)
    } else if (h < pool + BED_BELOW && !(this._bankGrid && pool > -1e3 && this.pools.some((p) => p.ring && p.level === pool))) h = Math.min(h, pool - 2.5);
    // under the canal (CNY, once its water is built): the ground cut down below the water, so the coarse grid's
    // triangles — and the raised towpath's fill — never show through it as green streaks (user, 23 Nov)
    // (the grid's 12.8 m triangles span the water's edge: the ground rises from under the water gently — 12 cm a metre
    // out to 14 m past the edge — so no triangle from a bank vertex reaches up through the water)
    if (this._canalCut) { const c = canalAt(x, z, 14); if (c && !c.creek) { const o = (x - c.x) * c.nx + (z - c.z) * c.nz, s = Math.max(0, o > 0 ? o - c.w1 : -o - c.w2); h = Math.min(h, c.y - .45 + s * .12); } }
    h = Math.min(h, this.cut.cap(x, z));
    // (a bridge's ground cut beside a pool drawn on its outline: the bank still rises to the water's edge, so the water
    //  plane's rim never hangs over the cut — the deck stands well over the water anyway)
    if (rb && rb.s > -0.5 && rb.s < 2.5) h = Math.max(h, Math.min(rb.p.level + WATER_ABOVE + (rb.s - 1) * 0.45, rb.p.level + WATER_ABOVE + 0.2));
    return h;
  }
  /** The canal's built (the landmarks): cut the ground under it, and again in the tiles already built. */
  _cutCanal() {
    if (!CANAL.samples.some((p) => !p.creek)) return;
    this._canalCut = true;
    // [review 27 Nov] a tile whose ground job is part-way through its grid (groundRows) started again: the rows it had
    // done were sampled uncut (CNY's green streaks in the canal). Nothing of its ground is in the scene before the
    // mesh, so dropping the job is enough; _stream starts it afresh (its roads, built, skipped)
    if (this._tjob?.t.groundRows) { this._tjob.t.groundRows = false; this._tjob = null; }
    for (const t of this.tiles.values()) {
      const m = t.groundMesh; if (!m || !t.gridH) continue;
      const near = CANAL.samples.some((p) => !p.creek && p.x > t.i * TILE - 40 && p.x < (t.i + 1) * TILE + 40 && p.z > t.j * TILE - 40 && p.z < (t.j + 1) * TILE + 40);
      if (!near) continue;
      const P = m.geometry.attributes.position;
      for (let k = 0; k < P.count; k++) { const y = this._groundH(P.getX(k), P.getZ(k)); P.setY(k, y); t.gridH[k] = y; }
      P.needsUpdate = true; m.geometry.computeVertexNormals(); m.geometry.computeBoundingSphere();
    }
  }

  _updateCamera(riderPos, flat, fwd, dt) {
    const K = CAMERAS[this.camKey] || CHASE;
    const pos = _v.copy(riderPos).addScaledVector(flat, -K.back).addScaledVector(UP, K.up);
    const look = (this._look ||= new THREE.Vector3()).copy(riderPos).addScaledVector(fwd, K.ahead).addScaledVector(UP, K.lookUp);
    const g = this.heightAt(pos.x, pos.z);
    if (g != null && pos.y < g + K.ground) pos.y = g + K.ground;
    if (Math.abs(this.camera.fov - K.fov) > 0.01) { this.camera.fov = K.fov; this.camera.updateProjectionMatrix(); }
    if (!this._camInit) { this.camera.position.copy(pos); this.camTarget.copy(look); this._camInit = true; this._chaseOff = null; }
    else lockedChase(this, riderPos, pos, look, dt, K.back, (x, z) => { const h = this.heightAt(x, z); return h == null ? null : h + K.ground; });
    this.camera.lookAt(this.camTarget);
  }

  // ---------- streaming ----------
  _nodeWidths() {
    this.nodeWidth = new Map();
    for (const e of this.G.edges) for (const id of [e.from, e.to]) this.nodeWidth.set(id, Math.max(this.nodeWidth.get(id) || 0, this.wOf(e)));
    if (this.arms) this._planJunctions();
  }

  /** A point on edge e's drawn centre line at fractional sample f (graph/curves.js curvePoint; graph-life.js walks it). */
  _curvePoint(e, f) { return curvePoint(e, f); }

  /** The junctions' plan (graph/junction-plan.js): → this.jn (node id → { x, z, y, poly, corners, arms, J }), this.trim
   *  (edge id → [m cut at from, m cut at to]). [review 27 Nov] W14: a pure module now; re-run when the widths change. */
  _planJunctions() {
    const { jn, trim } = planJunctions(this.arms, { wOf: this.wOf, walkOf: this.walkOf, curbs: this.profile.junctionCurbs });
    this.jn = jn; this.trim = trim;
  }

  /** How far the tiles are built and the fog closes in, by quality (Low: phones). */
  _reach() {
    const low = this.qualityKey === 'low';
    const k = (this.gfx?.distance || 1) * ((this._govLevel || 0) >= 4 ? .85 : 1);   // (the governor's level 4+: a nearer horizon)
    const lowReach = low || MOBILE;   // (phones and tablets: Light's reach at any quality — memory, user 23 Nov)
    this.nearM = (lowReach ? REACH_LOW.near : NEAR_M) * k; this.farM = (lowReach ? REACH_LOW.far : FAR_M) * k;
    if (this.scene?.fog) { this.scene.fog.near = lowReach ? 700 : 900; this.scene.fog.far = this.nearM + 200; }
  }

  /**
   * The landmarks (the map's hero models: js/world/graph-heroes.js), then the city. [review 27 Nov] The landmarks are
   * optional: a 404 (now checked) or a failed build leaves a bare host (graph-heroes' stand-in for the city scene, with
   * no heroes in it) so the city still streams — before, the city and the bridges started only from the landmarks'
   * success, and a failure dropped every building while readiness() said ready. The failure shows in readiness().
   */
  _loadHeroes() {
    if (this._heroesState || !(this.json.heroes || this.json.cityData)) return;
    this._heroesState = 'loading';
    const build = (hj) => import('./graph-heroes.js').then(({ buildGraphHeroes }) => buildGraphHeroes(this, hj));
    const err3d = (what, err) => this.log('3d', `${what}: ${err.message} ${(err.stack || '').split('\n').slice(0, 4).join(' | ')}`, 'error');
    (this.json.heroes ? fetch(new URL(`../../${this.json.heroes}`, import.meta.url)).then((r) => { if (!r.ok) throw new Error(`${r.status} for ${this.json.heroes}`); return r.json(); }).then(build)
      : Promise.resolve(null))
      .then((h) => { this._heroesState = h ? 'ok' : 'none'; return h; }, (err) => { this._heroesState = 'failed'; err3d('PGH landmarks', err); return null; })
      .then((h) => h || (this.json.cityData && !this.disposed ? build({ heroes: [], buildings: [], landmarks: [] }) : null))
      .then((h) => {
        if (!h) return;
        if (this.disposed) { h.dispose(); return; }
        this.heroes = h; this.scene.add(h.group); h.setNight(this.timeKey === 'night' ? 1 : 0);
        if (this.baked) receiveOnAdd(h.group);   // ([review 27 Nov] the landmarks' and the city's meshes take the live shadows as they come)
        if (this.bridges?.glows) h.addGlows?.(this.bridges.glows, 'Bridge lamps');   // (the bridges in first)
        this._cutCanal(); this._loadCity();
      })
      .catch((err) => { if (this.json.cityData) this._cityState = 'failed'; err3d('PGH landmarks (bare host)', err); });
  }

  /** PGH's city (js/world/graph-city.js, tools/pgh_city.py): buildings, trees, furniture, the land cover and what each
   *  edge is made of. Once it's in, the edges take their widths and sidewalks and the tiles are rebuilt. */
  _loadCity() {
    if (!this.json.cityData || this._cityState || !this.heroes) return;
    this._cityState = 'loading';
    fetch(new URL(`../../${this.json.cityData}`, import.meta.url)).then((r) => { if (!r.ok) throw new Error(`${r.status} for ${this.json.cityData}`); return r.json(); })
      .then((cj) => import('./graph-city.js').then(({ GraphCity }) => {
        if (this.disposed) return;
        const c = new GraphCity(this, this.heroes, cj);
        this.city = c;
        if (this.gfx) c.setGfx(this.gfx);
        this._classify(c);
        this.cut = roadHash(this.G.edges, this.wOf, 32, this.profile.edgeFlush ? 0.05 : KERB);
        this._nodeWidths();
        return c.loadLand().then(() => {
          if (this.disposed) return;
          // [business pass] the roadside businesses OpenStreetMap maps here (tools/fetch_commerce.py): gas stations, fast food,
          // strip malls — not on Light
          if (this.qualityKey !== 'low') fetch(new URL(`../../routes/cities/${this.json.id}-commerce.json`, import.meta.url)).then((r) => (r.ok ? r.json() : null))
            .then((j) => { if (j && !this.disposed) this.commerce = new RoadsideCommerce(this, c, j); }).catch(() => {});
          // [evidence 27 Nov] the land beyond the ground (tools/far_terrain.py): the mesas and mountains the photos'
          // skylines are made of, 4–45 km off, one mesh (a map's profile asks for it: farTerrain)
          if (this.profile.farTerrain && !this.far) fetch(new URL(`../../routes/cities/${this.json.id}-far.json`, import.meta.url)).then((r) => (r.ok ? r.json() : null))
            .then((j) => { if (!j || this.disposed) return; this.far = new FarTerrain(j, this.proj, { desert: this.profile.ground === 'desert', farPlane: this.camera.far * .95 }); this.scene.add(this.far.mesh); }).catch(() => {});
          const b = c.landBox, U = this.mats.ground.userData.land;
          if (U) { U.uLand.value = c.landTexture; U.uLandBox.value.set(b.x0, b.z0, b.x1, b.z1); U.uLandOn.value = 1; }
          // [vegetation] tufts on every lawn, yard and pasture near the rider (toolbox/landscape/ground-cover.js); not on Phone
          if (this.qualityKey !== 'low' && !this.groundCover) {
            const desert = this.profile.ground === 'desert';
            // [evidence 27 Nov] the desert's flats are bunchgrass between the sage (the photos), not bare sand: pinyon-juniper
            // benches thin, sage flats thick, the town's gravel lots sparse
            const GRASS = desert ? { 5: .1, 40: .22, 41: .42, 42: .05, 43: .2 } : { 1: 1, 8: .7, 11: .9 };   // LAND.grass, yards, pasture: how thick
            // (its own copy of the verge's material: no depth written — the tufts are sorted far to near instead, so the
            //  contact shading doesn't take a tuft's back card for a crease: ground-cover.js)
            const mat = grassMaterial(this.renderer, c.treeTime || { value: 0 }, this.qualityKey !== 'low'); mat.depthWrite = false; mat.side = THREE.FrontSide;
            this.groundCover = new GroundCover({ parent: this.scene, material: mat, radius: this.qualityKey === 'ultra' ? 64 : this.qualityKey === 'high' ? 48 : 38, density: 3.2,
              isGrass: desert ? ((o) => (x, z) => desertTuft(c, x, z, GRASS, o))({}) : (x, z) => { const g = GRASS[c.landAt(x, z)] || 0; return g && !c.onRoad(x, z, 1.2) && !c.inWater?.(x, z) ? g : 0; },
              heightAt: (x, z) => this.surfaceH(x, z), tint: desert ? [1.45, 1.12, 1.05] : null });
          }
          for (const t of this.tiles.values()) if (t.built) this._release(t);
          this._cityState = 'ok';
          this.log('3d', `PGH city: ${Object.keys(cj.sectors.list).length} sectors, streamed`, 'debug');
        });
      }))
      .catch((err) => { this._cityState = 'failed'; this.log('3d', `PGH city: ${err.message} ${(err.stack || '').split('\n').slice(0, 3).join(' | ')}`, 'error'); });
  }

  /**
   * What each edge is (from the city data): a trail's width (a main trail 3.6 m, a park path 2.6 m), a riverwalk (a
   * paved walk along the water: 5.5 m of concrete or pavers), a street's sidewalks (in built-up places: 3.2 m on the
   * main streets among shops, 2.4 m elsewhere on them, 1.8 m on residential streets; none where OSM says none), and
   * its surface sample by sample (OSM's, plus the Pittsburgh map's rule: a residential street of 7 % or more,
   * 25 m or longer, among the houses, is red brick). Worked out once by tools/pgh_city.py; read from the index here.
   */
  _classify(c) {
    for (const e of this.G.edges) {
      const d = c.edgeData[e.id] || {}, info = c.edgeInfo(e);
      e._surf = new Array(e.n + 1);
      for (let i = 0; i <= e.n; i++) e._surf[i] = info.surf(i);
      if (d.w) e._w = d.w;
      if (d.rw) e._rw = true;
      if (d.cf) e._cf = true;   // (an old-growth hero area's singletrack: tools/cny_forest.py — drawn narrow, on the area's own floor)
      if (d.walk > 0) e._walk = d.walk;
    }
    // the villages (SKAN: Skaneateles, Marcellus — user, 22 Nov: "full village"): a sidewalk along every street inside
    const V = this.heroes?.json?.villages;
    if (V?.length) {
      const C = V.map((v) => ({ ...this.proj.toLocal(v.center[0], v.center[1]), r: v.r }));
      for (const e of this.G.edges) {
        if (e._walk || !['primary', 'secondary', 'tertiary', 'residential'].includes(e.kind)) continue;
        const m = e.n >> 1, x = e.x[m], z = e.z[m];
        if (C.some((c) => Math.hypot(x - c.x, z - c.z) < c.r)) e._walk = e.kind === 'residential' ? 1.6 : 2.2;
      }
    }
  }

  /** PGH's bridge models (js/world/graph-bridges.js, tools/pgh_bridges.mjs): built once; the tiles they stand in are
   *  rebuilt without the world's plain piers (and a ridden roadway's parapets) where a model stands. */
  _loadBridges() {
    if (!this.json.bridges || this._bridgesState) return;
    this._bridgesState = 'loading';
    fetch(new URL(`../../${this.json.bridges}`, import.meta.url)).then((r) => { if (!r.ok) throw new Error(`${r.status} for ${this.json.bridges}`); return r.json(); })
      .then((bj) => import('./graph-bridges.js').then(({ buildGraphBridges }) => buildGraphBridges(this, bj)))
      .then((b) => {
        if (this.disposed) { b.dispose(); return; }
        this.bridges = b; this.bridgeMask = b.mask; this.scene.add(b.group); b.tick(this.camera.position, this.qualityKey === 'low' ? 3000 : 4500);
        this.heroes?.addGlows?.(b.glows, 'Bridge lamps');
        for (const t of this.tiles.values()) if (t.built) this._release(t);
        this._bridgesState = 'ok';
        this.log('3d', `PGH bridges: ${b.count} models`, 'debug');
      })
      .catch((err) => { this._bridgesState = 'failed'; this.log('3d', `PGH bridges: ${err.message} ${(err.stack || '').split('\n').slice(0, 3).join(' | ')}`, 'error'); });
  }

  _stream(cx, cz, budgetMs) {
    const t0 = performance.now();
    const NEAR = this.nearM || NEAR_M;
    // [review 27 Nov] the tiles wanted, nearest first, made again only when the camera has gone WANT_STEP from where
    // they were last sorted or the reach changed (it had made ~170 key strings, as many objects, a sort, a filter and
    // a map every frame); a tile's centre moves < WANT_STEP in the order, at 400 m tiles nothing a rider sees
    const W = this._want;
    if (!W || W.near !== NEAR || Math.abs(cx - W.x) > WANT_STEP || Math.abs(cz - W.z) > WANT_STEP) this._wantAt(cx, cz, NEAR);
    const want = this._want.list;
    // one tile at a time, as a job run in this frame's slice (a tile's roads, then its ground, banks and dressed
    // places), nearest first; it carries on next frame where it paused
    for (;;) {
      const left = budgetMs - (performance.now() - t0);
      if (left <= 0) break;
      if (!this._tjob) {
        let w = null;
        for (let k = 0; k < want.length; k++) if (this._todo(want[k])) { w = want[k]; break; }
        if (!w) break;
        this._tjob = { t: w, gen: this._tileWork(w) };
      }
      if (runSlice(this._tjob.gen, left).done) this._tjob = null; else break;
    }
    let q = 0; for (let k = 0; k < want.length; k++) if (this._todo(want[k])) q++;
    this._queued = q;
    // the ways' spill (_spillJob): only near the camera — within SPILL_IN of a tile's edge, dropped past SPILL_OUT
    // (it's a fine detail; built for every tile out to 2.3 km it was ~34 MB on High). [review 27 Nov] From the tiles
    // waiting for it (_spillWait), not a scan of every tile in the map (PGH: > 1000) every frame
    const SW = this._spillWait;
    while ((this._sjob || SW.size) && performance.now() - t0 < budgetMs) {
      if (!this._sjob) {
        let best = null, bd = SPILL_IN;
        for (const t of SW) if (t.groundMesh) { const d = Math.hypot(t.cx - cx, t.cz - cz) - TILE * .71; if (d < bd) { bd = d; best = t; } }
        if (!best) break;
        this._spillPending(best, false); this._sjob = { t: best, gen: this._spillJob(best) };
      }
      if (runSlice(this._sjob.gen, budgetMs - (performance.now() - t0)).done) this._sjob = null; else break;
    }
    if (this._frames % 30 === 15) for (const t of this._spilled) if (t !== this._sjob?.t && Math.hypot(t.cx - cx, t.cz - cz) - TILE * .71 > SPILL_OUT) {
      t.spillMesh.geometry.dispose(); t.spillMesh = null; this._spilled.delete(t); this._spillPending(t, true); this._spillDirty = true;
    }
    if (this._spillDirty && !this._sjob && this._frames % 20 === 0) this._mergeSpill();
    // release far tiles (a few a frame) — [review 27 Nov] of the built ones (_built), not every tile ever made
    if (this._frames % 30 === 0) for (const t of this._built) {
      if (t !== this._tjob?.t && Math.hypot(t.cx - cx, t.cz - cz) > (this.farM || FAR_M)) this._release(t);
    }
  }
  /** [review 27 Nov] The tiles within NEAR of (cx, cz), nearest first (made once a WANT_STEP: _stream), and the near
   *  ones the loading screen counts. */
  _wantAt(cx, cz, NEAR) {
    const ci = Math.floor(cx / TILE), cj = Math.floor(cz / TILE), r = Math.ceil(NEAR / TILE), W = this._want ||= { list: [], d: new Map() };
    W.x = cx; W.z = cz; W.near = NEAR; W.list.length = 0; W.d.clear();
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
      const d = Math.hypot((i + 0.5) * TILE - cx, (j + 0.5) * TILE - cz);
      if (d > NEAR) continue;
      const key = `${i},${j}`;
      let t = this.tiles.get(key);
      if (!t) this.tiles.set(key, (t = { key, pieces: [], nodes: [], built: false, cx: (i + 0.5) * TILE, cz: (j + 0.5) * TILE, i, j }));
      W.list.push(t); W.d.set(t, d);
    }
    W.list.sort((a, b) => W.d.get(a) - W.d.get(b));
    this._nearTiles = W.list.filter((t) => W.d.get(t) < 700);
  }
  _todo(t) { return !t.built || (this.ground && !t.groundMesh); }
  /** A tile waiting for its spill (or not): the flag and the set _stream looks in. */
  _spillPending(t, on) { t.spillPending = on; if (on) this._spillWait.add(t); else this._spillWait.delete(t); }

  *_tileWork(t) {
    if (!t.built) yield* this._roadsJob(t);
    if (this.ground && !t.groundMesh) yield* this._groundJob(t);
  }

  _release(t) {
    if (this._tjob?.t === t) this._tjob = null;   // (a tile released while building: started again when it's wanted)
    if (this._sjob?.t === t) this._sjob = null;
    if (t.spillMesh) this._spillDirty = true;
    for (const m of [t.roadMesh, t.paintMesh, t.groundMesh, t.bankMesh, t.spillMesh, ...(t.extra || []), ...(t.extraRoad || [])]) if (m) { this.group.remove(m); m.geometry.dispose(); }
    t.roadMesh = t.paintMesh = t.groundMesh = t.bankMesh = t.spillMesh = null; t.groundRows = false; t.extra = []; t.extraRoad = [];
    this._spillPending(t, false); this._spilled.delete(t); this._built.delete(t);
    t.built = false;
  }

  /** A way drawn smooth from sample a to b (graph/curves.js curve). */
  _curve(e, a, b) { return curve(e, a, b); }

  /** How a way is painted: centre line, lane lines, edge lines (one-ways and lanes from the city data). */
  _paintOf(e) {
    const ow = this.city?.edgeInfo(e).ow || 0, lanes = this.city?.edgeInfo(e).lanes || 0;
    if (this.profile.pathPaint === false && (e.kind === 'path' || e.kind === 'bridle')) return { centre: null, edges: false, lanes: 0 };   // (NYC: the park's paths are unpainted)
    if (e.kind === 'drive' && this.profile.drivePaint === 'park') return { centre: null, edges: true, lanes: 0, bikeLane: true };   // (Central Park's drives: edge lines and a painted bike lane)
    if (e.kind === 'path') {
      // (a gravel or dirt trail has no paint: CNY's stone-dust towpath)
      const loose = this.city && ['gravel', 'dirt'].includes(this.city.edgeInfo(e).surf(e.n >> 1));
      return { centre: !e._rw && !loose && (e._w || 3) >= 3.4 ? 'dash-yellow' : null, edges: false, lanes: 0 };
    }
    if (e.kind === 'plaza' || e.kind === 'alley') return { centre: null, edges: false, lanes: 0 };
    if (ow) return { centre: null, edges: e.kind !== 'residential', lanes: Math.max(1, lanes), oneway: true };
    if (e.kind === 'primary' || e.kind === 'secondary') return { centre: 'double', edges: true, lanes: 0 };
    if (e.kind === 'tertiary') return { centre: 'dash-yellow', edges: false, lanes: 0 };
    return { centre: null, edges: false, lanes: 0 };
  }

  /** A tile's roads as a job: pauses between ways when its slice is used up (no stall on a phone). */
  *_roadsJob(t) {
    t.built = true; t.spills = []; t.endSpills = []; this._built.add(t);
    if (!t.pieces.length && !t.nodes.length) return;
    const R = new Mesher(true), P = new Mesher(), W = new Mesher(), P_ = P;
    const col = (k) => new THREE.Color(COLORS[k] || COLORS.residential);
    const side = col('side'), deckC = col('deck'), rail = col('rail'), under = col('under');
    const verge = new THREE.Color(this.profile.verge), gravelC = new THREE.Color('#a59b84'), walkC = new THREE.Color('#b4afa4'), curbC = new THREE.Color('#c3beb3'), walkSide = new THREE.Color('#9d988e');
    for (const { e, a, b } of t.pieces) {
      if (due()) yield;
      // (a hero area's singletrack has no ribbon of its own: its path is the area's floor worn through where the tires go
      //  — old-growth.js draws it — user, 24 Nov: "Start with the ground material and almost overlay wear from a bike
      //  passing over")
      if (e._cf && this.json?.oldGrowth) continue;
      const half = this.wOf(e) / 2, path = e.kind === 'path', walk = this.walkOf(e);
      const base = e._rw ? new THREE.Color('#a9a59c') : e._cf ? new THREE.Color('#6e553c') : col(e.kind), lift = e._cf ? 0.05 : ROAD_LIFT + (path ? -0.03 : 0);   // (a singletrack: packed, lighter earth, right on the floor)
      const deck = new Uint8Array(e.n + 1);
      for (const [p, q] of e.bridges) for (let i = p; i <= q; i++) deck[i] = 1;
      const bm = this.bridgeMask?.get(e.id) || this.modelDecks?.get(e.id);
      // the ribbon stops at a junction's mouth (_planJunctions), its end exactly on the mouth
      const tr = this.trim?.get(e.id) || [0, 0], f0 = tr[0] / 10, f1 = e.n - tr[1] / 10;
      if (f0 >= b || f1 <= a) continue;
      let C = this._curve(e, a, b);
      if (f0 > a || f1 < b) {
        const keep = C.filter((c) => c.i > f0 + 1e-6 && c.i < f1 - 1e-6);
        if (f0 > a) keep.unshift({ ...this._curvePoint(e, f0), i: f0 });
        if (f1 < b) keep.push({ ...this._curvePoint(e, f1), i: f1 });
        for (let k = 0; k < keep.length; k++) keep[k].s = k ? keep[k - 1].s + Math.hypot(keep[k].x - keep[k - 1].x, keep[k].z - keep[k - 1].z) : (C[0].s || 0);
        C = keep;
      }
      const n = C.length;
      if (n < 2) continue;
      // paint: clear of the junctions' mouths and their crosswalks
      const lenM = e.n * 10, r0 = tr[0] > 0 ? tr[0] + 3.4 : 0, r1 = tr[1] > 0 ? tr[1] + 3.4 : 0;
      const atS = (c) => c.i * 10;
      // [zwift-look] which of this way's lines the shader draws (bits: 1 edges, 2 bike lane, 4 double centre, 8 dashed
      // centre, 16 a path's dashes); the rest stay geometry below
      const P0 = this.roadLook?.paint ? this._paintOf(e) : null;
      const spaint = !P0 ? 0 : (P0.edges && !P0.oneway ? 1 : 0) | (P0.bikeLane ? 2 : 0) | (P0.centre === 'double' ? 4 : 0) | (P0.centre === 'dash-yellow' ? (path ? 24 : 8) : 0);
      const L = [], Rt = [], cols = [], ext = [];
      for (const c of C) {
        const y = c.y + lift;
        L.push([c.x + c.dz * half, y, c.z - c.dx * half]);
        Rt.push([c.x - c.dz * half, y, c.z + c.dx * half]);
        const si = Math.round(c.i), surf = SURF_CODE[e._surf?.[si] || (e._rw ? 'concrete' : 'asphalt')] ?? 0;
        cols.push(surf === 0 || surf === 5 || surf === 6 ? base : surf === 3 ? new THREE.Color('#a7a399') : surf === 4 ? new THREE.Color('#a49c8f') : base);
        ext.push(surf);
      }
      for (let k = 0; k + 1 < n; k++) {
        // ([zwift-look] the paint drawn in the road's own shader — roadLook effect: crisp at any distance, no geometry —
        //  its lines' code in the surface code, × 64, where the paint runs: clear of the junctions, not on brick or setts)
        const pc = spaint && atS(C[k]) >= r0 && atS(C[k + 1]) <= lenM - r1 && ext[k] !== 1 && ext[k] !== 2 ? spaint : 0;
        const uv = (c, x) => [ext[k] + pc * 64, x, c.s, half];
        R.quadX(L[k], Rt[k], Rt[k + 1], L[k + 1], cols[k], [uv(C[k], -half), uv(C[k], half), uv(C[k + 1], half), uv(C[k + 1], -half)]);
      }
      // a trail's gravel or dirt carried out onto the road where it meets one (its end at a junction's mouth)
      if (this.profile.roads === 'worn' && !e._cf) for (const [end, trimmed] of [[0, f0 > a], [n - 1, f1 < b]]) {
        const sf = ext[end]; if (!trimmed || (sf !== 5 && sf !== 6)) continue;
        const c = C[end], dir = end ? 1 : -1;
        t.endSpills.push({ x: c.x, y: c.y + lift, z: c.z, dx: c.dx * dir, dz: c.dz * dir, half, surf: sf, s: c.s });
      }
      // the sides: a deck's slab and parapets; on the ground a curb and sidewalk, or a shoulder down to the ground
      for (let k = 0; k + 1 < n; k++) {
        const c0 = C[k], c1 = C[k + 1], i0 = Math.floor(c0.i), i1 = Math.min(e.n, Math.ceil(c1.i));
        const br = deck[i0] && deck[i1];
        for (const [S, flip, sgn] of [[L, false, 1], [Rt, true, -1]]) {
          const p0 = S[k], p1 = S[k + 1];
          const o0 = [c0.dz * sgn, -c0.dx * sgn], o1 = [c1.dz * sgn, -c1.dx * sgn];   // outward
          const out = (p, o, d, dy) => [p[0] + o[0] * d, p[1] + dy, p[2] + o[1] * d];
          if (br) {
            if (bm && (bm[i0] & 4) && (bm[i1] & 4)) continue;   // (a landmark model's deck: it draws the sides)
            W.wall(p0, p1, -1.0, 0, deckC, flip);
            if (!(bm && (bm[i0] & 2) && (bm[i1] & 2))) W.wall(p0, p1, 0, 0.9, rail, flip);
            continue;
          }
          if (e._cf) {
            // a hero area's singletrack (user: "the bike trail is narrow throughout"): the tread's edge rolls down onto
            // the floor in its own dirt, a hand's width out — no shoulder, no verge, no spill
            const [i0, i1] = [out(p0, o0, 0, -0.01), out(p1, o1, 0, -0.01)], [e0, e1] = [out(p0, o0, 0.2, -0.05), out(p1, o1, 0.2, -0.05)];
            const x = (d) => -sgn * (half + d), u = (cc, d) => [ext[k], x(d), cc.s, half];
            if (sgn > 0) R.quadX(e0, i0, i1, e1, cols[k], [u(c0, .2), u(c0, 0), u(c1, 0), u(c1, .2)]);
            else R.quadX(i0, e0, e1, i1, cols[k], [u(c0, 0), u(c0, .2), u(c1, .2), u(c1, 0)]);
            continue;
          }
          if (walk) {
            W.wall(p0, p1, -0.05, 0.15, curbC, flip);                                                            // the curb's face
            W.quad(out(p0, o0, 0, 0.15), out(p1, o1, 0, 0.15), out(p1, o1, walk, 0.15), out(p0, o0, walk, 0.15), walkC, !flip);   // the sidewalk
            W.quad(out(p0, o0, walk, 0.15), out(p1, o1, walk, 0.15), out(p1, o1, walk, -1.4), out(p0, o0, walk, -1.4), walkSide, flip);
            continue;
          }
          // a shoulder: a gravel edge on a trail, then the verge sloping down to the ground, then a short face
          const band = path ? 0.35 : 0.2;
          // a raised trail (user, 24 Nov: "smooth the hard edge drop off"): a rounded embankment 3–5 m wide down to the
          // ground — its crest curving over, its foot easing in, its width wandering along the trail — in the trail's
          // own surface, the gravel thinning to ground cover down the slope (the shader: _bankJob's codes + 0.5 m)
          if (this.profile.roads === 'worn' && (ext[k] === 5 || ext[k] === 6) && this._trailBank(R, t, p0, p1, o0, o1, c0, c1, sgn, half, ext[k])) { W.wall(p0, p1, -0.6, -0.01, side, flip); continue; }
          if (ext[k] === 5 || ext[k] === 6) {
            // a gravel or dirt way (the towpath): its shoulder in the path's own surface — the same stone dust and
            // tone running down the side, not a green verge (user, 23 Nov: "the side of the towpath should carry the
            // same color and texture of the path")
            const ring = (d, dy) => [out(p0, o0, d, dy), out(p1, o1, d, dy)], x = (d) => -sgn * (half + d);
            const uvs = (d) => [[ext[k], x(d), c0.s, half], [ext[k], x(d), c1.s, half]];
            for (const [d0, y0, d1, y1] of [[0, -0.01, band, -0.06], [band, -0.06, 1.6, -0.9]]) {
              const [i0, i1] = ring(d0, y0), [e0, e1] = ring(d1, y1), [u0, u1] = uvs(d0), [v0, v1] = uvs(d1);
              if (sgn > 0) R.quadX(e0, i0, i1, e1, cols[k], [v0, u0, u1, v1]);
              else R.quadX(i0, e0, e1, i1, cols[k], [u0, v0, v1, u1]);
            }
          } else {
          if (this.profile.edgeFlush) {
            // (NYC: a park path's edge — a narrow stone edging, then the lawn at its level; the slope only where the
            //  ground falls away, under the lawn elsewhere)
            W.quad(out(p0, o0, 0, -0.01), out(p1, o1, 0, -0.01), out(p1, o1, 0.18, -0.02), out(p0, o0, 0.18, -0.02), curbC, !flip);
            W.quad(out(p0, o0, 0.18, -0.02), out(p1, o1, 0.18, -0.02), out(p1, o1, 1.6, -0.9), out(p0, o0, 1.6, -0.9), verge, !flip);
          } else {
          W.quad(out(p0, o0, 0, -0.01), out(p1, o1, 0, -0.01), out(p1, o1, band, -0.06), out(p0, o0, band, -0.06), path ? gravelC : verge, !flip);
          W.quad(out(p0, o0, band, -0.06), out(p1, o1, band, -0.06), out(p1, o1, 1.6, -0.9), out(p0, o0, 1.6, -0.9), verge, !flip);
          }
          }
          // on an embankment, the slope runs on down (1 : 1.5) to meet the ground, then a short face below it
          const toe = (p, o) => { const q = out(p, o, 1.6, -0.9), gy = this.ground ? this._groundH(q[0], q[2]) : q[1] - 2; const drop = Math.max(0, q[1] - 0.2 - gy); const d = Math.min(9, drop * 1.5); return [out(p, o, 1.6 + d, -0.9 - d / 1.5), gy]; };
          const [ta, ga] = toe(p0, o0), [tb, gb] = toe(p1, o1);
          // the spill beyond the shoulder's foot (user, 23 Nov: "texture blending … gravel dust blowing onto a road"):
          // drawn with the tile's ground (_spillJob), draped on it
          if (this.profile.roads === 'worn') t.spills.push({ a: ta, b: tb, o0, o1, s0: c0.s, s1: c1.s, half, sgn, surf: ext[k] === 5 || ext[k] === 6 ? ext[k] : 5 });
          // (over a pad — Bethesda's terrace, cut down below the drive — no embankment: the landmark's wall stands there)
          if (!(this.pads.length && (this._inPad(ta[0], ta[2]) || this._inPad(tb[0], tb[2])))) {
          W.quad(out(p0, o0, 1.6, -0.9), out(p1, o1, 1.6, -0.9), tb, ta, verge, !flip);
          W.quad(ta, tb, [tb[0], Math.min(tb[1], gb) - 1.5, tb[2]], [ta[0], Math.min(ta[1], ga) - 1.5, ta[2]], verge, flip);
          }
          W.wall(p0, p1, -0.6, -0.01, side, flip);
        }
        if (br && !(bm && (bm[i0] & 4) && (bm[i1] & 4))) W.quad([L[k][0], L[k][1] - 1, L[k][2]], [Rt[k][0], Rt[k][1] - 1, Rt[k][2]], [Rt[k + 1][0], Rt[k + 1][1] - 1, Rt[k + 1][2]], [L[k + 1][0], L[k + 1][1] - 1, L[k + 1][2]], under, true);
      }
      // paint, clear of the junctions
      const paint = this._paintOf(e), yellow = new THREE.Color('#e3b53a'), white = new THREE.Color('#f2efe6');
      const line = (off, w, dashM, gapM, color) => {
        for (let k = 0; k + 1 < n; k++) {
          const c0 = C[k], c1 = C[k + 1], s0 = atS(c0), s1 = atS(c1);
          if (s0 < r0 || s1 > lenM - r1) continue;
          if (ext[k] === 1 || ext[k] === 2) continue;   // (no paint on brick or setts)
          if (dashM && (c0.s % (dashM + gapM)) > dashM) continue;
          const A = { x: c0.x - c0.dz * off, y: c0.y + lift + 0.02, z: c0.z + c0.dx * off }, B = { x: c1.x - c1.dz * off, y: c1.y + lift + 0.02, z: c1.z + c1.dx * off };
          P.quad([A.x + c0.dz * w, A.y, A.z - c0.dx * w], [A.x - c0.dz * w, A.y, A.z + c0.dx * w], [B.x - c1.dz * w, B.y, B.z + c1.dx * w], [B.x + c1.dz * w, B.y, B.z - c1.dx * w], color);
        }
      };
      if (paint.centre === 'double' && !(spaint & 4)) { line(-0.18, 0.06, 0, 0, yellow); line(0.18, 0.06, 0, 0, yellow); }
      else if (paint.centre === 'dash-yellow' && !(spaint & 8)) line(0, path ? 0.05 : 0.07, path ? 3 : 3.3, path ? 6 : 6.7, yellow);
      if (paint.edges && !(spaint & 1)) { line(half - 0.35, 0.07, 0, 0, white); line(-(half - 0.35), 0.07, 0, 0, paint.oneway ? yellow : white); }
      if (paint.bikeLane && !(spaint & 2)) { line(-(half - 2.2), 0.1, 0, 0, white); line(-(half - 2.2) - 0.35, 0.1, 0, 0, white); }   // (the bike lane: a double white line 2 m in from the edge)
      if (paint.oneway && paint.lanes >= 2) for (let q = 1; q < paint.lanes; q++) line(-half + (2 * half) * q / paint.lanes, 0.06, 3, 9, white);
    }
    // junctions (_planJunctions): the surface — the mouths joined by the curb returns, a fan from the centre — the
    // sidewalks round the corners (the verges where neither way has one); a crosswalk across each arm just outside its
    // mouth where a main street meets two or more others among the buildings. Two ways meeting: a disc as wide as the
    // narrower, filling the bend's outside; a dead end: rounded.
    const white = new THREE.Color('#ece9de'), asphalt = col('residential');
    // a junction's look: its widest way's colour and surface (at its end there)
    const joinLook = (arms) => { let A = null; for (const a of arms) if (!A || this.wOf(a.e) > this.wOf(A.e)) A = a; if (!A) return null; const e = A.e, i = A.end ? e.n : 0, sf = SURF_CODE[e._surf?.[i] || 'asphalt'] ?? 0; return { color: e._rw ? new THREE.Color('#a9a59c') : sf === 3 ? new THREE.Color('#a7a399') : sf === 4 ? new THREE.Color('#a49c8f') : col(e.kind), surf: sf, path: e.kind === 'path' }; };
    const facing = (a, b, c, d, color, dx, dy, dz, M = W) => {   // a quad whose normal points along (dx, dy, dz)
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      M.quad(a, b, c, d, color, nx * dx + ny * dy + nz * dz < 0);
    };
    for (const nd of t.nodes) {
      if (due()) yield;
      const J = this.jn?.get(nd.id);
      if (!J) {
        const list = this.arms.get(nd.id) || [];
        // (a map that matches its joins — NYC: two ways meeting at a bend joined by a disc as wide as the wider, in its
        //  colour and surface, so the bend's outside has no wedge gap and a paved path no dark patch)
        // (and on any map, a real bend — over 20° — joined as wide as its wider way: the narrower disc left a wedge gap at
        //  the wider way's outside, the map QC's joinGap; PGH's path/primary and primary/residential bends, 25 Nov)
        let bend = false;
        if (list.length === 2) {
          const d = list.map(({ e, end }) => { const k = end ? Math.max(0, e.n - 1) : Math.min(e.n, 1), x0 = end ? e.x[e.n] : e.x[0], z0 = end ? e.z[e.n] : e.z[0], dx = e.x[k] - x0, dz = e.z[k] - z0, l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; });
          bend = Math.PI - Math.acos(Math.max(-1, Math.min(1, d[0][0] * d[1][0] + d[0][1] * d[1][1]))) > 0.35;
        }
        const r = list.length ? Math.max(0.5, (list.length >= 3 || bend || this.profile.junctionCurbs ? Math.max : Math.min)(...list.map(({ e }) => this.wOf(e) / 2))) : 3.5;
        const jc = this.profile.junctionCurbs ? joinLook(list) : null;
        if (jc) R.discX(nd.x, nd.y + ROAD_LIFT + (jc.path ? -0.03 : 0) + 0.004, nd.z, r, jc.color, 24, jc.surf);
        else R.discX(nd.x, nd.y + ROAD_LIFT + 0.004, nd.z, r, asphalt, 16);
        continue;
      }
      const jl = this.profile.junctionCurbs ? joinLook(J.arms) : null;
      const P = J.poly, cy = J.y + ROAD_LIFT, RD = [jl ? jl.surf : 0, 0, 0, 40], jcol = jl ? jl.color : asphalt;
      for (let k = 0; k < P.length; k++) {
        const p = P[k], q = P[(k + 1) % P.length];
        R._tri([J.x, cy, J.z], [q.x, q.y + ROAD_LIFT, q.z], [p.x, p.y + ROAD_LIFT, p.z], jcol, RD, RD, RD);
      }
      for (const c of J.corners) {
        const pts = c.curb; if (!pts || pts.length < 2 || c.gap < 0.3) continue;   // (a straight side too: the sidewalk runs on across the mouth of the way opposite)
        // each vertex's outward normal (away from the junction: the polygon is counter-clockwise, its inside on the left)
        const nrm = pts.map((p, k) => {
          let nx = 0, nz = 0;
          for (const [u, v] of [[pts[k - 1], p], [p, pts[k + 1]]]) { if (!u || !v) continue; const dx = v.x - u.x, dz = v.z - u.z, l = Math.hypot(dx, dz) || 1; nx += dz / l; nz += -dx / l; }
          const l = Math.hypot(nx, nz) || 1; return [nx / l, nz / l];
        });
        const wA = c.A.walk, wB = c.B.walk;
        for (let k = 0; k + 1 < pts.length; k++) {
          const p = pts[k], q = pts[k + 1], yp = p.y + ROAD_LIFT, yq = q.y + ROAD_LIFT, [nxp, nzp] = nrm[k], [nxq, nzq] = nrm[k + 1];
          const mdx = q.z - p.z, mdz = -(q.x - p.x);   // (this piece's outward direction)
          if (wA || wB) {
            const w0 = (wA || wB) + ((wB || wA) - (wA || wB)) * k / (pts.length - 1), w1 = (wA || wB) + ((wB || wA) - (wA || wB)) * (k + 1) / (pts.length - 1);
            const i0 = [p.x, yp + 0.15, p.z], i1 = [q.x, yq + 0.15, q.z], o0 = [p.x + nxp * w0, yp + 0.15, p.z + nzp * w0], o1 = [q.x + nxq * w1, yq + 0.15, q.z + nzq * w1];
            facing(i0, i1, o1, o0, walkC, 0, 1, 0);                                                                                         // the sidewalk
            facing([p.x, yp - 0.05, p.z], [q.x, yq - 0.05, q.z], i1, i0, curbC, -mdx, 0, -mdz);                                             // the curb's face
            facing(o0, o1, [o1[0], yq - 1.4, o1[2]], [o0[0], yp - 1.4, o0[2]], walkSide, mdx, 0, mdz);                                       // its outer side
          } else {
            const i0 = [p.x, yp - 0.01, p.z], i1 = [q.x, yq - 0.01, q.z], o0 = [p.x + nxp * 1.6, yp - 0.9, p.z + nzp * 1.6], o1 = [q.x + nxq * 1.6, yq - 0.9, q.z + nzq * 1.6];
            if (this.profile.edgeFlush) facing(i0, i1, [q.x + nxq * .18, yq - .02, q.z + nzq * .18], [p.x + nxp * .18, yp - .02, p.z + nzp * .18], curbC, 0, 1, 0);   // (the stone edging round the corner)
            facing(i0, i1, o1, o0, verge, 0, 1, 0);                                                                                          // the verge
            facing([p.x, yp - 0.6, p.z], [q.x, yq - 0.6, q.z], i1, i0, side, -mdx, 0, -mdz);
          }
        }
      }
      const main = J.arms.filter((A) => A.e.kind !== 'path' && A.e.kind !== 'plaza');
      if (main.length < 3 || !main.some((A) => A.e.kind === 'primary' || A.e.kind === 'secondary' || A.e.kind === 'tertiary') || !main.some((A) => A.walk)) continue;
      for (const A of main) {
        const ux = A.ud.x, uz = A.ud.z, half = A.h, cx = A.cut.x + ux * 1.6, cz = A.cut.z + uz * 1.6, yy = A.cut.y + ROAD_LIFT + 0.035;
        for (let v = -half + 0.4; v < half - 0.3; v += 1.1) {
          const px = cx - uz * v, pz = cz + ux * v, qx = px - uz * 0.55, qz = pz + ux * 0.55;
          facing([px - ux * 1.4, yy, pz - uz * 1.4], [px + ux * 1.4, yy, pz + uz * 1.4], [qx + ux * 1.4, yy, qz + uz * 1.4], [qx - ux * 1.4, yy, qz - uz * 1.4], white, 0, 1, 0, P_);
        }
      }
    }
    t.roadMesh = R.mesh(this.mats.roadSurface);
    if (t.roadMesh) this.group.add(t.roadMesh);
    t.paintMesh = P.mesh(this.mats.paint);
    if (t.paintMesh) this.group.add(t.paintMesh);
    const sm = W.mesh(this.mats.road);
    if (sm) { this.group.add(sm); (t.extraRoad ||= []).push(sm); }
  }

  /** A tile's ground, its river banks and the dressed places in it, as a job (row by row, a shore at a time). */
  *_groundJob(t) {
    const nx = Math.round(TILE / GROUND_CELL), x0 = t.i * TILE, z0 = t.j * TILE, cell = TILE / nx, n1 = nx + 1;
    const pos = new Float32Array(n1 * n1 * 3), color = new Float32Array(n1 * n1 * 3), landW = new Float32Array(n1 * n1);
    const grass = new THREE.Color('#89a868'), dry = new THREE.Color('#a7a27a'), bed = new THREE.Color('#6f6a58'), tmp = new THREE.Color();
    // (Out West's colours calibrated, 27 Nov 2026, against photos of Kanab and the Coral Pink dunes (tools/reference) and
    //  measured reflectance (tools/reference/measured.json): the sand was 2.3× too colourful and 25° too red, the rock 3×
    //  too colourful — sand now ~0.38 albedo, chroma ~24, hue ~65°; the red sandstone ~0.18, chroma ~30, hue ~48°)
    const desert = this.profile.ground === 'desert', sand = new THREE.Color('#d0a27c'), rockA = new THREE.Color('#a8644a'), rockB = new THREE.Color('#c4906a'), white = new THREE.Color('#ddcfb2');
    t.groundRows = true;   // [review 27 Nov] (until the mesh is in: _cutCanal restarts a job caught here)
    for (let j = 0, k = 0; j <= nx; j++) for (let i = 0; i <= nx; i++, k++) {
      if (i === 0 && due()) yield;
      const x = x0 + i * cell, z = z0 + j * cell, h = this._groundH(x, z), pool = this.poolAt(x, z);
      pos[3 * k] = x; pos[3 * k + 1] = h; pos[3 * k + 2] = z;
      const raw = this.ground.at(x, z), cutDepth = Math.max(0, raw - h);
      if (desert) {
        // [out-west] red-rock ground: sand on the flats, sandstone on the slopes, in strata bands by height (the
        // Vermilion, then the White Cliffs higher up), darker in the washes
        const sl = Math.min(1, Math.hypot(this._groundH(x + 6, z) - h, this._groundH(x, z + 6) - h) / 6);
        const band = Math.sin(h * .21 + Math.sin(x * .004 + z * .003) * 2.2) * .5 + .5, high = THREE.MathUtils.smoothstep(h, 1860, 2050);
        tmp.copy(sand).lerp(rockA, THREE.MathUtils.smoothstep(sl, .25, .7)).lerp(rockB, band * .45 * sl).lerp(white, high * (.25 + .35 * sl));   // (the White Cliffs: pale on the faces, the flats still sand)
      } else tmp.copy(h < pool ? bed : grass).lerp(dry, Math.min(1, cutDepth / 6));
      landW[k] = h < pool + 0.2 ? 0 : 1 - Math.min(1, cutDepth / 6) * 0.7;   // (the land cover's colour: not on the river bed, less on a cut)
      const v = 0.94 + 0.06 * Math.sin(x * 0.013 + z * 0.021) * Math.cos(x * 0.007 - z * 0.011);
      color[3 * k] = tmp.r * v; color[3 * k + 1] = tmp.g * v; color[3 * k + 2] = tmp.b * v;
    }
    t.gridH = new Float32Array(n1 * n1); for (let k = 0; k < n1 * n1; k++) t.gridH[k] = pos[3 * k + 1];
    t.gridCell = cell;
    const idx = new Uint32Array(nx * nx * 6);
    for (let j = 0, q = 0; j < nx; j++) for (let i = 0; i < nx; i++) {
      const a = j * n1 + i, b = a + 1, c = a + n1, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(color, 3));
    g.setAttribute('aLandW', new THREE.BufferAttribute(landW, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    t.groundMesh = new THREE.Mesh(g, this.mats.ground); t.groundRows = false;
    this.group.add(t.groundMesh);
    this._spillPending(t, !!(t.spills?.length || t.endSpills?.length));   // (built when the camera comes near: _stream)
    yield* this._bankJob(t);
    yield* this.effects.tileJob(t);
  }

  /**
   * The blend where a way's surface meets the ground (user, 23 Nov: "where two textures meet … a zone where the two
   * blend together"): a strip 1.5 m out from each shoulder's foot, draped on the ground, in the way's own surface
   * (a trail's gravel or dirt; a road's shoulder gravel) — the shader thins it to scattered grains, its width and
   * strength wandering along the edge (aRd.x + 20: the spill; across past half + 3 m: how far out).
   */
  *_spillJob(t) {
    if (!t.spills?.length && !t.endSpills?.length) return;
    const R = new Mesher(true), white = new THREE.Color(1, 1, 1), STEPS = 3, OUT = 1.5;
    for (let i = 0; i < (t.spills || []).length; i++) {
      if ((i & 63) === 0 && due()) yield;
      const S = t.spills[i], pt = (p, o, f) => { const x = p[0] + o[0] * OUT * f, z = p[2] + o[1] * OUT * f; return [x, Math.max(this.surfaceH(x, z), p[1] - .3) + .03, z]; };
      const rd = (s, f) => [S.surf + 20, -S.sgn * (S.half + 3 + f * OUT), s, S.half];
      for (let j = 0; j < STEPS; j++) {
        const f0 = j / STEPS, f1 = (j + 1) / STEPS;
        const a0 = pt(S.a, S.o0, f0), b0 = pt(S.b, S.o1, f0), a1 = pt(S.a, S.o0, f1), b1 = pt(S.b, S.o1, f1);
        if (S.sgn > 0) R.quadX(a1, a0, b0, b1, white, [rd(S.s0, f1), rd(S.s0, f0), rd(S.s1, f0), rd(S.s1, f1)]);
        else R.quadX(a0, a1, b1, b0, white, [rd(S.s0, f0), rd(S.s0, f1), rd(S.s1, f1), rd(S.s1, f0)]);
      }
    }
    // onto the road at a trail's end: 3 m out over the junction, as wide as the trail
    for (const E of t.endSpills || []) {
      const OUTE = 3, nx = E.dz, nz = -E.dx, p = (u, f) => [E.x + nx * u + E.dx * OUTE * f, E.y + .012, E.z + nz * u + E.dz * OUTE * f];
      const rd = (f) => [E.surf + 20, E.half + 3 + f * 1.5, E.s + f * OUTE, E.half];
      for (let j = 0; j < STEPS; j++) {
        const f0 = j / STEPS, f1 = (j + 1) / STEPS, w = E.half + .4;
        R.quadX(p(-w, f0), p(w, f0), p(w, f1), p(-w, f1), white, [rd(f0), rd(f0), rd(f1), rd(f1)]);
      }
    }
    const m = R.mesh(this.mats.spill);
    if (m) { t.spillMesh = m; this._spilled.add(t); this._spillDirty = true; }   // (drawn merged with the other near tiles': _mergeSpill)
  }

  /**
   * A raised trail's side as a rounded embankment (see the call): rings out from the trail's edge to a foot 3–5 m out
   * (wandering along the trail), each ring's height eased from the crest down to the ground there. Returns false where
   * the trail isn't above the ground beside it (it keeps its short shoulder), or the canal's at its side.
   */
  _trailBank(R, t, p0, p1, o0, o1, c0, c1, sgn, half, surf) {
    const width = (s) => 3 + 2 * (.5 + .5 * Math.sin(s * .043 + 1.3) * Math.cos(s * .017 + .4));
    const w0 = width(c0.s), w1 = width(c1.s);
    const at = (p, o, d) => [p[0] + o[0] * d, p[2] + o[1] * d];
    const gA = this._groundH(...at(p0, o0, w0)), gB = this._groundH(...at(p1, o1, w1));
    const dropA = p0[1] - gA, dropB = p1[1] - gB;
    if (Math.max(dropA, dropB) < .35) return false;
    for (const [p, o, w] of [[p0, o0, w0], [p1, o1, w1]]) { const [x, z] = at(p, o, w * .6); const c = canalAt(x, z, 1); if (c && !c.creek) return false; }
    // the ground cover at the foot: woods (litter, roots) or open grass — the colour the slope's lower part takes
    const lc = this.city?.landAt?.(...at(p0, o0, w0 + 1));
    const woods = lc === 2, cover = woods ? new THREE.Color('#54432e') : this.profile.ground === 'desert' ? new THREE.Color('#a8734c') : new THREE.Color('#5d7539');   // (desert: red sand, not grass)
    const RINGS = [0, .08, .2, .36, .55, .74, .9, 1];
    const ring = (p, o, w, g, f) => {
      // the profile: a smootherstep from the crest to the ground (convex at the top, concave at the foot)
      const e = f * f * f * (f * (f * 6 - 15) + 10), d = w * f, [x, z] = at(p, o, d);
      const y = Math.max(p[1] + (g - p[1]) * e, this._groundH(x, z) + .02 * (1 - f)) - (f === 0 ? .01 : 0);
      return [x, f === 1 ? Math.min(y, this._groundH(x, z) - .02) : y, z];
    };
    for (let j = 0; j + 1 < RINGS.length; j++) {
      const fa = RINGS[j], fb = RINGS[j + 1];
      const a0 = ring(p0, o0, w0, gA, fa), a1 = ring(p1, o1, w1, gB, fa), b0 = ring(p0, o0, w0, gA, fb), b1 = ring(p1, o1, w1, gB, fb);
      // aRd: the surface + .5 (a bank: the shader's code), across (m past the edge, signed as the trail's), along, half (+ 100 under woods)
      const rd = (c, f, w) => [surf + .5, -sgn * (half + f * w), c.s, half + (woods ? 100 : 0)];
      if (sgn > 0) R.quadX(b0, a0, a1, b1, cover, [rd(c0, fb, w0), rd(c0, fa, w0), rd(c1, fa, w1), rd(c1, fb, w1)]);
      else R.quadX(a0, b0, b1, a1, cover, [rd(c0, fa, w0), rd(c0, fb, w0), rd(c1, fb, w1), rd(c1, fa, w1)]);
    }
    return true;
  }

  /** The near tiles' spill strips as one mesh (one draw call, not one a tile), rebuilt when the set changes. */
  _mergeSpill() {
    this._spillDirty = false;
    const parts = [...this._spilled].map((t) => t.spillMesh?.geometry).filter(Boolean);
    if (this.spillAll) { this.group.remove(this.spillAll); this.spillAll.geometry.dispose(); this.spillAll = null; }
    if (!parts.length) return;
    const g = new THREE.BufferGeometry(), drop = function () { if (!globalThis.BF_KEEP_GEOMETRY) this.array = null; };
    for (const [name, size] of [['position', 3], ['normal', 3], ['color', 3], ['aRd', 4]]) {
      const n = parts.reduce((a, p) => a + p.attributes[name].array.length, 0), out = new Float32Array(n);
      let o = 0; for (const p of parts) { out.set(p.attributes[name].array, o); o += p.attributes[name].array.length; }
      const attr = new THREE.BufferAttribute(out, size); attr.onUpload(drop); g.setAttribute(name, attr);
    }
    g.computeBoundingSphere(); g.computeBoundingBox();
    const m = new THREE.Mesh(g, this.mats.spill); m.name = 'Spill'; m.receiveShadow = true; m.frustumCulled = false;
    this.spillAll = m; this.group.add(m);
  }

  /** The dressed places' ground in this tile (toolbox/materials/park-surfaces.js): lawns, beds, woods, plazas and walks
   *  draped on the ground; the fountain and pools; retaining walls and low walls in dressed stone; the trees. */
  *_dressingJob(t) {
    const D = this.dressing, key = `${t.i},${t.j}`;
    const areas = D.areas.get(key) || [], lines = D.lines.get(key) || [], trees = D.trees.get(key) || [];
    if (!areas.length && !lines.length && !trees.length) return;
    const by = new Map(), grey = new THREE.Color('#ffffff');
    const mesher = (k) => { if (!by.has(k)) by.set(k, new Mesher()); return by.get(k); };
    // the surface here: the ground, or a walled bank's promenade over it
    // the ground as its mesh draws it (surfaceH: the 12.8 m grid's triangles), so a drape lies on it everywhere
    // ([review 27 Nov] W15: was a private copy of surfaceH, line for line)
    const surf = (x, z) => { const h = Math.max(this._groundH(x, z), this.surfaceH(x, z)), sh = this.shore?.at(x, z); return sh && sh.walled && sh.s >= 0 && sh.s <= BANK_CAP ? Math.max(h, sh.top + 0.03) : h; };
    const under = (x, z, y) => Math.min(y, this.cut.cap(x, z) + 0.2);   // (never over a road: its surface is ≥ 0.35 m over its cut)
    const drape = (M, tri, lift) => {
      const split = (a, b, c, depth) => {
        const ab = Math.hypot(a[0] - b[0], a[1] - b[1]), bc = Math.hypot(b[0] - c[0], b[1] - c[1]), ca = Math.hypot(c[0] - a[0], c[1] - a[1]);
        const m = Math.max(ab, bc, ca);
        if (m <= 4 || depth > 9) { const v = (p) => [p[0], under(p[0], p[1], surf(p[0], p[1]) + lift), p[1]]; M._tri(v(a), v(c), v(b), grey); return; }
        if (m === ab) { const d = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; split(a, d, c, depth + 1); split(d, b, c, depth + 1); }
        else if (m === bc) { const d = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2]; split(a, b, d, depth + 1); split(a, d, c, depth + 1); }
        else { const d = [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2]; split(a, b, d, depth + 1); split(d, b, c, depth + 1); }
      };
      split(tri[0], tri[1], tri[2], 0);
    };
    const LIFT = { park: 0.22, wood: 0.25, scrub: 0.25, lawn: 0.28, fairway: 0.3, green: 0.32, sand: 0.32, garden: 0.31, plaza: 0.34 };   // (over the 12.8 m ground mesh's facets)
    for (const A of areas) {
      if (due()) yield;
      if (A.kind === 'fountain' || A.kind === 'pool') {
        // a basin: water a little under its granite rim, the rim a low dressed-stone kerb round it
        const h = Math.max(...A.pts.map(([x, z]) => surf(x, z))) + 0.2;   // (over the lawns draped round it)
        for (const tri of A.tris) mesher('water')._tri(...tri.map((p) => [p[0], h + 0.25, p[1]]).reverse(), grey);
        const R = mesher('rim'), F = mesher('rimFace');
        for (let i = 0; i + 1 < A.pts.length; i++) {
          const [p, q] = [A.pts[i], A.pts[i + 1]], dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l * A.wind, nz = dx / l * A.wind;
          const yi = h + 0.55, o = (pt, s) => [pt[0] + nx * s, yi, pt[1] + nz * s];
          R.quad(o(p, 0), o(q, 0), o(q, 1.4), o(p, 1.4), grey);
          F.quad([p[0], h - 0.2, p[1]], [q[0], h - 0.2, q[1]], [q[0], yi, q[1]], [p[0], yi, p[1]], grey);
        }
        if (A.kind === 'fountain') {   // the Point's jet: up to ~45 m on a summer day
          const [cx, cz] = A.centre, sp = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 3.2, 40, 14, 1, true), this.mats.spray);
          sp.position.set(cx, h + 20, cz); (t.extra ||= []).push(sp); this.group.add(sp);
        }
        continue;
      }
      const mat = A.kind === 'park' ? 'lawn' : A.kind;
      for (const tri of A.tris) { drape(mesher(mat), tri, LIFT[A.kind] ?? 0.06); if (due()) yield; }
    }
    for (const Ln of lines) {
      if (due()) yield;
      const P = Ln.pts;
      if (Ln.kind === 'walk' || Ln.kind === 'steps') {
        const half = Ln.width / 2, M = mesher(Ln.kind === 'steps' ? 'granite' : 'walk');
        for (let i = 0; i + 1 < P.length; i++) {
          const [p, q] = [P[i], P[i + 1]], dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l * half, nz = dx / l * half;
          drape(M, [[p[0] + nx, p[1] + nz], [q[0] + nx, q[1] + nz], [q[0] - nx, q[1] - nz]], 0.38);
          drape(M, [[p[0] + nx, p[1] + nz], [q[0] - nx, q[1] - nz], [p[0] - nx, p[1] - nz]], 0.38);
        }
      } else {
        // a retaining wall from the low side's ground to a 0.4 m parapet over the high side; a low wall 0.9 m
        const W = mesher('wall');
        for (let i = 0; i + 1 < P.length; i++) {
          const [p, q] = [P[i], P[i + 1]], dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz) || 1;
          if (l < 0.3) continue;
          const nx = -dz / l, nz = dx / l, side = (pt, s) => surf(pt[0] + nx * s, pt[1] + nz * s);
          const lowP = Math.min(side(p, 2.5), side(p, -2.5)), lowQ = Math.min(side(q, 2.5), side(q, -2.5));
          const topP = Ln.kind === 'wall' ? surf(p[0], p[1]) + 0.9 : Math.max(side(p, 2.5), side(p, -2.5)) + 0.4;
          const topQ = Ln.kind === 'wall' ? surf(q[0], q[1]) + 0.9 : Math.max(side(q, 2.5), side(q, -2.5)) + 0.4;
          const th = 0.2;
          for (const s of [th, -th]) W.quad([p[0] + nx * s, lowP - 0.2, p[1] + nz * s], [q[0] + nx * s, lowQ - 0.2, q[1] + nz * s], [q[0] + nx * s, topQ, q[1] + nz * s], [p[0] + nx * s, topP, p[1] + nz * s], grey);
          W.quad([p[0] + nx * th, topP, p[1] + nz * th], [q[0] + nx * th, topQ, q[1] + nz * th], [q[0] - nx * th, topQ, q[1] - nz * th], [p[0] - nx * th, topP, p[1] - nz * th], grey);
        }
      }
    }
    const mats = { water: this.mats.fountainWater, rim: this.mats.park.granite, rimFace: this.mats.parkWall, wall: this.mats.parkWall };
    for (const [k, M] of by) {
      const m = M.mesh(mats[k] || this.mats.park[k]);
      if (!m) continue;
      if (this.mats.park[k] && k !== 'granite' || k === 'water') { const n = m.geometry.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0); }   // (draped: lit as the flat ground it lies on, not facet by facet)
      (t.extra ||= []).push(m); this.group.add(m);
    }
    const forest = this.city?.forest, kitSp = forest?.kit?.species || this.city?.treeKit?.species;
    if (trees.length && forest && kitSp && (kitSp.plane || kitSp.redoak)) {
      // (user, 26 Nov — one tree look: the faceted ball trees beside the clumped crowns) the park's trees grown by the
      // tree engine like every other tree on the map: London planes, red oaks and lindens (basswood), by seed
      const pick = ['plane', 'redoak', 'basswood', 'plane'].filter((n) => kitSp[n]);
      const key = `park:${Math.round(trees[0][0])}:${Math.round(trees[0][1])}:${trees.length}`;
      forest.setTile(key, trees.map(([x, z]) => {
        const r = Math.abs(Math.sin(x * 12.9898 + z * 78.233)) % 1, sp = pick[Math.floor(r * pick.length) % pick.length];
        return { x, y: this._groundH(x, z) - .1, z, sp, v: Math.floor(r * 7) % (kitSp[sp].variants?.length || 1), s: .45 + r * .3, rot: r * 6.28 };
      }));
      const handle = new THREE.Object3D(); handle.name = 'Park trees (tree engine)'; handle.geometry = { dispose: () => forest.removeTile(key) };
      (t.extra ||= []).push(handle);
    } else if (trees.length) {
      // the park's trees: a trunk and a broad crown each (the Point's planes, oaks and lindens), sized and tinted by seed
      const trunkG = new THREE.CylinderGeometry(0.22, 0.32, 1, 6).translate(0, 0.5, 0), crownG = new THREE.IcosahedronGeometry(1, 1);
      const T1 = new THREE.InstancedMesh(trunkG, this.mats.trunk, trees.length), T2 = new THREE.InstancedMesh(crownG, this.mats.crown, trees.length);
      const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), c = new THREE.Color();
      trees.forEach(([x, z], k) => {
        const r = Math.abs(Math.sin(x * 12.9898 + z * 78.233)) % 1, h = this._groundH(x, z), H = 5 + r * 5, R = 3 + r * 2.5;
        m4.compose(new THREE.Vector3(x, h, z), q4, new THREE.Vector3(1, H * 0.55, 1)); T1.setMatrixAt(k, m4);
        m4.compose(new THREE.Vector3(x, h + H * 0.55 + R * 0.7, z), q4.setFromAxisAngle(UP, r * 6), new THREE.Vector3(R, R * 0.85, R)); T2.setMatrixAt(k, m4);
        T2.setColorAt(k, c.set('#4f7a35').offsetHSL((r - 0.5) * 0.04, 0, (r - 0.5) * 0.12));
      });
      for (const m of [T1, T2]) { (t.extra ||= []).push(m); this.group.add(m); }
    }
  }

  /** The riverbank along the shore lines in this tile: a stone face and a promenade where walled, a firm slope elsewhere. */
  *_bankJob(t) {
    const x0 = t.i * TILE, z0 = t.j * TILE, M = new Mesher(), Face = new Mesher(), Prom = new Mesher(), Rail = M, iron = new THREE.Color('#202325');
    const grass = new THREE.Color('#89a868'), stone = new THREE.Color('#8f8a80'), bed = new THREE.Color('#6f6a58');
    const capY = (x, z, y) => Math.min(y, this.cut.cap(x, z) + 0.12);   // (under a road's cut: just over the ground there, under the road)
    for (const L of this.shore ? this.shore.lines : []) {
      const pool = L.pool, waterY = pool + WATER_ABOVE;
      for (let i = 0; i + 1 < L.n; i++) {
        if ((i & 63) === 0 && due()) yield;
        const mx = (L.x[i] + L.x[i + 1]) / 2, mz = (L.z[i] + L.z[i + 1]) / 2;
        if (mx < x0 || mx >= x0 + TILE || mz < z0 || mz >= z0 + TILE) continue;
        const row = (k, s, y) => { const x = L.x[k] + L.nx[k] * s, z = L.z[k] + L.nz[k] * s; return [x, capY(x, z, y), z]; };
        if (L.walled[i] && L.walled[i + 1]) {
          const a = [L.x[i], pool - 4, L.z[i]], b = [L.x[i + 1], pool - 4, L.z[i + 1]];
          const ta = row(i, 0, L.top[i] + 0.03), tb = row(i + 1, 0, L.top[i + 1] + 0.03);
          Face.quad(a, b, tb, ta, stone);                                            // the wall's face (dressed stone)
          const pa = row(i, PROM_M, L.top[i] + 0.03), pb = row(i + 1, PROM_M, L.top[i + 1] + 0.03);
          Prom.quad(ta, tb, pb, pa, stone);                                          // the promenade's paving along the wall
          // the railing on the wall's edge: black iron, posts every 2.4 m, top and bottom rails, pickets
          {
            const ra = row(i, 0.25, L.top[i] + 0.03), rb = row(i + 1, 0.25, L.top[i + 1] + 0.03), seg = Math.hypot(rb[0] - ra[0], rb[2] - ra[2]);
            const at = (f, dy) => [ra[0] + (rb[0] - ra[0]) * f, ra[1] + (rb[1] - ra[1]) * f + dy, ra[2] + (rb[2] - ra[2]) * f];
            Rail.wall(at(0, 0), at(1, 0), 1.02, 1.1, iron, false); Rail.wall(at(0, 0), at(1, 0), 0.08, 0.14, iron, false);
            const np = Math.max(1, Math.round(seg / 0.32));
            for (let q = 0; q < np; q++) { const f0 = q / np, f1 = f0 + 0.04 / Math.max(seg, 0.1); Rail.quad(at(f0, 0.08), at(f1, 0.08), at(f1, 1.05), at(f0, 1.05), iron); }
            const nPost = Math.max(1, Math.round(seg / 2.4));
            for (let q = 0; q < nPost; q++) { const f0 = q / nPost, f1 = f0 + 0.09 / Math.max(seg, 0.1); Rail.quad(at(f0, 0), at(f1, 0), at(f1, 1.18), at(f0, 1.18), iron); }
          }
          if (!this.dressing?.inside(mx, mz)) M.quad(pa, pb, row(i + 1, BANK_CAP, L.top[i + 1] + 0.03), row(i, BANK_CAP, L.top[i] + 0.03), grass);   // then grass (a dressed place has its own)
        } else {
          const S = [-4, 0, 5, BANK_SLOPE];
          for (let q = 0; q + 1 < S.length; q++) {
            const y = (k, s) => bankProfile(s, L.top[k], waterY, pool) + 0.03;
            M.quad(row(i, S[q], y(i, S[q])), row(i + 1, S[q], y(i + 1, S[q])), row(i + 1, S[q + 1], y(i + 1, S[q + 1])), row(i, S[q + 1], y(i, S[q + 1])), q === 0 ? bed : grass);
          }
        }
      }
    }
    // bridge piers: under every deck that stands over a hollow or the water, one every PIER_M (not within 20 m of the
    // deck's ends — the abutments hold those), a slab as wide as the road, from the deck's underside to the ground
    const pier = new THREE.Color('#9a968c');
    for (const { e, a, b } of t.pieces) {
      if (!e.bridges.length) continue;
      const { deck, toEnd } = deckSpans(e);
      const half = this.wOf(e) / 2 - 0.4, pm = this.bridgeMask?.get(e.id) || this.modelDecks?.get(e.id);
      for (let i = Math.max(a, 1); i <= Math.min(b, e.n - 1); i++) {
        if (!deck[i] || toEnd[i] < 20 || i % PIER_STEP) continue;
        if (pm && pm[i] & 1) continue;   // a bridge model stands here (its own piers)
        const gy = this._groundH(e.x[i], e.z[i]), top = e.ele[i] - 1.0;
        if (top - gy < 3) continue;   // (low over the ground: the fill and the abutments are enough)
        let dx = e.x[i + 1] - e.x[i - 1], dz = e.z[i + 1] - e.z[i - 1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const nx = -dz, nz = dx, t2 = 0.9, bot = Math.min(gy, this.poolAt(e.x[i], e.z[i]) - 1) - 0.5;
        const c = (u, v, y) => [e.x[i] + dx * u + nx * v, y, e.z[i] + dz * u + nz * v];
        for (const [u0, v0, u1, v1] of [[-t2, -half, t2, -half], [t2, -half, t2, half], [t2, half, -t2, half], [-t2, half, -t2, -half]])
          M.quad(c(u0, v0, bot), c(u1, v1, bot), c(u1, v1, top), c(u0, v0, top), pier);
      }
    }
    t.bankMesh = M.mesh(this.mats.road);
    if (t.bankMesh) this.group.add(t.bankMesh);
    t.extra = [Face.mesh(this.mats.riverWall), Prom.mesh(this.mats.promenade)].filter(Boolean);   // (the railings: in the bank's mesh, the same material)
    for (const m of t.extra) this.group.add(m);
    if (this.dressing) yield* this._dressingJob(t);
  }
}

/** Triangles with flat colours, gathered then made one mesh. */
class Mesher {
  /** `road`: the road surface's attribute too (aRd: surface code, metres across from the centre, metres along, half width). */
  constructor(road = false) { this.pos = []; this.col = []; this.nrm = []; this.rd = road ? [] : null; }
  _tri(a, b, c, color, ra = null, rb = null, rc = null) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const p of [a, b, c]) { this.pos.push(p[0], p[1], p[2]); this.col.push(color.r, color.g, color.b); this.nrm.push(nx, ny, nz); }
    if (this.rd) for (const r of [ra, rb, rc]) this.rd.push(...(r || ZERO4));
  }
  /** A road quad with its aRd per corner. */
  quadX(a, b, c, d, color, r) { this._tri(a, b, c, color, r[0], r[1], r[2]); this._tri(a, c, d, color, r[0], r[2], r[3]); }
  discX(x, y, z, r, color, seg = 14, surf = 0) {
    const rd = [surf, 0, 0, r];
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      this._tri([x, y, z], [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r], [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r], color, rd, rd, rd);
    }
  }
  quad(a, b, c, d, color, flip = false) {
    if (flip) { this._tri(a, c, b, color); this._tri(a, d, c, color); }
    else { this._tri(a, b, c, color); this._tri(a, c, d, color); }
  }
  /** A vertical wall under/over the edge p0 → p1, from y + y0 to y + y1. */
  wall(p0, p1, y0, y1, color, flip) {
    this.quad([p0[0], p0[1] + y0, p0[2]], [p1[0], p1[1] + y0, p1[2]], [p1[0], p1[1] + y1, p1[2]], [p0[0], p0[1] + y1, p0[2]], color, flip);
  }
  mesh(material) {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.rd) g.setAttribute('aRd', new THREE.Float32BufferAttribute(this.rd, 4));
    g.computeBoundingSphere();
    return new THREE.Mesh(g, material);
  }
}

/** A material set two-sided (before its first compile). */
function twoSided(m) { m.side = THREE.DoubleSide; return m; }

/** A simple rider until the model loads. */
export function makeStandIn() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.5, 1.6), litMaterial({ color: '#ff7a1a' }, 'paint'));
  body.position.y = 0.75;
  group.add(body);
  return {
    group,
    update(pos, fwd) { group.position.copy(pos); group.lookAt(_v.copy(pos).add(new THREE.Vector3(fwd.x, 0, fwd.z))); },
    dispose() { group.removeFromParent(); body.geometry.dispose(); body.material.dispose(); },   // [review 27 Nov]
  };
}

/** A natural bank's height s metres in from the water's edge (− out in the river): under the water to the edge, then
 *  ≥ 1.5 m up within 5 m (no mud ramp), easing to the bank's top by BANK_SLOPE. */
export function bankProfile(s, top, waterY, pool) {
  const T = Math.max(top, waterY + 1.6), y5 = waterY + Math.max(1.5, 0.5 * (T - waterY));
  if (s <= -4) return pool - 2;
  if (s <= 0) return pool - 2 + ((waterY - 0.05 - (pool - 2)) * (s + 4)) / 4;
  if (s <= 5) return waterY - 0.05 + ((y5 - waterY + 0.05) * s) / 5;
  if (s <= BANK_SLOPE) { const u = (s - 5) / (BANK_SLOPE - 5); return y5 + (T - y5) * u * u * (3 - 2 * u); }
  return T;
}

/** The shore lines (tools/pgh_shore.mjs → <id>-shore.json) in the local frame, and the nearest one to a spot. */
export function decodeShore(json, proj) {
  const kl = json.unit?.latlon ?? 1e-6, kt = json.unit?.top ?? 0.1, ks = json.unit?.side ?? 0.001;
  const und = (a, k) => { const o = new Float64Array(a.length); let acc = 0; for (let i = 0; i < a.length; i++) { acc += a[i]; o[i] = acc * k; } return o; };
  const lines = json.lines.map((l) => {
    const la = und(l.lat, kl), lo = und(l.lon, kl), top = und(l.top, kt), side = und(l.side, ks), n = la.length;
    const x = new Float64Array(n), z = new Float64Array(n), nx = new Float64Array(n), nz = new Float64Array(n), walled = new Uint8Array(n);
    for (let i = 0; i < n; i++) { const q = proj.toLocal(la[i], lo[i]); x[i] = q.x; z[i] = q.z; nx[i] = Math.cos(side[i]); nz[i] = Math.sin(side[i]); }
    for (const [a, b] of l.walled) for (let i = a; i <= b; i++) walled[i] = 1;
    return { n, x, z, nx, nz, top, walled, pool: l.pool ?? json.pool };
  });
  // NB: the builder's x/z come from the same projection (the graph's origin), so its sides hold here
  const C = 25, grid = new Map();
  lines.forEach((L, li) => { for (let i = 0; i + 1 < L.n; i++) { const k = cellKey(Math.floor((L.x[i] + L.x[i + 1]) / 2 / C), Math.floor((L.z[i] + L.z[i + 1]) / 2 / C)); (grid.get(k) || grid.set(k, []).get(k)).push(li, i); } });
  return {
    lines,
    /** { s (m: + land, − river), top, walled, d } of the nearest shore within 30 m, or null. */
    at(x, z) {
      const cx = Math.floor(x / C), cz = Math.floor(z / C);
      let best = null, bd = 30;
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
        const arr = grid.get(cellKey(cx + a, cz + b));
        if (!arr) continue;
        for (let k = 0; k < arr.length; k += 2) {
          const L = lines[arr[k]], i = arr[k + 1];
          const ax = L.x[i], az = L.z[i], bx = L.x[i + 1], bz = L.z[i + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
          const px = ax + dx * t, pz = az + dz * t, ex = x - px, ez = z - pz, d = Math.sqrt(ex * ex + ez * ez);
          if (d < bd) {
            bd = d;
            const nx = L.nx[i] * (1 - t) + L.nx[i + 1] * t, nz = L.nz[i] * (1 - t) + L.nz[i + 1] * t;
            best = { s: (x - px) * nx + (z - pz) * nz, top: L.top[i] * (1 - t) + L.top[i + 1] * t, walled: L.walled[i] && L.walled[i + 1], d, pool: L.pool };
          }
        }
      }
      return best;
    },
  };
}

/** The dressed places (tools/pgh_dressing.mjs → <id>-dressing.json) in the local frame, by tile: areas triangulated, lines,
 *  trees. An area goes to every tile its box touches (each tile draws its own copy of it, clipped by nothing: a big
 *  lawn is drawn once, in the tile of its centre). */
export function decodeDressing(json, proj, tile) {
  const P = (p) => { const q = proj.toLocal(p[0], p[1]); return [q.x, q.z]; };
  const put = (map, x, z, item) => { const k = `${Math.floor(x / tile)},${Math.floor(z / tile)}`; (map.get(k) || map.set(k, []).get(k)).push(item); };
  const ORDER = ['park', 'wood', 'scrub', 'lawn', 'fairway', 'green', 'sand', 'garden', 'plaza', 'pool', 'fountain'];
  const areas = new Map(), lines = new Map(), trees = new Map();
  for (const a of [...json.areas].sort((p, q) => ORDER.indexOf(p.kind) - ORDER.indexOf(q.kind))) {
    let pts = a.pts.map(P);
    if (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.01) pts = pts.slice(0, -1);
    if (pts.length < 3) continue;
    const contour = pts.map(([x, z]) => new THREE.Vector2(x, z));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []).map((t3) => t3.map((k) => pts[k]));
    const area2 = pts.reduce((s2, p, i) => { const q = pts[(i + 1) % pts.length]; return s2 + p[0] * q[1] - q[0] * p[1]; }, 0);
    const cx = pts.reduce((s2, p) => s2 + p[0], 0) / pts.length, cz = pts.reduce((s2, p) => s2 + p[1], 0) / pts.length;
    put(areas, cx, cz, { kind: a.kind, name: a.name, pts: [...pts, pts[0]], tris, centre: [cx, cz], wind: area2 > 0 ? 1 : -1 });
  }
  for (const l of json.lines) { const pts = l.pts.map(P), m = pts[Math.floor(pts.length / 2)]; put(lines, m[0], m[1], { ...l, pts }); }
  for (const p of json.trees) { const [x, z] = P(p); put(trees, x, z, [x, z]); }
  // the dressed places' extent (their 'park' areas): the bank's plain grass gives way to the dressing there
  const parks = json.areas.filter((a) => a.kind === 'park').map((a) => a.pts.map(P));
  const inside = (x, z) => parks.some((pts) => inPairs(pts, x, z));
  return { areas, lines, trees, inside };
}
