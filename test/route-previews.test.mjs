// Route preview pictures (PLAN 6.8): the spot picker (tools/preview_spots.mjs), the manifest and pictures in
// routes/previews/ (tools/build_previews.mjs), and the menu's wiring (js/route-previews.js, index.html, sw.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { titleCase, pickSpots, steepestClimb, caption, imageName, loadSources, planRoutes, SCORE } from '../tools/preview_spots.mjs';
import { previewShots, shotsHtml, PREVIEW_INDEX } from '../js/route-previews.js';
import { appSource } from './app-source.mjs';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

// a synthetic track: 10 m samples, flat but for a 10 % ramp from 3000 to 3200 m, an escalator at 5000–5060 m
function track({ len = 8000, city = true, ramp = [3000, 3200, 10], escalator = [5000, 5060], under = null } = {}) {
  const samples = [];
  let ele = 200;
  for (let p = 0; p <= len; p += 10) {
    let g = 0;
    if (p > ramp[0] && p <= ramp[1]) g = ramp[2];
    if (p > escalator[0] && p <= escalator[1]) g = 30;
    ele += g / 10;
    samples.push({ p, park: 'fx', s: p, out: p, dir: 1, lat: 40 + p / 111000, lon: -80, ele, grade: g, name: p < 4000 ? 'First Street' : 'Second Street',
      carry: p > escalator[0] && p <= escalator[1], under: under ? p >= under[0] && p <= under[1] : false });
  }
  return { span: len, samples, city };
}

test('titleCase: sign labels to names', () => {
  assert.equal(titleCase('P.J. McARDLE ROADWAY'), 'P.J. McArdle Roadway');
  assert.equal(titleCase('POINT STATE PARK'), 'Point State Park');
  assert.equal(titleCase('GOING-TO-THE-SUN ROAD'), 'Going-To-The-Sun Road');
  assert.equal(titleCase('WHERE THE THREE RIVERS MEET'), 'Where the Three Rivers Meet');
  assert.equal(titleCase('Canton Avenue'), 'Canton Avenue');   // already mixed case: kept
});

test('pickSpots: start, the best highlight, the steep climb; spread apart', () => {
  const t = track();
  const C = [
    { park: 'fx', kind: 'sign', name: 'Little Sign', score: SCORE.sign, atM: 6000, beforeM: 50 },
    { park: 'fx', kind: 'bridge', name: 'Big Bridge', score: SCORE.styledBridge, fromM: 6500, toM: 6700 },
    { park: 'fx', kind: 'bridge', name: 'Too Close Bridge', score: SCORE.arch, fromM: 300, toM: 350 },   // within the start's gap
  ];
  const s = pickSpots(t, C, { startName: 'Water Steps' });
  assert.deepEqual(s.map((x) => x.role), ['start', 'highlight', 'climb']);
  assert.equal(s[0].caption, 'Start · Water Steps');
  assert.equal(s[0].atM, 20);
  assert.equal(s[1].caption, 'Highlight · Big Bridge');
  assert.equal(s[1].atM, 6320, 'a bridge is pictured from its approach (0.9 × its length, at least 70 m back)');
  assert.equal(s[1].render.s, 6320);
  assert.equal(s[1].render.subject.name, 'Big Bridge', 'the camera points at the bridge and checks it is seen');
  assert.deepEqual(s[1].render.subject.pts.map((q) => q.s), [6500, 6600, 6700], 'its ends and middle');
  assert.match(s[2].caption, /^Climb · First Street, 10 %$/);
  assert.ok(s[2].atM > 3000 && s[2].atM < 3200, 'part way up the ramp');
  const gap = Math.max(250, Math.min(3000, t.span * 0.1));
  for (const a of s) for (const b of s) if (a !== b) assert.ok(Math.abs(a.atM - b.atM) >= gap);
});

test('pickSpots: an escalator is not a climb; nothing underground but a view', () => {
  const t = track({ ramp: [0, 0, 0] });
  assert.equal(steepestClimb(t)?.strong ?? false, false, 'the escalator (30 %) is skipped');
  const u = track({ under: [5500, 6800] });
  const s = pickSpots(u, [{ park: 'fx', kind: 'bridge', name: 'Tunnel Bridge', score: SCORE.styledBridge, fromM: 6000, toM: 6100 },
    { park: 'fx', kind: 'sign', name: 'Daylight Sign', score: SCORE.sign, atM: 7500, beforeM: 50 }]);
  assert.equal(s[1].name, 'Daylight Sign');
});

