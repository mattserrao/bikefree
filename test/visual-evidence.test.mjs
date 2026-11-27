// The visual evidence (user, 27 Nov 2026: "prove each change with evidence; don't claim it"): Out West rendered from
// the places, camera heights, lenses and headings of real photographs (tools/reference/matched_shots.py), measured
// against them (compare.py) with the frame's own counters (js/world/toolbox/core/frame-audit.js), and recorded before
// and after (evidence.py → tools/reference/outwest-evidence.json). Rendering takes minutes, so the tests hold the
// recorded numbers to their budgets (tools/reference/budgets.json); re-record after a visual change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const B = JSON.parse(read('tools/reference/budgets.json'));
// (the records: PR #72's look, then the plant life — plants phases 0–5)
const RECORDS = ['outwest-evidence', 'outwest-plants-evidence'].map((n) => [n, JSON.parse(read(`tools/reference/${n}.json`))]);

for (const [name, ev] of RECORDS) {
test(`${name}: the evidence is a real record: four matched shots, each with a photo licence, stats and counters before and after`, () => {
  assert.equal(ev.format, 'bikefree-visual-evidence-1');
  assert.ok(ev.shots.length >= 4, `${ev.shots.length} shots`);
  for (const s of ev.shots) {
    assert.ok(s.license && s.page, `${s.photo}: licence and source page`);
    for (const k of ['before', 'after']) { assert.ok(s[k].stats?.land, `${s.photo} ${k}: stats`); assert.ok(s[k].counters?.calls, `${s.photo} ${k}: counters`); }
  }
});

test(`${name}: no shot moved further from its photo, and every land is within the image budget`, () => {
  const I = B.image;
  for (const s of ev.shots) {
    const b = s.before.stats.land, a = s.after.stats.land;
    assert.ok(a.dE <= b.dE + I.landDeSlack, `${s.photo}: land ΔE ${b.dE.toFixed(1)} → ${a.dE.toFixed(1)}`);
    assert.ok(a.dE <= I.landDeMax, `${s.photo}: land ΔE ${a.dE.toFixed(1)} > ${I.landDeMax}`);
    // (a known gap, named with its reason in budgets.json, is held only to not getting worse)
    if (B.knownGaps?.[s.photo]?.chroma) assert.ok(a.chromaRender <= b.chromaRender, `${s.photo}: chroma rose ${b.chromaRender.toFixed(0)} → ${a.chromaRender.toFixed(0)}`);
    else assert.ok(a.chromaRender / a.chromaPhoto <= I.chromaRatioMax, `${s.photo}: chroma ${a.chromaRender.toFixed(0)} vs photo ${a.chromaPhoto.toFixed(0)}`);
    assert.ok(Math.abs(a.hueDiff) <= I.hueAbsMax, `${s.photo}: hue off by ${a.hueDiff.toFixed(0)}°`);
    assert.ok(a.detailRender >= b.detailRender * .95, `${s.photo}: fine detail fell ${b.detailRender.toFixed(3)} → ${a.detailRender.toFixed(3)}`);
  }
});

test(`${name}: every after-shot is within the frame budgets (draw calls, triangles, programs, memory, overdraw)`, () => {
  const C = B.counters;
  for (const s of ev.shots) {
    const c = s.after.counters, at = s.photo;
    assert.ok(c.calls <= C.calls, `${at}: ${c.calls} draw calls`);
    assert.ok(c.triangles <= C.triangles, `${at}: ${c.triangles} triangles`);
    assert.ok(c.programs <= C.programs, `${at}: ${c.programs} programs`);
    assert.ok(c.geometryMB <= C.geometryMB, `${at}: ${c.geometryMB} MB geometry`);
    assert.ok(c.textureMB <= C.textureMB, `${at}: ${c.textureMB} MB textures`);
    assert.ok(c.overdraw.mean <= C.overdrawMean && c.overdraw.p95 <= C.overdrawP95, `${at}: overdraw ${c.overdraw.mean} / p95 ${c.overdraw.p95}`);
    assert.ok(c.cpuMs <= C.cpuMs, `${at}: ${c.cpuMs} ms script per frame`);
  }
});
}

test('the tree impostor atlas keeps no multisample or depth buffer of its own (baked a row at a time, then copied)', () => {
  const src = read('js/world/toolbox/vegetation/tree-engine.js');
  const atlas = src.match(/const rt = new THREE\.WebGLRenderTarget\(W, H, \{[^}]*\}/)?.[0] || '';
  assert.match(atlas, /depthBuffer: false/); assert.doesNotMatch(atlas, /samples/);
  const norm = src.match(/rtN = new THREE\.WebGLRenderTarget\([^)]*\{[^}]*\}/)?.[0] || '';
  assert.match(norm, /depthBuffer: false/);
  assert.match(src, /rowRT\.dispose\(\)/); assert.match(src, /rowN\.dispose\(\)/);
});

test('the desert ground keeps its covers\' own colour (no green-ground tint ratio on red sand)', () => {
  const src = read('js/world/graph-world.js');
  assert.match(src, /#ifdef DESERT\s+tintOff = 1\.;/);
});
