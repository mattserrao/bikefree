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

// [world-fix-4, 27 Nov] the guard's two graph-map shots that changed run to run after wave 3 (blamed on #84, which moved
// no pixel there: its parent, bb2b1b6, renders the same stills):
//  - skan:country 2.4 % off, one draw call and one triangle fewer: graph-world's Balanced lite post (2× MSAA + contact
//    AO, a full-screen triangle) is gated on the GPU timer's measured frame — SwiftShader has the timer, and when its
//    first result landed before the still (a slow, busy run) the lite post went off. --frozen hides the timer.
//  - pgh:oakland 2.5–5 % off, 24 draw calls more: the city's level-of-detail pass (the building kit's home detail
//    beyond 550 m hidden) runs every 8th frame, and a chunk the still's last stream built kept its detail shown at
//    any distance. snap_pgh calls the pass (GraphCity.lods) for the still's camera.
test('snap_pgh --frozen hides the GPU timer and runs the city\'s level-of-detail pass for the still', () => {
  const s = readFileSync(new URL('../tools/snap_pgh.mjs', import.meta.url), 'utf8');
  const init = s.slice(s.indexOf('if (frozen) await page.addInitScript('), s.indexOf('const rows = [];'));
  assert.match(init, /getExtension = function \(name\) \{ return \/disjoint_timer_query\/i\.test\(name\) \? null/);
  const lods = s.indexOf('w.city?.lods?.(w.camera.position)');
  assert.ok(lods > s.indexOf('w._stream(w.camera.position.x') && lods < s.indexOf('w._draw()'), 'after the stream loop, before the draw');
});

test('graph-world\'s lite post: on without a GPU timer, off once the timer measures a slow frame (why --frozen hides it)', async () => {
  const { GraphWorld } = await import('../js/world/graph-world.js');
  const lite = (ms) => GraphWorld.prototype._liteOn.call({ qualityKey: 'balanced', gfx: { post: true }, governor: { level: 0 }, gpuTimer: { ms } });
  assert.equal(lite({}), true);                 // (no result yet, or no timer: on)
  assert.equal(lite({ frame: 3 }), true);       // (a fast GPU)
  assert.equal(lite({ frame: 120 }), false);    // (SwiftShader's measured frame: off — one draw call fewer, no AO)
});

test('GraphCity.lods: the tiles\' near / far pieces and the kit\'s detail for a camera; tick runs it every 8th frame', async () => {
  const { GraphCity } = await import('../js/world/graph-city.js');
  const mesh = (name, ud = {}) => ({ name, visible: true, userData: ud });
  const nearT = { cx: 0, cz: 0, near: [mesh('Trees'), mesh('Parked cars')], far: [mesh('Tree cards')] };
  const farT = { cx: 5000, cz: 0, near: [mesh('Trees')], far: [mesh('Tree cards')] };
  const ticked = [];
  const city = { tiles: new Map([['a', nearT], ['b', farT]]), q: { treeNear: 450 }, gfx: { life: false }, kit: { tick: (c) => ticked.push(c) } };
  GraphCity.prototype.lods.call(city, { x: 0, z: 0 });
  assert.deepEqual([nearT.near[0].visible, nearT.near[1].visible, nearT.far[0].visible], [true, false, false]);   // (life off: no parked cars)
  assert.deepEqual([farT.near[0].visible, farT.far[0].visible], [false, true]);
  assert.equal(ticked.length, 1);
  // tick: the pass on every 8th call only (so a still drawn straight after streaming must call lods itself)
  let passes = 0;
  const host = { treeTime: { value: 0 }, glassNight: { value: 0 }, host: { night: { value: 0 } }, gfx: { life: false }, forest: { tick() {} }, world: { camera: {} }, lods: () => passes++ };
  for (let k = 0; k < 16; k++) GraphCity.prototype.tick.call(host, { x: 0, z: 0 }, 0);
  assert.equal(passes, 2);
});
