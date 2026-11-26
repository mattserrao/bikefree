// PGH's city (claude/pgh-assets-plan.md, user 21 Nov: "proceed on all phases"): the Pittsburgh map's buildings, trees
// and street furniture over the whole PGH network, streamed by the graph world's tiles. tools/pgh_city.py makes the
// data with the Pittsburgh map's own extraction (routes/cities/pgh-city.json); this draws it with the Pittsburgh map's
// own builders, through the CityScene stand-in the landmarks already use (js/world/graph-heroes.js):
//   buildings   CityScene._chunkJob — the facade shader (brick, stone, metal, windows lit at night, shop rows), the
//               rooftops — and the building kit (planned sector by sector: the pittsburgh-rowhouse and pittsburgh-frame homes,
//               their porches, steps and yards near the rider)
//   trees       the tree engine (toolbox/vegetation/tree-engine.js, the northeastern hardwood kit): on the map's trees,
//               along the streets, in the yards and parks, in the woods and hedgerows (_ruralTrees)
//   furniture   the street kit's pieces (FURNITURE: signals, bus stops and shelters, benches, hydrants, bike racks,
//               bins, bollards, stop signs…) where OSM maps them; the city's street lamps along the urban streets and
//               the riverwalks; car parks with parked cars; parked cars along the main streets; fences, walls,
//               hedges, retaining walls, guard rails and jersey barriers
// and the land cover itself (landAt, a texture for the ground shader) and what each edge is made of (edgeInfo).
//
//   const c = new GraphCity(world, heroes, index); await c.loadLand()   → c.stream(cx, cz, ms) (sectors fetched as the rider nears them), c.tick(cam)
import * as THREE from '../../vendor/three.module.min.js';
import { MeshBuilder, hash } from './toolbox/core/mesh-builder.js';
import { ParkedCars, pickCar, carMaterial } from './toolbox/life/figures/cars.js';
import { Herds } from './toolbox/life/figures/animals.js';
import { cellKey, freezeMatrix } from './graph-world.js';
import { drain, runSlice, due } from './toolbox/core/jobs.js';
import { planBuildingKitJob, makeStreetIndex, dress } from './toolbox/structures/buildings/kit.js';
import { assemble, Writer } from './toolbox/structures/buildings/assemble.js';
import { withSurfaceDetail } from './toolbox/materials/surface-detail.js';
import { grassCard, grassMaterial, CARD } from './toolbox/landscape/grass-cards.js';
import { buildBuilding, MAP_KINDS, FARM_CODES } from './toolbox/structures/building-engine.js';   // [blocks] one front door
import { makeFacadeMaterial } from './toolbox/structures/buildings/facade-material.js';
import { villageFurniture } from './toolbox/city/village-street.js';
import { planFrontYard, drawFrontYard } from './toolbox/city/front-yards.js';
import { FURNITURE, makeFacadeDresser } from './toolbox/city/street-kit.js';
import { farmBuilding } from './toolbox/city/cny-farms.js';
import { GraphLife } from './toolbox/city/graph-life.js';
import { TreeEngine } from './toolbox/vegetation/tree-engine.js';
import { plantTile } from './toolbox/vegetation/planting.js';   // [blocks]
import { planHomestead, drawHomestead, driveStrips, nearDrive } from './toolbox/city/homesteads.js';
import { skanCrop, cropMaterial, cropCardsJob, bale, verge, bay, farmStand, hayWagon } from './toolbox/landscape/farm-kit.js';
import { makeUpstateTrees, fallVariant } from './toolbox/vegetation/upstate-trees.js';
import { OldGrowth } from './toolbox/vegetation/old-growth.js';
import { planParkPlanting } from './toolbox/vegetation/park-planting.js';
import { profileY, ditchFits, ditchGeometry, culvertEnd, goldenrod, laceAndChicory, tallGrass, cattails, utilityPole, wires, scrubClump, roadSign } from './toolbox/landscape/roadside-ny.js';
import { CANAL, canalAt } from './toolbox/city/cny-landmarks.js';
import { ROAD_LIFT } from './pose.js';

// (9 is the toolbox's pond; 10–12: a rural map's fields from WorldCover — tools/pgh_city.py rural_land, SKAN;
// 20–29: CNY's fields — 20-23 corn and 24-27 grain by the rows' heading, 28 hay, 29 farmyard: pgh_city.py "the country")
export const LAND = { paved: 0, grass: 1, woods: 2, water: 3, building: 4, sand: 5, plaza: 6, outside: 7, yards: 8, crops: 10, pasture: 11, wetland: 12,
  corn: 20, grain: 24, hay: 28, farmyard: 29,
  // 30–33: an old-growth hero area's own (tools/cny_forest.py: Camillus Forest Unique Area) — old growth, its woods,
  // its tall meadows, the blowdown; dressed by toolbox/vegetation/old-growth.js
  oldGrowth: 30, ogForest: 31, ogMeadow: 32, ogBlowdown: 33 };
const TILE = 400;
// how far the city is built, by quality (Low: phones)
const VERGE_IN = 260, VERGE_OUT = 420;
/** Phones and tablets (user, 23 Nov: "even on high performance on mobile, the game should not run out of memory"):
 *  the city's tiles built no farther than Light's at any quality — the fog closes in a little sooner. */
export const MOBILE = (() => { try { const ua = navigator.userAgent || ''; return /iPhone|iPad|iPod|Android|Mobile/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1); } catch { return false; } })();
const capReach = (q) => (MOBILE ? { ...q, near: Math.min(q.near, 1300), far: Math.min(q.far, 1800) } : q);
/** Smooth value noise in [0, 1] (the verges' slow patches). */
const vnoise = (x, z) => {
  const i = Math.floor(x), j = Math.floor(z), u = x - i, v = z - j, f = (t) => t * t * (3 - 2 * t), H = (a, b) => hash(a * 127.1 + b * 311.7);
  const a = H(i, j), b = H(i + 1, j), c = H(i, j + 1), d = H(i + 1, j + 1), fu = f(u), fv = f(v);
  return a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv;
};   // the verges' grass and brush: built within, dropped beyond (m from a tile's edge)
const REACH = { low: { near: 1300, far: 1800, trees: 0.6, treeNear: 450 }, balanced: { near: 2300, far: 3100, trees: 1, treeNear: 750 }, high: { near: 2300, far: 3100, trees: 1.2, treeNear: 900 } };
const CAR_NEAR = 340;           // m: parked cars (the kit's lo LOD) within this, its far LOD beyond
const CAR_HI = 110;
const ANIMAL_M = 480;           // m: farm animals drawn within this             // m: the kit's detailed cars within this
const pipXZ = (r, x, z) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c; } return c; };
const HOUSE_CLOSE_M = 160;
/** A static mesh's arrays let go once they're on the GPU (no second copy in the page's memory: phones, user 23 Nov —
 *  "even on high … should not run out of memory"); its bounds kept first. Not for anything read back later. */
function gpuOnly(m) {
  const g = m.geometry; g.computeBoundingSphere(); if (!g.boundingBox) g.computeBoundingBox();
  const drop = function () { this.array = null; };
  for (const a of Object.values(g.attributes)) a.onUpload(drop);
  g.index?.onUpload(drop);
  return m;
}
const PROXY_MAT = new THREE.MeshStandardMaterial({ color: '#000000' });
/** One mesh of every tree's crown (an ellipsoid; a cone for the conifers) and trunk, for the bake only: on no camera
 *  layer (the bake draws it on its own), static (bake: true). */
// (the stutter, 23 Nov: it cloned three geometries per tree and spread their arrays into one — up to ~100 ms a tile in
//  one go; now it writes straight into one array from the shapes' own triangles, and yields as it goes)
const PROXY_SHAPES = (() => {
  const tris = (g) => (g.index ? g.toNonIndexed() : g).attributes.position.array;
  // (lighter, user 23 Nov — "should not run out of memory": an octahedron crown, a 4-sided cone, a trunk with no top or bottom;
  //  no normals — the bake reads only where they stand: ~110 MB on High, streamed out to 2.3 km, now about a third)
  const trunk = new THREE.CylinderGeometry(.6, .6, 1, 4, 1, true).translate(0, .5, 0);
  return { blob: tris(new THREE.OctahedronGeometry(1, 0)), cone: tris(new THREE.ConeGeometry(1, 1, 4).translate(0, .5, 0)), box: tris(trunk) };
})();
function* treeProxiesJob(trees, kit, out) {
  const S = PROXY_SHAPES;
  let n = 0;
  for (const t of trees) if (kit[t.sp]) n += (/pine|hemlock|spruce/.test(t.sp) ? S.cone.length : S.blob.length) + S.box.length;
  if (!n) return;
  const pos = new Float32Array(n);
  let k = 0;
  const put = (src, sx, sy, sz, x, y, z) => { for (let q = 0; q < src.length; q += 3) { pos[k++] = src[q] * sx + x; pos[k++] = src[q + 1] * sy + y; pos[k++] = src[q + 2] * sz + z; } };
  for (let i = 0; i < trees.length; i++) {
    if ((i & 255) === 0 && due()) yield;
    const t = trees[i], sp = kit[t.sp]; if (!sp) continue;   // (the understory: too low to matter)
    const h = sp.h * (t.sy ?? t.s), r = sp.r * t.s;
    if (/pine|hemlock|spruce/.test(t.sp)) put(S.cone, r * .8, h * .92, r * .8, t.x, t.y + h * .08, t.z);
    else if (t.sp === 'snag') put(S.blob, r * .2, h * .2, r * .2, t.x, t.y + h * .5, t.z);   // (a dead tree: its bare limbs, a little shade)
    else put(S.blob, r * .82, h * .3, r * .82, t.x, t.y + h * .62, t.z);
    const w = Math.max(.35, r * .1); put(S.box, w, h * .5, w, t.x, t.y, t.z);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.computeBoundingBox(); geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, PROXY_MAT);
  mesh.name = 'Tree shadow proxies'; mesh.layers.mask = 0; mesh.userData.bake = true; mesh.castShadow = false; mesh.frustumCulled = false;
  out.mesh = mesh;
}   // the house engine's close detail (casings, rails, brackets) drawn this far
/** The landscape as a lakefront house reads it: never lower than `floor` (its footings go down into the water). */
const dryLand = (L, floor) => { const o = Object.create(L); o.heightAt = (x, z) => Math.max(L.heightAt(x, z), floor); return o; };
const KIT_CFG = { detailM: 150, dressingM: 80, detailReachM: 550,
  styles: [{ preset: 'pittsburgh-rowhouse', kinds: ['rowhouse'] }, { preset: 'pittsburgh-frame', kinds: ['house', 'barn', 'shed'] }] };
/** Each road-graph city's homes (CNY: the suburbs' ranches and colonials, the villages' older houses, the farmhouses:
 *  presets.js cny-*; tools/pgh_city.py's zones give kinds 23 and 20). */
