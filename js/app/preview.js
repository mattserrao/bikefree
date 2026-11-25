// The menu's preview panel, the route pictures and the scenery choice behind free rides and workouts.
// (Part of the app: js/app.js imports every module in js/app/.)
import { saveSettings } from '../settings.js';
import { routeAt, legSpan } from '../gpx.js';
import { drawProfile, drawWorkout, drawTrace } from '../views.js';
import { legLength, stopNear } from '../route-plan.js';
import { PREVIEW_INDEX, previewShots, shotsHtml, prunePreviewCache } from '../route-previews.js';
import { $, log, settings, imperial, fmtDist, distUnit, fmtElev, elevUnit, fmtTime, escapeHtml } from './core.js';
import { chosen, renderStart, fmtPlanTime, chosenPlan, renderOptsSummary, renderRouteSelector, lapView } from './route-options.js';
import { parkItems, netItems, routeOutline, drawThumbs } from './routes-menu.js';
import { previewRoute, loadRouteItem } from './route-loading.js';
import { previewWorkout, workoutStats } from './workouts-ui.js';

// ---------- Preview panel (right column) ----------
let pvLayout = null;   // the preview profile's layout (the route selector's drag reads it)
const fact = (v, label) => `<div class="fact"><b>${v}</b><small>${label}</small></div>`;
function renderPreview() {
  const map = $('pvMap'), chart = $('pvChart');
  $('routeOpts').hidden = true;
  renderOptsSummary();
  $('pvHint').hidden = true;
  chart.classList.remove('pickable');
  $('offlineStatus').hidden = chosen !== 'route';
  if (chosen === 'route' && previewRoute) {
    const r = previewRoute;
    $('pvKicker').textContent = 'Route';
    $('pvTitle').textContent = r.name;
    $('pvSub').textContent = r.park || 'Your route';
    const leg = legLength(r), cp = chosenPlan(r), startM = cp.startM;
    // point to point (a one-way stage like Alpe d'Huez, or your own GPX): distance and climbing start to finish
    const p2p = cp.p2p;
    const netKm = r.netRide ? [...r.network.edges.values()].reduce((t, e) => t + e.len, 0) : 0;
    $('pvFacts').innerHTML = r.endless
      ? fact('∞', `${distUnit()} — it never ends`) + fact('6', 'biomes in turn') + '<div class="fact tag">Endless · choose the terrain every mile</div>'
      : r.free
      ? fact(`${fmtDist(netKm, 1)}`, `${distUnit()} of streets & trails`) + fact(String(r.network.nodes.size), 'junctions') +
        '<div class="fact tag">Free ride · choose every turn</div>'
      : r.netRide
      ? fact(`${fmtDist(leg, 1)}`, `${distUnit()} ${r.netOpen ? 'start to finish' : 'lap'}`) + fact(fmtElev(r.lapClimbM).toLocaleString(), `${elevUnit()} climb / lap`) +
        fact(`${Math.round(Math.max(...r.grade.subarray(0, Math.round(leg / 10) + 1)))}%`, 'max grade') +
        `<div class="fact tag">${r.netOpen ? 'One way · finishes at the end' : 'Loop · choose your turns at junctions'}</div>`
      : ((p2p
      ? fact(`${fmtDist(leg, 1)}`, `${distUnit()} start to finish`) + fact(fmtElev(r.oneWay.ascent).toLocaleString(), `${elevUnit()} climb to the finish`)
      : fact(`${fmtDist(leg, 1)}`, `${distUnit()} each way`) + fact(fmtElev(r.ascent).toLocaleString(), `${elevUnit()} climb / lap`)) +
      fact(`${Math.round(Math.max(...r.grade))}%`, 'max grade') +
      `<div class="fact tag">${p2p ? 'Point to point' : r.oneWay?.closedLoop ? 'Loop · each lap turns and rides it back' : 'There &amp; back · turns at each end'}</div>`);
    renderShots(r);
    $('planOpen').hidden = !r.netRide;
    if (r.netRide) $('pvDesc').innerHTML = `${r.note ? `${escapeHtml(r.note)}. ` : ''}At each junction choose left, straight, right or back with ◀ ▶ on the handlebars (or <kbd>A</kbd> <kbd>D</kbd>) — or follow the plan.`;
    if (!r.netRide) $('pvDesc').innerHTML = r.endless ? `${escapeHtml(r.note)}. Every mile choose flat, rolling, climb or descend with ◀ ▶ on the handlebars (or <kbd>A</kbd> <kbd>D</kbd>) — do nothing to keep the terrain.`
      : r.hasElevation ? '' : '<span class="warn">No elevation in this file — it will ride flat.</span>';
    map.hidden = false; chart.hidden = false;
    $('routeOpts').hidden = false;
    renderRouteSelector(r, cp);
    // the leg being ridden, in riding order, with the planned stretch bright and its finish line
    const span = legSpan(r, startM);
    const endM = cp.plan.endM;
    const selEnd = endM == null ? span[1] : Math.min(span[1], endM);
    const end = endM != null ? stopNear(r, r.stops, endM) : null;
    const ticks = (r.stops || []).map((st) => (r.netRide || span[0] === 0 ? st.atM : r.total - st.atM));
    drawTrace(map, lapView(r), startM, { markerOnly: true, section: endM != null ? [startM, endM] : null });
    pvLayout = drawProfile(chart, r, startM, { metric: !imperial(), span, selection: [startM, selEnd], ticks,
      finishAt: endM != null && endM <= span[1] + 1 ? Math.min(endM, span[1]) : null,
      endLabel: endM == null ? null : end && end.d < 600 ? end.name : `~${fmtPlanTime(cp.plan.timeS)}` });
    chart.classList.add('pickable');
    const at = routeAt(r, startM);
    $('pvHint').hidden = false;
    $('pvHint').textContent = `Drag on the profile to move the start · starting ${fmtDist(cp.st.offsetM, 1)} ${distUnit()} in at ${fmtElev(at.ele).toLocaleString()} ${elevUnit()}`;
  } else if (chosen === 'workout' && previewWorkout) {
    renderShots(null);
    $('planOpen').hidden = true;
    const w = previewWorkout, st = workoutStats(w);
    $('pvKicker').textContent = 'Workout';
    $('pvTitle').textContent = w.name;
    $('pvSub').textContent = `At FTP ${settings.ftp} W`;
    $('pvFacts').innerHTML = fact(fmtTime(w.duration), 'time') + fact(`~${st.kj}`, 'kJ') + fact(`${st.maxW} W`, 'peak');
    $('pvDesc').textContent = w.description || '';
    map.hidden = true; chart.hidden = false;
    drawWorkout(chart, w, 0, settings.ftp, 1);
  } else {
    const scene = sceneryItem();
    renderShots(null);
    $('planOpen').hidden = true;   // (the route pane's map planner link: the free pane now opens from there)
    $('pvKicker').textContent = 'Free ride';
    $('pvTitle').textContent = scene ? scene.name : 'Numbers only';
    $('pvSub').textContent = scene ? `Scenery · ${scene.park}` : 'No scenery — a plain dark background';
    $('pvFacts').innerHTML = '';
    $('pvDesc').innerHTML = 'Change the grade with ▲ ▼ on the handlebars (or <kbd>↑</kbd> <kbd>↓</kbd>) while you ride.' +
      (sceneryFreeItem(scene) ? ` The scenery is ${escapeHtml(scene.name.split(' · ')[0])}'s free ride: straight on at each junction, or turn with ◀ ▶ (<kbd>A</kbd> <kbd>D</kbd>) into any part of the city.` : '');
    chart.hidden = true;
    map.hidden = !scene;
    const line = scene && routeOutline(scene);
    if (line) drawTrace(map, line, 0);
  }
  renderStart();
}

