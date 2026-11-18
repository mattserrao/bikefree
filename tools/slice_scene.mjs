#!/usr/bin/env node
// Cut a scene's route-metre keys down to one area of a city (PLAN 5.4): an area cut from a master tour by
// tools/build_city.py "slice" has the master's own samples, piece by piece, so its metres are the master's moved
// by a whole offset. Ranges (fromM / toM: road zones, street-kit zones, qcAccept, main streets, river spans,
// route trees, overlooks…) keep the part on the area's forward pieces (its own segments and its aprons; never a
// ghost); places (atM, positionM) map or are dropped; whole-route ranges (0 … the master's end) become the
// area's whole line.
//
// Ranges on the way back (a there-and-back ride's second leg: beyond the master's line length, --leg) map onto
// the area's way back.
//
//   node tools/slice_scene.mjs <master scene.json> tools/city/<area>.json --leg <master line m> --out routes/scenes/<area>.json [--set key=json …]
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : null; };
const out = opt('--out');
const leg = Number(opt('--leg'));
const sets = [];
for (let i = args.indexOf('--set'); i >= 0; i = args.indexOf('--set')) sets.push(args.splice(i, 2)[1]);
const [scenePath, cfgPath] = args;
if (!scenePath || !cfgPath || !out || !(leg > 0)) { console.log('usage: node tools/slice_scene.mjs <master scene.json> <area city config.json> --out <scene.json> [--set key=json]'); process.exit(1); }
const scene = JSON.parse(readFileSync(scenePath, 'utf8'));
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
if (!cfg.slice) throw new Error(`${cfgPath} is not a slice of a master tour`);

// the pieces as build_city.py lays them: [area metre of the piece's start, master a, master b]; a join after a
// backward piece adds n × 10 m (the area's city data has the true ghost ends: read them from there)
const city = JSON.parse(readFileSync(cfg.data, 'utf8'));
const spans = [];
let at = 0;
for (const [a, b] of cfg.slice.pieces) {
  const prev = spans.at(-1);
  if (prev && prev.b !== a) {
    // the ghost before this piece runs on to its join: the city data's ghost that starts at prev.o
    const g = (city.routeGhosts || []).find((x) => Math.abs(x.fromM - prev.o) < 1 || (x.fromM <= prev.o + 1 && x.toM > prev.o));
    at = g ? g.toM : at;
  }
  spans.push({ o: at, a, b });
  at += Math.abs(b - a);
}
const total = at, masterEnd = Math.max(...cfg.slice.pieces.flat());
const fwd = spans.filter((p) => p.b > p.a);
const mapAt = (m) => { const p = fwd.find((x) => m >= x.a - 0.5 && m <= x.b + 0.5); return p ? p.o + m - p.a : null; };
const mapOut = (f, t) => fwd.map((p) => [Math.max(f, p.a), Math.min(t, p.b), p]).filter(([x, y]) => y - x >= 10)
  .map(([x, y, p]) => [Math.round(p.o + x - p.a), Math.round(p.o + y - p.a)]);
// (the way back: master metres beyond its line's end are 2 × leg − outbound; the area's likewise)
const mapRange = (f, t) => (f >= leg - 1 ? mapOut(2 * leg - t, 2 * leg - f).map(([x, y]) => [2 * total - y, 2 * total - x]) : mapOut(f, t));

let kept = 0, dropped = 0;
function walk(o, path) {
  if (Array.isArray(o)) {
    for (let i = 0; i < o.length; i++) {
      const v = o[i];
      if (v && typeof v === 'object' && !Array.isArray(v) && Number.isFinite(v.fromM) && Number.isFinite(v.toM)) {
        const pieces = v.fromM <= 0 && v.toM >= masterEnd - 10 ? [[0, total]] : mapRange(v.fromM, v.toM);
        if (!pieces.length) { dropped++; o.splice(i, 1); i--; continue; }
        const repl = pieces.map(([a, b]) => ({ ...v, fromM: a, toM: b }));
        kept++;
        o.splice(i, 1, ...repl);
        i += repl.length - 1;
        continue;
      }
      if (v && typeof v === 'object' && !Array.isArray(v) && Number.isFinite(v.atM)) {
        const m = mapAt(v.atM);
        if (m == null) { dropped++; o.splice(i, 1); i--; continue; }
        o[i] = { ...v, atM: Math.round(m) }; kept++;
        walk(o[i], `${path}[${i}]`);
        continue;
      }
      walk(v, `${path}[${i}]`);
    }
    return;
  }
  if (!o || typeof o !== 'object') return;
  for (const [key, v] of Object.entries(o)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && Number.isFinite(v.fromM) && Number.isFinite(v.toM)) {
      // a single range (overlooks, the street kit's reach): the longest piece, or gone
      const pieces = v.fromM <= 0 && v.toM >= masterEnd - 10 ? [[0, total]] : mapRange(v.fromM, v.toM);
      const best = pieces.sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]))[0];
      if (!best) { delete o[key]; dropped++; continue; }
      Object.assign(v, { fromM: best[0], toM: best[1] }); kept++;
    }
    if (v && typeof v === 'object' && !Array.isArray(v) && Number.isFinite(v.positionM)) {
      const m = mapAt(v.positionM);
      if (m == null) v.positionM = Math.round(fwd[0].o + Math.min(fwd[0].b - fwd[0].a, 600)); else v.positionM = Math.round(m);
    }
    if (v && typeof v === 'object') walk(v, `${path}.${key}`);
  }
}
walk(scene, '');
for (const s of sets) {
  const i = s.indexOf('='), key = s.slice(0, i), val = JSON.parse(s.slice(i + 1));
  const parts = key.split('.');
  let o = scene;
  for (const k of parts.slice(0, -1)) o = (o[k] ||= {});
  if (val === null) delete o[parts.at(-1)]; else o[parts.at(-1)] = val;
}
writeFileSync(out, `${JSON.stringify(scene, null, 2)}\n`);
console.log(`${out}: ${(total / 1000).toFixed(2)} km, ${kept} metre keys kept, ${dropped} dropped (outside the area)`);
