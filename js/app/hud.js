// The ride HUD: numbers, power bar, elevation profile, turn prompts and the diagnostics.
// (Part of the app: js/app.js imports every module in js/app/.)
import { MI_PER_KM } from '../settings.js';
import { averageGradeAhead, legSpan } from '../gpx.js';
import { targetWatts, zoneColor, ftpFromTwentyMinutes } from '../workout.js';
import { drawProfile, drawWorkout, gradeColor } from '../views.js';
import { ScreenAwake } from '../wakelock.js';
import {
  $, log, settings, trainer, hrStrap, session, imperial, fmtDist, distUnit, fmtElev, elevUnit, fmtTime, readable,
  fmtGrade, escapeHtml,
} from './core.js';
import { pausedByUser, renderStart } from './route-options.js';
import { pacer, stepPacer, pacerGap, fmtGap } from './pacer-ui.js';
import { onRideScreen, loadRun, holdForWorld, renderMinimap, world } from './ride-screen.js';

// ---------- Ride HUD ----------
const ZONES = [[0, 0.55, 'Z1'], [0.55, 0.76, 'Z2'], [0.76, 0.9, 'Z3'], [0.9, 1.05, 'Z4'], [1.05, 1.19, 'Z5'], [1.19, 99, 'Z6']];
const ZONE_MID = [0.4, 0.65, 0.83, 0.97, 1.12, 1.3];
const barMax = () => Math.max(400, Math.round((settings.ftp * 1.7) / 50) * 50);
const showRow = (n, value, label) => {
  $(`hRow${n}Box`).hidden = value == null;
  if (value == null) return;
  $(`hRow${n}`).textContent = value;
  $(`hRow${n}L`).textContent = label;
};

// Zone bar: six segments sized by their watt range, each filling in its own zone colour.
let zSegs = [];
function buildZoneBar() {
  const bar = $('zBar');
  bar.innerHTML = '';
  const max = barMax();
  zSegs = ZONES.map(([lo, hi], i) => {
    const a = lo * settings.ftp, b = Math.min(hi * settings.ftp, max);
    const seg = document.createElement('span');
    seg.className = 'zseg';
    seg.style.flex = `${Math.max(0, b - a)} 0 0`;
    seg.style.setProperty('--c', zoneColor(ZONE_MID[i]));
    seg.append(document.createElement('i'));
    bar.append(seg);
    return { seg, a, b };
  }).filter((z) => z.b > z.a);
  const tick = document.createElement('u');
  tick.id = 'zTarget';
  tick.hidden = true;
  bar.append(tick);
}

let lastTitle = '', titleTimer = 0;
function renderHudStatic() {
  $('hTitle').textContent = session.mode === 'route' && session.route
    ? (session.route.park ? `${session.route.name} · ${session.route.park}` : session.route.name)
    : session.mode === 'workout' && session.workout ? session.workout.name : 'Free ride';
  if ($('hTitle').textContent !== lastTitle) {
    lastTitle = $('hTitle').textContent;
    $('hTitle').classList.add('show');
    clearTimeout(titleTimer);
    titleTimer = setTimeout(() => $('hTitle').classList.remove('show'), 5000);
  }
  buildZoneBar();
  lastProfileDraw = 0;
}

let lastProfileDraw = 0, lastProfileKey = '';
const redrawRideProfile = () => { lastProfileDraw = 0; };
/**
 * The ride-screen profile's stretch (span) and height scale (eleRange). A network route's path changes as you
 * choose turns (and refills as you ride): its NetRide.profileView follows the path as it is now — the lap as
 * you'll ride it, else the way ahead — rebuilt once per path change (`version`) and segment, not per frame
 * (PLAN F150). `key` changes when the stretch does, so the strip is redrawn at once.
 */
