#!/usr/bin/env node
// One QC suite for every map: the right checks for each target, one findings list, one exit code.
//
//   node tools/qc.mjs <target …> [--sweep [600]] [--gpu] [--evidence 12] [--json tools/qc/out.json] [--strict] [--fast]
//   npm run qc:all -- skan endless bigsur --gpu
//
// Targets:
//   a graph map (routes/cities/<id>.json: pgh, cny, skan, nyc)  → the map checks (tools/qc-map.js) at its sites, or
//                                                                    over the whole map with --sweep
//   endless                                                      → the endless checks (tools/qc-endless.js)
//   a route scene (routes/parks/index.json: bigsur, …)            → the scene's lint, course QC (tools/qc_course.mjs)
//                                                                    and clipping QC (tools/qc_clipping.mjs, no city life)
// --gpu adds the GPU check to every site (tools/qc-gpu.js: shader / GL errors, the frame against tools/qc/budgets.json;
// a route scene gets it at its preview spot). --evidence N shoots close-ups of a map's first N defects. --fast skips
// a route scene's clipping QC (the slow one: ~10 min a route on a software GPU).
//
// Every finding comes out as { target, source, check, severity: fail|warn|info, id, at, note }; the exit code is 1
// when any is a fail (or any warn, with --strict). Severity of the map checks: see SEVERITY below.
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sitesOf, runQC, evidence, budgetOf } from './qc_map.mjs';
import { defectId } from './qc-defects.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// (what a rider can't miss or that breaks the frame fails; looks-wrong-up-close warns)
export const SEVERITY = {
  floating: 'fail', roadHole: 'fail', waterOverWay: 'fail', waterOverRoad: 'fail', bridgeDup: 'fail', treeOnRoad: 'fail', buried: 'fail',
  shaderErrors: 'fail', glErrors: 'fail', overBudget: 'fail',
  strayWater: 'warn', bankShard: 'warn', bankCliff: 'warn', dryBasin: 'warn', pathPaint: 'warn', edgeLip: 'warn', edgeDitch: 'warn',
  joinGap: 'warn', sharpCorner: 'warn', benchOnWay: 'warn', viewBlocked: 'warn', alleeMissing: 'warn',
};

const run = (cmd, args, { log = () => {} } = {}) => new Promise((ok) => {
  const p = spawn(cmd, args, { cwd: ROOT }); let buf = '';
  p.stdout.on('data', (d) => { buf += d; log('.'); }); p.stderr.on('data', (d) => { buf += d; });
  p.on('close', (code) => ok({ code, out: buf }));
});

/** What kind of target a name is: 'graph', 'endless', 'route' or null. */
export async function kindOf(t) {
  if (t === 'endless') return 'endless';
  if (existsSync(resolve(ROOT, `routes/cities/${t}.json`))) return 'graph';
  const cat = JSON.parse(await readFile(resolve(ROOT, 'routes/parks/index.json'), 'utf8'));
  return cat.some((r) => r.id === t && r.scene) ? 'route' : null;
}

/** A graph map or the endless map: its sites' defects as findings. */
async function mapTarget(t, o) {
  const sites = await sitesOf(t, { sweep: o.sweep });
  const out = `/tmp/qc/${t}`, radius = o.sweep ? Math.round(o.sweep * 0.75) : 420;
  process.stderr.write(`${t}: ${Object.keys(sites).length} sites `);
  const res = await runQC(t, sites, { out, radius, gpu: o.gpu });
  process.stderr.write('\n');
  if (o.evidence) await evidence(t, res, { out, n: o.evidence });
  const seen = new Set(), F = [];
  for (const [site, r] of Object.entries(res)) {
    if (!r) { F.push({ target: t, source: 'map', check: 'siteFailed', severity: 'fail', id: `siteFailed-${site}`, at: site, note: 'the site did not build' }); continue; }
    for (const d of r.defects || []) if (!seen.has(d.id)) { seen.add(d.id); F.push({ target: t, source: /Errors|overBudget/.test(d.check) ? 'gpu' : 'map', check: d.check, severity: SEVERITY[d.check] || 'warn', id: d.id, at: d.at?.join?.(',') ?? site, note: d.note, site }); }
  }
  return { findings: F, sites: res };
}

