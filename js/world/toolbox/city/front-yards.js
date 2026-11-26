// Front yards: what sits between a house and its street — a white picket fence or a clipped hedge along the front
// lot line (with a gap for the drive and a gate on the front walk), foundation shrubs under the front windows, a
// flower bed now and then. Plans are pure (data); drawing goes into the tile's street-kit mesh.
// Modular: works on any building-kit house with a homestead plan (toolbox/city/homesteads.js) — no map knowledge.
//   const Y = planFrontYard(R, H, { free, driveNear }, { fence: .22, hedge: .2, shrubs: .8 })
//   drawFrontYard(M, Y, groundH)
import * as THREE from '../../../../vendor/three.js';
import { hash } from '../core/mesh-builder.js';

const FRONT = [[0, -1], [1, 0], [0, 1], [-1, 0]];   // the kit's front index → (u, v) out of the house

/**
 * R: a kit recipe (rects, front, key, kind). H: its homestead (drive.pts, road { px, pz, dx, dz, ox, oz }).
 * ctx.free(x, z, pad): nothing there; ctx.driveNear(x, z, r): a driveway there (anyone's).
 */
export function planFrontYard(R, H, ctx, opts = {}) {
  const r = R.rects?.[0]; if (!r || !H?.road || !H.drive?.pts?.length) return null;
  const h = (k) => hash((R.key || 1) * 3.17 + k * 9.71);
  const farm = R.kind === 'farmhouse-ny', village = R.kind === 'village-house';
  const pFence = (opts.fence ?? 0.22) * (village ? 1.4 : farm ? 0.3 : 0.8), pHedge = (opts.hedge ?? 0.2) * (farm ? 0.2 : 1);
  const [fu, fv] = FRONT[R.front ?? 0] || FRONT[0];
  const out = { x: r.ux * fu + r.vx * fv, z: r.uz * fu + r.vz * fv };   // out of the front wall
  const half = fu ? r.hu : r.hv, wide = fu ? r.hv : r.hu;              // front's distance from the centre, its half-width
  const along = { x: fu ? r.vx : r.ux, z: fu ? r.vz : r.uz };
  const Y = { shrubs: [], fence: null, bed: null, seed: h(1) };
  // foundation shrubs: under the front wall, clear of the door's middle
  if (h(2) < (opts.shrubs ?? 0.8)) {
    const n = 2 + Math.floor(h(3) * 4);
    for (let k = 0; k < n; k++) {
      const a = -wide + 0.8 + (k + 0.5) * (2 * wide - 1.6) / n;
      if (Math.abs(a) < 0.9) continue;
      const x = r.cx + out.x * (half + 0.7) + along.x * a, z = r.cz + out.z * (half + 0.7) + along.z * a;
      if (ctx.free(x, z, 0.3) && !ctx.driveNear(x, z, 1)) Y.shrubs.push({ x, z, s: 0.6 + h(10 + k) * 0.5, c: h(20 + k) });
    }
  }
  // the front lot line: parallel to the road, ~3.4 m in from the road's edge (past a sidewalk) (the drive's road end is on the edge)
  const roll = h(4);
  const kind = roll < pFence ? 'picket' : roll < pFence + pHedge ? 'hedge' : null;
  if (kind) {
    const E = H.drive.pts[H.drive.pts.length - 1], o = { x: H.road.ox, z: H.road.oz }, t = { x: H.road.dx, z: H.road.dz };
    const inset = 3.4 + h(5) * 0.8, bx = E[0] + o.x * inset, bz = E[1] + o.z * inset;
    // the house's frontage on that line: its centre's projection, ± its width and a few metres
    const c0 = (r.cx - bx) * t.x + (r.cz - bz) * t.z, span = Math.max(r.hu, r.hv) + 3 + h(6) * 3;
    // the house must be behind the line (and not on it)
    const back = (r.cx - bx) * o.x + (r.cz - bz) * o.z;
    if (back > Math.min(r.hu, r.hv) + 2.5) {
      const runs = [], step = 0.5;
      let cur = null;
      for (let s = c0 - span; s <= c0 + span; s += step) {
        const x = bx + t.x * s, z = bz + t.z * s;
        const gate = Math.abs(s - c0) < 0.7;   // (the front walk's gate)
        const ok = !gate && ctx.free(x, z, 0.4) && !ctx.driveNear(x, z, 1.6);
        if (ok) { if (!cur) runs.push((cur = [[x, z], [x, z]])); else cur[1] = [x, z]; } else cur = null;
      }
      const keep = runs.filter(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]) > 1.5);
      if (keep.length) Y.fence = { kind, runs: keep, out: o };
    }
    // a flower bed inside the fence, by the gate
    if (Y.fence && h(7) < 0.5) Y.bed = { x: bx + t.x * (c0 + 1.8) + o.x * 0.7, z: bz + t.z * (c0 + 1.8) + o.z * 0.7, yaw: Math.atan2(t.x, t.z), c: h(8) };
  }
  return Y.shrubs.length || Y.fence || Y.bed ? Y : null;
}

