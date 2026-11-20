// [audit-A] City street profiles (js/world/toolbox/city/landscape.js: fairStreetProfilesJob): near the route, a major
// street's ribbon has no hump, dip or step between points — tools/qc_map.mjs `bump` and `height-step`, on one area.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalogRoute } from '../js/routes.js';
import { makeProjection, makeRouteIndex } from '../js/world/geo.js';
import { landscapeBuilder } from '../js/world/toolbox/landscape/index.js';
import { cityStreets } from '../js/world/toolbox/city/landscape.js';
import { loadSceneSync } from '../tools/qc_course.mjs';
import { MAP_LIMITS as M } from '../tools/qc_map.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const len = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);
const NEAR = 300;   // m from the area's route
// (pittsburgh-polish before the fairing: 8 bumps within 300 m of the route)
const BUDGET = { 'pittsburgh-polish': { bump: 2, step: 0 } };

for (const [id, budget] of Object.entries(BUDGET)) {
  test(`${id}: street ribbons near the route have no humps, dips or height steps`, () => {
    const item = JSON.parse(read('routes/parks/index.json')).find((it) => it.id === id);
    let scene = loadSceneSync(item.scene);
    scene = { ...scene, city: JSON.parse(read(scene.cityData)) };
    const route = buildCatalogRoute(read(item.file), item); route.scene = scene;
    const proj = makeProjection(scene.origin.lat, scene.origin.lon), index = makeRouteIndex(route, proj);
    const streets = cityStreets(landscapeBuilder(scene)(scene, proj, index, route), index, route);
    const bumps = [], steps = [];
    for (const st of streets) {
      const P = st.pts;
      for (let i = 1; i < P.length - 1; i++) {
        const a = P[i - 1], b = P[i], c = P[i + 1];
        if (!index.nearest(b.x, b.z, NEAR)) continue;
        if (st.cls <= 4 && len(a, b) <= 25 && len(b, c) <= 25 && len(a, b) > 2 && len(b, c) > 2 && b.jn == null) {
          const off = b.y - (a.y + (c.y - a.y) * len(a, b) / (len(a, b) + len(b, c)));
          if (Math.abs(off) > M.bump) bumps.push(`${b.x.toFixed(0)},${b.z.toFixed(0)} ${off.toFixed(2)} m`);
        }
        if (!st.bridge && len(a, b) >= M.stepSeg && Math.abs(b.y - a.y) / len(a, b) > M.step) steps.push(`${b.x.toFixed(0)},${b.z.toFixed(0)}`);
      }
    }
    assert.ok(bumps.length <= budget.bump, `${bumps.length} bumps within ${NEAR} m of the route (budget ${budget.bump}): ${bumps.slice(0, 8).join('; ')}`);
    assert.ok(steps.length <= budget.step, `${steps.length} height steps within ${NEAR} m of the route (budget ${budget.step}): ${steps.slice(0, 8).join('; ')}`);
  });
}
