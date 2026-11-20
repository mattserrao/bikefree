// Map QC budget (PLAN: Pittsburgh audit, D): every street of every Pittsburgh area (tools/qc_map.mjs), and per area
// and check, the fails and warnings within 300 m of the route may not grow past tools/qc-map-baseline.json. After a
// change that fixes some, lower the budget: `node tools/qc_map.mjs --baseline`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { qcMap, cityAreas, nearCounts, BASELINE_FILE } from '../tools/qc_map.mjs';

const baseline = JSON.parse(readFileSync(new URL(`../${BASELINE_FILE}`, import.meta.url), 'utf8'));

for (const area of cityAreas()) {
  test(`map QC ${area.id}: no more issues near the route than the baseline`, () => {
    const now = nearCounts(qcMap(area)), budget = baseline[area.id] || {};
    const over = Object.entries(now).filter(([check, n]) => n > (budget[check] || 0)).map(([check, n]) => `${check} ${n} > ${budget[check] || 0}`);
    assert.deepEqual(over, [], `${area.id}: ${over.join(', ')} (tools/qc-map-report.html: npm run qc:map)`);
  });
}
