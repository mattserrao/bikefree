import { Trainer } from './trainer.js';
import { Ride } from './ride.js';
import { HeartRate } from './hr.js';
import { Session } from './session.js';
import { powerRequired, speedFromCadence, WHEEL_CIRC } from './physics.js';
import { loadSettings, saveSettings, KG_PER_LB, MI_PER_KM } from './settings.js';
import { rideToFit, fitFilename, summarize } from './recorder.js';
import * as store from './store.js';
import { parseGpx, buildRoute, averageGradeAhead, ascentRemaining } from './gpx.js';
import { parseWorkout, BUILT_IN_WORKOUTS, targetWatts, zoneColor } from './workout.js';
import { drawProfile, drawTrace, drawWorkout } from './views.js';
import { planRouteTiles, tileKeysToUrls, downloadUrls, offlineStatus, setOfflineStatus, registerServiceWorker } from './offline.js';

const $ = (id) => document.getElementById(id);

// ---------- Log ----------
const logEl = $('log');
const logLines = [];
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
  if (level === 'error') $('diag').open = true;
}
document.body.classList.add('hide-debug');
$('debugToggle').addEventListener('change', (e) => document.body.classList.toggle('hide-debug', !e.target.checked));
$('clearLog').addEventListener('click', () => { logEl.innerHTML = ''; logLines.length = 0; });
$('copyLog').addEventListener('click', async () => {
  await navigator.clipboard.writeText(logLines.join('\n'));
  log('app', 'Log copied to clipboard', 'ok');
});

if (!navigator.bluetooth) {
  $('unsupported').hidden = false;
  for (const id of ['rideBtn', 'hrBtn']) $(id).disabled = true;
}

// ---------- Core objects ----------
const settings = loadSettings();
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

