// The map pipeline, code review 27 Nov 2026, wave 2: P1 (provenance in every map output, dated OSM queries, the cache
// manifest), P8 (one DEM / network / geometry module for the Python tools) and P9 (one static server and Chrome finder
// for the browser tools, tools/lib/harness.mjs). The Python unit tests (tools/tests) run in a python3 child: skipped
// without python3; inside, the parts that need numpy, scipy or Pillow skip themselves without them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { serve, resolvePath, findChrome, MIME } from '../tools/lib/harness.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TOOLS = join(ROOT, 'tools');
const PY = spawnSync('python3', ['--version']).status === 0;

test('P1/P8: the Python unit tests (tools/tests: geo, net, dem, osm_source, provenance, cache_manifest, warp)', { skip: !PY && 'no python3' }, () => {
  const r = spawnSync('python3', ['-W', 'ignore', '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py'], { cwd: TOOLS, encoding: 'utf8', env: { ...process.env, BIKEFREE_OFFLINE: '1' } });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stderr, /^OK/m);
});

test('P1: every map writer puts a provenance block in its output', () => {
  const writers = {
    'build_pgh.py': 2, 'build_city.py': 1, 'fetch_commerce.py': 1, 'cny_forest.py': 1, 'build_terrain_grid.py': 1,
    'build_places.py': 1, 'fetch_osm_corridor.py': 1, 'build_park_routes.py': 1, 'pgh_city.py': 1,
  };
  for (const [f, n] of Object.entries(writers)) {
    const s = readFileSync(join(TOOLS, f), 'utf8');
    const uses = (s.match(/provenance\.block\(|_prov\.block\(|'provenance': provenance\(cfg\)/g) || []).length;
    assert.ok(uses >= n, `${f}: ${uses} provenance block(s), want ${n}`);
  }
});

test('P1: cache_manifest.py has write / verify / pack / unpack and refuses an unknown command', { skip: !PY && 'no python3' }, () => {
  const r = spawnSync('python3', [join(TOOLS, 'cache_manifest.py')], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  for (const cmd of ['write', 'verify', 'pack', 'unpack']) assert.match(r.stdout, new RegExp(`cache_manifest.py ${cmd}`));
  // verify against an empty cache: a clear failure, not a crash
  const d = mkdtempSync(join(tmpdir(), 'bf-cache-'));
  try {
    const v = spawnSync('python3', [join(TOOLS, 'cache_manifest.py'), 'verify', 'nomap', '--cache', d], { encoding: 'utf8' });
    assert.equal(v.status, 1); assert.match(v.stdout, /no manifest/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------ P9: the browser tools' harness
const get = async (base, p) => { const r = await fetch(base + p); return { status: r.status, type: r.headers.get('content-type'), body: Buffer.from(await r.arrayBuffer()) }; };

test('P9: serve() — files with their MIME types, index.html, 404, no way out of the root', async () => {
  const d = mkdtempSync(join(tmpdir(), 'bf-serve-'));
  const root = join(d, 'site');
  mkdirSync(join(root, 'js'), { recursive: true }); mkdirSync(join(root, 'sub'));
  writeFileSync(join(root, 'index.html'), '<h1>home</h1>');
  writeFileSync(join(root, 'js', 'a.js'), 'export {}');
  writeFileSync(join(root, 'sub', 'index.html'), 'sub');
  writeFileSync(join(root, 'm.json'), '{}');
  writeFileSync(join(root, 'g.bin.gz'), Buffer.from([1, 2, 3]));
  writeFileSync(join(root, 'w.wasm'), Buffer.from([0, 97, 115, 109]));
  writeFileSync(join(root, 'a b.txt'), 'space');
  writeFileSync(join(d, 'secret.txt'), 'outside');
  const srv = await serve(root);
  try {
    assert.match(srv.base, /^http:\/\/127\.0\.0\.1:\d+$/);
    let r = await get(srv.base, '/');
    assert.equal(r.status, 200); assert.equal(r.type, 'text/html'); assert.equal(r.body.toString(), '<h1>home</h1>');
    r = await get(srv.base, '/js/a.js?v=1#x'); assert.equal(r.status, 200); assert.equal(r.type, 'text/javascript');
    assert.equal((await get(srv.base, '/m.json')).type, 'application/json');
    assert.equal((await get(srv.base, '/g.bin.gz')).type, 'application/octet-stream');
    assert.equal((await get(srv.base, '/w.wasm')).type, 'application/wasm');
    assert.equal((await get(srv.base, '/sub/')).body.toString(), 'sub');
    assert.equal((await get(srv.base, '/a%20b.txt')).body.toString(), 'space');
    assert.equal((await get(srv.base, '/missing.js')).status, 404);
    assert.equal((await get(srv.base, '/js')).status, 404);   // (a folder without an index)
    for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/js/..%2f..%2fsecret.txt', '/..%5csecret.txt', '/%00']) {
      const x = await get(srv.base, p);
      assert.ok(x.status === 403 || x.status === 404, `${p}: ${x.status}`);
      assert.notEqual(x.body.toString(), 'outside', p);
    }
  } finally { await srv.close(); rmSync(d, { recursive: true, force: true }); }
});

test('P9: serve() options — a transform, gzip with etags, a 404 hook', async () => {
  const d = mkdtempSync(join(tmpdir(), 'bf-serve-'));
  writeFileSync(join(d, 'a.json'), JSON.stringify({ format: 'x', n: 1 }));
  writeFileSync(join(d, 'b.js'), 'x'.repeat(4000));
  const missing = [];
  const srv = await serve(d, { transform: (path, body) => (path === 'a.json' ? Buffer.from(JSON.stringify({ ...JSON.parse(body), n: 2 })) : body), onMissing: (p) => missing.push(p) });
  try {
    assert.equal(JSON.parse((await get(srv.base, '/a.json')).body).n, 2);
    await get(srv.base, '/nope.png'); assert.deepEqual(missing, ['nope.png']);
  } finally { await srv.close(); }
  const gz = await serve(d, { gzip: true, cacheControl: 'max-age=600' });
  try {
    const r = await fetch(gz.base + '/b.js', { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(r.status, 200); assert.equal(r.headers.get('content-encoding'), 'gzip'); assert.equal(r.headers.get('cache-control'), 'max-age=600');
    assert.equal((await r.text()).length, 4000);
    const again = await fetch(gz.base + '/b.js', { headers: { 'if-none-match': r.headers.get('etag') } });
    assert.equal(again.status, 304);
  } finally { await gz.close(); rmSync(d, { recursive: true, force: true }); }
});

test('P9: resolvePath, findChrome', () => {
  assert.equal(resolvePath('/srv/site', '/a/b.js?x=1'), join('/srv/site', 'a/b.js'));
  // dot segments, raw or escaped, never climb out of the root (they stop at it)
  for (const u of ['/../x', '../x', '/a/%2e%2e/%2e%2e/x', '/a/..%2f..%2f..%2fx', '//../x']) assert.equal(resolvePath('/srv/site', u), join('/srv/site', 'x'), u);
  assert.equal(resolvePath('/srv/site', '/'), join('/srv/site'));
  assert.equal(resolvePath('/srv/site', '/%E0%A4%A'), null);   // (a bad escape)
  assert.equal(resolvePath('/srv/site', '/a%00.js'), null);
  assert.equal(MIME['.html'], 'text/html');
  assert.equal(findChrome('/explicit/chrome'), '/explicit/chrome');
  assert.equal(findChrome(null, { env: { CHROME: '/env/chrome' }, exists: () => false }), '/env/chrome');
  assert.equal(findChrome(null, { env: { CHROME_PATH: '/env2/chrome' }, exists: () => false }), '/env2/chrome');
  assert.equal(findChrome(null, { env: {}, exists: (p) => p === '/usr/bin/chromium' }), '/usr/bin/chromium');
  assert.equal(findChrome(null, { env: {}, exists: () => false }), undefined);
});

test('P9: the browser tools use the harness (no copied static server or Chrome list)', () => {
  const bad = [];
  const files = [...readdirSync(TOOLS).filter((f) => f.endsWith('.mjs')).map((f) => join(TOOLS, f)), join(TOOLS, 'bench', 'bench.mjs')];
  let users = 0;
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    if (/new URL\(req\.url, 'http:\/\/x'\)/.test(s)) bad.push(`${f}: its own static server`);
    if (/'\/usr\/bin\/google-chrome'/.test(s)) bad.push(`${f}: its own Chrome list`);
    if (/from '\.\.?\/(lib\/)?harness\.mjs'|from '\.\.\/lib\/harness\.mjs'/.test(s)) users++;
  }
  assert.deepEqual(bad, [], bad.join('\n'));
  assert.ok(users >= 23, `${users} tools import tools/lib/harness.mjs`);
});

test('P9: migrated tools still start (they load the harness and print their usage; no browser needed)', { timeout: 60000 }, () => {
  for (const [tool, want] of [['snap_scene.mjs', /usage: npm run snap/], ['ride_frames.mjs', /usage: node tools\/ride_frames/], ['snap_rider.mjs', /usage: npm run snap:rider/], ['snap_cam.mjs', /usage: node tools\/snap_cam/]]) {
    const args = [];
    const r = spawnSync(process.execPath, [join(TOOLS, tool), ...args], { cwd: ROOT, encoding: 'utf8', timeout: 30000, env: { ...process.env, CHROME: '/nonexistent/chrome' } });
    assert.ok(!/SyntaxError|ReferenceError|Cannot find module|does not provide an export/.test(r.stderr), `${tool}: ${r.stderr.slice(0, 400)}`);
    assert.match(r.stdout + r.stderr, want, `${tool}: ${(r.stdout + r.stderr).slice(0, 300)}`);
  }
});
