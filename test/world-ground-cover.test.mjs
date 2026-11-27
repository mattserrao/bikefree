// [review 27 Nov] Ground cover's streaming (js/world/toolbox/landscape/ground-cover.js; W8): crossing a cell plants
// the new row a few cells a frame and ends with the same instances as planting them at once; the instances stay far to
// near; the matrices written straight in are compose()'s; the desert's tufts come from frozen kinds, not a new object
// each.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.js';
import { GroundCover } from '../js/world/toolbox/landscape/ground-cover.js';
import { desertTuft } from '../js/world/graph-world.js';

const slowGrass = (x, z) => { let s = 0; for (let k = 0; k < 400; k++) s += Math.sin(x * k + z); return Math.sin(x * .1 + z * .07) > -.6 ? .7 + (s > 0 ? .1 : 0) : 0; };
const make = (sliceMs) => new GroundCover({ parent: new THREE.Group(), material: new THREE.MeshBasicMaterial(), isGrass: slowGrass, heightAt: (x, z) => Math.sin(x * .02) + z * .01, radius: 40, density: 2, sliceMs });
const snapshot = (gc) => { const m = new THREE.Matrix4(), out = []; for (let k = 0; k < gc.mesh.count; k++) { gc.mesh.getMatrixAt(k, m); out.push(m.elements.map((v) => v.toFixed(4)).join(',')); } return out; };

test('ground cover: a crossed cell is planted in slices and ends as planting at once would', () => {
  const gc = make(.05), cam = new THREE.Vector3(5, 0, 5);
  gc.tick(cam);
  cam.x += 12;   // (one cell: a crossing, not a jump)
  gc.tick(cam);
  assert.ok(gc.stats.planting > 0, 'the new row is left to later frames');
  let frames = 1;
  while (gc.stats.planting > 0 && frames < 200) { gc.tick(cam); frames++; }
  assert.ok(frames > 2, `planted over ${frames} frames`);
  const ref = make(.05); ref.tick(cam);   // (a fresh one here: a jump, all at once)
  assert.equal(gc.mesh.count, ref.mesh.count);
  assert.deepEqual(snapshot(gc).sort(), snapshot(ref).sort());
});

test('ground cover: far to near, faded toward the edge, matrices as compose() makes them', () => {
  const gc = make(1), cam = new THREE.Vector3(3, 0, -7);
  gc.tick(cam);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  let last = Infinity;
  for (let k = 0; k < gc.mesh.count; k++) {
    gc.mesh.getMatrixAt(k, m); m.decompose(p, q, s);
    const d = Math.hypot(p.x - cam.x, p.z - cam.z);
    assert.ok(d <= last + 40 / 1024 + 1e-4, `tuft ${k} nearer than the one after it`);
    last = Math.min(last, d);
    assert.ok(d < 40 && s.x > 0 && s.y > 0);
    assert.ok(Math.abs(Math.abs(q.y) ** 2 + q.w ** 2 - 1) < 1e-4, 'a turn about Y only');
    const ref = new THREE.Matrix4().compose(p, q, s);
    for (let e = 0; e < 16; e++) assert.ok(Math.abs(ref.elements[e] - m.elements[e]) < 1e-4);
  }
  assert.ok(gc.mesh.count > 1000);
});

test('desert tufts: one object filled each call, the kinds frozen', () => {
  const c = { onRoad: (x, z, r) => r > 5 && x % 50 < 8, inWater: () => false, landAt: (x) => (x % 3 < 1 ? 41 : x % 3 < 2 ? 40 : 43) };
  const GRASS = { 5: .1, 40: .22, 41: .42, 42: .05, 43: .2 }, out = {};
  const seen = new Set();
  let n = 0;
  for (let k = 0; k < 4000; k++) {
    const x = k * 1.37, z = k * .71, o = desertTuft(c, x, z, GRASS, out);
    if (!o) continue;
    assert.equal(o, out); n++;
    assert.ok(o.d > 0 && o.cell >= 0 && o.h > 0 && Array.isArray(o.tint));
    seen.add(o.cell);
  }
  assert.ok(n > 1000 && seen.size >= 3, `${n} tufts, ${seen.size} kinds`);
  assert.equal(desertTuft({ ...c, onRoad: () => true }, 0, 0, GRASS, out), 0);
});