const fmtGrade = (g) => `${(Math.abs(g) < 0.05 ? 0 : g).toFixed(1)}%`;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ---------- Device chips ----------
function deviceStatus() {
  const chip = (dev, dot, label, onText, offText) => {
    const on = dev.connected;
    $(dot).className = `dot ${on ? 'on' : dev.reconnecting ? 'wait' : ''}`;
    $(label).textContent = on ? onText() : dev.reconnecting ? 'Reconnecting…' : offText;
  };
  chip(trainer, 'trainerDot', 'trainerLabel', () => trainer.device.name, 'Connect trainer');
  $('trainerDot').classList.toggle('demo', !!trainer.demo);
  chip(ride, 'rideDot', 'rideLabel', () => `Zwift Ride${ride.battery != null ? ` · ${ride.battery}%` : ''}`, 'Connect handlebars');
  chip(hrStrap, 'hrDot', 'hrLabel', () => `${hrStrap.bpm ?? '--'} bpm`, 'Heart rate');
  $('rideInfo').textContent = ride.connected ? `fw ${ride.firmware ?? '?'} · battery ${ride.battery ?? '?'}%` : '—';
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

// ---------- Demo mode: simulated trainer, constant 15 mph ----------
const DEMO_MPH = 15;
const DEMO_SPEED = DEMO_MPH * 0.44704;
let demoHr = 92;
function demoData() {
  const pausedByUser = !session.running && session.movingS > 0 && !session.autoPaused;
  if (pausedByUser) return { powerW: 0, cadenceRpm: 0, speedKph: 0, heartRate: Math.round((demoHr += (78 - demoHr) * 0.01)) };
  const jitter = (a) => 1 + (Math.random() - 0.5) * a;
  const workoutW = session.workoutTarget;
  // Power: what it takes to hold 15 mph on the current grade (or the workout step's target).
  const power = Math.max(0, workoutW != null ? workoutW * jitter(0.04) : powerRequired(DEMO_SPEED, session.gradePct, session.physicsParams()) * jitter(0.06));
  // Cadence: what 15 mph needs in the current gear (so shifting changes it), kept in a sensible range.
  const cadence = workoutW != null ? 88 * jitter(0.03) : Math.min(125, Math.max(45, (DEMO_SPEED / (session.ratio * WHEEL_CIRC)) * 60)) * jitter(0.02);
  demoHr += (Math.min(185, 72 + power * 0.32) - demoHr) * 0.02;
  return { powerW: Math.round(power), cadenceRpm: cadence, speedKph: speedFromCadence(cadence, 2.4) * 3.6, heartRate: Math.round(demoHr) };
}
function setDemo(on) {
  if (on === !!trainer.demo) return;
  if (on) {
    trainer.startDemo(demoData);
    session.demoSpeedMps = DEMO_SPEED;
    log('app', `Demo mode: the rider holds ${DEMO_MPH} mph. Shift with ← →, change grade with ↑ ↓, try a Route or Workout.`, 'ok');
  } else {
    trainer.stopDemo();
    session.demoSpeedMps = null;
    if (session.running) session.pause();
  }
  $('demoBtn').classList.toggle('on', on);
  $('demoBtn').textContent = on ? `Demo · ${DEMO_MPH} mph` : 'Demo';
  $('demoBanner').hidden = !on;
  $('hDemo').hidden = !on;
  session.settingsChanged();
  deviceStatus();
}
$('demoBtn').addEventListener('click', () => setDemo(!trainer.demo));
$('demoOff').addEventListener('click', () => setDemo(false));
$('rideBtn').addEventListener('click', () => toggleDevice(ride, () => ride.connect(false), 'ride'));
$('rideAnyBtn').addEventListener('click', () => toggleDevice(ride, () => ride.connect(true), 'ride'));
$('hrBtn').addEventListener('click', () => toggleDevice(hrStrap, () => hrStrap.connect(), 'hr'));
$('rawToggle').addEventListener('change', (e) => { ride.showRaw = e.target.checked; });

// ---------- Gear bar ----------
const gearbar = $('gearbar');
for (let i = 1; i <= session.gearCount; i++) {
  const s = document.createElement('span');
  s.addEventListener('click', () => session.shift(i - session.gear));
  gearbar.append(s);
}

// ---------- Tabs ----------
let pane = 'free';
function showPane(p) {
  pane = p;
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('on', t.dataset.mode === p);
  for (const el of document.querySelectorAll('.mode-pane')) el.hidden = el.dataset.pane !== p;
  renderStatic();
  renderRoutePane();
  renderWorkoutPane();
}
for (const t of document.querySelectorAll('.tab')) {
  t.addEventListener('click', () => {
    if (t.dataset.mode === 'free' && session.mode !== 'free') {
      session.setFree();
      log('app', 'Switched to free ride');
    }
    showPane(t.dataset.mode);
  });
}

// ---------- Rendering ----------
function renderStatic() {
  $('gear').textContent = session.gear;
  [...gearbar.children].forEach((el, i) => {
    el.classList.toggle('on', i < session.gear);
    el.classList.toggle('cur', i === session.gear - 1);
  });
  $('gradeInput').value = session._manualGrade;
  $('speedUnit').textContent = imperial() ? 'mph' : 'km/h';
  $('distUnit').textContent = distUnit();
  $('elevUnit').textContent = elevUnit();
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active-mode', t.dataset.mode === session.mode);
  const ergWorkout = session.workoutTarget != null;
  document.body.classList.toggle('erg-workout', ergWorkout);
  $('gearHint').textContent = ergWorkout ? 'Workout step — trainer holds the target' : 'Left = easier · Right = harder';
  $('wkBias').textContent = `${Math.round(session.workoutBias * 100)}%`;
}

function renderTick() {
  $('power').textContent = Math.round(session.power);
  $('power3s').textContent = Math.round(session.power3s);
  $('cadence').textContent = Math.round(session.cadence);
  const kph = session.speedMps * 3.6;
  $('speed').textContent = (imperial() ? kph * MI_PER_KM : kph).toFixed(1);
  $('distance').textContent = fmtDist(session.distanceM);
  $('elev').textContent = fmtElev(session.elevGainM);
  $('time').textContent = fmtTime(session.movingS);
  $('timeState').textContent = session.running ? 'riding' : session.autoPaused ? 'auto-paused' : session.movingS ? 'paused' : 'ready';
  $('avgPower').textContent = Math.round(session.avgPower);
  $('hr').textContent = session.hr ?? '--';
  if (hrStrap.connected) $('hrLabel').textContent = `${hrStrap.bpm ?? '--'} bpm`;
  $('startBtn').textContent = session.running ? 'Pause' : session.movingS ? 'Resume' : 'Start';
  const laps = session.recorder.laps.length + 1;
  $('rideStatus').textContent = session.hasRide
    ? `● Recording · ${fmtTime(session.recorder.samples.length)} · lap ${laps}`
    : 'Pedal to start. Your ride is recorded automatically.';
  $('rideStatus').classList.toggle('rec', session.hasRide && session.running);
  $('grade').textContent = fmtGrade(session.gradePct);

  const t = session.target;
  $('target').textContent = !trainer.connected ? '—'
    : t ? (t.mode === 'ERG' ? `ERG ${t.value} W (${t.source})` : `SIM ${t.value.toFixed(1)}%`) : '—';
  $('realRatio').textContent = `${session.realRatio.toFixed(2)}${settings.realRatio ? ' (set)' : session.realRatioEst ? ' (auto)' : ' (default)'}`;
  const tk = trainer.data.speedKph;
  $('trainerSpeed').textContent = tk != null ? `${(imperial() ? tk * MI_PER_KM : tk).toFixed(1)} ${imperial() ? 'mph' : 'km/h'}` : '—';

  if (pane === 'route') renderRouteLive();
  if (pane === 'workout') renderWorkoutLive();
}

session.addEventListener('change', renderStatic);
session.addEventListener('tick', renderTick);

let lastGear = session.gear;
session.addEventListener('change', () => {
  if (session.gear !== lastGear) {
    const el = $('gear');
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    lastGear = session.gear;
  }
});

// ---------- Free ride controls ----------
$('gradeInput').addEventListener('input', (e) => session.setGrade(Number(e.target.value)));
$('gradeUp').addEventListener('click', () => session.setGrade(session._manualGrade + 0.5));
$('gradeDown').addEventListener('click', () => session.setGrade(session._manualGrade - 0.5));
$('flatBtn').addEventListener('click', () => session.setGrade(0));

// ---------- Ride bar ----------
$('startBtn').addEventListener('click', () => session.toggle());
$('lapBtn').addEventListener('click', () => session.lap());
$('finishBtn').addEventListener('click', () => openSummary());

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || document.querySelector('dialog[open]')) return;
  const k = e.key;
  if (k === 'ArrowRight' || k === '=' || k === ']') session.shift(+1);
  else if (k === 'ArrowLeft' || k === '-' || k === '[') session.shift(-1);
  else if (k === 'ArrowUp') session.upDown(1);
  else if (k === 'ArrowDown') session.upDown(-1);
  else if (k === ' ') session.toggle();
  else if (k === 'l' || k === 'L') session.lap();
  else if ((k === 'c' || k === 'C') && worldOpen) cycleCamera();
  else if ((k === 'f' || k === 'F') && worldOpen) toggleFullscreen();
  else return;
  e.preventDefault();
});

