// Figures kit (js/world/toolbox/life/figures): baked clips up to date, triangle budgets, rig sanity.
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { buildClipsModule } from '../tools/build_figures.mjs';
import { figureStats, personGeometry, cyclistGeometry, dogGeometry, CLIP, CLIP_META, posedFigure, randomLook } from '../js/world/toolbox/life/figures/people.js';
import { vehicleStats, VEHICLE_KINDS } from '../js/world/toolbox/life/figures/vehicles.js';
import { BONES } from '../js/world/toolbox/life/figures/clips.js';

test('figures/clips.js is baked from rig.js (run npm run figures)', () => {
  assert.strictEqual(readFileSync(new URL('../js/world/toolbox/life/figures/clips.js', import.meta.url), 'utf8'), buildClipsModule());
});

test('people stay inside their triangle budgets', () => {
  const s = figureStats();
  assert.ok(s.personHi <= 1300, `near person ${s.personHi}`);
  assert.ok(s.personLo <= 500, `mid person ${s.personLo}`);
  assert.ok(s.personFar <= 100, `far person ${s.personFar}`);
  assert.ok(s.dog <= 300 && s.stroller <= 350, `dog ${s.dog}, stroller ${s.stroller}`);
});

test('vehicles stay inside their triangle budgets', () => {
  const hi = vehicleStats('hi'), lo = vehicleStats('lo');
  for (const k of ['sedan', 'hatch', 'suv', 'pickup', 'van', 'taxi', 'camper']) assert.ok(hi[k] <= 800, `${k}: ${hi[k]}`);
  for (const k of ['sedan', 'hatch', 'suv']) assert.ok(lo[k] < 200, `parked ${k}: ${lo[k]}`);
  assert.strictEqual(Object.keys(hi).length, VEHICLE_KINDS.length);
});

test('every vertex is skinned to a real bone', () => {
  for (const g of [personGeometry('hi'), personGeometry('lo'), personGeometry('far'), cyclistGeometry('hi'), dogGeometry()]) {
    const a = g.attributes.aSkin;
    for (let i = 0; i < a.count; i++) {
      assert.ok(a.getX(i) >= 0 && a.getX(i) < BONES && a.getY(i) >= 0 && a.getY(i) < BONES, 'bone index');
      assert.ok(a.getZ(i) >= 0 && a.getZ(i) <= 1, 'weight');
    }
  }
});

test('standing and walking figures keep their feet on the ground', () => {
  let s = 7; const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const look = randomLook(rand, { kids: 0 }); look.h = 1; look.g = 1;
  for (const name of ['idle', 'look', 'walk', 'stroll', 'cheer', 'photo']) {
    for (const frame of [0, 6, 12, 18]) {
      const g = posedFigure(look, CLIP[name], { frame, lod: 'lo' }), p = g.attributes.position;
      let min = Infinity; for (let i = 0; i < p.count; i++) min = Math.min(min, p.getY(i));
      assert.ok(min > -.06 && min < .09, `${name} frame ${frame}: lowest point ${min.toFixed(3)} m`);
    }
  }
  assert.ok(CLIP_META[CLIP.walk].stride > 1 && CLIP_META[CLIP.jog].stride > CLIP_META[CLIP.walk].stride);
});
