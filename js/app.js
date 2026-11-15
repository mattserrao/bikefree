import { Trainer } from './trainer.js';
import { Ride } from './ride.js';
import { Session } from './session.js';
import { loadSettings, saveSettings, KG_PER_LB, MI_PER_KM } from './settings.js';

const $ = (id) => document.getElementById(id);

// ---------- Log ----------
const logEl = $('log');
const logLines = [];
function log(source, msg, level = 'info') {
  const t = new Date().toLocaleTimeString([], { hour12: false });
  const line = `${t} [${source}] ${msg}`;
  logLines.push(line);
  if (logLines.length > 2000) logLines.shift();
  if (level === 'error') console.error(line); else console.log(line);
  const li = document.createElement('li');
  li.className = `lvl-${level}`;
  li.textContent = line;
  logEl.prepend(li);
  while (logEl.childElementCount > 500) logEl.lastChild.remove();
  // Surface problems even when diagnostics are closed.
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
  $('trainerBtn').disabled = true;
  $('rideBtn').disabled = true;
}

// ---------- Core objects ----------
const settings = loadSettings();
const trainer = new Trainer(log);
const ride = new Ride(log);
const session = new Session({ trainer, ride, log, settings });
const imperial = () => settings.units === 'imperial';

// ---------- Device chips ----------
function deviceStatus() {
  const tOn = trainer.connected;
  $('trainerDot').className = `dot ${tOn ? 'on' : trainer.reconnecting ? 'wait' : ''}`;
  $('trainerLabel').textContent = tOn ? trainer.device.name : trainer.reconnecting ? 'Reconnecting…' : 'Connect trainer';

  const rOn = ride.connected;
  $('rideDot').className = `dot ${rOn ? 'on' : ride.reconnecting ? 'wait' : ''}`;
  $('rideLabel').textContent = rOn
    ? `Zwift Ride${ride.battery != null ? ` · ${ride.battery}%` : ''}`
    : ride.reconnecting ? 'Reconnecting…' : 'Connect handlebars';
  $('rideInfo').textContent = rOn ? `fw ${ride.firmware ?? '?'} · battery ${ride.battery ?? '?'}%` : '—';
}
trainer.addEventListener('status', deviceStatus);
ride.addEventListener('status', deviceStatus);

$('trainerBtn').addEventListener('click', async () => {
  if (trainer.connected || trainer.reconnecting) return trainer.disconnect();
  try { await trainer.connect(); }
  catch (err) { if (err.name !== 'NotFoundError') log('trainer', err.message, 'error'); }
  deviceStatus();
});

async function connectRide(anyZwift) {
  if (ride.connected || ride.reconnecting) return ride.disconnect();
  try { await ride.connect(anyZwift); }
  catch (err) { if (err.name !== 'NotFoundError') log('ride', err.message, 'error'); }
  deviceStatus();
}
$('rideBtn').addEventListener('click', () => connectRide(false));
$('rideAnyBtn').addEventListener('click', () => connectRide(true));
$('rawToggle').addEventListener('change', (e) => { ride.showRaw = e.target.checked; });

// ---------- Gear bar ----------
const gearbar = $('gearbar');
for (let i = 1; i <= session.gearCount; i++) {
  const s = document.createElement('span');
  s.addEventListener('click', () => session.shift(i - session.gear));
  gearbar.append(s);
}

