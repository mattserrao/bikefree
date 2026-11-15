// Pittsburgh's bridges (each in its own structural style), the two stadiums on the North Shore,
// and the landmarks: Point State Park's fountain, USS Requin, storefronts on East Carson Street,
// aircraft beacons and the Gulf Tower's weather beacon.
import * as THREE from '../../vendor/three.module.min.js';
import { MeshBuilder, resample, makePath, hash } from './city-geometry.js';
import { ROAD_WIDTH } from './pose.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
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
    const cur = [c[0].clone().setY(p.y - .05), c[1].clone().setY(p.y - .05), c[1].clone().setY(p.y - thick), c[0].clone().setY(p.y - thick)];
    if (prev) {
      M.quad(prev[3], prev[2], cur[2], cur[3]);           // underside
      M.quad(prev[0], prev[3], cur[3], cur[0]);           // left face
      M.quad(prev[2], prev[1], cur[1], cur[2]);           // right face
    }
    prev = cur;
  }
  // railings
  M.color(opts.rail || '#5d6166');
  const rn = Math.max(1, Math.ceil(path.length / 12));
  for (const side of [-1, 1]) {
    for (let k = 0; k < rn; k++) {
      const a = at(k / rn * path.length), b = at((k + 1) / rn * path.length);
      const o = side * (width / 2 + .25);
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

export function buildBridges(city) {
  const M = new MeshBuilder(), lights = [];
  const route = city.route, index = city.index;
  const routeNames = new Set();
  // 1. Bridges the route rides over (deck from the GPX itself)
  for (const b of city.landscape.routeBridges) {
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
  for (const st of city.streets) if (st.bridge && st.cls <= 7) deck(M, city, st.pts, st.width, { thick: st.cls <= 2 ? 2.2 : 1.6 });
  // 3. The famous ones get their structure
  for (const b of city.landscape.data.bridges || []) {
    if (routeNames.has(b.name)) continue;
    const pts = b.path.map(([qa, qo, y]) => { const p = city.D.local(qa, qo); return { x: p.x, y, z: p.z }; });
    if (pts.length < 2) continue;
    const path = makePath(resample(pts, 4));
    const width = b.style === 'fortpitt' || b.style === 'arch-gold' ? 17 : 12;
    superstructure(M, city, path, b.style, width, lights);
  }
  const mesh = new THREE.Mesh(city.own(M.geometry()), city.solidMaterial);
  mesh.castShadow = mesh.receiveShadow = true; mesh.name = 'Bridges';
  city.group.add(mesh);
  city.addGlows(lights, 'Bridge lights');
  return mesh;
}

// ---------------------------------------------------------------- stadiums
export function buildStadiums(city) {
  const M = new MeshBuilder(), lights = [];
  for (const st of city.landscape.data.stadiums || []) {
    const ring = st.ring.map(([a, o]) => city.D.local(a, o));
    if (ring.length < 4) continue;
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
    const seats = new THREE.Color(st.seats), wall = new THREE.Color(st.name.includes('PNC') ? '#b8946a' : '#3a3a3a');
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length, a = ring[i], b = ring[j], ia = inner[i], ib = inner[j];
      const mx = (a.x + b.x) / 2 - cx, mz = (a.z + b.z) / 2 - cz, ml = Math.hypot(mx, mz) || 1;
      const open = st.open ? Math.max(0, (mx * dir.x + mz * dir.z) / ml) : 0;
      const h = H * (1 - .75 * Math.pow(open, 1.5));
      M.color(seats.clone().multiplyScalar(.85 + (i % 3) * .07));
      M.quad(V(ia.x, ground + 2.5, ia.z), V(a.x, ground + h, a.z), V(b.x, ground + h, b.z), V(ib.x, ground + 2.5, ib.z));
      M.color(wall);
      M.quad(V(b.x, ground, b.z), V(b.x, ground + h, b.z), V(a.x, ground + h, a.z), V(a.x, ground, a.z));
      M.quad(V(ia.x, ground, ia.z), V(ia.x, ground + 2.5, ia.z), V(ib.x, ground + 2.5, ib.z), V(ib.x, ground, ib.z));
      if (i % Math.max(1, Math.floor(ring.length / 6)) === 0 && open < .6) {
        M.color('#55595d'); M.cylinder(a.x, ground + h, a.z, .5, 16, 6, .4);
        M.color('#e8e8e0'); M.box(a.x, ground + h + 16, a.z, 6, 3, 1.2, Math.atan2(mx, mz));
        lights.push({ x: a.x, y: ground + h + 17.5, z: a.z, size: 22, color: '#f4f6ff' });
      }
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
    const p = D.proj.toLocal(scene.fountain.lat, scene.fountain.lon), y = L.heightAt(p.x, p.z);
    const M = new MeshBuilder(), r = scene.fountain.radiusM || 22;
    M.color('#c8c1b2'); for (let k = 0; k < 40; k++) { const a0 = k / 40 * Math.PI * 2, a1 = (k + 1) / 40 * Math.PI * 2; M.beam(V(p.x + Math.cos(a0) * r, y + .25, p.z + Math.sin(a0) * r), V(p.x + Math.cos(a1) * r, y + .25, p.z + Math.sin(a1) * r), 1.2, .7); }
    const rim = new THREE.Mesh(city.own(M.geometry()), city.solidMaterial); rim.receiveShadow = true; city.group.add(rim);
    const pool = new THREE.Mesh(city.own(new THREE.CircleGeometry(r - .5, 48)), city.own(new THREE.MeshStandardMaterial({ color: '#4f8fa0', roughness: .15, metalness: .1, emissive: '#1b4f6e', emissiveIntensity: 0 })));
    pool.rotation.x = -Math.PI / 2; pool.position.set(p.x, y + .35, p.z); city.group.add(pool);
    out.poolMat = pool.material;
    const N = 2400, seeds = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) seeds.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    const g = city.own(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 4));
    g.boundingSphere = new THREE.Sphere(V(p.x, y + 15, p.z), 40);
    const mat = city.own(new THREE.ShaderMaterial({
      uniforms: { uTime: city.uniforms.uTime, uNight: city.night, uBase: { value: V(p.x, y, p.z) } },
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
  for (const b of city.buildings) {
    if (b.kind !== 12) continue;
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
  const streets = scene.mainStreets || [];
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
