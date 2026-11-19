// Building kit: the recipe for every building, planned once from the map footprints (pure: no three.js, so
// tests and QC can check it). A recipe is style × archetype × seed: the same footprint always comes out the
// same, neighbours never share a colour scheme and kind, and every choice (walls, roof, windows, extras,
// dressing) follows from the archetype and three knobs per building: age, upkeep and wealth.
//
// Footprints are cut into rectangles (L, T and U plans become a main block and wings, each with its own
// roof, so they meet as cross gables) — an outline too ragged for that keeps its outline and a low cap.
import { randomSequence } from '../../core/random.js';
import { drain, due } from '../../core/jobs.js';   // [F30]
import { resolveStyle, pick, WALLS, ROOFS, WINDOW_SETS, W, WINDOW_BAY, ROOF_COLORS, S } from './presets.js';

export const ROAD_HALF = 3.5;
const polyArea = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % pts.length]; a += x0 * z1 - x1 * z0; } return a / 2; };

/** Minimum-area rectangle round a polygon: centre, axes (u along the long side) and half sizes. */
export function orientedBox(pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < .3) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L, vx = -uz, vz = ux;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of pts) { const u = x * ux + z * uz, v = x * vx + z * vz; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area - 1e-6) best = { area, ux, uz, vx, vz, u0, u1, v0, v1 };
  }
  if (!best) return null;
  return frame(best.ux, best.uz, best.u0, best.u1, best.v0, best.v1);
}

/** A rectangle from its axes and extents, the long side along u. */
function frame(ux, uz, u0, u1, v0, v1) {
  let vx = -uz, vz = ux;
  let cu = (u0 + u1) / 2, cv = (v0 + v1) / 2, hu = (u1 - u0) / 2, hv = (v1 - v0) / 2;
  if (hv > hu) { [ux, uz, vx, vz] = [vx, vz, -ux, -uz]; [cu, cv] = [cv, -cu]; [hu, hv] = [hv, hu]; }
  return { cx: cu * ux + cv * vx, cz: cu * uz + cv * vz, ux, uz, vx, vz, hu, hv };
}

function inside(x, z, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/**
 * Cut a footprint into up to three rectangles on its own grid (largest first). Returns { rects, cover } —
 * cover is the share of the footprint the rectangles fill.
 */
export function decompose(pts) {
  const box = orientedBox(pts);
  if (!box) return null;
  const area = Math.abs(polyArea(pts));
  const fill = area / (4 * box.hu * box.hv);
  if (fill > .84 || area < 40) return { rects: [box], cover: Math.min(1, fill), box };
  const cell = Math.max(.5, Math.min(box.hu, box.hv) / 7);
  const nu = Math.max(2, Math.round(2 * box.hu / cell)), nv = Math.max(2, Math.round(2 * box.hv / cell));
  const cu = 2 * box.hu / nu, cv = 2 * box.hv / nv;
  const grid = new Uint8Array(nu * nv);
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = -box.hu + (i + .5) * cu, b = -box.hv + (j + .5) * cv;
    grid[i * nv + j] = inside(box.cx + box.ux * a + box.vx * b, box.cz + box.uz * a + box.vz * b, pts) ? 1 : 0;
  }
  const rects = [];
  let covered = 0;
  for (let k = 0; k < 3; k++) {
    // largest all-filled rectangle (histogram method)
    const hgt = new Int32Array(nv);
    let best = null;
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) hgt[j] = grid[i * nv + j] === 1 ? hgt[j] + 1 : 0;
      const st = [];
      for (let j = 0; j <= nv; j++) {
        const h = j < nv ? hgt[j] : 0;
        let start = j;
        while (st.length && st[st.length - 1][1] >= h) {
          const [s0, sh] = st.pop();
          const a = sh * cu * (j - s0) * cv;
          if (sh && (!best || a > best.a)) best = { a, i0: i - sh + 1, i1: i, j0: s0, j1: j - 1 };
          start = s0;
        }
        st.push([start, h]);
      }
    }
    if (!best) break;
    const w = (best.i1 - best.i0 + 1) * cu, d = (best.j1 - best.j0 + 1) * cv;
    if (Math.min(w, d) < 2.4 || best.a < Math.max(10, area * .12)) break;
    for (let i = best.i0; i <= best.i1; i++) for (let j = best.j0; j <= best.j1; j++) grid[i * nv + j] = 2;
    covered += best.a;
    const u0 = -box.hu + best.i0 * cu, u1 = -box.hu + (best.i1 + 1) * cu, v0 = -box.hv + best.j0 * cv, v1 = -box.hv + (best.j1 + 1) * cv;
    const r = frame(box.ux, box.uz, u0, u1, v0, v1);
    r.cx += box.cx; r.cz += box.cz;
    rects.push(r);
  }
  return { rects, cover: covered / area, box };
}

