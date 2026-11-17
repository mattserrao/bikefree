// ride-feel-test: Hill feel (grade scaling like Zwift's trainer difficulty) and momentum easing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GEAR_RATIOS, ergTargetForGear, feltGrade, easeGrade, HILL_FEEL_DEFAULT, HILL_FEEL_OPTIONS, MOMENTUM_TAU_S } from '../js/physics.js';
import { CHASE, CHASE_CLASSIC, CAMERAS } from '../js/world/pose.js';
import { DEFAULT_SETTINGS } from '../js/settings.js';

test('Hill feel defaults to 50% like Zwift and scales grade only', () => {
  assert.equal(HILL_FEEL_DEFAULT, 50);
  assert.equal(DEFAULT_SETTINGS.hillFeel, 50);
  assert.deepEqual(HILL_FEEL_OPTIONS, [25, 50, 75, 100]);
  assert.equal(feltGrade(4, 50), 2);
  assert.equal(feltGrade(-6, 25), -1.5);
  assert.equal(feltGrade(3, 100), 3);
  assert.equal(feltGrade(0, 50), 0);   // flat riding is untouched
});

test('at 50% a 1% hill asks for far less of a jump than full physics', () => {
  const r = GEAR_RATIOS[11];
  const flat = ergTargetForGear(85, r, 0), full = ergTargetForGear(85, r, 1), half = ergTargetForGear(85, r, feltGrade(1, 50));
  assert.ok(full / flat > 1.6, `full ${full} vs flat ${flat}`);
  assert.ok(half / flat < 1.4, `half ${half} vs flat ${flat}`);
});

test('momentum easing ramps the grade in over a few seconds', () => {
  let g = easeGrade(null, 0, 0.25);
  assert.equal(g, 0);
  const steps = [];
  for (let t = 0; t < 12; t += 0.25) { g = easeGrade(g, 1, 0.25); steps.push(g); }
  assert.ok(steps[0] < 0.1, 'first quarter second is small');
  const at3s = steps[11];
  assert.ok(at3s > 0.55 && at3s < 0.7, `≈63% after one time constant (${MOMENTUM_TAU_S} s): ${at3s}`);
  assert.ok(steps.at(-1) > 0.97, 'settled after ~12 s');
});

test('close camera is the default and nearer than classic', () => {
  assert.equal(CHASE, CAMERAS.close);
  assert.equal(DEFAULT_SETTINGS.camera, 'close');
  const d = (c) => Math.hypot(c.back, c.up);
  assert.ok(d(CHASE_CLASSIC) / d(CHASE) > 1.25);
});
