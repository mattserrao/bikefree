// Pittsburgh's bridges (each in its own structural style), the two stadiums on the North Shore,
// and the landmarks: Point State Park's fountain, USS Requin, storefronts on East Carson Street,
// aircraft beacons and the Gulf Tower's weather beacon.
import * as THREE from '../../../../vendor/three.js';
import { MeshBuilder, resample, makePath, hash } from '../core/mesh-builder.js';
import { due, each } from '../core/jobs.js';   // [F30]
import { ROAD_WIDTH } from '../core/road-frame.js';
import { randomSequence } from '../core/random.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * [w2-polish] A round granite fountain basin centred at (x, y ground, z), radius r (to the rim's middle): a paved
 * apron ring, the basin wall (outer face, coping that overhangs both sides, a darker inner face down to the water at
 * y + .35), and in the middle a three-tier granite pedestal with the nozzle and the jet's solid white core (the spray
 * is drawn as points on top). Granite blocks vary a little in tone. ≈ 1,000 triangles, one merged builder.
 */
function fountainBasin(M, x, y, z, r, { seg = 64, jetM = 18, footY = y - .1 } = {}) {
  const ring = (rr, k) => { const a = k / seg * Math.PI * 2; return [x + Math.cos(a) * rr, z + Math.sin(a) * rr]; };
  const quadR = (r0, y0, r1, y1, k, outward) => {   // a band between (r0, y0) and (r1, y1) for segment k
    const [ax, az] = ring(r0, k), [bx, bz] = ring(r0, k + 1), [cx, cz] = ring(r1, k + 1), [dx, dz] = ring(r1, k);
    const A = V(ax, y0, az), B = V(bx, y0, bz), C = V(cx, y1, cz), D = V(dx, y1, dz);
    const n = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(D, A));
    const mid = (k + .5) / seg * Math.PI * 2, want = V(Math.cos(mid) * outward[0], outward[1], Math.sin(mid) * outward[0]);
    if (n.dot(want) >= 0) M.quad(A, B, C, D); else M.quad(A, D, C, B);
  };
  const granite = ['#b3aca1', '#a9a297', '#bbb4a8', '#a49d93'], tone = (k, f = 1) => new THREE.Color(granite[Math.floor(hash(k * 31 + 7) * granite.length)]).multiplyScalar(f);
  const wallOut = r + .55, wallIn = r - .45, top = y + .95, cope = .3;
  for (let k = 0; k < seg; k++) {
    if (footY > y - .5) { M.color(tone(k, .82)); quadR(wallOut + 1.6, y + .04, wallOut + .02, y + .06, k, [0, 1]); }   // the apron (paving round the basin), on level ground
    M.color(tone(k, .95)); quadR(wallOut, Math.min(footY, y - .1), wallOut, top - .12, k, [1, 0]);        // outer face
    M.color(tone(k + 3, 1.06)); quadR(wallOut + cope * .5, top - .12, wallOut + cope * .5, top, k, [1, 0]);   // coping: outer lip,
    quadR(wallOut + cope * .5, top, wallIn - cope * .5, top, k, [0, 1]);                                    // top,
    quadR(wallIn - cope * .5, top, wallIn - cope * .5, top - .12, k, [-1, 0]);                              // inner lip
    M.color(tone(k, .72)); quadR(wallIn, top - .12, wallIn, y + .2, k, [-1, 0]);                         // inner face, down to the water
    M.color(tone(k + 3, .9)); quadR(wallOut, top - .12, wallOut + cope * .5, top - .12, k, [0, -1]); quadR(wallIn - cope * .5, top - .12, wallIn, top - .12, k, [0, -1]);   // coping soffits
  }
  // the centre: three granite tiers rising out of the water, the bronze nozzle and the jet's core
  const tiers = [[3.2, .9], [2.1, 1.35], [1.1, 1.7]];
  let base = y + .2;
  tiers.forEach(([tr, th], i) => { M.color(tone(i + 11, 1 - i * .04)); M.cylinder(x, base, z, tr, th - (base - y - .2), 24, tr * .96); base = y + .2 + th; });
  M.color('#6d5a3e'); M.cylinder(x, base, z, .45, .5, 12, .3);
  M.color('#eef5f8'); M.cylinder(x, base + .5, z, .32, jetM, 8, .06);   // the jet's solid core (the spray points do the rest)
}
const GOLD = '#d4a22c', CONCRETE = '#a49e93';
const STYLE = {
  sister: { color: GOLD }, 'arch-gold': { color: GOLD }, fortpitt: { color: GOLD }, lenticular: { color: '#3f6f9c', accent: '#9a5b3a' },
  truss: { color: '#7d8791' }, 'truss-dark': { color: '#3e4246' }, suspension: { color: '#b49a4c' }, arch: { color: '#6f8091' }, girder: { color: '#8a8e91' },
};

/** Frame along a deck path: position, flat forward and right at distance s. */
function framer(path) {
  return (s) => {
    const p = path.at(s);
    return { p: V(p.x, p.y, p.z), f: V(p.dx, 0, p.dz).normalize(), r: V(-p.dz, 0, p.dx).normalize() };
  };
}

