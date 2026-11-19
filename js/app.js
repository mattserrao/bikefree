import { Trainer } from './trainer.js';
import { Ride } from './ride.js';
import { HeartRate } from './hr.js';
import { Session, TICK_MS } from './session.js';
import { powerRequired, speedFromCadence, WHEEL_CIRC } from './physics.js';
import { loadSettings, saveSettings, KG_PER_LB, MI_PER_KM } from './settings.js';
import { rideToFit, fitFilename, summarize } from './recorder.js';
import * as store from './store.js';
import { parseGpx, buildRoute, averageGradeAhead, wrapDist, routeAt, isPointToPoint, finishDistanceM, legSpan, carryAt } from './gpx.js';
import { Pacer, PACER_WATTS } from './pacer.js';
import { parseWorkout, BUILT_IN_WORKOUTS, targetWatts, zoneColor, markFtpTest, ftpFromTwentyMinutes } from './workout.js';
import { drawProfile, drawWorkout, drawTrace, drawMinimap, drawNetworkMinimap, drawCityMap, gradeColor, profileDistAt } from './views.js';
import { groupByArea, groupCityItems, citySubline, filterByGoal, segmentRoutes, pickOnSegment, nearestLine, fitProjection, zoomProjection, zoomAt, panBy, mergeRivers, shortName } from './city-routes.js';
import { Profiles, GENDERS, initials, cmToFtIn, ftInToCm } from './profiles.js';
import { buildCatalogRoute, loadRouteScene } from './routes.js';
import { loadNetwork, makePathRoute, planNext, planCloses, keysToIds, idsToKeys, travKey, PathFollower, edgeLines } from './network.js';
import { legLength, startPosition, stopsForDirection, stopNear, planRide, startArchM } from './route-plan.js';
import { VERSION } from './version.js';
import { planRouteTiles, tileKeysToUrls, downloadUrls, offlineStatus, setOfflineStatus, registerServiceWorker } from './offline.js';

const $ = (id) => document.getElementById(id);

// The app version, shown faintly at the bottom right of the menu. Bump with each release (see PLAN.md).
export { VERSION };
$('ver').textContent = `bikefree v${VERSION}`;

// ---------- Log (lives in Settings › Advanced) ----------
const logEl = $('log');
const logLines = [];
let toastTimer = 0;
function toast(msg) {
  $('toast').textContent = msg;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 7000);
}
function log(source, msg, level = 'info') {
  const t = new Date().toLocaleTimeString([], { hour12: false });
  const line = `${t} [${source}] ${msg}`;
  logLines.push(line);
  if (logLines.length > 3000) logLines.shift();
  if (level === 'error') console.error(line); else console.log(line);
  const li = document.createElement('li');
  li.className = `lvl-${level}`;
  li.textContent = line;
  logEl.prepend(li);
  while (logEl.childElementCount > 500) logEl.lastChild.remove();
  if (level === 'error') toast(msg);
}
document.body.classList.add('hide-debug');
$('debugToggle').addEventListener('change', (e) => document.body.classList.toggle('hide-debug', !e.target.checked));
$('clearLog').addEventListener('click', () => { logEl.innerHTML = ''; logLines.length = 0; });
$('copyLog').addEventListener('click', async () => {
  await navigator.clipboard.writeText(logLines.join('\n'));
  log('app', 'Log copied to clipboard', 'ok');
});
$('toast').addEventListener('click', () => { $('toast').hidden = true; });

const hasBluetooth = !!navigator.bluetooth;
if (!hasBluetooth) for (const id of ['rideBtn', 'hrBtn']) $(id).disabled = true;

// ---------- Core objects ----------
const settings = loadSettings();
// The active rider's weight drives the physics.
const profiles = new Profiles(localStorage, settings.riderKg, settings.ftp);
settings.riderKg = profiles.active.weightKg;
settings.ftp = profiles.active.ftp;   // each rider has their own FTP
const trainer = new Trainer(log);
const ride = new Ride(log);
const hrStrap = new HeartRate(log);
const session = new Session({ trainer, ride, hr: hrStrap, log, settings });
const imperial = () => settings.units === 'imperial';
const fmtDist = (m, dp = 2) => (imperial() ? (m / 1609.344).toFixed(dp) : (m / 1000).toFixed(dp));
const distUnit = () => (imperial() ? 'mi' : 'km');
const fmtElev = (m) => Math.round(imperial() ? m * 3.28084 : m);
const elevUnit = () => (imperial() ? 'ft' : 'm');

function fmtTime(s) {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
// Zone and grade colours are tuned for dark glass; on light panels darken them so the text stays readable.
function readable(hex) {
  if (window.BFTheme?.mode() !== 'light') return hex;
  const n = parseInt(hex.slice(1), 16), k = 0.62;
  const c = (v) => Math.round(v * k).toString(16).padStart(2, '0');
  return `#${c(n >> 16)}${c((n >> 8) & 255)}${c(n & 255)}`;
}
const fmtGrade = (g) => `${(Math.abs(g) < 0.05 ? 0 : g).toFixed(1)}%`;
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ---------- Screens: setup ↔ ride ----------
let onRideScreen = false;

// ---------- Devices ----------
function deviceStatus() {
  const card = (dev, key, onText, offText) => {
    const on = dev.connected;
    const demo = dev === trainer && !!trainer.demo;
    const badge = $(`${key}Dot`);
    badge.className = `badge ${demo ? 'demo' : on ? 'on' : dev.reconnecting ? 'wait' : ''}`;
    badge.textContent = demo ? 'Demo' : on ? 'On' : dev.reconnecting ? '…' : '';
    badge.hidden = !(demo || on || dev.reconnecting);
    $(`${key}Label`).textContent = on ? onText() : dev.reconnecting ? 'Reconnecting…' : offText;
    $(`${key}Btn`).classList.toggle('connected', on && !demo);
    $(`${key}Btn`).classList.toggle('demo', demo);
  };
  card(trainer, 'trainer', () => trainer.device.name, hasBluetooth ? 'Tap to pair' : 'Needs Chrome');
  card(ride, 'ride', () => `Zwift Ride${ride.battery != null ? ` · ${ride.battery}%` : ''}`, hasBluetooth ? 'Tap to pair' : 'Needs Chrome');
  card(hrStrap, 'hr', () => `${hrStrap.bpm ?? '--'} bpm`, 'Optional · tap to pair');
  $('rideInfo').textContent = ride.connected ? `fw ${ride.firmware ?? '?'} · battery ${ride.battery ?? '?'}%` : '—';
  $('unsupported').hidden = hasBluetooth || !!trainer.demo;
  renderStart();
}
for (const d of [trainer, ride, hrStrap]) d.addEventListener('status', deviceStatus);

async function toggleDevice(dev, connectFn, name) {
  if (dev.connected || dev.reconnecting) return dev.disconnect();
  try { await connectFn(); }
  catch (err) { if (err.name !== 'NotFoundError') log(name, err.message, 'error'); }
  deviceStatus();
}
$('trainerBtn').addEventListener('click', () => {
  if (trainer.demo) { setDemo(false); return; }
  toggleDevice(trainer, () => trainer.connect(), 'trainer');
});
$('rideBtn').addEventListener('click', () => toggleDevice(ride, () => ride.connect(false), 'ride'));
$('rideAnyBtn').addEventListener('click', () => toggleDevice(ride, () => ride.connect(true), 'ride'));
$('hrBtn').addEventListener('click', () => toggleDevice(hrStrap, () => hrStrap.connect(), 'hr'));
$('rawToggle').addEventListener('change', (e) => { ride.showRaw = e.target.checked; });

// ---------- Demo mode: simulated trainer, constant 15 mph ----------
// Demo speed is adjustable (5–100 mph) so every route can be audited quickly.
let DEMO_MPH = 15;
let DEMO_SPEED = DEMO_MPH * 0.44704;
function setDemoSpeed(mph) {
  DEMO_MPH = Math.max(5, Math.min(100, Math.round(mph)));
  DEMO_SPEED = DEMO_MPH * 0.44704;
  if (trainer.demo) session.demoSpeedMps = DEMO_SPEED;
  for (const r of document.querySelectorAll('.demo-range')) r.value = DEMO_MPH;
  $('hDemoLabel').textContent = `Demo · ${DEMO_MPH} mph`;
  $('demoNoteMph').textContent = `${DEMO_MPH} mph`;
  if (trainer.demo) $('demoLabel').textContent = `Demo on · ${DEMO_MPH} mph`;
}
for (const r of document.querySelectorAll('.demo-range')) {
  r.addEventListener('input', () => setDemoSpeed(Number(r.value)));
  r.addEventListener('change', () => r.blur()); // hand the arrow keys back to shifting
}
let demoHr = 92;
function demoData() {
  const pausedByUser = !session.running && session.movingS > 0 && !session.autoPaused;
  if (pausedByUser) return { powerW: 0, cadenceRpm: 0, speedKph: 0, heartRate: Math.round((demoHr += (78 - demoHr) * 0.01)) };
  const jitter = (a) => 1 + (Math.random() - 0.5) * a;
  const workoutW = session.workoutTarget;
  // Power: what it takes to hold 15 mph on the current grade (or the workout step's target).
  const power = Math.max(0, workoutW != null ? workoutW * jitter(0.04) : Math.max(35, powerRequired(DEMO_SPEED, session.gradePct, session.physicsParams())) * jitter(0.06));
  // Cadence: what 15 mph needs in the current gear (so shifting changes it), kept in a sensible range.
  const cadence = workoutW != null ? 88 * jitter(0.03) : Math.min(125, Math.max(45, (DEMO_SPEED / (session.ratio * WHEEL_CIRC)) * 60)) * jitter(0.02);
  demoHr += (Math.min(185, 72 + power * 0.32) - demoHr) * 0.02;
  return { powerW: Math.round(Math.min(1500, power)), cadenceRpm: cadence, speedKph: speedFromCadence(cadence, 2.4) * 3.6, heartRate: Math.round(demoHr) };
}
function setDemo(on) {
  if (on === !!trainer.demo) return;
  if (on) {
    trainer.startDemo(demoData);
    session.demoSpeedMps = DEMO_SPEED;
    log('app', `Demo mode: the rider holds ${DEMO_MPH} mph.`, 'ok');
  } else {
    trainer.stopDemo();
    session.demoSpeedMps = null;
    if (session.running) session.pause();
  }
  $('demoBtn').classList.toggle('on', on);
  $('demoLabel').textContent = on ? `Demo on · ${DEMO_MPH} mph` : 'Demo';
  $('demoNote').hidden = !on;
  $('hDemo').hidden = !on;
  session.settingsChanged();
  deviceStatus();
}
$('demoBtn').addEventListener('click', () => setDemo(!trainer.demo));
$('demoOff').addEventListener('click', () => setDemo(false));

// ---------- Ride type picker ----------
let chosen = 'free';
function showPane(p) {
  chosen = p;
  for (const t of document.querySelectorAll('.mode')) t.classList.toggle('on', t.dataset.mode === p);
  for (const el of document.querySelectorAll('.mode-pane')) el.hidden = el.dataset.pane !== p;
  drawThumbs();
  renderPreview();
}
for (const t of document.querySelectorAll('.mode')) t.addEventListener('click', () => showPane(t.dataset.mode));

const pausedByUser = () => !session.running && session.movingS > 0 && !session.autoPaused;

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
const LENGTH_STEPS = { time: 5, dist: 1, climb: 50 };
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
  chips.push(...list);
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
}

// Drag the start along the profile (snaps to a named stop when you're close)
let pvLayout = null, pvDragging = false, pvDragRaf = 0, pvDragX = 0;
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

// ---------- Map planner (ride networks) ----------
// Tap a junction to start, then each segment to ride (only the ways on from where you've got to light up);
// tapping the segment you just rode turns back along it. A route that ends where it started laps; one that
// ends elsewhere finishes there. Saved in settings by segment names (they survive a rebuilt network).
const plan = { net: null, item: null, start: null, keys: [], layout: null };
function openPlanner(item = routeItems.find((it) => it.id === selectedRouteId)) {
  const r = item && routeCache.get(item.id);
  if (!r?.netRide || !item) return;
  plan.net = r.network; plan.item = item; plan.start = null; plan.keys = [];
  $('planTitle').textContent = `Plan your own route · ${(item.name || '').split(' · ')[0]}`;
  $('planName').value = '';
  $('planDlg').showModal();
  renderPlanner();
}
$('planOpen').addEventListener('click', () => openPlanner());
$('planUndo').addEventListener('click', () => { if (plan.keys.length) plan.keys.pop(); else plan.start = null; renderPlanner(); });
$('planClear').addEventListener('click', () => { plan.keys = []; plan.start = null; renderPlanner(); });
$('planName').addEventListener('input', () => renderPlanFacts());
$('planDlg').addEventListener('close', () => { if ($('planDlg').returnValue === 'save') savePlan(); });

