import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalogRoute } from '../js/routes.js';
import { makeProjection, makeRouteIndex } from '../js/world/geo.js';
import { makeRegionalLandscape } from '../js/world/toolbox/landscape/authored-region.js';
import { loadSceneSync } from '../tools/qc_course.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const catalog = JSON.parse(read('routes/catalog.json'));
for (const item of catalog.filter((r) => r.id !== 'bigsur')) {
  test(`${item.id}: regional terrain, water and bridges keep the actual GPX rideable`, () => {
    const route = buildCatalogRoute(read(item.file), item), config = loadSceneSync(item.scene);
    const proj = makeProjection((Math.min(...route.lat) + Math.max(...route.lat)) / 2, (Math.min(...route.lon) + Math.max(...route.lon)) / 2);
    const index = makeRouteIndex(route, proj), landscape = makeRegionalLandscape(config, proj, index, route);
    for (let i = 0; i < (route.turnIdx || route.dist.length - 1); i += 12) {
      const x = index.xs[i], z = index.zs[i], h = landscape.heightAt(x, z);
      assert.ok(Number.isFinite(h), `${item.id} @${i}: finite terrain`);
      assert.ok(h < route.ele[i] - .1, `${item.id} @${i}: terrain ${h} vs road ${route.ele[i]}`);
      assert.ok(landscape.waterLevelAt(x, z) < route.ele[i], `${item.id} @${i}: water above road`);
    }
    for (const bridge of landscape.landmarks) assert.ok(Number.isFinite(bridge.fx) && bridge.span > 0 && Number.isFinite(bridge.y));
  });
}
