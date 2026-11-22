// A road-graph city's panel: its map, routes, segments and landmarks.
// (Part of the app: js/app.js imports every module in js/app/.)
import { saveSettings } from '../settings.js';
import { drawCityMap } from '../views.js';
import {
  citySubline, filterByGoal, segmentRoutes, pickOnSegment, nearestLine, fitProjection, zoomProjection, zoomAt,
  panBy, shortName, landmarkRank, nearestLandmark, revealScrollTop,
} from '../city-routes.js';
import { keysToIds, edgeLines } from '../network.js';
import { thumbLines } from '../city-thumbs.js';
import { $, log, settings, trainer, fmtDist, distUnit, fmtElev, elevUnit, escapeHtml } from './core.js';
import { chosen, showPane } from './route-options.js';
import { openPlanner } from './planner.js';
import { renderCityShots } from './preview.js';
import { startRide } from './ride-screen.js';
import {
  graphCityOf, routeCache, selectedRouteId, setSelectedRouteId, GOALS, goalTags, routeGoal, routeCards,
  renderRouteCards, drawThumbs,
} from './routes-menu.js';
import { previewRoute, graphNetsDone, graphMaps, graphMapLabels, graphNet, previewSelectedRoute } from './route-loading.js';
import { removeNetRoute } from './offline-ui.js';