/** Deck slab, railings and piers for any bridge (girder look); returns the path for a superstructure. */
function deck(M, city, pts, width, opts = {}) {
  const path = makePath(resample(pts, 4));
  const L = city.landscape, at = framer(path);
  const n = Math.max(2, Math.ceil(path.length / 4));
  const thick = opts.thick || 1.8;
  M.color(opts.slab || CONCRETE);
  let prev = null;
  for (let k = 0; k <= n; k++) {
    const { p, r } = at(k / n * path.length);
    const hw = width / 2 + .4;
    const c = [p.clone().addScaledVector(r, -hw), p.clone().addScaledVector(r, hw)];
    // over the route the slab gets thinner, so its underside clears the rider and the chase camera
    let t = thick;
    const near = L.routeDist?.(p.x, p.z);
    if (near && near.d < hw + ROAD_WIDTH / 2 + 2 && p.y - near.y > 4) t = Math.max(.3, Math.min(thick, p.y - near.y - 4.15));
    const cur = [c[0].clone().setY(p.y - .05), c[1].clone().setY(p.y - .05), c[1].clone().setY(p.y - t), c[0].clone().setY(p.y - t)];
    if (prev) {
      // [finish] wound to face outwards (r = (-dz, 0, dx): all four faced inwards, so from above the slab showed its
      // underside up to 2.2 m below the roadway, it was lit from inside, and the lamps on its edges stood on nothing)
      M.quad(prev[1], cur[1], cur[0], prev[0]);           // top (the slab's edges past the roadway, where lamps stand)
      M.quad(prev[3], cur[3], cur[2], prev[2]);           // underside
      M.quad(prev[0], cur[0], cur[3], prev[3]);           // left face
      M.quad(prev[2], cur[2], cur[1], prev[1]);           // right face
    }
    prev = cur;
  }
  // railings
  M.color(opts.rail || '#5d6166');
  const rn = opts.noRail ? 0 : Math.max(1, Math.ceil(path.length / 12));
  for (const side of [-1, 1]) {
    for (let k = 0; k < rn; k++) {
      const a = at(k / rn * path.length), b = at((k + 1) / rn * path.length);
      const o = side * (width / 2 + .25);
      // [6.1] not across another carriageway at about the deck's level (a ramp merging, the other half of a
      // divided road alongside): its traffic would drive through the rail
      if (L.streetsNear && [.25, .75].some((f) => {
        const q = at((k + f) / rn * path.length), x = q.p.x + q.r.x * o, z = q.p.z + q.r.z * o;
        return L.streetsNear(x, z, .2).some((n) => n.k !== opts.street && city.streets?.[n.k]?.cls <= 7 && Math.abs(n.y - q.p.y) < 2.6);
      })) continue;
      M.beam(a.p.clone().addScaledVector(a.r, o).setY(a.p.y + 1.05), b.p.clone().addScaledVector(b.r, o).setY(b.p.y + 1.05), .12, .12);
    }
  }
  // piers where the deck is well above the ground or the river
  M.color(CONCRETE);
  const span = opts.pierEvery || 46;
  for (let s = span / 2; s < path.length - 8; s += span) {
    const { p, f } = at(s);
    const wet = L.waterAt(p.x, p.z) > .5;
    const ground = wet ? L.level - 6 : L.baseHeight(p.x, p.z);
    if (p.y - thick - ground < 3.5) continue;
    // never on the route's road or in another street's carriageway
    const half = Math.min(width * .7, 9) / 2 + 1.3, r = L.routeDist?.(p.x, p.z);
    if (r && r.d < ROAD_WIDTH / 2 + half) continue;
    if (L.streetAt && L.streetAt(p.x, p.z, half, opts.street ?? -1)) continue;
    M.box(p.x, ground, p.z, Math.min(width * .7, 9), p.y - thick - ground, 2.4, Math.atan2(f.x, f.z));
  }
  return path;
}

/** The stretch of a bridge that is over water: [s0, s1] (or the middle 70% if dry). */
function waterSpan(city, path) {
  let s0 = null, s1 = null;
  for (let s = 0; s <= path.length; s += 3) {
    const p = path.at(s);
    if (city.landscape.waterAt(p.x, p.z) > .5) { if (s0 === null) s0 = s; s1 = s; }
  }
  if (s0 === null || s1 - s0 < 40) return [path.length * .15, path.length * .85];
  return [Math.max(0, s0 - 6), Math.min(path.length, s1 + 6)];
}

