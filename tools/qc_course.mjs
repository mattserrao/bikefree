#!/usr/bin/env node
// Course QC: ride the full length of each route, metre by metre, and flag discontinuities.
//
//   node tools/qc_course.mjs                  every scenic route (+ Demo Hills)
//   node tools/qc_course.mjs teton zion       just these
//   node tools/qc_course.mjs --gpx my.gpx     your own GPX (path checks only, no scenery)
//   options: --step 1  --html tools/qc-report.html  --json out.json  --strict (warnings also fail)
//
// It uses the app's own code (route building, mirroring, rider placement, scenery height
// functions, the ground-patch mesh layout), so it checks what you actually ride and see.
// Exit code 1 when any FAIL finding exists (or any WARN with --strict).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { parseGpx, haversine } from '../js/gpx.js';
import { buildCatalogRoute } from '../js/routes.js';
import { parseTerrainGrid } from '../js/terrain-grid.js';
import { gunzipSync } from 'node:zlib';
import { makeProjection, makeRouteIndex } from '../js/world/geo.js';
import { attachTerrainBuffer } from '../js/world/terrain-data.js';
import { planSettlement } from '../js/world/toolbox/structures/settlement.js';
import { cityStreets, STREET_LIFT } from '../js/world/toolbox/city/landscape.js';
import { streetOverlaps, drawnLiftMax, routeLine } from '../js/world/toolbox/city/junctions.js';   // [junctions]
import { roadMeets, streetSlots, MEET_LIMITS } from '../js/world/toolbox/city/road-meets.js';   // [junctions]
import { normalizeScene } from '../js/world/toolbox/scene-schema.js';
import { landscapeBuilder } from '../js/world/toolbox/landscape/index.js';
import { riderPose, routePoint, ROAD_WIDTH, ROAD_LIFT, CHASE } from '../js/world/pose.js';
import { alignmentChecks } from './qc_alignment.mjs';   // [road-align]
import { groundDrape, DRAPE_MAX_DROP } from '../js/world/toolbox/landscape/ground-drape.js';   // [w2-align]

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// ---------- Thresholds (all distances in metres) ----------
export const LIMITS = {
  // Ridden path (rider pose, every `step` metres, both directions, across the lap seam)
  posJump: 0.6,           // FAIL: rider moves this much further than the step in one step
  heightStep: 0.35,       // FAIL: rider height changes more than this per metre (35 % — a ledge)
  headingWarn: 10,        // WARN: heading turns faster than this (°/m ≈ 6 m radius)
  headingFail: 25,        // FAIL: heading snaps (°/m) outside a planned U-turn
  // Elevation profile (10 m samples, what the trainer feels)
  gradeStepWarn: 3,       // WARN: grade changes this many %-points between 10 m samples
  gradeStepFail: 6,       // FAIL: …or this many (a resistance jolt)
  gradeClamp: 24.9,       // WARN: grade pinned at the ±25 % limit
  gradeMismatch: 1.5,     // FAIL: stored grade disagrees with the elevation it was built from
  // Source GPX
  rawGap: 60,             // WARN: GPX points this far apart (straight chord, may cut a bend)
  rawSpike: 6,            // WARN: one GPX point this far off its neighbours' elevation
  rawHairpin: 150,        // WARN: GPX doubles back this sharply (°) on short segments
  rawHairpinSeg: 30,
  // Drawn road (10 m polyline)
  jog: 12,                // WARN: opposite turns of more than this (°) on consecutive 10 m segments (sideways zig-zag)
  // Stylized scenery around the road (outbound road, every 2 m)
  buried: 0.03,           // FAIL: rendered ground this close to (or above) the road / shoulder surface
  floating: 3,            // WARN: ground this far below the shoulder edge (not on a bridge)
  wall: 3,                // WARN: ground this far above the road 8 m out (wall at the road edge)
  vergeStep: 1.0,         // WARN: ground 6 m out jumps this much between 2 m samples
  meshAlias: 1.0,         // WARN: drawn ground (6 m mesh) differs this much from the scenery's true height 6 m out
  flooded: 0.2,           // FAIL: water within this of the road surface
  cameraLift: 0.75,
  padGap: 0.6,            // WARN: an overlook pad's underside this far above the drawn ground
  padBuried: 0.25,        // WARN: the drawn ground this far above an overlook pad's surface       // WARN: chase camera pushed up this far by the ground (visible camera jump)
};

const SHOULDER_HALF = (ROAD_WIDTH + 1.6) / 2;   // stylized shoulder ribbon (world.js)
const SHOULDER_LIFT = 0.05;
const PATCH = 96, PATCH_CELLS = 16;              // finest stylized ground patch (stylized-terrain.js)

// ---------- Helpers ----------
const deg = (r) => (r * 180) / Math.PI;
const angleBetween = (a, b) => deg(Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.z * b.z))));

