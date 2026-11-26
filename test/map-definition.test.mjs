// The map definition (js/world/toolbox/map-definition.js): every production map, graph or scene, resolves to one shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveMapDefinition, TIER_BUDGETS } from '../js/world/toolbox/map-definition.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const KEYS = ['id', 'kind', 'profile', 'effects', 'lighting', 'sky', 'budget', 'assets'];

test('map definition: the graph maps, the production route scenes and Endless resolve to the same keys', () => {
  const defs = [
    ...read('routes/cities/index.json').cities.map((c) => resolveMapDefinition({ kind: 'graph', id: c.id, json: read(`routes/cities/${c.id}.json`) })),
    ...read('routes/parks/index.json').filter((p) => !p.retired).map((p) => resolveMapDefinition({ kind: 'scene', id: p.id, json: read(p.scene) })),
    resolveMapDefinition({ kind: 'endless' }),
  ];
  assert.ok(defs.length >= 7, `${defs.length} maps`);
  for (const d of defs) {
    assert.deepEqual(Object.keys(d), KEYS, d.id);
    assert.ok(d.id, 'an id');
    assert.equal(d.budget, TIER_BUDGETS);
  }
  const cny = defs.find((d) => d.id === 'cny');
  assert.equal(cny.lighting.baked, 'golden');
});
