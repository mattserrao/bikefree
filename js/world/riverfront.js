// Riverfront promenades: a paved walk, a stone river wall with a coping and a railing, and benches, along
// the river side of the route where it runs beside the water.
//
// The map's shoreline comes from a land grid (cells of several metres), so a bank beside the route shows as a
// sawtooth slope of grass down to the water. Where the scene asks for it, the river's edge is replaced by a
// smoothed line: the walk is paved from the route's shoulder out to it at the route's level, and a wall drops
// from there into the river. The other river walls (city.js) stay off the stretch this covers.
//
// A scene opts in with
//   "riverfront": { "spans": [{ "fromM": 1040, "toM": 1880 }, …] }
// where each span may set "side": "left" | "right" (default: the side the water is on) and "maxGapM" (how far
// from the route's centre the water may be for the walk to reach it). The planner is pure (no three.js), so
// tools and tests can run it in Node.
import * as THREE from '../../vendor/three.module.min.js';
import { MeshBuilder } from './city-geometry.js';
import { ROAD_WIDTH, routePoint } from './pose.js';

export const RIVERFRONT_DEFAULTS = {
  stepM: 2,          // sample spacing along the route (m)
  maxGapM: 26,       // the water must be within this of the route's centre
  innerM: ROAD_WIDTH / 2 + 1.8,   // the walk starts under the edge of the route's shoulder
  minOuterM: ROAD_WIDTH / 2 + 3.2, // narrowest walk: the wall at least this far from the centre
  marginM: 1.2,      // the wall stands this far out past the furthest shore point nearby
  minRunM: 60,       // shorter stretches are left natural
  gapM: 18,          // gaps up to this long (a crossing path, an unreadable shore) are walled through
  railEveryM: 2.4,   // railing post spacing
  benchEveryM: 38,   // bench spacing
  pavedM: 4.5,       // paved width of a wide walk (the rest is lawn)
  meshCellM: 6,      // the finest ground mesh's grid (stylized-terrain.js: 96 m patches, 16 cells)
};

/** The ground as the mesh draws it: heights on a grid, split into triangles like the terrain patches. */
function meshGround(heightAt, cell) {
  const cache = new Map();
  const v = (i, j) => { const key = i * 1e7 + j; let h = cache.get(key); if (h === undefined) { h = heightAt(i * cell, j * cell); cache.set(key, h); } return h; };
  return (x, z) => {
    const gi = Math.floor(x / cell), gj = Math.floor(z / cell), u = x / cell - gi, w = z / cell - gj;
    const a = v(gi, gj), b = v(gi + 1, gj), d = v(gi, gj + 1), e = v(gi + 1, gj + 1);
    return u + w <= 1 ? a + (b - a) * u + (d - a) * w : e + (d - e) * (1 - u) + (b - e) * (1 - w);
  };
}

const smoothMax = (a, r) => a.map((_, i) => { let m = -Infinity; for (let k = Math.max(0, i - r); k <= Math.min(a.length - 1, i + r); k++) m = Math.max(m, a[k]); return m; });
const smoothAvg = (a, r) => a.map((_, i) => { let s = 0, n = 0; for (let k = Math.max(0, i - r); k <= Math.min(a.length - 1, i + r); k++) { s += a[k]; n++; } return s / n; });

/**
 * Plan the promenades: runs of samples { s, x, z, nx, nz (unit normal toward the river), y (route line),
 * deck (walk height), outer (wall line offset from the centre, m) }.
 * @param {object} ctx { landscape, route, index, streets, config }
 */
