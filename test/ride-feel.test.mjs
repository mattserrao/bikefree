// ride-feel-test: Hill feel (grade scaling like Zwift's trainer difficulty) and the felt grade's shaping (PLAN 6.11;
// the ride through a hill, a crest and a descent is in test/hill-feel.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GEAR_RATIOS, ergTargetForGear, feltGrade, shapeGrade, momentumGrade, HILL_FEEL_DEFAULT, HILL_FEEL_OPTIONS } from '../js/physics.js';
import { readFileSync } from 'node:fs';
import { CHASE, CHASE_CLASSIC, CHASE_CLOSE, CHASE_CLOSEST, CAMERAS, DEFAULT_CAMERA } from '../js/world/pose.js';
import { DEFAULT_SETTINGS, loadSettings } from '../js/settings.js';

test('Hill feel defaults to 50% like Zwift and scales grade only', () => {
  assert.equal(HILL_FEEL_DEFAULT, 50);
  assert.equal(DEFAULT_SETTINGS.hillFeel, 50);
  assert.deepEqual(HILL_FEEL_OPTIONS, [25, 50, 75, 100]);
  assert.equal(feltGrade(4, 50), 2);
  assert.equal(feltGrade(-6, 25), -1.5);
  assert.equal(feltGrade(3, 100), 3);
  assert.equal(feltGrade(0, 50), 0);   // flat riding is untouched
});

test('at 50% a 1% hill asks for far less of a jump than full physics', () => {
  const r = GEAR_RATIOS[11];
  const flat = ergTargetForGear(85, r, 0), full = ergTargetForGear(85, r, 1), half = ergTargetForGear(85, r, feltGrade(1, 50));
  assert.ok(full / flat > 1.6, `full ${full} vs flat ${flat}`);
  assert.ok(half / flat < 1.4, `half ${half} vs flat ${flat}`);
});

test('the felt grade blends in over distance and changes at most 1 %/s', () => {
  assert.equal(shapeGrade(null, 3, 7, 0.25), 3);
  let g = 0;
  const steps = [];
  for (let t = 0; t < 12; t += 0.25) { const n = shapeGrade(g, 3, 7, 0.25); steps.push(n - g); g = n; }
  assert.ok(Math.max(...steps) <= 0.25 + 1e-9, 'never over 1 %/s');
  assert.ok(g > 2.95, `settled after ~12 s: ${g}`);
  // longer at speed (in distance): after 20 m, a slow bike is further along than a fast one, which covered it in less time
  const after20m = (v) => { let x = 0; for (let d = 0; d < 20; d += v * 0.25) x = shapeGrade(x, 0.5, v, 0.25); return x; };
  assert.ok(after20m(3) > after20m(12), `${after20m(3)} vs ${after20m(12)}`);
  // stopped (free ride ▲ ▼ at a standstill) it still arrives
  let s0 = 0; for (let t = 0; t < 10; t += 0.25) s0 = shapeGrade(s0, 1, 0, 0.25);
  assert.ok(s0 > 0.95);
});

test('momentum lets the hill through more slowly when the bike is faster', () => {
  const after = (v) => { let x = 0; for (let t = 0; t < 3; t += 0.25) x = momentumGrade(x, 3, v, 0.25); return x; };
  assert.ok(after(4) > after(7) && after(7) > after(10), `${after(4)} ${after(7)} ${after(10)}`);
  assert.equal(momentumGrade(null, 2, 7, 0.25), 2);
});

test('close is the default camera again (user, 23 Nov); closest is the Zwift-style chase (7.2b); close is nearer than classic', () => {
  assert.equal(DEFAULT_CAMERA, 'close');
  assert.equal(CHASE, CAMERAS.close);
  assert.equal(CHASE, CHASE_CLOSE);
  assert.deepEqual(Object.keys(CAMERAS).sort(), ['classic', 'close', 'closest']);
  assert.equal(DEFAULT_SETTINGS.camera, 'close');
  const d = (c) => Math.hypot(c.back, c.up);
  assert.ok(d(CHASE_CLASSIC) / d(CHASE_CLOSE) > 1.25);
  assert.ok(d(CHASE_CLOSEST) > d(CHASE_CLASSIC), `7.2b: the Zwift-style chase sits further back than classic (${d(CHASE_CLOSEST)})`);
  // the back wheel (hub 0.41 m behind the rider's origin, 0.336 m radius: models/rider.json) is in front of the camera and
  // below its view centre, and the camera stays well clear of the rider's helmet (~1.6 m up)
  for (const c of Object.values(CAMERAS)) {
    assert.ok(c.back > .41 + .336 + 1, `${JSON.stringify(c)} too close to the wheel`);
    assert.ok(c.up >= 1.4 && c.ground >= 1.4, `${JSON.stringify(c)} too low`);
  }
  // 7.2: Closest is closer and higher than 6.10's (2.3 m back, 1.5 m up), aimed down so the back wheel sits just over
  // the power bar (measured 1440×900 and 390×844): the look point well below the road ahead
  assert.ok(CHASE_CLOSEST.back >= 5.5 && CHASE_CLOSEST.up >= 2.2 && CHASE_CLOSEST.fov <= 52, JSON.stringify(CHASE_CLOSEST));   // 7.2b: Zwift-style
  const pitch = Math.atan2(CHASE_CLOSEST.up - CHASE_CLOSEST.lookUp, CHASE_CLOSEST.back + CHASE_CLOSEST.ahead) * 180 / Math.PI;
  assert.ok(pitch > 5 && pitch < 12, `aimed ${pitch.toFixed(1)}° down`);
  // Close and Classic unchanged
  assert.deepEqual(CHASE_CLOSE, { back: 3.3, up: 1.8, ahead: 7, lookUp: -0.4, ground: 1.6, fov: 58, speedFov: 10, pull: 0.25, buzz: 0.01 });
  assert.deepEqual(CHASE_CLASSIC, { back: 4.5, up: 2.1, ahead: 8, lookUp: -0.6, ground: 1.6, fov: 62, speedFov: 0, pull: 0, buzz: 0 });
  // Settings → Camera offers all three, Close first and marked the default
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const opts = [...html.match(/<select name="camera">([\s\S]*?)<\/select>/)[1].matchAll(/value="(\w+)"[^>]*>([^<]*)/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(opts.map((o) => o[0]), ['close', 'closest', 'classic']);
  assert.match(opts[0][1], /default/);
  assert.ok(!/default/.test(opts[1][1]) && !/default/.test(opts[2][1]));
});

test('saved camera settings: "closest" moves to the default "close" once (23 Nov); a later choice is kept', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  const KEY = 'bikefree.settings.v1';
  const save = (o) => localStorage.setItem(KEY, JSON.stringify(o));
  try {
    // nothing saved: the default
    assert.equal(loadSettings().camera, 'close');
    // saved with the 19 Nov default
    save({ camera: 'closest', camClosest: true, units: 'metric' });
    let s = loadSettings();
    assert.equal(s.camera, 'close');
    assert.equal(s.units, 'metric');
    // … once: Chase chosen again afterwards (saved with the migration's mark) stays Chase
    save({ ...s, camera: 'closest' });
    assert.equal(loadSettings().camera, 'closest');
    // Classic is kept
    save({ camera: 'classic' });
    assert.equal(loadSettings().camera, 'classic');
  } finally { delete globalThis.localStorage; }
});