function planLayout(canvas) {
  const net = plan.net, lines = edgeLines(net).map((x) => ({ e: x.e, lat: [...x.lat], lon: [...x.lon] }));   // (each segment from its own area's line)
  const rect = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
  let lat0 = 0, n = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const L of lines) for (const v of L.lat) { lat0 += v; n++; }
  lat0 /= n;
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111320, ky = 110540;
  for (const L of lines) for (let i = 0; i < L.lat.length; i++) {
    const x = L.lon[i] * kx, y = L.lat[i] * ky;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const pad = 34 * dpr, w = canvas.width, h = canvas.height;
  const sc = Math.min((w - pad * 2) / (maxX - minX), (h - pad * 2) / (maxY - minY));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const X = (lon) => w / 2 + (lon * kx - cx) * sc, Y = (lat) => h / 2 - (lat * ky - cy) * sc;
  for (const L of lines) L.pts = L.lat.map((la, i) => [X(L.lon[i]), Y(la)]);
  const nodes = [...net.nodes.values()].map((nd) => ({ nd, x: X(nd.lon), y: Y(nd.lat) }));
  return { lines, nodes, dpr, w, h };
}
const segDist = (pts, x, y) => {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    best = Math.min(best, Math.hypot(ax + dx * t - x, ay + dy * t - y));
  }
  return best;
};
function renderPlanner() {
  const c = $('planMap');
  plan.layout = planLayout(c);
  const { lines, nodes, dpr, w, h } = plan.layout, ctx = c.getContext('2d');
  const css = (v, d) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || d;
  const accent = css('--accent', '#7aa9f5'), ink = css('--ink', '#ece9e1'), muted = css('--muted', '#a8a69d'), bg = css('--panel', '#262624');
  ctx.clearRect(0, 0, w, h);
  const stroke = (pts, color, width, dash = []) => {
    ctx.strokeStyle = color; ctx.lineWidth = width * dpr; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash(dash.map((d) => d * dpr));
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.setLineDash([]);
  };
  for (const L of lines) stroke(L.pts, muted, 3);
  const next = plan.start ? planNext(plan.net, plan.keys, plan.start) : [];
  for (const o of next) stroke(lines.find((L) => L.e === o.t.e).pts, ink, 4, [6, 5]);
  // the route so far, with an arrow on each step
  plan.keys.forEach((k, j) => {
    const L = lines.find((x) => x.e.id === k.slice(0, -1)), pts = k.endsWith('+') ? L.pts : [...L.pts].reverse();
    stroke(pts, accent, 6);
    const m = Math.floor(pts.length / 2), [ax, ay] = pts[Math.max(0, m - 1)], [bx, by] = pts[Math.min(pts.length - 1, m + 1)];
    const ang = Math.atan2(by - ay, bx - ax);
    ctx.save(); ctx.translate(pts[m][0], pts[m][1]); ctx.rotate(ang);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(7 * dpr, 0); ctx.lineTo(-5 * dpr, 5 * dpr); ctx.lineTo(-5 * dpr, -5 * dpr); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = ink; ctx.font = `600 ${11 * dpr}px system-ui`; ctx.fillText(String(j + 1), pts[m][0] + 8 * dpr, pts[m][1] - 8 * dpr);
  });
  for (const { nd, x, y } of nodes) {
    const isStart = nd.id === plan.start;
    ctx.fillStyle = isStart ? accent : ink; ctx.strokeStyle = bg; ctx.lineWidth = 2 * dpr;
    ctx.beginPath(); ctx.arc(x, y, (isStart ? 8 : 6) * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = ink; ctx.font = `${12 * dpr}px system-ui`;
    const tw = ctx.measureText(nd.name).width;
    ctx.fillText(nd.name, Math.min(w - tw - 4 * dpr, x + 10 * dpr), y - 10 * dpr);
  }
  $('planSub').textContent = !plan.start ? 'Tap a junction to start.' : next.length ? 'Tap the next segment (dashed) — the one you just rode turns back.' : '';
  $('planSteps').innerHTML = plan.keys.map((k) => {
    const e = plan.net.edges.get(k.slice(0, -1)), fwd = k.endsWith('+');
    return `<li>${escapeHtml((e.toward?.[fwd ? 0 : 1] || e.name).replace(/^./, (ch) => ch.toUpperCase()))}</li>`;
  }).join('');
  renderPlanFacts();
}
function renderPlanFacts() {
  const keys = plan.keys;
  if (!keys.length) { $('planFacts').innerHTML = ''; $('planSave').disabled = true; return; }
  const r = makePathRoute(plan.net, { id: 'plan', name: 'plan', path: keys });
  const sim = planRide(r, 0, { mode: 'dist', value: r.lapM }, { watts: planWatts(), params: session.physicsParams(), pointToPoint: false, stopAtEnd: false });
  const loop = planCloses(plan.net, keys);
  const endName = plan.net.nodes.get(keys.at(-1).endsWith('+') ? plan.net.edges.get(keys.at(-1).slice(0, -1)).to : plan.net.edges.get(keys.at(-1).slice(0, -1)).from).name;
  $('planFacts').innerHTML = `<span><b>${fmtDist(r.lapM, 1)}</b> ${distUnit()}</span><span><b>${fmtElev(r.lapClimbM).toLocaleString()}</b> ${elevUnit()} climb</span>` +
    `<span><b>~${fmtPlanTime(sim.timeS)}</b> at ${planWatts()} W</span><span>${loop ? 'Loop — rides round and round' : `One way — finishes at ${escapeHtml(endName)}`}</span>`;
  $('planSave').disabled = false;
}
$('planMap').addEventListener('click', (e) => {
  if (!plan.layout) return;
  const rect = e.currentTarget.getBoundingClientRect(), d = plan.layout.dpr;
  const x = (e.clientX - rect.left) * d, y = (e.clientY - rect.top) * d;
  if (!plan.start) {
    let best = null;
    for (const n of plan.layout.nodes) { const dd = Math.hypot(n.x - x, n.y - y); if (dd < 26 * d && (!best || dd < best.d)) best = { n, d: dd }; }
    if (best) { plan.start = best.n.nd.id; renderPlanner(); }
    return;
  }
  // the nearest of the ways on (by the segment's line); a segment both ways on from here (a loop edge): the closer end
  let best = null;
  for (const o of planNext(plan.net, plan.keys, plan.start)) {
    const L = plan.layout.lines.find((l) => l.e === o.t.e), dd = segDist(L.pts, x, y);
    if (dd < 22 * d && (!best || dd < best.d - .5)) best = { o, d: dd };
  }
  if (best) { plan.keys.push(best.o.key); renderPlanner(); }
});
async function savePlan() {
  if (!plan.keys.length) return;
  const city = (plan.item.name || '').split(' · ')[0];
  const name = $('planName').value.trim() || `My route ${(settings.netRoutes || []).length + 1}`;
  const id = `mynet-${Date.now().toString(36)}`;
  settings.netRoutes = [...(settings.netRoutes || []), { id, network: plan.item.network, name, keys: idsToKeys(plan.net, plan.keys), created: Date.now() }];
  saveSettings(settings);
  log('app', `Saved your route: ${city} · ${name}`, 'ok');
  parkItems = null;   // rebuild the list with it
  await refreshRouteList(id);
  if ($('cityDlg').open) { city.sel = id; city.seg = null; renderCity(); }
}

// ---------- Virtual pacer ----------
// A rider in a yellow-checkered jersey who holds a set power on the same road physics as you.
const pacer = new Pacer(PACER_WATTS.includes(Number(settings.pacerWatts)) ? Number(settings.pacerWatts) : 0);
let pacerKey = null;
let pacerTrack = null;   // on a network ride: the pacer's own copy of the path (js/network.js PathFollower)
const onRoute = () => session.mode === 'route' && session.route;
const riderDist = () => (onRoute() ? session.routeRidden : session.distanceM);
const rideKey = () => (onRoute() ? `r:${session.route.name}:${session.routeStart}:${session.routeFinishM ?? 'endless'}`
  : `${session.mode === 'workout' ? `w:${session.workout?.id ?? session.workout?.name}` : 'free'}${session.sceneryRoute ? `:s:${session.sceneryRoute.id}` : ''}`);
/** A network path the ride follows (a network route's, or a free ride's / workout's network scenery: F37), and the pacer's metre on it. */
const turnPath = () => session.turnRide;
const pacerPathPos = () => (onRoute() ? session.routeStart + pacer.dist : Math.max(0, pacer.dist - session.sceneryOffset));
function resetPacer() {
  pacer.reset(riderDist());
  pacerKey = rideKey();
  pacerTrack = turnPath() ? new PathFollower(turnPath()) : null;
}
/** The pacer's own way on a network ride (or network scenery), kept up to date (null elsewhere). */
function pacerPath(route) {
  if (!pacerTrack || pacerTrack.ride !== route?.netRide || pacerTrack.ride !== turnPath()) return null;
  return pacerTrack.update(pacerPathPos());
}
function renderPacerChoice() {
  for (const b of $('pacerSeg').children) b.classList.toggle('on', Number(b.dataset.w) === pacer.watts);
}
function setPacer(watts) {
  const wasOn = pacer.on;
  pacer.watts = watts;
  settings.pacerWatts = watts;
  saveSettings(settings);
  if (watts && !wasOn) resetPacer();   // switching on: appear just ahead of you
  renderPacerChoice();
  if (watts) log('app', `Pacer: ${watts} W`); else log('app', 'Pacer off');
  renderHud();
}
$('pacerSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setPacer(Number(b.dataset.w)); });
renderPacerChoice();
function stepPacer() {
  // Same fixed step as the session, so you and the pacer share one clock.
  const dt = TICK_MS / 1000;
  if (!pacer.on || !session.running) return;
  if (pacerKey !== rideKey()) resetPacer();
  const r = onRoute() ? session.route : null;
  const track = r ? pacerPath(r) : null;
  const gradeAt = track ? (d) => track.grade(session.routeStart + d) : r ? (d) => routeAt(r, wrapDist(r, session.routeStart + d)).grade : () => session.gradePct;
  // conveyors (escalators) carry the pacer too: its own way's on a network ride, the route's elsewhere
  const carryAt_ = track ? (d) => track.carry(session.routeStart + d) : r?.carry ? (d) => carryAt(r, session.routeStart + d) : null;
  pacer.step(dt, gradeAt, session.physicsParams(), carryAt_);
  if (r && !r.closed) pacer.dist = Math.min(pacer.dist, r.total);
  if (r && session.routeFinishM != null) pacer.dist = Math.min(pacer.dist, session.routeFinishM);   // the pacer stops at the finish too
}
/** Gap to the pacer in metres (+ = pacer ahead). */
const pacerGap = () => pacer.dist - riderDist();
function fmtGap(m) {
  const a = Math.abs(m);
  if (imperial()) return a < 160.9 ? `${Math.round(a * 3.28084)} ft` : `${(a / 1609.344).toFixed(2)} mi`;
  return a < 1000 ? `${Math.round(a)} m` : `${(a / 1000).toFixed(2)} km`;
}

// ---------- Preview panel (right column) ----------
const fact = (v, label) => `<div class="fact"><b>${v}</b><small>${label}</small></div>`;
function renderPreview() {
  const map = $('pvMap'), chart = $('pvChart');
  $('routeOpts').hidden = true;
  $('pvHint').hidden = true;
  chart.classList.remove('pickable');
  $('offlineStatus').hidden = chosen !== 'route';
  if (chosen === 'route' && previewRoute) {
    const r = previewRoute;
    $('pvKicker').textContent = 'Route';
    $('pvTitle').textContent = r.name;
    $('pvSub').textContent = r.park || 'Your route';
    const leg = legLength(r), cp = chosenPlan(r), startM = cp.startM;
    // point to point (a one-way stage like Alpe d'Huez, or your own GPX): distance and climbing start to finish
    const p2p = cp.p2p;
    const netKm = r.netRide ? [...r.network.edges.values()].reduce((t, e) => t + e.len, 0) : 0;
    $('pvFacts').innerHTML = r.free
      ? fact(`${fmtDist(netKm, 1)}`, `${distUnit()} of streets & trails`) + fact(String(r.network.nodes.size), 'junctions') +
        '<div class="fact tag">Free ride · choose every turn</div>'
      : r.netRide
      ? fact(`${fmtDist(leg, 1)}`, `${distUnit()} ${r.netOpen ? 'start to finish' : 'lap'}`) + fact(fmtElev(r.lapClimbM).toLocaleString(), `${elevUnit()} climb / lap`) +
        fact(`${Math.round(Math.max(...r.grade.subarray(0, Math.round(leg / 10) + 1)))}%`, 'max grade') +
        `<div class="fact tag">${r.netOpen ? 'One way · finishes at the end' : 'Loop · choose your turns at junctions'}</div>`
      : ((p2p
      ? fact(`${fmtDist(leg, 1)}`, `${distUnit()} start to finish`) + fact(fmtElev(r.oneWay.ascent).toLocaleString(), `${elevUnit()} climb to the finish`)
      : fact(`${fmtDist(leg, 1)}`, `${distUnit()} each way`) + fact(fmtElev(r.ascent).toLocaleString(), `${elevUnit()} climb / lap`)) +
      fact(`${Math.round(Math.max(...r.grade))}%`, 'max grade') +
      `<div class="fact tag">${p2p ? 'Point to point' : r.oneWay?.closedLoop ? 'Loop · each lap turns and rides it back' : 'There &amp; back · turns at each end'}</div>`);
    $('planOpen').hidden = !r.netRide;
    if (r.netRide) $('pvDesc').innerHTML = `${r.note ? `${escapeHtml(r.note)}. ` : ''}At each junction choose left, straight, right or back with ◀ ▶ on the handlebars (or <kbd>A</kbd> <kbd>D</kbd>) — or follow the plan.`;
    if (!r.netRide) $('pvDesc').innerHTML = r.hasElevation ? '' : '<span class="warn">No elevation in this file — it will ride flat.</span>';
    map.hidden = false; chart.hidden = false;
    $('routeOpts').hidden = false;
    renderRouteSelector(r, cp);
    // the leg being ridden, in riding order, with the planned stretch bright and its finish line
    const span = legSpan(r, startM);
    const endM = cp.plan.endM;
    const selEnd = endM == null ? span[1] : Math.min(span[1], endM);
    const end = endM != null ? stopNear(r, r.stops, endM) : null;
    const ticks = (r.stops || []).map((st) => (r.netRide || span[0] === 0 ? st.atM : r.total - st.atM));
    drawTrace(map, lapView(r), startM, { markerOnly: true, section: endM != null ? [startM, endM] : null });
    pvLayout = drawProfile(chart, r, startM, { metric: !imperial(), span, selection: [startM, selEnd], ticks,
      finishAt: endM != null && endM <= span[1] + 1 ? Math.min(endM, span[1]) : null,
      endLabel: endM == null ? null : end && end.d < 600 ? end.name : `~${fmtPlanTime(cp.plan.timeS)}` });
    chart.classList.add('pickable');
    const at = routeAt(r, startM);
    $('pvHint').hidden = false;
    $('pvHint').textContent = `Drag on the profile to move the start · starting ${fmtDist(cp.st.offsetM, 1)} ${distUnit()} in at ${fmtElev(at.ele).toLocaleString()} ${elevUnit()}`;
  } else if (chosen === 'workout' && previewWorkout) {
    $('planOpen').hidden = true;
    const w = previewWorkout, st = workoutStats(w);
    $('pvKicker').textContent = 'Workout';
    $('pvTitle').textContent = w.name;
    $('pvSub').textContent = `At FTP ${settings.ftp} W`;
    $('pvFacts').innerHTML = fact(fmtTime(w.duration), 'time') + fact(`~${st.kj}`, 'kJ') + fact(`${st.maxW} W`, 'peak');
    $('pvDesc').textContent = w.description || '';
    map.hidden = true; chart.hidden = false;
    drawWorkout(chart, w, 0, settings.ftp, 1);
  } else {
    const scene = sceneryItem();
    $('pvKicker').textContent = 'Free ride';
    $('pvTitle').textContent = scene ? scene.name : 'Numbers only';
    $('pvSub').textContent = scene ? `Scenery · ${scene.park}` : 'No scenery — a plain dark background';
    $('pvFacts').innerHTML = '';
    $('pvDesc').innerHTML = 'Change the grade with ▲ ▼ on the handlebars (or <kbd>↑</kbd> <kbd>↓</kbd>) while you ride.' +
      (sceneryFreeItem(scene) ? ` The scenery is ${escapeHtml(scene.name.split(' · ')[0])}'s free ride: straight on at each junction, or turn with ◀ ▶ (<kbd>A</kbd> <kbd>D</kbd>) into any part of the city.` : '');
    chart.hidden = true;
    map.hidden = !scene;
    if (scene && routeCache.has(scene.id)) drawTrace(map, routeCache.get(scene.id), 0);
  }
  renderStart();
}

// ---------- Scenery (3D loop behind free rides and workouts) ----------
const sceneryItem = () => (parkItems || []).find((p) => p.id === settings.scenery) || null;
function setScenery(id) {
  settings.scenery = id;
  saveSettings(settings);
  renderScenery();
  renderPreview();
}
// Routes are listed in sections: In Progress, Rough Drafts (catalog "stage": "draft") and
// Deprecated ("stage": "deprecated"). The route list ends with a collapsible Ideas section.
const STAGES = [['progress', 'In Progress'], ['draft', 'Rough Drafts'], ['deprecated', 'Deprecated']];
const stageOf = (it) => (['draft', 'deprecated'].includes(it.stage) ? it.stage : 'progress');
function groupedCards(items, card) {
  return STAGES.map(([key, label]) => {
    const list = items.filter((it) => stageOf(it) === key);
    return list.length ? `<h3 class="cards-group">${label}</h3>${list.map(card).join('')}` : '';
  }).join('');
}

// Route ideas (routes/ideas.json): not rideable yet, listed in a collapsible section at the bottom.
let routeIdeas = null;
let ideasOpen = false;
async function loadIdeas() {
  if (routeIdeas) return routeIdeas;
  try { routeIdeas = await (await fetch('routes/ideas.json')).json(); } catch { routeIdeas = []; }
  return routeIdeas;
}
function ideasSection() {
  if (!routeIdeas?.length) return '';
  const top = routeIdeas.filter((i) => i.rank <= 10);
  const rest = routeIdeas.filter((i) => i.rank > 10);
  const row = (i) => `<li value="${i.rank}"><b>${escapeHtml(i.name)}</b>${i.note ? `<span class="rsub"> · ${escapeHtml(i.note)}</span>` : ''}</li>`;
  return `<details class="ideas" ${ideasOpen ? 'open' : ''}><summary class="cards-group">Ideas</summary>
    ${top.length ? `<h4>Top 10</h4><ol>${top.map(row).join('')}</ol>` : ''}
    ${rest.length ? `<h4>11–${rest[rest.length - 1].rank}</h4><ol>${rest.map(row).join('')}</ol>` : ''}</details>`;
}

const watchIdeas = (list) => list.querySelector('details.ideas')?.addEventListener('toggle', (e) => { ideasOpen = e.target.open; });

function renderScenery() {
  const items = [...(parkItems || []).filter((p) => !p.area), { id: 'none', name: 'None', park: 'Numbers only' }];   // (a city's areas: not choices of their own)
  if (!items.some((p) => p.id === settings.scenery)) settings.scenery = items[0].id;
  $('sceneCards').innerHTML = groupedCards(items, (p) => `
    <button class="rcard ${p.id === 'none' ? 'none' : ''} ${p.id === settings.scenery ? 'on' : ''}" data-id="${p.id}">
      ${p.id === 'none' ? '<div class="blank">No 3D</div>' : '<canvas></canvas>'}
      <div><b>${escapeHtml(p.name)}</b><div class="rsub">${escapeHtml(p.park || '')}</div></div>
    </button>`) + ideasSection();
  watchIdeas($('sceneCards'));
  drawThumbs();
  const sel = $('sceneSelect');
  sel.innerHTML = '';
  for (const [key, label] of STAGES) {
    const group = document.createElement('optgroup'); group.label = label;
    for (const p of items.filter((it) => stageOf(it) === key)) group.append(new Option(p.id === 'none' ? 'None — numbers only' : p.name, p.id));
    if (group.children.length) sel.append(group);
  }
  sel.value = settings.scenery;
}
$('sceneCards').addEventListener('click', (e) => {
  const card = e.target.closest('.rcard');
  if (card) setScenery(card.dataset.id);
});
$('sceneSelect').addEventListener('change', (e) => setScenery(e.target.value));
/** A city with a ride network as scenery (F37): its free ride over the whole network (its own copy, not the route list's). */
const sceneryFreeItem = (item) => {
  const free = item?.network && netItems.find((n) => n.baseId === item.id && n.free);
  return free ? { ...free, id: `scenery-${free.id}` } : null;
};
async function sceneryRoute() {
  const item = sceneryItem();
  if (!item) return null;
  const free = sceneryFreeItem(item);
  if (free) { try { return await loadRouteItem(free); } catch (err) { log('app', `Scenery: ${err.message} — riding the ${item.name} loop`, 'error'); } }
  try { return await loadRouteItem(item); } catch { return null; }
}

// ---------- Start and finish arches in the 3D world ----------
// START about ten seconds of easy pedalling in, named for where you are; FINISH (or GOAL, when you keep
// riding) over the planned finish line, named for the place it's at, else how far it is.
function courseMarks() {
  if (session.mode !== 'route' || !session.route) return {};
  const r = session.route, startM = session.routeStart, endRidden = session.routeFinishM ?? session.routeGoalM;
  const placeAt = (m, reach) => stopNear(r, r.stops, m, reach)?.name || null;
  const shortName = (r.name || '').split(' · ')[0];
  const start = { atM: startArchM(r, startM, { params: session.physicsParams(), finishM: endRidden }), title: 'START' };
  start.sub = placeAt(start.atM, 400) || shortName;
  const finish = endRidden == null ? null : { atM: startM + endRidden, title: session.routeFinishM != null ? 'FINISH' : 'GOAL' };
  if (finish) finish.sub = placeAt(finish.atM, 600) || `${fmtDist(endRidden, 1)} ${distUnit()} from the start`;
  return { start, finish };
}

// ---------- Start / leave the ride screen ----------
async function startRide() {
  if (chosen === 'route') {
    if (!previewRoute) return;
    const { startM, finishM, goalM } = chosenPlan(previewRoute);
    if (!sameAsCurrent() || session.mode !== 'route') {
      session.setRoute(previewRoute, startM, finishM, goalM);
      log('app', `Riding route: ${previewRoute.name} (${finishM != null ? `${fmtDist(finishM, 1)} ${distUnit()} to the finish`
        : goalM != null ? `goal in ${fmtDist(goalM, 1)} ${distUnit()}, then keep riding` : `${fmtDist(previewRoute.total, 1)} ${distUnit()}${previewRoute.closed ? ' loop' : ''}`})`, 'ok');
    }
  } else if (chosen === 'workout') {
    if (!previewWorkout) return;
    if (!(session.mode === 'workout' && session.workout === previewWorkout && !session.workoutDone)) {
      session.setWorkout(previewWorkout);
      log('app', `Workout: ${previewWorkout.name} (${fmtTime(previewWorkout.duration)}, FTP ${settings.ftp} W)`, 'ok');
    }
  } else if (session.mode !== 'free') {
    session.setFree();
    log('app', 'Free ride');
  }
  // the 3D world: the route, else the scenery — a city with a ride network rides its free ride (F37)
  const route = session.mode === 'route' ? session.route : await sceneryRoute();
  session.setScenery(session.mode === 'route' ? null : route);
  if (!session.hasRide || pacerKey !== rideKey()) resetPacer();
  if (pausedByUser()) session.start();
  onRideScreen = true;
  session.autoStart = true;
  $('setup').hidden = true;
  $('rideScreen').hidden = false;
  document.documentElement.requestFullscreen?.().catch(() => {});
  await openWorld(route);
  world?.setCourseMarks(courseMarks());
  renderHudStatic();
  renderHud();
}
$('startBtn').addEventListener('click', startRide);

function showSetup() {
  onRideScreen = false;
  session.autoStart = false;
  $('rideScreen').hidden = true;
  $('setup').hidden = false;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  world?.stop();
  showPane(chosen);
}
$('pauseBtn').addEventListener('click', () => session.pause());
$('resumeBtn').addEventListener('click', () => session.start());
$('finishBtn').addEventListener('click', () => openSummary());

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || document.querySelector('dialog[open]')) return;
  const k = e.key;
  if (k === 'ArrowRight' || k === '=' || k === ']') session.shift(+1);
  else if (k === 'ArrowLeft' || k === '-' || k === '[') session.shift(-1);
  else if (k === 'ArrowUp') session.upDown(1);
  else if (k === 'ArrowDown') session.upDown(-1);
  else if (k === ' ' && onRideScreen) session.toggle();
  else if (k === 'l' || k === 'L') session.lap();
  else if ((k === 'n' || k === 'N') && session.mode === 'workout') session.skipSegment();
  else if ((k === 'm' || k === 'M') && onRideScreen) cycleMinimap();
  else if ((k === 'a' || k === 'A' || k === 'd' || k === 'D') && onRideScreen && session.turnRide) { if (session.turn(k === 'a' || k === 'A' ? -1 : 1)) renderTurnPrompt(true); }
  else if ((k === ',' || k === '.') && trainer.demo) setDemoSpeed(DEMO_MPH + (k === '.' ? 5 : -5));
  else if ((k === 'f' || k === 'F') && onRideScreen) toggleFullscreen();
  else if ((k === 'w' || k === 'W') && onRideScreen) cycleWeather();
  else if ((k === 'i' || k === 'I') && onRideScreen && world) { const summary = world.togglePerf(); if (summary) log('perf', summary, 'info'); }
  else if (k === 'p' || k === 'P') { const opts = [0, ...PACER_WATTS]; setPacer(opts[(opts.indexOf(pacer.watts) + 1) % opts.length]); }
  else return;
  e.preventDefault();
});
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch((err) => log('3d', err.message, 'debug'));
}

