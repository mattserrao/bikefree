// Pittsburgh's Downtown / North Shore heroes (PLAN 7.7, with the stadiums of 7.8): PPG Place (the glass castle and its
// plaza), the Honus Wagner, Willie Stargell and Roberto Clemente statues at PNC Park, the Mister Rogers "Tribute to
// Children" on its old bridge pier, and USS Requin moored by the Science Center. Stylised, at their real spots (the
// scene's `heroes`: model, lat, lon; the OSM node or footprint they stand on), built into the heroes kit's builders
// (js/world/toolbox/city/heroes.js registers them).
import * as THREE from '../../../../vendor/three.module.min.js';
import { posedFigure, CLIP } from '../life/figures/people.js';
import { appendToMeshBuilder } from '../life/figures/vehicles.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;
const centroid = (ring) => { let x = 0, z = 0; for (const p of ring) { x += p.x; z += p.z; } return { x: x / ring.length, z: z / ring.length }; };
const area2 = (ring) => { let a = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p.x * q.z - q.x * p.z; } return a; };
const orient = (ring) => (area2(ring) > 0 ? ring.slice().reverse() : ring);

function prism(B, ring, y0, y1) {
  ring = orient(ring);
  for (let i = 0; i < ring.length; i++) { const a = ring[i], c = ring[(i + 1) % ring.length]; B.quad(V(a.x, y0, a.z), V(c.x, y0, c.z), V(c.x, y1, c.z), V(a.x, y1, a.z)); }
}
function cap(B, ring, y) {
  ring = orient(ring);
  let tris; try { tris = THREE.ShapeUtils.triangulateShape(ring.map((p) => new THREE.Vector2(p.x, p.z)), []); } catch { return; }
  const first = B.count;
  for (const p of ring) B.vertex(p.x, y, p.z, 0, 1, 0);
  for (const [i, j, k] of tris) {
    const ax = ring[j].x - ring[i].x, az = ring[j].z - ring[i].z, bx = ring[k].x - ring[i].x, bz = ring[k].z - ring[i].z;
    if (az * bx - ax * bz > 0) B.tri(first + i, first + j, first + k); else B.tri(first + i, first + k, first + j);
  }
}
/** A spire: a slim square pyramid (PPG Place has 231 of them). */
const spire = (B, x, y, z, w, h) => B.pyramid(x, y, z, w, h, w, Math.PI / 4);

/**
 * A square plan whose faces are pleated into glass prisms (PPG Place's sawtooth walls): `n` points out per face, `d`
 * metres deep. Returns the ring (outer points first along each face) and the prisms' tips.
 */
function pleated(c, half, yaw, n, d) {
  const ring = [], tips = [], cs = Math.cos(yaw), sn = Math.sin(yaw);
  const L = (u, v) => ({ x: c.x + u * cs - v * sn, z: c.z + u * sn + v * cs });
  for (let f = 0; f < 4; f++) {
    const rot = (u, v) => { const a = f * Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a); return L(u * ca - v * sa, u * sa + v * ca); };
    for (let k = 0; k < n; k++) {
      const v0 = -half + 2 * half * k / n, v1 = v0 + 2 * half / n;
      ring.push(rot(half, v0)); const t = rot(half + d, (v0 + v1) / 2); ring.push(t); tips.push(t);
    }
  }
  return { ring, tips };
}

