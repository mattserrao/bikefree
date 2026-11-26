// Visual QC for any free-ride graph map (PGH, CNY, SKAN, NYC, …): at each site the preview page builds the world round
// the camera with the landmarks' QC probes on (?qc=1), and tools/qc-map.js counts the visual faults there — then the
// shot is saved beside the counts. The checks that need a map's own data (ring pools, landmarks, benches, allées)
// count nothing on a map without it.
//
//   node tools/qc_map.mjs <map> [site …] [--sites tools/qc/sites/<map>.json] [--auto 8] [--out /tmp/qc/<map>]
//                         [--json tools/qc/<map>-qc.json] [--baseline <json>] [--radius 420]
//                         [--sweep [600]]   the whole map: a site every 600 m over its ways (radius 0.75 × step)
//                         [--evidence 12]   close-ups of the first 12 defects → <out>/defects/, <out>/defects.json
//                         [--gpu]           + shader / GL errors and the frame against tools/qc/budgets.json (tools/qc-gpu.js)
//   npm run qc:map -- nyc            npm run qc:map -- skan --auto 6
//
// Sites: tools/qc/sites/<map>.json — { "<name>": "<lat>,<lon>[,<dir>][@<metres>][#<eye lat>,<eye lon>,<up>,<look lat>,<look lon>,<up>]" }
// (tools/snap_pgh.mjs's shot spec); with none (or --auto N) the sites are spread over the map: N rider spots on its
// ways, evenly through its edges, and a look at each of its first landmarks.
//
// The checks (tools/qc-map.js): strayWater, bankShard, bankCliff, dryBasin, bridgeDup, floating, waterOverWay,
// pathPaint, edgeLip, edgeDitch, joinGap, sharpCorner, alleeTrees, gritEdges, benchOnWay, viewBlocked (+ trees counted).
// With --baseline, each count prints as before→after.
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const KEYS_ALL = ['strayWater', 'bankShard', 'bankCliff', 'dryBasin', 'bridgeDup', 'floating', 'waterOverWay', 'pathPaint', 'edgeLip', 'edgeDitch', 'joinGap', 'sharpCorner', 'alleeTrees', 'gritEdges', 'benchOnWay', 'viewBlocked', 'trees'];
export const KEYS = KEYS_ALL;

/** The sites of a map: its site file, else spread over its ways and landmarks. */
export async function sitesOf(map, { file = null, auto = 0, sweep = 0 } = {}) {
  if (sweep) return sweepSites(map, sweep);
  const f = file || resolve(ROOT, `tools/qc/sites/${map}.json`);
  if (!auto && existsSync(f)) return JSON.parse(await readFile(f, 'utf8'));
  // (the endless map: metres along its course, spread through its biomes — tools/snap_endless.mjs's spec)
  if (map === 'endless') { const n = auto || 6, out = {}; for (let k = 0; k < n; k++) out[`km${Math.round((800 + k * 6000) / 1000)}`] = `${800 + k * 6000}`; return out; }
  const n = auto || 8, net = JSON.parse(await readFile(resolve(ROOT, `routes/cities/${map}.json`), 'utf8'));
  const { decodeGraph } = await import('../js/graph.js');
  const G = decodeGraph(net), edges = G.edges.filter((e) => e.n >= 4), out = {};
  for (let k = 0; k < n; k++) { const e = edges[Math.floor((k + 0.5) * edges.length / n)], i = e.n >> 1; out[`way${k + 1}`] = `${e.lat[i].toFixed(5)},${e.lon[i].toFixed(5)},+@20`; }
  if (net.heroes && existsSync(resolve(ROOT, net.heroes))) {
    const hj = JSON.parse(await readFile(resolve(ROOT, net.heroes), 'utf8'));
    for (const l of (hj.landmarks || []).filter((q) => q.center).slice(0, Math.ceil(n / 2))) {
      const [la, lo] = l.center, eye = [la - 0.0006, lo];   // (from ~65 m south, 10 m up)
      out[l.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)] = `${la},${lo}@40#${eye[0].toFixed(5)},${eye[1].toFixed(5)},10,${la},${lo},2`;
    }
  }
  return out;
}

/** The whole map: a site every `step` m over the map's ways (a grid; each cell's site on the way sample nearest its
 *  middle, none where no way comes within the cell), so the checks' circles (radius ~ step / 1.4) cover every way.
 *  The endless map: a site every `step` m along its first 60 km. */