/** Footprint archetype and floor count (most map buildings are just "house" with no levels). */
const MAP_KIND = { church: 'church', chapel: 'chapel', apartments: 'block', hotel: 'block', public: 'public', garage: 'shed',
  shed: 'shed', barn: 'barn', farm: 'farmhouse', ruin: 'ruin', chalet: 'chalet', industrial: 'works', commercial: 'village' };
const SIZE = {   // area range (m²) and fewest neighbours (within 35 m) for each house archetype
  shed: [0, 30, 0], mazot: [26, 55, 0], cottage: [34, 150, 0], village: [45, 320, 4], farmhouse: [105, 700, 0],
  chalet: [55, 380, 0], block: [260, 1e9, 0] };
function archetypeOf(b, area, aspect, dens, style, r) {
  if (MAP_KIND[b.kind]) return MAP_KIND[b.kind] === 'village' && area > 400 ? 'works' : MAP_KIND[b.kind];
  if (b.levels >= 4) return 'block';
  if (area < 26) return 'shed';
  const w = {};
  for (const [k, wt] of Object.entries(style.archetypes)) {
    const sz = SIZE[k]; if (!sz || !wt) continue;
    if (area < sz[0] || area > sz[1] || dens < sz[2]) continue;
    let f = wt;
    if (k === 'farmhouse') f *= (aspect > 1.3 ? 1.3 : .5) * (dens > 9 ? .3 : 1);
    if (k === 'mazot' && dens > 6) f *= .2;
    if (k === 'village') f *= Math.min(2, dens / 5);
    if (k === 'cottage' && dens > 7) f *= .6;
    w[k] = f;
  }
  // nothing fits the size: the style's own main kind (a long mapped row stays a row), else a block or a cottage
  const main = Object.entries(style.archetypes).filter(([k, v]) => v > 0 && k !== 'shed').sort((a, b) => b[1] - a[1])[0]?.[0];
  return pick(w, r) || (main && (main !== 'block' || area > 200) ? main : area > 200 ? 'block' : 'cottage');
}

const FLOORS = {
  shed: () => 1, mazot: () => 1, ruin: () => 1, barn: () => 2, church: () => 1, chapel: () => 1,
  cottage: (a, r) => a < 60 ? 1 + (r < .35 ? 1 : 0) : 2, village: (a, r, dens) => 2 + (dens > 8 || r < .4 ? 1 : 0) + (a > 200 && r < .3 ? 1 : 0),
  farmhouse: () => 2, chalet: (a, r) => 2 + (a > 160 && r < .6 ? 1 : 0), public: (a, r) => 2 + (r < .5 ? 1 : 0),
  block: (a, r) => Math.min(8, 4 + Math.floor(r * 2.4) + (a > 500 ? 1 : 0)), works: () => 1,
};

/**
 * Plan every building: footprint plan (planFootprints) + the scene → recipes, sorted along the road.
 * `index` is the route index (road clearance and which way each house faces), `opts` the scene's buildingKit.
 */
