// [review 27 Nov] The toolbox's Wave 1 fixes from the code review: the post pipeline's targets (T5), the water
// surface's dispose (T3), the tree engine's and old growth's dispose (T7), the look's sweep cadence (T4), seeded
// content (T12) and no per-frame allocations in the ticks (T13).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.js';
import { PostFX } from '../js/world/toolbox/atmosphere/post.js';
import { waterSurface } from '../js/world/toolbox/effects/water-surface.js';
import { Look } from '../js/world/toolbox/atmosphere/look.js';
import { Builder, blob, M } from '../js/world/toolbox/core/model-builder.js';
import { Herds } from '../js/world/toolbox/life/figures/animals.js';

const fakeRenderer = () => ({ getPixelRatio: () => 1, setRenderTarget() {}, render() {}, toneMapping: 0 });

test('post: only the path in use keeps its full-size target; the quarter-size ones only on the graded path (T5)', () => {
  const P = new PostFX(fakeRenderer()), scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera();
  P.setSize(800, 600);
  P.render(scene, cam, { grade: false });
  assert.ok(P.plain && !P.scene, 'plain path: the 8-bit target only');
  assert.deepEqual([P.a, P.b, P.c, P.d], [null, null, null, null], 'plain path: no quarter-size targets');
  P.render(scene, cam, {});
  assert.ok(P.scene && !P.plain, 'graded path: the plain target freed');
  assert.ok(P.a && P.b && !P.c && !P.d, 'bloom targets made, the shafts\' not (no atmosphere)');
  assert.deepEqual([P.a.width, P.a.height], [200, 150]);
  P.setSize(400, 300); assert.deepEqual([P.a.width, P.a.height, P.scene.width], [100, 75, 400]);
  P.render(scene, cam, { grade: false });
  assert.ok(P.plain && !P.scene && !P.a && !P.b, 'back on the plain path: the HDR and bloom targets freed');
  P.dispose();
});

test('water surface: dispose switches it off and keeps patches chained on after it (T3)', () => {
  const m = new THREE.MeshStandardMaterial(), world = { mats: { water: m } };
  const a = waterSurface.install(world);
  // a later patch (as baked-light.js / look.js chain theirs, once per material)
  const water = m.onBeforeCompile, waterKey = m.customProgramCacheKey();
  m.onBeforeCompile = (s, r) => { water.call(m, s, r); s.fragmentShader += '\n// later-patch'; };
  m.customProgramCacheKey = () => `${waterKey}|later`;
  a.dispose();
  const compile = () => { const L = THREE.ShaderLib.standard, s = { vertexShader: L.vertexShader, fragmentShader: L.fragmentShader, uniforms: {} }; m.onBeforeCompile(s, {}); return s; };
  let s = compile();
  assert.ok(s.fragmentShader.includes('// later-patch'), 'the later patch survives dispose');
  assert.equal(s.uniforms.uWaterOn.value, 0, 'the surface is off');
  assert.ok(m.customProgramCacheKey().endsWith('|later'));
  // installed again (a new ride on the same material): its uniforms swapped in, not a second wrapper
  const b = waterSurface.install(world);
  s = compile();
  assert.equal(s.uniforms.uWaterOn.value, 1);
  assert.equal(s.fragmentShader.split('varying vec3 bfWaterP;').length, 2, 'declared once');
  b.dispose();
});

test('tree engine dispose frees the impostors\' shadow depth material (T7)', async () => {
  const { TreeEngine } = await import('../js/world/toolbox/vegetation/tree-engine.js');
  const freed = [], d = (name) => ({ dispose: () => freed.push(name) });
  const self = { group: { removeFromParent() {} }, entries: [], mats: [], _own: new Map(), impGeo: d('geo'), impMat: d('mat'), atlas: d('atlas'), leafTexture: d('leaf'), impMesh: { customDepthMaterial: d('depth') } };
  TreeEngine.prototype.dispose.call(self);
  assert.ok(freed.includes('depth'));
});

