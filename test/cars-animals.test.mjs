// The shared parked-car kit (js/world/toolbox/life/figures/cars.js) and the farm animals (animals.js): triangle
// budgets by LOD, wheels on the ground, every vertex tagged, deterministic picks; no moving traffic anywhere.
import test from 'node:test';
import assert from 'node:assert';
import { CAR_KINDS, carGeometry, carStats, pickCar, ParkedCars, staticCar } from '../js/world/toolbox/life/figures/cars.js';
import { ANIMALS, animalGeometry, animalStats, Herds } from '../js/world/toolbox/life/figures/animals.js';
import { MOVING_TRAFFIC } from '../js/world/toolbox/city/life.js';

test('parked cars: every kind in its triangle budget, LODs in order', () => {
  const hi = carStats('hi'), lo = carStats('lo'), far = carStats('far');
  for (const k of CAR_KINDS) {
    assert.ok(hi[k] <= 1600, `${k} hi ${hi[k]}`);   // (1500 → 1600, 26 Nov: 18-sided wheels up close)
    assert.ok(lo[k] <= 700, `${k} lo ${lo[k]}`);
    assert.ok(far[k] <= 130, `${k} far ${far[k]}`);
    assert.ok(far[k] < lo[k] && lo[k] < hi[k], `${k}: LODs in order`);
  }
});

test('parked cars: wheels on the ground, sensible size, parts tagged, unit normals', () => {
  for (const k of CAR_KINDS) for (const lod of ['hi', 'lo', 'far']) {
    const g = carGeometry(k, lod), P = g.attributes.position, N = g.attributes.normal, A = g.attributes.aCar;
    g.computeBoundingBox();
    const b = g.boundingBox;
    assert.ok(Math.abs(b.min.y) < 0.02, `${k} ${lod}: on the ground (${b.min.y})`);
    assert.ok(b.max.y > 1.2 && b.max.y < 2.4, `${k} ${lod}: height ${b.max.y}`);
    assert.ok(b.max.z - b.min.z > 3.8 && b.max.z - b.min.z < 5.9, `${k} ${lod}: length`);
    assert.strictEqual(A.count, P.count);
    for (let i = 0; i < N.count; i++) assert.ok(Math.abs(Math.hypot(N.getX(i), N.getY(i), N.getZ(i)) - 1) < 1e-3, `${k} ${lod}: unit normals`);
    let paint = 0, glass = 0; for (let i = 0; i < A.count; i++) { if (A.getX(i) === 0) paint++; if (A.getX(i) === 2) glass++; }
    assert.ok(paint > 0 && glass > 0, `${k} ${lod}: paint and glass`);
  }
  assert.ok(carGeometry('suv', 'hi', { rack: true }).index.count > carGeometry('suv', 'hi').index.count, 'a roof rack adds to the car');
  assert.ok(carGeometry('farmtruck', 'hi').attributes.aCar.getY(0) === 2, 'the farm truck is the worn class');
});

test('parked cars: picks are deterministic and fit the place', () => {
  const seeded = (h) => { let x = Math.floor(h * 2147483646) + 1; return () => ((x = (x * 16807) % 2147483647) / 2147483647); };
  assert.deepStrictEqual(pickCar(seeded(.3), 'rural', 'farm'), pickCar(seeded(.3), 'rural', 'farm'));
  const farm = Array.from({ length: 200 }, (_, i) => pickCar(seeded(i / 200), 'rural', 'farm').kind);
  assert.ok(farm.filter((k) => k === 'farmtruck' || k === 'pickup').length > 120, 'farms: mostly trucks');
  const city = Array.from({ length: 200 }, (_, i) => pickCar(seeded(i / 200), 'city', 'street').kind);
  assert.ok(!city.includes('farmtruck'), 'no farm trucks in the city');
  const P = new ParkedCars();
  for (let i = 0; i < 30; i++) P.add(i * 6, 0, 0, 0, pickCar(seeded(i / 30), 'city', 'lot'));
  const ms = P.meshes({}, 'lo');
  assert.strictEqual(ms.reduce((a, m) => a + m.count, 0), 30);
  assert.ok(ms.every((m) => m.userData.shared && m.instanceColor), 'shared kit geometry, paint per instance');
  assert.ok(staticCar('sedan', '#ff0000', 'lo').attributes.color.count === carGeometry('sedan', 'lo').attributes.position.count);
});

test('farm animals: budgets, standing on the ground, animation parts', () => {
  const s = animalStats();
  for (const [k, n] of Object.entries(s)) assert.ok(n <= 650, `${k}: ${n}`);
  for (const k of Object.keys(ANIMALS)) {
    const g = animalGeometry(k), A = g.attributes.aAnim, P = g.attributes.position;
    g.computeBoundingBox();
    if (!ANIMALS[k].swim) assert.ok(g.boundingBox.min.y >= -0.01, `${k}: not under the ground`);   // (swimmers sit in the water)
    const parts = new Set(); for (let i = 0; i < A.count; i++) parts.add(A.getX(i) % 10);
    assert.ok(parts.has(1), `${k}: a head that moves`);
    if (!ANIMALS[k].swim && k !== 'cat') assert.ok(parts.has(3) || parts.has(4), `${k}: legs`);
    assert.strictEqual(A.count, P.count);
  }
  const H = new Herds(); H.add('holstein', 0, 0, 0, 0, { walk: true, radius: 5, phase: .3 }); H.add('sheep', 5, 0, 0, 1);
  const ms = H.meshes(new Map(), { value: 0 });
  assert.strictEqual(ms.length, 2);
  assert.ok(ms.every((m) => m.customDepthMaterial), 'their shadows animate too');
});

test('no moving traffic: the city life drives no cars or buses', () => {
  assert.strictEqual(MOVING_TRAFFIC, false);
});
