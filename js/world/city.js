// The city around a city route (Pittsburgh first): rivers, buildings with windows that light up
// at night, streets with sidewalks, street lamps and trees, the bridges and landmarks
// (js/world/city-bridges.js) and everything that moves (js/world/city-life.js).
// Data: "bikefree-city-1" from tools/build_city.py; ground from js/world/city-landscape.js.
import * as THREE from '../../vendor/three.module.min.js';
import { decodeCity, LAND, cityStreets, STREET_W } from './city-landscape.js';
import { MeshBuilder, ribbon, resample, hash } from './city-geometry.js';
import { buildRiverfront } from './riverfront.js';   // [s1-riverfront]
import { buildBridges, buildStadiums, buildLandmarks } from './city-bridges.js';
import { buildHeroes } from './city-heroes.js';
import { CityLife } from './city-life.js';
import { StreetKit, streetKitConfig } from './street-kit.js';   // [street-kit]
import { ROAD_WIDTH } from './pose.js';
import { buildJunctionMeshes, drawnPieces } from './junction-mesh.js';   // [junctions]
import { junctionsNear } from './junctions.js';   // [junctions]
import { streetSlots } from './road-meets.js';   // [junctions]

export { STREET_W };
const CHUNK = 320;
// [w2-budget] Static city meshes (buildings, streets, sidewalks, paths, lamps, street trees) are merged per sector of
// SECTOR × SECTOR chunks (960 m): a sector is one draw call per material wherever it is seen. Buildings stream in per
// chunk (nearest first) and fold into their sector's mesh once the sector's last chunk is built.
export const SECTOR = 3;
const LAMP_LOD = { light: 420, balanced: 600, high: 800 };   // [w2-budget] lamp posts drawn up to this far from their sector's box (m)
const SECTOR_M = CHUNK * SECTOR;
const sectorOf = (key) => { const [x, z] = key.split(',').map(Number); return `${Math.floor(x / SECTOR)},${Math.floor(z / SECTOR)}`; };

