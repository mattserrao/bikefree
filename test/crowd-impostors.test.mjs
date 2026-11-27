import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.js';
import { POSES, POSE_OF, packColor, FRAMES, ANGLES, COLS } from '../js/world/toolbox/life/figures/impostors.js';
import { STRIDE, writePerson } from '../js/world/toolbox/life/crowd-pool.js';
import { CLIP, FIT, posedFigure, randomLook } from '../js/world/toolbox/life/figures/people.js';
import { randomSequence } from '../js/world/toolbox/core/random.js';

test('every race-day clip has an atlas pose', () => {
  for (const c of ['idle', 'look', 'photo', 'cheer', 'wave', 'clap', 'flag', 'sit']) assert.ok(POSE_OF[CLIP[c]] >= 0, c);
  assert.ok(POSES.length * FRAMES * ANGLES <= COLS * 10);
});

test('colours pack exactly into a float32', () => {
  const c = new THREE.Color(1, .5, 0), f = new Float32Array([packColor(c)])[0];
  assert.equal(f, 255 * 65536 + 128 * 256);
});

test('a person is 16 floats with its look', () => {
  const look = randomLook(randomSequence(3)); look.bits |= FIT.SLEEVES | FIT.LONG_PANTS;
  const a = new Float32Array(STRIDE * 2);
  writePerson(a, 1, { x: 1, y: 2, z: 3, yaw: .5, look, pose: 3, phase: .25, rate: .8 });
  assert.deepEqual([...a.subarray(16, 20)], [1, 2, 3, .5]);
  assert.equal(a[16 + 6], 3); assert.equal(a[16 + 13], 3);
});

test('posed figures bake paint channels (shirt, trousers, skin, hair; shin, forearm) for the atlas', () => {
  const look = randomLook(randomSequence(9)); look.bits = FIT.SLEEVES | FIT.LONG_PANTS;
  const g = posedFigure(look, CLIP.cheer, { lod: 'hi', channels: true });
  assert.ok(g.attributes.aCh0 && g.attributes.aCh1 && !g.attributes.color);
  const a1 = g.attributes.aCh1.array;
  let shin = 0, fore = 0; for (let i = 0; i < a1.length; i += 4) { shin += a1[i + 1]; fore += a1[i + 2]; }
  assert.ok(shin > 0 && fore > 0);
});
