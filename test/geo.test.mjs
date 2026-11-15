import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  lonToTileX, latToTileY, tileXToLon, tileYToLat, makeProjection, terrarium, tileSizeM, makeRouteIndex,
} from '../js/world/geo.js';
import { parseGpx, buildRoute, haversine } from '../js/gpx.js';

test('tile math round-trips', () => {
  const z = 15, lat = 43.7413, lon = -110.8024;
  assert.ok(Math.abs(tileXToLon(lonToTileX(lon, z), z) - lon) < 1e-9);
  assert.ok(Math.abs(tileYToLat(latToTileY(lat, z), z) - lat) < 1e-9);
  assert.equal(Math.floor(lonToTileX(0, 1)), 1);
  assert.ok(Math.abs(tileSizeM(15, 0) - 1222.99) < 0.1);
});

test('local projection is metric and invertible', () => {
  const p = makeProjection(43.75, -110.65);
  const a = { lat: 43.80, lon: -110.70 }, b = { lat: 43.70, lon: -110.60 };
  const la = p.toLocal(a.lat, a.lon), lb = p.toLocal(b.lat, b.lon);
  const d = Math.hypot(la.x - lb.x, la.z - lb.z);
  const h = haversine(a, b);
  assert.ok(Math.abs(d - h) / h < 0.005, `${d} vs ${h}`);
  assert.ok(la.z < 0, 'north is −z');
  const back = p.toLatLon(la.x, la.z);
  assert.ok(Math.abs(back.lat - a.lat) < 1e-9 && Math.abs(back.lon - a.lon) < 1e-9);
});

test('terrarium decode', () => {
  assert.equal(terrarium(128, 0, 0), 0);
  assert.equal(terrarium(135, 208, 0), 2000);
});

test('route index finds the road', () => {
  const r = buildRoute(parseGpx(readFileSync(new URL('../routes/parks/teton.gpx', import.meta.url), 'utf8')));
  const p = makeProjection(43.75, -110.65);
  const idx = makeRouteIndex(r, p);
  const on = p.toLocal(r.lat[500], r.lon[500]);
  const hit = idx.nearest(on.x + 3, on.z, 40);
  assert.ok(hit && hit.d < 10);
  assert.equal(idx.nearest(on.x + 5000, on.z + 5000, 40), null);
});