// ---------- Routes ----------
const DEMO_ROUTE = { id: 'builtin-demo-hills', kind: 'route', name: 'Demo Hills (built-in)', url: 'routes/demo-hills.gpx', group: 'Other' };
let routeItems = [];
let parkItems = null;
const routeCache = new Map();
let previewRoute = null;

async function loadParks() {
  if (parkItems) return parkItems;
  try {
    const list = await (await fetch('routes/parks/index.json')).json();
    parkItems = list.map((p) => ({ id: `builtin-park-${p.id}`, kind: 'route', name: p.name, url: p.file, park: p.park, group: 'National parks — 3D' }));
  } catch {
    parkItems = [];
  }
  return parkItems;
}

async function refreshRouteList(selectId) {
  const mine = (await store.listLibrary('route').catch(() => [])).map((r) => ({ ...r, group: 'My routes' }));
  routeItems = [...(await loadParks()), ...mine, DEMO_ROUTE];
  const sel = $('routeSelect');
  sel.innerHTML = '';
  const groups = new Map();
  for (const r of routeItems) {
    if (!groups.has(r.group)) {
      const og = document.createElement('optgroup');
      og.label = r.group;
      sel.append(og);
      groups.set(r.group, og);
    }
    groups.get(r.group).append(new Option(r.name, r.id));
  }
  sel.value = selectId || routeItems[0].id;
  await previewSelectedRoute();
}

async function loadRouteItem(item) {
  if (routeCache.has(item.id)) return routeCache.get(item.id);
  const text = item.text ?? await (await fetch(item.url)).text();
  const parsed = parseGpx(text);
  const route = buildRoute({ name: item.name.replace(' (built-in)', '') || parsed.name, points: parsed.points });
  route.park = item.park || null;
  routeCache.set(item.id, route);
  return route;
}

async function previewSelectedRoute() {
  const item = routeItems.find((r) => r.id === $('routeSelect').value);
  $('routeDelete').hidden = !item || item.id.startsWith('builtin');
  if (!item) return;
  try {
    previewRoute = await loadRouteItem(item);
  } catch (err) {
    previewRoute = null;
    $('routeInfo').textContent = `Could not load route: ${err.message}`;
    return;
  }
  renderRoutePane();
  renderOffline();
  if (worldOpen) openWorld(currentWorldRoute());
}

