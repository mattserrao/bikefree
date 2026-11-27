// [review 27 Nov] P12: a ride, driven in a DOM (test/dom-app.mjs: index.html in happy-dom, the real modules, a fake
// trainer over Web Bluetooth, a fake IndexedDB, a fake service worker, and test/fake-world.mjs for the 3D world).
// The smoke test walks choose a route → start → ride → finish → summary → save; the rest check, on the page, what
// were source-text checks: the summary holds auto resume (A10), the recovery copy is flushed when the page is hidden
// (A9), a failed save keeps the ride and offers its .fit (A2), the degraded-scenery note, and the Update ready bar
// (A7). The tests run in order on one page (one app per test file).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootApp } from './dom-app.mjs';

let fitAnswer = true;   // what the "download its .fit?" confirm() answers
const page = await bootApp({ files: { 'routes/cities/index.json': { cities: [] } },
  confirm: (m) => (/\.fit file/.test(m) ? fitAnswer : true) });
const { $, document, window, idb, sw, fakeWorld } = page;
const { session } = page.bike;
after(() => page.restore());

const rides = () => idb.stores.get('rides');
const current = () => idb.stores.get('state')?.get('current');
async function pick(id) {
  $('routeCards').querySelector(`.rcard[data-id="${id}"]`).click();
  await page.until(() => { const r = page.menu.routeCache.get(id); return r && page.loading.previewRoute === r && $('pvTitle').textContent === r.name; }, 8000, id);
}
/** Start: the loading screen, then (the fake world ready) the ride screen. */
async function start() {
  $('startBtn').click();
  assert.ok($('setup').hidden);
  assert.ok(!$('rideScreen').hidden);
  await page.until(() => $('loadScreen').hidden, 8000, 'the loading screen to finish');
}
/** Stop pedalling until the ride auto-pauses (the rider coasts to a stop). */
async function coastToStop() {
  for (let s = 0; s < 300 && !session.autoPaused; s++) await page.pedal(1, { kph: 0, rpm: 0, watts: 0 });
  assert.ok(session.autoPaused, 'auto-paused');
}
/** Pause (the pause card shows at the next tick), then its Finish ride. */
async function pauseAndFinish() {
  $('pauseBtn').click();
  assert.ok(!session.running);
  await page.until(() => !$('pauseOverlay').hidden, 2000, 'the pause card');
  $('finishBtn').click();
}
async function finishWith(button) {
  if (!$('summary').open) await pauseAndFinish();
  assert.ok($('summary').open);
  $(button).click();
  await page.until(() => !$('setup').hidden, 4000, 'back on the menu');
}

test('smoke: choose a route, start, ride, finish; the summary shows it and it is saved', async () => {
  assert.deepEqual(page.errors.map(String), [], 'errors while booting');
  await pick('builtin-park-bigsur');
  $('trainerBtn').click();
  await page.until(() => !$('startBtn').disabled, 4000, 'the trainer to connect');
  assert.equal($('trainerLabel').textContent, 'KICKR CORE 2');
  await start();
  // the world was built for the route; the loading screen showed its first picture
  assert.equal(fakeWorld.instances.length, 1);
  assert.ok(fakeWorld.instances[0].route === page.loading.previewRoute, 'the world is the route\'s');
  assert.ok(fakeWorld.instances[0].running);
  assert.match($('loadPic').getAttribute('src'), /^routes\/previews\/bigsur-20\.webp/);
  assert.match($('hTitle').textContent, /^Big Sur/);
  assert.ok($('toast').hidden, `an error: ${$('toast').textContent}`);
  assert.ok(!session.running, 'the clock waits for the first pedal stroke');
  // ride 20 s
  await page.pedal(20, { kph: 32, rpm: 90, watts: 220 });
  assert.ok(session.running);
  assert.ok(session.movingS >= 19 && session.movingS <= 21, `${session.movingS} s`);
  assert.match($('hTime').textContent, /^0:(19|20|21)$/);
  assert.equal($('hPower').textContent, '220');
  assert.ok(session.distanceM > 50);
  // finish: pause, Finish ride, the summary
  await pauseAndFinish();
  assert.ok($('summary').open);
  assert.equal($('sumTitle').textContent, 'Finish ride?');
  assert.match($('sumSub').textContent, /^Big Sur/);
  const cells = Object.fromEntries([...$('sumGrid').children].map((c) => [c.querySelector('.label').textContent, c.querySelector('.value').textContent]));
  assert.match(cells.Time, /^0:(19|20|21)$/);
  assert.match(cells['Avg power'], /^2[12]\d W$/);
  // Save: in the store (summary and track), the recovery copy gone, back on the menu
  $('sumSave').click();
  await page.until(() => rides()?.size === 1 && !$('setup').hidden, 4000, 'the ride saved');
  const [saved] = rides().values();
  assert.match(saved.name, /^Big Sur/);
  assert.ok(idb.stores.get('tracks').get(saved.id).samples.length >= 19);
  assert.equal(current(), undefined, 'the recovery copy is cleared');
  assert.ok(!session.hasRide);
  assert.ok($('rideScreen').hidden);
  assert.ok(!fakeWorld.instances[0].running, 'the world stopped');
  // and it's in the history
  $('historyBtn').click();
  await page.until(() => $('history').open, 2000, 'the history');
  assert.match($('histList').querySelector('.hist-name').textContent, /^Big Sur/);
  $('history').close();
  assert.deepEqual(page.errors.map(String), []);
});

