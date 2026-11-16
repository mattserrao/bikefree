// Junction meshes (three.js side of js/world/junctions.js): the junction surfaces and the plain asphalt over the
// route's road inside a junction go into the city's street builders (no extra draw calls), the corner sidewalks
// into the sidewalk builders, and the paint — crosswalks, stop lines, curb edges — into one merged mesh per chunk.
import * as THREE from '../../vendor/three.module.min.js';
import { streetPieces, LIFT_BLEND_M, junctionPaint, routeLine } from './junctions.js';
import { ROAD_WIDTH } from './pose.js';
import { cityStreets } from './city-landscape.js';

/** A city landscape's junction plan (planned with its streets on first use; null when the scene doesn't opt in). */
export function junctionPlan(landscape, index, route) {
  if (!landscape?.city || !landscape.junctions) return null;
  cityStreets(landscape, index, route);
  return landscape._junctions || null;
}

const PAINT_U = .78;          // …and the white block in its right half: paint costs no extra draw call
const TOP_SLOT = 8;           // above every street ribbon's height slot (city.js)
const ROAD_LIFT = .12, PAINT_SLOT = 9;   // (city.js draws slot 9 a hair nearer the camera)

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * A street's drawn pieces with their ribbon heights blended to the junction surface's lift at each cut, so the
 * ribbon (drawn at `lift` above its points) meets the junction surface exactly. → [[{x, y, z, tx?, tz?}…]…]
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
      return { x: p.x, z: p.z, y: p.y + (JL - lift) * (1 - w), tx: p.tx, tz: p.tz, tl: p.tl, tr: p.tr };
    });
  });
}

// [road meets] junction surfaces and the route's overlay take the plain asphalt of the street texture (u .05–.22: no
// lane lines), mapped in world metres like the ribbons, so the grain and the shade match the streets they join
const PLAIN = (x, jx) => .135 + .085 * Math.max(-1, Math.min(1, (x - jx) / 20));
const upNormal = (a, b, c) => {   // the face normal of a triangle (pointing up)
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
  const l = Math.hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l];
};

/**
 * Build everything for a plan. `city`: the CityScene; `get(map, x, z)`: its per-chunk builder lookup; `roads`,
 * `walks`: its street and sidewalk builder maps; `liftOf(k)`: a street's ribbon lift. Junction surfaces, paint and
 * corner sidewalks join the street and sidewalk chunks (no extra draw calls); the route's overlay is one mesh.
 */
export function buildJunctionMeshes(city, plan, { get, roads, walks, liftOf }) {
  const streets = city.streets, O = plan.options;
  const route = city.route, index = city.index;
  const paintAt = (x, z) => get(roads, x, z).set({ aSlot: [PAINT_SLOT] });
  const flatQuad = (B, p, u = PAINT_U) => {   // p: 4 corners {x, y, z} round the quad; the face points up
    const n = upNormal(p[0], p[1], p[2]);
    const k = p.map((q) => B.vertex(q.x, q.y, q.z, n[0], n[1], n[2], u, .5));
    const ax = p[1].x - p[0].x, az = p[1].z - p[0].z, bx = p[2].x - p[0].x, bz = p[2].z - p[0].z;
    if (az * bx - ax * bz > 0) { B.tri(k[0], k[1], k[2]); B.tri(k[0], k[2], k[3]); } else { B.tri(k[0], k[2], k[1]); B.tri(k[0], k[3], k[2]); }
  };
  let surfaces = 0, paintTris = 0;
  // each junction's geometry joins the chunk of one of its streets (no chunks of its own: no extra draw calls)
  const home = (jn) => { const a = jn.arms.find((o) => !o.route) || jn.extra[0]; const p = a ? streets[a.k].pts[0] : jn; return p; };
  for (const jn of plan.list) {
    const H = home(jn);
    // 1. the surface: a fan from the centre (the polygon is star-shaped about it), each vertex at its drawn height
    const B = get(roads, H.x, H.z).set({ aSlot: [TOP_SLOT] });
    const poly = jn.poly.filter((p, i) => { const q = jn.poly[(i + 1) % jn.poly.length]; return Math.hypot(p.x - q.x, p.z - q.z) > .02; });
    const star = poly.every((a, i) => { const b = poly[(i + 1) % poly.length]; return (a.x - jn.x) * (b.z - jn.z) - (a.z - jn.z) * (b.x - jn.x) > 1e-6; });
    const C = { x: jn.x, y: jn.cy, z: jn.z };
    // one normal for the whole surface (its plane: the route's grade, or the street plane), so it shades evenly
    const g = .5, nJ = upNormal({ x: jn.x - g, y: jn.J(jn.x - g, jn.z), z: jn.z }, { x: jn.x + g, y: jn.J(jn.x + g, jn.z), z: jn.z }, { x: jn.x, y: jn.J(jn.x, jn.z + g), z: jn.z + g });
    const vert = (p) => B.vertex(p.x, p.y, p.z, nJ[0], nJ[1], nJ[2], PLAIN(p.x, jn.x), p.z / 24);
    const ring = poly.map(vert);
    if (star) {
      const c = vert(C);
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
    // 2. corner sidewalks round each curb return (outward from the junction)
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
      // (at the curb's ends, the street's own sidewalk height: its line + .06, like city.js draws it)
      const y = (p, i) => (p.y != null ? p.y - jn.lift : jn.J(p.x, p.z)) + O.sidewalkLift + (i == null ? 0 : 0);
      const sy = cb.pts.map((p) => y(p));
      for (let i = 1; i < n; i++) {
        const a = cb.pts[i - 1], b = cb.pts[i];
        flatQuad(W, [{ ...a, y: sy[i - 1] }, { ...b, y: sy[i] }, { ...outer[i], y: sy[i] }, { ...outer[i - 1], y: sy[i - 1] }], 0);
      }
    }
  }
  // 3. paint (js/world/junctions.js junctionPaint: the same quads the course QC checks)
  const paint = junctionPaint(plan, streets, { route, index, routeDist: city.landscape.routeDist, roadWidth: ROAD_WIDTH, liftOf, routeKindAt: city.landscape.routeKindAt });
  for (const q of paint.quads) {
    if (q.kind === 'route-crosswalk') continue;   // (on the route's overlay below)
    const jn = plan.list[q.jn], H = home(jn);
    flatQuad(paintAt(H.x, H.z), q.pts); paintTris += 2;
  }
  // 4. the route's road inside each junction it passes through: plain asphalt (no lane lines), and its crosswalks
  const overlay = routeJunctionOverlay(route, index, plan, paint, city.streetMaterial);
  if (overlay) city.group.add(overlay);
  return { surfaces, paintTris, paintLeftOut: paint.bad.length };
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
 * route, like the road itself) with the streets' plain asphalt through each junction (no edge or centre lines across
 * it; the same texture, shade and normals as the junction surface around it) and the route's crosswalks. Drawn with
 * a stronger depth offset than the road so it always lies on top. Follows the road's curve (routeLine).
 */
