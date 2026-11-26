// The post pass's shaders (js/world/toolbox/atmosphere/post.js): every function and uniform a pass calls is declared
// in that pass (Balanced's lite pass once called the contact shading without its chunk: a shader that didn't compile,
// a world that never got ready — caught by qc:map, 26 Nov 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PostFX } from '../js/world/toolbox/atmosphere/post.js';

test('each post pass declares what it calls (contact shading, the air, the ink)', () => {
  const P = new PostFX({ getPixelRatio: () => 1 });
  for (const [name, m] of [['copy', P.copy], ['composite', P.composite]]) {
    const fs = m.fragmentShader;
    for (const [use, decl] of [['contactAO(', 'float contactAO('], ['applyAtmo(', 'vec3 applyAtmo('], ['applyInk(', 'vec3 applyInk('], ['uAO.', 'uniform vec2 uAO']]) {
      if (fs.includes(use)) assert.ok(fs.includes(decl), `${name} uses ${use} without ${decl}`);
    }
  }
});
