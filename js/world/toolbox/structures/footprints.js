// Buildings from map footprints: every mapped building near the road (tools/build_places.py → "places.buildings"),
// extruded from its real outline and roofed in the region's style, merged into one draw per stretch of road.
// Real places drawn in the cartoon look: the outline, size and height are the map's; the colours, roofs, windows,
// shutters and balconies come from the scene's "buildingStyles" (by stretch), so the Dévoluy's grey stone houses
// and the Oisans' rendered chalets differ. Churches get a bell tower, ski-resort blocks get flat roofs and
// balcony bands. Windows and shutters are drawn by the shader (no extra geometry).
//
//   "buildingStyles": [
//     { "fromM": 0, "toM": 60000, "walls": ["#cfc6b4", "#b9b0a0"], "roofs": ["#6e6a66", "#7a5a48"], "trim": ["#6b8a5a", "#8a5a3a"],
//       "stone": 0.6, "pitch": 30 },
//     { "fromM": 60000, "walls": ["#e3d3b5", "#d9c19a"], "roofs": ["#8b4a36", "#6d5446"], "trim": ["#7d4a2d"], "balconies": 0.5 } ],
//   "buildings": { "reachM": 9000, "chunkM": 3000, "landmarks": [ { "name": "Notre-Dame des Neiges", "shape": "tent" } ] }
import * as THREE from '../../../../vendor/three.module.min.js';
import { randomSequence } from '../core/random.js';

const ROAD_HALF = 3.5;
const KIND = ['house', 'farm', 'barn', 'shed', 'church', 'chapel', 'apartments', 'hotel', 'commercial', 'public', 'garage', 'industrial', 'chalet', 'ruin'];
// storeys and floor heights when the map has none
const DEFAULT_LEVELS = { house: 2, farm: 2, barn: 1, shed: 1, church: 1, chapel: 1, apartments: 5, hotel: 4, commercial: 2, public: 2, garage: 1, industrial: 1, chalet: 2, ruin: 1 };
const FLOOR_M = 2.9;

/** Pure planning: buildings in local metres, the ones off the road, and tree clearings round them. */
export function planFootprints(config, proj, index) {
  const data = config.places?.buildings;
  if (!data?.length) return null;
  const out = [], clear = [];
  for (const e of data) {
    const [lat, lon, xy, levels, kind, roof, height, s, , name] = e;
    const c = proj.toLocal(lat, lon);
    const pts = [];
    for (let k = 0; k < xy.length; k += 2) pts.push([c.x + xy[k] / 10, c.z + xy[k + 1] / 10]);
    if (pts.length < 3) continue;
    // keep the road clear: a footprint the 7 m road would run through is left out
    let onRoad = false;
    for (const [x, z] of pts) { const n = index.nearest(x, z, ROAD_HALF + 1.2); if (n) { onRoad = true; break; } }
    if (onRoad || index.nearest(c.x, c.z, ROAD_HALF + 2)) continue;
    let r = 0;
    for (const [x, z] of pts) r = Math.max(r, Math.hypot(x - c.x, z - c.z));
    const b = { x: c.x, z: c.z, pts, levels, kind: KIND[kind] || 'house', roof, height, s, r, name: name || '' };
    out.push(b);
    clear.push({ x: c.x, z: c.z, r: r + 4 });
  }
  return { buildings: out, clearings: clear };
}

/** Minimum-area rectangle round a polygon (rotating the hull's edges): centre, axes, half sizes. */
function orientedBox(pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < .3) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L, vx = -uz, vz = ux;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of pts) { const u = x * ux + z * uz, v = x * vx + z * vz; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, ux, uz, vx, vz, cu: (u0 + u1) / 2, cv: (v0 + v1) / 2, hu: (u1 - u0) / 2, hv: (v1 - v0) / 2 };
  }
  if (!best) return null;
  // the long axis first (the ridge runs along it)
  if (best.hv > best.hu) best = { ...best, ux: best.vx, uz: best.vz, vx: -best.ux, vz: -best.uz, cu: best.cv, cv: -best.cu, hu: best.hv, hv: best.hu };
  best.cx = best.cu * best.ux + best.cv * best.vx; best.cz = best.cu * best.uz + best.cv * best.vz;
  return best;
}

const polyArea = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % pts.length]; a += x0 * z1 - x1 * z0; } return a / 2; };