// ---------- 3D world ----------
// On a route the rider is where the ride is; otherwise the scenery loop simply rolls by.
// A free ride's or workout's network scenery (F37) is a path the rider rides along, turns and all.
function riderPosOn(route) {
  if (session.mode === 'route' && session.route === route) return session.routePos;
  if (session.mode !== 'route' && route.netRide && session.sceneryRoute === route) return session.sceneryPos;
  return session.distanceM % route.total;
}
function pacerPosOn(route) {
  const t = route.total;
  if (session.mode === 'route' && session.route === route) return wrapDist(route, session.routeStart + pacer.dist);
  if (session.mode !== 'route' && route.netRide && session.sceneryRoute === route) return pacerPathPos();
  return ((pacer.dist % t) + t) % t;
}

// ---------- Minimap (ride screen, bottom-left) ----------
// Zoomed in by default (18 Nov): about 3 km across, north up, following the rider a little behind centre
// (js/minimap-view.js); Settings or M: whole course · off. Redrawn 5× a second; only what's in view is drawn.
let lastMapDraw = 0;
function minimapRoute() {
  if (session.mode === 'route' && session.route) return session.route;
  return worldRoute && !document.body.classList.contains('no-world') ? worldRoute : null;
}
function renderMinimap(now = performance.now(), force = false) {
  const box = $('hMap'), route = settings.minimap !== 'off' ? minimapRoute() : null;
  box.hidden = !route;
  if (!route || (!force && now - lastMapDraw < 200)) return;
  lastMapDraw = now;
  if (route.netRide) {
    // a network route: the network, the path ahead and the next junction's ways on
    const pos = riderPosOn(route), net = route.netRide;
    const up = net.prompt(pos, session.speedMps);
    const span = net.profileSpan(pos);
    drawNetworkMinimap($('hMapCanvas'), net, pos, { mode: settings.minimap === 'course' ? 'course' : 'follow', now,
      pacerPos: !pacer.on ? null : pacerPath(route) ? pacerPath(route).latLon(pacerPosOn(route)) : pacerPosOn(route), up,
      aheadTo: Math.max(span[1], net.endOf(Math.min(net.entries.length - 1, net.entryAt(pos) + 1))) });
    return;
  }
  drawMinimap($('hMapCanvas'), route, riderPosOn(route), {
    mode: settings.minimap === 'course' ? 'course' : 'follow', now,
    pacerPos: pacer.on ? pacerPosOn(route) : null,
  });
}
function applyHudPrefs() {
  document.body.dataset.hudSize = settings.hudSize;
  if (onRideScreen) renderMinimap(performance.now(), true);
}
function cycleMinimap() {
  const order = ['follow', 'course', 'off'];
  settings.minimap = order[(order.indexOf(settings.minimap) + 1) % order.length];
  saveSettings(settings);
  renderMinimap(performance.now(), true);
  toast(settings.minimap === 'off' ? 'Minimap off' : settings.minimap === 'follow' ? 'Minimap: zoomed in' : 'Minimap: whole course');
}