export function planRiverfront({ landscape: L, route, index, streets = [], config }) {
  if (typeof streets === 'function') streets = streets();
  const O = { ...RIVERFRONT_DEFAULTS, ...config };
  const runs = [], ground = meshGround(L.heightAt, O.meshCellM);
  for (const span of config?.spans || []) {
    const so = { ...O, ...span };
    const raw = [];
    for (let s = span.fromM; s <= span.toM; s += so.stepM) {
      const p = routePoint(route, index, s), a = routePoint(route, index, s - 1.5), b = routePoint(route, index, s + 1.5);
      let tx = b.x - a.x, tz = b.z - a.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const left = { x: tz, z: -tx };
      // the shore as drawn: past the last ground above the water, until 6 m of open water (the ground mesh
      // is triangulated on a 6 m grid, so its waterline zig-zags well past the map's)
      const dist = (sg) => {
        let last = 0, wet = 0;
        for (let r = 1; r <= so.maxGapM + 6; r += .5) {
          const x = p.x + left.x * r * sg, z = p.z + left.z * r * sg;
          if (ground(x, z) >= L.level - .1 && L.waterAt(x, z) < .98) { last = r; wet = 0; } else if ((wet += .5) >= 6) break;
        }
        return wet >= 6 && last <= so.maxGapM ? Math.max(1, last) : null;
      };
      raw.push({ s, x: p.x, z: p.z, y: p.y, tx, tz, left, dl: dist(1), dr: dist(-1) });
    }
    // the side: as asked, or the one the water is on more often
    let side = span.side === 'left' ? 1 : span.side === 'right' ? -1 : 0;
    if (!side) { let l = 0, r = 0; for (const q of raw) { if (q.dl != null) l++; if (q.dr != null) r++; } side = l >= r ? 1 : -1; }
    // usable samples: water within reach, no street in the way, not on a bridge deck
    const ok = raw.map((q) => {
      q.nx = q.left.x * side; q.nz = q.left.z * side; q.d = side > 0 ? q.dl : q.dr;
      if ((L.routeBridges || []).some((b) => q.s > b.fromM - 4 && q.s < b.toM + 4)) return null;   // hard stops: decks, streets
      if (q.d == null) return false;
      // (a street the map draws along the route itself, under or over it, doesn't count)
      const own = new Set((L.streetsNear?.(q.x, q.z, 3) || []).map((o) => o.k));
      for (const r of [so.innerM + 1, (so.innerM + Math.max(so.minOuterM, q.d)) / 2, Math.max(so.minOuterM, q.d)]) {
        const x = q.x + q.nx * r, z = q.z + q.nz * r;
        if ((L.streetsNear?.(x, z, 2) || []).some((o) => !own.has(o.k) && streets[o.k] && streets[o.k].cls < 8 && Math.abs((o.y ?? q.y) - q.y) < 4)) return null;
      }
      return true;
    });
    // runs, bridging short gaps (up to gapM) where the shore can't be read
    const bridge = Math.round(so.gapM / so.stepM);
    let i = 0;
    while (i < raw.length) {
      if (!ok[i]) { i++; continue; }
      let j = i;
      const soft = (k) => { for (let m = k; m < Math.min(raw.length, k + 1 + bridge); m++) { if (ok[m] === null) return false; if (ok[m]) return true; } return false; };
      while (j + 1 < raw.length && (ok[j + 1] || soft(j + 1))) j++;
      while (j > i && !ok[j]) j--;
      const run = raw.slice(i, j + 1);
      if (run.length && (run[run.length - 1].s - run[0].s) >= so.minRunM) runs.push(finishRun(run, L, so));
      i = j + 1;
    }
  }
  return runs;
}

/** Smooth the wall line and the walk's height along one run. */
function finishRun(run, L, O) {
  const r = Math.max(1, Math.round(10 / O.stepM));
  const d = run.map((q) => q.d ?? NaN);
  for (let k = 0; k < d.length; k++) if (!Number.isFinite(d[k])) { let a = k - 1, b = k + 1; while (b < d.length && !Number.isFinite(d[b])) b++; d[k] = Number.isFinite(d[a]) ? (b < d.length ? (d[a] + d[b]) / 2 : d[a]) : d[b]; }
  // the furthest shore nearby, smoothed (twice), plus a margin: the wall stands out in the water all along
  const outer = smoothAvg(smoothAvg(smoothMax(d, r), r), r).map((v, k) => Math.max(O.minOuterM, v + O.marginM, d[k] + .4));
  // the walk: level with the route at its inner edge, never under the ground across it
  const deck = run.map((q, k) => {
    let g = -Infinity;
    for (let o = O.innerM; o <= outer[k]; o += 1.5) g = Math.max(g, L.heightAt(q.x + q.nx * o, q.z + q.nz * o));
    return Math.max(q.y + .06, g + .08);
  });
  const deckS = smoothAvg(smoothMax(deck, 2), 2);
  return { samples: run.map((q, k) => ({ s: q.s, x: q.x, z: q.z, y: q.y, nx: q.nx, nz: q.nz, tx: q.tx, tz: q.tz, outer: outer[k], deck: Math.max(deckS[k], q.y + .06) })), opts: O };
}

