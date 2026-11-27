// [review 27 Nov] A3: a backgrounded ride keeps its time and distance. Chrome's intensive throttling (a tab hidden > 5
// min) wakes page timers about once a minute and the clock caught up at most 2 s, so a hidden ride lost most of its
// distance and the trainer stopped following the grade. Now a Worker timer ticks the clock, the trainer's data
// notifications tick it too, and a gap the trainer's data streamed all through is caught up in full; a gap without
// data (a sleeping laptop) is still capped at MAX_CATCHUP_MS.
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Session, TICK_MS, MAX_CATCHUP_MS, startClockTimer } from '../js/session.js';

// A fake clock for everything the session reads (performance.now, Date.now): whole milliseconds from 1000, so no
// real time passes between steps and no floating-point drift decides whether a step is due. (CI, 27 Nov: on the
// real performance.now() origin, (t + 250) - t could come out 249.99999997 and skip a step.)
const WALL0 = Date.UTC(2026, 10, 27, 7, 0, 0);
let clock = 1000;
before(() => { mock.method(performance, 'now', () => clock); mock.method(Date, 'now', () => WALL0 + clock); });
const sessions = [];
after(() => { for (const s of sessions) s.stopClock(); mock.restoreAll(); });

/** A session at 200 W / 90 rpm on its own fake time `s.t` (setting it sets the clock); `s.data(ms)`: trainer data every 250 ms. */
function makeSession() {
  clock = 1000;
  const trainer = Object.assign(new EventTarget(), { connected: true, demo: false, lastDataAt: Infinity, data: { powerW: 200, cadenceRpm: 90, speedKph: 30 },
    setErgWatts() { return Promise.resolve(); }, setGrade() { return Promise.resolve(); } });
  const ride = Object.assign(new EventTarget(), { vibrate() {} });
  const s = new Session({ trainer, ride, hr: new EventTarget(), log: () => {}, settings: { riderKg: 75, bikeKg: 9, ftp: 200, difficulty: 100, startGear: 12 } });
  s.stopClock();   // (ticked by hand)
  sessions.push(s);
  assert.equal(s._clockAt, 1000);
  let own = 1000;
  Object.defineProperty(s, 't', { get: () => own, set: (v) => { own = v; clock = v; } });
  s.timer = (ms) => { s.t += ms; return s._clock(); };
  /** `ms` of trainer notifications every 250 ms (the page's timers stalled meanwhile). */
  s.data = (ms, notify = () => trainer.dispatchEvent(new CustomEvent('data'))) => { for (let e = 0; e < ms; e += TICK_MS) { s.t += TICK_MS; notify(); } };
  return s;
}

test('a 60 s timer stall while the trainer\'s data kept arriving: no distance or samples lost', () => {
  const ref = makeSession(), s = makeSession();
  for (let i = 0; i < 40; i++) { ref.timer(TICK_MS); s.timer(TICK_MS); }   // 10 s ridden on time
  for (let i = 0; i < 240; i++) ref.timer(TICK_MS);   // the reference: 60 s more, on time
  s.data(60_000);   // the timers stall for 60 s (a hidden tab); the trainer's notifications tick the clock
  s.timer(TICK_MS); ref.timer(TICK_MS);   // the next timer wakes
  assert.ok(Math.abs(s.distanceM - ref.distanceM) < 0.5, `${s.distanceM.toFixed(1)} m vs ${ref.distanceM.toFixed(1)} m on time`);
  assert.equal(s.recorder.samples.length, ref.recorder.samples.length);
  assert.ok(Math.abs(s.recorder.samples.length - 70) <= 1, `${s.recorder.samples.length} samples in 70 s`);
});

test('a 60 s gap that the trainer\'s data streamed all through is caught up in full (one late timer)', () => {
  const ref = makeSession(), s = makeSession();
  s.data(2000); ref.data(2000);   // riding, the data streaming before the gap
  // the data streams (noted, but the clock isn't run by it: e.g. the main thread was busy), then one timer
  const noteOnly = () => { s._inClock = true; s._onTrainerData(); s._inClock = false; };
  s.data(60_000, noteOnly);
  const steps = s._clock();
  assert.equal(steps, 240);
  for (let i = 0; i < 240; i++) ref.timer(TICK_MS);
  assert.ok(Math.abs(s.distanceM - ref.distanceM) < 0.5, `${s.distanceM.toFixed(1)} vs ${ref.distanceM.toFixed(1)} m`);
  assert.ok(Math.abs(s.recorder.samples.length - ref.recorder.samples.length) <= 1);
});