// ---------- Route pictures (PLAN 6.8): start, highlight, a climb — pre-rendered (tools/build_previews.mjs) ----------
let previewManifest = null, shownShots = [], shotsKey = null, shotAt = 0, dlgShots = [];
async function loadPreviewManifest() {
  try { previewManifest = await (await fetch(PREVIEW_INDEX)).json(); } catch { previewManifest = null; }
  prunePreviewCache(previewManifest).catch(() => {});
}
function renderShots(r) {
  const key = r ? r.id : null;
  if (key === shotsKey) return;   // the same route: keep the pictures (no reload while the start is dragged)
  shotsKey = key;
  shownShots = r ? previewShots(previewManifest, r.id) : [];
  const box = $('pvShots');
  box.hidden = !shownShots.length;
  box.style.setProperty('--n', shownShots.length || 1);
  box.innerHTML = shotsHtml(shownShots);
}
/** Enlarges picture i of a strip's list (the menu's, or the city panel's: 7.1) — ‹ › go round that list. */
function showShot(i, list = dlgShots) {
  if (!list.length) return;
  dlgShots = list;
  shotAt = (i + list.length) % list.length;
  const s = list[shotAt];
  $('shotImg').src = s.url; $('shotImg').alt = s.caption;
  $('shotCap').innerHTML = `<b>${escapeHtml(s.word)}</b>${s.place ? ` ${escapeHtml(s.place)}` : ''}`;
  $('shotCount').textContent = `${shotAt + 1} of ${list.length}`;
  $('shotPrev').hidden = $('shotNext').hidden = list.length < 2;
  if (!$('shotDlg').open) $('shotDlg').showModal();   // (over the full-screen city panel too: the later modal is on top)
}
$('pvShots').addEventListener('click', (e) => { const b = e.target.closest('[data-shot]'); if (b) showShot(Number(b.dataset.shot), shownShots); });
// the full-screen city panel covers the menu's pictures (7.1): the selected route's are shown below its map
let cityShotList = [], cityShotsKey;
function renderCityShots(routeId) {
  const key = `${routeId}|${previewManifest ? 1 : 0}`;
  if (key === cityShotsKey) return;   // the same route: no reload (the list is redrawn on every pick)
  cityShotsKey = key;
  cityShotList = routeId ? previewShots(previewManifest, routeId) : [];
  const box = $('cityShots');
  box.hidden = !cityShotList.length;
  box.style.setProperty('--n', cityShotList.length || 1);
  box.innerHTML = shotsHtml(cityShotList);
  $('cityDlg').classList.toggle('has-shots', cityShotList.length > 0);
}
$('cityShots').addEventListener('click', (e) => { const b = e.target.closest('[data-shot]'); if (b) showShot(Number(b.dataset.shot), cityShotList); });
$('shotPrev').addEventListener('click', () => showShot(shotAt - 1));
$('shotNext').addEventListener('click', () => showShot(shotAt + 1));
$('shotClose').addEventListener('click', () => $('shotDlg').close());
$('shotDlg').addEventListener('click', (e) => { if (e.target === $('shotDlg')) $('shotDlg').close(); });   // the backdrop
$('shotDlg').addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') showShot(shotAt - 1); if (e.key === 'ArrowRight') showShot(shotAt + 1); });

