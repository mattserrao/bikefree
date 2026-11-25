// Visual QC for any free-ride graph map (PGH, CNY, SKAN, NYC, …): at each site the preview page builds the world round
// the camera with the landmarks' QC probes on (?qc=1), and tools/qc-map.js counts the visual faults there — then the
// shot is saved beside the counts. The checks that need a map's own data (ring pools, landmarks, benches, allées)
// count nothing on a map without it.
//
//   node tools/qc_map.mjs <map> [site …] [--sites tools/qc/sites/<map>.json] [--auto 8] [--out /tmp/qc/<map>]
//                         [--json tools/qc/<map>-qc.json] [--baseline <json>] [--radius 420]
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
export const KEYS = ['strayWater', 'bankShard', 'bankCliff', 'dryBasin', 'bridgeDup', 'floating', 'waterOverWay', 'pathPaint', 'edgeLip', 'edgeDitch', 'joinGap', 'sharpCorner', 'alleeTrees', 'gritEdges', 'benchOnWay', 'viewBlocked', 'trees'];

/** The sites of a map: its site file, else spread over its ways and landmarks. */
export async function sitesOf(map, { file = null, auto = 0 } = {}) {
  const f = file || resolve(ROOT, `tools/qc/sites/${map}.json`);
  if (!auto && existsSync(f)) return JSON.parse(await readFile(f, 'utf8'));
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

/** Runs the QC at the sites: { [site]: { at, counts, examples } } (and the shots in out). */
export async function runQC(map, sites, { out = `/tmp/qc/${map}`, radius = 420, log = (s) => process.stderr.write(s) } = {}) {
  const net = JSON.parse(await readFile(resolve(ROOT, `routes/cities/${map}.json`), 'utf8'));
  const city = net.cityData ? `/${net.cityData}` : null;
  const EVAL = `import('/tools/qc-map.js').then((m) => (${city ? `fetch('${city}').then((r) => r.json())` : 'Promise.resolve({})'}).then((cd) => m.runMapQC(w, T, { radius: ${radius}, heroes: { allee: cd.allee || null } })))`;
  await mkdir(out, { recursive: true });
  const names = Object.keys(sites);
  const text = await new Promise((ok, bad) => {
    const p = spawn('node', ['tools/snap_pgh.mjs', '--software', '--qc', '--size', '1280x720', '--graph', `routes/cities/${map}.json`, '--out', out, '--time', 'afternoon',
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
  lines.push(`${'site'.padEnd(14)} ${KEYS.map((k) => k.slice(0, 9).padStart(9)).join(' ')}`);
  const cell = (v, b) => String(b !== undefined && b !== v ? `${b}→${v}` : v).padStart(9);
  for (const n of names) { const c = res[n]?.counts || {}; lines.push(`${n.slice(0, 14).padEnd(14)} ${KEYS.map((k) => cell(c[k] ?? '-', base?.[n]?.counts?.[k])).join(' ')}`); }
  const tot = (r) => { const t = {}; for (const n of names) for (const k of KEYS) { const v = r?.[n]?.counts?.[k]; if (typeof v === 'number') t[k] = (t[k] || 0) + v; } return t; };
  const T1 = tot(res), T0 = base ? tot(base) : null;
  lines.push(`${'total'.padEnd(14)} ${KEYS.map((k) => cell(T1[k] ?? '-', T0?.[k])).join(' ')}`);
  for (const n of names) for (const [k, list] of Object.entries(res[n]?.examples || {})) lines.push(`  ${n} ${k}: ${list.slice(0, 3).map((e) => e.join(' ')).join(' | ')}`);
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
  const sitesFile = opt('--sites', null), auto = +opt('--auto', 0), radius = +opt('--radius', 420);
  const jsonOut = opt('--json', null), baseline = opt('--baseline', null);
  const map = args.shift();
  if (!map) { console.error('usage: node tools/qc_map.mjs <map> [site …] [--sites f] [--auto N] [--out dir] [--json f] [--baseline f]'); process.exit(2); }
  const out = opt('--out', `/tmp/qc/${map}`);
  let sites = await sitesOf(map, { file: sitesFile, auto });
  if (args.length) sites = Object.fromEntries(args.map((n) => [n, sites[n]]).filter(([, v]) => v));
  const res = await runQC(map, sites, { out, radius });
  const base = baseline ? JSON.parse(await readFile(baseline, 'utf8')) : null;
  console.log(`\n${report(res, base)}`);
  if (jsonOut) { await mkdir(dirname(resolve(ROOT, jsonOut)), { recursive: true }); await writeFile(resolve(ROOT, jsonOut), JSON.stringify(res, null, 1)); }
}
