// Pairing the trainer, handlebars and heart-rate strap, and Demo mode (a simulated trainer).
// (Part of the app: js/app.js imports every module in js/app/.)
import { powerRequired, speedFromCadence, WHEEL_CIRC } from '../physics.js';
import { $, log, hasBluetooth, trainer, ride, hrStrap, session } from './core.js';
import { pausedByUser, renderStart } from './route-options.js';

// ---------- Screens: setup ↔ ride ----------

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
  if (pausedByUser()) return { powerW: 0, cadenceRpm: 0, speedKph: 0, heartRate: Math.round((demoHr += (78 - demoHr) * 0.01)) };
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

export { deviceStatus, DEMO_MPH, setDemoSpeed };
