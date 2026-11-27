// [review 27 Nov] The route scenes' headlight (js/world/world.js), as the graph maps' (W7): made with the world at
// nothing, always visible, its intensity set by the time of day — it had been added on the first night frame (and
// hidden by day, which takes it out of the light count too), a change in the lights every lit material compiled
// with: the first night frame recompiled them all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/world/world.js', import.meta.url), 'utf8');
const ctor = src.slice(src.indexOf('  constructor('), src.indexOf('\n  }\n', src.indexOf('  constructor(')));
const method = (name) => { const i = src.indexOf(`\n  ${name}(`); return src.slice(i, src.indexOf('\n  }\n', i)); };

test('the headlight exists from construction, at intensity 0, before the first time of day is set', () => {
  const make = ctor.search(/this\.headlight = new THREE\.SpotLight\('#fff1d6', 0, 85, \.58, 1, 1\.5\); this\.scene\.add\(this\.headlight, this\.headlight\.target\)/);
  assert.ok(make > 0, 'made in the constructor at 0');
  assert.ok(make < ctor.indexOf("this.setTimeOfDay('midday')"), 'before the first setTimeOfDay');
});

test('the time of day (_applyLight) only sets its intensity: never makes it, never hides it (both change the light count)', () => {
  const tod = method('_applyLight');
  assert.ok(tod.length > 1000);
  assert.doesNotMatch(tod, /new THREE\.SpotLight/);
  assert.doesNotMatch(tod, /headlight\.visible\s*=/);
  assert.match(tod, /this\.headlight\.intensity = t\.night \? 650 : 0/);
  assert.equal((src.match(/new THREE\.SpotLight\(/g) || []).length, 1, 'one headlight, made once');
  assert.doesNotMatch(src, /headlight\?\.visible|headlight\.visible/);
});

test('three counts a light at intensity 0 that is visible (so day and night compile the same programs)', async () => {
  const THREE = await import('../vendor/three.js');
  const scene = new THREE.Scene(), l = new THREE.SpotLight('#fff1d6', 0, 85, .58, 1, 1.5);
  scene.add(l, l.target);
  let n = 0; scene.traverseVisible((o) => { if (o.isLight) n++; });
  assert.equal(n, 1);
});
