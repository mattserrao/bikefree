import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GEAR_RATIOS, DEFAULT_GEAR, speedFromCadence, powerRequired, stepSpeed,
  ergTargetForGear, simGradeForGear, estimateRealRatio,
} from '../js/physics.js';

test('24 increasing gears', () => {
  assert.equal(GEAR_RATIOS.length, 24);
  for (let i = 1; i < 24; i++) assert.ok(GEAR_RATIOS[i] > GEAR_RATIOS[i - 1]);
});

test('default gear at 90 rpm on flat is a moderate ride', () => {
  const v = speedFromCadence(90, GEAR_RATIOS[DEFAULT_GEAR - 1]);
  const kph = v * 3.6;
  assert.ok(kph > 25 && kph < 30, `kph ${kph}`);
  const w = ergTargetForGear(90, GEAR_RATIOS[DEFAULT_GEAR - 1], 0);
  assert.ok(w > 90 && w < 160, `watts ${w}`);
});

test('harder gear and steeper grade need more power', () => {
  const r = GEAR_RATIOS[11];
  assert.ok(ergTargetForGear(90, GEAR_RATIOS[12], 0) > ergTargetForGear(90, r, 0));
  assert.ok(ergTargetForGear(90, r, 5) > ergTargetForGear(90, r, 0));
  assert.equal(ergTargetForGear(0, r, 5), 0);
});

test('downhill needs less power, never negative', () => {
  assert.equal(ergTargetForGear(60, GEAR_RATIOS[0], -10), 0);
});

test('speed integration converges to steady-state speed', () => {
  const p = powerRequired(10, 0); // power for 10 m/s
  let v = 0;
  for (let i = 0; i < 4 * 600; i++) v = stepSpeed(v, p, 0, 0.25);
  assert.ok(Math.abs(v - 10) < 0.05, `v ${v}`);
});

test('coasting slows down on flat and speeds up downhill', () => {
  assert.ok(stepSpeed(10, 0, 0, 1) < 10);
  assert.ok(stepSpeed(10, 0, -8, 1) > 10);
});

test('SIM grade equals real grade when virtual gear matches the real chain (no aero at 0 speed)', () => {
  const g = simGradeForGear(0, 2.4, 2.4, 5);
  assert.ok(Math.abs(g - 5) < 0.2, `grade ${g}`);
});

test('SIM grade: harder virtual gear → steeper sent grade', () => {
  assert.ok(simGradeForGear(80, 3.5, 2.4, 2) > simGradeForGear(80, 2.4, 2.4, 2));
});

test('estimate real ratio', () => {
  const v = speedFromCadence(90, 2.5) * 3.6;
  assert.ok(Math.abs(estimateRealRatio(v, 90) - 2.5) < 1e-9);
  assert.equal(estimateRealRatio(20, 30), null);
});