function superstructure(M, city, path, style, width, lights) {
  const at = framer(path), S = STYLE[style] || STYLE.girder;
  const light = (p) => lights.push({ x: p.x, y: p.y, z: p.z, size: 2.4, color: '#fff1d0' });
  if (style === 'sister') {
    // self-anchored suspension: two towers, eyebar chains from the deck ends over the towers
    const [w0, w1] = waterSpan(city, path), L = path.length;
    const t0 = Math.max(w0, L * .27), t1 = Math.min(w1, L * .73), H = 19;
    const off = width / 2 + 1.1;
    const chainY = (s, y) => {
      if (s <= t0) { const u = s / t0; return y + .6 + (H - .6) * u * u; }
      if (s >= t1) { const u = (L - s) / (L - t1); return y + .6 + (H - .6) * u * u; }
      const u = (s - t0) / (t1 - t0); return y + 2.4 + (H - 2.4) * (2 * u - 1) ** 2;
    };
    M.color(S.color);
    for (const side of [-1, 1]) {
      let prev = null;
      for (let s = 0; s <= L + .01; s += 4) {
        const { p, r } = at(s), base = p.clone().addScaledVector(r, side * off);
        const c = base.clone().setY(chainY(s, p.y));
        if (prev) M.beam(prev, c, .9, .55);
        if (s > 2 && s < L - 2 && c.y - p.y > 1.4 && Math.round(s / 4) % 2 === 0) M.beam(base.clone().setY(p.y), c, .16, .16);
        if (Math.round(s / 4) % 3 === 0) light(c.clone().setY(c.y + .5));
        prev = c;
      }
      // stiffening girder
      for (let s = 0; s < L; s += 4) { const a = at(s), b = at(Math.min(L, s + 4)); M.beam(a.p.clone().addScaledVector(a.r, side * off).setY(a.p.y - .6), b.p.clone().addScaledVector(b.r, side * off).setY(b.p.y - .6), .7, 2.2); }
    }
    for (const t of [t0, t1]) {
      const { p, r, f } = at(t);
      for (const side of [-1, 1]) { const b = p.clone().addScaledVector(r, side * off); M.box(b.x, p.y - 2, b.z, 1.5, H + 3, 1.5, Math.atan2(f.x, f.z)); }
      M.beam(p.clone().addScaledVector(r, -off).setY(p.y + H), p.clone().addScaledVector(r, off).setY(p.y + H), 1.2, 1.4);
      M.beam(p.clone().addScaledVector(r, -off).setY(p.y + H * .55), p.clone().addScaledVector(r, off).setY(p.y + H * .55), .8, .9);
    }
  } else if (style === 'lenticular') {
    // Smithfield Street: two lens-shaped trusses, blue with cinnamon bracing, buff stone portals
    const [w0, w1] = waterSpan(city, path), mid = (w0 + w1) / 2, spans = [[w0, mid], [mid, w1]], off = width / 2 + .7;
    for (const [a, b] of spans) {
      const len = b - a, n = Math.max(6, Math.round(len / 7));
      for (const side of [-1, 1]) {
        let pt = null, pb = null;
        for (let k = 0; k <= n; k++) {
          const s = a + len * k / n, u = k / n, { p, r } = at(s), base = p.clone().addScaledVector(r, side * off);
          const top = base.clone().setY(p.y + 1 + 17 * Math.sin(Math.PI * u)), bot = base.clone().setY(p.y + 1 - 4.5 * Math.sin(Math.PI * u));
          M.color(S.color);
          if (pt) { M.beam(pt, top, .9, .9); M.beam(pb, bot, .7, .7); }
          if (k > 0 && k < n) { M.beam(bot, top, .4, .4); if (pt) { M.color(S.accent); M.beam(pb, top, .22, .22); } }
          if (k % 2 === 0) light(top.clone().setY(top.y + .6));
          pt = top; pb = bot;
        }
      }
      M.color(S.accent);
      for (let k = 1; k < n; k++) {
        const s = a + len * k / n, { p, r } = at(s), y = p.y + 1 + 17 * Math.sin(Math.PI * k / n);
        if (y - p.y > 7) M.beam(p.clone().addScaledVector(r, -off).setY(y), p.clone().addScaledVector(r, off).setY(y), .35, .35);
      }
    }
    M.color('#d6c6a0');
    for (const s of [w0, w1]) {
      const { p, r, f } = at(s);
      for (const side of [-1, 1]) { const b = p.clone().addScaledVector(r, side * (off + .4)); M.box(b.x, p.y - 1, b.z, 2.2, 10, 2.2, Math.atan2(f.x, f.z)); M.pyramid(b.x, p.y + 9, b.z, 1.4, 3.2, 1.4, Math.atan2(f.x, f.z)); }
      M.beam(p.clone().addScaledVector(r, -off).setY(p.y + 8.4), p.clone().addScaledVector(r, off).setY(p.y + 8.4), 1.1, 1.6);
    }
  } else if (style === 'arch-gold' || style === 'arch' || style === 'fortpitt') {
    // through arch (West End, Fort Duquesne) or Fort Pitt's double-deck tied arch
    const [w0, w1] = waterSpan(city, path), span = w1 - w0;
    const H = Math.min(58, Math.max(22, span * .19)), off = width / 2 + 1.5;
    const springDrop = style === 'fortpitt' ? 9 : 6;
    M.color(S.color);
    const archY = (u, y) => y - springDrop + (H + springDrop) * 4 * u * (1 - u);
    const n = Math.max(10, Math.round(span / 6));
    for (const side of [-1, 1]) {
      let prev = null;
      for (let k = 0; k <= n; k++) {
        const s = w0 + span * k / n, { p, r } = at(s), c = p.clone().addScaledVector(r, side * off).setY(archY(k / n, p.y));
        if (prev) M.beam(prev, c, 1.3, 2.6);
        if (k > 0 && k < n && c.y > p.y + 1.6) M.beam(p.clone().addScaledVector(r, side * off).setY(p.y), c, .22, .22);
        if (k % 2 === 0) light(c.clone().setY(c.y + 1.4));
        prev = c;
      }
    }
    for (let k = 1; k < n; k += 2) {
      const s = w0 + span * k / n, { p, r } = at(s), y = archY(k / n, p.y);
      if (y > p.y + 7.5) M.beam(p.clone().addScaledVector(r, -off).setY(y), p.clone().addScaledVector(r, off).setY(y), .6, .9);
    }
    if (style === 'fortpitt') deck(M, city, Array.from({ length: 12 }, (_, k) => { const p = at(w0 + span * k / 11).p; return { x: p.x, y: p.y - 9, z: p.z }; }), width, { slab: S.color });
  } else if (style === 'truss' || style === 'truss-dark') {
    const [w0, w1] = waterSpan(city, path), span = w1 - w0, n = Math.max(6, Math.round(span / 9)), off = width / 2 + .8;
    M.color(S.color);
    for (const side of [-1, 1]) {
      let pt = null, pb = null;
      for (let k = 0; k <= n; k++) {
        const s = w0 + span * k / n, { p, r } = at(s), b = p.clone().addScaledVector(r, side * off).setY(p.y - .2);
        const t = b.clone().setY(p.y + 8 + 4 * Math.sin(Math.PI * k / n));
        if (pt) { M.beam(pt, t, .8, .8); M.beam(pb, b, .8, .8); M.beam(k % 2 ? pb : b, k % 2 ? t : pt, .35, .35); }
        M.beam(b, t, .4, .4);
        pt = t; pb = b;
      }
    }
    for (let k = 1; k < n; k++) { const { p, r } = at(w0 + span * k / n), y = p.y + 8 + 4 * Math.sin(Math.PI * k / n); M.beam(p.clone().addScaledVector(r, -off).setY(y), p.clone().addScaledVector(r, off).setY(y), .35, .35); }
  } else if (style === 'suspension') {
    const L = path.length, t0 = L * .25, t1 = L * .75, H = 26, off = width / 2 + 1;
    M.color(S.color);
    for (const side of [-1, 1]) {
      let prev = null;
      for (let s = 0; s <= L + .01; s += 4) {
        const { p, r } = at(s), base = p.clone().addScaledVector(r, side * off);
        const y = s < t0 ? p.y + H * (s / t0) ** 1.5 : s > t1 ? p.y + H * ((L - s) / (L - t1)) ** 1.5 : p.y + 2 + (H - 2) * (2 * (s - t0) / (t1 - t0) - 1) ** 2;
        const c = base.clone().setY(y);
        if (prev) M.beam(prev, c, .45, .45);
        if (y > p.y + 1.3 && s > t0 && s < t1) M.beam(base.clone().setY(p.y), c, .1, .1);
        prev = c;
      }
    }
    for (const t of [t0, t1]) { const { p, r, f } = at(t); for (const side of [-1, 1]) { const b = p.clone().addScaledVector(r, side * off); M.box(b.x, p.y - 2, b.z, 1.3, H + 3, 1.3, Math.atan2(f.x, f.z)); } }
  }
}

