// The road-graph cities' menu cards are drawn from baked thumbnails (code review, Nov 2026): routes/cities/index.json
// (tools/build_routes.mjs → tools/city_thumbs.mjs) holds each city's roads (all of them), water, box and preset routes, so the
// menu no longer downloads and builds the PGH, CNY and SKAN graphs (about 2 MB) to draw three small cards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { thumbLines } from '../js/city-thumbs.js';
import { simplifyLatLon } from '../tools/city_thumbs.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the generated files are up to date (npm run routes:check)', () => {
  const r = spawnSync(process.execPath, [new URL('../tools/build_routes.mjs', import.meta.url).pathname, '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('every graph city has a small thumbnail with a line for each of its preset routes', () => {
  const { cities } = JSON.parse(read('routes/cities/index.json'));
  const config = JSON.parse(read('routes/cities/graph-cities.json'));
  assert.deepEqual(cities.map((c) => c.id), config.map((c) => c.id));
  for (const c of cities) {
    assert.ok(c.thumb.lines.length > 100, `${c.id}: every road`);
    assert.equal(c.thumb.box.length, 4);
    const presets = JSON.parse(read(`routes/cities/${c.id}-presets.json`));
    for (const pr of presets) assert.ok(c.thumb.routes[pr.id]?.length > 3, `${c.id}: ${pr.id}`);
  }
  assert.ok(read('routes/cities/index.json').length < 400_000, 'the thumbnails stay small (vs ~2 MB of graphs)');
  assert.ok(cities.find((c) => c.id === 'pgh').thumb.water?.length > 0, 'PGH: its rivers');
});

test('thumbLines: the roads, the undrawn box, and the selected route last', () => {
  const thumb = { lines: [[[1, 2], [1.1, 2.1]]], box: [0, 1, 2, 3], routes: { a: [[1, 2], [1.05, 2.05], [1.1, 2.1]] } };
  const { lines, route } = thumbLines(thumb, 'a');
  assert.equal(lines.length, 3);
  assert.equal(lines[1].frame, true);
  assert.ok(!lines[0].frame, 'roads are drawn');
  assert.deepEqual(route, ['route+']);
  assert.equal(lines[2].id, 'route');
  assert.equal(thumbLines(thumb, 'missing').route, null);
});

test('simplifyLatLon keeps corners and drops points on a straight line', () => {
  const straight = Array.from({ length: 50 }, (_, i) => [40 + i * 1e-4, -80]);
  assert.equal(simplifyLatLon(straight).length, 2);
  const corner = [[40, -80], [40.001, -80], [40.002, -80], [40.002, -79.999], [40.002, -79.998]];
  assert.equal(simplifyLatLon(corner).length, 3);
});