/**
 * A terraced cascade down a bank to the river (Pittsburgh's North Shore Water Steps): scene
 * "riverfront": { "waterSteps": { "top": {lat, lon}, "bottom": {lat, lon}, "widthM": 20, "tiers": 6 } }.
 * Tier heights run from the ground at the top to the ground at the bottom (never under the water).
 */
export function planWaterSteps(L, spec) {
  const proj = L.decoded?.proj;
  if (!spec?.top || !spec?.bottom || !proj) return null;
  const T = proj.toLocal(spec.top.lat, spec.top.lon), B = proj.toLocal(spec.bottom.lat, spec.bottom.lon);
  const len = Math.hypot(B.x - T.x, B.z - T.z), ux = (B.x - T.x) / len, uz = (B.z - T.z) / len;
  // the top: the plaza (or street) just behind it; the bottom: the walk at its foot
  let yTop = -Infinity; for (let a = -8; a <= 0; a += 1) yTop = Math.max(yTop, L.heightAt(T.x + ux * a, T.z + uz * a));
  if (spec.topM != null) yTop = L.level + spec.topM;   // or as the scene says (the map's pool sinks the ground)
  const yBot = Math.max(L.level + .3, Math.min(yTop - .5, L.heightAt(B.x + ux * 3, B.z + uz * 3)));
  const n = Math.max(2, spec.tiers || Math.round((yTop - yBot) / .45) + 1);
  const tiers = [];
  for (let k = 0; k < n; k++) tiers.push({ t0: len * k / n, t1: len * (k + 1) / n, y: yTop - (yTop - yBot) * k / (n - 1) });
  return { T, B, len, ux, uz, vx: -uz, vz: ux, width: spec.widthM || 20, tiers };
}

/**
 * The promenades on a 2 m raster: `covers(x, z)` (on the walk or just past its wall: other walls and scattered
 * plants keep off) and `groundCap(x, z)` (past the wall the ground must lie under the water, or the drawn
 * bank shows in front of the wall; it eases back over 20 m past each end of a run).
 */
export function riverfrontField(runs, level, { pad = 4, cutInM = 3, cutOutM = 40, taperM = 20, steps = null } = {}) {
  const C = 2, cover = new Set(), cap = new Map();
  const key = (x, z) => (Math.floor(x / C) + 32768) * 65536 + Math.floor(z / C) + 32768;
  const mark = (q, along, lift) => {
    const bx = q.x + q.tx * along, bz = q.z + q.tz * along;
    for (let o = q.innerM - 1; o <= q.outer + cutOutM; o += 1) {
      const k = key(bx + q.nx * o, bz + q.nz * o);
      if (lift === 0 && o <= q.outer + pad) cover.add(k);
      // (past the ends the cut also recedes outward)
      if (o >= (lift ? q.outer + 2 + lift * 4 : Math.max(q.outer - cutInM, q.innerM + 1))) { const h = level - 1.5 + lift; if (!(cap.get(k) <= h)) cap.set(k, h); }
    }
  };
  for (const run of runs) {
    const S = run.samples, O = run.opts;
    for (const q of S) { q.innerM ??= O.innerM; for (let a = -O.stepM * .75; a <= O.stepM * .75; a += .5) mark(q, a, 0); }
    // past the ends: the cap rises back to the bank's own height
    for (const [q, dir] of [[S[0], -1], [S[S.length - 1], 1]]) for (let e = 1; e <= taperM; e += .5) mark(q, dir * e, 3 * e / taperM);
  }
  // the water steps: the ground under each tier stays just below its tread
  if (steps) for (const t of steps.tiers) for (let a = t.t0 - 1; a <= t.t1 + 1; a += 1) for (let o = -steps.width / 2 - 1; o <= steps.width / 2 + 1; o += 1) {
    const k = key(steps.T.x + steps.ux * a + steps.vx * o, steps.T.z + steps.uz * a + steps.vz * o), h = t.y - .08;
    cover.add(k); if (!(cap.get(k) <= h)) cap.set(k, h);
  }
  return {
    covers: (x, z) => cover.has(key(x, z)),
    groundCap: (x, z) => cap.get(key(x, z)) ?? Infinity,
  };
}

