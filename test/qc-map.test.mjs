// The map QC (tools/qc_map.mjs + tools/qc-map.js, user 25 Nov: "standardize the QC tools in the project so they can be
// deployed on various maps"): its sites for any graph map, its report, and the in-page checks' module shape. (The
// checks themselves need the built world in the browser: npm run qc:map -- <map>.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sitesOf, report, KEYS } from '../tools/qc_map.mjs';

test('qc_map: NYC has its review sites; any other graph map gets sites spread over its ways and landmarks', async () => {
  const nyc = await sitesOf('nyc');
  assert.equal(Object.keys(nyc).length, 12);
  assert.ok(nyc.bethesda.includes('#'), 'a free camera on Bethesda');
  for (const map of JSON.parse(readFileSync(new URL('../routes/cities/graph-cities.json', import.meta.url), 'utf8')).map((c) => c.id)) {
    const s = await sitesOf(map, { auto: 4 });
    const ways = Object.keys(s).filter((k) => k.startsWith('way'));
    assert.equal(ways.length, 4, map);
    for (const v of Object.values(s)) assert.match(v, /^-?\d+\.\d+,-?\d+\.\d+/, `${map}: ${v}`);
  }
});

test('qc_map: the report shows before→after per site and the totals', () => {
  const base = { a: { counts: { floating: 3, pathPaint: 2 } } }, res = { a: { counts: { floating: 0, pathPaint: 2 }, examples: { floating: [[40.7, -73.9, 'x']] } } };
  const r = report(res, base);
  assert.match(r, /3→0/);
  assert.match(r, /total/);
  assert.ok(KEYS.includes('bankCliff') && KEYS.includes('joinGap'));
});

test('qc-map.js: the in-page checks load as a module and every check is listed in the runner', async () => {
  const src = readFileSync(new URL('../tools/qc-map.js', import.meta.url), 'utf8');
  const m = await import('../tools/qc-map.js');
  assert.equal(typeof m.runMapQC, 'function');
  for (const k of KEYS.filter((k) => !['trees', 'alleeTrees', 'gritEdges'].includes(k))) assert.ok(src.includes(`'${k}'`), k);
});