/** Ground as the stylized patch mesh draws it: 6 m grid, triangles (a,d,b) and (b,d,e). */
function makeMeshGround(heightAt, fineCells = PATCH_CELLS, fineAt = null, landscape = null) {
  // [w2-align] city patches are draped off the streets (js/world/toolbox/landscape/ground-drape.js): model each 96 m patch the same way
  if (landscape?.groundClearPoints) {
    // (a patch the landscape asks to draw finer — groundMesh.fineCells along a city's fineRanges — as stylized-terrain.js builds it)
    const patches = new Map();
    const patch = (pi, pj) => {
      const key = pi * 1e7 + pj;
      let h = patches.get(key);
      if (!h) {
        const x0 = pi * PATCH, z0 = pj * PATCH, S = fineAt && fineAt(x0 + 1, z0 + 1) ? fineCells : PATCH_CELLS, cell = PATCH / S, N = S + 1;
        h = new Float64Array(N * N); h.S = S;
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) h[j * N + i] = heightAt(x0 + i * cell, z0 + j * cell);
        const d = groundDrape(h, x0, z0, cell, S, heightAt, { maxDrop: DRAPE_MAX_DROP, fixed: landscape.groundDrapeFixed, last: landscape.groundDrapeLast });
        d.add(landscape.groundClearPoints(x0, z0, x0 + PATCH, z0 + PATCH, Math.max(2, cell / 3))); d.apply();
        patches.set(key, h);
      }
      return h;
    };
    return (x, z) => {
      const pi = Math.floor(x / PATCH), pj = Math.floor(z / PATCH), h = patch(pi, pj), S = h.S, cell = PATCH / S, N = S + 1;
      const u = (x - pi * PATCH) / cell, w = (z - pj * PATCH) / cell;
      const i = Math.min(S - 1, Math.floor(u)), j = Math.min(S - 1, Math.floor(w)), fu = u - i, fw = w - j;
      const a = h[j * N + i], b = h[j * N + i + 1], d = h[(j + 1) * N + i], e = h[(j + 1) * N + i + 1];
      return fu + fw <= 1 ? a + (b - a) * fu + (d - a) * fw : e + (d - e) * (1 - fu) + (b - e) * (1 - fw);
    };
  }
  const caches = new Map();
  const v = (cell, i, j) => {
    const cache = caches.get(cell) || caches.set(cell, new Map()).get(cell), key = i * 1e7 + j;
    let h = cache.get(key);
    if (h === undefined) { h = heightAt(i * cell, j * cell); cache.set(key, h); }
    return h;
  };
  return (x, z) => {
    // the patch's own cell size: finer where the landscape asks for it (hairpins)
    const fine = fineAt && fineAt(Math.floor(x / PATCH) * PATCH + 1, Math.floor(z / PATCH) * PATCH + 1);
    const cell = PATCH / (fine ? fineCells : PATCH_CELLS);
    const gi = Math.floor(x / cell), gj = Math.floor(z / cell);
    const u = x / cell - gi, w = z / cell - gj;
    const a = v(cell, gi, gj), b = v(cell, gi + 1, gj), d = v(cell, gi, gj + 1), e = v(cell, gi + 1, gj + 1);
    return u + w <= 1 ? a + (b - a) * u + (d - a) * w : e + (d - e) * (1 - u) + (b - e) * (1 - w);
  };
}

class Findings {
  constructor() { this.list = []; this.open = new Map(); }
  /** Record a flagged sample; consecutive samples of the same check merge into one finding. */
  add(check, severity, s, value, note, merge = 60) {
    const key = `${check}|${severity}`;
    const f = this.open.get(key);
    if (f && s - f.to <= merge) {
      f.to = s; f.count++;
      if (Math.abs(value) > Math.abs(f.value)) { f.value = value; f.at = s; }
      return;
    }
    const nf = { check, severity, from: s, to: s, at: s, value, count: 1, note };
    this.list.push(nf); this.open.set(key, nf);
  }
}

