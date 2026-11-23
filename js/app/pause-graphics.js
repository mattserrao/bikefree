// The pause menu's Graphics panel (user, 23 Nov 2026: "in pausing an app, allow for change to graphics (both desktop
// and mobile same menus)"): scenery detail, time of day, weather, camera, minimap and power bar size, applied at once
// and saved (the same settings as the Settings dialog). Filled each time the pause overlay opens.
// (Part of the app: js/app.js imports it.)
import { saveSettings } from '../settings.js';
import { $, settings, log } from './core.js';
import { applyHudPrefs, world } from './ride-screen.js';

const TIMES = [['auto', "Route's default"], ['morning', 'Morning'], ['midday', 'Midday'], ['golden', 'Golden hour'], ['night', 'Night']];
const WEATHER = [['clear', 'Clear'], ['marine', 'Marine layer'], ['clouds', 'Clouds'], ['rain', 'Rain']];
const QUALITY_LABEL = { low: 'Light', balanced: 'Balanced', high: 'High' };

function options(select, list, value) {
  select.replaceChildren(...list.map(([v, label]) => { const o = document.createElement('option'); o.value = v; o.textContent = label; return o; }));
  select.value = list.some(([v]) => v === value) ? value : list[0][0];
}

function fill() {
  $('pQuality').value = settings.worldQuality;
  // the times and weathers the world being ridden offers (CNY, SKAN: one fixed golden hour — no menu)
  const times = world?.timeOptions?.() || null;
  const tList = times ? [['auto', "Route's default"], ...times.map((t) => [t.key, t.label])] : TIMES;
  $('pTimeBox').hidden = !!times && times.length <= 1;
  options($('pTime'), tList, settings.worldTime || 'auto');
  const weathers = world?.weatherOptions?.() || [];
  $('pWeatherBox').hidden = !!world && weathers.length <= 1;
  options($('pWeather'), weathers.length ? weathers.map((w) => [w.key, w.label]) : WEATHER, world?.weatherKey ?? settings.worldWeather ?? 'clear');
  $('pCamera').value = settings.camera || 'closest';
  $('pMinimap').value = settings.minimap;
  $('pHudSize').value = settings.hudSize;
  note();
}

/** What a scenery-detail change does now, and what waits for the next ride (a renderer's anti-aliasing is fixed). */
function note() {
  const started = world?.startQuality ?? world?.qualityKey;
  const el = $('pGfxNote');
  el.hidden = !started || started === settings.worldQuality;
  el.textContent = `Draw distance and sharpness change now. Anti-aliasing and ground detail switch to ${QUALITY_LABEL[settings.worldQuality]} on your next ride.`;
}

function save(what) { saveSettings(settings); log('app', `Pause menu: ${what}`); }

$('pQuality').addEventListener('change', (e) => {
  if (world && world.startQuality == null) world.startQuality = world.qualityKey;
  settings.worldQuality = e.target.value; world?.setQuality(settings.worldQuality); save(`scenery detail ${settings.worldQuality}`); note();
});
$('pTime').addEventListener('change', (e) => { settings.worldTime = e.target.value; world?.setTimeOfDay(settings.worldTime); save(`time ${settings.worldTime}`); });
$('pWeather').addEventListener('change', (e) => { settings.worldWeather = e.target.value; world?.setWeather(settings.worldWeather); save(`weather ${settings.worldWeather}`); });
$('pCamera').addEventListener('change', (e) => { settings.camera = e.target.value; world?.setCamera?.(settings.camera); save(`camera ${settings.camera}`); });
$('pMinimap').addEventListener('change', (e) => { settings.minimap = e.target.value; applyHudPrefs(); save(`minimap ${settings.minimap}`); });
$('pHudSize').addEventListener('change', (e) => { settings.hudSize = e.target.value; applyHudPrefs(); save(`power bar ${settings.hudSize}`); });

// fill it whenever the overlay opens
const overlay = $('pauseOverlay');
new MutationObserver(() => { if (!overlay.hidden) fill(); }).observe(overlay, { attributes: true, attributeFilter: ['hidden'] });

export { fill as fillPauseGraphics };
