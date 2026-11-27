// Finishing a ride: the summary, the saved-ride history and crash recovery.
// (Part of the app: js/app.js imports every module in js/app/.)
import { rideToFit, fitFilename, summarize } from '../recorder.js';
import * as store from '../store.js';
import { ftpFromTwentyMinutes } from '../workout.js';
import { $, log, profiles, session, imperial, fmtDist, distUnit, fmtElev, elevUnit, fmtTime, escapeHtml } from './core.js';
import { showSetup } from './ride-screen.js';
import { ftpRun } from './hud.js';
import { riderName, statFacts, renderProfile, useActiveProfile } from './profiles-ui.js';

// ---------- Ride summary / finishing ----------
function statCells(sum) {
  const cells = [
    ['Time', fmtTime(sum.timerS)],
    ['Distance', `${fmtDist(sum.distanceM)} ${distUnit()}`],
    ['Avg power', `${Math.round(sum.avgPower)} W`],
    ['Normalized', sum.np ? `${Math.round(sum.np)} W` : '—'],
    ['Max power', `${Math.round(sum.maxPower)} W`],
    ['Avg cadence', `${Math.round(sum.avgCadence)} rpm`],
    ['Avg speed', `${(imperial() ? sum.avgSpeed * 2.23694 : sum.avgSpeed * 3.6).toFixed(1)} ${imperial() ? 'mph' : 'km/h'}`],
    ['Climbed', `${fmtElev(sum.ascentM)} ${elevUnit()}`],
    ['Energy', `${Math.round(sum.kj)} kJ`],
    ['Avg HR', sum.avgHr ? `${Math.round(sum.avgHr)} bpm` : '—'],
  ];
  return cells.map(([k, v]) => `<div><div class="label">${k}</div><div class="value">${v}</div></div>`).join('');
}

function lapTable(r) {
  if (!r.laps || r.laps.length < 2) return '';
  const rows = r.laps.map((lap, i) => {
    const s = summarize(r.samples, lap.startIdx, lap.endIdx, lap.startT, lap.endT);
    return `<tr><td>${i + 1}</td><td>${escapeHtml(lap.label || '')}</td><td>${fmtTime(s.timerS)}</td>` +
      `<td>${Math.round(s.avgPower)} W</td><td>${Math.round(s.maxPower)} W</td><td>${s.avgHr ? Math.round(s.avgHr) : '—'}</td></tr>`;
  }).join('');
  return `<table><thead><tr><th>#</th><th>Lap</th><th>Time</th><th>Avg</th><th>Max</th><th>HR</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderFtpResult() {
  const box = $('sumFtp');
  box.hidden = !(ftpRun && ftpRun.secs > 30 && session.workout === ftpRun.workout);
  if (box.hidden) return;
  const p = profiles.active;
  if (ftpRun.secs < 19 * 60) {
    box.innerHTML = `<span><b>FTP test incomplete</b> — ${fmtTime(ftpRun.secs)} of the 20-minute effort. Ride the full 20 minutes for a result.</span>`;
    return;
  }
  const avg = ftpRun.sum / ftpRun.secs, ftp = ftpFromTwentyMinutes(avg);
  box.innerHTML = `<span>FTP test<br><b class="big">${ftp} W</b></span>
    <span class="muted small">95% of your 20-minute average (${Math.round(avg)} W). Current FTP: ${p.ftp} W.</span>
    <button type="button" class="primary" id="ftpSave">Save ${ftp} W to ${escapeHtml(riderName(p))}'s profile</button>`;
  $('ftpSave').addEventListener('click', () => {
    profiles.update(p.id, { ftp });
    useActiveProfile();
    $('ftpSave').disabled = true;
    $('ftpSave').textContent = `Saved — FTP is now ${ftp} W`;
    log('app', `FTP updated to ${ftp} W from a 20-minute test`, 'ok');
  });
}

