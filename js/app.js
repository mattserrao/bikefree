import { Trainer } from './trainer.js';
import { Ride } from './ride.js';

const $ = (id) => document.getElementById(id);

// ---------- Log ----------
const logEl = $('log');
const logLines = [];
function log(source, msg, level = 'info') {
  const t = new Date().toLocaleTimeString([], { hour12: false });
  const line = `${t} [${source}] ${msg}`;
  logLines.push(line);
  if (level === 'error') console.error(line); else console.log(line);
  const li = document.createElement('li');
  li.className = `lvl-${level}`;
  li.textContent = line;
  logEl.prepend(li);
  while (logEl.childElementCount > 500) logEl.lastChild.remove();
}

$('debugToggle').addEventListener('change', (e) => document.body.classList.toggle('hide-debug', !e.target.checked));
$('clearLog').addEventListener('click', () => { logEl.innerHTML = ''; logLines.length = 0; });
$('copyLog').addEventListener('click', async () => {
  await navigator.clipboard.writeText(logLines.join('\n'));
  log('app', 'Log copied to clipboard', 'ok');
});

// ---------- Support check ----------
if (!navigator.bluetooth) {
  $('unsupported').hidden = false;
  for (const b of document.querySelectorAll('button.primary')) b.disabled = true;
}

// ---------- Trainer ----------
const trainer = new Trainer(log);
let mode = null;

function trainerStatus() {
  const on = trainer.connected;
  $('trainerDot').classList.toggle('on', on);
  $('trainerSub').textContent = on
    ? `${trainer.device.name} · ${trainer.hasControl ? 'in control' : 'connected'}`
    : 'KICKR CORE 2 · not connected';
  $('trainerBtn').textContent = on ? 'Disconnect' : 'Connect trainer';
  for (const id of ['ergBtn', 'gradeBtn', 'flatBtn']) $(id).disabled = !on;
  if (!on) setTiles({});
}
trainer.addEventListener('status', trainerStatus);
trainer.addEventListener('data', (e) => setTiles(e.detail));

function setTiles(d) {
  $('power').textContent = d.powerW != null ? Math.round(d.powerW) : '--';
  $('cadence').textContent = d.cadenceRpm != null ? Math.round(d.cadenceRpm) : '--';
  $('speed').textContent = d.speedKph != null ? (d.speedKph * 0.621371).toFixed(1) : '--';
}

function setMode(text, unit) {
  mode = text;
  $('mode').textContent = text;
  $('modeUnit').textContent = unit;
}

$('trainerBtn').addEventListener('click', async () => {
  if (trainer.connected) return trainer.disconnect();
  try { await trainer.connect(); }
  catch (err) { if (err.name !== 'NotFoundError') log('trainer', err.message, 'error'); }
  trainerStatus();
});

$('ergBtn').addEventListener('click', async () => {
  const w = Number($('ergInput').value);
  await trainer.setErgWatts(w);
  setMode(`${w}`, 'W · ERG');
});

const gradeInput = $('gradeInput');
gradeInput.addEventListener('input', () => { $('gradeOut').textContent = `${Number(gradeInput.value).toFixed(1)}%`; });
$('gradeBtn').addEventListener('click', async () => {
  const g = Number(gradeInput.value);
  await trainer.setGrade(g);
  setMode(g.toFixed(1), '% · SIM');
});
$('flatBtn').addEventListener('click', async () => {
  gradeInput.value = 0;
  gradeInput.dispatchEvent(new Event('input'));
  await trainer.setGrade(0);
  setMode('0.0', '% · SIM');
});

// ---------- Handlebars ----------
const ride = new Ride(log);

function rideStatus() {
  const on = ride.connected;
  $('rideDot').classList.toggle('on', on);
  const bits = [];
  if (on) {
    bits.push(ride.device.name || 'Zwift device');
    if (ride.firmware) bits.push(`fw ${ride.firmware}`);
    if (ride.battery != null) bits.push(`${ride.battery}%`);
  }
  $('rideSub').textContent = on ? bits.join(' · ') : 'Zwift Ride · not connected';
  $('rideBtn').textContent = on ? 'Disconnect' : 'Connect handlebars';
  $('rideAnyBtn').hidden = on;
}
ride.addEventListener('status', rideStatus);

const keyEls = document.querySelectorAll('[data-btn]');
ride.addEventListener('buttons', (e) => {
  const pressed = new Set(e.detail);
  for (const el of keyEls) {
    const isOn = pressed.has(el.dataset.btn);
    el.classList.toggle('pressed', isOn);
    if (isOn) el.classList.add('seen');
  }
});

async function connectRide(anyZwift) {
  if (ride.connected) return ride.disconnect();
  try { await ride.connect(anyZwift); }
  catch (err) { if (err.name !== 'NotFoundError') log('ride', err.message, 'error'); }
  rideStatus();
}
$('rideBtn').addEventListener('click', () => connectRide(false));
$('rideAnyBtn').addEventListener('click', () => connectRide(true));
$('rawToggle').addEventListener('change', (e) => { ride.showRaw = e.target.checked; });

log('app', 'Ready. Close Zwift, Zwift Companion and the Wahoo app first, then connect.');
