// Shared foundations: the log, the trainer / handlebars / heart-rate / session objects, settings, profiles and the number formatters.
// (Part of the app: js/app.js imports every module in js/app/.)
import { Trainer } from '../trainer.js';
import { Ride } from '../ride.js';
import { HeartRate } from '../hr.js';
import { Session } from '../session.js';
import { loadSettings } from '../settings.js';
import { Profiles } from '../profiles.js';
import { VERSION } from '../version.js';
import { worldSound } from '../world/toolbox/core/sound.js';

const $ = (id) => document.getElementById(id);

// The app version, shown faintly at the bottom right of the menu. Bump with each release (see PLAN.md).
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
worldSound.setEnabled(settings.worldSound !== false);   // [subway sound] Settings → World sounds (on, quiet)
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

export {
  $, toast, log, hasBluetooth, settings, profiles, trainer, ride, hrStrap, session, imperial, fmtDist, distUnit,
  fmtElev, elevUnit, fmtTime, readable, fmtGrade, escapeHtml,
};