/** buildBridges as a job ([F30]: js/world/toolbox/core/jobs.js). */
export function* buildBridgesJob(city) {
  const M = new MeshBuilder(), lights = [];
  const route = city.route, index = city.index;
  const routeNames = new Set();
  // 1. Bridges the route rides over (deck from the GPX itself)
  for (const b of city.landscape.routeBridges) {
    if (due()) yield;
    const pts = [];
    for (let s = b.fromM; s <= b.toM; s += 5) {
      const i = Math.min((route.turnIdx || route.dist.length - 1) - 1, Math.floor(s / 10)), f = (s - route.dist[i]) / 10;
      pts.push({ x: index.xs[i] + (index.xs[i + 1] - index.xs[i]) * f, y: route.ele[i] + (route.ele[i + 1] - route.ele[i]) * f, z: index.zs[i] + (index.zs[i + 1] - index.zs[i]) * f });
    }
    if (pts.length < 2) continue;
    const width = ROAD_WIDTH + 3;
    const path = deck(M, city, pts, width);
    const useStreet = (city.landscape.data.bridges || []).some((d) => d.name === b.name) && (city.route.scene?.bridgeFrames || {})[b.name] === 'street';
    if (b.style && b.style !== 'girder' && !useStreet) { superstructure(M, city, path, b.style, width, lights); routeNames.add(b.name); }
  }
  // 2. Every other bridge street (ramps, viaducts, the other river bridges): deck + piers
  yield* each(city.streets, (st, k) => { if (st.bridge && st.cls <= 7) deck(M, city, st.pts, st.width, { thick: st.cls <= 2 ? 2.2 : 1.6, noRail: st.underRoute, street: k }); });
  // 3. The famous ones get their structure
  for (const b of city.landscape.data.bridges || []) {
    if (due()) yield;
    if (routeNames.has(b.name)) continue;
    const pts = b.path.map(([qa, qo, y]) => { const p = city.D.local(qa, qo); return { x: p.x, y, z: p.z }; });
    if (pts.length < 2) continue;
    const path = makePath(resample(pts, 4));
    const width = b.style === 'fortpitt' || b.style === 'arch-gold' ? 17 : 12;
    superstructure(M, city, path, b.style, width, lights);
  }
  yield* M.keepOutOfJob(city.landscape.inRouteTube, { whole: true });   // decks, ramps and members the data puts in the rider's space (whole members: no cut stubs)
  const mesh = new THREE.Mesh(city.own(M.geometry()), city.solidMaterial);
  mesh.castShadow = mesh.receiveShadow = true; mesh.name = 'Bridges';
  city.group.add(mesh);
  city.addGlows(lights, 'Bridge lights');
  return mesh;
}

// ---------------------------------------------------------------- stadiums
/** A quad from p0 to p1 between heights y0 and y1, wound to face `out` (xz), pushed `push` m outward. */
function wallQuad(M, p0, p1, y0, y1, out, push = 0) {
  const A = V(p0.x + out.x * push, y0, p0.z + out.z * push), B = V(p1.x + out.x * push, y0, p1.z + out.z * push);
  const C = V(B.x, y1, B.z), D = V(A.x, y1, A.z);
  const n = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(D, A));
  if (n.x * out.x + n.z * out.z >= 0) M.quad(A, B, C, D); else M.quad(B, A, D, C);
}

/** [s1-stadium] One bay of a stadium's outer wall (a → b, facing `out`), `h` tall. */
function facade(M, a, b, out, ground, h, wall, i) {
  const lerp = (t) => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
  const base = wall.clone().multiplyScalar(.72), steel = new THREE.Color('#4a5560'), shade = new THREE.Color('#2e2a26'), cornice = wall.clone().lerp(new THREE.Color('#f1e6cf'), .45);
  const lo = Math.min(3, h * .2), mid = h > 14 ? h * .58 : h, top = Math.max(lo + 1, h - 1.1);
  M.color(base); wallQuad(M, a, b, ground, ground + lo, out);
  M.color(wall); wallQuad(M, a, b, ground + lo, ground + mid, out);
  if (mid < top) { M.color(steel); wallQuad(M, a, b, ground + mid, ground + top, out); }
  M.color(cornice); wallQuad(M, a, b, ground + top, ground + h, out, .35);
  { // the cornice's top, back to the wall
    const y = ground + h, A = V(a.x, y, a.z), B = V(b.x, y, b.z), C = V(b.x + out.x * .35, y, b.z + out.z * .35), D = V(a.x + out.x * .35, y, a.z + out.z * .35);
    if (new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(D, A)).y >= 0) M.quad(A, B, C, D); else M.quad(B, A, D, C);
  }
  // tall openings: a dark recess in the middle of the bay, a lit band of upper openings over it
  if (Math.hypot(b.x - a.x, b.z - a.z) > 6 && mid - lo > 5) {
    M.color(shade); wallQuad(M, lerp(.22), lerp(.78), ground + lo + .4, ground + lo + (mid - lo) * .62, out, .12);
    if (mid < top - 3) { M.color(steel.clone().multiplyScalar(.6)); wallQuad(M, lerp(.12), lerp(.88), ground + mid + 1.2, ground + top - 1.4, out, .12); }
  }
  // a pilaster at the bay's start
  if (mid - lo > 5) {
    const t = .045, p0 = lerp(0), p1 = lerp(t * 2);
    M.color(cornice.clone().multiplyScalar(.92)); wallQuad(M, p0, p1, ground + lo, ground + mid, out, .3);
  }
}