const ridingPreviewedRoute = () => session.mode === 'route' && session.route && session.route === previewRoute;

function renderRoutePane() {
  if (pane !== 'route' || !previewRoute) return;
  const r = previewRoute;
  const riding = ridingPreviewedRoute();
  $('routeInfo').innerHTML = `<b>${escapeHtml(r.name)}</b>${r.park ? ` · ${escapeHtml(r.park)}` : ''} · ${fmtDist(r.total, 1)} ${distUnit()}${r.closed ? ' loop' : ''} · ` +
    `${fmtElev(r.ascent)} ${elevUnit()} climbing · steepest ${Math.round(Math.max(...r.grade))}%` +
    (r.hasElevation ? '' : ' · <span class="warn">no elevation in this file — it will be flat</span>') +
    (r.closed ? ' · <span class="muted">laps continue as long as you ride</span>' : '') +
    (riding ? (session.routeDone ? ' · <span class="ok">finished</span>' : ' · <span class="ok">riding now</span>') : '') +
    (!riding && session.mode === 'route' && session.route ? ` · <span class="muted">currently riding ${escapeHtml(session.route.name)}</span>` : '');
  $('routeStats').hidden = !riding;
  $('rLapBox').hidden = !r.closed;
  $('route3d').textContent = worldOpen ? 'Hide 3D' : '3D view';
  $('routeGo').hidden = riding;
  $('routeRestart').hidden = !riding;
  renderRouteLive();
}

function renderRouteLive() {
  if (!previewRoute) return;
  const riding = ridingPreviewedRoute();
  const r = previewRoute;
  const pos = riding ? session.routePos : 0;
  drawProfile($('profile'), r, pos, { metric: !imperial() });
  drawTrace($('trace'), r, pos);
  if (!riding) return;
  const ahead = imperial() ? 804.672 : 500;
  $('rAheadLabel').textContent = imperial() ? '½ mi' : '500 m';
  $('rGrade').textContent = fmtGrade(session.gradePct);
  $('rAhead').textContent = fmtGrade(averageGradeAhead(r, pos, ahead));
  $('rLeft').textContent = `${fmtDist(Math.max(0, r.total - pos), 1)} ${distUnit()}`;
  $('rLeftLabel').textContent = r.closed ? 'Lap to go' : 'To go';
  $('rLap').textContent = session.routeLap;
  $('rClimb').textContent = `${fmtElev(ascentRemaining(r, pos))} ${elevUnit()}`;
  $('rPct').textContent = `${Math.min(100, Math.floor((pos / r.total) * 100))}%`;
}

$('routeSelect').addEventListener('change', previewSelectedRoute);

// ---------- Offline park downloads ----------
let offlineAbort = null;
function renderOffline() {
  if (offlineAbort) return;
  const id = $('routeSelect').value;
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
  const id = $('routeSelect').value;
  const keys = planRouteTiles(previewRoute);
  const urls = tileKeysToUrls(keys);
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
$('routeGo').addEventListener('click', () => {
  if (!previewRoute) return;
  session.setRoute(previewRoute);
  log('app', `Riding route: ${previewRoute.name} (${fmtDist(previewRoute.total, 1)} ${distUnit()}${previewRoute.closed ? ' loop' : ''})`, 'ok');
  showPane('route');
  if (previewRoute.park || worldOpen) openWorld(previewRoute);
});
$('route3d').addEventListener('click', () => {
  if (worldOpen) closeWorld(); else openWorld(currentWorldRoute());
  renderRoutePane();
});
$('routeRestart').addEventListener('click', () => {
  if (confirm('Restart this route from the beginning? Your ride keeps recording.')) session.restartRoute();
});
$('routeDelete').addEventListener('click', async () => {
  const id = $('routeSelect').value;
  if (id.startsWith('builtin') || !confirm('Remove this route from your library?')) return;
  await store.deleteLibraryItem(id);
  routeCache.delete(id);
  await refreshRouteList();
});
$('gpxFile').addEventListener('change', async (e) => {
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
    alert(`Could not load that GPX file: ${err.message}`);
  }
});
session.addEventListener('routeFinished', () => {
  renderRoutePane();
  openSummary(`Route complete — ${session.route.name}`);
});


// ---------- 3D world ----------
let world = null;
let worldOpen = false;
let worldRoute = null;
let worldModule = null;
let previewPos = 0;
let previewLast = performance.now();

