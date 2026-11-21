// Junction QC budget (PLAN: Pittsburgh audit, H): the junctions drawn where streets meet each Pittsburgh route
// (tools/qc_junctions.mjs, the plan cityStreets() makes for the renderer), and per area and check, the findings may not
// grow past tools/qc-junctions-baseline.json. After a change that fixes some, lower it: `node tools/qc_junctions.mjs --baseline`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { qcJunctions, junctionAreas, countsOf, BASELINE_FILE } from '../tools/qc_junctions.mjs';

const baseline = JSON.parse(readFileSync(new URL(`../${BASELINE_FILE}`, import.meta.url), 'utf8'));

for (const { item, scene } of junctionAreas()) {
  test(`junction QC ${item.id}: no more junction faults at the route than the baseline`, () => {
    const now = countsOf(qcJunctions({ item, scene }).findings), budget = baseline[item.id] || {};
    const over = Object.entries(now).filter(([check, n]) => n > (budget[check] || 0)).map(([check, n]) => `${check} ${n} > ${budget[check] || 0}`);
    assert.deepEqual(over, [], `${item.id}: ${over.join(', ')} (npm run qc:junctions)`);
  });
}