// ---------- The sweep ----------
export function qcRoute({ id, name, gpxText, item = {}, scene = null, step = 1 }) {
  const raw = parseGpx(gpxText).points;
  const route = buildCatalogRoute(gpxText, item);
  if (scene) route.scene = scene;
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (let i = 0; i < route.lat.length; i++) {
    minLat = Math.min(minLat, route.lat[i]); maxLat = Math.max(maxLat, route.lat[i]);
    minLon = Math.min(minLon, route.lon[i]); maxLon = Math.max(maxLon, route.lon[i]);
  }
  const o = scene?.origin;   // (a city's areas: the city's frame, PLAN 5.4)
  const proj = o ? makeProjection(o.lat, o.lon) : makeProjection((minLat + maxLat) / 2, (minLon + maxLon) / 2);   // as world.js
  const index = makeRouteIndex(route, proj);
  const F = new Findings();
  const total = route.total, turn = route.turnS, oneWay = turn || total;
  // a ride network's spur turns round where its ghost begins (js/world/ghost.js): a planned U-turn too
  const tips = (scene?.city?.routeGhosts || []).flatMap((g) => [g.fromM, g.toM]);
  const nearTip = (s, r) => { const x = turn && s > turn ? total - s : s; return tips.some((t) => Math.abs(x - t) < r); };
  const nearUturn = (s, r) => (!!turn && (Math.abs(s - turn) < r || s < r || total - s < r)) || nearTip(s, r);
  const series = { s: [], ele: [], grade: [], heading: [], clearance: [], cs: [] };

  // 1. Source GPX (positions are distance along the ride; the far end of an out-and-back GPX is a planned U-turn)
  let rawGapMax = 0, cum = 0;
  for (let i = 1; i < raw.length; i++) {
    const a = raw[i - 1], b = raw[i], d = haversine(a, b);
    const sa = Math.min(total, cum); cum += d;
    const sb = Math.min(total, cum);
    rawGapMax = Math.max(rawGapMax, d);
    if (d > LIMITS.rawGap) F.add('gpx-gap', 'warn', sa, d, 'GPX points far apart: the road is a straight chord here', 0);
    if (i === raw.length - 1) continue;
    const c = raw[i + 1];
    if ([a.ele, b.ele, c.ele].every(Number.isFinite)) {
      const spike = b.ele - (a.ele + c.ele) / 2;
      if (Math.abs(spike) > LIMITS.rawSpike && Math.abs(a.ele - c.ele) < LIMITS.rawSpike) F.add('gpx-spike', 'warn', sb, spike, 'one GPX point off its neighbours’ elevation', 0);
    }
    const d2 = haversine(b, c);
    if (d < LIMITS.rawHairpinSeg && d2 < LIMITS.rawHairpinSeg && d > 0.5 && d2 > 0.5) {
      const pa = proj.toLocal(a.lat, a.lon), pb = proj.toLocal(b.lat, b.lon), pc = proj.toLocal(c.lat, c.lon);
      const u = { x: pb.x - pa.x, z: pb.z - pa.z }, w = { x: pc.x - pb.x, z: pc.z - pb.z };
      const lu = Math.hypot(u.x, u.z), lw = Math.hypot(w.x, w.z);
      const turnDeg = angleBetween({ x: u.x / lu, z: u.z / lu }, { x: w.x / lw, z: w.z / lw });
      if (turnDeg > LIMITS.rawHairpin) F.add('gpx-hairpin', nearUturn(sb, 30) ? 'info' : 'warn', sb, turnDeg, nearUturn(sb, 30) ? 'turnaround at the end of the GPX (expected)' : 'GPX doubles back on itself (spur or zig-zag)', 0);
    }
  }
  const closureGap = raw.length > 2 ? haversine(raw[0], raw[raw.length - 1]) : 0;
  F.open.clear();

  // 2. Elevation profile at 10 m (what the trainer feels), full ridden length incl. the seam
  const n = route.dist.length - 1;           // last sample == start again on a closed route
  for (let i = 0; i < n; i++) {
    const j = i + 1 < n ? i + 1 : (route.closed ? 0 : i);
    const s = route.dist[i];
    const g = route.grade[i], dg = route.grade[j] - g;
    const planned = nearUturn(s, 30);
    if (Math.abs(dg) > LIMITS.gradeStepFail) F.add('grade-step', planned ? 'info' : 'fail', s, dg, planned ? 'grade flips at the U-turn (expected)' : 'grade jumps: resistance jolt');
    else if (Math.abs(dg) > LIMITS.gradeStepWarn) F.add('grade-step', planned ? 'info' : 'warn', s, dg, planned ? 'grade flips at the U-turn (expected)' : 'sharp grade change');
    if (Math.abs(g) >= LIMITS.gradeClamp) F.add('grade-clamp', 'warn', s, g, 'grade pinned at the ±25 % limit');
    if (!planned && Math.abs(g) < LIMITS.gradeClamp) {
      const a = (i - 3 + n) % n, b = (i + 3) % n;
      if (route.closed || (i >= 3 && i + 3 < n)) {
        const slope = ((route.ele[b] - route.ele[a]) / 60) * 100;
        if (Math.abs(slope - g) > LIMITS.gradeMismatch) F.add('grade-mismatch', 'fail', s, g - slope, 'stored grade disagrees with elevation');
      }
    }
  }
  F.open.clear();

  // 2b. Drawn road: sideways zig-zags in the 10 m polyline (the road ribbon kinks; heading barely notices)
  {
    const last = Math.round(oneWay / 10);
    const turnAt = (i) => {
      const t1 = Math.atan2(index.zs[i] - index.zs[i - 1], index.xs[i] - index.xs[i - 1]);
      const t2 = Math.atan2(index.zs[i + 1] - index.zs[i], index.xs[i + 1] - index.xs[i]);
      return ((((t2 - t1) * 180) / Math.PI + 540) % 360) - 180;
    };
    for (let i = 2; i < last - 2; i++) {
      const a = turnAt(i), b = turnAt(i + 1);
      if (a * b < 0 && Math.min(Math.abs(a), Math.abs(b)) > LIMITS.jog) F.add('path-jog', 'warn', route.dist[i], Math.min(Math.abs(a), Math.abs(b)), 'road zig-zags sideways (kink in the road)');
    }
  }
  F.open.clear();

  // 3. Ridden path: rider pose every `step` m over the whole ride, wrapping across the seam
  const stylized = route.scene?.style === 'stylized';
  const landscape = stylized ? landscapeBuilder(route.scene)(route.scene, proj, index, route) : null;
  const ground = landscape ? makeMeshGround(landscape.heightAt, route.scene?.groundMesh?.fineCells, route.scene?.groundMesh?.fineCells ? landscape.fineGroundAt : null, landscape) : null;   // a scene may ask for finer ground (hairpins); [w2-align] landscape: draped city patches
  const bridgeAt = (x, z, m) => !!landscape?.bridgeAt?.(x, z, m);
  let prev = riderPose(route, index, 0), maxHeading = 0, maxJump = 0;
  // A real switchback (Alpe d'Huez's 21 hairpins): the road reverses within ±40 m. Its tight turn is the
  // road itself, not a GPX fault, so it is reported as info; a sharp turn that doesn't reverse still warns.
  const flatDir = (a, b) => { const p = routePoint(route, index, a), q = routePoint(route, index, b), l = Math.hypot(q.x - p.x, q.z - p.z) || 1; return { x: (q.x - p.x) / l, z: (q.z - p.z) / l }; };
  const switchback = (s) => s > 40 && s < total - 40 && angleBetween(flatDir(s - 40, s - 20), flatDir(s + 20, s + 40)) > 120;
  for (let s = step; s <= total + 1e-6; s += step) {
    const cur = riderPose(route, index, s);
    const at = s - step / 2;
    const dh = Math.hypot(cur.pos.x - prev.pos.x, cur.pos.z - prev.pos.z);
    const dy = cur.pos.y - prev.pos.y;
    const turnRate = angleBetween(prev.flat, cur.flat) / step;
    maxJump = Math.max(maxJump, dh - step);
    // (a network spur's tip: the base line turns straight back there; the network rides it with a U-turn curve,
    // checked by tools/qc_network.mjs)
    if (dh - step > LIMITS.posJump) F.add('pose-jump', nearTip(at, 12) ? 'info' : 'fail', at, dh - step, nearTip(at, 12) ? 'spur tip: ridden as a U-turn by the network' : 'rider position jumps');
    if (Math.abs(dy) / step > LIMITS.heightStep) F.add('pose-height', 'fail', at, dy, 'rider height steps');
    if (nearUturn(at, 12)) { if (turnRate > LIMITS.headingWarn) F.add('u-turn', 'info', at, turnRate, 'planned U-turn'); }
    else {
      maxHeading = Math.max(maxHeading, turnRate);
      if (turnRate > LIMITS.headingFail) F.add('heading-snap', 'fail', at, turnRate, 'heading snaps');
      else if (turnRate > LIMITS.headingWarn) {
        if (switchback(at)) F.add('switchback', 'info', at, turnRate, 'hairpin bend (the road doubles back)');
        else F.add('heading-sharp', 'warn', at, turnRate, 'very tight turn');
      }
    }
    if (ground && Math.round(s) % 2 === 0) {
      // chase camera: CHASE.back behind, CHASE.up up, pushed CHASE.ground above the ground (world.js, pose.js)
      const cx = cur.pos.x - cur.flat.x * CHASE.back, cz = cur.pos.z - cur.flat.z * CHASE.back, cy = cur.pos.y + CHASE.up;
      const lift = landscape.heightAt(cx, cz) + CHASE.ground - cy;
      if (lift > LIMITS.cameraLift) F.add('camera-lift', 'warn', s, lift, 'chase camera pushed up by the ground');
    }
    if (Math.round(s) % 10 === 0) { series.s.push(s); series.heading.push(turnRate); }
    prev = cur;
  }
  F.open.clear();
  for (let i = 0; i < route.dist.length; i += 5) { series.ele.push([route.dist[i], route.ele[i]]); series.grade.push([route.dist[i], route.grade[i]]); }

  // 4. Stylized ground around the drawn road (outbound half — the return rides the same road)
  if (ground) {
    const last = { };
    for (let s = 0; s <= oneWay; s += 2) {
      const c = routePoint(route, index, s);
      const ahead = routePoint(route, index, Math.min(oneWay, s + 5)), behind = routePoint(route, index, Math.max(0, s - 5));
      let fx = ahead.x - behind.x, fz = ahead.z - behind.z; const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
      const rx = -fz, rz = fx;
      const road = c.y + ROAD_LIFT, shoulder = c.y + SHOULDER_LIFT;
      const g = (o) => ground(c.x + rx * o, c.z + rz * o);
      const onBridge = bridgeAt(c.x, c.z, 12);
      let clearance = Infinity;
      // (on a switchback the edge probes cross the tight inside of the turn, where the bank between the legs
      // meets the road: only its centre line is checked there)
      const tight = switchback(s);
      for (const o of tight ? [0] : [0, -ROAD_WIDTH / 2, ROAD_WIDTH / 2]) clearance = Math.min(clearance, road - g(o));
      if (!tight) for (const o of [-SHOULDER_HALF, SHOULDER_HALF]) clearance = Math.min(clearance, shoulder - g(o));
      if (clearance < LIMITS.buried) F.add('road-buried', 'fail', s, clearance, 'ground shows through the road');
      // On a hairpin the probes square to the road cross the inside of the turn into the other leg: the ground
      // there is the landscape's bank between the legs (real-terrain.js), so only the road surface is checked.
      // Where another leg of a switchback runs within 40 m, the ground between the legs is the same bank, and the
      // upper road stands on its retaining wall (structures/hairpin-walls.js).
      const hairpin = switchback(s) || switchback(s - 30) || switchback(s + 30) || !!landscape.otherLegNear?.(c.x, c.z);
      if (!onBridge && !hairpin) {
        const drop = Math.max(shoulder - g(-SHOULDER_HALF), shoulder - g(SHOULDER_HALF));
        if (drop > LIMITS.floating) F.add('road-floating', 'warn', s, drop, 'road edge floats above the ground');
        const wall = Math.max(g(-8), g(8)) - road;
        if (wall > LIMITS.wall) F.add('verge-wall', 'warn', s, wall, 'ground rises steeply right at the road edge');
        // ledge right beside the shoulder: compare the same spot 6 m out between 2 m samples
        // (skipped on tight bends, where the 6 m point itself sweeps sideways)
        // [road-align] up to 20 m past a bridge's end the ground beside the road may drop like a cliff (an
        // abutment over a street or a bank): no ledge/mesh checks there (walls are the detail kit's)
        const abutment = bridgeAt(c.x, c.z, 20);
        for (const o of [-6, 6]) {
          const px = c.x + rx * o, pz = c.z + rz * o, h = ground(px, pz), k = `v${o}`, p0 = last[k];
          if (landscape.riverfront?.covers(px, pz)) { last[k] = null; continue; }   // [s1-riverfront] the promenade's walk is drawn over the ground here
          const exact = landscape.heightAt(px, pz);
          if (abutment) { last[k] = null; continue; }
          if (Math.abs(h - exact) > LIMITS.meshAlias) { F.add('mesh-coarse', 'warn', s, h - exact, `ground mesh can’t follow a narrow carve ${Math.abs(o)} m ${o < 0 ? 'left' : 'right'} of the road (jagged edge)`, 150); last[k] = null; continue; }
          if (p0 && Math.hypot(px - p0.x, pz - p0.z) < 4 && Math.abs(h - p0.h - (c.y - last.y)) > LIMITS.vergeStep)
            F.add('verge-step', 'warn', s, h - p0.h - (c.y - last.y), `ground ${Math.abs(o)} m ${o < 0 ? 'left' : 'right'} of the road steps`);
          last[k] = { x: px, z: pz, h };
        }
      } else { last['v-6'] = last.v6 = null; }
      last.y = c.y;
      const water = landscape.waterLevelAt ? landscape.waterLevelAt(c.x, c.z)
        : (landscape.coastX && c.x - landscape.coastX(c.z) < 0 ? 0.05 : -Infinity);
      if (water > road - LIMITS.flooded) F.add('road-flooded', 'fail', s, water - road, 'water at or over the road');
      if (s % 20 === 0) { series.cs.push(s); series.clearance.push(Math.min(clearance, 5)); }
    }
  }

  // 5. Real shorelines and the built world (scenes with baked terrain / forest-edge layout)
  if (landscape?.shoreAt) {
    for (let s = 0; s <= oneWay; s += 5) {
      const c = routePoint(route, index, s);
      if (landscape.shoreAt(c.x, c.z) < 0 && !bridgeAt(c.x, c.z, 4)) F.add('road-in-lake', 'fail', s, -landscape.shoreAt(c.x, c.z), 'road runs through a lake');
    }
    F.open.clear();
    for (const l of route.scene.lookouts || []) {
      const side = l.side === 'inland' ? -1 : 1, water = (sg) => {
        const a = routePoint(route, index, l.atM), b = routePoint(route, index, Math.min(oneWay, l.atM + 5));
        let fx = b.x - a.x, fz = b.z - a.z; const n = Math.hypot(fx, fz) || 1; fx /= n; fz /= n;
        for (let o = 20; o <= 400; o += 20) if (landscape.shoreAt(a.x - fz * o * sg, a.z + fx * o * sg) < 0) return o;
        return Infinity;
      };
      if (water(side) > 400 && water(-side) <= 400) F.add('lake-side', 'warn', l.atM, water(-side), 'lookout faces away from the water');
    }
  }
  if (stylized && (route.scene.towns || route.scene.vegetation?.layout === 'forest-edge')) {
    const plan = planSettlement(route.scene, route, index, landscape);
    for (const it of plan.items) {
      const s = route.dist[index.nearest(it.x, it.z, 400)?.i ?? 0];
      const road = index.nearest(it.x, it.z, 60);
      if (!it.water && road && road.d < it.r * .7 + 5) F.add('building-on-road', 'fail', s, road.d, `${it.asset} within ${road.d.toFixed(1)} m of the road`, 1);
      if (!it.water && landscape.shoreAt && landscape.shoreAt(it.x, it.z) < 0) F.add('building-in-water', 'fail', s, landscape.shoreAt(it.x, it.z), `${it.asset} stands in a lake`, 1);
      if (it.water && landscape.shoreAt && landscape.shoreAt(it.x + Math.sin(it.rot) * 8, it.z + Math.cos(it.rot) * 8) > 0) F.add('dock-on-land', 'warn', s, 0, `${it.asset} does not reach the water`, 1);
    }
    F.open.clear();
  }
  // 4b. Overlooks: the gravel pad should sit on the drawn ground — not float over a drop, not sink into a bank
  if (ground) {
    for (const l of route.scene.lookouts || []) {
      const side = l.side === 'inland' ? -1 : 1, w = l.widthM || 10, len = l.lengthM || 32;
      let gap = 0, buried = 0;
      for (const along of [-len / 2, -len / 4, 0, len / 4, len / 2]) for (const out of [ROAD_WIDTH / 2 + .5, ROAD_WIDTH / 2 + w / 2, ROAD_WIDTH / 2 + w - .5]) {
        const c = routePoint(route, index, Math.max(0, Math.min(oneWay, l.atM + along)));
        const n = routePoint(route, index, Math.min(oneWay, l.atM + along + 2)), p = routePoint(route, index, Math.max(0, l.atM + along - 2));
        let fx = n.x - p.x, fz = n.z - p.z; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
        const padTop = c.y - .35 + .45, padBottom = padTop - .9;   // the pad follows the road's grade
        const g = ground(c.x - fz * side * out, c.z + fx * side * out);
        gap = Math.max(gap, padBottom - g); buried = Math.max(buried, g - padTop);
      }
      if (gap > LIMITS.padGap) F.add('lookout-floating', 'warn', l.atM, gap, 'overlook pad floats above the ground');
      if (buried > LIMITS.padBuried) F.add('lookout-buried', 'warn', l.atM, buried, 'ground rises through the overlook pad');
    }
    F.open.clear();
  }

  let streetStats = null;   // [junctions]
  // 5. City streets drawn over the route: another carriageway, a ramp or a bridge deck above the road
  //    would hide the road and the rider's legs (what the renderer draws, via the shared cityStreets()).
  if (landscape?.city) {
    F.open.clear();
    const hits = [], end = route.turnIdx || route.dist.length - 1;
    const streets = cityStreets(landscape, index, route), plan = landscape._junctions;   // [junctions]
    const slots = plan ? streetSlots(landscape, streets) : null, RLq = plan && routeLine(route, index);   // [junctions] each ribbon's own lift, the road's drawn curve
    streets.forEach((st, k) => {
      for (const p of st.pts) {
        if (p.jn != null) continue;   // [junctions] inside a junction: not drawn (its surface is checked below)
        const r = index.nearest(p.x, p.z, st.width / 2 + ROAD_WIDTH / 2 + 1);
        if (!r) continue;
        const i = r.i > end ? Math.max(0, 2 * end - r.i) : r.i;
        // [road-align] the road as drawn: straight between its 10 m samples, not the nearest sample's height;
        // [junctions] with a junction plan: its curve, and the ribbon's own lift, blended to the junction's
        const rd0 = landscape.routeDist?.(p.x, p.z), e = rd0 && Math.abs(rd0.y - route.ele[i]) < 3 ? rd0.y : route.ele[i];
        const rd = plan && RLq.project(p.x, p.z, route.dist[i], 25), roadY = rd && rd.d < st.width / 2 + ROAD_WIDTH / 2 + 1 ? rd.y : e;
        const over = p.y + drawnLiftMax(p, plan, slots ? .1 + slots[k] * .02 : STREET_LIFT) - (roadY + ROAD_LIFT);
        if (over > -.02 && over < 4) hits.push([route.dist[i], over]);
      }
    });
    hits.sort((a, b) => a[0] - b[0]);
    for (const [hs, over] of hits) F.add('street-over-road', 'fail', hs, over, 'a city street or bridge deck covers the road');
    // [junctions] a junction the route passes through must stay under the road's surface (its corners, every vertex)
    F.open.clear();
    for (const jn of plan?.list || []) {
      for (const p of [jn, ...jn.poly]) {
        const r = landscape.routeDist(p.x, p.z);
        if (!r || r.d > ROAD_WIDTH / 2 + .6) continue;
        // [F15] against the road as drawn (its curve), not the 10 m chords routeDist follows
        // (and every other pass of it there: a street ridden twice draws two roads over each other)
        const q = RLq.project(p.x, p.z, route.dist[Math.min(end, r.i)], 25), low = RLq.lowestNear(p.x, p.z, ROAD_WIDTH / 2 + .6, q ? q.s : route.dist[Math.min(end, r.i)], 60);   // (other passes: 60 m along the road either way is this pass, as the junction planner counts them — on a tight corner up a steep street the pass's own chords before and after the bend lie within reach at other heights)
        const roadY = Math.min(q && q.d < ROAD_WIDTH / 2 + 1.5 ? q.y : r.y, low ?? Infinity);
        const over = (p === jn ? jn.cy : p.y ?? jn.top(p.x, p.z)) - (roadY + ROAD_LIFT);   // [junctions] (the surface as drawn)
        if (over > -.005 && over < 4) F.add('junction-over-road', 'fail', route.dist[r.i], over, 'a junction surface covers the road');   // (4 m and up: a junction on a deck that crosses over the road, as for streets)
      }
    }
    // [junctions] how much street surface is still drawn over other street surface (overlapping ribbons)
    streetStats = { ...streetOverlaps(streets, plan || null, { routeDist: landscape.routeDist, roadWidth: ROAD_WIDTH }),
      junctions: plan?.list.length || 0, routeJunctions: plan?.list.filter((j) => j.route).length || 0 };
    // [junctions] road meets (js/world/toolbox/city/road-meets.js): every place roadways meet near the route, measured as drawn —
    // steps, gaps, overlaps, dangling ends, misplaced paint. Reported (info: the work list, with the counts in the
    // summary line; test/road-meets.test.mjs bounds them), since the rest need source heights fixed (docs/pittsburgh/detail/s2.md)
    const meets = roadMeets(landscape, index, route, { roadWidth: ROAD_WIDTH });
    F.open.clear();
    // [w2-meets] each site's issue is listed (info, the work list); the check warns when more sites within 25 m of
    // the route have issues than MEET_LIMITS.nearBudget allows (the junction system's regression guard)
    const nearIssues = meets.sites.filter((st) => st.issues.length && st.d <= 25);
    for (const site of meets.sites) for (const is of site.issues) F.add('road-meet', site.d <= 25 && nearIssues.length > MEET_LIMITS.nearBudget ? 'warn' : 'info', site.s, is.value, `${site.kind} ${is.check}: ${is.note}`, 0);
    F.open.clear();
    streetStats.meets = { sites: meets.sites.length, counts: meets.counts, issues: meets.issues, near: nearIssues.length };
  }

  // 6. Road alignment: kinks, jitter and creases in the drawn road; city streets' profiles ([road-align])
  alignmentChecks({ route, index, landscape, F, nearUturn, oneWay });

  // a ride network's ghost stretch (js/world/ghost.js) is never ridden or drawn: what is found along it is info
  const ghosts = scene?.city?.routeGhosts || [];
  const outM = (s) => (turn && s > turn ? total - s : s);
  const inGhost = (f) => { const a = outM(f.from), b = outM(f.to), lo = Math.min(a, b), hi = Math.max(a, b); return ghosts.some((g) => lo > g.fromM + 2 && hi < g.toM - 2); };
  for (const f of F.list) if (f.severity !== 'info' && inGhost(f)) { f.severity = 'info'; f.note = `${f.note} (on a ghost stretch: never ridden or drawn)`; }

  // a scene's accepted warnings ("qcAccept": [{check, fromM, toM, why}]): known, reviewed spots listed with the
  // reason, reported as info. Never fails — a FAIL always stands.
  for (const f of F.list) {
    if (f.severity !== 'warn') continue;
    const a = (scene?.qcAccept || []).find((q) => q.check === f.check && f.from >= q.fromM && f.to <= q.toM);
    if (a) { f.severity = 'info'; f.note = `${f.note} (accepted: ${a.why})`; }
  }
  const list = F.list.sort((a, b) => a.from - b.from);
  const count = (sev) => list.filter((f) => f.severity === sev).length;
  return {
    id, name: name || route.name, total, oneWay, outAndBack: !!route.outAndBack, closedLoop: !!(route.oneWay?.closedLoop ?? route.closed),
    stylized, rawPoints: raw.length, rawGapMax, closureGap, maxHeading, maxJump, streets: streetStats,   // [junctions]
    ascent: route.ascent, minEle: route.minEle, maxEle: route.maxEle,
    fails: count('fail'), warns: count('warn'), infos: count('info'), findings: list, series,
  };
}