let world = null;
let worldRoute = null;
let worldBase = null;   // the route the world is built around (a network route rides its city loop's world)
let worldModule = null;

async function openWorld(route) {
  document.body.classList.toggle('no-world', !route);
  if (!route) { world?.stop(); return; }
  if (world && worldRoute === route) { world.start(); return; }
  let base = route.base || route;
  // a city of areas (PLAN 5.4): the world starts in the area where the ride starts, and builds the others as the path reaches them
  const net = route.netRide?.net, areas = net?.multi ? cityAreas(net) : null;
  if (areas) {
    const start = route.netRide.worldAt(riderPosOn(route)).area;
    base = net.areas.get(start).base;
    await loadRouteScene(base).catch((err) => log('3d', err.message, 'error'));
    areas.id = start;
  }
  if (world && (areas ? world.areaSet?.net === net : worldBase === base && !world.areaSet)) {
    worldBase = base;
    // the same city: just follow this ride's path (or none)
    worldRoute = route;
    world.setPath(route.netRide || null);
    wireWorld(route);
    world.start();
    return;
  }
  try {
    worldModule = worldModule || await import('./world/world.js');
  } catch (err) {
    log('3d', `Could not start the 3D view: ${err.message}`, 'error');
    document.body.classList.add('no-world');
    return;
  }
  if (world) { world.dispose(); world = null; }
  try {
    world = new worldModule.World($('worldView'), base, { log, quality: settings.worldQuality, path: route.netRide || null, areas });
  } catch (err) {
    log('3d', `3D view needs WebGL: ${err.message}`, 'error');
    document.body.classList.add('no-world');
    return;
  }
  worldRoute = route;
  worldBase = base;
  world.setTimeOfDay(settings.worldTime);
  world.setWeather(settings.worldWeather || 'clear', true);
  wireWorld(route);
  world.start();
  log('3d', `3D view: ${route.name}`);
}
/** A network of areas as the world loads them: the city's frame, and each area's route with its scene (fetched when needed). */
function cityAreas(net) {
  return { net, origin: net.origin, load: async (id) => { const base = net.areas.get(id).base; await loadRouteScene(base); return base; } };
}
function wireWorld(route) {
  world.setSource(() => ({ pos: riderPosOn(route), speed: session.speedMps, cadence: session.cadence, riding: true,
    grade: session.gradePct, power: session.power3s, ftp: settings.ftp }));
  world.setPacerSource(() => {
    if (!pacer.on) return null;
    return { pos: pacerPosOn(route), speed: session.running ? pacer.speed : 0, cadence: session.running ? pacer.cadence : 0,
      grade: pacer.grade, power: session.running ? pacer.watts : 0, ftp: settings.ftp, path: pacerPath(route) };
  });
}
function cycleWeather() {
  // The route decides which presets it offers and what they're called (Pittsburgh: Clear, River fog, Clouds).
  const options = world?.weatherOptions?.().length ? world.weatherOptions()
    : ['clear', 'marine', 'clouds', 'rain'].map((key) => ({ key, label: key }));
  const now = options.findIndex((o) => o.key === (world?.weatherKey ?? settings.worldWeather));
  const next = options[(now + 1) % options.length];
  settings.worldWeather = next.key;
  saveSettings(settings);
  world?.setWeather(next.key);
  toast(`Weather: ${next.label}`);
}
document.addEventListener('visibilitychange', () => {
  if (!world || !onRideScreen) return;
  if (document.hidden) world.stop(); else world.start();
});

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
/**
 * The ride-screen profile's stretch (span) and height scale (eleRange). A network route's path changes as you
 * choose turns (and refills as you ride): its NetRide.profileView follows the path as it is now — the lap as
 * you'll ride it, else the way ahead — rebuilt once per path change (`version`) and segment, not per frame
 * (PLAN F150). `key` changes when the stretch does, so the strip is redrawn at once.
 */
