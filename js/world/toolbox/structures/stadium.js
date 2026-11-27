// Toolbox structures: the stadium kit (PLAN 7.8) — a ballpark or a football stadium at its real size and place, ridden
// through: a spiral escalator carries the rider up to the upper deck (a `carry` zone, js/gpx.js: no pedalling), the
// ride follows the upper-deck concourse with the view over the field, and a spiral ramp brings it down to the street.
// Game on: crowds in the stands, players on the field (baseball or football) with the figures kit, a scoreboard, and
// light towers that come on at dusk and night (the field lit).
//
// Data: the scene's `stadiumKit` (tools/build_stadiums.py from tools/city/pittsburgh-stadiums.json): per stadium its
// footprint `ring`, `field` frame, `sport`, `colors`, `rimEle` (the concourse height), its ride's `path` ("x y z u,…"
// in the kit's frame), `helices` (escalator and ramp: centre, radius, turns, heights) and `deckU` (the stretch off the
// ground, path metres). The deck the rider rides is drawn from the area's own line where the city data has it
// (`routeDecks`: the same curve and heights the rider follows), else from the kit's path (an area that only sees it).
// Every area whose grid holds the stadiums carries the kit, so the stadium doesn't change at an area swap — but only
// an area whose own line rides through a stadium (its `routeDecks` name it: the core both, the North Side's and the
// subway's aprons PNC Park) builds that stadium in full (the deck, escalator, crowd and players). Everywhere else it is
// a light far shell (PLAN 7.8b, phone memory): the bowl's silhouette, the field's colours, the boards and the light
// towers (lit at night), a plain slab where the deck runs; no crowd, players, railings or escalator. A shell's geometry
// is shared between the areas resident at once (a module cache by stadium and field level, released with the last).
//
// Lean cartoon style: vertex colours, merged meshes. Budget per stadium: ~10 draws, ~0.25 M triangles (mostly the
// crowd's far figures, drawn only within ~1.5 km; the near rows and the players only within ~300 m).
import * as THREE from '../../../../vendor/three.js';
import { MeshBuilder } from '../core/mesh-builder.js';
import { routePoint } from '../core/road-frame.js';
import { randomSequence } from '../core/random.js';
import { figureMaterial, staticCrowdMesh, randomLook, CLIP, Crowd, clipRate } from '../life/figures/people.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const DECK = { width: 7, lift: .1, slab: .7, rail: 1.15 };   // the ridden deck: as wide as a road, its top just under the rider's wheels
const R_ = 6371008.8 * DEG;

// ---------------------------------------------------------------- geometry helpers (pure)
const inPoly = (ring, x, z) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], c = ring[j];
    if ((a.z > z) !== (c.z > z) && x < ((c.x - a.x) * (z - a.z)) / (c.z - a.z) + a.x) inside = !inside;
  }
  return inside;
};
/** Distance along the ray (o + t·d) to the first crossing of a closed ring beyond tMin, or Infinity. */
function rayRing(ring, ox, oz, dx, dz, tMin = 0) {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], ex = b.x - a.x, ez = b.z - a.z;
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a.x - ox) * ez - (a.z - oz) * ex) / den, u = ((a.x - ox) * dz - (a.z - oz) * dx) / den;
    if (u >= 0 && u <= 1 && t > tMin && t < best) best = t;
  }
  return best;
}

/** The kit's frame (its `origin`, x east, z south) → this scene's local frame. */
function kitToLocal(kit, proj) {
  const o = kit.origin, kx = R_ * Math.cos(o.lat * DEG);
  const a = proj.toLocal(o.lat, o.lon), b = proj.toLocal(o.lat, o.lon + 100 / kx), c = proj.toLocal(o.lat - 100 / R_, o.lon);
  const ax = (b.x - a.x) / 100, az = (b.z - a.z) / 100, bx = (c.x - a.x) / 100, bz = (c.z - a.z) / 100;
  return (x, z) => ({ x: a.x + x * ax + z * bx, z: a.z + x * az + z * bz });
}

/**
 * The inner edge of the stands (the field and the ground round it), as a closed ring in the local frame, and a point
 * inside it the stands are laid out round. Baseball: the fair territory to the fence and the foul ground along the
 * lines and behind home. Football: the field and its sidelines, a rounded rectangle.
 */
function fieldPlan(st, L) {
  const f = st.field;
  if (st.sport === 'baseball') {
    const H = L(...f.home), c = L(f.home[0] + f.cf[0] * 100, f.home[1] + f.cf[1] * 100);
    const ux = (c.x - H.x) / 100, uz = (c.z - H.z) / 100, ul = Math.hypot(ux, uz);
    const u = { x: ux / ul, z: uz / ul };
    // v: toward the left-field side (left of the batter looking out); which side is which comes from the data's lf
    const vl = { x: u.z, z: -u.x }, side = f.lfSide ?? 1, v = { x: vl.x * side, z: vl.z * side };
    const P = (a, b) => ({ x: H.x + u.x * a + v.x * b, z: H.z + u.z * a + v.z * b });
    const dist = f.fenceM || [[0, 99], [22, 119], [45, 122], [68, 114], [90, 98]];   // from the left-field line (deg) to the right
    const D = (phi) => { for (let k = 1; k < dist.length; k++) if (phi <= dist[k][0]) { const t = (phi - dist[k - 1][0]) / (dist[k][0] - dist[k - 1][0]); return dist[k - 1][1] + (dist[k][1] - dist[k - 1][1]) * t; } return dist.at(-1)[1]; };
    const fence = [];
    for (let phi = 0; phi <= 90; phi += 3) { const a = (45 - phi) * DEG, d = D(phi); fence.push({ ...P(Math.cos(a) * d, Math.sin(a) * d), phi, d }); }
    const foul = f.foulM ?? 13, back = f.backstopM ?? 18, ring = [...fence.map((p) => ({ x: p.x, z: p.z }))];
    const s2 = Math.SQRT1_2;
    // down the right-field line on its foul side, round behind home, up the left-field line
    const rf = D(90), lf = D(0);
    ring.push(P(rf * s2 + foul * s2, -rf * s2 + foul * s2));
    for (let a = -135; a >= -225; a -= 7.5) ring.push(P(Math.cos(a * DEG) * back, Math.sin(a * DEG) * back));
    ring.push(P(lf * s2 + foul * s2, lf * s2 - foul * s2));
    return { ring, centre: P(50, 0), home: H, u, v, P, fence, D };
  }
  const C = L(...f.centre), A = L(f.centre[0] + f.axis[0] * 100, f.centre[1] + f.axis[1] * 100);
  const ax = (A.x - C.x) / 100, az = (A.z - C.z) / 100, al = Math.hypot(ax, az);
  const u = { x: ax / al, z: az / al }, v = { x: u.z, z: -u.x };
  const P = (a, b) => ({ x: C.x + u.x * a + v.x * b, z: C.z + u.z * a + v.z * b });
  const hl = f.lengthM / 2 + (f.endM ?? 12), hw = f.widthM / 2 + (f.sideM ?? 11), r = 14, ring = [];
  for (const [cx, cz, a0] of [[hl - r, hw - r, 0], [-(hl - r), hw - r, 90], [-(hl - r), -(hw - r), 180], [hl - r, -(hw - r), 270]])
    for (let a = a0; a <= a0 + 90; a += 10) ring.push(P(cx + Math.cos(a * DEG) * r, cz + Math.sin(a * DEG) * r));
  return { ring, centre: C, u, v, P };
}

