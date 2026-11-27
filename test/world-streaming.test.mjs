// [review 27 Nov] The graph maps' per-frame streaming (W6) and night lights (W7): js/world/graph-world.js _stream sorts
// its wanted tiles only when the camera has moved on, builds nearest first, finds spill work in the tiles waiting for
// it (not a scan of the map); GraphCity.stream works out a tile's sectors once; the lamp lights come from the city's
// lamp heads by tile; the live shadow is set on meshes as they are added.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.js';
import { GraphWorld, nearestLampHeads, receiveOnAdd, TILE } from '../js/world/graph-world.js';
import { GraphCity } from '../js/world/graph-city.js';

const fakeWorld = () => {
  const w = Object.create(GraphWorld.prototype);
  Object.assign(w, { tiles: new Map(), nearM: 1200, farM: 1600, ground: {}, _frames: 0, _built: new Set(), _spillWait: new Set(), _spilled: new Set(), group: new THREE.Group() });
  w.built = [];
  w._tileWork = function* (t) { t.built = true; t.groundMesh = new THREE.Mesh(); this._built.add(t); this.built.push(t); };
  w._spillJob = function* (t) { (this.spilled ||= []).push(t); };
  return w;
};

test('graph world streaming: nearest first, sorted again only once the camera moves on', () => {
  const w = fakeWorld();
  let sorts = 0; const wantAt = w._wantAt; w._wantAt = function (...a) { sorts++; return wantAt.apply(this, a); };
  for (let f = 0; f < 200; f++) { w._frames = f; w._stream(130, -70, 1e9); }
  assert.equal(sorts, 1);
  const d = (t) => Math.hypot(t.cx - 130, t.cz + 70);
  for (let k = 1; k < w.built.length; k++) assert.ok(d(w.built[k]) >= d(w.built[k - 1]), 'built nearest first');
  assert.ok(w.built.length > 20 && w.built.every((t) => d(t) <= 1200));
  assert.equal(w._queued, 0);
  for (let f = 0; f < 60; f++) { w._frames++; w._stream(130 + f, -70, 1e9); }   // (60 m: one more sort)
  assert.equal(sorts, 2);
});

test('graph world streaming: spill work from the tiles waiting for it; released tiles leave the sets', () => {
  const w = fakeWorld();
  w._stream(0, 0, 1e9);
  const near = w.tiles.get('0,0'), far = w.tiles.get('1,1');
  w._spillPending(near, true); w._spillPending(far, true);
  w._frames = 1; w._stream(0, 0, 1e9);
  assert.deepEqual(w.spilled, [near]);   // (within SPILL_IN of the camera only)
  assert.ok(!w._spillWait.has(near) && w._spillWait.has(far) && near.spillPending === false);
  w._release(far);
  assert.ok(!w._spillWait.has(far) && !w._built.has(far) && far.built === false);
});

test('graph city streaming: a tile\'s sectors worked out once', () => {
  const c = Object.create(GraphCity.prototype);
  const list = {}; for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) list[`${a}_${b}`] = 1;
  c.index = { sectors: { south: 39.98, west: -80.02, dlat: .01, dlon: .013, list } };
  c.world = { ground: {}, proj: { toLatLon: (x, z) => ({ lat: 40 + z / 111000, lon: -80 + x / 85000 }) }, camera: { position: { x: 0, z: 0 } } };
  Object.assign(c, { ready: true, q: { near: 1200, far: 1600 }, tiles: new Map(), sectors: new Map(), gfx: { verge: false }, kit: { closeJob: () => null } });
  c._requestSector = function (k) { if (!this.sectors.has(k)) this.sectors.set(k, { key: k, state: 'ready' }); };
  c._tileJob = function* (key, i, j) { this.tiles.set(key, { key, i, j, cx: (i + .5) * TILE, cz: (j + .5) * TILE, built: true, meshes: [], near: [] }); };
  let calls = 0; const so = c._sectorsOf; c._sectorsOf = function (...a) { calls++; return so.apply(this, a); };
  for (let f = 0; f < 300; f++) c.stream(f * .1, 0, 1e9);
  const n = c._want.list.length;
  assert.ok(n > 20 && calls === n, `${calls} sector look-ups for ${n} tiles`);
  assert.equal(c.queued, 0);
  assert.equal(c.tiles.size, n);
});

