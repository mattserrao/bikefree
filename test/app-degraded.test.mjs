// [review 27 Nov] A graph world's readiness() returns `degraded` (the parts that failed to load: landmarks, bridges,
// the city) while the rest of the map rides on (wave 1, js/world/graph-world.js). The ride screen shows a small,
// non-blocking note when it's non-empty (js/app/ride-screen.js), checked while loading and every 2 s on the ride.
// The DOM-bound functions are lifted from their source and run on small fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const src = read('js/app/ride-screen.js');

function lift() {
  const a = src.indexOf('const DEGRADED_NAMES');
  const b = src.indexOf('\n', src.indexOf('function resetDegraded('));
  assert.ok(a > 0 && b > a, 'the degraded note\'s code');
  const note = Object.assign(new EventTarget(), { hidden: true, textContent: '' });
  const logs = [];
  const make = new Function('$', 'log', `let world = null, onRideScreen = false;
    ${src.slice(a, b)}
    return { renderDegraded, checkDegraded, resetDegraded, set(w, on) { world = w; onRideScreen = on; } };`);
  const api = make((id) => { assert.equal(id, 'worldNote'); return note; }, (...x) => logs.push(x));
  return { ...api, note, logs };
}

test('the note shows the failed parts, once, and hides when there are none', () => {
  const d = lift();
  d.renderDegraded({ ready: true, steps: [] });   // a world without `degraded` (world.js, endless)
  assert.ok(d.note.hidden);
  d.renderDegraded({ degraded: [] });
  assert.ok(d.note.hidden);
  d.renderDegraded({ degraded: ['landmarks'] });
  assert.ok(!d.note.hidden);
  assert.match(d.note.textContent, /couldn’t load \(landmarks\)/);
  assert.equal(d.logs.length, 1);
  d.renderDegraded({ degraded: ['landmarks'] });
  assert.equal(d.logs.length, 1, 'logged again for the same parts');
  d.renderDegraded({ degraded: ['landmarks', 'city'] });
  assert.match(d.note.textContent, /landmarks, buildings and trees/);
  assert.equal(d.logs[1][2], 'warn', 'a warning in the log, not an error toast');
  d.resetDegraded();
  assert.ok(d.note.hidden);
});

test('on the ride it is checked every 2 s (a part can fail after the start), not off the ride screen', () => {
  const d = lift();
  let calls = 0, degraded = [];
  d.set({ readiness: () => { calls++; return { degraded }; } }, true);
  d.checkDegraded(10_000);
  d.checkDegraded(10_500);
  assert.equal(calls, 1);
  degraded = ['bridges'];
  d.checkDegraded(12_100);
  assert.equal(calls, 2);
  assert.ok(!d.note.hidden);
  assert.match(d.note.textContent, /bridges/);
  d.set({ readiness: () => { calls++; return {}; } }, false);
  d.checkDegraded(20_000);
  assert.equal(calls, 2);
  d.set(null, true);
  d.checkDegraded(30_000);   // (no 3D view)
});

test('the wiring: the loading screen\'s poll, the ride\'s tick, a new world resets it, a tap dismisses it', () => {
  const fn = (name) => { const i = src.indexOf(`function ${name}(`); return src.slice(i, src.indexOf('\n}\n', i)); };
  assert.match(fn('pollLoad'), /const r = world\.readiness\(\);\n\s*renderDegraded\(r\);/);
  assert.match(fn('holdForWorld'), /checkDegraded\(\);/);
  assert.match(fn('openWorld'), /resetDegraded\(\);/);
  assert.match(src, /\$\('worldNote'\)\.addEventListener\('click', \(\) => \{ \$\('worldNote'\)\.hidden = true; \}\)/);
  assert.match(read('js/app/hud.js'), /holdForWorld\(\);/);
  assert.match(read('index.html'), /<div class="world-note" id="worldNote" role="status"[^>]* hidden><\/div>/);
  assert.match(read('css/style.css'), /\.world-note \{/);
});
