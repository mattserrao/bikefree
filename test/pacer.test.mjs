import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pacer, PACER_WATTS, PACER_LEAD_M } from '../js/pacer.js';
import { powerRequired, DEFAULTS } from '../js/physics.js';

const run = (p, secs, grade = 0) => { for (let t = 0; t < secs; t += 0.5) p.step(0.5, () => grade, DEFAULTS); };

test('pacer offers the six power levels', () => {
  assert.deepEqual(PACER_WATTS, [75, 100, 125, 150, 175, 200]);
});

test('pacer starts just ahead of the rider, standing', () => {
  const p = new Pacer(150);
  p.reset(1234);
  assert.equal(p.dist, 1234 + PACER_LEAD_M);
  assert.equal(p.speed, 0);
});

test('pacer settles at the speed its power holds on the flat', () => {
  const p = new Pacer(150);
  p.reset(0);
  run(p, 180);
  assert.ok(Math.abs(powerRequired(p.speed, 0, DEFAULTS) - 150) < 3, `steady power ${powerRequired(p.speed, 0, DEFAULTS)}`);
});

test('more power is faster, climbs are slower, off stays put', () => {
  const speed = (w, g) => { const p = new Pacer(w); p.reset(0); run(p, 240, g); return p.speed; };
  assert.ok(speed(200, 0) > speed(100, 0));
  assert.ok(speed(150, 6) < speed(150, 0));
  const off = new Pacer(0);
  off.reset(0);
  run(off, 60);
  assert.equal(off.dist, PACER_LEAD_M);
});
