#!/usr/bin/env node
// Highway profiles (PLAN: Pittsburgh audit, F): "can a car drive on it?" — one smooth, grade-limited height profile for
// every kept highway (cls 0: tools/city/pittsburgh-highways-keep.json), solved once over all the areas together, and
// stored in each area's city data so every area draws the same road (no jumps at the seams, no steps, no ledges).
//
// How: the highway pieces of every area are one graph (an OSM node is the same node in every area: its lat/lon); each
// node starts at its deck height (a bridge) or at its bare ground (the area's baseHeight); the profile is then smoothed
// along the graph (pulled a little back to where it started, so it still follows the land) and held to ≤ MAX_GRADE
// between neighbouring nodes; a bridge deck may rise, never sink (its clearance). The result is written into the
// packed `deck` heights of every highway point (150 + d/10 m) with flag bit 4 (16) "profiled", which the renderer
// (cityStreetsJob) reads like a deck's heights. Banks or decks under the road follow from it (audit E1).
//
//   node tools/highway_profiles.mjs            all Pittsburgh areas (writes the city JSON); --dry: report only
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildCatalogRoute } from '../js/routes.js';
import { makeProjection, makeRouteIndex } from '../js/world/geo.js';
import { landscapeBuilder } from '../js/world/toolbox/landscape/index.js';
import { loadSceneSync } from './qc_course.mjs';
import { decodeStreets, withStreets } from './repair_city.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
export const PROFILE = { maxGrade: .06, iterations: 400, smooth: .5, anchor: .03, deckRise: 6, flag: 16, routeReach: 12, under: .45, over: 4.8, flushM: 6 };

export function solveProfiles({ dry = false, log = console.log } = {}) {
  const P = PROFILE;
  const items = JSON.parse(read('routes/parks/index.json')).filter((it) => it.id.startsWith('pittsburgh') && it.scene);
  const nodes = new Map(), areas = [];
  // one OSM node is one node in every area: each area stores it relative to its own origin (2e-6° steps), so the same
  // node can come back up to ~0.2 m apart — matched within 0.6 m
  const P0 = makeProjection(40.4375, -79.9925), buckets = new Map();
  const key = (lat, lon) => {
    const p = P0.toLocal(lat, lon), bx = Math.floor(p.x), bz = Math.floor(p.z);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const [id, q] of buckets.get(`${bx + a},${bz + b}`) || []) if (Math.hypot(q.x - p.x, q.z - p.z) < .6) return id;
    const id = `${bx},${bz},${buckets.size}`, k = `${bx},${bz}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push([id, p]);
    return id;
  };
  for (const item of items) {
    const scene = loadSceneSync(item.scene);
    if (!scene.cityData) continue;
    const text = read(scene.cityData), city = JSON.parse(text);
    const route = buildCatalogRoute(read(item.file), item); route.scene = scene;
    const proj = makeProjection(scene.origin.lat, scene.origin.lon), index = makeRouteIndex(route, proj);
    const L = landscapeBuilder(scene)({ ...scene, city }, proj, index, route);
    const ground = L.baseHeight || L.heightAt;
    const { streets } = decodeStreets(text), [lat0, lon0] = city.origin, unit = city.unit;
    const keys = [];
    streets.forEach((st, k) => {
      if (st.meta[0] !== 0) { keys.push(null); return; }
      const bridge = !!(st.meta[1] & 1), ks = [];
      st.xy.forEach(([a, o], i) => {
        const lat = lat0 + a * unit, lon = lon0 + o * unit, id = key(lat, lon), p = proj.toLocal(lat, lon);
        let n = nodes.get(id);
        if (!n) nodes.set(id, (n = { x: p.x, z: p.z, lat, lon, g: [], deck: null, nb: new Set(), road: null }));
        // a highway beside or across a route's road at about its height: it must pass under it or clear it (the renderer
        // would push it under there: a step) — the solve keeps it out of that band
        const rd = L.routeDist?.(p.x, p.z);
        if (rd && rd.d < P.routeReach && (!n.road || rd.d < n.road.d)) n.road = { d: rd.d, y: rd.y };
        if (bridge && st.deck[i]) n.deck = Math.max(n.deck ?? -Infinity, 150 + st.deck[i] / 10);
        else n.g.push(ground(p.x, p.z));
        if (i) n.nb.add(ks[i - 1]), nodes.get(ks[i - 1]).nb.add(id);
        ks.push(id);
      });
      keys.push(ks);
    });
    areas.push({ item, scene, text, streets, keys });
  }
  // the solve
  const list = [...nodes.values()];
  const idx = new Map([...nodes.keys()].map((k, i) => [k, i]));
  for (const n of list) { n.h0 = n.deck ?? (n.g.reduce((a, b) => a + b, 0) / Math.max(1, n.g.length)); n.h = n.h0; n.nbi = [...n.nb].map((k) => idx.get(k)); n.len = n.nbi.map((j) => Math.hypot(list[j].x - n.x, list[j].z - n.z)); }
  // a route riding on the highway (its centre inside the carriageway): flush with the route's road, as the renderer pins it
  const band = (n) => { if (!n.road) return; if (n.road.d < P.flushM) { n.h = n.road.y - .15; return; } const d = n.h - n.road.y; if (d > -P.under && d < P.over) n.h = d < (P.over - P.under) / 2 - P.under ? n.road.y - P.under : n.road.y + P.over; };
  for (let it = 0; it < P.iterations; it++) {
    for (const n of list) {
      if (!n.nbi.length) continue;
      const avg = n.nbi.reduce((a, j) => a + list[j].h, 0) / n.nbi.length;
      n.h += (avg - n.h) * P.smooth + (n.h0 - n.h) * P.anchor;
      if (n.deck != null) n.h = Math.min(n.h0 + P.deckRise, Math.max(n.h, n.h0));   // a deck keeps its clearance
      band(n);
    }
    for (const n of list) n.nbi.forEach((j, q) => {
      const m = list[j], lim = P.maxGrade * Math.max(.5, n.len[q]), d = m.h - n.h;
      if (Math.abs(d) <= lim) return;
      const fix = (Math.abs(d) - lim) / 2 * Math.sign(d);
      n.h += fix; m.h -= fix;
    });
  }
  for (const n of list) { if (n.deck != null && n.h < n.h0) n.h = n.h0; band(n); }
  // report and write
  let worst = 0, moved = 0;
  for (const n of list) { moved = Math.max(moved, Math.abs(n.h - n.h0)); n.nbi.forEach((j, q) => { worst = Math.max(worst, Math.abs(list[j].h - n.h) / Math.max(.5, n.len[q])); }); }
  log(`highway nodes ${list.length}; steepest after ${(worst * 100).toFixed(1)} % (limit ${P.maxGrade * 100} %); largest move ${moved.toFixed(1)} m`);
  for (const A of areas) {
    let changed = 0;
    const streets = A.streets.map((st, k) => {
      if (!A.keys[k]) return st;
      changed++;
      return { meta: [st.meta[0], st.meta[1] | P.flag, st.meta[2]], xy: st.xy, deck: A.keys[k].map((id) => Math.max(1, Math.min(65535, Math.round((nodes.get(id).h - 150) * 10)))) };
    });
    const out = withStreets(A.text, streets);
    if (!dry && out !== A.text) writeFileSync(join(ROOT, A.scene.cityData), out);
    log(`  ${A.item.id}: ${changed} highway pieces profiled${dry ? ' (dry)' : out === A.text ? ' (unchanged)' : ''}`);
  }
  return { nodes: list.length, worst, moved };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) solveProfiles({ dry: process.argv.includes('--dry') });