export const KIT_STYLES = { cny: [{ preset: 'cny-village', kinds: ['village-house'] }, { preset: 'cny-farmhouse', kinds: ['farmhouse-ny', 'barn', 'shed'] },
  { preset: 'cny-suburban', kinds: ['house', 'rowhouse'] }],
  // SKAN: the same upstate styles; its houses are sorted at load (_addSector: a house by a barn is a farmhouse, one
  // among many close neighbours a village house)
  skan: [{ preset: 'cny-village', kinds: ['village-house'] }, { preset: 'cny-farmhouse', kinds: ['farmhouse-ny', 'barn', 'shed'] },
    { preset: 'cny-suburban', kinds: ['house', 'rowhouse'] }] };
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
    this.q = capReach(REACH[world.qualityKey] || REACH.balanced);
    this.gfx = { distance: 1, trees: 1, verge: true, life: true };   // (the graphics menu: setGfx)
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
        const k = cellKey(Math.floor((e.x[i] + e.x[i + 1]) / 2 / 20), Math.floor((e.z[i] + e.z[i + 1]) / 2 / 20));
        let a = this._segGrid.get(k); if (!a) this._segGrid.set(k, (a = [])); a.push(e, i);
      }
    }

    // ---- sectors (~1.6 km): fetched as the rider nears them; their buildings join the stand-in's lists
    this.sectors = new Map();   // key → { state: 'loading' | 'planning' | 'ready' | 'failed', job }
    this.buildings = [];
    this._railZones = this._railApproaches();
    this.covered = this._landmarkCover();
    this.landmarkClear = this._landmarkClear();
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
    this.kitScene = { ...host.route.scene, buildingKit: { ...KIT_CFG, styles: KIT_STYLES[world.json?.id] || KIT_CFG.styles } };
    this.kit = this._kitAdapter();
    host.buildingKit = this.kit;
    this._materials();
    // the rural maps (CNY, SKAN; user, 22 Nov): no cars — other cyclists and people walking instead
    this.rural = !!world.rural;   // (the profile's country dressing: toolbox/map-profile.js)
    this.profile = world.profile;
    if (this.profile.life === 'cyclists' || this.profile.life === 'park') this.life = new GraphLife(world, host.group, { quality: world.qualityKey, uTime: this.treeTime, park: this.profile.life === 'park' });
    // the tree engine (one for the game: toolbox/vegetation/tree-engine.js) with the northeastern hardwood kit — every
    // road-graph map (PGH's western Pennsylvania has the same trees); the rural maps in early fall, PGH in summer
    this.treeKit = makeUpstateTrees({ oldGrowth: !!world.json?.oldGrowth, park: !!this.profile.parkTrees, bushes: !!this.profile.understory });
    this.fall = this.profile.season === 'early-fall' || this.profile.season === 'peak-fall';
    this.peak = this.profile.season === 'peak-fall';   // (NYC: the canopy at its height — most trees turned)
    this.cars = this.profile.cars !== false;            // (NYC: no parked cars — the streets round the park stay empty)
    // ([zwift-look] a map's near band: its trees within ~nearM m drawn as their grown leaf-cluster models, not cards)
    this.forest = new TreeEngine({ renderer: world.renderer, parent: host.group, quality: world.qualityKey, uTime: this.treeTime, lights: { hemi: world.hemi, sun: world.sun }, kit: this.treeKit, near: (MOBILE ? .6 : 1) * (this.profile.trees?.nearM || 0) });
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
    // an old-growth hero area (CNY: the Camillus Forest Unique Area): its data, then its dressing
    const ogFile = this.world.json?.oldGrowth;
    if (ogFile) {
      try { const data = await (await fetch(new URL(`../../${ogFile}`, import.meta.url))).json(); this.oldGrowth = new OldGrowth({ world: this.world, city: this, data }); }
      catch (err) { console.warn('old growth: not loaded', err); }
    }
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
  *_addSector(key, st) {
    const d = st.data, host = this.host;
    const B = d.buildings, h = new Uint16Array(u8(B.h)), mh = new Uint16Array(u8(B.mh)), starts = new Uint32Array(u8(B.starts)), xy = new Int16Array(u8(B.xy));
    const mine = [];
    for (let q = 0; q < B.count; q++) {
      if ((q & 31) === 0 && due()) yield;
      const ring = []; for (let i = starts[q]; i < starts[q + 1]; i++) ring.push(this.local(xy[2 * i], xy[2 * i + 1]));
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, cx = 0, cz = 0;
      for (const p of ring) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); cx += p.x; cz += p.z; }
      cx /= ring.length; cz /= ring.length;
      const b = { k: this.buildings.length, ring, h: h[q] / 10, mh: mh[q] / 10, kind: B.kind[q], name: B.names[q] || '', bb: [x0, x1, z0, z1], cx, cz, sector: key };
      if (this.covered(b) || this._underDeck(b)) b.hidden = true;
      if (this.profile.hideInWater && this.world.ground && this.inWater(cx, cz)) b.hidden = true;   // (a lakefront footprint past the drawn shore)
      if (FARM_CODES.has(b.kind)) b.ownModel = 'farm';   // CNY's barns: js/world/toolbox/city/cny-farms.js (_farms), not boxes
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
    // SKAN's houses (all kind 1 in its data): one with a barn within 120 m is a farmhouse, one with a dozen buildings
    // within 90 m a village house — the CNY presets then dress them as CNY's are
    if (this.profile.classifyHomes === 'by-neighbours') {
      // the village cores' commercial buildings (tools/skan_heroes.py: their OSM outlines along Genesee, Jordan and
      // Fennell Streets, Marcellus's Main and North Streets): storefront rows; the historic houses the house engine
      // builds as their real type
      const V = this._villageData ||= this._skanVillages();
      for (const b of mine) {
        const s = V.shops.find((q) => b.cx > q.bb[0] && b.cx < q.bb[1] && b.cz > q.bb[2] && b.cz < q.bb[3] && pipXZ(q.ring, b.cx, b.cz));
        if (s) { b.kind = 0; b.h = Math.max(b.h, s.h); b.shop = true; continue; }
        const f = V.styles.find((q) => Math.hypot(q.x - b.cx, q.z - b.cz) < 7);
        if (f) { b.force = f; b.kind = 23; }
      }
      const barns = mine.filter((b) => b.kind === 13), all = mine;
      for (const b of mine) {
        if (b.kind !== 1 || b.force) continue;
        if (barns.some((o) => Math.hypot(o.cx - b.cx, o.cz - b.cz) < 120)) { b.kind = 20; continue; }
        let n = 0; for (const o of all) if (Math.abs(o.cx - b.cx) < 90 && Math.abs(o.cz - b.cz) < 90 && Math.hypot(o.cx - b.cx, o.cz - b.cz) < 90) n++;
        if (n >= 13) b.kind = 23;
      }
    }
    // the homes' plan: rowhouses and houses (the kit's), the rest as neighbours
    const kinds = MAP_KINDS, homes = [], neighbours = [];   // [blocks] the building engine's codes   // (13, 14: a rural map's barns and sheds, SKAN; 20, 23: CNY's farmhouses and village houses)
    for (const b of mine) {
      if (due()) yield;
      if (b.kind === 12 || b.hidden) continue;
      const pts = b.ring.map((p) => [p.x, p.z]);
      let r = 0; for (const [px, pz] of pts) r = Math.max(r, Math.hypot(px - b.cx, pz - b.cz));
      // a brick row on a main street (East Carson, Butler, Penn…): a shop row, dressed by _storefronts, not a home
      if (b.kind === 0 && b.h >= 6.5 && this._frontsOf(b, b.ring, null, !b.shop).length) b.shopRow = true;
      if (b.shop && !b.shopRow) { b.shopRow = true; }   // (a village core's: a storefront row even round a corner)
      const e = { x: b.cx, z: b.cz, pts, levels: 0, kind: b.shopRow ? 'other' : kinds[b.kind] || 'other', roof: -1, height: b.h, s: 0, r, name: b.name || '', key: b.k, force: b.force };
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
    // the houses' close detail, per 120 m cell: built when the camera comes within reach, dropped past it (user, 23 Nov:
    // "even on high … should not run out of memory" — built up front it was 50–65 MB in the villages)
    const closeCells = new Map();   // cell key → { tile, houses: [R], box, mesh, pending }
    let closeJob = null;
    const addExt = (e) => { for (let i = Math.floor((e.x - e.r) / 20); i <= Math.floor((e.x + e.r) / 20); i++) for (let j = Math.floor((e.z - e.r) / 20); j <= Math.floor((e.z + e.r) / 20); j++) { const k = i * 100003 + j; let a = extents.get(k); if (!a) extents.set(k, (a = [])); a.push(e); } };
    return {
      group, material, details, plans,
      /** A sector's plan is in: its homes, and what they add outside their footprints (for the trees and lamps). */
      planned(plan) {
        // (none in the canal: a footprint OSM puts in the channel, or a house the clean shape pushed into it)
        for (const R of plan.buildings) R.inCanal = (R.rects.length ? R.rects : [{ cx: R.x, cz: R.z, ux: 1, uz: 0, vx: 0, vz: 1, hu: 1, hv: 1 }])
          .some((r) => [[0, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]].some(([a, b]) => canalAt(r.cx + r.ux * a * r.hu + r.vx * b * r.hv, r.cz + r.uz * a * r.hu + r.vz * b * r.hv, .5)));
        // (a lakefront house whose footprint runs past the drawn shore: stood on its floor above the water, not in it;
        //  one whose middle is in the lake is left out)
        if (self.world.ground) for (const R of plan.buildings) {
          if (R.inCanal) continue;
          const pts = (R.rects.length ? R.rects : [{ cx: R.x, cz: R.z, ux: 1, uz: 0, vx: 0, vz: 1, hu: 1, hv: 1 }]).flatMap((r) => [[0, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]].map(([a, b]) => [r.cx + r.ux * a * r.hu + r.vx * b * r.hv, r.cz + r.uz * a * r.hu + r.vz * b * r.hv]));
          const wet = pts.filter(([x, z]) => self.inWater(x, z)).length;
          if (!wet) continue;
          if (self.inWater(R.x, R.z) || wet > pts.length / 2) { R.inCanal = true; continue; }
          R.floorAbove = self.world.poolAt(R.x, R.z) + 0.9;
        }
        for (const R of plan.buildings) {
          plans.set(R.key, R);
          if (R.inCanal) continue;   // (taken, never drawn)
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
        // the house engine's close detail (casings, rails, brackets, gutters): one mesh per 120 m cell, drawn to ~160 m,
        // built later when the camera nears the cell (_closeJob); here a writer that's thrown away
        const scrap = new Writer(4096), closeOf = (R) => {
          const k = `${key}|${Math.floor(R.x / 120)},${Math.floor(R.z / 120)}`; let c = closeCells.get(k);
          if (!c) closeCells.set(k, (c = { tile: key, houses: [], box: new THREE.Box3(), mesh: null }));
          c.houses.push(R); c.box.expandByPoint(new THREE.Vector3(R.x, (L.heightAt?.(R.x, R.z) ?? 0), R.z)); scrap.n = 0; scrap.ni = 0; return scrap;
        };
        for (const R of list) {
          if (due()) yield;
          if (R.inCanal) continue;
          const LR = R.floorAbove ? dryLand(L, R.floorAbove) : L;
          const res = buildBuilding(R, w, d, R.house ? closeOf(R) : null, LR);   // [blocks] (closeOf only for the house engine's)
          if (R.dressing?.length) for (const it of R.dressing) dress(d, it, R, L, res);
        }
        if (w.n) { const m = gpuOnly(new THREE.Mesh(w.geometry(), material)); m.name = `Homes ${key}`; m.castShadow = m.receiveShadow = true; group.add(m); }
        if (d.n) { const dm = gpuOnly(new THREE.Mesh(d.geometry(), material)); dm.userData.bake = false; dm.name = `Home detail ${key}`; dm.receiveShadow = true; dm.geometry.computeBoundingBox(); dm.userData.box = dm.geometry.boundingBox; group.add(dm); details.push(dm); }
        for (const c of closeCells.values()) if (c.tile === key) c.box.expandByScalar(18);   // (the houses' own size round their centres)
      },
      tick(cam) {
        for (const m of details) m.visible = m.userData.box.distanceToPoint(cam) < (m.userData.reach || KIT_CFG.detailReachM);
        for (const c of closeCells.values()) {
          const d = c.box.distanceToPoint(cam);
          if (c.mesh) { c.mesh.visible = d < HOUSE_CLOSE_M; if (d > HOUSE_CLOSE_M + 140 && closeJob?.c !== c) { group.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh = null; } }
        }
      },
      /** The nearest cell within reach whose close detail isn't built, built as a job (sliced: graph-city stream). */
      *closeJob(cam) {
        let best = null, bd = HOUSE_CLOSE_M + 60;
        for (const c of closeCells.values()) if (!c.mesh) { const d = c.box.distanceToPoint(cam); if (d < bd) { bd = d; best = c; } }
        if (!best) return false;
        closeJob = { c: best };
        const W = new Writer(8192), D = new Writer(4096), C = new Writer(4096), L = self.host.landscape;
        for (const R of best.houses) {
          if (due()) yield;
          if (!closeCells.has(`${best.tile}|${Math.floor(R.x / 120)},${Math.floor(R.z / 120)}`)) { closeJob = null; return true; }   // (its tile released meanwhile)
          W.n = W.ni = 0; D.n = D.ni = 0;
          buildBuilding(R, W, D, C, R.floorAbove ? dryLand(L, R.floorAbove) : L);
        }
        if (C.n) { const cm = gpuOnly(new THREE.Mesh(C.geometry(), material)); cm.userData.bake = false; cm.name = `House close detail ${best.tile}`; cm.receiveShadow = true; cm.visible = best.box.distanceToPoint(cam) < HOUSE_CLOSE_M; group.add(cm); best.mesh = cm; }
        else best.mesh = new THREE.Object3D();   // (nothing to draw: marked done)
        closeJob = null;
        return true;
      },
      /** A tile's cells forgotten (graph-city _release). */
      releaseTile(key) { for (const [k, c] of closeCells) if (c.tile === key) { if (c.mesh) { group.remove(c.mesh); c.mesh.geometry?.dispose(); } closeCells.delete(k); } },
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
      const arr = this._segGrid.get(cellKey(gx + a, gz + b)); if (!arr) continue;
      for (let k = 0; k < arr.length; k += 2) {
        const e = arr[k], i = arr[k + 1], ax = e.x[i], az = e.z[i], dx = e.x[i + 1] - ax, dz = e.z[i + 1] - az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), px = ax + dx * t, pz = az + dz * t, ex = x - px, ez = z - pz, d = Math.sqrt(ex * ex + ez * ez);
        const half = (w.wOf ? w.wOf(e) : 7) / 2;
        if (d - half > r) continue;
        if (!best || d - half < best.d - best.half) { const l = Math.sqrt(l2); best = { e, i, t, d, half, y: e.ele[i] + (e.ele[i + 1] - e.ele[i]) * t, dx: dx / l, dz: dz / l, px, pz }; }
      }
    }
    return best;
  }
  /** Is (x, z) on a way (within `margin` of its edge)? */
  onRoad(x, z, margin = 0.5) { const r = this.roadNear(x, z, margin); return !!r && r.d < r.half + margin; }
  /** Rural maps: built up enough for street lamps (a village or a suburban street): houses all round within ~40 m. */
  _suburb(x, z) {
    let n = 0;
    for (let k = 0; k < 8; k++) { const a = k * .785; if (this.host.buildingNear(x + Math.cos(a) * 32, z + Math.sin(a) * 32, 9)) n++; }
    return n >= 5;
  }
  urban(x, z) { const c = this.landAt(x, z); return c === LAND.paved || c === LAND.yards || c === LAND.building || c === LAND.plaza; }
  inWater(x, z) { const w = this.world; return w._groundH(x, z) < w.poolAt(x, z) + 0.3; }
  /** Water or wet ground here: a pond or lake, the canal, a creek's line, a marsh (the atmosphere effect's mist). */
  waterNear(x, z) { const c = this.landAt(x, z); return c === LAND.water || c === LAND.wetland || canalAt(x, z, 0) || this.inWater(x, z); }

  // ------------------------------------------------------------------ setup helpers
  /** CNY's rail bridge approaches (cny-landmarks.js railbridge): the embankments' strips along the bridge's axis, so
   *  no house, tree, fence or verge stands on them; their ends, where a stand of trees takes the line. */
  _railApproaches() {
    const out = [], proj = this.world.proj;
    for (const l of this.heroes.json?.landmarks || []) {
      if (l.model !== 'railbridge' || !l.path) continue;
      const p0 = proj.toLocal(...l.path[0]), p1 = proj.toLocal(...l.path[l.path.length - 1]), len = Math.hypot(p1.x - p0.x, p1.z - p0.z) || 20;
      const u = { x: (p1.x - p0.x) / len, z: (p1.z - p0.z) / len }, v = { x: -u.z, z: u.x }, c = { x: (p0.x + p1.x) / 2, z: (p0.z + p1.z) / 2 };
      const hl = Math.max(11, len / 2 + 2), [A0, A1] = l.approachM || [150, 60];
      out.push({ c, u, v, a0: -(hl + A0), a1: hl + A1, hw: 9, ends: [{ x: c.x + u.x * -(hl + A0), z: c.z + u.z * -(hl + A0), s: -1 }, { x: c.x + u.x * (hl + A1), z: c.z + u.z * (hl + A1), s: 1 }] });
    }
    return out;
  }
  /** Is (x, z) on a rail approach's strip (within pad)? */
  _railCovers(x, z, pad = 0) {
    for (const R of this._railZones || []) {
      const dx = x - R.c.x, dz = z - R.c.z, a = dx * R.u.x + dz * R.u.z, b = dx * R.v.x + dz * R.v.z;
      if (a > R.a0 - pad && a < R.a1 + pad && Math.abs(b) < R.hw + pad) return true;
    }
    return false;
  }

  /** SKAN's village data (graph-heroes' json: shops' outlines and styled houses), in the local frame. */
  _skanVillages() {
    const hj = this.heroes.json || {}, proj = this.world.proj;
    const shops = (hj.shops || []).map((q) => {
      const ring = q.ring.map(([a, o]) => proj.toLocal(a, o));
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const p of ring) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
      return { ring, h: q.h, bb: [x0, x1, z0, z1] };
    });
    const styles = (hj.styles || []).map((q) => ({ ...proj.toLocal(q.center[0], q.center[1]), type: q.type, wall: q.wall }));
    return { shops, styles };
  }
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
      if (this._railCovers(b.cx, b.cz, 1) || b.ring.some((p) => this._railCovers(p.x, p.z, 0))) return true;   // (on a rail approach)
      for (const q of boxes) {
        if (b.cx < q.x0 - 4 || b.cx > q.x1 + 4 || b.cz < q.z0 - 4 || b.cz > q.z1 + 4) continue;
        if (pip(q.r, b.cx, b.cz) || q.r.some((p) => pip(b.ring, p.x, p.z))) return true;
      }
      return false;
    };
  }
  /** Ground kept clear of trees round the landmarks that ask for it (a landmark's clearM: NYC's, so Bethesda, Belvedere
   *  and the rest are seen from the paths) → (x, z) → true where no tree grows. */
  _landmarkClear() {
    const proj = this.world.proj, list = [];
    for (const l of this.heroes.json?.landmarks || []) {
      // (a landmark with view corridors and no clearM — the QC fixer's, tools/qc_fix.mjs — keeps just its corridors)
      if ((!(l.clearM >= 0) && !l.views?.length) || (!l.ring && !l.center)) continue;
      if (l.clearM >= 0) {
        const r = l.ring && l.ring.length >= 3 ? l.ring.map(([a, o]) => proj.toLocal(a, o)) : [proj.toLocal(l.center[0], l.center[1])];
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const p of r) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
        const m = l.clearM; list.push({ r, m, x0: x0 - m, x1: x1 + m, z0: z0 - m, z1: z1 + m });
      }
      // its view corridors: from a way to it, trees kept viewM off the line
      if (!l.center) continue;
      const c = proj.toLocal(l.center[0], l.center[1]), vm = l.viewM || 3.5;
      for (const [la, lo] of l.views || []) { const a = proj.toLocal(la, lo), seg = [a, c]; list.push({ r: seg, m: vm, view: true, x0: Math.min(a.x, c.x) - vm, x1: Math.max(a.x, c.x) + vm, z0: Math.min(a.z, c.z) - vm, z1: Math.max(a.z, c.z) + vm }); }
    }
    if (!list.length) return () => false;
    const pip = (r, x, z) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c; } return c; };
    const near = (r, x, z, m) => { for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)); if (Math.hypot(a.x + dx * t - x, a.z + dz * t - z) < m) return true; } return false; };
    // (margin false: only inside an outline or a view corridor — a mapped tree stands in a landmark's margin)
    return (x, z, margin = true) => list.some((q) => x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1 && ((q.r.length >= 3 && pip(q.r, x, z)) || ((margin || q.view) && near(q.r, x, z, q.m))));
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
    // the verges' grass and brush: one-triangle blades, both faces drawn
    // the trees: the tree engine (constructor); its wind clock
    this.treeTime = { value: 0 };
    this.vergeMat = grassMaterial(this.world.renderer, this.treeTime, this.world.renderer.getContextAttributes?.()?.antialias || this.world.qualityKey === 'high');   // (soft picture cards: grass-cards.js)

    // the street kit's facade dressing (shop fronts, signs, awnings, cornices, belt courses, sills)
    this.glassNight = { value: 0 };   // (the shop glass: lit, not floodlit; follows the night in tick; the signs: the windows' night)
    this.facades = makeFacadeDresser(this.host.windowNight || night, { glassNight: this.glassNight,
      lampNear: (x, z, r) => { const a = this._lampPts; if (a) for (let k = 0; k < a.length; k += 2) if (Math.hypot(a[k] - x, a[k + 1] - z) < r) return true; return false; } });
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
      if (st.state === 'decode') { st.state = 'adding'; st.add = this._addSector(key, st); }
      if (st.state === 'adding') { if (!runSlice(st.add, Math.max(0.5, ms - (performance.now() - t0))).done) return; st.add = null; }
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
    // the houses' close detail near the camera (the building kit's cells), as a job in the frame's slice
    while (performance.now() - t0 < ms) {
      if (!this._cjob) this._cjob = this.kit.closeJob?.(this.world.camera.position);
      if (!this._cjob) break;
      const r = runSlice(this._cjob, ms - (performance.now() - t0));
      if (!r.done) break;
      this._cjob = null;
      if (r.value === false) break;
    }
    // verges: the nearest tile waiting for its grass, as a job in the frame's slice; far ones dropped
    while (performance.now() - t0 < ms) {
      if (!this._vjob) {
        let best = null, bd = VERGE_IN;
        let crops = false;
        for (const t of this.tiles.values()) if (!t.building && ((this.gfx.verge && t.vergePending) || t.cropsPending)) { const d = Math.hypot(t.cx - cx, t.cz - cz) - TILE * .71; if (d < bd + (t.cropsPending ? 80 : 0)) { bd = d - (t.cropsPending ? 80 : 0); best = t; crops = !!t.cropsPending; } }
        if (!best) break;
        this._vjob = { t: best, gen: crops ? this._cropsJob(best) : this._vergeJob(best) };
      }
      const left = ms - (performance.now() - t0);
      if (left <= 0) break;
      if (runSlice(this._vjob.gen, left).done) this._vjob = null; else break;
    }
    if ((this._f || 0) % 30 === 15) for (const t of this.tiles.values()) if (t !== this._vjob?.t) {
      const d = Math.hypot(t.cx - cx, t.cz - cz) - TILE * .71;
      if (t.vergeMesh && d > VERGE_OUT) this._dropVerge(t);
      if (t.cropsMesh && d > VERGE_OUT + 120) { const m = t.cropsMesh; this.host.group.remove(m); m.geometry.dispose(); t.meshes = t.meshes.filter((r) => r.m !== m); t.near = t.near.filter((x) => x !== m); t.cropsMesh = null; t.cropsPending = true; }
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
    const t = { key, i, j, cx: (i + 0.5) * TILE, cz: (j + 0.5) * TILE, built: true, building: true, meshes: [], near: [], far: [], spots: [] };
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
    if (this.rural) { yield* this._planHomesteads(t); yield; }
    yield* this._trees(t); yield;
    yield* this._furniture(t); yield;
    if (this.rural) { yield* this._drawHomesteads(t); yield; yield* this._farmland(t); yield; yield* this._animals(t); yield; }
    yield* this._farms(t); yield;
    yield* this._storefronts(t); yield;
    yield* this._lots(t); yield* this._lines(t);
    // the street furniture, fences and walls: one mesh (one draw call) for the tile
    if (t.kitM.count) { const m = gpuOnly(new THREE.Mesh(t.kitM.geometry(), this.kitMaterial)); m.name = `Street furniture ${t.key}`; m.castShadow = true; m.receiveShadow = true; this._add(t, m); }
    t.kitM = null;
    for (const { m } of t.meshes) freezeMatrix(m);   // (static: no per-frame matrix work)
    if (t.spots.length) this.world.tileSpots?.set(key, t.spots);
    t.building = false;
  }

  _release(key, t) {
    if (this._vjob?.t === t) this._vjob = null;
    this.kit.releaseTile?.(key);
    this.world.tileSpots?.delete(key);
    for (const { m, parent, kit } of t.meshes) {
      parent.remove(m);
      if (m.geometry && !m.userData.shared) m.geometry.dispose();
      if (kit) { const d = this.kit.details.indexOf(m); if (d >= 0) this.kit.details.splice(d, 1); }
    }
    this.host.chunks.delete(key);
    this.tiles.delete(key);
    this.forest?.removeTile(key);
  }

  _add(t, mesh, lod = null) {
    if (lod) mesh.userData.bake = false;   // (near / far detail comes and goes with the camera: the bake leaves it out)
    this.host.group.add(mesh);
    t.meshes.push({ m: mesh, parent: this.host.group });
    if (lod === 'near') t.near.push(mesh); else if (lod === 'far') t.far.push(mesh);
  }

  /** LOD: detailed trees and cars near the camera, crowns and plain cars beyond; the kit's near detail. */
  tick(cam, time, rider = null, dt = 0) {
    this.treeTime.value = time;
    if (this.gfx.life) this.life?.tick(cam, rider?.pos || null, rider?.fwd || null, dt);
    this.glassNight.value = this.host.night.value * 0.05;
    this.forest.tick(this.world.camera);
    this.oldGrowth?.tick(this.world.camera, time);
    if ((this._lf = (this._lf || 0) + 1) % 8) return;
    for (const t of this.tiles.values()) {
      const d = Math.hypot(t.cx - cam.x, t.cz - cam.z) - TILE * 0.71;
      for (const m of t.near) m.visible = d < (m.userData.lodM || this.q.treeNear) && !(d < m.userData.lodMin) && (this.gfx.life || !/^(Parked cars|Animals)/.test(m.name));
      for (const m of t.far) m.visible = d >= (m.userData.lodM || this.q.treeNear);
    }
    this.kit.tick(cam);
  }

  // ------------------------------------------------------------------ trees
  *_trees(t) { yield* this._ruralTrees(t); }

  /**
   * The rural maps' trees (CNY, SKAN; user, 22 Nov 2026), drawn by the tree engine. Placed sensibly: never on or in
   * a house (no crown over a roof), a road (trunks ≥ 4 m from its edge; crowns near it kept clear of the camera), a
   * driveway, the water (≥ 3 m from it) or a field or farmyard. Where:
   *   woods       dense (a tree every ~8 m), the full upstate mix, an age mix (saplings to old giants); the woodlot's
   *               edge graded through younger trees, shrubs, sumac and saplings into the open
   *   hedgerows   along the boundaries between fields (ash, cherry, maples, a willow where it's wet) with shrubs
   *   yards       one to four trees beside or behind each house — maples, an oak, a birch, a pine or spruce
   *   streets     the villages' street trees (maples, oak)
   *   pasture     a lone shade tree now and then; wetland: red maple, willow, ash
   *   understory  near the road in the woods: ferns, logs and stumps
   */
  *_ruralTrees(t) {
    const W = this.world, x0 = t.i * TILE, z0 = t.j * TILE, out = [], kit = this.treeKit.species;
    const FIELD = (c) => c === LAND.crops || c === LAND.pasture || (c >= 20 && c <= 29);
    const edgeOf = (x, z) => { const r = this.roadNear(x, z, 30); return r ? r.d - r.half : 99; };
    // (the land cover's own water too: the canal and the ponds the ground draws as water, OSM's canal line or not —
    //  user, 23 Nov: "trees spawning in canal water is still an issue")
    const wetLand = (x, z, r) => this.landAt(x, z) === LAND.water || this.landAt(x + r, z) === LAND.water || this.landAt(x - r, z) === LAND.water || this.landAt(x, z + r) === LAND.water || this.landAt(x, z - r) === LAND.water;
    const clearOf = (x, z, crown, mapped = false) => !this.inWater(x, z) && !canalAt(x, z, Math.max(1.5, crown * .5)) && !wetLand(x, z, Math.max(1.5, crown * .5)) && !this.inWater(x + 3, z) && !this.inWater(x - 3, z) && !this.inWater(x, z + 3) && !this.inWater(x, z - 3)
      && !this.heroes.heroes?.covers?.(x, z, 3) && !this.host.buildingNear(x, z, crown) && !this.kit.occupied(x, z, Math.min(crown, 3)) && !this._inDressing(x, z)
      && !this._drivewayNear?.(x, z, 2.5) && !this._railCovers(x, z, crown * .6) && !this.landmarkClear?.(x, z, !mapped);
    const pick = (mix, r) => { let a = 0, tot = 0; for (const [, w] of mix) tot += w; for (const [n, w] of mix) { a += w / tot; if (r <= a) return n; } return mix[mix.length - 1][0]; };
    const MIX = {
      woods: [['sugarmaple', 28], ['redoak', 15], ['beech', 10], ['whiteash', 12], ['blackcherry', 8], ['redmaple', 10], ['whitepine', 8], ['hemlock', 6], ['birch', 3]],
      wet: [['redmaple', 40], ['willow', 28], ['whiteash', 20], ['birch', 12]],
      hedge: [['whiteash', 20], ['blackcherry', 25], ['redmaple', 15], ['sugarmaple', 15], ['redoak', 10], ['hemlock', 5]],
      yard: [['sugarmaple', 35], ['redmaple', 20], ['redoak', 10], ['birch', 10], ['whitepine', 10], ['spruce', 10], ['blackcherry', 5]],
      street: [['sugarmaple', 40], ['redmaple', 30], ['whiteash', 10], ['redoak', 20]],
      pasture: [['sugarmaple', 40], ['redoak', 35], ['whiteash', 15], ['willow', 10]],
      orn: [['jmaple', 22], ['crabapple', 22], ['bluespruce', 18], ['arborvitae', 16], ['birchclump', 22]],
      arbor: [['arborvitae', 1]],
      ...(this.profile.treeMix || {}),   // (a map's own mix by role: NYC's park — elms, London planes, oaks, tupelo)
    };
    MIX.avenue ||= MIX.osm || MIX.street;
    /** A tree of `role` at (x, z) if it fits (shrunk to clear a roof or the road if it must): true if placed. */
    // (a hero area's singletrack — narrow, so the camera rides close to everything beside it: no low crown or brush
    //  card within 10 m, where it would be all magnified blur)
    const nearCf = (x, z) => { const r = this.roadNear(x, z, 11); return !!(r && r.e._cf && r.d - r.half < 10); };
    // (extra — [zwift-look] park planting: { lean: [lx, lz] the top's offset per metre up, overhang: may reach over the way })
    const tree = (x, z, role, seed, age = null, extra = null) => {
      if (nearCf(x, z)) return false;
      const r1 = hash(seed * 7.13 + 1), r2 = hash(seed * 3.71 + 2), r3 = hash(seed * 9.17 + 3), r4 = hash(seed * 1.93 + 4);
      // ~6% dead (user, 23 Nov): snags in the woods, wet ground, hedgerows and pastures, a few by the road; none in yards or on streets
      const dead = role !== 'yard' && role !== 'street' && role !== 'osm' && kit.snag && hash(seed * 5.37 + 9) < .06;
      const name = dead ? 'snag' : pick(MIX[role], r1), sp = kit[name];
      // the age mix: saplings and young trees, mostly mature, a few old giants away from the road
      let k = age ?? (r2 < .08 ? .3 + r2 * 2.5 : r2 < .22 ? .55 + (r2 - .08) * 1.8 : r2 > .95 ? 1.15 + (r2 - .95) * 3 : .85 + (r2 - .22) * .32);
      k *= .92 + r3 * .16;
      const de = edgeOf(x, z);
      const mapped = role === 'osm';   // (a map's own mapped trees — NYC's Mall elms: where OSM puts them, close to the walk, the crowns over it)
      const over = !!extra?.overhang;
      if (de < (mapped ? 1.5 : over ? 3 : 4)) return false;   // trunks ≥ 4 m from the road's edge (3 m: an avenue's)
      if (k > 1.1 && de < 25) k = 1;
      // a crown reaching over the road: smaller, so it clears the chase camera (an avenue's: let to arch over, its
      // crown high above the camera)
      if (sp.r * k > de + 1.5 && !mapped && !over) k = Math.max(.45, (de + 1.5) / sp.r);
      let crown = sp.r * k * .85;
      if (!clearOf(x, z, crown, mapped)) { k *= .6; crown = sp.r * k * .85; if (k < .35 || !clearOf(x, z, crown, mapped)) return false; }
      const T = { x, z, y: W._groundH(x, z) - .15, sp: name, v: this.fall ? fallVariant(sp, r4, this.peak) : 0, s: k, sy: k * (.94 + r3 * .12), rot: seed * 40 % 6.283, tint: .9 + r3 * .18, deep: de > 30 };
      if (extra?.lean && !/pine|hemlock|spruce|arborvitae/.test(name)) T.lean = extra.lean;
      out.push(T);
      return true;
    };
    const under = (x, z, name, seed, s = 1) => {
      if (edgeOf(x, z) < 2.5 || !clearOf(x, z, 1.5) || (!/fern|rock|stump|log/.test(name) && nearCf(x, z))) return;
      out.push({ x, z, y: W._groundH(x, z) - .05, sp: name, v: 0, s: s * (.8 + hash(seed) * .5), rot: seed * 23 % 6.283, tint: .9 + hash(seed * 3) * .2 });
    };
    // a stand of trees round each rail approach's end: the line runs off into the woods
    for (const R of this._railZones) for (const E of R.ends) {
      if (E.x < x0 - 30 || E.x >= x0 + TILE + 30 || E.z < z0 - 30 || E.z >= z0 + TILE + 30) continue;
      for (let k = 0; k < 26; k++) {
        const h = hash(k * 7.7 + E.x), along = E.s * (2 + hash(k * 3.1 + E.z) * 30), across = (hash(k * 5.3 + E.x * .1) - .5) * 26;
        const x = E.x + R.u.x * along + R.v.x * across, z = E.z + R.u.z * along + R.v.z * across;
        if (x < x0 || x >= x0 + TILE || z < z0 || z >= z0 + TILE) continue;
        // (past the end the strip is clear: trees may stand on the line's continuation, in front of it)
        if (h < .2) under(x, z, h < .1 ? 'buckthorn' : 'sapling', k + E.x); else tree(x, z, 'woods', Math.round(x * 13 + z * 7) + k, .7 + h * .4);
      }
    }
    // OSM's mapped trees
    for (const p of this.osmTrees.get(t.key) || []) tree(p.x, p.z, MIX.osm ? 'osm' : this.urban(p.x, p.z) ? 'yard' : 'woods', Math.round(p.x * 7 + p.z * 13));   // (a map's own mix for them: NYC's elms and planes)
    // street trees in the villages (the urban streets with a sidewalk or a verge)
    for (const piece of W.tiles.get(t.key)?.pieces || []) {
      if (due()) yield;
      const e = piece.e;
      if (!ROADS.has(e.kind) || e.kind === 'alley') continue;
      const half = W.wOf(e) / 2, walk = W.walkOf ? W.walkOf(e) : 0;
      for (let i = Math.max(piece.a, 2); i < Math.min(piece.b, e.n - 1); i += 2) {
        if (e._deck?.[i] || hash(e.id.length * 977 + i * 131 + e.n) < .4) continue;
        const dx = e.x[i + 1] - e.x[i - 1], dz = e.z[i + 1] - e.z[i - 1], l = Math.hypot(dx, dz) || 1;
        for (const side of [-1, 1]) {
          const off = half + (walk ? walk + 1.6 : 4.5), x = e.x[i] - dz / l * off * side, z = e.z[i] + dx / l * off * side;
          if (!this.urban(x, z) || hash(i * 17 + side * 5 + e.n * 3) < .5) continue;
          tree(x, z, 'street', i * 7 + side + e.n * 11, .7 + hash(i * 3 + side) * .3);
        }
      }
    }
    // yard trees: beside or behind each house (its front faces the road), rarely in front
    for (const b of this.host.buildingChunks.get(t.key) || []) {
      const R = this.kit.plans.get(b.k); if (!R || b.hidden || R.inCanal) continue;
      const r = R.rects?.[0] ?? R.rects?.get?.(0); if (!r) continue;
      const back = [[0, 1], [-1, 0], [0, -1], [1, 0]][R.front] || [0, 1];   // (front 0: −v, 1: +u, 2: +v, 3: −u)
      const n = 1 + Math.floor(hash(b.k * 1.7) * 3.2);
      for (let q = 0; q < n; q++) {
        const h = hash(b.k * 5.3 + q * 11), sideways = q % 2 === 1;
        const [au, av] = sideways ? [back[1] === 0 ? 0 : (h < .5 ? -1 : 1), 0] : back;
        const du = sideways ? (h < .5 ? -1 : 1) * (r.hu + 4 + h * 4) : au * (r.hu + 5 + h * 8) + (hash(q + b.k) - .5) * r.hu * 1.6;
        const dv = sideways ? (hash(q * 3 + b.k) - .5) * r.hv : av * (r.hv + 5 + h * 8) + (hash(q * 7 + b.k) - .5) * r.hv * 1.4;
        const x = r.cx + r.ux * du + r.vx * dv, z = r.cz + r.uz * du + r.vz * dv;
        tree(x, z, 'yard', b.k * 13 + q, .65 + h * .45);
      }
      // ornamentals (user, 23 Nov): by the front corners or a step out in the side yard — a Japanese maple, a crab, a blue
      // spruce, arborvitae, a birch clump; now and then a row of arborvitae along a side lot line
      if (hash(b.k * 2.9) < .75 && (R.kind === 'house' || R.kind === 'village-house' || R.kind === 'farmhouse-ny')) {
        const fu = -back[0], fv = -back[1], m = 1 + (hash(b.k * 4.1) < .45 ? 1 : 0);
        for (let q = 0; q < m; q++) {
          const h = hash(b.k * 6.7 + q * 3.3), side = (q === 0) === (h < .5) ? -1 : 1, out = 2.5 + h * 3.5;
          const du = fu ? fu * (r.hu + out) : side * (r.hu + 1.5 + h * 2), dv = fv ? fv * (r.hv + out) : side * (r.hv + 1.5 + h * 2);
          const x = r.cx + r.ux * du + r.vx * dv, z = r.cz + r.uz * du + r.vz * dv;
          tree(x, z, 'orn', b.k * 17 + q, .8 + h * .3);
        }
        if (hash(b.k * 8.3) < .12) {   // an arborvitae row down one side
          const sg = hash(b.k * 9.1) < .5 ? -1 : 1;
          for (let q = 0; q < 5; q++) {
            const along = (q / 4 - .5) * 2 * (fu ? r.hv : r.hu) * 1.2, du = fu ? sg * (r.hu + 4) : along, dv = fu ? along : sg * (r.hv + 4);
            tree(r.cx + r.ux * du + r.vx * dv, r.cz + r.uz * du + r.vz * dv, 'arbor', b.k * 19 + q, .9);
          }
        }
      }
      if ((b.k & 7) === 0) yield;
    }
    // the old-growth hero area's own stands, floor and debris (toolbox/vegetation/old-growth.js), on its own codes
    const og = this.oldGrowth;
    if (og?.touches(x0, z0, TILE)) yield* og.treesJob(x0, z0, TILE, out, this.treeKit, (x, z, r) => clearOf(x, z, r));
    // the land cover: woods (edges graded), wetland, hedgerows between fields, the odd pasture tree
    const step = 8;
    for (let x = x0 + step / 2; x < x0 + TILE; x += step) for (let z = z0 + step / 2; z < z0 + TILE; z += step) {
      if (z === z0 + step / 2 && due()) yield;
      const h1 = hash(Math.round(x * 3.1) * 92821 + Math.round(z * 1.7)), jx = x + (h1 - .5) * step * .9, jz = z + (hash(Math.round(x * 5.3) + Math.round(z * 7.9) * 31) - .5) * step * .9;
      const c = this.landAt(jx, jz), seed = Math.round(jx * 11) + Math.round(jz * 13) * 7, h2 = hash(seed * 1.31);
      if (c >= LAND.oldGrowth && c <= LAND.ogBlowdown) continue;   // (the hero area's: placed above)
      if (c === LAND.woods || c === LAND.outside) {
        // how open it is round here: the woodlot's edge
        let open = 0; for (const [ox, oz] of [[11, 0], [-11, 0], [0, 11], [0, -11]]) if (this.landAt(jx + ox, jz + oz) !== c) open++;
        const de = edgeOf(jx, jz);
        if (open >= 1 && h2 < .45) {
          // the graded edge: shrubs, sumac (scarlet now), saplings, goldenrod
          const r = hash(seed * 2.9);
          if (r < .3) under(jx, jz, r < .15 ? 'dogwood' : 'buckthorn', seed);
          else if (r < .45) under(jx, jz, r < .38 ? 'sumac' : 'sumac2', seed);
          else if (r < .65) under(jx, jz, 'sapling', seed, .9);
          else if (r < .8) tree(jx, jz, 'woods', seed, .4 + r * .3);
          else under(jx, jz, 'goldenrod', seed);
          continue;
        }
        // the forest floor near the road (user, 23 Nov: "forest understory … 2D sprite ferns", with logs, stumps and rocks):
        // ferns in clumps where the ground's damp and shaded (a slow patchiness), a fallen log, a stump, a mossy rock
        const ferny = vnoise(jx / 17 + 4.1, jz / 17 - 2.7), fernAt = (fx, fz, k) => { if (hash(seed * 7.3 + k) < ferny * 1.1 - .15) under(fx, fz, hash(seed * 9.1 + k) < .5 ? 'fern' : 'fern2', seed * 3.7 + k, .75 + ferny * .5); };
        if (h1 < (c === LAND.woods ? .82 : .45) * this.q.trees) { if (!tree(jx, jz, this.world.nearWater?.(jx, jz) ? 'wet' : 'woods', seed) && de < 90) fernAt(jx, jz, 0); }
        else if (de < 90 && de > 4) {
          const r = hash(seed * 4.1);
          if (r < .06) under(jx, jz, r < .035 ? 'log' : r < .05 ? 'stump' : 'stump2', seed);
          else if (r < .1) under(jx, jz, r < .085 ? 'rock' : 'rock2', seed);
          else fernAt(jx, jz, 1);
        }
        // a second fern in a clump, a step off
        if (c === LAND.woods && de < 90 && de > 4 && ferny > .4) for (let q = 0; q < 3; q++) fernAt(jx + (hash(seed * 5.1 + q) - .5) * 6, jz + (hash(seed * 5.5 + q) - .5) * 6, 2 + q);
      } else if (c === LAND.wetland) {
        if (h1 < .25) tree(jx, jz, 'wet', seed); else if (h1 < .4) under(jx, jz, 'dogwood', seed);
      } else if (FIELD(c) && c !== LAND.farmyard) {
        // a hedgerow where this field meets another (a different crop, rows, or the woods)
        let edge = false; for (const [ox, oz] of [[6, 0], [-6, 0], [0, 6], [0, -6]]) { const n = this.landAt(jx + ox, jz + oz); if (n !== c && (FIELD(n) || n === LAND.woods)) { edge = true; break; } }
        if (edge) { if (h1 < .32) tree(jx, jz, 'hedge', seed); else if (h1 < .55) under(jx, jz, h1 < .45 ? 'buckthorn' : 'sumac', seed); }
        else if (c === LAND.pasture && h1 < .006) tree(jx, jz, 'pasture', seed, 1.05 + h2 * .2);
      } else if (c === LAND.yards || c === LAND.grass) {
        // (openLawns — NYC: the lawns stay open, their trees in the margins along the paths and the woods' edges)
        if (this.profile.openLawns && c === LAND.grass) {
          let edge = false; for (const [ox, oz] of [[14, 0], [-14, 0], [0, 14], [0, -14]]) if (this.landAt(jx + ox, jz + oz) !== LAND.grass) { edge = true; break; }
          if (edge ? h1 < .22 : h1 < .006) tree(jx, jz, 'yard', seed);
        } else if (h1 < (c === LAND.yards ? (this.rural ? .02 : .1) : this.rural ? .008 : .06)) tree(jx, jz, 'yard', seed);
      } else if (!this.rural && c === LAND.paved) {
        if (h1 < .008) tree(jx, jz, 'street', seed, .8);
      }
    }
    // roadside thickets: sumac (scarlet now), dogwood and buckthorn in clumps behind the brush, every so often
    if (this.rural) for (const piece of W.tiles.get(t.key)?.pieces || []) {
      const e = piece.e; if (!ROADS.has(e.kind) || e.kind === 'alley' || (W.walkOf && W.walkOf(e))) continue;
      const half = W.wOf(e) / 2;
      for (let i = Math.max(piece.a, 1); i < Math.min(piece.b, e.n - 1); i += 2) for (const side of [-1, 1]) {
        const h = hash(e.x[i] * .173 + e.z[i] * .291 + side * 3.7); if (h > .22) continue;
        const dx = e.x[i + 1] - e.x[i], dz = e.z[i + 1] - e.z[i], l = Math.hypot(dx, dz) || 1, nx = -dz / l * side, nz = dx / l * side;
        const lc = this.landAt(e.x[i] + nx * (half + 7), e.z[i] + nz * (half + 7));
        if (lc === LAND.yards || lc === LAND.paved || lc === LAND.building || lc === LAND.plaza) continue;
        const n = 3 + Math.floor(h * 14);
        for (let k = 0; k < n; k++) {
          const r = hash(h * 97 + k * 3.3), along = (r - .5) * 9, d = half + 5.8 + hash(h * 13 + k) * 3;
          const x = e.x[i] + dx / l * along + nx * d, z = e.z[i] + dz / l * along + nz * d, seed = Math.round(x * 7 + z * 13) + k;
          under(x, z, r < .55 ? (r < .3 ? 'sumac' : 'sumac2') : r < .8 ? 'buckthorn' : 'dogwood', seed);
        }
      }
    }
    // [zwift-look] the park planting along the ways (profile.avenue, profile.understory: park-planting.js)
    if (this.profile.avenue || this.profile.understory) {
      const G = new Map(), C = 6, gk = (x, z) => Math.floor(x / C) * 100003 + Math.floor(z / C);
      for (const o of out) { const k = gk(o.x, o.z); (G.get(k) || G.set(k, []).get(k)).push(o); }
      const occupied = (x, z, r) => { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const o of G.get(gk(x + a * C, z + b * C)) || []) if (Math.hypot(o.x - x, o.z - z) < r && kit[o.sp]) return true; return false; };
      const landOk = (x, z) => { const c = this.landAt(x, z); return c !== LAND.water && c !== LAND.building && c !== LAND.plaza && c !== LAND.paved && !this.inWater(x, z) && !(c >= LAND.oldGrowth && c <= LAND.ogBlowdown); };
      yield* planParkPlanting({ pieces: (W.tiles.get(t.key)?.pieces || []).filter((p) => !p.e._cf), half: (e) => W.wOf(e) / 2, walk: (e) => (W.walkOf ? W.walkOf(e) : 0),
        tree, under, occupied, landOk, avenue: this.profile.avenue, understory: this.profile.understory });
    }
    yield;
    plantTile(this.forest, t.key, out);   // [blocks] the planting API
    t.trees = out;
    // the trees' stand-ins for the baked shadows (graph-world: golden hour baked): a crown and a trunk each, never drawn
    if (this.world.baked) { const px = {}; yield; yield* treeProxiesJob(out, kit, px); if (px.mesh) this._add(t, px.mesh); }
    this.stats.trees += out.length;
  }

  // ------------------------------------------------------------------ homesteads (rural maps)
  /** The nearest way of a kind a driveway meets (not a trail), searched out to maxR. */
  _roadNearFar(x, z, maxR) {
    let best = null; const R = Math.ceil(maxR / 20), gx = Math.floor(x / 20), gz = Math.floor(z / 20), w = this.world;
    for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) {
      const arr = this._segGrid.get(cellKey(gx + a, gz + b)); if (!arr) continue;
      for (let k = 0; k < arr.length; k += 2) {
        const e = arr[k], i = arr[k + 1];
        if (e.kind === 'path' || e._deck?.[i]) continue;
        const ax = e.x[i], az = e.z[i], dx = e.x[i + 1] - ax, dz = e.z[i + 1] - az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
        if (d > maxR || (best && d >= best.d)) continue;
        const l = Math.sqrt(l2); best = { e, i, d, px, pz, half: w.wOf(e) / 2, y: e.ele[i] + (e.ele[i + 1] - e.ele[i]) * t, dx: dx / l, dz: dz / l };
      }
    }
    return best;
  }
  /** Each house's driveway, mailbox and outbuildings (toolbox/city/homesteads.js), planned before the trees. */
  *_planHomesteads(t) {
    const ctx = {
      roadNear: (x, z, r) => this._roadNearFar(x, z, r),
      free: (x, z, pad) => !canalAt(x, z, pad + 1) && !this.host.buildingNear(x, z, pad) && !this.kit.occupied(x, z, pad) && !this.onRoad(x, z, pad + 1) && !this.inWater(x, z) && !this._railCovers(x, z, pad),
    };
    t.homes = [];
    for (const b of this.host.buildingChunks.get(t.key) || []) {
      const R = this.kit.plans.get(b.k);
      if (!R || b.hidden || R.inCanal || !['house', 'village-house', 'farmhouse-ny'].includes(R.kind)) continue;
      const H = planHomestead(R, ctx);
      if (H) t.homes.push(H);
      if (due()) yield;
    }
    this._curHomes = t.homes;
  }
  _drivewayNear(x, z, r) { return nearDrive(this._curHomes || [], x, z, r); }
  *_drawHomesteads(t) {
    if (!t.homes?.length) return;
    const g = (x, z) => this.world._groundH(x, z);
    for (const H of t.homes) { drawHomestead(t.kitM, H, g); if (due()) yield; }
    // the homes' parked cars (on the drive by the house; a farm's often a truck)
    const P = new ParkedCars();
    for (const H of t.homes) if (H.car) { const c = H.car; P.add(c.x, g(c.x, c.z) + 0.03, c.z, c.yaw, pickCar(seeded(c.seed), 'rural', c.setting)); this.stats.cars++; }
    this._parked(t, P);
    // front yards (the "frontYards" effect: toolbox/city/front-yards.js): fences, hedges, foundation shrubs, beds
    if (this.world.frontYards) {
      const ctx = { free: (x, z, pad) => !canalAt(x, z, pad + 1) && !this.host.buildingNear(x, z, pad) && !this.kit.occupied(x, z, pad) && !this.onRoad(x, z, pad + 1) && !this.inWater(x, z), driveNear: (x, z, r) => this._drivewayNear(x, z, r) };
      let n = 0;
      for (const H of t.homes) { if (due()) yield; const R = this.kit.plans.get(H.key); if (R && drawFrontYard(t.kitM, planFrontYard(R, H, ctx, this.world.frontYards), g)) n++; }
      this.stats.frontYards = (this.stats.frontYards || 0) + n;
    }
    const geo = driveStrips(t.homes, g);
    if (geo) { const m = new THREE.Mesh(geo, this.lotMaterial); m.name = `Driveways ${t.key}`; m.receiveShadow = true; this._add(t, m); }
    this.stats.driveways = (this.stats.driveways || 0) + t.homes.length;
  }

  // ------------------------------------------------------------------ fields and roadsides (rural maps)
  /** The crop at (x, z) for the 3D rows: CNY's corn fields (codes 20–23, their rows' heading in the code), SKAN's
   *  WorldCover cropland (code 10: the ground shader's own field pick, js/world/toolbox/landscape/farm-kit.js). */
  _cropAt(x, z) {
    const c = this.landAt(x, z);
    if (c >= 20 && c <= 23) {
      const a = (c - 20) * Math.PI / 4, ns = Math.sign(this.landBox.z0 - this.landBox.z1) || 1;
      return { crop: 'corn', heading: Math.atan2(ns * Math.sin(a), Math.cos(a)), per: .9 };
    }
    if (c === LAND.crops) { const k = skanCrop(x, z); return { crop: k.crop, heading: k.heading + Math.PI / 2 }; }
    if (c === 28) return { crop: 'hay', heading: 0 };
    if (c >= 24 && c <= 27) return { crop: 'stubble', heading: 0 };
    return null;
  }
  *_farmland(t) {
    const W = this.world, x0 = t.i * TILE, z0 = t.j * TILE, g = (x, z) => W._groundH(x, z), M = t.kitM;
    // standing corn and soybeans: row cards, near the camera only
    this.cropMat ||= cropMaterial(this.treeTime);
    // (the standing crops only near the camera, as the verges: drawn to 300 m, built within VERGE_IN + 80; ~136 MB on
    //  High when every loaded tile's were built)
    if (Math.hypot(t.cx - W.camera.position.x, t.cz - W.camera.position.z) - TILE * .71 < VERGE_IN + 80) yield* this._cropsJob(t); else t.cropsPending = true;
    yield;
    // round bales on the hay and the stubble
    for (let x = x0 + 11; x < x0 + TILE; x += 22) for (let z = z0 + 11; z < z0 + TILE; z += 22) {
      const h = hash(Math.round(x) * 7.1 + Math.round(z) * 3.3), jx = x + (h - .5) * 16, jz = z + (hash(h * 91) - .5) * 16;
      const c = this._cropAt(jx, jz), lc = this.landAt(jx, jz);
      const p = c?.crop === 'hay' ? .3 : c?.crop === 'stubble' ? .12 : lc === LAND.pasture ? .03 : 0;
      if (h >= p || this.onRoad(jx, jz, 6) || this.host.buildingNear(jx, jz, 4) || this.inWater(jx, jz)) continue;
      const n = 1 + Math.floor(hash(h * 13) * 3);   // ones and twos and threes, as the baler dropped them
      for (let k = 0; k < n; k++) bale(M, jx + k * 2.1 * Math.cos(h * 9), g(jx, jz), jz + k * 2.1 * Math.sin(h * 9), h * 9 + k * .2, hash(h * 5) < .3, hash(h * 17 + k));
      // now and then a hay wagon left out by the bales, half loaded
      if (c?.crop === 'hay' && hash(h * 23) < .12) { const wx = jx + Math.cos(h * 9 + 1.6) * 5, wz = jz + Math.sin(h * 9 + 1.6) * 5; if (!this.onRoad(wx, wz, 4) && !this.host.buildingNear(wx, wz, 4)) hayWagon(M, wx, g(wx, wz), wz, h * 9 + .4, hash(h * 29)); }
    }
    yield;
    // the country roads' edges: the ditch, its grass and brush, the poles (_roadsides); then fence and wall runs
    // (the grass and brush only for a tile near the camera — drawn to 240 m, built within VERGE_IN, dropped beyond
    // VERGE_OUT: user, 23 Nov, phones reloading — every loaded tile's verge to 1.3 km was 270–420 MB of geometry)
    const N = new MeshBuilder({ aGlow: 1 }), vNear = this.gfx.verge && Math.hypot(t.cx - W.camera.position.x, t.cz - W.camera.position.z) - TILE * .71 < VERGE_IN;
    yield* this._roadsides(t, N, M, vNear ? 'all' : 'struct');
    if (!vNear) t.vergePending = true;
    for (const piece of W.tiles.get(t.key)?.pieces || []) {
      if (due()) yield;
      const e = piece.e; if (!ROADS.has(e.kind) || e.kind === 'alley') continue;
      const half = W.wOf(e) / 2, walk = W.walkOf ? W.walkOf(e) : 0;
      if (walk) continue;   // (a village street with sidewalks: no fences, no verge)
      for (let i = Math.max(piece.a, 1); i < Math.min(piece.b, e.n - 1); i++) {
        if (e._deck?.[i] || e._deck?.[i + 1]) continue;
        const dx = e.x[i + 1] - e.x[i], dz = e.z[i + 1] - e.z[i], l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
        for (const side of [-1, 1]) {
          const at = (k, off) => ({ x: e.x[k] + nx * off * side, z: e.z[k] + nz * off * side });
          // fences and walls, in runs of ~60 m chosen by what's beside the road
          if (i < 2 || i > e.n - 3) continue;
          const blk = Math.floor(i / 6), hb = hash(e.n * 1.31 + blk * 7.7 + side * 3.3 + e.x[0] * .01);
          const o = half + 5.5, a = at(i, o), b = at(i + 1, o), m = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
          const lc = this.landAt(m.x + nx * side * 4, m.z + nz * side * 4), cr = this._cropAt(m.x + nx * side * 4, m.z + nz * side * 4);
          const pasture = lc === LAND.pasture || cr?.crop === 'hay', woodsOrCrop = lc === LAND.woods || (cr && cr.crop !== 'hay');
          const kind = pasture ? (hb < .55 ? 'wire' : hb < .7 ? 'board' : null) : woodsOrCrop ? (hb < .3 ? 'stone' : null) : null;
          if (!kind || this._railCovers(m.x, m.z, 1) || this.urban(m.x, m.z) || this.inWater(m.x, m.z) || this.host.buildingNear(m.x, m.z, 2) || this._drivewayNear(m.x, m.z, 2) || this.onRoad(m.x, m.z, 1)) continue;
          bay(M, kind, a, b, g(a.x, a.z), g(b.x, b.z), hb * 1000 + i);
          if (kind !== 'stone') { const mm = at(i, o), q = at(i + 1, o); bay(M, kind, { x: (mm.x + q.x) / 2, z: (mm.z + q.z) / 2 }, q, g((mm.x + q.x) / 2, (mm.z + q.z) / 2), g(q.x, q.z), hb); }
        }
      }
    }
    if (vNear) yield* this._canalScrub(t, N);
    // the wires: no shadow, baked or live (a 2.5 cm wire's shadow drew as a thick black line across the road)
    if (t.wireM?.count) { const m = gpuOnly(new THREE.Mesh(t.wireM.geometry(), this._wireMat())); m.name = `Wires ${t.key}`; m.castShadow = false; m.userData.bake = false; this._add(t, m); }
    t.wireM = null;
    if (N.count) { const m = new THREE.Mesh(N.geometry(), this.vergeMat); m.name = `Verge ${t.key}`; m.userData.lodM = 240; const d = Math.hypot(t.cx - W.camera.position.x, t.cz - W.camera.position.z) - TILE * .71; m.visible = d < 240; this._add(t, this._gpuOnly(m), 'near'); t.vergeMesh = m; }
    // a farm stand by some farmhouses' drives (pumpkins and squash: it's September)
    for (const H of t.homes || []) {
      if (H.kind !== 'farmhouse-ny' || hash(H.key * 3.7) > .3) continue;
      const r = H.road, x = r.px + r.ox * (W.wOf ? 6 : 6) + r.dx * 6, z = r.pz + r.oz * 6 + r.dz * 6;
      if (this.onRoad(x, z, 1.5) || this.host.buildingNear(x, z, 2) || this._drivewayNear(x, z, 1)) continue;
      farmStand(M, x, g(x, z), z, Math.atan2(r.ox, r.oz));
      // a customer or two at the stand, and now and then the farmer behind it
      { const yaw = Math.atan2(r.ox, r.oz), fx = Math.sin(yaw), fz = Math.cos(yaw); for (let q = 0; q < 1 + (hash(H.key * 1.9) < .5 ? 1 : 0); q++) { const sx = x - fx * 1.6 + r.dx * (q - .5) * .9, sz = z - fz * 1.6 + r.dz * (q - .5) * .9; t.spots.push({ x: sx, z: sz, y: g(sx, sz), yaw, kind: 'stand' }); }
        if (hash(H.key * 4.1) < .5) t.spots.push({ x: x + fx * 1.2, z: z + fz * 1.2, y: g(x + fx * 1.2, z + fz * 1.2), yaw: yaw + Math.PI, kind: 'idle' }); }
    }
  }

  /** A soft plant card (grass-cards.js): its size by kind and scale, a per-plant tint and turn. */
  _card(N, x, y, z, seed, cell, sc) {
    const SZ = [[.75, .38], [1.05, .95], [1.15, 1.3], [.95, 1.05]][cell], k = hash(seed * 7.7 + 3.1);
    const tint = (this._tint ||= new THREE.Color()).setRGB(.62 + k * .18, .66 + hash(seed * 5.3) * .16, .58 + hash(seed * 2.9) * .14);
    grassCard(N, x, y, z, cell, SZ[0] * (.8 + k * .4) * Math.min(1.3, sc), SZ[1] * sc, seed * 6.283, tint);
  }
  /**
   * The wires' material (user, 24 Nov — Zwift parity: "less shimmer on wires"): a wire 5 cm thick is under a pixel
   * past ~40 m and crawls as it comes and goes between pixels; here each vertex is pushed out along its normal so the
   * wire is never thinner than about a pixel on screen, and fades to the sky's colour as it thins further (no flicker).
   */
  _wireMat() {
    if (this.wireMat) return this.wireMat;
    const m = new THREE.MeshLambertMaterial({ color: '#2a2a28' });
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying float vThin;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          { vec4 wp = modelMatrix * vec4(position, 1.); float d = length(wp.xyz - cameraPosition);
            float px = d * 2. / (projectionMatrix[1][1] * 900.);   // ~a pixel's size at that distance (a 900 px tall view)
            float r = .025, want = max(r, px * .7);
            transformed += normal * (want - r); vThin = r / want; }`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vThin;')
        .replace('#include <opaque_fragment>', 'outgoingLight = mix(outgoingLight * 1.9 + vec3(.25), outgoingLight, clamp(vThin * 1.6, 0., 1.));\n#include <opaque_fragment>');
    };
    m.customProgramCacheKey = () => 'graph-wires-1';
    return (this.wireMat = m);
  }
  /** A tile's standing crops (row cards), built when the camera comes near it. */
  *_cropsJob(t) {
    const W = this.world, x0 = t.i * TILE, z0 = t.j * TILE, g = (x, z) => W._groundH(x, z);
    t.cropsPending = false;
    const cc = {}; yield* cropCardsJob(x0, z0, TILE, (x, z) => this._cropAt(x, z), g, cc); const geo = cc.geo;
    if (geo) { const m = gpuOnly(new THREE.Mesh(geo, this.cropMat)); m.name = `Crops ${t.key}`; m.userData.lodM = 300; m.userData.bake = false; const d = Math.hypot(t.cx - W.camera.position.x, t.cz - W.camera.position.z) - TILE * .71; m.visible = d < 300; this._add(t, m, 'near'); t.cropsMesh = m; }
  }
  /** A tile's verge grass and brush (and the canal's bank scrub), built when the camera comes near it. */
  *_vergeJob(t) {
    const W = this.world, N = new MeshBuilder({ aGlow: 1 });
    yield* this._roadsides(t, N, new MeshBuilder(), 'grass');
    yield* this._canalScrub(t, N);
    t.vergePending = false;
    if (!N.count) return;
    const m = new THREE.Mesh(N.geometry(), this.vergeMat); m.name = `Verge ${t.key}`; m.userData.lodM = 240;
    m.visible = Math.hypot(t.cx - W.camera.position.x, t.cz - W.camera.position.z) - TILE * .71 < 240;
    this._add(t, this._gpuOnly(m), 'near'); t.vergeMesh = m;
  }
  /** The graphics menu (laptops; user, 23 Nov): how far the city's tiles reach, how many trees new tiles plant, the
   *  verges' grass and brush, and the people, parked cars and farm animals. */
  setGfx({ distance = 1, trees = 1, verge = true, life = true } = {}) {
    const base = capReach(REACH[this.world.qualityKey] || REACH.balanced);
    this.q = { ...base, near: base.near * distance, far: base.far * distance, trees: base.trees * trees };
    this.gfx = { distance, trees, verge, life };
    if (!verge) { for (const t of this.tiles.values()) this._dropVerge(t); this._vjob = null; }
    for (const c of [this.life?.bikes, this.life?.walkers, this.life?.locals]) for (const m of c?.meshes || []) m.visible = life;
  }
  /** The verge's arrays let go once they're on the GPU (no second copy in the page's memory: phones). */
  _gpuOnly(m) { m.geometry.computeBoundingSphere(); m.geometry.computeBoundingBox(); for (const a of Object.values(m.geometry.attributes)) a.onUpload(function () { this.array = null; }); if (m.geometry.index) m.geometry.index.onUpload(function () { this.array = null; }); return m; }
  /** A far tile's verge dropped (built again when the camera comes back). */
  _dropVerge(t) {
    const m = t.vergeMesh; if (!m) return;
    this.host.group.remove(m); m.geometry.dispose();
    t.meshes = t.meshes.filter((r) => r.m !== m); t.near = t.near.filter((x) => x !== m);
    t.vergeMesh = null; t.vergePending = true;
  }
  /**
   * The country roads' edges (roadside-ny.js), every ~2 m along both sides of each road without sidewalks:
   *   the ditch strip (where the ground is a shelf under the road; broken by driveways, a culvert's ends showing),
   *   a mowed strip of short grass and the odd wildflower to ~2.5 m, then unmowed brush on the berm and out to the
   *   fence line (goldenrod, Queen Anne's lace, chicory, tall grass; cattails in the wet bottoms) — lawns stay mowed,
   *   and now and then the crew mowed farther; utility poles every ~40 m along one side, wires between them.
   */
  *_roadsides(t, N, M, mode = 'all') {
    // mode: 'all'; 'struct' — the ditches, culverts, poles and wires only (a tile built far off: its grass and brush
    // come later, _vergeJob); 'grass' — the grass and brush only
    const W = this.world, sH = (x, z) => W.surfaceH(x, z), runs = [], grass = mode !== 'struct', struct = mode !== 'grass';
    const STEP = 5;   // stations per 10 m sample
    for (const piece of W.tiles.get(t.key)?.pieces || []) {
      if (due()) yield;
      const e = piece.e; if (!ROADS.has(e.kind) || e.kind === 'alley') continue;
      const half = W.wOf(e) / 2, walk = W.walkOf ? W.walkOf(e) : 0;
      if (walk) continue;
      const i0 = Math.max(piece.a, 1), i1 = Math.min(piece.b, e.n - 1);
      if (i1 <= i0) continue;
      // the normal at a sample (from its neighbours: mitred at the bends)
      const nAt = (k) => { const a = Math.max(0, k - 1), b = Math.min(e.n, k + 1), dx = e.x[b] - e.x[a], dz = e.z[b] - e.z[a], l = Math.hypot(dx, dz) || 1; return [-dz / l, dx / l, dx / l, dz / l]; };
      const poleSide = hash(e.n * .71 + e.x[0] * .013 + e.z[0] * .007) < .5 ? -1 : 1;
      for (const side of [-1, 1]) {
        let run = [], prevDrive = false, last = null;
        const close = () => { if (run.length > 1) runs.push(run); run = []; };
        for (let i = i0; i < i1; i++) {
          if (due()) yield;   // (each 10 m: a long country road's verge was one 100–180 ms block — the stutter, 23 Nov)
          const deck = e._deck?.[i] || e._deck?.[i + 1];
          const nA = nAt(i), nB = nAt(i + 1);
          for (let f = 0; f <= (i === i1 - 1 ? STEP : STEP - 1); f++) {
            const u = f / STEP, px = e.x[i] + (e.x[i + 1] - e.x[i]) * u, pz = e.z[i] + (e.z[i + 1] - e.z[i]) * u;
            let nx = nA[0] + (nB[0] - nA[0]) * u, nz = nA[1] + (nB[1] - nA[1]) * u; const nl = Math.hypot(nx, nz) || 1; nx = nx / nl * side; nz = nz / nl * side;
            const tx = nA[2], tz = nA[3];
            const rY = e.ele[i] + (e.ele[i + 1] - e.ele[i]) * u + ROAD_LIFT;
            const at = (d) => [px + nx * (half + d), pz + nz * (half + d)];
            const [bx, bz] = at(2.5), [ox, oz] = at(4.8), lc = this.landAt(bx, bz);
            const base = Math.min(sH(bx, bz), sH(ox, oz));
            const drive = this._drivewayNear(bx, bz, .6);
            const hard = deck || canalAt(bx, bz, 1) || lc === LAND.water || lc === LAND.paved || lc === LAND.building || lc === LAND.plaza || this.inWater(bx, bz) || this._railCovers(bx, bz, 1)
              || this.onRoad(bx, bz, .2) || this.onRoad(ox, oz, 0) || this.host.buildingNear(ox, oz, .8);
            const ok = !hard && !drive && ditchFits(rY, base);
            const seed = hash(px * .913 + pz * .377 + side * 5.1);
            // the ditch run (and a culvert's ends where a driveway breaks it)
            if (ok) {
              if (prevDrive && last && struct) { culvertEnd(M, bx - tx * .2, base, bz - tz * .2, tx, tz, seed); }
              const row = { x: px + nx * half, z: pz + nz * half, nx, nz, rY, base, side };
              run.push(row); last = row;
            } else {
              if (drive && run.length && struct) { const r = run[run.length - 1]; const cx = r.x + r.nx * 2.5, cz = r.z + r.nz * 2.5; culvertEnd(M, cx + tx * .2, r.base, cz + tz * .2, -tx, -tz, seed); }
              close();
            }
            prevDrive = drive;
            if (hard || drive || !grass) continue;
            const yAt = (d) => { const [x, z] = at(d); return ok && d <= 4.8 ? profileY(d, rY, base) : sH(x, z); };
            // (user, 23 Nov: "more randomization to their placement and height to appear more natural"): each plant
            // jittered along the road and out from it, the stand's density and height following slow patches (a lush
            // run, a thin one, shorter where the mower last reached), each plant's own height varied on top
            const lush = vnoise(px / 23 + side * 7.1, pz / 23), tall = vnoise(px / 11 + 3.3, pz / 11 - side * 4.4);
            // the mowed strip: tufts and the odd wildflower
            const tufts = 2 + Math.floor(hash(seed * 23) * (1 + lush * 2.5));
            for (let r = 0; r < tufts; r++) {
              const j = (hash(seed * 29 + r) - .5) * 1.9, d = .3 + hash(seed * 13 + r * 5) * 2.1, [x0, z0] = at(d), x = x0 + tx * j, z = z0 + tz * j;
              // (wildflowers sparse and clumped: a few 14 m cells have a clump, most none — user, 23 Nov)
              const hs = hash(x * 1.3 + z * 2.1), fl = hash(Math.floor(x / 14) * 3 + Math.floor(z / 14)) < .16 && hs < .3;
              this._card(N, x, yAt(d), z, hs, fl ? CARD.lace : CARD.turf, .6 + tall * .7 + hash(seed * 37 + r) * .35);
            }
            // the ditch bottom: cattails where it stays wet, else grass
            if (ok && hash(Math.floor((px + pz) / 31) * 7.7 + side) < .14 && seed < .45) { const [x, z] = at(2.5 + (seed - .25) * .6); cattails(N, x, profileY(2.5, rY, base), z, seed, .75 + hash(seed * 41) * .5); }
            // the brush: berm out to the fence line, unless it's a lawn, or the crew mowed farther here
            const lawn = lc === LAND.yards || this.host.buildingNear(...at(10), 6);
            const mowed = hash(Math.floor((px * .7 + pz * .3) / 35) * 3.3 + e.n + side) < .18;
            if (lawn || mowed) continue;
            const reach = 3 + hash(Math.floor((px + pz * .6) / 17) * 2.9 + side) * 3.5, count = 2 + Math.floor(hash(seed * 43) * (1 + lush * 5.5));
            for (let r = 0; r < count; r++) {
              const h = hash(seed * 31 + r * 7), j = (hash(seed * 47 + r) - .5) * 2.2, d = 2.9 + Math.pow(hash(seed * 53 + r * 3), .8) * reach;
              const [x0, z0] = at(d), x = x0 + tx * j, z = z0 + tz * j;
              if (this.onRoad(x, z, .5) || this._drivewayNear(x, z, 1)) continue;
              const y = d <= 4.8 ? yAt(d) : sH(x, z), k = hash(seed * 17 + r * 3);
              // taller farther from the road and where the stand is lush; each its own
              const sc = (.55 + tall * .55 + lush * .25) * (.85 + Math.min(1, (d - 2.9) / 4) * .3) * (.75 + hash(seed * 59 + r) * .5);
              // patches of scrubby brush (sumac, dogwood, raspberry canes: user, 23 Nov "more scrubby brush"), goldenrod in
              // sparser drifts, tall grass between, the odd lace or chicory
              const drift = hash(Math.floor(x / 14) * 5.1 + Math.floor(z / 14) * 2.3), scrub = hash(Math.floor(x / 22) * 1.7 + Math.floor(z / 22) * 4.3 + side) < .38;
              if (scrub && k < .45) scrubClump(N, x, y, z, h, sc);
              else if (k < .08 + drift * .22) this._card(N, x, y, z, h, CARD.goldenrod, sc);
              else if (k < .9) this._card(N, x, y, z, h, CARD.tall, sc);
              else this._card(N, x, y, z, h, CARD.lace, sc);
            }
          }
        }
        close();
        // utility poles along one side, every 40 m; wires to the next pole (drawn by the tile with this one)
        if (side !== poleSide || !struct) continue;
        const pole = (k) => {
          if (k < 1 || k > e.n - 1 || e._deck?.[k]) return null;
          const n = nAt(k), nx = n[0] * side, nz = n[1] * side, x = e.x[k] + nx * (half + 4.4), z = e.z[k] + nz * (half + 4.4);
          if (this.onRoad(x, z, 1) || this.host.buildingNear(x, z, 1.5) || this._drivewayNear(x, z, 1) || this.inWater(x, z) || this._railCovers(x, z, 1)) return null;
          const lc = this.landAt(x, z); if (lc === LAND.paved || lc === LAND.plaza || lc === LAND.building) return null;
          return { x, z, y: sH(x, z), yaw: Math.atan2(-nz, nx), seed: hash(x * .31 + z * .77) };
        };
        // road signs (user, 23 Nov cheap wins): every ~400 m or so on a through road — a speed limit, a curve ahead
        // where it bends within the next 80 m, the odd deer crossing — on this side, facing the traffic coming
        if (e.kind !== 'path' && e.kind !== 'track' && e.kind !== 'service') for (let i = Math.ceil(i0 / 37) * 37 + 5; i < i1 - 1; i += 37) {
          const hs = hash(e.x[i] * .37 + e.z[i] * .91 + side); if (hs > .55) continue;
          const n = nAt(i), nx = n[0] * side, nz = n[1] * side, x = e.x[i] + nx * (half + 3), z = e.z[i] + nz * (half + 3);
          if (this.onRoad(x, z, .8) || this._drivewayNear(x, z, 1.5) || this.host.buildingNear(x, z, 1.5) || this.inWater(x, z)) continue;
          const j = Math.min(e.n, i + 8), turn = Math.abs(Math.atan2(n[3], n[2]) - Math.atan2(nAt(j)[3], nAt(j)[2]));
          const kind = Math.min(turn, Math.PI * 2 - turn) > .35 ? 'curve' : hs < .14 ? 'deer' : 'speed';
          roadSign(M, x, sH(x, z), z, Math.atan2(-n[2] * side, -n[3] * side), kind);
        }
        for (let i = Math.ceil(i0 / 4) * 4; i < i1; i += 4) {
          const P = pole(i); if (!P) continue;
          const A = utilityPole(M, P.x, P.y, P.z, P.yaw, P.seed);
          const Q = pole(i + 4); if (!Q) continue;
          const tmp = new MeshBuilder();   // (the next pole's attach points, without drawing it twice)
          wires(t.wireM ||= new MeshBuilder({ aGlow: 1 }), A, utilityPole(tmp, Q.x, Q.y, Q.z, Q.yaw, Q.seed));   // (their own mesh: no shadow)
        }
      }
    }
    const geo = struct ? ditchGeometry(runs) : null;
    if (geo) { const m = new THREE.Mesh(geo, this.ditchMat ||= (this.world.qualityKey === 'low' ? (x) => x : withSurfaceDetail)(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), 'ditch')); m.name = `Ditches ${t.key}`; m.receiveShadow = true; m.userData.lodM = 700; this._add(t, m); }
  }
  /**
   * The canal's banks (user, 22 Nov: "the inside slope down to the water is covered with shrubs and scrubby plants"):
   * along both sides, every ~2 m, scrub clumps (dogwood, willow), tall grass and goldenrod from the water's edge up the
   * bank and over its top to the towpath (where the towpath runs right at the edge, grass only), cattails at the
   * waterline now and then. Into the tile's near mesh (drawn to 240 m).
   */
  *_canalScrub(t, N) {
    if (!CANAL.samples.length) return;
    const x0 = t.i * TILE, z0 = t.j * TILE;
    for (let k = 0; k < CANAL.samples.length; k++) {
      const p = CANAL.samples[k];
      if (p.creek) continue;   // (a creek's channel: kept clear, not dressed as the canal's banks)
      if (p.x < x0 || p.x >= x0 + TILE || p.z < z0 || p.z >= z0 + TILE) continue;
      if (k % 40 === 0 && due()) yield;
      for (const sd of [1, -1]) {
        const w = sd > 0 ? p.w1 : p.w2, g = sd > 0 ? p.g1 : p.g2, top = Math.min(.85, Math.max(.12, (g - .2) * .6));
        // up the bank and over its top, short of the towpath; on the far side's berm path (gravel on the bank's top),
        // the inside slope only
        const berm = sd !== p.trail && g >= 6, room = berm ? 1.15 : Math.min(3.2, g - .7);
        for (let f = 0; f < 3; f++) {
          const along = (f - 1) * 1.35 + (hash(k * 7 + f + sd) - .5) * .7;
          for (let r = 0; r < 4; r++) {
            const h = hash(k * 13 + f * 5 + r * 3 + sd * 7), o = w - .35 + h * Math.max(.4, room + .35);
            const x = p.x + p.nx * sd * o + p.dx * along, z = p.z + p.nz * sd * o + p.dz * along;
            if (this.onRoad(x, z, .3) || this._railCovers(x, z)) continue;
            const y = p.y - .05 + Math.max(0, Math.min(1, (o - w + .2) / 1.2)) * top, kind = hash(h * 31 + k), sc = .6 + vnoise(x / 13, z / 13) * .6 + hash(h * 7) * .35;
            if (o < w + .1) { if (kind < .35) cattails(N, x, p.y - .02, z, h, sc); else if (kind < .7) this._card(N, x, p.y, z, h, CARD.tall, sc); continue; }
            if (room < 1) { this._card(N, x, y, z, h, CARD.tall, sc); continue; }
            if (kind < .45) scrubClump(N, x, y, z, h, sc);
            else if (kind < .75) this._card(N, x, y, z, h, CARD.tall, sc);
            else if (kind < .9) this._card(N, x, y, z, h, CARD.goldenrod, sc);
            else this._card(N, x, y, z, h, CARD.lace, sc);
          }
        }
      }
    }
  }

  /**
   * Farm animals (rural maps; toolbox/life/figures/animals.js; user, 23 Nov 2026): herds in the pastures — dairy
   * cows (Holsteins, some Jerseys) near the barns, horses (some blanketed), sheep and goats; chickens and a barn cat
   * by the barns; geese and ducks on the farm ponds. Kept at a medium distance from the road (≥ ~25 m; the birds by
   * a barn ≥ 12 m); a few walk slowly round a small circle, the rest graze. Drawn within ANIMAL_M of the camera.
   */
  *_animals(t) {
    const W = this.world, H = new Herds(), x0 = t.i * TILE, z0 = t.j * TILE;
    const R = (k) => hash(t.i * 7919.3 + t.j * 104729.7 + k * 13.37);
    // the barns here and round about (a herd's kind follows how near a barn is)
    const barns = [];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const o of this.host.buildingChunks.get(`${t.i + a},${t.j + b}`) || []) if (o.kind === 13 || o.kind === 21 || o.kind === 22) barns.push(o);
    const barnD = (x, z) => { let d = Infinity; for (const o of barns) d = Math.min(d, Math.hypot(o.cx - x, o.cz - z)); return d; };
    const clear = (x, z, road, pad) => !this.roadNear(x, z, road) && !this.inWater(x, z) && !this.host.buildingNear(x, z, pad) && !canalAt(x, z, 2);
    // (the land cover's pasture, and its hay meadows: upstate, hay and pasture are the same grass, grazed by turns)
    const pasture = (x, z) => { const c = this.landAt(x, z); return c === LAND.pasture || c === LAND.hay; };
    let k = 0;
    const put = (kind, x, z, y, walk, radius) => { H.add(kind, x, y ?? W._groundH(x, z), z, R(k++) * 6.283, { walk, radius, phase: R(k++) }); };
    // pastures: a herd seed every so often on a 40 m lattice
    for (let gx = 20; gx < TILE; gx += 40) for (let gz = 20; gz < TILE; gz += 40) {
      if (due()) yield;
      const cx = x0 + gx + (R(gx * 3 + gz) - .5) * 30, cz = z0 + gz + (R(gx + gz * 5) - .5) * 30;
      if (!pasture(cx, cz) || R(gx * 11 + gz * 17) > .12 || !clear(cx, cz, 25, 6)) continue;
      // (a farm's stock stays near the farm: a barn or farmhouse within 600 m)
      const dB = barnD(cx, cz), r = R(gx * 13 + gz * 7);
      if (dB > 600) continue;
      let kinds, n, spread;
      if (dB < 450 && r < .55) { kinds = R(gx + gz) < .8 ? ['holstein', 'holstein', 'holstein', 'jersey'] : ['jersey']; n = 4 + Math.floor(R(gx * 5 + gz) * 8); spread = 16; }
      else if (r < .78) { kinds = R(gx * 2 + gz) < .35 ? ['horseBlanket', 'horseBlanketGreen', 'horseBay'] : ['horseBay', 'horseChestnut', 'horseGrey', 'horseBay']; n = 2 + Math.floor(R(gx + gz * 3) * 3); spread = 12; }
      else if (r < .92) { kinds = R(gx * 7 + gz) < .4 ? ['sheepSuffolk', 'sheep', 'sheep'] : ['sheep']; n = 5 + Math.floor(R(gx * 9 + gz) * 8); spread = 10; }
      else { kinds = ['goatWhite', 'goatBrown', 'goatWhite']; n = 3 + Math.floor(R(gx * 3 + gz * 9) * 4); spread = 8; }
      for (let q = 0; q < n; q++) {
        const a = R(k++) * 6.283, d = Math.sqrt(R(k++)) * spread, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
        if (!pasture(x, z) || !clear(x, z, 25, 4)) continue;
        const walk = R(k++) < .15, radius = 3 + R(k++) * 4;
        if (walk && !(pasture(x + radius, z) && pasture(x - radius, z) && pasture(x, z + radius) && pasture(x, z - radius) && clear(x + radius, z, 22, 3) && clear(x - radius, z, 22, 3) && clear(x, z + radius, 22, 3) && clear(x, z - radius, 22, 3))) { put(kinds[q % kinds.length], x, z, null, false, 0); continue; }
        put(kinds[q % kinds.length], x, z, null, walk, radius);
      }
    }
    // the barns in this tile: chickens scratching about, a cat by the wall, geese and ducks on a pond near by
    for (const o of this.host.buildingChunks.get(t.key) || []) {
      if (!(o.kind === 13 || o.kind === 21 || o.kind === 22)) continue;
      if (due()) yield;
      const s0 = Math.round(o.cx * 3.1 + o.cz * 1.7);
      if (hash(s0) < .6) {
        const n = 4 + Math.floor(hash(s0 + 1) * 6), a0 = hash(s0 + 2) * 6.283, kind = hash(s0 + 3) < .5 ? 'chickenRed' : 'chickenWhite';
        for (let q = 0; q < n; q++) {
          const a = a0 + (hash(s0 + 10 + q) - .5) * 1.4, d = 9 + hash(s0 + 20 + q) * 9, x = o.cx + Math.cos(a) * d, z = o.cz + Math.sin(a) * d;
          if (!clear(x, z, 12, 1.5)) continue;
          put(q % 3 === 0 ? (kind === 'chickenRed' ? 'chickenWhite' : 'chickenRed') : kind, x, z, null, hash(s0 + 30 + q) < .3, 1 + hash(s0 + 40 + q) * 1.5);
        }
      }
      if (hash(s0 + 5) < .5) {
        for (let tries = 0; tries < 6; tries++) {
          const a = hash(s0 + 50 + tries) * 6.283, d = 7 + hash(s0 + 60 + tries) * 4, x = o.cx + Math.cos(a) * d, z = o.cz + Math.sin(a) * d;
          if (clear(x, z, 12, .5)) { put('cat', x, z, null, false, 0); break; }
        }
      }
      // a farm pond within 250 m: its shore found along a few rays from the barn
      if (hash(s0 + 7) < .7) {
        let pond = null;
        for (let ray = 0; ray < 12 && !pond; ray++) {
          const a = ray / 12 * 6.283 + hash(s0 + 8) ;
          for (let d = 20; d < 250; d += 10) { const x = o.cx + Math.cos(a) * d, z = o.cz + Math.sin(a) * d; if (this.inWater(x, z) && this.landAt(x, z) === LAND.water) { pond = { x, z, a }; break; } }
        }
        if (pond && !this.roadNear(pond.x, pond.z, 25)) {
          const n = 3 + Math.floor(hash(s0 + 9) * 5), geese = hash(s0 + 11) < .5;
          for (let q = 0; q < n; q++) {
            const x = pond.x + Math.cos(pond.a) * (4 + q * 1.8) + (hash(s0 + 70 + q) - .5) * 5, z = pond.z + Math.sin(pond.a) * (4 + q * 1.8) + (hash(s0 + 80 + q) - .5) * 5;
            if (this.inWater(x, z)) {
              const kind = geese ? (q % 3 === 2 ? 'gooseGrey' : 'goose') : (q % 2 ? 'duckMallard' : 'duckPekin'), r = 1.5 + hash(s0 + 90 + q) * 2;
              const ok = this.inWater(x + r, z) && this.inWater(x - r, z) && this.inWater(x, z + r) && this.inWater(x, z - r);
              put(kind, x, z, W.poolAt(x, z) + 0.02, ok && hash(s0 + 95 + q) < .6, r);
            } else if (geese && clear(x, z, 15, 1)) put('gooseShore', x, z, null, false, 0);
          }
        }
      }
    }
    if (!H.count) return;
    this.animalMats ||= new Map();
    const d = Math.hypot(t.cx - W.camera.position.x, t.cz - W.camera.position.z) - TILE * 0.71;
    for (const im of H.meshes(this.animalMats, this.treeTime, 'Animals')) {
      im.name += ` ${t.key}`; im.userData.lodM = ANIMAL_M; im.visible = d < ANIMAL_M;
      this._add(t, im, 'near');
    }
    this.stats.animals = (this.stats.animals || 0) + H.count;
  }
  /** CNY's barns and silos (cny-farms.js) into the tile's street-kit mesh. */
  *_farms(t) {
    let n = 0;
    for (const b of this.host.buildingChunks.get(t.key) || []) {
      if (b.ownModel !== 'farm' || b.hidden) continue;
      if (due()) yield;
      this.stats.silos = (this.stats.silos || 0) + farmBuilding(t.kitM, b, this.host.landscape); n++;
    }
    this.stats.barns = (this.stats.barns || 0) + n;
  }
  /** The main streets' buildings dressed as the Pittsburgh map's are: shop fronts with their signs (lit at night),
   *  awnings and blade signs, belt courses, cornices and sills (FACADE_STYLES: the victorian rows on the main streets,
   *  masonry blocks, tower bases, glass). Mid detail to 700 m, near detail (signs, pilasters, brackets) to 260 m. */
  *_storefronts(t) {
    const host = this.host, L = host.landscape, C = this.facades.builders();
    this._lampPts = t.lampPts || null;
    let n = 0, furniture = 0;
    for (const b of host.buildingChunks.get(t.key) || []) {
      if (due()) yield;
      // (a kit building is dressed by the kit, except a village shop row's: its awnings, signs and sidewalk furniture)
      if (b.hidden || b.onRoute || b.hero || b.kind === 12 || (this.kit.plans.has(b.k) && !(this.world.villageStreets && b.shopRow))) continue;
      const style = b.kind === 2 ? (b.h < 22 ? 'victorian' : 'masonry') : b.kind === 0 ? (b.shopRow ? this.world.shopStyle || 'victorian' : 'rowhouse') : b.kind === 4 ? 'tower' : b.kind === 5 ? 'glass' : b.kind === 7 || b.kind === 11 ? 'masonry' : null;
      if (!style || b.h < 4) continue;
      let ring = b.ring, area = 0;
      for (let i = 0; i < ring.length; i++) { const a = ring[i], c = ring[(i + 1) % ring.length]; area += a.x * c.z - c.x * a.z; }
      if (area > 0) ring = ring.slice().reverse();
      let ground = Infinity, top = -Infinity;
      for (const p of ring) { const g = L.heightAt(p.x, p.z); ground = Math.min(ground, g); top = Math.max(top, g); }
      const y1 = b.h < 20 ? Math.max(ground + b.h, top + b.h * 0.7) : ground + b.h;
      const fronts = this._frontsOf(b, ring, ground, style === 'rowhouse');
      if (fronts.length && (this.facades.dress(C, b, fronts, ground, y1, style) || style !== 'rowhouse')) n++;
      // a village main street's sidewalk furniture along the shop fronts (the "village" effect: toolbox/city/village-street.js)
      if (this.world.villageStreets && b.shopRow && t.kitM) furniture += villageFurniture(t.kitM, fronts, 0, b.k, { ...this.world.villageStreets, spots: t.spots });
      // a few people talking in twos and threes on the shop fronts' sidewalks
      if (this.world.villageStreets && b.shopRow) for (const f of fronts) {
        if (!(f.walk >= 1.4) || f.base == null || hash(b.k * 3.3 + f.i * 7.1) > .5) continue;
        const u = f.len * (.3 + .4 * hash(b.k + f.i)), d = Math.min(f.walk * .45, 1.2), cx = f.a.x + f.tx * u + f.nx * d, cz = f.a.z + f.tz * u + f.nz * d, n = 2 + (hash(b.k * 9 + f.i) < .4 ? 1 : 0);
        for (let q = 0; q < n; q++) { const a = q / n * Math.PI * 2 + hash(b.k * 5 + q) * .6, r = .45; const px = cx + Math.sin(a) * r, pz = cz + Math.cos(a) * r; t.spots.push({ x: px, z: pz, y: f.base, yaw: Math.atan2(cx - px, cz - pz), kind: 'chat' }); }
      }
    }
    this._lampPts = null;
    this.stats.storefronts = (this.stats.storefronts || 0) + n;
    this.stats.villageFurniture = (this.stats.villageFurniture || 0) + furniture;
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
      const r = this.roadNear(mx + nx * 3, mz + nz * 3, b.shop ? 12 : 6);   // (a village core's fronts: set back over a wide street's parking lane)
      if (!r || !ROADS.has(r.e.kind) || r.e.kind === 'alley' || r.e._deck?.[r.i] || (main && !MAIN.has(r.e.kind))) continue;
      const walk = this.world.walkOf ? this.world.walkOf(r.e) : 0;
      if (Math.hypot(mx - r.px, mz - r.pz) - r.half > walk + (b.shop ? 7 : 4) || Math.abs(r.dx * tx + r.dz * tz) < 0.6 || (ground != null && Math.abs(r.y - ground) > 4)) continue;
      if (this.host.buildingNear(mx + nx * 1.2, mz + nz * 1.2, 0)) continue;
      out.push({ i, a, c, len, tx, tz, nx, nz, mx, mz, yaw: Math.atan2(nx, nz), walk, base: walk && ground != null ? Math.max(ground, r.y + 0.15) : ground });
    }
    return out;
  }
  /** A village core's shop (b.shop) within r of (x, z)? */
  _shopNear(x, z, r) {
    const G = this.host.buildingGrid;
    for (let gx = Math.floor((x - r) / 40); gx <= Math.floor((x + r) / 40); gx++) for (let gz = Math.floor((z - r) / 40); gz <= Math.floor((z + r) / 40); gz++)
      for (const b of G.get(`${gx},${gz}`) || []) if (b.shop && !b.hidden && x > b.bb[0] - r && x < b.bb[1] + r && z > b.bb[2] - r && z < b.bb[3] + r) return true;
    return false;
  }
  /** Inside the dressed Point (its own lawns and trees)? */
  _inDressing(x, z) { const D = this.world.dressing; return !!D && !!D.inside?.(x, z); }

  // ------------------------------------------------------------------ furniture, lamps, parked cars
  *_furniture(t) {
    const W = this.world, M = (t.kitM = new MeshBuilder({ aGlow: 1 })), Mc = new ParkedCars();   // (the parked cars: _parked)
    const lamps = [], acorns = [], glows = [];
    const frame = (x, y, z, yaw) => ({ x, y, z, yaw, c: Math.cos(yaw), s: Math.sin(yaw) });
    // OSM's furniture: off the carriageway (a signal mapped on the road goes to the corner), facing the road
    for (const p of this.points.get(t.key) || []) {
      if (due()) yield;
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
      if (due()) yield;
      const e = piece.e, half = W.wOf(e) / 2, walk = W.walkOf ? W.walkOf(e) : 0;
      const riverwalk = W.isRiverwalk?.(e);
      if (!ROADS.has(e.kind) && !riverwalk) continue;
      for (let i = Math.max(piece.a, 1); i < Math.min(piece.b, e.n); i++) {
        const dx = e.x[i + 1] - e.x[i - 1], dz = e.z[i + 1] - e.z[i - 1], l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
        const deck = e._deck?.[i];
        const nearEnd = i < 2 || i > e.n - 2;
        // lamps
        if (riverwalk ? i % 3 === 0 : (i % 3 === 0 && (walk || (this.rural ? this._suburb(e.x[i], e.z[i]) : this.urban(e.x[i], e.z[i]))) && e.kind !== 'alley')) {
          const side = riverwalk ? 1 : ((i / 3) % 2 ? 1 : -1), off = half + (riverwalk ? 0.6 : walk ? walk - 0.5 : 1.2);
          const x = e.x[i] + nx * off * side, z = e.z[i] + nz * off * side;
          if (!this.onRoad(x, z, 0.3) && !this.host.buildingNear(x, z, 0.6) && !this.inWater(x, z) && !deck) {
            const y = walk && !riverwalk ? e.ele[i] + 0.15 : Math.min(W._groundH(x, z), e.ele[i]);
            (riverwalk ? acorns : lamps).push({ x, y, z, yaw: Math.atan2(-nx * side, -nz * side) });
            (t.lampPts ||= []).push(x, z);
          }
        }
        // parked cars: main streets with sidewalks, both sides (one side on a one-way), away from junctions and decks
        // (a rural map's village main streets too, with the "village" effect: their sidewalks are only in the villages)
        if (this.cars && (!this.rural || this.world.villageStreets) && MAIN.has(e.kind) && walk && !deck && !nearEnd && i % 2 === 0 && half >= 4.2) {
          const ow = this.edgeInfo(e).ow;
          for (const side of ow ? [ow > 0 ? 1 : -1] : [-1, 1]) {
            for (const f of [0.15, 0.8]) {
              const h0 = hash(i * 31 + side * 7 + f * 100 + e.n * 13);
              if (h0 < 0.45) continue;
              const k0 = i, k1 = i + 1, x = e.x[k0] + (e.x[k1] - e.x[k0]) * f + nx * (half - 1.15) * side, z = e.z[k0] + (e.z[k1] - e.z[k0]) * f + nz * (half - 1.15) * side;
              const y = e.ele[k0] + (e.ele[k1] - e.ele[k0]) * f + 0.02;
              const yaw = Math.atan2(dx * side, dz * side);
              // (a rural map's village: only along its shop rows — the side with a shop within 14 m)
              if (this.rural && !this._shopNear(x, z, 14)) continue;
              Mc.add(x, y, z, yaw, pickCar(seeded(h0), this.rural ? 'rural' : 'city', 'street'));
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
    if (!this.rural && this.cars) for (const ring of this.lots.get(t.key) || []) { this._lotCars(ring, Mc); if (due()) yield; }
    this._parked(t, Mc);
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

  /** Parked cars (toolbox/life/figures/cars.js, the shared kit): instanced by kind, the detailed LOD within CAR_HI,
   *  the lo LOD to CAR_NEAR, the far LOD beyond. */
  _parked(t, P) {
    if (!P.count) return;
    this.carMat ||= carMaterial({ dirt: this.rural ? 0.35 : 0.12, rust: this.rural ? 0.22 : 0.05, night: this.host.night });
    const d = Math.hypot(t.cx - this.world.camera.position.x, t.cz - this.world.camera.position.z) - TILE * 0.71;
    const bands = [['hi', 'near', 0, CAR_HI], ['lo', 'near', CAR_HI, CAR_NEAR], ['far', 'far', 0, CAR_NEAR]];
    for (const [lod, set, lo, hi] of bands) for (const im of P.meshes(this.carMat, lod, `Parked cars ${lod}`)) {
      im.name += ` ${t.key}`; im.userData.lodM = hi; if (lo) im.userData.lodMin = lo;
      im.visible = set === 'far' ? d >= hi : d < hi && !(lo && d < lo);
      this._add(t, im, set);
    }
  }
  _lotCars(ring, Mc) {
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
      Mc.add(x, y, z, yaw, pickCar(seeded(h0 * 1.8 % 1), 'city', 'lot'));
      this.stats.cars++;
    }
  }

  // ------------------------------------------------------------------ car parks' paving
  *_lots(t) {
    const list = this.lots.get(t.key); if (!list) return;
    const W = this.world, pos = [], col = [], c1 = new THREE.Color('#5a5b5e'), c2 = new THREE.Color('#e9e6dc');
    const tri = (a, b, c, color) => { for (const p of [a, b, c]) { pos.push(p[0], p[1], p[2]); col.push(color.r, color.g, color.b); } };
    const surf = (x, z) => Math.min(W._groundH(x, z) + 0.06, W.cut.cap(x, z) + 0.25);
    for (const ring of list) {
      if (due()) yield;
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
  *_lines(t) {
    const list = this.lines.get(t.key); if (!list) return;
    const W = this.world, M = t.kitM;
    const gy = (x, z) => W._groundH(x, z);
    for (const ln of list) {
      if (due()) yield;
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
  }

  dispose() {
    this.disposed = true;
    for (const [key, t] of this.tiles) this._release(key, t);
    this.kit.material.dispose();
    this.facades.dispose(); this.life?.dispose(); this.forest.dispose();
    this.carMat?.dispose();
    for (const m of this.animalMats?.values() || []) { m.userData.depth.dispose(); m.dispose(); }
    for (const g of [this.lampGeo, this.acornGeo]) g.dispose();
    for (const m of [this.kitMaterial, this.vergeMat, this.wireMat, this.lampMaterial, this.lotMaterial, this.cropMat, this.ditchMat].filter(Boolean)) m.dispose();
    this.landTexture?.dispose();
  }
}

/** A small deterministic random source from a 0–1 seed (a parked car's kind, paint and rack). */
function seeded(h) { let x = Math.floor(h * 2147483646) + 1; return () => ((x = (x * 16807) % 2147483647) / 2147483647); }
