#!/usr/bin/env node
// Network QC: ride every way through every junction of a ride network (js/network.js) and check the rider's
// pose is continuous — no jumps, no ledges, no heading snaps — on the app's own code. Also checks the path
// route the session rides is continuous where traversals meet.
//
//   node tools/qc_network.mjs                 every catalog route with a network
//   options: --step 0.25   --json out.json
// Exit code 1 when any check fails.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildCatalogRoute } from '../js/routes.js';
import { haversine } from '../js/gpx.js';
import { makeProjection, makeRouteIndex } from '../js/world/geo.js';
import { normalizeScene } from '../js/world/toolbox/scene-schema.js';
import { ghostAt } from '../js/world/ghost.js';
import { loadNetwork, NetRide, optionsAt, travKey, endNode, makePathRoute } from '../js/network.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

export const NET_LIMITS = {
  posJump: 0.6,        // rider moves this much further than the step in one step
  heightStep: 0.35,    // m of height per m along
  heading: 25,         // °/m through a turn
  headingUturn: 70,    // °/m through a U-turn ("back": a tight turn at walking pace)
  sampleGap: 30,       // path route: neighbouring 10 m samples this far apart on the ground (a junction's passes
                       // can sit a few metres apart — up to ~18 m where a spur leaves and its ghost returns: the recorded track hops that much there)
};

/** A catalog route with its scene (the road's curve: roadAlign) and its city data's ghosts and aprons. */
function loadBase(item) {
  const base = buildCatalogRoute(read(item.file), { ...item, routeId: item.id });
  if (item.scene) {
    base.scene = normalizeScene(JSON.parse(read(item.scene)));
    if (base.scene.cityData) { const c = JSON.parse(read(base.scene.cityData)); base.scene.city = { routeGhosts: c.routeGhosts, routeAprons: c.routeAprons }; }
  }
  return base;
}

/**
 * The base route of a catalog item with a network, its network and the world index (as world.js builds it). A city
 * of areas (PLAN 5.4): every area's route, projected around the city's origin; `index` is then a function of the
 * area id (js/network.js NetRide.pose takes either).
 */
export function loadCatalogNetwork(item) {
  const json = JSON.parse(read(item.network));
  if (json.format === 'bikefree-network-2') {
    const catalog = JSON.parse(read('routes/parks/index.json'));
    const bases = new Map(json.areas.map((a) => [a.id, loadBase(catalog.find((c) => c.id === a.catalogId))]));
    const net = loadNetwork(json, bases);
    const proj = makeProjection(json.origin.lat, json.origin.lon);
    const indexes = new Map([...bases].map(([id, b]) => [id, makeRouteIndex(b, proj)]));
    return { base: net.base, net, index: (id) => indexes.get(id), indexes };
  }
  const base = loadBase(item);
  const net = loadNetwork(json, base);
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (let i = 0; i < base.lat.length; i++) {
    minLat = Math.min(minLat, base.lat[i]); maxLat = Math.max(maxLat, base.lat[i]);
    minLon = Math.min(minLon, base.lon[i]); maxLon = Math.max(maxLon, base.lon[i]);
  }
  const index = makeRouteIndex(base, makeProjection((minLat + maxLat) / 2, (minLon + maxLon) / 2));
  return { base, net, index };
}

/** Ride every arrival × every way on at every junction; returns [{node, from, to, label, jump, head, height, ok}]. */
export function sweepTurns(net, index, { step = 0.25, reach = 40, lane = 0.22 } = {}) {
  const out = [];
  for (const node of net.nodes.values()) {
    for (const arm of node.arms) {
      const arrive = { e: arm.e, dir: -arm.dir };   // the traversal that comes in along this arm
      for (const o of optionsAt(net, arrive)) {
        const r = {};
        const ride = new NetRide(net, r, { first: travKey(arrive) });
        ride.pick(o.key, 0);
        const P = arrive.e.len;
        let prev = null, jump = 0, head = 0, height = 0, area = null;
        for (let p = Math.max(0, P - reach); p <= P + Math.min(reach, o.t.e.len - 1); p += step) {
          area = net.multi ? ride.areaFor(p, area) : null;   // (a city of areas: on the area drawn, as the world does)
          const q = ride.pose(p, index, lane, area);
          if (prev) {
            const d = Math.hypot(q.pos.x - prev.pos.x, q.pos.z - prev.pos.z);
            jump = Math.max(jump, d - step);
            height = Math.max(height, Math.abs(q.pos.y - prev.pos.y) / step);
            const c = Math.max(-1, Math.min(1, q.flat.x * prev.flat.x + q.flat.z * prev.flat.z));
            head = Math.max(head, (Math.acos(c) * 180) / Math.PI / step);
          }
          prev = q;
        }
        const ok = jump <= NET_LIMITS.posJump && height <= NET_LIMITS.heightStep && head <= (o.back || Math.abs(o.angle) > 150 ? NET_LIMITS.headingUturn : NET_LIMITS.heading);
        out.push({ node: node.id, name: node.name, from: travKey(arrive), to: o.key, label: o.label, angle: Math.round(o.angle), jump, head, height, ok });
      }
    }
  }
  return out;
}

