// Street & facade detail kit: the small things that make a city street believable, for any city route.
// Storefront ground floors, cornices, bay windows, parapets and rooftop clutter on the buildings; curbs,
// raised sidewalks and parking lanes along the streets; street furniture (signal poles, signs, hydrants,
// benches, bus shelters, bollards, planters, bike racks, meters, bins); car parks with stalls; fences,
// walls and hedges; railings on the river walls.
//
// Everything is low-poly, vertex-coloured and merged per city chunk (CityScene's 320 m building chunks)
// into a few meshes, built when the chunk streams in, seeded and deterministic, with distance LOD:
//   near   furniture, parked cars, storefront detail, cornice brackets, shop signs  (≈300 m)
//   mid    cornices, parapets, bays' trim, rooftop clutter, fences, railings        (≈1.1 km)
//   walks  curbs, sidewalks, parking lanes, car parks (a ground surface: always drawn)
// Wall-like pieces (bay windows, stair heads) go into the chunk's own building mesh, so the building
// shader draws their windows and they cost no draw call.
//
// Scene key (all optional; without `streetKit` the kit is off):
//   "streetKit": { "fromM": 0, "toM": 1e9, "rangeM": 220,
//                  "zones": [{ "name", "style": "victorian", "fromM", "toM", "widthM": 80, "parking": true }] }
//                  (a zone with "sidewalks": false lays no sidewalk along the route: a park drive, PLAN 6.6)
// Facade styles: FACADE_STYLES (victorian, rowhouse, masonry, industrial, tower, glass, village). Outside a zone a
// building's style comes from its kind (AUTO_STYLE). OSM details (signals, bus stops, benches, hydrants,
// shops, car parks, fences) come from the city data's `streetKit` block (tools/citylib/street_kit.py); the
// kit's own spacing rules fill in the rest. See docs/pittsburgh/detail/s3.md.
import { ghostAt } from '../../ghost.js';
import * as THREE from '../../../../vendor/three.js';
import { MeshBuilder, hash } from '../core/mesh-builder.js';
import { drain, due, clock, each } from '../core/jobs.js';   // [F30]
import { ROAD_WIDTH, ROAD_LIFT } from '../../pose.js';
import { LAND } from './landscape.js';
import { appendToMeshBuilder } from '../life/figures/vehicles.js';
import { staticCar, pickCar } from '../life/figures/cars.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
/** Quad a-b-c-d wound so its face points along `want` (any vector with the right sign). */
function face(M, a, b, c, d, want, uvs = null) {
  const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a));
  if (n.dot(want) >= 0) M.quad(a, b, c, d, uvs);
  else M.quad(a, d, c, b, uvs && [uvs[0], uvs[1], uvs[6], uvs[7], uvs[4], uvs[5], uvs[2], uvs[3]]);
}
const UP = new THREE.Vector3(0, 1, 0);

/** MeshBuilder with a cheap vertex() (no per-vertex Object.entries) and an optional glow / building attribute. */
class KitBuilder extends MeshBuilder {
  vertex(x, y, z, nx, ny, nz, u = 0, v = 0) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); const c = this.cur.color; this.c.push(c[0], c[1], c[2]); this.uv.push(u, v);
    if (this.extra.aGlow) this.extra.aGlow.data.push(this.cur.aGlow[0]);
    else if (this.extra.aBld) { const b = this.cur.aBld; this.extra.aBld.data.push(b[0], b[1], b[2], b[3]); }
    return this.p.length / 3 - 1;
  }
  /**
   * A trim band along a wall: from (x0, z0) to (x1, z1) (the wall line), `d` out along (nx, nz), from y to y + h.
   * Front, top and bottom faces only (6 triangles): cornices, belt courses, sills, fascias.
   */
  band(x0, z0, x1, z1, nx, nz, d, y, h) {
    const t0 = this.i.length;
    const A = V(x0, y, z0), B = V(x1, y, z1), A2 = V(x0 + nx * d, y, z0 + nz * d), B2 = V(x1 + nx * d, y, z1 + nz * d);
    const up = (p) => V(p.x, p.y + h, p.z);
    face(this, A2, B2, up(B2), up(A2), V(nx, 0, nz));
    face(this, up(A), up(B), up(B2), up(A2), UP);
    if (h > .05) face(this, A, B, B2, A2, V(0, -1, 0));
    this.members.push([t0, this.i.length]);
    return this;
  }
  /** A box without its bottom face (10 triangles): things standing on a roof or the ground. */
  block(x, y, z, w, h, l, yaw = 0) {
    const t0 = this.i.length, c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (dx, dy, dz) => V(x + dx * c + dz * s, y + dy, z - dx * s + dz * c);
    const v = [P(-w / 2, 0, -l / 2), P(w / 2, 0, -l / 2), P(w / 2, 0, l / 2), P(-w / 2, 0, l / 2), P(-w / 2, h, -l / 2), P(w / 2, h, -l / 2), P(w / 2, h, l / 2), P(-w / 2, h, l / 2)];
    this.quad(v[4], v[7], v[6], v[5]);
    this.quad(v[0], v[4], v[5], v[1]); this.quad(v[1], v[5], v[6], v[2]); this.quad(v[2], v[6], v[7], v[3]); this.quad(v[3], v[7], v[4], v[0]);
    this.members.push([t0, this.i.length]);
    return this;
  }
}
const GROUND_CELL = 6;   // [w2-clip] the near ground's grid (stylized-terrain.js: 96 m patches, 16 cells a side)
import { CURB_H, ROUTE_CURB, streetKitConfig, routeCurbAt, zoneCurbAt, walkTopAt } from './street-grade.js';
import { releaseAfterUpload } from '../core/release.js';   // [F399]
import { withNightGlow } from '../materials/night-glow.js';   // [review 27 Nov]
import { patchShader } from '../core/shader-patch.js';
export { streetKitConfig, zoneCurbAt, walkTopAt, CURB_H, ROUTE_CURB };
const LOD = { light: { near: 160, mid: 450, carDetail: 40 }, balanced: { near: 260, mid: 750, carDetail: 90 }, high: { near: 320, mid: 900, carDetail: 90 } };   // [finish] High: near 380 → 320, mid 1100 → 900, detailed cars 140 → 90 m (the 2 M triangle budget)   // [w2-polish] carDetail: detailed parked cars within this of them

// ---------------------------------------------------------------- catalogue: facade styles
/**
 * A facade style: how a building's street faces are dressed. Probabilities are per building (or per shop
 * unit for `store`); heights in metres; colours sRGB hex.
 */
export const FACADE_STYLES = {
  // 2–4 storey brick commercial rows built to the sidewalk (East Carson Street, main streets)
  victorian: { store: .92, storeH: 4.1, unitM: [5, 8], awning: .4, blade: .35, cornice: { h: .75, d: .55, frieze: 1.1, brackets: true },
    belt: true, bays: .35, parapet: .75, pediment: .35, sills: true, roof: ['#a39d92', '#8f8a82', '#b7b2a8'],
    trim: ['#e8dfc8', '#3c4a3e', '#5b2d26', '#2d2f33', '#cbb994', '#7a5a3a'], frame: ['#2c3a30', '#3a2420', '#24272b', '#5c4632', '#6e2e2a'] },
  // brick rowhouses: a few corner shops, small cornices, the odd bay
  rowhouse: { store: .12, storeH: 3.6, unitM: [5, 7], awning: .3, blade: .15, cornice: { h: .45, d: .35, frieze: .5, brackets: true },
    belt: false, bays: .2, parapet: .5, pediment: .1, sills: true, roof: ['#9a958d', '#85817a'],
    trim: ['#e6dcc4', '#3b3d3f', '#6b4a35', '#d8d0bc'], frame: ['#2c2f33', '#4a3226'] },
  // stone / brick commercial blocks downtown: a storefront base, belt course, heavy cornice
  masonry: { store: .6, storeH: 4.6, unitM: [6, 10], awning: .2, blade: .1, cornice: { h: .9, d: .6, frieze: 1.2, brackets: false },
    belt: true, bays: 0, parapet: .9, pediment: .05, sills: false, roof: ['#a7a39b', '#b9b5ac'],
    trim: ['#d9d1bf', '#bfb6a2', '#8e877a'], frame: ['#2b2e31', '#3d3a35'] },
  // warehouses and works: a plain coping, loading doors, no shops
  industrial: { store: 0, storeH: 4.5, unitM: [8, 12], awning: 0, blade: 0, cornice: { h: .35, d: .15, frieze: 0, brackets: false },
    belt: false, bays: 0, parapet: 1, pediment: 0, sills: false, docks: .6, roof: ['#b4b1aa', '#9e9b94', '#c4c1ba'],
    trim: ['#8d8a83', '#6f6c66'], frame: ['#55585b'] },
  // a tower's base: shopfronts and a cornice line over the second floor
  tower: { store: .8, storeH: 5, unitM: [7, 11], awning: .1, blade: 0, cornice: { h: .8, d: .7, frieze: 0, brackets: false }, baseCornice: 9,
    belt: true, bays: 0, parapet: 1, pediment: 0, sills: false, roof: ['#9d9a94'], trim: ['#cfc7b5', '#9a958b'], frame: ['#2a2d30'] },
  // a small-town main street (Skaneateles' Genesee Street, Marcellus): 2–3 storey brick and painted fronts, most shops
  // under a canvas awning (striped on some), painted fascia signs, bracketed cornices
  village: { store: .95, storeH: 4, unitM: [5, 9], awning: .7, stripes: .45, blade: .25, cornice: { h: .7, d: .5, frieze: 1, brackets: true },
    belt: true, bays: .15, parapet: .6, pediment: .3, sills: true, roof: ['#8f8a82', '#6f6a64', '#a39d92'],
    trim: ['#efe6cf', '#2f4a3c', '#6b2a26', '#2a3340', '#d9c9a0', '#f4f1ea'], frame: ['#1f3a2e', '#5a1f1c', '#1e2a3a', '#3a3a3a', '#f0ebe0'],
    awnings: ['#1f4d3a', '#7a1f24', '#1f3b57', '#3a3a3a', '#8a6a2a', '#5a2a4a'] },
  // glass towers: a dark glazed base and a thin canopy
  glass: { store: .9, storeH: 5, unitM: [8, 12], awning: 0, canopy: .5, blade: 0, cornice: null, belt: false, bays: 0, parapet: 1, pediment: 0,
    sills: false, roof: ['#8e9296'], trim: ['#9aa4ab'], frame: ['#1f2428'] },
};
/** Building kind (tools/build_city.py) → facade style outside a zone; null: left plain. */
export const AUTO_STYLE = { 0: 'rowhouse', 1: null, 2: 'masonry', 3: 'industrial', 4: 'tower', 5: 'glass', 7: 'masonry', 8: 'industrial', 11: 'masonry' };

const SHOP_LABELS = {
  food: ['PIZZA', 'TACOS', 'DINER', 'NOODLES', 'BBQ', 'DELI', 'PIEROGIES', 'RAMEN', 'BURGERS', 'THAI'],
  bar: ['BAR', 'BREWPUB', 'TAVERN', 'LIVE MUSIC', 'WINE BAR', 'SALOON'],
  cafe: ['COFFEE', 'CAFE', 'BAKERY', 'DONUTS', 'TEA'],
  shop: ['BOOKS', 'VINYL', 'THRIFT', 'BIKES', 'HARDWARE', 'FLOWERS', 'GALLERY', 'TATTOO', 'ANTIQUES', 'SHOES', 'TOYS', 'VINTAGE'],
  service: ['BARBER', 'SALON', 'TAILOR', 'OPTICIAN'],
  bank: ['BANK'], pharmacy: ['PHARMACY'],
};
const SIGN_COLORS = [['#1f3b57', '#ffd34d'], ['#7a1f24', '#fff3d6'], ['#14402e', '#9ef0c2'], ['#2a2a2a', '#ff5fa2'], ['#f2e6c9', '#7a2b16'],
  ['#0f2f4a', '#6fd3ff'], ['#3b2416', '#ffb347'], ['#262145', '#c7a0ff']];
const ALL_LABELS = Object.values(SHOP_LABELS).flat();
// [w2-polish] every label once, in a fixed shuffle (seeded), for shopLabel()
const SHOP_ORDER = ALL_LABELS.map((l, k) => [hash(k * 2654435761 + 97), l]).sort((a, b) => a[0] - b[0]).map((e) => e[1]);

// ---------------------------------------------------------------- the kit
export class StreetKit {
  /**
   * @param {import('./city.js').CityScene} city
   * @param {object} config  streetKitConfig(scene)
   * @param {{chunk:number}} opts  the city's chunk size (metres)
   */
  constructor(city, config, { chunk = 320 } = {}, deferred = false) {
    const job = this._buildJob(city, config, chunk);   // [F30] a job: `deferred`, the caller runs `this.job` in frame slices
    if (deferred) { this.job = job; return; }
    drain(job);
  }

  *_buildJob(city, config, chunk) {
    this.city = city; this.cfg = config; this.CHUNK = chunk;
    this.L = city.landscape; this.route = city.route; this.index = city.index;
    this.end = this.route.turnIdx || this.route.dist.length - 1;
    this.meshes = [];          // every kit mesh, for LOD
    this.pending = new Map();  // chunk key → { furniture: [], stations: [], lots: [], lines: [], rails: [] }
    this.jobs = new Map();     // chunk key → buildings to dress (recorded while the city builds the chunk)
    this.queue = [];           // chunks waiting to be dressed: [{ key, out, gen }]
    this.deferred = false;     // true while the app streams (CityScene._stream): dress chunks a few ms per frame
    this.budgetMs = 3;
    this._outs = new Map();    // chunk key → the city's mesh list for it
    this._started = new Set(); // chunk keys whose kit work has begun (their bucket is taken)
    this._late = new Set();    // chunk keys given furniture after that (built on the next tick)
    this.junctionsExternal = false;
    this._t0 = 0;              // start of the current slice of chunk work (see _due)
    this.stats = { buildings: 0, triangles: 0, meshes: 0, furniture: 0, cars: 0 };
    this._lod = LOD[city.qualityKey] || LOD.balanced;
    this.maxCurb = Math.max(ROUTE_CURB, ...config.zones.map((z) => z.curbM));
    this._materials();
    if (due()) yield;
    this._area();
    if (due()) yield;
    this._streetGrid();
    if (due()) yield;
    this._decodeData();
    if (due()) yield;
    yield* this._planJob();
    // [w2-clip] the terrain's scattered trees, shrubs and rocks stay off the kit's sidewalks and car parks
    { const plant = this.L.canPlant; this.L.canPlant = (x, z) => (!plant || plant(x, z)) && !this.onWalk(x, z); }
  }