function currentWorldRoute() {
  if (session.mode === 'route' && session.route && (pane !== 'route' || previewRoute === session.route)) return session.route;
  return previewRoute;
}

async function openWorld(route) {
  if (!route) return;
  worldOpen = true;
  $('worldPanel').hidden = false;
  if (world && worldRoute === route) { world.start(); return; }
  try {
    worldModule = worldModule || await import('./world/world.js');
  } catch (err) {
    log('3d', `Could not start the 3D view: ${err.message}`, 'error');
    return;
  }
  if (world) { world.dispose(); world = null; }
  try {
    world = new worldModule.World($('worldView'), route, { log });
  } catch (err) {
    log('3d', `3D view needs WebGL: ${err.message}`, 'error');
    $('worldPanel').hidden = true;
    worldOpen = false;
    return;
  }
  worldRoute = route;
  previewPos = 0;
  world.setCamera(settings.worldCam);
  world.setTimeOfDay(settings.worldTime);
  world.setSource(() => {
    const now = performance.now();
    const dt = (now - previewLast) / 1000;
    previewLast = now;
    if (session.mode === 'route' && session.route === route) {
      return { pos: session.routePos, speed: session.speedMps, cadence: session.cadence, riding: true };
    }
    // Not riding this route yet: a gentle preview fly-along.
    previewPos = (previewPos + 9 * dt) % route.total;
    return { pos: previewPos, speed: 9, cadence: 80, riding: false };
  });
  world.start();
  $('hTitle').textContent = route.park ? `${route.name} · ${route.park}` : route.name;
  log('3d', `3D view: ${route.name}`);
  renderWorldControls();
}

function closeWorld() {
  worldOpen = false;
  $('worldPanel').hidden = true;
  if (document.fullscreenElement) document.exitFullscreen();
  if (world) world.stop();
}

function renderWorldControls() {
  for (const b of document.querySelectorAll('#camSeg button')) b.classList.toggle('on', b.dataset.cam === settings.worldCam);
  for (const b of document.querySelectorAll('#timeSeg button')) b.classList.toggle('on', b.dataset.time === settings.worldTime);
}

// ---------- Power gauge (3D overlay) ----------
const G = { cx: 150, cy: 140, r: 112, start: 150, sweep: 240 };
const gPoint = (t, r = G.r) => {
  const a = ((G.start + G.sweep * t) * Math.PI) / 180;
  return [G.cx + r * Math.cos(a), G.cy + r * Math.sin(a)];
};
const gArc = (t0, t1, r = G.r) => {
  const [x0, y0] = gPoint(t0, r), [x1, y1] = gPoint(Math.max(t0 + 0.0001, t1), r);
  return `M${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 ${(t1 - t0) * G.sweep > 180 ? 1 : 0} 1 ${x1.toFixed(1)},${y1.toFixed(1)}`;
};
const ZONES = [[0, 0.55, 'Z1'], [0.55, 0.76, 'Z2'], [0.76, 0.9, 'Z3'], [0.9, 1.05, 'Z4'], [1.05, 1.19, 'Z5'], [1.19, 9, 'Z6']];
let gaugeMax = 0;
function buildGauge() {
  gaugeMax = Math.max(400, Math.round((settings.ftp * 1.7) / 50) * 50);
  const zones = $('gZones');
  zones.innerHTML = '';
  const ns = 'http://www.w3.org/2000/svg';
  for (const [lo, hi] of ZONES) {
    const t0 = Math.min(1, (lo * settings.ftp) / gaugeMax), t1 = Math.min(1, (hi * settings.ftp) / gaugeMax);
    if (t1 <= t0) continue;
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', gArc(t0, t1));
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', zoneColor((lo + Math.min(hi, 1.4)) / 2));
    p.setAttribute('stroke-width', '6');
    p.setAttribute('stroke-opacity', '0.55');
    zones.append(p);
  }
  const ticks = $('gTicks');
  ticks.innerHTML = '';
  const step = gaugeMax > 600 ? 200 : 100;
  for (let w = 0; w <= gaugeMax; w += step) {
    const [x, y] = gPoint(w / gaugeMax, G.r - 24);
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', x.toFixed(1)); t.setAttribute('y', (y + 4).toFixed(1));
    t.textContent = w;
    ticks.append(t);
  }
  const bar = $('gGearBar');
  if (!bar.childElementCount) for (let i = 0; i < session.gearCount; i++) bar.append(document.createElement('i'));
}
function renderGauge() {
  if (!gaugeMax) buildGauge();
  const p3 = session.power3s;
  const t = Math.min(1, p3 / gaugeMax);
  const pct = settings.ftp ? p3 / settings.ftp : 0;
  const zone = ZONES.find(([lo, hi]) => pct >= lo && pct < hi) || ZONES[0];
  const fill = $('gFill');
  fill.setAttribute('d', gArc(0, t, G.r));
  fill.setAttribute('stroke', zoneColor(Math.max(pct, 0.01)));
  fill.setAttribute('stroke-opacity', p3 > 1 ? '1' : '0');
  const tn = Math.min(1, session.power / gaugeMax);
  const [x0, y0] = gPoint(tn, G.r - 12), [x1, y1] = gPoint(tn, G.r + 12);
  const needle = $('gNeedle');
  needle.setAttribute('x1', x0.toFixed(1)); needle.setAttribute('y1', y0.toFixed(1));
  needle.setAttribute('x2', x1.toFixed(1)); needle.setAttribute('y2', y1.toFixed(1));
  const tgt = session.target && session.target.mode === 'ERG' && trainer.connected ? session.target.value : null;
  const tg = $('gTarget');
  if (tgt != null) {
    const [tx, ty] = gPoint(Math.min(1, tgt / gaugeMax), G.r + 20);
    tg.setAttribute('transform', `translate(${tx.toFixed(1)},${ty.toFixed(1)})`);
    tg.style.display = '';
  } else tg.style.display = 'none';
  $('hPower').textContent = Math.round(session.power);
  $('gZone').textContent = zone[2];
  $('gZone').style.color = zoneColor(Math.max(pct, 0.01));
  $('gPct').textContent = `${Math.round(pct * 100)}%`;
  $('gWkg').textContent = (p3 / settings.riderKg).toFixed(1);
  $('g3s').textContent = Math.round(p3);
  $('gAvg').textContent = Math.round(session.avgPower);
  $('gTargetW').textContent = tgt != null ? `${tgt} W${session.target.source === 'workout' ? '' : ' (gear)'}` : '—';
  $('hGear').textContent = session.gear;
  [...$('gGearBar').children].forEach((el, i) => {
    el.className = i === session.gear - 1 ? 'cur' : i < session.gear ? 'on' : '';
  });
}