export function buildStadiums(city) {
  const M = new MeshBuilder(), lights = [];
  const shapes = city.route.scene?.stadiumShapes || {}, L = city.landscape;
  for (const st of city.landscape.data.stadiums || []) {
    let ring = st.ring.map(([a, o]) => city.D.local(a, o));
    // the map data can lose a stadium's outline (one point): the scene then gives its centre and size, and the
    // outline pulls in wherever it would touch the route or a street
    const sh = shapes[st.name];
    if (sh && (ring.length < 4 || sh.override)) {
      const c = city.D.proj.toLocal(sh.lat, sh.lon), yaw = (sh.yawDeg || 0) * Math.PI / 180, n = 40, pw = sh.power || 2;
      ring = Array.from({ length: n }, (_, k) => {
        const t = k / n * Math.PI * 2, cs = Math.cos(t), sn = Math.sin(t);
        const u = Math.sign(cs) * Math.abs(cs) ** (2 / pw) * sh.rx, v = Math.sign(sn) * Math.abs(sn) ** (2 / pw) * sh.rz;
        return { x: c.x + u * Math.cos(yaw) - v * Math.sin(yaw), z: c.z + u * Math.sin(yaw) + v * Math.cos(yaw) };
      });
      for (const p of ring) {
        for (let k = 0; k < 14; k++) {
          const r = L.routeDist(p.x, p.z), blocked = (r && r.d < ROAD_WIDTH / 2 + 10) || L.streetsNear(p.x, p.z, 3).some((o) => city.streets[o.k].cls < 7 && !city.streets[o.k].bridge) || L.waterAt(p.x, p.z) > .1;
          if (!blocked) break;
          p.x += (c.x - p.x) * .06; p.z += (c.z - p.z) * .06;
        }
      }
      // map footprints standing inside the bowl give way to it
      const inside = (x, z) => { let r = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], q = ring[j]; if ((a.z > z) !== (q.z > z) && x < ((q.x - a.x) * (z - a.z)) / (q.z - a.z) + a.x) r = !r; } return r; };
      for (const b of city.buildings) { if (Math.abs(b.bb[0] - c.x) > 300 || Math.abs(b.bb[2] - c.z) > 300) continue; const m = b.ring.reduce((acc, p) => ({ x: acc.x + p.x / b.ring.length, z: acc.z + p.z / b.ring.length }), { x: 0, z: 0 }); const inB = (x, z) => { let r = false; for (let i = 0, j = b.ring.length - 1; i < b.ring.length; j = i++) { const a = b.ring[i], q = b.ring[j]; if ((a.z > z) !== (q.z > z) && x < ((q.x - a.x) * (z - a.z)) / (q.z - a.z) + a.x) r = !r; } return r; };
        if (inside(m.x, m.z) || b.ring.some((q) => inside(q.x, q.z)) || ring.some((q) => inB(q.x, q.z))) b.hero = true; }
    }
    if (ring.length < 4) continue;
    (city.stadiumRings ||= []).push({ ring, bb: [Math.min(...ring.map((p) => p.x)), Math.max(...ring.map((p) => p.x)), Math.min(...ring.map((p) => p.z)), Math.max(...ring.map((p) => p.z))] });
    let cx = 0, cz = 0; for (const p of ring) { cx += p.x; cz += p.z; } cx /= ring.length; cz /= ring.length;
    let ground = Infinity; for (const p of ring) ground = Math.min(ground, city.landscape.baseHeight(p.x, p.z));
    // which way is the river? (PNC Park opens to the skyline)
    let best = -1, dir = V(0, 0, 1);
    for (let a = 0; a < 16; a++) {
      const d = V(Math.cos(a / 16 * Math.PI * 2), 0, Math.sin(a / 16 * Math.PI * 2));
      const w = city.landscape.waterAt(cx + d.x * 260, cz + d.z * 260);
      if (w > best) { best = w; dir = d; }
    }
    const H = st.heightM || 30, inner = ring.map((p) => ({ x: cx + (p.x - cx) * .6, z: cz + (p.z - cz) * .6 }));
    const seats = new THREE.Color(st.seats), wall = new THREE.Color(st.name.includes('PNC') ? '#b8946a' : '#77716a');
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length, a = ring[i], b = ring[j], ia = inner[i], ib = inner[j];
      const mx = (a.x + b.x) / 2 - cx, mz = (a.z + b.z) / 2 - cz, ml = Math.hypot(mx, mz) || 1;
      const open = st.open ? Math.max(0, (mx * dir.x + mz * dir.z) / ml) : 0;
      const h = H * (1 - .75 * Math.pow(open, 1.5));
      M.color(seats.clone().multiplyScalar(.85 + (i % 3) * .07));
      M.quad(V(ia.x, ground + 2.5, ia.z), V(a.x, ground + h, a.z), V(b.x, ground + h, b.z), V(ib.x, ground + 2.5, ib.z));
      // the upper deck's fascia: a dark band halfway up the bowl (two tiers of seats)
      if (h > 12) {
        const t = .52, lo = (P, Q) => V(P.x + (Q.x - P.x) * t, ground + 2.5 + (h - 2.5) * t, P.z + (Q.z - P.z) * t);
        const pa = lo(ia, a), pb = lo(ib, b);
        M.color('#2b2f35'); M.quad(pa, pb, pb.clone().setY(pb.y + 2.2), pa.clone().setY(pa.y + 2.2));
      }
      // the outer wall, facing out (the ring's winding varies with the data): a stone plinth, bays of tall
      // openings between pilasters, a darker steel upper level and a pale cornice, instead of one blank face
      facade(M, a, b, { x: mx / ml, z: mz / ml }, ground, h, wall, i);   // [s1-stadium]
      M.quad(V(ia.x, ground, ia.z), V(ia.x, ground + 2.5, ia.z), V(ib.x, ground + 2.5, ib.z), V(ib.x, ground, ib.z));
      if (i % Math.max(1, Math.floor(ring.length / 6)) === 0 && open < .6) {
        M.color('#55595d'); M.cylinder(a.x, ground + h, a.z, .5, 16, 6, .4);
        M.color('#e8e8e0'); M.box(a.x, ground + h + 16, a.z, 6, 3, 1.2, Math.atan2(mx, mz));
        lights.push({ x: a.x, y: ground + h + 17.5, z: a.z, size: 22, color: '#f4f6ff' });
      }
    }
    // a scoreboard at the open end, facing the field
    {
      let reach = 0; for (const p of ring) reach = Math.max(reach, (p.x - cx) * dir.x + (p.z - cz) * dir.z);
      const sx = cx + dir.x * reach * .92, sz = cz + dir.z * reach * .92, yaw = Math.atan2(dir.z, -dir.x);
      M.color('#3a3f45'); for (const u of [-8, 8]) M.box(sx + dir.z * u, ground, sz - dir.x * u, .8, 14, .8);
      M.color('#16191c'); M.box(sx, ground + 14, sz, 26, 10, 1.4, yaw);
      for (let k = -4; k <= 4; k++) lights.push({ x: sx + dir.z * k * 2.6 - dir.x * 1, y: ground + 19, z: sz - dir.x * k * 2.6 - dir.z * 1, size: 5, color: k % 2 ? '#ffd27a' : '#bfe3ff' });
    }
    // the field
    M.color('#4f8a3c');
    const tris = THREE.ShapeUtils.triangulateShape(inner.map((p) => new THREE.Vector2(p.x, p.z)), []);
    for (const [i, j, k] of tris) {
      const A = V(inner[i].x, ground + .35, inner[i].z), B = V(inner[j].x, ground + .35, inner[j].z), C = V(inner[k].x, ground + .35, inner[k].z);
      const n = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A));
      if (n.y > 0) M.triangle(A, B, C); else M.triangle(A, C, B);
    }
    if (st.name.includes('PNC')) {
      M.color('#a8764c');   // infield dirt
      const home = V(cx - dir.x * 40, ground + .4, cz - dir.z * 40);
      M.box(home.x + dir.x * 19, ground + .36, home.z + dir.z * 19, 27, .06, 27, Math.atan2(dir.x, dir.z) + Math.PI / 4);
      M.color('#54913f'); M.box(home.x + dir.x * 19, ground + .37, home.z + dir.z * 19, 20, .06, 20, Math.atan2(dir.x, dir.z) + Math.PI / 4);
    } else {
      M.color('#f2f2f2');
      for (let k = -5; k <= 5; k++) { const yaw = Math.atan2(dir.z, -dir.x); M.box(cx + Math.cos(yaw) * k * 9, ground + .37, cz - Math.sin(yaw) * k * 9, .4, .04, 48, yaw); }
    }
  }
  if (!M.count) return null;
  const mesh = new THREE.Mesh(city.own(M.geometry()), city.solidMaterial);
  mesh.castShadow = mesh.receiveShadow = true; mesh.name = 'Stadiums';
  city.group.add(mesh);
  city.addGlows(lights, 'Stadium lights');
  return mesh;
}

