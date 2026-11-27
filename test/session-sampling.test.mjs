// [review 27 Nov] The ride's recording follows the session's clock: one sample per 4 running 0.25 s steps (A1), so an
// hour of riding is 3600 samples (timer time, FIT total_timer_time, laps, kJ) however the browser's timer jitters or
// throttles; one 'tick' per timer, after its steps (A12); and pedalling doesn't restart a ride behind the summary (A10).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Session, TICK_MS } from '../js/session.js';

const sessions = [];
const realNow = Date.now;
after(() => { Date.now = realNow; for (const s of sessions) clearInterval(s._timer); });

/** A session with a trainer reporting `watts` at 90 rpm, and a wall clock (Date.now) that follows the simulated time. */
function makeSession(watts = 200) {
  const trainer = Object.assign(new EventTarget(), { connected: true, demo: false, lastDataAt: Infinity, data: { powerW: watts, cadenceRpm: 90, speedKph: 30 },
    setErgWatts() { return Promise.resolve(); }, setGrade() { return Promise.resolve(); } });
  const s = new Session({ trainer, ride: Object.assign(new EventTarget(), { vibrate() {} }), hr: new EventTarget(), log: () => {}, settings: { riderKg: 75, bikeKg: 9, ftp: 200, difficulty: 100, startGear: 12 } });
  clearInterval(s._timer);
  sessions.push(s);
  const wall0 = realNow(), perf0 = s._clockAt;
  s.advance = (ms) => { const t = s._clockAt + ms; Date.now = () => wall0 + (t - perf0); return s._clock(t); };
  return s;
}

/** Ride `ms` of wall time on timers every `periodMs` ± up to `jitterMs` (a seeded random, like a real timer's). */
function ride(s, ms, periodMs, jitterMs) {
  let el = 0, seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  while (el < ms) { const d = periodMs + (rnd() * 2 - 1) * jitterMs; s.advance(d); el += d; }
}

for (const [label, period] of [['foreground (250 ms timers)', TICK_MS], ['hidden tab (1 s timers)', 1000]]) {
  test(`an hour with ±4 ms timer jitter, ${label}: 3600 samples, an hour of timer time, the right kJ`, () => {
    const s = makeSession(200);
    ride(s, 3600 * 1000, period, 4);
    const r = s.finish();
    assert.ok(Math.abs(r.samples.length - 3600) <= 1, `${r.samples.length} samples`);
    assert.ok(Math.abs(r.summary.timerS - 3600) <= 1, `timer ${r.summary.timerS} s`);
    assert.ok(Math.abs(r.summary.kj - 720) < 1, `${r.summary.kj} kJ`);   // 200 W × 3600 s
    // the average speed is distance over timer time: the same as the distance over the hour
    assert.ok(Math.abs(r.summary.avgSpeed - r.summary.distanceM / 3600) < 0.01, `avg ${r.summary.avgSpeed}`);
    // the samples' wall times are in order and about a second apart
    const t = r.samples.map((x) => x[0]);
    for (let i = 1; i < t.length; i++) assert.ok(t[i] > t[i - 1], `sample ${i} out of order`);
    assert.ok(Math.abs((t.at(-1) - t[0]) / 1000 - 3599) < 2, `${(t.at(-1) - t[0]) / 1000} s from first to last sample`);
  });
}

test('a pause carries its part-second over: samples add up to the running time', () => {
  const s = makeSession(150);
  for (let k = 0; k < 20; k++) {
    s.advance(TICK_MS * 7);   // 1.75 s riding
    s.pause(); s.advance(TICK_MS * 3); s.start();
  }
  s.advance(TICK_MS * 4);
  const r = s.finish();
  assert.equal(r.samples.length, (20 * 7 + 4) / 4);   // 144 running steps (the auto start rides the first)
});

test('one tick event per timer, carrying its steps and running steps', () => {
  const s = makeSession(200);
  const ticks = [];
  s.addEventListener('tick', (e) => ticks.push(e.detail));
  s.advance(1000);   // a throttled timer: four steps, one tick
  assert.equal(ticks.length, 1);
  assert.equal(ticks[0].steps, 4);
  assert.equal(ticks[0].dt, TICK_MS / 1000);
  assert.ok(ticks[0].runSteps >= 3 && ticks[0].runSteps <= 4, `runSteps ${ticks[0].runSteps}`);   // (the auto start comes on the first step)
  s.pause();
  s.advance(2000);
  assert.equal(ticks.length, 2);
  assert.deepEqual([ticks[1].steps, ticks[1].runSteps], [8, 0]);
  s.advance(10);   // too soon for a step: no tick
  assert.equal(ticks.length, 2);
});

test('the summary open holds auto start and auto resume (holdResume)', () => {
  const s = makeSession(200);
  s.advance(1000);
  assert.ok(s.running);
  // stop pedalling: the ride auto-pauses
  s.trainer.data.powerW = 0; s.trainer.data.cadenceRpm = 0;
  s.demoSpeedMps = 0;
  for (let i = 0; i < 10 && s.running; i++) s._lastActiveAt = -1e9, s.advance(1000);
  assert.ok(s.autoPaused && !s.running);
  // the summary opens; pedalling doesn't resume the ride behind it
  s.holdResume = true;
  s.demoSpeedMps = null; s.trainer.data.powerW = 200; s.trainer.data.cadenceRpm = 90;
  s.advance(2000);
  assert.ok(!s.running, 'resumed behind the summary');
  const n = s.recorder.samples.length;
  s.advance(2000);
  assert.equal(s.recorder.samples.length, n);
  // closed with Resume: pedalling resumes it
  s.holdResume = false;
  s.advance(500);
  assert.ok(s.running);
});

test('holdResume also holds the first auto start', () => {
  const s = makeSession(200);
  s.holdResume = true;
  s.advance(2000);
  assert.ok(!s.running && !s.hasRide);
});