function openSummary(title) {
  if ($('summary').open) return;
  const snap = session.recorder.snapshot(session.rideMeta());
  if (!snap) {
    alert('Nothing recorded yet — start pedalling first.');
    return;
  }
  const wasRunning = session.running;
  if (wasRunning) session.pause();
  session.holdResume = true;   // [review 27 Nov] an auto-paused ride doesn't resume behind the dialog when you pedal
  $('sumTitle').textContent = title || 'Finish ride?';
  $('sumSub').textContent = `${snap.name} · ${new Date(snap.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`;
  $('sumGrid').innerHTML = statCells(snap.summary);
  $('sumLaps').innerHTML = lapTable(snap);
  renderFtpResult();
  const dlg = $('summary');
  dlg.returnValue = '';
  dlg.onclose = async () => {
    session.holdResume = false;
    const v = dlg.returnValue;
    if (v === 'resume' || v === '') {
      if (wasRunning) session.start();
      return;
    }
    if (v === 'discard' && !confirm('Discard this ride? It will not be saved.')) {
      if (wasRunning) session.start();
      return;
    }
    const finished = session.finish();
    if (!finished || v === 'discard') { await store.saveCurrent(null).catch(() => {}); log('app', 'Ride discarded'); showSetup(); return; }
    finished.profileId = profiles.active.id;
    // [review 27 Nov] save first; the crash-recovery copy is cleared only once the ride is saved (it was cleared
    // before, so a failed save — a full disk — lost the ride). On failure the ride stays the recovery copy, and its
    // .fit is offered so it isn't lost.
    let saved = false;
    try {
      await store.saveFinishedRide(finished);
      saved = true;
      log('app', `Ride saved: ${finished.name}, ${fmtTime(finished.summary.timerS)}`, 'ok');
    } catch (err) {
      log('app', `Could not save ride: ${err?.message || err}`, 'error');
    }
    if (v === 'download' || (!saved && confirm('This ride couldn\'t be saved in the browser (is the disk full?). Download its .fit file so it isn\'t lost?'))) downloadFit(finished);
    renderProfile();
    showSetup();
  };
  dlg.showModal();
}

function downloadFit(r) {
  const bytes = rideToFit(r);
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fitFilename(r);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  log('app', `Downloaded ${a.download}`, 'ok');
}

// ---------- History ----------
async function renderHistory() {
  const list = $('histList');
  const p = profiles.active;
  const all = await store.listRides().catch(() => []);
  const rides = all.filter((r) => profiles.ownerOf(r) === p.id);
  $('histTitle').textContent = `${riderName(p)} — saved rides`;
  const st = profiles.stats(p.id, all);
  $('histTotals').innerHTML = rides.length ? statFacts(st) : '';
  if (!rides.length) { list.innerHTML = '<p class="muted">No saved rides yet.</p>'; return; }
  list.innerHTML = rides.map((r) => `
    <div class="hist-row" data-id="${r.id}">
      <div class="hist-main">
        <div class="hist-name">${escapeHtml(r.name || 'Ride')}${r.recovered ? ' <span class="warn">(recovered)</span>' : ''}</div>
        <div class="muted">${new Date(r.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} ·
          ${fmtTime(r.summary.timerS)} · ${fmtDist(r.summary.distanceM)} ${distUnit()} · ${Math.round(r.summary.avgPower)} W avg ·
          ${fmtElev(r.summary.ascentM)} ${elevUnit()}</div>
      </div>
      <button type="button" data-act="fit">.fit</button>
      <button type="button" data-act="del" class="ghost">Delete</button>
    </div>`).join('');
}
$('histList').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = Number(btn.closest('.hist-row').dataset.id);
  if (btn.dataset.act === 'fit') {
    const r = await store.getRide(id);
    if (r) downloadFit(r);
  } else if (btn.dataset.act === 'del' && confirm('Delete this ride?')) {
    await store.deleteRide(id);
    renderHistory();
    renderProfile();
  }
});
$('historyBtn').addEventListener('click', async () => { await renderHistory(); $('history').showModal(); });

// ---------- Crash recovery ----------
// A snapshot of the ride every 15 s, and ([review 27 Nov]) at once when the page is hidden or put away (a closed tab
// or a phone's app switch would lose up to 15 s otherwise).
function flushRecovery() {
  if (!session.hasRide) return;
  const snap = session.recorder.snapshot(session.rideMeta());
  if (snap) store.saveCurrent(snap).catch((err) => log('app', `Could not keep the ride's recovery copy: ${err?.message || err}`, 'debug'));
}
setInterval(flushRecovery, 15000);
addEventListener('pagehide', flushRecovery);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushRecovery(); });

async function checkRecovery() {
  // ([review 27 Nov] caught and logged: it ran at boot with no catch, so a failed save was an unhandled rejection —
  // and the copy is kept, to be offered again, when it can't be saved)
  try {
    const cur = await store.getCurrent().catch(() => null);
    if (!cur || !cur.samples?.length) return;
    const when = new Date(cur.startedAt).toLocaleString();
    if (confirm(`An unfinished ride from ${when} (${fmtTime(cur.summary.timerS)}) was found. Save it to your rides?`)) {
      cur.profileId ??= profiles.active.id;
      await store.saveRide(cur, { clearCurrent: true });
      log('app', 'Recovered unfinished ride and saved it', 'ok');
      renderProfile();
    } else await store.saveCurrent(null);
  } catch (err) {
    log('app', `Could not recover the unfinished ride: ${err?.message || err}`, 'error');
  }
}

export { openSummary, checkRecovery };