function renderHud() {
  if (!worldOpen || !world) return;
  renderGauge();
  const riding = session.mode === 'route' && session.route === worldRoute;
  $('hCad').textContent = Math.round(session.cadence);
  const kph = session.speedMps * 3.6;
  $('hSpeed').textContent = (imperial() ? kph * MI_PER_KM : kph).toFixed(1);
  $('hSpeedU').textContent = imperial() ? 'mph' : 'km/h';
  $('hGrade').textContent = fmtGrade(riding ? session.gradePct : 0);
  $('hLap').textContent = riding ? session.routeLap : '–';
  const left = riding ? Math.max(0, worldRoute.total - session.routePos) : worldRoute.total;
  $('hLeft').textContent = fmtDist(left, 1);
  $('hLeftU').textContent = `${distUnit()} ${worldRoute.closed ? 'lap to go' : 'to go'}`;
  $('hTime').textContent = fmtTime(session.movingS);
  $('hHr').textContent = session.hr ?? '--';
  $('hLoading').hidden = world.loading < 4;
  $('worldNote').textContent = riding ? '' : 'Preview — press "Ride this route" to ride it';
}
session.addEventListener('tick', renderHud);

$('worldClose').addEventListener('click', () => { closeWorld(); renderRoutePane(); });
$('worldFull').addEventListener('click', toggleFullscreen);
function toggleFullscreen() {
  if (!worldOpen) return;
  if (document.fullscreenElement) document.exitFullscreen();
  else $('worldPanel').requestFullscreen().catch((err) => log('3d', err.message, 'debug'));
}
$('camSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-cam]');
  if (!b) return;
  settings.worldCam = b.dataset.cam;
  saveSettings(settings);
  world?.setCamera(settings.worldCam);
  renderWorldControls();
});
$('timeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-time]');
  if (!b) return;
  settings.worldTime = b.dataset.time;
  saveSettings(settings);
  world?.setTimeOfDay(settings.worldTime);
  renderWorldControls();
});
function cycleCamera() {
  const order = ['chase', 'eye', 'side', 'drone'];
  settings.worldCam = order[(order.indexOf(settings.worldCam) + 1) % order.length];
  saveSettings(settings);
  world?.setCamera(settings.worldCam);
  renderWorldControls();
}
document.addEventListener('visibilitychange', () => {
  if (!world || !worldOpen) return;
  if (document.hidden) world.stop(); else world.start();
});
session.addEventListener('routeLap', renderTick);