/** Geometry writer: positions, normals, colours, facade attributes (u along the wall, height, floor height, style). */
class Writer {
  constructor() { this.p = []; this.n = []; this.c = []; this.f = []; this.t = []; }
  tri(a, b, c, col, fac, trim, fa = fac, fb = fac) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
    for (const [v, f] of [[a, fac], [b, fa], [c, fb]]) { this.p.push(...v); this.n.push(nx, ny, nz); this.c.push(col.r, col.g, col.b); this.f.push(...f); this.t.push(trim.r, trim.g, trim.b); }
  }
  quad(a, b, c, d, col, trim, fa, fb, fc, fd) { this.tri(a, b, c, col, fa, trim, fb, fc); this.tri(a, c, d, col, fa, trim, fc, fd); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aFacade', new THREE.Float32BufferAttribute(this.f, 4));
    g.setAttribute('aTrim', new THREE.Float32BufferAttribute(this.t, 3));
    g.computeBoundingSphere();
    return g;
  }
}

const NOFAC = [0, 0, 0, -1];

function material(uniforms) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aFacade; attribute vec3 aTrim; varying vec4 vFac; varying vec3 vTrim; varying float vFpx;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFac = aFacade; vTrim = aTrim;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvFpx = -mvPosition.z;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vFac; varying vec3 vTrim; varying float vFpx;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (vFac.w >= 0.) {
          // facades: windows with shutters on each floor; style 0 house, 1 church (tall narrow), 2 block (balcony bands), 3 barn (planks)
          float u = vFac.x, v = vFac.y, fh = vFac.z, st = vFac.w;
          float fade = 1. - smoothstep(180., 520., vFpx);
          float floorV = mod(v, fh), floorN = floor(v / fh);
          if (st > 2.5) {
            // barn: vertical plank lines in the upper half, stone below
            float plank = smoothstep(.04, .0, abs(fract(u * 2.5) - .5) - .45);
            diffuseColor.rgb *= 1. - plank * .25 * step(1.8, v) * fade;
          } else {
            float cellW = st > .5 && st < 1.5 ? 4.5 : 3.2;
            float cu = abs(fract(u / cellW) - .5) * cellW;
            float winW = st > .5 && st < 1.5 ? .5 : .55, top = st > .5 && st < 1.5 ? fh * .8 : 2.15, bot = st > .5 && st < 1.5 ? 2.2 : .95;
            float inWin = step(cu, winW) * step(bot, floorV) * step(floorV, top);
            float shutter = step(winW, cu) * step(cu, winW + .45) * step(bot, floorV) * step(floorV, top) * step(st, .5);
            float frame = step(cu, winW + .08) * step(bot - .08, floorV) * step(floorV, top + .08) * (1. - inWin);
            float edge = step(.6, u) * step(.6, vFac.y);
            vec3 c = diffuseColor.rgb;
            c = mix(c, vec3(.93, .92, .88), frame * .8);
            c = mix(c, vTrim, shutter * .9);
            c = mix(c, vec3(.16, .19, .23), inWin);
            // blocks: a wooden balcony band along each floor above the ground floor
            if (st > 1.5 && st < 2.5) c = mix(c, vTrim * .8, step(.5, floorN) * step(floorV, .9) * .85);
            diffuseColor.rgb = mix(diffuseColor.rgb, c, fade * step(.5, v));
          }
        }`);
  };
  m.customProgramCacheKey = () => 'bf-footprints-1';
  return m;
}

export class Footprints {
  constructor(parent, plan, landscape, config, uniforms) {
    this.group = new THREE.Group(); this.group.name = 'Buildings (map footprints)'; parent.add(this.group);
    const opts = { reachM: 9000, chunkM: 3000, ...(config.buildings || {}) };
    this.reach = opts.reachM;
    this.L = landscape;
    this.material = material(uniforms);
    const styles = (config.buildingStyles || [{}]).map((st) => ({
      fromM: st.fromM ?? 0, toM: st.toM ?? Infinity,
      walls: (st.walls || ['#d9cfbd', '#cbbfa9', '#e2d8c4']).map((c) => new THREE.Color(c)),
      roofs: (st.roofs || ['#7b4b3a', '#6d6863', '#8b5a44']).map((c) => new THREE.Color(c)),
      trim: (st.trim || ['#6b4a35', '#4f6b52', '#7a6a5a']).map((c) => new THREE.Color(c)),
      stone: st.stone ?? .4, pitch: (st.pitch ?? 32) * Math.PI / 180, eave: st.eaveM ?? .5,
      // ski-resort stretches: big houses are apartment blocks (balcony bands, low roofs); chalets: wooden balconies
      blockArea: st.blockAreaM2 ?? Infinity, balconies: st.balconies ?? 0,
    }));
    const styleAt = (s) => styles.find((st) => s >= st.fromM && s < st.toM) || styles[0];
    const landmarks = opts.landmarks || [];
    const rand = randomSequence((config.seed || 1) * 97 + 11);
    const chunks = new Map();
    for (const b of plan.buildings) {
      const key = Math.floor(b.s / opts.chunkM);
      if (!chunks.has(key)) chunks.set(key, { w: new Writer(), x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, n: 0 });
      const ch = chunks.get(key);
      this._building(ch.w, b, styleAt(b.s), rand, landmarks.find((l) => l.name && b.name.includes(l.name)));
      ch.x0 = Math.min(ch.x0, b.x - b.r); ch.x1 = Math.max(ch.x1, b.x + b.r); ch.z0 = Math.min(ch.z0, b.z - b.r); ch.z1 = Math.max(ch.z1, b.z + b.r); ch.n++;
    }
    this.meshes = [];
    for (const [key, ch] of chunks) {
      const mesh = new THREE.Mesh(ch.w.build(), this.material);
      mesh.name = `Buildings ${key * opts.chunkM / 1000}–${(key + 1) * opts.chunkM / 1000} km (${ch.n})`;
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData.box = ch;
      this.group.add(mesh); this.meshes.push(mesh);
    }
    this.count = plan.buildings.length;
  }

  _building(w, b, style, rand, landmark) {
    const L = this.L, pts = b.pts;
    // ground under the outline: the walls start below the lowest corner
    let lo = Infinity, hi = -Infinity;
    for (const [x, z] of pts) { const h = L.heightAt(x, z); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    lo = Math.min(lo, L.heightAt(b.x, b.z)) - .4;
    const area = Math.abs(polyArea(pts));
    const kind = b.kind;
    const levels = b.levels || DEFAULT_LEVELS[kind] || 2;
    const h = rand();
    let wallH = b.height ? Math.max(2.5, b.height * .78) : kind === 'shed' || kind === 'garage' ? 2.6 : kind === 'barn' ? 5.5 + h * 1.5 : kind === 'church' ? 9 + h * 2 : kind === 'chapel' ? 5.5 : levels * FLOOR_M + .4;
    if (kind === 'house' && !b.levels && area > 160) wallH += FLOOR_M;   // bigger farmhouses: a storey more
    if (kind === 'ruin') wallH = 2 + h * 2;
    // eaves: a storey's worth above the uphill corner at most (the downhill side shows a taller wall, as in the Alps)
    const top = lo + wallH + Math.min(hi - lo, FLOOR_M) * .8;
    const block = kind === 'apartments' || kind === 'hotel' || (kind === 'house' && (area > style.blockArea || levels >= 4));
    const chalet = !block && kind === 'house' && style.balconies > (h * 7.3) % 1;
    const wall = style.walls[Math.floor(h * 997) % style.walls.length].clone();
    const roofCol = style.roofs[Math.floor(h * 773) % style.roofs.length].clone();
    const trim = style.trim[Math.floor(h * 557) % style.trim.length].clone();
    if (kind === 'barn') wall.lerp(new THREE.Color('#7a6248'), .6);
    if (kind === 'church' || kind === 'chapel') wall.lerp(new THREE.Color('#d8d2c4'), .4);
    if (block) wall.lerp(new THREE.Color('#e8e2d2'), .3);
    // every house a little different: warmer or cooler, lighter or darker
    wall.offsetHSL((((h * 31.7) % 1) - .5) * .03, (((h * 17.3) % 1) - .5) * .08, (((h * 11.9) % 1) - .5) * .1);
    roofCol.offsetHSL(0, 0, (((h * 23.1) % 1) - .5) * .08);
    const facStyle = kind === 'church' || kind === 'chapel' ? 1 : block || chalet ? 2 : kind === 'barn' || kind === 'shed' || kind === 'garage' ? 3 : kind === 'ruin' ? -1 : 0;
    const stoneBase = style.stone > h && facStyle === 0 ? Math.min(1.1, wallH * .3) : 0;
    const stone = new THREE.Color('#a59d8f');
    // walls (counter-clockwise outline: make sure the faces point outward)
    const ccw = polyArea(pts) > 0;
    let u = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[ccw ? (pts.length - i) % pts.length : i], c = pts[ccw ? (pts.length - i - 1 + pts.length) % pts.length : (i + 1) % pts.length];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const A = [a[0], lo, a[1]], B = [c[0], lo, c[1]], C = [c[0], top, c[1]], D = [a[0], top, a[1]];
      const fac = (uu, vv) => [uu, vv, FLOOR_M, facStyle];
      const H = top - lo, base = (hi - lo) * .5;   // windows count floors from the ground at the wall's foot (about)
      w.quad(A, B, C, D, wall, trim, fac(u, -base), fac(u + len, -base), fac(u + len, H - base), fac(u, H - base));
      if (stoneBase) {
        const S = lo + base + stoneBase;
        // a stone plinth: a slightly proud band at the foot (cartoon: just a colour band on its own quad)
        const o = .03, nx = (c[1] - a[1]) / len * o, nz = -(c[0] - a[0]) / len * o;
        w.quad([a[0] + nx, lo, a[1] + nz], [c[0] + nx, lo, c[1] + nz], [c[0] + nx, S, c[1] + nz], [a[0] + nx, S, a[1] + nz], stone, trim, NOFAC, NOFAC, NOFAC, NOFAC);
      }
      u += len;
    }
    // roof
    const box = orientedBox(pts);
    if (!box) return;
    const rect = area / (4 * box.hu * box.hv);
    const flat = block && (b.roof === 2 || area > 900) || kind === 'industrial' || kind === 'commercial' && area > 500 || b.roof === 2 || kind === 'ruin';
    if (landmark?.shape === 'tent') { this._tent(w, box, top, roofCol.clone().lerp(new THREE.Color('#5d5852'), .4), trim); return; }
    if (flat || rect < .62) {
      // a flat roof (or an outline too irregular for one ridge): the outline capped, a little parapet colour
      const cap = roofCol.clone().lerp(new THREE.Color('#8f8a82'), flat ? .7 : .3);
      const ctr = [b.x, top + (flat ? .2 : .8), b.z];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], c = pts[(i + 1) % pts.length];
        if (ccw) w.tri([a[0], top, a[1]], ctr, [c[0], top, c[1]], cap, NOFAC, trim);
        else w.tri([a[0], top, a[1]], [c[0], top, c[1]], ctr, cap, NOFAC, trim);
      }
      return;
    }
    const e = style.eave, hu = box.hu + e, hv = box.hv + e;
    const pitch = kind === 'church' || kind === 'chapel' ? Math.max(style.pitch, .7) : kind === 'barn' ? style.pitch * 1.1 : style.pitch;
    const rise = Math.min(box.hv * Math.tan(pitch), 9);
    const P = (su, sv, y) => [box.cx + box.ux * su + box.vx * sv, y, box.cz + box.uz * su + box.vz * sv];
    const yE = top - e * Math.tan(pitch);
    const hipped = b.roof === 1 || b.roof === 3 || (kind !== 'church' && kind !== 'chapel' && area > 260 && h > .5);
    const ridgeU = hipped ? Math.max(0, hu - hv) : hu;
    const r0 = P(-ridgeU, 0, top + rise), r1 = P(ridgeU, 0, top + rise);
    const a0 = P(-hu, -hv, yE), a1 = P(hu, -hv, yE), b0 = P(-hu, hv, yE), b1 = P(hu, hv, yE);
    const roofDark = roofCol.clone().multiplyScalar(.82);
    w.quad(a0, a1, r1, r0, roofCol, trim, NOFAC, NOFAC, NOFAC, NOFAC);
    w.quad(b1, b0, r0, r1, roofDark, trim, NOFAC, NOFAC, NOFAC, NOFAC);
    if (hipped) {
      w.tri(b0, a0, r0, roofCol, NOFAC, trim); w.tri(a1, b1, r1, roofDark, NOFAC, trim);
    } else {
      // gable ends: wall colour up to the ridge
      const g0 = P(-box.hu, -box.hv, top), g1 = P(-box.hu, box.hv, top), g2 = P(-box.hu, 0, top + rise * (box.hv / hv));
      const k0 = P(box.hu, -box.hv, top), k1 = P(box.hu, box.hv, top), k2 = P(box.hu, 0, top + rise * (box.hv / hv));
      w.tri(g1, g0, g2, wall, NOFAC, trim); w.tri(k0, k1, k2, wall, NOFAC, trim);
      // the eaves' underside, dark (cartoon depth under the overhang)
      const under = new THREE.Color('#4a4038');
      w.quad(a1, a0, P(-hu, -box.hv, top), P(hu, -box.hv, top), under, trim, NOFAC, NOFAC, NOFAC, NOFAC);
      w.quad(b0, b1, P(hu, box.hv, top), P(-hu, box.hv, top), under, trim, NOFAC, NOFAC, NOFAC, NOFAC);
    }
    if (kind === 'church') this._tower(w, box, lo, top, wall, roofCol, trim);
    // a chimney on the bigger houses
    if (kind === 'house' && area > 70 && h < .7) {
      const cx = box.cx + box.ux * hu * .35, cz = box.cz + box.uz * hu * .35, cy = top + rise * .7;
      this._box(w, cx, cz, .35, .35, cy, cy + 1.6, new THREE.Color('#9c9488'), trim, box);
    }
  }

  _tower(w, box, lo, top, wall, roofCol, trim) {
    // a square bell tower at one end, with a pyramid spire
    const s = Math.min(2.6, box.hv * .55), cx = box.cx + box.ux * (box.hu + s * .6), cz = box.cz + box.uz * (box.hu + s * .6);
    const tt = top + 9;
    this._box(w, cx, cz, s, s, lo, tt, wall.clone().multiplyScalar(.95), trim, box, 1);
    const P = (a, b, y) => [cx + box.ux * a + box.vx * b, y, cz + box.uz * a + box.vz * b];
    const apex = P(0, 0, tt + 6.5), c = roofCol.clone().lerp(new THREE.Color('#5a5650'), .5);
    const q = [P(-s, -s, tt), P(s, -s, tt), P(s, s, tt), P(-s, s, tt)];
    for (let i = 0; i < 4; i++) w.tri(q[i], q[(i + 1) % 4], apex, c, NOFAC, trim);
  }

  _tent(w, box, top, col, trim) {
    // Notre-Dame des Neiges (Alpe d'Huez): a steep tent of a roof reaching almost to the ground
    const P = (a, b, y) => [box.cx + box.ux * a + box.vx * b, y, box.cz + box.uz * a + box.vz * b];
    const base = top - 6, apexH = top + box.hv * 1.6;
    const r0 = P(-box.hu, 0, apexH), r1 = P(box.hu * .6, 0, apexH + 4);
    const a0 = P(-box.hu, -box.hv - 1, base), a1 = P(box.hu, -box.hv - 1, base), b0 = P(-box.hu, box.hv + 1, base), b1 = P(box.hu, box.hv + 1, base);
    w.quad(a0, a1, r1, r0, col, trim, NOFAC, NOFAC, NOFAC, NOFAC);
    w.quad(b1, b0, r0, r1, col.clone().multiplyScalar(.85), trim, NOFAC, NOFAC, NOFAC, NOFAC);
    w.tri(a1, b1, r1, new THREE.Color('#c9c4b8'), NOFAC, trim); w.tri(b0, a0, r0, new THREE.Color('#c9c4b8'), NOFAC, trim);
  }

  _box(w, cx, cz, sx, sz, y0, y1, col, trim, box, fac = -1) {
    const P = (a, b, y) => [cx + box.ux * a + box.vx * b, y, cz + box.uz * a + box.vz * b];
    const c = [P(-sx, -sz, 0), P(sx, -sz, 0), P(sx, sz, 0), P(-sx, sz, 0)];
    for (let i = 0; i < 4; i++) {
      const a = c[i], b = c[(i + 1) % 4];
      const f = fac >= 0 ? (uu, vv) => [uu, vv, 4, fac] : () => NOFAC;
      w.quad([a[0], y0, a[2]], [b[0], y0, b[2]], [b[0], y1, b[2]], [a[0], y1, a[2]], col, trim, f(0, 0), f(sx * 2, 0), f(sx * 2, y1 - y0), f(0, y1 - y0));
    }
  }

  /** Show the stretches within reach of the camera. */
  cull(cx, cz) {
    for (const m of this.meshes) {
      const b = m.userData.box;
      const dx = Math.max(b.x0 - cx, 0, cx - b.x1), dz = Math.max(b.z0 - cz, 0, cz - b.z1);
      m.visible = Math.hypot(dx, dz) < this.reach;
    }
  }

  dispose() { for (const m of this.meshes) m.geometry.dispose(); this.material.dispose(); this.group.removeFromParent(); }
}
