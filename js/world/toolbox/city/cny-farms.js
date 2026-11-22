// CNY's farms (user, 22 Nov: "find which areas are villages, suburbs, and farms. A lot of land is farmland and requires
// new texture and models"): the barns and silos tools/pgh_city.py finds in the farm zone (kinds 14, 15), built on their
// OSM footprints into a tile's street-kit mesh (js/world/graph-city.js _farms).
//
//   barn (14)       a dairy barn of central New York: boards painted barn red (some weathered grey, a few white), white
//                   corner boards, a gambrel roof (a gable on the narrow ones) of grey metal or dark shingle, big doors
//                   with a white X on the gable end and a hay door above, a cupola on the long ones; beside many, one or
//                   two silos — concrete staves with a domed cap, or a blue glass-lined Harvestore
//   shed (17)       a farm's small outbuilding: a low gable of boards, red or grey
//   long barn (15)  a free-stall barn: long and low, white metal, a shallow roof with a ridge vent, the curtain sides
//                   a dark band
import * as THREE from '../../../../vendor/three.module.min.js';
import { hash } from '../core/mesh-builder.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** The footprint's best-fitting rectangle: { cx, cz, ux, uz (the long side), vx, vz, hu, hv }. */
export function fitRect(ring) {
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], l = Math.hypot(b.x - a.x, b.z - a.z);
    if (l < 1) continue;
    const ux = (b.x - a.x) / l, uz = (b.z - a.z) / l, vx = -uz, vz = ux;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of ring) { const u = p.x * ux + p.z * uz, v = p.x * vx + p.z * vz; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) {
      const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
      best = { area, cx: ux * cu + vx * cv, cz: uz * cu + vz * cv, ux, uz, vx, vz, hu: (u1 - u0) / 2, hv: (v1 - v0) / 2 };
    }
  }
  if (best && best.hv > best.hu) { const r = best; best = { ...r, ux: r.vx, uz: r.vz, vx: -r.ux, vz: -r.uz, hu: r.hv, hv: r.hu }; }
  return best;
}

/** A quad whose front faces `out` (whatever the order given). */
function face(M, a, b, c, d, out) {
  const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a));
  if (n.dot(out) < 0) M.quad(d, c, b, a); else M.quad(a, b, c, d);
}
function tri(M, a, b, c, out) {
  const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
  if (n.dot(out) < 0) M.triangle(c, b, a); else M.triangle(a, b, c);
}

const BARN_REDS = ['#8a2b22', '#963326', '#7c2820', '#a03a2a', '#84302a'];
const GREYS = ['#8d8981', '#9a958b', '#7f7b74'];
const ROOFS = ['#6e7275', '#5d6266', '#4a4d50', '#3f4a3f', '#7a7f82'];
const TRIM = '#efece4';

/**
 * Barn (kind 14) or long barn (kind 15) on footprint b (its ring in world x, z), standing on the ground L.heightAt.
 * Returns the number of silos drawn.
 */