const SHRUB = ['#3f5d2e', '#486a33', '#355229', '#53703a'], BLOOM = ['#c2304a', '#e8a326', '#f2f2ea', '#b45bb8', '#e86a8a'];

/** The yard into the street-kit mesh M. groundH(x, z) → y. Returns the triangles it added (about). */
export function drawFrontYard(M, Y, groundH) {
  if (!Y) return 0;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  for (const s of Y.shrubs) {
    const y = groundH(s.x, s.z);
    M.color(SHRUB[Math.floor(s.c * SHRUB.length)]).pyramid(s.x, y - 0.05, s.z, s.s * 1.1, s.s * 1.15, s.s * 1.1, s.c * 6);
    M.pyramid(s.x, y + s.s * 0.15, s.z, s.s * 0.95, s.s * 1.05, s.s * 0.9, s.c * 6 + 0.8);
  }
  if (Y.bed) {
    const y = groundH(Y.bed.x, Y.bed.z);
    M.color('#4a3a2a').box(Y.bed.x, y - 0.1, Y.bed.z, 0.9, 0.16, 2.2, Y.bed.yaw);
    M.color(BLOOM[Math.floor(Y.bed.c * BLOOM.length)]);
    for (let k = 0; k < 5; k++) M.box(Y.bed.x + Math.sin(Y.bed.yaw) * (k - 2) * 0.42, y + 0.04, Y.bed.z + Math.cos(Y.bed.yaw) * (k - 2) * 0.42, 0.35, 0.22, 0.3, Y.bed.yaw + k);
  }
  const F = Y.fence; if (!F) return 0;
  for (const [a, b] of F.runs) {
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), tx = dx / L, tz = dz / L, yaw = Math.atan2(F.out.x, F.out.z);
    if (F.kind === 'hedge') {
      // a clipped privet or yew hedge: a long box, its top a shade lighter, a second shade at random lengths
      const n = Math.max(1, Math.round(L / 3));
      for (let k = 0; k < n; k++) {
        const s0 = (k / n) * L, s1 = ((k + 1) / n) * L, cx = a[0] + tx * (s0 + s1) / 2, cz = a[1] + tz * (s0 + s1) / 2, y = groundH(cx, cz);
        M.color(SHRUB[(k + Math.floor(Y.seed * 4)) % SHRUB.length]).box(cx, y - 0.1, cz, s1 - s0 + 0.05, 1.15 + 0.1 * Math.sin(k * 2.1), 0.8, yaw);
      }
      continue;
    }
    // a white picket fence: posts every 2.4 m, two rails, pointed pickets (front and back faces, no boxes)
    M.color('#f1efe8');
    const nP = Math.max(1, Math.round(L / 2.4));
    for (let k = 0; k <= nP; k++) { const s = (k / nP) * L, x = a[0] + tx * s, z = a[1] + tz * s; M.box(x, groundH(x, z) - 0.2, z, 0.1, 1.25, 0.1, yaw); }
    for (const hR of [0.3, 0.75]) {
      for (let k = 0; k < nP; k++) {
        const s0 = (k / nP) * L, s1 = ((k + 1) / nP) * L, x0 = a[0] + tx * s0, z0 = a[1] + tz * s0, x1 = a[0] + tx * s1, z1 = a[1] + tz * s1;
        const y0 = groundH(x0, z0) + hR, y1 = groundH(x1, z1) + hR;
        M.beam(V(x0 - F.out.x * 0.04, y0, z0 - F.out.z * 0.04), V(x1 - F.out.x * 0.04, y1, z1 - F.out.z * 0.04), 0.07, 0.04);
      }
    }
    for (let s = 0.12; s < L; s += 0.16) {
      const x = a[0] + tx * s, z = a[1] + tz * s, y = groundH(x, z), w = 0.045, hh = 0.95;
      const p0 = V(x - tx * w, y - 0.05, z - tz * w), p1 = V(x + tx * w, y - 0.05, z + tz * w), p2 = V(x + tx * w, y + hh, z + tz * w), p3 = V(x - tx * w, y + hh, z - tz * w), tip = V(x, y + hh + 0.08, z);
      M.quad(p0, p1, p2, p3); M.triangle(p3, p2, tip);
      M.quad(p1, p0, p3, p2); M.triangle(p2, p3, tip);
    }
  }
  return 1;
}
