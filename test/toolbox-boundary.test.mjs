// [review 27 Nov] The toolbox's module boundary (TOOLBOX.md, the import rule): a file under js/world/toolbox/ imports only
// from js/world/toolbox/ and vendor/. What the toolbox needs of the app's world (the road width and lift, routePoint,
// the local frame, the route index, ghosts, road alignment) lives in toolbox/core/ and the app's files re-export it.
// The few imports that remain are listed here, each with its reason: a new one fails this test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOOLBOX = 'js/world/toolbox';

/** 'importing file -> imported file' (repo-relative) → why the toolbox still reaches outside itself there. */
const ALLOWED = {
  'js/world/toolbox/core/road-frame.js -> js/gpx.js': 'wrapDist: the GPX route\'s own distance rule (a pure leaf module with no imports); moving it needs js/gpx.js to re-export it from the toolbox',
  'js/world/toolbox/city/life.js -> js/physics.js': 'powerRequired: the rider physics the city\'s cyclists pedal by (a pure leaf module); injecting it needs the world to hand it to CityScene',
  'js/world/toolbox/life/road-riders.js -> js/world/rider.js': 'loadRider: the app\'s rider model (loads a GLTF, caches it); injecting it needs js/world/graph-world.js to pass it in RoadRiders\' options',
  'js/world/toolbox/landscape/authored-region.js -> js/world/terrain-data.js': 'makeTerrainSampler: the baked terrain grid\'s sampler (pure, no imports); moving it needs js/world/terrain-data.js to re-export it from the toolbox',
};

function files(dir) {
  const out = [];
  for (const f of readdirSync(join(ROOT, dir))) {
    const p = `${dir}/${f}`;
    if (statSync(join(ROOT, p)).isDirectory()) out.push(...files(p)); else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

/** Every relative import / export-from / dynamic import in a file, resolved repo-relative. */
export function importsOf(file) {
  const src = readFileSync(join(ROOT, file), 'utf8'), out = [];
  const re = /(?:^|[;\s])(?:import|export)\s[^'"`;]*?\sfrom\s*['"]([^'"]+)['"]|(?:^|[;\s])import\s*['"]([^'"]+)['"]|import\(\s*['"`]([^'"`$]+)['"`]\s*\)/gm;
  for (let m; (m = re.exec(src));) {
    const line = src.slice(src.lastIndexOf('\n', m.index) + 1, m.index + m[0].length).trimStart();
    if (line.startsWith('//') || line.startsWith('*')) continue;   // (an example in a comment)
    const spec = m[1] || m[2] || m[3];
    if (spec.startsWith('.')) out.push(normalize(join(dirname(file), spec)).replace(/\\/g, '/'));
    else out.push(spec);   // (a bare or absolute specifier: never allowed in the toolbox)
  }
  return out;
}

test('the toolbox imports only the toolbox and vendor/ (and the listed exceptions)', () => {
  const found = [];
  for (const f of files(TOOLBOX)) for (const to of importsOf(f)) {
    if (to.startsWith(`${TOOLBOX}/`) || to.startsWith('vendor/')) continue;
    found.push(`${f} -> ${to}`);
  }
  const extra = found.filter((e) => !ALLOWED[e]);
  assert.deepEqual(extra, [], `outside the toolbox (move what it needs into toolbox/core/, or inject it; else list it with a reason):\n${extra.join('\n')}`);
  const stale = Object.keys(ALLOWED).filter((e) => !found.includes(e));
  assert.deepEqual(stale, [], 'allowlisted imports that are gone: take them off the list');
});

test('the checker sees static, re-export and dynamic imports', () => {
  const imps = importsOf('js/world/pose.js');
  assert.ok(imps.includes('js/world/toolbox/core/road-frame.js'), relative(ROOT, 'js/world/pose.js'));
  assert.ok(importsOf('js/world/toolbox/vegetation/near-trunks.js').some((p) => p.startsWith('js/world/toolbox/')));
});

test('the app\'s world files still give every name the toolbox core moved out of them', async () => {
  const pose = await import('../js/world/pose.js'), frame = await import('../js/world/toolbox/core/road-frame.js');
  for (const k of ['ROAD_WIDTH', 'LANE_OFFSET', 'ROAD_LIFT', 'PACER_LANE', 'routePoint', 'riderPose', 'LEAN', 'pathCurvature', 'leanTarget', 'stepLean', 'leanAlong', 'CHASE', 'lockedChase']) assert.ok(k in pose, `pose.js ${k}`);
  for (const k of Object.keys(frame)) assert.equal(pose[k], frame[k], `pose.js re-exports ${k}`);
  const geo = await import('../js/world/geo.js'), cgeo = await import('../js/world/toolbox/core/geo.js');
  for (const k of Object.keys(cgeo)) assert.equal(geo[k], cgeo[k], `geo.js re-exports ${k}`);
  for (const [app, core] of [['ghost.js', 'ghost.js'], ['road-align.js', 'road-align.js']]) {
    const a = await import(`../js/world/${app}`), c = await import(`../js/world/toolbox/core/${core}`);
    assert.deepEqual(Object.keys(a).sort(), Object.keys(c).sort(), app);
  }
});

test('the core road frame\'s headingSpan agrees with js/routes.js', async () => {
  const { headingSpan } = await import('../js/world/toolbox/core/road-frame.js');
  const app = (await import('../js/routes.js')).headingSpan;
  const routes = [{ total: 1000, closed: false }, { total: 1000, closed: true }, { total: 2000, turnS: 1000, closed: false }];
  for (const r of routes) for (const d of [-20, 0, 3, 500, 997, 1000, 1004, 1500, 1998, 2600]) for (const look of [6, 12]) assert.deepEqual(headingSpan(r, d, look), app(r, d, look), `${JSON.stringify(r)} ${d} ${look}`);
});
