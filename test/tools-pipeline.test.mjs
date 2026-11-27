// The map pipeline's own guards (code review 27 Nov 2026, wave 1: P2, P3, P4, P10, P11, P14). The Python parts run in
// a python3 child (skipped when there is no python3; the parts that need numpy are skipped without it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { separations } from '../tools/pgh_pipeline.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TOOLS = join(ROOT, 'tools');
const sources = (exts) => {
  const out = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      if (n === '.cache' || n === 'node_modules' || n === 'snapshots' || n === '__pycache__') continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (exts.some((e) => n.endsWith(e))) out.push(p);
    }
  };
  walk(TOOLS);
  return out;
};
const PY = spawnSync('python3', ['--version']).status === 0;
const hasNumpy = PY && spawnSync('python3', ['-c', 'import numpy, scipy, PIL']).status === 0;
const py = (code, env = {}) => spawnSync('python3', ['-c', code], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env, PYTHONPATH: TOOLS } });

test('P3: every gzip the tools write has mtime 0 (the same bytes on every rebuild)', () => {
  const bad = [];
  for (const f of sources(['.py'])) {
    const s = readFileSync(f, 'utf8');
    // gzip.compress(…) — the call's text up to its closing parenthesis at the same depth
    for (const m of s.matchAll(/gzip\.(compress|GzipFile)\(/g)) {
      let depth = 1, i = m.index + m[0].length;
      while (depth && i < s.length) { if (s[i] === '(') depth++; else if (s[i] === ')') depth--; i++; }
      if (!/mtime\s*=\s*0\b/.test(s.slice(m.index, i))) bad.push(`${relative(ROOT, f)}:${s.slice(0, m.index).split('\n').length}`);
    }
    // gzip.open(…, 'w…') writes the time too
    for (const m of s.matchAll(/gzip\.open\([^)]*['"][wax]b?t?['"]/g)) bad.push(`${relative(ROOT, f)}:${s.slice(0, m.index).split('\n').length} (gzip.open for writing: use gzip.compress(…, mtime=0))`);
  }
  assert.deepEqual(bad, [], `gzip writes without mtime=0:\n${bad.join('\n')}`);
});

test('P3: Node\'s zlib gzip header carries no time (so the Node tools need nothing)', async () => {
  const { gzipSync } = await import('node:zlib');
  assert.equal(gzipSync(Buffer.from('x'), { level: 9 }).readUInt32LE(4), 0);
});

test('P10: no tool hard-codes a checkout or /tmp', () => {
  const bad = [];
  for (const f of sources(['.py', '.mjs', '.js'])) {
    readFileSync(f, 'utf8').split('\n').forEach((line, k) => {
      if (/\/home\/claude\b|['"`]\/tmp\//.test(line)) bad.push(`${relative(ROOT, f)}:${k + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('P11: no silent catch-alls in the city step; build_pgh needs numpy', () => {
  const city = readFileSync(join(TOOLS, 'pgh_city.py'), 'utf8');
  assert.doesNotMatch(city, /except Exception:\s*(pass|continue)\b/);
  const pgh = readFileSync(join(TOOLS, 'build_pgh.py'), 'utf8');
  assert.doesNotMatch(pgh, /except Exception:/);
  assert.match(pgh, /^import numpy as np/m);
});

test('P4: separations() fails after its last fix instead of carrying on', () => {
  const calls = [];
  const failing = (cmd) => { calls.push(cmd); return cmd.includes('pgh_crossings') ? "{ 'clash': 3 }\n" : ''; };
  assert.throws(() => separations(failing, () => calls.push('map'), 4), /still failing after 4 fixes/);
  assert.equal(calls.filter((c) => c.includes('fix_separations')).length, 4);
  assert.equal(calls.filter((c) => c.includes('pgh_crossings')).length, 5);   // (the last fix is checked too)
  let n = 0;
  const fixedOnSecond = (cmd) => (cmd.includes('pgh_crossings') ? (n++ < 1 ? "{ 'low': 1 }" : '{}') : '');
  assert.equal(separations(fixedOnSecond, () => {}, 4), 1);
});

test('P4: the PGH pipeline and build_map pass offline to every step', () => {
  const pipe = readFileSync(join(TOOLS, 'pgh_pipeline.mjs'), 'utf8');
  assert.match(pipe, /execSync\(cmd, \{[^}]*\benv\b/);
  assert.doesNotMatch(pipe, /run\('python3 tools\/pgh_city\.py'\)/);
  const map = readFileSync(join(TOOLS, 'build_map.mjs'), 'utf8');
  assert.match(map, /spawnSync\(cmd, args, \{[^}]*\benv\b/);
  assert.match(map, /BIKEFREE_OFFLINE: '1'/);
});

test('P4: offline (flag or BIKEFREE_OFFLINE=1) stops a download', { skip: !PY && 'no python3' }, () => {
  const code = 'from citylib.offline import guard\ntry:\n  guard("https://example.invalid/x")\n  print("fetched")\nexcept RuntimeError as e: print("stopped", e)';
  assert.match(py(code, { BIKEFREE_OFFLINE: '1' }).stdout, /^stopped offline: https:\/\/example\.invalid\/x/);
  assert.match(py(code, { BIKEFREE_OFFLINE: '' }).stdout, /^fetched/);
});

test('P4: the warp\'s DEM and WorldCover honour offline', { skip: !hasNumpy && 'no numpy/scipy/Pillow' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'bf-offline-'));
  try {
    const code = `
import citylib.warp as W, citylib.landcover as L
W.CACHE = L.CACHE = ${JSON.stringify(dir)}
for f in (lambda: W.Dem()._tile(1, 1), lambda: L._fetch('N42W077')):
    try: f(); print('downloaded')
    except RuntimeError as e: print('stopped', str(e).split(':')[0])`;
    const r = py(code, { BIKEFREE_OFFLINE: '1' });
    assert.equal(r.stdout.trim(), 'stopped offline\nstopped offline', r.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('P2: the city step reads only its box\'s OSM tiles and stops on none or too few nodes', { skip: !PY && 'no python3' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'bf-osm-'));
  try {
    // tiles of 0.01° × 0.008°: two overlapping the box, a split tile (depth 1: 0.005° × 0.004°) inside it and one just
    // outside it, one far away (an older, larger box's), one stray file
    for (const n of ['t_40.4000_-80.0000_0.osm', 't_40.4080_-80.0000_0.osm', 't_40.4000_-79.9950_1.osm', 't_40.3960_-80.0100_1.osm', 't_41.0000_-81.0000_0.osm', 'notes.osm']) writeFileSync(join(dir, n), '<osm/>');
    const code = `
import json
from citylib.osm_tiles import tiles_in_box, require_tiles, check_nodes
k, s, u = tiles_in_box(${JSON.stringify(dir)}, (40.401, -79.999, 40.410, -79.991), [0.01, 0.008])
print(json.dumps([[p.split('/')[-1] for p in x] for x in (k, s, u)]))
for f in (lambda: require_tiles(${JSON.stringify(dir)}, (10, 10, 11, 11), [0.01, 0.008], 'x'), lambda: check_nodes(12, 1000, 'x')):
    try: f(); print('ran on')
    except SystemExit as e: print('stopped', str(e).split(':')[0])
check_nodes(5000, 1000, 'x'); print('ok')`;
    const r = py(code);
    const [first, ...rest] = r.stdout.trim().split('\n');
    assert.deepEqual(JSON.parse(first), [['t_40.4000_-79.9950_1.osm', 't_40.4000_-80.0000_0.osm', 't_40.4080_-80.0000_0.osm'], ['t_40.3960_-80.0100_1.osm', 't_41.0000_-81.0000_0.osm'], ['notes.osm']], r.stderr);
    assert.deepEqual(rest.filter((l) => !l.startsWith('  OSM:')), ['stopped pgh_city', 'stopped pgh_city', 'ok']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('P11: skipped multipolygons are counted, and too many stop the build', { skip: !PY && 'no python3' }, () => {
  const code = `
from citylib.skips import Skips
def boom(): raise ValueError('ring')
S = Skips('t', share=0.02, floor=2)
for i in range(100): S.attempt('rings', i, boom if i < 2 else (lambda: [1]))
print(S.report())
for i in range(3): S.attempt('rings', 'x', boom)
try: S.report(); print('ran on')
except SystemExit as e: print('stopped', e)`;
  const r = py(code);
  const out = r.stdout.trim().split('\n');
  assert.match(out[0], /skipped 2 of 100 rings \(first: 0: ValueError: ring\)/, r.stderr);
  assert.equal(out[1], "{'rings': 2}");
  assert.match(out.at(-1), /^stopped t: too many skipped — rings 5\/103/);
});

test('P14: nothing git-ignored is tracked', { skip: spawnSync('git', ['rev-parse'], { cwd: ROOT }).status !== 0 && 'not a git checkout' }, () => {
  const r = spawnSync('git', ['ls-files', '-ci', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.stdout.trim(), '', `tracked despite .gitignore (git rm --cached them):\n${r.stdout}`);
});
