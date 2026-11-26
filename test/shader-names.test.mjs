// Shader name clashes (the route scenes' compile error, 26 Nov): the shared GLSL chunks that the tree engine and the
// grass cards add to other modules' materials must not reuse a name those materials already declare.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WIND_GLSL } from '../js/world/toolbox/atmosphere/wind.js';

const declared = (src) => new Set([...src.matchAll(/uniform\s+\w+\s+(\w+)/g)].map((m) => m[1]));
const functions = (glsl) => [...glsl.matchAll(/\b(?:vec[234]|float|int|bool|void)\s+(\w+)\s*\(/g)].map((m) => m[1]);

test('the shared wind chunk declares no name the scenery materials use as a uniform', () => {
  const names = new Set([...declared(readFileSync('js/world/toolbox/materials/surfaces.js', 'utf8')),
    ...declared(readFileSync('js/world/toolbox/vegetation/tree-cards.js', 'utf8')),
    ...Object.keys({ bfWind: 1, bfWet: 1, bfRough: 1, bfCloud: 1 })]);   // (the stylized terrain's uniforms)
  const clash = functions(WIND_GLSL).filter((f) => names.has(f));
  assert.deepEqual(clash, [], `wind.js functions clash with scenery uniforms: ${clash.join(', ')}`);
});