// ---------------------------------------------------------------- the ride's deck
/** Points along the stadium's ridden deck in the local frame, ~0.5 m apart: [{x, y, z, s (line or path metres), tx, tz}]. */
function deckPoints(city, st, L) {
  const route = city.route, index = city.index;
  const own = (city.data.routeDecks || []).filter((d) => d.name === st.name);
  const out = [];
  if (own.length) {
    for (const d of own) for (let s = d.fromM; s <= d.toM + 1e-6; s += .5) { const p = routePoint(route, index, s); out.push({ x: p.x, y: p.y, z: p.z, s, own: true }); }
  } else {
    const pts = st.path.split(',').map((t) => t.split(' ').map(Number));
    const [u0, u1] = st.deckU;
    for (let k = 0; k < pts.length; k++) {
      const [x, y, z, u] = pts[k];
      if (u < u0 - 1 || u > u1 + 1) continue;
      const p = L(x, z); out.push({ x: p.x, y, z: p.z, s: u, own: false });
    }
  }
  for (let k = 0; k < out.length; k++) {
    const a = out[Math.max(0, k - 1)], b = out[Math.min(out.length - 1, k + 1)], l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    out[k].tx = (b.x - a.x) / l; out[k].tz = (b.z - a.z) / l;
  }
  return out;
}

/** A spatial hash of points for "is anything of the deck within r of (x, z)" (horizontal). */
function pointHash(pts, cell = 8) {
  const g = new Map(), key = (i, j) => i * 73856093 ^ j * 19349663;
  for (const p of pts) { const k = key(Math.floor(p.x / cell), Math.floor(p.z / cell)); (g.get(k) || g.set(k, []).get(k)).push(p); }
  return (x, z, r) => {
    const i0 = Math.floor((x - r) / cell), i1 = Math.floor((x + r) / cell), j0 = Math.floor((z - r) / cell), j1 = Math.floor((z + r) / cell);
    let best = null, bd = r;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const p of g.get(key(i, j)) || []) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p; } }
    return best;
  };
}

// ---------------------------------------------------------------- the build
/** Far shells built once for the areas resident together: key (stadium, field level) → { geos, glows, refs }. */
const SHELLS = new Map();
export const NEAR_M = 300, CROWD_FAR_M = 1500;   // the near rows and the players within NEAR_M of the stands; the crowd within CROWD_FAR_M

/** The stadiums this area's own line rides through (its `routeDecks`): those are built in full, the rest as far shells. */
function riddenStadiums(data) { return new Set((data?.routeDecks || []).map((d) => d.name)); }

export function buildStadiumKit(city) {
  const kit = city.route.scene?.stadiumKit;
  if (!kit?.stadiums?.length) return null;
  const L0 = kitToLocal(kit, city.D.proj), land = city.landscape;
  const out = { stadiums: [], tick: null, setNight: null };
  // (materials stay per area: a world's light bake patches them, and a module-level one would be patched again by
  // the next ride's world; only geometry is shared)
  const mats = {
    field: city.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95, metalness: 0, emissive: new THREE.Color('#000000') })),
    screen: city.own(new THREE.MeshBasicMaterial({ vertexColors: true, fog: true })),   // (a video board: its own light, day and night)
    figures: null,
  };
  const ridden = riddenStadiums(city.data), shells = [];
  const solid = city.solidMaterial, glows = [];
  for (const st of kit.stadiums) {
    const full = ridden.has(st.name);
    const L = L0, S = new MeshBuilder(), F = new MeshBuilder(), Sc = new MeshBuilder();
    const ring = st.ring.map(([x, z]) => L(x, z));
    const plan = fieldPlan(st, L);
    // the field's level: on its highest ground (the map's ground pokes through nothing)
    let gField = -Infinity, gMin = Infinity;
    for (let k = 0; k < plan.ring.length; k++) { const p = plan.ring[k], q = plan.centre; for (const t of [0, .5, 1]) { const g = land.heightAt(p.x + (q.x - p.x) * t, p.z + (q.z - p.z) * t); gField = Math.max(gField, g); gMin = Math.min(gMin, g); } }
    gField = Math.min(gField, gMin + 4) + .15;
    const rim = st.rimEle, col = st.colors || {};
    // the footprint is the stadium's: no map buildings, trees or lamps inside it
    (city.stadiumRings ||= []).push({ ring, bb: [Math.min(...ring.map((p) => p.x)), Math.max(...ring.map((p) => p.x)), Math.min(...ring.map((p) => p.z)), Math.max(...ring.map((p) => p.z))] });
    for (const b of city.buildings) {
      const c = b.ring.reduce((a, p) => ({ x: a.x + p.x / b.ring.length, z: a.z + p.z / b.ring.length }), { x: 0, z: 0 });
      if (inPoly(ring, c.x, c.z)) b.hero = true;
    }
    const add = (B, mat, name, shadow = true, geo = null) => { if (!geo && !B.count) return null; const m = new THREE.Mesh(geo || city.own(B.geometry()), mat); m.name = name; m.castShadow = shadow; m.receiveShadow = true; city.group.add(m); return m; };
    if (!full) {
      // a far shell: shared with the other areas resident that see it from the same field level
      const key = `${st.name}|${Math.round(gField * 2)}`;
      let sh = SHELLS.get(key);
      if (!sh) {
        const deck = deckPoints(city, st, L), nearDeck = pointHash(deck);
        const helices = (st.helices || []).map((h) => ({ ...h, c: L(h.x, h.z) }));
        const stand = buildStands(S, st, plan, ring, gField, rim, nearDeck, helices, col, land, SHELL_STANDS);
        buildFieldShell(F, st, plan, gField, col);
        buildDeckShell(S, deck, col);
        for (const h of helices) buildDrum(S, h, land, col);
        buildBoards(S, Sc, st, plan, gField, rim, col);
        const g = [];
        const towers = buildLights(S, stand, st, g);
        sh = { geos: [S.count ? S.geometry() : null, F.count ? F.geometry() : null, Sc.count ? Sc.geometry() : null], glows: g, towers, refs: 0 };
        SHELLS.set(key, sh);
      }
      sh.refs++; shells.push(key);
      add(null, solid, `${st.name} (far)`, true, sh.geos[0]);
      add(null, mats.field, `${st.name} field (far)`, false, sh.geos[1]);
      add(null, mats.screen, `${st.name} scoreboard (far)`, false, sh.geos[2]);
      glows.push(...sh.glows);
      out.stadiums.push({ name: st.name, full: false, plan, gField, towers: sh.towers, game: null, fans: 0 });
      continue;
    }
    mats.figures ||= city.own(figureMaterial(city.uniforms.uTime));
    const deck = deckPoints(city, st, L);
    const nearDeck = pointHash(deck);
    const helices = (st.helices || []).map((h) => ({ ...h, c: L(h.x, h.z) }));
    const stand = buildStands(S, st, plan, ring, gField, rim, nearDeck, helices, col, land);
    buildField(F, st, plan, gField, col);
    buildDeck(S, deck, st, helices, ring, land, col, city.data.routeConveyors);
    // the whole ride's path (its ground ends too): the ramp's colonnade keeps clear of where it runs past (PLAN 7.8 clipping QC:
    // the rider and the chase camera leaving or entering the ramp the other way round passed through a column)
    const nearPath = pointHash(st.path.split(',').map((t) => { const [x, y, z] = t.split(' ').map(Number); return { ...L(x, z), y }; }));
    for (const h of helices) buildHelix(S, h, st, land, col, glows, nearPath);
    buildBoards(S, Sc, st, plan, gField, rim, col);
    const towers = buildLights(S, stand, st, glows);
    add(S, solid, `${st.name}`);
    add(F, mats.field, `${st.name} field`, false);
    add(Sc, mats.screen, `${st.name} scoreboard`, false);
    // the crowd: still figures in the stands (the near rows by the concourse in more detail), cheering now and then
    const fans = crowdIn(stand, st, nearDeck), crowd = {};
    for (const [list, lod, nm, k] of [[fans.far, 'far', 'crowd', 'far'], [fans.near, 'lo', 'crowd (near the concourse)', 'near']]) {
      if (!list.length) continue;
      const im = staticCrowdMesh(list, mats.figures, `${st.name} ${nm}`, lod); im.castShadow = false; city.group.add(im); city.own(im.geometry);
      crowd[k] = im;
    }
    const game = new Game(city, st, plan, gField, mats.figures);
    let rad = 0; for (const p of ring) rad = Math.max(rad, Math.hypot(p.x - plan.centre.x, p.z - plan.centre.z));
    out.stadiums.push({ name: st.name, full: true, plan, gField, stand, deck, helices, towers, game, crowd, rad, fans: fans.far.length + fans.near.length });
  }
  out.lights = city.addGlows(glows, 'Stadium lights');
  out.tick = (time, dt, camera) => {
    const c = camera.position || camera;
    for (const s of out.stadiums) {
      if (!s.game) continue;
      // near/far detail: the near rows and the players within NEAR_M of the stands, the crowd within CROWD_FAR_M
      const d = Math.max(0, Math.hypot(c.x - s.plan.centre.x, c.z - s.plan.centre.z) - s.rad), near = d < NEAR_M;
      if (s.crowd.near) s.crowd.near.visible = near;
      if (s.crowd.far) s.crowd.far.visible = d < CROWD_FAR_M;
      s.game.setVisible(near);
      if (near) s.game.tick(time, dt, camera);
    }
  };
  out.setNight = (v) => {
    // the floodlights: the field brightens at night
    mats.field.emissive.setRGB(.16 * v, .2 * v, .14 * v);
  };
  out.dispose = () => {
    for (const s of out.stadiums) s.game?.dispose();
    for (const key of shells.splice(0)) { const sh = SHELLS.get(key); if (sh && --sh.refs <= 0) { for (const g of sh.geos) g?.dispose(); SHELLS.delete(key); } }
  };
  return out;
}


