// PGH's city (claude/pgh-assets-plan.md, user 21 Nov: "proceed on all phases"): the Pittsburgh map's buildings, trees
// and street furniture over the whole PGH network, streamed by the graph world's tiles. tools/pgh_city.py makes the
// data with the Pittsburgh map's own extraction (routes/cities/pgh-city.json); this draws it with the Pittsburgh map's
// own builders, through the CityScene stand-in the landmarks already use (js/world/graph-heroes.js):
//   buildings   CityScene._chunkJob — the facade shader (brick, stone, metal, windows lit at night, shop rows), the
//               rooftops — and the building kit (planned sector by sector: the pittsburgh-rowhouse and pittsburgh-frame homes,
//               their porches, steps and yards near the rider)
//   trees       the city's street tree (trunk and lumpy crown, the toolbox foliage shader), on the map's trees, along
//               the streets, in the yards and parks, and as woods on the steep ground the land cover marks
//   furniture   the street kit's pieces (FURNITURE: signals, bus stops and shelters, benches, hydrants, bike racks,
//               bins, bollards, stop signs…) where OSM maps them; the city's street lamps along the urban streets and
//               the riverwalks; car parks with parked cars; parked cars along the main streets; fences, walls,
//               hedges, retaining walls, guard rails and jersey barriers
// and the land cover itself (landAt, a texture for the ground shader) and what each edge is made of (edgeInfo).
//
//   const c = new GraphCity(world, heroes, index); await c.loadLand()   → c.stream(cx, cz, ms) (sectors fetched as the rider nears them), c.tick(cam)
import * as THREE from '../../vendor/three.module.min.js';
import { MeshBuilder, hash } from './toolbox/core/mesh-builder.js';
import { drain, runSlice, due } from './toolbox/core/jobs.js';
import { planBuildingKitJob, makeStreetIndex, dress } from './toolbox/structures/buildings/kit.js';
import { assemble, Writer } from './toolbox/structures/buildings/assemble.js';
import { makeFacadeMaterial } from './toolbox/structures/buildings/facade-material.js';
import { FURNITURE, makeFacadeDresser } from './toolbox/city/street-kit.js';
import { decorateTreeMaterial } from './toolbox/packs/northern-rockies.js';
import { makeAlpsPack } from './toolbox/packs/alps.js';
import { makeNortheastPack } from './toolbox/packs/northeast.js';
import { makeTreeCards } from './toolbox/vegetation/tree-cards.js';

export const LAND = { paved: 0, grass: 1, woods: 2, water: 3, building: 4, sand: 5, plaza: 6, outside: 7, yards: 8 };
const TILE = 400;
// how far the city is built, by quality (Low: phones)
const REACH = { low: { near: 1300, far: 1800, trees: 0.6, treeNear: 450 }, balanced: { near: 2300, far: 3100, trees: 1, treeNear: 750 }, high: { near: 2300, far: 3100, trees: 1.2, treeNear: 900 } };
// the trees: western Pennsylvania's broadleaves (the alps and northeast packs' models), by where they stand; height range m
const TREE_MIX = {
  street: { mix: [['fieldmaple0', 3], ['oak0', 2], ['maple0', 2], ['ash0', 1]], h: [7, 11] },
  yard: { mix: [['maple0', 3], ['maple1', 2], ['oak0', 2], ['ash0', 1], ['walnut0', 1], ['beech0', 1], ['fieldmaple0', 1]], h: [10, 18] },
  woods: { mix: [['oak0', 3], ['maple1', 3], ['beech0', 2], ['beech1', 1], ['ash1', 2], ['walnut0', 1], ['birch0', 1]], h: [15, 24] },
};
const TREE_FULL = { low: 60, balanced: 90, high: 130 }, TREE_LOD = { low: 200, balanced: 300, high: 380 };   // m: full model, then the 84-triangle one, then the 28
const CAR_NEAR = 320;           // m: detailed parked cars within this
const KIT_CFG = { detailM: 150, dressingM: 80, detailReachM: 550,
  styles: [{ preset: 'pittsburgh-rowhouse', kinds: ['rowhouse'] }, { preset: 'pittsburgh-frame', kinds: ['house'] }] };
const ROADS = new Set(['primary', 'secondary', 'tertiary', 'residential', 'alley']);
const MAIN = new Set(['primary', 'secondary', 'tertiary']);
const POINT_FN = { signal: 'signal', bus_stop: 'busSign', bench: 'bench', hydrant: 'hydrant', bike_rack: 'bikeRack', waste: 'waste', picnic: 'picnic',
  post_box: 'postBox', drinking: 'drinking', bollard: 'bollard', shelter: 'shelter', stop_sign: 'stopSign', bike_share: 'bikeRack' };
const u8 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0)).buffer;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