/** The heroes' North Shore and PPG Place models, sharing the heroes kit's builders and helpers (heroes.js). */
export function northShoreModels(k) {
  const { city, S, W, glows, claim, clearUnder, ground, wall, L } = k;
  const GLASS = '#41566b', GLASS2 = '#5f7891', FRAME = '#2c3742';
  const bronze = { h: 1, g: 1, bits: 1 | 2, hair: 7 };
  const statue = (p, clip, { scale = 1.25, frame = 6, yaw = 0, base = [2.6, 2.2, 2.6], baseColor = '#b6aea0', bat = null, y = null } = {}) => {
    const g0 = y ?? ground([p, { x: p.x + 1, z: p.z }, { x: p.x, z: p.z + 1 }]);
    S.color(baseColor); S.box(p.x, g0 - .5, p.z, base[0], base[1] + .5, base[2], yaw);
    S.color('#8c8578'); S.box(p.x, g0 + base[1], p.z, base[0] * .86, .25, base[2] * .86, yaw);
    const c = new THREE.Color('#7a5b34');
    const geo = posedFigure({ ...bronze, shirt: c, pants: c.clone().multiplyScalar(.9), skin: c.clone().multiplyScalar(1.05) }, clip, { frame, lod: 'hi' });
    const m = new THREE.Matrix4().compose(V(p.x, g0 + base[1] + .25, p.z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), yaw), V(scale, scale, scale));
    appendToMeshBuilder(S, geo, m); geo.dispose();
    if (bat) { S.color('#6a4d2b'); const a = V(...bat[0]).applyMatrix4(m), b = V(...bat[1]).applyMatrix4(m); S.beam(a, b, .09, .09); }
    return g0 + base[1];
  };
  /** Facing a point (the figure's front is +z). */
  const faceTo = (p, q) => Math.atan2(q.x - p.x, q.z - p.z);

  return {
    // PPG Place (1984): a neo-Gothic castle of 19,750 panes of dark glass — One PPG Place's 40 storeys with pleated
    // faces and a crown of spires, round a plaza with its obelisk, the lower PPG buildings (pleated, spired) and the
    // Wintergarden's glass hall. Replaces their map footprints.
    ppg(p, o) {
      const [b] = claim(p, 30, 60);
      const c = b ? centroid(b.ring) : p, g = ground(b ? b.ring : [p]);
      let yaw = 0;
      if (b) { let best = 0; for (let i = 0; i < b.ring.length; i++) { const a = b.ring[i], q = b.ring[(i + 1) % b.ring.length], l = Math.hypot(q.x - a.x, q.z - a.z); if (l > best) { best = l; yaw = Math.atan2(q.z - a.z, q.x - a.x); } } }
      const H = o.heightM || 194, body = H - 30, half = (o.halfM || 26);
      const { ring, tips } = pleated(c, half, yaw, 6, 2.2);
      clearUnder(ring.map((q) => ({ x: c.x + (q.x - c.x) * 1.05, z: c.z + (q.z - c.z) * 1.05 })));
      wall(5, .91, g, 0, GLASS); prism(W, ring, g - 1, g + body);
      // setbacks: three tiers of pleated glass narrowing to the crown
      const tiers = [[.82, body, body + 10], [.62, body + 10, body + 18]];
      for (const [f, y0, y1] of tiers) {
        const t = pleated(c, half * f, yaw, 4, 1.8);
        S.color(GLASS2); cap(S, ring.map((q) => q), y0); S.color(GLASS); prism(S, t.ring, y0, y1);
        S.color('#6f8aa3'); for (const q of t.tips) spire(S, q.x, y1, q.z, 1.5, 7);
      }
      S.color(GLASS2); cap(S, pleated(c, half * .62, yaw, 4, 1.8).ring, body + 18);
      // the crown: a tall central spire ringed by smaller ones, spires on every prism of the main faces
      S.color('#7d97b0'); spire(S, c.x, body + 18, c.z, 6, H - body - 18);
      for (let i = 0; i < 8; i++) { const a = yaw + i / 8 * TAU; spire(S, c.x + Math.cos(a) * 7, body + 18, c.z + Math.sin(a) * 7, 2, 9); }
      S.color('#6f8aa3'); for (const q of tips) spire(S, q.x, g + body, q.z, 1.8, 9);
      // the four corner towers rise past the parapet
      for (let i = 0; i < 4; i++) {
        const a = yaw + Math.PI / 4 + i * Math.PI / 2, r = half * Math.SQRT2 - 1, x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
        S.color(GLASS); S.box(x, g + body - 4, z, 5, 10, 5, -yaw); S.color('#7d97b0'); spire(S, x, g + body + 6, z, 4.5, 16);
      }
      // the lit crown at night
      for (let i = 0; i < 8; i++) { const a = yaw + i / 8 * TAU; glows.push({ x: c.x + Math.cos(a) * half * .62, y: g + body + 17, z: c.z + Math.sin(a) * half * .62, size: 6, color: '#cfe4ff' }); }
      // the plaza's buildings: each map footprint (its lat/lon in `annex`), pleated glass and spires on its edges
      for (const [la, lo, h] of o.annex || []) {
        const q = L(la, lo), [a] = claim(q, 22);
        if (!a) continue;
        const ga = ground(a.ring), ha = h || a.h;
        wall(5, .92, ga, 0, GLASS); prism(W, a.ring, ga - 1, ga + ha); S.color(FRAME); cap(S, a.ring, ga + ha);
        S.color('#6f8aa3');
        for (let i = 0; i < a.ring.length; i++) {
          const u = a.ring[i], v = a.ring[(i + 1) % a.ring.length], n = Math.max(1, Math.round(Math.hypot(v.x - u.x, v.z - u.z) / 7));
          for (let j = 0; j < n; j++) { const t = (j + .5) / n; spire(S, u.x + (v.x - u.x) * t, ga + ha, u.z + (v.z - u.z) * t, 1.4, 5); }
        }
      }
      // the Wintergarden: a glass hall with a steep Gothic roof
      if (o.wintergarden) {
        const q = L(...o.wintergarden), [a] = claim(q, 20);
        if (a) {
          const ga = ground(a.ring), cc = centroid(a.ring);
          wall(5, .93, ga, 0, GLASS2); prism(W, a.ring, ga - 1, ga + 16);
          S.color(GLASS2); for (const u of a.ring) S.beam(V(u.x, ga + 16, u.z), V(cc.x, ga + 27, cc.z), .5, .5);
          S.color('#6f8aa3'); spire(S, cc.x, ga + 27, cc.z, 1.6, 6);
        }
      }
      // the plaza's obelisk (13 m, granite)
      if (o.obelisk) { const q = L(...o.obelisk), gq = ground([q]); S.color('#3e4248'); S.box(q.x, gq, q.z, 1.6, 1, 1.6); S.box(q.x, gq + 1, q.z, 1.1, 11, 1.1); S.pyramid(q.x, gq + 12, q.z, 1.1, 1.5); }
    },

    // The statues at PNC Park's gates: Honus Wagner (1955) swinging on his tall granite base at the home-plate gate,
    // Willie Stargell (2001) at the left-field gate, Roberto Clemente (1994) tipping his cap by the bridge named for him
    statue(p, o) {
      const look = o.faceLat ? L(o.faceLat, o.faceLon) : null;
      const yaw = look ? faceTo(p, look) : (o.yawDeg || 0) * Math.PI / 180;
      const pose = { wagner: [CLIP.idle, 4], stargell: [CLIP.cheer, 9], clemente: [CLIP.wave, 7] }[o.who] || [CLIP.idle, 0];
      const base = o.who === 'wagner' ? [3.6, 3.2, 3.6] : [2.4, 1.6, 2.4];
      const bat = o.who === 'wagner' ? [[.35, 1.05, .1], [.75, 1.85, -.35]] : o.who === 'stargell' ? [[.1, 1.75, 0], [.2, 2.55, -.3]] : null;
      // (clear of the ride: the heroes' builders keep out of the rider's tube)
      statue(p, pose[0], { yaw, base, frame: pose[1], scale: o.scale || 1.35, bat });
    },

    // "Tribute to Children" (2009): Fred Rogers, seated, tying his shoe — 7,000 lb of bronze on a pier of the old
    // Manchester Bridge, in a ring of paving by the river
    rogers(p, o) {
      const yaw = (o.yawDeg ?? 160) * Math.PI / 180, g = ground([p, { x: p.x + 6, z: p.z }, { x: p.x, z: p.z + 6 }]);
      S.color('#cfc8ba'); S.cylinder(p.x, g - .3, p.z, 16, .45, 28);   // the plaza
      // the pier: rough-cut stone, rounded ends, on its footing
      const L2 = 13, w = 7, h = 5.2, cs = Math.cos(yaw), sn = Math.sin(yaw);
      S.color('#9b8f7c'); S.box(p.x, g - .5, p.z, L2, h + .5, w, yaw);
      for (const s of [-1, 1]) { S.cylinder(p.x + cs * s * L2 / 2, g - .5, p.z - sn * s * L2 / 2, w / 2, h + .5, 14); }
      S.color('#857a69'); S.box(p.x, g + h, p.z, L2 + .6, .6, w + .6, yaw);
      for (let y = g + 1.1; y < g + h; y += 1.3) { S.color('#8b806e'); S.box(p.x, y, p.z, L2 + .08, .12, w + .08, yaw); }
      // Mister Rogers on the pier's edge facing the river (and the city), seated, a little larger than life
      const f = { x: p.x - Math.sin(yaw) * (w / 2 - 1), z: p.z - Math.cos(yaw) * (w / 2 - 1) };
      const c = new THREE.Color('#6f5634');
      const geo = posedFigure({ ...bronze, shirt: c, pants: c.clone().multiplyScalar(.85), skin: c.clone().multiplyScalar(1.08) }, CLIP.sit, { frame: 3, lod: 'hi' });
      appendToMeshBuilder(S, geo, new THREE.Matrix4().compose(V(f.x, g + h + .6, f.z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), yaw + Math.PI), V(2.6, 2.6, 2.6)));
      geo.dispose();
      glows.push({ x: f.x, y: g + h + 1, z: f.z, size: 7, color: '#ffe1a8' });
    },

    // USS Requin (SS-481): a Tench-class submarine, 95 m, moored by the Carnegie Science Center: a long dark hull
    // tapering to bow and stern, its casing deck, the sail with periscopes and masts, a deck gun, the bow planes
    requin(p, o) {
      const [b] = claim(p, 40);
      let c = p, len = o.lengthM || 95, yaw = (o.yawDeg || 0) * Math.PI / 180;
      if (b) {
        c = centroid(b.ring); len = 0;
        for (const a of b.ring) for (const q of b.ring) { const d = Math.hypot(q.x - a.x, q.z - a.z); if (d > len) { len = d; yaw = Math.atan2(q.x - a.x, q.z - a.z); } }
        len = Math.min(len, 96);   // (claimed: the old stand-in, bridges.js, steps aside for this one)
      }
      const f = { x: Math.sin(yaw), z: Math.cos(yaw) }, y = city.landscape.level - .9, n = 24;
      const at = (u, dy = 0) => V(c.x + f.x * u * len, y + dy, c.z + f.z * u * len);
      S.color('#2d3236');
      for (let k = 0; k < n; k++) {
        const u0 = k / n - .5, u1 = (k + 1) / n - .5;
        const r = (u) => 4.1 * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(2 * u) * (u > 0 ? 1 : 1.04), 3.2)), .5);
        S.beam(at(u0, .9), at(u1, .9), Math.max(.5, r(u0) + r(u1)) * .95, Math.max(.4, r(u0) + r(u1)) * .62);
      }
      S.color('#55595c'); S.beam(at(-.47, 2.75), at(.45, 2.75), 3, .3);   // the casing deck
      // the sail (conning tower), its bridge rail and periscopes
      S.color('#2a2e31'); S.box(c.x + f.x * len * .04, y + 2.8, c.z + f.z * len * .04, 2.9, 4.6, 12, yaw);
      S.color('#202326'); S.box(c.x + f.x * len * .07, y + 7.4, c.z + f.z * len * .07, 2.6, .9, 6, yaw);
      for (const [u, h] of [[.01, 6], [.03, 7.2], [.05, 5]]) S.cylinder(c.x + f.x * len * u, y + 7.4, c.z + f.z * len * u, .18, h, 6);
      S.color('#e8e6df'); S.box(c.x + f.x * len * .02 + f.z * 1.5, y + 5.6, c.z + f.z * len * .02 - f.x * 1.5, .05, 1.1, 2.6, yaw);   // the hull number's panel
      // the deck gun forward of the sail, the bow planes
      S.color('#3a3f43'); S.cylinder(c.x + f.x * len * .14, y + 2.9, c.z + f.z * len * .14, .7, 1.4, 8); S.beam(at(.14, 4.1), at(.2, 4.4), .3, .3);
      for (const s of [-1, 1]) S.beam(at(.42, 1.4), V(c.x + f.x * len * .42 + f.z * s * 3.4, y + 1.4, c.z + f.z * len * .42 - f.x * s * 3.4), .9, .15);
      glows.push({ x: c.x + f.x * len * .05, y: y + 13.5, z: c.z + f.z * len * .05, size: 3, color: '#ff4a3a' });
    },
  };
}
