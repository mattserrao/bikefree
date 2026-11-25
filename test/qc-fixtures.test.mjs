// Calibration fixtures for the QC checks (user, 25 Nov: "Calibration fixtures" — a known-good and a known-bad scene
// per check, so a check that stops finding faults, or starts finding them everywhere, fails here before it misleads a
// map's QC). Each fixture is a tiny synthetic world — a straight way, a ground plane, a few landmark pieces — run
// through the real in-page checks (tools/qc-map.js with the BVH caster, tools/qc-gpu.js) in Node with three.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { runMapQC } from '../tools/qc-map.js';
import { runGpuQC } from '../tools/qc-gpu.js';
import { defectId, diffDefects, closeup } from '../tools/qc-defects.js';
import { bvhCaster } from '../tools/qc-bvh.js';

/** A fixture world: a 100 m way along x (6 m wide, at height 0), a ground plane at `groundY`, and extra meshes / QC
 *  probe data. The ground function (the world's own) is `groundY` too. */
function world({ groundY = 0, meshes = [], prims = [], benches = [], basins = [], roadDeck = false } = {}) {
  const scene = new T.Scene();
  const ground = new T.Mesh(new T.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new T.MeshBasicMaterial());
  ground.position.y = groundY; ground.name = 'Ground'; scene.add(ground);
  if (roadDeck) { const deck = new T.Mesh(new T.PlaneGeometry(100, 6).rotateX(-Math.PI / 2), new T.MeshBasicMaterial()); deck.name = 'Roads'; scene.add(deck); }
  for (const m of meshes) scene.add(m);
  scene.updateMatrixWorld(true);
  const n = 20, x = [], z = [], ele = [];
  for (let i = 0; i <= n; i++) { x.push(-50 + i * 5); z.push(0); ele.push(0); }
  return {
    camera: { position: { x: 0, z: 0 } },
    proj: { toLatLon: (px, pz) => ({ lat: 40 - pz / 111320, lon: -74 + px / 85000 }) },
    G: { edges: [{ id: 1, x, z, ele, n, bridges: [], kind: 'road', name: 'Fixture Rd', from: 1, to: 2 }] },
    pools: [], city: null, profile: {}, scene,
    _groundH: () => groundY, poolAt: () => -1e9, wOf: () => 6,
    heroes: { landmarks: { qc: { prims, benches, basins, bridges: [], views: [] } } },
  };
}
const box = (w, h, d, x, y, z, name = 'Fixture box') => { const m = new T.Mesh(new T.BoxGeometry(w, h, d), new T.MeshBasicMaterial()); m.position.set(x, y + h / 2, z); m.name = name; return m; };
const run = (w) => runMapQC(w, T, { radius: 200 });

test('fixture floating: a piece on the ground, on another piece or on a drawn roof passes; one in the air fails', async () => {
  const good = await run(world({ prims: [
    { lm: 'Fixture', what: 'pillar', x: 20, y: 0, z: 20, r: 0.5, top: 4 },
    { lm: 'Fixture', what: 'cap', x: 20, y: 4, z: 20, r: 0.6, top: 4.4 },                       // held by the pillar
  ], meshes: [box(4, 6, 4, -20, 0, 20, 'Tower')] }));
  assert.equal(good.counts.floating, 0);
  const roof = await run(world({ prims: [{ lm: 'Fixture', what: 'pinnacle', x: -20, y: 6, z: 20, r: 0.3, top: 8 }], meshes: [box(4, 6, 4, -20, 0, 20, 'Tower')] }));
  assert.equal(roof.counts.floating, 0, 'a pinnacle on a drawn roof (the ray from just over its foot)');
  const bad = await run(world({ prims: [{ lm: 'Fixture', what: 'colonnade', x: 20, y: 3, z: 20, r: 0.5, top: 6 }] }));
  assert.equal(bad.counts.floating, 1);
  assert.match(bad.examples.floating[0].at(-1), /colonnade 3\.0 m up/);
  assert.equal(bad.defects[0].id, defectId('floating', 20, 20), 'a stable id');
});

test('fixture edgeLip: flat ground beside the way passes; a 40 cm kerb block right at its edge fails', async () => {
  const good = await run(world({ roadDeck: true }));
  assert.equal(good.counts.edgeLip, 0); assert.equal(good.counts.edgeDitch, 0);
  assert.equal(good.counts.edgeSamples, 10, 'both edges sampled every 20 m');
  const bad = await run(world({ roadDeck: true, meshes: [box(100, 0.4, 1.2, 0, 0, 3.8, 'Kerb')] }));
  assert.ok(bad.counts.edgeLip >= 4, `lips found: ${bad.counts.edgeLip}`);
  assert.match(bad.examples.edgeLip[0].at(-1), /\+0\.28 m \(Kerb\)/);
});

test('fixture edgeDitch: a way on a bank with the ground 1 m down beside it fails', async () => {
  const bad = await run(world({ roadDeck: true, groundY: -1 }));
  assert.ok(bad.counts.edgeDitch >= 4, `ditches found: ${bad.counts.edgeDitch}`);
  assert.equal(bad.counts.edgeLip, 0);
});

