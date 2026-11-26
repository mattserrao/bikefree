// The render core's quality governor (js/world/render-core.js): steps down when frames run long, back up with headroom,
// and reads a vsync'd frame interval without stepping down on every frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QualityGovernor, TIERS, pixelRatioFor } from '../js/world/render-core.js';

const run = (g, ms, seconds, interval = false) => { for (let t = 0; t < seconds * 60; t++) g.sample(ms, 1 / 60, interval); };

test('governor: work time past 85 % of the budget steps down, under 60 % steps back up', () => {
  const scales = [];
  const g = new QualityGovernor({ quality: 'balanced', enabled: true, onScale: (s) => scales.push(s) });
  run(g, 15.5, 10);
  assert.ok(g.level >= 2, `level ${g.level}`);
  run(g, 6, 30);
  assert.equal(g.level, 0);
  assert.equal(scales.at(-1), 1);
});

test('governor: a steady vsync interval (≈ the budget) never steps down; missed frames do', () => {
  const g = new QualityGovernor({ quality: 'balanced', enabled: true });
  run(g, 1000 / 60, 60, true);
  assert.equal(g.level, 0);
  run(g, 1000 / 40, 10, true);
  assert.ok(g.level > 0);
});

test('governor: a 30 fps cap is the budget, not a slow frame', () => {
  const g = new QualityGovernor({ quality: 'balanced', enabled: true });
  g.setTarget(30);
  run(g, 1000 / 30, 30, true);
  assert.equal(g.level, 0);
});

test('tiers: one table, Phone to Ultra, each capping the pixel ratio', () => {
  assert.deepEqual(Object.keys(TIERS), ['low', 'balanced', 'high', 'ultra']);
  globalThis.window = { devicePixelRatio: 3 };
  assert.equal(pixelRatioFor('balanced'), 1.5);
  assert.equal(pixelRatioFor('low', .7), .7);
  delete globalThis.window;
});
