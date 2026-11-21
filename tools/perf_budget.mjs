#!/usr/bin/env node
// [perf-5] Memory and frame budget: one Pittsburgh start measured in headless Chrome and held to tools/perf-budget.json.
//   1. tools/memory_check.mjs — the live JS heap after GC, the geometry the scene still holds on the CPU (typed arrays),
//      the triangles in the scene and the building vertices, once the loading screen closes;
//   2. tools/ride_frames.mjs --no-draw — the load time and the ride's p95 / worst frame (everything but drawing the view:
//      a software GPU's draw drowns the rest) on a downtown stretch.
// Any number over its budget fails (exit 1). After a change that lowers them, re-set the budget (each number plus
// HEADROOM): `node tools/perf_budget.mjs --baseline`. Takes a few minutes; not part of `npm test` (it needs Chrome).
//
//   node tools/perf_budget.mjs [--baseline] [--route "Three Rivers Loop"] [--stretch 0-1500]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BUDGET_FILE = 'tools/perf-budget.json';
const HEADROOM = 1.15;   // the budget: the measured value + 15% (headless timings and GC wander)
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const baseline = args.includes('--baseline');
const routeName = opt('--route', 'Three Rivers Loop'), stretch = opt('--stretch', '0-1500');

/** Measure: { heapMB, geometryMB, tris, buildingVerts, loadS, rideP95Ms, rideWorstMs } */
export function measure() {
  const node = process.execPath, run = (f, a) => execFileSync(node, [join(ROOT, 'tools', f), ...a], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20, timeout: 1200000 });
  const mem = run('memory_check.mjs', [routeName]);
  const num = (re) => { const m = mem.match(re); if (!m) throw new Error(`memory_check: no ${re}`); return Number(m[1]); };
  const frames = JSON.parse(run('ride_frames.mjs', ['--no-draw', 'pittsburgh', stretch]).trim().split('\n').filter((l) => l.startsWith('{')).at(-1));
  if (frames.errors?.length) throw new Error(`ride_frames: ${frames.errors.join('; ')}`);
  return {
    heapMB: num(/live JS heap (\d+) MB/), geometryMB: num(/GEOMETRY in the scene: ([\d.]+) MB/), tris: num(/tris (\d+)/), buildingVerts: num(/building verts (\d+)/),
    loadS: frames.load.s, rideP95Ms: frames.ride.p95Ms, rideWorstMs: frames.ride.worstMs,
  };
}

/** The numbers over budget: ["heapMB 512 > 480", …] */
export function overBudget(now, budget) {
  return Object.entries(budget).filter(([k, v]) => now[k] != null && now[k] > v).map(([k, v]) => `${k} ${now[k]} > ${v}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const now = measure();
  console.log(JSON.stringify(now));
  const file = join(ROOT, BUDGET_FILE);
  if (baseline) {
    const b = Object.fromEntries(Object.entries(now).map(([k, v]) => [k, k === 'tris' || k === 'buildingVerts' ? Math.round(v * HEADROOM) : +(v * HEADROOM).toFixed(1)]));
    writeFileSync(file, JSON.stringify({ route: routeName, stretch, measured: now, budget: b }, null, 1) + '\n');
    console.log(`Budget: ${BUDGET_FILE}`);
  } else {
    if (!existsSync(file)) { console.error(`no ${BUDGET_FILE}: run with --baseline first`); process.exit(2); }
    const over = overBudget(now, JSON.parse(readFileSync(file, 'utf8')).budget);
    if (over.length) { console.error(`over budget: ${over.join(', ')}`); process.exit(1); }
    console.log('within budget');
  }
}
