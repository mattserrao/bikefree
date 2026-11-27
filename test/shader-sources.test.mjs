// [review 27 Nov] The generated shader source of every toolbox material that constructs in Node, against its snapshot
// (test/shader-sources.snap.json; built by test/shader-sources.mjs). Wave 3 refactors (T8: patchShader's anchor() at
// every onBeforeCompile patch; T14: the city's and the impostors' shaders in their own modules) changed none of it.
// After an intended shader change: `node test/shader-sources.mjs --write`, and say why in the commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { snapshot } from './shader-sources.mjs';

test('every constructible toolbox material generates the source in its snapshot', async () => {
  const want = JSON.parse(readFileSync(new URL('./shader-sources.snap.json', import.meta.url), 'utf8'));
  const { out, skipped } = await snapshot();
  assert.deepEqual(skipped, [], 'every factory constructs in Node');
  assert.ok(Object.keys(out).length >= 50, 'at least fifty materials');
  const changed = Object.keys(want).filter((k) => JSON.stringify(out[k]) !== JSON.stringify(want[k]));
  const added = Object.keys(out).filter((k) => !(k in want));
  assert.deepEqual({ changed, added }, { changed: [], added: [] }, 'shader source changed: if intended, node test/shader-sources.mjs --write');
});