/** [w2-budget] One geometry from several with the same attributes (indexed; 32-bit index when it needs one). */
export function mergeGeometries(list) {
  list = list.filter((g) => g.attributes.position?.count);
  const out = new THREE.BufferGeometry();
  if (!list.length) return out;
  const names = Object.keys(list[0].attributes);
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  for (const name of names) {
    const size = list[0].attributes[name].itemSize, arr = new Float32Array(nv * size);
    let o = 0; for (const g of list) { arr.set(g.attributes[name].array, o); o += g.attributes[name].count * size; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let o = 0, base = 0;
  for (const g of list) {
    const n = g.attributes.position.count;
    if (g.index) { const a = g.index.array; for (let k = 0; k < a.length; k++) idx[o + k] = a[k] + base; o += a.length; }
    else { for (let k = 0; k < n; k++) idx[o + k] = base + k; o += n; }
    base += n;
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

const KIND_COLORS = [
  ['#8c4a37', '#9a5a41', '#7b3f30', '#a46a4f', '#6e4a3a', '#b08a6a', '#94503c', '#c2b49a'],   // 0 brick rowhouses
  ['#c9c2b0', '#a9b6b8', '#d8ccb0', '#8e9a87', '#c08f6f', '#e2dccc', '#b7a58a'],               // 1 houses
  ['#b9ab93', '#a39a8c', '#c8bfae', '#8f8a83', '#d0c3a7', '#9e8b74', '#c4b8a4'],               // 2 commercial
  ['#8c8c86', '#7a7d80', '#9d978b', '#8b8274'],                                                // 3 industrial
  ['#c9c0ae', '#b5aea2', '#d6cfc0', '#a8a196', '#bfb39b'],                                     // 4 stone/concrete towers
  ['#6f8496', '#5d7487', '#7a8d99', '#4e6577', '#7c8a8f'],                                     // 5 glass towers
  ['#3c4a52'],                                                                                 // 6 PPG Place
  ['#8d8476', '#a09382'],                                                                      // 7 churches
  ['#a7a39a', '#9b978e'],                                                                      // 8 garages
  ['#5c3b2b'],                                                                                 // 9 U.S. Steel Tower
  ['#c9bba1'],                                                                                 // 10 Gulf Tower
  ['#c4b79c', '#b8a98d'],                                                                      // 11 civic stone
];

/** [s1-lanes] Which third of the street texture a street uses (u range; reversed for one-ways drawn backwards). */
export function streetPaint(st) {
  const k = st.oneway ? (st.width >= 10 ? 1 : 2) : 0, u = [k / 4, (k + 1) / 4];   // (u .75–1: junction paint)
  return st.oneway < 0 ? [u[1], u[0]] : u;
}

export class CityScene {
  constructor(parent, route, index, landscape, kit, uniforms, qualityKey = 'balanced') {
    this.group = new THREE.Group(); this.group.name = 'City'; parent.add(this.group);
    this.route = route; this.index = index; this.landscape = landscape; this.kit = kit;
    this.data = landscape.data; this.D = decodeCity(this.data, landscape.decoded.proj);
    this.uniforms = uniforms;
    this.night = { value: 0 };
    this.qualityKey = qualityKey;
    this.disposables = new Set();
    this.chunks = new Map();          // key → {buildings, streets, ...} meshes
    this._decodeStreets();
    this._decodeBuildings();
    this._materials();
    this.riverfront = buildRiverfront(this);   // [s1-riverfront] promenade walls where the route runs along a river
    this._water();
    { const k = streetKitConfig(this.route.scene); if (k) this.streetKit = new StreetKit(this, k, { chunk: CHUNK }); }   // [street-kit] (before the lamps and trees: it places some of both)
    this._streetsAndLamps();
    this.bridges = buildBridges(this);
    this.stadiums = buildStadiums(this);
    { const plant = this.landscape.canPlant; if (plant) this.landscape.canPlant = (x, z) => plant(x, z) && !this.inStadium(x, z, 2)
      && (this.landscape.landAt(x, z) !== LAND.yards || !this.buildingNear(x, z, 3.5)); }   // no trees on the field; [s4-section] yard trees clear of houses
    this.landmarks = buildLandmarks(this);
    this.heroes = buildHeroes(this);
    this.landscape.landmarks.push(...this.heroes.landmarks);   // postcard views for the scenic camera
    this._trees();
    this.life = new CityLife(this);
    this._pending = [...new Set([...this.buildingChunks.keys(), ...(this.streetKit?.keys() || [])])];   // [street-kit] (+ chunks with only kit content)
    // [w2-budget] each sector: the chunks still to build, and the built chunks' building meshes waiting to be merged
    this.sectors = new Map();
    for (const key of this._pending) { const sk = sectorOf(key); if (!this.sectors.has(sk)) this.sectors.set(sk, { left: new Set(), parts: [], mesh: null }); this.sectors.get(sk).left.add(key); }
  }

  own(x) { this.disposables.add(x); return x; }

  // ---------------------------------------------------------------- data
  _decodeStreets() { this.streets = cityStreets(this.landscape, this.index, this.route); }

  _decodeBuildings() {
    const B = this.data.buildings, D = this.D;
    const u8 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0)).buffer;
    const h = new Uint16Array(u8(B.h)), mh = new Uint16Array(u8(B.mh)), starts = new Uint32Array(u8(B.starts)), xy = new Int16Array(u8(B.xy));
    this.buildingChunks = new Map();
    this.buildings = [];
    for (let k = 0; k < B.count; k++) {
      const ring = D.points(xy, starts[k], starts[k + 1]);
      const b = { k, ring, h: h[k] / 10, mh: mh[k] / 10, kind: B.kind[k], name: B.names[k] || '' };
      this.buildings.push(b);
      const key = `${Math.floor(ring[0].x / CHUNK)},${Math.floor(ring[0].z / CHUNK)}`;
      if (!this.buildingChunks.has(key)) this.buildingChunks.set(key, []);
      this.buildingChunks.get(key).push(b);
    }
    // 40 m grid of footprints for "is something standing in (or right against) a building"
    this.buildingGrid = new Map();
    for (const b of this.buildings) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const p of b.ring) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
      b.bb = [x0, x1, z0, z1];
      for (let gx = Math.floor(x0 / 40); gx <= Math.floor(x1 / 40); gx++) for (let gz = Math.floor(z0 / 40); gz <= Math.floor(z1 / 40); gz++) {
        const k = `${gx},${gz}`; if (!this.buildingGrid.has(k)) this.buildingGrid.set(k, []); this.buildingGrid.get(k).push(b);
      }
    }
    this._hideDuplicates();
  }

  /**
   * Duplicate footprints (the map has some buildings twice, or a part drawn over its whole): a building whose
   * footprint lies more than 60% inside another standing on the same ground (25% when their roofs are level),
   * and that is no taller, isn't drawn.
   */
  _hideDuplicates() {
    const inside = (ring, x, z) => { let r = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], c = ring[j]; if ((a.z > z) !== (c.z > z) && x < ((c.x - a.x) * (z - a.z)) / (c.z - a.z) + a.x) r = !r; } return r; };
    for (const b of this.buildings) {
      const pts = [];
      for (let u = 1; u < 6; u++) for (let v = 1; v < 6; v++) {
        const x = b.bb[0] + (b.bb[1] - b.bb[0]) * u / 6, z = b.bb[2] + (b.bb[3] - b.bb[2]) * v / 6;
        if (inside(b.ring, x, z)) pts.push([x, z]);
      }
      if (pts.length < 3) continue;
      const seen = new Set();
      for (let gx = Math.floor(b.bb[0] / 40); gx <= Math.floor(b.bb[1] / 40); gx++) for (let gz = Math.floor(b.bb[2] / 40); gz <= Math.floor(b.bb[3] / 40); gz++) {
        for (const o of this.buildingGrid.get(`${gx},${gz}`) || []) {
          if (o === b || seen.has(o) || o.hidden || Math.abs(o.mh - b.mh) > 3 || o.h < b.h || (o.h === b.h && o.k > b.k)) continue;
          seen.add(o);
          if (o.bb[0] > b.bb[1] || o.bb[1] < b.bb[0] || o.bb[2] > b.bb[3] || o.bb[3] < b.bb[2]) continue;
          let n = 0; for (const [x, z] of pts) if (inside(o.ring, x, z)) n++;
          if (n / pts.length > (Math.abs(o.h - b.h) < .5 ? .25 : .6)) { b.hidden = true; break; }   // equal roofs flicker even when only partly stacked
        }
        if (b.hidden) break;
      }
    }
  }

  /** Is (x, z) inside a building footprint, or within r metres of one? */
  buildingNear(x, z, r = 0) {
    for (let gx = Math.floor((x - r) / 40); gx <= Math.floor((x + r) / 40); gx++) for (let gz = Math.floor((z - r) / 40); gz <= Math.floor((z + r) / 40); gz++) {
      for (const b of this.buildingGrid.get(`${gx},${gz}`) || []) {
        if (b.kind === 12 || x < b.bb[0] - r || x > b.bb[1] + r || z < b.bb[2] - r || z > b.bb[3] + r) continue;
        const ring = b.ring;
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const a = ring[i], c = ring[j];
          if ((a.z > z) !== (c.z > z) && x < ((c.x - a.x) * (z - a.z)) / (c.z - a.z) + a.x) inside = !inside;
          if (r > 0) {
            const dx = c.x - a.x, dz = c.z - a.z, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
            if (Math.hypot(a.x + dx * t - x, a.z + dz * t - z) < r) return b;
          }
        }
        if (inside) return b;
      }
    }
    return null;
  }

  /** Points along every bridge deck, incline and raised railway (40 m grid), for `_crossed`. */
  _overheadIndex() {
    if (this._overhead) return this._overhead;
    const grid = new Map(), add = (x, y, z) => { const k = `${Math.floor(x / 40)},${Math.floor(z / 40)}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push([x, y, z]); };
    const line = (pts, step = 2) => { for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step)); for (let k = 0; k <= n; k++) add(a.x + (b.x - a.x) * k / n, a.y == null ? null : a.y + (b.y - a.y) * k / n, a.z + (b.z - a.z) * k / n); } };
    for (const st of this.streets) if (st.bridge) line(st.pts);
    for (const r of this.data.rails || []) if (r.kind === 'funicular' || r.bridge) line(r.path.map(([a, o]) => ({ ...this.D.local(a, o), y: null })));
    return (this._overhead = grid);
  }

  /** Does a bridge deck, incline or raised railway pass through this building (within its height)? */
  _crossed(b) {
    const grid = this._overheadIndex();
    for (let gx = Math.floor(b.bb[0] / 40); gx <= Math.floor(b.bb[1] / 40); gx++) for (let gz = Math.floor(b.bb[2] / 40); gz <= Math.floor(b.bb[3] / 40); gz++) {
      for (const [x, y, z] of grid.get(`${gx},${gz}`) || []) {
        if (x < b.bb[0] || x > b.bb[1] || z < b.bb[2] || z > b.bb[3] || this.buildingNear(x, z, 0) !== b) continue;
        const ground = this.landscape.heightAt(x, z);
        if (y == null || (y > ground - 1 && y < ground + b.h)) return true;   // inclines and rail viaducts follow the hill
      }
    }
    return false;
  }

  /** Does a building footprint reach into the route's road (with a margin), where the road runs at ground level? */
  _onRoute(b) {
    const L = this.landscape, ring = b.ring;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], c = ring[(i + 1) % ring.length], n = Math.max(1, Math.ceil(Math.hypot(c.x - a.x, c.z - a.z) / 2));
      for (let k = 0; k <= n; k++) {
        const x = a.x + (c.x - a.x) * k / n, z = a.z + (c.z - a.z) * k / n, r = L.routeDist(x, z);
        if (r && r.d < ROAD_WIDTH / 2 + 2 && L.heightAt(x, z) + b.h > r.y - 1) return true;
      }
    }
    // the road crossing straight through a footprint
    const e = this.route.turnIdx || this.route.dist.length - 1;
    for (let i = 0; i <= e; i += 1) {
      const x = this.index.xs[i], z = this.index.zs[i];
      if (x < b.bb[0] || x > b.bb[1] || z < b.bb[2] || z > b.bb[3]) continue;
      if (this.buildingNear(x, z, 0) === b) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- materials
  _materials() {
    const U = this.uniforms, night = this.night;
    // Buildings: vertex colour + procedural windows (glass by day, some lit warm at night).
    const bm = this.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .86, metalness: .02 }));
    bm.onBeforeCompile = (shader) => {
      shader.uniforms.uNight = night; shader.uniforms.uSkyTop = U.uSkyTop;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aBld; varying vec4 vBld; varying vec3 vWPos; varying vec3 vWNorm;')
        .replace('#include <fog_vertex>', '#include <fog_vertex>\nvBld = aBld; vWPos = (modelMatrix * vec4(transformed, 1.)).xyz; vWNorm = normalize(mat3(modelMatrix) * objectNormal);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uNight; uniform vec3 uSkyTop; varying vec4 vBld; varying vec3 vWPos; varying vec3 vWNorm;
          float bfH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float bfWin = 0., bfLit = 0.;
          int bfKind = int(vBld.x + .5);
          if (vBld.w < .5 && abs(vWNorm.y) < .5) {
            vec2 t = normalize(vec2(-vWNorm.z, vWNorm.x));
            float along = dot(vWPos.xz, t), up = vWPos.y - vBld.z;
            bool glass = bfKind == 5 || bfKind == 6;
            bool small = bfKind == 0 || bfKind == 1;
            float fh = small ? 3.1 : glass ? 3.9 : 3.6;
            float cw = small ? 2.3 : glass ? 1.55 : bfKind == 9 ? 1.9 : 2.6;
            vec2 cell = vec2(along / cw, up / fh), id = floor(cell), f = fract(cell);
            vec2 lo = glass ? vec2(.05, .1) : vec2(.24, .28), hi = glass ? vec2(.95, .94) : vec2(.76, .86);
            bfWin = step(lo.x, f.x) * step(f.x, hi.x) * step(lo.y, f.y) * step(f.y, hi.y);
            if (id.y < 1.) bfWin = (bfKind == 2 || (bfKind == 0 && bfH(id + vBld.y) > .45)) ? step(.07, f.x) * step(f.x, .93) * step(.12, f.y) * step(f.y, .78) : bfWin * step(.5, bfH(id.xx + vBld.y));
            if (bfKind == 3 || bfKind == 8 || bfKind == 7) bfWin *= step(.55, bfH(vec2(id.y, vBld.y)));
            vec3 glassCol = (bfKind == 6 ? vec3(.07, .09, .11) : vec3(.13, .16, .2)) + uSkyTop * (glass ? .22 : .12) * (1. - uNight);
            diffuseColor.rgb = mix(diffuseColor.rgb, glassCol, bfWin * (glass ? .93 : .86));
            bfLit = bfWin * step(glass ? .5 : .58, bfH(id * 1.37 + vBld.y * 17.));
          }`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, .22, bfWin);')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += mix(vec3(1., .74, .42), vec3(.85, .9, 1.), step(.8, bfH(vWPos.xz * .01 + vBld.y))) * bfLit * uNight * 1.25;`);
    };
    bm.customProgramCacheKey = () => 'city-buildings-1';
    this.buildingMaterial = bm;

    // Streets: asphalt with lane paint; sidewalks; paths.
    // [s1-lanes] three paint styles side by side (u 0–.75 in thirds, see streetPaint): two-way with a double yellow
    // centre line; one-way multi-lane (divided highways, one-way pairs): yellow left edge, dashed white lanes;
    // one-way single lane (ramps): edge lines only. [junctions] u .77–.98: the white block for crosswalks and stop
    // lines (junction-mesh.js PAINT_U); junction surfaces sample the plain asphalt of the two-way style (u .02–.11)
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = this.landscape.junctions ? '#555c60' : '#505457'; ctx.fillRect(0, 0, 256, 256);   // [junctions] the route's road's asphalt
    for (let k = 0; k < 10000; k++) { const g = 70 + Math.random() * 26; ctx.fillStyle = `rgba(${g},${g + 2},${g + 4},.45)`; ctx.fillRect(Math.random() * 256, Math.random() * 256, 1, 1); }
    ctx.fillStyle = '#e4e1d6'; ctx.fillRect(196, 0, 56, 256);   // [junctions] crosswalk and stop-line white
    ctx.fillStyle = '#d9d6c8'; ctx.fillRect(3, 0, 1.5, 256); ctx.fillRect(59.5, 0, 1.5, 256);
    ctx.fillStyle = '#d6b44c'; ctx.fillRect(30.5, 0, 1.4, 150); ctx.fillRect(32.6, 0, 1.4, 150);
    ctx.fillStyle = '#d6b44c'; ctx.fillRect(64 + 4, 0, 1.6, 256); ctx.fillRect(128 + 4, 0, 1.6, 256);
    ctx.fillStyle = '#d9d6c8'; ctx.fillRect(64 + 58.5, 0, 1.5, 256); ctx.fillRect(128 + 58.5, 0, 1.5, 256);
    for (const x of [64 + 23, 64 + 41]) ctx.fillRect(x, 0, 1.3, 96);
    const tex = this.own(new THREE.CanvasTexture(c)); tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const offset = (f) => ({ polygonOffset: true, polygonOffsetFactor: f, polygonOffsetUnits: f });
    this.streetMaterial = this.own(new THREE.MeshStandardMaterial({ map: tex, roughness: .93, ...offset(-1.6) }));
    // Each road ribbon carries its height slot (aSlot), and the depth test settles overlaps by it: where two
    // streets meet at one height, the higher slot always wins, at any distance (their surfaces drift a few cm
    // relative to each other inside a junction, which a 2 cm lift alone can't outweigh).
    this.streetMaterial.userData.slotDepthBias = true;
    this.streetMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float aSlot; varying float vSlot;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSlot = aSlot;')
        // [junctions] road paint (slot 9: crosswalks, stop lines, the plain asphalt over the route's road in a junction) is
        // drawn a hair nearer along the view ray (same pixel, nearer depth), so it always wins over the road it lies on
        .replace('#include <project_vertex>', '#include <project_vertex>\nif (aSlot > 8.5) { mvPosition.xyz *= .9994; gl_Position = projectionMatrix * mvPosition; }');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vSlot;')
        .replace('#include <logdepthbuf_fragment>', '#include <logdepthbuf_fragment>\n#if defined( USE_LOGDEPTHBUF )\ngl_FragDepth -= vSlot * 2e-6;\n#endif');
    };
    this.streetMaterial.customProgramCacheKey = () => 'city-streets-slot-3';   // [junctions]
    this.sidewalkMaterial = this.own(new THREE.MeshStandardMaterial({ color: '#aca59a', roughness: .95, ...offset(-1.1) }));
    this.pathMaterial = this.own(new THREE.MeshStandardMaterial({ color: '#9d978a', roughness: .95, ...offset(-1.3) }));
    this.solidMaterial = this.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .8, metalness: .1 }));
    this.glowMaterial = this._glowMaterial();
  }

  /** Camera-facing additive glows, faded in with the night (lamps, beacons, headlights). */
  _glowMaterial() {
    const m = new THREE.ShaderMaterial({
      uniforms: { uNight: this.night },
      vertexShader: /* glsl */`
        attribute vec3 aGlow; varying vec3 vColor; varying vec2 vUv;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main() {
          vUv = uv; vColor = aGlow;
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(0., 0., 0., 1.);
          float size = length(instanceMatrix[0].xyz);
          mv.xy += (uv - .5) * size;
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */`
        uniform float uNight; varying vec3 vColor; varying vec2 vUv;
        #include <logdepthbuf_pars_fragment>
        void main() {
          #include <logdepthbuf_fragment>
          float r = length(vUv - .5) * 2.;
          float a = (exp(-r * r * 4.) * .9 + exp(-r * r * 40.)) * uNight;
          if (a < .004) discard;
          gl_FragColor = vec4(vColor * a, a);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    return this.own(m);
  }

  // ---------------------------------------------------------------- rivers
  _water() {
    const D = this.D, mask = new Float32Array(D.lx * D.ly);
    for (let i = 0; i < mask.length; i++) mask[i] = D.land[i] === LAND.water ? 1 : 0;
    this.water = this._waterMesh(mask, D.lx, D.ly, D.x0, D.z0, D.x1, D.z1, 'Rivers', null, this._riverFields(mask, D.lx, D.ly));
    this._riverWalls(mask);
    // the rivers beyond the city's box, from the real height grid's river mask (drawn only outside the box)
    const O = this.landscape.outer;
    if (O) {
      const om = Float32Array.from(O.mask.m);
      this.outerWater = this._waterMesh(om, O.mask.nx, O.mask.ny, O.x0, O.z0, O.x1, O.z1, 'Rivers beyond', [D.x0, D.z0, D.x1, D.z1]);
    }
  }

  /**
   * River walls along the urban banks (downtown, the North Shore, Station Square): stone walls traced along the
   * shoreline (marching squares on the water mask) wherever the landscape marks the shore as walled, from below
   * the waterline to the bank, with a dark wet band and a pale coping.
   */
  _riverWalls(mask) {
    const D = this.D, L = this.landscape, W = D.lx, H = D.ly, level = L.level, dx = (D.x1 - D.x0) / (W - 1), dz = (D.z1 - D.z0) / (H - 1);
    const walls = L.shoreWalls?.();
    this.wallGrid = new Map();
    if (!walls) return;
    const B = new MeshBuilder(), X = (i) => D.x0 + i * dx, Z = (j) => D.z0 + j * dz;
    // the railways, on a 20 m grid
    const rails = new Map();
    for (const r of this.data.rails || []) {
      const pts = r.path.map(([qa, qo]) => D.local(qa, qo));
      for (let q = 1; q < pts.length; q++) {
        const a0 = pts[q - 1], a1 = pts[q], n = Math.max(1, Math.ceil(Math.hypot(a1.x - a0.x, a1.z - a0.z) / 3));
        for (let t = 0; t <= n; t++) { const px = a0.x + (a1.x - a0.x) * t / n, pz = a0.z + (a1.z - a0.z) * t / n, key = `${Math.floor(px / 20)},${Math.floor(pz / 20)}`; if (!rails.has(key)) rails.set(key, []); rails.get(key).push(px, pz); }
      }
    }
    const railNear = (x, z, r) => {
      for (let gx = Math.floor((x - r) / 20); gx <= Math.floor((x + r) / 20); gx++) for (let gz = Math.floor((z - r) / 20); gz <= Math.floor((z + r) / 20); gz++) {
        const a = rails.get(`${gx},${gz}`); if (!a) continue;
        for (let q = 0; q < a.length; q += 2) if (Math.hypot(a[q] - x, a[q + 1] - z) < r) return true;
      }
      return false;
    };
    let n = 0;
    for (let j = 0; j < H - 1; j++) for (let i = 0; i < W - 1; i++) {
      const k = j * W + i, a = mask[k], b = mask[k + 1], c = mask[k + W + 1], d = mask[k + W];
      const code = (a > .5 ? 1 : 0) | (b > .5 ? 2 : 0) | (c > .5 ? 4 : 0) | (d > .5 ? 8 : 0);
      if (code === 0 || code === 15) continue;
      if (!(walls[k] || walls[k + 1] || walls[k + W] || walls[k + W + 1])) continue;
      // edge midpoints: top (a-b), right (b-c), bottom (d-c), left (a-d)
      const E = [{ x: X(i + .5), z: Z(j) }, { x: X(i + 1), z: Z(j + .5) }, { x: X(i + .5), z: Z(j + 1) }, { x: X(i), z: Z(j + .5) }];
      const segs = { 1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 5: [[3, 0], [1, 2]], 6: [[0, 2]], 7: [[3, 2]], 8: [[2, 3]], 9: [[2, 0]], 10: [[0, 1], [2, 3]], 11: [[2, 1]], 12: [[1, 3]], 13: [[1, 0]], 14: [[0, 3]] }[code];
      for (const [e0, e1] of segs) {
        let p0 = E[e0], p1 = E[e1];
        // which side is land: step off the segment's middle both ways
        const mx = (p0.x + p1.x) / 2, mz = (p0.z + p1.z) / 2, tx = p1.x - p0.x, tz = p1.z - p0.z, tl = Math.hypot(tx, tz) || 1;
        let nx = -tz / tl, nz = tx / tl;
        if (L.waterAt(mx + nx * 4, mz + nz * 4) > L.waterAt(mx - nx * 4, mz - nz * 4)) { nx = -nx; nz = -nz; [p0, p1] = [p1, p0]; }
        // where a street or a railway runs right along the shore, the bank stays natural (cars, trains, lamps)
        const cx = mx + nx * 1, cz = mz + nz * 1;
        const rt = L.routeDist(cx, cz);
        if (this.riverfront?.covers(mx, mz)) continue;   // [s1-riverfront] the promenade has its own wall here
        if (L.streetsNear(cx, cz, 3).some((o) => this.streets[o.k].cls < 8) || railNear(cx, cz, 6) || (rt && rt.d < ROAD_WIDTH / 2 + 4)) continue;
        { const key = `${Math.floor(mx / 20)},${Math.floor(mz / 20)}`; if (!this.wallGrid.has(key)) this.wallGrid.set(key, []); this.wallGrid.get(key).push(p0.x, p0.z, p1.x, p1.z); }
        // the wall faces the water (−n): quad from p0 to p1 as seen from the river
        const top0 = Math.max(level + 1, L.baseHeight(p0.x + nx * 1.5, p0.z + nz * 1.5)), top1 = Math.max(level + 1, L.baseHeight(p1.x + nx * 1.5, p1.z + nz * 1.5));
        const V3 = (p, y) => new THREE.Vector3(p.x, y, p.z);
        B.color('#4c4a42'); B.quad(V3(p1, level - 1.2), V3(p0, level - 1.2), V3(p0, level + .7), V3(p1, level + .7));
        B.color('#8e897e'); B.quad(V3(p1, level + .7), V3(p0, level + .7), V3(p0, top0), V3(p1, top1));
        const q0 = { x: p0.x + nx * .9, z: p0.z + nz * .9 }, q1 = { x: p1.x + nx * .9, z: p1.z + nz * .9 };
        B.color('#bdb6a6'); B.quad(V3(p1, top1 + .12), V3(p0, top0 + .12), V3(q0, top0 + .12), V3(q1, top1 + .12));
        B.quad(V3(p1, top1), V3(p0, top0), V3(p0, top0 + .12), V3(p1, top1 + .12));
        n++;
      }
    }
    if (!n) return;
    B.keepOutOf(L.inRouteTube);
    const m = new THREE.Mesh(this.own(B.geometry()), this.solidMaterial);
    m.name = 'River walls'; m.receiveShadow = true; this.group.add(m);
  }

  /**
   * The rivers' character, from the water mask on the land grid (the scene's `riverFlow` seeds: the Allegheny and
   * Monongahela upstream, the Ohio downstream, and the Point): along-river distances by Dijkstra; the current
   * runs down the distance to the Ohio's outlet; each cell takes the colour of whichever river reaches it first
   * along the water, so below the Point the Allegheny's green and the Mon's brown run side by side down the Ohio,
   * blending over the next few kilometres. Returns { tex: RG flow direction, B Allegheny-ness, A blend }.
   */
  _riverFields(mask, W, H) {
    const F = this.route.scene?.riverFlow;
    if (!F) return null;
    const D = this.D, dx = (D.x1 - D.x0) / (W - 1), dz = (D.z1 - D.z0) / (H - 1);
    const cellOf = ([lat, lon]) => {
      const p = D.proj.toLocal(lat, lon), u = Math.round((p.x - D.x0) / dx), v = Math.round((p.z - D.z0) / dz);
      let best = -1, bd = Infinity;   // the nearest water cell within ~400 m
      for (let j = Math.max(0, v - 35); j <= Math.min(H - 1, v + 35); j++) for (let i = Math.max(0, u - 35); i <= Math.min(W - 1, u + 35); i++) {
        if (mask[j * W + i] < .5) continue;
        const d = (i - u) ** 2 + (j - v) ** 2; if (d < bd) { bd = d; best = j * W + i; }
      }
      return best;
    };
    const dijkstra = (seed) => {
      const dist = new Float64Array(W * H).fill(Infinity);   // (64-bit: a float32 rounds below its queued value and the cell is never expanded)
      const seeds = Array.isArray(seed) ? seed : seed >= 0 ? [seed] : [];
      if (!seeds.length) return dist;
      // binary heap of [d, i]
      const hd = [], hi = [];
      const push = (d, i) => { hd.push(d); hi.push(i); let c = hd.length - 1; while (c) { const p = (c - 1) >> 1; if (hd[p] <= hd[c]) break; [hd[p], hd[c]] = [hd[c], hd[p]]; [hi[p], hi[c]] = [hi[c], hi[p]]; c = p; } };
      const pop = () => { const d = hd[0], i = hi[0], ld = hd.pop(), li = hi.pop(); if (hd.length) { hd[0] = ld; hi[0] = li; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < hd.length && hd[l] < hd[m]) m = l; if (r < hd.length && hd[r] < hd[m]) m = r; if (m === c) break; [hd[m], hd[c]] = [hd[c], hd[m]]; [hi[m], hi[c]] = [hi[c], hi[m]]; c = m; } } return [d, i]; };
      for (const q of seeds) { dist[q] = 0; push(0, q); }
      const nb = [[1, 0, dx], [-1, 0, dx], [0, 1, dz], [0, -1, dz], [1, 1, Math.hypot(dx, dz)], [-1, 1, Math.hypot(dx, dz)], [1, -1, Math.hypot(dx, dz)], [-1, -1, Math.hypot(dx, dz)]];
      while (hd.length) {
        const [d, i] = pop();
        if (d > dist[i]) continue;
        const x = i % W, y = (i / W) | 0;
        for (const [ox, oy, w] of nb) {
          const nx = x + ox, ny = y + oy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx; if (mask[j] < .5) continue;
          const nd = d + w; if (nd < dist[j]) { dist[j] = nd; push(nd, j); }
        }
      }
      return dist;
    };
    const dA = dijkstra(cellOf(F.allegheny)), dM = dijkstra(cellOf(F.monongahela)), dO = dijkstra(cellOf(F.ohio));
    const point = cellOf(F.point), dOPoint = point >= 0 ? dO[point] : Infinity, pP = D.proj.toLocal(...F.point);
    // the confluence: on the shortest water path from the Allegheny's seed to the Mon's (every cell on it has the
    // least dA + dM), the cell nearest the outlet — the tip of the Point. Offsetting the Mon's distances so both
    // rivers arrive there together leaves only the position across the Ohio to decide whose water a cell is.
    let best = Infinity, tip = -1;
    for (let k = 0; k < W * H; k++) {
      if (!isFinite(dA[k]) || !isFinite(dM[k])) continue;
      const sum = dA[k] + dM[k];
      if (sum < best - 1e-6 || (Math.abs(sum - best) < 1e-6 && dO[k] < dO[tip])) { best = sum; tip = k; }
    }
    for (let k = 0; k < W * H; k++) {   // ties along the path: the one furthest downstream (within a cell's rounding)
      if (isFinite(dA[k]) && isFinite(dM[k]) && dA[k] + dM[k] < best + Math.hypot(dx, dz) && dO[k] < dO[tip]) tip = k;
    }
    const off = tip >= 0 ? dA[tip] - dM[tip] : 0;
    // In the Ohio the two rivers' waters run side by side: the Allegheny's along the north bank, the Mon's along
    // the south. Distance through the water to each shore decides it there (comparing distances back to the
    // sources drifts over kilometres). The shores are the land masses holding the scene's `north` and `south` points.
    let dN = null, dS = null;
    if (F.north && F.south) {
      const land = new Int32Array(W * H);
      const fill = (start, id) => {
        if (start < 0 || mask[start] >= .5) return;
        const st = [start]; land[start] = id;
        while (st.length) { const q = st.pop(), x = q % W, y = (q / W) | 0; for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + a, Y = y + b; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const j = Y * W + X; if (!land[j] && mask[j] < .5) { land[j] = id; st.push(j); } } }
      };
      const landCellOf = ([lat, lon]) => { const p = D.proj.toLocal(lat, lon); return Math.round((p.z - D.z0) / dz) * W + Math.round((p.x - D.x0) / dx); };
      fill(landCellOf(F.north), 1); fill(landCellOf(F.south), 2);
      const shore = (id) => { const out = []; for (let k = W; k < W * H - W; k++) { if (mask[k] < .5) continue; if (land[k - 1] === id || land[k + 1] === id || land[k - W] === id || land[k + W] === id) out.push(k); } return out; };
      dN = dijkstra(shore(1)); dS = dijkstra(shore(2));
    }
    const tex = new Uint8Array(W * H * 4);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i;
      if (mask[k] < .5 || !isFinite(dO[k])) { tex[k * 4] = tex[k * 4 + 1] = 128; tex[k * 4 + 2] = 128; continue; }
      // the current: down the gradient of the distance to the outlet
      const at = (u, v) => { const q = Math.max(0, Math.min(H - 1, v)) * W + Math.max(0, Math.min(W - 1, u)); return isFinite(dO[q]) ? dO[q] : dO[k]; };
      let gx = (at(i + 1, j) - at(i - 1, j)) / (2 * dx), gz = (at(i, j + 1) - at(i, j - 1)) / (2 * dz);
      const g = Math.hypot(gx, gz) || 1; gx /= -g; gz /= -g;
      tex[k * 4] = (gx * .5 + .5) * 255; tex[k * 4 + 1] = (gz * .5 + .5) * 255;
      // Allegheny-ness: which river reaches this cell first along the water (a band ~120 m wide where they meet)
      const a = isFinite(dA[k]) ? dA[k] : 1e9, m = isFinite(dM[k]) ? dM[k] + off : 1e9;
      let alle = Math.max(0, Math.min(1, .5 + (m - a) / 120));
      if (dN && dO[k] < dOPoint - 60 && isFinite(dN[k]) && isFinite(dS[k])) {
        const t = dS[k] / (dN[k] + dS[k] || 1);   // 1 at the north bank, 0 at the south
        alle = Math.max(0, Math.min(1, (t - .42) / .16));
      }
      tex[k * 4 + 2] = alle * 255;
      // below the Point, the two colours blend slowly into the Ohio's
      const downstream = dO[k] < dOPoint - 30;
      const far = Math.hypot(D.x0 + i * dx - pP.x, D.z0 + j * dz - pP.z);
      tex[k * 4 + 3] = (downstream ? Math.max(0, Math.min(.85, (far - 1500) / 6000)) : 0) * 255;   // (the line between them is still there miles down)
    }
    // soften the band and the current
    const out = new Uint8Array(tex);
    for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
      const k = j * W + i; if (mask[k] < .5) continue;
      for (let c = 0; c < 4; c++) { let sum = 0, n = 0; for (let v = -1; v <= 1; v++) for (let u = -1; u <= 1; u++) { const q = (j + v) * W + i + u; if (mask[q] >= .5) { sum += tex[q * 4 + c]; n++; } } out[k * 4 + c] = sum / n; }
    }
    const t = this.own(new THREE.DataTexture(out, W, H)); t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
    return t;
  }

  _waterMesh(mask, W, H, x0, z0, x1, z1, name, hole = null, fields = null) {
    const level = this.landscape.level;
    // Water mask → soft distance-to-bank texture (blurred), for shallow colour and bank foam.
    const blur = (src, r) => {
      const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
      for (let y = 0; y < H; y++) { let acc = 0; for (let x = -r; x < W + r; x++) { if (x + r < W) acc += src[y * W + Math.min(W - 1, x + r)]; if (x - r - 1 >= 0) acc -= src[y * W + x - r - 1]; if (x >= 0 && x < W) tmp[y * W + x] = acc / (2 * r + 1); } }
      for (let x = 0; x < W; x++) { let acc = 0; for (let y = -r; y < H + r; y++) { if (y + r < H) acc += tmp[Math.min(H - 1, y + r) * W + x]; if (y - r - 1 >= 0) acc -= tmp[(y - r - 1) * W + x]; if (y >= 0 && y < H) out[y * W + x] = acc / (2 * r + 1); } }
      return out;
    };
    const deep = blur(blur(mask, 3), 3);
    const tex = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) { tex[i * 4] = mask[i] * 255; tex[i * 4 + 1] = Math.min(255, deep[i] * 255); tex[i * 4 + 3] = 255; }
    const dt = this.own(new THREE.DataTexture(tex, W, H)); dt.magFilter = dt.minFilter = THREE.LinearFilter; dt.needsUpdate = true;
    const U = this.uniforms;
    const mat = this.own(new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: U.uTime, uSunDir: U.uSunDir, uSkyTop: U.uSkyTop, uSkyHorizon: U.uSkyHorizon,
        uNight: this.night, uMask: { value: dt }, uBox: { value: new THREE.Vector4(x0, z0, x1 - x0, z1 - z0) }, uHole: { value: new THREE.Vector4(...(hole || [1, 1, -1, -1])) },
        uDeep: { value: new THREE.Color('#2f5a5c') }, uShallow: { value: new THREE.Color('#5d7f6a') },
        uFlow: { value: fields || dt }, uHasFlow: { value: fields ? 1 : 0 },
        // the Allegheny runs green and clear, the Monongahela browner; the Ohio is their blend
        uAlleDeep: { value: new THREE.Color('#284a42') }, uAlleShallow: { value: new THREE.Color('#4c7563') },
        uMonDeep: { value: new THREE.Color('#584f34') }, uMonShallow: { value: new THREE.Color('#7f744e') } },
      vertexShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_vertex>
        #include <fog_pars_vertex>
        varying vec3 vW;
        void main() { vW = (modelMatrix * vec4(position, 1.)).xyz; vec4 mvPosition = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mvPosition;
          #include <logdepthbuf_vertex>
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_fragment>
        #include <fog_pars_fragment>
        uniform float uTime, uNight, uHasFlow; uniform vec3 uSunDir, uSkyTop, uSkyHorizon, uDeep, uShallow, uAlleDeep, uAlleShallow, uMonDeep, uMonShallow;
        uniform sampler2D uMask, uFlow; uniform vec4 uBox, uHole;
        varying vec3 vW;
        float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
          float a = fract(sin(dot(i, vec2(12.9, 78.2))) * 43758.5), b = fract(sin(dot(i + vec2(1, 0), vec2(12.9, 78.2))) * 43758.5),
                c = fract(sin(dot(i + vec2(0, 1), vec2(12.9, 78.2))) * 43758.5), d = fract(sin(dot(i + vec2(1, 1), vec2(12.9, 78.2))) * 43758.5);
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
        void main() {
          #include <logdepthbuf_fragment>
          if (vW.x > uHole.x && vW.z > uHole.y && vW.x < uHole.z && vW.z < uHole.w) discard;
          vec2 uv = (vW.xz - uBox.xy) / uBox.zw;
          vec4 m = texture2D(uMask, uv);
          if (m.r < .02) discard;
          vec2 p = vW.xz;
          float near = 1. - smoothstep(300., 2600., length(cameraPosition.xz - p));
          vec4 fl = texture2D(uFlow, uv);
          vec2 dir = uHasFlow > .5 ? fl.rg * 2. - 1. : vec2(0.);
          float flowing = clamp(length(dir) * 1.4, 0., 1.); dir = flowing > .01 ? normalize(dir) : vec2(1., 0.);
          // the current: ripples carried downstream (flow-mapped: two phases, cross-faded), plus long slick lines
          float ph = fract(uTime * .04), w0 = abs(ph - .5) * 2.;
          vec2 o0 = dir * ph * 46. * flowing, o1 = dir * fract(ph + .5) * 46. * flowing;
          float r1 = mix(n2((p - o1) * .09 + vec2(uTime * .05)), n2((p - o0) * .09 + vec2(7.3, 1.1) + vec2(uTime * .05)), w0);
          float r2 = mix(n2((p - o1) * .23 + 3.1), n2((p - o0) * .23 + 9.4), w0);
          vec2 q = vec2(dot(p, dir), dot(p, vec2(-dir.y, dir.x)));
          float slick = smoothstep(.55, .9, n2(vec2((q.x - uTime * 1.1) * .012, q.y * .11))) * flowing;
          vec3 N = normalize(vec3((r1 - .5) * .09 * near, 1., (r2 - .5) * .09 * near));
          vec3 V = normalize(cameraPosition - vW);
          float fres = .04 + .5 * pow(1. - max(dot(N, V), 0.), 4.);
          vec3 R = reflect(-V, N);
          vec3 sky = mix(uSkyHorizon, uSkyTop, sqrt(max(R.y, 0.)));
          float alle = uHasFlow > .5 ? fl.b : .5, blend = uHasFlow > .5 ? fl.a : 1.;
          vec3 deepC = mix(mix(uMonDeep, uAlleDeep, alle), uDeep, blend), shallowC = mix(mix(uMonShallow, uAlleShallow, alle), uShallow, blend);
          vec3 col = mix(shallowC, deepC, smoothstep(.15, .85, m.g)) * (.92 + n2(p * .01) * .16);
          col *= 1. + slick * .07;
          col = mix(col, sky, fres * (1. - slick * .5) * .8);
          // the sun on the water: a broad warm sheen, a tight highlight, and sparkles that glitter in it
          vec3 Ls = normalize(uSunDir);
          float spec = max(dot(reflect(-Ls, N), V), 0.);
          float low = 1. - smoothstep(.15, .6, Ls.y);   // strongest with the sun low (golden hour)
          float sparkle = step(.93, n2(p * 1.7 + vec2(uTime * 2.3, -uTime * 1.9))) * pow(spec, 12.) * near;
          col += vec3(1., .86, .6) * (pow(spec, 140.) * .8 + pow(spec, 22.) * .18 * (.4 + low) + sparkle * 1.4 * (.5 + low)) * (1. - uNight);
          col *= mix(1., .16, uNight);
          // city lights on the water at night: streaks stretched toward the viewer, strongest near the banks
          vec2 toCam = normalize(cameraPosition.xz - p + 1e-3);
          vec2 sq = vec2(dot(p, vec2(-toCam.y, toCam.x)), dot(p, toCam));
          float lights = smoothstep(.7, .95, n2(vec2(sq.x * .45, sq.y * .018 + uTime * .02))) * (1. - smoothstep(.15, .75, m.g));
          float wob = .75 + .25 * sin(sq.y * .5 + uTime * 2. + sq.x);
          col += mix(vec3(1., .74, .4), vec3(.85, .9, 1.), step(.6, n2(vec2(sq.x * .2, 3.)))) * lights * wob * uNight * .7;
          col = mix(col, vec3(.78, .82, .76), (1. - smoothstep(.0, .14, m.g)) * .35 * (1. - uNight * .7));
          gl_FragColor = vec4(col, 1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
      fog: true,
    }));
    // a plain rectangle, or (beyond the city) a frame around the city's box, so the two never overlap
    const quads = hole ? [[x0, z0, x1, hole[1]], [x0, hole[3], x1, z1], [x0, hole[1], hole[0], hole[3]], [hole[2], hole[1], x1, hole[3]]] : [[x0, z0, x1, z1]];
    const pos = [], idx = [];
    for (const [a0, b0, a1, b1] of quads) {
      if (a1 <= a0 || b1 <= b0) continue;
      const n = pos.length / 3;
      pos.push(a0, 0, b0, a1, 0, b0, a0, 0, b1, a1, 0, b1); idx.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
    }
    const geo = this.own(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    const water = new THREE.Mesh(geo, mat);
    water.position.set(0, level, 0);
    water.name = name; water.renderOrder = 0;
    this.group.add(water);
    return water;
  }

  // ---------------------------------------------------------------- buildings
  _buildChunk(key) {
    const list = this.buildingChunks.get(key) || [];   // [street-kit] (a chunk can hold only street-kit content)
    const B = new MeshBuilder({ aBld: 4 });   // [w2-budget] walls, roofs and the rooftop details (aBld.w = 1: no windows), one mesh
    const roofTint = new THREE.Color();
    for (const b of list) {
      if (b.kind === 12 || b.hero || b.hidden) continue;   // the submarine and the hero landmarks are drawn on their own; duplicates not at all
      if (b.onRoute ??= this._onRoute(b)) continue;   // OSM footprints that overlap the ride's road: not drawn
      if (b.crossed ??= this._crossed(b)) continue;   // a ramp, incline or raised railway runs through it: not drawn
      let ring = b.ring;
      let area = 0;
      for (let i = 0; i < ring.length; i++) { const a = ring[i], c = ring[(i + 1) % ring.length]; area += a.x * c.z - c.x * a.z; }
      if (area > 0) ring = ring.slice().reverse();   // walls wound to face outwards
      let ground = Infinity, top = -Infinity;
      for (const p of ring) { const g = this.landscape.heightAt(p.x, p.z); ground = Math.min(ground, g); top = Math.max(top, g); }
      // On steep ground the tall side shows: measure the height from the uphill corner for small buildings.
      const y0 = ground + b.mh - (b.mh ? 0 : .8), y1 = (b.h < 20 ? Math.max(ground + b.h, top + b.h * .7) : ground + b.h);
      const palette = KIND_COLORS[b.kind] || KIND_COLORS[2];
      const seed = hash(b.k * 7919 + 13);
      const base = new THREE.Color(palette[Math.floor(seed * palette.length)]).multiplyScalar(.9 + hash(b.k) * .18);
      const kit = this.streetKit?.building(b, ring, ground, y0, y1, base, key, B);   // [street-kit] facade detail (bays into B); window grid base, roof colour
      B.color(base).set({ aBld: [b.kind, seed * 100, kit ? kit.winBase : ground, 0] });
      const facets = b.kind === 6 && b.h > 18;   // PPG Place: glass in rows of projecting prisms
      let mx = 0, mz = 0; for (const p of ring) { mx += p.x; mz += p.z; } mx /= ring.length; mz /= ring.length;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], c = ring[(i + 1) % ring.length];
        const len = Math.hypot(c.x - a.x, c.z - a.z), bays = facets ? Math.floor(len / 5.5) : 0;
        if (!bays) { B.quad(new THREE.Vector3(a.x, y0, a.z), new THREE.Vector3(c.x, y0, c.z), new THREE.Vector3(c.x, y1, c.z), new THREE.Vector3(a.x, y1, a.z)); continue; }
        let nx = (c.z - a.z) / len, nz = -(c.x - a.x) / len;
        if (((a.x + c.x) / 2 - mx) * nx + ((a.z + c.z) / 2 - mz) * nz < 0) { nx = -nx; nz = -nz; }
        for (let k = 0; k < bays; k++) {
          const p0 = { x: a.x + (c.x - a.x) * k / bays, z: a.z + (c.z - a.z) * k / bays }, p1 = { x: a.x + (c.x - a.x) * (k + 1) / bays, z: a.z + (c.z - a.z) * (k + 1) / bays };
          const m = { x: (p0.x + p1.x) / 2 + nx * 1.3, z: (p0.z + p1.z) / 2 + nz * 1.3 };
          for (const [u, v] of [[p0, m], [m, p1]]) B.quad(new THREE.Vector3(u.x, y0, u.z), new THREE.Vector3(v.x, y0, v.z), new THREE.Vector3(v.x, y1, v.z), new THREE.Vector3(u.x, y1, u.z));
          B.triangle(new THREE.Vector3(p0.x, y1, p0.z), new THREE.Vector3(p1.x, y1, p1.z), new THREE.Vector3(m.x, y1, m.z));
        }
      }
      // flat roof, a little darker (tar and gravel), with a parapet colour band from the walls
      roofTint.copy(base).lerp(kit?.roof || new THREE.Color(b.kind === 6 ? '#2f3a40' : '#6a6762'), kit ? .9 : .65);   // [street-kit]
      B.color(roofTint).set({ aBld: [b.kind, seed * 100, ground, 1] });
      const contour = ring.map((p) => new THREE.Vector2(p.x, p.z));
      let tris;
      try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch { tris = []; }
      const first = B.count;
      for (const p of ring) B.vertex(p.x, y1, p.z, 0, 1, 0);
      for (const [i, j, k] of tris) {
        const ax = ring[j].x - ring[i].x, az = ring[j].z - ring[i].z, bx = ring[k].x - ring[i].x, bz = ring[k].z - ring[i].z;
        if (az * bx - ax * bz > 0) B.tri(first + i, first + j, first + k); else B.tri(first + i, first + k, first + j);
      }
      this._rooftop(B, b, ring, y1, seed, !!kit);   // [w2-budget] (was its own mesh in the solid material)
    }
    const mesh = new THREE.Mesh(this.own(B.geometry()), this.buildingMaterial);
    mesh.castShadow = mesh.receiveShadow = true; mesh.name = `Buildings ${key}`;
    this.group.add(mesh);
    const out = [];
    this.streetKit?.finishChunk(key, out);   // [street-kit] sidewalks, furniture, trim
    this.chunks.set(key, out);
    this._sectorChunk(key, mesh);   // [w2-budget]
  }

  /**
   * [w2-budget] A chunk's building mesh is built: keep it until its sector's last chunk is in, then merge them all into
   * the sector's one mesh (the static set changes then anyway, so the bake re-runs once, not twice).
   */
  _sectorChunk(key, mesh) {
    const S = this.sectors.get(sectorOf(key));
    if (!S) { this.chunks.get(key).push(mesh); return; }
    S.left.delete(key); S.parts.push(mesh);
    if (S.left.size) return;
    const geo = this.own(mergeGeometries(S.parts.map((m) => m.geometry)));
    for (const m of S.parts) { this.group.remove(m); m.geometry.dispose(); this.disposables.delete(m.geometry); }
    S.parts = [];
    if (!geo.attributes.position?.count) return;
    const sm = new THREE.Mesh(geo, this.buildingMaterial);
    sm.castShadow = sm.receiveShadow = true; sm.name = `Buildings ${sectorOf(key)}`;
    sm.matrixAutoUpdate = false; sm.updateMatrix();
    this.group.add(sm);
    S.mesh = sm;
  }

  /** Rooftops that make the skyline: PPG Place's glass spires, the Gulf Tower's stepped pyramid, masts, water tanks. */
  _rooftop(M, b, ring, y1, seed, kit = false) {
    let cx = 0, cz = 0; for (const p of ring) { cx += p.x; cz += p.z; } cx /= ring.length; cz /= ring.length;
    if (b.kind === 6 && b.h > 18) {
      M.color('#2e3a42');
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], c = ring[(i + 1) % ring.length], len = Math.hypot(c.x - a.x, c.z - a.z), n = Math.floor(len / 6);
        const yaw = Math.atan2(c.x - a.x, c.z - a.z);
        M.pyramid(a.x, y1, a.z, 2.6, b.h > 100 ? 11 : 6, 2.6, yaw);
        for (let k = 1; k < n; k++) { const f = k / n; M.pyramid(a.x + (c.x - a.x) * f, y1, a.z + (c.z - a.z) * f, 1.8, b.h > 100 ? 6 : 3.6, 1.8, yaw); }
      }
      if (b.h > 100) M.pyramid(cx, y1, cz, 9, 26, 9);
    } else if (b.kind === 10) {
      M.color('#c9bba1');
      let r = 0; for (const p of ring) r = Math.min(r || Infinity, Math.hypot(p.x - cx, p.z - cz));
      const w = r * 1.5;
      for (let k = 0; k < 4; k++) M.box(cx, y1 + k * 4.5, cz, w * (1 - k * .2), 4.5, w * (1 - k * .2));
      M.pyramid(cx, y1 + 18, cz, w * .2, 6);
    } else if (b.name === 'Fifth Avenue Place' || b.name === 'BNY Mellon Center') {
      M.color('#8d9aa3'); M.cylinder(cx, y1, cz, .5, 30, 6, .15);
    } else if (b.h > 60) {
      M.color('#7b7f82'); M.box(cx, y1, cz, 9, 4.5, 9);
    } else if (kit) {   // [street-kit] the kit dresses ordinary roofs
    } else if (b.kind === 0 && seed > .8 && b.h < 14) {
      M.color('#5a524b'); M.box(cx, y1, cz, 1.2, 1.4, 1.2);   // chimney
    } else if ((b.kind === 2 || b.kind === 3) && seed > .86 && b.h > 13) {   // [street-kit] a timber water tank at its real size (≈ 3 m across, 2.6 m tall on 1.8 m legs; was 4.4 m on 3.5 m)
      M.color('#7d6b58'); M.cylinder(cx, y1 + 1.8, cz, 1.45, 2.6, 10, 1.45);
      M.color('#5d5650'); M.pyramid(cx, y1 + 4.4, cz, 3.1, 1.0);
      for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) M.box(cx + dx, y1, cz + dz, .18, 1.8, .18);
    }
  }

  // ---------------------------------------------------------------- streets, sidewalks and lamps
  _streetsAndLamps() {
    const roads = new Map(), walks = new Map(), paths = new Map();
    const get = (map, x, z) => { const key = `${Math.floor(x / SECTOR_M)},${Math.floor(z / SECTOR_M)}`; if (!map.has(key)) map.set(key, new MeshBuilder(map === roads ? { aSlot: 1 } : {})); return map.get(key); };   // [w2-budget] per sector (was 512 m)
    const lamps = [];
    const plan = this.junctions = this.landscape._junctions || null;   // [junctions] real intersections (js/world/junctions.js)
    this._levelJunctions();
    const slots = this.streetSlots = this._streetSlots();
    this.streets.forEach((st, k) => {
      // crossing ribbons each get their own height (2 cm apart), so lane paint never flickers at a junction
      const p0 = st.pts[0], lift = .1 + slots[k] * .02;
      if (st.cls === 8) { ribbon(get(paths, p0.x, p0.z), st.pts, st.width, lift, 8); return; }
      for (const pc of plan ? drawnPieces(st, k, plan, lift) : [st.pts]) {   // [junctions] trimmed to each junction's edge
        ribbon(get(roads, p0.x, p0.z).set({ aSlot: [slots[k]] }), pc, st.width, lift, 24, streetPaint(st), !!plan);   // [s1-lanes] paint style; [junctions] normals lean with the grade
        if (!st.bridge && st.cls >= 2 && st.cls <= 6) ribbon(get(walks, p0.x, p0.z), pc, st.width + 5, .06, 8);
      }
      // lamps every ~34 m, alternating sides
      if (st.cls >= 1 && st.cls <= 6) {
        let acc = hash(k) * 30, side = k % 2 ? 1 : -1;
        for (let i = 1; i < st.pts.length; i++) {
          const a = st.pts[i - 1], b = st.pts[i], len = Math.hypot(b.x - a.x, b.z - a.z);
          acc += len;
          if (acc < 34) continue;
          acc = 0; side = -side;
          // on a bridge the post stands on the deck slab, just inside the railing; elsewhere on the sidewalk
          const dx = (b.x - a.x) / (len || 1), dz = (b.z - a.z) / (len || 1), off = st.width / 2 + (st.bridge ? .05 : .9);
          const x = b.x - dz * off * side, z = b.z + dx * off * side;
          if (!this._clearSpot(x, z, .35, k, ROAD_WIDTH / 2 + 1.2)) continue;
          if (st.bridge && this._onStyledBridge(x, z)) continue;   // the famous bridges carry their own lights (and railings)
          lamps.push({ x, z, y: st.bridge ? b.y : this.landscape.heightAt(x, z), yaw: Math.atan2(dz * side, -dx * side), bridge: st.bridge });
        }
      }
    });
    // the route itself: lamps along streets and riverfront trails
    const r = this.route, end = r.turnIdx || r.dist.length - 1;
    for (let i = 3; i < end - 3; i += 3) {
      const s = r.dist[i], kind = this.landscape.routeKindAt(s);
      const every = kind === 'road' ? 36 : 30;
      if (Math.floor(s / every) === Math.floor(r.dist[i - 3] / every)) continue;
      const dx = this.index.xs[i + 1] - this.index.xs[i - 1], dz = this.index.zs[i + 1] - this.index.zs[i - 1], len = Math.hypot(dx, dz) || 1;
      const deckBridge = this.landscape.routeBridges.find((b) => s > b.fromM - 6 && s < b.toM + 6);
      if (deckBridge && deckBridge.style && deckBridge.style !== 'girder') continue;   // styled bridges carry their own lights
      for (const side of kind === 'road' ? [-1, 1] : [Math.floor(s / every) % 2 ? 1 : -1]) {
        // on a girder deck: on the slab inside the railing ((ROAD_WIDTH + 3) / 2 + .25)
        const kitLamp = !deckBridge && kind === 'road' ? this.streetKit?.routeLamp(s, side) : undefined;   // [street-kit] in a kit zone: at the curb, on its sidewalk
        if (kitLamp === null) continue;   // [street-kit] (no sidewalk there: a junction)
        const off = deckBridge ? (ROAD_WIDTH + 3) / 2 + .05 : ROAD_WIDTH / 2 + (kind === 'road' ? 2.6 : 1.6);
        const x = kitLamp ? kitLamp.x : this.index.xs[i] - dz / len * off * side, z = kitLamp ? kitLamp.z : this.index.zs[i] + dx / len * off * side;
        if (!deckBridge && !this._clearSpot(x, z, .35, -1, ROAD_WIDTH / 2 + 1.2)) continue;
        // on a deck: not in another carriageway that runs alongside at the same level (the roadway's other half)
        if (deckBridge && this.landscape.streetsNear(x, z, .35).some((o) => this.streets[o.k].cls !== 8 && Math.abs(o.y - r.ele[i]) < 1.5)) continue;
        lamps.push({ x, z, y: deckBridge ? r.ele[i] : kitLamp ? kitLamp.y : this.landscape.heightAt(x, z), yaw: Math.atan2(dz / len * side, -dx / len * side), bridge: !!deckBridge });   // [street-kit] (kitLamp.y)
      }
    }
    if (plan) this.junctionMeshes = buildJunctionMeshes(this, plan, { get, roads, walks, liftOf: (k) => .1 + slots[k] * .02 });   // [junctions]
    for (const [map, mat, name] of [[roads, this.streetMaterial, 'Streets'], [walks, this.sidewalkMaterial, 'Sidewalks'], [paths, this.pathMaterial, 'Paths']]) {
      for (const [key, builder] of map) {
        builder.keepOutOf(this.landscape.inRouteTube);   // ramps and roadways the data puts in the rider's space
        const mesh = new THREE.Mesh(this.own(builder.geometry()), mat);
        mesh.receiveShadow = true; mesh.name = `${name} ${key}`; mesh.renderOrder = 1;
        this.group.add(mesh);
      }
    }
    this.lamps = lamps;
    this._lampMeshes(lamps);
  }

  /** Within r metres of a river wall's line? */
  nearWall(x, z, r) {
    for (let gx = Math.floor((x - r) / 20); gx <= Math.floor((x + r) / 20); gx++) for (let gz = Math.floor((z - r) / 20); gz <= Math.floor((z + r) / 20); gz++) {
      const a = this.wallGrid?.get(`${gx},${gz}`); if (!a) continue;
      for (let q = 0; q < a.length; q += 4) {
        const ax = a[q], az = a[q + 1], bx = a[q + 2], bz = a[q + 3], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
        if (Math.hypot(ax + dx * t - x, az + dz * t - z) < r) return true;
      }
    }
    return false;
  }

  /** Inside a stadium bowl (or within `pad` of its outline)? */
  inStadium(x, z, pad = 0) {
    for (const r of this.stadiumRings || []) {
      if (x < r.bb[0] - pad || x > r.bb[1] + pad || z < r.bb[2] - pad || z > r.bb[3] + pad) continue;
      let inside = false;
      for (let i = 0, j = r.ring.length - 1; i < r.ring.length; j = i++) { const a = r.ring[i], c = r.ring[j]; if ((a.z > z) !== (c.z > z) && x < ((c.x - a.x) * (z - a.z)) / (c.z - a.z) + a.x) inside = !inside; }
      if (inside) return true;
      if (pad) for (const p of r.ring) if (Math.hypot(p.x - x, p.z - z) < pad + 8) return true;
    }
    return false;
  }

  /** Within 14 m of one of the styled river bridges' structure lines (data.bridges)? */
  _onStyledBridge(x, z) {
    if (!this._styled) {
      this._styled = new Map();
      for (const br of this.data.bridges || []) {
        const pts = br.path.map(([qa, qo]) => this.D.local(qa, qo));
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], c = pts[i], n = Math.max(1, Math.ceil(Math.hypot(c.x - a.x, c.z - a.z) / 4));
          for (let k = 0; k <= n; k++) { const px = a.x + (c.x - a.x) * k / n, pz = a.z + (c.z - a.z) * k / n, key = `${Math.floor(px / 20)},${Math.floor(pz / 20)}`; if (!this._styled.has(key)) this._styled.set(key, []); this._styled.get(key).push([px, pz]); }
        }
      }
    }
    for (let gx = Math.floor(x / 20) - 1; gx <= Math.floor(x / 20) + 1; gx++) for (let gz = Math.floor(z / 20) - 1; gz <= Math.floor(z / 20) + 1; gz++) {
      for (const [px, pz] of this._styled.get(`${gx},${gz}`) || []) if (Math.hypot(px - x, pz - z) < 14) return true;
    }
    return false;
  }

  _lampMeshes(lamps) {
    const pole = new MeshBuilder();
    pole.color('#3a3d40'); pole.cylinder(0, 0, 0, .1, 7.2, 6, .07); pole.beam(new THREE.Vector3(0, 7.1, 0), new THREE.Vector3(0, 7.25, 1.6), .1, .1);
    pole.color('#2e3033'); pole.box(0, 6.95, 1.75, .5, .3, .8);
    pole.color('#fff4d6'); pole.box(0, 6.9, 1.75, .36, .06, .6);
    const poleGeo = this.own(pole.geometry());
    const poleMat = this.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .6, metalness: .4 }));
    poleMat.onBeforeCompile = (shader) => {
      shader.uniforms.uNight = this.night;
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += step(.95, vColor.b) * vec3(1., .85, .6) * uNight * 3.;');
    };
    poleMat.customProgramCacheKey = () => 'city-lamp-1';
    const glowGeo = this.own(new THREE.PlaneGeometry(1, 1));
    const poolTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
      const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31); gr.addColorStop(0, 'rgba(255,214,150,.55)'); gr.addColorStop(1, 'rgba(255,214,150,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return this.own(new THREE.CanvasTexture(c));
    })();
    const poolMat = this.own(new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    this.poolMaterial = poolMat;
    const poolGeo = this.own(new THREE.PlaneGeometry(1, 1)); poolGeo.rotateX(-Math.PI / 2);
    const byChunk = new Map();
    for (const l of lamps) { const key = `${Math.floor(l.x / SECTOR_M)},${Math.floor(l.z / SECTOR_M)}`;   // [w2-budget] per sector (was 640 m)
      if (!byChunk.has(key)) byChunk.set(key, []); byChunk.get(key).push(l); }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    for (const list of byChunk.values()) {
      const poles = new THREE.InstancedMesh(poleGeo, poleMat, list.length);
      const glows = new THREE.InstancedMesh(glowGeo, this.glowMaterial, list.length);
      const pools = new THREE.InstancedMesh(poolGeo, poolMat, list.length);
      const colors = new Float32Array(list.length * 3);
      const glowGeoChunk = this.own(glowGeo.clone());
      glowGeoChunk.setAttribute('aGlow', new THREE.InstancedBufferAttribute(colors, 3));
      glows.geometry = glowGeoChunk;
      list.forEach((l, i) => {
        q.setFromAxisAngle(Y, l.yaw); p.set(l.x, l.y - .1, l.z);
        poles.setMatrixAt(i, m.compose(p, q, s));
        const head = new THREE.Vector3(0, 6.85, 1.75).applyQuaternion(q).add(p);
        glows.setMatrixAt(i, m.compose(head, new THREE.Quaternion(), new THREE.Vector3(4.2, 4.2, 4.2)));
        colors.set([1, .78, .5], i * 3);
        const ground = l.bridge ? l.y + .2 : this.landscape.heightAt(head.x, head.z) + .2;
        pools.setMatrixAt(i, m.compose(new THREE.Vector3(head.x, ground, head.z), new THREE.Quaternion(), new THREE.Vector3(17, 1, 17)));
      });
      poles.name = 'Lamp posts'; glows.name = 'Lamp glows'; pools.name = 'Lamp pools';   // [w2-budget] named for --breakdown (the clipping QC's label)
      for (const im of [poles, glows, pools]) { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); this.group.add(im); }
      poles.castShadow = true; poles.receiveShadow = true;
      // [w2-budget] posts are thin (not in the bake), so they can come and go with distance without a re-bake: past
      // LAMP_LOD of the camera they are under a pixel wide and only cost triangles. The glows and pools stay (night).
      poles.userData.bake = false; poles.computeBoundingBox(); (this.lampPosts ||= []).push(poles);
      glows.renderOrder = 5; pools.renderOrder = 3;
      (this.nightOnly ||= []).push(glows, pools);
    }
  }

  /** Night glows at fixed points: [{x, y, z, size, color}] → one instanced mesh. */
  addGlows(list, name = 'Glows') {
    if (!list.length) return null;
    const geo = this.own(new THREE.PlaneGeometry(1, 1));
    const colors = new Float32Array(list.length * 3), c = new THREE.Color();
    const im = new THREE.InstancedMesh(geo, this.glowMaterial, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    list.forEach((g, i) => {
      im.setMatrixAt(i, m.compose(new THREE.Vector3(g.x, g.y, g.z), q, new THREE.Vector3(g.size || 3, g.size || 3, g.size || 3)));
      c.set(g.color || '#ffe2b0'); colors.set([c.r, c.g, c.b], i * 3);
    });
    geo.setAttribute('aGlow', new THREE.InstancedBufferAttribute(colors, 3));
    im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.name = name; im.renderOrder = 5;
    im.visible = this.night.value > .01;
    (this.nightOnly ||= []).push(im); this.group.add(im);
    return im;
  }

  // ---------------------------------------------------------------- trees along streets
  /**
   * Can a post or trunk stand at (x, z)? Not in water or a building (nor within `wall` of one), not on any
   * street's carriageway (nor within `margin` of it; `skip` = the street it belongs to, when on its own deck),
   * and not within `routeClear` of the route's road (true distance to the road, not its 10 m sample points).
   */
  _clearSpot(x, z, margin, skip, routeClear, wall = margin) {
    const L = this.landscape, c = L.landAt(x, z);
    if (c === LAND.water && !L.bridgeAt(x, z, 0)) return false;
    if (this.buildingNear(x, z, wall)) return false;
    if (this.inStadium(x, z, 4) || this.nearWall(x, z, Math.max(1.2, margin + .6))) return false;
    // any street's carriageway, not just the nearest; its own street too, where a bend brings the roadway back
    // to it (a post on its own bridge deck stands on the slab's edge, so there it may touch the roadway)
    for (const o of L.streetsNear(x, z, margin)) {
      const st = this.streets[o.k];
      if (st.cls === 8) continue;
      if (o.k !== skip || o.edge < (st.bridge ? -.05 : .5)) return false;
    }
    if (junctionsNear(L._junctions, x, z, margin).length) return false;   // [junctions] nor on a junction's surface
    const r = L.routeDist(x, z);
    return !(r && r.d < routeClear);
  }

  /**
   * Junctions are level: wherever ground-level streets meet, every point of each within 6 m of the other's
   * carriageway takes the highest of their heights, so the 2 cm height slots below decide which is on top.
   * (Each street is tilted along its own grade, so two that merely share a height at one point still cross
   * along a line, and the lane paint flickers there.) Ramps and decks keep their own heights; streets more
   * than 0.8 m apart in height are crossing, not joining.
   */
  _levelJunctions() {
    if (this.landscape._junctions) return;   // [junctions] the junction plan owns street heights where streets meet
    const L = this.landscape, reach = 6;
    // each junction (a cluster of street points within `reach` of another street's carriageway, at nearly the
    // same height) becomes a level plateau at the highest of its heights
    for (let pass = 0; pass < 3; pass++) {
      this.streets.forEach((st, k) => {
        if (st.bridge) return;
        for (const p of st.pts) {
          if (p.jn != null) continue;   // [junctions] inside a junction its surface owns the height
          for (const o of L.streetsNear(p.x, p.z, reach)) {
            if (o.k === k || this.streets[o.k].bridge || Math.abs(o.y - p.y) > .8) continue;
            if (o.y > p.y) p.y = o.y;
          }
        }
      });
    }
  }

  /** Height slots for street ribbons: streets whose ribbons overlap (junctions, crossings) never share one. */
  _streetSlots() {
    if (this.landscape._junctions) return streetSlots(this.landscape, this.streets);   // [junctions] the same slots the plan and QC use
    const L = this.landscape, n = this.streets.length, slots = new Array(n).fill(-1);
    const order = [...Array(n).keys()].sort((a, b) => this.streets[a].cls - this.streets[b].cls || a - b);
    for (const k of order) {
      const st = this.streets[k], used = new Set();
      for (const p of st.pts) {
        // another street's ribbon (or sidewalk) reaches this one's
        for (const o of L.streetsNear(p.x, p.z, st.width / 2 + 5)) if (o.k !== k && slots[o.k] >= 0) used.add(slots[o.k]);
      }
      let slot = 0; while (used.has(slot) && slot < 7) slot++;
      slots[k] = slot;
    }
    return slots;
  }

  _trees() {
    const spots = [];
    this.streets.forEach((st, k) => {
      if (st.bridge || st.cls < 3 || st.cls > 6) return;
      let acc = hash(k * 3) * 15;
      for (let i = 1; i < st.pts.length; i++) {
        const a = st.pts[i - 1], b = st.pts[i], len = Math.hypot(b.x - a.x, b.z - a.z);
        acc += len; if (acc < 15) continue; acc = 0;
        for (const side of [-1, 1]) {
          if (hash(k * 131 + i * 17 + side) < .5) continue;
          const dx = (b.x - a.x) / (len || 1), dz = (b.z - a.z) / (len || 1), off = st.width / 2 + 2.3;
          spots.push({ x: b.x - dz * off * side, z: b.z + dx * off * side, seed: hash(k * 7 + i * 3 + side) });
        }
      }
    });
    const kitTrees = this.streetKit?.treeSpots() || [];   // [street-kit] street trees in the kit's tree pits (placed and checked by the kit)
    spots.push(...kitTrees);
    const T = this.data.trees ? new Int16Array(Uint8Array.from(atob(this.data.trees), (c) => c.charCodeAt(0)).buffer) : [];
    for (let i = 0; i < T.length; i += 2) { const p = this.D.local(T[i], T[i + 1]); spots.push({ ...p, seed: hash(i) }); }
    // [s4-section] tree rows along the route (a riverfront park, an avenue): scene `routeTrees` =
    // [{fromM, toM, spacingM = 12, offsetM = 7.5, sides: [-1, 1] (left, right of the ride)}]; spots that aren't clear are dropped
    // [s4-section] yard trees: scene `vegetation.yardTrees` = {density, spacingM = 15, boxes: [[s, w, n, e]…]} — a
    // jittered grid over the yards (land use "yards") inside the boxes (lat/lon), near the ride
    const YT = this.route.scene?.vegetation?.yardTrees, railPts = new Map();
    if (YT) for (const r of this.data.rails || []) {   // yard trees keep 5 m off the railways (10 m grid of 3 m steps)
      const pts = r.path.map(([qa, qo]) => this.D.local(qa, qo));
      for (let q = 1; q < pts.length; q++) {
        const a0 = pts[q - 1], a1 = pts[q], n = Math.max(1, Math.ceil(Math.hypot(a1.x - a0.x, a1.z - a0.z) / 3));
        for (let t = 0; t <= n; t++) { const px = a0.x + (a1.x - a0.x) * t / n, pz = a0.z + (a1.z - a0.z) * t / n; railPts.set(`${Math.floor(px / 5)},${Math.floor(pz / 5)}`, true); }
      }
    }
    const nearRail = (x, z) => { for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if (railPts.has(`${Math.floor(x / 5) + i},${Math.floor(z / 5) + j}`)) return true; return false; };
    for (const [bs, bw, bn, be] of YT?.boxes || []) {
      const P = this.D.proj, a = P.toLocal(bs, bw), b = P.toLocal(bn, be), g = YT.spacingM || 15;
      for (let x = Math.min(a.x, b.x); x < Math.max(a.x, b.x); x += g) for (let z = Math.min(a.z, b.z); z < Math.max(a.z, b.z); z += g) {
        const seed = hash(x * .37 + z * 1.13);
        if (seed > (YT.density ?? .5)) continue;
        const px = x + (hash(x + z * 3.1) - .5) * g * .8, pz = z + (hash(x * 2.3 - z) - .5) * g * .8;
        if (this.landscape.landAt(px, pz) !== LAND.yards || !this.index.nearest(px, pz, 650) || nearRail(px, pz)) continue;
        spots.push({ x: px, z: pz, seed: hash(seed * 997), wall: 3 });   // crowns clear of the houses
      }
    }
    for (const row of this.route.scene?.routeTrees || []) {
      const R = this.route, I = this.index, last = (R.turnIdx || R.dist.length - 1) - 1;
      for (let s = row.fromM, n = 0; s < row.toM; s += row.spacingM || 12, n++) {
        const i = Math.max(0, Math.min(last - 1, Math.floor(s / 10))), f = Math.min(1, (s - R.dist[i]) / 10);
        const x = I.xs[i] + (I.xs[i + 1] - I.xs[i]) * f, z = I.zs[i] + (I.zs[i + 1] - I.zs[i]) * f;
        const dx = I.xs[i + 1] - I.xs[i], dz = I.zs[i + 1] - I.zs[i], l = Math.hypot(dx, dz) || 1;
        for (const side of row.sides || [-1, 1]) {
          const seed = hash(s * 7 + side * 3), off = (row.offsetM ?? 7.5) + (seed - .5) * 1.5;
          spots.push({ x: x - (dz / l) * off * side, z: z + (dx / l) * off * side, seed });
        }
      }
    }
    // a light street tree: trunk + two lumpy crowns (~40 triangles), coloured per instance
    const M = new MeshBuilder();
    M.color('#5b4636');   // [w2-budget] the trunk: five sides, no cap (it ends inside the crown): 10 triangles, was 15
    for (let k = 0; k < 5; k++) {
      const p = (a, r, y) => new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r), a0 = k / 5 * Math.PI * 2, a1 = (k + 1) / 5 * Math.PI * 2;
      M.quad(p(a0, .16, 0), p(a0, .12, 3.2), p(a1, .12, 3.2), p(a1, .16, 0));
    }
    const crown = new THREE.IcosahedronGeometry(1, 0).toNonIndexed(), pos = crown.attributes.position;
    for (const [ox, oy, oz, r] of [[0, 4.8, 0, 2.4]]) {
      M.color('#ffffff');
      for (let k = 0; k < pos.count; k += 3) {
        const v = [0, 1, 2].map((j) => new THREE.Vector3(pos.getX(k + j) * r + ox, pos.getY(k + j) * r * .9 + oy, pos.getZ(k + j) * r + oz));
        M.triangle(v[0], v[1], v[2]);
      }
    }
    crown.dispose();
    const geo = this.own(M.geometry());
    const mat = this.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95, flatShading: true }));
    const greens = ['#5f8a3e', '#6f9a45', '#557d38', '#7a9b4a', '#4f7434', '#8aa452'].map((c) => new THREE.Color(c));
    const lists = new Map();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
    for (const t of spots) {
      const road = this.index.nearest(t.x, t.z, 650);
      if (!road) continue;   // near the ride only
      // trunk clear of every carriageway, the crown clear of walls, and nothing growing over the rider's road
      if (!t.kit && !this._clearSpot(t.x, t.z, 1.6, -1, ROAD_WIDTH / 2 + 2.4, t.wall ?? 1.2)) continue;   // [s4-section] t.wall, [street-kit] kit trees: checked
      const key = `${Math.floor(t.x / SECTOR_M)},${Math.floor(t.z / SECTOR_M)}`, w = .75 + t.seed * .5;   // [w2-budget] per sector (was 480 m)
      q.setFromAxisAngle(Y, t.seed * 40);
      if (!lists.has(key)) lists.set(key, []);
      lists.get(key).push({ m: m.compose(new THREE.Vector3(t.x, t.y ?? this.landscape.heightAt(t.x, t.z) - .1, t.z), q, new THREE.Vector3(w, w * (.85 + t.seed * .3) * (t.sy || 1), w)).clone(), seed: t.seed });   // [street-kit] (sy: kit street trees stand taller)
    }
    for (const list of lists.values()) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((t, i) => { im.setMatrixAt(i, t.m); im.setColorAt(i, greens[Math.floor(t.seed * 997) % greens.length]); });
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
      im.castShadow = im.receiveShadow = true; im.name = 'Street trees'; this.group.add(im);
    }
    this.treeCount = spots.length;
  }

  // ---------------------------------------------------------------- per-frame
  /** Build a few building chunks per frame, nearest first, so the ride never stalls. */
  _stream(cx, cz) {
    if (!this._pending.length) return;
    const t0 = performance.now();
    this._pending.sort((a, b) => {
      const [ax, az] = a.split(',').map(Number), [bx, bz] = b.split(',').map(Number);
      return Math.hypot((bx + .5) * CHUNK - cx, (bz + .5) * CHUNK - cz) - Math.hypot((ax + .5) * CHUNK - cx, (az + .5) * CHUNK - cz);
    });
    if (this.streetKit) this.streetKit.deferred = !!this._warm;   // [street-kit] while riding, its chunk work runs in its own frame budget
    while (this._pending.length && performance.now() - t0 < (this._warm ? 7 : 400)) this._buildChunk(this._pending.pop());
    this._warm = true;
  }

  tick(camera, dt, time, rider) {
    this._stream(camera.x, camera.z);
    this.life.tick(camera, dt, time, rider);
    this.landmarks?.tick?.(time, dt);
    this.heroes?.tick?.(time, dt);
    this.streetKit?.tick(camera);   // [street-kit] LOD
    if ((this._lodFrame = (this._lodFrame || 0) + 1) % 10 === 1) this._lampLod(camera);   // [w2-budget]
  }

  /** [w2-budget] Lamp posts: drawn only in sectors within LAMP_LOD of the camera. */
  _lampLod(camera) {
    const r = LAMP_LOD[this.qualityKey] || LAMP_LOD.balanced, p = new THREE.Vector3(camera.x, camera.y, camera.z);
    // (by layer, not .visible: tools that index the scene, like the clipping QC, still see every post)
    for (const m of this.lampPosts || []) { if (m.boundingBox.distanceToPoint(p) < r) m.layers.set(0); else m.layers.disableAll(); }
  }

  setNight(v) {
    this.night.value = v;
    this.landmarks?.setNight?.(v);
    if (this.poolMaterial) this.poolMaterial.opacity = v;
    this.streetKit?.setNight(v);   // [street-kit]
    for (const m of this.nightOnly || []) m.visible = v > 0.01;
  }

  setQuality(key) { this.qualityKey = key; this.life.setQuality(key); this.streetKit?.setQuality(key); this._lodFrame = 0; }   // [street-kit] [w2-budget] (lamp LOD on the next tick)

  dispose() {
    this.life.dispose();
    this.group.parent?.remove(this.group);
    this.group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
    for (const x of this.disposables) x.dispose?.();
    this.disposables.clear();
  }
}
