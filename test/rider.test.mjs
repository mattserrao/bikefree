// Rider posture: stand on hard climbs, tuck on descents, seated otherwise (js/world/rider.js POSTURE_RULES).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stepPosture, postureState, POSTURE_RULES } from '../js/world/rider.js';

const ride = (st, effort, speed, seconds, dt = 0.1) => {
  for (let t = 0; t < seconds; t += dt) stepPosture(st, effort, speed, dt);
  return st.posture;
};
const FTP = 250;

test('seated on the flat and when the climb is easy', () => {
  const st = postureState();
  assert.equal(ride(st, { grade: 1, power: 200, ftp: FTP }, 9, 5), 'seated');
  assert.equal(ride(st, { grade: 8, power: 180, ftp: FTP }, 4, 5), 'seated');   // steep but only 72 % FTP
});

test('stands on a hard steep climb, then sits again when it eases', () => {
  const st = postureState();
  assert.equal(ride(st, { grade: 8, power: 240, ftp: FTP }, 4, 3), 'standing');
  assert.equal(ride(st, { grade: 6, power: 200, ftp: FTP }, 4, 3), 'standing');   // hysteresis: still 6 %, 80 % FTP
  assert.equal(ride(st, { grade: 4, power: 200, ftp: FTP }, 5, 3), 'seated');
});

test('stands in bouts on a long climb', () => {
  const st = postureState();
  const hard = { grade: 10, power: 260, ftp: FTP };
  ride(st, hard, 3.5, 2);
  assert.equal(st.posture, 'standing');
  ride(st, hard, 3.5, POSTURE_RULES.stand.maxS);
  assert.equal(st.posture, 'seated');
  assert.equal(ride(st, hard, 3.5, POSTURE_RULES.stand.restS + 1), 'standing');
});

test('tucks on a descent when coasting or soft-pedalling, not when pushing', () => {
  const st = postureState();
  assert.equal(ride(st, { grade: -6, power: 0, ftp: FTP, cadence: 0 }, 14, 3), 'tuck');
  assert.equal(ride(st, { grade: -3, power: 60, ftp: FTP, cadence: 70 }, 12, 3), 'tuck');   // hysteresis
  assert.equal(ride(st, { grade: -6, power: 220, ftp: FTP, cadence: 95 }, 15, 3), 'seated');
  const slow = postureState();
  assert.equal(ride(slow, { grade: -6, power: 0, ftp: FTP, cadence: 0 }, 3, 3), 'seated');   // too slow to bother
});

test('no flicker: a posture holds for the dwell time', () => {
  const st = postureState();
  ride(st, { grade: 8, power: 260, ftp: FTP }, 4, 3);
  stepPosture(st, { grade: 0, power: 150, ftp: FTP }, 6, 0.1);
  assert.equal(st.posture, 'seated');
  stepPosture(st, { grade: 8, power: 260, ftp: FTP }, 4, 0.1);
  assert.equal(st.posture, 'seated', 'must not stand up again straight away');
});

test('stopped or no effort data: seated; a forced posture wins', () => {
  const st = postureState();
  assert.equal(ride(st, { grade: 10, power: 300, ftp: FTP }, 0, 3), 'seated');
  assert.equal(ride(st, null, 8, 3), 'seated');
  st.forced = 'tuck';
  assert.equal(ride(st, null, 0, 0.2), 'tuck');
});

test('model: one skinned mesh, ~60k triangles, every vertex fully weighted to known bones', () => {
  const m = JSON.parse(readFileSync(new URL('../models/rider.json', import.meta.url)));
  assert.equal(m.format, 'bikefree-model-2');
  assert.ok(m.mesh.tris > 50000 && m.mesh.tris < 70000, `${m.mesh.tris} triangles`);
  const skin = Buffer.from(m.mesh.skin, 'base64'), w = Buffer.from(m.mesh.weights, 'base64');
  assert.equal(skin.length, m.mesh.verts * 4);
  for (let v = 0; v < m.mesh.verts; v++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) { sum += w[v * 4 + k]; assert.ok(skin[v * 4 + k] < m.rig.bones.length); }
    assert.equal(sum, 255, `vertex ${v} weights`);
  }
  for (const f of Object.values(m.atlas).filter((x) => typeof x === 'string')) {
    assert.ok(readFileSync(new URL(`../models/${f}`, import.meta.url)).length > 1000, f);
  }
});
