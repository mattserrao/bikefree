// Hill feel, up and down (PLAN 6.11): the real Session with a fake trainer (tools/ride_feel_trace.mjs) — a rider at a
// steady cadence in one gear, the trainer holding the ERG target — through a hill's start, a crest and a descent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRide } from '../tools/ride_feel_trace.mjs';
import {
  GEAR_RATIOS, WHEEL_CIRC, ergTargetForBike, descentFloorW, speedFromCadence, PEDAL_FLOOR_MIN_W, GRADE_RATE_PCT_S,
} from '../js/physics.js';

const TICK = 0.25;

/** A rider at `kph` in `gear` (cadence to match), settled on the flat; then `grade` for `sec` s. Rows per tick. */
async function hill({ kph = 25, gear = 12, grade = 6, sec = 60, settings = {}, settleS = 90 } = {}) {
  const ride = await makeRide({ gear, settings });
  ride.cadence = (kph / 3.6) / (GEAR_RATIOS[gear - 1] * WHEEL_CIRC) * 60;
  ride.settle(settleS);
  const w0 = ride.session.target.value;
  ride.session.setGrade(grade);
  const rows = [];
  for (let i = 0; i < sec / TICK; i++) {
    ride.tick();
    rows.push({ t: (i + 1) * TICK, w: ride.session.target.value, felt: ride.session.trainerGrade, v: ride.session.speedMps, sent: ride.trainer.erg ?? ride.trainer.sim });
  }
  return { ride, w0, rows };
}
const timeTo = (rows, w0, frac) => { const w1 = rows.at(-1).w; return rows.find((r) => r.w >= w0 + frac * (w1 - w0))?.t ?? Infinity; };

test('a 6 % hill entered at 25 km/h comes to 90 % of its resistance in ~10 s, gently at first', async () => {
  const { w0, rows } = await hill({ kph: 25 });
  const t90 = timeTo(rows, w0, 0.9);
  assert.ok(t90 >= 8.5 && t90 <= 12, `t90 ${t90} s`);
  const rise = rows.at(-1).w - w0;
  const at2 = rows.find((r) => r.t === 2).w;
  assert.ok(at2 - w0 < 0.25 * rise, `after 2 s only ${at2 - w0} of ${rise} W`);
  // the old fixed 3 s ease had ~half of it by 2 s (183 of 279 W); no one-second step over 60 W here
  for (let i = 4; i < rows.length; i++) assert.ok(rows[i].w - rows[i - 4].w <= 60, `step ${rows[i].w - rows[i - 4].w} W/s at ${rows[i].t}`);
  for (const k of [5, 8]) {
    const h = await hill({ kph: 25, grade: k });
    const t = timeTo(h.rows, h.w0, 0.9);
    assert.ok(t >= 8 && t <= 12.5, `${k} %: t90 ${t} s`);
  }
});

test('longer when the hill is entered faster, shorter when slower', async () => {
  const t15 = await hill({ kph: 15, gear: 7 }).then((h) => timeTo(h.rows, h.w0, 0.9));
  const t25 = await hill({ kph: 25, gear: 12 }).then((h) => timeTo(h.rows, h.w0, 0.9));
  const t35 = await hill({ kph: 35, gear: 16 }).then((h) => timeTo(h.rows, h.w0, 0.9));
  assert.ok(t15 < t25 - 1.5 && t35 > t25 + 2, `15 km/h ${t15} s, 25 km/h ${t25} s, 35 km/h ${t35} s`);
  assert.ok(t15 >= 5 && t35 <= 18, `${t15} ${t35}`);
});

test('the felt grade changes at most 1 %/s, ERG and SIM, and SIM gets the same shaping (no momentum)', async () => {
  for (const shiftMode of ['erg', 'sim']) {
    for (const hillFeel of [50, 100]) {
      const { rows } = await hill({ grade: 10, settings: { shiftMode, hillFeel } });
      let prev = 0;
      for (const r of rows) { assert.ok(Math.abs(r.felt - prev) <= GRADE_RATE_PCT_S * TICK + 1e-9, `${shiftMode} ${hillFeel}: ${r.felt} after ${prev}`); prev = r.felt; }
      assert.ok(Math.abs(rows.at(-1).felt - 10 * hillFeel / 100) < 0.05, 'gets there');
    }
  }
  // SIM: the shaped grade alone (blend + 1 %/s) — ahead of ERG's momentum, and the grade sent follows it gradually
  const sim = await hill({ grade: 6, settings: { shiftMode: 'sim' } });
  const erg = await hill({ grade: 6 });
  const at = (h, t) => h.rows.find((r) => r.t === t).felt;
  assert.ok(at(sim, 4) > at(erg, 4) + 0.3, `SIM ${at(sim, 4)} vs ERG ${at(erg, 4)} at 4 s`);
  assert.ok(at(sim, 3) <= 3 * GRADE_RATE_PCT_S && at(sim, 6) > 2.5, `SIM felt 3 s ${at(sim, 3)}, 6 s ${at(sim, 6)}`);
  assert.ok(sim.rows[3].sent < sim.rows.at(-1).sent - 1, 'SIM sent grade ramps, not a step');
});