test('pickSpots: a subject the renderer could not see is skipped for the next best', () => {
  const t = track({ ramp: [0, 0, 0], escalator: [0, 0] });
  const C = [{ park: 'fx', kind: 'bridge', name: 'Hidden Bridge', score: SCORE.styledBridge, fromM: 4000, toM: 4100 },
    { park: 'fx', kind: 'hero', name: 'Tall Tower', score: SCORE.hero, lat: 40 + 6500 / 111000, lon: -80, height: 200, radius: 15, nearM: 250, farM: 1400 }];
  const a = pickSpots(t, C);
  assert.equal(a[1].name, 'Hidden Bridge');
  const b = pickSpots(t, C, { rejected: new Set([imageName(a[1].render)]) });
  assert.equal(b[1].name, 'Tall Tower');
  assert.equal(b[1].render.subject.kind, 'hero');
  assert.deepEqual(b[1].render.subject.pts.map((q) => q.up), [0, 100, 200], 'its foot, middle and top');
  assert.ok(b[1].atM < 6500 - 250, 'from the road riding toward it');
});

test('pickSpots: a flat route gets a second highlight instead of a climb; hand picks win', () => {
  const t = track({ ramp: [0, 0, 0], escalator: [0, 0] });
  const C = [{ park: 'fx', kind: 'view', name: 'The View', score: SCORE.view, atM: 4000, rangeM: 100, view: 'The View' },
    { park: 'fx', kind: 'lookout', name: 'The Lookout', score: SCORE.lookout, atM: 7000, beforeM: 40 }];
  const s = pickSpots(t, C);
  assert.deepEqual(s.map((x) => x.caption), ['Start', 'Highlight · The View', 'Highlight · The Lookout']);
  assert.equal(s[1].render.view, 'The View');
  const h = pickSpots(t, C, { picks: { start: { name: 'Home' }, highlight: { atM: 2500, name: 'My Spot' }, third: { off: true } } });
  assert.deepEqual(h.map((x) => [x.caption, x.atM]), [['Start · Home', 20], ['Highlight · My Spot', 2500]]);
});

test('caption and image names', () => {
  assert.equal(caption({ role: 'climb', name: 'Canton Avenue', gradePct: 26 }), 'Climb · Canton Avenue, 26 %');
  assert.equal(caption({ role: 'highlight', kind: 'summit', name: 'Logan Pass' }), 'Summit · Logan Pass');
  assert.equal(imageName({ park: 'pittsburgh-oakland', s: 5420.4 }), 'pittsburgh-oakland-5420.webp');
  assert.equal(imageName({ park: 'pittsburgh', view: 'The Point' }), 'pittsburgh-view-the-point.webp');
  assert.equal(imageName({ park: 'pittsburgh', s: 100, subject: { name: 'U.S. Steel Tower' } }), 'pittsburgh-100-u-s-steel-tower.webp');
});

// the repo's routes: every park route in the menu, every Pittsburgh preset and the free ride
const src = loadSources();
const plans = planRoutes(src);
const network = JSON.parse(read('routes/cities/pittsburgh-network.json'));
const parkIds = src.catalog.filter((c) => !c.area && !c.network).map((c) => c.id);
const expected = [...parkIds, ...network.presets.map((p) => p.id), `${network.id}-free`];

test('every route in the menu gets 2–3 spots on its own track', () => {
  assert.deepEqual(plans.map((p) => p.id).sort(), [...expected].sort());
  assert.equal(network.presets.length, 48);
  for (const p of plans) {
    assert.ok(p.spots.length >= 2 && p.spots.length <= 3, `${p.id}: ${p.spots.length} spots`);
    assert.equal(p.spots[0].role, 'start', p.id);
    for (const s of p.spots) {
      assert.match(s.caption, /^(Start|Highlight|Climb|Summit|Along)( · .+)?$/, `${p.id}: ${s.caption}`);
      assert.ok(s.render.park && (s.render.view || Number.isFinite(s.render.s)), `${p.id}: ${JSON.stringify(s.render)}`);
      assert.ok(src.catalog.some((c) => c.id === s.render.park), `${p.id}: world ${s.render.park}`);
    }
    assert.equal(new Set(p.spots.map((s) => imageName(s.render))).size, p.spots.length, `${p.id}: three different pictures`);
  }
});