export async function sweepSites(map, step = 600) {
  const out = {};
  if (map === 'endless') { for (let s = 400; s <= 60000; s += step) out[`s${Math.round(s)}`] = `${s}`; return out; }
  const net = JSON.parse(await readFile(resolve(ROOT, `routes/cities/${map}.json`), 'utf8'));
  const { decodeGraph } = await import('../js/graph.js');
  const G = decodeGraph(net), cells = new Map();
  const lat0 = G.edges[0].lat[0], mLat = 111320, mLon = 111320 * Math.cos(lat0 * Math.PI / 180);
  for (const e of G.edges) for (let i = 0; i <= e.n; i += 2) {
    const y = e.lat[i] * mLat, x = e.lon[i] * mLon, k = `${Math.floor(x / step)},${Math.floor(y / step)}`;
    const cxm = (Math.floor(x / step) + 0.5) * step, cym = (Math.floor(y / step) + 0.5) * step, d = Math.hypot(x - cxm, y - cym);
    const c = cells.get(k); if (!c || d < c.d) cells.set(k, { d, lat: e.lat[i], lon: e.lon[i] });
  }
  const keys = [...cells.keys()].sort((a, b) => { const [ax, ay] = a.split(',').map(Number), [bx, by] = b.split(',').map(Number); return by - ay || ax - bx; });
  keys.forEach((k, n) => { const c = cells.get(k); out[`sw${String(n + 1).padStart(3, '0')}`] = `${c.lat.toFixed(5)},${c.lon.toFixed(5)},+@20`; });
  return out;
}

/** Close-up shots of the defects found (deduplicated by id, the first `n`): <out>/defects/<id>.png beside
 *  <out>/defects.json (each defect with its site and shot). The endless map: the rider's view at the defect. */
export async function evidence(map, res, { out = `/tmp/qc/${map}`, n = 12, log = (s) => process.stderr.write(s) } = {}) {
  const { closeup } = await import('./qc-defects.js');
  const seen = new Map();
  for (const [site, r] of Object.entries(res)) for (const d of r?.defects || []) if (!seen.has(d.id)) seen.set(d.id, { ...d, site });
  const all = [...seen.values()], pick = all.slice(0, n), dir = resolve(out, 'defects');
  await mkdir(dir, { recursive: true });
  if (pick.length) {
    const endless = map === 'endless';
    const specs = pick.map((d) => (endless ? `${d.id}@${Math.max(0, d.s - 25)}` : `${d.id}@${d.at[0]},${d.at[1]}@20#${closeup(d)}`));
    await new Promise((ok, bad) => {
      const p = spawn('node', endless ? ['tools/snap_endless.mjs', '--software', '--size', '960x540', '--out', dir, ...specs]
        : ['tools/snap_pgh.mjs', '--software', '--qc', '--size', '960x540', '--graph', `routes/cities/${map}.json`, '--out', dir, '--time', 'afternoon', ...specs], { cwd: ROOT });
      let buf = ''; p.stdout.on('data', (d) => { buf += d; log('+'); }); p.stderr.on('data', (d) => { buf += d; });
      p.on('close', (code) => (code ? bad(new Error(buf.slice(-2000))) : ok(buf)));
    });
    for (const d of pick) d.shot = endless ? `defects/${d.id}.png` : `defects/pgh-${d.id}-view.png`;
  }
  await writeFile(resolve(out, 'defects.json'), JSON.stringify(all, null, 1));
  return all;
}

/** Runs the QC at the sites: { [site]: { at, counts, examples } } (and the shots in out). */
/** A map's frame budget (tools/qc/budgets.json: its own over the default). */
export async function budgetOf(map) {
  const b = JSON.parse(await readFile(resolve(ROOT, 'tools/qc/budgets.json'), 'utf8'));
  return { ...b['*'], ...(b[map] || {}) };
}

/** The GPU check's results folded into a site's map-check results (counts, examples, defects; its stats as `gpu`). */
export const MERGE_GPU = `([a, g]) => ({ ...a, counts: { ...a.counts, ...g.counts }, examples: { ...a.examples, ...g.examples }, defects: [...(a.defects || []), ...g.defects], gpu: g.gpu })`;

export async function runQC(map, sites, { out = `/tmp/qc/${map}`, radius = 420, gpu = false, log = (s) => process.stderr.write(s) } = {}) {
  const endless = map === 'endless';
  const net = endless ? {} : JSON.parse(await readFile(resolve(ROOT, `routes/cities/${map}.json`), 'utf8'));
  const city = net.cityData ? `/${net.cityData}` : null;
  let EVAL = endless ? `import('/tools/qc-endless.js').then((m) => m.runEndlessQC(w, T, { radius: ${Math.max(radius, 600)} }))` : `import('/tools/qc-map.js').then((m) => (${city ? `fetch('${city}').then((r) => r.json())` : 'Promise.resolve({})'}).then((cd) => m.runMapQC(w, T, { radius: ${radius}, heroes: { allee: cd.allee || null } })))`;
  // (--gpu: the frame's shader / GL errors and its costs against the map's budget, tools/qc-gpu.js — after the map checks)
  if (gpu) EVAL = `${EVAL}.then((a) => import('/tools/qc-gpu.js').then((m) => m.runGpuQC(w, T, { budget: ${JSON.stringify(await budgetOf(map))} })).then((g) => (${MERGE_GPU})([a, g])))`;
  await mkdir(out, { recursive: true });
  const names = Object.keys(sites);
  const text = await new Promise((ok, bad) => {
    const p = spawn('node', endless ? ['tools/snap_endless.mjs', '--software', '--size', '1280x720', '--out', out, ...names.map((n) => `${n}@${sites[n]}`), '--eval', EVAL]
      : ['tools/snap_pgh.mjs', '--software', '--qc', '--size', '1280x720', '--graph', `routes/cities/${map}.json`, '--out', out, '--time', 'afternoon',
        ...names.map((n) => `${n}@${sites[n]}`), '--eval', EVAL], { cwd: ROOT });
    let buf = ''; p.stdout.on('data', (d) => { buf += d; log('.'); }); p.stderr.on('data', (d) => { buf += d; });
    p.on('close', (code) => (code ? bad(new Error(buf.slice(-2000))) : ok(buf)));
  });
  const evals = [...text.matchAll(/^\s+eval: (.*)$/gm)].map((m) => JSON.parse(m[1]));
  const res = {}; names.forEach((n, k) => { res[n] = evals[k]; });
  return res;
}