  /** [w2-clip] Is (x, z) on (or within `margin` of) a kit sidewalk or car park? Conservative: the widest a walk can be. */
  onWalk(x, z, margin = .5) {
    if (!this.inArea(x, z)) return false;
    const r = this.L.routeDist(x, z), s = r && this.sOf(r);
    if (r && s >= this.cfg.fromM && s <= this.cfg.toM && this.L.routeKindAt(s) === 'road') {
      const c = this.curbAt(s), w = (this.zoneAt(s)?.sidewalkM ?? 3) + 4.4;   // (_station: to the building line, at most width + 4 + .4)
      if (r.d > c - .2 && r.d < c + w + margin) return true;
    }
    for (const o of this.streetsAt(x, z, 2.5 + margin)) if (!o.st.bridge && o.st.cls >= 2 && o.st.cls <= 6) return true;
    if (!this._lotGrid) {
      this._lotGrid = new Map();
      for (const ring of this.osm.lots) {
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (const p of ring) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
        for (let gx = Math.floor((x0 - 1) / 40); gx <= Math.floor((x1 + 1) / 40); gx++) for (let gz = Math.floor((z0 - 1) / 40); gz <= Math.floor((z1 + 1) / 40); gz++) {
          const k = `${gx},${gz}`; if (!this._lotGrid.has(k)) this._lotGrid.set(k, []); this._lotGrid.get(k).push(ring);
        }
      }
    }
    for (const ring of this._lotGrid.get(`${Math.floor(x / 40)},${Math.floor(z / 40)}`) || []) {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], c = ring[j]; if ((a.z > z) !== (c.z > z) && x < ((c.x - a.x) * (z - a.z)) / (c.z - a.z) + a.x) inside = !inside; }
      if (inside) return true;
    }
    return false;
  }

  // ------------------------------------------------------------ helpers
  key(x, z) { return `${Math.floor(x / this.CHUNK)},${Math.floor(z / this.CHUNK)}`; }
  bucket(key) { let b = this.pending.get(key); if (!b) this.pending.set(key, (b = { furniture: [], stations: [], lots: [], lines: [], rails: [] })); return b; }
  /** Chunk keys with kit content but maybe no buildings (the city streams them too). */
  keys() { return [...this.pending.keys()]; }
  outbound(i) { return i > this.end ? Math.max(0, 2 * this.end - i) : i; }
  /** The route's curb line (metres from its centre) at outbound distance s: the zone's curbM, else ROUTE_CURB. */
  curbAt(s) { return routeCurbAt(this.cfg, s); }
  /** Outbound route distance of a routeDist() hit. */
  sOf(r) { return this.route.dist[this.outbound(r.i)]; }

  /** Route frame at distance s (outbound): position, height, tangent and right vectors. */
  frame(s) {
    const r = this.route, i = Math.max(0, Math.min(this.end - 1, Math.floor(s / 10)));
    const span = r.dist[i + 1] - r.dist[i] || 1, f = Math.max(0, Math.min(1, (s - r.dist[i]) / span));
    const X = this.index.xs, Z = this.index.zs;
    const x = X[i] + (X[i + 1] - X[i]) * f, z = Z[i] + (Z[i + 1] - Z[i]) * f, y = r.ele[i] + (r.ele[i + 1] - r.ele[i]) * f;
    const a = Math.max(0, i - 1), b = Math.min(this.end, i + 2);
    let tx = X[b] - X[a], tz = Z[b] - Z[a]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    return { x, y, z, tx, tz, rx: -tz, rz: tx, s };
  }

  /** The kit works within `rangeM` of the route between fromM and toM: a 40 m cell set. */
  _area() {
    const C = 40, R = this.cfg.rangeM, cells = new Map(), r = this.route;
    for (let i = 0; i <= this.end; i++) {
      const s = r.dist[i];
      if (s < this.cfg.fromM - R || s > this.cfg.toM + R || ghostAt(r, s)) continue;
      const x = this.index.xs[i], z = this.index.zs[i], n = Math.ceil(R / C), gx = Math.floor(x / C), gz = Math.floor(z / C);
      for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) {
        const d = Math.hypot((gx + a + .5) * C - x, (gz + b + .5) * C - z);
        if (d > R + C * .7) continue;
        const k = `${gx + a},${gz + b}`, c = cells.get(k);
        if (!c || d < c.d) cells.set(k, { d, s });
      }
    }
    // only cells whose nearest stretch of route is inside the kit's span
    for (const [k, c] of cells) if (c.s < this.cfg.fromM || c.s > this.cfg.toM) cells.delete(k);
    this._cells = cells;
    // a 10 m grid of the distance to the route's line (anywhere along it), out to 40 m: cheap "could this be near the road"
    const G = new Map(), X = this.index.xs, Z = this.index.zs;
    for (let i = 0; i <= this.end; i++) {
      const gx = Math.floor(X[i] / 10), gz = Math.floor(Z[i] / 10);
      for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) {
        const k = (gx + a) * 131072 + (gz + b), d = Math.hypot((gx + a + .5) * 10 - X[i], (gz + b + .5) * 10 - Z[i]);
        if (!(G.get(k) <= d)) G.set(k, d);
      }
    }
    this._near10 = G;
  }
  /** Lower bound on the distance from (x, z) to the route's road line (Infinity beyond ~35 m). */
  routeNear(x, z) { const d = this._near10.get(Math.floor(x / 10) * 131072 + Math.floor(z / 10)); return d == null ? Infinity : Math.max(0, d - 12.2); }
  inArea(x, z) { return this._cells.has(`${Math.floor(x / 40)},${Math.floor(z / 40)}`); }
  /** Route distance s (outbound, ±40 m) if (x, z) is within the kit's reach of its span of the route, else null. */
  routeS(x, z) { return this._cells.get(`${Math.floor(x / 40)},${Math.floor(z / 40)}`)?.s ?? null; }
  routeD(x, z) { return this._cells.get(`${Math.floor(x / 40)},${Math.floor(z / 40)}`)?.d ?? Infinity; }
  zoneAt(s, d = 0) { return s == null ? null : this.cfg.zones.find((z) => s >= z.fromM && s <= z.toM && d <= z.widthM) || null; }

  /** Street segments on a 24 m grid with their directions: for "which street, and which way does it run". */
  _streetGrid() {
    const g = new Map(), S = this.city.streets;
    S.forEach((st, k) => {
      for (let i = 1; i < st.pts.length; i++) {
        const a = st.pts[i - 1], b = st.pts[i], r = st.width / 2 + 2;
        for (let gx = Math.floor((Math.min(a.x, b.x) - r) / 24); gx <= Math.floor((Math.max(a.x, b.x) + r) / 24); gx++)
          for (let gz = Math.floor((Math.min(a.z, b.z) - r) / 24); gz <= Math.floor((Math.max(a.z, b.z) + r) / 24); gz++) {
            const key = `${gx},${gz}`; if (!g.has(key)) g.set(key, []); g.get(key).push(k, i);
          }
      }
    });
    this._sg = g;
  }
  /** Streets whose carriageway comes within `extra` of (x, z): [{k, edge, y, tx, tz, st}]. */
  streetsAt(x, z, extra = 0) {
    const out = new Map(), S = this.city.streets, a = this._sg.get(`${Math.floor(x / 24)},${Math.floor(z / 24)}`);
    if (!a) return [];
    for (let q = 0; q < a.length; q += 2) {
      const k = a[q], st = S[k], p = st.pts[a[q + 1] - 1], c = st.pts[a[q + 1]];
      const dx = c.x - p.x, dz = c.z - p.z, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - p.x) * dx + (z - p.z) * dz) / l2));
      const edge = Math.hypot(p.x + dx * t - x, p.z + dz * t - z) - st.width / 2;
      if (edge < extra && (!out.has(k) || edge < out.get(k).edge)) { const l = Math.sqrt(l2); out.set(k, { k, st, edge, y: p.y + (c.y - p.y) * t, tx: dx / l, tz: dz / l, px: p.x + dx * t, pz: p.z + dz * t }); }
    }
    return [...out.values()];
  }

  // ------------------------------------------------------------ materials
  _materials() {
    const city = this.city, night = city.night;
    // vertex colour + a per-vertex glow that lights up at night (aGlow): 0 none; (0, 1] warm light (shop windows,
    // shelters); 2 the vertex colour, bright (signal lenses, walk signals); 3 the texture's own colours (shop signs)
    const kitMaterial = (map = null) => {
      const m = city.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .78, metalness: .04, map }));
      // [review 27 Nov] the shared night glow
      return withNightGlow(m, night, '(vGlow > 2.5 ? diffuseColor.rgb * .95 : mix(vec3(1., .78, .5), vColor.rgb * 3., step(1.5, vGlow))) * min(vGlow, 1.) * uNight * 1.4',
        map ? 'street-kit-1-map' : 'street-kit-1', { glow: 'float', patch: (shader) => {
          shader.fragmentShader = patchShader(shader.fragmentShader, '#include <roughnessmap_fragment>', 'roughnessFactor = mix(roughnessFactor, .2, step(.05, vGlow) * step(vGlow, 2.5));');
        } });
    };
    this.material = kitMaterial();
    // sidewalks, curbs, parking lanes, car parks: ground surfaces (drawn under the furniture, over the old ribbons)
    this.walkMaterial = city.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95, polygonOffset: true, polygonOffsetFactor: -1.2, polygonOffsetUnits: -1.2 }));
    // shop signs: an atlas of generic shop names (no brands), lit at night
    const cvs = document.createElement('canvas'); cvs.width = 1024; cvs.height = 512;
    const ctx = cvs.getContext('2d');
    this.labels = ALL_LABELS;
    ALL_LABELS.forEach((name, k) => {
      const x = (k % 8) * 128, y = Math.floor(k / 8) * 85, [bg, fg] = SIGN_COLORS[k % SIGN_COLORS.length];
      ctx.fillStyle = bg; ctx.fillRect(x + 2, y + 2, 124, 81);
      ctx.strokeStyle = fg; ctx.lineWidth = 3; ctx.strokeRect(x + 7, y + 7, 114, 71);
      ctx.fillStyle = fg; ctx.font = `bold ${name.length > 7 ? 17 : 24}px Georgia, serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(name, x + 64, y + 44);
    });
    // the bottom strip stays white: everything else in the near mesh samples uv (0, 0) there (constant uv: mip 0)
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 440, 1024, 72);
    const tex = city.own(new THREE.CanvasTexture(cvs)); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    // the near mesh (furniture, storefront detail) carries the shop signs too: one material, one draw call
    this.nearMaterial = kitMaterial(tex);
  }
  /** UV rectangle of a label in the sign atlas. */
  labelUV(name) {
    const k = Math.max(0, this.labels.indexOf(name)), u0 = (k % 8) / 8, v1 = 1 - Math.floor(k / 8) * 85 / 512;
    return [u0 + .003, v1 - 83 / 512, u0 + 1 / 8 - .003, v1 - .004];
  }
  setNight() {}   // (the kit's glow follows the city's night uniform)

  // ------------------------------------------------------------ OSM details (city data's streetKit block)
  _decodeData() {
    const K = this.city.data.streetKit, D = this.city.D;
    this.osm = { points: [], shops: [], lots: [], lines: [] };
    if (!K || K.format !== 'bikefree-street-kit-1') return;
    const i16 = (t) => { const b = Uint8Array.from(atob(t), (c) => c.charCodeAt(0)); return new Int16Array(b.buffer, 0, b.byteLength / 2); };
    const u32 = (t) => { const b = Uint8Array.from(atob(t), (c) => c.charCodeAt(0)); return new Uint32Array(b.buffer, 0, b.byteLength / 4); };
    const pts = i16(K.points.xy);
    K.points.kind.forEach((k, j) => { const p = D.local(pts[j * 2], pts[j * 2 + 1]); if (this.inArea(p.x, p.z)) this.osm.points.push({ kind: K.pointKinds[k], ...p }); });
    const sh = i16(K.shops.xy);
    K.shops.cat.forEach((c, j) => { const p = D.local(sh[j * 2], sh[j * 2 + 1]); if (this.inArea(p.x, p.z)) this.osm.shops.push({ cat: K.shopCats[c], ...p }); });
    const rings = (blk) => { const st = u32(blk.starts), xy = i16(blk.xy), out = []; for (let r = 0; r + 1 < st.length; r++) out.push(D.points(xy, st[r], st[r + 1])); return out; };
    for (const ring of rings(K.lots)) if (ring.some((p) => this.inArea(p.x, p.z))) this.osm.lots.push(ring);
    rings(K.lines).forEach((line, j) => { if (line.some((p) => this.inArea(p.x, p.z))) this.osm.lines.push({ kind: K.lineKinds[K.lines.kind[j]], pts: line }); });
    // shops on a 40 m grid, for labelling storefronts by what is really there
    this._shopGrid = new Map();
    for (const s of this.osm.shops) { const k = `${Math.floor(s.x / 40)},${Math.floor(s.z / 40)}`; if (!this._shopGrid.has(k)) this._shopGrid.set(k, []); this._shopGrid.get(k).push(s); }
  }
  shopNear(x, z, r = 9) {
    let best = null, bd = r;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const s of this._shopGrid?.get(`${Math.floor(x / 40) + a},${Math.floor(z / 40) + b}`) || []) {
      const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  // ------------------------------------------------------------ placement plan (cheap: spots only; geometry per chunk)
  *_planJob() {
    const L = this.L, r = this.route;
    // 1. the route's own street: sidewalk stations every 3 m on both sides (road stretches, not decks)
    const s0 = Math.max(0, this.cfg.fromM), s1 = Math.min(r.dist[this.end] - 1, this.cfg.toM);
    const decks = L.routeBridges || [];
    for (let s = s0; s <= s1; s += 3) {
      if (due()) yield;
      if (L.routeKindAt(s) !== 'road' || decks.some((b) => s > b.fromM - 8 && s < b.toM + 8) || ghostAt(r, s)) continue;   // (a ghost: the real pass has its sidewalks)
      const f = this.frame(s);
      for (const side of [-1, 1]) {
        const c = this.curbAt(s), cx = f.x + f.rx * side * c, cz = f.z + f.rz * side * c;
        this.bucket(this.key(cx, cz)).stations.push({ s, side, route: true });
      }
    }
    // 2. other streets (classes 2–6, on the ground): stations every 3.5 m on both sides
    yield* each(this.city.streets, (st, k) => {
      if (st.bridge || st.cls < 2 || st.cls > 6) return;
      let acc = 0;
      for (let i = 1; i < st.pts.length; i++) {
        const a = st.pts[i - 1], b = st.pts[i], len = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.round(len / 3.5));
        for (let j = 0; j < n; j++) {
          const t = j / n, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
          acc += len / n;
          if (!this.inArea(x, z) || this.routeS(x, z) == null) continue;
          const rd = L.routeDist(x, z);
          if (rd && rd.d < this.curbAt(this.sOf(rd)) + 4) continue;   // the route's own street: done above
          for (const side of [-1, 1]) this.bucket(this.key(x, z)).stations.push({ k, i, t, side, acc });
        }
      }
    });
    // 3. OSM furniture
    for (const p of this.osm.points) this.bucket(this.key(p.x, p.z)).furniture.push({ osm: true, ...p });
    for (const ring of this.osm.lots) this.bucket(this.key(ring[0].x, ring[0].z)).lots.push(ring);
    for (const l of this.osm.lines) this.bucket(this.key(l.pts[0].x, l.pts[0].z)).lines.push(l);
    // 4. river-wall railings near the route
    for (const [, a] of this.city.wallGrid || []) for (let q = 0; q < a.length; q += 4) {
      const mx = (a[q] + a[q + 2]) / 2, mz = (a[q + 1] + a[q + 3]) / 2;
      if (this.inArea(mx, mz) && this.routeS(mx, mz) != null) this.bucket(this.key(mx, mz)).rails.push([a[q], a[q + 1], a[q + 2], a[q + 3]]);
    }
    // 5. along the route's trails: benches and bins every ~70 m, alternating sides
    for (let s = s0 + 35; s <= s1; s += 70) {
      if (L.routeKindAt(s) !== 'trail' || decks.some((b) => s > b.fromM - 10 && s < b.toM + 10) || ghostAt(this.route, s)) continue;
      const f = this.frame(s), side = Math.floor(s / 70) % 2 ? 1 : -1, off = ROAD_WIDTH / 2 + 1.7;
      const x = f.x + f.rx * side * off, z = f.z + f.rz * side * off, yaw = Math.atan2(-f.rx * side, -f.rz * side);
      this.bucket(this.key(x, z)).furniture.push({ kind: 'bench', x, z, yaw, trail: true });
      const x2 = x + f.tx * 1.6, z2 = z + f.tz * 1.6;
      if (Math.floor(s / 70) % 3 === 0) this.bucket(this.key(x2, z2)).furniture.push({ kind: 'waste', x: x2, z: z2, yaw, trail: true });
    }
    // 6. a trail's parkland: picnic tables on the landward grass every ~140 m, a marker post every 400 m
    for (let s = s0 + 105; s <= s1; s += 140) {
      if (L.routeKindAt(s) !== 'trail' || decks.some((b) => s > b.fromM - 10 && s < b.toM + 10) || ghostAt(this.route, s)) continue;
      const f = this.frame(s), side = L.waterAt(f.x + f.rx * 25, f.z + f.rz * 25) < L.waterAt(f.x - f.rx * 25, f.z - f.rz * 25) ? 1 : -1;
      for (const off of [6.5, 9, 12]) {
        const x = f.x + f.rx * side * off, z = f.z + f.rz * side * off;
        if (L.landAt(x, z) !== LAND.grass) continue;
        this.bucket(this.key(x, z)).furniture.push({ kind: 'picnic', x, z, yaw: Math.atan2(f.tx, f.tz) + (hash(s) - .5) * .5, trail: true, clearR: 1.3 });
        break;
      }
    }
    for (let s = Math.ceil((s0 + 1) / 400) * 400; s <= s1; s += 400) {
      if (L.routeKindAt(s) !== 'trail' || decks.some((b) => s > b.fromM - 10 && s < b.toM + 10) || ghostAt(this.route, s)) continue;
      const f = this.frame(s), side = Math.floor(s / 400) % 2 ? 1 : -1, off = ROAD_WIDTH / 2 + 1.1;
      const x = f.x + f.rx * side * off, z = f.z + f.rz * side * off;
      this.bucket(this.key(x, z)).furniture.push({ kind: 'trailMarker', x, z, yaw: Math.atan2(-f.rx * side, -f.rz * side), trail: true });
    }
  }

  // ------------------------------------------------------------ street trees
  /**
   * Street trees along the route in zones with `trees` (spacing, metres): in tree pits 1.1 m in from the curb, where
   * the sidewalk is at least 3.4 m deep, sized so the crown stays clear of the rider's space and the walls. Returns
   * spots for CityScene._trees ({x, z, seed, kit: true}: drawn with the city's instanced street trees, no extra
   * draw call); the pits (grates) are queued as furniture. Called once, by the city, before it plants its trees.
   */
  treeSpots() { return drain(this.treeSpotsJob()); }
  /** treeSpots as a job ([F30]). */
  *treeSpotsJob() {
    if (this._treeSpots) return this._treeSpots;
    const out = (this._treeSpots = []), L = this.L, decks = L.routeBridges || [];
    this._treeCells = new Set();
    for (const zone of this.cfg.zones) {
      if (!(zone.trees > 0)) continue;
      for (const side of [-1, 1]) for (let s = zone.fromM + (side > 0 ? zone.trees / 2 : 0) + 4; s <= zone.toM - 4; s += zone.trees) {
        if (due()) yield;
        if (L.routeKindAt(s) !== 'road' || decks.some((b) => s > b.fromM - 12 && s < b.toM + 12) || ghostAt(this.route, s)) continue;
        const f = this.frame(s), curb = this.curbAt(s), nx = f.rx * side, nz = f.rz * side;
        const ix = f.x + nx * curb, iz = f.z + nz * curb, x = ix + nx * 1.1, z = iz + nz * 1.1;
        const line = this.buildingLine(ix, iz, nx, nz, 8);
        if (line < 3.4) continue;
        let bad = false;
        for (const u of [-2.6, 0, 2.6]) {
          const px = x + f.tx * u, pz = z + f.tz * u;
          if (this.crossing(px, pz, -1, f.tx, f.tz) || this.crossing(ix + f.tx * u, iz + f.tz * u, -1, f.tx, f.tz) || [LAND.water, LAND.pond].includes(L.landAt(px, pz))) { bad = true; break; }
        }
        if (!bad) for (const o of this.streetsAt(x, z, 1.2)) if (o.st.cls < 8 && (o.edge < .5 || !this.routeStreet(o, f.tx, f.tz))) { bad = true; break; }
        if (!bad && !this._station({ route: true, s, side })) bad = true;   // no sidewalk here
        if (bad || this.lampNear(x, z, 3)) continue;
        // [6.1] the trunk clear of every wall's facade, not just the one straight out from the curb (a corner block,
        // a frontage at an angle): pilasters and bays stand ~.9 m proud, awnings and blade signs reach 1.3 m out
        if (this.city.buildingNear(x, z, 2.3)) continue;
        // crown radius 2.4 × scale (city tree: scale .75 + seed × .5): clear of the tube (ROAD_WIDTH / 2 + .6) and the walls
        const wmax = Math.min(1.25, (curb + 1.1 - ROAD_WIDTH / 2 - .9) / 2.4, (Math.min(line, 8) - 1.1 + .4) / 2.4);
        if (wmax < .78) continue;
        const seed = Math.min(hash(Math.round(s) * 31 + side * 7), (wmax - .75) / .5);
        out.push({ x, z, seed, kit: true, sy: 1.35, y: walkTopAt(f.y) - .05 });   // taller: crowns over the shop signs (≈ 5–8 m)
        this._treeCells.add(`${side}:${Math.floor(s / 3)}`);
        this.bucket(this.key(x, z)).furniture.push({ kind: 'treePit', x, z, yaw: Math.atan2(-nx, -nz), given: true, y: f.y + ROAD_LIFT + CURB_H });
      }
    }
    // trail parkland (`parkTrees`: spacing, metres): loose groups on the grass beside the route's trails, more on
    // the landward side; checked by the city like its other trees
    const every = this.cfg.parkTrees || 0, r = this.route;
    if (every > 0) for (let s = Math.max(0, this.cfg.fromM); s <= Math.min(r.dist[this.end] - 1, this.cfg.toM); s += every) {
      if (L.routeKindAt(s) !== 'trail' || decks.some((b) => s > b.fromM - 15 && s < b.toM + 15) || ghostAt(this.route, s)) continue;
      const f = this.frame(s), land = L.waterAt(f.x + f.rx * 25, f.z + f.rz * 25) < L.waterAt(f.x - f.rx * 25, f.z - f.rz * 25) ? 1 : -1;
      for (const side of [land, -land]) for (let k = 0; k < 2; k++) {
        const h = hash(Math.round(s) * 13 + side * 5 + k * 71);
        if (h > (side === land ? .6 : .3)) continue;
        const off = 8.5 + hash(Math.round(s) * 7 + side + k * 3) * 16, along = (hash(Math.round(s) * 3 + k) - .5) * every;
        const x = f.x + f.rx * side * off + f.tx * along, z = f.z + f.rz * side * off + f.tz * along;
        const c = L.landAt(x, z);
        if (c !== LAND.grass && c !== LAND.woods) continue;
        out.push({ x, z, seed: hash(Math.round(x * 3) + Math.round(z * 7) * 17) });
      }
    }
    return out;
  }
  /**
   * Where the city's route lamp at outbound distance s, on `side`, stands in a kit zone: { x, z, y } on the sidewalk
   * at the curb; null where the zone has no sidewalk there (a junction); undefined outside the zones.
   */
  routeLamp(s, side) {
    if (!this.zoneAt(s) || this.zoneAt(s).sidewalks === false) return undefined;   // ([6.6] a park drive: lamps on the verge, as outside the zones)
    const P = this._station({ route: true, s, side });
    if (!P || !this._station({ route: true, s: s - 3, side }) || !this._station({ route: true, s: s + 3, side })) return null;   // on a run of slabs, not at its end
    return { x: P.ix + P.nx * .45, z: P.iz + P.nz * .45, y: P.top };
  }
  treeAt(side, s) { return this._treeCells?.has(`${side}:${Math.floor(s / 3)}`) || this._treeCells?.has(`${side}:${Math.floor(s / 3) - 1}`) || this._treeCells?.has(`${side}:${Math.floor(s / 3) + 1}`); }
  /** [finish] Is a street tree's trunk (CityScene._trees, kit pits included) within r of (x, z)? */
  treeNear(x, z, r = .9) {
    const T = this.city.treeTrunks; if (!T) return false;
    if (!this._trees || this._treesN !== T.length) {
      this._trees = new Map(); this._treesN = T.length;
      for (let i = 0; i < T.length; i += 2) { const k = `${Math.floor(T[i] / 20)},${Math.floor(T[i + 1] / 20)}`; if (!this._trees.has(k)) this._trees.set(k, []); this._trees.get(k).push(T[i], T[i + 1]); }
    }
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const L = this._trees.get(`${Math.floor(x / 20) + a},${Math.floor(z / 20) + b}`); if (!L) continue;
      for (let i = 0; i < L.length; i += 2) if (Math.hypot(L[i] - x, L[i + 1] - z) < r) return true;
    }
    return false;
  }
  /** A street lamp (CityScene.lamps) within r of (x, z)? */
  lampNear(x, z, r = .6) {
    if (!this._lamps) {
      this._lamps = new Map();
      for (const l of this.city.lamps || []) { const k = `${Math.floor(l.x / 20)},${Math.floor(l.z / 20)}`; if (!this._lamps.has(k)) this._lamps.set(k, []); this._lamps.get(k).push(l); }
    }
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const l of this._lamps.get(`${Math.floor(x / 20) + a},${Math.floor(z / 20) + b}`) || []) if (Math.hypot(l.x - x, l.z - z) < r) return true;
    return false;
  }

  // ------------------------------------------------------------ sidewalks
  /** Sidewalk top at (x, z) if a kit sidewalk covers it (for standing things on it), else the ground. */
  walkLevel(x, z) {
    const r = this.L.routeDist(x, z), s = r && this.sOf(r), c = r && this.curbAt(s);
    if (r && r.d > c - .2 && r.d < c + 9) {
      if (s >= this.cfg.fromM && s <= this.cfg.toM && this.L.routeKindAt(s) === 'road') return r.y + ROAD_LIFT + CURB_H;
    }
    for (const o of this.streetsAt(x, z, 7)) if (!o.st.bridge && o.st.cls >= 2 && o.st.cls <= 6 && o.edge > -.2) return o.y + this.lift(o.k) + CURB_H;
    return this.L.heightAt(x, z);
  }
  lift(k) { return .1 + (this.city.streetSlots?.[k] || 0) * .02; }
  /** Is (x, z) on another street's carriageway (a junction or a driveway), not the one we're dressing? */
  crossing(x, z, own = -1, tx = 0, tz = 0) {
    for (const o of this.streetsAt(x, z, .4)) {
      if (o.k === own || o.st.cls === 8) continue;
      if (own < 0 && this.routeStreet(o, tx, tz)) continue;   // the route's own street, drawn under it
      return true;
    }
    return false;
  }
  /** Is a streetsAt() hit the route's own street (runs along it, centreline within 3 m of the route's line)? */
  routeStreet(o, tx, tz) { return Math.abs(o.tx * tx + o.tz * tz) > .8 && this.L.routeDist(o.px, o.pz)?.d < 3; }
  /** How far out from (x, z) along (nx, nz) the first building wall is (up to max), or Infinity. */
  buildingLine(x, z, nx, nz, max) {
    if (this.city.buildingNear(x, z, 0)) return 0;
    let best = Infinity;
    const ex = x + nx * max, ez = z + nz * max, seen = new Set(), G = this.city.buildingGrid;
    for (let gx = Math.floor(Math.min(x, ex) / 40); gx <= Math.floor(Math.max(x, ex) / 40); gx++) for (let gz = Math.floor(Math.min(z, ez) / 40); gz <= Math.floor(Math.max(z, ez) / 40); gz++) {
      for (const b of G.get(`${gx},${gz}`) || []) {
        if (seen.has(b) || b.kind === 12 || b.hidden || b.onRoute || b.crossed) continue;
        seen.add(b);
        if (Math.max(x, ex) < b.bb[0] || Math.min(x, ex) > b.bb[1] || Math.max(z, ez) < b.bb[2] || Math.min(z, ez) > b.bb[3]) continue;
        const r = b.ring;
        for (let i = 0; i < r.length; i++) {
          const p = r[i], q = r[(i + 1) % r.length], qx = q.x - p.x, qz = q.z - p.z, den = nx * qz - nz * qx;
          if (Math.abs(den) < 1e-9) continue;
          const t = ((p.x - x) * qz - (p.z - z) * qx) / den, u = ((p.x - x) * nz - (p.z - z) * nx) / den;
          if (t > 0 && t < best && u >= 0 && u <= 1) best = t;
        }
      }
    }
    return best <= max ? best : Infinity;
  }

  /** Sidewalks of one chunk → the walks builder (a generator: yields every 32 stations); returns the cross-sections. */
  *_walks(W, stations, spots) {
    const L = this.L, city = this.city, out = [];
    // group consecutive stations into strips
    const strips = new Map();
    for (const st of stations) {
      const key = st.route ? `r${st.side}` : `${st.k}:${st.side}`;
      if (!strips.has(key)) strips.set(key, []);
      strips.get(key).push(st);
    }
    for (const [key, list] of strips) {
      list.sort((a, b) => (a.route ? a.s - b.s : a.acc - b.acc));
      let prev = null, n = 0;
      for (let q = 0; q < list.length; q++) {
        const st = list[q];
        if (this._due()) yield 'walks';
        const P = this._station(st);
        if (!P) { prev = null; continue; }
        // [w2-clip] on the inside of a tight bend (or where the building line jumps) an edge steps backwards and the
        // slab would fold back over the last one (two shades of paving at one height: they flicker): hold that edge
        if (prev && Math.hypot(P.ix - prev.ix, P.iz - prev.iz) < 5.5) {
          if ((P.ix - prev.ix) * P.tx + (P.iz - prev.iz) * P.tz < 0) { P.ix = prev.ix; P.iz = prev.iz; }
          if ((P.ox - prev.ox) * P.tx + (P.oz - prev.oz) * P.tz < 0) { P.ox = prev.ox; P.oz = prev.oz; }
        }
        if (prev && Math.hypot(P.ix - prev.ix, P.iz - prev.iz) < 5.5) this._slab(W, prev, P, n++);
        else if (prev) this._endCap(W, prev), this._startCap(W, P);
        else this._startCap(W, P);
        if (!prev && st.route) spots.push({ kind: 'corner', x: P.ix + P.nx * .6, z: P.iz + P.nz * .6, yaw: P.yaw, P, st });
        prev = P; prev.st = st;
        out.push(P);
      }
      if (prev) this._endCap(W, prev);
    }
    return out;
  }

  /** A sidewalk cross-section at a station: inner (curb) and outer edge points, heights, normal; null if none. */
  _station(st) {
    const L = this.L, city = this.city;
    let x, z, y, tx, tz, curb, width = 3, zone = null, own = -1;
    if (st.route) {
      if (this.zoneAt(st.s)?.sidewalks === false) return null;   // [6.6] (F88) a park drive: no sidewalks (Lake Drive)
      const f = this.frame(st.s); x = f.x; z = f.z; y = f.y + ROAD_LIFT; tx = f.tx; tz = f.tz; curb = this.curbAt(st.s);
      // (`clearRouteCrossings`, PLAN 5.9: no sidewalk round the apex of a hairpin — the slabs between stations fan
      // across the road there; Broadway Ave to Coast Ave in Beechview) — on the inside of the turn only: the outside's
      // cross-sections spread apart rather than fan, so it keeps its sidewalk (F79)
      if (this.cfg.clearRouteCrossings) {
        const a = this.frame(st.s - 14), b = this.frame(st.s + 14);
        const inside = (b.tx - a.tx) * (-tz * st.side) + (b.tz - a.tz) * (tx * st.side) > 0;
        if (a.tx * b.tx + a.tz * b.tz < .2 && inside) return null;
      }
      zone = this.zoneAt(st.s); if (zone) width = zone.sidewalkM;
    } else {
      const S = city.streets[st.k], a = S.pts[st.i - 1], b = S.pts[st.i];
      x = a.x + (b.x - a.x) * st.t; z = a.z + (b.z - a.z) * st.t; y = a.y + (b.y - a.y) * st.t + this.lift(st.k);
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1; tx = (b.x - a.x) / l; tz = (b.z - a.z) / l; curb = S.width / 2; own = st.k;
      width = S.cls <= 3 ? 2.5 : 2.2;   // (the city's own sidewalk band: scenery keeps 2.6 m off a carriageway)
    }
    const nx = -tz * st.side, nz = tx * st.side;
    const ix = x + nx * curb, iz = z + nz * curb;
    // up to the building line (a sidewalk runs to the walls), at least 1.6 m
    const line = this.buildingLine(ix, iz, nx, nz, width + 4);
    // to the building line (a sidewalk runs to the walls) along the route; along other streets no wider than their band
    const w = line < Infinity ? (st.route ? Math.max(1.4, line + .4) : Math.max(1.4, Math.min(line + .4, width))) : width;
    const ox = ix + nx * w, oz = iz + nz * w;
    // not across another street, the water, a deck, or into the route's road
    for (const f of [0, .5, 1]) {
      const px = ix + nx * w * f, pz = iz + nz * w * f;
      if (this.crossing(px, pz, own, tx, tz)) return null;
      if ([LAND.water, LAND.pond].includes(L.landAt(px, pz)) || L.bridgeAt(px, pz, 0)) return null;
      if (!st.route) { const r = L.routeDist(px, pz); if (r && r.d < this.curbAt(this.sOf(r)) + .3) return null; }
      // `clearRouteCrossings` (opt-in, PLAN 5.5: the GAP meeting East Waterfront Drive): no sidewalk across another
      // pass of the route — a trail that joins the route's street at a junction (F41: the other areas, after review)
      else if (this.cfg.clearRouteCrossings) { const r = L.routeDist(px, pz), s2 = r && this.sOf(r); if (r && r.d < ROAD_WIDTH / 2 + .3 && Math.abs(s2 - st.s) > 20 && !ghostAt(this.route, s2)) return null; }
    }
    if (line < 1.2) return null;   // a building right at the curb: no room
    const top = y + CURB_H;
    return { ix, iz, ox, oz, nx, nz, tx, tz, y, top, w, curb, yaw: Math.atan2(-nx, -nz), route: !!st.route, zone, line, ground: y - 1.2 };
  }

  _slab(W, a, b, n) {
    W.color(new THREE.Color('#bdb7ab').multiplyScalar(n % 2 ? 1 : .955));   // slab joints every station
    const A0 = V(a.ix, a.top, a.iz), A1 = V(a.ox, a.top, a.oz), B0 = V(b.ix, b.top, b.iz), B1 = V(b.ox, b.top, b.oz);
    face(W, A0, B0, B1, A1, UP);
    // curb face (towards the street)
    W.color('#d3cdc1');
    face(W, V(a.ix, a.y - .05, a.iz), V(b.ix, b.y - .05, b.iz), B0, A0, V(-a.nx, 0, -a.nz));
    // outer skirt down into the ground (hidden by the walls where there are buildings)
    W.color('#9a958b');
    face(W, A1, B1, V(b.ox, Math.min(b.ground, b.top) - .4, b.oz), V(a.ox, Math.min(a.ground, a.top) - .4, a.oz), V(a.nx, 0, a.nz));
  }
  /** The end of a sidewalk run (a junction corner): a curb face across the slab, facing `dir` along the street. */
  _cap(W, P, dir) {
    W.color('#d3cdc1');
    face(W, V(P.ix, P.y - .05, P.iz), V(P.ox, Math.min(P.ground, P.top) - .4, P.oz), V(P.ox, P.top, P.oz), V(P.ix, P.top, P.iz), V(P.tx * dir, 0, P.tz * dir));
  }
  _startCap(W, P) { this._cap(W, P, -1); }
  _endCap(W, P) { this._cap(W, P, 1); }

  /**
   * The route's asphalt between its lanes and the curb (the road ribbon is ROAD_WIDTH wide): a parking lane in zones
   * with parking (a white line 2.4 m out from the curb, and a tick at each 6 m stall), else plain asphalt.
   */
  _parkingLane(W, list) {
    const pts = list.filter((P) => P.route);
    for (let j = 1; j < pts.length; j++) {
      const a = pts[j - 1], b = pts[j];
      if (Math.hypot(b.ix - a.ix, b.iz - a.iz) > 5.5 || a.st.side !== b.st.side) continue;
      const inA = a.curb - (ROAD_WIDTH / 2 - .05), inB = b.curb - (ROAD_WIDTH / 2 - .05);
      const P = (p, d) => V(p.ix - p.nx * d, p.y - .012, p.iz - p.nz * d), Q = (p, d) => V(p.ix - p.nx * d, p.y - .004, p.iz - p.nz * d);
      W.color('#50565a'); face(W, P(a, 0), P(b, 0), P(b, inB), P(a, inA), UP);
      if (!a.zone?.parking || a.curb - ROAD_WIDTH / 2 < 2.2) continue;
      const line = Math.min(2.4, a.curb - ROAD_WIDTH / 2 - .1);
      W.color('#d9d6cc'); face(W, Q(a, line - .06), Q(b, line - .06), Q(b, line + .06), Q(a, line + .06), UP);
      if (Math.floor(a.st.s / 6) !== Math.floor(b.st.s / 6)) face(W, Q(a, .3), Q(a, line), V(a.ix - a.nx * line + a.tx * .1, a.y - .004, a.iz - a.nz * line + a.tz * .1), V(a.ix - a.nx * .3 + a.tx * .1, a.y - .004, a.iz - a.nz * .3 + a.tz * .1), UP);
    }
  }

  // ------------------------------------------------------------ buildings
  /**
   * Called by CityScene._buildChunk for each drawn building, before its walls: decides the building's style and
   * street fronts and returns { winBase, roof } (the window grid's base height, the roof colour), or null to leave
   * it plain. The trim itself is built later with the chunk's other kit work (finishChunk / tick). `B`: the city's
   * building builder for the chunk (aBld), for the bay windows' walls.
   */
  building(b, ring, ground, y0, y1, wall, key, B = null) {
    if (!this.inArea(ring[0].x, ring[0].z)) return null;
    let cx = 0, cz = 0; for (const p of ring) { cx += p.x; cz += p.z; } cx /= ring.length; cz /= ring.length;
    const s = this.routeS(cx, cz);
    if (s == null) return null;
    const zone = this.zoneAt(s, this.routeD(cx, cz));
    const styleKey = zone && (b.kind === 0 || b.kind === 2) ? zone.style : AUTO_STYLE[b.kind];
    const style = FACADE_STYLES[styleKey];
    if (!style) return null;
    const rnd = (n) => hash(b.k * 9973 + n * 131);
    const fronts = this._fronts(b, ring, cx, cz);
    const fh = b.kind === 0 || b.kind === 1 ? 3.1 : b.kind === 5 || b.kind === 6 ? 3.9 : 3.6;
    const H = y1 - ground;
    for (const f of fronts) f.base = Math.max(ground, this.walkLevel(f.mx + f.nx * .8, f.mz + f.nz * .8));
    const shops = H > 5.5 && fronts.length > 0 && rnd(4) < style.store;
    const storeTop = shops ? Math.max(...fronts.map((f) => f.base)) + Math.min(style.storeH, H * .45) : null;
    const winBase = shops ? storeTop - fh : ground;   // upper windows start just above the shop fronts
    const roof = new THREE.Color(style.roof[Math.floor(rnd(3) * style.roof.length)]);
    // bay windows: planned now, their walls drawn straight into the city's building mesh when it's given (B)
    const seed = hash(b.k * 7919 + 13);
    for (const f of fronts) {
      if (style.bays && storeTop && y1 - storeTop > fh * 2 + 1 && f.len > 6 && rnd(10 + f.i) < style.bays) {
        f.bay = this._bayPlan(f, storeTop + .4, Math.min(y1 - .9, storeTop + fh * 2 + .2), b);
        if (B) this._bayWalls(B, f, f.bay, b, seed, winBase, wall);
      }
    }
    let list = this.jobs.get(key); if (!list) this.jobs.set(key, (list = []));
    list.push({ b, ring, cx, cz, ground, y1, style, styleKey, fronts, fh, H, shops, storeTop, winBase, rnd, wall: wall.clone(), baysDrawn: !!B });
    this.stats.buildings++;
    return { winBase, roof, style: styleKey };
  }

  /** The trim of one building: shop fronts, cornices, sills, bays, parapet, rooftop clutter. */
  *_dressBuilding(C, j) {
    const { b, ring, cx, cz, ground, y1, style, fronts, fh, H, shops, storeTop, winBase, rnd } = j;
    const seed = hash(b.k * 7919 + 13);
    const trim = new THREE.Color(style.trim[Math.floor(rnd(1) * style.trim.length)]);
    const frame = new THREE.Color(style.frame[Math.floor(rnd(2) * style.frame.length)]);
    for (const f of fronts) {
      if (this._due()) yield 'building';
      if (shops) this._storefront(C, f, f.base, storeTop, style, frame, trim, b, rnd);
      else if (style.docks && rnd(5) < style.docks && f.len > 8) this._dock(C, f, f.base, frame);
      if (style.belt && storeTop && y1 - storeTop > 2) C.mid.color(trim).band(f.a.x, f.a.z, f.c.x, f.c.z, f.nx, f.nz, .22, storeTop, .28);
      if (style.baseCornice && H > style.baseCornice + 6) C.mid.color(trim).band(f.a.x, f.a.z, f.c.x, f.c.z, f.nx, f.nz, style.cornice.d, f.base + style.baseCornice, .5);
      if (style.cornice && H > 4) this._cornice(C, f, y1, style, trim);
      if (f.bay) { if (!j.baysDrawn) this._bayWalls(C.walls, f, f.bay, b, seed, winBase, j.wall); this._bayCaps(C, f, f.bay, trim); }
      if (style.sills && H > 5) this._sills(C, f, winBase, fh, y1, storeTop, trim);
      if (style.canopy && storeTop && rnd(6) < style.canopy) C.mid.color(frame).band(f.a.x + f.tx * f.len * .2, f.a.z + f.tz * f.len * .2, f.c.x - f.tx * f.len * .2, f.c.z - f.tz * f.len * .2, f.nx, f.nz, 2.4, storeTop - .3, .18);
    }
    if (rnd(7) < style.parapet && H > 4) this._parapet(C, ring, y1, trim, b.kind === 0 ? .55 : .8, fronts, style, rnd, cx, cz);
    this._rooftop(C, b, ring, cx, cz, ground, y1, style, rnd, fronts, j.wall);
  }

  /** Walls facing a street (the route or a city street) within a few metres. */
  _fronts(b, ring, cx, cz) {
    const out = [], L = this.L;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], c = ring[(i + 1) % ring.length], len = Math.hypot(c.x - a.x, c.z - a.z);
      if (len < 3) continue;
      const tx = (c.x - a.x) / len, tz = (c.z - a.z) / len;
      let nx = tz, nz = -tx;
      const mx = (a.x + c.x) / 2, mz = (a.z + c.z) / 2;
      if ((mx - cx) * nx + (mz - cz) * nz < 0) { nx = -nx; nz = -nz; }
      const ox = mx + nx * 3, oz = mz + nz * 3;
      let facing = false;
      const r = this.routeNear(ox, oz) < this.maxCurb + 10 ? L.routeDist(ox, oz) : null;
      if (r && r.d < this.curbAt(this.sOf(r)) + 10 && L.routeKindAt(this.route.dist[this.outbound(r.i)]) === 'road') {
        const back = L.routeDist(mx - nx * 3, mz - nz * 3);
        facing = !back || back.d > r.d;
      }
      if (!facing) for (const o of this.streetsAt(ox, oz, 7)) {
        if (o.st.cls > 6 || o.st.cls < 1) continue;
        if (Math.abs(o.tx * tx + o.tz * tz) < .6) continue;   // runs along the wall, not end-on
        facing = true; break;
      }
      if (facing && this.city.buildingNear(mx + nx * 1.2, mz + nz * 1.2, 0)) facing = false;   // another building against it
      if (facing) out.push({ i, a, c, len, tx, tz, nx, nz, mx, mz, yaw: Math.atan2(nx, nz) });
    }
    return out;
  }

  /**
   * Shop fronts along a wall: units of 5–8 m. Mid detail: the glass (lit at night) and the fascia. Near detail:
   * pilasters, kick plate, transom, door, awnings, blade signs and the shop signs.
   */
  _storefront(C, f, base, top, style, frame, trim, b, rnd) {
    const n = Math.max(1, Math.round(f.len / (style.unitM[0] + (style.unitM[1] - style.unitM[0]) * rnd(20 + f.i))));
    const uw = f.len / n, N = C.near, M = C.mid, h = top - base;
    const at = (u, d) => [f.a.x + f.tx * u + f.nx * d, f.a.z + f.tz * u + f.nz * d];
    const band = (B, u0, u1, d, y, hh) => { const [x0, z0] = at(u0, 0), [x1, z1] = at(u1, 0); B.band(x0, z0, x1, z1, f.nx, f.nz, d, y, hh); };
    for (let k = 0; k < n; k++) {
      const u0 = k * uw, um = u0 + uw / 2, r = hash(b.k * 733 + f.i * 37 + k);
      const unitFrame = r < .5 ? frame : new THREE.Color(style.frame[Math.floor(r * 7) % style.frame.length]);
      // glass, lit warm at night (a quad just proud of the wall)
      M.set({ aGlow: [1] }).color('#2b3640');
      { const [x0, z0] = at(u0 + .35, .05), [x1, z1] = at(u0 + uw - .35, .05); face(M, V(x0, base + .5, z0), V(x1, base + .5, z1), V(x1, base + h - 1.05, z1), V(x0, base + h - 1.05, z0), V(f.nx, 0, f.nz)); }
      M.set({ aGlow: [0] });
      // fascia (the sign band)
      M.color(unitFrame); band(M, u0 + .15, u0 + uw - .15, .2, base + h - .95, .9);
      // near: kick plate, transom, pilasters, door
      N.color(unitFrame); band(N, u0 + .25, u0 + uw - .25, .16, base - .3, .8); band(N, u0 + .25, u0 + uw - .25, .14, base + h - 1.1, .14);
      N.color(trim);
      for (const u of [u0 + .25, u0 + uw - .25]) { const [px, pz] = at(u, .12); N.block(px, base - .3, pz, .5, h - .55 + .3, .24, f.yaw); }
      if (uw > 3.5) { const [dx, dz] = at(u0 + (r > .5 ? .9 : uw - .9), .07); N.color('#1d2226'); face(N, V(dx - f.tx * .48, base, dz - f.tz * .48), V(dx + f.tx * .48, base, dz + f.tz * .48), V(dx + f.tx * .48, base + 2.2, dz + f.tz * .48), V(dx - f.tx * .48, base + 2.2, dz - f.tz * .48), V(f.nx, 0, f.nz)); }
      // the shop's sign: what's mapped there (by kind of shop), else a generic name; neighbours differ
      const label = this.shopLabel(f, um, uw);
      const sw = Math.min(uw - .8, 3.6), [sx, sz] = at(um, .21);
      this._signQuad(C.near, sx, sz, f.nx, f.nz, sw, base + h - .88, base + h - .14, label);
      // an awning over the glass, or a blade sign out over the sidewalk
      // [finish] (not where a lamp post stands under it: the awning or the blade sign would hang through the post)
      const [ax, az] = at(um, .9), lampHere = this.lampNear(ax, az, Math.max(1.4, uw / 2));
      if (r > 1 - style.awning && !lampHere) {
        const col = style.awnings ? new THREE.Color(style.awnings[Math.floor(r * 89) % style.awnings.length])
          : new THREE.Color(SIGN_COLORS[Math.floor(r * 97) % SIGN_COLORS.length][0]).lerp(new THREE.Color('#b33a3a'), r > .9 ? .6 : 0);
        const [a0x, a0z] = at(u0 + .35, .1), [a1x, a1z] = at(u0 + uw - .35, .1), yA = base + h - 1.05;
        // [business pass] (user 26 Nov — "awning and canopy variety"): the shape by shop — a sloped canvas with a
        // straight or scalloped valance, a rounded dome (quarter-round in three slopes), or (masonry and towers) a flat
        // metal canopy whose underside glows at night
        const shape = hash(r * 613 + 11), metal = !style.awnings && shape > .72;
        // a striped canvas (style.stripes of them): ~.45 m stripes, the colour and cream in turn
        const ns = !metal && style.stripes && hash(r * 977 + 3) < style.stripes ? Math.max(3, Math.round((uw - .7) / .45)) : 1, cream = new THREE.Color('#efe9da');
        const lx = (t) => a0x + (a1x - a0x) * t, lz = (t) => a0z + (a1z - a0z) * t;
        if (metal) {
          const d = 1.5, p0 = V(a0x, yA + .1, a0z), p1 = V(a1x, yA + .1, a1z), p2 = V(a1x + f.nx * d, yA + .1, a1z + f.nz * d), p3 = V(a0x + f.nx * d, yA + .1, a0z + f.nz * d);
          N.color('#3c4044'); face(N, p0, p1, p2, p3, UP);
          N.set({ aGlow: [1] }).color('#c9c2b0'); face(N, p0, p1, p2, p3, V(0, -1, 0)); N.set({ aGlow: [0] });
          N.color('#2c2f32'); face(N, p3, p2, V(p2.x, p2.y - .3, p2.z), V(p3.x, p3.y - .3, p3.z), V(f.nx, 0, f.nz));
          for (const t of [0, 1]) N.block(lx(t) + f.nx * d * .5, yA + .32, lz(t) + f.nz * d * .5, .04, .04, d * 1.1, f.yaw);   // the tie rods
        } else {
          const dome = shape > .5, scallop = !dome && shape > .25;
          const prof = dome ? [[0, 0], [.55, -.12], [1, -.42], [1.25, -.95]] : [[0, 0], [1.3, -.65]];
          for (let q = 0; q < ns; q++) {
            N.color(ns > 1 && q % 2 ? cream : col);
            const f0 = q / ns, f1 = (q + 1) / ns;
            for (let j = 0; j + 1 < prof.length; j++) {
              const [da, ya] = prof[j], [db, yb] = prof[j + 1];
              const p0 = V(lx(f0) + f.nx * da, yA + ya, lz(f0) + f.nz * da), p1 = V(lx(f1) + f.nx * da, yA + ya, lz(f1) + f.nz * da);
              const p2 = V(lx(f1) + f.nx * db, yA + yb, lz(f1) + f.nz * db), p3 = V(lx(f0) + f.nx * db, yA + yb, lz(f0) + f.nz * db);
              face(N, p0, p1, p2, p3, UP); face(N, p0, p1, p2, p3, V(0, -1, 0));
            }
            const [de, ye] = prof[prof.length - 1], e0 = V(lx(f0) + f.nx * de, yA + ye, lz(f0) + f.nz * de), e1 = V(lx(f1) + f.nx * de, yA + ye, lz(f1) + f.nz * de);
            if (dome) continue;
            if (scallop) {   // (the valance cut in scallops, ~.3 m each)
              const sc = Math.max(1, Math.round(Math.hypot(e1.x - e0.x, e1.z - e0.z) / .3));
              for (let j = 0; j < sc; j++) {
                const t0 = j / sc, t1 = (j + 1) / sc, tm = (t0 + t1) / 2, P = (t, dy) => V(e0.x + (e1.x - e0.x) * t, e0.y + dy, e0.z + (e1.z - e0.z) * t);
                face(N, P(t0, 0), P(t1, 0), P(t1, -.12), P(t0, -.12), V(f.nx, 0, f.nz));
                N.tri(N.vertex(...P(t0, -.12).toArray(), f.nx, 0, f.nz), N.vertex(...P(t1, -.12).toArray(), f.nx, 0, f.nz), N.vertex(...P(tm, -.27).toArray(), f.nx, 0, f.nz));
              }
            } else face(N, e0, e1, V(e1.x, e1.y - .25, e1.z), V(e0.x, e0.y - .25, e0.z), V(f.nx, 0, f.nz));   // (the valance)
          }
        }
      } else if (r < style.blade && h > 3 && !this.lampNear(...at(u0 + .5, .6), 1.2)) {
        const [bx, bz] = at(u0 + .5, .1), y = base + h + .3;
        N.color('#2a2a2a').block(bx + f.nx * .45, y + 1.25, bz + f.nz * .45, .05, .05, .9, f.yaw);
        const L2 = label;   // the shop's own name on its blade sign
        const cx = bx + f.nx * .55, cz = bz + f.nz * .55;
        this._signQuad(C.near, cx + f.tx * .03, cz + f.tz * .03, f.tx, f.tz, .8, y, y + 1.2, L2);
        this._signQuad(C.near, cx - f.tx * .03, cz - f.tz * .03, -f.tx, -f.tz, .8, y, y + 1.2, L2);
      }
      // [business pass] (user 26 Nov — "sign variety"): lettering on the glass or a small neon in the window (it glows
      // at night like the fascia), and a sandwich board out on the sidewalk by the door of some cafés and shops
      const s2 = hash(r * 431 + 5);
      if (uw > 3.2 && s2 < .45) {
        const [wx, wz] = at(um + (s2 < .2 ? 0 : uw * .22), .07), ww = s2 < .2 ? Math.min(2.2, uw - 1.2) : .9;
        this._signQuad(C.near, wx, wz, f.nx, f.nz, ww, base + 1.5, base + 1.5 + ww * .22, label);
      }
      if (s2 > .82 && !lampHere) {
        const [px, pz] = at(u0 + (r > .5 ? 1.6 : uw - 1.6), 1.25), sb = .6, hb = .95;
        N.color('#3a2f26');
        for (const sgn of [1, -1]) {   // the A-frame's two boards, leaning together
          const bx = px + f.nx * sgn * .14, bz = pz + f.nz * sgn * .14;
          face(N, V(bx - f.tx * sb / 2 + f.nx * sgn * .12, base, bz - f.tz * sb / 2 + f.nz * sgn * .12), V(bx + f.tx * sb / 2 + f.nx * sgn * .12, base, bz + f.tz * sb / 2 + f.nz * sgn * .12),
            V(bx + f.tx * sb / 2, base + hb, bz + f.tz * sb / 2), V(bx - f.tx * sb / 2, base + hb, bz - f.tz * sb / 2), V(f.nx * sgn, .2, f.nz * sgn));
        }
        this._signQuad(C.near, px + f.nx * .22, pz + f.nz * .22, f.nx, f.nz, .5, base + .35, base + .85, label);
      }
    }
  }
  /**
   * The sign for a shop unit centred `um` along front `f` (unit width `uw`). Order-independent and deterministic:
   * the label comes from the unit's position along its street line (2 m steps, from a seeded shuffle of every
   * label), stepped by a number prime to the label count, so units side by side (2–6 steps apart, in the same or
   * the next building) never share a sign. A shop mapped within the unit (OSM) gives its kind: the nearest
   * label of that kind in the shuffle.
   */
  shopLabel(f, um, uw) {
    const n = SHOP_ORDER.length;
    const x = f.a.x + f.tx * um, z = f.a.z + f.tz * um;
    const along = x * f.tx + z * f.tz, across = x * f.nx + z * f.nz;   // the street line: direction and offset
    const line = hash(((Math.round(Math.atan2(f.tx, f.tz) * 6) + 64) * 7919) ^ Math.round(across / 12) * 104729);
    const at = (a) => ((Math.floor(a / 2) * 7 + Math.floor(line * n)) % n + n) % n;
    let i = at(along);
    const shop = this.shopNear(x, z, Math.max(4, uw * .6));   // a mapped shop inside this unit
    const pool = shop && SHOP_LABELS[shop.cat];
    if (pool) {
      const next = [SHOP_ORDER[at(along - uw)], SHOP_ORDER[at(along + uw)]];   // what the units either side show
      for (let k = 0; k < n && (!pool.includes(SHOP_ORDER[i]) || (k < n - 1 && pool.length > 2 && next.includes(SHOP_ORDER[i]))); k++) i = (i + 1) % n;
    }
    return SHOP_ORDER[i];
  }
  /** A textured sign quad centred at (x, z), facing (nx, nz), so its text reads from that side. */
  _signQuad(S, x, z, nx, nz, w, y0, y1, label) {
    const [u0, v0, u1, v1] = this.labelUV(label);
    S.set({ aGlow: [3] }).color('#ffffff');
    const rx = nz, rz = -nx;   // the viewer's right
    S.quad(V(x - rx * w / 2, y0, z - rz * w / 2), V(x + rx * w / 2, y0, z + rz * w / 2), V(x + rx * w / 2, y1, z + rz * w / 2), V(x - rx * w / 2, y1, z - rz * w / 2),
      [u0, v0, u1, v0, u1, v1, u0, v1]);
    S.set({ aGlow: [0] });
  }
  /** Loading doors on industrial fronts. */
  _dock(C, f, base, frame) {
    const n = Math.min(3, Math.floor(f.len / 7));
    for (let k = 0; k < n; k++) {
      const u = f.len * (k + .5) / n, x = f.a.x + f.tx * u + f.nx * .06, z = f.a.z + f.tz * u + f.nz * .06;
      C.mid.color('#8c9094'); face(C.mid, V(x - f.tx * 1.6, base, z - f.tz * 1.6), V(x + f.tx * 1.6, base, z + f.tz * 1.6), V(x + f.tx * 1.6, base + 3.4, z + f.tz * 1.6), V(x - f.tx * 1.6, base + 3.4, z - f.tz * 1.6), V(f.nx, 0, f.nz));
      C.near.color(frame).band(x - f.tx * 1.8, z - f.tz * 1.8, x + f.tx * 1.8, z + f.tz * 1.8, f.nx, f.nz, .3, base + 3.5, .25);
    }
  }
  /** Cornice: a projecting band with a lip, a frieze below; brackets under it (near). */
  _cornice(C, f, top, style, trim) {
    const k = style.cornice, M = C.mid;
    const x0 = f.a.x - f.tx * k.d / 2, z0 = f.a.z - f.tz * k.d / 2, x1 = f.c.x + f.tx * k.d / 2, z1 = f.c.z + f.tz * k.d / 2;
    M.color(trim).band(x0, z0, x1, z1, f.nx, f.nz, k.d, top - k.h, k.h);
    M.band(x0 - f.tx * .05, z0 - f.tz * .05, x1 + f.tx * .05, z1 + f.tz * .05, f.nx, f.nz, k.d + .1, top - .1, .14);
    if (k.frieze) M.color(trim.clone().multiplyScalar(.82)).band(f.a.x, f.a.z, f.c.x, f.c.z, f.nx, f.nz, .06, top - k.h - k.frieze, k.frieze);
    if (k.brackets) {
      const n = Math.max(2, Math.round(f.len / 1.6));
      C.near.color(trim.clone().multiplyScalar(.9));
      for (let j = 0; j <= n; j++) {
        const u = f.len * j / n, bx = f.a.x + f.tx * u + f.nx * k.d * .4, bz = f.a.z + f.tz * u + f.nz * k.d * .4;
        C.near.block(bx, top - k.h - .5, bz, .15, .5, k.d * .8, f.yaw);
      }
    }
  }
  /** Stone sills and lintels at each window row (the building shader's window grid): near detail. */
  _sills(C, f, winBase, fh, top, storeTop, trim) {
    const M = C.near.color(trim), ax = f.a.x + f.tx * .2, az = f.a.z + f.tz * .2, cx = f.c.x - f.tx * .2, cz = f.c.z - f.tz * .2;
    for (let k = 0; ; k++) {
      const yS = winBase + (k + .27) * fh, yH = winBase + (k + .87) * fh;
      if (yH > top - .9) break;
      if (storeTop != null && yS < storeTop + .2) continue;
      M.band(ax, az, cx, cz, f.nx, f.nz, .1, yS - .08, .1);
      M.band(ax, az, cx, cz, f.nx, f.nz, .08, yH, .14);
    }
  }
  /** A canted two-storey bay window's plan on front f: [y0, y1], centre u along the wall, width w, depth d. */
  _bayPlan(f, y0, y1, b) {
    const w = Math.min(3.4, f.len * .45), d = .75, u = f.len / 2 + (hash(b.k * 3 + f.i) - .5) * (f.len - w - 1);
    const at = (uu, dd) => ({ x: f.a.x + f.tx * uu + f.nx * dd, z: f.a.z + f.tz * uu + f.nz * dd });
    return { y0, y1, w, d, u, at, mid: at(u, d * .5) };
  }
  /**
   * The bay's three walls, in a building-material builder (the city's own chunk mesh when CityScene passes it to
   * building(), else the kit's): the building shader draws their windows, and they cost no draw call of their own.
   */
  _bayWalls(B, f, g, b, seed, winBase, wall) {
    const { y0, y1, w, d, u, at, mid } = g, p = [at(u - w / 2, 0), at(u - w / 2 + .6, d), at(u + w / 2 - .6, d), at(u + w / 2, 0)];
    B.set({ aBld: [b.kind + 16 * Math.max(0, Math.round(y1 - winBase)), seed * 100, winBase, 0] }).color(wall);
    for (let k = 0; k < 3; k++) {
      const a = p[k], c = p[k + 1];
      face(B, V(a.x, y0, a.z), V(c.x, y0, c.z), V(c.x, y1, c.z), V(a.x, y1, a.z), V((a.x + c.x) / 2 - mid.x + f.nx * .01, 0, (a.z + c.z) / 2 - mid.z + f.nz * .01));
    }
  }
  /** The bay's trim caps (head and sill), in the facade mesh. */
  _bayCaps(C, f, g, trim) {
    const { y0, y1, w, d, u, at, mid } = g;
    const M = C.mid.color(trim);
    const cap = (y, h, grow) => {
      const q = [at(u - w / 2 - grow, 0), at(u - w / 2 + .6 - grow * .5, d + grow), at(u + w / 2 - .6 + grow * .5, d + grow), at(u + w / 2 + grow, 0)];
      const tp = q.map((v) => V(v.x, y + h, v.z)), bt = q.map((v) => V(v.x, y, v.z));
      face(M, tp[0], tp[1], tp[2], tp[3], UP); face(M, bt[0], bt[1], bt[2], bt[3], V(0, -1, 0));
      for (let k = 0; k < 3; k++) { const ex = (q[k].x + q[k + 1].x) / 2 - mid.x, ez = (q[k].z + q[k + 1].z) / 2 - mid.z; face(M, bt[k], bt[k + 1], tp[k + 1], tp[k], V(ex + f.nx * .01, 0, ez + f.nz * .01)); }
    };
    cap(y1, .3, .12); cap(y0 - .35, .35, .05);
  }
  /** Parapet: the walls carried up past the roof (outer and inner faces) with a coping; a pediment on some fronts. */
  _parapet(C, ring, y1, trim, h, fronts, style, rnd, cx, cz) {
    const M = C.mid, wall = trim.clone().multiplyScalar(.75), coping = trim.clone().lerp(new THREE.Color('#cfc9bb'), .5);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], c = ring[(i + 1) % ring.length], len = Math.hypot(c.x - a.x, c.z - a.z);
      if (len < .5) continue;
      let nx = (c.z - a.z) / len, nz = -(c.x - a.x) / len;
      if (((a.x + c.x) / 2 - cx) * nx + ((a.z + c.z) / 2 - cz) * nz < 0) { nx = -nx; nz = -nz; }
      const ai = V(a.x - nx * .25, 0, a.z - nz * .25), ci = V(c.x - nx * .25, 0, c.z - nz * .25);
      M.color(wall);
      face(M, V(a.x, y1 - .05, a.z), V(c.x, y1 - .05, c.z), V(c.x, y1 + h, c.z), V(a.x, y1 + h, a.z), V(nx, 0, nz));
      face(M, V(ai.x, y1, ai.z), V(ci.x, y1, ci.z), V(ci.x, y1 + h, ci.z), V(ai.x, y1 + h, ai.z), V(-nx, 0, -nz));
      M.color(coping); face(M, V(a.x + nx * .05, y1 + h, a.z + nz * .05), V(c.x + nx * .05, y1 + h, c.z + nz * .05), V(ci.x, y1 + h, ci.z), V(ai.x, y1 + h, ai.z), UP);
      const front = fronts.find((f) => f.i === i);
      if (front && style.pediment && len > 5 && rnd(40 + i) < style.pediment) {   // a raised centre panel on the street front
        const w = Math.min(4.5, len * .4), mx = (a.x + c.x) / 2, mz = (a.z + c.z) / 2, tx = (c.x - a.x) / len, tz = (c.z - a.z) / len;
        M.color(trim).block(mx - nx * .12, y1 + h, mz - nz * .12, w, .9, .3, Math.atan2(nx, nz));
        M.color(coping).band(mx - tx * (w / 2 + .1), mz - tz * (w / 2 + .1), mx + tx * (w / 2 + .1), mz + tz * (w / 2 + .1), nx, nz, .1, y1 + h + .9, .12);
      }
    }
  }

  /** Rooftop clutter at a believable scale: stair heads and water tanks (mid); HVAC, vents, chimneys, skylights (near). */
  _rooftop(C, b, ring, cx, cz, ground, y1, style, rnd, fronts, wall) {
    let area = 0; for (let i = 0; i < ring.length; i++) { const a = ring[i], c = ring[(i + 1) % ring.length]; area += a.x * c.z - c.x * a.z; }
    area = Math.abs(area) / 2;
    if (area < 30) return;
    const inside = (x, z) => {   // distance to the footprint's edge if inside, else 0
      let r = false, dmin = Infinity;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i], c = ring[j];
        if ((a.z > z) !== (c.z > z) && x < ((c.x - a.x) * (z - a.z)) / (c.z - a.z) + a.x) r = !r;
        const dx = c.x - a.x, dz = c.z - a.z, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
        dmin = Math.min(dmin, Math.hypot(a.x + dx * t - x, a.z + dz * t - z));
      }
      return r ? dmin : 0;
    };
    const [x0, x1, z0, z1] = b.bb;
    const spot = (n, clear) => {
      for (let t = 0; t < 8; t++) {
        const x = x0 + (x1 - x0) * hash(b.k * 101 + n * 13 + t), z = z0 + (z1 - z0) * hash(b.k * 103 + n * 17 + t * 7);
        if (inside(x, z) > clear) return [x, z];
      }
      return null;
    };
    const M = C.mid, N = C.near, yaw = fronts[0]?.yaw ?? 0, H = y1 - ground;
    if (H > 9 && area > 120) {   // stair / elevator head on 3+ storey buildings
      const p = spot(1, 2.2);
      if (p) { M.color(wall.clone().multiplyScalar(.9)).block(p[0], y1, p[1], 2.8, 2.7, 3.4, yaw); M.color('#6b6762').block(p[0], y1 + 2.7, p[1], 3.1, .15, 3.7, yaw); }
    }
    const commercial = b.kind !== 0 && b.kind !== 1;
    const units = commercial ? Math.min(4, Math.floor(area / 160) + (rnd(50) < .5 ? 1 : 0)) : rnd(51) < .25 ? 1 : 0;
    for (let k = 0; k < units; k++) {
      const p = spot(10 + k, 1.6); if (!p) continue;
      N.color('#b9bcbd').block(p[0], y1, p[1], 1.3, 1.05, 1.9, yaw);
      N.color('#7f8487').block(p[0], y1 + 1.05, p[1], .9, .08, .9, yaw);
    }
    for (let k = 0; k < (area > 100 ? 2 : 1); k++) { const p = spot(20 + k, .8); if (p) N.color('#5c5f62').block(p[0], y1, p[1], .22, .9, .22, yaw); }
    if (b.kind === 0 && rnd(52) < .55) {
      const p = spot(30, .5);
      if (p) N.color('#6e4334').block(p[0], y1, p[1], .7, 1.4, 1.1, yaw).color('#4d3a32').block(p[0], y1 + 1.4, p[1], .8, .12, 1.2, yaw);
    }
    if (area > 90 && rnd(53) < .4) { const p = spot(40, 1.5); if (p) N.color('#7d93a0').block(p[0], y1, p[1], 1.4, .35, 2.2, yaw); }
    // a small timber water tank on some 4+ storey commercial and industrial roofs (≈ 3 m across)
    if ((b.kind === 2 || b.kind === 3) && H > 13 && area > 200 && rnd(54) < .22) {
      const p = spot(50, 2.2);
      if (p) {
        const r = 1.4, legs = 1.7;
        M.color('#4c4844'); for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) M.block(p[0] + dx * r * .6, y1, p[1] + dz * r * .6, .14, legs, .14);
        M.color('#7d6650').cylinder(p[0], y1 + legs, p[1], r, 2.5, 8, r);
        M.color('#5a4c40').cylinder(p[0], y1 + legs + 2.5, p[1], r + .1, .9, 8, 0);
      }
    }
  }

  // ------------------------------------------------------------ furniture catalogue
  /**
   * Place one piece of street furniture. `kind`: one of FURNITURE; (x, z) on the ground or a sidewalk; yaw: the
   * piece's front (local +z) faces (sin yaw, cos yaw) — towards the street for curbside pieces. Returns false if
   * the spot isn't clear. Public: the junctions module can feed signal poles at its curb corners this way.
   */
  place(C, kind, x, z, yaw, opts = {}) {
    const fn = FURNITURE[kind];
    if (!fn) return false;
    if (kind !== 'treePit' && kind !== 'car' && this.treeNear(x, z, Math.max(.9, LAMP_CLEAR[kind] ?? 0))) return false;   // [finish] not in a street tree's trunk
    if (kind !== 'car' && this.lampNear(x, z, LAMP_CLEAR[kind] ?? .7)) return false;   // [finish] …nor in a lamp post (hydrants every 90 m, pits, masts)
    // [6.1] nothing standing in another street's carriageway (a mapped piece snapped to the wrong curb, a corner sign
    // or bollard at a lane's mouth): its traffic drives through it. (The route's own street keeps the kit's curbs.)
    if (kind !== 'treePit' && kind !== 'car' && this.streetsAt(x, z, -.2).some((o) => o.st.cls < 8 && !(this.L.routeDist(o.px, o.pz)?.d < 3))) return false;
    const y = opts.y ?? this.walkLevel(x, z);
    const M = opts.lod === 'mid' ? C.mid : C.near;
    const f = { x, y, z, yaw, c: Math.cos(yaw), s: Math.sin(yaw) };
    if (kind === 'car' && C.carsHi) {   // [w2-polish] a detailed car and a plain stand-in, each one member (kept or dropped whole)
      for (const [B, draw] of [[C.carsHi, FURNITURE.car], [C.carsLo, carLo]]) { const t0 = B.i.length, m0 = B.members.length; draw(B, f, opts); B.members.length = m0; B.members.push([t0, B.i.length]); }
    } else fn.call(this, M, f, opts);
    this.stats.furniture++;
    return true;
  }
  /**
   * Queue a piece for its chunk (for other modules: junction corners, hand-placed scene data). Best called before
   * the chunk streams in (from a module built in CityScene's constructor); a piece added to a chunk that is already
   * dressed is built on the next tick into a small mesh of its own (one more draw call for that chunk).
   * opts: { y } (default: the sidewalk or ground level there), { arm } for signals, { lod: 'mid' } to keep it to 750 m.
   */
  addFurniture(kind, x, z, yaw, opts = {}) {
    const key = this.key(x, z);
    this.bucket(key).furniture.push({ kind, x, z, yaw, ...opts, given: true });
    if (this._started.has(key)) this._late.add(key);
  }
  /** A signal mast at a junction corner, its arm reaching `arm` metres towards (sin yaw, cos yaw) over the lanes. */
  addSignal(x, z, yaw, arm = 5, opts = {}) { this.addFurniture('signal', x, z, yaw, { arm, ...opts }); }
  /**
   * One junction corner's furniture (the junctions module's entry point):
   *   corner = { x, z, yaw, arm = 5, signal = true, sign = true, button = signal, bollards = 0, y }
   *   (x, z)    the corner's pole spot on the sidewalk, ~0.7 m in from the curb return
   *   yaw       the direction the mast arm reaches (over the approach lanes it controls): (sin yaw, cos yaw)
   *   bollards  posts along the curb return, 1.3 m apart, starting 1.2 m from (x, z) to the mast's right
   */
  addCorner(c) {
    const { x, z, yaw, arm = 5, signal = true, sign = true, button = signal, bollards = 0 } = c, y = c.y != null ? { y: c.y } : {};
    const sx = Math.sin(yaw), cz = Math.cos(yaw), rx = cz, rz = -sx;   // (rx, rz): the mast's right
    if (signal) this.addSignal(x, z, yaw, arm, y);
    if (sign) this.addFurniture('streetSign', x - sx * .45 + rx * .45, z - cz * .45 + rz * .45, yaw, y);
    if (button) this.addFurniture('pushButton', x - rx * 1.1, z - rz * 1.1, yaw, y);
    for (let k = 0; k < bollards; k++) this.addFurniture('bollard', x + rx * (1.2 + k * 1.3), z + rz * (1.2 + k * 1.3), yaw, y);
  }
  /**
   * Hand junction furniture to another module: the kit stops placing its own signal masts (from OSM's mapped
   * signals) and corner street signs. The junctions module calls this, then addCorner() for every corner it builds.
   */
  externalJunctions(on = true) { this.junctionsExternal = on; }
  /** Sidewalk (or ground) level at (x, z): what the junctions module should build its corner pads to. */
  sidewalkTop(x, z) { return this.walkLevel(x, z); }

  /** Is a post-sized thing at (x, z) clear of buildings, carriageways and the route's road? */
  clear(x, z, r = .4) { return !this.lampNear(x, z, r + .3) && this.city._clearSpot(x, z, r, -1, ROAD_WIDTH / 2 + 1.2, r); }

  // ------------------------------------------------------------ chunk assembly
  /**
   * Called at the end of CityScene._buildChunk. The chunk's kit work (trim of the buildings recorded by building(),
   * sidewalks, furniture, car parks, fences) runs now — or, while the app streams (`deferred`), a few milliseconds per
   * frame from tick(), nearest chunk first. Its meshes join `out` (the city's list for the chunk) when done.
   */
  finishChunk(key, out) { drain(this.finishChunkJob(key, out)); }
  /** [F30] finishChunk as a job: not deferred, the chunk's kit work runs now — at once, or in the caller's frame slices. */
  *finishChunkJob(key, out) {
    this._outs.set(key, out);
    const job = { key, out, gen: this._work(key) };
    if (this.deferred) { this.queue.push(job); return; }
    // (all at once outside a slice: _due() is then never true; in one, the kit's own pauses follow the caller's slice)
    for (;;) { this._t0 = clock.deadline - 1.5; if (job.gen.next().done) return; yield; }
  }
  /** Finish every queued chunk now (tools that render one frame or inspect the scene). */
  flush() { this._t0 = Infinity; for (const j of this.queue.splice(0)) while (!j.gen.next().done); }
  /** Has the current step of chunk work used its slice (1.5 ms)? The generators yield when it has. */
  _due() { return performance.now() - this._t0 > 1.5; }

  *_work(key) {
    const C = { key, near: new KitBuilder({ aGlow: 1 }), mid: new KitBuilder({ aGlow: 1 }), walls: new KitBuilder({ aBld: 4 }), walks: new KitBuilder(),
      carsHi: new KitBuilder({ aGlow: 1 }), carsLo: new KitBuilder({ aGlow: 1 }) };   // [w2-polish] parked cars, two LODs
    const jobs = this.jobs.get(key) || [];
    this.jobs.delete(key);
    for (const j of jobs) { yield* this._dressBuilding(C, j); if (this._due()) yield 'building'; }
    const P = this.pending.get(key);
    this.pending.delete(key); this._started.add(key);
    if (P) {
      const sections = yield* this._walks(C.walks, P.stations, []);
      if (this._due()) yield 'walks';
      this._parkingLane(C.walks, sections);
      yield* this._dress(C, sections);
      if (this._due()) yield 'dress';
      for (let q = 0; q < P.furniture.length; q++) { this._osmPiece(C, P.furniture[q]); if (this._due()) yield 'furniture'; }
      for (const ring of P.lots) { yield* this._lot(C, ring); if (this._due()) yield 'lot'; }
      for (const l of P.lines) { this._line(C, l); if (this._due()) yield 'line'; }
      for (const r of P.rails) this._rail(C, r);
      if (this._due()) yield 'rails';
    }
    // [w2-polish] parked cars join the near mesh as [plain cars | furniture | detailed cars]: one draw call, and the
    // LOD pass draws the first two or the last two (geometry draw range) by the camera's distance to the cars
    let carLod = null;
    if (C.carsHi.count) {
      for (const B of [C.near, C.carsHi, C.carsLo]) { yield* this._keepOutOfTube(B); B.tubeDone = true; }
      if (C.carsHi.i.length) { carLod = carBand(C.carsHi); C.near = joinBuilders([C.carsLo, C.near, C.carsHi]); C.near.tubeDone = true; carLod.lo = C.carsLo.i.length; carLod.hi = C.near.i.length - C.carsHi.i.length; carLod.total = C.near.i.length; }
    }
    const parts = [[C.walks, this.walkMaterial, 'Sidewalks · kit', 'walk', false], [C.walls, this.city.buildingMaterial, 'Street kit · bays', 'mid', true],
      [C.mid, this.material, 'Street kit · facades', 'mid', false], [C.near, this.nearMaterial, 'Street kit · furniture', 'near', false]];
    for (const [builder, material, name, lod, shadow] of parts) {
      if (!builder.count) continue;
      if (lod !== 'walk' && !builder.tubeDone) yield* this._keepOutOfTube(builder);
      if (!builder.i.length) continue;
      if (this._due()) yield 'tube';
      const mesh = new THREE.Mesh(this.city.own(releaseAfterUpload(builder.geometry())), material);   // [F399] (setDrawRange only, later)
      mesh.name = `${name} ${key}`; mesh.receiveShadow = true; mesh.castShadow = shadow;
      mesh.userData.bake = false;   // [baked-light] kit pieces stream with the camera (LOD bands): they receive the bake but never trigger a re-bake
      mesh.userData.kitLod = lod; mesh.renderOrder = lod === 'walk' ? 1 : 0;
      if (builder === C.near && carLod) { mesh.userData.carLod = carLod; carLod.on = false; mesh.geometry.setDrawRange(0, carLod.hi); }   // [w2-polish] plain cars until the LOD pass
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      this.city.group.add(mesh);
      (this.city.chunks.get(key) || this._outs.get(key))?.push(mesh);
      this.meshes.push(mesh);
      this.stats.meshes++; this.stats.triangles += builder.i.length / 3;
      if (this._cam) this._lodOne(mesh, this._cam);
      yield 'mesh';
    }
  }

  /** Rule-based furniture along this chunk's sidewalks: hydrants, meters, benches, bins, racks, planters, cars. */
  *_dress(C, sections) {
    const byStrip = new Map();
    for (const P of sections) { const k = P.st.route ? `r${P.st.side}` : `${P.st.k}:${P.st.side}`; if (!byStrip.has(k)) byStrip.set(k, []); byStrip.get(k).push(P); }
    for (const list of byStrip.values()) {
      for (let j = 0; j < list.length; j++) {
        if (this._due()) yield 'dress';
        const P = list[j], st = P.st, pos = st.route ? st.s : st.acc, zone = P.zone;
        const along = (d) => [P.ix + P.nx * d, P.iz + P.nz * d];
        const cell = Math.floor(pos / 3);   // one decision per 3 m station
        const h = hash(cell * 7919 + (st.route ? 17 : st.k * 31) + st.side * 3);
        const room = P.w;
        // parked cars along the route's parking lane (zones with parking), with gaps
        // (cars stay out of the rider's space: centred at least ROAD_WIDTH / 2 + 1.55 m out)
        const back = Math.min(1.15, P.curb - ROAD_WIDTH / 2 - 1.55);
        if (zone?.parking && st.route && cell % 2 === 0 && h < .72 && back > .95) {
          const off = back, [x, z] = [P.ix - P.nx * back, P.iz - P.nz * back];
          const yaw = Math.atan2(P.tx * st.side, P.tz * st.side);
          if (!this.crossing(x, z, -1, P.tx, P.tz) && !this.crossing(x + P.tx * 2.4, z + P.tz * 2.4, -1, P.tx, P.tz) && !this.crossing(x - P.tx * 2.4, z - P.tz * 2.4, -1, P.tx, P.tz)) {
            this.place(C, 'car', x, z, yaw, { y: P.y - .015, seed: h }); this.stats.cars++;
          }
          void off;
        }
        if (room < 1.6) continue;
        const busy = st.route && this.treeAt(st.side, pos);
        if (zone && !busy) {
          if (st.route && cell % 4 === 1 && h < .8) { const [x, z] = along(.45); if (!this.lampNear(x, z, .9)) this.place(C, 'meter', x, z, P.yaw, { y: P.top }); }
          const m = cell % 8;
          if (m === 3 && room > 2.4) { const [x, z] = along(1.1); const kind = ['bench', 'waste', 'bikeRack', 'planter', 'waste', 'bench'][Math.floor(h * 6)]; if (!this.lampNear(x, z, 1.4)) this.place(C, kind, x, z, P.yaw, { y: P.top }); }
        }
        // a hydrant every ~90 m, a street-name sign at each run's start (a corner)
        if (Math.floor(pos / 90) !== Math.floor((pos - 3) / 90) && h < .85) { const [x, z] = along(.55); this.place(C, 'hydrant', x, z, P.yaw, { y: P.top }); }
      }
      // corners: a street sign and two bollards at the first station of each run
      const first = list[0];
      if (first && first.zone && !this.junctionsExternal) {
        const [x, z] = [first.ix + first.nx * .5, first.iz + first.nz * .5];
        this.place(C, 'streetSign', x + first.tx * .8, z + first.tz * .8, first.yaw, { y: first.top });
      }
    }
  }

  /** An OSM-mapped (or given) piece: snap it to the nearest curb and face the street. */
  _osmPiece(C, f) {
    const L = this.L;
    let x = f.x, z = f.z, yaw = f.yaw ?? 0;
    const kindMap = { signal: 'signal', bus_stop: 'busStop', bench: 'bench', hydrant: 'hydrant', bike_rack: 'bikeRack', waste: 'waste', picnic: 'picnic',
      post_box: 'postBox', drinking: 'drinking', bollard: 'bollard', shelter: 'shelter', stop_sign: 'stopSign', bike_share: 'bikeRack' };
    const kind = f.given || f.trail ? f.kind : kindMap[f.kind];
    if (!kind) return;
    if (f.given || f.trail) { if (kind === 'signal' || kind === 'treePit' || this.clear(x, z, f.clearR ?? .3)) this.place(C, kind, x, z, yaw, f); return; }
    // the street it belongs to: the route if close, else the nearest carriageway
    const r = L.routeDist(x, z);
    let tx, tz, nx, nz, curb, cxn, czn;
    if (r && r.d < 16 && L.routeKindAt(this.route.dist[this.outbound(r.i)]) === 'road') {
      const F = this.frame(this.route.dist[this.outbound(r.i)]);
      const side = (x - F.x) * F.rx + (z - F.z) * F.rz > 0 ? 1 : -1;
      tx = F.tx; tz = F.tz; nx = F.rx * side; nz = F.rz * side; curb = this.curbAt(F.s); cxn = F.x; czn = F.z;
    } else {
      const o = this.streetsAt(x, z, 12).filter((q) => !q.st.bridge && q.st.cls < 8).sort((a, b) => a.edge - b.edge)[0];
      if (!o) { if (this.clear(x, z, .4)) this.place(C, kind, x, z, yaw); return; }
      // project onto the street line
      const S = o.st; let best = null;
      for (let i = 1; i < S.pts.length; i++) {
        const a = S.pts[i - 1], b = S.pts[i], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
        const px = a.x + dx * t, pz = a.z + dz * t, d = Math.hypot(px - x, pz - z);
        if (!best || d < best.d) best = { d, px, pz, tx: dx / Math.sqrt(l2), tz: dz / Math.sqrt(l2) };
      }
      tx = best.tx; tz = best.tz; cxn = best.px; czn = best.pz;
      const side = (x - cxn) * -tz + (z - czn) * tx > 0 ? 1 : -1;
      nx = -tz * side; nz = tx * side; curb = S.width / 2;
    }
    const face = Math.atan2(-nx, -nz);   // towards the street
    if (kind === 'signal') return this.junctionsExternal ? undefined : this._signals(C, cxn, czn, tx, tz, curb);
    if (kind === 'stopSign') { const px = cxn + nx * (curb + .5), pz = czn + nz * (curb + .5); if (this.clear(px, pz, .2)) this.place(C, kind, px, pz, face); return; }
    if (kind === 'busStop') {
      const line = this.buildingLine(cxn + nx * curb, czn + nz * curb, nx, nz, 6);
      if (line > 3.4) { const d = curb + 2.2, px = cxn + nx * d, pz = czn + nz * d; if (this.clear(px, pz, 1)) { this.place(C, 'shelter', px, pz, face); } }
      const px = cxn + nx * (curb + .5) + tx * 2.5, pz = czn + nz * (curb + .5) + tz * 2.5;
      if (this.clear(px, pz, .2)) this.place(C, 'busSign', px, pz, face);
      return;
    }
    // curbside pieces: hydrants, bollards, meters at the curb; the rest a little further in, unless mapped well away
    const d0 = Math.hypot(x - cxn, z - czn);
    const want = kind === 'hydrant' || kind === 'bollard' ? curb + .55 : Math.max(curb + 1.1, Math.min(d0, curb + 6));
    x = cxn + nx * want; z = czn + nz * want;
    if (this.clear(x, z, kind === 'picnic' ? 1.2 : .45)) this.place(C, kind, x, z, face);
  }

  /** Signal poles on two opposite corners of a signalised junction, arms reaching over the lanes. */
  _signals(C, x, z, tx, tz, curb) {
    let cross = 5;
    for (const o of this.streetsAt(x, z, 2)) if (Math.abs(o.tx * tx + o.tz * tz) < .7) cross = Math.max(cross, o.st.width / 2);
    for (const side of [1, -1]) {
      const nx = -tz * side, nz = tx * side;
      for (const shift of [cross + 1.6, cross + 3.2, cross + 5]) {
        const px = x + nx * (curb + .7) + tx * shift * side, pz = z + nz * (curb + .7) + tz * shift * side;
        if (!this.clear(px, pz, .3)) continue;
        this.place(C, 'signal', px, pz, Math.atan2(-nx, -nz), { arm: Math.max(3, curb - 1) });
        break;
      }
    }
  }

  // ------------------------------------------------------------ car parks, fences, railings
  /** A surface car park: asphalt draped over the ground, painted stalls, and some parked cars. */
  *_lot(C, ring) {
    const L = this.L, W = C.walks;
    let area = 0; for (let i = 0; i < ring.length; i++) { const a = ring[i], c = ring[(i + 1) % ring.length]; area += a.x * c.z - c.x * a.z; }
    if (Math.abs(area) / 2 < 60 || Math.abs(area) / 2 > 40000) return;
    const contour = ring.map((p) => new THREE.Vector2(p.x, p.z));
    let tris; try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch { return; }
    const level = (x, z) => {
      if ([LAND.water, LAND.pond].includes(L.landAt(x, z)) || this.streetsAt(x, z, .3).some((o) => o.st.cls < 8)) return null;   // not over a street (lots drawn across one)
      const r = L.routeDist(x, z);
      if (r && r.d < ROAD_WIDTH / 2 + 2.2) return null;
      return L.heightAt(x, z) + .07;
    };
    const out = tris.map(([i, j, k]) => [contour[i], contour[j], contour[k]]);   // [w2-clip] (cut along the ground's grid below)
    W.color('#5a5d5f');
    this.stats.lots = (this.stats.lots || 0) + 1;
    // [w2-clip] the asphalt's own height at a point (its triangles, not the ground's): the painted stalls lie on it
    // exactly, instead of on a straight line between their ends that dips into the asphalt where the ground bends
    const drawn = new Map(), cellOf = (x, z) => `${Math.floor(x / 4)},${Math.floor(z / 4)}`;
    const asphaltAt = (x, z) => {
      for (const [a, b, c, ys] of drawn.get(cellOf(x, z)) || []) {
        const d = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y); if (Math.abs(d) < 1e-9) continue;
        const u = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (z - c.y)) / d, v = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (z - c.y)) / d, w = 1 - u - v;
        if (u >= -1e-4 && v >= -1e-4 && w >= -1e-4) return u * ys[0] + v * ys[1] + w * ys[2];
      }
      return null;
    };
    // [w2-clip] the asphalt lies on the ground as drawn: the near ground is a 6 m grid of flat triangles (heights
    // at the grid points, split corner (i+1, j) to (i, j+1)), and between its points it can stand above the true
    // height. Each lot triangle is cut along that grid, so every piece sits 7 cm over one flat ground triangle.
    const G = GROUND_CELL, gh = new Map();
    const gridY = (i, j) => { const k = i * 1e6 + j; let y = gh.get(k); if (y === undefined) gh.set(k, (y = L.heightAt(i * G, j * G))); return y; };
    const meshAt = (x, z) => {
      const i = Math.floor(x / G), j = Math.floor(z / G), fx = x / G - i, fz = z / G - j;
      if (fx + fz <= 1) { const a = gridY(i, j); return a + (gridY(i + 1, j) - a) * fx + (gridY(i, j + 1) - a) * fz; }
      const e = gridY(i + 1, j + 1); return e + (gridY(i, j + 1) - e) * (1 - fx) + (gridY(i + 1, j) - e) * (1 - fz);
    };
    // keep the part of polygon `poly` ([x, z] pairs) on the left of a → b
    const clip = (poly, ax, az, bx, bz) => {
      const o = [], side = (p) => (bx - ax) * (p[1] - az) - (bz - az) * (p[0] - ax);
      for (let q = 0; q < poly.length; q++) {
        const P = poly[q], Q = poly[(q + 1) % poly.length], sp = side(P), sq = side(Q);
        if (sp >= 0) o.push(P);
        if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); o.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]); }
      }
      return o;
    };
    const ccw = (pts) => { let s2 = 0; for (let q = 0; q < pts.length; q++) { const P = pts[q], Q = pts[(q + 1) % pts.length]; s2 += P[0] * Q[1] - Q[0] * P[1]; } return s2 > 0 ? pts : pts.slice().reverse(); };
    for (const [a, b, c] of out) {
      if (this._due()) yield 'lot';
      const tri = ccw([[a.x, a.y], [b.x, b.y], [c.x, c.y]]);
      for (let i = Math.floor(Math.min(a.x, b.x, c.x) / G); i <= Math.floor(Math.max(a.x, b.x, c.x) / G); i++) for (let j = Math.floor(Math.min(a.y, b.y, c.y) / G); j <= Math.floor(Math.max(a.y, b.y, c.y) / G); j++) {
        const x0 = i * G, z0 = j * G, x1 = x0 + G, z1 = z0 + G;
        // the cell's two ground triangles, counter-clockwise in (x, z): (x0,z0)(x1,z0)(x0,z1) and (x1,z0)(x1,z1)(x0,z1)
        for (const g of [[[x0, z0], [x1, z0], [x0, z1]], [[x1, z0], [x1, z1], [x0, z1]]]) {
          let poly = tri;
          for (let q = 0; q < 3 && poly.length >= 3; q++) { const A = g[q], B = g[(q + 1) % 3]; poly = clip(poly, A[0], A[1], B[0], B[1]); }
          if (poly.length < 3) continue;
          let cx = 0, cz = 0; for (const [x, z] of poly) { cx += x / poly.length; cz += z / poly.length; }
          if (level(cx, cz) == null || poly.some(([x, z]) => level(x, z) == null)) { this.stats.lotSkip = (this.stats.lotSkip || 0) + 1; continue; }
          const ys = poly.map(([x, z]) => meshAt(x, z) + .07);
          const ks = poly.map(([x, z], q) => W.vertex(x, ys[q], z, 0, 1, 0));
          for (let q = 1; q + 1 < poly.length; q++) {
            const pa = poly[0], pb = poly[q], pc = poly[q + 1];
            if (Math.abs((pb[0] - pa[0]) * (pc[1] - pa[1]) - (pc[0] - pa[0]) * (pb[1] - pa[1])) < 1e-6) continue;
            W.tri(ks[0], ks[q + 1], ks[q]);   // (counter-clockwise in x, z is clockwise seen from above: face up)
            const A = { x: pa[0], y: pa[1] }, B = { x: pb[0], y: pb[1] }, C2 = { x: pc[0], y: pc[1] }, yy = [ys[0], ys[q], ys[q + 1]];
            this.stats.lotTris = (this.stats.lotTris || 0) + 1;
            for (let gx = Math.floor(Math.min(A.x, B.x, C2.x) / 4); gx <= Math.floor(Math.max(A.x, B.x, C2.x) / 4); gx++) for (let gz = Math.floor(Math.min(A.y, B.y, C2.y) / 4); gz <= Math.floor(Math.max(A.y, B.y, C2.y) / 4); gz++) {
              const k = `${gx},${gz}`; if (!drawn.has(k)) drawn.set(k, []); drawn.get(k).push([A, B, C2, yy]);
            }
          }
        }
      }
    }
    yield 'lot';
    // stalls: rows along the lot's longest edge
    let best = 0, ax = 1, az = 0;
    for (let i = 0; i < ring.length; i++) { const a = ring[i], c = ring[(i + 1) % ring.length], l = Math.hypot(c.x - a.x, c.z - a.z); if (l > best) { best = l; ax = (c.x - a.x) / l; az = (c.z - a.z) / l; } }
    const bx = -az, bz = ax;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of ring) { const u = p.x * ax + p.z * az, v = p.x * bx + p.z * bz; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const inRing = (x, z) => { let r = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], c = ring[j]; if ((a.z > z) !== (c.z > z) && x < ((c.x - a.x) * (z - a.z)) / (c.z - a.z) + a.x) r = !r; } return r; };
    const P = (u, v) => ({ x: ax * u + bx * v, z: az * u + bz * v });
    let cars = 0;
    for (let v = v0 + 1; v + 5 < v1; v += 17) {   // a double row of stalls (2 × 5 m) and a 7 m aisle
      if (this._due()) yield 'lot';
      for (const [vs, dir] of [[v, 1], [v + 10, -1]]) {
        for (let u = u0 + 1.5; u + 2.6 < u1; u += 2.7) {
          const p0 = P(u, vs), p1 = P(u, vs + 5), m = P(u + 1.35, vs + 2.5);
          if (!inRing(p0.x, p0.z) || !inRing(p1.x, p1.z) || !inRing(m.x, m.z) || this.streetsAt(m.x, m.z, 1.6).some((o) => o.st.cls < 8)) continue;
          const y0 = level(p0.x, p0.z), y1 = level(p1.x, p1.z), ym = level(m.x, m.z);
          if (y0 == null || y1 == null || ym == null) continue;
          W.color('#e8e4d8');
          const w = .06;
          for (let q = 0; q < 5; q++) {   // [w2-clip] in 1 m pieces, each end on the asphalt
            const f0 = q / 5, f1 = (q + 1) / 5, x0 = p0.x + (p1.x - p0.x) * f0, z0 = p0.z + (p1.z - p0.z) * f0, x1 = p0.x + (p1.x - p0.x) * f1, z1 = p0.z + (p1.z - p0.z) * f1;
            const h0 = (asphaltAt(x0, z0) ?? y0 + (y1 - y0) * f0) + .012, h1 = (asphaltAt(x1, z1) ?? y0 + (y1 - y0) * f1) + .012;
            face(W, V(x0 - ax * w, h0, z0 - az * w), V(x0 + ax * w, h0, z0 + az * w), V(x1 + ax * w, h1, z1 + az * w), V(x1 - ax * w, h1, z1 - az * w), UP);
          }
          const h = hash(Math.round(m.x * 7) * 31 + Math.round(m.z * 7) * 17);
          if (h < .55 && cars < 45) { this.place(C, 'car', m.x, m.z, Math.atan2(bx * dir, bz * dir), { y: ym, seed: h }); cars++; }   // [finish] at most 45 a lot (was 60: big lots cost a lot of triangles on High)
        }
      }
    }
  }

  _line(C, l) {
    const L = this.L, M = C.mid, pts = l.pts;
    const spec = { fence: ['#5d5f5c', 1.6], wall: ['#a39a88', 1.3], hedge: ['#4f6e35', 1.2], retaining_wall: ['#9b968b', 1.5], guard_rail: ['#a3a7a8', .8], jersey_barrier: ['#c7c2b6', .8] }[l.kind];
    if (!spec) return;
    const [col, h] = spec;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], len = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(len / 3));
      for (let k = 0; k < n; k++) {
        const p = { x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n }, q = { x: a.x + (b.x - a.x) * (k + 1) / n, z: a.z + (b.z - a.z) * (k + 1) / n };
        const mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2;
        if (!this.inArea(mx, mz) || [LAND.water, LAND.pond].includes(L.landAt(mx, mz)) || this.streetsAt(mx, mz, .2).some((o) => o.st.cls < 8)) continue;
        const rd = L.routeDist(mx, mz); if (rd && rd.d < ROAD_WIDTH / 2 + 1.5) continue;
        if (this.city.buildingNear(mx, mz, 0)) continue;
        if (this.lampNear(mx, mz, Math.hypot(q.x - p.x, q.z - p.z) / 2 + .4)) continue;   // [finish] a gap where a lamp post stands
        const yp = L.heightAt(p.x, p.z), yq = L.heightAt(q.x, q.z), sl = len / n;
        const yaw = Math.atan2(q.x - p.x, q.z - p.z);
        if (l.kind === 'fence' || l.kind === 'guard_rail') {
          M.color(col).box(p.x, yp - .2, p.z, .08, h + .2, .08, yaw);
          const top = l.kind === 'fence' ? h - .1 : .6;
          M.beam(V(p.x, yp + top, p.z), V(q.x, yq + top, q.z), l.kind === 'fence' ? .05 : .08, l.kind === 'fence' ? .05 : .3);
          if (l.kind === 'fence') { M.color(new THREE.Color(col).multiplyScalar(1.15)); const nn = V(q.z - p.z, 0, p.x - q.x); face(M, V(p.x, yp, p.z), V(q.x, yq, q.z), V(q.x, yq + top, q.z), V(p.x, yp + top, p.z), nn); face(M, V(p.x, yp, p.z), V(q.x, yq, q.z), V(q.x, yq + top, q.z), V(p.x, yp + top, p.z), nn.clone().negate()); }
        } else {
          const w = l.kind === 'hedge' ? .9 : l.kind === 'jersey_barrier' ? .6 : .35;
          M.color(new THREE.Color(col).multiplyScalar(.92 + hash(k + i * 31) * .12)).box(mx, Math.min(yp, yq) - .3, mz, w, h + .3 + Math.abs(yp - yq) / 2, sl + .05, yaw);
        }
      }
    }
  }

  /** Railings on a river wall's coping, near the route. */
  _rail(C, [ax, az, bx, bz]) {
    const L = this.L, M = C.mid, len = Math.hypot(bx - ax, bz - az);
    if (len < .5) return;
    const tx = (bx - ax) / len, tz = (bz - az) / len;
    let nx = -tz, nz = tx;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    if (this.lampNear(mx, mz, len / 2 + .5)) return;   // [finish] not through a lamp post
    if (L.waterAt(mx + nx * 3, mz + nz * 3) > L.waterAt(mx - nx * 3, mz - nz * 3)) { nx = -nx; nz = -nz; }   // n: inland
    const top = (x, z) => Math.max(L.level + 1, L.baseHeight(x + nx * 1.5, z + nz * 1.5)) + .12;
    const p = { x: ax + nx * .35, z: az + nz * .35 }, q = { x: bx + nx * .35, z: bz + nz * .35 };
    const yp = top(ax, az), yq = top(bx, bz);
    M.color('#3d4347').box(p.x, yp, p.z, .07, 1.1, .07);
    M.beam(V(p.x, yp + 1.05, p.z), V(q.x, yq + 1.05, q.z), .07, .07);
    M.beam(V(p.x, yp + .5, p.z), V(q.x, yq + .5, q.z), .03, .03);
  }

  /**
   * Nothing may stand in the rider's space (landscape.inRouteTube): every piece (a builder member, or a lone
   * triangle) that reaches into it is left out whole. Bounding boxes settle almost all pieces without sampling.
   */
  *_keepOutOfTube(B) {
    const L = this.L, P = B.p, I = B.i, nt = I.length / 3, owner = new Int32Array(nt).fill(-1), R = ROAD_WIDTH / 2 + .6;
    B.members.forEach(([t0, t1], m) => owner.fill(m, t0 / 3, t1 / 3));
    const drop = new Uint8Array(nt);
    const hits = (t0, t1) => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let t = t0; t < t1; t++) for (let v = 0; v < 3; v++) {
        const k = I[t * 3 + v] * 3;
        x0 = Math.min(x0, P[k]); x1 = Math.max(x1, P[k]); y0 = Math.min(y0, P[k + 1]); y1 = Math.max(y1, P[k + 1]); z0 = Math.min(z0, P[k + 2]); z1 = Math.max(z1, P[k + 2]);
      }
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, r = Math.hypot(x1 - x0, z1 - z0) / 2;
      if (this.routeNear(cx, cz) > r + R) return false;
      const rd = L.routeDist(cx, cz);
      if (!rd || rd.d - r > R || y1 < rd.y - .5 || y0 > rd.y + 4.6) return false;
      // close: sample each triangle's corners, edges and face ~0.8 m apart
      for (let t = t0; t < t1; t++) {
        const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
        const len = Math.max(Math.hypot(P[a] - P[b], P[a + 2] - P[b + 2], P[a + 1] - P[b + 1]), Math.hypot(P[b] - P[c], P[b + 2] - P[c + 2], P[b + 1] - P[c + 1]), Math.hypot(P[c] - P[a], P[c + 2] - P[a + 2], P[c + 1] - P[a + 1]));
        const n = Math.min(24, Math.max(1, Math.ceil(len / .8)));
        for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
          const u = i / n, w = j / n, o = 1 - u - w;
          if (L.inRouteTube(P[a] * o + P[b] * u + P[c] * w, P[a + 1] * o + P[b + 1] * u + P[c + 1] * w, P[a + 2] * o + P[b + 2] * u + P[c + 2] * w)) return true;
        }
      }
      return false;
    };
    for (let t = 0, n = 0; t < nt; n++) {
      if (this._due()) yield 'tube';
      const m = owner[t];
      if (m < 0) { if (hits(t, t + 1)) drop[t] = 1; t++; continue; }
      const [t0, t1] = B.members[m];
      if (hits(t0 / 3, t1 / 3)) drop.fill(1, t0 / 3, t1 / 3);
      t = t1 / 3;
    }
    const kept = [];
    for (let t = 0; t < nt; t++) if (!drop[t]) kept.push(I[t * 3], I[t * 3 + 1], I[t * 3 + 2]);
    B.i = kept; B.members = [];
  }

  // ------------------------------------------------------------ per frame: dressing queued chunks, LOD
  tick(camera) {
    this._cam = camera;
    if (this._late.size) { for (const key of this._late) this.finishChunk(key, this._outs.get(key) || []); this._late.clear(); }
    if (this.queue.length) {
      const t0 = performance.now();
      this.queue.sort((a, b) => this._dist(b.key, camera) - this._dist(a.key, camera));
      while (this.queue.length && performance.now() - t0 < this.budgetMs) {
        const j = this.queue[this.queue.length - 1];
        this._t0 = performance.now();
        if (j.gen.next().done) this.queue.pop();
      }
    }
    // LOD every 10 frames, and at once after a jump (a tool or a seek moving the camera: [w2-polish])
    const jump = !this._lodAt || Math.hypot(camera.x - this._lodAt.x, camera.z - this._lodAt.z) > 30;
    if ((this._frame = (this._frame || 0) + 1) % 10 === 0 || jump) { for (const m of this.meshes) this._lodOne(m, camera); this._lodAt = { x: camera.x, z: camera.z }; }
  }
  _dist(key, cam) { const [x, z] = key.split(',').map(Number); return Math.hypot((x + .5) * this.CHUNK - cam.x, (z + .5) * this.CHUNK - cam.z); }
  _lodOne(m, cam) {
    const sph = m.geometry.boundingSphere, k = m.userData.kitLod;
    if (!sph) return;
    const d = Math.hypot(sph.center.x - cam.x, sph.center.z - cam.z) - sph.radius;
    // [finish] sidewalks and car parks too, beyond the mid band (the city's own sidewalk ribbons are under them)
    m.visible = d < (k === 'near' ? this._lod.near : k === 'walk' ? this._lod.mid * 1.2 : this._lod.mid);
    const cl = m.userData.carLod;   // [w2-polish] detailed cars only close to them
    if (cl) { const hi = cl.box.distanceToPoint(cam) < this._lod.carDetail; if (hi !== cl.on) { cl.on = hi; m.geometry.setDrawRange(hi ? cl.lo : 0, hi ? cl.total - cl.lo : cl.hi); } }
  }
  _applyLod(cam) { this._cam = cam; for (const m of this.meshes) this._lodOne(m, cam); }
  setQuality(key) { this._lod = LOD[key] || LOD.balanced; if (this._cam) this._applyLod(this._cam); }
}

// ---------------------------------------------------------------- furniture pieces
// Each draws at frame f = {x, y, z, yaw, c, s} into M; local +z is the piece's front, +x along the street.
const at = (f, dx, dz) => [f.x + dx * f.c + dz * f.s, f.z - dx * f.s + dz * f.c];
function bx(M, f, dx, dy, dz, w, h, l) { const [x, z] = at(f, dx, dz); M.box(x, f.y + dy, z, w, h, l, f.yaw); }
function cy(M, f, dx, dy, dz, r, h, seg = 6, rTop = r) { const [x, z] = at(f, dx, dz); M.cylinder(x, f.y + dy, z, r, h, seg, rTop); }
function bm(M, f, a, b, w, h = w) { const [ax, az] = at(f, a[0], a[2]), [bx2, bz] = at(f, b[0], b[2]); M.beam(V(ax, f.y + a[1], az), V(bx2, f.y + b[1], bz), w, h); }

/** [finish] How far furniture keeps from a street lamp's post (m), by kind; others .7. */
const LAMP_CLEAR = { treePit: 1.1, shelter: 2, bench: 1.2, signal: 1, bikeRack: 1, planter: .9 };

export const FURNITURE = {
  /** A tree pit: a dark iron grate flush with the sidewalk, a stone edge (street trees: CityScene's instanced trees). */
  treePit(M, f) { M.color('#8f897d'); bx(M, f, 0, -.02, 0, 1.5, .03, 1.5); M.color('#2e2b27'); bx(M, f, 0, -.01, 0, 1.25, .03, 1.25); },
  hydrant(M, f) { M.color('#cfa62b'); cy(M, f, 0, -.05, 0, .13, .62, 6); M.color('#b58f22'); cy(M, f, 0, .57, 0, .16, .14, 6, .06); bx(M, f, 0, .32, 0, .44, .1, .1); bx(M, f, 0, .3, .12, .1, .1, .1); },
  bench(M, f) {
    M.color('#3d4a3c'); bx(M, f, -.7, -.05, 0, .07, .5, .45); bx(M, f, .7, -.05, 0, .07, .5, .45);
    M.color('#7a5a3c'); bx(M, f, 0, .44, 0, 1.7, .07, .46); bx(M, f, 0, .55, -.22, 1.7, .42, .06);
  },
  meter(M, f) { M.color('#444a4f'); bx(M, f, 0, -.05, 0, .07, 1.15, .07); M.color('#6d7378'); bx(M, f, 0, 1.08, 0, .2, .32, .16); },
  bikeRack(M, f) {
    M.color('#585e63');
    for (const dx of [-.5, .5]) { bm(M, f, [dx, 0, -.35], [dx, .8, -.35], .05); bm(M, f, [dx, .8, -.35], [dx, .8, .35], .05); bm(M, f, [dx, .8, .35], [dx, 0, .35], .05); }
  },
  planter(M, f) { M.color('#a49d90'); bx(M, f, 0, -.05, 0, .95, .6, .95); M.color('#557a3a'); bx(M, f, 0, .55, 0, .8, .35, .8); M.color('#6d8f45'); bx(M, f, .1, .85, -.05, .5, .25, .5); },
  bollard(M, f) { M.color('#3b3f42'); cy(M, f, 0, -.05, 0, .1, .95, 6); M.color('#c9b33f'); cy(M, f, 0, .75, 0, .105, .06, 6); },
  waste(M, f) { M.color('#2f4a3a'); cy(M, f, 0, -.05, 0, .28, .9, 7); M.color('#263a2e'); cy(M, f, 0, .85, 0, .3, .08, 7, .2); },
  postBox(M, f) { M.color('#1f4f8f'); bx(M, f, 0, .15, 0, .5, .85, .5); bx(M, f, 0, 1, 0, .5, .15, .45); M.color('#2b2b2b'); bx(M, f, 0, -.05, 0, .4, .2, .4); },
  drinking(M, f) { M.color('#5d6266'); bx(M, f, 0, -.05, 0, .35, .95, .35); },
  picnic(M, f) {
    M.color('#8a6a48'); bx(M, f, 0, .72, 0, 1.8, .06, .78); bx(M, f, 0, .42, .62, 1.8, .05, .28); bx(M, f, 0, .42, -.62, 1.8, .05, .28);
    M.color('#6b5238'); for (const dx of [-.7, .7]) { bx(M, f, dx, 0, 0, .08, .72, .08); bx(M, f, dx, .38, 0, .08, .05, 1.5); }
  },
  stopSign(M, f) { M.color('#7a7f83'); bx(M, f, 0, -.05, 0, .06, 2.4, .06); M.color('#b8262b'); bx(M, f, 0, 1.9, .05, .62, .62, .04); M.color('#efe9df'); bx(M, f, 0, 2.15, .075, .4, .1, .01); },
  /** A trail marker: a brown timber post with a sign board facing the trail. */
  trailMarker(M, f) { M.color('#5a4330'); bx(M, f, 0, -.05, 0, .16, 1.5, .16); M.color('#3d5a3f'); bx(M, f, 0, 1.05, .1, .5, .5, .04); M.color('#e9e2cf'); bx(M, f, 0, 1.25, .125, .36, .08, .01); bx(M, f, 0, 1.1, .125, .26, .06, .01); },
  /** A pedestrian push-button post with a walk signal head. */
  pushButton(M, f) { M.color('#3f4448'); bx(M, f, 0, -.05, 0, .09, 2.9, .09); M.color('#2a2d30'); bx(M, f, 0, 2.45, .1, .32, .38, .22); M.set({ aGlow: [2] }).color('#e8e2d0'); bx(M, f, 0, 2.5, .215, .22, .26, .01); M.set({ aGlow: [0] }); M.color('#c9a52b'); bx(M, f, 0, 1.0, .07, .1, .16, .06); },
  streetSign(M, f) {
    M.color('#7a7f83'); bx(M, f, 0, -.05, 0, .07, 3.2, .07);
    M.color('#1f5a3a'); bx(M, f, 0, 2.9, 0, .04, .2, 1.0); bx(M, f, 0, 3.12, 0, 1.0, .2, .04);
  },
  busSign(M, f) { M.color('#7a7f83'); bx(M, f, 0, -.05, 0, .07, 2.7, .07); M.color('#1f4f8f'); bx(M, f, .25, 2.05, 0, .5, .6, .04); M.color('#e9e4d8'); bx(M, f, .25, 2.25, .022, .4, .15, .01); },
  shelter(M, f) {
    M.color('#3a3f44'); for (const dx of [-1.6, 1.6]) for (const dz of [-.7, .55]) bx(M, f, dx, -.05, dz, .08, 2.45, .08);
    bx(M, f, 0, 2.4, -.05, 3.5, .1, 1.6);
    M.set({ aGlow: [.25] }).color('#8fa4ad'); bx(M, f, 0, .25, -.7, 3.2, 1.9, .04); bx(M, f, -1.6, .25, -.1, .04, 1.9, 1.1); M.set({ aGlow: [0] });
    M.color('#5e6469'); bx(M, f, 0, .45, -.45, 2.4, .06, .4);
  },
  /** A signal mast: pole, arm reaching `arm` m forward (over the lanes), two signal heads and a walk signal. */
  signal(M, f, o = {}) {
    const arm = o.arm || 5;
    M.color('#3f4448'); cy(M, f, 0, -.05, 0, .14, 6.5, 6, .11);
    bm(M, f, [0, 5.95, 0], [0, 6.05, arm], .13, .13);
    bm(M, f, [0, 5.2, 0], [0, 5.95, arm * .4], .06, .06);
    for (const t of [.55, .95]) {
      M.color('#c9a52b'); bx(M, f, 0, 4.85, arm * t, .36, 1.05, .3);
      M.set({ aGlow: [2] }).color('#b8322a'); bx(M, f, 0, 5.55, arm * t - .16, .2, .2, .03); M.color('#3aa45a'); bx(M, f, 0, 4.95, arm * t - .16, .2, .2, .03); M.set({ aGlow: [0] });
    }
    M.color('#2a2d30'); bx(M, f, .2, 2.7, 0, .3, .35, .25);
    M.color('#1f5a3a'); bx(M, f, 0, 6.15, arm * .7, .04, .28, 1.3);
  },
  /**
   * A parked car from the figures kit (life/figures/vehicles.js): sedan, hatchback or SUV by seed, paint baked in,
   * the same soft cartoon models as the moving traffic (the plain stand-in, carLo, is 20 triangles); local +z is the front.
   */
  car(M, f, o = {}) {
    const c = pickCar(seededCar(o.seed ?? .5), 'city', 'street');
    appendToMeshBuilder(M, staticCar(c.kind, c.paint, 'lo', { rack: c.rack }), new THREE.Matrix4().makeRotationY(f.yaw).setPosition(f.x, f.y, f.z));
  },
};

/** [w2-polish] The parked car for distance: the same car (pickCar by seed) at the car kit's far LOD (~110 triangles). */
function carLo(M, f, o = {}) {
  const c = pickCar(seededCar(o.seed ?? .5), 'city', 'street');
  appendToMeshBuilder(M, staticCar(c.kind, c.paint, 'far'), new THREE.Matrix4().makeRotationY(f.yaw).setPosition(f.x, f.y, f.z));
}
function seededCar(h) { let x = Math.floor(h * 2147483646) + 1; return () => ((x = (x * 16807) % 2147483647) / 2147483647); }
/** [w2-polish] One builder from several (same attributes), in order. */
function joinBuilders(list) {
  const out = new KitBuilder({ aGlow: 1 });
  for (const B of list) {
    const base = out.count;
    for (const [dst, src] of [[out.p, B.p], [out.n, B.n], [out.c, B.c], [out.uv, B.uv], [out.extra.aGlow.data, B.extra.aGlow.data]]) for (let k = 0; k < src.length; k++) dst.push(src[k]);
    for (let k = 0; k < B.i.length; k++) out.i.push(B.i[k] + base);
  }
  return out;
}
/** [w2-polish] The detailed cars' bounding box, for the LOD pass. */
function carBand(B) {
  const box = new THREE.Box3();
  for (let k = 0; k < B.p.length; k += 3) box.expandByPoint(V(B.p[k], B.p[k + 1], B.p[k + 2]));
  return { box, on: null };
}

/**
 * The street kit's facade dressing on its own, for a city drawn without a route (PGH, js/world/graph-city.js): the
 * shop fronts (glass lit at night, fascia, pilasters, doors, signs, awnings, blade signs), belt courses, cornices
 * with brackets and the sills, in a FACADE_STYLES style, on fronts the caller has found ({ i, a, c, len, tx, tz, nx,
 * nz, mx, mz, yaw, base }). `night`: the night uniform; `lampNear(x, z, r)`: a lamp post there (no awning over it);
 * `glassNight`: a dimmer night uniform for the shop glass.
 *   const F = makeFacadeDresser(night, { lampNear }); const C = F.builders(); F.dress(C, b, fronts, ground, y1, 'victorian');
 *   → C.mid (with F.material), C.near (with F.nearMaterial: the signs)
 */
export function makeFacadeDresser(night, { lampNear = () => false, glassNight = null } = {}) {
  const sk = Object.create(StreetKit.prototype);
  sk.city = { own: (x) => x, night };
  sk._materials();
  sk.walkMaterial.dispose();
  if (glassNight) {   // the glass (and the rest of the mid detail) under its own night level; the signs keep `night`
    const near = sk.nearMaterial; sk.city.night = glassNight; sk.material.dispose(); sk._materials(); sk.walkMaterial.dispose(); sk.nearMaterial.map.dispose(); sk.nearMaterial.dispose(); sk.nearMaterial = near;
  }
  sk.lampNear = lampNear;
  return {
    material: sk.material, nearMaterial: sk.nearMaterial,
    builders: () => ({ near: new KitBuilder({ aGlow: 1 }), mid: new KitBuilder({ aGlow: 1 }) }),
    /** Dress building b's street fronts; returns whether it has shops. */
    dress(C, b, fronts, ground, y1, styleKey) {
      const style = FACADE_STYLES[styleKey]; if (!style || !fronts.length) return false;
      const rnd = (n) => hash(b.k * 9973 + n * 131), H = y1 - ground;
      const fh = b.kind === 0 || b.kind === 1 ? 3.1 : b.kind === 5 ? 3.9 : 3.6;
      const shops = H > 5.5 && rnd(4) < style.store;
      const storeTop = shops ? Math.max(...fronts.map((f) => f.base)) + Math.min(style.storeH, H * 0.45) : null;
      const trim = new THREE.Color(style.trim[Math.floor(rnd(1) * style.trim.length)]), frame = new THREE.Color(style.frame[Math.floor(rnd(2) * style.frame.length)]);
      for (const f of fronts) {
        if (shops) sk._storefront(C, f, f.base, storeTop, style, frame, trim, b, rnd);
        if (style.belt && storeTop && y1 - storeTop > 2) C.mid.color(trim).band(f.a.x, f.a.z, f.c.x, f.c.z, f.nx, f.nz, 0.22, storeTop, 0.28);
        if (style.baseCornice && H > style.baseCornice + 6) C.mid.color(trim).band(f.a.x, f.a.z, f.c.x, f.c.z, f.nx, f.nz, style.cornice.d, f.base + style.baseCornice, 0.5);
        if (style.cornice && H > 4) sk._cornice(C, f, y1, style, trim);
        if (style.sills && H > 5) sk._sills(C, f, ground, fh, y1, storeTop, trim);   // (the facade shader's window rows start at the ground here)
        if (style.canopy && storeTop && rnd(6) < style.canopy) C.mid.color(frame).band(f.a.x + f.tx * f.len * 0.2, f.a.z + f.tz * f.len * 0.2, f.c.x - f.tx * f.len * 0.2, f.c.z - f.tz * f.len * 0.2, f.nx, f.nz, 2.4, storeTop - 0.3, 0.18);
      }
      return shops;
    },
    dispose() { sk.material.dispose(); sk.nearMaterial.map?.dispose(); sk.nearMaterial.dispose(); },
  };
}