/**
 * A city of areas: ride every preset's first lap as the world does — the area drawn chosen by NetRide.areaFor —
 * and check the line under the rider is drawn there (not a ghost), and that where the area drawn swaps the pose
 * doesn't jump (from the old area's line to the new one's). [{preset, swaps, worstJump, ghostUnder, ok}]
 */
export function crossAreas(net, index, { lane = 0.22, step = 0.25, around = 30 } = {}) {
  const out = [];
  if (!net.multi) return out;
  for (const pr of net.presets) {
    const ride = new NetRide(net, {}, { plan: pr.path });
    const lap = ride.lapM;
    // the area drawn along the lap (1 m steps), and the line under the rider drawn there (no ghost)
    let area = null, ghost = 0;
    const swaps = [];
    for (let p = 0; p <= lap; p += 1) {
      const a = ride.areaFor(p, area);
      if (area && a !== area) swaps.push({ p, from: area, to: a });
      area = a;
      const at = ride.worldAt(p, area), A = net.areas.get(area);
      if (at.area !== area || ghostAt(A.base, at.s > A.L ? A.total - at.s : at.s)) ghost++;
    }
    // each swap at `step` metres, as the world rides it: the pose on the old area up to the swap, on the new one after
    let worst = 0;
    for (const sw of swaps) {
      let prev = null;
      for (let p = sw.p - around; p <= sw.p + around; p += step) {
        const q = ride.pose(p, index, lane, p < sw.p ? sw.from : sw.to);
        if (prev) worst = Math.max(worst, Math.hypot(q.pos.x - prev.pos.x, q.pos.z - prev.pos.z) - step, Math.abs(q.pos.y - prev.pos.y) - NET_LIMITS.heightStep * step);
        prev = q;
      }
    }
    out.push({ preset: pr.id, swaps, worstJump: Math.max(0, worst), ghostUnder: ghost, ok: worst <= NET_LIMITS.posJump && ghost === 0 });
  }
  return out;
}

/** The path route of every preset: neighbouring samples close together on the ground (no hops at junctions). */
export function checkPathRoutes(net) {
  const out = [];
  for (const pr of net.presets) {
    const r = makePathRoute(net, pr);
    let worst = 0;
    for (let i = 1; i < r.lat.length; i++) worst = Math.max(worst, haversine({ lat: r.lat[i - 1], lon: r.lon[i - 1] }, { lat: r.lat[i], lon: r.lon[i] }));
    out.push({ preset: pr.id, lapM: r.lapM, worstGap: worst, ok: worst <= NET_LIMITS.sampleGap });
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const step = Number(opt('--step', 0.25));
  const index = JSON.parse(read('routes/parks/index.json'));
  let fails = 0;
  const report = [];
  for (const item of index.filter((r) => r.network && !r.area)) {
    const { net, index: idx } = loadCatalogNetwork(item);
    const turns = sweepTurns(net, idx, { step });
    const paths = checkPathRoutes(net);
    const cross = crossAreas(net, idx);
    report.push({ id: item.id, turns, paths, cross });
    console.log(`${item.id}: ${net.nodes.size} junctions, ${net.edges.size} edges, ${turns.length} ways through junctions`);
    for (const t of turns) {
      if (!t.ok) fails++;
      console.log(`  ${t.ok ? 'ok  ' : 'FAIL'} ${t.node} ${t.from} → ${t.to} (${t.label}, ${t.angle}°): jump ${t.jump.toFixed(2)} m · heading ${t.head.toFixed(1)}°/m · height ${(t.height * 100).toFixed(0)}%`);
    }
    for (const p of paths) {
      if (!p.ok) fails++;
      console.log(`  ${p.ok ? 'ok  ' : 'FAIL'} path route ${p.preset}: lap ${(p.lapM / 1000).toFixed(2)} km, widest sample gap ${p.worstGap.toFixed(2)} m`);
    }
    for (const c of cross) {
      if (!c.ok) fails++;
      console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} areas ${c.preset}: ${c.swaps.map((x) => `${x.from}→${x.to} @${(x.p / 1000).toFixed(2)} km`).join(', ') || 'one area'} · worst jump ${c.worstJump.toFixed(2)} m · ghost under the rider ${c.ghostUnder} m`);
    }
  }
  const json = opt('--json');
  if (json) writeFileSync(json, JSON.stringify(report, null, 1));
  console.log(fails ? `${fails} failing` : 'All clean');
  process.exit(fails ? 1 : 0);
}
export { endNode };
