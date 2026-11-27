// Saving a route's map tiles for offline rides, and removing your own routes.
// (Part of the app: js/app.js imports every module in js/app/.)
import { saveSettings } from '../settings.js';
import * as store from '../store.js';
import { parseGpx, buildRoute } from '../gpx.js';
import { planRouteTiles, tileKeysToUrls, downloadUrls, offlineStatus, setOfflineStatus, applyUpdate } from '../offline.js';
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
  store.persistStorage();   // [review 27 Nov] ask once that the browser keep the downloaded tiles (and rides) when space runs low
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

// ---------- A new version (sw.js) ----------
/**
 * [review 27 Nov] A7: a new revision is installed and waiting (sw.js no longer takes over mid-session). The menu shows
 * "Update ready · Reload"; with a ride in progress it waits for the ride to be finished. With no ride going, leaving
 * the page (hidden) lets it take over quietly: this tab keeps its own files, the next load is the new version.
 * `apply(worker, reload?)`: js/offline.js applyUpdate. Returns { ready(worker), render(), hidden() }.
 */
function updatePrompt(bar, text, btn, session, apply, reload) {
  let waiting = null, applying = false;
  const render = () => {
    bar.hidden = !waiting;
    if (!waiting || applying) return;
    const riding = session.hasRide;
    text.textContent = riding ? 'Update ready — reload after this ride' : 'Update ready';
    btn.disabled = riding;
  };
  btn.addEventListener('click', () => {
    if (!waiting || applying || session.hasRide) return;
    applying = true; btn.disabled = true; text.textContent = 'Updating…';
    apply(waiting, reload);
  });
  return {
    ready(worker) { waiting = worker; render(); },
    render,
    hidden() {   // (the page was hidden: no ride going → let it take over now; no reload)
      if (!waiting || applying || session.hasRide) return;
      apply(waiting, null);
      waiting = null; render();
    },
  };
}
const update = updatePrompt($('updateBar'), $('updateText'), $('updateBtn'), session,
  (w, reload) => applyUpdate(w, navigator.serviceWorker, reload), () => location.reload());
for (const ev of ['change', 'routeFinished']) session.addEventListener(ev, update.render);
document.addEventListener('visibilitychange', () => { if (document.hidden) update.hidden(); });
const onUpdateReady = (worker) => { log('app', 'A new version is ready: reload to use it', 'info'); update.ready(worker); };

export { renderOffline, removeNetRoute, onUpdateReady };
