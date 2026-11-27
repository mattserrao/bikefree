import test from 'node:test';
import assert from 'node:assert/strict';
import { PEDESTRIANS, CYCLIST_SHARE, cyclists, pedestrians } from '../js/world/toolbox/life/population.js';

test('nobody on foot', () => {
  assert.equal(PEDESTRIANS, false);
  for (const n of [0, 1, 8, 35, 130]) assert.equal(pedestrians(n), 0);
});

test('half the cyclists', () => {
  assert.equal(CYCLIST_SHARE, 0.5);
  assert.deepEqual([0, 1, 4, 6, 8, 12, 18, 26].map(cyclists), [0, 1, 2, 3, 4, 6, 9, 13]);
});