// ---------------------------------------------------------------- landmarks
const SHOPS = ['PIZZA', 'COFFEE', 'TATTOO', 'BOOKS', 'TACOS', 'DINER', 'BAR', 'VINYL', 'BIKES', 'BAKERY', 'NOODLES', 'THRIFT',
  'FLOWERS', 'PIEROGIES', 'LIVE MUSIC', 'HARDWARE', 'DELI', 'GALLERY', 'BBQ', 'BREWPUB', 'RAMEN', 'BARBER', 'ARCADE', 'DONUTS'];
const SIGN_COLORS = [['#1f3b57', '#ffd34d'], ['#7a1f24', '#fff3d6'], ['#14402e', '#9ef0c2'], ['#2a2a2a', '#ff5fa2'], ['#f2e6c9', '#7a2b16'],
  ['#0f2f4a', '#6fd3ff'], ['#3b2416', '#ffb347'], ['#262145', '#c7a0ff']];

export function buildLandmarks(city) {
  const out = { tick: null };
  const scene = city.route.scene || {};
  const D = city.D, L = city.landscape;
  const glows = [];
  // Aircraft beacons on the tall towers, the Gulf Tower's weather beacon.
  for (const b of city.buildings) {
    if (b.h < 60 && b.kind !== 10) continue;
    let cx = 0, cz = 0, g = Infinity; for (const p of b.ring) { cx += p.x; cz += p.z; g = Math.min(g, L.heightAt(p.x, p.z)); } cx /= b.ring.length; cz /= b.ring.length;
    if (b.kind === 10) out.gulf = { x: cx, y: g + b.h + 22, z: cz };
    else glows.push({ x: cx, y: g + b.h + (b.name === 'Fifth Avenue Place' || b.name === 'BNY Mellon Center' ? 30 : 5), z: cz, size: 5, color: '#ff3b2e' });
  }
  city.addGlows(glows, 'Aircraft beacons');
  if (out.gulf) {
    out.gulfGlow = city.addGlows([{ ...out.gulf, size: 16, color: '#4aa3ff' }], 'Gulf Tower beacon');
    out.gulfGlow && (out.gulfGlow.visible = true);
  }

  // Point State Park fountain: a basin and a 30 m jet.
  if (scene.fountain) {
    const p = D.proj.toLocal(scene.fountain.lat, scene.fountain.lon), r = scene.fountain.radiusM || 22;
    // [w2-polish] the basin sits level on its highest ground (water and coping clear the ground mesh inside and
    // round it); its outer wall reaches down to the lowest
    let y = -Infinity, low = Infinity;
    for (let k = 0; k < 48; k++) for (const f of [0, .35, .7, 1, 1.12]) { const a = k / 48 * Math.PI * 2, g = L.heightAt(p.x + Math.cos(a) * r * f, p.z + Math.sin(a) * r * f); y = Math.max(y, g); low = Math.min(low, g); }
    const M = new MeshBuilder();
    fountainBasin(M, p.x, y, p.z, r, { footY: low - .3 });   // [w2-polish] granite basin, coping, apron, centre pedestal and the jet's core
    const rim = new THREE.Mesh(city.own(M.geometry()), city.solidMaterial); rim.receiveShadow = true; city.group.add(rim);
    const pool = new THREE.Mesh(city.own(new THREE.CircleGeometry(r - .5, 48)), city.own(new THREE.MeshStandardMaterial({ color: '#4f8fa0', roughness: .15, metalness: .1, emissive: '#1b4f6e', emissiveIntensity: 0 })));
    pool.rotation.x = -Math.PI / 2; pool.position.set(p.x, y + .35, p.z); city.group.add(pool);
    out.poolMat = pool.material;
    const N = 2400, seeds = new Float32Array(N * 4);
    const fr = randomSequence(Math.floor(Math.abs(p.x * 7.31 + p.z * 3.17)) + 29);   // [review 27 Nov] seeded by its place (TOOLBOX rule 3)
    for (let i = 0; i < N; i++) seeds.set([fr(), fr(), fr(), fr()], i * 4);
    const g = city.own(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 4));
    g.boundingSphere = new THREE.Sphere(V(p.x, y + 15, p.z), 40);
    const mat = city.own(new THREE.ShaderMaterial({
      uniforms: { uTime: city.uniforms.uTime, uNight: city.night, uBase: { value: V(p.x, y + 1.9, p.z) } },   // [w2-polish] from the pedestal
      vertexShader: /* glsl */`
        attribute vec4 aSeed; uniform float uTime; uniform vec3 uBase; varying float vA;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main() {
          float t = fract(uTime * (.33 + aSeed.w * .08) + aSeed.x);
          float a = aSeed.y * 6.2832, spread = aSeed.z;
          float up = 34. * (.82 + .18 * aSeed.w);
          vec3 pos = uBase + vec3(cos(a) * spread * 9. * t, up * t * (1. - t) * 4. * (1. - spread * .35) + .5, sin(a) * spread * 9. * t);
          vA = (1. - t * .7) * (.55 + .45 * (1. - spread));
          vec4 mv = modelViewMatrix * vec4(pos, 1.);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(260. / -mv.z, 1.5, 22.);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */`
        uniform float uNight; varying float vA;
        #include <logdepthbuf_pars_fragment>
        void main() {
          #include <logdepthbuf_fragment>
          vec2 c = gl_PointCoord - .5; float r = dot(c, c) * 4.; if (r > 1.) discard;
          vec3 col = mix(vec3(.92, .96, 1.), vec3(.55, .8, 1.), uNight);
          gl_FragColor = vec4(col, vA * (1. - r) * .55);
        }`,
      transparent: true, depthWrite: false,
    }));
    const spray = new THREE.Points(g, mat); spray.name = 'Point State Park fountain'; spray.frustumCulled = true; city.group.add(spray);
    city.addGlows([{ x: p.x, y: y + 2, z: p.z, size: 30, color: '#8fd0ff' }], 'Fountain light');
  }

  // USS Requin: the submarine moored by the Science Center.
  const requinHero = (scene.heroes || []).some((h) => h.model === 'requin');   // [7.7] the heroes kit draws it
  for (const b of city.buildings) {
    if (b.kind !== 12 || requinHero) continue;
    let cx = 0, cz = 0; for (const p of b.ring) { cx += p.x; cz += p.z; } cx /= b.ring.length; cz /= b.ring.length;
    let len = 0, yaw = 0;
    for (const a of b.ring) for (const c of b.ring) { const d = Math.hypot(c.x - a.x, c.z - a.z); if (d > len) { len = d; yaw = Math.atan2(c.x - a.x, c.z - a.z); } }
    const M = new MeshBuilder(), y = L.level - 1.2, f = V(Math.sin(yaw), 0, Math.cos(yaw));
    M.color('#3d4246');
    const n = 16;
    for (let k = 0; k < n; k++) {
      const u0 = k / n - .5, u1 = (k + 1) / n - .5, r0 = 3.4 * Math.sqrt(1 - (2 * u0) ** 4), r1 = 3.4 * Math.sqrt(1 - (2 * u1) ** 4);
      M.beam(V(cx + f.x * u0 * len, y + 1, cz + f.z * u0 * len), V(cx + f.x * u1 * len, y + 1, cz + f.z * u1 * len), Math.max(.4, r0 + r1) * .9, Math.max(.4, r0 + r1) * .55);
    }
    M.color('#2f3438'); M.box(cx + f.x * len * .08, y + 2.6, cz + f.z * len * .08, 2.6, 5.5, 11, yaw);
    M.color('#8a8f92'); M.box(cx, y + 2.65, cz, 2.2, .15, len * .8, yaw);
    const sub = new THREE.Mesh(city.own(M.geometry()), city.solidMaterial); sub.castShadow = sub.receiveShadow = true; sub.name = 'USS Requin';
    city.group.add(sub);
  }

  // Storefront awnings and shop signs along the main street(s).
  const streets = scene.streetKit ? [] : scene.mainStreets || [];   // [street-kit] the kit dresses the shop fronts
  if (streets.length) {
    const cvs = document.createElement('canvas'); cvs.width = 1024; cvs.height = 512;
    const ctx = cvs.getContext('2d');
    SHOPS.forEach((name, k) => {
      const x = (k % 6) * 170.6, y = Math.floor(k / 6) * 128, [bg, fg] = SIGN_COLORS[k % SIGN_COLORS.length];
      ctx.fillStyle = bg; ctx.fillRect(x + 4, y + 18, 162, 92);
      ctx.strokeStyle = fg; ctx.lineWidth = 3; ctx.strokeRect(x + 10, y + 24, 150, 80);
      ctx.fillStyle = fg; ctx.font = `bold ${name.length > 8 ? 22 : 30}px Georgia, serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(name, x + 85, y + 64);
    });
    const tex = city.own(new THREE.CanvasTexture(cvs)); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const signMat = city.own(new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0, roughness: .7 }));
    out.signMat = signMat;
    const A = new MeshBuilder(), S = new MeshBuilder();
    const route = city.route, index = city.index;
    let shop = 0;
    for (const b of city.buildings) {
      if (b.kind !== 0 && b.kind !== 2) continue;
      for (let i = 0; i < b.ring.length; i++) {
        const a = b.ring[i], c = b.ring[(i + 1) % b.ring.length], len = Math.hypot(c.x - a.x, c.z - a.z);
        if (len < 4) continue;
        const mx = (a.x + c.x) / 2, mz = (a.z + c.z) / 2, road = index.nearest(mx, mz, 16);
        if (!road) continue;
        const s = route.dist[road.i > (route.turnIdx || 1e9) ? 2 * route.turnIdx - road.i : road.i];
        if (!streets.some((m) => s >= m.fromM && s <= m.toM)) continue;
        // outward normal facing the road
        let nx = (c.z - a.z) / len, nz = -(c.x - a.x) / len;
        if ((index.xs[road.i] - mx) * nx + (index.zs[road.i] - mz) * nz < 0) { nx = -nx; nz = -nz; }
        const g = L.heightAt(mx, mz), w = Math.min(len - 1, 7.5), tx = (c.x - a.x) / len, tz = (c.z - a.z) / len, k = hash(b.k * 31 + i);
        // awning: a sloped quad over the shop window
        const col = new THREE.Color(SIGN_COLORS[Math.floor(k * 8)][0]).lerp(new THREE.Color('#b33a3a'), k > .7 ? .6 : 0);
        A.color(col);
        const p0 = V(mx - tx * w / 2 + nx * .1, g + 3.3, mz - tz * w / 2 + nz * .1), p1 = V(mx + tx * w / 2 + nx * .1, g + 3.3, mz + tz * w / 2 + nz * .1);
        const p2 = p1.clone().add(V(nx * 1.4, -.7, nz * 1.4)), p3 = p0.clone().add(V(nx * 1.4, -.7, nz * 1.4));
        A.quad(p0, p1, p2, p3);
        // sign above the awning
        const cell = shop++ % SHOPS.length, u0 = (cell % 6) / 6 + .004, u1 = (cell % 6 + 1) / 6 - .004, v0 = 1 - (Math.floor(cell / 6) + 1) / 4 + .03, v1 = 1 - Math.floor(cell / 6) / 4 - .03;
        const sw = Math.min(w, 4.2), sx = mx + nx * .12, sz = mz + nz * .12;
        S.quad(V(sx - tx * sw / 2, g + 3.6, sz - tz * sw / 2), V(sx + tx * sw / 2, g + 3.6, sz + tz * sw / 2),
          V(sx + tx * sw / 2, g + 4.9, sz + tz * sw / 2), V(sx - tx * sw / 2, g + 4.9, sz - tz * sw / 2), [u1, v0, u0, v0, u0, v1, u1, v1]);
        break;
      }
    }
    if (A.count) {
      A.keepOutOf(city.landscape.inRouteTube); S.keepOutOf(city.landscape.inRouteTube);
      const am = new THREE.Mesh(city.own(A.geometry()), city.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, side: THREE.DoubleSide })));
      am.castShadow = am.receiveShadow = true; am.name = 'Awnings'; city.group.add(am);
      const sm = new THREE.Mesh(city.own(S.geometry()), signMat); sm.name = 'Shop signs'; city.group.add(sm);
    }
  }

  out.tick = (time) => {
    if (out.gulfGlow) {
      // the Gulf Tower's beacon: blue for fair weather, red for rain — here it slowly breathes
      const pulse = .75 + .25 * Math.sin(time * 1.3);
      const m = new THREE.Matrix4().compose(V(out.gulf.x, out.gulf.y, out.gulf.z), new THREE.Quaternion(), V(16 * pulse, 16 * pulse, 16 * pulse));
      out.gulfGlow.setMatrixAt(0, m); out.gulfGlow.instanceMatrix.needsUpdate = true;
    }
  };
  out.setNight = (v) => {
    if (out.signMat) out.signMat.emissiveIntensity = v * 1.3;
    if (out.poolMat) out.poolMat.emissiveIntensity = v * 1.5;
  };
  return out;
}
