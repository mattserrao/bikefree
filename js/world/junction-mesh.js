// Junction meshes (three.js side of js/world/junctions.js): the junction surfaces and the plain asphalt over the
// route's road inside a junction go into the city's street builders (no extra draw calls), the corner sidewalks
// into the sidewalk builders, and the paint — crosswalks, stop lines, curb edges — into one merged mesh per chunk.
import * as THREE from '../../vendor/three.module.min.js';
import { streetPieces, streetPoint, LIFT_BLEND_M } from './junctions.js';
import { cityStreets } from './city-landscape.js';

/** A city landscape's junction plan (planned with its streets on first use; null when the scene doesn't opt in). */
export function junctionPlan(landscape, index, route) {
  if (!landscape?.city || !landscape.junctions) return null;
  cityStreets(landscape, index, route);
  return landscape._junctions || null;
}

const PLAIN_U = .125;         // a column of the street texture with no lane paint (city.js: the left half is the lanes)
const PAINT_U = .78;          // …and the white block in its right half: paint costs no extra draw call
const TOP_SLOT = 8;           // above every street ribbon's height slot (city.js)
const ROAD_LIFT = .12, ERASE = .012, PAINT_SLOT = 9;   // (city.js draws slot 9 a hair nearer the camera)

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * A street's drawn pieces with their ribbon heights blended to the junction surface's lift at each cut, so the
 * ribbon (drawn at `lift` above its points) meets the junction surface exactly. → [[{x, y, z}…]…]
 */
export function drawnPieces(st, k, plan, lift) {
  const pieces = streetPieces(st, plan.cuts.get(k));
  if (pieces.length === 1 && pieces[0] === st.pts) return pieces;
  const JL = plan.options.lift;
  return pieces.map((pc) => {
    let d = 0;
    const along = [0];
    for (let i = 1; i < pc.length; i++) { d += Math.hypot(pc[i].x - pc[i - 1].x, pc[i].z - pc[i - 1].z); along.push(d); }
    return pc.map((p, i) => {
      const fromCut = Math.min(pc[0].cut ? along[i] : Infinity, pc[pc.length - 1].cut ? d - along[i] : Infinity);
      const w = fromCut === Infinity ? 1 : smooth(fromCut / LIFT_BLEND_M);
      return { x: p.x, z: p.z, y: p.y + (JL - lift) * (1 - w) };
    });
  });
}

/**
 * Build everything for a plan. `city`: the CityScene; `get(map, x, z)`: its per-chunk builder lookup; `roads`,
 * `walks`: its street and sidewalk builder maps; `liftOf(k)`: a street's ribbon lift. Returns the paint meshes.
 */
