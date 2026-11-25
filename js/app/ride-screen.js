// The ride screen: start and finish arches, entering and leaving it, the loading screen, the 3D world and the minimap.
// (Part of the app: js/app.js imports every module in js/app/.)
import { saveSettings } from '../settings.js';
import { wrapDist } from '../gpx.js';
import { PACER_WATTS } from '../pacer.js';
import { drawMinimap, drawNetworkMinimap } from '../views.js';
import { loadRouteScene } from '../routes.js';
import { stopNear, startArchM } from '../route-plan.js';
import { previewShots } from '../route-previews.js';
import { $, toast, log, settings, trainer, session, fmtDist, distUnit, fmtElev, elevUnit, fmtTime, escapeHtml } from './core.js';
import { DEMO_MPH, setDemoSpeed } from './devices.js';
import { chosen, showPane, pausedByUser, sameAsCurrent, fmtPlanTime, planWatts, chosenPlan } from './route-options.js';
import { pacer, pacerKey, rideKey, pacerPathPos, resetPacer, pacerPath, setPacer } from './pacer-ui.js';
import { previewManifest, sceneryRoute } from './preview.js';
import { renderHudStatic, renderHud, renderTurnPrompt } from './hud.js';
import { previewRoute } from './route-loading.js';
import { previewWorkout } from './workouts-ui.js';
import { openSummary } from './summary.js';

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
let onRideScreen = false;
async function startRide() {
  let plan = null;
  if (chosen === 'route') {
    if (!previewRoute) return;
    const cp = chosenPlan(previewRoute), { startM, finishM, goalM } = cp;
    plan = cp.plan;
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
  // [phase 8] the ride screen opens behind the loading screen; the clock is held (no auto start, no resume) until the
  // route's start is built, then the first pedal stroke starts it (L1–L4)
  const resume = pausedByUser();
  session.autoStart = false;
  onRideScreen = true;
  const run = beginLoad(plan);
  $('setup').hidden = true;
  $('rideScreen').hidden = false;
  document.documentElement.requestFullscreen?.().catch(() => {});
  // the 3D world: the route, else the scenery — a city with a ride network rides its free ride (F37)
  const route = session.mode === 'route' ? session.route : await sceneryRoute();
  if (run !== loadRun) return;   // (cancelled meanwhile)
  session.setScenery(session.mode === 'route' ? null : route);
  if (!session.hasRide || pacerKey !== rideKey()) resetPacer();
  setLoadInfo(run, route);
  await openWorld(route);
  if (run !== loadRun) return;
  run.worldOpen = true;
  world?.setCourseMarks(courseMarks());
  renderHudStatic();
  renderHud();
  const how = await run.done;
  if (how === 'cancel' || run !== loadRun) return;
  endLoad();
  if (how === 'anyway') log('app', 'Riding before the scenery was ready (Ride anyway)', 'info');
  if (resume) session.start();
  session.autoStart = true;
  renderHud();
}

// ---------- Loading screen (phase 8: load before you ride) ----------
// Menu → route → this screen while the route's start is built (js/world/world.js readiness(): scenery, ground,
// roads & buildings, light, riders) → "Pedal to start". The trainer stays connected (its resistance: the start's
// grade). Cancel goes back to the menu; past LOAD_VALVE_S or on an error, "Ride anyway" rides at once (today's way).
const LOAD_VALVE_S = 30;
let loadRun = null;   // { t0, done (promise: 'ready' | 'anyway' | 'cancel'), finish, raf, valve }
function beginLoad(plan) {
  cancelLoad();
  let finish;
  const run = { t0: performance.now(), done: new Promise((ok) => { finish = ok; }), plan };
  run.finish = (how) => { if (run.ended) return; run.ended = true; cancelAnimationFrame(run.raf); world?.setPreload?.(false); finish(how); };
  loadRun = run;
  session.setHeld(true);   // (the A button / Space meanwhile: go once it's ready)
  $('loadScreen').hidden = false;
  $('loadAnyway').hidden = true;
  $('loadNote').classList.remove('warn');
  $('loadNote').textContent = 'The clock starts on your first pedal stroke once the route is ready.';
  $('loadPic').hidden = true;
  $('loadSteps').innerHTML = '';
  setLoadInfo(run, session.mode === 'route' ? session.route : null);
  showLoadProgress(0, 'Getting ready…');
  const tick = () => {
    if (loadRun !== run || run.ended) return;
    run.raf = requestAnimationFrame(tick);
    pollLoad(run);
  };
  run.raf = requestAnimationFrame(tick);
  return run;
}
/** The route's name, length, climb and first preview picture (a free ride / workout: its scenery's). */
function setLoadInfo(run, route) {
  const r = session.mode === 'route' ? session.route : route;
  const fact = (b, small) => `<span><b>${b}</b> ${small}</span>`;
  let kicker = 'Loading the route', title = r?.name || '', facts = '';
  if (session.mode === 'route' && r) {
    const p = run.plan;
    const distM = p?.distM ?? r.lapM ?? r.oneWay?.total ?? r.total, climbM = p?.climbM ?? r.lapClimbM ?? r.oneWay?.ascent ?? r.ascent;
    facts = fact(fmtDist(distM, 1), distUnit()) + (climbM != null ? fact(fmtElev(climbM).toLocaleString(), `${elevUnit()} climb`) : '') +
      (p?.timeS ? fact(`~${fmtPlanTime(p.timeS)}`, `at ${planWatts()} W`) : '');
  } else if (session.mode === 'workout' && session.workout) {
    kicker = 'Loading the scenery'; title = session.workout.name;
    facts = fact(fmtTime(session.workout.duration), 'workout') + (r ? fact(escapeHtml(r.name), '') : '');
  } else {
    kicker = 'Loading the scenery'; title = 'Free ride';
    facts = r ? fact(escapeHtml(r.name), '') : '';
  }
  $('loadKicker').textContent = kicker;
  $('loadTitle').textContent = title;
  $('loadFacts').innerHTML = facts;
  const id = r ? (session.mode === 'route' ? r.id : r.id?.replace(/^scenery-/, '')) : null;
  const shot = id ? previewShots(previewManifest, id)[0] : null;
  if (shot) { $('loadPic').src = shot.url; $('loadPic').alt = shot.caption || ''; }
  $('loadPic').hidden = !shot;
}
function showLoadProgress(p, what) {
  const pct = Math.round(Math.max(0, Math.min(1, p)) * 100);
  $('loadFill').style.width = `${pct}%`;
  $('loadBar').setAttribute('aria-valuenow', String(pct));
  if ($('loadWhat').textContent !== what) $('loadWhat').textContent = what;
}
function pollLoad(run) {
  const s = (performance.now() - run.t0) / 1000;
  if (!run.worldOpen) {   // (the route's scene file and the 3D view are still on their way)
    if (!run.valve && s > LOAD_VALVE_S) offerRideAnyway(run, false, 'opening the 3D view');
    return;
  }
  // no 3D view (no WebGL, or nothing to show): nothing to wait for
  if (!world || document.body.classList.contains('no-world')) { run.finish('ready'); return; }
  world.setPreload?.(true);
  const r = world.readiness();
  const next = r.steps.find((x) => !x.done);
  showLoadProgress(r.progress, r.ready ? 'Ready' : `Loading ${next.label.toLowerCase()}…`);
  const key = r.steps.map((x) => +x.done).join('');
  if (key !== run.stepsKey) {
    run.stepsKey = key;
    $('loadSteps').innerHTML = r.steps.map((x) => `<li class="${x.done ? 'done' : ''}">${escapeHtml(x.label)}</li>`).join('');
  }
  if (r.ready) {
    log('3d', `Start ready in ${s.toFixed(1)} s`, 'info');
    run.finish('ready');
    return;
  }
  if (!run.valve && (r.failed || s > LOAD_VALVE_S)) offerRideAnyway(run, r.failed, r.steps.filter((x) => !x.done).map((x) => x.key).join(', '));
}
function offerRideAnyway(run, failed, what) {
  run.valve = true;
  $('loadAnyway').hidden = false;
  $('loadNote').classList.add('warn');
  $('loadNote').textContent = failed ? 'Some of the scenery couldn’t load. You can ride anyway — it carries on loading as you ride.'
    : 'This is taking a while. You can ride anyway — the scenery carries on loading as you ride.';
  log('3d', failed ? 'Loading screen: a scenery file failed — offering Ride anyway' : `Loading screen: still loading after ${LOAD_VALVE_S} s — offering Ride anyway (${what})`, 'info');
}
function endLoad() {
  $('loadScreen').hidden = true;
  loadRun = null;
  session.setHeld(false);
}
function cancelLoad() {
  if (!loadRun) return;
  const run = loadRun;
  loadRun = null;
  run.finish('cancel');
  $('loadScreen').hidden = true;
  session._resumeAfterHold = false;   // (a press meanwhile doesn't start it on the menu)
  session.setHeld(false);
}
$('loadAnyway').addEventListener('click', () => loadRun?.finish('anyway'));
$('loadCancel').addEventListener('click', () => { if (loadRun) showSetup(); });

// [phase 8] L5: while the world waits for the streets ahead (the fade), time and distance are held; past
// LOAD_VALVE_S the ride goes on regardless (the world keeps the drawn area on screen), until that wait ends.
let holdSince = 0, holdGaveUp = false;
function holdForWorld() {
  if (loadRun) return;   // (the loading screen holds it)
  const wait = onRideScreen && !!world?.waitingForArea;
  if (!wait) { holdGaveUp = false; session.setHeld(false); return; }
  const now = performance.now();
  if (!session.held && !holdGaveUp) holdSince = now;
  if (session.held && now - holdSince > LOAD_VALVE_S * 1000) {
    holdGaveUp = true;
    log('3d', `The streets ahead took over ${LOAD_VALVE_S} s to load — the clock runs on`, 'info');
    toast('The streets ahead are slow to load — the clock runs on');
  }
  session.setHeld(!holdGaveUp);
}
$('startBtn').addEventListener('click', startRide);

function showSetup() {
  cancelLoad();   // [phase 8]
  onRideScreen = false;
  session.autoStart = false;
  session.setHeld(false);
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
// Touch: while the turn prompt is up, swipe left / right anywhere on the ride screen to change the way (user, 23 Nov),
// or tap a way in the prompt.
let swipe = null;
const turnUp = () => onRideScreen && session.turnRide && !$('hTurn').hidden;
const pickTurn = (dir) => { if (session.turn(dir)) renderTurnPrompt(true); };
document.addEventListener('pointerdown', (e) => {
  swipe = null;
  if (e.pointerType === 'mouse' || !turnUp() || document.querySelector('dialog[open]')) return;
  if (e.target.closest('button, a, input, select, textarea, .hud-buttons')) return;
  swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
}, { passive: true });
document.addEventListener('pointerup', (e) => {
  const s = swipe; swipe = null;
  if (!s || s.id !== e.pointerId || !turnUp()) return;
  const dx = e.clientX - s.x, dy = e.clientY - s.y;
  if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.5 && performance.now() - s.t < 800) { pickTurn(dx < 0 ? -1 : 1); return; }
  if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {   // a tap on one of the ways
    const opt = e.target.closest('#hTurn .turn-opt'), up = opt && session.turnRide.prompt(session.turnPos, session.speedMps);
    if (!up || up.locked) return;
    const j = [...opt.parentNode.children].indexOf(opt), step = j - up.selected;
    for (let i = 0; i < Math.abs(step); i++) if (!session.turn(Math.sign(step))) break;
    renderTurnPrompt(true);
  }
}, { passive: true });
document.addEventListener('pointercancel', () => { swipe = null; });
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
const redrawMinimap = () => { lastMapDraw = 0; };
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
  if (settings.minimap !== 'off') settings.minimapView = settings.minimap;
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
  const base = route.base || route;
  // the scenery loads here, not with the route (PLAN 7.11: the menu never waits on it)
  await loadRouteScene(base).catch((err) => log('3d', err.message, 'error'));
  if (route !== base && !route.scene) route.scene = base.scene;
  if (world && worldBase === base && !world.areaSet) {
    worldBase = base;
    // the same city: just follow this ride's path (or none)
    worldRoute = route;
    world.setPath(route.netRide || null);
    wireWorld(route);
    world.start();
    return;
  }
  let WorldClass;
  try {
    if (base.graph) WorldClass = (await import('../world/graph-world.js')).GraphWorld;   // [pgh] a free-ride road graph: its own light world
    else if (base.endless) WorldClass = (await import('../world/endless-world.js')).EndlessWorld;   // [endless] generated as you ride
    else {
      worldModule = worldModule || await import('../world/world.js');
      // [F399] static city meshes keep no CPU copy once on the GPU (~300 MB less on a Pittsburgh start); ?keepGeometry=1 keeps it
      worldModule.setGeometryRelease?.(!new URLSearchParams(location.search).has('keepGeometry'));
      WorldClass = worldModule.World;
    }
  } catch (err) {
    log('3d', `Could not start the 3D view: ${err.message}`, 'error');
    document.body.classList.add('no-world');
    return;
  }
  if (world) { world.dispose(); world = null; }
  try {
    world = new WorldClass($('worldView'), base, { log, quality: settings.worldQuality, path: route.netRide || null });
  } catch (err) {
    log('3d', `3D view needs WebGL: ${err.message}`, 'error');
    document.body.classList.add('no-world');
    return;
  }
  worldRoute = route;
  worldBase = base;
  world.setTimeOfDay(settings.worldTime);
  world.setWeather(settings.worldWeather || 'clear', true);
  world.setCamera(settings.camera);
  world.setGfx?.(settings.gfx);
  wireWorld(route);
  watchGpu(world);
  world.start();
  log('3d', `3D view: ${route.name}`);
}
/**
 * The GPU can drop the page's WebGL context (a phone short of memory, a driver reset, a Mac switching graphics cards):
 * the 3D view would stay black for the rest of the ride. On loss the world stops drawing; when the browser hands the
 * context back (or after a few seconds if it doesn't), the world is rebuilt where the rider is. The ride itself
 * (time, distance, recording, the trainer) never stops.
 */
const GPU_RESTORE_WAIT_MS = 3000;
function watchGpu(w) {
  const canvas = w.renderer?.domElement;
  if (!canvas) return;
  let timer = 0;
  const rebuild = () => {
    clearTimeout(timer);
    if (world !== w) return;   // (already replaced or closed)
    const route = worldRoute;
    try { w.dispose(); } catch { /* its context is gone */ }
    world = null; worldRoute = null; worldBase = null;
    if (route && onRideScreen) openWorld(route).then(() => { if (world) log('3d', '3D view rebuilt after the graphics reset', 'ok'); });
  };
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();   // (lets the browser restore it)
    if (world !== w) return;
    w.stop();
    log('3d', 'The graphics card reset: rebuilding the 3D view…', 'warn');
    toast('3D view lost — rebuilding…');
    timer = setTimeout(rebuild, GPU_RESTORE_WAIT_MS);
  });
  canvas.addEventListener('webglcontextrestored', rebuild);
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

export { courseMarks, onRideScreen, startRide, loadRun, holdForWorld, showSetup, redrawMinimap, renderMinimap, applyHudPrefs, world };
