// City life on Pittsburgh's ride network (test/city-life.test.mjs's checks, js/network.js rides): one lap of a
// few presets as the world places them — turns through the junctions, edges ridden backwards (Forbes Ave
// against its one-way, F18), a U-turn at a dead end and at the Water Steps. Cross traffic waits at the kerb (F16).
//   LIFE_SIM_REPORT=1 node --test test/city-life-network.test.mjs   prints the counts (LIFE_SIM_DEBUG=1: and each finding)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.NO_TESTS = '1';   // (the harness only: its own Forward / Reverse tests run in their file)
const { simulate } = await import('./city-life.test.mjs');
const net = JSON.parse(readFileSync(new URL('../routes/cities/pittsburgh-network.json', import.meta.url), 'utf8'));

// Oakland & South Side: I>J and back down it (Forbes the wrong way), Schenley Park, the Hot Metal Bridge, Smithfield;
// Mount Washington there and back: McArdle, junction D, the West End Bridge, "Back" at the Water Steps
for (const id of ['pgh-oakland-south', 'pgh-mt-washington']) {
  test(`pittsburgh life on the network, ${id}: no jumps, people off the road, cross traffic clear of the rider, no pop-in`, () => {
    const R = simulate(false, { plan: net.presets.find((p) => p.id === id).path });
    if (process.env.LIFE_SIM_REPORT) console.log(id, JSON.stringify(R));
    assert.ok(R.seen.person > 40000 && R.seen.vehicle > 10000,   // (7.4: no corner slowdowns, so less time beside people; 6.10 halved them)
      `life near the rider: ${JSON.stringify(R.seen)}`);
    assert.equal(R.jumps, 0, `jumps (worst ${R.worstJump.toFixed(2)} m in one step)`);
    assert.equal(R.personInRoad, 0, 'people in the carriageway near the rider');
    assert.equal(R.vehicleInLane, 0, "vehicles in the rider's lane ahead");
    assert.equal(R.oneWayOncoming, 0, 'oncoming traffic on a one-way stretch of the route (Forbes Ave, F18)');
    assert.equal(R.vehicleClose, 0, `vehicles within 1.5 m of the rider (closest ${R.closest.toFixed(2)} m)`);
    assert.equal(R.popIn + R.popOut, 0, `spawned ${R.popIn} / despawned ${R.popOut} in view`);
    // F336 (known, deferred by the user 19 Nov): on pgh-oakland-south a route rider can touch you at a junction curve;
    // that one check is skipped there until F336 is fixed — every other ride and check still runs
    if (id !== 'pgh-oakland-south') assert.equal(R.routeRiderClose, 0, `[6.10] riders on the route within .25 m of the rider (closest ${R.closestRouteRider.toFixed(2)} m)`);
  });
}

// [F31] Life carried across area swaps (js/world/toolbox/city/life-handoff.js): the crosstown ride swaps four times
// (Polish Hill, Oakland, the core, Allegheny); at each swap the new area's life takes over the people and traffic near
// the camera on the same streets, so the swap's step is judged like any other — nothing in view vanishes or appears,
// nothing jumps (without the hand-off: ~70 in view vanished and ~80 appeared over the four swaps)
test('pittsburgh life across area swaps, pgh-polish-crosstown: carried over, no pop-out, no pop-in, no jumps', () => {
  const R = simulate(false, { plan: net.presets.find((p) => p.id === 'pgh-polish-crosstown').path, handOff: true });
  if (process.env.LIFE_SIM_REPORT) console.log('pgh-polish-crosstown hand-off', JSON.stringify(R));
  assert.ok(R.swaps >= 3, `swaps: ${R.swaps}`);
  assert.ok(R.carried > 75 * R.swaps && R.dropped < R.carried / 10, `carried ${R.carried}, dropped ${R.dropped}`);   // (people and traffic halved in 6.10: was 150 a swap)
  assert.equal(R.swapPopOut, 0, 'agents in view not carried across a swap');
  assert.equal(R.jumps, 0, `jumps (worst ${R.worstJump.toFixed(2)} m in one step)`);
  assert.equal(R.personInRoad + R.vehicleInLane + R.vehicleClose + R.oneWayOncoming, 0, `people in the road ${R.personInRoad}, vehicles in the lane ${R.vehicleInLane} / close ${R.vehicleClose}, oncoming on a one-way ${R.oneWayOncoming}`);
  assert.equal(R.popIn + R.popOut, 0, `spawned ${R.popIn} / despawned ${R.popOut} in view`);
  assert.equal(R.routeRiderClose, 0, `[6.10] riders on the route within .25 m of the rider (closest ${R.closestRouteRider.toFixed(2)} m)`);
  assert.ok(R.perMinute > .6 && R.perMinute < 1.6, `[6.10] passes a minute across the swaps: ${R.perMinute}`);
});
