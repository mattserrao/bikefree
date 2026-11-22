// Saving a route's map tiles for offline rides, and removing your own routes.
// (Part of the app: js/app.js imports every module in js/app/.)
import { saveSettings } from '../settings.js';
import * as store from '../store.js';
import { parseGpx, buildRoute } from '../gpx.js';
import { planRouteTiles, tileKeysToUrls, downloadUrls, offlineStatus, setOfflineStatus } from '../offline.js';
import { $, toast, log, settings, session } from './core.js';
import { routeItems, routeCache, selectedRouteId, resetRouteList, refreshRouteList } from './routes-menu.js';
import { previewRoute, closeMenus } from './route-loading.js';
import { openSummary } from './summary.js';

// ---------- Offline park downloads ----------
let offlineAbort = null;
function renderOffline() {
  if (offlineAbort) return;
  const bundled = !!(previewRoute?.scene || previewRoute?.sceneUrl || previewRoute?.base?.sceneUrl);
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
  // a wireframe placeholder draws only the elevation tiles (no aerial photos)
  const wire = routeItems.find((it) => it.id === id)?.wireframe;
  const urls = tileKeysToUrls(keys, { imagery: !wire });
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
  if (id.startsWith('mynet-')) { await removeNetRoute(id); return; }
  await store.deleteLibraryItem(id);
  routeCache.delete(id);
  await refreshRouteList();
});
/** Your own network route (the map planner): kept in settings. */
async function removeNetRoute(id) {
  settings.netRoutes = (settings.netRoutes || []).filter((m) => m.id !== id);
  saveSettings(settings);
  routeCache.delete(id);
  resetRouteList();
  await refreshRouteList();
}
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
session.addEventListener('routeGoal', () => toast('Goal reached — keep riding, or finish when you like'));

export { renderOffline, removeNetRoute };