// ---------- Rendering ----------
function fmtTime(s) {
  s = Math.floor(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function renderStatic() {
  $('gear').textContent = session.gear;
  [...gearbar.children].forEach((el, i) => {
    el.classList.toggle('on', i < session.gear);
    el.classList.toggle('cur', i === session.gear - 1);
  });
  $('grade').textContent = `${session.gradePct.toFixed(1)}%`;
  $('gradeInput').value = session.gradePct;
  $('startBtn').textContent = session.running ? 'Pause' : 'Start';
  $('speedUnit').textContent = imperial() ? 'mph' : 'km/h';
  $('distUnit').textContent = imperial() ? 'mi' : 'km';
  $('elevUnit').textContent = imperial() ? 'ft' : 'm';
}

function renderTick() {
  $('power').textContent = Math.round(session.power);
  $('power3s').textContent = Math.round(session.power3s);
  $('cadence').textContent = Math.round(session.cadence);
  const kph = session.speedMps * 3.6;
  $('speed').textContent = (imperial() ? kph * MI_PER_KM : kph).toFixed(1);
  const km = session.distanceM / 1000;
  $('distance').textContent = (imperial() ? km * MI_PER_KM : km).toFixed(2);
  $('elev').textContent = Math.round(imperial() ? session.elevGainM * 3.28084 : session.elevGainM);
  $('time').textContent = fmtTime(session.movingS);
  $('timeState').textContent = session.running ? 'riding' : session.autoPaused ? 'auto-paused' : session.movingS ? 'paused' : 'ready';
  $('avgPower').textContent = Math.round(session.avgPower);
  $('startBtn').textContent = session.running ? 'Pause' : 'Start';

  const t = session.target;
  $('target').textContent = !trainer.connected ? '—' : t ? (t.mode === 'ERG' ? `ERG ${t.value} W` : `SIM ${t.value.toFixed(1)}%`) : '—';
  $('realRatio').textContent = `${session.realRatio.toFixed(2)}${settings.realRatio ? ' (set)' : session.realRatioEst ? ' (auto)' : ' (default)'}`;
  const tk = trainer.data.speedKph;
  $('trainerSpeed').textContent = tk != null ? `${(imperial() ? tk * MI_PER_KM : tk).toFixed(1)} ${imperial() ? 'mph' : 'km/h'}` : '—';
}

session.addEventListener('change', renderStatic);
session.addEventListener('tick', renderTick);

// Flash the gear number on shift
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

// Light up handlebar presses briefly in the hint line? Keep it simple: log only.

// ---------- Controls ----------
$('gradeInput').addEventListener('input', (e) => session.setGrade(Number(e.target.value)));
$('gradeUp').addEventListener('click', () => session.setGrade(session.gradePct + 0.5));
$('gradeDown').addEventListener('click', () => session.setGrade(session.gradePct - 0.5));
$('flatBtn').addEventListener('click', () => session.setGrade(0));
$('startBtn').addEventListener('click', () => session.toggle());
$('resetBtn').addEventListener('click', () => {
  if (session.movingS < 60 || confirm('Reset this ride?')) session.reset();
});

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea, dialog[open]')) return;
  const k = e.key;
  if (k === 'ArrowRight' || k === '=' || k === ']') session.shift(+1);
  else if (k === 'ArrowLeft' || k === '-' || k === '[') session.shift(-1);
  else if (k === 'ArrowUp') session.setGrade(session.gradePct + 0.5);
  else if (k === 'ArrowDown') session.setGrade(session.gradePct - 0.5);
  else if (k === ' ') session.toggle();
  else return;
  e.preventDefault();
});

// ---------- Settings dialog ----------
const dlg = $('settings');
const form = dlg.querySelector('form');
function fillSettings() {
  const imp = imperial();
  const f = form.elements;
  f.units.value = settings.units;
  f.rider.value = +(imp ? settings.riderKg / KG_PER_LB : settings.riderKg).toFixed(1);
  f.bike.value = +(imp ? settings.bikeKg / KG_PER_LB : settings.bikeKg).toFixed(1);
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
  // Convert shown weights when switching units inside the dialog.
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
    shiftMode: f.shiftMode.value,
    difficulty: Number(f.difficulty.value),
    realRatio: Math.max(0, Number(f.realRatio.value) || 0),
    haptics: f.haptics.checked,
    startGear: Math.min(24, Math.max(1, Math.round(Number(f.startGear.value) || 12))),
  });
  saveSettings(settings);
  session.settingsChanged();
  log('app', `Settings saved (${settings.shiftMode.toUpperCase()} shifting, difficulty ${settings.difficulty}%)`);
});

renderStatic();
renderTick();
deviceStatus();
log('app', 'Ready. Close Zwift, Zwift Companion and the Wahoo app, then connect the trainer and handlebars.');
