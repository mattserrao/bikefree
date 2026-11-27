// Toolbox: ground cover on every lawn and field near the rider (fidelity plan, step 6). The verge already has its grass
// (grass-cards.js along the road edges); this is the rest — lawns, parks, yards, pasture — as tufts of the same soft
// picture cards, in fixed cells round the camera:
//   - cells of CELL m; the ones within RADIUS are planted, the rest let go (chunked instancing: one test per cell, no
//     per-tuft culling); each cell's tufts come from a hash of its position, so a cell planted again looks the same
//   - one InstancedMesh for every tuft (one draw call), its instances rewritten only when a cell comes or goes
//   - a tuft fades (scales) to nothing toward RADIUS, so the edge of the field never shows
//   - what grows where is the map's: isGrass(x, z) → 0 (none) … 1 (full), or { d, cell, tint: [r, g, b], h, w } — a
//     card cell of grass-cards.js (one mesh draws every kind: the shader shifts each tuft to its cell), its colour,
//     height and width [plants phase 3: the desert's grasses, forbs and, near the rider, its shrubs at their real
//     cover] (read at once: the map may hand back one object it fills each call); heightAt(x, z) the ground
// Cost (Balanced): ~6–9 k tufts × 8 triangles (both faces) ≈ 60 k triangles, one draw. Not on Phone.
//
//   const gc = new GroundCover({ parent, material: grassMaterial(...), isGrass, heightAt, density, radius, tint })
//   gc.tick(cameraPosition[, sliceMs]); gc.dispose()   (new cells planted a few a frame; a jump plants all at once)
import * as THREE from '../../../../vendor/three.js';
import { MeshBuilder } from '../core/mesh-builder.js';
import { grassCard, CARD } from './grass-cards.js';
import { due, drain, runSlice } from '../core/jobs.js';

