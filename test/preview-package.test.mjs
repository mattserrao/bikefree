import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Script } from 'node:vm';

test('standalone package preserves embedded code and produces one valid bootstrap script', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bikefree-preview-'));
  try {
    const path = join(dir, 'preview.html');
    const result = spawnSync(process.execPath, [new URL('../tools/package_preview.mjs', import.meta.url).pathname, path], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const html = readFileSync(path, 'utf8');
    assert.equal([...html.matchAll(/<script\b/g)].length, 1);
    assert.equal([...html.matchAll(/<\/script>/g)].length, 1);
    const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    assert.doesNotThrow(() => new Script(bootstrap));
    assert.ok(bootstrap.includes('bikefree-scene-1'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
