import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planRouteTiles, tileKeysToUrls } from '../js/offline.js';
import { parseGpx, buildRoute } from '../js/gpx.js';

const catalog = JSON.parse(readFileSync(new URL('../routes/catalog.json', import.meta.url), 'utf8'));
for (const { id: park, file, scene } of catalog) {
  // a wireframe placeholder downloads elevation only
  const wire = scene && JSON.parse(readFileSync(new URL(`../${scene}`, import.meta.url), 'utf8')).style === 'wireframe';
  test(`offline plan for ${park} covers the route at full detail`, () => {
    const r = buildRoute(parseGpx(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')));
    const keys = planRouteTiles(r);
    const z15 = keys.filter((k) => k.startsWith('15/'));
    const urls = tileKeysToUrls(keys, { imagery: !wire });
    assert.ok(z15.length > 20, `${park}: ${z15.length} z15 tiles`);
    // about 6,000 files for a 100 km route; long Tour stages scale with their length
    assert.ok(urls.length < 6000 * Math.max(1, r.total / 100000), `${park}: ${urls.length} urls`);
    assert.equal(new Set(urls).size, urls.length);
    console.log(`  ${park}: ${keys.length} tiles (${z15.length} detailed), ${urls.length} files`);
  });
}
