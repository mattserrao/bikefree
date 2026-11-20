// Phase 8 (load before you ride): the clock is held while the route loads (the loading screen) and while the world
// waits for the streets ahead (L3–L5); the first pedal stroke after that starts it. The page flow itself (the
// loading screen, Ride anyway, Cancel) is checked headless by tools/load_screen_check.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../js/session.js';

const sessions = [];
const pedal = { powerW: 180, cadenceRpm: 85, speedKph: 30 };
const idle = { powerW: 0, cadenceRpm: 0, speedKph: 0 };
function makeSession() {
  const trainer = Object.assign(new EventTarget(), { connected: true, demo: false, lastDataAt: 0, data: { ...idle }, setErgWatts() { return Promise.resolve(); }, setGrade() { return Promise.resolve(); } });
  const s = new Session({ trainer, ride: Object.assign(new EventTarget(), { vibrate() {} }), hr: new EventTarget(), log: () => {}, settings: { riderKg: 75, bikeKg: 9, ftp: 200 } });
  clearInterval(s._timer);   // (ticked by hand below)
  sessions.push(s);
  s.feed = (d) => { trainer.data = { ...d }; trainer.lastDataAt = performance.now(); };
  s.ticks = (n) => { for (let i = 0; i < n; i++) { trainer.lastDataAt = performance.now(); s._tick(); } };
  return s;
}
after(() => { for (const s of sessions) clearInterval(s._timer); });

test('behind the loading screen pedalling does not start the clock; after it the first pedal stroke does', () => {
  const s = makeSession();
  s.autoStart = false;
  s.setHeld(true);   // (the app: beginLoad)
  s.feed(pedal);
  s.ticks(20);
  assert.equal(s.running, false);
  assert.equal(s.movingS, 0);
  assert.equal(s.distanceM, 0);
  // ready: the screen closes, auto start armed
  s.setHeld(false);
  s.autoStart = true;
  assert.equal(s.running, false, 'not until a pedal stroke');
  s.ticks(1);
  assert.equal(s.running, true);
  s.ticks(8);
  assert.ok(s.movingS > 1.5 && s.distanceM > 0);
});

test('autoStart alone (no hold) still cannot start while held', () => {
  const s = makeSession();
  s.autoStart = true;
  s.setHeld(true);
  s.feed(pedal);
  s.ticks(8);
  assert.equal(s.running, false);
});

test('A / Space while loading starts the ride once the hold ends, and not before', () => {
  const s = makeSession();
  s.autoStart = false;
  s.setHeld(true);
  s.feed(idle);
  s.toggle();   // (A button)
  assert.equal(s.running, false);
  s.setHeld(false);
  assert.equal(s.running, true);
});

test('mid-ride, waiting for an area holds time and distance, then the ride carries on by itself', () => {
  const s = makeSession();
  s.feed(pedal);
  s.ticks(8);
  assert.equal(s.running, true);
  const t = s.movingS, d = s.distanceM;
  s.setHeld(true);
  assert.equal(s.running, false);
  s.ticks(20);
  assert.equal(s.movingS, t, 'time held');
  assert.equal(s.distanceM, d, 'distance held');
  assert.ok(s.speedMps > 0, 'the speed you ride at is still shown');
  s.setHeld(false);
  assert.equal(s.running, true);
  s.ticks(4);
  assert.ok(s.distanceM > d);
});

test('pausing during a hold keeps the ride paused when the hold ends', () => {
  const s = makeSession();
  s.feed(pedal);
  s.ticks(8);
  s.setHeld(true);
  s.toggle();   // you pause while it waits
  s.setHeld(false);
  assert.equal(s.running, false);
  s.ticks(8);
  assert.equal(s.running, false, 'pedalling does not resume a ride you paused');
});

test('an auto-paused ride is not resumed by the hold, but by pedalling once it ends', () => {
  const s = makeSession();
  s.feed(pedal);
  s.ticks(8);
  s.feed(idle);
  s.speedMps = 0;
  s._lastActiveAt = performance.now() - 10000;
  s.ticks(1);
  assert.equal(s.autoPaused, true);
  s.setHeld(true);
  s.feed(pedal);
  s.ticks(4);
  assert.equal(s.running, false, 'held');
  s.setHeld(false);
  s.ticks(1);
  assert.equal(s.running, true);
});
