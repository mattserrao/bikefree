import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StreetKit, FURNITURE } from '../js/world/toolbox/city/street-kit.js';
import { MeshBuilder } from '../js/world/toolbox/core/mesh-builder.js';

// [w2-polish] shop signs: deterministic, and units side by side along a street never repeat a sign
test('shop labels differ between neighbouring units and are deterministic', () => {
  const kit = { shopNear: () => null };
  const label = (f, um, uw) => StreetKit.prototype.shopLabel.call(kit, f, um, uw);
  for (const yaw of [0, .4, 1.3, 2.9, -2]) {
    const tx = Math.sin(yaw), tz = Math.cos(yaw);
    // a row of buildings along one street line: fronts of varied length cut into 5–10 m units
    let u = 0, prev = null, k = 0;
    for (let b = 0; b < 60; b++) {
      const len = 6 + ((b * 37) % 23), n = Math.max(1, Math.round(len / (5 + (b % 4)))), uw = len / n;
      const f = { a: { x: 100 + tx * u + tz * 30, z: -50 + tz * u - tx * 30 }, tx, tz, nx: tz, nz: -tx };
      for (let j = 0; j < n; j++) {
        const l = label(f, j * uw + uw / 2, uw);
        assert.equal(l, label(f, j * uw + uw / 2, uw));
        assert.notEqual(l, prev, `unit ${k} repeats ${l}`);
        prev = l; k++;
      }
      u += len + (b % 3 ? 0 : 2.5);
    }
  }
});

test('a mapped shop gives its kind of sign', () => {
  const f = { a: { x: 0, z: 0 }, tx: 1, tz: 0, nx: 0, nz: -1 };
  const kit = { shopNear: () => ({ cat: 'cafe' }) };
  for (let um = 3; um < 120; um += 6.5) assert.ok(['COFFEE', 'CAFE', 'BAKERY', 'DONUTS', 'TEA'].includes(StreetKit.prototype.shopLabel.call(kit, f, um, 6)));
});

// [w2-polish] parked cars: wheels, cabin and glass, still a few hundred triangles at most (v0.14: the shared car
// kit's lo LOD, life/figures/cars.js — a loft body with arches, so ~450–550)
test('the parked car has wheels, a glass cabin and stays low-poly', () => {
  for (const seed of [.1, .5, .75, .9]) {
    const M = new MeshBuilder();
    FURNITURE.car(M, { x: 0, y: 0, z: 0, yaw: 0, c: 1, s: 0 }, { seed });
    const tris = M.i.length / 3;
    assert.ok(tris > 60 && tris < 600, `car ${seed}: ${tris} triangles`);
    let low = 0; for (let k = 1; k < M.p.length; k += 3) if (M.p[k] < .05) low++;
    assert.ok(low >= 8, 'wheels reach the ground');
    for (let k = 0; k < M.n.length; k += 3) assert.ok(Math.abs(Math.hypot(M.n[k], M.n[k + 1], M.n[k + 2]) - 1) < 1e-3, 'unit normals');
  }
});

// F79: at a sharp corner of the route the sidewalk is dropped on the inside of the turn only (where its slabs
// would fan across the road); the outside keeps its sidewalk
test('route corner: no sidewalk on the inside of a sharp turn, the outside keeps it', () => {
  // the route runs east (+x) to s = 100, then turns 90° to −z; side +1 is the +z (outside) side, −1 the inside
  const frame = (s) => (s < 100 ? { x: s, z: 0, y: 0, tx: 1, tz: 0 } : { x: 100, z: -(s - 100), y: 0, tx: 0, tz: -1 });
  const kit = (clear) => ({
    cfg: { clearRouteCrossings: clear }, route: { scene: {} }, city: {},
    frame, curbAt: () => 4, zoneAt: () => null, sOf: (r) => r.s, crossing: () => false, buildingLine: () => Infinity,
    L: { landAt: () => 0, bridgeAt: () => null, routeDist: () => null },
  });
  const at = (clear, side) => StreetKit.prototype._station.call(kit(clear), { route: true, s: 100, side });
  assert.equal(at(true, -1), null, 'inside of the turn: none');
  assert.ok(at(true, 1), 'outside of the turn: kept');
  assert.ok(at(false, -1) && at(false, 1), 'not opted in: both');
  // a straight stretch keeps both sides
  const straight = (side) => StreetKit.prototype._station.call(kit(true), { route: true, s: 50, side });
  assert.ok(straight(1) && straight(-1));
});
