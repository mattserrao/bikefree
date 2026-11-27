// The virtual pacer's controls and its position along the ride.
// (Part of the app: js/app.js imports every module in js/app/.)
import { TICK_MS } from '../session.js';
import { saveSettings } from '../settings.js';
import { wrapDist, routeAt, carryAt } from '../gpx.js';
import { Pacer, PACER_WATTS } from '../pacer.js';
import { PathFollower } from '../network.js';
import { $, log, settings, session, imperial } from './core.js';
import { renderOptsSummary } from './route-options.js';
import { renderHud } from './hud.js';

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
const turnPath = () => (session.turnRide?.entries ? session.turnRide : null);   // ([endless] the mile prompts aren't a path to follow)
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
  renderOptsSummary();
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
function stepPacer(runSteps = session.running ? 1 : 0) {
  // Same fixed step as the session, so you and the pacer share one clock ([review 27 Nov] one 'tick' per timer now
  // carries every step it ran: the pacer takes as many of them as ran with the clock going)
  const dt = TICK_MS / 1000;
  if (!pacer.on || !runSteps) return;
  if (pacerKey !== rideKey()) resetPacer();
  for (let i = 0; i < runSteps; i++) stepPacerOnce(dt);
}
function stepPacerOnce(dt) {
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

export { pacer, pacerKey, rideKey, pacerPathPos, resetPacer, pacerPath, renderPacerChoice, setPacer, stepPacer, pacerGap, fmtGap };