export function buildJunctionMeshes(city, plan, { get, roads, walks, liftOf }) {
  const L = city.landscape, streets = city.streets, O = plan.options, JL = O.lift;
  const route = city.route, index = city.index, end = route.turnIdx || route.dist.length - 1;
  // paint goes into the street builders too (white block of the street texture, the topmost height slot)
  const paintAt = (x, z) => get(roads, x, z).set({ aSlot: [PAINT_SLOT] });
  const flatQuad = (B, p, u = PAINT_U) => {   // p: 4 corners {x, y, z} (any order round the quad: the face points up)
    const k = p.map((q) => B.vertex(q.x, q.y, q.z, 0, 1, 0, u, .5));
    // wind so the face points up
    const ax = p[1].x - p[0].x, az = p[1].z - p[0].z, bx = p[2].x - p[0].x, bz = p[2].z - p[0].z;
    if (az * bx - ax * bz > 0) { B.tri(k[0], k[1], k[2]); B.tri(k[0], k[2], k[3]); } else { B.tri(k[0], k[2], k[1]); B.tri(k[0], k[3], k[2]); }
  };
  // the route's road: centre, right vector and surface height at distance s (as world.js draws it)
  const roadAt = (s) => {
    let j = Math.max(0, Math.min(end - 1, Math.floor(s / 10)));
    while (j > 0 && route.dist[j] > s) j--; while (j < end - 1 && route.dist[j + 1] < s) j++;
    const f = Math.max(0, Math.min(1, (s - route.dist[j]) / ((route.dist[j + 1] - route.dist[j]) || 1)));
    const dir = (i) => { const a = Math.max(0, i - 1), b = Math.min(end, i + 1); const dx = index.xs[b] - index.xs[a], dz = index.zs[b] - index.zs[a], l = Math.hypot(dx, dz) || 1; return { x: -dz / l, z: dx / l }; };
    const r0 = dir(j), r1 = dir(j + 1);
    return { x: index.xs[j] + (index.xs[j + 1] - index.xs[j]) * f, z: index.zs[j] + (index.zs[j + 1] - index.zs[j]) * f,
      y: route.ele[j] + (route.ele[j + 1] - route.ele[j]) * f + ROAD_LIFT, rx: r0.x + (r1.x - r0.x) * f, rz: r0.z + (r1.z - r0.z) * f, j, f };
  };
  let surfaces = 0, paintTris = 0;
  // junction polygons on a 32 m grid: paint never lands inside another junction
  const jgrid = new Map();
  for (const jn of plan.list) {
    const key = `${Math.floor(jn.x / 32)},${Math.floor(jn.z / 32)}`; if (!jgrid.has(key)) jgrid.set(key, []); jgrid.get(key).push(jn);
  }
  const inPoly = (ring, x, z) => { let r = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], c = ring[j]; if ((a.z > z) !== (c.z > z) && x < ((c.x - a.x) * (z - a.z)) / (c.z - a.z) + a.x) r = !r; } return r; };
  const inOther = (self, p, pad = 1.5) => {
    for (let gx = Math.floor(p.x / 32) - 1; gx <= Math.floor(p.x / 32) + 1; gx++) for (let gz = Math.floor(p.z / 32) - 1; gz <= Math.floor(p.z / 32) + 1; gz++) {
      for (const o of jgrid.get(`${gx},${gz}`) || []) {
        if (o === self) continue;
        if (inPoly(o.poly, p.x, p.z)) return true;
        for (const q of o.poly) if (Math.hypot(q.x - p.x, q.z - p.z) < pad) return true;
      }
    }
    return false;
  };
  const spanNear = (self, s0, s1) => plan.spans.some((sp) => sp.jn !== self.id && sp.s0 - 2 < Math.max(s0, s1) && sp.s1 + 2 > Math.min(s0, s1));

  // each junction's geometry joins the chunk of one of its streets (no chunks of its own: no extra draw calls)
  const home = (jn) => { const a = jn.arms.find((o) => !o.route) || jn.extra[0]; const p = a ? streets[a.k].pts[0] : jn; return p; };
  for (const jn of plan.list) {
    const H = home(jn);
    // 1. the surface: a fan from the centre (the polygon is star-shaped about it)
    const B = get(roads, H.x, H.z).set({ aSlot: [TOP_SLOT] });
    const poly = jn.poly.filter((p, i) => { const q = jn.poly[(i + 1) % jn.poly.length]; return Math.hypot(p.x - q.x, p.z - q.z) > .02; });
    const star = poly.every((a, i) => { const b = poly[(i + 1) % poly.length]; return (a.x - jn.x) * (b.z - jn.z) - (a.z - jn.z) * (b.x - jn.x) > 1e-6; });
    const ring = poly.map((p) => B.vertex(p.x, jn.J(p.x, p.z) + JL, p.z, 0, 1, 0, PLAIN_U, 0));
    if (star) {
      const c = B.vertex(jn.x, jn.J(jn.x, jn.z) + JL, jn.z, 0, 1, 0, PLAIN_U, 0);
      for (let i = 0; i < ring.length; i++) B.tri(c, ring[(i + 1) % ring.length], ring[i]);
    } else {   // (where the centre sits off to one side: ear clipping)
      let tris = [];
      try { tris = THREE.ShapeUtils.triangulateShape(poly.map((p) => new THREE.Vector2(p.x, p.z)), []); } catch { tris = []; }
      for (const [i, j, k] of tris) {
        const a = poly[i], b = poly[j], c = poly[k];
        if ((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x) > 0) B.tri(ring[i], ring[k], ring[j]); else B.tri(ring[i], ring[j], ring[k]);
      }
    }
    surfaces++;
    // 2. corner sidewalks round each curb return (outward from the junction), with a pale curb edge
    for (const cb of jn.curbs) {
      const W = get(walks, H.x, H.z), n = cb.pts.length;
      const outer = [];
      for (let i = 0; i < n; i++) {
        const a = cb.pts[Math.max(0, i - 1)], b = cb.pts[Math.min(n - 1, i + 1)], p = cb.pts[i];
        let nx = -(b.z - a.z), nz = b.x - a.x; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
        if (nx * (p.x - jn.x) + nz * (p.z - jn.z) < 0) { nx = -nx; nz = -nz; }
        const w = cb.wA + (cb.wB - cb.wA) * (i / (n - 1));
        outer.push({ x: p.x + nx * w, z: p.z + nz * w });
      }
      const y = (p) => jn.J(p.x, p.z);
      for (let i = 1; i < n; i++) {
        const a = cb.pts[i - 1], b = cb.pts[i];
        const sl = O.sidewalkLift;
        flatQuad(W, [{ ...a, y: y(a) + sl }, { ...b, y: y(b) + sl }, { ...outer[i], y: y(outer[i]) + sl }, { ...outer[i - 1], y: y(outer[i - 1]) + sl }], 0);
      }
    }
    // 3. paint at each arm's mouth: a crosswalk across it, a stop line across the lanes coming in
    const busy = jn.arms.length >= 3;
    for (const A of jn.arms) {
      if (A.route || !busy || !(A.cls >= 2 && A.cls <= 6)) continue;   // (the route's own arms: routeJunctionOverlay)
      let height;
      if (A.route) {
        const s0 = jn.s + A.dir * A.t;
        height = (d) => roadAt(jn.s + A.dir * d).y + .014;
        if (s0 < 5 || s0 > route.dist[end] - 5) continue;
      } else {
        const st = streets[A.k], lift = liftOf(A.k);
        height = (d) => { const p = streetPoint(st, A.a0 + A.dir * d); return p.y + JL + (lift - JL) * smooth((d - A.t) / LIFT_BLEND_M) + .014; };
      }
      const P = paintAt(H.x, H.z);
      const at = (d, side) => {   // a point on the arm d from its node, `side` metres to the left
        if (A.route) { const r = roadAt(jn.s + A.dir * d), sg = A.dir; return { x: r.x + r.rx * side * sg, z: r.z + r.rz * side * sg, y: r.y + .014 }; }
        const p = streetPoint(streets[A.k], A.a0 + A.dir * d), nx = -p.dz * A.dir, nz = p.dx * A.dir;
        return { x: p.x + nx * side, z: p.z + nz * side, y: height(d) };
      };
      const d0 = A.t + .5, d1 = d0 + O.crosswalkW, h = A.h - .5;
      // not where the block is too short for it, nor into the next junction
      if (A.route ? spanNear(jn, jn.s + A.dir * d0, jn.s + A.dir * (d1 + 2)) : (A.shared ? d1 + 1 > A.avail * .5 : d1 + 1 > A.avail)) continue;
      if ([at(d0, -h), at(d0, h), at(d1, -h), at(d1, h)].some((p) => inOther(jn, p))) continue;
      const bars = Math.max(2, Math.floor((2 * h) / 1.1));
      for (let q = 0; q < bars; q++) {
        const s0 = -h + (2 * h) * (q + .25) / bars, s1 = -h + (2 * h) * (q + .75) / bars;
        flatQuad(P, [at(d0, s0), at(d0, s1), at(d1, s1), at(d1, s0)]); paintTris += 2;
      }
      if (!A.route) {
        const inbound = A.oneway === 0 ? [-A.h + .3, -.15] : A.oneway * A.dir < 0 ? [-A.h + .3, A.h - .3] : null;
        if (inbound) { const ds = d1 + 1.1; flatQuad(P, [at(ds, inbound[0]), at(ds, inbound[1]), at(ds + .45, inbound[1]), at(ds + .45, inbound[0])]); paintTris += 2; }
      }
    }
  }
  return { surfaces, paintTris };
}