test('fixture benches and basins: a bench beside the way passes, one on it fails; a dry basin fails', async () => {
  const good = await run(world({ benches: [{ x: 10, z: 5, kind: 'path', facing: true }], basins: [{ x: 30, z: 30, water: true, name: 'Pool' }] }));
  assert.equal(good.counts.benchOnWay, 0); assert.equal(good.counts.dryBasin, 0);
  const bad = await run(world({ benches: [{ x: 10, z: 1, kind: 'path' }, { x: 20, z: 6, kind: 'path', facing: false }], basins: [{ x: 30, z: 30, water: false, name: 'Pool' }] }));
  assert.equal(bad.counts.benchOnWay, 2); assert.equal(bad.counts.dryBasin, 1);
});

test('fixture BVH caster: hits the top of what is there, misses where nothing is, and indexes every mesh', async () => {
  const w = world({ meshes: [box(2, 3, 2, 5, 0, 5)] }), meshes = [];
  w.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const c = await bvhCaster(T, meshes);
  assert.equal(c.stats.bvh, true); assert.equal(c.stats.built, 2);
  assert.ok(Math.abs(c.down(5, 10, 5, 30).point.y - 3) < 1e-6, 'the box top');
  assert.ok(Math.abs(c.down(50, 10, 50, 30).point.y) < 1e-6, 'the ground');
  assert.equal(c.down(500, 10, 500, 30), null, 'off the ground: nothing');
});

test('fixture GPU: a clean frame passes; GL errors, failed shaders and an over-budget frame fail', async () => {
  const fake = ({ calls = 100, errs = [], shaderFail = false } = {}) => {
    const q = [...errs], info = { autoReset: true, reset() {}, render: { calls, triangles: calls * 1000 }, memory: { geometries: 10, textures: 4 }, programs: [1, 2] };
    const gl = { NO_ERROR: 0, getError: () => q.shift() ?? 0, getProgramInfoLog: () => 'ERROR: 0:12: undeclared identifier', getShaderInfoLog: () => '' };
    const r = { info, debug: {}, getContext: () => gl, compile() { if (shaderFail) r.debug.onShaderError(gl, {}, {}, {}); } };
    return { renderer: r, scene: {}, camera: {}, _draw() {} };
  };
  const ok = await runGpuQC(fake(), T, { budget: { calls: 500 }, spector: false });
  assert.deepEqual(ok.counts, { shaderErrors: 0, glErrors: 0, overBudget: 0 });
  const bad = await runGpuQC(fake({ calls: 900, shaderFail: true }), T, { budget: { calls: 500 }, spector: false });
  assert.equal(bad.counts.overBudget, 1); assert.match(bad.examples.overBudget[0][0], /calls 900 > 500/);
  assert.equal(bad.counts.shaderErrors, 1);
  // (errors left from before the check are cleared; only the frame's own count)
  const w = fake(); const gl = w.renderer.getContext(); let k = 0; gl.getError = () => [0x502, 0, 0x500, 0][k++] ?? 0;
  const glErr = await runGpuQC(w, T, { spector: false });
  assert.equal(glErr.counts.glErrors, 1); assert.equal(glErr.examples.glErrors[0][0], '0x500');
});

test('defects: ids are stable within a 4 m cell, differ by check; a run-to-run diff says what was fixed and what is new', () => {
  assert.equal(defectId('floating', 20.1, 20.2), defectId('floating', 21.9, 23.9));
  assert.notEqual(defectId('floating', 20, 20), defectId('edgeLip', 20, 20));
  assert.notEqual(defectId('floating', 20, 20), defectId('floating', 24.1, 20));
  assert.deepEqual(diffDefects([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }]), { fixed: ['a'], added: ['c'], kept: ['b'] });
  const cam = closeup({ at: [40.7, -73.97] }).split(',').map(Number);
  assert.equal(cam.length, 6); assert.ok(cam[0] < 40.7 && cam[1] > -73.97, 'the eye to the south-east');
});

test('qc_fix: a blocked view gets a corridor proposal in the heroes file; a defect no fixer knows is listed as unfixable', async () => {
  const { propose } = await import('../tools/qc_fix.mjs');
  const d = { id: 'viewBlocked-x', check: 'viewBlocked', note: 'Bow Bridge: 3 trees', landmark: 'Bow Bridge', from: [40.7765, -73.9721] };
  const { props, unfixable } = await propose('nyc', [d, { id: 'sharpCorner-y', check: 'sharpCorner', note: '50°' }]);
  assert.equal(props.length, 1); assert.equal(unfixable.length, 1);
  assert.equal(props[0].file, 'routes/cities/nyc-heroes.json');
  assert.deepEqual(props[0].after.views.at(-1), [40.7765, -73.9721]);
  const json = { landmarks: [{ label: 'Bow Bridge', views: [] }] }; props[0].apply(json);
  assert.deepEqual(json.landmarks[0].views.at(-1), [40.7765, -73.9721]); assert.ok(json.landmarks[0].clearM >= 0, 'the clearing on');
});

test('qc.mjs: one entry for every map kind', async () => {
  const { kindOf, SEVERITY } = await import('../tools/qc.mjs');
  assert.equal(await kindOf('skan'), 'graph'); assert.equal(await kindOf('endless'), 'endless');
  assert.equal(await kindOf('bigsur'), 'route'); assert.equal(await kindOf('nowhere'), null);
  assert.equal(SEVERITY.floating, 'fail'); assert.equal(SEVERITY.sharpCorner, 'warn');
});