// ---------- Report ----------
const km = (m) => (m / 1000).toFixed(2);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function chart(r) {
  const W = 1000, H = 150, L = r.total, pad = 4;
  const x = (s) => pad + (s / L) * (W - 2 * pad);
  const line = (pts, lo, hi, h0, h1) => pts.map(([s, v], i) => `${i ? 'L' : 'M'}${x(s).toFixed(1)},${(h1 - ((v - lo) / (hi - lo || 1)) * (h1 - h0)).toFixed(1)}`).join('');
  const ele = r.series.ele, grade = r.series.grade;
  const eLo = Math.min(...ele.map((p) => p[1])), eHi = Math.max(...ele.map((p) => p[1]));
  const hd = r.series.s.map((s, i) => [s, Math.min(30, r.series.heading[i])]);
  const cl = r.series.cs.map((s, i) => [s, r.series.clearance[i]]);
  const marks = r.findings.filter((f) => f.severity !== 'info').map((f) =>
    `<rect x="${x(f.from).toFixed(1)}" y="0" width="${Math.max(2, x(f.to) - x(f.from)).toFixed(1)}" height="${H}" class="${f.severity}"><title>${esc(f.check)} · ${km(f.from)} km</title></rect>`).join('');
  const turnLine = r.outAndBack ? `<line x1="${x(r.oneWay)}" x2="${x(r.oneWay)}" y1="0" y2="${H}" class="turn"/>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${marks}${turnLine}
    <path d="${line(ele, eLo, eHi, 6, 70)}" class="ele"/>
    <line x1="0" x2="${W}" y1="105" y2="105" class="zero"/>
    <path d="${line(grade, -15, 15, 76, 134)}" class="grade"/>
    <path d="${line(hd, 0, 30, 76, 148)}" class="heading"/>
    ${cl.length ? `<path d="${line(cl, -1, 5, 76, 148)}" class="clear"/>` : ''}</svg>`;
}

