#!/usr/bin/env node
// Remap a scene's route-metre keys (fromM / toM / atM / positionM, and a city config's profileKeep) from an
// old GPX to a new one by geometry: each old 10 m sample goes to the nearest new sample riding the same way
// (within 25 m, heading within ~45°). Ranges that land in pieces (the new line runs the old one in another
// order) are split into one range per piece; pieces under 20 m are dropped.
//
//   node tools/remap_scene_metres.mjs <old.gpx> <new.gpx> <scene.json> [--city tools/city/<id>.json] [--ghosts <new city data>] [--write]
//
// Written for Pittsburgh's ride network (the loop became one open tour with the Jail Trail); any scene whose
// GPX is rebuilt in a new order can use it. Without --write it prints what would change.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseGpx, buildRoute } from '../js/gpx.js';

const args = process.argv.slice(2);
const write = args.includes('--write');
const ci = args.indexOf('--city');
const gi = args.indexOf('--ghosts');   // city data with routeGhosts for the NEW line: never map onto a ghost stretch
const ghosts = gi >= 0 ? JSON.parse(readFileSync(args[gi + 1], 'utf8')).routeGhosts || [] : [];
const cityPath = ci >= 0 ? args[ci + 1] : null;
const [oldPath, newPath, scenePath] = args.filter((a, i) => !a.startsWith('--') && !(ci >= 0 && i === ci + 1) && !(gi >= 0 && i === gi + 1));
const load = (p) => buildRoute({ ...parseGpx(readFileSync(p, 'utf8')), eleSmoothM: 0 });
const A = load(oldPath), B = load(newPath);
const k = 6378137 * Math.PI / 180, kx = k * Math.cos((A.lat[0] * Math.PI) / 180);
const xy = (r, i) => ({ x: r.lon[i] * kx, z: r.lat[i] * k });
const head = (r, i) => {
  const a = xy(r, Math.max(0, i - 1)), b = xy(r, Math.min(r.lat.length - 1, i + 1));
  const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
};
// grid of the new line's samples
const cell = 50, grid = new Map();
for (let j = 0; j < B.lat.length; j++) {
  if (ghosts.some((g) => j * 10 > g.fromM && j * 10 < g.toM)) continue;
  const p = xy(B, j), key = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`;
  if (!grid.has(key)) grid.set(key, []);
  grid.get(key).push(j);
}
const map = new Int32Array(A.lat.length).fill(-1);
for (let i = 0; i < A.lat.length; i++) {
  const p = xy(A, i), h = head(A, i);
  let best = -1, bd = 25;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    for (const j of grid.get(`${Math.floor(p.x / cell) + dx},${Math.floor(p.z / cell) + dz}`) || []) {
      const q = xy(B, j), d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d >= bd) continue;
      const g = head(B, j);
      if (g.x * h.x + g.z * h.z < 0.7) continue;
      bd = d; best = j;
    }
  }
  map[i] = best;
}
const mapAt = (s) => { const i = Math.max(0, Math.min(A.lat.length - 1, Math.round(s / 10))); return map[i] < 0 ? null : map[i] * 10 + (s - i * 10); };
const mapRange = (from, to) => {
  const runs = [];
  let run = null;
  for (let s = from; s <= to; s += 10) {
    const j = map[Math.max(0, Math.min(A.lat.length - 1, Math.round(s / 10)))];
    if (j < 0) { run = null; continue; }
    if (run && Math.abs(j - run.last) <= 3) { run.last = j; run.to = j * 10; }
    else { run = { from: j * 10, to: j * 10, last: j }; runs.push(run); }
  }
  return runs.filter((r) => r.to - r.from >= 20).map((r) => [r.from, r.to]);
};

let unmapped = 0;
const report = [];
function walk(o, path) {
  if (Array.isArray(o)) {
    for (let i = 0; i < o.length; i++) {
      const v = o[i];
      if (v && typeof v === 'object' && !Array.isArray(v) && Number.isFinite(v.fromM) && Number.isFinite(v.toM)) {
        const pieces = mapRange(v.fromM, v.toM);
        if (!pieces.length) { unmapped++; report.push(`${path}[${i}] ${v.fromM}–${v.toM}: no match, dropped`); o.splice(i, 1); i--; continue; }
        const repl = pieces.map(([a, b]) => ({ ...v, fromM: a, toM: b }));
        report.push(`${path}[${i}] ${v.fromM}–${v.toM} → ${pieces.map(([a, b]) => `${a}–${b}`).join(', ')}`);
        o.splice(i, 1, ...repl);
        i += repl.length - 1;
        for (const r of repl) walk(r, `${path}[${i}]`);
        continue;
      }
      walk(v, `${path}[${i}]`);
    }
    return;
  }
  if (!o || typeof o !== 'object') return;
  if (Number.isFinite(o.fromM) && Number.isFinite(o.toM) && !path.endsWith(']')) {
    const pieces = mapRange(o.fromM, o.toM);
    const [a, b] = pieces.reduce((m, p) => (p[1] - p[0] > m[1] - m[0] ? p : m), [0, -1]);
    report.push(`${path} ${o.fromM}–${o.toM} → ${a}–${b}${pieces.length > 1 ? ` (longest of ${pieces.length})` : ''}`);
    if (b >= a) { o.fromM = a; o.toM = b; } else unmapped++;
  }
  for (const key of ['atM', 'positionM']) {
    if (Number.isFinite(o[key])) {
      const m = mapAt(o[key]);
      report.push(`${path}.${key} ${o[key]} → ${m}`);
      if (m == null) unmapped++; else o[key] = Math.round(m);
    }
  }
  for (const [key, v] of Object.entries(o)) if (v && typeof v === 'object') walk(v, `${path}.${key}`);
}

const scene = JSON.parse(readFileSync(scenePath, 'utf8'));
walk(scene, '');
console.log(report.join('\n'));
let city = null;
if (cityPath) {
  city = JSON.parse(readFileSync(cityPath, 'utf8'));
  if (city.profileKeep) {
    const out = city.profileKeep.flatMap(([a, b]) => mapRange(a, b));
    console.log(`profileKeep ${JSON.stringify(city.profileKeep)} → ${JSON.stringify(out)}`);
    city.profileKeep = out;
  }
}
console.log(`old ${(A.total / 1000).toFixed(2)} km → new ${(B.total / 1000).toFixed(2)} km · ${unmapped} unmapped`);
if (write) {
  writeFileSync(scenePath, `${JSON.stringify(scene, null, 2)}\n`);
  if (city) writeFileSync(cityPath, `${JSON.stringify(city, null, 2)}\n`);
}