// ---------- Scenery (3D loop behind free rides and workouts) ----------
const sceneryItem = () => (parkItems || []).find((p) => p.id === settings.scenery) || null;
function setScenery(id) {
  settings.scenery = id;
  saveSettings(settings);
  renderScenery();
  renderPreview();
}
// Routes are listed in sections: Production, In Progress, then one closed "More routes" fold (menu-simplify-test) holding
// Rough Drafts (catalog "stage": "draft") and the Ideas list. The fold opens
// by itself while the selected item is in it.
// (user, 25 Nov: PGH, CNY, SKAN and Endless — QC checked — in a new first section, Production)
const STAGES = [['production', 'Production'], ['progress', 'In Progress'], ['draft', 'Rough Drafts']];
const OPEN_STAGES = 2;   // (Production and In Progress open; the rest in the "More routes" fold)
const stageOf = (it) => (it.stage === 'draft' ? 'draft' : it.stage === 'production' ? 'production' : 'progress');
const moreOpen = {};   // by list (route cards, scenery cards): opened by hand
function groupedCards(items, card, selectedId = null, list = 'routeCards') {
  const block = ([key, label]) => {
    const list = items.filter((it) => stageOf(it) === key);
    return list.length ? `<h3 class="cards-group">${label}</h3>${list.map(card).join('')}` : '';
  };
  const folded = items.filter((it) => !STAGES.slice(0, OPEN_STAGES).some(([k]) => k === stageOf(it)));
  const open = moreOpen[list] || folded.some((it) => it.id === selectedId);
  const inner = STAGES.slice(OPEN_STAGES).map(block).join('') + ideasSection();
  return STAGES.slice(0, OPEN_STAGES).map(block).join('') + (inner ? `<details class="more-routes" ${open ? 'open' : ''}${open && !moreOpen[list] ? ' data-auto="1"' : ''}><summary class="cards-group">More routes <span class="muted">· ${folded.length} drafts &amp; older${routeIdeas?.length ? ' · ideas' : ''}</span></summary><div class="cards">${inner}</div></details>` : '');
}
const watchMore = (list) => list.querySelector('details.more-routes')?.addEventListener('toggle', (e) => { if (!(e.target.dataset.auto && e.target.open)) moreOpen[list.id] = e.target.open; /* (not when opened for the selection) */ drawThumbs(); });

