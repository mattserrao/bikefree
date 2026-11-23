// The settings dialog, and redrawing the charts on resize or a theme change.
// (Part of the app: js/app.js imports every module in js/app/.)
import { saveSettings, KG_PER_LB } from '../settings.js';
import { worldSound } from '../world/toolbox/core/sound.js';
import { $, log, settings, session, imperial } from './core.js';
import { chosen, showPane } from './route-options.js';
import { renderPreview } from './preview.js';
import { onRideScreen, redrawMinimap, applyHudPrefs, world } from './ride-screen.js';
import { redrawRideProfile, renderHud, renderDiag } from './hud.js';
import { renderRouteCards, drawThumbs } from './routes-menu.js';
import { renderWorkoutList } from './workouts-ui.js';
import { renderProfile } from './profiles-ui.js';

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
  // a route with one fixed time (CNY, SKAN: golden hour, its shadows baked): no choice to offer, so no menu
  const label = select.closest('label'); if (label) label.hidden = !!(offered && offered.length <= 1);
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
  f.worldSound.checked = settings.worldSound !== false;
  f.hudSize.value = settings.hudSize;
  f.hillFeel.value = String(settings.hillFeel ?? 50);
  f.camera.value = settings.camera || 'closest';
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
    worldSound: f.worldSound.checked,
    hudSize: f.hudSize.value,
    hillFeel: Number(f.hillFeel.value) || 50,
    camera: f.camera.value,
    minimap: f.minimap.value,
    startGear: Math.min(24, Math.max(1, Math.round(Number(f.startGear.value) || 12))),
  });
  saveSettings(settings);
  window.BFTheme?.set(f.theme.value);
  session.settingsChanged();
  world?.setTimeOfDay(settings.worldTime);
  world?.setQuality(settings.worldQuality);
  world?.setWeather(settings.worldWeather);
  world?.setCamera?.(settings.camera);
  worldSound.setEnabled(settings.worldSound);
  applyHudPrefs();
  renderRouteCards();
  renderWorkoutList();
  renderProfile();
  showPane(chosen);
  log('app', `Settings saved (${settings.shiftMode.toUpperCase()} shifting, difficulty ${settings.difficulty}%, hill feel ${settings.hillFeel}%, FTP ${settings.ftp} W)`);
});

window.addEventListener('resize', () => { renderPreview(); drawThumbs(); redrawRideProfile(); redrawMinimap(); });
window.addEventListener('beforeunload', (e) => {
  if (session.hasRide) { e.preventDefault(); e.returnValue = ''; }
});

// Light / dark: charts are drawn on canvases, so redraw them when the appearance changes (incl. macOS switching).
window.BFTheme?.onChange(() => { renderPreview(); drawThumbs(); redrawRideProfile(); redrawMinimap(); renderHud(); });