// ---------- City panel (a ride network's map and routes) ----------
// Full screen over the menu (a <dialog>: Escape closes it, focus goes back to the card). The map shows the whole
// network over its rivers; a route tapped in the list lights up bold on it, a line tapped on the map lists the
// routes that ride it (tap again for the next). The goal chips filter both. Ride starts riding the route at once
// (F104: the defaults the preview would apply — its remembered start, else the plan's, and the ride length and
// pacer as set); "Options" beside it chooses the route and goes back to the menu, where its preview, start
// options and Start button are — the same as picking a card used to (and Ride does that too, with no trainer).
const city = { baseId: null, goal: 'all', sel: null, seg: null, segIds: null, focus: null, lines: [], hint: '', view: { k: 1 } };
const cityMaps = new Map();     // baseId → the graph's baked map (F101: river banks, labels), when it has one
/** A city's graph (its panel's map and lines) and its baked map, loaded when the panel opens. */
async function loadCityMap(card) {
  if (cityMaps.has(card.baseId)) return false;
  cityMaps.set(card.baseId, null);
  await graphNet(card.network, graphCityOf(card.baseId)?.name);
  const mapUrl = graphMaps.get(card.network);
  if (mapUrl) try { cityMaps.set(card.baseId, await (await fetch(mapUrl)).json()); } catch { /* lines only */ }
  return true;
}
const cityNet = (card) => graphNetsDone.get(card.network) || null;
/** A city route's traversal keys (a preset's path; your own route's, from its saved segment names). */
function cityPath(net, it) {
  if (it.preset) return net.presets.find((x) => x.id === it.preset)?.path || [];
  if (it.custom) return keysToIds(net, it.keys) || [];
  return [];
}
function cityMapData(card) {
  const net = cityNet(card);
  if (!net) return null;
  const paths = new Map(card.routes.map((it) => [it.id, cityPath(net, it)]));
  // a road graph's network (PGH: thousands of streets) is drawn simply (minor: 0 primary roads and trails, 1 secondary
  // roads — both drawn in full, the thumbnail too — 2 the rest, thinner, not on the thumbnail; all in one faint style),
  // no junction dots, no landmarks; a few neighbourhoods named and the rivers
  const lines = edgeLines(net).map((L) => ({ id: L.id, lat: L.lat, lon: L.lon, minor: L.e.kind === 'primary' || L.e.kind === 'path' ? 0 : L.e.kind === 'secondary' ? 1 : 2 })), map = cityMaps.get(card.baseId);
  return { net, paths, index: segmentRoutes(card.routes.map((it) => ({ id: it.id, path: paths.get(it.id) }))),
    lines, rivers: [], waterAreas: map?.water || null,
    labels: [...(map?.labels || []).filter((lb) => lb.kind === 'river'), ...(graphMapLabels.get(card.network) || [])], landmarks: [] };
}
function drawCityThumb(canvas, card) {
  if (!card) return;
  const sel = card.routes.find((x) => x.id === selectedRouteId);
  const d = cityNet(card) && cityMapData(card);
  const thumb = graphCityOf(card.baseId)?.thumb;
  if (d) { drawCityMap(canvas, { lines: d.lines, rivers: d.rivers, waterAreas: d.waterAreas || thumb?.water, route: sel ? d.paths.get(sel.id) : null, thumb: true, project: fitProjection }); return; }
  // the graph isn't loaded (it loads with the panel or a route of it): the card's baked thumbnail (js/city-thumbs.js)
  if (!thumb) return;
  const { lines, route } = thumbLines(thumb, sel?.preset);
  drawCityMap(canvas, { lines, waterAreas: thumb.water, route, thumb: true, project: fitProjection });
}
const cityCard = () => routeCards.find((x) => x.city && x.baseId === city.baseId) || null;
function openCity(baseId) {
  city.baseId = baseId;
  const card = cityCard();
  if (!card) return;
  city.goal = routeGoal;
  city.sel = card.routes.some((x) => x.id === selectedRouteId) ? selectedRouteId : null;
  city.seg = null; city.segIds = null; city.focus = null; city.hint = '';
  city.view = { k: 1 };
  $('cityDlg').showModal();
  // the browser's Back closes the panel (F100: on a phone Back is the way out); the panel's own ways out drop the entry
  if (!history.state?.cityPanel) history.pushState({ ...(history.state || {}), cityPanel: true }, '');
  renderCity();
  $('cityList').querySelector('.city-row.on')?.scrollIntoView({ block: 'nearest' });
  loadCityMap(card).then((fresh) => { if (fresh && $('cityDlg').open) { renderCity(); renderCityMap(); drawThumbs(); } }).catch((err) => log('app', `Could not load ${card.name}: ${err.message}`, 'error'));
}
$('cityBack').addEventListener('click', () => $('cityDlg').close());
window.addEventListener('popstate', () => { if ($('cityDlg').open) $('cityDlg').close(); });
$('cityDlg').addEventListener('close', () => { if (history.state?.cityPanel) history.back(); });
window.addEventListener('resize', () => { if ($('cityDlg').open) renderCityMap(); });
/** The routes the goal shows, and of those the ones on the tapped segment (when one is). */
function cityShown(card) {
  const byGoal = filterByGoal(card.routes, city.goal, goalTags);
  return { byGoal, list: city.segIds ? byGoal.filter((it) => city.segIds.includes(it.id)) : byGoal };
}
function renderCity() {
  const card = cityCard();
  if (!card) { $('cityDlg').close(); return; }
  const label = Object.fromEntries(GOALS);
  const { byGoal, list } = cityShown(card);
  $('cityTitle').textContent = card.name;
  $('citySub').textContent = `${citySubline(card, 0)}${card.mine.length ? ` · ${card.mine.length} yours` : ''}`;
  $('cityGoals').innerHTML = GOALS.map(([k, l]) => `<button type="button" data-goal="${k}" class="${k === city.goal ? 'on' : ''}" aria-pressed="${k === city.goal}">${k === 'new' ? 'New' : l}</button>`).join('');
  $('cityFree').parentElement.hidden = !card.free;
  const net = cityNet(card);
  // the tapped segment: which routes ride it
  $('citySeg').hidden = !city.seg;
  if (city.seg && net) {
    const e = net.edges.get(city.seg), k = city.segIds.indexOf(city.sel);
    $('citySeg').innerHTML = `<span><b>${escapeHtml(e?.name || 'This segment')}</b> · ${city.segIds.length === 1 ? '1 route rides it' : `${city.segIds.length} routes ride it${k >= 0 ? ` · ${k + 1} of ${city.segIds.length}, tap it again for the next` : ''}`}</span><button type="button" class="link" id="citySegClear">Show all</button>`;
  }
  const facts = (it) => {
    const r = routeCache.get(it.id);
    return r ? `${fmtDist(r.lapM, 1)} ${distUnit()} · ${fmtElev(r.lapClimbM).toLocaleString()} ${elevUnit()}` : '';
  };
  const rowHtml = (it) => {
    const r = routeCache.get(it.id), on = it.id === city.sel, tags = goalTags(it);
    const mine = it.custom ? '<span class="yours">yours</span>' : '';
    const row = `<button type="button" class="city-row-btn" data-id="${escapeHtml(it.id)}" aria-pressed="${on}"><span class="cr-name">${escapeHtml(shortName(it.name))}${mine}</span><span class="cr-facts">${facts(it)}</span></button>`;
    if (!on) return `<li class="city-row">${row}</li>`;
    const kind = r ? (r.netOpen ? 'One way' : 'Loop') : '';
    const detail = `<div class="cr-detail"><div class="cr-tags">${[kind, ...tags.map((t) => label[t])].filter(Boolean).map((t) => `<span>${escapeHtml(t)}</span>`).join('')}</div>
      ${it.note && !it.custom ? `<p class="cr-note">${escapeHtml(it.note)}</p>` : ''}
      <div class="cr-actions">${it.custom ? `<button type="button" class="ghost danger" data-remove="${escapeHtml(it.id)}">Remove</button>` : ''}<button type="button" class="link" data-options="${escapeHtml(it.id)}" title="Choose where to start and how long to ride, then Start" aria-label="Options for ${escapeHtml(shortName(it.name))}: start and length">Options</button><button type="button" class="primary" data-ride="${escapeHtml(it.id)}" aria-label="Ride ${escapeHtml(shortName(it.name))} now" title="Start riding it now">Ride</button></div></div>`;
    return `<li class="city-row on">${row}${detail}</li>`;
  };
  if (!list.some((it) => it.id === city.sel)) city.sel = list[0]?.id || null;   // (the top of the list as shown)
  $('cityList').innerHTML = list.length ? list.map(rowHtml).join('') : `<li class="muted city-none">No ${city.goal === 'all' ? '' : `${label[city.goal].toLowerCase()} `}routes${city.seg ? ' on this segment' : ''} yet${byGoal.length ? '' : ' — try another goal, or plan your own'}.</li>`;
  const sel = list.find((it) => it.id === city.sel);
  $('citySel').textContent = sel ? `${shortName(sel.name)}: ${facts(sel)}` : '';
  renderCityShots(sel ? sel.routeId : null);
  renderCityMap();
}
function renderCityMap() {
  const card = cityCard(), d = card && cityMapData(card);
  if (!d) return;
  const { byGoal } = cityShown(card);
  const lit = new Set(byGoal.flatMap((it) => (d.paths.get(it.id) || []).map((k) => k.replace(/[+-]$/, ''))));
  // landmarks (PLAN 7.9): shown unless switched off with the map's toggle (remembered); labels by rank as you zoom
  const showLm = settings.mapLandmarks !== false;
  $('cityLm').hidden = !d.landmarks.length;
  $('cityLm').setAttribute('aria-pressed', String(showLm));
  $('cityLm').title = showLm ? 'Hide the landmarks' : 'Show the landmarks';
  city.lines = drawCityMap($('cityMap'), { lines: d.lines, rivers: d.rivers, waterAreas: d.waterAreas, labels: d.labels.filter((lb) => !(lb.rank > 1) || $('cityMap').clientWidth >= 520 || (city.view?.k || 1) >= 1.5),   // (no junction dots: the roads alone)
    landmarks: showLm ? d.landmarks : null, landmarkRank: landmarkRank(city.view?.k || 1, $('cityMap').clientWidth < 520),
    lit: city.goal === 'all' ? null : lit, route: city.sel ? d.paths.get(city.sel) : null, marked: city.seg, focus: city.focus,
    project: (lines, w, h, pad) => zoomProjection(fitProjection(lines, w, h, pad), w, h, city.view) });
  const zoomed = (city.view?.k || 1) > 1;
  $('cityMap').classList.toggle('zoomed', zoomed);
  $('cityFit').hidden = !zoomed;
  $('cityMap').lines = city.lines;   // (tools/snap_city.mjs taps a line by these)
  const sel = card.routes.find((x) => x.id === city.sel), fe = city.focus && d.net.edges.get(city.focus);
  $('cityMap').setAttribute('aria-label', `Map of ${card.name}${sel ? `, ${shortName(sel.name)} highlighted` : ''}${showLm && d.landmarks.length ? `, with ${d.landmarks.length} landmarks` : ''}. Arrow keys pick a segment, Enter lists the routes that ride it.`);
  $('cityMapHint').textContent = city.hint || (fe ? `${fe.name} · Enter to see its routes` : 'Tap a line to see the routes that ride it');
}
function citySelect(id, { scroll = true, fromMap = false, focusRide = false } = {}) {
  city.sel = id;
  renderCity();
  const list = $('cityList'), row = list.querySelector('.city-row.on');
  if (!row) return;
  if (fromMap && list.scrollHeight > list.clientHeight) {
    // picked on the map (7.9c): glide the list so the row and its Ride / Options are fully in view, and give Ride focus
    const lr = list.getBoundingClientRect(), rr = row.getBoundingClientRect(), top = rr.top - lr.top + list.scrollTop;
    const to = revealScrollTop(top, top + rr.height, list.scrollTop, list.clientHeight);
    if (to != null) list.scrollTo({ top: to, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    if (focusRide) row.querySelector('[data-ride]')?.focus({ preventScroll: true });   // (not from the map's keys: Enter again picks the next route)
  } else if (scroll) row.scrollIntoView({ block: 'nearest' });
}
/** A segment tapped (or chosen with the keyboard): list the routes that ride it, select the first (again: the next). */
function cityTapSegment(edgeId, { pointer = false } = {}) {
  const card = cityCard(), d = card && cityMapData(card);
  if (!d) return;
  const { byGoal } = cityShown(card);
  const res = pickOnSegment(d.index, edgeId, byGoal.map((it) => it.id), { lastEdge: city.seg, selected: city.sel });
  const e = d.net.edges.get(edgeId);
  if (!res.ids.length) {
    city.hint = `No ${city.goal === 'all' ? '' : `${Object.fromEntries(GOALS)[city.goal].toLowerCase()} `}route rides ${e?.name || 'that segment'} — Free ride or Plan your own can`;
    renderCityMap();
    return;
  }
  city.hint = '';
  city.seg = edgeId; city.segIds = res.ids;
  citySelect(res.selected, { fromMap: true, focusRide: pointer });
}
function cityChoose(id) {
  // the same as picking its card in the list used to: it's the route, and the menu shows its preview and Start
  $('cityDlg').close();
  setSelectedRouteId(id);
  renderRouteCards();
  const shown = previewSelectedRoute();
  if (matchMedia('(max-width: 1080px)').matches) document.querySelector('.preview').scrollIntoView({ block: 'start' });
  $('startBtn').focus({ preventScroll: true });
  return shown;
}
/** Ride (F104): choose the route and start riding it at once, as Start would with the preview's defaults. */
async function cityRide(id) {
  if (chosen !== 'route') showPane('route');
  await cityChoose(id);
  // (no trainer yet, or the route didn't load: the menu shows it chosen, with what's missing on its Start button)
  if (!trainer.connected || selectedRouteId !== id || !previewRoute || previewRoute !== routeCache.get(id)) return;
  await startRide();
}
// zoom and pan (F102): pinch or the wheel zooms about the fingers / the pointer, a drag pans once zoomed in;
// "Whole map" goes back out. Lines stay as easy to tap in px, so zoomed in they are further apart
const mapPtrs = new Map();
let mapDrag = null;   // {x, y, d, moved}: the gesture under way (one pointer's place, or two pointers' midpoint and spread)
function mapGesture() {
  const p = [...mapPtrs.values()];
  if (!p.length) return null;
  const x = p.reduce((t, q) => t + q.x, 0) / p.length, y = p.reduce((t, q) => t + q.y, 0) / p.length;
  return { x, y, d: p.length > 1 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0, n: p.length };
}
$('cityMap').addEventListener('pointerdown', (e) => {
  const rect = e.currentTarget.getBoundingClientRect();
  mapPtrs.set(e.pointerId, { x: e.clientX - rect.left, y: e.clientY - rect.top });
  mapDrag = { ...mapGesture(), moved: mapDrag?.moved || false };
});
$('cityMap').addEventListener('pointermove', (e) => {
  if (!mapPtrs.has(e.pointerId) || !mapDrag) return;
  const rect = e.currentTarget.getBoundingClientRect(), w = rect.width, h = rect.height;
  mapPtrs.set(e.pointerId, { x: e.clientX - rect.left, y: e.clientY - rect.top });
  const g = mapGesture();
  if (g.n !== mapDrag.n) { mapDrag = { ...g, moved: mapDrag.moved }; return; }
  if (Math.hypot(g.x - mapDrag.x, g.y - mapDrag.y) < 6 && Math.abs(g.d - mapDrag.d) < 6 && !mapDrag.moved) return;   // still a tap
  let v = city.view || { k: 1 };
  if (g.n > 1 && mapDrag.d > 0) v = zoomAt(v, w, h, g.x, g.y, g.d / mapDrag.d);
  if (v.k > 1) v = panBy(v, w, h, g.x - mapDrag.x, g.y - mapDrag.y);
  else if (g.n < 2) return;   // the whole map: a one-finger drag scrolls the page (touch-action pan-y)
  e.preventDefault();
  city.view = v; mapDrag = { ...g, moved: true };
  renderCityMap();
});
const mapUp = (e) => { mapPtrs.delete(e.pointerId); if (!mapPtrs.size && mapDrag) setTimeout(() => { mapDrag = null; }, 0); else if (mapDrag) mapDrag = { ...mapGesture(), moved: mapDrag.moved }; };
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) $('cityMap').addEventListener(ev, mapUp);
$('cityMap').addEventListener('wheel', (e) => {
  const rect = e.currentTarget.getBoundingClientRect();
  e.preventDefault();
  city.view = zoomAt(city.view || { k: 1 }, rect.width, rect.height, e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY / 300));
  renderCityMap();
}, { passive: false });
// hovering a line with a mouse previews which routes ride it (F105), in the map's hint
$('cityMap').addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || mapDrag?.moved) return;
  const card = cityCard(), d = card && cityMapData(card);
  if (!d) return;
  const rect = e.currentTarget.getBoundingClientRect(), px = e.clientX - rect.left, py = e.clientY - rect.top;
  const lm = nearestLandmark(city.lines.landmarks, px, py, 8);   // (PLAN 7.9: a marker under the pointer names itself)
  if (lm) {
    if (city.hover === `lm:${lm.lm.name}`) return;
    city.hover = `lm:${lm.lm.name}`;
    $('cityMapHint').textContent = lm.lm.name;
    return;
  }
  const j = nearestLine(city.lines, px, py, 14);
  const id = j >= 0 ? city.lines[j].id : null;
  if (id === city.hover) return;
  city.hover = id;
  if (!id) { $('cityMapHint').textContent = city.hint || 'Tap a line to see the routes that ride it'; return; }
  const { byGoal } = cityShown(card);
  const n = (d.index.get(id) || []).filter((r) => byGoal.some((it) => it.id === r)).length;
  $('cityMapHint').textContent = `${d.net.edges.get(id)?.name || 'This segment'} · ${n ? `${n === 1 ? '1 route rides' : `${n} routes ride`} it — click to list them` : 'no route rides it — Free ride or Plan your own can'}`;
});
$('cityMap').addEventListener('pointerleave', () => { if (city.hover) { city.hover = null; renderCityMap(); } });
$('cityLm').addEventListener('click', () => {
  settings.mapLandmarks = settings.mapLandmarks === false;
  saveSettings(settings);
  if (city.hint && !settings.mapLandmarks) city.hint = '';
  renderCityMap();
});
$('cityFit').addEventListener('click', () => { city.view = { k: 1 }; renderCityMap(); $('cityMap').focus({ preventScroll: true }); });
$('cityMap').addEventListener('click', (e) => {
  if (mapDrag?.moved) return;   // the end of a pinch or a drag, not a tap
  const rect = e.currentTarget.getBoundingClientRect();
  const j = nearestLine(city.lines, e.clientX - rect.left, e.clientY - rect.top, e.pointerType === 'mouse' ? 14 : 22);
  if (j >= 0) { city.focus = null; cityTapSegment(city.lines[j].id, { pointer: true }); return; }
  // off the lines, on a landmark (PLAN 7.9): its name in the hint
  const lm = nearestLandmark(city.lines.landmarks, e.clientX - rect.left, e.clientY - rect.top, e.pointerType === 'mouse' ? 10 : 18);
  if (lm) { city.hint = lm.lm.name; renderCityMap(); return; }
  if (city.seg) { city.seg = null; city.segIds = null; renderCity(); }   // off the lines: back to every route
});
$('cityMap').addEventListener('keydown', (e) => {
  const card = cityCard(), d = card && cityMapData(card);
  if (!d) return;
  // the keyboard's way round the map: the segments the goal lights, in order
  const { byGoal } = cityShown(card);
  const ids = d.lines.map((L) => L.id).filter((id) => (d.index.get(id) || []).some((r) => byGoal.some((it) => it.id === r)));
  if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key) && ids.length) {
    const i = ids.indexOf(city.focus), dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    city.focus = ids[(i < 0 ? (dir > 0 ? 0 : ids.length - 1) : (i + dir + ids.length) % ids.length)];
    city.hint = '';
    renderCityMap();
    $('citySel').textContent = `${d.net.edges.get(city.focus)?.name}: ${(d.index.get(city.focus) || []).length} routes`;
  } else if ((e.key === 'Enter' || e.key === ' ') && city.focus) cityTapSegment(city.focus);
  else return;
  e.preventDefault();
});
$('cityGoals').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-goal]');
  if (!b) return;
  city.goal = b.dataset.goal; city.seg = null; city.segIds = null; city.hint = '';
  renderCity();
});
$('citySeg').addEventListener('click', (e) => { if (e.target.id === 'citySegClear') { city.seg = null; city.segIds = null; renderCity(); } });
$('cityList').addEventListener('click', async (e) => {
  const ride = e.target.closest('[data-ride]'), opts = e.target.closest('[data-options]'), rm = e.target.closest('[data-remove]'), row = e.target.closest('.city-row-btn');
  if (ride) cityRide(ride.dataset.ride);
  else if (opts) cityChoose(opts.dataset.options);
  else if (rm) {
    if (!confirm('Remove this route from your library?')) return;
    await removeNetRoute(rm.dataset.remove);
    if ($('cityDlg').open) renderCity();
  } else if (row) citySelect(row.dataset.id, { scroll: false });
});
$('cityList').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const rows = [...$('cityList').querySelectorAll('.city-row-btn')], i = rows.indexOf(document.activeElement);
  if (i < 0) return;
  const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
  e.preventDefault();
  citySelect(next.dataset.id);
  $('cityList').querySelector(`.city-row-btn[data-id="${CSS.escape(next.dataset.id)}"]`)?.focus();
});
// the Free ride tile starts it at once, as Ride does (F104); Options beside it chooses it and shows its preview
$('cityFree').addEventListener('click', () => { const c = cityCard(); if (c?.free) cityRide(c.free.id); });
$('cityFreeOpts').addEventListener('click', () => { const c = cityCard(); if (c?.free) cityChoose(c.free.id); });
$('cityPlan').addEventListener('click', () => { const c = cityCard(); if (c) openPlanner(c.routes.find((x) => !x.custom) || c.free); });

export { city, drawCityThumb, openCity, renderCity, renderCityMap };
