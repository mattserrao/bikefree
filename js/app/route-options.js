// The ride type tabs and the route selector: direction, start point, ride length and the start note.
// (Part of the app: js/app.js imports every module in js/app/.)
import { saveSettings } from '../settings.js';
import { isPointToPoint } from '../gpx.js';
import { profileDistAt } from '../views.js';
import { legLength, startPosition, stopsForDirection, stopNear, planRide } from '../route-plan.js';
import { $, settings, trainer, session, imperial, fmtDist, distUnit, fmtElev, elevUnit, fmtTime } from './core.js';
import { pacer } from './pacer-ui.js';
import { pvLayout, renderPreview } from './preview.js';
import { drawThumbs } from './routes-menu.js';
import { previewRoute } from './route-loading.js';
import { previewWorkout } from './workouts-ui.js';
import { openSummary } from './summary.js';

// ---------- Ride type picker ----------
// One tab row (menu-simplify-test): Routes (the default), Workouts and Free ride (you set the grade; its pane is
// the scenery cards). (The mode isn't saved, so nothing to migrate.)
let chosen = 'route';
function showPane(p) {
  chosen = p;
  for (const t of document.querySelectorAll('.ride-tab')) {
    t.classList.toggle('on', t.dataset.mode === p);
    t.setAttribute('aria-selected', String(t.dataset.mode === p));
  }
  for (const el of document.querySelectorAll('.mode-pane')) el.hidden = el.dataset.pane !== p;
  drawThumbs();
  renderPreview();
}
for (const t of document.querySelectorAll('.ride-tab')) t.addEventListener('click', () => showPane(t.dataset.mode));

// (a ride held while the world loads the streets ahead, phase 8, isn't one you paused — unless you paused it meanwhile)
const pausedByUser = () => !session.running && session.movingS > 0 && !session.autoPaused && !(session.held && session._resumeAfterHold);

// What the Start button would ride, and whether that's the ride already under way.
function sameAsCurrent() {
  if (!session.hasRide) return false;
  if (chosen === 'free') return session.mode === 'free';
  if (chosen === 'route') {
    const cp = chosenPlan(previewRoute);
    return session.mode === 'route' && session.route === previewRoute && session.routeStart === cp.startM
      && session.routeFinishM === cp.finishM && session.routeGoalM === cp.goalM;
  }
  return session.mode === 'workout' && session.workout === previewWorkout && !session.workoutDone;
}
function renderStart() {
  const inProgress = session.hasRide;
  const ready = trainer.connected;
  const btn = $('startBtn');
  btn.disabled = !ready;
  btn.textContent = !ready ? 'Connect the trainer to start' : inProgress ? (sameAsCurrent() ? 'Resume ride' : 'Switch & resume') : 'Start riding';
  $('startNote').innerHTML = inProgress
    ? `Ride in progress · ${fmtTime(session.movingS)} · ${fmtDist(session.distanceM)} ${distUnit()} · <button class="link" id="finishFromMenu">Finish ride</button>`
    : ready ? 'Recording starts when you pedal.' : 'No bike handy? Turn on <b>Demo</b> in the top right.';
  $('finishFromMenu')?.addEventListener('click', () => openSummary());
}

