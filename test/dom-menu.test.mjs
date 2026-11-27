// [review 27 Nov] P12: the main menu, driven in a DOM (test/dom-app.mjs: index.html in happy-dom, the real modules,
// fake Bluetooth / IndexedDB / fetch). Replaces the source-text checks of the ride tabs and the default route
// (city-routes.test.mjs), the route pictures' strip, enlarge dialog and city panel strip (route-previews.test.mjs),
// and the menu's Finish ride button (A5, app-reliability.test.mjs).
// One city (CNY: its graph is small) and the parks; the picture manifest gets one CNY route's pictures.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootApp } from './dom-app.mjs';

const json = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const cities = json('routes/cities/index.json');
const previews = json('routes/previews/index.json');
const cnyFirst = json('routes/cities/cny-presets.json')[0];
const cnyShots = [{ file: 'cny-a-20.webp', caption: 'Start · Erie Canal', role: 'start', atM: 20 }, { file: 'cny-a-900.webp', caption: 'Climb · Hill Road, 8 %', role: 'climb', atM: 900 }];
const page = await bootApp({ files: {
  'routes/cities/index.json': { ...cities, cities: cities.cities.filter((c) => c.id === 'cny') },
  'routes/previews/index.json': { ...previews, routes: { ...previews.routes, [cnyFirst.id]: cnyShots } },
} });
const { $, document } = page;
after(() => page.restore());

const card = (id) => $('routeCards').querySelector(`.rcard[data-id="${id}"]`);
/** Picks a route card and waits for the preview to show it. */
async function pick(id) {
  card(id).click();
  const shown = () => { const r = page.menu.routeCache.get(id); return r && page.loading.previewRoute === r && $('pvTitle').textContent === r.name; };
  await page.until(shown, 8000, `${id} in the preview`);
  assert.ok(card(id).classList.contains('on'));
}

test('the menu boots: one ride-type tab row, Routes first and on; the city\'s first route is selected', () => {
  assert.deepEqual(page.errors.map(String), [], 'errors while booting');
  const tabs = [...document.querySelectorAll('.ride-tab')].map((t) => [t.dataset.mode, t.classList.contains('on'), t.getAttribute('aria-selected')]);
  assert.deepEqual(tabs, [['route', true, 'true'], ['workout', false, 'false'], ['free', false, 'false']]);
  const panes = Object.fromEntries([...document.querySelectorAll('.mode-pane')].map((p) => [p.dataset.pane, p.hidden]));
  assert.deepEqual(panes, { route: false, workout: true, free: true });
  assert.equal($('rideOpts').open, false, 'ride options folded');
  // the default: the city's first route (defaultRouteId), shown on its card and in the preview
  const city = $('routeCards').querySelector('.city-card');
  assert.ok(city.classList.contains('on'));
  assert.match(city.querySelector('.rsel').textContent, new RegExp(`^Selected · ${cnyFirst.name}`));
  assert.equal($('pvKicker').textContent, 'Route');
  assert.match($('pvTitle').textContent, new RegExp(cnyFirst.name));
  assert.equal($('startBtn').textContent, 'Connect the trainer to start');
  assert.ok($('startBtn').disabled);
});

test('the ride tabs switch the pane and the preview', async () => {
  const tab = (m) => document.querySelector(`.ride-tab[data-mode="${m}"]`);
  tab('workout').click();
  assert.equal(tab('workout').getAttribute('aria-selected'), 'true');
  assert.equal(tab('route').getAttribute('aria-selected'), 'false');
  assert.ok(document.querySelector('.mode-pane[data-pane="route"]').hidden);
  assert.ok(!document.querySelector('.mode-pane[data-pane="workout"]').hidden);
  assert.equal($('pvKicker').textContent, 'Workout');
  assert.ok($('pvShots').hidden, 'a workout has no pictures');
  tab('free').click();
  assert.ok(tab('free').classList.contains('on'));
  assert.equal($('pvKicker').textContent, 'Free ride');
  assert.ok($('routeOpts').hidden, 'no route options for a free ride');
  tab('route').click();
  assert.ok(!document.querySelector('.mode-pane[data-pane="route"]').hidden);
  assert.equal($('pvKicker').textContent, 'Route');
  assert.ok(!$('routeOpts').hidden);
});

