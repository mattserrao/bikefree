// Small mesh-building helpers for the city: one merged buffer per material and chunk,
// so thousands of buildings, beams and lamp posts stay a handful of draw calls.
import * as THREE from '../../../../vendor/three.module.min.js';
import { drain, due } from './jobs.js';   // [F30] keepOutOf as a job

export class MeshBuilder {
  constructor(extra = {}) {
    this.p = []; this.n = []; this.c = []; this.uv = []; this.i = [];
    this.extra = Object.fromEntries(Object.entries(extra).map(([k, size]) => [k, { size, data: [] }]));
    this.cur = { color: [1, 1, 1] };
    this.members = [];   // [first, end) index ranges of each beam / box / pyramid / cylinder (whole-member culling)
    for (const [k, v] of Object.entries(this.extra)) this.cur[k] = new Array(v.size).fill(0);
  }
  get count() { return this.p.length / 3; }
  set(attrs) { Object.assign(this.cur, attrs); return this; }
  color(c) { const col = c instanceof THREE.Color ? c : new THREE.Color(c); this.cur.color = [col.r, col.g, col.b]; return this; }
  vertex(x, y, z, nx, ny, nz, u = 0, v = 0) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.c.push(...this.cur.color); this.uv.push(u, v);
    for (const [k, e] of Object.entries(this.extra)) e.data.push(...this.cur[k]);
    return this.count - 1;
  }
  tri(a, b, c) { this.i.push(a, b, c); }
  /** Flat-shaded quad a-b-c-d (counter-clockwise seen from the front). */
  quad(a, b, c, d, uvs) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    const k = [a, b, c, d].map((v, j) => this.vertex(v.x, v.y, v.z, n.x, n.y, n.z, uvs ? uvs[j * 2] : 0, uvs ? uvs[j * 2 + 1] : 0));
    this.tri(k[0], k[1], k[2]); this.tri(k[0], k[2], k[3]);
  }
  triangle(a, b, c) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    const k = [a, b, c].map((v) => this.vertex(v.x, v.y, v.z, n.x, n.y, n.z));
    this.tri(k[0], k[1], k[2]);
  }
  /** Box between two points with a square-ish cross-section (w across, h up). */
  beam(a, b, w, h = w, up = null) { const t0 = this.i.length; this._beam(a, b, w, h, up); if (this.i.length > t0) this.members.push([t0, this.i.length]); return this; }
  _beam(a, b, w, h = w, up = null) {
    const d = new THREE.Vector3().subVectors(b, a); const len = d.length(); if (len < 1e-4) return;
    d.divideScalar(len);
    let side = new THREE.Vector3().crossVectors(d, up || new THREE.Vector3(0, 1, 0));
    if (side.lengthSq() < 1e-6) side = new THREE.Vector3(1, 0, 0); side.normalize();
    const top = new THREE.Vector3().crossVectors(side, d).normalize();
    const corner = (p, sx, sy) => p.clone().addScaledVector(side, sx * w / 2).addScaledVector(top, sy * h / 2);
    const A = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => corner(a, x, y));
    const B = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => corner(b, x, y));
    for (let k = 0; k < 4; k++) { const k2 = (k + 1) % 4; this.quad(A[k], A[k2], B[k2], B[k]); }
    this.quad(A[3], A[2], A[1], A[0]); this.quad(B[0], B[1], B[2], B[3]);
  }
  /** Axis-aligned-in-yaw box: centre (x, y bottom, z), size (w across, h, l along), yaw angle. */
  box(x, y, z, w, h, l, yaw = 0) { const t0 = this.i.length; this._box(x, y, z, w, h, l, yaw); if (this.i.length > t0) this.members.push([t0, this.i.length]); return this; }
  _box(x, y, z, w, h, l, yaw = 0) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (dx, dy, dz) => new THREE.Vector3(x + dx * c + dz * s, y + dy, z - dx * s + dz * c);
    const v = [P(-w / 2, 0, -l / 2), P(w / 2, 0, -l / 2), P(w / 2, 0, l / 2), P(-w / 2, 0, l / 2),
      P(-w / 2, h, -l / 2), P(w / 2, h, -l / 2), P(w / 2, h, l / 2), P(-w / 2, h, l / 2)];
    this.quad(v[4], v[7], v[6], v[5]); this.quad(v[0], v[1], v[2], v[3]);
    this.quad(v[0], v[4], v[5], v[1]); this.quad(v[1], v[5], v[6], v[2]); this.quad(v[2], v[6], v[7], v[3]); this.quad(v[3], v[7], v[4], v[0]);
  }
  /** Square pyramid (spires, roofs). */
  pyramid(x, y, z, w, h, l = w, yaw = 0) { const t0 = this.i.length; this._pyramid(x, y, z, w, h, l, yaw); if (this.i.length > t0) this.members.push([t0, this.i.length]); return this; }
  _pyramid(x, y, z, w, h, l = w, yaw = 0) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (dx, dz) => new THREE.Vector3(x + dx * c + dz * s, y, z - dx * s + dz * c);
    const b = [P(-w / 2, -l / 2), P(w / 2, -l / 2), P(w / 2, l / 2), P(-w / 2, l / 2)], t = new THREE.Vector3(x, y + h, z);
    for (let k = 0; k < 4; k++) this.triangle(b[k], t, b[(k + 1) % 4]);
  }
  /** Vertical cylinder (columns, tanks). */
  cylinder(x, y, z, r, h, seg = 8, rTop = r) { const t0 = this.i.length; this._cylinder(x, y, z, r, h, seg, rTop); if (this.i.length > t0) this.members.push([t0, this.i.length]); return this; }
  _cylinder(x, y, z, r, h, seg = 8, rTop = r) {
    for (let k = 0; k < seg; k++) {
      const a0 = k / seg * Math.PI * 2, a1 = (k + 1) / seg * Math.PI * 2;
      const p = (a, rr, yy) => new THREE.Vector3(x + Math.cos(a) * rr, yy, z + Math.sin(a) * rr);
      this.quad(p(a0, r, y), p(a0, rTop, y + h), p(a1, rTop, y + h), p(a1, r, y));
      if (rTop > 0) this.triangle(p(a0, rTop, y + h), new THREE.Vector3(x, y + h, z), p(a1, rTop, y + h));
    }
  }
  /**
   * Drop every triangle that reaches into a forbidden space — `inside(x, y, z)` tested at its corners, edge
   * midpoints and centre. Used to keep the route's clearance (where the rider and the chase camera move) free
   * of other streets, decks, rails and bridge members that the map data puts there.
   */
  keepOutOf(inside, opts = {}) { return drain(this.keepOutOfJob(inside, opts)); }
  /** keepOutOf as a job ([F30]: js/world/toolbox/core/jobs.js): pauses every few hundred triangles when its slice is used up. */
  *keepOutOfJob(inside, { whole = false } = {}) {
    const P = this.p, kept = [];
    let dropped = 0;
    const hit = (A, B, C) => {
      // corners, then points ~0.8 m apart along the edges and across the face (long posts and big slabs
      // can pass straight through a small space with every corner outside it)
      const len = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]);
      const n = Math.min(64, Math.max(1, Math.ceil(Math.max(len(A, B), len(B, C), len(C, A)) / .8)));
      for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
        const u = i / n, v = j / n, w = 1 - u - v;
        if (inside(A[0] * w + B[0] * u + C[0] * v, A[1] * w + B[1] * u + C[1] * v, A[2] * w + B[2] * u + C[2] * v)) return true;
      }
      return false;
    };
    function hitTri(t) {
      const a = this.i[t] * 3, b = this.i[t + 1] * 3, c = this.i[t + 2] * 3;
      const A = [P[a], P[a + 1], P[a + 2]], B = [P[b], P[b + 1], P[b + 2]], C = [P[c], P[c + 1], P[c + 2]];
      // cheap reject: nothing to test unless the triangle's middle is near enough to the space at all
      const cx = (A[0] + B[0] + C[0]) / 3, cz = (A[2] + B[2] + C[2]) / 3;
      if (inside.near && !inside.near(cx, cz, Math.max(Math.hypot(A[0] - cx, A[2] - cz), Math.hypot(B[0] - cx, B[2] - cz), Math.hypot(C[0] - cx, C[2] - cz)))) return false;
      return hit(A, B, C);
    }
    // whole members: a beam or box with any part in the space goes entirely (no cut stubs left hanging)
    let drop = null, member = null;
    if (whole && this.members.length) {
      drop = new Uint8Array(this.i.length / 3); member = new Uint8Array(this.i.length / 3);
      for (const [t0, t1] of this.members) {
        if (due()) yield;
        member.fill(1, t0 / 3, t1 / 3);
        let any = false;
        for (let t = t0; t < t1 && !any; t += 3) any = hitTri.call(this, t);
        if (any) drop.fill(1, t0 / 3, t1 / 3);
      }
    }
    for (let t = 0; t < this.i.length; t += 3) {
      if (t % 96 === 93 && due()) yield;
      if (member?.[t / 3] ? drop[t / 3] : hitTri.call(this, t)) { dropped++; continue; }
      kept.push(this.i[t], this.i[t + 1], this.i[t + 2]);
    }
    this.i = kept;
    this.members = [];
    return dropped;
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    for (const [k, e] of Object.entries(this.extra)) g.setAttribute(k, new THREE.Float32BufferAttribute(e.data, e.size));
    if (this.count > 65535) g.setIndex(new THREE.Uint32BufferAttribute(this.i, 1)); else g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}

