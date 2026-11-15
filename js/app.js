import { Trainer } from './trainer.js';
import { Ride } from './ride.js';
import { HeartRate } from './hr.js';
import { Session, TICK_MS } from './session.js';
import { powerRequired, speedFromCadence, WHEEL_CIRC } from './physics.js';
import { loadSettings, saveSettings, KG_PER_LB, MI_PER_KM } from './settings.js';
import { rideToFit, fitFilename, summarize } from './recorder.js';
import * as store from './store.js';
import { parseGpx, buildRoute, averageGradeAhead, wrapDist, routeAt } from './gpx.js';
import { Pacer, PACER_WATTS } from './pacer.js';
import { parseWorkout, BUILT_IN_WORKOUTS, targetWatts, zoneColor, markFtpTest, ftpFromTwentyMinutes } from './workout.js';
import { drawProfile, drawWorkout, drawTrace, gradeColor } from './views.js';
import { Profiles, GENDERS, initials, cmToFtIn, ftInToCm } from './profiles.js';
import { buildCatalogRoute, loadRouteScene, routeStartM } from './routes.js';
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
  if (chosen === 'route') return session.mode === 'route' && session.route === previewRoute && session.routeStart === chosenStartM(previewRoute);
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

// ---------- Route direction and start point ----------
// Every route rides there and back; Reverse starts at the far end, ⅓ / ⅔ start part-way in that direction.
const routeChoice = { reverse: settings.routeReverse === true, fraction: Number(settings.routeFraction) || 0 };
function renderRouteChoice() {
  for (const b of $('dirSeg').children) b.classList.toggle('on', (b.dataset.dir === 'rev') === routeChoice.reverse);
  for (const b of $('startSeg').children) b.classList.toggle('on', Math.abs(Number(b.dataset.f) - routeChoice.fraction) < 0.01);
}
function setRouteChoice(change) {
  Object.assign(routeChoice, change);
  settings.routeReverse = routeChoice.reverse;
  settings.routeFraction = routeChoice.fraction;
  saveSettings(settings);
  renderRouteChoice();
  renderPreview();
}
$('dirSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setRouteChoice({ reverse: b.dataset.dir === 'rev' }); });
$('startSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setRouteChoice({ fraction: Number(b.dataset.f) }); });
renderRouteChoice();
const chosenStartM = (r) => routeStartM(r, routeChoice);

// ---------- Virtual pacer ----------
// A rider in a yellow-checkered jersey who holds a set power on the same road physics as you.
const pacer = new Pacer(PACER_WATTS.includes(Number(settings.pacerWatts)) ? Number(settings.pacerWatts) : 0);
let pacerKey = null;
const onRoute = () => session.mode === 'route' && session.route;
const riderDist = () => (onRoute() ? session.routeRidden : session.distanceM);
const rideKey = () => (onRoute() ? `r:${session.route.name}:${session.routeStart}` : session.mode === 'workout' ? `w:${session.workout?.id ?? session.workout?.name}` : 'free');
function resetPacer() {
  pacer.reset(riderDist());
  pacerKey = rideKey();
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
  const gradeAt = r ? (d) => routeAt(r, wrapDist(r, session.routeStart + d)).grade : () => session.gradePct;
  pacer.step(dt, gradeAt, session.physicsParams());
  if (r && !r.closed) pacer.dist = Math.min(pacer.dist, r.total);
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
  $('offlineStatus').hidden = chosen !== 'route';
  if (chosen === 'route' && previewRoute) {
    const r = previewRoute;
    $('pvKicker').textContent = 'Route';
    $('pvTitle').textContent = r.name;
    $('pvSub').textContent = r.park || 'Your route';
    const leg = r.turnS || r.total, startM = chosenStartM(r);
    $('pvFacts').innerHTML = fact(`${fmtDist(leg, 1)}`, `${distUnit()} each way`) + fact(fmtElev(r.ascent).toLocaleString(), `${elevUnit()} climb / lap`) +
      fact(`${Math.round(Math.max(...r.grade))}%`, 'max grade') +
      `<div class="fact tag">${r.oneWay?.closedLoop ? 'Loop · each lap turns and rides it back' : 'There &amp; back · turns at each end'} · endless</div>`;
    $('pvDesc').innerHTML = r.hasElevation ? '' : '<span class="warn">No elevation in this file — it will ride flat.</span>';
    map.hidden = false; chart.hidden = false;
    $('routeOpts').hidden = false;
    drawTrace(map, r, startM, { markerOnly: true });
    drawProfile(chart, r, startM, { metric: !imperial() });
  } else if (chosen === 'workout' && previewWorkout) {
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
    $('pvDesc').innerHTML = 'Change the grade with ▲ ▼ on the handlebars (or <kbd>↑</kbd> <kbd>↓</kbd>) while you ride.';
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
function renderScenery() {
  const items = [...(parkItems || []), { id: 'none', name: 'None', park: 'Numbers only' }];
  if (!items.some((p) => p.id === settings.scenery)) settings.scenery = items[0].id;
  $('sceneCards').innerHTML = items.map((p) => `
    <button class="rcard ${p.id === 'none' ? 'none' : ''} ${p.id === settings.scenery ? 'on' : ''}" data-id="${p.id}">
      ${p.id === 'none' ? '<div class="blank">No 3D</div>' : '<canvas></canvas>'}
      <div><b>${escapeHtml(p.name)}</b><div class="rsub">${escapeHtml(p.park || '')}</div></div>
    </button>`).join('');
  drawThumbs();
  const sel = $('sceneSelect');
  sel.innerHTML = '';
  for (const p of items) sel.add(new Option(p.id === 'none' ? 'None — numbers only' : p.name, p.id));
  sel.value = settings.scenery;
}
$('sceneCards').addEventListener('click', (e) => {
  const card = e.target.closest('.rcard');
  if (card) setScenery(card.dataset.id);
});
$('sceneSelect').addEventListener('change', (e) => setScenery(e.target.value));
async function sceneryRoute() {
  const item = sceneryItem();
  if (!item) return null;
  try { return await loadRouteItem(item); } catch { return null; }
}

// ---------- Start / leave the ride screen ----------
async function startRide() {
  if (chosen === 'route') {
    if (!previewRoute) return;
    const startM = chosenStartM(previewRoute);
    if (!(session.mode === 'route' && session.route === previewRoute && session.routeStart === startM)) {
      session.setRoute(previewRoute, startM);
      log('app', `Riding route: ${previewRoute.name} (${fmtDist(previewRoute.total, 1)} ${distUnit()}${previewRoute.closed ? ' loop' : ''})`, 'ok');
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
  if (!session.hasRide || pacerKey !== rideKey()) resetPacer();
  if (pausedByUser()) session.start();
  onRideScreen = true;
  session.autoStart = true;
  $('setup').hidden = true;
  $('rideScreen').hidden = false;
  document.documentElement.requestFullscreen?.().catch(() => {});
  const route = session.mode === 'route' ? session.route : await sceneryRoute();
  await openWorld(route);
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
$('camBtn').addEventListener('click', cycleCamera);

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
  else if ((k === 'c' || k === 'C') && onRideScreen) cycleCamera();
  else if ((k === ',' || k === '.') && trainer.demo) setDemoSpeed(DEMO_MPH + (k === '.' ? 5 : -5));
  else if ((k === 'f' || k === 'F') && onRideScreen) toggleFullscreen();
  else if ((k === 'w' || k === 'W') && onRideScreen) cycleWeather();
  else if (k === 'p' || k === 'P') { const opts = [0, ...PACER_WATTS]; setPacer(opts[(opts.indexOf(pacer.watts) + 1) % opts.length]); }
  else return;
  e.preventDefault();
});
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch((err) => log('3d', err.message, 'debug'));
}

// ---------- 3D world ----------
let world = null;
let worldRoute = null;
let worldModule = null;

async function openWorld(route) {
  document.body.classList.toggle('no-world', !route);
  if (!route) { world?.stop(); return; }
  if (world && worldRoute === route) { world.start(); return; }
  try {
    worldModule = worldModule || await import('./world/world.js');
  } catch (err) {
    log('3d', `Could not start the 3D view: ${err.message}`, 'error');
    document.body.classList.add('no-world');
    return;
  }
  if (world) { world.dispose(); world = null; }
  try {
    world = new worldModule.World($('worldView'), route, { log, quality: settings.worldQuality });
  } catch (err) {
    log('3d', `3D view needs WebGL: ${err.message}`, 'error');
    document.body.classList.add('no-world');
    return;
  }
  worldRoute = route;
  world.setCamera(settings.worldCam);
  world.setTimeOfDay(settings.worldTime);
  world.setWeather(settings.worldWeather || 'clear', true);
  world.setSource(() => {
    // On a route the rider is where the ride is; otherwise the scenery loop simply rolls by.
    const pos = session.mode === 'route' && session.route === route ? session.routePos : session.distanceM % route.total;
    return { pos, speed: session.speedMps, cadence: session.cadence, riding: true };
  });
  world.setPacerSource(() => {
    if (!pacer.on) return null;
    const t = route.total;
    const pos = session.mode === 'route' && session.route === route
      ? wrapDist(route, session.routeStart + pacer.dist)
      : ((pacer.dist % t) + t) % t;
    return { pos, speed: session.running ? pacer.speed : 0, cadence: session.running ? pacer.cadence : 0 };
  });
  world.start();
  log('3d', `3D view: ${route.name}`);
}
function cycleWeather() {
  const order = ['clear', 'marine', 'clouds', 'rain'];
  settings.worldWeather = order[(order.indexOf(settings.worldWeather) + 1) % order.length];
  saveSettings(settings);
  world?.setWeather(settings.worldWeather);
  toast(`Weather: ${({ clear: 'Clear', marine: 'Marine layer', clouds: 'Clouds', rain: 'Rain' })[settings.worldWeather]}`);
}
function cycleCamera() {
  const order = ['chase', 'eye', 'side', 'drone'];
  settings.worldCam = order[(order.indexOf(settings.worldCam) + 1) % order.length];
  saveSettings(settings);
  world?.setCamera(settings.worldCam);
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

let lastProfileDraw = 0;
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
    $('hGrade').textContent = fmtGrade(session.gradePct);
    $('hGrade').style.color = readable(gradeColor(session.gradePct));
    $('hGradeLabel').textContent = 'grade';
    if (session.mode === 'route' && session.route) {
      const r = session.route;
      const ahead = imperial() ? 804.672 : 500;
      const g = averageGradeAhead(r, session.routePos, ahead);
      showRow(1, `${g > 0.05 ? '+' : ''}${fmtGrade(g)}`, imperial() ? 'next ½ mi' : 'next 500 m');
      showRow(2, r.closed ? String(session.routeLap) : null, 'lap');
      showRow(3, `${fmtDist(Math.max(0, session.routeLapToGo), 1)} ${distUnit()}`, 'lap to go');
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

  // Bottom edge: route profile or workout chart (redrawn once a second; blank on free rides).
  const now = performance.now();
  if (now - lastProfileDraw > 1000) {
    lastProfileDraw = now;
    const c = $('hudProfile');
    if (session.mode === 'route' && session.route) drawProfile(c, session.route, session.routePos, { metric: !imperial(), compact: true });
    else if (session.mode === 'workout' && session.workout) drawWorkout(c, session.workout, session.workoutT, settings.ftp, session.workoutBias, { compact: true });
    else c.getContext('2d').clearRect(0, 0, c.width, c.height);
  }

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
const routeCache = new Map();
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
  return parkItems;
}

async function refreshRouteList(selectId) {
  const mine = (await store.listLibrary('route').catch(() => [])).map((r) => ({ ...r, group: 'My routes' }));
  routeItems = [...(await loadParks()), ...mine, DEMO_ROUTE];
  // Load every route up front: they're small, and the cards draw their outlines.
  await Promise.all(routeItems.map((it) => loadRouteItem(it).catch(() => null)));
  if (selectId || !routeItems.some((r) => r.id === selectedRouteId)) selectedRouteId = selectId || routeItems[0].id;
  renderRouteCards();
  renderScenery();
  await previewSelectedRoute();
}

function renderRouteCards() {
  $('routeCards').innerHTML = routeItems.map((it) => {
    const r = routeCache.get(it.id);
    const sub = r ? `${fmtDist(r.turnS || r.total, 1)} ${distUnit()} each way · ${fmtElev(r.ascent).toLocaleString()} ${elevUnit()}` : 'Could not load';
    return `<button class="rcard ${it.id === selectedRouteId ? 'on' : ''}" data-id="${it.id}"><canvas></canvas>
      <div><b>${escapeHtml(it.name.replace(' (built-in)', ''))}</b><div class="rsub">${escapeHtml(it.park || it.group)} · ${sub}</div></div></button>`;
  }).join('');
  drawThumbs();
}

// Card thumbnails need a laid-out canvas, so draw them whenever their pane is visible.
function drawThumbs() {
  for (const c of document.querySelectorAll('#routeCards canvas, #sceneCards canvas')) {
    const r = routeCache.get(c.closest('.rcard').dataset.id);
    if (r && c.clientWidth) drawTrace(c, r, 0);
  }
  for (const c of document.querySelectorAll('#workoutList canvas')) {
    const w = workoutCache.get(c.closest('.wrow').dataset.id);
    if (w && c.clientWidth) drawWorkout(c, w, 0, settings.ftp, 1, { compact: true });
  }
}
$('routeCards').addEventListener('click', (e) => {
  const card = e.target.closest('.rcard');
  if (!card) return;
  selectedRouteId = card.dataset.id;
  for (const c of $('routeCards').children) c.classList.toggle('on', c === card);
  previewSelectedRoute();
});

async function loadRouteItem(item) {
  if (routeCache.has(item.id)) return routeCache.get(item.id);
  const text = item.text ?? await (await fetch(item.url)).text();
  const route = buildCatalogRoute(text, item);
  await loadRouteScene(route).catch((err) => log('3d', err.message, 'error'));
  routeCache.set(item.id, route);
  return route;
}

async function previewSelectedRoute() {
  const item = routeItems.find((r) => r.id === selectedRouteId);
  $('routeDelete').hidden = !item || item.id.startsWith('builtin');
  $('routeOffline').hidden = !item?.park;
  if (!item) return;
  try {
    previewRoute = await loadRouteItem(item);
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
$('routeDelete').addEventListener('click', async () => {
  closeMenus();
  const id = selectedRouteId;
  if (id.startsWith('builtin') || !confirm('Remove this route from your library?')) return;
  await store.deleteLibraryItem(id);
  routeCache.delete(id);
  await refreshRouteList();
});
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
function fillSettings() {
  const imp = imperial();
  const f = form.elements;
  f.theme.value = window.BFTheme?.pref() || 'system';
  f.units.value = settings.units;
  f.bike.value = +(imp ? settings.bikeKg / KG_PER_LB : settings.bikeKg).toFixed(1);
  f.worldCam.value = settings.worldCam;
  f.worldTime.value = settings.worldTime;
  f.worldQuality.value = settings.worldQuality;
  f.worldWeather.value = settings.worldWeather || 'clear';
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
    worldCam: f.worldCam.value,
    worldTime: f.worldTime.value,
    worldQuality: f.worldQuality.value,
    worldWeather: f.worldWeather.value,
    shiftMode: f.shiftMode.value,
    difficulty: Number(f.difficulty.value),
    realRatio: Math.max(0, Number(f.realRatio.value) || 0),
    haptics: f.haptics.checked,
    startGear: Math.min(24, Math.max(1, Math.round(Number(f.startGear.value) || 12))),
  });
  saveSettings(settings);
  window.BFTheme?.set(f.theme.value);
  session.settingsChanged();
  world?.setCamera(settings.worldCam);
  world?.setTimeOfDay(settings.worldTime);
  world?.setQuality(settings.worldQuality);
  world?.setWeather(settings.worldWeather);
  renderRouteCards();
  renderWorkoutList();
  renderProfile();
  showPane(chosen);
  log('app', `Settings saved (${settings.shiftMode.toUpperCase()} shifting, difficulty ${settings.difficulty}%, FTP ${settings.ftp} W)`);
});

window.addEventListener('resize', () => { renderPreview(); drawThumbs(); lastProfileDraw = 0; });
window.addEventListener('beforeunload', (e) => {
  if (session.hasRide) { e.preventDefault(); e.returnValue = ''; }
});

// Light / dark: charts are drawn on canvases, so redraw them when the appearance changes (incl. macOS switching).
window.BFTheme?.onChange(() => { renderPreview(); drawThumbs(); lastProfileDraw = 0; renderHud(); });

// ---------- Boot ----------
renderProfile();
session.autoStart = false;
deviceStatus();
refreshRouteList();
refreshWorkoutList();
checkRecovery();
registerServiceWorker(log);
log('app', 'Ready. Close Zwift, Zwift Companion and the Wahoo app, then connect your devices.');

// For debugging in the browser console.
window.bikefree = { pacer, session, trainer, ride, hrStrap, store, profiles, get world() { return world; }, get ftpRun() { return ftpRun; } };