test('A10: the summary holds auto resume: pedalling behind it doesn\'t restart an auto-paused ride', async () => {
  await start();
  await page.pedal(5);
  await coastToStop();
  const moving = session.movingS;
  // (the summary opens on an auto-paused ride from the menu's Finish ride, or at a route's finish)
  $('finishBtn').click();
  assert.ok($('summary').open);
  assert.ok(session.holdResume);
  await page.pedal(4);
  assert.ok(!session.running, 'the ride resumed behind the summary');
  assert.equal(session.movingS, moving);
  // Keep riding: the hold goes, the next pedal stroke resumes it
  $('sumResume').click();
  assert.ok(!$('summary').open);
  assert.ok(!session.holdResume);
  await page.pedal(2);
  assert.ok(session.running);
  assert.ok(session.movingS > moving);
});

test('A9: the recovery copy is flushed at once when the page is hidden or put away', async () => {
  idb.stores.get('state').clear();
  window.dispatchEvent(new window.Event('pagehide'));
  await page.until(() => current(), 2000, 'the recovery copy');
  const first = current().samples.length;
  assert.ok(first > 0);
  assert.match(current().name, /^Big Sur/);
  await page.pedal(5);
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new window.Event('visibilitychange'));
  delete document.visibilityState;
  await page.until(() => current().samples.length > first, 2000, 'a newer recovery copy');
  assert.ok(current().samples.length >= first + 4);
});

test('the degraded-scenery note: shows the parts that failed (checked every 2 s on the ride), a tap dismisses it', async () => {
  const note = $('worldNote');
  assert.ok(note.hidden);
  const w = fakeWorld.instances.at(-1);
  let calls = 0;
  const readiness = w.readiness.bind(w);
  w.readiness = () => { calls++; return readiness(); };
  fakeWorld.degraded = ['landmarks'];
  await page.pedal(1);
  await page.pedal(2);
  assert.ok(!note.hidden, 'the note');
  assert.equal(note.textContent, 'Some scenery couldn’t load (landmarks) — riding on without it');
  assert.ok(calls >= 1 && calls <= 2, `readiness() ${calls}× in 3 s of ride`);
  assert.equal(page.logged.filter((l) => /Scenery partly loaded: landmarks failed/.test(l)).length, 1, 'logged once');
  assert.equal($('toast').hidden, true, `a warning in the log, not an error toast (${$('toast').textContent})`);
  fakeWorld.degraded = ['landmarks', 'city'];
  await page.pedal(3);
  assert.match(note.textContent, /\(landmarks, buildings and trees\)/);
  note.click();
  assert.ok(note.hidden, 'a tap dismisses it');
  await page.pedal(3);
  assert.ok(note.hidden, 'the same parts: it stays dismissed');
  fakeWorld.degraded = ['bridges'];
  await page.pedal(3);
  assert.ok(!note.hidden, 'other parts: it shows again');
  assert.match(note.textContent, /\(bridges\)/);
  note.click();
  assert.ok(note.hidden);
});

