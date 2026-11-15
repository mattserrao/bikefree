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
import { makeProjection, makeRouteIndex } from '../js/world/geo.js';
import { makeCoastLandscape } from '../js/world/coast.js';
import { makeRegionalLandscape } from '../js/world/regional-landscape.js';
import { attachTerrainBuffer } from '../js/world/terrain-data.js';
import { planSettlement } from '../js/world/settlement.js';
import { makeCityLandscape, cityStreets, STREET_LIFT } from '../js/world/city-landscape.js';
import { riderPose, routePoint, ROAD_WIDTH, ROAD_LIFT } from '../js/world/pose.js';

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
  cameraLift: 0.75,       // WARN: chase camera pushed up this far by the ground (visible camera jump)
};

const SHOULDER_HALF = (ROAD_WIDTH + 1.6) / 2;   // stylized shoulder ribbon (world.js)
const SHOULDER_LIFT = 0.05;
const PATCH = 96, PATCH_CELLS = 16;              // finest stylized ground patch (stylized-terrain.js)

// ---------- Helpers ----------
const deg = (r) => (r * 180) / Math.PI;
const angleBetween = (a, b) => deg(Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.z * b.z))));

/** Ground as the stylized patch mesh draws it: 6 m grid, triangles (a,d,b) and (b,d,e). */
function makeMeshGround(heightAt) {
  const cell = PATCH / PATCH_CELLS, cache = new Map();
  const v = (i, j) => {
    const key = i * 1e7 + j;
    let h = cache.get(key);
    if (h === undefined) { h = heightAt(i * cell, j * cell); cache.set(key, h); }
    return h;
  };
  return (x, z) => {
    const gi = Math.floor(x / cell), gj = Math.floor(z / cell);
    const u = x / cell - gi, w = z / cell - gj;
    const a = v(gi, gj), b = v(gi + 1, gj), d = v(gi, gj + 1), e = v(gi + 1, gj + 1);
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
  const proj = makeProjection((minLat + maxLat) / 2, (minLon + maxLon) / 2);   // as world.js
  const index = makeRouteIndex(route, proj);
  const F = new Findings();
  const total = route.total, turn = route.turnS, oneWay = turn || total;
  const nearUturn = (s, r) => !!turn && (Math.abs(s - turn) < r || s < r || total - s < r);
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
  const landscape = stylized ? (route.scene.terrain === 'authored-city' ? makeCityLandscape : route.scene.terrain === 'authored-region' ? makeRegionalLandscape : makeCoastLandscape)(route.scene, proj, index, route) : null;
  const ground = landscape ? makeMeshGround(landscape.heightAt) : null;
  const bridgeAt = (x, z, m) => !!landscape?.bridgeAt?.(x, z, m);
  let prev = riderPose(route, index, 0), maxHeading = 0, maxJump = 0;
  for (let s = step; s <= total + 1e-6; s += step) {
    const cur = riderPose(route, index, s);
    const at = s - step / 2;
    const dh = Math.hypot(cur.pos.x - prev.pos.x, cur.pos.z - prev.pos.z);
    const dy = cur.pos.y - prev.pos.y;
    const turnRate = angleBetween(prev.flat, cur.flat) / step;
    maxJump = Math.max(maxJump, dh - step);
    if (dh - step > LIMITS.posJump) F.add('pose-jump', 'fail', at, dh - step, 'rider position jumps');
    if (Math.abs(dy) / step > LIMITS.heightStep) F.add('pose-height', 'fail', at, dy, 'rider height steps');
    if (nearUturn(at, 12)) { if (turnRate > LIMITS.headingWarn) F.add('u-turn', 'info', at, turnRate, 'planned U-turn'); }
    else {
      maxHeading = Math.max(maxHeading, turnRate);
      if (turnRate > LIMITS.headingFail) F.add('heading-snap', 'fail', at, turnRate, 'heading snaps');
      else if (turnRate > LIMITS.headingWarn) F.add('heading-sharp', 'warn', at, turnRate, 'very tight turn');
    }
    if (ground && Math.round(s) % 2 === 0) {
      // chase camera: 6.5 m behind, 2.7 m up, pushed to 1.6 m above the ground (world.js)
      const cx = cur.pos.x - cur.flat.x * 6.5, cz = cur.pos.z - cur.flat.z * 6.5, cy = cur.pos.y + 2.7;
      const lift = landscape.heightAt(cx, cz) + 1.6 - cy;
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
      for (const o of [0, -ROAD_WIDTH / 2, ROAD_WIDTH / 2]) clearance = Math.min(clearance, road - g(o));
      for (const o of [-SHOULDER_HALF, SHOULDER_HALF]) clearance = Math.min(clearance, shoulder - g(o));
      if (clearance < LIMITS.buried) F.add('road-buried', 'fail', s, clearance, 'ground shows through the road');
      if (!onBridge) {
        const drop = Math.max(shoulder - g(-SHOULDER_HALF), shoulder - g(SHOULDER_HALF));
        if (drop > LIMITS.floating) F.add('road-floating', 'warn', s, drop, 'road edge floats above the ground');
        const wall = Math.max(g(-8), g(8)) - road;
        if (wall > LIMITS.wall) F.add('verge-wall', 'warn', s, wall, 'ground rises steeply right at the road edge');
        // ledge right beside the shoulder: compare the same spot 6 m out between 2 m samples
        // (skipped on tight bends, where the 6 m point itself sweeps sideways)
        for (const o of [-6, 6]) {
          const px = c.x + rx * o, pz = c.z + rz * o, h = ground(px, pz), k = `v${o}`, p0 = last[k];
          const exact = landscape.heightAt(px, pz);
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
  // 5. City streets drawn over the route: another carriageway, a ramp or a bridge deck above the road
  //    would hide the road and the rider's legs (what the renderer draws, via the shared cityStreets()).
  if (landscape?.city) {
    F.open.clear();
    const hits = [], end = route.turnIdx || route.dist.length - 1;
    for (const st of cityStreets(landscape, index, route)) {
      for (const p of st.pts) {
        const r = index.nearest(p.x, p.z, st.width / 2 + ROAD_WIDTH / 2 + 1);
        if (!r) continue;
        const i = r.i > end ? Math.max(0, 2 * end - r.i) : r.i;
        const over = p.y + STREET_LIFT - (route.ele[i] + ROAD_LIFT);
        if (over > -.02 && over < 4) hits.push([route.dist[i], over]);
      }
    }
    hits.sort((a, b) => a[0] - b[0]);
    for (const [hs, over] of hits) F.add('street-over-road', 'fail', hs, over, 'a city street or bridge deck covers the road');
  }

  const list = F.list.sort((a, b) => a.from - b.from);
  const count = (sev) => list.filter((f) => f.severity === sev).length;
  return {
    id, name: name || route.name, total, oneWay, outAndBack: !!route.outAndBack, closedLoop: !!(route.oneWay?.closedLoop ?? route.closed),
    stylized, rawPoints: raw.length, rawGapMax, closureGap, maxHeading, maxJump,
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
      const link = r.preview ? `<a href="${previewHref}?park=${r.preview}&pos=${Math.round(f.at)}&cam=drone">view</a> · <a href="${previewHref}?park=${r.preview}&pos=${Math.round(f.at)}&cam=chase">ride</a>` : '';
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
  const scene = JSON.parse(read(path));
  if (scene.terrainData?.file) attachTerrainBuffer(scene, readFileSync(join(ROOT, scene.terrainData.file)));
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
    for (const f of r.findings) if (f.severity !== 'info') console.log(`       ${f.severity.toUpperCase().padEnd(4)} ${f.check.padEnd(15)} ${km(f.from).padStart(7)}${f.to - f.from > 1 ? `–${km(f.to)}` : ''} km  worst ${f.value.toFixed(2)}  ${f.note}`);
  }
  if (html) { const out = join(ROOT, html); writeFileSync(out, htmlReport(results)); console.log(`\nReport: ${relative(process.cwd(), out)}`); }
  if (json) writeFileSync(json, JSON.stringify(results.map(({ series, ...r }) => r), null, 2));
  const bad = results.some((r) => r.fails || (strict && r.warns));
  process.exitCode = bad ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
