// [perf-5] The memory budget's static half (the measured half: tools/perf_budget.mjs, in Chrome, against
// tools/perf-budget.json): the building kit's vertex size, the city data's size per area, and the budget check itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { Writer } from '../js/world/toolbox/structures/buildings/assemble.js';
import { overBudget } from '../tools/perf_budget.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('perf budget: a building kit vertex costs at most 62 bytes (seed and wear 16-bit)', () => {
  const w = new Writer(64);
  w.set({ b: [.37, .81] });
  w.box({ cx: 0, cz: 0, ux: 1, uz: 0, vx: 0, vz: 1 }, -2, 2, -3, 3, 0, 6);
  const g = w.geometry(), n = g.attributes.position.count;
  const bytes = Object.values(g.attributes).reduce((s, a) => s + a.array.byteLength, 0) / n;
  assert.ok(bytes <= 62, `${bytes} bytes a vertex`);
  assert.ok(g.attributes.aB.array instanceof Uint16Array && g.attributes.aB.normalized, 'aB is Uint16, normalized');
  assert.ok(Math.abs(g.attributes.aB.getX(0) - .37) < 1e-4 && Math.abs(g.attributes.aB.getY(0) - .81) < 1e-4, 'the shader reads the same seed and wear');
});

test('perf budget: no Pittsburgh area\'s city data grows past 2.1 MB', () => {
  const catalog = JSON.parse(read('routes/parks/index.json'));
  for (const it of catalog.filter((c) => c.id.startsWith('pittsburgh') && c.scene)) {
    const scene = JSON.parse(read(it.scene));
    if (!scene.cityData) continue;
    const mb = statSync(new URL(`../${scene.cityData}`, import.meta.url)).size / 1e6;
    assert.ok(mb <= 2.1, `${it.id}: ${mb.toFixed(2)} MB`);
  }
});

test('perf budget: the check flags exactly the numbers over budget', () => {
  assert.deepEqual(overBudget({ heapMB: 300, tris: 4e6, loadS: 10 }, { heapMB: 320, tris: 3.5e6, rideP95Ms: 20 }), ['tris 4000000 > 3500000']);
});