test('A12: the pacer steps with every running step, a caught-up timer\'s too', async () => {
  const { pacer } = page.bike;
  document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'p', bubbles: true }));   // P: the pacer on
  assert.ok(pacer.on, 'the pacer');
  let steps = 0;
  const step = pacer.step.bind(pacer);
  pacer.step = (...a) => { steps++; return step(...a); };
  await page.pedal(2);
  const moving = session.movingS, before = steps;
  // a 2 s gap in the timers (a hidden tab, a long frame), the trainer's data streaming all through it: one tick, 8 steps
  page.skip(2000);
  page.chars.bikeData.notify(page.bikeData());
  await page.settle();
  const ran = Math.round((session.movingS - moving) * 4);
  assert.ok(ran >= 8, `${ran} steps caught up`);
  assert.equal(steps - before, ran, 'the pacer stepped once per tick, not once per step');
  document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'p', bubbles: true }));
  pacer.step = step;
});

test('A7: Update ready: waits for the ride in progress; then hidden, it takes over quietly; a tap reloads', async () => {
  await page.until(() => sw.registered.length === 1, 4000, 'the service worker registered');
  assert.match(sw.registered[0].url, /\/sw\.js$/);
  assert.ok($('updateBar').hidden);
  sw.install();   // a new revision installs and waits
  assert.ok(!$('updateBar').hidden, 'the Update ready bar');
  assert.equal($('updateText').textContent, 'Update ready — reload after this ride');
  assert.ok($('updateBtn').disabled);
  $('updateBtn').click();
  // hidden mid-ride: nothing either
  Object.defineProperty(document, 'hidden', { value: true, configurable: true });
  document.dispatchEvent(new window.Event('visibilitychange'));
  delete document.hidden;
  assert.deepEqual(sw.waiting.messages, [], 'took over during a ride');
  // the ride finished and saved: the bar offers the reload
  await finishWith('sumSave');
  assert.equal(rides().size, 2);
  assert.equal($('updateText').textContent, 'Update ready');
  assert.ok(!$('updateBtn').disabled);
  // (off the ride screen the degraded note isn't checked)
  const w = fakeWorld.instances[0];
  let calls = 0;
  w.readiness = () => { calls++; return {}; };
  await page.pedal(3, { kph: 0, rpm: 0, watts: 0 });
  assert.equal(calls, 0);
  // the page hidden with no ride going: the new version takes over quietly (no reload: the next load is the new one)
  Object.defineProperty(document, 'hidden', { value: true, configurable: true });
  document.dispatchEvent(new window.Event('visibilitychange'));
  delete document.hidden;
  assert.deepEqual(sw.waiting.messages, [{ type: 'skipWaiting' }]);
  assert.ok($('updateBar').hidden);
  // another revision: Reload
  sw.waiting.messages.length = 0;
  sw.install();
  assert.ok(!$('updateBar').hidden);
  $('updateBtn').click();
  assert.equal($('updateText').textContent, 'Updating…');
  assert.deepEqual(sw.waiting.messages, [{ type: 'skipWaiting' }]);
  $('updateBtn').click();
  assert.equal(sw.waiting.messages.length, 1);
});

test('A2: a ride that can\'t be saved (a full disk) stays the recovery copy, and its .fit is offered', async () => {
  // (another route: a new world, with its own note — the bridges failed there too: shown, though dismissed before)
  await pick('builtin-endless');
  await start();
  assert.equal(fakeWorld.instances.length, 2);
  assert.ok(fakeWorld.instances[0].disposed);
  assert.equal(fakeWorld.instances[1].constructor.name, 'EndlessWorld');
  assert.ok(!$('worldNote').hidden, 'the new world\'s note');
  assert.match($('worldNote').textContent, /\(bridges\)/);
  fakeWorld.degraded = [];
  await page.pedal(6);
  idb.abortIf = (t) => t.scope.includes('tracks');
  fitAnswer = false;
  page.dialogs.confirm.length = 0;
  await finishWith('sumSave');
  await page.until(() => page.dialogs.confirm.length, 2000, 'the .fit offer');
  idb.abortIf = null;
  assert.match(page.dialogs.confirm[0], /couldn't be saved[^]*\.fit file/);
  assert.match(current().name, /Endless/);
  assert.equal(rides().size, 2, 'not saved');
  assert.ok(current()?.samples.length >= 5, 'the finished ride is kept as the recovery copy');
  assert.ok(current().summary.timerS >= 5);
  assert.ok(page.logged.some((l) => /Could not save ride/.test(l)));
});

test('the note\'s styles are in the stylesheet', () => {
  // (a regex: happy-dom loads no CSS and lays nothing out, so the rule's presence is all that can be checked here)
  assert.match(readFileSync(new URL('../css/style.css', import.meta.url), 'utf8'), /\.world-note \{/);
});