let finishView = null;
function hudProfileView() {
  const r = session.route, net = r.netRide;
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
      if (r.netRide && !toFinish && !toGoal) {
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
  $('hLoading').hidden = !world || document.body.classList.contains('no-world') || world.loading < 4;
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

session.addEventListener('tick', () => {
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
  $('realRatio').textContent = `${session.realRatio.toFixed(2)}${settings.realRatio ? ' (set)' : session.realRatioEst ? ' (auto)' : ' (default)'}`;
  const tk = trainer.data.speedKph;
  $('trainerSpeed').textContent = tk != null ? `${(imperial() ? tk * MI_PER_KM : tk).toFixed(1)} ${imperial() ? 'mph' : 'km/h'}` : '—';
}

// ---------- Routes ----------
// Demo Hills is an invented test loop: its hills don't exist in the real terrain where it's placed,
// so it gets stylized scenery that shapes itself around the road (and no real horizon).
const DEMO_ROUTE = { id: 'builtin-demo-hills', kind: 'route', name: 'Demo Hills (built-in)', url: 'routes/demo-hills.gpx', scene: 'routes/scenes/demo-hills.json', group: 'Other' };
let routeItems = [];
let parkItems = null;
let netItems = [];          // network presets (choose your turns): listed as routes, not as scenery
const routeCache = new Map();
const netCache = new Map();   // network JSON by URL
let previewRoute = null;
let selectedRouteId = null;

async function loadParks() {
  if (parkItems) return parkItems;
  try {
    const list = await (await fetch('routes/parks/index.json')).json();
    parkItems = list.map((p) => ({ ...p, routeId: p.id, id: `builtin-park-${p.id}`, kind: 'route', url: p.file, group: 'Scenic routes — 3D' }));
  } catch {
    parkItems = [];
  }
  // a city loop with a ride network: one route per preset, on the same world (js/network.js)
  netItems = [];
  for (const p of parkItems.filter((x) => x.network)) {
    try {
      if (!netCache.has(p.network)) netCache.set(p.network, await (await fetch(p.network)).json());
      const city = p.name.split(' · ')[0];
      for (const pr of netCache.get(p.network).presets || []) {
        netItems.push({ id: `builtin-net-${pr.id}`, routeId: pr.id, kind: 'route', name: `${city} · ${pr.name}`, park: p.park,
          stage: p.stage, group: 'Scenic routes — 3D', baseId: p.id, network: p.network, preset: pr.id,
          km: +(pr.lengthM / 1000).toFixed(1), climbM: pr.climbM, tags: pr.tags || [], note: pr.note || '' });
      }
      const json = netCache.get(p.network);
      const base = { kind: 'route', park: p.park, stage: p.stage, group: 'Scenic routes — 3D', baseId: p.id, network: p.network };
      if (json.freeRide) netItems.push({ ...base, id: `builtin-netfree-${json.id}`, routeId: `${json.id}-free`, name: `${city} · ${json.freeRide.name}`,
        free: true, tags: ['varied'], note: json.freeRide.note || '' });
      // your own routes from the map planner (kept in settings, by segment names so they survive a rebuilt network)
      for (const m of (settings.netRoutes || []).filter((x) => x.network === p.network)) {
        netItems.push({ ...base, id: m.id, routeId: m.id, name: `${city} · ${m.name}`, custom: true, keys: m.keys, tags: [], note: 'Your own route' });
      }
    } catch (err) { log('app', `Could not load the ${p.name} network: ${err.message}`, 'error'); }
  }
  return parkItems;
}

async function refreshRouteList(selectId) {
  const mine = (await store.listLibrary('route').catch(() => [])).map((r) => ({ ...r, group: 'My routes' }));
  const parks = await loadParks();
  // a city loop with a network is listed as its presets (the loop itself is one of them); it stays a scenery choice
  routeItems = [...parks.filter((p) => !p.area).flatMap((p) => (p.network && netItems.some((n) => n.baseId === p.id) ? netItems.filter((n) => n.baseId === p.id) : [p])), ...mine, DEMO_ROUTE];
  await loadIdeas();
  // Load every route up front: they're small, and the cards draw their outlines.
  await Promise.all(routeItems.map((it) => loadRouteItem(it).catch(() => null)));
  if (selectId || !routeItems.some((r) => r.id === selectedRouteId)) selectedRouteId = selectId || routeItems[0].id;
  renderRouteCards();
  renderScenery();
  await previewSelectedRoute();
}

// Ride goals: a filter over the route list. A network preset says its own (varied, new areas…); every route
// also gets flat / hilly from its climbing per km and short / long from its length (one lap or one way).
const GOALS = [['all', 'All'], ['flat', 'Flat'], ['hilly', 'Hilly'], ['short', 'Short'], ['long', 'Long'], ['varied', 'Varied'], ['new', 'New areas']];
function goalTags(it) {
  const r = routeCache.get(it.id);
  const km = r ? (r.lapM || (r.stageRoute ? r.turnS : r.turnS || r.total)) / 1000 : it.km;
  const climb = r ? (r.lapClimbM ?? (r.oneWay?.ascent ?? r.ascent)) : it.climbM;
  const tags = new Set(it.tags || []);
  if (it.free) return GOALS.map(([k]) => k).filter((k) => tags.has(k));   // a free ride is what you make it
  if (km > 0 && climb != null) {
    const perKm = climb / km;
    if (!tags.has('hilly') && perKm < 6) tags.add('flat');
    if (!tags.has('flat') && perKm >= 12) tags.add('hilly');
    if (!tags.has('long') && km < 15) tags.add('short');
    if (!tags.has('short') && km >= 30) tags.add('long');
  }
  return GOALS.map(([k]) => k).filter((k) => tags.has(k));
}
let routeGoal = GOALS.some(([k]) => k === settings.routeGoal) ? settings.routeGoal : 'all';
function renderGoalSeg() {
  $('goalSeg').innerHTML = GOALS.map(([k, label]) => `<button type="button" data-goal="${k}" class="${k === routeGoal ? 'on' : ''}">${label}</button>`).join('');
}
$('goalSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-goal]');
  if (!b) return;
  routeGoal = b.dataset.goal;
  settings.routeGoal = routeGoal;
  saveSettings(settings);
  renderRouteCards();
});

// A city with a ride network (Pittsburgh) is one card: its presets, free ride and your own routes are in its panel.
let routeCards = [];   // routeItems with each city's items folded into one card (js/city-routes.js)
const cityAreaCount = (card) => routeCache.get(card.baseId)?.networks?.get(card.network)?.areas.size || 0;
const CHEVRON = '<svg class="ic chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';
function renderRouteCards() {
  renderGoalSeg();
  routeCards = groupCityItems(routeItems);
  const label = Object.fromEntries(GOALS);
  const matches = (it) => goalTags(it).includes(routeGoal);
  // a city shows while any of its routes (or its free ride) suits the goal
  const shown = routeGoal === 'all' ? routeCards : routeCards.filter((it) => (it.city ? [...it.routes, ...(it.free ? [it.free] : [])].some(matches) : matches(it)));
  $('routeCards').innerHTML = (shown.length ? '' : '<p class="muted">No routes for that goal yet.</p>') + groupedCards(shown, (it) => {
    if (it.city) {
      const n = routeGoal === 'all' ? it.routes.length : it.routes.filter(matches).length;
      let sub = citySubline(it, cityAreaCount(it));
      if (routeGoal !== 'all') sub = sub.replace(/\d+ routes?/, `${n} ${label[routeGoal].toLowerCase()} route${n === 1 ? '' : 's'}`);
      if (it.mine.length) sub += ` · ${it.mine.length} yours`;
      const sel = [...it.routes, it.free].find((x) => x?.id === selectedRouteId);
      return `<button class="rcard city-card ${sel ? 'on' : ''}" data-city="${escapeHtml(it.baseId)}" aria-haspopup="dialog"><canvas></canvas>
        <div class="city-text"><b>${escapeHtml(it.name)}</b><div class="rsub">${escapeHtml(sub)}</div>${sel ? `<div class="rsel">Selected · ${escapeHtml(shortName(sel.name))}</div>` : '<div class="rsel muted">Pick a route on the map</div>'}</div>${CHEVRON}</button>`;
    }
    const r = routeCache.get(it.id);
    const sub = !r ? 'Could not load' : r.stageRoute && r.oneWay
      ? `${fmtDist(r.turnS, 1)} ${distUnit()} to the finish · ${fmtElev(r.oneWay.ascent).toLocaleString()} ${elevUnit()}`
      : r.free ? `${r.network.nodes.size} junctions · choose every turn`
      : r.netRide ? `${fmtDist(r.lapM, 1)} ${distUnit()} ${r.netOpen ? 'one way' : 'loop'} · ${fmtElev(r.lapClimbM).toLocaleString()} ${elevUnit()} · choose your turns`
      : `${fmtDist(r.turnS || r.total, 1)} ${distUnit()} each way · ${fmtElev(r.ascent).toLocaleString()} ${elevUnit()}`;
    const tags = goalTags(it);
    return `<button class="rcard ${it.id === selectedRouteId ? 'on' : ''}" data-id="${it.id}"><canvas></canvas>
      <div><b>${escapeHtml(it.name.replace(' (built-in)', ''))}</b><div class="rsub">${escapeHtml(it.park || it.group)} · ${sub}</div>${tags.length ? `<div class="rtags">${tags.map((t) => `<span>${label[t]}</span>`).join('')}</div>` : ''}</div></button>`;
  }) + ideasSection();
  watchIdeas($('routeCards'));
  drawThumbs();
  for (const c of routeCards.filter((x) => x.city)) loadCityRivers(c).then((fresh) => { if (fresh) drawThumbs(); });
}

// Card thumbnails need a laid-out canvas, so draw them whenever their pane is visible.
function drawThumbs() {
  for (const c of document.querySelectorAll('#routeCards canvas, #sceneCards canvas')) {
    if (!c.clientWidth) continue;
    const cityId = c.closest('.rcard').dataset.city;
    if (cityId) { drawCityThumb(c, routeCards.find((x) => x.city && x.baseId === cityId)); continue; }
    const r = routeCache.get(c.closest('.rcard').dataset.id);
    if (r) drawTrace(c, lapView(r), 0);
  }
  for (const c of document.querySelectorAll('#workoutList canvas')) {
    const w = workoutCache.get(c.closest('.wrow').dataset.id);
    if (w && c.clientWidth) drawWorkout(c, w, 0, settings.ftp, 1, { compact: true });
  }
}
$('routeCards').addEventListener('click', (e) => {
  const card = e.target.closest('.rcard');
  if (!card) return;
  if (card.dataset.city) { openCity(card.dataset.city); return; }
  selectedRouteId = card.dataset.id;
  for (const c of $('routeCards').querySelectorAll('.rcard')) c.classList.toggle('on', c === card);
  previewSelectedRoute();
});

// ---------- City panel (a ride network's map and routes) ----------
// Full screen over the menu (a <dialog>: Escape closes it, focus goes back to the card). The map shows the whole
// network over its rivers; a route tapped in the list lights up bold on it, a line tapped on the map lists the
// routes that ride it (tap again for the next). The goal chips filter both. Ride starts riding the route at once
// (F104: the defaults the preview would apply — its remembered start, else the plan's, and the ride length and
// pacer as set); "Options" beside it chooses the route and goes back to the menu, where its preview, start
// options and Start button are — the same as picking a card used to (and Ride does that too, with no trainer).
const city = { baseId: null, goal: 'all', sel: null, seg: null, segIds: null, focus: null, lines: [], hint: '', view: { k: 1 } };
const cityRivers = new Map();   // baseId → rivers (the city's scenes: each area's has its own copy, some reaching further)
async function loadCityRivers(card) {
  if (cityRivers.has(card.baseId)) return false;
  const base = routeCache.get(card.baseId);
  const lists = [base?.scene?.rivers];
  cityRivers.set(card.baseId, mergeRivers(lists));
  const cityPark = parkItems?.find((p) => p.id === card.baseId);
  const areas = (parkItems || []).filter((p) => p.area && p.area === cityPark?.routeId && p.scene);
  await Promise.all(areas.map(async (a) => { try { lists.push((await (await fetch(a.scene)).json()).rivers); } catch { /* the core's rivers will do */ } }));
  cityRivers.set(card.baseId, mergeRivers(lists));
  return true;
}
const cityNet = (card) => routeCache.get(card.baseId)?.networks?.get(card.network) || null;
/** A city route's traversal keys (a preset's path; your own route's, from its saved segment names). */
function cityPath(net, it) {
  if (it.preset) return net.presets.find((x) => x.id === it.preset)?.path || [];
  if (it.custom) return keysToIds(net, it.keys) || [];
  return [];
}
function cityMapData(card) {
  const net = cityNet(card);
  if (!net) return null;
  const paths = new Map(card.routes.map((it) => [it.id, cityPath(net, it)]));
  return { net, paths, index: segmentRoutes(card.routes.map((it) => ({ id: it.id, path: paths.get(it.id) }))),
    lines: edgeLines(net).map((L) => ({ id: L.id, lat: L.lat, lon: L.lon })), rivers: cityRivers.get(card.baseId) || [] };
}
function drawCityThumb(canvas, card) {
  const d = card && cityMapData(card);
  if (!d) return;
  const sel = [...card.routes].find((x) => x.id === selectedRouteId);
  drawCityMap(canvas, { lines: d.lines, rivers: d.rivers, route: sel ? d.paths.get(sel.id) : null, thumb: true, project: fitProjection });
}
const cityCard = () => routeCards.find((x) => x.city && x.baseId === city.baseId) || null;
function openCity(baseId) {
  city.baseId = baseId;
  const card = cityCard();
  if (!card) return;
  city.goal = routeGoal;
  city.sel = card.routes.some((x) => x.id === selectedRouteId) ? selectedRouteId : null;
  city.seg = null; city.segIds = null; city.focus = null; city.hint = '';
  city.view = { k: 1 };
  $('cityDlg').showModal();
  // the browser's Back closes the panel (F100: on a phone Back is the way out); the panel's own ways out drop the entry
  if (!history.state?.cityPanel) history.pushState({ ...(history.state || {}), cityPanel: true }, '');
  renderCity();
  $('cityList').querySelector('.city-row.on')?.scrollIntoView({ block: 'nearest' });
  loadCityRivers(card).then((fresh) => { if (fresh && $('cityDlg').open) renderCityMap(); });
}
$('cityBack').addEventListener('click', () => $('cityDlg').close());
window.addEventListener('popstate', () => { if ($('cityDlg').open) $('cityDlg').close(); });
$('cityDlg').addEventListener('close', () => { if (history.state?.cityPanel) history.back(); });
window.addEventListener('resize', () => { if ($('cityDlg').open) renderCityMap(); });
/** The routes the goal shows, and of those the ones on the tapped segment (when one is). */
function cityShown(card) {
  const byGoal = filterByGoal(card.routes, city.goal, goalTags);
  return { byGoal, list: city.segIds ? byGoal.filter((it) => city.segIds.includes(it.id)) : byGoal };
}
function renderCity() {
  const card = cityCard();
  if (!card) { $('cityDlg').close(); return; }
  const label = Object.fromEntries(GOALS);
  const { byGoal, list } = cityShown(card);
  $('cityTitle').textContent = card.name;
  $('citySub').textContent = `${citySubline(card, cityAreaCount(card))}${card.mine.length ? ` · ${card.mine.length} yours` : ''}`;
  $('cityGoals').innerHTML = GOALS.map(([k, l]) => `<button type="button" data-goal="${k}" class="${k === city.goal ? 'on' : ''}" aria-pressed="${k === city.goal}">${k === 'new' ? 'New' : l}</button>`).join('');
  $('cityFree').parentElement.hidden = !card.free;
  const net = cityNet(card);
  // the tapped segment: which routes ride it
  $('citySeg').hidden = !city.seg;
  if (city.seg && net) {
    const e = net.edges.get(city.seg), k = city.segIds.indexOf(city.sel);
    $('citySeg').innerHTML = `<span><b>${escapeHtml(e?.name || 'This segment')}</b> · ${city.segIds.length === 1 ? '1 route rides it' : `${city.segIds.length} routes ride it${k >= 0 ? ` · ${k + 1} of ${city.segIds.length}, tap it again for the next` : ''}`}</span><button type="button" class="link" id="citySegClear">Show all</button>`;
  }
  const facts = (it) => {
    const r = routeCache.get(it.id);
    return r ? `${fmtDist(r.lapM, 1)} ${distUnit()} · ${fmtElev(r.lapClimbM).toLocaleString()} ${elevUnit()}` : '';
  };
  const rowHtml = (it) => {
    const r = routeCache.get(it.id), on = it.id === city.sel, tags = goalTags(it);
    const mine = it.custom ? '<span class="yours">yours</span>' : '';
    const row = `<button type="button" class="city-row-btn" data-id="${escapeHtml(it.id)}" aria-pressed="${on}"><span class="cr-name">${escapeHtml(shortName(it.name))}${mine}</span><span class="cr-facts">${facts(it)}</span></button>`;
    if (!on) return `<li class="city-row">${row}</li>`;
    const kind = r ? (r.netOpen ? 'One way' : 'Loop') : '';
    const detail = `<div class="cr-detail"><div class="cr-tags">${[kind, ...tags.map((t) => label[t])].filter(Boolean).map((t) => `<span>${escapeHtml(t)}</span>`).join('')}</div>
      ${it.note && !it.custom ? `<p class="cr-note">${escapeHtml(it.note)}</p>` : ''}
      <div class="cr-actions">${it.custom ? `<button type="button" class="ghost danger" data-remove="${escapeHtml(it.id)}">Remove</button>` : ''}<button type="button" class="link" data-options="${escapeHtml(it.id)}" title="Choose where to start and how long to ride, then Start" aria-label="Options for ${escapeHtml(shortName(it.name))}: start and length">Options</button><button type="button" class="primary" data-ride="${escapeHtml(it.id)}" aria-label="Ride ${escapeHtml(shortName(it.name))} now" title="Start riding it now">Ride</button></div></div>`;
    return `<li class="city-row on">${row}${detail}</li>`;
  };
  // grouped by area (F103) when the city has more than one: a heading per area, its routes in the network's order
  const groups = net?.multi ? groupByArea(list, (it) => cityPath(net, it), (id) => { const e = net.edges.get(id); return e && { area: e.area, len: e.len }; }, [...net.areas.keys()]) : [{ area: null, items: list }];
  if (!list.some((it) => it.id === city.sel)) city.sel = groups[0]?.items[0]?.id || null;   // (the top of the list as shown)
  const heading = (g) => (groups.length > 1 ? `<li class="city-group" role="presentation">${escapeHtml(g.area ? net.areas.get(g.area)?.json?.name || g.area : 'To plan again')}</li>` : '');
  $('cityList').innerHTML = list.length ? groups.map((g) => heading(g) + g.items.map(rowHtml).join('')).join('') : `<li class="muted city-none">No ${city.goal === 'all' ? '' : `${label[city.goal].toLowerCase()} `}routes${city.seg ? ' on this segment' : ''} yet${byGoal.length ? '' : ' — try another goal, or plan your own'}.</li>`;
  const sel = list.find((it) => it.id === city.sel);
  $('citySel').textContent = sel ? `${shortName(sel.name)}: ${facts(sel)}` : '';
  renderCityMap();
}
function renderCityMap() {
  const card = cityCard(), d = card && cityMapData(card);
  if (!d) return;
  const { byGoal } = cityShown(card);
  const lit = new Set(byGoal.flatMap((it) => (d.paths.get(it.id) || []).map((k) => k.replace(/[+-]$/, ''))));
  city.lines = drawCityMap($('cityMap'), { lines: d.lines, rivers: d.rivers, nodes: [...d.net.nodes.values()],
    lit: city.goal === 'all' ? null : lit, route: city.sel ? d.paths.get(city.sel) : null, marked: city.seg, focus: city.focus,
    project: (lines, w, h, pad) => zoomProjection(fitProjection(lines, w, h, pad), w, h, city.view) });
  const zoomed = (city.view?.k || 1) > 1;
  $('cityMap').classList.toggle('zoomed', zoomed);
  $('cityFit').hidden = !zoomed;
  $('cityMap').lines = city.lines;   // (tools/snap_city.mjs taps a line by these)
  const sel = card.routes.find((x) => x.id === city.sel), fe = city.focus && d.net.edges.get(city.focus);
  $('cityMap').setAttribute('aria-label', `Map of ${card.name}${sel ? `, ${shortName(sel.name)} highlighted` : ''}. Arrow keys pick a segment, Enter lists the routes that ride it.`);
  $('cityMapHint').textContent = city.hint || (fe ? `${fe.name} · Enter to see its routes` : 'Tap a line to see the routes that ride it');
}
function citySelect(id, { scroll = true } = {}) {
  city.sel = id;
  renderCity();
  if (scroll) $('cityList').querySelector('.city-row.on')?.scrollIntoView({ block: 'nearest' });
}
/** A segment tapped (or chosen with the keyboard): list the routes that ride it, select the first (again: the next). */
function cityTapSegment(edgeId) {
  const card = cityCard(), d = card && cityMapData(card);
  if (!d) return;
  const { byGoal } = cityShown(card);
  const res = pickOnSegment(d.index, edgeId, byGoal.map((it) => it.id), { lastEdge: city.seg, selected: city.sel });
  const e = d.net.edges.get(edgeId);
  if (!res.ids.length) {
    city.hint = `No ${city.goal === 'all' ? '' : `${Object.fromEntries(GOALS)[city.goal].toLowerCase()} `}route rides ${e?.name || 'that segment'} — Free ride or Plan your own can`;
    renderCityMap();
    return;
  }
  city.hint = '';
  city.seg = edgeId; city.segIds = res.ids;
  citySelect(res.selected);
}
function cityChoose(id) {
  // the same as picking its card in the list used to: it's the route, and the menu shows its preview and Start
  $('cityDlg').close();
  selectedRouteId = id;
  renderRouteCards();
  const shown = previewSelectedRoute();
  if (matchMedia('(max-width: 1080px)').matches) document.querySelector('.preview').scrollIntoView({ block: 'start' });
  $('startBtn').focus({ preventScroll: true });
  return shown;
}
/** Ride (F104): choose the route and start riding it at once, as Start would with the preview's defaults. */
async function cityRide(id) {
  if (chosen !== 'route') showPane('route');
  await cityChoose(id);
  // (no trainer yet, or the route didn't load: the menu shows it chosen, with what's missing on its Start button)
  if (!trainer.connected || selectedRouteId !== id || !previewRoute || previewRoute !== routeCache.get(id)) return;
  await startRide();
}
// zoom and pan (F102): pinch or the wheel zooms about the fingers / the pointer, a drag pans once zoomed in;
// "Whole map" goes back out. Lines stay as easy to tap in px, so zoomed in they are further apart
const mapPtrs = new Map();
let mapDrag = null;   // {x, y, d, moved}: the gesture under way (one pointer's place, or two pointers' midpoint and spread)
function mapGesture() {
  const p = [...mapPtrs.values()];
  if (!p.length) return null;
  const x = p.reduce((t, q) => t + q.x, 0) / p.length, y = p.reduce((t, q) => t + q.y, 0) / p.length;
  return { x, y, d: p.length > 1 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0, n: p.length };
}
$('cityMap').addEventListener('pointerdown', (e) => {
  const rect = e.currentTarget.getBoundingClientRect();
  mapPtrs.set(e.pointerId, { x: e.clientX - rect.left, y: e.clientY - rect.top });
  mapDrag = { ...mapGesture(), moved: mapDrag?.moved || false };
});
$('cityMap').addEventListener('pointermove', (e) => {
  if (!mapPtrs.has(e.pointerId) || !mapDrag) return;
  const rect = e.currentTarget.getBoundingClientRect(), w = rect.width, h = rect.height;
  mapPtrs.set(e.pointerId, { x: e.clientX - rect.left, y: e.clientY - rect.top });
  const g = mapGesture();
  if (g.n !== mapDrag.n) { mapDrag = { ...g, moved: mapDrag.moved }; return; }
  if (Math.hypot(g.x - mapDrag.x, g.y - mapDrag.y) < 6 && Math.abs(g.d - mapDrag.d) < 6 && !mapDrag.moved) return;   // still a tap
  let v = city.view || { k: 1 };
  if (g.n > 1 && mapDrag.d > 0) v = zoomAt(v, w, h, g.x, g.y, g.d / mapDrag.d);
  if (v.k > 1) v = panBy(v, w, h, g.x - mapDrag.x, g.y - mapDrag.y);
  else if (g.n < 2) return;   // the whole map: a one-finger drag scrolls the page (touch-action pan-y)
  e.preventDefault();
  city.view = v; mapDrag = { ...g, moved: true };
  renderCityMap();
});
const mapUp = (e) => { mapPtrs.delete(e.pointerId); if (!mapPtrs.size && mapDrag) setTimeout(() => { mapDrag = null; }, 0); else if (mapDrag) mapDrag = { ...mapGesture(), moved: mapDrag.moved }; };
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) $('cityMap').addEventListener(ev, mapUp);
$('cityMap').addEventListener('wheel', (e) => {
  const rect = e.currentTarget.getBoundingClientRect();
  e.preventDefault();
  city.view = zoomAt(city.view || { k: 1 }, rect.width, rect.height, e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY / 300));
  renderCityMap();
}, { passive: false });
// hovering a line with a mouse previews which routes ride it (F105), in the map's hint
$('cityMap').addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || mapDrag?.moved) return;
  const card = cityCard(), d = card && cityMapData(card);
  if (!d) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const j = nearestLine(city.lines, e.clientX - rect.left, e.clientY - rect.top, 14);
  const id = j >= 0 ? city.lines[j].id : null;
  if (id === city.hover) return;
  city.hover = id;
  if (!id) { $('cityMapHint').textContent = city.hint || 'Tap a line to see the routes that ride it'; return; }
  const { byGoal } = cityShown(card);
  const n = (d.index.get(id) || []).filter((r) => byGoal.some((it) => it.id === r)).length;
  $('cityMapHint').textContent = `${d.net.edges.get(id)?.name || 'This segment'} · ${n ? `${n === 1 ? '1 route rides' : `${n} routes ride`} it — click to list them` : 'no route rides it — Free ride or Plan your own can'}`;
});
$('cityMap').addEventListener('pointerleave', () => { if (city.hover) { city.hover = null; renderCityMap(); } });
$('cityFit').addEventListener('click', () => { city.view = { k: 1 }; renderCityMap(); $('cityMap').focus({ preventScroll: true }); });
$('cityMap').addEventListener('click', (e) => {
  if (mapDrag?.moved) return;   // the end of a pinch or a drag, not a tap
  const rect = e.currentTarget.getBoundingClientRect();
  const j = nearestLine(city.lines, e.clientX - rect.left, e.clientY - rect.top, e.pointerType === 'mouse' ? 14 : 22);
  if (j >= 0) { city.focus = null; cityTapSegment(city.lines[j].id); return; }
  if (city.seg) { city.seg = null; city.segIds = null; renderCity(); }   // off the lines: back to every route
});
$('cityMap').addEventListener('keydown', (e) => {
  const card = cityCard(), d = card && cityMapData(card);
  if (!d) return;
  // the keyboard's way round the map: the segments the goal lights, in order
  const { byGoal } = cityShown(card);
  const ids = d.lines.map((L) => L.id).filter((id) => (d.index.get(id) || []).some((r) => byGoal.some((it) => it.id === r)));
  if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key) && ids.length) {
    const i = ids.indexOf(city.focus), dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    city.focus = ids[(i < 0 ? (dir > 0 ? 0 : ids.length - 1) : (i + dir + ids.length) % ids.length)];
    city.hint = '';
    renderCityMap();
    $('citySel').textContent = `${d.net.edges.get(city.focus)?.name}: ${(d.index.get(city.focus) || []).length} routes`;
  } else if ((e.key === 'Enter' || e.key === ' ') && city.focus) cityTapSegment(city.focus);
  else return;
  e.preventDefault();
});
$('cityGoals').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-goal]');
  if (!b) return;
  city.goal = b.dataset.goal; city.seg = null; city.segIds = null; city.hint = '';
  renderCity();
});
$('citySeg').addEventListener('click', (e) => { if (e.target.id === 'citySegClear') { city.seg = null; city.segIds = null; renderCity(); } });
$('cityList').addEventListener('click', async (e) => {
  const ride = e.target.closest('[data-ride]'), opts = e.target.closest('[data-options]'), rm = e.target.closest('[data-remove]'), row = e.target.closest('.city-row-btn');
  if (ride) cityRide(ride.dataset.ride);
  else if (opts) cityChoose(opts.dataset.options);
  else if (rm) {
    if (!confirm('Remove this route from your library?')) return;
    await removeNetRoute(rm.dataset.remove);
    if ($('cityDlg').open) renderCity();
  } else if (row) citySelect(row.dataset.id, { scroll: false });
});
$('cityList').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const rows = [...$('cityList').querySelectorAll('.city-row-btn')], i = rows.indexOf(document.activeElement);
  if (i < 0) return;
  const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
  e.preventDefault();
  citySelect(next.dataset.id);
  $('cityList').querySelector(`.city-row-btn[data-id="${CSS.escape(next.dataset.id)}"]`)?.focus();
});
// the Free ride tile starts it at once, as Ride does (F104); Options beside it chooses it and shows its preview
$('cityFree').addEventListener('click', () => { const c = cityCard(); if (c?.free) cityRide(c.free.id); });
$('cityFreeOpts').addEventListener('click', () => { const c = cityCard(); if (c?.free) cityChoose(c.free.id); });
$('cityPlan').addEventListener('click', () => { const c = cityCard(); if (c) openPlanner(c.routes.find((x) => !x.custom) || c.free); });