let finishView = null;
function hudProfileView() {
  const r = session.route, net = r.netRide;
  if (r.endlessRide) { const p = session.routePos, k = Math.floor(p / 400); return { key: `e${r.endlessRide.version}:${k}`, span: [Math.max(0, k * 400 - 800), k * 400 + 3200], eleRange: null }; }   // [endless] the road around you
  if (!net) return { key: '', span: session.routeFinishM != null ? legSpan(r, session.routeStart) : null, eleRange: null };
  if (session.routeFinishM != null) {
    // a planned finish: the start to the finish line, on the path as it is now
    const from = session.routeStart, to = from + session.routeFinishM, key = `f${net.version}:${from}:${to}`;
    if (finishView?.key !== key) { const v = net.eleRange(from, to); finishView = { key, span: [from, to], eleRange: [v.minEle, v.maxEle] }; }
    return finishView;
  }
  const v = net.profileView(session.routePos);
  return { key: v.key, span: [v.from, v.to], eleRange: [v.minEle, v.maxEle] };
}
let lastGear = session.gear;
function renderHud() {
  if (!onRideScreen) return;
  const kph = session.speedMps * 3.6;
  $('hTime').textContent = fmtTime(session.movingS);
  $('hDist').textContent = fmtDist(session.distanceM, session.distanceM < 16000 ? 2 : 1);
  $('hDistU').textContent = distUnit();
  $('hSpeed').textContent = (imperial() ? kph * MI_PER_KM : kph).toFixed(1);
  $('hSpeedU').textContent = imperial() ? 'mph' : 'km/h';

  // Power: 3-second power. Zone 1 stays white for contrast; higher zones take their colour.
  const p3 = session.power3s;
  const pct = settings.ftp ? p3 / settings.ftp : 0;
  const zi = Math.max(0, ZONES.findIndex(([lo, hi]) => pct >= lo && pct < hi));
  const zc = zoneColor(ZONE_MID[zi]);
  $('hPower').textContent = Math.round(p3);
  $('hPower').style.color = zi > 0 ? readable(zc) : '';
  $('hZone').textContent = ZONES[zi][2];
  $('hZone').style.background = zi > 0 ? zc : '';
  $('hZone').style.color = zi > 0 ? '#1d1d1c' : '';
  for (const z of zSegs) z.seg.firstChild.style.width = `${Math.max(0, Math.min(1, (p3 - z.a) / (z.b - z.a))) * 100}%`;
  const tw = session.workoutTarget;
  const tick = $('zTarget');
  if (tick) {
    tick.hidden = tw == null;
    if (tw != null) tick.style.left = `${Math.min(100, (tw / barMax()) * 100)}%`;
  }
  $('hPowerSub').hidden = tw == null;
  if (tw != null) $('hPowerSub').textContent = `target ${tw} W`;
  $('hCad').textContent = Math.round(session.cadence);
  $('hHr').textContent = session.hr ?? '--';

  // Gear (hidden on ERG workout steps — the trainer holds the watts)
  $('hGearBox').hidden = tw != null;
  $('hGear').textContent = session.gear;
  if (session.gear !== lastGear) {
    lastGear = session.gear;
    const el = $('hGear');
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }

  // Top right: grade (coloured by steepness) and what's ahead — or the workout step.
  if (session.mode === 'workout' && session.workout && !session.workoutDone && session.segment) {
    const w = session.workout, seg = session.segment;
    $('hGrade').textContent = fmtTime(seg.start + seg.duration - session.workoutT);
    $('hGrade').style.color = '';
    $('hGradeLabel').textContent = `${seg.label} · left`;
    const next = w.segments[session.segIndex + 1];
    showRow(1, next ? (next.kind === 'erg' ? `${targetWatts(next, next.start, settings.ftp, session.workoutBias)} W` : 'Free') : 'Finish', next ? `next · ${fmtTime(next.duration)}` : 'next');
    showRow(2, fmtTime(w.duration - session.workoutT), 'workout left');
    showRow(3, session.workoutBias !== 1 ? `${Math.round(session.workoutBias * 100)}%` : null, 'intensity');
    if (seg.ftpTest && ftpRun?.secs > 5) {
      // during the 20-minute test: running average and the FTP it points to
      const avg = ftpRun.sum / ftpRun.secs;
      showRow(2, `${Math.round(avg)} W`, 'test average');
      showRow(3, `${ftpFromTwentyMinutes(avg)} W`, 'FTP so far');
    }
  } else {
    const carry = session.carry;   // an escalator (a conveyor) carries you: its name instead of the grade
    $('hGrade').textContent = carry ? carry.label || 'Carried' : fmtGrade(session.gradePct);
    $('hGrade').style.color = carry ? '' : readable(gradeColor(session.gradePct));
    $('hGrade').classList.toggle('carry', !!carry);
    $('hGradeLabel').textContent = carry ? 'no pedalling' : 'grade';
    if (session.mode === 'route' && session.route) {
      const r = session.route;
      const ahead = imperial() ? 804.672 : 500;
      const g = averageGradeAhead(r, session.routePos, ahead);
      showRow(1, `${g > 0.05 ? '+' : ''}${fmtGrade(g)}`, imperial() ? 'next ½ mi' : 'next 500 m');
      const toFinish = session.routeFinishM != null;
      showRow(2, (r.closed || (r.netRide && !r.free && !r.netOpen)) && !toFinish ? String(session.routeLap) : null, 'lap');
      const toGoal = !toFinish && session.routeGoalM != null && !session.routeGoalHit;
      if (r.endlessRide && !toGoal) {
        // [endless] the mile ahead: how far to the next terrain choice, what you're riding now
        const st = r.endlessRide.stateAt(session.routePos);
        showRow(3, `${fmtDist(Math.max(0, st.toMark), 1)} ${distUnit()}`, `${st.label} · next mile`);
      } else if (r.netRide && !toFinish && !toGoal) {
        // a network route: the rest of this lap on the plan, else the way to the next junction
        // (the lap as the path rides it now — with the turns chosen — PLAN F150; off it, or the chosen way
        // leaving it: the next junction)
        const up = r.netRide.upcoming(session.routePos), view = r.netRide.profileView(session.routePos), onPlan = view.lap;
        const toGo = onPlan ? view.to - session.routePos : up.distTo;
        showRow(3, `${fmtDist(Math.max(0, toGo), 1)} ${distUnit()}`, onPlan ? 'lap to go' : `to ${up.node.name}`);
      } else showRow(3, `${fmtDist(Math.max(0, toGoal ? session.routeGoalM - session.routeRidden : session.routeLapToGo), 1)} ${distUnit()}`,
        toFinish ? 'to the finish' : toGoal ? 'to your goal' : 'lap to go');
    } else {
      showRow(1, session.mode === 'workout' && session.workoutDone ? 'Done' : null, 'workout');
      showRow(2, null);
      showRow(3, null);
    }
  }

  $('hudRows').hidden = [1, 2, 3].every((n) => $(`hRow${n}Box`).hidden);

  // Pacer: its power and how far ahead or behind it is.
  $('hPacer').hidden = !pacer.on;
  if (pacer.on) {
    const gap = pacerGap();
    $('hPacerT').textContent = `Pacer ${pacer.watts} W · ${Math.abs(gap) < 3 ? 'alongside' : `${fmtGap(gap)} ${gap > 0 ? 'ahead' : 'behind'}`}`;
  }

  // Bottom edge: route profile or workout chart (redrawn once a second, and at once when a network route's path
  // changes under it; blank on free rides).
  const now = performance.now();
  const pv = session.mode === 'route' && session.route ? hudProfileView() : null;
  if (now - lastProfileDraw > 1000 || (pv && pv.key !== lastProfileKey)) {
    lastProfileDraw = now;
    lastProfileKey = pv?.key ?? '';
    const c = $('hudProfile');
    if (pv) drawProfile(c, session.route, session.routePos, { metric: !imperial(), compact: true, span: pv.span, eleRange: pv.eleRange,
      finishAt: session.routeFinishM != null ? session.routeStart + session.routeFinishM : null });
    else if (session.mode === 'workout' && session.workout) drawWorkout(c, session.workout, session.workoutT, settings.ftp, session.workoutBias, { compact: true });
    else c.getContext('2d').clearRect(0, 0, c.width, c.height);
  }
  renderMinimap(now);
  renderTurnPrompt();

  // Status and pause overlay
  const userPaused = pausedByUser();
  const state = session.running ? '' : session.autoPaused ? 'Paused — pedal to resume' : session.movingS ? '' : 'Pedal to start';
  $('hState').hidden = !state;
  $('hState').textContent = state;
  $('hLoading').hidden = !world || !!loadRun || document.body.classList.contains('no-world') || world.loading < 4;
  const lost = !trainer.demo && !trainer.connected;
  $('hAlert').hidden = !lost;
  $('hAlert').textContent = trainer.reconnecting ? 'Trainer reconnecting…' : 'Trainer not connected';
  $('pauseOverlay').hidden = !userPaused || $('summary').open;
}

