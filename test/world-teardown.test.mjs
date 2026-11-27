// [review 27 Nov] The worlds' teardown and the graph world's fixes (code review W1–W5, W11, W12): the shadow box on
// whole texels, teardownWorld's order (sweep, then dispose, then forceContextLoss), the battery listener taken off
// in dispose(), a mid-way ground job restarted by the canal's cut, readiness() with the landmarks failed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.js';
import { snapShadowBox, teardownWorld } from '../js/world/render-core.js';
import { GraphWorld, makeStandIn } from '../js/world/graph-world.js';
import { CANAL } from '../js/world/toolbox/city/cny-landmarks.js';

const SUN = new THREE.Vector3(-0.6, 0.35, -0.7).normalize();

test('snapShadowBox: the centre sits on the map\'s texel grid, still under a sub-texel move, at the same depth', () => {
  const span = 60, size = 2048, texel = 2 * span / size;
  const right = new THREE.Vector3(0, 1, 0).cross(SUN).normalize(), up = SUN.clone().cross(right).normalize();
  const a = snapShadowBox(new THREE.Vector3(123.456, 7.8, -98.765), SUN, span, size, new THREE.Vector3());
  for (const axis of [right, up]) { const k = a.dot(axis) / texel; assert.ok(Math.abs(k - Math.round(k)) < 1e-6, `off-grid ${k}`); }
  assert.ok(Math.abs(a.dot(SUN) - new THREE.Vector3(123.456, 7.8, -98.765).dot(SUN)) < 1e-9);
  // within a texel of the original (no jump), and the same box for a move smaller than half a texel off a centre
  assert.ok(a.distanceTo(new THREE.Vector3(123.456, 7.8, -98.765)) < texel);
  const b = snapShadowBox(a.clone().addScaledVector(right, texel * 0.3), SUN, span, size, new THREE.Vector3());
  assert.ok(a.distanceTo(b) < 1e-9);
  const c = snapShadowBox(a.clone().addScaledVector(right, texel * 0.7), SUN, span, size, new THREE.Vector3());
  assert.ok(Math.abs(a.distanceTo(c) - texel) < 1e-9);
  // straight down (no right axis from +Y): still a box
  const d = snapShadowBox(new THREE.Vector3(1, 2, 3), new THREE.Vector3(0, 1, 0), span, size, new THREE.Vector3());
  assert.ok(Number.isFinite(d.x + d.y + d.z));
});

test('teardownWorld: the scene swept (geometry, materials, their textures), then dispose, then forceContextLoss', () => {
  const calls = [];
  const geo = new THREE.BoxGeometry(), tex = new THREE.Texture(), mat = new THREE.MeshBasicMaterial({ map: tex });
  const sm = new THREE.ShaderMaterial({ uniforms: { t: { value: new THREE.Texture() } } });
  geo.addEventListener('dispose', () => calls.push('geometry'));
  tex.addEventListener('dispose', () => calls.push('texture'));
  sm.uniforms.t.value.addEventListener('dispose', () => calls.push('uniform texture'));
  mat.addEventListener('dispose', () => calls.push('material'));
  const scene = new THREE.Scene(); scene.add(new THREE.Mesh(geo, mat), new THREE.Mesh(new THREE.PlaneGeometry(), sm));
  const renderer = { dispose: () => calls.push('dispose'), forceContextLoss: () => calls.push('lost'), domElement: { remove: () => calls.push('canvas') } };
  teardownWorld(renderer, scene);
  for (const c of ['geometry', 'texture', 'uniform texture', 'material']) assert.ok(calls.includes(c), c);
  assert.deepEqual(calls.slice(-3), ['dispose', 'lost', 'canvas']);
});

test('makeStandIn: dispose frees its box', () => {
  const s = makeStandIn(); let n = 0;
  s.group.children[0].geometry.addEventListener('dispose', () => n++);
  s.group.children[0].material.addEventListener('dispose', () => n++);
  new THREE.Scene().add(s.group); s.dispose();
  assert.equal(n, 2); assert.equal(s.group.parent, null);
});

