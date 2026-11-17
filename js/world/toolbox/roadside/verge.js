// Verge: the small things right beside the road that pass close and give a sense of speed and place —
// mile markers, snow poles, white delineator posts and rocks fallen from the cuts onto the shoulder.
// Portable: a scene's "verge" block turns each part on for stretches of road. Instanced, grouped per
// ~1.5 km of road and hidden past `reachM`, so only the stretch around the rider is drawn.
//
//   "verge": {
//     "markers": { "units": "mi" },                                         // every mile (or "km")
//     "poles":   [{ "fromM": 30000, "toM": 56500, "spacingM": 38 }],       // tall snow poles, uphill side
//     "posts":   [{ "fromM": 0, "toM": 30000, "spacingM": 48 }],           // delineators, alternate sides
//     "debris":  [{ "fromM": 30000, "toM": 56500, "density": 0.7 }],       // fallen rock below the road cuts
//     "reachM": 1300
//   }
import * as THREE from '../../../../vendor/three.module.min.js';
import { MeshBuilder } from '../core/mesh-builder.js';
import { randomSequence } from '../core/random.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ROAD_HALF = 3.5;
const CHUNK_M = 1500;

function rockGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 0), p = g.attributes.position, rand = randomSequence(31);
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (.8 + rand() * .4), p.getY(i) * (.55 + rand() * .3), p.getZ(i) * (.8 + rand() * .4));
  const flat = g.toNonIndexed(); flat.computeVertexNormals(); g.dispose();
  const c = new THREE.Color('#ffffff'), col = new Float32Array(flat.attributes.position.count * 3);
  for (let i = 0; i < col.length; i += 9) { const k = .85 + ((i * 7.31) % 1) * .25; for (let v = 0; v < 9; v += 3) col.set([c.r * k, c.g * k, c.b * k], i + v); }
  flat.setAttribute('color', new THREE.BufferAttribute(col, 3));
  flat.translate(0, .35, 0);
  return flat;
}
function poleGeometry() {
  // a tall snow pole for the plough: a slim post, the top metre in orange and black bands
  const M = new MeshBuilder();
  M.color('#d9d6cc'); M.box(0, 0, 0, .06, 2.2, .06);
  for (let k = 0; k < 4; k++) { M.color(k % 2 ? '#1c1c1c' : '#ef6a1d'); M.box(0, 2.2 + k * .25, 0, .065, .25, .065); }
  return M.geometry();
}
function postGeometry() {
  // a white delineator with an amber reflector near the top
  const M = new MeshBuilder();
  M.color('#eceae2'); M.box(0, 0, 0, .1, 1.05, .06);
  M.color('#e2a21c'); M.box(0, .82, .032, .07, .14, .01);
  return M.geometry();
}
function markerGeometry() {
  // a brown post; the number plate is drawn by a separate textured quad
  const M = new MeshBuilder();
  M.color('#5a4330'); M.box(0, 0, 0, .1, 1.1, .1);
  return M.geometry();
}

/** French "borne": a white post with a coloured cap (red on national roads, yellow on departmental ones). */
function borneGeometry() {
  const M = new MeshBuilder();
  M.color('#f1efe8'); M.box(0, 0, 0, .26, .72, .16);
  return M.geometry();
}
function capGeometry() { const M = new MeshBuilder(); M.color('#ffffff'); M.box(0, .72, 0, .265, .2, .165); return M.geometry(); }