// ---------------------------------------------------------------- the stands
/**
 * The seating bowl, laid out on rays from inside the field: each ray runs from the stands' inner edge (the field plan)
 * out to the first of the footprint, the ridden deck (the stands stop at its inner rail) or a helix. A ray's profile
 * is its sector's: two tiers to the concourse round the infield (football: both sides and the closed end), one low
 * tier along the outfield and the open end, none in centre field (the view out).
 */
const FULL_STANDS = { rays: 240, rows: 18, treads: true, arches: 3, rail: true };
const SHELL_STANDS = { rays: 96, rows: 4, treads: false, arches: 0, rail: false };   // (a far shell: the bowl's silhouette)
function buildStands(B, st, plan, ring, g0, rim, nearDeck, helices, col, land, opt = FULL_STANDS) {
  const rays = [], N = opt.rays, C = plan.centre, baseball = st.sport === 'baseball';
  const seat = new THREE.Color(col.seats || '#2a4d8f'), upper = new THREE.Color(col.upper || col.seats || '#2a4d8f');
  const stone = new THREE.Color(col.stone || '#a89a86'), steel = new THREE.Color(col.steel || '#3a3d42');
  for (let k = 0; k < N; k++) {
    const a = k / N * TAU, dx = Math.cos(a), dz = Math.sin(a);
    const t0 = rayRing(plan.ring, C.x, C.z, dx, dz, 1);
    let t1 = rayRing(ring, C.x, C.z, dx, dz, t0 + .5);
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) { rays.push(null); continue; }
    // the stands stop at the deck's inner rail or a helix's outer edge, whichever comes first
    let stopAt = null;
    for (let t = t0 + 2; t < t1; t += .75) {
      const x = C.x + dx * t, z = C.z + dz * t, d = nearDeck(x, z, DECK.width / 2 + 1.4);
      if (d) { stopAt = { t, deckY: d.y }; break; }
      if (helices.some((h) => Math.hypot(x - h.c.x, z - h.c.z) < h.R + DECK.width / 2 + 2)) { stopAt = { t, deckY: null }; break; }
    }
    if (stopAt) t1 = stopAt.t;
    const inner = { x: C.x + dx * t0, z: C.z + dz * t0 }, outer = { x: C.x + dx * t1, z: C.z + dz * t1 };
    // its sector: how high the stand rises here
    let kind = 'full', top = rim - .4;
    if (baseball) {
      const { u, v, home } = plan, px = inner.x - home.x, pz = inner.z - home.z, along = px * u.x + pz * u.z, side = px * v.x + pz * v.z;
      const phi = 45 - Math.atan2(side, along) / DEG;   // 0 on the left-field line … 90 on the right
      const fair = phi > -2 && phi < 92 && Math.hypot(px, pz) > 60;
      const lineDist = Math.max(Math.abs(along + side), Math.abs(along - side)) / Math.SQRT2;   // how far out along the nearer line
      if (fair) kind = phi < 38 ? 'bleachers' : phi > 64 ? 'rf' : 'open';
      else if (lineDist > 92) kind = 'low';
      else if (lineDist > 70) kind = 'step';
    } else {
      const px = inner.x - C.x, pz = inner.z - C.z, along = (px * plan.u.x + pz * plan.u.z) / Math.hypot(px, pz);
      if (along > .62) kind = 'low';   // the open end (Acrisure's toward the river and the Point)
    }
    if (stopAt?.deckY != null) { kind = 'full'; top = stopAt.deckY + DECK.lift - .05; }
    const H = { full: top - g0, step: Math.min(top - g0, 19), low: 12, bleachers: 9, rf: 8, open: 0 }[kind];
    const depth = { bleachers: 24, rf: 16 }[kind];
    if (depth) t1 = Math.min(t1, t0 + depth);
    rays.push({ a, dx, dz, t0, t1, inner, outer: { x: C.x + dx * t1, z: C.z + dz * t1 }, kind, H, top: g0 + H, stop: !!stopAt });
  }
  // profiles (fraction of the depth → fraction of the height): two tiers with a club-level fascia, or one tier
  const TWO = [[0, 0], [.08, .04], [.46, .38], [.5, .4], [.52, .6], [.56, .63], [1, 1]];
  const ONE = [[0, 0], [.1, .08], [1, 1]];
  const prof = (r) => (r.kind === 'full' || r.kind === 'step' ? TWO : ONE);
  const at = (r, f) => { const P = prof(r); for (let k = 1; k < P.length; k++) if (f <= P[k][0] + 1e-9) { const t = (f - P[k - 1][0]) / (P[k][0] - P[k - 1][0] || 1); return P[k - 1][1] + (P[k][1] - P[k - 1][1]) * t; } return 1; };
  const pt = (r, f) => { const t = r.t0 + (r.t1 - r.t0) * f; return V(r.inner.x + r.dx * (t - r.t0), g0 + .6 + (r.H - .6) * at(r, f), r.inner.z + r.dz * (t - r.t0)); };
  const ROWS = opt.rows, fs = Array.from({ length: ROWS + 1 }, (_, k) => k / ROWS);
  for (let k = 0; k < N; k++) {
    const a = rays[k], b = rays[(k + 1) % N];
    if (!a || !b || a.kind === 'open' || b.kind === 'open' || !a.H || !b.H) continue;
    const same = prof(a) === prof(b);
    const F = same ? [...new Set([...fs, ...prof(a).map((p) => p[0])])].sort((x, y) => x - y) : fs;
    for (let j = 0; j < F.length - 1; j++) {
      const f0 = F[j], f1 = F[j + 1], mid = (f0 + f1) / 2;
      const fascia = same && prof(a) === TWO && mid > .5 && mid < .56;
      const c = fascia ? steel.clone().multiplyScalar(.75) : (mid > .52 ? upper : seat).clone().multiplyScalar(.82 + (j % 2) * .12 + ((k >> 1) % 3) * .02);
      if (!fascia && Math.floor(k * 240 / N) % 24 < 2) c.multiplyScalar(.7);   // an aisle
      B.color(c);
      const A0 = pt(a, f0), A1 = pt(a, f1), B0 = pt(b, f0), B1 = pt(b, f1);
      // treads: each row a riser and a flat step (the seats read as rows); a shell is one slope per band
      if (opt.treads) { const Am = A1.clone().setY(A0.y), Bm = B1.clone().setY(B0.y); B.quad(A0, B0, Bm, Am); B.quad(Am, Bm, B1, A1); } else B.quad(A0, B0, B1, A1);
    }
    // the back of the stand: the outer wall down to the ground (arches below the concourse, a cornice)
    const ta = pt(a, 1), tb = pt(b, 1);
    const ga = Math.min(g0, land.heightAt(ta.x, ta.z)) - 1, gb = Math.min(g0, land.heightAt(tb.x, tb.z)) - 1;
    B.color(stone);
    B.quad(V(tb.x, gb, tb.z), V(ta.x, ga, ta.z), V(ta.x, ta.y, ta.z), V(tb.x, tb.y, tb.z));
    B.quad(V(ta.x, ga, ta.z), V(tb.x, gb, tb.z), V(tb.x, tb.y, tb.z), V(ta.x, ta.y, ta.z));
    if (opt.arches && k % opt.arches === 0 && Math.min(ta.y, tb.y) - g0 > 9) {   // an arched opening on the street side
      const m = V((ta.x + tb.x) / 2 + a.dx * .25, 0, (ta.z + tb.z) / 2 + a.dz * .25);
      B.color(stone.clone().multiplyScalar(.45)); B.box(m.x, g0, m.z, .2, 6.5, Math.hypot(tb.x - ta.x, tb.z - ta.z) * .8, Math.atan2(tb.x - ta.x, tb.z - ta.z));
    }
    // the front: a padded wall at the field
    const ia = pt(a, 0), ib = pt(b, 0);
    B.color(col.wall || '#24543a'); B.quad(V(ia.x, g0 - .2, ia.z), V(ib.x, g0 - .2, ib.z), V(ib.x, ia.y + .9, ib.z), V(ia.x, ia.y + .9, ia.z));
    // a rail along the stand's top where it doesn't meet the deck
    if (opt.rail && !a.stop && !b.stop) { B.color(steel); B.beam(V(ta.x, ta.y + 1.05, ta.z), V(tb.x, tb.y + 1.05, tb.z), .08, .08); }
  }
  return { rays, pt, g0 };
}

