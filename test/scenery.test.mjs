import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalogRoute, headingSpan, loadRouteScene } from '../js/routes.js';
import { routeAt, haversine } from '../js/gpx.js';
import { makeProjection, makeRouteIndex } from '../js/world/geo.js';
import { makeCoastLandscape } from '../js/world/coast.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const catalog = JSON.parse(read('routes/catalog.json'));
const item = catalog.find((r) => r.id === 'bigsur');
const route = buildCatalogRoute(read(item.file), item);
const proj = makeProjection(36.38, -121.87);
const index = makeRouteIndex(route, proj);
const scene = JSON.parse(read(item.scene));
const coast = makeCoastLandscape(scene, proj, index, route);

test('shared catalog loader carries scene and turnaround metadata', () => {
  assert.equal(route.name, 'Big Sur · Bixby Bridge & Hurricane Point');
  assert.equal(route.outAndBack, true);
  assert.equal(route.sceneUrl, 'routes/scenes/bigsur.json');
  assert.ok(Math.abs(route.turnS - route.total / 2) < 10);
});

test('heading stays on its own leg at start, turnaround and lap seam', () => {
  for (const s of [0, 1, route.turnS - 1, route.turnS, route.turnS + 1, route.total - 1, route.total, route.total + 1]) {
    const [a, b] = headingSpan(route, s);
    assert.ok(b > a, `heading has non-zero length at ${s}`);
    assert.ok(haversine(routeAt(route, a), routeAt(route, b)) > .4, `heading is not cancelled by overlapping legs at ${s}`);
    assert.ok(b <= route.turnS || a >= route.turnS);
  }
});

test('authored coast stays below the road and leaves the bridge canyon open', () => {
  for (let i = 0; i <= route.turnIdx; i += 8) {
    const x = index.xs[i], z = index.zs[i];
    const height = coast.heightAt(x, z);
    assert.ok(Number.isFinite(height), `finite terrain at ${i}`);
    assert.ok(height < route.ele[i] - .1, `road clearance at ${i}`);
  }
  const bridge = coast.landmarks[0];
  assert.ok(coast.heightAt(bridge.x, bridge.z) < bridge.y - 40);
  assert.ok(coast.heightAt(coast.coastX(bridge.z) - 100, bridge.z) < 0, 'ocean floor lies below the sea');
});

test('scene fetch failure is explicit rather than silently accepting bad scenery', async () => {
  await assert.rejects(() => loadRouteScene({ sceneUrl: item.scene }, async () => ({ ok: false, status: 503 })), /503/);
  await assert.rejects(() => loadRouteScene({ sceneUrl: item.scene }, async () => ({ ok: true, json: async () => ({ format: 'wrong' }) })), /Unsupported/);
});

test('Blender assets have complete vertex streams and the bridge has full-span railings', () => {
  const kit = JSON.parse(read(scene.assets));
  for (const [name, asset] of Object.entries(kit.assets)) {
    const positions = Buffer.from(asset.position, 'base64');
    assert.equal(positions.length, asset.triangles * 9 * 2, name);
    assert.equal(Buffer.from(asset.normal, 'base64').length, positions.length / 2, name);
    assert.equal(Buffer.from(asset.color, 'base64').length, positions.length / 2, name);
  }
  const p = Buffer.from(kit.assets.bridge.position, 'base64');
  let low = Infinity, high = -Infinity;
  for (let i = 4; i < p.length; i += 6) { const z = p.readInt16LE(i) / kit.positionScale; low = Math.min(low, z); high = Math.max(high, z); }
  assert.ok(high - low >= 218, 'bridge and railings cover the crossing');
});