export function routeJunctionOverlay(route, index, plan, paint, streetMaterial) {
  if (!plan?.spans.length || !streetMaterial) return null;
  const RL = routeLine(route, index), D = RL.route.dist, total = RL.length;
  const pos = [], nor = [], uv = [], idx = [];
  const v = (x, y, z, n, u, w) => { pos.push(x, y, z); nor.push(...n); uv.push(u, w); return pos.length / 3 - 1; };
  const P = (i) => ({ x: pos[i * 3], z: pos[i * 3 + 2] });
  const quad = (k) => {   // 4 vertex indices round a quad: wound so the face points up
    const p = k.map(P), ax = p[1].x - p[0].x, az = p[1].z - p[0].z, bx = p[2].x - p[0].x, bz = p[2].z - p[0].z;
    if (az * bx - ax * bz > 0) idx.push(k[0], k[1], k[2], k[0], k[2], k[3]); else idx.push(k[0], k[2], k[1], k[0], k[3], k[2]);
  };
  const normalAt = (s) => { const a = RL.at(s - 1.5), b = RL.at(s + 1.5), g = (b.y - a.y) / 3; const l = Math.hypot(1, g); return [-a.tx * g / l, 1 / l, -a.tz * g / l]; };
  const half = ROAD_WIDTH / 2 + .02;
  for (const sp of plan.spans) {
    const s0 = Math.max(0, sp.s0), s1 = Math.min(total, sp.s1);
    if (s1 - s0 < 1) continue;
    const st = [s0]; for (let i = 0; i <= RL.n; i++) if (D[i] > s0 + .05 && D[i] < s1 - .05) st.push(D[i]); st.push(s1);
    let prev = null;
    for (const s of st) {
      const r = RL.at(s), y = r.y + ROAD_LIFT + .004, n = normalAt(s);
      const L = v(r.x - r.rx * half, y, r.z - r.rz * half, n, .05, s / 24), R = v(r.x + r.rx * half, y, r.z + r.rz * half, n, .22, s / 24);
      if (prev) quad([prev[0], prev[1], R, L]);
      prev = [L, R];
    }
  }
  for (const q of paint?.quads || []) {
    if (q.kind !== 'route-crosswalk') continue;
    const s = RL.project(q.pts[0].x, q.pts[0].z, plan.list[q.jn].s, 60)?.s ?? 0, n = normalAt(s);
    quad(q.pts.map((p) => v(p.x, p.y, p.z, n, PAINT_U, .5)));
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aSlot', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3).fill(TOP_SLOT), 1));
  g.setIndex(idx);
  const mat = streetMaterial.clone();
  mat.polygonOffset = true; mat.polygonOffsetFactor = -3; mat.polygonOffsetUnits = -3;
  mat.onBeforeCompile = streetMaterial.onBeforeCompile; mat.customProgramCacheKey = streetMaterial.customProgramCacheKey;
  const m = new THREE.Mesh(g, mat);
  m.name = 'Route road junctions';   // (a road surface for the clipping QC)
  m.frustumCulled = false; m.renderOrder = 3; m.receiveShadow = true;
  return m;
}
