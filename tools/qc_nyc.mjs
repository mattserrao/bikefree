// The NYC map's visual QC: tools/qc_map.mjs with NYC's sites (tools/qc/sites/nyc.json — the review's twelve, 25 Nov).
//   node tools/qc_nyc.mjs [site …] [--json f] [--baseline f] [--out dir]      (= node tools/qc_map.mjs nyc …)
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
spawn('node', ['tools/qc_map.mjs', 'nyc', ...process.argv.slice(2)], { cwd: ROOT, stdio: 'inherit' }).on('close', (c) => process.exit(c ?? 0));
