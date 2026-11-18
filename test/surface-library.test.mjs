import test from 'node:test';
import assert from 'node:assert/strict';
import { SURFACE_LIBRARY, toolboxSurfaceSpec, makeToolboxSurface } from '../js/world/toolbox/materials/surface-library.js';

test('every surface family has discoverable opt-in presets and independent materials', () => {
  assert.deepEqual([...new Set(Object.values(SURFACE_LIBRARY).map((p) => p.family))].sort(), ['buildings','details','masonry','terrain','vegetation']);
  for (const id of Object.keys(SURFACE_LIBRARY)) {
    const a = makeToolboxSurface(id, { seed: 17 }), b = makeToolboxSurface(id, { color: '#335577', scale: 2 });
    assert.notEqual(a, b);
    assert.equal(a.userData.toolboxSurface.seed, 17);
    assert.equal(b.userData.toolboxSurface.color, '#335577');
    assert.equal(b.userData.toolboxSurface.scale, 2);
    assert.equal(a.map, null, 'no external texture dependency');
    a.dispose(); b.dispose();
  }
});

test('invalid surface IDs and controls fail with actionable errors', () => {
  for (const id of ['missing','toString','__proto__']) assert.throws(() => toolboxSurfaceSpec(id), /Unknown toolbox surface/);
  for (const options of [{ seed: -1 }, { seed: .5 }, { scale: 0 }, { variation: 1.1 }, { color: 'red' }]) assert.throws(() => makeToolboxSurface('bark-oak', options), RangeError);
});
