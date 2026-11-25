// Geometry helpers for the hand-made hero landmarks (city/heroes.js, city/landmark-heroes.js): polygon
// helpers on {x, z} rings, solid prisms and caps, a footprint's oriented frame, lathes, discs, gabled roofs.
import * as THREE from '../../../../vendor/three.module.min.js';

export const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const TAU = Math.PI * 2;

// ---------------------------------------------------------------- polygon helpers
export const centroid = (ring) => { let x = 0, z = 0; for (const p of ring) { x += p.x; z += p.z; } return { x: x / ring.length, z: z / ring.length }; };
export const area2 = (ring) => { let a = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p.x * q.z - q.x * p.z; } return a; };
/** Walls face outwards with the city's quad convention when the ring's signed area is ≤ 0. */
export const orient = (ring) => (area2(ring) > 0 ? ring.slice().reverse() : ring);
export const scaleRing = (ring, f, c = centroid(ring)) => ring.map((p) => ({ x: c.x + (p.x - c.x) * f, z: c.z + (p.z - c.z) * f }));
export const lerp2 = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
export const inPoly = (ring, x, z) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], c = ring[j];
    if ((a.z > z) !== (c.z > z) && x < ((c.x - a.x) * (z - a.z)) / (c.z - a.z) + a.x) inside = !inside;
  }
  return inside;
};
/** Distance from (x, z) to a ring's outline. */
export const ringDist = (ring, x, z) => {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], c = ring[(i + 1) % ring.length], dx = c.x - a.x, dz = c.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(a.x + dx * t - x, a.z + dz * t - z));
  }
  return best;
};

/** The QC probe's hook (js/world/toolbox/city/qc-probe.js; off unless a QC run turns it on): each solid piece built
 *  in a builder it watches is reported, so tools/qc-map.js can find pieces standing on nothing. */
export const QC_HOOK = { rec: null };
const ringExt = (ring) => { const c = centroid(ring); let R = 0; for (const q of ring) R = Math.max(R, Math.hypot(q.x - c.x, q.z - c.z)); return { c, R }; };
export function prism(B, ring, y0, y1) {
  if (B.__qc && QC_HOOK.rec) { const { c, R } = ringExt(ring); QC_HOOK.rec({ x: c.x, z: c.z, y: Math.min(y0, y1), top: Math.max(y0, y1), r: R, what: 'walls' }); }
  ring = orient(ring);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], c = ring[(i + 1) % ring.length];
    B.quad(V(a.x, y0, a.z), V(c.x, y0, c.z), V(c.x, y1, c.z), V(a.x, y1, a.z));
  }
}
export function cap(B, ring, y) {
  ring = orient(ring);
  let tris;
  try { tris = THREE.ShapeUtils.triangulateShape(ring.map((p) => new THREE.Vector2(p.x, p.z)), []); } catch { return; }
  const first = B.count;
  for (const p of ring) B.vertex(p.x, y, p.z, 0, 1, 0);
  for (const [i, j, k] of tris) {
    const ax = ring[j].x - ring[i].x, az = ring[j].z - ring[i].z, bx = ring[k].x - ring[i].x, bz = ring[k].z - ring[i].z;
    if (az * bx - ax * bz > 0) B.tri(first + i, first + j, first + k); else B.tri(first + i, first + k, first + j);
  }
}
/** A solid block: walls, plus a roof. */
export function block(B, ring, y0, y1) { prism(B, ring, y0, y1); cap(B, ring, y1); }
/** Chamfer every corner of a polygon by `t` of each edge (notched or cut corners). */
export function chamfer(ring, t, notch = 0) {
  const c = centroid(ring), out = [];
  ring.forEach((p, i) => {
    const prev = ring[(i + ring.length - 1) % ring.length], next = ring[(i + 1) % ring.length];
    out.push(lerp2(p, prev, t));
    if (notch) out.push(lerp2(p, c, notch));
    out.push(lerp2(p, next, t));
  });
  return out;
}

/** A quad (4 points) or triangle (3), wound so its face points along `want` (a Vector3). */
export function faceOut(B, pts, want) {
  const [a, b, , d] = pts, c3 = pts.length === 3;
  const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c3 ? pts[2] : d, a));
  const fwd = n.dot(want) >= 0;
  if (c3) { if (fwd) B.triangle(pts[0], pts[1], pts[2]); else B.triangle(pts[0], pts[2], pts[1]); }
  else if (fwd) B.quad(pts[0], pts[1], pts[2], pts[3]); else B.quad(pts[0], pts[3], pts[2], pts[1]);
}

// ---------------------------------------------------------------- a footprint's frame
/**
 * The smallest rectangle round a ring (tried along each of its edges): centre `c`, long axis `u`, short axis `v`
 * (unit {x, z}), half length `hl` (along u) and half width `hw`. `at(a, b)` is the point a along u, b along v.
 */
