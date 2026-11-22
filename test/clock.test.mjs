// The ride clock follows real time (code review, Nov 2026): Session._clock runs one fixed 0.25 s step per 250 ms of
// wall time, so late timers (a hidden tab ticks about once a second; a long frame while scenery builds) no longer
// slow the ride's time and distance. A gap longer than MAX_CATCHUP_MS (a sleeping laptop) is not ridden.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Session, TICK_MS, MAX_CATCHUP_MS } from '../js/session.js';

const sessions = [];
function makeSession() {
  const trainer = Object.assign(new EventTarget(), { connected: true, demo: false, lastDataAt: 0, data: {}, setErgWatts() { return Promise.resolve(); }, setGrade() { return Promise.resolve(); } });
  const s = new Session({ trainer, ride: Object.assign(new EventTarget(), { vibrate() {} }), hr: new EventTarget(), log: () => {}, settings: { riderKg: 75, bikeKg: 9, ftp: 200 } });
  clearInterval(s._timer);
  sessions.push(s);
  let ticks = 0;
  const tick = s._tick.bind(s);
  s._tick = () => { ticks++; tick(); };
  s.count = () => ticks;
  return s;
}
after(() => { for (const s of sessions) clearInterval(s._timer); });

test('on time: one step per timer', () => {
  const s = makeSession();
  let t = s._clockAt;
  for (let i = 0; i < 40; i++) { t += TICK_MS; s._clock(t); }
  assert.equal(s.count(), 40);
});

test('a throttled timer (once a second, as in a hidden tab) catches up: four steps each', () => {
  const s = makeSession();
  let t = s._clockAt;
  for (let i = 0; i < 10; i++) { t += 1000; s._clock(t); }
  assert.equal(s.count(), 40);
});

test('jitter neither drops nor doubles steps', () => {
  const s = makeSession();
  let t = s._clockAt;
  for (let i = 0; i < 400; i++) { t += TICK_MS + (i % 2 ? 3 : -3) + (i % 7 === 0 ? 1 : 0); s._clock(t); }
  assert.equal(s.count(), 400);
});

test('a long gap (laptop asleep) adds at most MAX_CATCHUP_MS', () => {
  const s = makeSession();
  const t = s._clockAt + 60 * 60 * 1000;
  s._clock(t);
  assert.equal(s.count(), MAX_CATCHUP_MS / TICK_MS);
});

test('riding at a steady pace: distance follows wall time whatever the timer rate', () => {
  const ride = (stepMs) => {
    const s = makeSession();
    s.demoSpeedMps = 10;
    s.start();
    let t = s._clockAt;
    for (let el = 0; el < 60000; el += stepMs) { t += stepMs; s._clock(t); }
    return s.distanceM;
  };
  const onTime = ride(250), hidden = ride(1000), stalls = ride(700);
  assert.ok(Math.abs(onTime - 600) < 3, `on time ${onTime}`);
  assert.ok(Math.abs(hidden - onTime) < 3, `hidden ${hidden}`);
  assert.ok(Math.abs(stalls - onTime) < 3, `stalls ${stalls}`);
});