/** Numbers 0–127 in one texture: black on white (the French kilometre "bornes"). */
function frenchAtlas() {
  const S = 64, c = document.createElement('canvas'); c.width = S * 16; c.height = S * 8;
  const ctx = c.getContext('2d');
  for (let n = 0; n < 128; n++) {
    const x = (n % 16) * S, y = Math.floor(n / 16) * S;
    ctx.fillStyle = '#f4f2ec'; ctx.fillRect(x, y, S, S);
    ctx.fillStyle = '#1e1e1e'; ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(n), x + S / 2, y + S / 2 + 2);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** Numbers 0–63 in one texture: white on park brown. */
function numberAtlas() {
  const S = 64, c = document.createElement('canvas'); c.width = c.height = S * 8;
  const ctx = c.getContext('2d');
  for (let n = 0; n < 64; n++) {
    const x = (n % 8) * S, y = Math.floor(n / 8) * S;
    ctx.fillStyle = '#5a4330'; ctx.fillRect(x, y, S, S);
    ctx.strokeStyle = '#e9e2cf'; ctx.lineWidth = 3; ctx.strokeRect(x + 4, y + 4, S - 8, S - 8);
    ctx.fillStyle = '#f1ead6'; ctx.font = 'bold 34px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(n), x + S / 2, y + S / 2 + 2);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export class Verge {
  constructor(parent, landscape, route, config = {}) {
    this.L = landscape; this.route = route; this.cfg = config;
    this.group = new THREE.Group(); this.group.name = 'Verge'; parent.add(this.group);
    this.oneWay = route.turnS || route.total;
    this.reach = config.reachM ?? 1300;
    this.chunks = []; this.disposables = [];
    this.material = this._own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9 }));
    this.rockMaterial = this._own(new THREE.MeshStandardMaterial({ color: config.rockColor || '#8a8277', vertexColors: true, roughness: .95 }));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = V(0, 1, 0), rand = randomSequence(4711);
    const lists = { rocks: [], poles: [], posts: [], markers: [], plates: [], caps: {} }, plateNums = [];
    const fr = config.markers?.style === 'fr';
    const F = (s) => this.L.frameAt(Math.max(0, Math.min(this.oneWay - .5, s)));
    // +1 / −1: the side of the road (right / left of the outbound direction) where the ground rises
    const uphill = (p) => (this.L.baseHeight(p.x - p.fz * 16, p.z + p.fx * 16) > this.L.baseHeight(p.x + p.fz * 16, p.z - p.fx * 16) ? 1 : -1);
    const at = (p, side, off) => ({ x: p.x - p.fz * side * off, z: p.z + p.fx * side * off });
    const bridge = (s) => this.L.bridgeOfS?.(s, 6);
    const place = (list, s, side, off, scale = 1, yaw = null, lift = 0) => {
      const p = F(s), w = at(p, side, off), y = this.L.heightAt(w.x, w.z) + lift;
      if (this.L.onRoadAt?.(w.x, w.z)) return { p, w, y, skipped: true };   // the inside of a hairpin: another part of the road
      q.setFromAxisAngle(up, yaw ?? Math.atan2(p.fx, p.fz));
      list.push(m.compose(V(w.x, y, w.z), q, V(scale, scale, scale)).clone());
      return { p, w, y };
    };
    // mile (or kilometre) markers, on the uphill side, facing the outbound rider
    if (config.markers) {
      const unit = config.markers.units === 'km' ? 1000 : 1609.344;
      for (let k = 1; k * unit < this.oneWay - 20 && k < (fr ? 128 : 64); k++) {
        const s = k * unit;
        if (bridge(s) || config.skip?.(s)) continue;
        // French bornes stand on the right, the plate facing the oncoming traffic
        const side = config.markers.side ?? (fr ? 1 : uphill(F(s))), off = ROAD_HALF + .9;
        const { p, w, y, skipped } = place(lists.markers, s, side, off);
        if (skipped) continue;
        if (fr) {
          // the cap's colour by stretch (national road red, departmental yellow)
          const cap = (config.markers.caps || []).find((c) => s >= (c.fromM ?? 0) && s < (c.toM ?? Infinity))?.color || '#d9342b';
          place(lists.caps[cap] ||= [], s, side, off);
        }
        // the plate: a quad on the post's road-facing side, turned to face the oncoming outbound rider
        q.setFromAxisAngle(up, Math.atan2(-p.fx, -p.fz));
        lists.plates.push(m.compose(V(w.x - p.fx * (fr ? .085 : .06), y + (fr ? .46 : .72), w.z - p.fz * (fr ? .085 : .06)), q, V(fr ? .24 : .36, fr ? .24 : .36, 1)).clone());
        plateNums.push(k);
      }
    }
    // snow poles: tall, on the uphill side (the valley side has the walls), every so often
    for (const r of config.poles || []) {
      for (let s = r.fromM; s < Math.min(r.toM, this.oneWay); s += r.spacingM || 38) {
        if (bridge(s)) continue;
        const p = F(s); place(lists.poles, s, r.side ?? uphill(p), ROAD_HALF + 1.15 + rand() * .2, 1, rand() * 3);
      }
    }
    // delineators: alternate sides
    for (const r of config.posts || []) {
      let k = 0;
      for (let s = r.fromM; s < Math.min(r.toM, this.oneWay); s += r.spacingM || 48, k++) {
        if (bridge(s)) continue;
        place(lists.posts, s, k % 2 ? 1 : -1, ROAD_HALF + 1.0 + rand() * .15);
      }
    }
    // fallen rock: on the shoulder below the deeper cuts, a few bigger blocks at the foot of the face
    for (const r of config.debris || []) {
      for (let s = r.fromM; s < Math.min(r.toM, this.oneWay); s += 2 + rand() * 5) {
        if (bridge(s)) continue;
        const p = F(s), side = uphill(p), c = at(p, side, 14);
        const cut = this.L.baseHeight(c.x, c.z) - this.L.heightAt(c.x, c.z);
        if (cut < 2 || rand() > (r.density ?? .6) * Math.min(1, (cut - 2) / 6)) continue;
        // small stones on the shoulder; bigger blocks out on the bench at the foot of the cut
        const big = rand() < .25, off = big ? ROAD_HALF + 3.2 + rand() * 4 : ROAD_HALF + .2 + rand() * 1.4;
        const ss = s + (rand() - .5) * 3, pp = F(ss), w = at(pp, side, off);
        if (Math.abs(this.L.heightAt(w.x, w.z) - pp.y) > 1.2) continue;   // only on the level ground beside the road
        place(lists.rocks, ss, side, off, big ? .4 + rand() * .55 : .1 + rand() * .2, rand() * 6.28, -.08);
      }
    }
    this._build(rockGeometry(), this.rockMaterial, lists.rocks, 'Fallen rock', true);
    this._build(poleGeometry(), this.material, lists.poles, 'Snow poles', false);
    this._build(postGeometry(), this.material, lists.posts, 'Delineators', false);
    this._build(fr ? borneGeometry() : markerGeometry(), this.material, lists.markers, fr ? 'Kilometre bornes' : 'Mile marker posts', false);
    for (const [color, list] of Object.entries(lists.caps)) this._build(capGeometry(), this._own(new THREE.MeshStandardMaterial({ color, roughness: .7 })), list, 'Borne caps', false);
    if (lists.plates.length) {
      const atlas = this._own(fr ? frenchAtlas() : numberAtlas());
      const cols = fr ? 16 : 8;
      const plate = new THREE.PlaneGeometry(1, 1);
      const cells = new Float32Array(lists.plates.length * 2);
      plateNums.forEach((n, i) => cells.set([(n % cols) / cols, 1 - (Math.floor(n / cols) + 1) / 8], i * 2));
      const mat = this._own(new THREE.MeshStandardMaterial({ map: atlas, roughness: .8 }));
      mat.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aCell;')
          .replace('#include <uv_vertex>', cols === 8 ? '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = aCell + uv / 8.;\n#endif' : `#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = aCell + uv / vec2(${cols}., 8.);\n#endif`);
      };
      mat.customProgramCacheKey = () => (cols === 8 ? 'bf-verge-plates' : `bf-verge-plates-${cols}`);
      this._build(plate, mat, lists.plates, 'Mile marker plates', false, (geo, ids) => {
        geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(Float32Array.from(ids.flatMap((i) => [cells[i * 2], cells[i * 2 + 1]])), 2));
      });
    }
    this.counts = Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.length]));
  }

  _own(x) { this.disposables.push(x); return x; }

  /** One instanced mesh per ~1.5 km stretch (per-instance attributes added by `extra(geometry, ids)`). */
  _build(geometry, material, list, name, shadow, extra = null) {
    this._own(geometry);
    if (!list.length) return;
    const chunks = new Map(), p = V(0, 0, 0);
    list.forEach((mm, i) => { p.setFromMatrixPosition(mm); const k = `${Math.floor(p.x / CHUNK_M)},${Math.floor(p.z / CHUNK_M)}`; (chunks.get(k) || chunks.set(k, []).get(k)).push(i); });
    for (const ids of chunks.values()) {
      const geo = extra ? geometry.clone() : geometry;
      if (extra) { extra(geo, ids); this._own(geo); }
      const mesh = new THREE.InstancedMesh(geo, material, ids.length);
      ids.forEach((i, j) => mesh.setMatrixAt(j, list[i]));
      mesh.instanceMatrix.needsUpdate = true; mesh.castShadow = shadow; mesh.receiveShadow = true; mesh.name = name;
      mesh.computeBoundingSphere(); this.group.add(mesh); this.chunks.push(mesh);
    }
  }

  /** Hide the stretches beyond reach (call as the camera moves). */
  cull(cx, cz) {
    for (const m of this.chunks) {
      const b = m.boundingSphere;
      m.visible = Math.hypot(b.center.x - cx, b.center.z - cz) - b.radius < this.reach;
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.chunks.forEach((m) => m.dispose());
    this.disposables.forEach((d) => d.dispose());
  }
}
