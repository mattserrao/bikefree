// The KTX2 texture library (tools/build_textures.mjs → textures/ktx2): every set has both images, and every map's
// declared sets download in under MAP_TEXTURE_MB (fidelity plan v5: ≤ 8 MB a map).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { MAP_TEXTURE_MB } from '../js/world/toolbox/map-definition.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const manifest = read('textures/ktx2/manifest.json');

test('texture library: every set has its albedo and nra KTX2, sizes as built', () => {
  for (const [set, s] of Object.entries(manifest)) for (const kind of ['albedo', 'nra']) {
    assert.ok(s[kind], `${set} ${kind}`);
    assert.equal(statSync(new URL(`../${s[kind].file}`, import.meta.url)).size, s[kind].bytes, `${set} ${kind} rebuilt? npm run textures`);
  }
});

test(`texture budget: each map's sets download in ≤ ${MAP_TEXTURE_MB} MB`, () => {
  const maps = [...read('routes/cities/index.json').cities.map((c) => [c.id, read(`routes/cities/${c.id}.json`)]),
    ...read('routes/parks/index.json').filter((p) => !p.retired).map((p) => [p.id, read(p.scene)])];
  for (const [id, json] of maps) {
    const sets = json.assets?.textures || [];
    for (const s of sets) assert.ok(manifest[s], `${id}: unknown texture set ${s}`);
    const mb = sets.reduce((a, s) => a + manifest[s].albedo.bytes + manifest[s].nra.bytes, 0) / 1048576;
    assert.ok(mb <= MAP_TEXTURE_MB, `${id}: ${mb.toFixed(1)} MB of textures`);
  }
});