export function farmBuilding(M, b, L) {
  const R = fitRect(b.ring); if (!R) return 0;
  const s = hash(b.k * 7919 + 211), s2 = hash(b.k * 104729 + 17), s3 = hash(b.k * 3571 + 5);
  const F = {
    at: (u, v, y) => V(R.cx + R.ux * u + R.vx * v, y, R.cz + R.uz * u + R.vz * v),
    U: V(R.ux, 0, R.uz), Vd: V(R.vx, 0, R.vz),
  };
  let g0 = Infinity;
  for (const p of b.ring) g0 = Math.min(g0, L.heightAt(p.x, p.z));
  for (const [a, c] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g0 = Math.min(g0, L.heightAt(F.at(a * R.hu, c * R.hv, 0).x, F.at(a * R.hu, c * R.hv, 0).z));
  const y0 = g0 - 0.4;
  M.set({ aGlow: [0] });
  const long = b.kind === 15, shed = b.kind === 17;
  const hu = R.hu, hv = R.hv, W = hv * 2;
  // walls
  const wallH = shed ? 2.5 + s2 * .6 : long ? 3.4 + s2 * .6 : Math.min(6.2, Math.max(3.6, W * .34 + s2 * .8));
  const wall = long ? (s < .7 ? '#e9e6de' : '#c9ccc8') : s < .62 ? BARN_REDS[Math.floor(s2 * BARN_REDS.length)] : s < .87 ? GREYS[Math.floor(s2 * GREYS.length)] : '#e6e1d4';
  const roofC = long ? '#8f9496' : ROOFS[Math.floor(s3 * ROOFS.length)];
  const top = y0 + 0.4 + wallH;
  M.color(wall);
  for (const [sv, out] of [[-1, F.Vd.clone().negate()], [1, F.Vd]]) face(M, F.at(-hu, sv * hv, y0), F.at(hu, sv * hv, y0), F.at(hu, sv * hv, top), F.at(-hu, sv * hv, top), out);
  // the roof's profile across the width: [v, y above the walls' top]
  const gambrel = !long && !shed && W >= 8.5 && s3 < .68;
  const rise = long ? hv * Math.tan(18 * Math.PI / 180) : gambrel ? W * .5 : hv * Math.tan((34 + s * 8) * Math.PI / 180);
  const eave = long ? .5 : shed ? .3 : .45;
  const prof = gambrel
    ? [[-hv - eave, -eave * 1.6], [-hv * .62, rise * .62], [0, rise], [hv * .62, rise * .62], [hv + eave, -eave * 1.6]]
    : [[-hv - eave, -eave * Math.min(1, rise / hv)], [0, rise], [hv + eave, -eave * Math.min(1, rise / hv)]];
  // gable ends: the wall up into the roof's profile (inside the eaves)
  const inner = prof.map(([v, y]) => [Math.max(-hv, Math.min(hv, v)), Math.max(0, y)]);
  for (const su of [-1, 1]) {
    const out = F.U.clone().multiplyScalar(su);
    M.color(wall);
    face(M, F.at(su * hu, -hv, y0), F.at(su * hu, hv, y0), F.at(su * hu, hv, top), F.at(su * hu, -hv, top), out);
    const c = F.at(su * hu, 0, top);
    for (let k = 0; k + 1 < inner.length; k++) tri(M, c, F.at(su * hu, inner[k][0], top + inner[k][1]), F.at(su * hu, inner[k + 1][0], top + inner[k + 1][1]), out);
  }
  // roof slopes, over the ends a little
  const ov = long ? .4 : shed ? .25 : .35;
  M.color(roofC);
  for (let k = 0; k + 1 < prof.length; k++) {
    const [va, ya] = prof[k], [vb, yb] = prof[k + 1];
    const mid = (va + vb) / 2, n = V(R.vx * Math.sign(mid || 1) * Math.abs(yb - ya), Math.abs(vb - va), R.vz * Math.sign(mid || 1) * Math.abs(yb - ya));
    const A = F.at(-hu - ov, va, top + ya), B = F.at(hu + ov, va, top + ya), C = F.at(hu + ov, vb, top + yb), D = F.at(-hu - ov, vb, top + yb);
    face(M, A, B, C, D, n);
    // the underside (seen from below the eaves)
    face(M, A.clone().setY(A.y - .08), B.clone().setY(B.y - .08), C.clone().setY(C.y - .08), D.clone().setY(D.y - .08), n.clone().negate());
  }
  if (long) {
    // the curtain sides (a dark band under the eaves) and a ridge vent
    M.color('#3d4246');
    for (const sv of [-1, 1]) M.box(R.cx + R.vx * (hv + .03) * sv, top - 1.9, R.cz + R.vz * (hv + .03) * sv, .06, 1.5, hu * 2 - 1.2, Math.atan2(R.ux, R.uz));
    M.color('#b8bcbd'); M.box(R.cx, top + rise - .05, R.cz, .9, .45, hu * 2 - 2, Math.atan2(R.ux, R.uz));
    return 0;
  }
  // white corner boards and a trim board under the eaves
  M.color(TRIM);
  const yawU = Math.atan2(R.ux, R.uz);
  for (const [su, sv] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const p = F.at(su * (hu - .1), sv * (hv - .1), y0); M.box(p.x, y0, p.z, .3, top - y0, .3, yawU); }
  if (shed) return 0;
  // the doors on one gable end (the one towards the farmyard: either), a hay door above, a white X on each
  const su = s2 < .5 ? -1 : 1, out = F.U.clone().multiplyScalar(su);
  const dw = Math.min(W * .42, 4.4), dh = Math.min(wallH - .5, 3.8), base = g0 + .02;
  const door = (v0, w, yb, h) => {
    const p = (v, y) => F.at(su * (hu + .06), v, y);
    M.color(wall === '#e6e1d4' ? '#8a2b22' : '#6b241d'); face(M, p(v0 - w / 2, yb), p(v0 + w / 2, yb), p(v0 + w / 2, yb + h), p(v0 - w / 2, yb + h), out);
    M.color(TRIM);
    const fr = (a, b2) => M.beam(F.at(su * (hu + .1), a[0], a[1]), F.at(su * (hu + .1), b2[0], b2[1]), .16, .08);
    fr([v0 - w / 2, yb], [v0 - w / 2, yb + h]); fr([v0 + w / 2, yb], [v0 + w / 2, yb + h]); fr([v0 - w / 2, yb + h], [v0 + w / 2, yb + h]);
    fr([v0 - w / 2, yb], [v0 + w / 2, yb + h]); fr([v0 + w / 2, yb], [v0 - w / 2, yb + h]);
  };
  door(0, dw, base, dh);
  const loftY = Math.max(base + dh + .6, top - 1.2);
  door(0, Math.min(1.8, W * .2), loftY, 1.6);
  // a cupola on the ridge of a long barn
  if (hu > 9 && s3 < .6) {
    const ridge = F.at(0, 0, top + rise);
    M.color(TRIM); M.box(ridge.x, ridge.y - .3, ridge.z, 1.4, 1.5, 1.4, yawU);
    M.color(roofC); M.pyramid(ridge.x, ridge.y + 1.2, ridge.z, 1.9, 1.1, 1.9, yawU);
  }
  // silos: by most dairy barns, beside one gable end (the far one from the doors)
  let silos = 0;
  if (hu * hv * 4 > 200 && s < .72) {
    const n = s3 < .3 ? 2 : 1, blue = s2 > .8, r = blue ? 3.2 : 2.4 + s * .9, h = blue ? 18 + s3 * 5 : 12 + s3 * 7;
    for (let k = 0; k < n; k++) {
      const v = (s < .36 ? -1 : 1) * (hv - r * .6) - (k ? (s < .36 ? -1 : 1) * (r * 2.3) : 0);
      const c = F.at(-su * (hu + r + .6), v, 0), g = L.heightAt(c.x, c.z) - .3;
      M.color(blue ? '#2d4a6c' : k ? '#a9a398' : '#b8b1a3'); M.cylinder(c.x, g, c.z, r, h, 14);
      if (!blue) { M.color('#8e877b'); for (let q = 1; q < 6; q++) M.cylinder(c.x, g + h * q / 6, c.z, r + .05, .16, 14); }   // the hoops round the staves
      M.color(blue ? '#2d4a6c' : '#9b9fa1'); M.cylinder(c.x, g + h, c.z, r, r * .55, 14, r * .15);   // the domed cap
      M.color('#8d9295'); M.cylinder(c.x, g + h + r * .55, c.z, r * .16, .4, 6, .05);
      silos++;
    }
  }
  return silos;
}