/**
 * Plan the scene's promenades on a city landscape and push the ground past their walls under the water.
 * Called once by the landscape (city-landscape.js) so the ground mesh, the city and the QC tools agree.
 */
export function riverfrontGround(L, { route, index, streets, config }) {
  const runs = planRiverfront({ landscape: L, route, index, streets, config });
  const steps = planWaterSteps(L, config.waterSteps);
  const field = riverfrontField(runs, L.level, { steps });
  const heightAt = L.heightAt;
  L.heightAt = (x, z) => Math.min(heightAt(x, z), field.groundCap(x, z));
  L.riverfront = { runs, steps, ...field };
  return L.riverfront;
}

/**
 * Build the promenades into the city: a few merged meshes (one per ~200 m), on the city's solid material.
 * Returns { runs, covers(x, z) } (or null when the scene has none).
 */
export function buildRiverfront(city) {
  const config = city.route.scene?.riverfront;
  if (!config?.spans?.length && !config?.waterSteps) return null;
  const L = city.landscape;
  // planned with the landscape (the ground past the walls is already under the water), else here
  const plan = L.riverfront || { runs: planRiverfront({ landscape: L, route: city.route, index: city.index, streets: city.streets, config }) };
  const runs = plan.runs, field = plan.covers ? plan : riverfrontField(runs, L.level), covers = field.covers;
  const level = L.level, V = (x, y, z) => new THREE.Vector3(x, y, z);
  const stone = new THREE.Color('#9b9486'), wet = new THREE.Color('#4a4840'), coping = new THREE.Color('#c9c1ae');
  const lawn = new THREE.Color(city.route.scene?.palette?.grass || '#7a9a55').multiplyScalar(.82);
  const paveA = new THREE.Color('#b3aa98'), paveB = new THREE.Color('#a69d8b'), edge = new THREE.Color('#8f877a'), iron = new THREE.Color('#2a2e31'), wood = new THREE.Color('#7a5a3c');
  let tris = 0;
  const meshes = [];
  for (const run of runs) {
    const S = run.samples, O = run.opts;
    for (let c0 = 0; c0 < S.length - 1; c0 += 100) {
      const c1 = Math.min(S.length - 1, c0 + 100), M = new MeshBuilder();
      const at = (q, off, y) => V(q.x + q.nx * off, y, q.z + q.nz * off);
      for (let k = c0; k < c1; k++) {
        const a = S[k], b = S[k + 1];
        // the walk: pavers in 6 m bands, a darker granite strip along the wall
        // (where it is wide, a paved walk by the route and a lawn out to the wall, like the Point's)
        const pa = Math.min(a.outer - .9, O.innerM + O.pavedM), pb = Math.min(b.outer - .9, O.innerM + O.pavedM);
        M.color(Math.floor(a.s / 6) % 2 ? paveA : paveB);
        M.quad(at(a, O.innerM, a.deck), at(b, O.innerM, b.deck), at(b, pb, b.deck), at(a, pa, a.deck));
        orient(M);
        if (a.outer - .9 - pa > .3 || b.outer - .9 - pb > .3) {
          M.color(lawn); M.quad(at(a, pa, a.deck), at(b, pb, b.deck), at(b, b.outer - .9, b.deck), at(a, a.outer - .9, a.deck)); orient(M);
        }
        M.color(edge);
        M.quad(at(a, a.outer - .9, a.deck), at(b, b.outer - .9, b.deck), at(b, b.outer - .45, b.deck), at(a, a.outer - .45, a.deck));
        orient(M);
        // the coping: a pale stone cap, a little proud of the wall
        const ca = a.deck + .16, cb = b.deck + .16;
        M.color(coping);
        M.quad(at(a, a.outer - .45, ca), at(b, b.outer - .45, cb), at(b, b.outer + .08, cb), at(a, a.outer + .08, ca)); orient(M);
        face(M, at(a, a.outer - .45, a.deck), at(b, b.outer - .45, b.deck), ca, cb, a, -1);
        face(M, at(a, a.outer + .08, a.deck - .12), at(b, b.outer + .08, b.deck - .12), ca, cb, a, 1);
        // the wall into the river: dressed stone, a dark wet band at the waterline
        M.color(stone); face(M, at(a, a.outer, level + .55), at(b, b.outer, level + .55), a.deck - .12, b.deck - .12, a, 1);
        M.color(wet); face(M, at(a, a.outer, level - 1.4), at(b, b.outer, level - 1.4), level + .55, level + .55, a, 1);
      }
      // the railing: posts and two rails, set in from the coping's edge
      M.color(iron);
      let prev = null;
      for (let k = c0; k <= c1; k++) {
        const q = S[k];
        if (k > c0 && Math.floor(q.s / O.railEveryM) === Math.floor(S[k - 1].s / O.railEveryM) && k !== c1) continue;
        const base = at(q, q.outer - .2, q.deck + .16);
        M.box(base.x, base.y, base.z, .07, 1.04, .07, Math.atan2(q.tx, q.tz));
        if (prev) { M.beam(prev.clone().setY(prev.y + 1.02), base.clone().setY(base.y + 1.02), .07, .05); M.beam(prev.clone().setY(prev.y + .52), base.clone().setY(base.y + .52), .035, .035); }
        prev = base;
      }
      // benches facing the river, now and then
      for (let k = c0; k < c1; k++) {
        const q = S[k];
        if (Math.floor(q.s / O.benchEveryM) === Math.floor(S[Math.max(0, k - 1)].s / O.benchEveryM) || q.outer - O.innerM < 4) continue;
        const wide = q.outer - .9 - (O.innerM + O.pavedM) > 1.5, bo = wide ? O.innerM + O.pavedM - .5 : q.outer - 1.9;
        const p = at(q, bo, q.deck), yaw = Math.atan2(q.tx, q.tz);
        M.color(iron); for (const e of [-.7, .7]) M.box(p.x + q.tx * e, p.y, p.z + q.tz * e, .45, .42, .06, yaw);
        M.color(wood); M.box(p.x, p.y + .42, p.z, .46, .06, 1.8, yaw);
        const bk = at(q, bo - .24, q.deck);
        M.box(bk.x, bk.y + .5, bk.z, .06, .42, 1.8, yaw);
      }
      // the ends of a run: the wall turns back to the bank
      for (const [k, dir] of [[0, -1], [S.length - 1, 1]]) {
        if (k < c0 || k > c1) continue;
        const q = S[k];
        M.color(stone);
        const A = at(q, O.innerM, level - 1.4), B = at(q, q.outer + .08, level - 1.4), C = at(q, q.outer + .08, q.deck + .16), D = at(q, O.innerM, q.deck);
        const n = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(D, A));
        if (n.x * q.tx * dir + n.z * q.tz * dir >= 0) M.quad(A, B, C, D); else M.quad(B, A, D, C);
      }
      M.keepOutOf(L.inRouteTube);
      tris += M.i.length / 3;
      const mesh = new THREE.Mesh(city.own(M.geometry()), city.solidMaterial);
      mesh.name = 'Riverfront'; mesh.receiveShadow = true; mesh.castShadow = true;
      city.group.add(mesh); meshes.push(mesh);
    }
  }
  const steps = plan.steps !== undefined ? plan.steps : planWaterSteps(L, config.waterSteps);
  if (steps) { const m = waterStepsMesh(city, steps); tris += m.geometry.index.count / 3; meshes.push(m); }
  // no street trees at the wall or past it (in the river)
  if (city._clearSpot) { const clear = city._clearSpot; city._clearSpot = function (x, z, ...rest) { return clear.call(this, x, z, ...rest) && !(covers(x, z) && field.groundCap(x, z) < Infinity); }; }
  // no scattered rocks, shrubs or grass on the walk
  const plant = L.canPlant;
  if (plant) L.canPlant = (x, z) => plant(x, z) && !covers(x, z);
  return { runs, covers, meshes, tris };
}