test('night lights: the nearest lamp heads from the city\'s tiles, nearest first', () => {
  const tiles = new Map(), all = [];
  let s = 1; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    const H = new Float32Array(30 * 3);
    for (let k = 0; k < 30; k++) { const x = (i + rnd()) * TILE, z = (j + rnd()) * TILE; H.set([x, 7, z], k * 3); all.push([x, z]); }
    tiles.set(`${i},${j}`, { lampHeads: H });
  }
  const out = new Float32Array(18);
  for (const [x, z] of [[10, 10], [-390, 205], [399, -1]]) {
    const n = nearestLampHeads({ tiles }, x, z, 120, out, 6);
    const ref = all.map(([a, b]) => Math.hypot(a - x, b - z)).filter((d) => d < 120).sort((a, b) => a - b).slice(0, 6);
    assert.equal(n, ref.length);
    for (let k = 0; k < n; k++) assert.ok(Math.abs(Math.hypot(out[k * 3] - x, out[k * 3 + 2] - z) - ref[k]) < 1e-3);
  }
  assert.equal(nearestLampHeads(null, 0, 0, 120, out, 6), 0);
});

test('live shadows: set on meshes as they are added, however deep', () => {
  const root = new THREE.Group(), pre = new THREE.Mesh();
  root.add(pre);
  receiveOnAdd(root);
  assert.equal(pre.receiveShadow, true);
  const sub = new THREE.Group(); root.add(sub);
  const late = new THREE.Mesh(); sub.add(late);
  const inner = new THREE.Group(), deep = new THREE.Mesh(); inner.add(deep); sub.add(inner);
  assert.ok(late.receiveShadow && deep.receiveShadow);
  assert.equal(sub.children.length, 2);
});

test('route worlds: the look is told to sweep when the terrain builds, not only every 20 frames', async () => {
  const { World } = await import('../js/world/world.js');
  const look = { dirty: false }, terrain = { stats: { queued: 5, ready: 10 }, city: { _pending: [1, 2] } };
  const w = Object.assign(Object.create(World.prototype), { look, terrain });
  w._lookWatch(); assert.equal(look.dirty, true);
  look.dirty = false; w._lookWatch(); assert.equal(look.dirty, false, 'nothing built: no walk');
  terrain.stats.queued = 4; w._lookWatch(); assert.equal(look.dirty, true, 'a tile built');
  look.dirty = false; terrain.city._pending.pop(); w._lookWatch(); assert.equal(look.dirty, true, 'a city chunk built');
  look.dirty = false; w.terrain = { stats: { queued: 4, ready: 10 }, city: { _pending: [1] } }; w._lookWatch(); assert.equal(look.dirty, true, 'another area drawn');
  w.look = null; w._lookWatch();   // (no look: nothing to do)
});

// [flash fix 27 Nov] anything new — a landmark, the crowd, a rider — marks the look dirty too, by the renderer's counts
test('route worlds: a new geometry or shader program marks the look dirty (no unstyled frames)', async () => {
  const { World } = await import('../js/world/world.js');
  const look = { dirty: false }, terrain = { stats: { queued: 0, ready: 1 }, city: { _pending: [] } };
  const renderer = { info: { memory: { geometries: 10 }, programs: [1, 2] } };
  const w = Object.assign(Object.create(World.prototype), { look, terrain, renderer });
  w._lookWatch(); look.dirty = false;
  w._lookWatch(); assert.equal(look.dirty, false);
  renderer.info.memory.geometries = 11; w._lookWatch(); assert.equal(look.dirty, true, 'a new geometry');
  look.dirty = false; renderer.info.programs.push(3); w._lookWatch(); assert.equal(look.dirty, true, 'a new program');
});