// Route ideas (routes/ideas.json): not rideable yet, listed in a collapsible section at the bottom.
let routeIdeas = null;
let ideasOpen = false;
async function loadIdeas() {
  if (routeIdeas) return routeIdeas;
  try { routeIdeas = await (await fetch('routes/ideas.json')).json(); } catch { routeIdeas = []; }
  return routeIdeas;
}
function ideasSection() {
  if (!routeIdeas?.length) return '';
  const top = routeIdeas.filter((i) => i.rank <= 10);
  const rest = routeIdeas.filter((i) => i.rank > 10);
  const row = (i) => `<li value="${i.rank}"><b>${escapeHtml(i.name)}</b>${i.note ? `<span class="rsub"> · ${escapeHtml(i.note)}</span>` : ''}</li>`;
  return `<details class="ideas" ${ideasOpen ? 'open' : ''}><summary class="cards-group">Ideas</summary>
    ${top.length ? `<h4>Top 10</h4><ol>${top.map(row).join('')}</ol>` : ''}
    ${rest.length ? `<h4>11–${rest[rest.length - 1].rank}</h4><ol>${rest.map(row).join('')}</ol>` : ''}</details>`;
}

const watchIdeas = (list) => list.querySelector('details.ideas')?.addEventListener('toggle', (e) => { ideasOpen = e.target.open; });

function renderScenery() {
  const items = [...(parkItems || []).filter((p) => !p.area), { id: 'none', name: 'None', park: 'Numbers only' }];   // (a city's areas: not choices of their own)
  if (!items.some((p) => p.id === settings.scenery)) settings.scenery = items[0].id;
  $('sceneCards').innerHTML = groupedCards(items, (p) => `
    <button class="rcard ${p.id === 'none' ? 'none' : ''} ${p.id === settings.scenery ? 'on' : ''}" data-id="${p.id}">
      ${p.id === 'none' ? '<div class="blank">No 3D</div>' : '<canvas></canvas>'}
      <div><b>${escapeHtml(p.name)}</b><div class="rsub">${escapeHtml(p.park || '')}</div></div>
    </button>`, settings.scenery, 'sceneCards');
  watchIdeas($('sceneCards')); watchMore($('sceneCards'));
  drawThumbs();
  const sel = $('sceneSelect');
  sel.innerHTML = '';
  for (const [key, label] of STAGES) {
    const group = document.createElement('optgroup'); group.label = label;
    for (const p of items.filter((it) => stageOf(it) === key)) group.append(new Option(p.id === 'none' ? 'None — numbers only' : p.name, p.id));
    if (group.children.length) sel.append(group);
  }
  sel.value = settings.scenery;
}
$('sceneCards').addEventListener('click', (e) => {
  const card = e.target.closest('.rcard');
  if (card) setScenery(card.dataset.id);
});
$('sceneSelect').addEventListener('change', (e) => setScenery(e.target.value));
/** A city with a ride network as scenery (F37): its free ride over the whole network (its own copy, not the route list's). */
const sceneryFreeItem = (item) => {
  const free = item?.network && netItems.find((n) => n.baseId === item.id && n.free);
  return free ? { ...free, id: `scenery-${free.id}` } : null;
};
async function sceneryRoute() {
  const item = sceneryItem();
  if (!item) return null;
  const free = sceneryFreeItem(item);
  if (free) { try { return await loadRouteItem(free); } catch (err) { log('app', `Scenery: ${err.message} — riding the ${item.name} loop`, 'error'); } }
  try { return await loadRouteItem(item); } catch { return null; }
}

export {
  pvLayout, fact, renderPreview, previewManifest, loadPreviewManifest, renderCityShots, groupedCards, watchMore,
  loadIdeas, watchIdeas, renderScenery, sceneryRoute,
};
