// Trains in the city life (js/world/toolbox/city/life.js): a rail line in a shallow cut under the route's road.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CityLife } from '../js/world/toolbox/city/life.js';
import { makePath } from '../js/world/toolbox/core/mesh-builder.js';

// F59: the route runs north–south along x = 0 at 10 m; a railway crosses it east–west at railY
const under = (railY) => {
  const self = { city: { landscape: { routeDist: (x, z) => ({ d: Math.abs(x), y: 10, i: 0 }) } } };
  const pts = []; for (let x = -200; x <= 200; x += 10) pts.push({ x, y: railY, z: 0 });
  return CityLife.prototype._underpasses.call(self, { path: makePath(pts), gap: 18 });
};

test('a train is not drawn where its line runs a few metres under the route\'s road (a filled cut, F59)', () => {
  const u = under(7);   // 3 m under the deck: a car (4 m tall) would stand through the road
  assert.equal(u.length, 1);
  assert.ok(u[0].s0 < 200 - 4 && u[0].s1 > 200 + 4, JSON.stringify(u));   // around the crossing, a car's half-length either side
  assert.ok(u[0].s1 - u[0].s0 < 40);
  assert.deepEqual(under(10), []);   // at the road's level: a level crossing (held for the rider, drawn)
  assert.deepEqual(under(2), []);    // 8 m under: room for the train
});