export function htmlReport(results, { previewHref = 'world-preview.html' } = {}) {
  const rows = results.map((r) => `<tr><td><a href="#${r.id}">${esc(r.name)}</a></td><td>${km(r.oneWay)}</td>
    <td>${r.outAndBack ? 'there & back' : r.closedLoop ? 'loop' : 'one way'}</td><td class="${r.fails ? 'fail' : ''}">${r.fails}</td>
    <td class="${r.warns ? 'warn' : ''}">${r.warns}</td><td>${r.maxHeading.toFixed(1)}</td><td>${r.rawGapMax.toFixed(0)}</td></tr>`).join('');
  const sections = results.map((r) => {
    const items = r.findings.map((f) => {
      const link = r.preview ? `<a href="${previewHref}?park=${r.preview}&pos=${Math.round(f.at)}">ride</a>` : '';
      return `<tr class="${f.severity}"><td>${f.severity.toUpperCase()}</td><td>${esc(f.check)}</td><td>${km(f.from)}${f.to - f.from > 1 ? `–${km(f.to)}` : ''}</td>
        <td>${f.value.toFixed(2)}</td><td>${f.count}</td><td>${esc(f.note)}</td><td>${link}</td></tr>`;
    }).join('');
    return `<section id="${r.id}"><h2>${esc(r.name)}</h2>
      <p>${km(r.total)} km ridden per lap (${r.outAndBack ? `turns at ${km(r.oneWay)} km` : 'loop'}) · GPX ${r.rawPoints} points, widest gap ${r.rawGapMax.toFixed(0)} m${r.closedLoop ? `, start–end gap ${r.closureGap.toFixed(0)} m` : ''} · ${r.stylized ? 'stylized scenery checked' : 'path only'}</p>
      <div class="chart">${chart(r)}</div>
      <p class="legend"><span class="k ele"></span>elevation <span class="k grade"></span>grade (±15 %) <span class="k heading"></span>turn rate (0–30 °/m) ${r.stylized ? '<span class="k clear"></span>road clearance over ground (−1…5 m)' : ''} <span class="k failk"></span>fail <span class="k warnk"></span>warn</p>
      ${items ? `<table><tr><th></th><th>check</th><th>km</th><th>worst</th><th>samples</th><th>what</th><th>preview</th></tr>${items}</table>` : '<p class="ok">No discontinuities found.</p>'}
    </section>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>bikefree course QC</title><style>
  :root{color-scheme:light dark;--fg:#1d2733;--bg:#f6f8fb;--card:#fff;--accent:#2f6fde;--line:#d8dee8}
  @media (prefers-color-scheme:dark){:root{--fg:#e6ebf2;--bg:#11161d;--card:#18202a;--line:#2b3644}}
  body{font:14px/1.45 system-ui,sans-serif;color:var(--fg);background:var(--bg);margin:0;padding:24px;max-width:1100px;margin:auto}
  h1{color:var(--accent)} section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:18px 0}
  table{border-collapse:collapse;width:100%} td,th{padding:4px 8px;border-bottom:1px solid var(--line);text-align:left}
  td.fail,tr.fail td:first-child{color:#d64545;font-weight:600} td.warn,tr.warn td:first-child{color:#c98a12;font-weight:600} tr.info{opacity:.6}
  a{color:var(--accent)} .chart svg{width:100%;height:150px;border:1px solid var(--line);border-radius:6px}
  path{fill:none;stroke-width:1.4;vector-effect:non-scaling-stroke} .ele{stroke:var(--accent)} .grade{stroke:#888} .heading{stroke:#9b59b6;opacity:.7} .clear{stroke:#27ae60}
  rect.fail{fill:#d64545;opacity:.35} rect.warn{fill:#e0a020;opacity:.25} .zero{stroke:var(--line)} .turn{stroke:var(--fg);stroke-dasharray:4 3;opacity:.5}
  .legend{font-size:12px;opacity:.8} .k{display:inline-block;width:14px;height:3px;margin:0 4px 3px 10px;vertical-align:middle}
  .k.ele{background:var(--accent)}.k.grade{background:#888}.k.heading{background:#9b59b6}.k.clear{background:#27ae60}.k.failk{background:#d64545}.k.warnk{background:#e0a020}
  .ok{color:#27ae60}
  </style></head><body><h1>Course QC</h1><p>Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · each route ridden end to end (both directions, across the lap seam). Preview links need the dev server (<code>npm start</code>, open from <code>tools/</code>).</p>
  <table><tr><th>route</th><th>km one way</th><th>shape</th><th>fail</th><th>warn</th><th>sharpest turn °/m</th><th>widest GPX gap m</th></tr>${rows}</table>${sections}</body></html>`;
}

/** Scene JSON plus its baked terrain, read from disk. */
export function loadSceneSync(path) {
  const scene = normalizeScene(JSON.parse(read(path)));
  if (scene.terrainData?.file) attachTerrainBuffer(scene, readFileSync(join(ROOT, scene.terrainData.file)));
  if (scene.terrainGridFile) scene.terrainGrid = scene.terrainGridFile.endsWith('.json') ? JSON.parse(read(scene.terrainGridFile)) : parseTerrainGrid(gunzipSync(readFileSync(join(ROOT, scene.terrainGridFile))));   // real-coast grid (build_terrain_grid.py)
  if (scene.placesFile) scene.places = parseTerrainGrid(gunzipSync(readFileSync(join(ROOT, scene.placesFile))));   // OSM places (build_places.py)
  return scene;
}

// ---------- CLI ----------
async function main() {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
  const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
  const withCity = (scene) => (scene.cityData ? { ...scene, city: JSON.parse(read(scene.cityData)) } : scene);
  const step = Number(opt('--step', 1));
  const html = opt('--html', 'tools/qc-report.html');
  const json = opt('--json', null);
  const gpx = opt('--gpx', null);
  const strict = flag('--strict');
  const jobs = [];
  if (gpx) {
    jobs.push({ id: 'gpx', name: gpx, gpxText: readFileSync(gpx, 'utf8'), item: {} });
  } else {
    const catalog = JSON.parse(read('routes/parks/index.json'));
    const demo = { id: 'demo-hills', name: 'Demo Hills', file: 'routes/demo-hills.gpx', scene: 'routes/scenes/demo-hills.json', noPreview: true };
    for (const item of [...catalog, demo]) {
      if (args.length && !args.includes(item.id)) continue;
      jobs.push({ id: item.id, name: item.name, gpxText: read(item.file), item, scene: item.scene ? withCity(loadSceneSync(item.scene)) : null, preview: item.noPreview ? null : item.id });
    }
  }
  const results = [];
  for (const job of jobs) {
    const t0 = Date.now();
    const r = qcRoute({ ...job, step });
    r.preview = job.preview || null;
    results.push(r);
    const tag = r.fails ? 'FAIL' : r.warns ? 'warn' : 'ok  ';
    console.log(`${tag} ${r.name.padEnd(42)} ${km(r.oneWay).padStart(7)} km  ${String(r.fails).padStart(3)} fail ${String(r.warns).padStart(3)} warn  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    if (r.streets) console.log(`       streets: ${(r.streets.overlapM / 1000).toFixed(1)} km of ribbon over other streets, ${(r.streets.routeOverlapM / 1000).toFixed(1)} km under the route's road, ${r.streets.junctionOverlapM} m into other junctions; ${r.streets.junctions} junctions (${r.streets.routeJunctions} on the route)`);   // [junctions]
    if (r.streets?.meets) console.log(`       road meets: ${r.streets.meets.sites} sites within 150 m (${Object.entries(r.streets.meets.counts).map(([k, v]) => `${k} ${v}`).join(', ')}), ${r.streets.meets.issues} with issues (${r.streets.meets.near ?? 0} within 25 m of the route)`);   // [junctions]
    for (const f of r.findings) if (f.severity !== 'info') console.log(`       ${f.severity.toUpperCase().padEnd(4)} ${f.check.padEnd(15)} ${km(f.from).padStart(7)}${f.to - f.from > 1 ? `–${km(f.to)}` : ''} km  worst ${f.value.toFixed(2)}  ${f.note}`);
  }
  if (html) { const out = join(ROOT, html); writeFileSync(out, htmlReport(results)); console.log(`\nReport: ${relative(process.cwd(), out)}`); }
  if (json) writeFileSync(json, JSON.stringify(results.map(({ series, ...r }) => r), null, 2));
  const bad = results.some((r) => r.fails || (strict && r.warns));
  process.exitCode = bad ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