// (F270: until the full render, some routes have no pictures yet — the menu then shows none — so this checks what
// is listed, not that every route is)
test('the manifest lists menu routes with their pictures, within the size budget', () => {
  assert.ok(existsSync(new URL(PREVIEW_INDEX, root)), 'routes/previews/index.json (node tools/build_previews.mjs)');
  const m = JSON.parse(read(PREVIEW_INDEX));
  assert.equal(m.format, 'bikefree-previews-1');
  assert.equal(m.size, '480x270');
  let total = 0;
  const files = new Set();
  assert.ok(Object.keys(m.routes).length > 0, 'some routes have pictures');
  for (const [id, list] of Object.entries(m.routes)) {
    assert.ok(expected.includes(id), `${id} is a route in the menu`);
    assert.ok(list.length >= 1 && list.length <= 3, `${id}: ${list.length} pictures`);
    for (const s of list) {
      const f = new URL(`routes/previews/${s.file}`, root);
      assert.ok(existsSync(f), s.file);
      if (!files.has(s.file)) { files.add(s.file); total += statSync(f).size; }
      assert.ok(statSync(f).size < 45 * 1024, `${s.file}: ${statSync(f).size} bytes`);
      const head = readFileSync(f).subarray(0, 12).toString('latin1');
      assert.ok(head.startsWith('RIFF') && head.endsWith('WEBP'), `${s.file} is a WebP`);
    }
  }
  assert.ok(total < 8 * 1024 * 1024, `${(total / 1048576).toFixed(2)} MB of pictures`);
  assert.equal(m.images, files.size);
});

test('a route with no pictures shows none', () => {
  const app = appSource();
  assert.match(app, /box\.hidden = !shownShots\.length/);
  assert.deepEqual(previewShots({ format: 'bikefree-previews-1', routes: {} }, 'pgh-long'), []);
  assert.equal(shotsHtml([]), '');
});

test('previewShots: riding order, cache-busting URL, caption split, bad entries dropped', () => {
  const m = { format: 'bikefree-previews-1', routes: { r: [
    { file: 'b-200.webp', caption: 'Highlight · Smithfield Street Bridge', role: 'highlight', atM: 900, v: 'abc' },
    { file: 'b-20.webp', caption: 'Start · the Water Steps', role: 'start', atM: 20 },
    { file: '../evil.webp', caption: 'x', atM: 5 },
    { file: 'b-300.webp', caption: 'Climb · Canton Ave, 26 %', role: 'climb', atM: 500 },
  ] } };
  const s = previewShots(m, 'r');
  assert.deepEqual(s.map((x) => x.file), ['b-20.webp', 'b-300.webp', 'b-200.webp']);
  assert.equal(s[2].url, 'routes/previews/b-200.webp?v=abc');
  assert.deepEqual([s[1].word, s[1].place], ['Climb', 'Canton Ave, 26 %']);
  assert.deepEqual(previewShots(m, 'none'), []);
  assert.deepEqual(previewShots(null, 'r'), []);
  const html = shotsHtml([{ ...s[0], caption: 'Start · <b>&', place: '<b>&' }]);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /data-shot="0"/);
  assert.ok(!html.includes('<b>&'), 'escaped');
});

test('the menu shows them: preview pane strip, enlarge dialog, offline cache', () => {
  const html = read('index.html'), app = appSource(), sw = read('sw.js'), assets = read('sw-assets.js');
  assert.match(html, /id="pvShots"/);
  assert.match(html, /<dialog id="shotDlg"/);
  assert.match(app, /from '\.\.\/route-previews\.js'/);
  assert.match(app, /renderShots\(r\)/);
  assert.match(sw, /PREVIEW_CACHE/);
  assert.match(sw, /routes\/previews\//);
  assert.ok(assets.includes('"routes/previews/index.json"'), 'the manifest is precached');
  assert.ok(!/routes\/previews\/[^"]+\.webp/.test(assets), 'the pictures are not');
  assert.ok(assets.includes('"js/route-previews.js"'));
});

test('the full-screen city panel shows the selected route\'s pictures below its map (7.1)', () => {
  const html = read('index.html'), app = appSource(), css = read('css/style.css');
  // in the panel's body, after the map column (below the map), before the route list
  const body = html.slice(html.indexOf('<div class="city-body">'), html.indexOf('<ul class="city-list"'));
  assert.ok(body.indexOf('id="cityShots"') > body.indexOf('id="cityMapHint"'), 'below the map');
  assert.ok(body.indexOf('id="cityShots"') < body.indexOf('<div class="city-side">'), 'not in the route list column');
  assert.match(body, /class="pv-shots city-shots" id="cityShots" hidden/);
  // drawn on every pick (list or map: both go through renderCity) for the selected item's route id
  assert.match(app, /renderCityShots\(sel \? sel\.routeId : null\)/);
  assert.match(app, /box\.hidden = !cityShotList\.length/);
  assert.match(app, /showShot\(Number\(b\.dataset\.shot\), cityShotList\)/);
  // desktop: the map column's second row; phone/tablet: one column, a swipeable strip
  assert.match(css, /\.city-shots \{ grid-column: 1; grid-row: 2;/);
  assert.match(css, /\.city-side \{ grid-column: 2; grid-row: 1 \/ span 2; \}/);
  // the pictures are lazy (the same strip HTML as the menu)
  assert.match(shotsHtml(previewShots({ format: 'bikefree-previews-1', routes: { a: [{ file: 'x-1.webp', caption: 'Start · A' }] } }, 'a')), /loading="lazy"/);
});
