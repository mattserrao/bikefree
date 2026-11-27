// The refactor guard's stills (code review 27 Nov 2026, wave 3). Until this wave every route still the guard recorded
// was an empty canvas (snap_scene.mjs --fingerprint read the frame back after an await, once the browser had cleared
// the WebGL drawing buffer), and every graph-map still was compared against a path that didn't exist (read as 0 %
// changed). These tests pin the fixes: the PNG reader the guard now uses, the readback order, and — where Chrome is
// installed — a real guard record of one cheap scene that must come out non-blank.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { decodePng, imageStats, pixelShare } from '../tools/lib/png.mjs';
import { findChrome } from '../tools/lib/harness.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

// a PNG encoder for the fixtures: every row with the next of the five filters, so the reader's unfiltering is all tested
function crc32(buf) { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; }
function chunk(kind, body) { const b = Buffer.alloc(12 + body.length); b.writeUInt32BE(body.length, 0); b.write(kind, 4, 'latin1'); body.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, 8 + body.length)), 8 + body.length); return b; }
function encodePng(width, height, channels, px) {
  const type = { 1: 0, 2: 4, 3: 2, 4: 6 }[channels], stride = width * channels, raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const f = y % 5; raw[y * (stride + 1)] = f;
    for (let x = 0; x < stride; x++) {
      const v = px[y * stride + x], a = x >= channels ? px[y * stride + x - channels] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = y && x >= channels ? px[(y - 1) * stride + x - channels] : 0;
      const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
      const p = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      raw[y * (stride + 1) + 1 + x] = (v - p) & 255;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = type;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('png.mjs: decodes every filter and colour type the browser writes', () => {
  for (const ch of [1, 2, 3, 4]) {
    const w = 23, h = 11, px = Uint8Array.from({ length: w * h * ch }, (_, i) => (i * 37 + (i >> 3) * 11) & 255);
    const img = decodePng(encodePng(w, h, ch, px));
    assert.deepEqual([img.width, img.height, img.channels], [w, h, ch]);
    assert.deepEqual(Buffer.from(img.data), Buffer.from(px), `channels ${ch}`);
  }
  assert.throws(() => decodePng(Buffer.from('not a png at all')), /not a PNG/);
});

test('png.mjs: imageStats calls an empty canvas blank and a drawn one not', () => {
  const w = 64, h = 36;
  const empty = encodePng(w, h, 4, new Uint8Array(w * h * 4));   // what the guard recorded before wave 3: transparent black
  assert.equal(imageStats(empty).blank, true);
  assert.equal(imageStats(empty).colours, 1);
  const black = encodePng(w, h, 3, new Uint8Array(w * h * 3));
  assert.equal(imageStats(black).blank, true);
  const drawn = encodePng(w, h, 3, Uint8Array.from({ length: w * h * 3 }, (_, i) => (i * 7) & 255));
  const s = imageStats(drawn);
  assert.equal(s.blank, false); assert.ok(s.colours > 100 && s.lit > .5, JSON.stringify(s));
});

test('png.mjs: pixelShare — the graph maps\' tolerance check (was png_diff.py)', () => {
  const w = 10, h = 10, a = new Uint8Array(w * h * 3).fill(100), b = Uint8Array.from(a);
  for (let i = 0; i < 7; i++) b[i * 3 + 1] = 200;   // 7 pixels off by 100 in green
  b[50 * 3] = 120;   // one off by 20: under the 32 levels
  assert.equal(pixelShare(encodePng(w, h, 3, a), encodePng(w, h, 3, b)), .07);
  assert.equal(pixelShare(encodePng(w, h, 3, a), encodePng(w, h, 3, a)), 0);
  assert.equal(pixelShare(encodePng(w, h, 3, a), encodePng(5, 5, 3, new Uint8Array(75))), 1);   // sizes differ
});

test('snap_scene.mjs reads the frame back in the same task as the render (no await between)', () => {
  const s = readFileSync(join(ROOT, 'tools/snap_scene.mjs'), 'utf8');
  const render = s.indexOf('if (w._render) w._render(); else w.renderer.render(w.scene, w.camera);');
  const read = s.indexOf('toDataURL(', render);
  assert.ok(render > 0 && read > render, 'render, then toDataURL');
  assert.doesNotMatch(s.slice(render, read), /\bawait\b/, 'an await between the render and the readback blanks the still');
});

test('toolbox_guard.mjs: no Python in compare; refuses blank and missing stills', () => {
  const s = readFileSync(join(ROOT, 'tools/toolbox_guard.mjs'), 'utf8');
  assert.doesNotMatch(s, /png_diff\.py|python3/);
  assert.match(s, /stillProblem/);
  const p = readFileSync(join(ROOT, 'tools/snap_pgh.mjs'), 'utf8');
  assert.doesNotMatch(p, /file\.slice\(ROOT\.length\)/, 'an --out outside the repo had written a mangled path the guard then could not find');
});

// The real thing: record one cheap route scene (Yosemite, one shot, ~15 s on a software GPU) and check its still.
// Skipped without Chrome, or with BF_SKIP_BROWSER=1.
const CHROME = findChrome();
test('guard record of one scene gives a non-blank still (Chrome)', { skip: (!CHROME && 'no Chrome') || (process.env.BF_SKIP_BROWSER && 'BF_SKIP_BROWSER'), timeout: 300000 }, () => {
  const d = mkdtempSync(join(tmpdir(), 'bf-guard-'));
  try {
    const r = spawnSync(process.execPath, [join(ROOT, 'tools/toolbox_guard.mjs'), 'record', d, 'yosemite'], { cwd: ROOT, encoding: 'utf8', timeout: 280000 });
    const file = join(d, 'yosemite', 'yosemite-7610.png');
    assert.ok(existsSync(file), r.stdout + r.stderr);
    const s = imageStats(readFileSync(file));
    assert.equal(s.blank, false, JSON.stringify(s));
    assert.ok(s.colours > 1000 && s.lit > .5, JSON.stringify(s));
    assert.doesNotMatch(r.stdout, /STILL (BLANK|MISSING)/);
    const rows = JSON.parse(readFileSync(join(d, 'yosemite', 'snapshots.json'))).rows;
    assert.ok(rows[0].fingerprint?.objects > 0, 'the fingerprint still comes with the still');
    // and compare of a run with itself: same
    const c = spawnSync(process.execPath, [join(ROOT, 'tools/toolbox_guard.mjs'), 'compare', d, d], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(c.status, 0, c.stdout);
    assert.match(c.stdout, /same\s+yosemite@7610/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
