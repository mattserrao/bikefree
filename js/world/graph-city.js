// PGH's city (claude/pgh-assets-plan.md, user 21 Nov: "proceed on all phases"): the Pittsburgh map's buildings, trees
// and street furniture over the whole PGH network, streamed by the graph world's tiles. tools/pgh_city.py makes the
// data with the Pittsburgh map's own extraction (routes/cities/pgh-city.json); this draws it with the Pittsburgh map's
// own builders, through the CityScene stand-in the landmarks already use (js/world/graph-heroes.js):
//   buildings   CityScene._chunkJob — the facade shader (brick, stone, metal, windows lit at night, shop rows), the
//               rooftops — and the building kit (CityBuildingKit: the pittsburgh-rowhouse and pittsburgh-frame homes,
//               their porches, steps and yards near the rider)
//   trees       the city's street tree (trunk and lumpy crown, the toolbox foliage shader), on the map's trees, along
//               the streets, in the yards and parks, and as woods on the steep ground the land cover marks
//   furniture   the street kit's pieces (FURNITURE: signals, bus stops and shelters, benches, hydrants, bike racks,
//               bins, bollards, stop signs…) where OSM maps them; the city's street lamps along the urban streets and
//               the riverwalks; car parks with parked cars; parked cars along the main streets; fences, walls,
//               hedges, retaining walls, guard rails and jersey barriers
// and the land cover itself (landAt, a texture for the ground shader) and what each edge is made of (edgeInfo).
//
//   const c = new GraphCity(world, heroes, json)   → c.ready (after the kit's plan), c.stream(cx, cz, ms), c.tick(cam)
import * as THREE from '../../vendor/three.module.min.js';
import { MeshBuilder, hash } from './toolbox/core/mesh-builder.js';
import { drain, runSlice } from './toolbox/core/jobs.js';
import { CityBuildingKit } from './toolbox/structures/buildings/kit.js';
import { FURNITURE } from './toolbox/city/street-kit.js';
import { decorateTreeMaterial } from './toolbox/packs/northern-rockies.js';

