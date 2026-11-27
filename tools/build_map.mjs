#!/usr/bin/env node
// One build for any graph map (fidelity plan, step 7): the same chain CNY, SKAN and NYC each had as their own npm script,
// driven by the map's config (tools/city/<id>.json) and its optional extra steps there ("buildSteps": ["tools/x.py", …]).
//   node tools/build_map.mjs <id> [--offline] [--no-qc]      (npm run map:build -- <id>)
// Steps: the road graph and ground (build_pgh.py), the city layer (pgh_city.py), the map's own extras (heroes, forests…),
// the preset routes (pgh_routes.mjs --write), then the network QC (qc_pgh.mjs, 200 rides) unless --no-qc.
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const [id, ...rest] = process.argv.slice(2);
if (!id) { console.error('usage: node tools/build_map.mjs <id> [--offline] [--no-qc]'); process.exit(2); }
const cfgPath = `tools/city/${id}.json`;
if (!existsSync(ROOT + cfgPath)) { console.error(`no ${cfgPath}`); process.exit(2); }
const cfg = JSON.parse(readFileSync(ROOT + cfgPath, 'utf8'));
// (--offline, or BIKEFREE_OFFLINE=1: every step gets BIKEFREE_OFFLINE=1 in its environment and the Python steps --offline
//  too — tools/citylib/offline.py: a download stops the build instead)
const offline = rest.includes('--offline') || !['', '0', undefined].includes(process.env.BIKEFREE_OFFLINE) ? ['--offline'] : [];
const env = offline.length ? { ...process.env, BIKEFREE_OFFLINE: '1' } : process.env;
const steps = [
  ['python3', ['tools/build_pgh.py', '--city', id, ...offline]],
  ['python3', ['tools/pgh_city.py', '--city', id, ...offline]],
  ...(cfg.buildSteps || []).map((s) => { const [f, ...args] = s.split(' '); return f.endsWith('.py') ? ['python3', [f, ...args, ...offline]] : ['node', [f, ...args]]; }),   // (a step may carry its own arguments)
  ['node', ['tools/pgh_routes.mjs', '--city', id, '--write']],
  ...(rest.includes('--no-qc') ? [] : [['node', ['tools/qc_pgh.mjs', `routes/cities/${id}.json`, '--rides', '200']]]),
];
for (const [cmd, args] of steps) {
  console.log(`\n▶ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: ROOT, env, stdio: 'inherit' });
  if (r.status !== 0) { console.error(`✖ ${args[0]} failed (${r.error ? r.error.message : r.status ?? r.signal})`); process.exit(r.status || 1); }   // (a signal or a failed spawn too)
}
console.log(`\n✔ ${id} built`);