// Turn prompt (network routes): the next junction's ways on, about 15 s before it; ◀ ▶ / A D to choose.
let turnKey = '';
function renderTurnPrompt(force = false) {
  const box = $('hTurn'), net = session.turnRide;   // a network route's, or a free ride's / workout's network scenery (F37)
  const up = net && !(session.mode === 'route' && session.routeDone) ? net.prompt(session.turnPos, session.speedMps) : null;
  if (!up) { if (!box.hidden) { box.hidden = true; turnKey = ''; } return; }
  const key = `${up.node.id}:${up.i}:${up.selected}:${up.locked}:${Math.round(up.distTo / 10)}:${settings.units}`;
  if (!force && key === turnKey) return;
  turnKey = key;
  const fmtLen = (m) => `${fmtDist(m, 1)} ${distUnit()}`;
  box.hidden = false;
  box.classList.toggle('locked', up.locked);
  const sel = up.options[up.selected];
  box.innerHTML = `<div class="turn-head"><b>${escapeHtml(up.node.name)}</b><span>${up.distTo > 5 ? `in ${Math.round(imperial() ? up.distTo * 3.28084 / 10 : up.distTo / 5) * (imperial() ? 10 : 5)} ${imperial() ? 'ft' : 'm'}` : 'now'}</span></div>
    <div class="turn-opts">${up.options.map((o, j) => `<div class="turn-opt ${j === up.selected ? 'on' : ''} ${o.back ? 'back' : ''}"><i>${o.glyph}</i><b>${o.label}</b></div>`).join('')}</div>
    <div class="turn-sel">${up.onPlan ? '<em>Plan</em> ' : ''}${escapeHtml(sel.toward.charAt(0).toUpperCase() + sel.toward.slice(1))} · ${fmtLen(sel.lengthM)} · ${fmtElev(sel.climbM).toLocaleString()} ${elevUnit()} up</div>
    <div class="turn-hint">${up.locked ? 'Locked in' : '◀ ▶ on the handlebars · <kbd>A</kbd> <kbd>D</kbd>'}</div>`;
}