test('Hill feel still scales the hill', async () => {
  const a = await hill({ settings: { hillFeel: 25 } });
  const b = await hill({ settings: { hillFeel: 100 } });
  assert.ok(b.rows.at(-1).w - b.w0 > 3 * (a.rows.at(-1).w - a.w0), `${a.rows.at(-1).w} vs ${b.rows.at(-1).w}`);
});

test('a crest eases off gradually and settles on the flat value', async () => {
  const { ride, rows: up } = await hill({ grade: 6, sec: 60 });
  const climbW = up.at(-1).w;
  ride.session.setGrade(0);
  const rows = [];
  for (let i = 0; i < 60 / TICK; i++) { ride.tick(); rows.push(ride.session.target.value); }
  const flat = rows.at(-1);
  assert.ok(Math.abs(flat - ergTargetForBike(ride.cadence, ride.session.ratio, 0, ride.session.speedMps)) <= 1);
  assert.ok(rows[3] > climbW - 0.25 * (climbW - flat), `1 s over the crest: ${rows[3]} (climb ${climbW}, flat ${flat})`);
  const t90 = (rows.findIndex((w) => w <= climbW - 0.9 * (climbW - flat)) + 1) * TICK;
  assert.ok(t90 > 3 && t90 < 15, `crest t90 ${t90} s`);   // half in ~4 s, the tail as the bike gets back to speed (F303)
});

test('descent: pedalling meets a floor that fades as you spin out; coasting is 0', async () => {
  const { ride, w0, rows } = await hill({ grade: -6, sec: 60 });
  const ws = rows.map((r) => r.w);
  assert.ok(Math.min(...ws) >= PEDAL_FLOOR_MIN_W, `never 0 while pedalling: min ${Math.min(...ws)}`);
  assert.ok(ws[7] > 0.6 * w0, `2 s in still ${ws[7]} of ${w0} W`);
  for (let i = 4; i < ws.length; i++) assert.ok(ws[i - 4] - ws[i] <= 40, `drop ${ws[i - 4] - ws[i]} W/s`);
  const end = ws.at(-1);
  assert.ok(end < 0.5 * w0, `spun out in gear 12 at ${(rows.at(-1).v * 3.6).toFixed(0)} km/h: ${end} W`);
  // a bigger gear keeps more of it
  ride.session.shift(+6);
  ride.tick();
  assert.ok(ride.session.target.value > 2 * end, `gear 18: ${ride.session.target.value} W vs ${end}`);
  // coasting
  ride.cadence = 0;
  ride.tick();
  assert.equal(ride.session.target.value, 0);
  assert.equal(ride.trainer.erg, 0);
});

test('descent floor: full while the gear keeps up with the bike, fading to its minimum as the bike runs away', () => {
  const r = GEAR_RATIOS[11], cad = 85, vc = speedFromCadence(cad, r);
  const at = (vb) => descentFloorW(cad, r, vb);
  assert.ok(at(vc) > 50 && at(vc) <= at(vc * 1.03) + 1);
  let prev = Infinity;
  for (let vb = vc * 1.06; vb < vc * 4; vb += 0.5) { const w = at(vb); assert.ok(w <= prev + 1e-9, `fades: ${w} at ${vb}`); prev = w; }
  assert.ok(at(vc * 3) >= PEDAL_FLOOR_MIN_W && at(vc * 3) < 0.5 * at(vc), `${at(vc * 3)} vs ${at(vc)}`);
  assert.equal(descentFloorW(10, r, 15), 0);
  assert.equal(ergTargetForBike(0, r, -6, 15), 0);
  // on the flat and up hills the gear's demand is above the floor: the target is the gear demand as before
  assert.ok(ergTargetForBike(cad, r, 0, vc) > at(vc));
});

test('a shift changes the target at once, mid-climb', async () => {
  const { ride, rows } = await hill({ grade: 6, sec: 30 });
  const before = rows.at(-1).w;
  ride.session.shift(-2);
  ride.tick();
  const now = ride.session.target.value;
  const want = ergTargetForBike(ride.cadence, ride.session.ratio, ride.session.pedalGrade, ride.session.speedMps);
  assert.equal(now, want);
  assert.equal(ride.trainer.erg, now, 'sent the same tick');
  for (let i = 0; i < 40; i++) ride.tick();
  const settled = ride.session.target.value;
  assert.ok(Math.abs(now - settled) < 0.1 * (before - settled), `at once ${now}, settled ${settled}, before ${before}`);
});

test('workouts and conveyors are untouched', async () => {
  const { ride } = await hill({ grade: 6, sec: 5 });
  ride.session.setWorkout({ name: 'w', segments: [{ start: 0, duration: 600, label: 'z2', kind: 'erg', unit: 'ftp', from: 0.6, to: 0.6 }] });
  ride.tick();
  assert.equal(ride.session.target.source, 'workout');
  assert.equal(ride.session.target.value, 120);
  assert.equal(ride.trainer.erg, 120);
  // an escalator: ERG 0 (CARRY_SIM_GRADE in SIM), as before
  ride.session.setFree();
  ride.session.mode = 'route';
  ride.session.route = { carry: true };
  Object.defineProperty(ride.session, 'carry', { value: { from: 0, to: 50, mps: 1 }, configurable: true });
  ride.session._control(performance.now(), ride.session.physicsParams(), 6, ride.session.carry, TICK);
  assert.equal(ride.session.target.source, 'carry');
  assert.equal(ride.session.target.value, 0);
});