export class GraphCity {
  /** index: routes/cities/pgh-city.json ("bikefree-pgh-city-2"): the edges, the land cover's file, the sectors' list. */
  constructor(world, heroes, index) {
    this.world = world; this.heroes = heroes; this.host = heroes.host; this.index = index;
    const proj = world.proj, host = this.host;
    const [lat0, lon0] = index.origin, U = index.unit;
    this.local = (qa, qo) => proj.toLocal(lat0 + qa * U, lon0 + qo * U);
    this.q = REACH[world.qualityKey] || REACH.balanced;
    this.tiles = new Map(); this.stats = { buildings: 0, trees: 0, furniture: 0, cars: 0, lamps: 0, sectors: 0 };
    this.ready = false;   // (the land cover is in)

    // ---- land cover: its box now, its codes when the file is in (loadLand)
    const L = index.land, nw = proj.toLocal(L.north, L.west), se = proj.toLocal(L.south, L.east);
    this.landBox = { x0: nw.x, z0: nw.z, x1: se.x, z1: se.z, nx: L.nx, ny: L.ny };
    this.land = null; this.landTexture = null;

    // ---- the edges: what they're made of, and a segment grid for "the road near here"
    this.surfaces = index.surfaces || ['asphalt'];
    this.edgeData = index.edges || {};
    this._segGrid = new Map();
    for (const e of world.G.edges) {
      for (let i = 0; i < e.n; i++) {
        const k = `${Math.floor((e.x[i] + e.x[i + 1]) / 2 / 20)},${Math.floor((e.z[i] + e.z[i + 1]) / 2 / 20)}`;
        let a = this._segGrid.get(k); if (!a) this._segGrid.set(k, (a = [])); a.push(e, i);
      }
    }

    // ---- sectors (~1.6 km): fetched as the rider nears them; their buildings join the stand-in's lists
    this.sectors = new Map();   // key → { state: 'loading' | 'planning' | 'ready' | 'failed', job }
    this.buildings = [];
    this.covered = this._landmarkCover();
    this._deckGrid = this._deckIndex();
    host.buildings = this.buildings; host.buildingChunks = new Map(); host.buildingGrid = new Map();
    // a footprint reaching into a way's carriageway (at its level) isn't drawn
    host._onRoute = (b) => {
      const ring = b.ring;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], c = ring[(i + 1) % ring.length], n = Math.max(1, Math.ceil(Math.hypot(c.x - a.x, c.z - a.z) / 2));
        for (let k = 0; k <= n; k++) {
          const x = a.x + (c.x - a.x) * k / n, z = a.z + (c.z - a.z) * k / n, r = this.roadNear(x, z, 0);
          if (r && r.d < r.half - 0.6 && !r.e._deck?.[r.i] && Math.abs(r.y - world._groundH(x, z)) < 4) return true;
        }
      }
      return false;
    };
    host._crossed = () => false;
    host.chunks = new Map(); host.sectors = new Map(); host.streetKit = null;
    this.osmTrees = new Map(); this.points = new Map(); this.lots = new Map(); this.lines = new Map();

    // ---- the building kit, planned sector by sector: the homes' fronts face the nearest PGH way
    const xs = [], zs = [], lines = [];
    for (const e of world.G.edges) {
      const pts = []; for (let i = 0; i <= e.n; i++) { pts.push({ x: e.x[i], z: e.z[i] }); xs.push(e.x[i]); zs.push(e.z[i]); }
      if (!e.bridges.some(([a, b]) => b - a >= e.n - 1)) lines.push({ pts, half: world.wOf(e) / 2 + (world.walkOf(e) || 0) + 1.5 });
    }
    host.index = { xs: Float64Array.from(xs), zs: Float64Array.from(zs), nearest: () => null };
    this.kitStreets = makeStreetIndex(lines);
    this.kitScene = { ...host.route.scene, buildingKit: KIT_CFG };
    this.kit = this._kitAdapter();
    host.buildingKit = this.kit;
    this._materials();
  }

  /** The land cover's codes (a gzipped file of nx × ny bytes): then the ground shader and landAt have them. */
  async loadLand() {
    const res = await fetch(new URL(`../../${this.index.land.file}`, import.meta.url));
    let bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    this.land = bytes;
    const L = this.landBox, tex = new THREE.DataTexture(bytes, L.nx, L.ny, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.unpackAlignment = 1; tex.needsUpdate = true;
    this.landTexture = tex;
    this.ready = true;
  }

  /** The sectors a tile reaches into. */
  _sectorsOf(i, j) {
    const S = this.index.sectors, out = new Set(), proj = this.world.proj;
    for (const [x, z] of [[i * TILE, j * TILE], [(i + 1) * TILE, j * TILE], [i * TILE, (j + 1) * TILE], [(i + 1) * TILE, (j + 1) * TILE]]) {
      const { lat, lon } = proj.toLatLon(x, z), key = `${Math.floor((lat - S.south) / S.dlat)}_${Math.floor((lon - S.west) / S.dlon)}`;
      if (S.list[key] !== undefined) out.add(key);
    }
    return [...out];
  }
  _requestSector(key) {
    if (this.sectors.has(key)) return;
    const st = { state: 'loading', job: null };
    this.sectors.set(key, st);
    fetch(new URL(`../../${this.index.sectors.folder}/s_${key}.json`, import.meta.url)).then((r) => r.json())
      .then((d) => { if (this.disposed) return; st.data = d; st.state = 'decode'; })
      .catch(() => { st.state = 'failed'; });
  }

  /** A sector's data in: its buildings into the lists (hidden under landmarks and decks), its trees and furniture by
   *  tile, and its homes' plan started (a job, run in the stream's slices). */
  _addSector(key, st) {
    const d = st.data, host = this.host;
    const B = d.buildings, h = new Uint16Array(u8(B.h)), mh = new Uint16Array(u8(B.mh)), starts = new Uint32Array(u8(B.starts)), xy = new Int16Array(u8(B.xy));
    const mine = [];
    for (let q = 0; q < B.count; q++) {
      const ring = []; for (let i = starts[q]; i < starts[q + 1]; i++) ring.push(this.local(xy[2 * i], xy[2 * i + 1]));
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, cx = 0, cz = 0;
      for (const p of ring) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); cx += p.x; cz += p.z; }
      cx /= ring.length; cz /= ring.length;
      const b = { k: this.buildings.length, ring, h: h[q] / 10, mh: mh[q] / 10, kind: B.kind[q], name: B.names[q] || '', bb: [x0, x1, z0, z1], cx, cz, sector: key };
      if (this.covered(b) || this._underDeck(b)) b.hidden = true;
      this.buildings.push(b); mine.push(b);
      const tk = `${Math.floor(cx / TILE)},${Math.floor(cz / TILE)}`;
      if (!host.buildingChunks.has(tk)) host.buildingChunks.set(tk, []); host.buildingChunks.get(tk).push(b);
      for (let gx = Math.floor(x0 / 40); gx <= Math.floor(x1 / 40); gx++) for (let gz = Math.floor(z0 / 40); gz <= Math.floor(z1 / 40); gz++) {
        const g = `${gx},${gz}`; if (!host.buildingGrid.has(g)) host.buildingGrid.set(g, []); host.buildingGrid.get(g).push(b);
      }
    }
    const by = (x, z) => `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
    const put = (map, k, v) => { if (!map.has(k)) map.set(k, []); map.get(k).push(v); };
    const T = d.trees ? new Int16Array(u8(d.trees)) : [];
    for (let i = 0; i < T.length; i += 2) { const p = this.local(T[i], T[i + 1]); put(this.osmTrees, by(p.x, p.z), p); }
    const S = this.index.sectors;
    if (d.points?.kind?.length) { const pxy = new Int16Array(u8(d.points.xy)); d.points.kind.forEach((c, i) => { const p = this.local(pxy[2 * i], pxy[2 * i + 1]); put(this.points, by(p.x, p.z), { ...p, kind: S.pointKinds[c] }); }); }
    if (d.lots?.xy) {
      const st2 = new Uint32Array(u8(d.lots.starts)), lxy = new Int16Array(u8(d.lots.xy));
      for (let k = 0; k + 1 < st2.length; k++) {
        const ring = []; for (let i = st2[k]; i < st2[k + 1]; i++) ring.push(this.local(lxy[2 * i], lxy[2 * i + 1]));
        if (ring.length < 3) continue;
        let cx = 0, cz = 0; for (const p of ring) { cx += p.x; cz += p.z; }
        put(this.lots, by(cx / ring.length, cz / ring.length), ring);
      }
    }
    if (d.lines?.kind?.length) {
      const st2 = new Uint32Array(u8(d.lines.starts)), nxy = new Int16Array(u8(d.lines.xy));
      d.lines.kind.forEach((c, k) => {
        const pts = []; for (let i = st2[k]; i < st2[k + 1]; i++) pts.push(this.local(nxy[2 * i], nxy[2 * i + 1]));
        if (pts.length >= 2) put(this.lines, by(pts[pts.length >> 1].x, pts[pts.length >> 1].z), { kind: S.lineKinds[c], pts });
      });
    }
    // the homes' plan: rowhouses and houses (the kit's), the rest as neighbours
    const kinds = { 0: 'rowhouse', 1: 'house' }, homes = [], neighbours = [];
    for (const b of mine) {
      if (b.kind === 12 || b.hidden) continue;
      const pts = b.ring.map((p) => [p.x, p.z]);
      let r = 0; for (const [px, pz] of pts) r = Math.max(r, Math.hypot(px - b.cx, pz - b.cz));
      // a brick row on a main street (East Carson, Butler, Penn…): a shop row, dressed by _storefronts, not a home
      if (b.kind === 0 && b.h >= 6.5 && this._frontsOf(b, b.ring, null, true).length) b.shopRow = true;
      const e = { x: b.cx, z: b.cz, pts, levels: 0, kind: b.shopRow ? 'other' : kinds[b.kind] || 'other', roof: -1, height: b.h, s: 0, r, name: b.name || '', key: b.k };
      (kinds[b.kind] && !b.shopRow ? homes : neighbours).push(e);
    }
    st.job = planBuildingKitJob({ buildings: homes, neighbours }, this.kitScene, this.kitStreets, this.host.index);
    st.state = 'planning'; st.data = null;
    this.stats.sectors++;
  }

  /** The building kit's part of the city chunk builder: the homes it plans (by sector) drawn in place of the boxes. */
  _kitAdapter() {
    const self = this, material = makeFacadeMaterial(this.host.uniforms), group = new THREE.Group();
    group.name = 'Buildings (building kit)'; this.host.group.add(group);
    const plans = new Map(), lists = new Map(), extents = new Map(), details = [];
    const addExt = (e) => { for (let i = Math.floor((e.x - e.r) / 20); i <= Math.floor((e.x + e.r) / 20); i++) for (let j = Math.floor((e.z - e.r) / 20); j <= Math.floor((e.z + e.r) / 20); j++) { const k = i * 100003 + j; let a = extents.get(k); if (!a) extents.set(k, (a = [])); a.push(e); } };
    return {
      group, material, details, plans,
      /** A sector's plan is in: its homes, and what they add outside their footprints (for the trees and lamps). */
      planned(plan) {
        for (const R of plan.buildings) {
          plans.set(R.key, R);
          for (const [k, r] of R.rects.entries()) {
            const front = k === 0 ? R.front : -1, porch = R.parts.frontPorch ? R.parts.frontPorch.depth + 0.3 : R.parts.porch || R.dress ? 1.2 : 0;
            const ea = R.form === 'flat' ? 0.3 : (R.form === 'hip' ? R.eave : R.rake) + 0.2, eb = R.form === 'flat' ? 0.3 : R.eave + 0.2;
            const ext = [eb + (front === 0 ? porch : 0), ea + (front === 1 ? porch : 0), eb + (front === 2 ? porch : 0), ea + (front === 3 ? porch : 0)];
            addExt({ rect: r, ext, x: r.cx, z: r.cz, r: Math.hypot(r.hu, r.hv) + Math.max(...ext) });
          }
          for (const it of R.dressing || []) addExt({ x: it.x, z: it.z, r: Math.max(...it.size.slice(0, 2)) * 0.6 + 0.2, item: true });
        }
      },
      occupied(x, z, pad = 0) {
        for (const e of extents.get(Math.floor(x / 20) * 100003 + Math.floor(z / 20)) || []) {
          if (Math.hypot(e.x - x, e.z - z) > e.r + pad) continue;
          if (e.item) return true;
          const r = e.rect, dx = x - r.cx, dz = z - r.cz, a = dx * r.ux + dz * r.uz, b = dx * r.vx + dz * r.vz;
          if (a > -r.hu - e.ext[3] - pad && a < r.hu + e.ext[1] + pad && b > -r.hv - e.ext[0] - pad && b < r.hv + e.ext[2] + pad) return true;
        }
        return false;
      },
      take(b, key) { const R = plans.get(b.k); if (!R) return false; if (!lists.has(key)) lists.set(key, []); lists.get(key).push(R); return true; },
      *chunkBuiltJob(key) {
        const list = lists.get(key); lists.delete(key);
        if (!list?.length) return;
        const w = new Writer(8192), d = new Writer(4096), L = self.host.landscape;
        for (const R of list) { if (due()) yield; const res = assemble(R, w, d, L); if (R.dressing?.length) for (const it of R.dressing) dress(d, it, R, L, res); }
        if (w.n) { const m = new THREE.Mesh(w.geometry(), material); m.name = `Homes ${key}`; m.castShadow = m.receiveShadow = true; group.add(m); }
        if (d.n) { const dm = new THREE.Mesh(d.geometry(), material); dm.name = `Home detail ${key}`; dm.receiveShadow = true; dm.geometry.computeBoundingBox(); dm.userData.box = dm.geometry.boundingBox; group.add(dm); details.push(dm); }
      },
      tick(cam) { for (const m of details) m.visible = m.userData.box.distanceToPoint(cam) < KIT_CFG.detailReachM; },
    };
  }

  // ------------------------------------------------------------------ queries
  /** Land-cover code at (x, z) (LAND). */
  landAt(x, z) {
    if (!this.land) return LAND.outside;
    const b = this.landBox, i = Math.round((x - b.x0) / (b.x1 - b.x0) * (b.nx - 1)), j = Math.round((z - b.z0) / (b.z1 - b.z0) * (b.ny - 1));
    if (i < 0 || j < 0 || i >= b.nx || j >= b.ny) return LAND.outside;
    return this.land[j * b.nx + i];
  }
  /** What edge e is made of: { surf(i) → name, ow, lanes, walk }. */
  edgeInfo(e) {
    if (e._info) return e._info;
    const d = this.edgeData[e.id] || {}, S = this.surfaces;
    const runs = d.s || null;
    const surf = (i) => { if (!runs) return S[0]; for (const r of runs) if (i >= r[0] && i <= r[1]) return S[r[2]]; return S[0]; };
    return (e._info = { surf, ow: d.ow || 0, lanes: d.lanes || 0, walk: d.walk ?? -1, runs });
  }
  /** The nearest way to (x, z) within r of its edge: { e, i, t, d (from its centre line), half, y, dx, dz, nx, nz } or null. */
  roadNear(x, z, r = 6) {
    let best = null;
    const gx = Math.floor(x / 20), gz = Math.floor(z / 20), w = this.world;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const arr = this._segGrid.get(`${gx + a},${gz + b}`); if (!arr) continue;
      for (let k = 0; k < arr.length; k += 2) {
        const e = arr[k], i = arr[k + 1], ax = e.x[i], az = e.z[i], dx = e.x[i + 1] - ax, dz = e.z[i + 1] - az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
        const half = (w.wOf ? w.wOf(e) : 7) / 2;
        if (d - half > r) continue;
        if (!best || d - half < best.d - best.half) { const l = Math.sqrt(l2); best = { e, i, t, d, half, y: e.ele[i] + (e.ele[i + 1] - e.ele[i]) * t, dx: dx / l, dz: dz / l, px, pz }; }
      }
    }
    return best;
  }
  /** Is (x, z) on a way (within `margin` of its edge)? */
  onRoad(x, z, margin = 0.5) { const r = this.roadNear(x, z, margin); return !!r && r.d < r.half + margin; }
  urban(x, z) { const c = this.landAt(x, z); return c === LAND.paved || c === LAND.yards || c === LAND.building || c === LAND.plaza; }
  inWater(x, z) { const w = this.world; return w._groundH(x, z) < w.poolAt(x, z) + 0.3; }

  // ------------------------------------------------------------------ setup helpers
  /** Footprints the landmarks stand on: the heroes' claimed ones and zones, the PGH landmarks' outlines, the stadiums. */
  _landmarkCover() {
    const rings = [], proj = this.world.proj, hj = this.heroes.json || {};
    for (const b of this.heroes.claimed || []) rings.push(b.ring);
    for (const l of hj.landmarks || []) if (l.ring && l.ring.length >= 4) rings.push(l.ring.map(([a, o]) => proj.toLocal(a, o)));
    for (const s of hj.stadiums || []) if (s.ring) rings.push(s.ring.map(([a, o]) => proj.toLocal(a, o)));
    if (hj.phipps) { const p = hj.phipps.origin, c = proj.toLocal(p.lat, p.lon); rings.push([[-130, -130], [130, -130], [130, 130], [-130, 130]].map(([x, z]) => ({ x: c.x + x, z: c.z + z }))); }
    const boxes = rings.map((r) => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const p of r) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); } return { r, x0, x1, z0, z1 }; });
    const pip = (r, x, z) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c; } return c; };
    const covers = this.heroes.heroes?.covers;
    return (b) => {
      if (covers && covers(b.cx, b.cz, 2)) return true;
      for (const q of boxes) {
        if (b.cx < q.x0 - 4 || b.cx > q.x1 + 4 || b.cz < q.z0 - 4 || b.cz > q.z1 + 4) continue;
        if (pip(q.r, b.cx, b.cz) || q.r.some((p) => pip(b.ring, p.x, p.z))) return true;
      }
      return false;
    };
  }
  _deckIndex() {
    const grid = new Map();
    for (const e of this.world.G.edges) for (const [a, b] of e.bridges) for (let i = a + 1; i < b; i++) {
      const k = `${Math.floor(e.x[i] / 40)},${Math.floor(e.z[i] / 40)}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(e.x[i], e.ele[i], e.z[i]);
    }
    return grid;
  }
  /** A deck (bridge, ramp) running through a footprint within its height: the building isn't drawn. */
  _underDeck(b) {
    const pip = (r, x, z) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], q = r[j]; if ((a.z > z) !== (q.z > z) && x < (q.x - a.x) * (z - a.z) / (q.z - a.z) + a.x) c = !c; } return c; };
    for (let gx = Math.floor(b.bb[0] / 40); gx <= Math.floor(b.bb[1] / 40); gx++) for (let gz = Math.floor(b.bb[2] / 40); gz <= Math.floor(b.bb[3] / 40); gz++) {
      const a = this._deckGrid.get(`${gx},${gz}`); if (!a) continue;
      for (let k = 0; k < a.length; k += 3) {
        if (a[k] < b.bb[0] - 3 || a[k] > b.bb[1] + 3 || a[k + 2] < b.bb[2] - 3 || a[k + 2] > b.bb[3] + 3) continue;
        if (pip(b.ring, a[k], a[k + 2]) && a[k + 1] < this.world._groundH(b.cx, b.cz) + b.h + 1) return true;
      }
    }
    return false;
  }

  _materials() {
    const night = this.host.night;
    // the street kit's material: vertex colour, a glow at night (aGlow: 0 none, (0, 1] warm light, 2 the colour bright)
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.04 });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uNight = night;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float aGlow; varying float vGlow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight; varying float vGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += mix(vec3(1., .78, .5), vColor.rgb * 3., step(1.5, vGlow)) * min(vGlow, 1.) * uNight * 1.4;');
    };
    m.customProgramCacheKey = () => 'pgh-street-kit-1';
    this.kitMaterial = m;
    // the trees: each species in three levels of detail, drawn from pools round the camera (_poolTrees); far tiles: cards
    const packs = { ...makeAlpsPack(), ...makeNortheastPack() };
    this.species = [...new Set(Object.values(TREE_MIX).flatMap((r) => r.mix.map(([n]) => n)))];
    this.treeGeos = this.species.map((n) => { const g = packs[n]; g.computeBoundingBox(); return { name: n, h: g.boundingBox.max.y, tiers: [packs[n], packs[`${n}-lod`], packs[`${n}-far`]] }; });
    for (const k of Object.keys(packs)) if (!this.treeGeos.some((t) => t.tiers.includes(packs[k]))) packs[k].dispose?.();
    for (const r of Object.values(TREE_MIX)) { const t = r.mix.reduce((a, [, w]) => a + w, 0); let c = 0; r.table = r.mix.map(([n, w]) => [this.species.indexOf(n), (c += w / t)]); }
    this.treeTime = { value: 0 };
    this.treeMaterial = decorateTreeMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }), { uTime: this.treeTime });
    this.cards = makeTreeCards({ uTime: this.treeTime });
    this.tints = ['#ffffff', '#f1f6e8', '#e4ecd6', '#fbf3df', '#dfe7d2', '#f6fbef'].map((c) => new THREE.Color(c));
    this.cardGreens = ['#5f8a3e', '#6f9a45', '#557d38', '#7a9b4a', '#4f7434', '#678c40'].map((c) => new THREE.Color(c));
    this.pools = this.treeGeos.map((T) => T.tiers.map((g, tier) => this._pool(g, tier, 256)));
    // the street kit's facade dressing (shop fronts, signs, awnings, cornices, belt courses, sills)
    this.glassNight = { value: 0 };   // (the shop glass: lit, not floodlit; follows the night in tick; the signs: the windows' night)
    this.facades = makeFacadeDresser(this.host.windowNight || night, { glassNight: this.glassNight,
      lampNear: (x, z, r) => { const a = this._lampPts; if (a) for (let k = 0; k < a.length; k += 2) if (Math.hypot(a[k] - x, a[k + 1] - z) < r) return true; return false; } });
    this._poolAt = null;
    // the city's street lamp: pole, arm, head (its lens lit at night)
    const P = new MeshBuilder();
    P.color('#3a3d40'); P.cylinder(0, 0, 0, 0.1, 7.2, 6, 0.07); P.beam(V(0, 7.1, 0), V(0, 7.25, 1.6), 0.1, 0.1);
    P.color('#2e3033'); P.box(0, 6.95, 1.75, 0.5, 0.3, 0.8);
    P.color('#fff4d6'); P.box(0, 6.9, 1.75, 0.36, 0.06, 0.6);
    this.lampGeo = P.geometry();
    // a riverwalk's lamp: a black post and an acorn globe
    const A = new MeshBuilder();
    A.color('#1f2326'); A.cylinder(0, 0, 0, 0.12, 0.5, 8, 0.1); A.cylinder(0, 0.5, 0, 0.07, 3.3, 8, 0.06); A.cylinder(0, 3.8, 0, 0.16, 0.18, 8, 0.12);
    A.color('#fff4d6'); A.cylinder(0, 3.98, 0, 0.2, 0.55, 8, 0.12);
    A.color('#1f2326'); A.cylinder(0, 4.53, 0, 0.14, 0.12, 8, 0.02);
    this.acornGeo = A.geometry();
    const lampMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4 });
    lampMat.onBeforeCompile = (shader) => {
      shader.uniforms.uNight = night;
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += step(.95, vColor.b) * vec3(1., .85, .6) * uNight * 3.;');
    };
    lampMat.customProgramCacheKey = () => 'pgh-lamp-1';
    this.lampMaterial = lampMat;
    this.lotMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  }

  // ------------------------------------------------------------------ streaming
  /** Fetch the sectors near (cx, cz), decode and plan them, then build and release tiles round it, all within `ms`. */
  stream(cx, cz, ms) {
    const t0 = performance.now();
    if (!this.world.ground || !this.ready) return;
    const ci = Math.floor(cx / TILE), cj = Math.floor(cz / TILE), NEAR_M = this.q.near, r = Math.ceil(NEAR_M / TILE), want = [];
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
      const d = Math.hypot((i + 0.5) * TILE - cx, (j + 0.5) * TILE - cz);
      if (d > NEAR_M) continue;
      const key = `${i},${j}`;
      if (this.tiles.get(key)?.built) continue;
      const secs = this._sectorsOf(i, j);
      for (const s of secs) this._requestSector(s);
      want.push({ key, i, j, d, secs });
    }
    want.sort((a, b) => a.d - b.d);
    this.queued = want.length;
    // sectors: decode one that came in, then plan (its homes) in slices
    for (const [key, st] of this.sectors) {
      if (performance.now() - t0 > ms) return;
      if (st.state === 'decode') this._addSector(key, st);
      if (st.state === 'planning') {
        const res = runSlice(st.job, Math.max(0.5, ms - (performance.now() - t0)));
        if (res.done) { this.kit.planned(res.value); st.job = null; st.state = 'ready'; } else return;
      }
    }
    // tiles: one at a time, as a job in frame-sized slices (no hitch on the ride), once its sectors are ready
    while (performance.now() - t0 < ms) {
      if (!this._job) {
        const w = want.find((q) => !this.tiles.get(q.key)?.built && q.secs.every((s) => { const st = this.sectors.get(s); return st && (st.state === 'ready' || st.state === 'failed'); }));
        if (!w) break;
        this._job = this._tileJob(w.key, w.i, w.j);
      }
      const left = ms - (performance.now() - t0);
      if (left <= 0) break;
      if (runSlice(this._job, left).done) this._job = null; else break;
    }
    if ((this._f = (this._f || 0) + 1) % 30 === 0) for (const [key, t] of this.tiles) if (t.built && !t.building && Math.hypot(t.cx - cx, t.cz - cz) > this.q.far) this._release(key, t);
  }
  /** Tiles within r of (x, z) not yet built (the loading screen waits for the start's). */
  pendingNear(x, z, r) {
    if (!this.ready) return 1;
    let n = 0;
    const ci = Math.floor(x / TILE), cj = Math.floor(z / TILE), k = Math.ceil(r / TILE);
    for (let i = ci - k; i <= ci + k; i++) for (let j = cj - k; j <= cj + k; j++) {
      if (Math.hypot((i + 0.5) * TILE - x, (j + 0.5) * TILE - z) > r) continue;
      const t = this.tiles.get(`${i},${j}`); if (!t?.built || t.building) n++;
    }
    return n;
  }

  *_tileJob(key, i, j) {
    const t = { key, i, j, cx: (i + 0.5) * TILE, cz: (j + 0.5) * TILE, built: true, building: true, meshes: [], near: [], far: [] };
    this.tiles.set(key, t);
    const host = this.host, kitGroup = this.kit.group;
    // buildings: the city's chunk builder (and the building kit's homes) for this tile
    if (host.buildingChunks.has(key)) {
      const before = new Set(host.group.children), beforeKit = new Set(kitGroup.children);
      yield* host._chunkJob(key);
      for (const m of host.group.children) if (!before.has(m)) t.meshes.push({ m, parent: host.group });
      for (const m of kitGroup.children) if (!beforeKit.has(m)) t.meshes.push({ m, parent: kitGroup, kit: true });
      this.stats.buildings += host.buildingChunks.get(key).length;
    }
    yield;
    this._trees(t); yield;
    this._furniture(t); yield;
    this._storefronts(t); yield;
    this._lots(t); this._lines(t);
    t.building = false;
  }

  _release(key, t) {
    for (const { m, parent, kit } of t.meshes) {
      parent.remove(m);
      if (m.geometry && !m.userData.shared) m.geometry.dispose();
      if (kit) { const d = this.kit.details.indexOf(m); if (d >= 0) this.kit.details.splice(d, 1); }
    }
    this.host.chunks.delete(key);
    this.tiles.delete(key);
    if (t.trees) this._poolAt = null;
  }

  _add(t, mesh, lod = null) {
    this.host.group.add(mesh);
    t.meshes.push({ m: mesh, parent: this.host.group });
    if (lod === 'near') t.near.push(mesh); else if (lod === 'far') t.far.push(mesh);
  }

  /** LOD: detailed trees and cars near the camera, crowns and plain cars beyond; the kit's near detail. */
  tick(cam, time) {
    this.treeTime.value = time;
    this.glassNight.value = this.host.night.value * 0.05;
    if (!this._poolAt || this._poolAt.distanceTo(cam) > 15) this._poolTrees(cam);
    if ((this._lf = (this._lf || 0) + 1) % 8) return;
    for (const t of this.tiles.values()) {
      const d = Math.hypot(t.cx - cam.x, t.cz - cam.z) - TILE * 0.71;
      for (const m of t.near) m.visible = d < (m.userData.lodM || this.q.treeNear);
      for (const m of t.far) m.visible = d >= (m.userData.lodM || this.q.treeNear);
    }
    this.kit.tick(cam);
  }

  // ------------------------------------------------------------------ trees
  _trees(t) {
    const W = this.world, x0 = t.i * TILE, z0 = t.j * TILE, spots = [];
    const ok = (x, z, wall = 1.4, road = 2) => !this.inWater(x, z) && !this.onRoad(x, z, road) && !this.host.buildingNear(x, z, wall)
      && !this.heroes.heroes?.covers?.(x, z, 2) && !this.kit.occupied(x, z, 0.8) && !this._inDressing(x, z);
    // the map's trees
    for (const p of this.osmTrees.get(t.key) || []) if (ok(p.x, p.z, 1.2, 1.2)) spots.push({ x: p.x, z: p.z, seed: hash(Math.round(p.x * 7 + p.z * 13)) });
    // street trees: every ~15 m along the urban streets, on one side or both, in the sidewalk or the verge
    for (const piece of W.tiles.get(t.key)?.pieces || []) {
      const e = piece.e;
      if (!ROADS.has(e.kind) || e.kind === 'alley') continue;
      const half = W.wOf(e) / 2, info = this.edgeInfo(e), walk = W.walkOf ? W.walkOf(e) : 0;
      for (let i = Math.max(piece.a, 2); i < Math.min(piece.b, e.n - 1); i++) {
        if (e._deck?.[i]) continue;
        const h0 = hash(e.id.length * 977 + i * 131 + e.n);
        if (h0 < 0.35) continue;
        const dx = e.x[i + 1] - e.x[i - 1], dz = e.z[i + 1] - e.z[i - 1], l = Math.hypot(dx, dz) || 1;
        for (const side of [-1, 1]) {
          if (hash(i * 17 + side * 5 + e.n * 3) < (MAIN.has(e.kind) ? 0.35 : 0.55)) continue;
          const off = half + (walk ? walk - 0.9 : 2.6), x = e.x[i] - dz / l * off * side, z = e.z[i] + dx / l * off * side;
          if (!this.urban(x, z) || !ok(x, z, 1.6, 0.9)) continue;
          spots.push({ x, z, seed: hash(i * 7 + side + e.n * 11), role: 'street' });
        }
      }
    }
    // the land cover: woods dense, yards and parks sparse
    const step = 9;
    for (let x = x0 + step / 2; x < x0 + TILE; x += step) for (let z = z0 + step / 2; z < z0 + TILE; z += step) {
      const h1 = hash(Math.round(x * 3.1) * 92821 + Math.round(z * 1.7)), jx = x + (h1 - 0.5) * step * 0.9, jz = z + (hash(Math.round(x * 5.3) + Math.round(z * 7.9) * 31) - 0.5) * step * 0.9;
      const c = this.landAt(jx, jz);
      const p = c === LAND.woods ? 0.85 : c === LAND.outside ? 0.45 : c === LAND.yards ? 0.1 : c === LAND.grass ? 0.06 : c === LAND.paved ? 0.008 : 0;
      if (h1 >= p * this.q.trees) continue;
      if (!ok(jx, jz, 2.2, 3)) continue;
      spots.push({ x: jx, z: jz, seed: hash(Math.round(jx * 11) + Math.round(jz * 13) * 7), wood: c === LAND.woods || c === LAND.outside });
    }
    if (!spots.length) return;
    // each spot's species and size (by where it stands); the tile keeps the list for the pools, and draws cards for far off
    const cards = new THREE.InstancedMesh(this.cards.geometry, this.cards.broadleaf.material, spots.length), m = new THREE.Matrix4(), q = new THREE.Quaternion();
    t.trees = spots.map((s, k) => {
      const R = TREE_MIX[s.role || (s.wood ? 'woods' : 'yard')], r1 = hash(s.seed * 7919 + 1), r2 = hash(s.seed * 104729 + 3);
      let sp = R.table[R.table.length - 1][0]; for (const [i, c] of R.table) if (r1 <= c) { sp = i; break; }
      const H = (R.h[0] + (R.h[1] - R.h[0]) * r2) * (s.wood ? 1 : this.q.trees > 1 ? 1.05 : 1), g = H / this.treeGeos[sp].h;
      const y = W._groundH(s.x, s.z) - 0.1, rot = s.seed * 40, tint = Math.floor(hash(s.seed * 31 + 5) * this.tints.length);
      m.compose(V(s.x, y, s.z), q, V(H * 0.78, H, 1)); cards.setMatrixAt(k, m);
      cards.setColorAt(k, this.cardGreens[Math.floor(s.seed * 997) % this.cardGreens.length]);
      return { x: s.x, y, z: s.z, sp, g, gy: g * (0.92 + r2 * 0.14), rot, tint };
    });
    cards.instanceMatrix.needsUpdate = true; cards.computeBoundingSphere(); cards.userData.shared = true; cards.name = `Tree cards ${t.key}`;
    const d = Math.hypot(t.cx - W.camera.position.x, t.cz - W.camera.position.z) - TILE * 0.71;
    cards.visible = d >= this.q.treeNear;
    this._add(t, cards, 'far');
    this._poolAt = null;   // (the pools take this tile's trees)
    this.stats.trees += spots.length;
  }

  /** One pool: a species at one level of detail, as many instances as the trees near the camera need. */
  _pool(geo, tier, n) {
    const im = new THREE.InstancedMesh(geo, this.treeMaterial, n);
    im.count = 0; im.frustumCulled = false; im.castShadow = tier < 2; im.receiveShadow = true;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.setColorAt(0, this.tints[0]);
    im.name = `Trees ${geo.name || ''} ${['full', 'lod', 'far'][tier]}`;
    this.host.group.add(im);
    return im;
  }
  /** The trees of the tiles within reach, each in its species' pool for its distance: the full model close by, the
   *  simpler ones further out (tiles beyond the reach show their cards). Re-sorted when the camera has moved 15 m. */
  _poolTrees(cam) {
    const fullM = TREE_FULL[this.world.qualityKey] || 90, lodM = TREE_LOD[this.world.qualityKey] || 300;
    const lists = this.pools.map((tiers) => tiers.map(() => []));
    for (const t of this.tiles.values()) {
      if (!t.trees) continue;
      if (Math.hypot(t.cx - cam.x, t.cz - cam.z) - TILE * 0.71 >= this.q.treeNear) continue;
      for (const r of t.trees) { const d = Math.hypot(r.x - cam.x, r.z - cam.z); lists[r.sp][d < fullM ? 0 : d < lodM ? 1 : 2].push(r); }
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = V(0, 1, 0), p = V(0, 0, 0), sc = V(1, 1, 1);
    lists.forEach((tiers, i) => tiers.forEach((list, tier) => {
      let im = this.pools[i][tier];
      if (list.length > im.instanceMatrix.count) {
        this.host.group.remove(im); im.dispose();
        im = this.pools[i][tier] = this._pool(this.treeGeos[i].tiers[tier], tier, Math.ceil(list.length * 1.5));
      }
      list.forEach((r, k) => {
        q.setFromAxisAngle(Y, r.rot); p.set(r.x, r.y, r.z); sc.set(r.g, r.gy, r.g);
        im.setMatrixAt(k, m.compose(p, q, sc)); im.setColorAt(k, this.tints[r.tint]);
      });
      im.count = list.length; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }));
    this._poolAt = cam.clone();
  }
  /** The main streets' buildings dressed as the Pittsburgh map's are: shop fronts with their signs (lit at night),
   *  awnings and blade signs, belt courses, cornices and sills (FACADE_STYLES: the victorian rows on the main streets,
   *  masonry blocks, tower bases, glass). Mid detail to 700 m, near detail (signs, pilasters, brackets) to 260 m. */
  _storefronts(t) {
    const host = this.host, L = host.landscape, C = this.facades.builders();
    this._lampPts = t.lampPts || null;
    let n = 0;
    for (const b of host.buildingChunks.get(t.key) || []) {
      if (b.hidden || b.onRoute || b.hero || b.kind === 12 || this.kit.plans.has(b.k)) continue;
      const style = b.kind === 2 ? (b.h < 22 ? 'victorian' : 'masonry') : b.kind === 0 ? (b.shopRow ? 'victorian' : 'rowhouse') : b.kind === 4 ? 'tower' : b.kind === 5 ? 'glass' : b.kind === 7 || b.kind === 11 ? 'masonry' : null;
      if (!style || b.h < 4) continue;
      let ring = b.ring, area = 0;
      for (let i = 0; i < ring.length; i++) { const a = ring[i], c = ring[(i + 1) % ring.length]; area += a.x * c.z - c.x * a.z; }
      if (area > 0) ring = ring.slice().reverse();
      let ground = Infinity, top = -Infinity;
      for (const p of ring) { const g = L.heightAt(p.x, p.z); ground = Math.min(ground, g); top = Math.max(top, g); }
      const y1 = b.h < 20 ? Math.max(ground + b.h, top + b.h * 0.7) : ground + b.h;
      const fronts = this._frontsOf(b, ring, ground, style === 'rowhouse');
      if (fronts.length && (this.facades.dress(C, b, fronts, ground, y1, style) || style !== 'rowhouse')) n++;
    }
    this._lampPts = null;
    this.stats.storefronts = (this.stats.storefronts || 0) + n;
    for (const [B, mat, m] of [[C.mid, this.facades.material, 700], [C.near, this.facades.nearMaterial, 260]]) {
      if (!B.i.length) continue;
      const mesh = new THREE.Mesh(B.geometry(), mat); mesh.name = `Storefronts ${t.key}`; mesh.receiveShadow = true; mesh.castShadow = m > 300;
      mesh.userData.lodM = m;
      const d = Math.hypot(t.cx - this.world.camera.position.x, t.cz - this.world.camera.position.z) - TILE * 0.71;
      mesh.visible = d < m;
      this._add(t, mesh, 'near');
    }
  }
  /** Building b's walls facing a street (main streets only: `main`) within its sidewalk and a few metres:
   *  [{ i, a, c, len, tx, tz, nx, nz, mx, mz, yaw, base (the sidewalk's level there) }]. `ring` wound clockwise. */
  _frontsOf(b, ring, ground, main) {
    const out = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], c = ring[(i + 1) % ring.length], len = Math.hypot(c.x - a.x, c.z - a.z);
      if (len < 4) continue;
      const tx = (c.x - a.x) / len, tz = (c.z - a.z) / len, mx = (a.x + c.x) / 2, mz = (a.z + c.z) / 2;
      let nx = tz, nz = -tx; if ((mx - b.cx) * nx + (mz - b.cz) * nz < 0) { nx = -nx; nz = -nz; }
      const r = this.roadNear(mx + nx * 3, mz + nz * 3, 6);
      if (!r || !ROADS.has(r.e.kind) || r.e.kind === 'alley' || r.e._deck?.[r.i] || (main && !MAIN.has(r.e.kind))) continue;
      const walk = this.world.walkOf ? this.world.walkOf(r.e) : 0;
      if (Math.hypot(mx - r.px, mz - r.pz) - r.half > walk + 4 || Math.abs(r.dx * tx + r.dz * tz) < 0.6 || (ground != null && Math.abs(r.y - ground) > 4)) continue;
      if (this.host.buildingNear(mx + nx * 1.2, mz + nz * 1.2, 0)) continue;
      out.push({ i, a, c, len, tx, tz, nx, nz, mx, mz, yaw: Math.atan2(nx, nz), base: walk && ground != null ? Math.max(ground, r.y + 0.15) : ground });
    }
    return out;
  }
  /** Inside the dressed Point (its own lawns and trees)? */
  _inDressing(x, z) { const D = this.world.dressing; return !!D && !!D.inside?.(x, z); }

  // ------------------------------------------------------------------ furniture, lamps, parked cars
  _furniture(t) {
    const W = this.world, M = new MeshBuilder({ aGlow: 1 }), Mc = new MeshBuilder({ aGlow: 1 }), Mf = new MeshBuilder({ aGlow: 1 });
    const lamps = [], acorns = [], glows = [];
    const frame = (x, y, z, yaw) => ({ x, y, z, yaw, c: Math.cos(yaw), s: Math.sin(yaw) });
    // OSM's furniture: off the carriageway (a signal mapped on the road goes to the corner), facing the road
    for (const p of this.points.get(t.key) || []) {
      const fn = FURNITURE[POINT_FN[p.kind]]; if (!fn) continue;
      let { x, z } = p;
      const r = this.roadNear(x, z, 8);
      let yaw = 0, y;
      if (r) {
        const nx = -r.dz, nz = r.dx, side = Math.sign((x - r.px) * nx + (z - r.pz) * nz) || 1;
        const edge = r.half + (W.walkOf ? Math.min(W.walkOf(r.e), 1.6) : 0) + 0.7;
        if (r.d < edge) { x = r.px + nx * side * edge; z = r.pz + nz * side * edge; }
        yaw = Math.atan2(-nx * side, -nz * side);   // +z (the piece's front) towards the road
        y = (W.walkOf && W.walkOf(r.e) && r.d < r.half + W.walkOf(r.e) + 1) ? r.y + 0.15 : W._groundH(x, z);
        if (this.onRoad(x, z, 0.2) && !(r.d >= r.half)) continue;
      } else y = W._groundH(x, z);
      if (this.inWater(x, z) || this.host.buildingNear(x, z, 0.3)) continue;
      fn(M, frame(x, y, z, yaw), { arm: r ? Math.min(6, r.half + 1.5) : 4 });
      this.stats.furniture++;
    }
    // along the urban streets: lamps every ~32 m, alternating sides; parked cars on the main streets
    for (const piece of W.tiles.get(t.key)?.pieces || []) {
      const e = piece.e, half = W.wOf(e) / 2, walk = W.walkOf ? W.walkOf(e) : 0;
      const riverwalk = W.isRiverwalk?.(e);
      if (!ROADS.has(e.kind) && !riverwalk) continue;
      for (let i = Math.max(piece.a, 1); i < Math.min(piece.b, e.n); i++) {
        const dx = e.x[i + 1] - e.x[i - 1], dz = e.z[i + 1] - e.z[i - 1], l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
        const deck = e._deck?.[i];
        const nearEnd = i < 2 || i > e.n - 2;
        // lamps
        if (riverwalk ? i % 3 === 0 : (i % 3 === 0 && (walk || this.urban(e.x[i], e.z[i])) && e.kind !== 'alley')) {
          const side = riverwalk ? 1 : ((i / 3) % 2 ? 1 : -1), off = half + (riverwalk ? 0.6 : walk ? walk - 0.5 : 1.2);
          const x = e.x[i] + nx * off * side, z = e.z[i] + nz * off * side;
          if (!this.onRoad(x, z, 0.3) && !this.host.buildingNear(x, z, 0.6) && !this.inWater(x, z) && !deck) {
            const y = walk && !riverwalk ? e.ele[i] + 0.15 : Math.min(W._groundH(x, z), e.ele[i]);
            (riverwalk ? acorns : lamps).push({ x, y, z, yaw: Math.atan2(-nx * side, -nz * side) });
            (t.lampPts ||= []).push(x, z);
          }
        }
        // parked cars: main streets with sidewalks, both sides (one side on a one-way), away from junctions and decks
        if (MAIN.has(e.kind) && walk && !deck && !nearEnd && i % 2 === 0 && half >= 4.2) {
          const ow = this.edgeInfo(e).ow;
          for (const side of ow ? [ow > 0 ? 1 : -1] : [-1, 1]) {
            for (const f of [0.15, 0.8]) {
              const h0 = hash(i * 31 + side * 7 + f * 100 + e.n * 13);
              if (h0 < 0.45) continue;
              const k0 = i, k1 = i + 1, x = e.x[k0] + (e.x[k1] - e.x[k0]) * f + nx * (half - 1.15) * side, z = e.z[k0] + (e.z[k1] - e.z[k0]) * f + nz * (half - 1.15) * side;
              const y = e.ele[k0] + (e.ele[k1] - e.ele[k0]) * f + 0.02;
              const yaw = Math.atan2(dx * side, dz * side);
              FURNITURE.car(Mc, frame(x, y, z, yaw), { seed: h0 });
              carLo(Mf, frame(x, y, z, yaw), h0);
              this.stats.cars++;
            }
          }
        }
      }
    }
    // along the river walls' promenades: acorn lamps every ~30 m and benches facing the water
    {
      const x0 = t.i * TILE, z0 = t.j * TILE;
      for (const Ln of W.shore ? W.shore.lines : []) {
        let acc = 0;
        for (let i = 0; i + 1 < Ln.n; i++) {
          const seg = Math.hypot(Ln.x[i + 1] - Ln.x[i], Ln.z[i + 1] - Ln.z[i]);
          if (!(Ln.walled[i] && Ln.walled[i + 1])) { acc = 0; continue; }
          acc += seg;
          const mx = Ln.x[i], mz = Ln.z[i];
          if (mx < x0 || mx >= x0 + TILE || mz < z0 || mz >= z0 + TILE) continue;
          if (W.dressing?.inside?.(mx, mz)) continue;
          const nx = Ln.nx[i], nz = Ln.nz[i], top = Ln.top[i] + 0.03;
          if (acc > 30) {
            acc = 0;
            const x = mx + nx * 1.1, z = mz + nz * 1.1;
            if (!this.onRoad(x, z, 0.4)) acorns.push({ x, y: top, z, yaw: 0 });
            const bx = mx + nx * 2.6 + (Ln.x[i + 1] - mx) * 0.5, bz = mz + nz * 2.6 + (Ln.z[i + 1] - mz) * 0.5;
            if (hash(i * 13 + Ln.n) < 0.6 && !this.onRoad(bx, bz, 1)) { FURNITURE.bench(M, frame(bx, top, bz, Math.atan2(-nx, -nz))); this.stats.furniture++; }
          }
        }
      }
    }
    // a car park's cars (in the lots of this tile)
    for (const ring of this.lots.get(t.key) || []) this._lotCars(ring, Mc, Mf, frame);
    const mesh = (B, name, lod) => {
      if (!B.count) return;
      const g = B.geometry(); const m = new THREE.Mesh(g, this.kitMaterial); m.name = `${name} ${t.key}`; m.castShadow = true; m.receiveShadow = true;
      if (lod) m.userData.lodM = CAR_NEAR;
      const d = Math.hypot(t.cx - W.camera.position.x, t.cz - W.camera.position.z) - TILE * 0.71;
      if (lod === 'near') m.visible = d < CAR_NEAR; else if (lod === 'far') m.visible = d >= CAR_NEAR;
      this._add(t, m, lod);
    };
    mesh(M, 'Street furniture'); mesh(Mc, 'Parked cars', 'near'); mesh(Mf, 'Parked cars far', 'far');
    const lampMesh = (list, geo, name, head) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, this.lampMaterial, list.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
      list.forEach((l, k) => { q.setFromAxisAngle(V(0, 1, 0), l.yaw); im.setMatrixAt(k, m4.compose(V(l.x, l.y - 0.1, l.z), q, V(1, 1, 1))); glows.push({ ...V(...head).applyQuaternion(q).add(V(l.x, l.y, l.z)), size: name === 'Lamps' ? 4.2 : 2.6, color: '#ffc880' }); });
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.userData.shared = true; im.castShadow = true; im.name = `${name} ${t.key}`;
      this._add(t, im);
      this.stats.lamps += list.length;
    };
    lampMesh(lamps, this.lampGeo, 'Lamps', [0, 6.85, 1.75]);
    lampMesh(acorns, this.acornGeo, 'Riverwalk lamps', [0, 4.25, 0]);
    if (glows.length) { const g = this.host.addGlows(glows, `Lamp glows ${t.key}`); if (g) t.meshes.push({ m: g, parent: this.host.group }); }
  }

  _lotCars(ring, Mc, Mf, frame) {
    // rows along the lot's longest side, 2.7 m stalls, 5.5 m rows, ~55% taken
    let best = 0, ux = 1, uz = 0;
    for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length], l = Math.hypot(b.x - a.x, b.z - a.z); if (l > best) { best = l; ux = (b.x - a.x) / l; uz = (b.z - a.z) / l; } }
    const vx = -uz, vz = ux;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of ring) { const a = p.x * ux + p.z * uz, b = p.x * vx + p.z * vz; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
    if ((a1 - a0) * (b1 - b0) > 60000) return;   // (a huge lot: leave it to the paving)
    const pip = (x, z) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c; } return c; };
    const W = this.world;
    for (let b = b0 + 3; b < b1 - 2.5; b += 6.2) for (let a = a0 + 2; a < a1 - 1.5; a += 2.7) {
      const x = ux * a + vx * b, z = uz * a + vz * b, h0 = hash(Math.round(x * 3) * 7919 + Math.round(z * 3));
      if (h0 > 0.55) continue;
      // the car's whole outline inside the lot, clear of roads and buildings
      const corners = [[1.1, 2.4], [-1.1, 2.4], [1.1, -2.4], [-1.1, -2.4]].map(([s, l]) => [x + ux * s + vx * l, z + uz * s + vz * l]);
      if (!corners.every(([cx, cz]) => pip(cx, cz)) || this.onRoad(x, z, 2) || this.host.buildingNear(x, z, 1.2)) continue;
      const y = W._groundH(x, z) + 0.06, yaw = Math.atan2(vx, vz) + (h0 > 0.27 ? Math.PI : 0);
      FURNITURE.car(Mc, frame(x, y, z, yaw), { seed: h0 * 1.8 % 1 });
      carLo(Mf, frame(x, y, z, yaw), h0 * 1.8 % 1);
      this.stats.cars++;
    }
  }

  // ------------------------------------------------------------------ car parks' paving
  _lots(t) {
    const list = this.lots.get(t.key); if (!list) return;
    const W = this.world, pos = [], col = [], c1 = new THREE.Color('#5a5b5e'), c2 = new THREE.Color('#e9e6dc');
    const tri = (a, b, c, color) => { for (const p of [a, b, c]) { pos.push(p[0], p[1], p[2]); col.push(color.r, color.g, color.b); } };
    const surf = (x, z) => Math.min(W._groundH(x, z) + 0.06, W.cut.cap(x, z) + 0.25);
    for (const ring of list) {
      let tris; try { tris = THREE.ShapeUtils.triangulateShape(ring.map((p) => new THREE.Vector2(p.x, p.z)), []); } catch { continue; }
      for (const [i, j, k] of tris) {
        const split = (a, b, c, depth) => {
          const m = Math.max(Math.hypot(a[0] - b[0], a[1] - b[1]), Math.hypot(b[0] - c[0], b[1] - c[1]), Math.hypot(c[0] - a[0], c[1] - a[1]));
          if (m <= 6 || depth > 8) { const v = (p) => [p[0], surf(p[0], p[1]), p[1]]; const A = v(a), B = v(b), C = v(c); const up = (B[0] - A[0]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[0] - A[0]); if (up < 0) tri(A, B, C, c1); else tri(A, C, B, c1); return; }
          const ab = Math.hypot(a[0] - b[0], a[1] - b[1]), bc = Math.hypot(b[0] - c[0], b[1] - c[1]);
          if (m === ab) { const d = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; split(a, d, c, depth + 1); split(d, b, c, depth + 1); }
          else if (m === bc) { const d = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2]; split(a, b, d, depth + 1); split(a, d, c, depth + 1); }
          else { const d = [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2]; split(a, b, d, depth + 1); split(d, b, c, depth + 1); }
        };
        split([ring[i].x, ring[i].z], [ring[j].x, ring[j].z], [ring[k].x, ring[k].z], 0);
      }
      // stall lines along the longest side
      let best = 0, ux = 1, uz = 0;
      for (let q = 0; q < ring.length; q++) { const a = ring[q], b = ring[(q + 1) % ring.length], l = Math.hypot(b.x - a.x, b.z - a.z); if (l > best) { best = l; ux = (b.x - a.x) / l; uz = (b.z - a.z) / l; } }
      const vx = -uz, vz = ux;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const p of ring) { const a = p.x * ux + p.z * uz, b = p.x * vx + p.z * vz; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
      if ((a1 - a0) * (b1 - b0) > 60000) continue;
      const pip = (x, z) => { let c = false; for (let i2 = 0, j2 = ring.length - 1; i2 < ring.length; j2 = i2++) { const a = ring[i2], b = ring[j2]; if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c; } return c; };
      for (let b = b0 + 0.5; b < b1 - 2.5; b += 6.2) for (let a = a0 + 0.65; a < a1 - 1.5; a += 2.7) {
        const x0 = ux * a + vx * b, z0 = uz * a + vz * b, x1 = x0 + vx * 5, z1 = z0 + vz * 5;
        if (!pip(x0, z0) || !pip(x1, z1)) continue;
        const y0 = surf(x0, z0) + 0.02, y1 = surf(x1, z1) + 0.02, w = 0.06;
        tri([x0 - ux * w, y0, z0 - uz * w], [x1 + ux * w, y1, z1 + uz * w], [x1 - ux * w, y1, z1 - uz * w], c2);
        tri([x0 - ux * w, y0, z0 - uz * w], [x0 + ux * w, y0, z0 + uz * w], [x1 + ux * w, y1, z1 + uz * w], c2);
      }
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, this.lotMaterial); m.name = `Car parks ${t.key}`; m.receiveShadow = true;
    this._add(t, m);
  }

  // ------------------------------------------------------------------ fences, walls, hedges, rails
  _lines(t) {
    const list = this.lines.get(t.key); if (!list) return;
    const W = this.world, M = new MeshBuilder({ aGlow: 1 });
    const gy = (x, z) => W._groundH(x, z);
    for (const ln of list) {
      const pts = ln.pts;
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1], b = pts[k], len = Math.hypot(b.x - a.x, b.z - a.z); if (len < 0.3) continue;
        const n = Math.max(1, Math.ceil(len / 3));
        for (let s = 0; s < n; s++) {
          const p = { x: a.x + (b.x - a.x) * s / n, z: a.z + (b.z - a.z) * s / n }, q = { x: a.x + (b.x - a.x) * (s + 1) / n, z: a.z + (b.z - a.z) * (s + 1) / n };
          const mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2;
          if (this.onRoad(mx, mz, 0.4) || this.inWater(mx, mz)) continue;
          const y0 = gy(p.x, p.z), y1 = gy(q.x, q.z), seg = Math.hypot(q.x - p.x, q.z - p.z), yaw = Math.atan2(q.x - p.x, q.z - p.z), ym = Math.min(y0, y1);
          switch (ln.kind) {
            case 'fence':
              M.color('#5b5f62'); M.box(p.x, y0 - 0.1, p.z, 0.06, 1.6, 0.06, yaw);
              M.beam(V(p.x, y0 + 1.45, p.z), V(q.x, y1 + 1.45, q.z), 0.04, 0.04);
              M.color('#8b9093'); M.beam(V(p.x, y0 + 0.75, p.z), V(q.x, y1 + 0.75, q.z), 0.015, 1.35);
              break;
            case 'wall': M.color('#9a8f7e'); M.box(mx, ym - 0.3, mz, 0.35, Math.max(y0, y1) - ym + 1.3, seg + 0.05, yaw); M.color('#b2a894'); M.box(mx, Math.max(y0, y1) + 1.0, mz, 0.45, 0.1, seg + 0.05, yaw); break;
            case 'retaining_wall': M.color('#8f877a'); M.box(mx, ym - 1.2, mz, 0.5, Math.max(y0, y1) - ym + 1.6, seg + 0.05, yaw); break;
            case 'hedge': M.color('#3f6a33'); M.box(mx, ym - 0.1, mz, 0.9, 1.3 + (Math.max(y0, y1) - ym), seg + 0.1, yaw); break;
            case 'guard_rail':
              M.color('#9aa0a4'); M.box(p.x, y0 - 0.1, p.z, 0.1, 0.8, 0.1, yaw); M.beam(V(p.x, y0 + 0.6, p.z), V(q.x, y1 + 0.6, q.z), 0.06, 0.3); break;
            case 'jersey_barrier': M.color('#b5b1a8'); M.box(mx, ym - 0.05, mz, 0.6, 0.85 + (Math.max(y0, y1) - ym), seg, yaw); M.box(mx, ym + 0.75, mz, 0.25, 0.1, seg, yaw); break;
          }
        }
      }
    }
    if (!M.count) return;
    const m = new THREE.Mesh(M.geometry(), this.kitMaterial); m.name = `Fences and walls ${t.key}`; m.castShadow = true; m.receiveShadow = true;
    this._add(t, m);
  }

  dispose() {
    this.disposed = true;
    for (const [key, t] of this.tiles) this._release(key, t);
    this.kit.material.dispose();
    for (const T of this.treeGeos) for (const g of T.tiers) g.dispose();
    for (const tiers of this.pools) for (const im of tiers) im.dispose();
    this.cards.dispose(); this.facades.dispose();
    for (const g of [this.lampGeo, this.acornGeo]) g.dispose();
    for (const m of [this.kitMaterial, this.treeMaterial, this.lampMaterial, this.lotMaterial]) m.dispose();
    this.landTexture?.dispose();
  }
}

/** The plain parked car for distance: two blocks (as the street kit's carLo). */
const CAR_COLORS = ['#8c1f1f', '#1f3f6e', '#2c2c2e', '#d9d6cf', '#6b6f73', '#a9adb0', '#2f4f3a', '#7a5a2c', '#3c3f6b', '#b8a46a'];
function carLo(M, f, seed) {
  const col = CAR_COLORS[Math.floor(seed * 997) % CAR_COLORS.length], suv = seed > 0.85, L = suv ? 4.7 : seed < 0.2 ? 4.0 : 4.45, lift = suv ? 0.14 : 0;
  const at = (dx, dz) => [f.x + dx * f.c + dz * f.s, f.z - dx * f.s + dz * f.c];
  M.color(col); { const [x, z] = at(0, 0); M.box(x, f.y + 0.12, z, (suv ? 1.86 : 1.78) - 0.05, 0.71 + lift, L - 0.08, f.yaw); }
  M.color('#2e3a44'); { const [x, z] = at(0, -L * 0.08); M.box(x, f.y + 0.83 + lift, z, 1.47, suv ? 0.58 : 0.46, L * (suv ? 0.6 : 0.46), f.yaw); }
}