/** The table: a row per site, a column per check (before→after with a baseline), and the totals. */
export function report(res, base = null) {
  const names = Object.keys(res), lines = [];
  // (the graph maps' checks, else whatever the map's checks counted — the endless map's own)
  const seen = new Set(names.flatMap((n) => Object.keys(res[n]?.counts || {})));
  const AUX = ['edgeSamples', 'skewCorner'];   // (and with --gpu its three checks, as their own columns)
  const GPUK = ['shaderErrors', 'glErrors', 'overBudget'];   // (counted alongside, not checks)
  const base0 = [...seen].filter((k) => !GPUK.includes(k));
  const KEYS = [...(base0.every((k) => KEYS_ALL.includes(k) || AUX.includes(k)) ? KEYS_ALL : base0.filter((k) => !AUX.includes(k))), ...GPUK.filter((k) => seen.has(k))];
  lines.push(`${'site'.padEnd(14)} ${KEYS.map((k) => k.slice(0, 9).padStart(9)).join(' ')}`);
  const cell = (v, b) => String(b !== undefined && b !== v ? `${b}→${v}` : v).padStart(9);
  for (const n of names) { const c = res[n]?.counts || {}; lines.push(`${n.slice(0, 14).padEnd(14)} ${KEYS.map((k) => cell(c[k] ?? '-', base?.[n]?.counts?.[k])).join(' ')}`); }
  const tot = (r) => { const t = {}; for (const n of names) for (const k of KEYS) { const v = r?.[n]?.counts?.[k]; if (typeof v === 'number') t[k] = (t[k] || 0) + v; } return t; };
  const T1 = tot(res), T0 = base ? tot(base) : null;
  lines.push(`${'total'.padEnd(14)} ${KEYS.map((k) => cell(T1[k] ?? '-', T0?.[k])).join(' ')}`);
  for (const n of names) if (res[n]?.gpu) { const g = res[n].gpu; lines.push(`  ${n} gpu: ${g.calls} calls, ${(g.triangles / 1e6).toFixed(2)} M tris, ${g.geometries} geometries, ${g.textures} textures, ${g.programs} programs, ${g.heapMB} MB${g.capture ? ` · capture ${g.capture.commands} commands, ${g.capture.programBinds} program / ${g.capture.textureBinds} texture binds, ${g.capture.redundant} redundant` : ''}`); }
  for (const n of names) for (const [k, list] of Object.entries(res[n]?.examples || {})) lines.push(`  ${n} ${k}: ${list.slice(0, 3).map((e) => e.join(' ')).join(' | ')}`);
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
  const sitesFile = opt('--sites', null), auto = +opt('--auto', 0), sweepI = args.indexOf('--sweep');
  // (--sweep [step m]: the whole map; the checks' radius follows the step so the circles overlap)
  let sweep = 0; if (sweepI >= 0) { const v = +args[sweepI + 1]; sweep = v > 0 ? v : 600; args.splice(sweepI, v > 0 ? 2 : 1); }
  const radius = +opt('--radius', sweep ? Math.round(sweep * 0.75) : 420), nEvidence = +opt('--evidence', 0);
  const gpuI = args.indexOf('--gpu'), gpu = gpuI >= 0; if (gpu) args.splice(gpuI, 1);
  const jsonOut = opt('--json', null), baseline = opt('--baseline', null);
  const map = args.shift();
  if (!map) { console.error('usage: node tools/qc_map.mjs <map> [site …] [--sites f] [--auto N] [--out dir] [--json f] [--baseline f]'); process.exit(2); }
  const out = opt('--out', `/tmp/qc/${map}`);
  let sites = await sitesOf(map, { file: sitesFile, auto, sweep });
  if (args.length) sites = Object.fromEntries(args.map((n) => [n, sites[n]]).filter(([, v]) => v));
  const res = await runQC(map, sites, { out, radius, gpu });
  const base = baseline ? JSON.parse(await readFile(baseline, 'utf8')) : null;
  console.log(`\n${report(res, base)}`);
  if (nEvidence) { const all = await evidence(map, res, { out, n: nEvidence }); console.log(`\n${all.length} defects (${Math.min(all.length, nEvidence)} shot) → ${out}/defects.json`); }
  if (jsonOut) { await mkdir(dirname(resolve(ROOT, jsonOut)), { recursive: true }); await writeFile(resolve(ROOT, jsonOut), JSON.stringify(res, null, 1)); }
}