// ---------- Workouts ----------
let workoutItems = [];
let previewWorkout = null;
const workoutCache = new Map();

async function refreshWorkoutList(selectId) {
  const builtins = BUILT_IN_WORKOUTS.map((b) => ({ ...b, kind: 'workout', name: `${parseWorkout(b.text).name} (built-in)` }));
  workoutItems = [...builtins, ...(await store.listLibrary('workout').catch(() => []))];
  const sel = $('workoutSelect');
  sel.innerHTML = '';
  for (const w of workoutItems) sel.add(new Option(w.name, w.id));
  sel.value = selectId || workoutItems[0].id;
  previewSelectedWorkout();
}

function previewSelectedWorkout() {
  const item = workoutItems.find((w) => w.id === $('workoutSelect').value);
  $('workoutDelete').hidden = !item || item.id.startsWith('builtin');
  if (!item) return;
  try {
    if (!workoutCache.has(item.id)) {
      const w = parseWorkout(item.text, item.filename || '');
      if (!w.name || w.name === 'Workout') w.name = item.name;
      workoutCache.set(item.id, w);
    }
    previewWorkout = workoutCache.get(item.id);
  } catch (err) {
    previewWorkout = null;
    $('workoutInfo').textContent = err.message;
    return;
  }
  renderWorkoutPane();
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

const ridingPreviewedWorkout = () => session.mode === 'workout' && session.workout && session.workout === previewWorkout;

function renderWorkoutPane() {
  if (pane !== 'workout' || !previewWorkout) return;
  const w = previewWorkout;
  const riding = ridingPreviewedWorkout();
  const st = workoutStats(w);
  $('workoutInfo').innerHTML = `<b>${escapeHtml(w.name)}</b> · ${fmtTime(w.duration)} · ~${st.kj} kJ · peak ${st.maxW} W at FTP ${settings.ftp} W` +
    (riding ? (session.workoutDone ? ' · <span class="ok">complete — free ride</span>' : ' · <span class="ok">in progress</span>') : '') +
    (!riding && session.mode === 'workout' && session.workout ? ` · <span class="muted">currently doing ${escapeHtml(session.workout.name)}</span>` : '') +
    (w.description ? `<div class="desc">${escapeHtml(w.description)}</div>` : '');
  $('wkNow').hidden = !riding || session.workoutDone;
  $('workoutGo').textContent = riding ? 'Restart workout' : 'Start this workout';
  $('workoutSkip').hidden = !riding || session.workoutDone;
  renderWorkoutLive();
}

function renderWorkoutLive() {
  if (!previewWorkout) return;
  const riding = ridingPreviewedWorkout();
  const w = previewWorkout;
  drawWorkout($('workoutChart'), w, riding ? session.workoutT : 0, settings.ftp, riding ? session.workoutBias : 1);
  if (!riding || session.workoutDone) return;
  const seg = session.segment;
  if (!seg) return;
  const tw = session.workoutTarget;
  $('wkTarget').textContent = tw != null ? `${tw} W` : 'Free';
  $('wkStepLabel').textContent = seg.label;
  $('wkStepLeft').textContent = fmtTime(seg.start + seg.duration - session.workoutT);
  const next = w.segments[session.segIndex + 1];
  $('wkNext').textContent = next
    ? `${next.label} · ${next.kind === 'erg' ? `${targetWatts(next, next.start, settings.ftp, session.workoutBias)} W` : 'free'} · ${fmtTime(next.duration)}`
    : 'Finish';
  $('wkLeft').textContent = fmtTime(w.duration - session.workoutT);
}

$('workoutSelect').addEventListener('change', previewSelectedWorkout);
$('workoutGo').addEventListener('click', () => {
  if (!previewWorkout) return;
  if (ridingPreviewedWorkout() && !confirm('Restart this workout from the beginning?')) return;
  session.setWorkout(previewWorkout);
  log('app', `Workout: ${previewWorkout.name} (${fmtTime(previewWorkout.duration)}, FTP ${settings.ftp} W)`, 'ok');
  showPane('workout');
});
$('workoutSkip').addEventListener('click', () => session.skipSegment());
$('biasUp').addEventListener('click', () => session.setBias(session.workoutBias + 0.05));
$('biasDown').addEventListener('click', () => session.setBias(session.workoutBias - 0.05));
$('workoutDelete').addEventListener('click', async () => {
  const id = $('workoutSelect').value;
  if (id.startsWith('builtin') || !confirm('Remove this workout from your library?')) return;
  await store.deleteLibraryItem(id);
  workoutCache.delete(id);
  await refreshWorkoutList();
});
$('workoutFile').addEventListener('change', async (e) => {
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
    alert(`Could not load that workout: ${err.message}`);
  }
});
session.addEventListener('segment', renderWorkoutPane);
session.addEventListener('workoutFinished', renderWorkoutPane);

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
    if (!finished || v === 'discard') { log('app', 'Ride discarded'); showPane(pane); return; }
    try {
      await store.saveRide(finished);
      log('app', `Ride saved: ${finished.name}, ${fmtTime(finished.summary.timerS)}`, 'ok');
    } catch (err) {
      log('app', `Could not save ride: ${err.message}`, 'error');
    }
    if (v === 'download') downloadFit(finished);
    showPane(pane);
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
  const rides = await store.listRides().catch(() => []);
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
    await store.saveRide(cur);
    log('app', 'Recovered unfinished ride and saved it', 'ok');
  }
  await store.saveCurrent(null);
}