test('with no trainer data through the gap (a sleeping laptop), the catch-up cap still applies', () => {
  const s = makeSession();
  s.data(2000);   // riding, data streaming
  const d0 = s.distanceM, n0 = s.recorder.samples.length;
  s.t += 60_000;   // 60 s with nothing at all
  const steps = s._clock();
  assert.equal(steps, MAX_CATCHUP_MS / TICK_MS);
  assert.ok(s.distanceM - d0 < 25, `${(s.distanceM - d0).toFixed(1)} m in a capped gap`);
  assert.ok(s.recorder.samples.length - n0 <= MAX_CATCHUP_MS / 1000);
});

test('data that stopped during the gap and came back (a dropout) does not lift the cap', () => {
  const s = makeSession();
  s.data(2000);
  const ca = s.t;
  s.t += 30_000;   // 30 s silent
  s._inClock = true; s._onTrainerData(); s._inClock = false;   // the trainer's back: a new streak, begun after the gap began
  assert.equal(s._clockAt, ca);
  s.t += 30_000;
  s._inClock = true; s._onTrainerData(); s._inClock = false;
  assert.equal(s._clock(), MAX_CATCHUP_MS / TICK_MS);
});

test('the demo trainer\'s data (fired inside a step) neither re-enters the clock nor lifts the cap', () => {
  const s = makeSession();
  s.trainer.demo = true;
  let polls = 0;
  s.trainer.pollDemo = () => { polls++; s.trainer.dispatchEvent(new CustomEvent('data')); };
  assert.equal(s.timer(1000), 4);
  assert.equal(polls, 4);
  const d0 = s.distanceM;
  s.data(10_000);   // the demo's own (throttled page) timer: no clock steps from it
  assert.equal(s.distanceM, d0, 'the demo data drove the clock');
  assert.equal(s.timer(0), MAX_CATCHUP_MS / TICK_MS, 'the demo data lifted the cap');
});

test('the clock timer runs in a Worker where there is one, else on setInterval; a failing Worker falls back', async () => {
  const made = [];
  class FakeWorker { constructor(url) { this.url = url; this.terminated = false; made.push(this); } terminate() { this.terminated = true; } }
  const revoked = [];
  const env = { Worker: FakeWorker, Blob, URL: { createObjectURL: (b) => { assert.ok(b instanceof Blob); return 'blob:clock'; }, revokeObjectURL: (u) => revoked.push(u) } };
  let n = 0;
  const t = startClockTimer(() => n++, TICK_MS, env);
  assert.equal(t.kind, 'worker');
  assert.equal(made[0].url, 'blob:clock');
  made[0].onmessage({ data: 0 }); made[0].onmessage({ data: 0 });
  assert.equal(n, 2);
  t.stop();
  assert.ok(made[0].terminated);
  assert.deepEqual(revoked, ['blob:clock']);
  // the worker fails to start its script (a CSP): the page's setInterval takes over
  const t2 = startClockTimer(() => n++, 10, env);
  made[1].onerror(new Event('error'));
  assert.equal(t2.kind, 'interval');
  assert.ok(made[1].terminated);
  const before = n;
  await new Promise((r) => setTimeout(r, 60));
  t2.stop();
  assert.ok(n > before, 'the fallback interval ticked');
  // no Worker (node, old browsers): setInterval
  const t3 = startClockTimer(() => {}, TICK_MS, {});
  assert.equal(t3.kind, 'interval');
  t3.stop();
  // the blob source posts on a timer
  let src = '';
  startClockTimer(() => {}, TICK_MS, { ...env, Blob: class { constructor(parts) { src = parts.join(''); } } }).stop();
  assert.match(src, /setInterval\(\(\) => postMessage\(0\), 250\)/);
});
