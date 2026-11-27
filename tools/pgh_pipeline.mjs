// PGH from scratch, every step in order (npm run pgh:build). Each step that renumbers the ways (save in
// tools/pgh_graph_edit.mjs drops the routes) is followed by matching the routes again, because the next step reads them.
//   node tools/pgh_pipeline.mjs [--offline] [--from <step>]
// --offline (or BIKEFREE_OFFLINE=1) reaches every step: BIKEFREE_OFFLINE=1 in their environment (tools/citylib/offline.py)
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const offline = args.includes('--offline') || !['', '0', undefined].includes(process.env.BIKEFREE_OFFLINE) ? ' --offline' : '';
const env = offline ? { ...process.env, BIKEFREE_OFFLINE: '1' } : process.env;
const from = args.includes('--from') ? args[args.indexOf('--from') + 1] : null;
const run = (cmd, quiet = false) => {
  const t0 = Date.now();
  const out = execSync(cmd, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 26 });
  const lines = out.trim().split('\n');
  console.log(`· ${cmd.replace(/^node tools\/|^python3 tools\//, '')} (${((Date.now() - t0) / 1000).toFixed(0)} s)${quiet ? '' : '\n    ' + lines.slice(-2).join('\n    ')}`);
  return out;
};
const map = () => run('node tools/pgh_routes.mjs --write', true);   // (PGH's routes, laid out on PGH: tools/pgh_routes.mjs)
// the grade separations: check (tools/pgh_crossings.mjs), fix, lay the routes out again — up to `tries` times; still
// failing after the last fix is an error (code review P4: it used to fall out of the loop and carry on)
export const SEPARATION_PROBLEM = /(low|clash|no-deck|level|kink)'?:/;
export function separations(run, map, tries = 4) {
  let first = '';
  for (let k = 0; k <= tries; k++) {
    first = run('node tools/pgh_crossings.mjs').split('\n')[0];
    if (!SEPARATION_PROBLEM.test(first)) return k;
    if (k === tries) break;
    run('node tools/fix_separations_pgh.mjs'); map();
  }
  throw new Error(`grade separations still failing after ${tries} fixes: ${first}`);
}
const seps = () => separations(run, map);
const steps = [
  ['build', () => { run(`python3 tools/build_pgh.py${offline}`); map(); }],
  ['prune', () => { run('node tools/prune_pgh.mjs'); map(); }],
  ['neaten', () => { run('node tools/pgh_junctions.mjs'); run('node tools/neaten_pgh.mjs'); map(); }],
  ['riverside', () => { run('node tools/pgh_shore.mjs'); run('node tools/riverside_pgh.mjs'); map(); seps(); run('node tools/pgh_dressing.mjs'); run('node tools/pgh_bridges.mjs'); run(`python3 tools/pgh_city.py${offline}`); }],
  ['loops', () => { for (let k = 0; k < 2; k++) { run('node tools/pgh_loops.mjs'); run('node tools/fix_loops_pgh.mjs'); map(); } }],
  ['stubs', () => {
    run('node tools/pgh_stubs.mjs'); run('node tools/remove_stubs_pgh.mjs'); map();
    run('node tools/pgh_stubs.mjs'); run('node tools/remove_stubs_pgh.mjs --why trimmed --max-m 150'); map();
    run('node tools/pgh_junctions.mjs'); run('node tools/neaten_pgh.mjs'); map();   // (with the stubs gone, more junctions can be tidied)
    for (let k = 0; k < 2; k++) { run('node tools/pgh_loops.mjs'); run('node tools/fix_loops_pgh.mjs'); map(); }   // (joining through can close a loop)
    seps();
  }],
  // the gaps found laying out the routes (tools/fix_gaps_pgh.mjs: the Rachel Carson Bridge's north end, the David
  // McCullough Bridge, the North Shore Trail at Millvale and past Acrisure Stadium); then the bridge models and the city
  // data on the final edges, and the routes again (they read the city data's one-way streets)
  ['gaps', () => { run('node tools/fix_gaps_pgh.mjs'); map(); seps(); run('node tools/pgh_bridges.mjs'); run(`python3 tools/pgh_city.py${offline}`); map(); }],
  ['report', () => {
    run('node tools/pgh_shore.mjs'); run('node tools/riverside_pgh.mjs'); map(); seps();
    run('node tools/pgh_bridges.mjs'); run(`python3 tools/pgh_city.py${offline}`); map();   // (the city data is keyed by edge id: again after any renumbering)
    for (const c of ['node tools/pgh_junctions.mjs', 'node tools/pgh_stubs.mjs', 'node tools/pgh_loops.mjs', 'node tools/pgh_crossings.mjs', 'python3 tools/pgh_landmarks.py', 'python3 tools/pgh_riverbank.py', 'node tools/pgh_riverbank_check.mjs', 'node tools/qc_pgh.mjs', 'node tools/pgh_map_page.mjs']) run(c);
  }],
];
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (from && !steps.some(([name]) => name === from)) { console.error(`no step ${from} (${steps.map(([n]) => n).join(', ')})`); process.exit(2); }
  let on = !from;
  try {
    for (const [name, f] of steps) { if (name === from) on = true; if (!on) continue; console.log(`\n== ${name}`); f(); }
  } catch (err) { console.error(`✖ ${err.message.split('\n')[0]}`); process.exit(1); }
}