export function frameOf(ring) {
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length], len = Math.hypot(q.x - p.x, q.z - p.z);
    if (len < .5) continue;
    const ux = (q.x - p.x) / len, uz = (q.z - p.z) / len;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const r of ring) { const a = r.x * ux + r.z * uz, b = -r.x * uz + r.z * ux; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
    const area = (a1 - a0) * (b1 - b0);
    if (!best || area < best.area) best = { area, ux, uz, a0, a1, b0, b1 };
  }
  let { ux, uz, a0, a1, b0, b1 } = best;
  const am = (a0 + a1) / 2, bm = (b0 + b1) / 2;
  const c = { x: am * ux - bm * uz, z: am * uz + bm * ux };
  let u = { x: ux, z: uz }, v = { x: -uz, z: ux }, hl = (a1 - a0) / 2, hw = (b1 - b0) / 2;
  if (hw > hl) { [hl, hw] = [hw, hl]; [u, v] = [v, { x: -u.x, z: -u.z }]; }
  return makeFrame(c, u, v, hl, hw);
}
/** A frame from a centre, axis u and sizes (v is u turned a quarter, so u × v keeps one handedness). */
export function makeFrame(c, u, v = { x: -u.z, z: u.x }, hl = 0, hw = 0) {
  return {
    c, u, v, hl, hw,
    at(a, b) { return { x: c.x + u.x * a + v.x * b, z: c.z + u.z * a + v.z * b }; },
    /** S.box / S.pyramid yaw that runs a box's length along u (yawV: along v). */
    get yawU() { return Math.atan2(u.x, u.z); },
    get yawV() { return Math.atan2(v.x, v.z); },
    /** The same frame turned half round (the far end becomes the front). */
    flipped() { return makeFrame(c, { x: -u.x, z: -u.z }, { x: -v.x, z: -v.z }, hl, hw); },
    /** A frame at (a, b) turned a quarter (its u along this one's v). */
    sub(a, b, quarter = false) { return makeFrame(this.at(a, b), quarter ? v : u, quarter ? { x: -u.x, z: -u.z } : v); },
    rect(a0, a1, b0, b1) { return [this.at(a0, b0), this.at(a1, b0), this.at(a1, b1), this.at(a0, b1)]; },
  };
}

// ---------------------------------------------------------------- shapes
/** A solid of revolution round (x, z): `prof` [[r, dy], …] from the bottom up (r 0 closes it at the top). */
export function lathe(B, x, y, z, prof, seg = 10) {
  if (B.__qc && QC_HOOK.rec) { const ys = prof.map((p) => p[1]); QC_HOOK.rec({ x, z, y: y + Math.min(...ys), top: y + Math.max(...ys), r: Math.max(...prof.map((p) => p[0])), what: 'turned' }); }
  for (let k = 0; k < seg; k++) {
    const a0 = k / seg * TAU, a1 = (k + 1) / seg * TAU;
    for (let j = 0; j + 1 < prof.length; j++) {
      const [r0, h0] = prof[j], [r1, h1] = prof[j + 1];
      const p = (a, r, h) => V(x + Math.cos(a) * r, y + h, z + Math.sin(a) * r);
      if (r1 < 1e-4) B.triangle(p(a0, r0, h0), V(x, y + h1, z), p(a1, r0, h0));
      else B.quad(p(a0, r0, h0), p(a0, r1, h1), p(a1, r1, h1), p(a1, r0, h0));
    }
  }
}
/** A flat disc (a rose window, a clock face) at `c` (Vector3) facing along horizontal `n` ({x, z}). */
export function disc(B, c, n, r, seg = 12) {
  const t = { x: -n.z, z: n.x }, want = V(n.x, 0, n.z);
  for (let k = 0; k < seg; k++) {
    const a0 = k / seg * TAU, a1 = (k + 1) / seg * TAU;
    const p = (a) => V(c.x + t.x * Math.cos(a) * r, c.y + Math.sin(a) * r, c.z + t.z * Math.cos(a) * r);
    faceOut(B, [c, p(a0), p(a1)], want);
  }
}
/**
 * A gabled roof along frame F's u from a0 to a1, `hw` either side, eaves at yE, ridge at yR, the eaves `over`
 * past the walls. The gable ends are filled in `endColor` (the walls'), the slopes in the builder's colour.
 */
export function gable(B, F, a0, a1, hw, yE, yR, { over = .5, endColor = null, ends = [true, true] } = {}) {
  if (B.__qc && QC_HOOK.rec) QC_HOOK.rec({ x: F.c.x, z: F.c.z, y: yE, top: yR, r: Math.max(Math.abs(a0), Math.abs(a1), hw), what: 'roof' });
  const P = (a, b, y) => { const q = F.at(a, b); return V(q.x, y, q.z); };
  const roof = B.cur.color.slice(), drop = over * (yR - yE) / Math.max(hw, .1);
  for (const s of [-1, 1]) faceOut(B, [P(a0, s * (hw + over), yE - drop), P(a1, s * (hw + over), yE - drop), P(a1, 0, yR), P(a0, 0, yR)], V(F.v.x * s, 1, F.v.z * s));
  if (endColor) B.color(endColor);
  [a0, a1].forEach((a, k) => { if (ends[k]) faceOut(B, [P(a, -hw, yE), P(a, hw, yE), P(a, 0, yR - .15)], V(F.u.x * (k ? 1 : -1), 0, F.u.z * (k ? 1 : -1))); });
  B.cur.color = roof;
}