/**
 * The route's shoulder (world.js: the pale band either side of the road) is left out inside junctions the route
 * passes through: the junction surface and its corner sidewalks take its place. Cuts the ribbon exactly at each
 * span's ends (new stations interpolated along its edges). `dist`: the route's distance at each station.
 */
export function cutRouteRibbon(mesh, plan, dist) {
  if (!plan?.spans.length || !mesh?.geometry) return;
  const g = mesh.geometry, P = g.attributes.position.array, U = g.attributes.uv.array, n = P.length / 6;
  const spans = plan.spans.map((sp) => [sp.s0, sp.s1]).sort((a, b) => a[0] - b[0]);
  const inside = (s) => spans.some(([a, b]) => s > a + 1e-3 && s < b - 1e-3);
  const pos = [], uv = [], idx = [];
  let prev = -1;
  const station = (i, f) => {   // vertices at fraction f from station i toward i + 1
    const j = Math.min(n - 1, i + 1);
    for (let side = 0; side < 2; side++) {
      for (let c = 0; c < 3; c++) pos.push(P[i * 6 + side * 3 + c] + (P[j * 6 + side * 3 + c] - P[i * 6 + side * 3 + c]) * f);
      for (let c = 0; c < 2; c++) uv.push(U[i * 4 + side * 2 + c] + (U[j * 4 + side * 2 + c] - U[i * 4 + side * 2 + c]) * f);
    }
    return pos.length / 6 - 1;
  };
  const link = (a, b) => { const A = a * 2, B = b * 2; idx.push(A, A + 1, B, A + 1, B + 1, B); };
  for (let i = 0; i < n; i++) {
    const s = dist[i];
    if (!inside(s)) { const k = station(i, 0); if (prev >= 0) link(prev, k); prev = k; } else prev = -1;
    if (i === n - 1) break;
    const s1 = dist[i + 1];
    for (const [a, b] of spans) for (const e of [a, b]) {
      if (e <= s || e >= s1) continue;
      const k = station(i, (e - s) / (s1 - s));
      if (e === a) { if (prev >= 0) link(prev, k); prev = -1; } else prev = k;
    }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
}

/**
 * The route's own road inside and at the mouths of junctions: one mesh over the road (one draw call for the whole
 * route, like the road itself) with plain asphalt through each junction (no edge or centre lines across it) and a
 * crosswalk across the road at each mouth where a street with sidewalks comes in. Drawn with a stronger depth
 * offset than the road so it always lies on top. `plan`: the city's junctions (null: nothing).
 */
export function routeJunctionOverlay(route, index, plan) {
  if (!plan?.spans.length) return null;
  const end = route.turnIdx || route.dist.length - 1, total = route.dist[end];
  const pos = [], col = [], idx = [];
  const ASPHALT = new THREE.Color('#53595d'), PAINT = new THREE.Color('#e6e2d4');
  const dir = (i) => { const a = Math.max(0, i - 1), b = Math.min(end, i + 1); const dx = index.xs[b] - index.xs[a], dz = index.zs[b] - index.zs[a], l = Math.hypot(dx, dz) || 1; return [-dz / l, dx / l]; };
  const roadAt = (s) => {   // centre, right vector and surface height at s (exactly as world.js builds the road)
    let j = Math.max(0, Math.min(end - 1, Math.floor(s / 10)));
    while (j > 0 && route.dist[j] > s) j--; while (j < end - 1 && route.dist[j + 1] < s) j++;
    const f = Math.max(0, Math.min(1, (s - route.dist[j]) / ((route.dist[j + 1] - route.dist[j]) || 1))), r0 = dir(j), r1 = dir(j + 1);
    return { x: index.xs[j] + (index.xs[j + 1] - index.xs[j]) * f, z: index.zs[j] + (index.zs[j + 1] - index.zs[j]) * f,
      y: route.ele[j] + (route.ele[j + 1] - route.ele[j]) * f + ROAD_LIFT, rx: r0[0] + (r1[0] - r0[0]) * f, rz: r0[1] + (r1[1] - r0[1]) * f };
  };
  const v = (x, y, z, c) => { pos.push(x, y, z); col.push(c.r, c.g, c.b); return pos.length / 3 - 1; };
  // a strip between distances s0 and s1 (stations at the road's own samples), from `a` to `b` metres across
  const strip = (s0, s1, a, b, lift, c) => {
    const st = [s0]; for (let i = 0; i <= end; i++) if (route.dist[i] > s0 + .05 && route.dist[i] < s1 - .05) st.push(route.dist[i]); st.push(s1);
    let prev = null;
    for (const s of st) {
      const r = roadAt(s), L = v(r.x + r.rx * a, r.y + lift, r.z + r.rz * a, c), R = v(r.x + r.rx * b, r.y + lift, r.z + r.rz * b, c);
      if (prev) idx.push(prev[0], prev[1], L, prev[1], R, L);
      prev = [L, R];
    }
  };
  const spans = plan.spans.map((sp) => ({ ...sp, s0: Math.max(0, sp.s0), s1: Math.min(total, sp.s1) })).filter((sp) => sp.s1 - sp.s0 > 1);
  for (const sp of spans) strip(sp.s0, sp.s1, -3.52, 3.52, .004, ASPHALT);
  const W = plan.options.crosswalkW;
  for (const sp of spans) {
    const jn = plan.list[sp.jn];
    if (jn.arms.length < 3 || !jn.arms.some((o) => !o.route && o.cls >= 2 && o.cls <= 6)) continue;
    for (const [d0, sgn] of [[sp.s0 - .5, -1], [sp.s1 + .5, 1]]) {
      const a0 = sgn > 0 ? d0 : d0 - W, a1 = sgn > 0 ? d0 + W : d0;
      if (a0 < 5 || a1 > total - 5 || spans.some((o) => o !== sp && o.s0 - 2 < a1 && o.s1 + 2 > a0)) continue;   // no room before the next junction
      for (let q = 0; q < 6; q++) strip(a0, a1, -3 + 6 * (q + .2) / 6, -3 + 6 * (q + .8) / 6, .008, PAINT);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .93, metalness: .015, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  m.name = 'Route junctions'; m.frustumCulled = false; m.renderOrder = 3; m.receiveShadow = true;
  return m;
}