async function loadRouteItem(item) {
  if (routeCache.has(item.id)) return routeCache.get(item.id);
  if (item.preset || item.free || item.custom) {
    // a network preset: the path route over the city loop's own route and world (js/network.js)
    const base = await loadRouteItem(parkItems.find((p) => p.id === item.baseId));
    base.networks ||= new Map();
    if (!base.networks.has(item.network)) base.networks.set(item.network, loadNetwork(netCache.get(item.network), await networkBases(netCache.get(item.network), base)));
    const net = base.networks.get(item.network);
    let preset;
    if (item.free) preset = { id: item.routeId, name: item.name, path: null, first: net.json.freeRide.first };
    else if (item.custom) {
      const path = keysToIds(net, item.keys);
      if (!path) throw new Error(`${item.name} uses segments the network no longer has — plan it again`);
      preset = { id: item.routeId, name: item.name, path };
    } else preset = net.presets.find((x) => x.id === item.preset);
    const route = makePathRoute(net, preset, { id: item.routeId, name: item.name, park: item.park });
    route.note = item.note || '';
    route.scene = base.scene;
    // the path ahead changed (a turn chosen, or the path refilled): the arches follow it
    route.netRide.addEventListener('change', () => { if (session.route === route && world?.path === route.netRide) world.setCourseMarks(courseMarks()); });
    routeCache.set(item.id, route);
    return route;
  }
  const text = item.text ?? await (await fetch(item.url)).text();
  const route = buildCatalogRoute(text, item);
  route.sourceFile = item.file;
  await loadRouteScene(route).catch((err) => log('3d', err.message, 'error'));
  routeCache.set(item.id, route);
  return route;
}

