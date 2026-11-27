// [review 27 Nov] The app's side of the reliability fixes (js/app/): the menu's Finish ride button isn't rebuilt every
// tick (A5); one tick per timer steps the pacer and the FTP test by the session's running steps (A12); a finished
// ride is saved before its recovery copy goes, with the .fit offered if it can't be (A2); the recovery copy is
// flushed when the page is hidden and recovery's errors are caught (A9); and the summary holds auto resume (A10).
// The DOM-bound functions are lifted from their source and run on small fakes.
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

test('A5: the start note is built once while a ride is in progress; only its time and distance change', () => {
  const src = read('js/app/route-options.js');
  let rebuilds = 0, html = '';
  const els = { startBtn: {}, startNoteRide: { textContent: '' }, finishFromMenu: { addEventListener() {} } };
  els.startNote = { dataset: {}, get innerHTML() { return html; }, set innerHTML(v) { rebuilds++; html = v; els.startNoteRide = { textContent: '' }; } };
  const session = { hasRide: true, movingS: 0, distanceM: 0 };
  const renderStart = new Function('$', 'session', 'trainer', 'sameAsCurrent', 'fmtTime', 'fmtDist', 'distUnit', 'openSummary',
    `${fnSource(src, 'renderStart')}; return renderStart;`)((id) => els[id], session, { connected: true }, () => true,
    (s) => `${s}s`, (m) => (m / 1000).toFixed(2), () => 'km', () => {});
  for (let i = 0; i < 40; i++) { session.movingS = i; session.distanceM = i * 2.5; renderStart(); }
  assert.equal(rebuilds, 1, `the note (and its Finish ride button) was rebuilt ${rebuilds} times in 10 s`);
  assert.match(html, /id="finishFromMenu"/);
  assert.equal(els.startNoteRide.textContent, '39s · 0.10 km');
  session.hasRide = false; renderStart();
  assert.equal(rebuilds, 2);
  assert.match(html, /Recording starts/);
  // the click is handled on the note (it outlives the button), not on each new button
  assert.match(src, /\$\('startNote'\)\.addEventListener\('click', \(e\) => \{ if \(e\.target\.closest\('#finishFromMenu'\)\) openSummary\(\); \}\)/);
  assert.doesNotMatch(fnSource(src, 'renderStart'), /addEventListener/);
});

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
  // the tick handler hands the steps on, once per timer
  assert.match(src, /session\.addEventListener\('tick', \(e\) => \{\n\s+const \{ runSteps = 0, dt = 0\.25 \} = e\.detail \|\| \{\};[^]*?trackFtpTest\(runSteps, dt\);\n\s+stepPacer\(runSteps\);/);
  const pacer = read('js/app/pacer-ui.js');
  assert.match(fnSource(pacer, 'stepPacer'), /for \(let i = 0; i < runSteps; i\+\+\) stepPacerOnce\(dt\);/);
});

test('A2: a finished ride is saved before its recovery copy goes; if it can\'t be, its .fit is offered', () => {
  const src = read('js/app/summary.js'), open = fnSource(src, 'openSummary');
  const save = open.indexOf('store.saveFinishedRide(finished)');
  assert.ok(save > 0, 'openSummary saves with saveFinishedRide (save, then clear the copy)');
  // the recovery copy is cleared before the save only for a discarded ride
  const clear = open.indexOf('store.saveCurrent(null)');
  assert.ok(clear < 0 || /if \(!finished \|\| v === 'discard'\) \{ await store\.saveCurrent\(null\)/.test(open), 'the copy is cleared before the save');
  assert.match(open, /!saved && confirm\([^]*?\.fit file[^]*?downloadFit\(finished\)/);
});

test('A9: the recovery copy is flushed when the page is hidden; recovery errors are caught', () => {
  const src = read('js/app/summary.js');
  assert.match(src, /setInterval\(flushRecovery, 15000\)/);
  assert.match(src, /addEventListener\('pagehide', flushRecovery\)/);
  assert.match(src, /document\.addEventListener\('visibilitychange', \(\) => \{ if \(document\.visibilityState === 'hidden'\) flushRecovery\(\); \}\)/);
  const rec = fnSource(src, 'checkRecovery');
  assert.match(rec, /try \{[^]*store\.saveRide\(cur, \{ clearCurrent: true \}\)[^]*\} catch \(err\) \{\n\s+log\(/);
});

test('A10: the summary holds auto resume while it is open', () => {
  const open = fnSource(read('js/app/summary.js'), 'openSummary');
  assert.match(open, /session\.holdResume = true;/);
  assert.match(open, /dlg\.onclose = async \(\) => \{\n\s+session\.holdResume = false;/);
});

test('A4: the first explicit offline download asks the browser to keep the site\'s storage', () => {
  assert.match(read('js/app/offline-ui.js'), /store\.persistStorage\(\);[^\n]*\n\s+offlineAbort = new AbortController\(\);/);
});
