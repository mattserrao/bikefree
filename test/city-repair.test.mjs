// tools/repair_city.mjs on one small area (the West End): the packed streets codec gives the city JSON back byte for
// byte, and the stored (repaired) data is already repaired — a second run changes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeStreets, encodeStreets, withStreets, repairArea, loadRides } from '../tools/repair_city.mjs';
import { loadSceneSync } from '../tools/qc_course.mjs';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const catalog = JSON.parse(read('routes/parks/index.json'));
const item = catalog.find((it) => it.id === 'pittsburgh-westend');
const scene = loadSceneSync(item.scene), text = read(scene.cityData);

test('city repair: the streets codec round-trips the city JSON byte-identically', () => {
  const { streets, at, len } = decodeStreets(text);
  assert.equal(streets.length, JSON.parse(text).streets.count);
  assert.equal(encodeStreets(streets), text.slice(at, at + len));
  assert.equal(withStreets(text, streets), text);
});

test('city repair: a second run on the West End changes nothing (idempotent)', () => {
  const rides = loadRides(catalog);
  const r = repairArea({ item, scene, text, rides });
  assert.deepEqual(r.changes, [], `repairs: ${JSON.stringify(r.changes)}`);
  assert.equal(r.text, text);
  assert.deepEqual(r.after, r.before);
});