/**
 * The base routes a network rides: its one base line, or (a city of areas, PLAN 5.4) every area's line, keyed by
 * area id — the city's own route for the area it shares files with, the others' lines without their scenery
 * (the world fetches that when it needs it: js/routes.js loadRouteScene).
 */
async function networkBases(json, cityRoute) {
  if (json.format !== 'bikefree-network-2') return cityRoute;
  const bases = new Map();
  for (const a of json.areas) {
    const it = parkItems.find((p) => p.routeId === a.catalogId);
    if (!it) throw new Error(`No catalog entry for area ${a.id}`);
    if (it.file === cityRoute.sourceFile) { bases.set(a.id, cityRoute); continue; }
    const key = `area-${it.id}`;
    if (!routeCache.has(key)) {
      const r = buildCatalogRoute(await (await fetch(it.url)).text(), it);
      r.sourceFile = it.file;
      routeCache.set(key, r);
    }
    bases.set(a.id, routeCache.get(key));
  }
  return bases;
}

async function previewSelectedRoute() {
  const item = routeItems.find((r) => r.id === selectedRouteId);
  $('routeDelete').hidden = !item || item.id.startsWith('builtin');
  $('routeOffline').hidden = !item?.park;
  if (!item) return;
  try {
    previewRoute = await loadRouteItem(item);
    // a network route not being ridden: show its plan, not the turns chosen on the last ride
    if (previewRoute.netRide && session.route !== previewRoute) previewRoute.netRide.reset();
  } catch (err) {
    previewRoute = null;
    log('app', `Could not load route: ${err.message}`, 'error');
    return;
  }
  renderOffline();
  renderPreview();
}

const closeMenus = () => { for (const d of document.querySelectorAll('details.more')) d.open = false; };
document.addEventListener('click', (e) => { if (!e.target.closest('details.more')) closeMenus(); });

// ---------- Offline park downloads ----------
let offlineAbort = null;
function renderOffline() {
  if (offlineAbort) return;
  const bundled = !!previewRoute?.scene;
  $('routeOffline').disabled = bundled;
  if (bundled) {
    $('routeOffline').textContent = 'Scenery included';
    $('offlineStatus').textContent = 'No separate scenery download needed';
    return;
  }
  const id = selectedRouteId;
  const st = offlineStatus(id);
  $('routeOffline').textContent = st ? 'Update offline copy' : 'Save for offline';
  $('offlineStatus').textContent = st
    ? `Saved for offline · ${(st.bytes / 1e6).toFixed(0)} MB · ${new Date(st.date).toLocaleDateString()}${st.failed ? ` · ${st.failed} files missing` : ''}`
    : '';
}
$('routeOffline').addEventListener('click', async () => {
  if (offlineAbort) { offlineAbort.abort(); return; }
  if (!previewRoute) return;
  if (!('caches' in window)) { alert('This browser can\'t store files for offline use here.'); return; }
  const id = selectedRouteId;
  const keys = planRouteTiles(previewRoute);
  // a wireframe placeholder draws only the elevation tiles (no aerial photos)
  const wire = routeItems.find((it) => it.id === id)?.wireframe;
  const urls = tileKeysToUrls(keys, { imagery: !wire });
  const estMB = Math.round((urls.length * 35) / 1000);
  if (!confirm(`Download ${urls.length.toLocaleString()} terrain and imagery files (about ${estMB} MB) for ${previewRoute.name}?`)) return;
  offlineAbort = new AbortController();
  $('routeOffline').textContent = 'Cancel download';
  const status = $('offlineStatus');
  status.innerHTML = '<progress max="1" value="0"></progress><span>Starting…</span>';
  const t0 = performance.now();
  try {
    const res = await downloadUrls(urls, (p) => {
      status.querySelector('progress').value = p.done / p.total;
      status.querySelector('span').textContent = `${p.done.toLocaleString()} / ${p.total.toLocaleString()} files · ${(p.bytes / 1e6).toFixed(0)} MB`;
    }, offlineAbort.signal);
    if (offlineAbort.signal.aborted) {
      log('app', 'Offline download cancelled');
    } else {
      setOfflineStatus(id, { date: Date.now(), files: res.total, bytes: res.bytes, failed: res.failed });
      log('app', `Saved ${previewRoute.name} for offline: ${(res.bytes / 1e6).toFixed(0)} MB in ${((performance.now() - t0) / 1000).toFixed(0)} s${res.failed ? `, ${res.failed} failed` : ''}`, 'ok');
    }
  } catch (err) {
    log('app', `Offline download failed: ${err.message}`, 'error');
  } finally {
    offlineAbort = null;
    renderOffline();
  }
});
$('routeDelete').addEventListener('click', async () => {
  closeMenus();
  const id = selectedRouteId;
  if (id.startsWith('builtin') || !confirm('Remove this route from your library?')) return;
  if (id.startsWith('mynet-')) { await removeNetRoute(id); return; }
  await store.deleteLibraryItem(id);
  routeCache.delete(id);
  await refreshRouteList();
});
/** Your own network route (the map planner): kept in settings. */
async function removeNetRoute(id) {
  settings.netRoutes = (settings.netRoutes || []).filter((m) => m.id !== id);
  saveSettings(settings);
  routeCache.delete(id);
  netItems = []; parkItems = null;
  await refreshRouteList();
}
$('gpxFile').addEventListener('change', async (e) => {
  closeMenus();
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = parseGpx(text);
    const name = parsed.name || file.name.replace(/\.gpx$/i, '');
    buildRoute({ name, points: parsed.points }); // validate before saving
    const id = `route-${Date.now()}`;
    await store.saveLibraryItem({ id, kind: 'route', name, text });
    log('app', `Loaded route ${name}`, 'ok');
    await refreshRouteList(id);
  } catch (err) {
    log('app', `Could not load GPX: ${err.message}`, 'error');
  }
});
session.addEventListener('routeFinished', () => openSummary(`Route complete — ${session.route.name}`));
session.addEventListener('routeGoal', () => toast('Goal reached — keep riding, or finish when you like'));

// ---------- Workouts ----------
let workoutItems = [];
let previewWorkout = null;
let selectedWorkoutId = null;
const workoutCache = new Map();

function parseWorkoutItem(item) {
  if (!workoutCache.has(item.id)) {
    const w = parseWorkout(item.text, item.filename || '');
    if (!w.name || w.name === 'Workout') w.name = item.name.replace(' (built-in)', '');
    if (item.ftpTest) markFtpTest(w);
    workoutCache.set(item.id, w);
  }
  return workoutCache.get(item.id);
}

async function refreshWorkoutList(selectId) {
  const builtins = BUILT_IN_WORKOUTS.map((b) => ({ ...b, kind: 'workout', name: `${parseWorkout(b.text).name} (built-in)` }));
  workoutItems = [...builtins, ...(await store.listLibrary('workout').catch(() => []))];
  if (selectId || !workoutItems.some((w) => w.id === selectedWorkoutId)) selectedWorkoutId = selectId || workoutItems[0].id;
  renderWorkoutList();
  previewSelectedWorkout();
}

function renderWorkoutList() {
  $('workoutList').innerHTML = workoutItems.map((it) => {
    let w = null;
    try { w = parseWorkoutItem(it); } catch { /* shown as unreadable */ }
    return `<button class="wrow ${it.id === selectedWorkoutId ? 'on' : ''}" data-id="${it.id}">
      <span><b>${escapeHtml(w ? w.name : it.name)}</b><span class="rsub">${w ? `${fmtTime(w.duration)}${it.id.startsWith('builtin') ? ' · built-in' : ''}` : 'Could not read this file'}</span></span>
      <canvas></canvas></button>`;
  }).join('');
  drawThumbs();
}
$('workoutList').addEventListener('click', (e) => {
  const row = e.target.closest('.wrow');
  if (!row) return;
  selectedWorkoutId = row.dataset.id;
  for (const r of $('workoutList').children) r.classList.toggle('on', r === row);
  previewSelectedWorkout();
});

function previewSelectedWorkout() {
  const item = workoutItems.find((w) => w.id === selectedWorkoutId);
  $('workoutDelete').hidden = !item || item.id.startsWith('builtin');
  if (!item) return;
  try {
    previewWorkout = parseWorkoutItem(item);
  } catch (err) {
    previewWorkout = null;
    log('app', `Could not read workout: ${err.message}`, 'error');
    return;
  }
  renderPreview();
}

function workoutStats(w) {
  let work = 0, maxW = 0;
  for (const s of w.segments) {
    if (s.kind !== 'erg') continue;
    work += targetWatts(s, s.start + s.duration / 2, settings.ftp) * s.duration;
    maxW = Math.max(maxW, targetWatts(s, s.start, settings.ftp), targetWatts(s, s.start + s.duration, settings.ftp));
  }
  return { kj: Math.round(work / 1000), maxW };
}

