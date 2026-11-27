// [review 27 Nov] The app's side of the reliability fixes (js/app/): one tick per timer steps the pacer and the FTP test
// by the session's running steps (A12), and the first offline download asks to keep the site's storage (A4).
// The functions are lifted from their source and run on small fakes. (The menu's Finish ride button, A5, is driven in a
// DOM in test/dom-menu.test.mjs; the save before the recovery copy goes, A2, the flush when the page is hidden, A9,
// and the summary's hold on auto resume, A10, in test/dom-ride.test.mjs.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
/** The text of `function name(...) { ... }` in a source file (up to the first closing brace at column 0). */
function fnSource(src, name) {
  const i = src.indexOf(`function ${name}(`);
  assert.ok(i >= 0, `no function ${name}`);
  const j = src.indexOf('\n}\n', i);
  return src.slice(i, j + 2);
}

test('A12: the FTP test counts the session\'s running steps, whatever the timer rate', () => {
  const src = read('js/app/hud.js');
  const seg = { ftpTest: true }, w = { ftpTest: true };
  const session = { mode: 'workout', workout: w, running: true, segment: seg, power: 300 };
  const run = new Function('session', 'performance', `let ftpRun = null, ftpLast = 0; ${fnSource(src, 'trackFtpTest')}; return { step: trackFtpTest, get run() { return ftpRun; } };`)(session, { now: () => 0 });
  for (let i = 0; i < 60; i++) run.step(8, 0.25);   // a 2 s catch-up each time (8 steps): 2 minutes
  assert.ok(Math.abs(run.run.secs - 120) < 1e-9, `${run.run.secs} s of test`);
  assert.ok(Math.abs(run.run.sum / run.run.secs - 300) < 1e-9);
  run.step(0, 0.25);   // paused (no running steps): no time
  assert.ok(Math.abs(run.run.secs - 120) < 1e-9);
  // the tick handler hands the steps on, once per timer. (A regex: the test's 20-minute effort comes 20+ minutes into
  // the workout, too long to ride in the DOM tests; the pacer's share of the same handler is driven there, A12 in
  // test/dom-ride.test.mjs.)
  assert.match(src, /session\.addEventListener\('tick', \(e\) => \{\n\s+const \{ runSteps = 0, dt = 0\.25 \} = e\.detail \|\| \{\};[^]*?trackFtpTest\(runSteps, dt\);/);
});

// (A regex: the download is offered only for your own GPX routes — every catalog route's scenery is bundled — and runs
// thousands of tile fetches into the Cache API; the persist request itself is tested in test/store.test.mjs.)
test('A4: the first explicit offline download asks the browser to keep the site\'s storage', () => {
  assert.match(read('js/app/offline-ui.js'), /store\.persistStorage\(\);[^\n]*\n\s+offlineAbort = new AbortController\(\);/);
});
