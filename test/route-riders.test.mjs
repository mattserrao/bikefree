// [6.10] Pittsburgh's city life rebalanced, and riders on the route with you (js/world/toolbox/city/life.js): people
// and traffic about half what they were; cyclists on the route's own road, each ~5–20 % faster or slower than you,
// slowing on climbs as you do, so that you pass someone or are passed about once a minute. The ride sims (the life
// harness of test/city-life.test.mjs) count the passes at 20, 25 and 30 km/h on the flat (the GAP trail by Homestead),
// on a climb (Pittsburgh's own line up from the Strip, a steady power), and with a pacer riding beside you.
//   LIFE_SIM_REPORT=1 node --test test/route-riders.test.mjs   prints the counts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { powerRequired } from '../js/physics.js';

process.env.NO_TESTS = '1';   // (the harness only: its own tests run in their file)
const { simulate, steadyPower, makeLife } = await import('./city-life.test.mjs');
const { COUNTS, ROUTE_RIDE } = await import('../js/world/toolbox/city/life.js');
const { LEAN } = await import('../js/world/pose.js');
const DT = .1;   // (the life harness's step: test/city-life.test.mjs)
const report = (name, R) => process.env.LIFE_SIM_REPORT && console.log(name, JSON.stringify({ perMinute: R.perMinute, passes: R.passes, caught: R.caught, passedBy: R.passedBy,
  minutes: +R.minutes.toFixed(1), closest: +R.closestRouteRider.toFixed(2), routeRiderClose: R.routeRiderClose, pacerClose: R.pacerClose, popIn: R.popIn, popOut: R.popOut, jumps: R.jumps }));

test('city life: people and traffic about half of what they were (19 Nov), more cyclists', () => {
  // before 6.10: low 70 people / 40 cars, balanced 160 / 85, high 260 / 140; buses max(4, cars / 12); 4 oncoming cars
  const before = { low: [70, 40, 4], balanced: [160, 85, 7], high: [260, 140, 12] };
  for (const [k, [people, cars, buses]] of Object.entries(before)) {
    const c = COUNTS[k];
    assert.ok(c.people / people >= .45 && c.people / people <= .55, `${k} people ${c.people} (was ${people})`);
    assert.ok(c.cars / cars >= .45 && c.cars / cars <= .55, `${k} cars ${c.cars} (was ${cars})`);
    assert.ok(Math.max(2, Math.round(c.cars / 12)) / buses <= .6, `${k} buses`);
    assert.ok(c.routeRiders >= 5, `${k} riders on the route: ${c.routeRiders}`);
  }
  const life = makeLife();
  assert.equal(life.walkers.length, COUNTS.balanced.people);
  assert.equal(life.carAgents.length, COUNTS.balanced.cars);
  assert.equal(life.busAgents.length, 4);
  assert.equal(life.oncoming.length, 2);
  assert.equal(life.riders.length, COUNTS.balanced.cyclists);   // (the side streets' and trails' cyclists, as before)
  assert.equal(life.routeRiders.length, COUNTS.balanced.routeRiders);
  life.dispose();
});

test('route riders: their speed — a share of yours on your grade, the bike physics on theirs', () => {
  const life = makeLife(), v = 25 / 3.6;
  // on the grade you're on: exactly their share of your speed
  assert.equal(life._paceFor(1.12 * v, 0, 0), 1.12 * v);
  assert.equal(life._paceFor(.88 * v, 5, 5), .88 * v);
  // on a climb ahead of you: slower, as the same power makes it; on a descent: faster
  const up = life._paceFor(1.1 * v, 0, 6), down = life._paceFor(1.1 * v, 0, -4);
  assert.ok(up < v * .6 && up > 1, `6 % climb: ${up}`);
  assert.ok(Math.abs(powerRequired(up, 6) - powerRequired(1.1 * v, 0)) < 2, 'the same power');
  assert.ok(down > 1.1 * v, `4 % descent: ${down}`);
  // you on a climb, it on the flat behind you: much faster (it catches you on the hill)
  assert.ok(life._paceFor(1.1 * 3, 6, 0) > 3 * 2, 'flat behind a climbing rider');
  // coasting down a hill you'd still pedal on the flat: never a stop on the flat beyond
  assert.ok(life._paceFor(12, -6, 0) > 5);
  // the shares: 5–20 % either way
  assert.ok(ROUTE_RIDE.slower[0] >= .05 && ROUTE_RIDE.slower[1] <= .2 && ROUTE_RIDE.faster[0] >= .05 && ROUTE_RIDE.faster[1] <= .2);
  life.dispose();
});

