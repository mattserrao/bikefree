// A new map is data, not code (fidelity plan, step 7): the toolbox never branches on a map's id, every module takes
// three.js from the one entry point (vendor/three.js), and every production map resolves through the map definition.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const walk = (d) => readdirSync(join(ROOT, d)).flatMap((f) => (statSync(join(ROOT, d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith('.js') ? [join(d, f)] : []));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const MAP_IDS = [...JSON.parse(read('routes/cities/index.json')).cities.map((c) => c.id), ...JSON.parse(read('routes/parks/index.json')).map((p) => p.id)];

test('the toolbox never branches on a map id (a map\'s rules come from its profile, effects and definition)', () => {
  const re = new RegExp(`(===|!==|==)\\s*['"](${MAP_IDS.join('|')})['"]|['"](${MAP_IDS.join('|')})['"]\\s*(===|!==|==)`);
  const hits = walk('js/world/toolbox').filter((f) => re.test(read(f)));
  assert.deepEqual(hits, []);
});

test('every module takes three.js from vendor/three.js (one entry point for the renderer build)', () => {
  const hits = walk('js').filter((f) => /from ['"][^'"]*vendor\/three\.(module|core|webgpu)\.min\.js['"]/.test(read(f)));
  assert.deepEqual(hits, []);
});
