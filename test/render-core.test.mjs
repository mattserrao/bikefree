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

// [flash fix 27 Nov] a device just short of 60 fps at full resolution on a 60 Hz display: the frame interval reads a
// clean 16.7 ms one step down, so the governor kept retrying full resolution (and missing) every ~18 s — a canvas
// resize each time. Failed retries now wait longer.
test('governor: a full-resolution retry that keeps failing backs off instead of flapping every ~18 s', () => {
  const changes = [];
  const g = new QualityGovernor({ quality: 'balanced', enabled: true, onScale: (s) => changes.push(s) });
  for (let f = 0; f < 60 * 600; f++) {   // ten minutes
    const work = 17.5 * g.scale * g.scale, iv = Math.ceil(work / (1000 / 60) - 1e-9) * (1000 / 60);
    g.sample(iv, iv / 1000, true);
  }
  // (unchecked it changed ~66 times in ten minutes; now the retries come after 15 s, 60 s, 4 min, 10 min)
  assert.ok(changes.length <= 10, `${changes.length} resolution changes in 10 min`);
  assert.ok(g.hold >= 240, `hold ${g.hold}`);
});

test('governor: a level that holds after stepping back up keeps the normal retry time', () => {
  const g = new QualityGovernor({ quality: 'balanced', enabled: true });
  run(g, 1000 / 40, 10, true);          // overloaded: steps down
  assert.ok(g.level > 0);
  run(g, 1000 / 60, 120, true);         // then fine at every level
  assert.equal(g.level, 0);
  assert.equal(g.hold, 15);
});