/** The pass checks every ride shares: ~1 a minute, both ways, nothing clipping you or the pacer, no pop-in. */
function ridePasses(name, R, { lo = .7, hi = 1.5 } = {}) {
  report(name, R);
  assert.ok(R.minutes > 8, `ridden ${R.minutes} min`);
  assert.ok(R.perMinute >= lo && R.perMinute <= hi, `${name}: ${R.perMinute} passes a minute (${R.passes} in ${R.minutes.toFixed(1)} min)`);
  assert.ok(R.caught > 0 && R.passedBy > 0, `both ways: you caught ${R.caught}, passed by ${R.passedBy}`);
  assert.equal(R.routeRiderClose, 0, `riders within .25 m of you (closest ${R.closestRouteRider.toFixed(2)} m)`);
  assert.equal(R.pacerClose, 0, 'riders within .25 m of the pacer');
  assert.equal(R.popIn + R.popOut, 0, `appeared ${R.popIn} / vanished ${R.popOut} in view`);
  assert.equal(R.jumps, 0, `jumps (worst ${R.worstJump.toFixed(2)} m in one step)`);
  assert.equal(R.vehicleClose + R.vehicleInLane + R.personInRoad, 0, 'the rest of the life as before');
}

// the GAP trail by Homestead (1.5–8.5 km: flat, the river beside it), at a steady speed
for (const kph of [20, 25, 30]) {
  test(`route riders at ${kph} km/h on the flat: a pass about once a minute, both ways`, () => {
    ridePasses(`flat ${kph} km/h`, simulate(false, { area: 'pittsburgh-homestead', span: [1500, 8500], speed: kph / 3.6 }));
  });
}

test('route riders with a pacer riding beside you: kept clear of it too', () => {
  ridePasses('flat 25 km/h + pacer', simulate(false, { area: 'pittsburgh-homestead', span: [1500, 8500], speed: 25 / 3.6, pacer: true }));
});

// a climb: Pittsburgh's own line 12.3–14.6 km (about 2 km at 4–7 %, ~11 % at its steepest),
// holding the power that makes 30 km/h on the flat — the speed falls to a crawl on the steep parts and they slow too
// [7.5] …and they lean into the road's bends as you do: into the turn (− left, + right), within the cap, eased
test('route riders on a climb (a steady power): still passes, both ways, slowing as you do; they lean into the bends', () => {
  const cap = LEAN.maxDeg * Math.PI / 180, prev = new Map();
  let n = 0, agree = 0, against = 0, most = 0, worstStep = 0;
  const watch = (life) => {
    for (const a of life.routeRiders) {
      if (!a.alive) { prev.delete(a); continue; }
      assert.ok(Number.isFinite(a.lean) && Math.abs(a.lean) <= cap + 1e-9, `lean ${a.lean}`);
      most = Math.max(most, Math.abs(a.lean));
      const q = prev.get(a);
      if (q) {
        worstStep = Math.max(worstStep, Math.abs(a.lean - q.lean));
        let d = a.yaw - q.yaw; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
        // a steady bend (turning > 0.15 rad/s for a while: the lean has caught up): leaning into it
        if (a.v > 2 && Math.abs(d) / DT > .15 && Math.sign(d) === q.sign && ++q.run > 5) { n++; if (Math.sign(a.lean) === -Math.sign(d)) agree++; else against++; }
        else if (Math.sign(d) !== q.sign) q.run = 0;
        Object.assign(q, { yaw: a.yaw, lean: a.lean, sign: Math.sign(d) });
      } else prev.set(a, { yaw: a.yaw, lean: a.lean, sign: 0, run: 0 });
    }
  };
  ridePasses('climb, 30 km/h power', simulate(false, { area: 'pittsburgh', span: [12300, 14600], speed: 30 / 3.6, speedAt: steadyPower(30), watch }), { lo: .6 });
  if (process.env.LIFE_SIM_REPORT) console.log('route rider lean', { most: most * 180 / Math.PI, worstStep: worstStep * 180 / Math.PI, n, agree, against });
  assert.ok(most > 3 * Math.PI / 180, `they lean in the bends: most ${most * 180 / Math.PI}°`);
  assert.ok(n > 20 && agree / n > .95, `into the turn: ${agree} of ${n}`);
  assert.ok(worstStep < 2 * Math.PI / 180, `no snaps: ${worstStep * 180 / Math.PI}° in a step`);
});
