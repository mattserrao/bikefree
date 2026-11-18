// City life on Pittsburgh's ride network (test/city-life.test.mjs's checks, js/network.js rides): one lap of a
// few presets as the world places them — turns through the junctions, edges ridden backwards, a U-turn at a
// dead end and at the Water Steps. Cross traffic waits at the kerb (F16).
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
    assert.ok(R.seen.person > 50000 && R.seen.vehicle > 10000, `life near the rider: ${JSON.stringify(R.seen)}`);
    assert.equal(R.jumps, 0, `jumps (worst ${R.worstJump.toFixed(2)} m in one step)`);
    assert.equal(R.personInRoad, 0, 'people in the carriageway near the rider');
    assert.equal(R.vehicleInLane, 0, "vehicles in the rider's lane ahead");
    assert.equal(R.vehicleClose, 0, `vehicles within 1.5 m of the rider (closest ${R.closest.toFixed(2)} m)`);
    assert.equal(R.popIn + R.popOut, 0, `spawned ${R.popIn} / despawned ${R.popOut} in view`);
  });
}