// ---------------------------------------------------------------- the field
function buildField(B, st, plan, g0, col) {
  const y = g0 + .02;
  const flat = (ring, color, dy = 0) => {
    B.color(color);
    const tris = THREE.ShapeUtils.triangulateShape(ring.map((p) => new THREE.Vector2(p.x, p.z)), []);
    for (const [i, j, k] of tris) {
      const A = V(ring[i].x, y + dy, ring[i].z), Bv = V(ring[j].x, y + dy, ring[j].z), C = V(ring[k].x, y + dy, ring[k].z);
      const n = new THREE.Vector3().subVectors(Bv, A).cross(new THREE.Vector3().subVectors(C, A));
      if (n.y > 0) B.triangle(A, Bv, C); else B.triangle(A, C, Bv);
    }
  };
  const grass = new THREE.Color('#4f8f3a'), grass2 = new THREE.Color('#5c9c45');
  if (st.sport === 'baseball') {
    const { P, D } = plan;
    // mown stripes across the outfield: bands of fair ground between arcs round home
    flat(plan.ring, grass, 0);
    for (let r = 30; r < 125; r += 12) {
      const band = [];
      for (let phi = -1; phi <= 91; phi += 3) { const a = (45 - phi) * DEG, d = Math.min(r, D(Math.max(0, Math.min(90, phi))) - .5); band.push(P(Math.cos(a) * d, Math.sin(a) * d)); }
      for (let phi = 91; phi >= -1; phi -= 3) { const a = (45 - phi) * DEG, d = Math.min(r + 6, D(Math.max(0, Math.min(90, phi))) - .5); band.push(P(Math.cos(a) * d, Math.sin(a) * d)); }
      flat(band, grass2, .01);
    }
    // the infield: the dirt arc (29 m round the rubber), the grass diamond, the mound, home's circle, the base paths
    const dirt = new THREE.Color('#b0764a'), arc = [P(0, 0)];
    for (let phi = -6; phi <= 96; phi += 4) { const a = (45 - phi) * DEG; arc.push(P(18.4 + Math.cos(a) * 29 - 0, Math.sin(a) * 29)); }
    flat(arc.map((p, k) => (k ? p : P(-1.5, 0))), dirt, .02);
    const s = 27.43, d = s * Math.SQRT1_2;
    flat([P(1.5, 0), P(d - 1, d - 2.4), P(2 * d - 2.4, 0), P(d - 1, -(d - 2.4))], grass, .03);
    const disc = (cu, cv, r, color, dy) => { const pts = []; for (let k = 0; k < 16; k++) pts.push(P(cu + Math.cos(k / 16 * TAU) * r, cv + Math.sin(k / 16 * TAU) * r)); flat(pts, color, dy); };
    disc(18.4, 0, 2.7, dirt, .04); disc(0, 0, 4, dirt, .04);
    B.color('#f4f1e8');
    for (const [a, b] of [[0, 1], [0, -1]]) { const e = P(D(b > 0 ? 0 : 90) * Math.SQRT1_2, b * D(b > 0 ? 0 : 90) * Math.SQRT1_2), h = P(0, 0); B.beam(V(h.x, y + .06, h.z), V(e.x, y + .06, e.z), .12, .02); }
    for (const [bu, bv] of [[d, d], [2 * d, 0], [d, -d], [0, 0]]) { const p = P(bu, bv); B.box(p.x, y + .05, p.z, .45, .06, .45, 0); }
    // the warning track along the fence and the foul poles (yellow)
    const track = [];
    for (let phi = 0; phi <= 90; phi += 3) { const a = (45 - phi) * DEG, dd = D(phi); track.push(P(Math.cos(a) * dd, Math.sin(a) * dd)); }
    for (let phi = 90; phi >= 0; phi -= 3) { const a = (45 - phi) * DEG, dd = D(phi) - 4.5; track.push(P(Math.cos(a) * dd, Math.sin(a) * dd)); }
    flat(track, '#9a6a45', .02);
    B.color('#f2c230');
    for (const phi of [0, 90]) { const a = (45 - phi) * DEG, dd = D(phi); const p = P(Math.cos(a) * dd, Math.sin(a) * dd); B.cylinder(p.x, y, p.z, .3, 24, 6); }
    // the fence: green padding, the right-field wall taller (the Clemente Wall)
    for (let phi = 0; phi < 90; phi += 3) {
      const a0 = (45 - phi) * DEG, a1 = (45 - phi - 3) * DEG, p0 = P(Math.cos(a0) * D(phi), Math.sin(a0) * D(phi)), p1 = P(Math.cos(a1) * D(phi + 3), Math.sin(a1) * D(phi + 3));
      const h = phi >= 64 ? 6.4 : 3.2;
      B.color(phi >= 38 && phi < 64 ? '#2d5a34' : '#245a3a');
      B.quad(V(p0.x, y, p0.z), V(p1.x, y, p1.z), V(p1.x, y + h, p1.z), V(p0.x, y + h, p0.z));
      B.quad(V(p1.x, y, p1.z), V(p0.x, y, p0.z), V(p0.x, y + h, p0.z), V(p1.x, y + h, p1.z));
      B.color('#f2c230'); B.beam(V(p0.x, y + h, p0.z), V(p1.x, y + h, p1.z), .25, .18);
    }
    return;
  }
  // football: the field, yard lines every 5 yards, end zones in the home colours, the sideline ground
  const { P } = plan, f = st.field, hl = f.lengthM / 2, hw = f.widthM / 2;
  flat(plan.ring, '#3f7d35', 0);
  for (let k = -10; k < 10; k++) {
    const a = k * 4.572 - 10 * 4.572 + 45.72;   // (a 100-yard field, its ten-yard bands)
    if (Math.abs(a) > 45.72 || Math.abs(a + 4.572) > 45.72 + 1e-6) continue;
    flat([P(a, -hw), P(a + 4.572, -hw), P(a + 4.572, hw), P(a, hw)], k % 2 ? grass : grass2, .01);
  }
  B.color('#f4f4ef');
  for (let k = 0; k <= 20; k++) { const a = -45.72 + k * 4.572, p = P(a, -hw), q = P(a, hw); B.beam(V(p.x, y + .05, p.z), V(q.x, y + .05, q.z), .14, .02); }
  for (const s of [-1, 1]) { const p = P(-hl, s * hw), q = P(hl, s * hw); B.beam(V(p.x, y + .05, p.z), V(q.x, y + .05, q.z), .16, .02); }
  const ez = (a0, a1, c) => flat([P(a0, -hw), P(a1, -hw), P(a1, hw), P(a0, hw)], c, .02);
  ez(-hl, -45.72, col.endzone || '#1b1b1b'); ez(45.72, hl, col.endzone2 || '#f2b81c');
  // goal posts (yellow)
  B.color('#f2c230');
  for (const s of [-1, 1]) {
    const c = P(s * (hl + .2), 0), l = P(s * (hl + .2), -2.82), r = P(s * (hl + .2), 2.82);
    B.cylinder(c.x, y, c.z, .15, 3.05, 6); B.beam(V(l.x, y + 3.05, l.z), V(r.x, y + 3.05, r.z), .15, .15);
    B.cylinder(l.x, y + 3.05, l.z, .08, 9, 5); B.cylinder(r.x, y + 3.05, r.z, .08, 9, 5);
  }
}