/** The water steps: granite tiers, a sheet of water down the middle of each tread and over each riser. */
function waterStepsMesh(city, S) {
  const L = city.landscape, M = new MeshBuilder(), yaw = Math.atan2(S.ux, S.uz), level = L.level;
  const granite = [new THREE.Color('#bdb5a5'), new THREE.Color('#b0a897')], sheet = new THREE.Color('#8fc3d1'), fall = new THREE.Color('#dcecef'), cheek = new THREE.Color('#a39a89');
  const at = (a, o) => ({ x: S.T.x + S.ux * a + S.vx * o, z: S.T.z + S.uz * a + S.vz * o });
  const V = (p, y) => new THREE.Vector3(p.x, y, p.z);
  S.tiers.forEach((t, k) => {
    const c = at((t.t0 + t.t1) / 2, 0), l = t.t1 - t.t0 + .04;
    M.color(granite[k % 2]); M.box(c.x, level - 1.4, c.z, S.width, t.y - level + 1.4, l, yaw);
    // the water: a sheet across the middle of the tread, a white fall over its front edge
    const w = S.width * .42, y = t.y + .025;
    M.color(sheet); M.quad(V(at(t.t1, -w / 2), y), V(at(t.t1, w / 2), y), V(at(t.t0, w / 2), y), V(at(t.t0, -w / 2), y)); orient(M);
    const next = S.tiers[k + 1];
    if (next) { M.color(fall); face(M, V(at(t.t1 + .03, -w / 2), next.y), V(at(t.t1 + .03, w / 2), next.y), y, y, { nx: S.ux, nz: S.uz }, 1); }
    // granite cheek walls a step higher at the sides
    for (const o of [-S.width / 2 - .4, S.width / 2 + .4]) { const p = at((t.t0 + t.t1) / 2, o); M.color(cheek); M.box(p.x, level - 1.4, p.z, .8, t.y - level + 1.9, l, yaw); }
  });
  M.keepOutOf(L.inRouteTube);
  const mesh = new THREE.Mesh(city.own(M.geometry()), city.solidMaterial);
  mesh.name = 'Water steps'; mesh.receiveShadow = mesh.castShadow = true;
  city.group.add(mesh);
  return mesh;
}

/** Flip the last quad so it faces up (the walk and the coping). */
function orient(M) {
  const n = M.n.length;
  if (M.n[n - 2] >= 0) return;
  const i = M.i, t = i.length;
  for (const k of [t - 6, t - 3]) { const x = i[k + 1]; i[k + 1] = i[k + 2]; i[k + 2] = x; }
  for (let k = n - 12; k < n; k += 3) { M.n[k] = -M.n[k]; M.n[k + 1] = -M.n[k + 1]; M.n[k + 2] = -M.n[k + 2]; }
}

/** A vertical face from the bottom points a0, b0 up to heights ya, yb, facing the river (sign 1) or the walk (-1). */
function face(M, a0, b0, ya, yb, q, sign) {
  const a1 = a0.clone().setY(ya), b1 = b0.clone().setY(yb);
  const n = new THREE.Vector3().subVectors(b0, a0).cross(new THREE.Vector3().subVectors(a1, a0));
  if ((n.x * q.nx + n.z * q.nz) * sign >= 0) M.quad(a0, b0, b1, a1); else M.quad(b0, a0, a1, b1);
}