/** A route scene: lint, course and clipping QC, and the GPU check at its preview spot. */
async function routeTarget(t, o) {
  const F = [], tmp = `/tmp/qc/${t}`; await mkdir(tmp, { recursive: true });
  const add = (source, f) => F.push({ target: t, source, ...f, id: f.id || defectId(f.check, f.s ?? 0, 0) });
  const cat = JSON.parse(await readFile(resolve(ROOT, 'routes/parks/index.json'), 'utf8')), item = cat.find((r) => r.id === t);
  const lint = await run('node', ['tools/lint_scene.mjs', item.scene]);
  for (const m of lint.out.matchAll(/^(error|warn) +(.*)$/gm)) add('lint', { check: 'sceneLint', severity: /error/i.test(m[1]) ? 'fail' : 'warn', at: item.scene, note: m[2].trim() });
  process.stderr.write(`${t}: course `);
  await run('node', ['tools/qc_course.mjs', t, '--json', `${tmp}/course.json`, '--html', '']);
  for (const r of existsSync(`${tmp}/course.json`) ? JSON.parse(await readFile(`${tmp}/course.json`, 'utf8')) : []) for (const f of r.findings || []) if (f.severity !== 'info') add('course', { check: f.check, severity: f.severity, s: f.from, at: `${Math.round(f.from)} m`, note: f.note });
  if (!o.fast) {
    process.stderr.write('clipping ');
    await run('node', ['tools/qc_clipping.mjs', t, '--no-life', '--json', `${tmp}/clipping.json`, '--html', `${tmp}/clipping.html`], { log: (s) => process.stderr.write(s) });
    for (const r of existsSync(`${tmp}/clipping.json`) ? JSON.parse(await readFile(`${tmp}/clipping.json`, 'utf8')) : []) for (const f of r.findings || []) if (f.severity !== 'info') add('clipping', { check: f.check, severity: f.severity, s: f.s, at: `${Math.round(f.s)} m`, note: f.note || f.label });
  }
  let gpu = null;
  if (o.gpu) {
    process.stderr.write('gpu ');
    const post = `import('/tools/qc-gpu.js').then((m) => m.runGpuQC(w, T, { budget: ${JSON.stringify(await budgetOf(t))} }))`;
    const r = await run('node', ['tools/snap_scene.mjs', '--software', '--out', tmp, t, '--post', post]);
    const m = r.out.match(/^\s+eval: (.*)$/m); const g = m ? JSON.parse(m[1]) : null;
    if (!g) add('gpu', { check: 'gpuFailed', severity: 'fail', at: t, note: r.out.slice(-300) });
    else { gpu = g.gpu; for (const d of g.defects) add('gpu', { check: d.check, severity: SEVERITY[d.check] || 'fail', id: d.id, at: t, note: d.note }); }
  }
  process.stderr.write('\n');
  return { findings: F, gpu };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
  const flag = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
  const jsonOut = opt('--json', null), nEv = +opt('--evidence', 0);
  const sI = args.indexOf('--sweep'); let sweep = 0; if (sI >= 0) { const v = +args[sI + 1]; sweep = v > 0 ? v : 600; args.splice(sI, v > 0 ? 2 : 1); }
  const o = { sweep, evidence: nEv, gpu: flag('--gpu'), fast: flag('--fast') }, strict = flag('--strict');
  if (!args.length) { console.error('usage: node tools/qc.mjs <map|endless|route …> [--sweep [m]] [--gpu] [--evidence N] [--json f] [--strict] [--fast]'); process.exit(2); }
  const all = [], detail = {};
  for (const t of args) {
    const k = await kindOf(t);
    if (!k) { console.error(`${t}: not a graph map, endless or a route scene`); process.exitCode = 2; continue; }
    const r = k === 'route' ? await routeTarget(t, o) : await mapTarget(t, o);
    all.push(...r.findings); detail[t] = r;
    const n = (s) => r.findings.filter((f) => f.severity === s).length;
    console.log(`${n('fail') ? 'FAIL' : n('warn') ? 'warn' : 'ok  '} ${t.padEnd(16)} ${String(n('fail')).padStart(4)} fail ${String(n('warn')).padStart(4)} warn`);
    const by = {}; for (const f of r.findings) (by[`${f.severity} ${f.source}:${f.check}`] ||= []).push(f);
    for (const [k2, list] of Object.entries(by).sort()) console.log(`       ${k2.padEnd(34)} ${String(list.length).padStart(4)}   e.g. ${list[0].id} ${list[0].at} ${String(list[0].note || '').slice(0, 70)}`);
    if (r.gpu) console.log(`       gpu: ${r.gpu.calls} calls, ${(r.gpu.triangles / 1e6).toFixed(2)} M tris, ${r.gpu.programs} programs, ${r.gpu.heapMB} MB`);
  }
  if (jsonOut) { await mkdir(dirname(resolve(ROOT, jsonOut)), { recursive: true }); await writeFile(resolve(ROOT, jsonOut), JSON.stringify({ findings: all, detail }, null, 1)); }
  if (all.some((f) => f.severity === 'fail' || (strict && f.severity === 'warn'))) process.exitCode = 1;
}