/** Ribbon along a 3D polyline: points [{x, y, z}], width (or per-point widths), v = distance / repeat. */
export function ribbon(builder, pts, width, lift = 0, repeat = 10, uRange = [0, 1], slopeNormals = false) {
  if (pts.length < 2) return;
  let dist = 0, prev = null;
  for (let k = 0; k < pts.length; k++) {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
    let dx = b.x - a.x, dz = b.z - a.z; const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    const grade = slopeNormals ? (b.y - a.y) / len : 0;
    // [junctions] an end that meets a junction's mouth or another street's end is square to the direction given
    if (pts[k].tx != null && (k === 0 || k === pts.length - 1)) { dx = pts[k].tx; dz = pts[k].tz; }
    const w = (typeof width === 'function' ? width(k) : width) / 2, p = pts[k];
    if (k) dist += Math.hypot(p.x - pts[k - 1].x, p.z - pts[k - 1].z);
    // [junctions] a ribbon trimmed where it runs into another (road-meets.js trimOverlaps): `tl` / `tr` metres off
    // its (dz, −dx) / other half; the texture keeps its scale (the trimmed edge's u moves in with it)
    const wl = Math.max(0, w - (p.tl || 0)), wr = Math.max(0, w - (p.tr || 0)), um = (uRange[0] + uRange[1]) / 2;
    let lx = p.x + dz * wl, lz = p.z - dx * wl, rx = p.x - dz * wr, rz = p.z + dx * wr;
    // on the inside of a tight bend an edge would step backwards and the ribbon fold over itself (two layers of
    // road at one height: flicker); hold that edge where it was instead
    if (prev) {
      const sx = p.x - pts[k - 1].x, sz = p.z - pts[k - 1].z;
      if ((lx - prev[2]) * sx + (lz - prev[3]) * sz < 0) { lx = prev[2]; lz = prev[3]; }
      if ((rx - prev[4]) * sx + (rz - prev[5]) * sz < 0) { rx = prev[4]; rz = prev[5]; }
    }
    // (slopeNormals: the normal leans with the street's grade, as the route's road's does, so both shade alike)
    const ny = 1 / Math.hypot(1, grade), nx = -dx * grade * ny, nz = -dz * grade * ny;
    const l = builder.vertex(lx, p.y + lift, lz, nx, ny, nz, um + (uRange[0] - um) * (wl / w), dist / repeat);
    const r = builder.vertex(rx, p.y + lift, rz, nx, ny, nz, um + (uRange[1] - um) * (wr / w), dist / repeat);
    if (prev) { builder.tri(prev[0], prev[1], l); builder.tri(prev[1], r, l); }
    prev = [l, r, lx, lz, rx, rz];
  }
}