// ---------------------------------------------------------------- the ridden deck
/**
 * The deck along the ride: a slab as wide as a road, its top just under the rider's wheels, railings both sides
 * (the escalator's balustrades and moving treads where it's carried), columns down to the ground where it's out of
 * the stands. Built from the same points the rider rides.
 */
function buildDeck(B, deck, st, helices, ring, land, col, convs) {
  if (deck.length < 2) return;
  const w = DECK.width / 2, esc = helices.filter((h) => h.role === 'escalator');
  const onEsc = (p) => esc.some((h) => (p.own ? false : p.s >= h.u0 && p.s <= h.u1) || (p.own && h._s && p.s >= h._s[0] && p.s <= h._s[1]));
  // (the escalator's stretch on the area's own line: the city data's conveyor of that name, line metres)
  // (an apron's copy carries the neighbour's conveyor too, F355; without one, the deck's start is the escalator's foot, so its length on from there)
  const own0 = deck.find((p) => p.own)?.s;
  for (const h of esc) { const c = (convs || []).find((q) => q.name === h.name); h._s = c ? [c.fromM, c.toM] : own0 != null ? [own0 + h.u0 - st.deckU[0], own0 + h.u1 - st.deckU[0]] : null; }
  const concrete = new THREE.Color(col.deck || '#b9b3a8'), tread = new THREE.Color('#3b3f45'), tread2 = new THREE.Color('#4a4f56'), edge = new THREE.Color('#f2c230');
  const steel = new THREE.Color(col.steel || '#3a3d42'), glass = new THREE.Color('#9fc4cf');
  let lastCol = -1e9;
  for (let k = 0; k < deck.length - 1; k++) {
    const a = deck[k], b = deck[k + 1];
    const ra = { x: -a.tz, z: a.tx }, rb = { x: -b.tz, z: b.tx };
    const ya = a.y + DECK.lift, yb = b.y + DECK.lift;
    const e = onEsc(a) && onEsc(b);
    const L = (p, r, s, y) => V(p.x + r.x * s, y, p.z + r.z * s);
    // the top
    B.color(e ? (k % 2 ? tread : tread2) : concrete.clone().multiplyScalar(.96 + (k % 8 === 0 ? -.06 : 0)));
    B.quad(L(a, ra, w, ya), L(b, rb, w, yb), L(b, rb, -w, yb), L(a, ra, -w, ya));   // (wound to face up)
    if (e) { B.color(edge); for (const s of [-1, 1]) B.quad(L(a, ra, s * (w - .35) + .12, ya + .01), L(b, rb, s * (w - .35) + .12, yb + .01), L(b, rb, s * (w - .35) - .12, yb + .01), L(a, ra, s * (w - .35) - .12, ya + .01)); }
    // the slab's edges and underside
    B.color(concrete.clone().multiplyScalar(.72));
    for (const s of [-1, 1]) {
      const A = L(a, ra, s * w, ya), Bv = L(b, rb, s * w, yb), A2 = L(a, ra, s * w, ya - DECK.slab), B2 = L(b, rb, s * w, yb - DECK.slab);
      if (s > 0) B.quad(A2, B2, Bv, A); else B.quad(B2, A2, A, Bv);
    }
    B.quad(L(a, ra, -w, ya - DECK.slab), L(b, rb, -w, yb - DECK.slab), L(b, rb, w, yb - DECK.slab), L(a, ra, w, ya - DECK.slab));   // (the underside, facing down)
    // railings (every 2 m: four of the deck's 0.5 m steps — PLAN 7.8b, a quarter of the beams; the top stays at
    // 0.5 m, the surface the rider rides): a balustrade on the escalator (glass panels), posts and a top rail elsewhere
    if (k % RAIL_STEP === 0) {
      const kb = Math.min(deck.length - 1, k + RAIL_STEP), b2 = deck[kb], rb2 = { x: -b2.tz, z: b2.tx }, yb2 = b2.y + DECK.lift;
      for (const s of [-1, 1]) {
        const A = L(a, ra, s * (w - .1), ya), Bv = L(b2, rb2, s * (w - .1), yb2);
        if (e) {
          B.color(glass); B.quad(s > 0 ? A : Bv, s > 0 ? Bv : A, (s > 0 ? Bv : A).clone().setY((s > 0 ? yb2 : ya) + 1), (s > 0 ? A : Bv).clone().setY((s > 0 ? ya : yb2) + 1));
          B.color('#1d1f22'); B.beam(A.clone().setY(ya + 1.02), Bv.clone().setY(yb2 + 1.02), .1, .08);
        } else {
          B.color(steel); B.beam(A.clone().setY(ya + DECK.rail), Bv.clone().setY(yb2 + DECK.rail), .07, .07);
          B.beam(A.clone().setY(ya + .55), Bv.clone().setY(yb2 + .55), .04, .04);
          B.beam(A.clone().setY(ya), A.clone().setY(ya + DECK.rail), .07, .07);
        }
      }
    }
    // columns down to the ground where the deck is high and not over the stands or in a helix
    const along = Math.hypot(a.x - (deck[0].x), a.z - deck[0].z);
    if (k - lastCol > 22 && a.y - land.heightAt(a.x, a.z) > 3.5 && !inPoly(ring, a.x, a.z) && !helices.some((h) => Math.hypot(a.x - h.c.x, a.z - h.c.z) < h.R + w + 1)) {
      lastCol = k;
      const g = land.heightAt(a.x, a.z) - .5;
      B.color(concrete.clone().multiplyScalar(.82));
      for (const s of [-1, 1]) B.box(a.x + ra.x * s * (w - .6), g, a.z + ra.z * s * (w - .6), .7, a.y - DECK.slab - g + DECK.lift, .7, Math.atan2(a.tx, a.tz));
    }
    void along;
  }
}