const CELL = 12, STRIDE = 12, BANDS = 1024;   // (a tuft: x, y, z, turn, size, shade, card cell, height, r, g, b — r < 0: the default tint — width)
// (1 − smoothstep(d, .7 R, R), as before: the tufts' fade toward the edge of reach)
const fadeAt = (d, R) => { const u = (d - R * .7) / (R * .3); return u <= 0 ? 1 : u >= 1 ? 0 : 1 - u * u * (3 - 2 * u); };
const hash = (x, z, k) => { const s = Math.sin(x * 127.1 + z * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };

/** The tuft: three crossed pairs of turf cards round a point (a clump, not a single blade). */
function tuftGeometry() {
  const M = new MeshBuilder({ aGlow: 1 });
  for (let k = 0; k < 2; k++) {
    const a = k * 1.1, r = k ? .12 : 0;
    grassCard(M, Math.cos(a) * r, 0, Math.sin(a) * r, CARD.turf, .5, .24 + k * .07, a * 1.7, new THREE.Color(1, 1, 1));
  }
  // (both faces as front faces, drawn single-sided: a double-sided card's back came out lit as if facing down — every
  //  tuft half near-black against a low sun, 27 Nov)
  const g = M.geometry(), ix = g.index.array, both = new (ix.constructor)(ix.length * 2);
  both.set(ix); for (let k = 0; k < ix.length; k += 3) { both[ix.length + k] = ix[k]; both[ix.length + k + 1] = ix[k + 2]; both[ix.length + k + 2] = ix[k + 1]; }
  g.setIndex(new THREE.BufferAttribute(both, 1));
  return g;
}

export class GroundCover {
  constructor({ parent, material, isGrass, heightAt, density = 1.6, radius = 40, tint = null, sliceMs = 1.5 }) {
    this.tint = tint;   // [evidence 27 Nov] (r, g, b) multiplier for the tufts' colour: the desert's are dry bunchgrass, not lawn
    this.parent = parent; this.isGrass = isGrass; this.heightAt = heightAt; this.radius = radius; this.density = density; this.sliceMs = sliceMs;
    const per = Math.ceil(CELL * CELL * density), cells = Math.ceil((2 * radius / CELL + 2) ** 2);
    this.capacity = per * cells;
    this.mesh = new THREE.InstancedMesh(tuftGeometry(), material, this.capacity);
    this.mesh.name = 'Ground cover'; this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.userData.dynamic = false; this.mesh.userData.bake = false;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 3), 3);
    this.cellAttr = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1); this.cellAttr.setUsage(THREE.DynamicDrawUsage);
    this.mesh.geometry.setAttribute('iCell', this.cellAttr);
    parent.add(this.mesh);
    this.cells = new Map(); this._at = null;
    // [review 27 Nov] the scratch of a rewrite, made once (it had made a [d, cell, k] array for every tuft, ~10–20 k, at
    // every cell crossed, and sorted them): the tufts' distances, their cell and offset, their far-to-near order
    this._want = new Set(); this._todo = []; this._job = null; this._dirty = false; this._live = [];
    this._seed = new Float32Array(per * STRIDE);
    this._d = new Float32Array(this.capacity); this._c = new Uint16Array(this.capacity); this._k = new Uint32Array(this.capacity);
    this._band = new Uint16Array(this.capacity); this._order = new Uint32Array(this.capacity); this._count = new Uint32Array(BANDS + 1);
  }
  _plant(ci, cj) {
    const out = this._seed, n = Math.round(CELL * CELL * this.density);
    let w = 0;
    for (let k = 0; k < n; k++) {
      const x = (ci + hash(ci, cj, k)) * CELL, z = (cj + hash(ci, cj, k + 999)) * CELL;
      const o = this.isGrass(x, z), g = typeof o === 'object' && o ? o.d : o;   // (o read here and let go: a map may hand back the same object each call)
      if (!(g > 0) || hash(x, z, 3) > g) continue;
      const y = this.heightAt(x, z);
      if (!Number.isFinite(y)) continue;
      const T = o?.tint, t9 = hash(x, z, 9);
      out[w] = x; out[w + 1] = y; out[w + 2] = z; out[w + 3] = hash(x, z, 5) * 6.283; out[w + 4] = .7 + .6 * hash(x, z, 7); out[w + 5] = t9; out[w + 6] = o?.cell || 0; out[w + 7] = o?.h || 1;
      out[w + 8] = T ? T[0] * (.9 + .2 * t9) : -1; out[w + 9] = T ? T[1] * (.9 + .2 * t9) : 0; out[w + 10] = T ? T[2] * (.92 + .16 * t9) : 0; out[w + 11] = o?.w || 1;
      w += STRIDE;
    }
    return out.slice(0, w);
  }
  /** [review 27 Nov] the cells still to plant, a few a frame (crossing a cell planted a row of 7–9 at once: ~460 isGrass
   *  a cell, each 2 road tests + the land + the ground on the desert — a spike of tens of ms on the main thread). The
   *  new cells are at the edge of reach, where the tufts fade to nothing, so a few frames late never shows. */
  *_planter() {
    while (this._todo.length) {
      const c = this._todo.pop();
      if (this._want.has(c.key) && !this.cells.has(c.key)) { this.cells.set(c.key, { i: c.i, j: c.j, tufts: this._plant(c.i, c.j) }); this._dirty = true; }
      if (this._todo.length && due()) yield;
    }
  }
  /** Plant the cells that came within reach (sliced: _planter), let go of the ones that left; rewrite the instances
   *  once the new ones are in. A jump (the start, a teleport: more than one cell) plants everything at once. */
  tick(cam, ms = this.sliceMs) {
    const ci0 = Math.floor(cam.x / CELL), cj0 = Math.floor(cam.z / CELL);
    if (!this._at || this._at[0] !== ci0 || this._at[1] !== cj0) {
      const jump = !this._at || Math.abs(this._at[0] - ci0) > 1 || Math.abs(this._at[1] - cj0) > 1;
      (this._at ||= [0, 0])[0] = ci0; this._at[1] = cj0;
      const r = Math.ceil(this.radius / CELL), want = this._want;
      want.clear(); this._todo.length = 0;
      for (let i = ci0 - r; i <= ci0 + r; i++) for (let j = cj0 - r; j <= cj0 + r; j++) {
        const dx = Math.max(0, Math.abs((i + .5) * CELL - cam.x) - CELL / 2), dz = Math.max(0, Math.abs((j + .5) * CELL - cam.z) - CELL / 2);
        const dd = Math.hypot(dx, dz);
        if (dd > this.radius) continue;
        const key = i * 100003 + j; want.add(key);
        if (!this.cells.has(key)) this._todo.push({ key, i, j, dd });
      }
      for (const key of this.cells.keys()) if (!want.has(key)) { this.cells.delete(key); this._dirty = true; }   // (a Map's keys may be deleted while iterating it)
      this._todo.sort((a, b) => b.dd - a.dd);   // (popped nearest first)
      this._job = this._todo.length ? this._planter() : null;
      if (jump && this._job) { drain(this._job); this._job = null; }
    }
    if (this._job) { if (!runSlice(this._job, ms).done) return; this._job = null; }
    if (this._dirty) { this._dirty = false; this._write(cam); }
  }
  /** The instances, far to near, each tuft scaled down toward the edge of reach (no visible edge). */
  _write(cam) {
    const R = this.radius, live = this._live, D = this._d, C = this._c, K = this._k, B = this._band, O = this._order, cnt = this._count, cap = this.capacity;
    live.length = 0;
    let N = 0;
    for (const c of this.cells.values()) {
      const ci = live.length, tf = c.tufts; live.push(c);
      for (let k = 0; k < tf.length && N < cap; k += STRIDE) {
        const dx = tf[k] - cam.x, dz = tf[k + 2] - cam.z, d = Math.sqrt(dx * dx + dz * dz);
        if (fadeAt(d, R) <= .02) continue;
        D[N] = d; C[N] = ci; K[N] = k; N++;
      }
    }
    // (drawn far to near: the tufts write no depth — the screen-space contact shading read each tuft's back card as a
    //  crease behind its front one and painted it near-black, 27 Nov — so they're laid painter's-fashion instead.
    //  [review 27 Nov] a counting sort by BANDS distance bands (R / 1024: 4–6 cm) in place of a comparison sort of arrays)
    cnt.fill(0);
    for (let n = 0; n < N; n++) { const b = BANDS - 1 - Math.min(BANDS - 1, Math.floor(D[n] / R * BANDS)); B[n] = b; cnt[b + 1]++; }
    for (let b = 1; b <= BANDS; b++) cnt[b] += cnt[b - 1];
    for (let n = 0; n < N; n++) O[cnt[B[n]]++] = n;
    // (the matrix written straight in — a turn about Y, the scale, the place: what compose() makes of them, without its
    //  quaternion — and the colour likewise: ~12 k tufts on High)
    const T = this.tint, A = this.cellAttr.array, IM = this.mesh.instanceMatrix.array, IC = this.mesh.instanceColor.array;
    for (let o = 0; o < N; o++) {
      const n = O[o], tf = live[C[n]].tufts, k = K[n];
      const f = tf[k + 4] * fadeAt(D[n], R), sw = f * tf[k + 11], a = tf[k + 3], cs = Math.cos(a), sn = Math.sin(a), e = o * 16;
      IM[e] = cs * sw; IM[e + 1] = 0; IM[e + 2] = -sn * sw; IM[e + 3] = 0;
      IM[e + 4] = 0; IM[e + 5] = f * tf[k + 7]; IM[e + 6] = 0; IM[e + 7] = 0;
      IM[e + 8] = sn * sw; IM[e + 9] = 0; IM[e + 10] = cs * sw; IM[e + 11] = 0;
      IM[e + 12] = tf[k]; IM[e + 13] = tf[k + 1]; IM[e + 14] = tf[k + 2]; IM[e + 15] = 1;
      const t = tf[k + 5], c3 = o * 3;
      if (tf[k + 8] >= 0) { IC[c3] = tf[k + 8]; IC[c3 + 1] = tf[k + 9]; IC[c3 + 2] = tf[k + 10]; }   // (its kind's own colour)
      else { IC[c3] = (.6 + .16 * t) * (T ? T[0] : 1); IC[c3 + 1] = (.74 + .14 * t) * (T ? T[1] : 1); IC[c3 + 2] = (.5 + .08 * (1 - t)) * (T ? T[2] : 1); }   // (a shade darker than the cards' green: tufts sit in the lawn)
      A[o] = tf[k + 6];
    }
    live.length = 0;
    this.mesh.count = N;
    this.mesh.instanceMatrix.clearUpdateRanges(); this.mesh.instanceMatrix.addUpdateRange(0, N * 16); this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.clearUpdateRanges(); this.mesh.instanceColor.addUpdateRange(0, N * 3); this.mesh.instanceColor.needsUpdate = true;
    this.cellAttr.clearUpdateRanges(); this.cellAttr.addUpdateRange(0, N); this.cellAttr.needsUpdate = true;
  }
  get stats() { return { tufts: this.mesh.count, cells: this.cells.size, planting: this._todo.length }; }
  dispose() { this._job = null; this.parent.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose?.(); this.mesh.dispose(); }
}
