// Out West's plant life (user, 27 Nov 2026: "proceed with phases 0–5" of claude/desert-plant-life-plan.md): the map
// builds only the plants it uses (each a row of the tree impostor atlas, whose memory is fixed), every plant the
// communities name is in that kit, the desert's grass cards exist, and the census (tools/reference/plant_census.py)
// puts the communities' cover inside the published ranges.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeUpstateTrees } from '../js/world/toolbox/vegetation/upstate-trees.js';
import { PROFILE_PRESETS } from '../js/world/toolbox/map-profile.js';
import { DESERT_COMMUNITIES, desertCommunity } from '../js/world/toolbox/vegetation/desert-communities.js';
import { CARD } from '../js/world/toolbox/landscape/grass-cards.js';

const mix = PROFILE_PRESETS.desert.treeMix;
const only = new Set(Object.values(mix).flat().map(([n]) => n));
const kit = makeUpstateTrees({ desert: true, only });
const rows = (k) => Object.values(k.species).reduce((a, s) => a + s.variants.length, 0) + Object.keys(k.understory).length;

test('phase 0: the desert kit builds only its own plants (atlas rows ≤ 50; no upstate maples, hemlock or ferns)', () => {
  const full = makeUpstateTrees({ desert: true });
  assert.ok(rows(kit) <= 50, `${rows(kit)} rows`);
  assert.ok(rows(full) - rows(kit) >= 50, `saved ${rows(full) - rows(kit)} rows`);
  for (const n of ['sugarmaple', 'redoak', 'hemlock', 'whitepine']) assert.ok(!kit.species[n], n);
  for (const n of ['fern', 'dogwood', 'sumac']) assert.ok(!kit.understory[n], n);
});

test('phases 2 and 4: every plant a community or the tree mix names is in the kit', () => {
  for (const [role, list] of Object.entries(mix)) for (const [n] of list) assert.ok(kit.species[n], `${role}: ${n}`);
  for (const [name, c] of Object.entries(DESERT_COMMUNITIES)) {
    assert.ok(mix[c.role], `${name}: role ${c.role}`);
    for (const [n] of c.list) assert.ok(kit.understory[n], `${name}: ${n}`);
  }
  for (const n of ['snakeweed', 'saltbush', 'blackbrush', 'sandsage', 'bitterbrush', 'manzanita']) assert.ok(kit.understory[n], n);
  for (const n of ['tamarisk', 'cwillow', 'gambel', 'ponderosa', 'deadpj', 'selm', 'poplar', 'mahogany']) assert.ok(kit.species[n], n);
});

test('phase 4: the community follows the ground (creek, dunes, plateau, road strip, steep risers)', () => {
  const LAND = { water: 3, sand: 5, wetland: 12, pj: 40, sage: 41, slick: 42 };
  const city = (y, slopeX = 0, water = false) => ({ world: { _groundH: (x) => y + x * slopeX }, landAt: (x) => (water && x > 10 ? LAND.water : LAND.sage) });
  assert.equal(desertCommunity(city(1500, 0, true), 0, 0, LAND.sage, 50, LAND).role, 'riparian');
  assert.equal(desertCommunity(city(1800), 0, 0, LAND.sand, 50, LAND).list, DESERT_COMMUNITIES.dune.list);
  assert.equal(desertCommunity(city(2000), 0, 0, LAND.pj, 50, LAND).role, 'ponderosa');
  assert.equal(desertCommunity(city(1800), 0, 0, LAND.pj, 50, LAND).role, 'upper');
  assert.equal(desertCommunity(city(1600), 0, 0, LAND.sage, 6, LAND).list, DESERT_COMMUNITIES.verge.list);
  const flat = desertCommunity(city(1600), 0, 0, LAND.pj, 50, LAND), steep = desertCommunity(city(1600, 1), 0, 0, LAND.pj, 50, LAND);
  assert.ok(steep.shrubs < flat.shrubs * .5 && steep.trees < flat.trees * .5, 'a cliff riser is mostly bare');
});

test('phase 3: the desert grass cards (bunchgrass, cheatgrass, forbs) are cells of the grass atlas', () => {
  assert.deepEqual([CARD.bunch, CARD.cheat, CARD.forb], [5, 6, 7]);
});

test('phase 5: the census puts sagebrush and pinyon-juniper cover inside the published ranges', () => {
  const census = JSON.parse(readFileSync(new URL('../tools/reference/outwest-census.json', import.meta.url), 'utf8'));
  const withTarget = census.places.filter((p) => p.target);
  assert.ok(withTarget.length >= 2);
  for (const p of withTarget) assert.ok(p.target.within, `${p.id}: ${p.target.what} ${p.target.got}% (published ${p.target.range.join('–')}%)`);
  for (const p of census.places) assert.ok(p.plants > 0, `${p.id}: no plants`);
});
