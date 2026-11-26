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
const offline = rest.includes('--offline') ? ['--offline'] : [];
const steps = [
  ['python3', ['tools/build_pgh.py', '--city', id, ...offline]],
  ['python3', ['tools/pgh_city.py', '--city', id, ...offline]],
  ...(cfg.buildSteps || []).map((s) => (s.endsWith('.py') ? ['python3', [s, ...offline]] : ['node', [s]])),
  ['node', ['tools/pgh_routes.mjs', '--city', id, '--write']],
  ...(rest.includes('--no-qc') ? [] : [['node', ['tools/qc_pgh.mjs', `routes/cities/${id}.json`, '--rides', '200']]]),
];
for (const [cmd, args] of steps) {
  console.log(`\n▶ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  if (r.status) { console.error(`✖ ${args[0]} failed (${r.status})`); process.exit(r.status); }
}
console.log(`\n✔ ${id} built`);