// Hide the on-screen buttons until the mouse moves.
let idleTimer = 0;
function wake() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add('idle'), 3000);
}
document.addEventListener('mousemove', wake);

// FTP test: average power over the 20-minute all-out segment
let ftpRun = null, ftpLast = 0;
function trackFtpTest() {
  const now = performance.now(), dt = Math.min(1, (now - ftpLast) / 1000);
  ftpLast = now;
  const w = session.mode === 'workout' ? session.workout : null;
  if (!w?.ftpTest) return;
  if (!ftpRun || ftpRun.workout !== w) ftpRun = { workout: w, sum: 0, secs: 0 };
  if (session.running && session.segment?.ftpTest) { ftpRun.sum += session.power * dt; ftpRun.secs += dt; }
}

// Keep the Mac's screen from sleeping while a trainer is connected or a ride is going (ride-feel-test).
const screenAwake = new ScreenAwake(log);
session.addEventListener('tick', () => {
  screenAwake.want(trainer.connected || session.running || session.hasRide);
});
session.addEventListener('tick', () => {
  holdForWorld();   // [phase 8]
  trackFtpTest();
  stepPacer();
  renderHud();
  renderDiag();
  if (!onRideScreen) {
    if (session.hasRide) renderStart();
    if (hrStrap.connected) $('hrLabel').textContent = `${hrStrap.bpm ?? '--'} bpm`;
  }
});
session.addEventListener('change', renderHudStatic);
session.addEventListener('segment', renderHudStatic);
session.addEventListener('workoutFinished', renderHudStatic);

function renderDiag() {
  if (!$('settings').open) return;
  const t = session.target;
  $('target').textContent = !trainer.connected ? '—'
    : t ? (t.mode === 'ERG' ? `ERG ${t.value} W (${t.source})` : `SIM ${t.value.toFixed(1)}%`) : '—';
  $('feltGrade').textContent = session.trainerGrade == null ? '—'
    : `${session.trainerGrade.toFixed(1)}% (road ${session.gradePct.toFixed(1)}%, hill feel ${settings.hillFeel ?? 50}%)`;
  $('realRatio').textContent = `${session.realRatio.toFixed(2)}${settings.realRatio ? ' (set)' : session.realRatioEst ? ' (auto)' : ' (default)'}`;
  const tk = trainer.data.speedKph;
  $('trainerSpeed').textContent = tk != null ? `${(imperial() ? tk * MI_PER_KM : tk).toFixed(1)} ${imperial() ? 'mph' : 'km/h'}` : '—';
}

export { renderHudStatic, redrawRideProfile, renderHud, renderTurnPrompt, ftpRun, renderDiag };
