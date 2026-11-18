// The toolbox's own checks: pack descriptions match what the packs build, every scene and preset passes the
// scene linter, old field names still map, and every module the schema points at exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACK_META, packModels, packId } from '../js/world/toolbox/packs/meta.js';
import { PACKS, scenePacks } from '../js/world/toolbox/packs/index.js';
import { SCENE_FIELDS, normalizeScene, lifeKit } from '../js/world/toolbox/scene-schema.js';
import { lintScene } from '../tools/lint_scene.mjs';
import { buildPresets } from '../tools/build_presets.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sceneFiles = readdirSync(join(ROOT, 'routes/scenes')).filter((f) => f.endsWith('.json') && !f.endsWith('-city.json'));

test('every pack in meta.js is registered and lists exactly the models it builds', () => {
  assert.deepEqual(Object.keys(PACKS).sort(), Object.keys(PACK_META).sort());
  for (const [id, pack] of Object.entries(PACKS)) {
    const built = Object.keys(pack.make({})).sort();
    assert.deepEqual([...packModels(id)].sort(), built, `${id}: meta.js models differ from the pack's output`);
    for (const n of PACK_META[id].groundcover) assert.ok(built.includes(n), `${id}: ground cover ${n} is not built`);
    for (const [species, n] of Object.entries(PACK_META[id].variants)) for (let v = 0; v < n; v++) assert.ok(built.includes(`${species}${v}`), `${id}: ${species}${v} missing`);
  }
});

test('pack names and old aliases resolve', () => {
  assert.equal(packId('adirondack'), 'northeast');
  assert.equal(packId('glacier'), 'northern-rockies');
  assert.equal(packId('northeast'), 'northeast');
  assert.equal(packId('nope'), null);
  assert.deepEqual(scenePacks({ kitExtensions: ['glacier'] }).map((p) => p.id), ['northern-rockies']);
});

test('old scene field names normalize to the toolbox names', () => {
  const s = normalizeScene({ kitExtensions: ['adirondack'], glacier: { tunnels: [] } });
  assert.deepEqual(s.packs, ['northeast']);
  assert.deepEqual(s.mountainRoad, { tunnels: [] });
  assert.ok(!('kitExtensions' in s) && !('glacier' in s));
  assert.equal(lifeKit({ life: {} }, { mountain: true }), 'wildlife');
  assert.equal(lifeKit({ life: {} }, { real: true }), 'coast');
  assert.equal(lifeKit({ life: { kit: 'wildlife' } }, { real: true }), 'wildlife');
  assert.equal(lifeKit({}, { mountain: true }), null);
});

test('every scene passes the scene linter', () => {
  for (const f of sceneFiles) {
    const { errors } = lintScene(JSON.parse(readFileSync(join(ROOT, 'routes/scenes', f), 'utf8')), f);
    assert.deepEqual(errors, [], errors.join('\n'));
  }
});

test('the linter catches typos, unknown packs and wrong terrain', () => {
  const { errors, warnings } = lintScene({ format: 'bikefree-scene-1', style: 'stylized', terrain: 'real-coast', palete: {}, packs: ['adirondak'], mountainRoad: {}, vegetation: { layot: 1 } }, 'bad');
  assert.ok(errors.some((e) => e.includes('"palete"') && e.includes('palette')));
  assert.ok(errors.some((e) => e.includes('missing required field "palette"')));
  assert.ok(errors.some((e) => e.includes('unknown pack "adirondak"')));
  assert.ok(errors.some((e) => e.includes('"mountainRoad" only works')));
  assert.ok(warnings.some((w) => w.includes('vegetation.layot')));
});

test('presets are up to date, lint clean and carry the toolbox standard look', () => {
  for (const [id, p] of Object.entries(buildPresets())) {
    const file = join(ROOT, 'routes/presets', `${id}.json`);
    assert.ok(existsSync(file), `missing ${file}: node tools/build_presets.mjs`);
    assert.equal(readFileSync(file, 'utf8'), JSON.stringify(p, null, 2) + '\n', `routes/presets/${id}.json is stale: node tools/build_presets.mjs`);
    const { errors, warnings } = lintScene(p.scene, `preset ${id}`);
    assert.deepEqual(errors, [], errors.join('\n'));
    assert.deepEqual(warnings, [], warnings.join('\n'));
    assert.equal(p.scene.look, 'gentle');
    assert.ok(p.scene.lighting?.baked);
  }
});

test('every module named in the scene schema exists', () => {
  for (const [k, f] of Object.entries(SCENE_FIELDS)) if (f.tool) assert.ok(existsSync(join(ROOT, f.tool)), `${k}: ${f.tool}`);
});

test('road surface: unused zone slots end the shader\'s zone loop (w = 0), so they never act as zones at 0 m (F12)', async () => {
  const THREE = await import('../vendor/three.module.min.js');
  const { decorateRoad } = await import('../js/world/toolbox/materials/road-surface.js');
  const m = new THREE.MeshStandardMaterial();
  decorateRoad(m, { surface: 'fresh', zones: [{ fromM: 100, toM: 200, surface: 'worn' }] });
  const shader = { uniforms: {}, vertexShader: '', fragmentShader: '#include <common>\n#include <map_fragment>' };
  m.onBeforeCompile(shader, null);
  const span = shader.uniforms.rsSpan.value;
  assert.equal(span[0].w, 1, 'the zone is on');
  assert.ok(span.slice(1).every((v) => v.w === 0), 'every unused slot is off');
});