const RAIL_STEP = 4;

/** A far shell's deck: a plain slab along the kit's path every ~4 m (top and underside), no railings or treads. */
function buildDeckShell(B, deck, col) {
  if (deck.length < 2) return;
  const w = DECK.width / 2, concrete = new THREE.Color(col.deck || '#b9b3a8');
  const pts = [deck[0]];
  for (const p of deck) if (Math.hypot(p.x - pts.at(-1).x, p.z - pts.at(-1).z) >= 4) pts.push(p);
  if (pts.at(-1) !== deck.at(-1)) pts.push(deck.at(-1));
  const L = (p, s, y) => V(p.x - p.tz * s, y, p.z + p.tx * s);
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1], ya = a.y + DECK.lift, yb = b.y + DECK.lift;
    B.color(concrete); B.quad(L(a, w, ya), L(b, w, yb), L(b, -w, yb), L(a, -w, ya));
    B.color(concrete.clone().multiplyScalar(.72));
    B.quad(L(a, -w, ya - DECK.slab), L(b, -w, yb - DECK.slab), L(b, w, yb - DECK.slab), L(a, w, ya - DECK.slab));
    B.quad(L(a, w, ya - DECK.slab), L(b, w, yb - DECK.slab), L(b, w, yb), L(a, w, ya));
    B.quad(L(b, -w, yb - DECK.slab), L(a, -w, ya - DECK.slab), L(a, -w, ya), L(b, -w, yb));
  }
}

/** A far shell's helix: its drum alone. */
function buildDrum(B, h, land, col) {
  const g = land.heightAt(h.c.x, h.c.z) - .5, top = Math.max(h.y0, h.y1) + (h.role === 'escalator' ? 5 : 2.5);
  B.color(h.role === 'escalator' ? (col.steel || '#3a3d42') : (col.stone || '#a89a86'));
  B.cylinder(h.c.x, g, h.c.z, h.R - DECK.width / 2 - 1.6, top - g, 14);
}

/** A far shell's field: the grass, the infield (baseball) or the end zones (football). */
function buildFieldShell(B, st, plan, g0, col) {
  const y = g0 + .02;
  const flat = (ring, color, dy = 0) => {
    B.color(color);
    const tris = THREE.ShapeUtils.triangulateShape(ring.map((p) => new THREE.Vector2(p.x, p.z)), []);
    for (const [i, j, k] of tris) {
      const A = V(ring[i].x, y + dy, ring[i].z), Bv = V(ring[j].x, y + dy, ring[j].z), C = V(ring[k].x, y + dy, ring[k].z);
      const n = new THREE.Vector3().subVectors(Bv, A).cross(new THREE.Vector3().subVectors(C, A));
      if (n.y > 0) B.triangle(A, Bv, C); else B.triangle(A, C, Bv);
    }
  };
  if (st.sport === 'baseball') {
    const { P } = plan;
    flat(plan.ring, '#4f8f3a');
    const arc = [P(-1.5, 0)];
    for (let phi = -6; phi <= 96; phi += 12) { const a = (45 - phi) * DEG; arc.push(P(18.4 + Math.cos(a) * 29, Math.sin(a) * 29)); }
    flat(arc, '#b0764a', .02);
    const d = 27.43 * Math.SQRT1_2;
    flat([P(1.5, 0), P(d - 1, d - 2.4), P(2 * d - 2.4, 0), P(d - 1, -(d - 2.4))], '#4f8f3a', .03);
    return;
  }
  const { P } = plan, f = st.field, hl = f.lengthM / 2, hw = f.widthM / 2;
  flat(plan.ring, '#3f7d35');
  const ez = (a0, a1, c) => flat([P(a0, -hw), P(a1, -hw), P(a1, hw), P(a0, hw)], c, .02);
  ez(-hl, -45.72, col.endzone || '#1b1b1b'); ez(45.72, hl, col.endzone2 || '#f2b81c');
}

// ---------------------------------------------------------------- the helices: a spiral escalator, a spiral ramp
/**
 * Round each helix: a drum at its heart (the escalator's lit glass, the ramp's stone rotunda), short of the deck's
 * inner edge and of the rider leaning in; the ramp gets a colonnade outside and a ring beam on top.
 */