export function planBuildings(...args) { return drain(planBuildingsJob(...args)); }
/** planBuildings as a job ([F30]: js/world/toolbox/core/jobs.js). */
export function* planBuildingsJob(plan, config, index, opts = {}, tierIndex = null) {
  const kit = { detailM: 120, dressingM: 70, ...opts };
  const styles = (kit.styles?.length ? kit.styles : [{}]).map(resolveStyle);
  // a style can be limited to some kinds of map building ("kinds": ["rowhouse"]): cities pick by kind, routes by stretch
  const fits = (st, kind) => !st.kinds || st.kinds.includes(kind);
  const styleAt = (s, kind) => styles.find((st) => fits(st, kind) && s >= st.fromM && s < st.toM) || styles.find((st) => fits(st, kind)) || styles[0];
  const seed0 = ((config.seed || 1) * 7919 + 31) | 0;
  // neighbour grid (35 m density, 30 m scheme rule)
  const G = 40, grid = new Map(), key = (x, z) => `${Math.floor(x / G)},${Math.floor(z / G)}`;
  // every footprint is a neighbour (density, party walls, clearances); only plan.buildings are planned
  for (const b of [...plan.buildings, ...(plan.neighbours || [])]) { const k = key(b.x, b.z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(b); if (due()) yield; }
  const around = (x, z, r, fn) => {
    const i0 = Math.floor((x - r) / G), i1 = Math.floor((x + r) / G), j0 = Math.floor((z - r) / G), j1 = Math.floor((z + r) / G);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const o of grid.get(`${i},${j}`) || []) if (Math.hypot(o.x - x, o.z - z) < r) fn(o);
  };
  // detail tiers (a city): 40 m cells within reach of the route, so far buildings skip the nearest-point search
  const tierR = Math.max(kit.detailM, kit.dressingM) + 10, tierCells = new Set();
  if (tierIndex) {
    const c = 40, r = Math.ceil((tierR + c) / c);
    for (let i = 0; i < tierIndex.xs.length; i += 4) {
      if (due()) yield;
      const cx = Math.floor(tierIndex.xs[i] / c), cz = Math.floor(tierIndex.zs[i] / c);
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) tierCells.add((cx + dx) * 100003 + (cz + dz));
    }
  }
  const nearTier = (x, z) => tierCells.has(Math.floor(x / 40) * 100003 + Math.floor(z / 40));
  // the map has some buildings twice (or a part drawn over its whole): keep the bigger, drop what overlaps it
  const dup = new Set();
  if (due()) yield;
  const bySize = plan.buildings.slice().sort((a, b) => Math.abs(polyArea(b.pts)) - Math.abs(polyArea(a.pts)));
  if (due()) yield;
  const kept = [];
  const keptGrid = new Map();
  for (const b of bySize) {
    if (due()) yield;
    let hit = false;
    const i0 = Math.floor((b.x - b.r - 45) / G), i1 = Math.floor((b.x + b.r + 45) / G), j0 = Math.floor((b.z - b.r - 45) / G), j1 = Math.floor((b.z + b.r + 45) / G);
    for (let i = i0; i <= i1 && !hit; i++) for (let j = j0; j <= j1 && !hit; j++) for (const o of keptGrid.get(`${i},${j}`) || []) {
      if (Math.hypot(o.x - b.x, o.z - b.z) > o.r + b.r) continue;
      if (inside(b.x, b.z, o.pts) || inside(o.x, o.z, b.pts) || b.pts.filter(([x, z]) => inside(x, z, o.pts)).length > b.pts.length / 2) { hit = true; break; }
    }
    if (hit) { dup.add(b); continue; }
    kept.push(b); const k = key(b.x, b.z); if (!keptGrid.has(k)) keptGrid.set(k, []); keptGrid.get(k).push(b);
  }
  const out = [];
  const done = new Map();   // building → recipe (for the neighbour rule)
  const sorted = plan.buildings.filter((b) => !dup.has(b)).sort((a, b) => a.s - b.s);
  for (let n = 0; n < sorted.length; n++) {
    if (due()) yield;
    const b = sorted[n];
    const rand = randomSequence(seed0 ^ Math.imul(Math.round(b.x * 10) | 0, 73856093) ^ Math.imul(Math.round(b.z * 10) | 0, 19349663));
    const style = styleAt(b.s, b.kind);
    const area = Math.abs(polyArea(b.pts));
    const dec = decompose(b.pts);
    if (!dec) continue;
    let dens = 0; around(b.x, b.z, 35, () => dens++); dens--;
    const near = index.nearest(b.x, b.z, 60) || index.nearest(b.x, b.z, 200) || index.nearest(b.x, b.z, 600);
    const d = near ? near.d : 600;
    const toRoad = near ? norm(index.xs[near.i] - b.x, index.zs[near.i] - b.z) : { x: 0, z: 1 };
    const main = dec.rects[0] || dec.box;
    const aspect = main.hu / Math.max(.5, main.hv);
    const landmark = (config.buildings?.landmarks || []).find((l) => l.name && b.name && b.name.includes(l.name));
    const archetype = landmark?.shape === 'tent' ? 'tent' : archetypeOf(b, area, aspect, dens, style, rand());
    // detail tiers by distance to the ride (a city: the route, while fronts and clearances use every street)
    const tn = tierIndex ? (nearTier(b.x, b.z) ? tierIndex.nearest(b.x, b.z, tierR) : null) : near;
    const dTier = tierIndex ? (tn ? tn.d : 1e4) : d;
    const full = dTier < kit.detailM;
    const R = {
      id: n, x: b.x, z: b.z, s: b.s, d, dTier, r: b.r, pts: b.pts, area, dens, toRoad, archetype, kind: b.kind, name: b.name, full, key: b.key,
      rects: dec.cover >= .74 ? dec.rects : [], outline: dec.cover < .74, seed: rand(),
    };
    // rows: which walls of the main block stand against a neighbour (no windows there); the ridge runs along the street
    R.party = [false, false, false, false];
    if (style.attached && R.rects.length) {
      const partyOf = (r) => [0, 1, 2, 3].map((i) => {
        const n2 = i === 0 ? [-r.vx, -r.vz] : i === 2 ? [r.vx, r.vz] : i === 1 ? [r.ux, r.uz] : [-r.ux, -r.uz];
        const t = [n2[1], -n2[0]], out = (i % 2 === 0 ? r.hv : r.hu) + .7, along = i % 2 === 0 ? r.hu : r.hv;
        let hits = 0;
        for (const f of [-.5, 0, .5]) {
          const x = r.cx + n2[0] * out + t[0] * f * along, z = r.cz + n2[1] * out + t[1] * f * along;
          let hit = false; around(x, z, 40, (o) => { if (!hit && o !== b && Math.hypot(o.x - x, o.z - z) <= o.r + 1 && inside(x, z, o.pts)) hit = true; });
          if (hit) hits++;
        }
        return hits >= 2;
      });
      let P0 = partyOf(R.rects[0]);
      if ((P0[0] || P0[2]) && !(P0[1] && P0[3])) {
        // party walls along the long sides: turn the block so the ridge runs between them, along the street
        const r = R.rects[0];
        R.rects[0] = { cx: r.cx, cz: r.cz, ux: r.vx, uz: r.vz, vx: -r.ux, vz: -r.uz, hu: r.hv, hv: r.hu };
        P0 = partyOf(R.rects[0]);
      }
      R.party = P0;
      R.attached = P0.some(Boolean);
    }
    const m0 = R.rects[0] || main;   // the main block (turned for rows)
    // the three knobs
    R.age = lerp(style.age[0], style.age[1], rand());
    R.upkeep = archetype === 'ruin' ? 0 : lerp(style.upkeep[0], style.upkeep[1], rand());
    R.wealth = rand();
    R.hero = dens >= 4 && rand() < .07 && ['village', 'cottage', 'public', 'chalet'].includes(archetype);
    if (R.hero) R.upkeep = Math.max(R.upkeep, .85);
    R.wear = clamp(R.age * .55 + (1 - R.upkeep) * .75 - .15, 0, 1);
    // storeys
    R.floors = b.levels || (FLOORS[archetype] || FLOORS.cottage)(area, rand(), dens);
    R.floorH = archetype === 'block' ? 2.85 : archetype === 'village' || archetype === 'public' ? 3.15 : archetype === 'church' ? 9 + rand() * 3
      : archetype === 'chapel' ? 5 : archetype === 'shed' ? 2.5 + rand() * .5 : archetype === 'mazot' ? 2.4 : 3;
    if (b.height && b.height > 2) R.floors = Math.max(1, Math.round(b.height * .8 / R.floorH));
    // colours: a scheme no neighbour within 30 m already has (with the same archetype), then a small jitter
    const schemes = style.schemes;
    const used = new Set();
    around(b.x, b.z, 30, (o) => { const q = done.get(o); if (q && q.style === style) used.add(q.schemeIx); });
    let si = Math.floor(rand() * schemes.length);
    for (let t = 0; t < schemes.length && used.has(si); t++) si = (si + 1) % schemes.length;
    R.schemeIx = si; R.style = style;
    R.scheme = schemes[si];
    // walls
    const wallName = archetype === 'mazot' ? 'logs' : archetype === 'shed' || archetype === 'barn' ? pick(style.barn, rand())
      : archetype === 'works' ? 'metal' : archetype === 'block' ? (style.walls.concrete && rand() < .5 ? 'concrete' : 'render')
      : archetype === 'church' || archetype === 'chapel' ? (rand() < .4 ? 'rubble' : 'render') : pick(style.walls, rand());
    R.wall = WALLS[wallName] ?? S.RENDER;
    R.rendered = R.wall === S.RENDER || R.wall === S.ROUGH;
    R.plinth = R.rendered && rand() < style.plinth ? .7 + rand() * .5 : archetype === 'mazot' ? 1.1 : archetype === 'chalet' ? 1.2 : 0;
    const upperName = archetype === 'chalet' ? (pick(style.upper, rand()) || 'boards') : archetype === 'block' ? null : rand() < sum(style.upper) ? pick(style.upper, rand()) : null;
    R.upper = upperName && R.floors >= 2 ? WALLS[upperName] : null;
    R.upperFrom = archetype === 'chalet' && R.floors >= 3 && rand() < .5 ? 2 : 1;
    const gableName = rand() < sum(style.gable) ? pick(style.gable, rand()) : null;
    R.gable = archetype === 'chalet' || archetype === 'barn' || archetype === 'mazot' ? S.BOARDS : gableName ? WALLS[gableName] : null;
    // farmhouses: a house end and a barn end under one roof
    if (archetype === 'farmhouse' && R.rects.length) {
      const split = .38 + rand() * .2;
      R.barnEnd = rand() < .5 ? -1 : 1;   // which end of the main block is the barn
      R.barnSplit = split;
      R.barnWall = WALLS[pick(style.barn, rand())] ?? S.BOARDS;
    }
    // roof
    const roofName = archetype === 'works' ? 'corrugated' : archetype === 'block' && style.roofs.flat && rand() < .5 ? 'flat' : pick(style.roofs, rand());
    R.roof = ROOFS[roofName] ?? S.R_TILE;
    R.roofColor = R.scheme.roof || pickArr(ROOF_COLORS[roofName] || ROOF_COLORS.tile, rand());
    let form = archetype === 'shed' ? (rand() < .55 ? 'shed' : 'gable') : archetype === 'works' || roofName === 'flat' ? 'flat'
      : archetype === 'church' || archetype === 'chapel' ? 'gable' : archetype === 'block' ? (rand() < .6 ? 'hip' : 'gable') : pick(style.forms, rand()) || 'gable';
    if (form === 'stepped' && (m0.hv < 3 || archetype === 'chalet')) form = 'gable';
    R.form = form;
    const pitchDeg = archetype === 'block' && form !== 'flat' ? Math.min(style.pitch, 24) : archetype === 'church' ? Math.max(style.pitch, 42)
      : archetype === 'shed' && form === 'shed' ? 14 : style.pitch + (rand() - .5) * 2 * style.pitchJitter;
    R.pitch = pitchDeg * Math.PI / 180;
    R.eave = archetype === 'shed' ? .3 : archetype === 'chalet' ? Math.max(style.eaveM, .9) : style.eaveM * (.8 + rand() * .4);
    R.rake = archetype === 'shed' ? .2 : archetype === 'chalet' ? Math.max(style.rakeM, .8) : style.rakeM * (.8 + rand() * .4);
    if (form === 'stepped') R.rake = 0;
    // windows and their dressing
    R.windows = archetype === 'church' || archetype === 'chapel' ? W.CHURCH : archetype === 'block' ? (rand() < .6 ? W.RESORT : WINDOW_SETS[style.windows] || W.FRENCH)
      : archetype === 'barn' || archetype === 'shed' || archetype === 'works' ? W.BARN : archetype === 'mazot' ? W.FARM
      : archetype === 'chalet' ? W.CHALET : archetype === 'farmhouse' && rand() < .4 ? W.FARM : WINDOW_SETS[style.windows] || W.FRENCH;
    R.shutters = R.windows !== W.RESORT && R.windows !== W.CHURCH && R.windows !== W.BARN && rand() < style.shutters;
    R.surrounds = R.rendered && (R.hero || rand() < style.surrounds);
    R.quoins = R.rendered && (R.hero || rand() < style.quoins);
    R.flowerBoxes = R.hero || rand() < style.flowerBoxes * (.4 + R.upkeep * .8);
    R.genoise = R.rendered && form !== 'flat' && rand() < style.genoise;
    R.ivy = rand() < style.ivy * (.3 + R.age);
    // front: the wall facing the road (chalets: a gable end); the door goes there
    R.front = frontWall(m0, toRoad, archetype === 'chalet' || (!R.attached && rand() < (style.frontEnd || 0)), R.party);
    R.lintels = (R.wall === S.BRICK || R.wall === S.RENDER) && rand() < style.lintels;
    if (R.party[1] || R.party[3]) R.rake = 0;
    R.shop = archetype === 'village' && d < 18 && rand() < style.shops && R.front % 2 === 0;
    // extras (the silhouette: only buildings near the road get them)
    const P = R.parts = {};
    const can = full && R.rects.length > 0 && archetype !== 'ruin';
    const two = R.floors >= 2;
    if (can && two && ['chalet', 'cottage', 'village', 'block', 'farmhouse'].includes(archetype)) {
      const pb = archetype === 'block' ? .85 : archetype === 'chalet' ? Math.max(style.balconies, .7) : style.balconies * (archetype === 'village' ? .6 : 1);
      if (rand() < pb) P.balcony = { side: archetype === 'chalet' ? (R.front % 2 ? R.front : 3) : R.front, full: archetype === 'block' || rand() < .45, wrap: archetype === 'chalet' && rand() < .4 };
      if (archetype === 'chalet' || archetype === 'farmhouse' || archetype === 'cottage') if (rand() < style.galleries) P.gallery = { end: rand() < .5 ? 1 : 3 };
    }
    if (can && form !== 'flat' && form !== 'shed' && m0.hv > 3.5 && pitchDeg > 28 && archetype !== 'block' && rand() < style.dormers * (archetype === 'village' ? 1.4 : 1))
      P.dormers = 1 + Math.floor(rand() * Math.min(3, m0.hu / 3));
    if (form !== 'flat' && !['shed', 'barn', 'works', 'mazot', 'church', 'chapel'].includes(archetype) && rand() < style.chimneys)
      P.chimneys = { n: m0.hu > 6 && rand() < .35 ? 2 : 1, kind: archetype === 'chalet' && rand() < .5 ? 'pipe' : R.wall === S.RUBBLE || rand() < .4 ? 'stone' : 'render' };
    if (can && form !== 'flat' && rand() < style.solar * (1.4 - R.age)) P.solar = true;
    if (can && ['cottage', 'farmhouse', 'village', 'chalet'].includes(archetype) && rand() < style.leanTo) P.leanTo = { end: rand() < .5 ? 1 : 3, open: rand() < .5 };
    if (can && ['cottage', 'chalet'].includes(archetype) && !P.leanTo && rand() < style.garage) P.garage = { end: rand() < .5 ? 1 : 3 };
    if (can && R.floors <= 3 && ['cottage', 'village', 'farmhouse', 'chalet'].includes(archetype) && rand() < style.frontPorch) P.frontPorch = { depth: 2.1 + rand() * .7, roof: rand() < .7 };
    if (can && !P.frontPorch && archetype !== 'block' && archetype !== 'works' && rand() < style.porch) P.porch = true;
    if (can && archetype === 'farmhouse' && rand() < style.stair * 2) P.stair = true;
    if (can && R.rendered && ['cottage', 'village', 'farmhouse', 'public'].includes(archetype) && rand() < style.sundial * (R.hero ? 5 : 1)) P.sundial = true;
    if (archetype === 'church') P.tower = { end: rand() < .5 ? 1 : 3 };
    // nothing that sticks out may reach the road or another building: try the other end, else leave it off
    const clear = (pts, margin = 1.5) => pts.every(([x, z]) => !index.nearest(x, z, ROAD_HALF + margin) && !insideOther(x, z, b));
    const insideOther = (x, z, self) => { let hit = false; around(x, z, 40, (o) => { if (!hit && o !== self && Math.hypot(o.x - x, o.z - z) <= o.r && inside(x, z, o.pts)) hit = true; }); return hit; };
    const endBox = (end, depth, half) => { const sgn = end === 1 ? 1 : -1; return [[0, -half], [0, half], [1, -half], [1, half], [.5, 0]].map(([t, bb]) => [m0.cx + m0.ux * sgn * (m0.hu + t * depth) + m0.vx * bb, m0.cz + m0.uz * sgn * (m0.hu + t * depth) + m0.vz * bb]); };
    for (const k of ['leanTo', 'garage', 'gallery', 'tower']) {
      const o = P[k]; if (!o) continue;
      const depth = k === 'tower' ? 6 : 3.6, half = k === 'gallery' ? m0.hv : 3.3;
      const key = k === 'gallery' || k === 'tower' || k === 'leanTo' || k === 'garage' ? 'end' : 'end';
      if (clear(endBox(o[key], depth, half))) continue;
      o[key] = o[key] === 1 ? 3 : 1;
      if (!clear(endBox(o[key], depth, half))) delete P[k];
    }
    const sideBox = (i, depth) => {
      const n = i === 0 ? [-m0.vx, -m0.vz] : i === 2 ? [m0.vx, m0.vz] : i === 1 ? [m0.ux, m0.uz] : [-m0.ux, -m0.uz];
      const out = i % 2 === 0 ? m0.hv : m0.hu, along = i % 2 === 0 ? m0.hu : m0.hv, t = [n[1], -n[0]];
      return [-.8, 0, .8].map((f) => [m0.cx + n[0] * (out + depth) + t[0] * f * along, m0.cz + n[1] * (out + depth) + t[1] * f * along]);
    };
    if (P.balcony && !clear(sideBox(P.balcony.side, 1.5))) {
      const alt = (P.balcony.side + 2) % 4;
      if (clear(sideBox(alt, 1.5))) P.balcony.side = alt; else delete P.balcony;
    }
    if (P.stair && !clear(sideBox(R.front, 1.4))) delete P.stair;
    // a porch may come up to the sidewalk
    if (P.frontPorch && !clear(sideBox(R.front, P.frontPorch.depth + .3), .3)) { delete P.frontPorch; if (can && rand() < style.porch) P.porch = true; }
    R.dress = dTier < kit.dressingM && !['works', 'ruin'].includes(archetype);
    out.push(R);
    done.set(b, R);
  }
  return { buildings: out, styles, kit, duplicates: dup.size };
}