export const LAND = { paved: 0, grass: 1, woods: 2, water: 3, building: 4, sand: 5, plaza: 6, outside: 7, yards: 8 };
const TILE = 400;
// how far the city is built, by quality (Low: phones)
const REACH = { low: { near: 1300, far: 1800, trees: 0.6, treeNear: 450 }, balanced: { near: 2300, far: 3100, trees: 1, treeNear: 750 }, high: { near: 2300, far: 3100, trees: 1.2, treeNear: 900 } };
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
  constructor(world, heroes, data) {
    this.world = world; this.heroes = heroes; this.host = heroes.host; this.data = data;
    const proj = world.proj, host = this.host;
    const [lat0, lon0] = data.origin, U = data.unit;
    this.local = (qa, qo) => proj.toLocal(lat0 + qa * U, lon0 + qo * U);
    this.q = REACH[world.qualityKey] || REACH.balanced;
    this.ready = false; this.tiles = new Map(); this.stats = { buildings: 0, trees: 0, furniture: 0, cars: 0, lamps: 0 };

    // ---- land cover
    const L = data.land, land = new Uint8Array(L.nx * L.ny);
    for (let i = 0, k = 0; i < L.rle.length; i += 2) { land.fill(L.rle[i], k, k + L.rle[i + 1]); k += L.rle[i + 1]; }
    const nw = proj.toLocal(L.north, L.west), se = proj.toLocal(L.south, L.east);
    this.landBox = { x0: nw.x, z0: nw.z, x1: se.x, z1: se.z, nx: L.nx, ny: L.ny };
    this.land = land;
    const tex = new THREE.DataTexture(land, L.nx, L.ny, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.unpackAlignment = 1; tex.needsUpdate = true;
    this.landTexture = tex;

    // ---- the edges: what they're made of, and a segment grid for "the road near here"
    this.surfaces = data.surfaces || ['asphalt'];
    this.edgeData = data.edges || {};
    this._segGrid = new Map();
    for (const e of world.G.edges) {
      for (let i = 0; i < e.n; i++) {
        const k = `${Math.floor((e.x[i] + e.x[i + 1]) / 2 / 20)},${Math.floor((e.z[i] + e.z[i + 1]) / 2 / 20)}`;
        let a = this._segGrid.get(k); if (!a) this._segGrid.set(k, (a = [])); a.push(e, i);
      }
    }

    // ---- buildings: the city's own records (local rings), by tile; those under a landmark or a deck hidden
    const B = data.buildings, h = new Uint16Array(u8(B.h)), mh = new Uint16Array(u8(B.mh)), starts = new Uint32Array(u8(B.starts)), xy = new Int16Array(u8(B.xy));
    const covered = this._landmarkCover();
    const buildings = [], byTile = new Map();
    for (let k = 0; k < B.count; k++) {
      const ring = []; for (let i = starts[k]; i < starts[k + 1]; i++) ring.push(this.local(xy[2 * i], xy[2 * i + 1]));
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, cx = 0, cz = 0;
      for (const p of ring) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); cx += p.x; cz += p.z; }
      cx /= ring.length; cz /= ring.length;
      const b = { k, ring, h: h[k] / 10, mh: mh[k] / 10, kind: B.kind[k], name: B.names[k] || '', bb: [x0, x1, z0, z1], cx, cz };
      if (covered(b)) b.hidden = true;
      buildings.push(b);
      const key = `${Math.floor(cx / TILE)},${Math.floor(cz / TILE)}`;
      if (!byTile.has(key)) byTile.set(key, []); byTile.get(key).push(b);
    }
    this._hideUnderDecks(buildings);
    this.buildings = buildings;
    host.buildings = buildings; host.buildingChunks = byTile;
    host.buildingGrid = new Map();
    for (const b of buildings) for (let gx = Math.floor(b.bb[0] / 40); gx <= Math.floor(b.bb[1] / 40); gx++) for (let gz = Math.floor(b.bb[2] / 40); gz <= Math.floor(b.bb[3] / 40); gz++) {
      const key = `${gx},${gz}`; if (!host.buildingGrid.has(key)) host.buildingGrid.set(key, []); host.buildingGrid.get(key).push(b);
    }
    // the stand-in as the city chunk builder expects it: no route to keep off (PGH's ways were kept off in the data)
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
    // the building kit plans its homes off the PGH ways (their fronts face the nearest one)
    const xs = [], zs = [];
    host.streets = [];
    for (const e of world.G.edges) {
      const pts = []; for (let i = 0; i <= e.n; i++) { pts.push({ x: e.x[i], y: e.ele[i], z: e.z[i] }); xs.push(e.x[i]); zs.push(e.z[i]); }
      host.streets.push({ pts, width: world.wOf ? world.wOf(e) : 7, bridge: e.bridges.length > 0 && e.n <= 3 });
    }
    host.index = { xs: Float64Array.from(xs), zs: Float64Array.from(zs), nearest: () => null };
    host.route.scene.buildingKit = KIT_CFG;
    const kit = new CityBuildingKit(host, KIT_CFG, true);
    this._kitJob = kit.job; this._kit = kit;

    // ---- trees, furniture: decoded by tile
    const T = data.trees ? new Int16Array(u8(data.trees)) : [];
    this.osmTrees = new Map();
    for (let i = 0; i < T.length; i += 2) { const p = this.local(T[i], T[i + 1]); const key = `${Math.floor(p.x / TILE)},${Math.floor(p.z / TILE)}`; if (!this.osmTrees.has(key)) this.osmTrees.set(key, []); this.osmTrees.get(key).push(p); }
    this._decodeKit(data.streetKit || {});
    this._materials();
  }

  // ------------------------------------------------------------------ queries
  /** Land-cover code at (x, z) (LAND). */
  landAt(x, z) {
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
  /** A deck (bridge, ramp) running through a footprint within its height: the building isn't drawn. */
  _hideUnderDecks(buildings) {
    const grid = new Map();
    for (const e of this.world.G.edges) for (const [a, b] of e.bridges) for (let i = a + 1; i < b; i++) {
      const k = `${Math.floor(e.x[i] / 40)},${Math.floor(e.z[i] / 40)}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(e.x[i], e.ele[i], e.z[i]);
    }
    const pip = (r, x, z) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c; } return c; };
    for (const b of buildings) {
      if (b.hidden) continue;
      out: for (let gx = Math.floor(b.bb[0] / 40); gx <= Math.floor(b.bb[1] / 40); gx++) for (let gz = Math.floor(b.bb[2] / 40); gz <= Math.floor(b.bb[3] / 40); gz++) {
        const a = grid.get(`${gx},${gz}`); if (!a) continue;
        for (let k = 0; k < a.length; k += 3) {
          if (a[k] < b.bb[0] - 3 || a[k] > b.bb[1] + 3 || a[k + 2] < b.bb[2] - 3 || a[k + 2] > b.bb[3] + 3) continue;
          if (pip(b.ring, a[k], a[k + 2]) && a[k + 1] < this.world._groundH(b.cx, b.cz) + b.h + 1) { b.hidden = true; break out; }
        }
      }
    }
  }
  _decodeKit(K) {
    const by = (x, z) => `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
    const put = (map, key, v) => { if (!map.has(key)) map.set(key, []); map.get(key).push(v); };
    this.points = new Map(); this.lots = new Map(); this.lines = new Map();
    if (K.points) {
      const xy = new Int16Array(u8(K.points.xy));
      K.points.kind.forEach((c, i) => { const p = this.local(xy[2 * i], xy[2 * i + 1]); put(this.points, by(p.x, p.z), { ...p, kind: K.pointKinds[c] }); });
    }
    if (K.lots) {
      const st = new Uint32Array(u8(K.lots.starts)), xy = new Int16Array(u8(K.lots.xy));
      for (let k = 0; k + 1 < st.length; k++) {
        const ring = []; for (let i = st[k]; i < st[k + 1]; i++) ring.push(this.local(xy[2 * i], xy[2 * i + 1]));
        if (ring.length < 3) continue;
        let cx = 0, cz = 0; for (const p of ring) { cx += p.x; cz += p.z; }
        put(this.lots, by(cx / ring.length, cz / ring.length), ring);
      }
    }
    if (K.lines) {
      const st = new Uint32Array(u8(K.lines.starts)), xy = new Int16Array(u8(K.lines.xy));
      K.lines.kind.forEach((c, k) => {
        const pts = []; for (let i = st[k]; i < st[k + 1]; i++) pts.push(this.local(xy[2 * i], xy[2 * i + 1]));
        if (pts.length < 2) return;
        const m = pts[pts.length >> 1];
        put(this.lines, by(m.x, m.z), { kind: K.lineKinds[c], pts });
      });
    }
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
    // the city's street tree: four-sided trunk, an icosahedron crown; the toolbox foliage shader (aTree: 1 bark)
    const T = new MeshBuilder();
    T.color('#5b4636');
    for (let k = 0; k < 4; k++) {
      const p = (a, r, y) => V(Math.cos(a) * r, y, Math.sin(a) * r), a0 = k / 4 * Math.PI * 2 + 0.4, a1 = (k + 1) / 4 * Math.PI * 2 + 0.4;
      T.quad(p(a0, 0.16, 0), p(a0, 0.12, 3.2), p(a1, 0.12, 3.2), p(a1, 0.16, 0));
    }
    const trunkVerts = T.count;
    const crown = new THREE.IcosahedronGeometry(1, 0).toNonIndexed(), pos = crown.attributes.position;
    T.color('#ffffff');
    for (let k = 0; k < pos.count; k += 3) {
      const v = [0, 1, 2].map((j) => V(pos.getX(k + j) * 2.4, pos.getY(k + j) * 2.4 * 0.9 + 4.8, pos.getZ(k + j) * 2.4));
      T.triangle(v[0], v[1], v[2]);
    }
    const tree = T.geometry();
    tree.setAttribute('aTree', new THREE.Float32BufferAttribute(Array.from({ length: T.count }, (_, k) => (k < trunkVerts ? 1 : 0)), 1));
    // the far tree: the crown only, an octahedron (8 triangles), a little darker
    const F = new MeshBuilder(); F.color('#ffffff');
    const oct = new THREE.OctahedronGeometry(1, 0).toNonIndexed(), op = oct.attributes.position;
    for (let k = 0; k < op.count; k += 3) { const v = [0, 1, 2].map((j) => V(op.getX(k + j) * 2.5, op.getY(k + j) * 2.6 + 4.6, op.getZ(k + j) * 2.5)); F.triangle(v[0], v[1], v[2]); }
    const far = F.geometry(); far.setAttribute('aTree', new THREE.Float32BufferAttribute(new Array(F.count).fill(0), 1));
    this.treeGeo = tree; this.treeFarGeo = far;
    this.treeTime = { value: 0 };
    this.treeMaterial = decorateTreeMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }), { uTime: this.treeTime });
    this.greens = ['#5f8a3e', '#6f9a45', '#557d38', '#7a9b4a', '#4f7434', '#8aa452', '#4b6e33'].map((c) => new THREE.Color(c));
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
  /** Run the kit's planning a few ms a frame, then build and release tiles round (cx, cz). */
  stream(cx, cz, ms) {
    const t0 = performance.now();
    if (this._kitJob) {
      if (runSlice(this._kitJob, ms).done) { this._kitJob = null; this.host.buildingKit = this._kit; this.ready = true; }
      return;
    }
    const ci = Math.floor(cx / TILE), cj = Math.floor(cz / TILE), NEAR_M = this.q.near, r = Math.ceil(NEAR_M / TILE), want = [];
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
      const d = Math.hypot((i + 0.5) * TILE - cx, (j + 0.5) * TILE - cz);
      if (d > NEAR_M) continue;
      const key = `${i},${j}`;
      if (this.tiles.get(key)?.built) continue;
      // (the world's ground must be there first: heights)
      if (!this.world.ground) continue;
      want.push({ key, i, j, d });
    }
    want.sort((a, b) => a.d - b.d);
    this.queued = want.length;
    // one tile at a time, as a job in frame-sized slices (a tile's buildings can take a while: no hitch on the ride)
    while (performance.now() - t0 < ms) {
      if (!this._job) {
        const w = want.find((q) => q.key !== this._lastKey && !this.tiles.get(q.key)?.built);
        if (!w) break;
        this._job = this._tileJob(w.key, w.i, w.j); this._lastKey = w.key;
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
    const host = this.host, kitGroup = this._kit.group;
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
    this._lots(t); this._lines(t);
    t.building = false;
  }

  _release(key, t) {
    for (const { m, parent, kit } of t.meshes) {
      parent.remove(m);
      if (m.geometry && !m.userData.shared) m.geometry.dispose();
      if (kit) { const d = this._kit.details.indexOf(m); if (d >= 0) this._kit.details.splice(d, 1); for (const T of this._kit.sectors.values()) { const p = T.parts.indexOf(m); if (p >= 0) T.parts.splice(p, 1); } }
    }
    this.host.chunks.delete(key);
    this.tiles.delete(key);
  }

  _add(t, mesh, lod = null) {
    this.host.group.add(mesh);
    t.meshes.push({ m: mesh, parent: this.host.group });
    if (lod === 'near') t.near.push(mesh); else if (lod === 'far') t.far.push(mesh);
  }

  /** LOD: detailed trees and cars near the camera, crowns and plain cars beyond; the kit's near detail. */
  tick(cam, time) {
    this.treeTime.value = time;
    if ((this._lf = (this._lf || 0) + 1) % 8) return;
    for (const t of this.tiles.values()) {
      const d = Math.hypot(t.cx - cam.x, t.cz - cam.z) - TILE * 0.71;
      for (const m of t.near) m.visible = d < (m.userData.lodM || this.q.treeNear);
      for (const m of t.far) m.visible = d >= (m.userData.lodM || this.q.treeNear);
    }
    if (this.ready) this._kit.tick(cam);
  }

  // ------------------------------------------------------------------ trees
  _trees(t) {
    const W = this.world, x0 = t.i * TILE, z0 = t.j * TILE, spots = [];
    const ok = (x, z, wall = 1.4, road = 2) => !this.inWater(x, z) && !this.onRoad(x, z, road) && !this.host.buildingNear(x, z, wall)
      && !this.heroes.heroes?.covers?.(x, z, 2) && !this._kit.occupied(x, z, 0.8) && !this._inDressing(x, z);
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
          spots.push({ x, z, seed: hash(i * 7 + side + e.n * 11) });
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
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = V(0, 1, 0);
    const near = new THREE.InstancedMesh(this.treeGeo, this.treeMaterial, spots.length), far = new THREE.InstancedMesh(this.treeFarGeo, this.treeMaterial, spots.length);
    spots.forEach((s, k) => {
      const w = (s.wood ? 0.95 : 0.75) + s.seed * 0.55, y = W._groundH(s.x, s.z) - 0.1;
      q.setFromAxisAngle(Y, s.seed * 40);
      m.compose(V(s.x, y, s.z), q, V(w, w * (0.85 + s.seed * 0.35), w));
      near.setMatrixAt(k, m); far.setMatrixAt(k, m);
      const g = this.greens[Math.floor(s.seed * 997) % this.greens.length];
      near.setColorAt(k, g); far.setColorAt(k, g.clone().multiplyScalar(0.92));
    });
    for (const im of [near, far]) { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.userData.shared = true; im.castShadow = true; im.receiveShadow = true; }
    near.name = `Trees ${t.key}`; far.name = `Trees far ${t.key}`;
    const d = Math.hypot(t.cx - W.camera.position.x, t.cz - W.camera.position.z) - TILE * 0.71;
    near.visible = d < this.q.treeNear; far.visible = !near.visible;
    this._add(t, near, 'near'); this._add(t, far, 'far');
    this.stats.trees += spots.length;
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
    for (const [key, t] of this.tiles) this._release(key, t);
    for (const g of [this.treeGeo, this.treeFarGeo, this.lampGeo, this.acornGeo]) g.dispose();
    for (const m of [this.kitMaterial, this.treeMaterial, this.lampMaterial, this.lotMaterial]) m.dispose();
    this.landTexture.dispose();
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