function buildHelix(B, h, st, land, col, glows, nearPath = () => null) {
  const g = land.heightAt(h.c.x, h.c.z) - .5, top = Math.max(h.y0, h.y1) + (h.role === 'escalator' ? 5 : 2.5);
  const rIn = h.R - DECK.width / 2 - 1.6, rOut = h.R + DECK.width / 2 + .8;
  if (h.role === 'escalator') {
    B.color(col.steel || '#3a3d42'); B.cylinder(h.c.x, g, h.c.z, rIn, top - g, 24);
    B.color('#cfe3ea'); for (let y = g + 3.2; y < top - 1; y += 4) B.cylinder(h.c.x, y, h.c.z, rIn + .06, 2.2, 24);   // glass bands
    B.color(col.steel || '#3a3d42'); B.cylinder(h.c.x, top, h.c.z, rIn + 1.5, .6, 24, rIn + 1.2);
    for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; glows.push({ x: h.c.x + Math.cos(a) * (rIn + .3), y: top - 1.5, z: h.c.z + Math.sin(a) * (rIn + .3), size: 4, color: '#ffe6b0' }); }
  } else {
    B.color(col.stone || '#a89a86'); B.cylinder(h.c.x, g, h.c.z, rIn, top - g, 28);
    B.color(new THREE.Color(col.stone || '#a89a86').multiplyScalar(.6));
    for (let y = g + 2; y < top - 2; y += 6) B.cylinder(h.c.x, y, h.c.z, rIn + .05, 1.2, 28);
    // the colonnade outside the ramp, and its ring beam
    B.color(col.steel2 || col.steel || '#3a3d42');
    for (let k = 0; k < 16; k++) { const a = k / 16 * TAU, x = h.c.x + Math.cos(a) * rOut, z = h.c.z + Math.sin(a) * rOut; if (!nearPath(x, z, DECK.width / 2 + .6)) B.cylinder(x, g, z, .35, top - g, 6); }
    for (let k = 0; k < 32; k++) {
      const a0 = k / 32 * TAU, a1 = (k + 1) / 32 * TAU;
      B.beam(V(h.c.x + Math.cos(a0) * rOut, top, h.c.z + Math.sin(a0) * rOut), V(h.c.x + Math.cos(a1) * rOut, top, h.c.z + Math.sin(a1) * rOut), .5, .7);
    }
  }
}

// ---------------------------------------------------------------- scoreboards
function buildBoards(B, Sc, st, plan, g0, rim, col) {
  const board = (p, facing, w, h, y0) => {
    const yaw = Math.atan2(facing.x, facing.z), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    B.color('#2b2e33');
    for (const s of [-.35, .35]) B.box(p.x + rx * s * w, g0 - 1, p.z + rz * s * w, 1.2, y0 - g0 + 1, 1.2, yaw);
    B.box(p.x, y0, p.z, w + 1.2, h + 1.2, 1.6, yaw);
    // the screen: blocks of the home colours and a line score
    const cols = ['#f2b81c', '#151515', '#ffffff', '#c8102e', '#27509b'];
    const n = 12, m = 4;
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
      const u0 = -w / 2 + w * i / n, u1 = u0 + w / n * .94, v0 = y0 + .6 + h * j / m, v1 = v0 + h / m * .9;
      const c = j === m - 1 ? (i % 3 ? '#151515' : '#f2b81c') : cols[(i * 7 + j * 3) % cols.length];
      Sc.color(c);
      const P = (u, v) => V(p.x + rx * u + facing.x * .85, v, p.z + rz * u + facing.z * .85);
      Sc.quad(P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1));
    }
  };
  if (st.sport === 'baseball') {
    const { P, D, home } = plan, a = 45 - 26, d = D(26) + 26, at = P(Math.cos(a * DEG) * d, Math.sin(a * DEG) * d);
    const face = { x: home.x - at.x, z: home.z - at.z }, l = Math.hypot(face.x, face.z);
    board(at, { x: face.x / l, z: face.z / l }, 30, 11, g0 + 13);
  } else {
    const at = plan.P(st.field.lengthM / 2 + 26, 0), face = { x: -plan.u.x, z: -plan.u.z };
    board(at, face, 32, 10, g0 + 14);
  }
}

// ---------------------------------------------------------------- light towers
function buildLights(B, stand, st, glows) {
  const towers = [], rays = stand.rays.filter((r) => r && r.kind === 'full' && !r.stop);   // (not where the stand meets the ridden deck)
  if (!rays.length) return towers;
  const want = st.sport === 'baseball' ? 6 : 4;
  // spread round the full-height sectors: every n-th of them
  const step = Math.max(1, Math.floor(rays.length / want));
  for (let k = Math.floor(step / 2); k < rays.length && towers.length < want; k += step) {
    const r = rays[k], p = stand.pt(r, .98), hgt = st.sport === 'baseball' ? 22 : 16;
    B.color(st.colors?.lights || '#2f3338'); B.cylinder(p.x, p.y, p.z, .55, hgt, 6, .35);
    const yaw = Math.atan2(r.dx, r.dz);
    B.color('#e9e9e2'); B.box(p.x, p.y + hgt, p.z, 9, 4.2, 1.2, yaw);
    for (let i = -3; i <= 3; i++) for (const j of [1.2, 3]) glows.push({ x: p.x + Math.cos(yaw) * i * 1.25 - r.dx * .8, y: p.y + hgt + j, z: p.z - Math.sin(yaw) * i * 1.25 - r.dz * .8, size: 5.5, color: '#f4f6ff' });
    towers.push({ x: p.x, y: p.y + hgt, z: p.z });
  }
  return towers;
}

// ---------------------------------------------------------------- the crowd
function crowdIn(stand, st, nearDeck) {
  const rand = randomSequence((st.name.length * 7919) | 0), far = [], near = [], rays = stand.rays;
  const home = st.sport === 'baseball' ? ['#151515', '#f2b81c', '#151515', '#ffffff', '#f2b81c'] : ['#151515', '#f2b81c', '#151515', '#f2b81c', '#ffffff'];
  const N = rays.length;
  for (let k = 0; k < N; k++) {
    const a = rays[k], b = rays[(k + 1) % N];
    if (!a || !b || !a.H || !b.H || a.kind === 'open' || b.kind === 'open') continue;
    const rows = a.kind === 'full' ? 22 : 9;
    for (let j = 0; j < rows; j++) {
      const f = (j + .5) / rows;
      if (a.kind === 'full' && f > .48 && f < .58) continue;   // (the club level)
      if (rand() > .45) continue;   // (PLAN 7.8b: ~27 % fewer than 7.8's .62)
      const t = rand(), A = stand.pt(a, f), B = stand.pt(b, f), x = A.x + (B.x - A.x) * t, y = Math.min(A.y, B.y), z = A.z + (B.z - A.z) * t;
      const look = randomLook(rand, { shirts: home, kids: .1, caps: .35 });
      const r = rand(), clip = r < .55 ? CLIP.sit : r < .72 ? CLIP.clap : r < .84 ? CLIP.cheer : r < .92 ? CLIP.idle : CLIP.flag;
      const yaw = Math.atan2(-a.dx, -a.dz) + (rand() - .5) * .4;
      const fig = { look, x, y, z, yaw, clip, phase: rand(), rate: clipRate(clip) * (.85 + rand() * .3) };
      (nearDeck(x, z, 30) ? near : far).push(fig);
    }
  }
  return { far, near };
}

