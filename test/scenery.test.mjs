import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalogRoute, headingSpan, loadRouteScene } from '../js/routes.js';
import { parseTerrainGrid } from '../js/terrain-grid.js';
import { gunzipSync } from 'node:zlib';
import { routeAt, haversine } from '../js/gpx.js';
import { makeProjection, makeRouteIndex } from '../js/world/geo.js';
import { makeRealCoastLandscape } from '../js/world/toolbox/landscape/real-terrain.js';
import { roadFrame, fitBridgeToRoad } from '../js/world/toolbox/roadside/details.js';
import * as THREE from '../vendor/three.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const catalog = JSON.parse(read('routes/catalog.json'));
const item = catalog.find((r) => r.id === 'bigsur');
const route = buildCatalogRoute(read(item.file), item);
const proj = makeProjection(36.38, -121.87);
const index = makeRouteIndex(route, proj);
const scene = JSON.parse(read(item.scene));
scene.terrainGrid = parseTerrainGrid(gunzipSync(readFileSync(new URL(`../${scene.terrainGridFile}`, import.meta.url))));
const coast = makeRealCoastLandscape(scene, proj, index, route);
const bixby = { ...coast.bridges.find((b) => /Bixby/.test(b.name)), span: 218 };

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

test('real coast stays below the road, opens the Bixby gorge and puts the sea below sea level', () => {
  for (let i = 0; i <= route.turnIdx; i += 8) {
    const x = index.xs[i], z = index.zs[i];
    const height = coast.heightAt(x, z);
    assert.ok(Number.isFinite(height), `finite terrain at ${i}`);
    assert.ok(height < route.ele[i] - .1, `road clearance at ${i}`);
  }
  assert.ok(bixby.depth > 60 && bixby.depth < 95, `Bixby gorge is about 80 m deep (${bixby.depth.toFixed(0)} m)`);
  assert.ok(coast.heightAt(bixby.x, bixby.z) < bixby.y - 40);
  // 1 km out to sea from the bridge (west) is ocean
  assert.ok(coast.heightAt(bixby.x - 1000, bixby.z) < 0, 'ocean floor lies below the sea');
  assert.ok(coast.inlandAt(bixby.x - 1000, bixby.z) < -300, 'shore distance is negative at sea');
  assert.ok(coast.inlandAt(bixby.x + 800, bixby.z) > 300, 'and positive inland');
  for (const creek of coast.creeks) for (let t = creek.start + 25; t < creek.mouth - 10; t += 25) {
    const p = creek.positionAt(t);
    assert.ok(coast.creekAt(p.x, p.z), `${creek.name} at ${t}`);
    assert.ok(coast.heightAt(p.x, p.z) < creek.waterAt(t) - .1, `${creek.name}: water stays above its carved bed`);
    assert.ok(creek.waterAt(t + 25) <= creek.waterAt(t) + 1e-6, `${creek.name}: water only flows downhill`);
  }
  assert.ok(coast.creeks.some((c) => /Bixby/.test(c.name) && c.mouth > 40), 'Bixby Creek reaches the sea');
});

test('scene fetch failure is explicit rather than silently accepting bad scenery', async () => {
  await assert.rejects(() => loadRouteScene({ sceneUrl: item.scene }, async () => ({ ok: false, status: 503 })), /503/);
  await assert.rejects(() => loadRouteScene({ sceneUrl: item.scene }, async () => ({ ok: true, json: async () => ({ format: 'wrong' }) })), /Unsupported/);
});

test('Blender assets have complete vertex streams and the bridge has full-span railings', () => {
  const kit = JSON.parse(read(scene.assets));
  for (const [name, asset] of Object.entries({ ...kit.assets, ...JSON.parse(read('models/scenery/regional.json')).assets })) {
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

test('bridge model follows the curved GPX and preserves deck-to-road clearance', () => {
  const kit = JSON.parse(read(scene.assets)), source = kit.assets.bridge;
  const packed = Buffer.from(source.position, 'base64');
  const position = new Float32Array(packed.length / 2);
  for (let i = 0; i < position.length; i++) position[i] = packed.readInt16LE(i * 2) / kit.positionScale;
  const original = new THREE.BufferGeometry();
  original.setAttribute('position', new THREE.BufferAttribute(position, 3));
  const landmark = { ...bixby, depth: 65 }, fitted = fitBridgeToRoad(original, route, index, landmark);
  const vertices = fitted.attributes.position;
  for (let i = 0; i < vertices.count; i += 19) {
    const x = position[i * 3], y = position[i * 3 + 1], z = position[i * 3 + 2];
    const s = landmark.s + z, a = routeAt(route, s);
    const start = routeAt(route, Math.floor(s / 10) * 10), end = routeAt(route, Math.floor(s / 10) * 10 + 10);
    const pa = proj.toLocal(a.lat, a.lon), p0 = proj.toLocal(start.lat, start.lon), p1 = proj.toLocal(end.lat, end.lon);
    const len = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    const expectedX = pa.x + (p1.z - p0.z) / len * x;
    const expectedZ = pa.z - (p1.x - p0.x) / len * x;
    assert.ok(Math.hypot(vertices.getX(i) - expectedX, vertices.getZ(i) - expectedZ) < .15);
    assert.ok(Math.abs(vertices.getY(i) - a.ele - y) < .001);
  }
  original.dispose(); fitted.dispose();
});

test('tree detail levels preserve the silhouette height while distant geometry is cheaper', () => {
  const kit = JSON.parse(read(scene.assets));
  const peak = (part) => {
    const data = Buffer.from(part.position, 'base64'); let max = -Infinity;
    for (let i = 2; i < data.length; i += 6) max = Math.max(max, data.readInt16LE(i) / kit.positionScale);
    return max;
  };
  for (const name of ['cypress0', 'cypress1', 'cypress2', 'pine0', 'pine1']) {
    assert.ok(kit.assets[`${name}-lod`].triangles < kit.assets[name].triangles, name);
    assert.ok(Math.abs(peak(kit.assets[`${name}-lod`]) - peak(kit.assets[name])) < .9, name);
  }
  for (const sign of scene.signs) {
    const frame = roadFrame(route, index, sign.atM, sign.side === 'inland' ? -5.7 : 5.7);
    assert.ok(Number.isFinite(frame.position.y));
    assert.ok(Math.abs(frame.forward.dot(frame.right)) < 1e-9);
  }
});