// ---------- Settings dialog ----------
const dlg = $('settings');
const form = dlg.querySelector('form');
function fillSettings() {
  const imp = imperial();
  const f = form.elements;
  f.units.value = settings.units;
  f.rider.value = +(imp ? settings.riderKg / KG_PER_LB : settings.riderKg).toFixed(1);
  f.bike.value = +(imp ? settings.bikeKg / KG_PER_LB : settings.bikeKg).toFixed(1);
  f.ftp.value = settings.ftp;
  f.shiftMode.value = settings.shiftMode;
  f.difficulty.value = settings.difficulty;
  $('diffOut').textContent = `${settings.difficulty}%`;
  f.realRatio.value = settings.realRatio;
  f.haptics.checked = settings.haptics;
  f.startGear.value = settings.startGear;
  for (const el of dlg.querySelectorAll('.u-weight')) el.textContent = imp ? 'lb' : 'kg';
}
form.elements.difficulty.addEventListener('input', (e) => { $('diffOut').textContent = `${e.target.value}%`; });
form.elements.units.addEventListener('change', (e) => {
  const toImp = e.target.value === 'imperial';
  for (const name of ['rider', 'bike']) {
    const el = form.elements[name];
    el.value = +(toImp ? el.value / KG_PER_LB : el.value * KG_PER_LB).toFixed(1);
  }
  for (const el of dlg.querySelectorAll('.u-weight')) el.textContent = toImp ? 'lb' : 'kg';
});
$('settingsBtn').addEventListener('click', () => { fillSettings(); dlg.showModal(); });
dlg.addEventListener('close', () => {
  if (dlg.returnValue !== 'save') return;
  const f = form.elements;
  const imp = f.units.value === 'imperial';
  const kg = (v) => (imp ? Number(v) * KG_PER_LB : Number(v));
  Object.assign(settings, {
    units: f.units.value,
    riderKg: kg(f.rider.value) || settings.riderKg,
    bikeKg: kg(f.bike.value) || settings.bikeKg,
    ftp: Math.round(Number(f.ftp.value)) || settings.ftp,
    shiftMode: f.shiftMode.value,
    difficulty: Number(f.difficulty.value),
    realRatio: Math.max(0, Number(f.realRatio.value) || 0),
    haptics: f.haptics.checked,
    startGear: Math.min(24, Math.max(1, Math.round(Number(f.startGear.value) || 12))),
  });
  saveSettings(settings);
  session.settingsChanged();
  gaugeMax = 0;
  showPane(pane);
  log('app', `Settings saved (${settings.shiftMode.toUpperCase()} shifting, difficulty ${settings.difficulty}%, FTP ${settings.ftp} W)`);
});

window.addEventListener('resize', () => { renderRouteLive(); renderWorkoutLive(); });
window.addEventListener('beforeunload', (e) => {
  if (session.hasRide) { e.preventDefault(); e.returnValue = ''; }
});

// ---------- Boot ----------
renderStatic();
renderTick();
deviceStatus();
refreshRouteList();
refreshWorkoutList();
checkRecovery();
registerServiceWorker(log);
log('app', 'Ready. Close Zwift, Zwift Companion and the Wahoo app, then connect your devices.');

// For debugging in the browser console.
window.bikefree = { session, trainer, ride, hrStrap, store, get world() { return world; } };