// ---------------------------------------------------------------- the game
/** Players on the field, a loop of light motion (a pitch and a hit to the outfield; a play from scrimmage). */
class Game {
  constructor(city, st, plan, g0, material) {
    this.st = st; this.plan = plan; this.y = g0 + .03;
    this.crowd = new Crowd(city.group, { uTime: city.uniforms.uTime, name: `${st.name} players`, capacity: 32, nearM: 70, nearCapacity: 32, shadows: true });
    this.crowd.mat.dispose(); this.crowd.mat = material;
    for (const m of this.crowd.meshes) { m.material = material; m.customDepthMaterial = material.userData.depth; }
    const rand = randomSequence(st.name.length * 131);
    const uni = (shirt, pants, extra = {}) => ({ ...randomLook(rand, { kids: 0, skirts: 0, sleeves: 1, packs: 0, caps: 0, longHair: .1 }), shirt: new THREE.Color(shirt), pants: new THREE.Color(pants), bits: 1 | 2 | (extra.cap ? 16 : 0), h: 1 + rand() * .06, g: 1.05 + rand() * .12 });
    this.actors = st.sport === 'baseball' ? baseballActors(uni) : footballActors(uni);
  }
  tick(time, dt, camera) {
    const P = this.plan.P, c = this.crowd.begin(camera.position || camera);
    for (const a of this.actors) {
      const s = a.at(time);
      const p = P(s.u, s.v), q = P(s.u + s.fu, s.v + s.fv);
      const yaw = Math.atan2(q.x - p.x, q.z - p.z);
      c.add(a.look, p.x, this.y, p.z, yaw, s.clip, s.phase, s.rate);
    }
    c.end();
  }
  setVisible(v) { if (this.visible === v) return; this.visible = v; for (const m of this.crowd.meshes) m.visible = v; }
  dispose() { for (const m of this.crowd.meshes) { m.removeFromParent(); m.geometry.dispose(); m.dispose(); } }
}

/**
 * An actor on a loop: keyframes [t (s in the loop), u, v (field metres), clip]; it moves straight between them, faces
 * where it goes (or `face` [u, v] when it stands), and runs its clip at the speed it moves.
 */
function actor(look, period, keys, face = [0, 0], offset = 0) {
  return {
    look,
    at(time) {
      const t = ((time + offset) % period + period) % period;
      let k = keys.length - 1;
      for (let i = 0; i < keys.length; i++) if (keys[i][0] <= t) k = i;
      const a = keys[k], b = keys[(k + 1) % keys.length], tb = k + 1 < keys.length ? b[0] : b[0] + period;
      const f = Math.min(1, (t - a[0]) / Math.max(1e-6, tb - a[0]));
      const u = a[1] + (b[1] - a[1]) * f, v = a[2] + (b[2] - a[2]) * f;
      const dist = Math.hypot(b[1] - a[1], b[2] - a[2]), speed = dist / Math.max(1e-6, tb - a[0]);
      const moving = speed > .2;
      const clip = moving ? (speed > 3 ? CLIP.jog : CLIP.walk) : (a[3] ?? CLIP.idle);
      const fu = moving ? (b[1] - a[1]) : face[0] - u, fv = moving ? (b[2] - a[2]) : face[1] - v;
      return { u, v, fu, fv, clip, phase: (t / CLIP_SEC(clip)) % 1, rate: 0 };
    },
  };
}
const CLIP_SEC = (clip) => 1 / clipRate(clip);

function baseballActors(uni) {
  // the home team in white, the visitors batting in grey; u: toward centre field from home, v: toward left field
  const home = () => uni('#f4f2ec', '#f4f2ec', { cap: 1 }), away = () => uni('#9a9da2', '#9a9da2', { cap: 1 }), ump = () => uni('#1c2433', '#55595f', { cap: 1 });
  const T = 24, s = 27.43 * Math.SQRT1_2;
  const still = (look, u, v, face = [0, 0], clip = CLIP.idle) => actor(look, T, [[0, u, v, clip]], face);
  const list = [
    still(home(), 18.4, 0, [0, 0], CLIP.look),                        // pitcher
    still(home(), -1.2, 0, [18, 0], CLIP.idle),                       // catcher
    still(ump(), -2.4, 0, [18, 0], CLIP.idle),                        // home-plate umpire
    still(home(), s * 2 - 6, -s + 3, [0, 0]), still(home(), s * 2 - 2, -6, [0, 0]),   // first base, second base
    still(home(), s * 2 - 2, 7, [0, 0]), still(home(), s - 1, s + 1, [0, 0]),         // shortstop, third base
    // the hit: the batter runs to first; the right fielder runs it down and throws it in, back to his place
    actor(away(), T, [[0, -.4, .9, CLIP.idle], [9, -.4, .9, CLIP.idle], [13, s, -s, CLIP.idle], [20, s, -s, CLIP.idle], [23.9, -.4, .9, CLIP.idle]], [18, 0]),
    actor(home(), T, [[0, 62, -52, CLIP.idle], [9.5, 62, -52, CLIP.idle], [12.5, 80, -45, CLIP.idle], [15, 80, -45, CLIP.idle], [20, 62, -52, CLIP.idle]], [0, 0]),
    actor(home(), T, [[0, 88, 0, CLIP.idle], [10, 88, 0, CLIP.idle], [13, 82, -18, CLIP.idle], [16, 82, -18, CLIP.idle], [20, 88, 0, CLIP.idle]], [0, 0]),   // centre field backs up the play
    still(home(), 64, 48, [0, 0]),                                    // left field
    still(away(), s * 2 + 1, -s - 6, [0, 0], CLIP.clap),             // first-base coach
    still(away(), s + 4, s + 6, [0, 0], CLIP.wave),                  // third-base coach
    still(ump(), s * 2 + 3, -s + 1, [0, 0]),                          // first-base umpire
  ];
  return list;
}

function footballActors(uni) {
  // offence (black, gold pants) going toward +u, defence in white; a play every 16 s: set, snap, the run, back to the huddle
  const off = () => uni('#151515', '#d9a92b'), def = () => uni('#f4f4f0', '#c8102e'), ref = () => uni('#e9e9e9', '#151515', { cap: 1 });
  const T = 16, list = [], los = -8;
  const play = (look, u0, v0, du, dv, face) => actor(look, T, [[0, u0, v0, CLIP.idle], [5, u0, v0, CLIP.idle], [9, u0 + du, v0 + dv, CLIP.idle], [11, u0 + du, v0 + dv, CLIP.idle], [15.5, u0, v0, CLIP.idle]], face);
  // offence: five linemen, a tight end, the quarterback, a running back, three receivers
  for (let k = -2; k <= 2; k++) list.push(play(off(), los - .8, k * 1.6, 2.5, 0, [los + 20, k * 1.6]));
  list.push(play(off(), los - .8, 4.6, 6, 1, [los + 20, 4.6]));
  list.push(play(off(), los - 5, 0, -4, -1, [los + 20, 0]));
  list.push(play(off(), los - 7, 1, 9, -5, [los + 20, 0]));
  for (const v of [-20, 14, 21]) list.push(play(off(), los - 1, v, 22, -v * .3, [los + 20, v]));
  // defence: four down linemen, three linebackers, four backs
  for (const v of [-4.5, -1.5, 1.5, 4.5]) list.push(play(def(), los + 1, v, -1.5, 0, [los - 10, v]));
  for (const v of [-6, 0, 6]) list.push(play(def(), los + 5, v, -2, v * .3, [los - 10, v]));
  for (const v of [-20, 21, -8, 9]) list.push(play(def(), los + (Math.abs(v) > 15 ? 7 : 13), v, 12, -v * .2, [los - 10, v]));
  for (const [u, v] of [[los - 12, 0], [los + 15, -3], [los, -26]]) list.push(play(ref(), u, v, 4, 0, [los, 0]));
  return list;
}