/** Which wall of the main block faces the road: 0 (−v long side), 1 (+u end), 2 (+v long side), 3 (−u end). */
export function frontWall(r, to, preferEnd = false, party = null) {
  const dots = [-(r.vx * to.x + r.vz * to.z), r.ux * to.x + r.uz * to.z, r.vx * to.x + r.vz * to.z, -(r.ux * to.x + r.uz * to.z)];
  if (party) for (let i = 0; i < 4; i++) if (party[i]) dots[i] = -9;   // never against a neighbour
  if (preferEnd && !(party && (party[1] || party[3]))) return dots[1] > dots[3] ? 1 : 3;
  let best = 0;
  for (let i = 1; i < 4; i++) if (dots[i] > dots[best] + (i % 2 ? .25 : 0)) best = i;   // long sides first
  return best;
}

const norm = (x, z) => { const L = Math.hypot(x, z) || 1; return { x: x / L, z: z / L }; };
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sum = (o) => Object.values(o || {}).reduce((a, v) => a + v, 0);
const pickArr = (arr, r) => arr[Math.floor(r * arr.length) % arr.length];

/** Window bays along a wall: the count and exact bay width, so windows sit symmetrically. */
export function bays(len, set) {
  const bw = (WINDOW_BAY[set] || WINDOW_BAY[W.FRENCH])[1];
  const n = Math.max(1, Math.floor(len / bw + .25));
  return { n, w: len / n };
}