test('old growth dispose frees what it made, not what it borrows (T7)', async () => {
  const { OldGrowth } = await import('../js/world/toolbox/vegetation/old-growth.js');
  const freed = new Set(), own = (name) => ({ name, dispose: () => freed.add(name) });
  const group = new THREE.Group(), parent = new THREE.Group(); parent.add(group);
  const ground = own('world ground'), kitLog = own('kit log geometry');
  const mesh = (name, geometry, material) => { const o = { name, geometry, material, dispose: () => freed.add(name) }; return o; };
  const self = Object.assign(Object.create(OldGrowth.prototype), {
    group, blocks: new Map([['0,0', { skirt: mesh('skirt', own('skirt geo'), ground), roots: mesh('roots', own('roots geo'), own('rootMat')), fins: mesh('fins', own('fins geo'), own('grassMat')) }]]),
    canopy: mesh('canopy', own('canopy geo'), own('canopy mat')), rays: null, pools: null,
    logMeshes: { log: mesh('log mesh', kitLog, own('logMat')) }, flareMesh: mesh('flare mesh'), flareGeo: own('flareGeo'),
    blades: { near: mesh('blades mesh', own('blades geo')) }, logMat: own('logMat'), flareMat: own('flareMat'), bladeMat: own('bladeMat'), grassMat: own('grassMat'), rootMat: own('rootMat'),
    _nt: own('near trunks'), _np: own('near plants'), life: own('life'),
  });
  self.dispose();
  assert.equal(group.parent, null);
  for (const k of ['skirt geo', 'roots geo', 'fins geo', 'canopy geo', 'canopy mat', 'log mesh', 'flare mesh', 'flareGeo', 'blades geo', 'blades mesh', 'logMat', 'flareMat', 'bladeMat', 'grassMat', 'rootMat', 'near trunks', 'near plants', 'life']) assert.ok(freed.has(k), k);
  assert.ok(!freed.has('world ground') && !freed.has('kit log geometry'), 'borrowed: the land material, the kit\'s models');
});

test('the look walks the scene on its first call, then every 20 frames or when dirty (T4)', () => {
  let walks = 0;
  const world = { renderer: { toneMapping: 0 }, scene: { traverse: () => walks++ }, road: null };
  const L = new Look(world, 'gentle');
  for (let i = 0; i < 40; i++) L.sweep();
  assert.equal(walks, 2);
  L.dirty = true; L.sweep(); assert.equal(walks, 3);
  L.sweep(true); assert.equal(walks, 4);
});

test('seeded content: the model builder\'s jitter and an animal\'s phase are the same every build (T12)', () => {
  const build = () => new Builder().add(blob(1), M(), '#557744', .3).build().attributes.color.array;
  const was = Math.random; let r = 0; Math.random = () => (r = (r + .618034) % 1);   // (a different draw every call: a build that used it wouldn't repeat)
  try {
    assert.deepEqual(build(), build());
    const a = new Herds().add('deer', 10, 0, 20, 0).list[0].phase, b = new Herds().add('deer', 10, 0, 20, 0).list[0].phase;
    assert.equal(a, b); assert.ok(a >= 0 && a < 1);
  } finally { Math.random = was; }
});

test('the ticks the review named allocate nothing per animal or per frame (T13)', async () => {
  const { readFileSync } = await import('node:fs');
  // the body of the first `head` in a file (braces matched)
  const body = (file, head) => {
    const src = readFileSync(new URL(`../js/world/toolbox/${file}`, import.meta.url), 'utf8'), i = src.indexOf(head);
    assert.ok(i >= 0, `${file}: ${head}`);
    let k = src.indexOf('{', i + head.length - 1), depth = 0, j = k;
    for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) break; }
    return src.slice(k, j + 1);
  };
  for (const [file, head] of [['life/forest-life.js', '  tick(time) {'], ['life/wildlife.js', '  tick(dt, camera) {'], ['life/coast-life.js', '  tick(dt, camera) {'],
    ['city/pgh-landmarks.js', '    tick(time) {'], ['landscape/far-terrain.js', '  tick(camera, '], ['structures/subway.js', '  update(sub, rider, dt) {']]) {
    const b = body(file, head);
    for (const bad of [/new THREE\./, /[^a-zA-Z_.]V\(/, /\.clone\(\)/, /\.map\(/, /\[\.\.\./]) assert.ok(!bad.test(b), `${file} ${head.trim()}: ${bad}`);
  }
  const og = body('vegetation/old-growth.js', '  tick(camera, time) {');
  assert.ok(og.includes('this._blockList ||=') && !/\.sort\(\(a, b\)/.test(og), 'old growth: the block list kept, sorted in place (no spread/map/sort a frame)');
});
