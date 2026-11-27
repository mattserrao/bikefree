// qc_map / qc.mjs --frozen (code review 27 Nov 2026, wave 3): a graph map's QC run made deterministic — snap_pgh.mjs
// --frozen (seeded Math.random, a frozen clock, the chase camera on its pose, the live shadows drawn for the still)
// and the moving life hidden before the checks. Measured (wave 3 PR, minutes in Chrome so not here): SKAN two runs
// byte-identical JSON; NYC the same counts but ±1 tree (tiles still arrive in async load order).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import { snapArgs, FROZEN_PRE, LIFE } from '../tools/qc_map.mjs';

test('qc_map snapArgs: --frozen passes snap_pgh --frozen and the life mask; off, neither', () => {
  const on = snapArgs('skan', ['a@1,2'], { out: '/o', frozen: true, evalJs: 'E' });
  assert.equal(on[0], 'tools/snap_pgh.mjs');
  assert.ok(on.includes('--frozen') && on.includes('--qc'));
  assert.equal(on[on.indexOf('--pre') + 1], FROZEN_PRE);
  assert.deepEqual(on.slice(-3), ['a@1,2', '--eval', 'E']);
  const off = snapArgs('skan', ['a@1,2'], { out: '/o' });
  assert.ok(!off.includes('--frozen') && !off.includes('--pre') && !off.includes('--eval'));
  assert.equal(snapArgs('endless', ['km1@800'], { out: '/o' })[0], 'tools/snap_endless.mjs');
  assert.throws(() => snapArgs('endless', ['km1@800'], { out: '/o', frozen: true }), /graph maps only/);
});

test('qc_map FROZEN_PRE hides people, riders, traffic and animals — not the places named like them', () => {
  const scene = new T.Scene(), add = (name) => { const m = new T.Mesh(new T.BufferGeometry(), new T.MeshBasicMaterial()); m.name = name; scene.add(m); return m; };
  const life = ['Road rider 3', 'Cyclists', 'Walkers', 'Locals', 'People', 'People · glasshouse visitors', 'Animals', 'Parked cars', 'Cars · sedan', 'Buses'].map(add);
  const still = ['Ground', 'Carson Street', 'Peoples Gas', 'Busway', 'Streets 3,4', 'Tree shadow proxies'].map(add);
  new Function('w', FROZEN_PRE)({ scene });
  for (const m of life) assert.equal(m.visible, false, m.name);
  for (const m of still) assert.equal(m.visible, true, m.name);
  assert.ok(LIFE.test('Cars · bus') && !LIFE.test('Carson'));
});

test('snap_pgh --frozen pins what had varied run to run: the chase camera and the live shadows', () => {
  const s = readFileSync(new URL('../tools/snap_pgh.mjs', import.meta.url), 'utf8');
  assert.match(s, /if \(frozen && w\._pose && w\._updateCamera\) \{ w\._camInit = false; w\._updateCamera\(/);
  assert.match(s, /if \(frozen\) w\.renderer\.shadowMap\.needsUpdate = true;/);
  const q = readFileSync(new URL('../tools/qc.mjs', import.meta.url), 'utf8');
  assert.match(q, /frozen: flag\('--frozen'\)/);
});