$('workoutDelete').addEventListener('click', async () => {
  closeMenus();
  const id = selectedWorkoutId;
  if (!id || id.startsWith('builtin') || !confirm('Remove this workout from your library?')) return;
  await store.deleteLibraryItem(id);
  workoutCache.delete(id);
  selectedWorkoutId = null;
  await refreshWorkoutList();
});
$('workoutFile').addEventListener('change', async (e) => {
  closeMenus();
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const w = parseWorkout(text, file.name);
    const name = w.name && w.name !== 'Workout' ? w.name : file.name.replace(/\.\w+$/, '');
    const id = `workout-${Date.now()}`;
    await store.saveLibraryItem({ id, kind: 'workout', name, text, filename: file.name });
    log('app', `Loaded workout ${name}`, 'ok');
    await refreshWorkoutList(id);
  } catch (err) {
    log('app', `Could not load workout: ${err.message}`, 'error');
  }
});

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
  $('sumTitle').textContent = title || 'Finish ride?';
  $('sumSub').textContent = `${snap.name} · ${new Date(snap.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`;
  $('sumGrid').innerHTML = statCells(snap.summary);
  $('sumLaps').innerHTML = lapTable(snap);
  renderFtpResult();
  const dlg = $('summary');
  dlg.returnValue = '';
  dlg.onclose = async () => {
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
    await store.saveCurrent(null).catch(() => {});
    if (!finished || v === 'discard') { log('app', 'Ride discarded'); showSetup(); return; }
    finished.profileId = profiles.active.id;
    try {
      await store.saveRide(finished);
      log('app', `Ride saved: ${finished.name}, ${fmtTime(finished.summary.timerS)}`, 'ok');
    } catch (err) {
      log('app', `Could not save ride: ${err.message}`, 'error');
    }
    if (v === 'download') downloadFit(finished);
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
setInterval(() => {
  if (!session.hasRide) return;
  const snap = session.recorder.snapshot(session.rideMeta());
  if (snap) store.saveCurrent(snap).catch(() => {});
}, 15000);

async function checkRecovery() {
  const cur = await store.getCurrent().catch(() => null);
  if (!cur || !cur.samples?.length) return;
  const when = new Date(cur.startedAt).toLocaleString();
  if (confirm(`An unfinished ride from ${when} (${fmtTime(cur.summary.timerS)}) was found. Save it to your rides?`)) {
    cur.profileId ??= profiles.active.id;
    await store.saveRide(cur);
    log('app', 'Recovered unfinished ride and saved it', 'ok');
  }
  await store.saveCurrent(null);
}

// ---------- Profiles ----------
const riderName = (p) => p.name?.trim() || `Rider ${profiles.all.indexOf(p) + 1}`;
const fmtHours = (s) => (s >= 3600 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 60)} min`);
function statFacts(st) {
  return fact(st.rides.toLocaleString(), st.rides === 1 ? 'ride' : 'rides') +
    fact(fmtDist(st.distanceM, st.distanceM < 16000 ? 1 : 0), `${distUnit()} ridden`) +
    fact(fmtHours(st.movingS), 'riding') +
    fact(fmtElev(st.ascentM).toLocaleString(), `${elevUnit()} climbed`);
}

let rideCache = [];
async function renderProfile() {
  rideCache = await store.listRides().catch(() => []);
  const p = profiles.active;
  const st = profiles.stats(p.id, rideCache);
  $('pAvatar').textContent = initials(p.name);
  $('pName').textContent = p.name?.trim() ? p.name.trim() : 'Set up profile';
  $('pStats').textContent = p.name?.trim() ? `${st.rides} ${st.rides === 1 ? 'ride' : 'rides'} · ${fmtDist(st.distanceM, st.distanceM < 16000 ? 1 : 0)} ${distUnit()}` : '';
  $('welcome').hidden = !!p.name?.trim() || profiles.all.length > 1;
  if ($('profileDlg').open) fillProfileStats();
}

const pform = $('profileDlg').querySelector('form');
$('pdGender').innerHTML = GENDERS.map(([v, label]) => `<option value="${v}">${label}</option>`).join('');
function fillProfileStats() {
  const p = profiles.active;
  $('pdStats').innerHTML = statFacts(profiles.stats(p.id, rideCache));
}
function fillProfile() {
  const p = profiles.active, f = pform.elements, imp = imperial();
  $('pdAvatar').textContent = initials(p.name);
  $('pdTitle').textContent = p.name?.trim() ? p.name.trim() : 'Your profile';
  $('pdSince').textContent = `Rider since ${new Date(p.createdAt).toLocaleDateString([], { month: 'long', year: 'numeric' })}`;
  const sw = $('pdSwitch');
  sw.innerHTML = profiles.all.map((x) => `<option value="${x.id}">${escapeHtml(riderName(x))}</option>`).join('');
  sw.value = p.id;
  sw.hidden = profiles.all.length < 2;
  f.pname.value = p.name || '';
  $('pdHeightImp').hidden = !imp;
  $('pdHeightMet').hidden = imp;
  if (p.heightCm) {
    const [ft, inch] = cmToFtIn(p.heightCm);
    f.hft.value = ft; f.hin.value = inch; f.hcm.value = Math.round(p.heightCm);
  } else { f.hft.value = ''; f.hin.value = ''; f.hcm.value = ''; }
  f.pweight.value = +(imp ? p.weightKg / KG_PER_LB : p.weightKg).toFixed(1);
  f.pgender.value = p.gender || '';
  f.pftp.value = p.ftp;
  for (const el of pform.querySelectorAll('.u-weight')) el.textContent = imp ? 'lb' : 'kg';
  // Riders can't be switched mid-ride: the ride belongs to whoever started it.
  const locked = session.hasRide;
  sw.disabled = locked;
  $('pdNew').disabled = locked;
  $('pdDelete').hidden = profiles.all.length < 2 || locked;
  $('pdNote').textContent = locked ? 'Finish the current ride to switch or add riders.' : 'Weight sets how hard climbs feel. Your profile and rides stay in this browser.';
  fillProfileStats();
  setTimeout(() => { if (!f.pname.value) f.pname.focus(); }, 0);
}
function openProfile() { renderProfile().then(fillProfile); fillProfile(); $('profileDlg').showModal(); }
$('profileBtn').addEventListener('click', openProfile);
$('welcomeBtn').addEventListener('click', openProfile);

function useActiveProfile() {
  settings.riderKg = profiles.active.weightKg;
  settings.ftp = profiles.active.ftp;
  saveSettings(settings);
  session.settingsChanged();
  renderProfile();
}
$('pdSwitch').addEventListener('change', (e) => {
  profiles.setActive(e.target.value);
  useActiveProfile();
  fillProfile();
});
$('pdNew').addEventListener('click', () => {
  profiles.create();
  useActiveProfile();
  fillProfile();
  pform.elements.pname.focus();
});
$('pdDelete').addEventListener('click', () => {
  const p = profiles.active;
  if (!confirm(`Delete ${riderName(p)}? Their saved rides are kept and move to ${riderName(profiles.all.find((x) => x.id !== p.id && x.id === profiles.firstId) || profiles.all.find((x) => x.id !== p.id))}.`)) return;
  profiles.remove(p.id);
  useActiveProfile();
  fillProfile();
});
$('profileDlg').addEventListener('close', () => {
  if ($('profileDlg').returnValue !== 'save') return;
  const f = pform.elements, imp = imperial();
  const heightCm = imp
    ? (f.hft.value || f.hin.value ? ftInToCm(f.hft.value, f.hin.value) : null)
    : (Number(f.hcm.value) || null);
  const kg = Number(f.pweight.value) * (imp ? KG_PER_LB : 1);
  profiles.update(profiles.active.id, {
    name: f.pname.value.trim(),
    heightCm: heightCm ? Math.round(heightCm * 10) / 10 : null,
    weightKg: kg > 20 ? Math.round(kg * 10) / 10 : profiles.active.weightKg,
    gender: f.pgender.value,
    ftp: Math.round(Number(f.pftp.value)) || profiles.active.ftp,
  });
  useActiveProfile();
  log('app', `Profile saved: ${riderName(profiles.active)}`, 'ok');
});

// ---------- Settings dialog ----------
const dlg = $('settings');
const form = dlg.querySelector('form');
/**
 * [w2-polish] Show only the times of day the open route really has (a baked scene: its baked time and night),
 * and pick the one it shows for the saved choice. The saved choice is kept unless the rider changes the menu.
 */
let shownTime = null;
function timeMenu(select) {
  const offered = onRideScreen ? world?.timeOptions?.().map((o) => o.key) : null;   // the route being ridden
  for (const opt of select.options) { const off = offered && opt.value !== 'auto' && !offered.includes(opt.value); opt.hidden = off; opt.disabled = off; }
  let key = settings.worldTime;
  if (offered && key !== 'auto' && !offered.includes(key)) key = offered.includes(world.timeKey) ? world.timeKey : 'auto';
  return (shownTime = key);
}
function fillSettings() {
  const imp = imperial();
  const f = form.elements;
  f.theme.value = window.BFTheme?.pref() || 'system';
  f.units.value = settings.units;
  f.bike.value = +(imp ? settings.bikeKg / KG_PER_LB : settings.bikeKg).toFixed(1);
  f.worldTime.value = timeMenu(f.worldTime);   // [w2-polish] only the times this route shows
  f.worldQuality.value = settings.worldQuality;
  f.worldWeather.value = settings.worldWeather || 'clear';
  f.shiftMode.value = settings.shiftMode;
  f.difficulty.value = settings.difficulty;
  $('diffOut').textContent = `${settings.difficulty}%`;
  f.realRatio.value = settings.realRatio;
  f.haptics.checked = settings.haptics;
  f.hudSize.value = settings.hudSize;
  f.minimap.value = settings.minimap;
  f.startGear.value = settings.startGear;
  for (const el of dlg.querySelectorAll('.u-weight')) el.textContent = imp ? 'lb' : 'kg';
}
form.elements.difficulty.addEventListener('input', (e) => { $('diffOut').textContent = `${e.target.value}%`; });
form.elements.units.addEventListener('change', (e) => {
  const toImp = e.target.value === 'imperial';
  for (const name of ['bike']) {
    const el = form.elements[name];
    el.value = +(toImp ? el.value / KG_PER_LB : el.value * KG_PER_LB).toFixed(1);
  }
  for (const el of dlg.querySelectorAll('.u-weight')) el.textContent = toImp ? 'lb' : 'kg';
});
$('settingsBtn').addEventListener('click', () => { fillSettings(); dlg.showModal(); renderDiag(); });
dlg.addEventListener('close', () => {
  if (dlg.returnValue !== 'save') return;
  const f = form.elements;
  const imp = f.units.value === 'imperial';
  const kg = (v) => (imp ? Number(v) * KG_PER_LB : Number(v));
  Object.assign(settings, {
    units: f.units.value,
    bikeKg: kg(f.bike.value) || settings.bikeKg,
    worldTime: f.worldTime.value === shownTime ? settings.worldTime : f.worldTime.value,   // [w2-polish]
    worldQuality: f.worldQuality.value,
    worldWeather: f.worldWeather.value,
    shiftMode: f.shiftMode.value,
    difficulty: Number(f.difficulty.value),
    realRatio: Math.max(0, Number(f.realRatio.value) || 0),
    haptics: f.haptics.checked,
    hudSize: f.hudSize.value,
    minimap: f.minimap.value,
    startGear: Math.min(24, Math.max(1, Math.round(Number(f.startGear.value) || 12))),
  });
  saveSettings(settings);
  window.BFTheme?.set(f.theme.value);
  session.settingsChanged();
  world?.setTimeOfDay(settings.worldTime);
  world?.setQuality(settings.worldQuality);
  world?.setWeather(settings.worldWeather);
  applyHudPrefs();
  renderRouteCards();
  renderWorkoutList();
  renderProfile();
  showPane(chosen);
  log('app', `Settings saved (${settings.shiftMode.toUpperCase()} shifting, difficulty ${settings.difficulty}%, FTP ${settings.ftp} W)`);
});

window.addEventListener('resize', () => { renderPreview(); drawThumbs(); lastProfileDraw = 0; lastMapDraw = 0; });
window.addEventListener('beforeunload', (e) => {
  if (session.hasRide) { e.preventDefault(); e.returnValue = ''; }
});

// Light / dark: charts are drawn on canvases, so redraw them when the appearance changes (incl. macOS switching).
window.BFTheme?.onChange(() => { renderPreview(); drawThumbs(); lastProfileDraw = 0; lastMapDraw = 0; renderHud(); });

// ---------- Boot ----------
applyHudPrefs();
renderProfile();
session.autoStart = false;
deviceStatus();
refreshRouteList();
refreshWorkoutList();
checkRecovery();
registerServiceWorker(log);
log('app', 'Ready. Close Zwift, Zwift Companion and the Wahoo app, then connect your devices.');

// For debugging in the browser console.
window.bikefree = { pacer, session, trainer, ride, hrStrap, store, profiles, get world() { return world; }, get ftpRun() { return ftpRun; }, get plan() { return plan; } };
