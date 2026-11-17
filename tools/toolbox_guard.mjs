// Toolbox refactor guard: renders a fixed set of shots on every route with a frozen clock and seeded random,
// then compares two runs pixel-for-pixel and object-by-object. Use it whenever shared toolbox code moves, so a
// refactor can prove that no route changed.
//
//   node tools/toolbox_guard.mjs record /tmp/before          # on the old code
//   node tools/toolbox_guard.mjs record /tmp/after           # on the new code
//   node tools/toolbox_guard.mjs compare /tmp/before /tmp/after
//   node tools/toolbox_guard.mjs record /tmp/x route28 bigsur   # only some routes
//
// Shots are 640x360 PNGs, software GPU, Balanced quality. "compare" lists every shot whose pixels or object
// fingerprints differ, and which named objects changed.
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Active routes get several spots and conditions; deprecated and rough-draft routes get one, to show they still build.
export const GUARD_SHOTS = {
  route28: ['route28@1200', 'route28@10650', 'route28@15200', 'route28@19050:morning:fall'],
  bigsur: ['bigsur@2100', 'bigsur@15420', 'bigsur@24000:golden:marine'],
  goingtothesun: ['goingtothesun@6000', 'goingtothesun@30000', 'goingtothesun@47200', 'goingtothesun@60000:clouds'],
  pittsburgh: ['pittsburgh@1500', 'pittsburgh@8000', 'pittsburgh@13100:golden'],
  zion: ['zion@2500', 'zion@6700'],
  yosemite: ['yosemite@7610'],
  acadia: ['acadia@8460'],
  teton: ['teton@5500'],
  craterlake: ['craterlake@10500'],
  monumentvalley: ['monumentvalley@250'],
  sevenmile: ['sevenmile@7000'],
  alpedhuez: ['alpedhuez@24480', 'alpedhuez@98300', 'alpedhuez@120800', 'alpedhuez@126700'],
};

// Objects seeded from Math.random in async load order (they differ run to run on the same code): reported,
// not failed.
export const NOISY = ['Point State Park fountain', 'Buses', 'Cars', 'People', 'Cyclists'];

// Streamed real terrain (wireframe routes) needs the network and a running clock, so these are only checked
// to render without errors (no pixel or fingerprint comparison).
export const LIVE_SHOTS = {};

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'record') {
  const [out, ...routes] = rest;
  if (!out) usage();
  const all = { ...GUARD_SHOTS, ...LIVE_SHOTS };
  const shots = (routes.length ? routes : Object.keys(all)).flatMap((r) => all[r] || [r]);
  // one browser page per route, so a route's result never depends on which routes ran before it
  let failed = false;
  const rows = [];
  for (const route of new Set(shots.map((s) => s.split(/[@:]/)[0]))) {
    const mine = shots.filter((s) => s.split(/[@:]/)[0] === route);
    const dir = join(out, route);
    const live = !!LIVE_SHOTS[route];
    const r = spawnSync('node', [join(ROOT, 'tools/snap_scene.mjs'), '--software', '--size', '640x360', '--out', dir, ...(live ? [] : ['--png', '--fingerprint']), ...mine], { cwd: ROOT, stdio: 'inherit' });
    if (r.status) failed = true;
    if (existsSync(join(dir, 'snapshots.json'))) rows.push(...JSON.parse(readFileSync(join(dir, 'snapshots.json'))).rows.map((x) => ({ ...x, route })));
  }
  console.log(`\n${rows.length} shots recorded in ${out}${failed ? ' (with errors)' : ''}`);
  process.exitCode = failed ? 1 : 0;
} else if (cmd === 'compare') {
  const [a, b] = rest;
  if (!a || !b) usage();
  const load = (d) => {
    const m = new Map();
    for (const route of [...Object.keys(GUARD_SHOTS), ...Object.keys(LIVE_SHOTS)]) {
      const f = join(d, route, 'snapshots.json');
      if (existsSync(f)) for (const r of JSON.parse(readFileSync(f)).rows) m.set(r.shot, { ...r, dir: join(d, route) });
    }
    return m;
  };
  const A = load(a), B = load(b);
  let diffs = 0;
  for (const [shot, ra] of A) {
    const rb = B.get(shot);
    if (!rb) { console.log(`missing  ${shot}`); diffs++; continue; }
    if (!ra.fingerprint) {   // live shot: both must render without errors
      const ok = !ra.errors?.length && !rb.errors?.length;
      if (!ok) diffs++;
      console.log(`${ok ? 'renders ' : 'ERRORS  '} ${shot.padEnd(36)} (live terrain: not compared)  calls ${ra.calls}→${rb.calls}`);
      continue;
    }
    const pa = readFileSync(resolve(ROOT, ra.file)), pb = readFileSync(resolve(ROOT, rb.file));
    const samePixels = pa.equals(pb);
    const fa = ra.fingerprint?.per || {}, fb = rb.fingerprint?.per || {};
    const changed = [...new Set([...Object.keys(fa), ...Object.keys(fb)])].filter((k) => fa[k] !== fb[k]);
    const real = changed.filter((k) => !NOISY.includes(k));
    const noise = !real.length && changed.length && ra.calls === rb.calls && ra.triangles === rb.triangles;
    const ok = (samePixels || noise) && !real.length && ra.calls === rb.calls && ra.triangles === rb.triangles;
    if (!ok) diffs++;
    console.log(`${ok ? (noise ? 'noise   ' : 'same    ') : 'CHANGED '} ${shot.padEnd(36)} ${samePixels ? 'pixels =' : 'pixels ≠'}  calls ${ra.calls}→${rb.calls}  tris ${ra.triangles}→${rb.triangles}${changed.length ? '  objects: ' + changed.slice(0, 8).join(', ') + (changed.length > 8 ? ` +${changed.length - 8}` : '') : ''}`);
  }
  console.log(`\n${A.size} shots, ${diffs} changed`);
  process.exitCode = diffs ? 1 : 0;
} else usage();

function usage() {
  console.log('usage: node tools/toolbox_guard.mjs record <dir> [route …] | compare <dirA> <dirB>');
  process.exit(1);
}
