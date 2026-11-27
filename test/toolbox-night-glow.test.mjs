// [review 27 Nov] The night glow (materials/night-glow.js), the one copy of "uniform float uNight + a term after
// <emissivemap_fragment>" that ~15 sites used to paste: it patches at anchors three's shaders have (patchShader throws
// otherwise), binds the host's uniform, and each migrated site keeps its own program cache key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from '../vendor/three.js';
import { nightGlowShader, withNightGlow } from '../js/world/toolbox/materials/night-glow.js';

const lib = (k) => ({ vertexShader: THREE.ShaderLib[k].vertexShader, fragmentShader: THREE.ShaderLib[k].fragmentShader, uniforms: {} });
const TOOLBOX = new URL('../js/world/toolbox/', import.meta.url).pathname;
const files = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? files(p) : p.endsWith('.js') ? [p] : []; });
const count = (s, x) => s.split(x).length - 1;

test('nightGlowShader adds uNight once and the term after the emissive map (expression, statements, aGlow)', () => {
  const night = { value: .5 };
  const a = nightGlowShader(lib('standard'), night, 'vColor.rgb * uNight');
  assert.equal(a.uniforms.uNight, night);
  assert.equal(count(a.fragmentShader, 'uniform float uNight;'), 1);
  assert.ok(a.fragmentShader.includes('#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * uNight;'));
  const b = nightGlowShader(lib('physical'), () => night, 'if (vGlow > .5) totalEmissiveRadiance += vec3(1.) * uNight;', { glow: 'float', decl: 'uniform float uPulse;' });
  assert.equal(b.uniforms.uNight, night, 'a function gives the uniform at compile time');
  assert.ok(b.fragmentShader.includes('#include <emissivemap_fragment>\nif (vGlow > .5) totalEmissiveRadiance'), 'statements go in as they are');
  assert.ok(b.fragmentShader.includes('uniform float uNight; varying float vGlow;\nuniform float uPulse;'));
  assert.ok(b.vertexShader.includes('attribute float aGlow; varying float vGlow;') && b.vertexShader.includes('#include <begin_vertex>\nvGlow = aGlow;'));
  // a shader without the emissive map (MeshBasicMaterial's) throws rather than losing the glow
  assert.throws(() => nightGlowShader(lib('basic'), night, 'vec3(1.)'), /anchor not found/);
});

test('withNightGlow chains the material\'s own patch and keeps the site\'s cache key', () => {
  const m = new THREE.MeshStandardMaterial();
  let ran = 0; m.onBeforeCompile = () => { ran++; };
  withNightGlow(m, { value: 1 }, 'vec3(1.) * uNight', 'site-key-1', { uniforms: { uPulse: { value: 0 } }, patch: (sh) => { sh.fragmentShader += '\n// site'; } });
  const sh = lib('standard'); m.onBeforeCompile(sh);
  assert.equal(ran, 1); assert.equal(m.customProgramCacheKey(), 'site-key-1');
  assert.ok(sh.uniforms.uPulse && sh.uniforms.uNight && sh.fragmentShader.endsWith('// site'));
});

test('the vehicles and the cars glow through the helper (one uNight, their lamp terms, the uniform they were given)', async () => {
  const { vehicleMaterial } = await import('../js/world/toolbox/life/figures/vehicles.js');
  const { carMaterial } = await import('../js/world/toolbox/life/figures/cars.js');
  const night = { value: 0 };
  for (const [m, type, key, term] of [[vehicleMaterial(night), 'standard', 'bf-vehicles-1', '(.2 + uNight * 2.2 + vBrake * 2.2)'], [carMaterial({ night }), 'physical', 'bf-cars-2', '(.12 + uNight * .3)']]) {
    const sh = lib(type); m.onBeforeCompile(sh);
    assert.equal(sh.uniforms.uNight, night); assert.equal(count(sh.fragmentShader, 'uniform float uNight;'), 1);
    assert.ok(sh.fragmentShader.includes(term)); assert.equal(m.customProgramCacheKey(), key);
  }
});

test('no toolbox kit pastes its own night glow any more, and every migrated site keeps its own cache key', () => {
  const src = Object.fromEntries(files(TOOLBOX).filter((f) => !f.endsWith('night-glow.js') && !f.endsWith('ground-cover.js')).map((f) => [f.slice(TOOLBOX.length), readFileSync(f, 'utf8')]));
  const PASTE = /replace\(\s*'#include <emissivemap_fragment>',\s*[`'][^`']*uNight/;   // (a replace at the emissive map whose code reads uNight)
  const pasted = Object.entries(src).filter(([, s]) => PASTE.test(s)).map(([f]) => f);
  assert.deepEqual(pasted, []);
  const all = Object.values(src).join('\n');
  for (const key of ['city-heroes-neon-1', 'city-lamp-1', 'glasshouse-art-2', 'glasshouse-frames-1', 'glasshouse-plant-2', 'pgh-landmark-neon', 'street-kit-1-map', 'coast-lighthouse-1', 'bf-vehicles-1', 'bf-cars-2', 'city-buildings-2'])
    assert.equal(count(all, `'${key}'`), 1, key);
  assert.equal(count(all, "'street-kit-1'"), 1);
});
