// PGH from scratch, every step in order (npm run pgh:build). Each step that renumbers the ways (save in
// tools/pgh_graph_edit.mjs drops the routes) is followed by matching the routes again, because the next step reads them.
//   node tools/pgh_pipeline.mjs [--offline] [--from <step>]
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const offline = args.includes('--offline') ? ' --offline' : '';
const from = args.includes('--from') ? args[args.indexOf('--from') + 1] : null;
const run = (cmd, quiet = false) => {
  const t0 = Date.now();
  const out = execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 26 });
  const lines = out.trim().split('\n');
  console.log(`· ${cmd.replace(/^node tools\/|^python3 tools\//, '')} (${((Date.now() - t0) / 1000).toFixed(0)} s)${quiet ? '' : '\n    ' + lines.slice(-2).join('\n    ')}`);
  return out;
};
const map = () => run('node tools/pgh_routes.mjs --write', true);   // (PGH's routes, laid out on PGH: tools/pgh_routes.mjs)
const separations = () => {
  for (let k = 0; k < 4; k++) {
    const out = run('node tools/pgh_crossings.mjs');
    if (!/(low|clash|no-deck|level|kink)'?:/.test(out.split('\n')[0])) return;
    run('node tools/fix_separations_pgh.mjs'); map();
  }
};
const steps = [
  ['build', () => { run(`python3 tools/build_pgh.py${offline}`); map(); }],
  ['prune', () => { run('node tools/prune_pgh.mjs'); map(); }],
  ['neaten', () => { run('node tools/pgh_junctions.mjs'); run('node tools/neaten_pgh.mjs'); map(); }],
  ['riverside', () => { run('node tools/pgh_shore.mjs'); run('node tools/riverside_pgh.mjs'); map(); separations(); run('node tools/pgh_dressing.mjs'); run('node tools/pgh_bridges.mjs'); run('python3 tools/pgh_city.py'); }],
  ['loops', () => { for (let k = 0; k < 2; k++) { run('node tools/pgh_loops.mjs'); run('node tools/fix_loops_pgh.mjs'); map(); } }],
  ['stubs', () => {
    run('node tools/pgh_stubs.mjs'); run('node tools/remove_stubs_pgh.mjs'); map();
    run('node tools/pgh_stubs.mjs'); run('node tools/remove_stubs_pgh.mjs --why trimmed --max-m 150'); map();
    run('node tools/pgh_junctions.mjs'); run('node tools/neaten_pgh.mjs'); map();   // (with the stubs gone, more junctions can be tidied)
    for (let k = 0; k < 2; k++) { run('node tools/pgh_loops.mjs'); run('node tools/fix_loops_pgh.mjs'); map(); }   // (joining through can close a loop)
    separations();
  }],
  ['report', () => {
    run('node tools/pgh_shore.mjs'); run('node tools/riverside_pgh.mjs'); map(); separations();
    for (const c of ['node tools/pgh_junctions.mjs', 'node tools/pgh_stubs.mjs', 'node tools/pgh_loops.mjs', 'node tools/pgh_crossings.mjs', 'python3 tools/pgh_landmarks.py', 'python3 tools/pgh_riverbank.py', 'node tools/pgh_riverbank_check.mjs', 'node tools/qc_pgh.mjs', 'node tools/pgh_map_page.mjs']) run(c);
  }],
];
let on = !from;
for (const [name, f] of steps) { if (name === from) on = true; if (!on) continue; console.log(`\n== ${name}`); f(); }
