// Street network QC budget (PLAN: Pittsburgh audit, H step 7): the street pieces within 150 m of each Pittsburgh route
// (tools/qc_streets.mjs: pieces, short, loose, stub, splice, overlap) may not grow past tools/qc-streets-baseline.json —
// so a data rebuild can't quietly bring back the stubs, splices and overlaps tools/simplify_city.mjs removed. After a
// change that removes more, lower it: `node tools/qc_streets.mjs --baseline`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { qcStreets, streetAreas, SCHECKS, STREETS_BASELINE } from '../tools/qc_streets.mjs';

const baseline = JSON.parse(readFileSync(new URL(`../${STREETS_BASELINE}`, import.meta.url), 'utf8'));

for (const { item, scene } of streetAreas()) {
  test(`street QC ${item.id}: no more street pieces or faults near the route than the baseline`, () => {
    const { counts } = qcStreets({ item, scene }), budget = baseline[item.id] || {};
    const over = SCHECKS.filter((c) => counts[c] > (budget[c] || 0)).map((c) => `${c} ${counts[c]} > ${budget[c] || 0}`);
    assert.deepEqual(over, [], `${item.id}: ${over.join(', ')} (node tools/qc_streets.mjs)`);
  });
}