test('route pictures: a route with pictures shows its strip (riding order, lazy), one without shows none', async () => {
  await pick('builtin-park-bigsur');
  const box = $('pvShots');
  assert.ok(!box.hidden, 'Big Sur has pictures');
  const imgs = [...box.querySelectorAll('img')];
  assert.equal(imgs.length, 3);
  assert.equal(box.style.getPropertyValue('--n'), '3');
  assert.ok(imgs.every((i) => i.getAttribute('loading') === 'lazy'));
  assert.match(imgs[0].getAttribute('src'), /^routes\/previews\/bigsur-20\.webp\?v=/);
  // a tap enlarges; ‹ › go round the list
  box.querySelector('[data-shot="1"]').click();
  assert.ok($('shotDlg').open);
  assert.match($('shotCap').textContent, /^Highlight Bixby Creek Bridge/);
  assert.equal($('shotCount').textContent, '2 of 3');
  $('shotNext').click();
  assert.equal($('shotCount').textContent, '3 of 3');
  $('shotNext').click();
  assert.equal($('shotCount').textContent, '1 of 3');
  $('shotClose').click();
  assert.ok(!$('shotDlg').open);
  // Going-to-the-Sun has none: the strip goes
  await pick('builtin-park-goingtothesun');
  assert.ok(box.hidden, 'a route with no pictures shows none');
  assert.equal(box.innerHTML, '');
  await pick('builtin-park-bigsur');
  assert.ok(!box.hidden);
  await pick('builtin-endless');
  assert.ok(box.hidden);
});

test('the city panel shows the selected route\'s pictures below its map, and enlarges them (7.1)', async () => {
  $('routeCards').querySelector('.city-card').click();
  assert.ok($('cityDlg').open);
  const shots = $('cityShots');
  // in the panel's body, after the map column, not in the route list column
  const body = $('cityDlg').querySelector('.city-body');
  assert.ok(shots.parentElement === body, 'in the panel\'s body');
  assert.ok($('cityMapHint').compareDocumentPosition(shots) & 4 /* following */, 'below the map');
  assert.ok(!shots.closest('.city-side'), 'not in the route list column');
  // the first route (with pictures) is selected in the panel
  await page.until(() => $('cityList').querySelector('.city-row-btn[aria-pressed="true"]'), 4000, 'the panel\'s selected route');
  assert.equal($('cityList').querySelector('.city-row-btn[aria-pressed="true"]').dataset.id, `builtin-graph-${cnyFirst.id}`);
  assert.ok(!shots.hidden);
  assert.equal(shots.querySelectorAll('img').length, 2);
  assert.ok($('cityDlg').classList.contains('has-shots'));
  shots.querySelector('[data-shot="1"]').click();
  assert.ok($('shotDlg').open);
  assert.match($('shotCap').textContent, /^Climb Hill Road, 8 %/);
  assert.equal($('shotCount').textContent, '2 of 2');
  $('shotClose').click();
  // another route (no pictures): the strip goes
  const other = [...$('cityList').querySelectorAll('.city-row-btn')].find((b) => b.getAttribute('aria-pressed') === 'false');
  other.click();
  await page.until(() => other.isConnected === false || other.getAttribute('aria-pressed') === 'true' || shots.hidden, 4000, 'the other route');
  assert.ok(shots.hidden, 'a route with no pictures shows none');
  assert.ok(!$('cityDlg').classList.contains('has-shots'));
  $('cityBack').click();
  assert.ok(!$('cityDlg').open);
});

test('A5: during a ride the menu\'s Finish ride button stays the same button, and a click on it opens the summary', async () => {
  await pick('builtin-park-bigsur');
  $('trainerBtn').click();   // pairs the fake trainer (navigator.bluetooth)
  await page.until(() => !$('startBtn').disabled, 4000, 'the trainer to connect');
  assert.equal($('startBtn').textContent, 'Start riding');
  assert.equal($('startNote').textContent, 'Recording starts when you pedal.');
  // a ride going while the menu shows (the Switch & resume case)
  const { session } = page.bike;
  session.setRoute(page.loading.previewRoute, 0, null, null);
  session.start();
  await page.pedal(1);
  assert.ok(session.hasRide);
  const btn = $('finishFromMenu');
  assert.ok(btn, 'a Finish ride button');
  await page.pedal(10);   // 40 clock steps, each one re-rendering the note's numbers
  assert.ok($('finishFromMenu') === btn, 'the note (and its button) was rebuilt during the ride');
  assert.match($('startNote').textContent, /^Ride in progress · 0:1\d · [\d.]+ (km|mi) · Finish ride$/);
  assert.equal($('startBtn').textContent, 'Resume ride');
  btn.click();
  assert.ok($('summary').open, 'the click opened the summary');
  assert.equal($('sumTitle').textContent, 'Finish ride?');
  // discard it (confirm: yes): back to no ride, the note rebuilt once for its new kind
  page.dialogs.confirm.length = 0;
  $('sumDiscard').click();
  await page.until(() => $('startNote').textContent === 'Recording starts when you pedal.', 2000, 'the ride discarded');
  assert.ok(!session.hasRide);
  assert.match(page.dialogs.confirm[0], /^Discard this ride/);
  assert.ok(!$('finishFromMenu'));
});