// ---------- Route selector: direction, start point and length ----------
// Every route rides there and back; Reverse starts at the far end. The start is any point along the leg
// (a named stop, or dragged on the profile), remembered per route. The length is open, or a goal by time,
// distance or climbing — turned into a finish line by riding the road at a steady power (js/route-plan.js).
// At the end the ride stops (the summary opens) or keeps going; a point-to-point route (a one-way stage,
// or your own GPX that doesn't loop) stops at its finish unless Keep riding is on, then turns and rides back.
const routeChoice = { endless: settings.routeEndless === true };
const routeStarts = settings.routeStarts && typeof settings.routeStarts === 'object' ? settings.routeStarts : {};
const rideLength = { mode: 'open', time: 45, dist: 20000, climb: 500, ...(settings.rideLength || {}) };
const routeKeyOf = (r) => r?.id || r?.name || 'route';
function startOf(r) {
  const s = routeStarts[routeKeyOf(r)];
  return { reverse: s ? !!s.reverse : settings.routeReverse === true, offsetM: Number(s?.offsetM) || 0 };
}
function saveRouteChoice() {
  settings.routeEndless = routeChoice.endless;
  settings.routeStarts = routeStarts;
  settings.rideLength = { ...rideLength };
  saveSettings(settings);
}
function setStart(r, change, { save = true } = {}) {
  if (!r) return;
  routeStarts[routeKeyOf(r)] = { ...startOf(r), ...change };
  if (save) saveRouteChoice();
  renderPreview();
}
function setRouteChoice(change) {
  Object.assign(routeChoice, change);
  saveRouteChoice();
  renderPreview();
}
/** An estimated time, rounded: "45 min", "1 h 20 min". */
function fmtPlanTime(sec) {
  const m = Math.max(1, Math.round(sec / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}
/** The steady power the length estimate assumes: your setting, else the pacer's, else 65% of FTP. */
const planWatts = () => (Number(settings.planWatts) > 0 ? Number(settings.planWatts)
  : pacer.on ? pacer.watts : Math.max(60, Math.round((settings.ftp * 0.65) / 5) * 5));
const lengthGoal = () => ({ mode: rideLength.mode, value: rideLength.mode === 'open' ? 0 : rideLength[rideLength.mode] });
/** Everything the Start button would ride on a route: start, the planned ride, its finish or goal. */
function chosenPlan(r) {
  const st = startOf(r), startM = startPosition(r, st), p2p = isPointToPoint(r) || !!r.netOpen, keep = routeChoice.endless;
  const len = lengthGoal();
  const plan = planRide(r, startM, len, { watts: planWatts(), params: session.physicsParams(), pointToPoint: p2p, stopAtEnd: !keep });
  const distM = plan.distM == null ? null : Math.max(10, Math.round(plan.distM));
  return { st, startM, p2p, len, plan, finishM: distM != null && !keep ? distM : null,
    goalM: distM != null && keep && len.mode !== 'open' ? distM : null };
}

// Length: mode buttons and the stepper (shown in your units; stored as minutes / metres)
const lenUnits = {
  time: { unit: () => 'min', toShow: (v) => v, fromShow: (v) => v, step: () => 5, min: 5 },
  dist: { unit: distUnit, toShow: (m) => +(m / (imperial() ? 1609.344 : 1000)).toFixed(1), fromShow: (v) => v * (imperial() ? 1609.344 : 1000), step: () => 1, min: 0.5 },
  climb: { unit: elevUnit, toShow: (m) => Math.round(imperial() ? m * 3.28084 : m), fromShow: (v) => (imperial() ? v / 3.28084 : v), step: () => (imperial() ? 100 : 50), min: 10 },
};
function setLength(mode, value) {
  if (mode) rideLength.mode = mode;
  if (value != null && rideLength.mode !== 'open') {
    const u = lenUnits[rideLength.mode];
    rideLength[rideLength.mode] = u.fromShow(Math.max(u.min, value));
  }
  saveRouteChoice();
  renderPreview();
}
function stepLength(dir) {
  const u = lenUnits[rideLength.mode];
  if (!u) return;
  const st = u.step(), cur = u.toShow(rideLength[rideLength.mode]);
  setLength(null, Math.max(u.min, (dir > 0 ? Math.floor(cur / st) + 1 : Math.ceil(cur / st) - 1) * st));
}
$('lengthSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setLength(b.dataset.len); });
$('lenMinus').addEventListener('click', () => stepLength(-1));
$('lenPlus').addEventListener('click', () => stepLength(1));
$('lenValue').addEventListener('change', (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) setLength(null, v); else renderPreview(); });
$('planWatts').addEventListener('change', (e) => {
  const w = parseFloat(e.target.value);
  settings.planWatts = Number.isFinite(w) && w > 0 ? Math.max(40, Math.min(600, Math.round(w))) : null;
  saveSettings(settings);
  renderPreview();
});
$('dirSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setStart(previewRoute, { reverse: b.dataset.dir === 'rev', offsetM: 0 }); });
$('startStops').addEventListener('click', (e) => { const b = e.target.closest('button[data-off]'); if (b) setStart(previewRoute, { offsetM: Number(b.dataset.off) }); });
$('endlessSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setRouteChoice({ endless: b.dataset.endless === '1' }); });

/** A few start chips, not one per junction (menu-simplify-test: PGH's loop had ~60): named places first (a stop
 *  whose name isn't a junction "A & B"), else evenly spread along the leg; in riding order. Anywhere else: drag
 *  the start on the profile. */
function namedChips(list, max) {
  const seen = new Set();
  list = list.filter((c) => !seen.has(c.name) && seen.add(c.name));   // (a loop passes some places twice)
  if (list.length <= max) return list;
  const places = list.filter((c) => !/ & /.test(c.name));
  const pool = places.length >= 2 ? places : list;
  if (pool.length <= max) return pool;
  const pick = new Set();
  for (let i = 0; i < max; i++) pick.add(pool[Math.round((i * (pool.length - 1)) / Math.max(1, max - 1))]);
  return pool.filter((c) => pick.has(c));
}
/** The closed "Ride options" fold's one-line summary of what's chosen (the route's choices, then the pacer). */
let optsRouteParts = [];
function renderOptsSummary() {
  const route = $('routeOpts').hidden ? [] : optsRouteParts;
  $('rideOptsSum').textContent = [...route, pacer.watts ? `pacer ${pacer.watts} W` : 'no pacer'].filter(Boolean).join(' · ');
}
/** The route-selector controls for a route: direction, start chips, length, and the plan's estimate. */
function renderRouteSelector(r, cp) {
  const { st, startM, p2p, plan, len } = cp;
  const leg = legLength(r);
  for (const b of $('dirSeg').children) b.classList.toggle('on', (b.dataset.dir === 'rev') === st.reverse);
  $('dirSeg').hidden = !!r.netRide;   // a network preset has its own direction (and turns of your choosing)
  // start chips: the beginning of the leg, then the named stops in riding order
  const list = stopsForDirection(r, r.stops, st.reverse);
  const chips = [];
  if (!list.length || list[0].offsetM > 150) chips.push({ name: st.reverse ? 'Far end' : 'Beginning', offsetM: 0 });
  chips.push(...namedChips(list, 6 - chips.length));
  const onChip = chips.find((c) => Math.abs(c.offsetM - st.offsetM) <= 60);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  $('startStops').innerHTML = chips.map((c) => `<button type="button" data-off="${c.offsetM}" class="${c === onChip ? 'on' : ''}">${esc(c.name)}</button>`).join('')
    + (onChip ? '' : `<button type="button" class="on custom" disabled>${fmtDist(st.offsetM, 1)} ${distUnit()} in</button>`);
  // length
  $('lenOpen').textContent = p2p ? 'Full' : 'Open';
  for (const b of $('lengthSeg').children) b.classList.toggle('on', b.dataset.len === len.mode);
  $('lengthCtl').hidden = len.mode === 'open';
  if (len.mode !== 'open') {
    const u = lenUnits[len.mode];
    if (document.activeElement !== $('lenValue')) $('lenValue').value = u.toShow(rideLength[len.mode]);
    $('lenValue').step = u.step();
    $('lenUnit').textContent = u.unit();
  }
  if (document.activeElement !== $('planWatts')) $('planWatts').value = planWatts();
  $('endlessSeg').hidden = !p2p && len.mode === 'open';
  for (const b of $('endlessSeg').children) b.classList.toggle('on', (b.dataset.endless === '1') === routeChoice.endless);
  // the estimate
  let note = '';
  if (plan.distM != null) {
    const end = stopNear(r, r.stops, plan.endM);
    const legEnd = startM < leg ? leg : r.total;
    const back = plan.endM - legEnd;
    note = `<b>${fmtDist(plan.distM, 1)} ${distUnit()}</b> · <b>${fmtElev(plan.climbM).toLocaleString()} ${elevUnit()}</b> climb · <b>~${fmtPlanTime(plan.timeS)}</b> at ${planWatts()} W`;
    if (r.netRide) { if (plan.distM > leg + 50) note += ` · about ${(plan.distM / leg).toFixed(1)} laps`; }
    else if (back > 50 && plan.endM <= r.total + leg) note += ` · turns at the ${startM < leg ? 'far end' : 'start'} and comes back ${fmtDist(back, 1)} ${distUnit()}`;
    else if (back > 50) note += ' · more than there and back';
    if (end && (back <= 50 || r.netRide)) note += ` · ends ${end.d < 150 ? 'at' : 'near'} ${esc(end.name)}`;
    if (plan.capped) note += ` <span class="warn">· the stage finishes first</span>`;
    if (cp.goalM != null) note += ' · goal only, the ride keeps going';
  } else {
    note = r.netRide ? 'Rides on until you stop, lap after lap — or wherever your turns take you.'
      : p2p ? 'Turns at the finish and rides it back, endlessly.' : 'Rides on until you stop, turning at each end.';
  }
  $('planNote').innerHTML = note;
  const lenName = { time: 'min', dist: distUnit(), climb: `${elevUnit()} climb` };
  optsRouteParts = [r.netRide ? null : st.reverse ? 'Reverse' : 'Forward',
    `from ${onChip ? onChip.name : `${fmtDist(st.offsetM, 1)} ${distUnit()} in`}`,
    len.mode === 'open' ? (p2p ? 'full length' : 'open length') : `${lenUnits[len.mode].toShow(rideLength[len.mode])} ${lenName[len.mode]}`];
  renderOptsSummary();
}

// Drag the start along the profile (snaps to a named stop when you're close)
let pvDragging = false, pvDragRaf = 0, pvDragX = 0;
function dragStartTo(clientX) {
  const r = previewRoute;
  if (!r || !pvLayout) return;
  const chart = $('pvChart');
  const x = clientX - chart.getBoundingClientRect().left;
  const st = startOf(r), leg = legLength(r);
  let off = profileDistAt(pvLayout, x) - (st.reverse ? leg : 0);
  const pxPerM = pvLayout.pw / (pvLayout.to - pvLayout.from);
  for (const s of stopsForDirection(r, r.stops, st.reverse)) if (Math.abs(s.offsetM - off) * pxPerM < 7) off = s.offsetM;
  if (Math.abs(off) * pxPerM < 7) off = 0;
  setStart(r, { offsetM: Math.max(0, Math.min(leg - 100, Math.round(off / 10) * 10)) }, { save: false });
}
$('pvChart').addEventListener('pointerdown', (e) => {
  if (chosen !== 'route' || !previewRoute) return;
  pvDragging = true;
  $('pvChart').setPointerCapture(e.pointerId);
  dragStartTo(e.clientX);
});
$('pvChart').addEventListener('pointermove', (e) => {
  if (!pvDragging) return;
  pvDragX = e.clientX;
  if (!pvDragRaf) pvDragRaf = requestAnimationFrame(() => { pvDragRaf = 0; dragStartTo(pvDragX); });
});
const endDrag = () => { if (pvDragging) { pvDragging = false; saveRouteChoice(); } };
$('pvChart').addEventListener('pointerup', endDrag);
$('pvChart').addEventListener('pointercancel', endDrag);

/** A network route's first lap as a route-like view (thumbnails and the preview map); other routes as they are. */
function lapView(r) {
  if (!r?.lapM) return r;
  const n = Math.round(r.lapM / 10) + 1;
  return { lat: r.lat.subarray(0, n), lon: r.lon.subarray(0, n), dist: r.dist.subarray(0, n), total: r.lapM };
}

export { chosen, showPane, pausedByUser, sameAsCurrent, renderStart, fmtPlanTime, planWatts, chosenPlan, renderOptsSummary, renderRouteSelector, lapView };