/** A GraphWorld with only what setGfx() and dispose() touch (no WebGL). */
function fakeWorld() {
  const w = Object.create(GraphWorld.prototype);
  Object.assign(w, {
    _reach() {}, _treeShadows() {}, pixelCalls: 0, _pixelRatio() { this.pixelCalls++; },
    sun: { castShadow: false, shadow: {} }, tiles: new Map(), mats: {}, _fixed: [], water: { geometry: { dispose() {} } },
    scene: new THREE.Scene(), renderer: { dispose() {}, forceContextLoss() {}, domElement: { remove() {} } },
  });
  return w;
}

test('GraphWorld: the battery listener is taken off in dispose(), and a late event does nothing', async () => {
  globalThis.cancelAnimationFrame ||= () => {};
  const listeners = new Set(), battery = { charging: true, addEventListener: (k, f) => listeners.add(f), removeEventListener: (k, f) => listeners.delete(f) };
  const had = Object.getOwnPropertyDescriptor(globalThis.navigator, 'getBattery');
  globalThis.navigator.getBattery = () => Promise.resolve(battery);
  try {
    const w = fakeWorld();
    w.setGfx({ battery: 'auto' }); await new Promise((r) => setTimeout(r, 0));
    w.setGfx({ battery: 'auto' }); await new Promise((r) => setTimeout(r, 0));
    assert.equal(listeners.size, 1, 'one listener, however often setGfx runs');
    const f = [...listeners][0];
    w.dispose();
    assert.equal(listeners.size, 0, 'removed on dispose');
    const before = w.pixelCalls; battery.charging = false; f();
    assert.equal(w.pixelCalls, before, 'a handler kept elsewhere does nothing once disposed');
  } finally { if (had) Object.defineProperty(globalThis.navigator, 'getBattery', had); else delete globalThis.navigator.getBattery; }
});

test('GraphWorld._cutCanal: a tile mid-way through its ground grid is started again; a roads job is left alone', () => {
  const saved = CANAL.samples.slice();
  CANAL.samples.push({ x: 0, z: 0, creek: false });
  try {
    const w = Object.create(GraphWorld.prototype), mid = { built: true, groundRows: true };
    Object.assign(w, { tiles: new Map([['0,0', mid]]), _tjob: { t: mid, gen: null } });
    w._cutCanal();
    assert.equal(w._tjob, null); assert.equal(mid.groundRows, false); assert.equal(w._canalCut, true);
    const roads = { built: true };
    Object.assign(w, { tiles: new Map([['0,0', roads]]), _tjob: { t: roads, gen: null } });
    w._cutCanal();
    assert.equal(w._tjob.t, roads);
  } finally { CANAL.samples.length = 0; CANAL.samples.push(...saved); }
});

test('GraphWorld.readiness: failed landmarks are reported, and the city and the bridges still wait on their own loads', () => {
  const w = Object.create(GraphWorld.prototype);
  Object.assign(w, {
    json: { heroes: 'h.json', bridges: 'b.json', cityData: 'c.json' }, ground: {}, _nearTiles: [], _frames: 1, _riderModel: 'ok',
    _heroesState: 'failed', _bridgesState: 'loading', camera: { position: { x: 0, z: 0 } },
  });
  let r = w.readiness();
  const lm = r.steps.find((s) => s.key === 'landmarks');
  assert.ok(lm.done && lm.failed, 'landmarks: done, marked failed');
  assert.deepEqual(r.degraded, ['landmarks']);
  assert.ok(r.steps.some((s) => s.key === 'bridges' && !s.done), 'bridges still loading');
  assert.ok(r.steps.some((s) => s.key === 'city' && !s.done), 'the city still to come');
  assert.equal(r.ready, false);
  w._bridgesState = 'ok'; w._cityState = 'ok'; w.city = { ready: true, pendingNear: () => false };
  r = w.readiness();
  assert.ok(r.steps.find((s) => s.key === 'city').done);
  assert.ok(r.steps.find((s) => s.key === 'bridges').done);
});