/** Resample a polyline every `step` metres (keeps the original corners). */
export function resample(pts, step) {
  const out = [pts[0]];
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k], len = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(len / step));
    for (let j = 1; j <= n; j++) {
      const f = j / n;
      out.push({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, y: a.y != null && b.y != null ? a.y + (b.y - a.y) * f : undefined });
    }
  }
  return out;
}

/** Polyline with cumulative distances, and a sampler at distance s → {x, y, z, dx, dz}. */
export function makePath(pts) {
  const d = [0];
  for (let k = 1; k < pts.length; k++) d.push(d[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z));
  const length = d[d.length - 1];
  let hint = 0;
  const at = (s, out = {}) => {
    s = Math.max(0, Math.min(length, s));
    if (d[hint] > s) hint = 0;
    while (hint < d.length - 2 && d[hint + 1] < s) hint++;
    const a = pts[hint], b = pts[hint + 1], f = (s - d[hint]) / ((d[hint + 1] - d[hint]) || 1);
    out.x = a.x + (b.x - a.x) * f; out.y = a.y + (b.y - a.y) * f; out.z = a.z + (b.z - a.z) * f;
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    out.dx = (b.x - a.x) / len; out.dz = (b.z - a.z) / len; out.dy = (b.y - a.y) / len;
    return out;
  };
  return { pts, d, length, at };
}

/** Deterministic pseudo-random from an integer seed. */
export const hash = (n) => { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3) | 0; n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); n ^= n >>> 15; return (n >>> 0) / 4294967296; };
