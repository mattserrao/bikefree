// The main menu's route list: the catalog, the road-graph cities, goal filters and the route cards.
// (Part of the app: js/app.js imports every module in js/app/.)
import { saveSettings } from '../settings.js';
import * as store from '../store.js';
import { drawWorkout, drawTrace } from '../views.js';
import { groupCityItems, cityCardsFirst, defaultRouteId, citySubline, shortName } from '../city-routes.js';
import { $, log, settings, fmtDist, distUnit, fmtElev, elevUnit, escapeHtml } from './core.js';
import { lapView } from './route-options.js';
import { loadPreviewManifest, groupedCards, watchMore, loadIdeas, watchIdeas, renderScenery } from './preview.js';
import { drawCityThumb, openCity, renderCity, renderCityMap } from './city-panel.js';
import { loadRouteItem, previewSelectedRoute } from './route-loading.js';
import { workoutCache } from './workouts-ui.js';

// ---------- Routes ----------
// Demo Hills is an invented test loop: its hills don't exist in the real terrain where it's placed,
// so it gets stylized scenery that shapes itself around the road (and no real horizon).
const DEMO_ROUTE = { id: 'builtin-demo-hills', kind: 'route', name: 'Demo Hills (built-in)', url: 'routes/demo-hills.gpx', scene: 'routes/scenes/demo-hills.json', group: 'Other' };
// [endless] the endless map (js/endless/course.js, js/world/endless-world.js): a world generated as you ride, six biomes in a
// seeded sequence; every mile choose flat, rolling, climb or descend with ◀ ▶
const ENDLESS_ROUTE = { id: 'builtin-endless', routeId: 'endless', kind: 'route', name: 'Endless', park: 'Six biomes · choose the terrain every mile', group: 'Scenic routes — 3D',
  endless: true, free: true, stage: 'production', tags: ['varied'], note: 'A world without end: farmland, northern forest and lakes, alpine mountains, the coast, desert canyons and arctic tundra' };
let routeItems = [];
let parkItems = null;
let netItems = [];          // network presets (choose your turns): listed as routes, not as scenery
// [pgh] free-ride road graphs (tools/build_pgh.py → js/graph.js, js/world/graph-world.js): every street, trail and
// bridge. Each city is one card, its routes and free ride in the card's panel. The cities and their card thumbnails come
// from routes/cities/index.json (tools/build_routes.mjs from graph-cities.json), so adding one needs no code change.
let graphCities = [];   // [{id, name, park, note, thumb}]
const graphBase = (id) => `builtin-graph-${id}`;
const graphCityOf = (baseId) => graphCities.find((c) => graphBase(c.id) === baseId);
const graphItem = (c) => ({ id: graphBase(c.id), routeId: `${c.id}-free`, kind: 'route', name: `${c.name} · Free ride`, park: c.park, baseId: graphBase(c.id),
  group: 'Scenic routes — 3D', network: `routes/cities/${c.id}.json`, graph: true, free: true, tags: ['varied'], note: c.note, ...(c.stage ? { stage: c.stage } : {}) });
const routeCache = new Map();
let selectedRouteId = null;
const setSelectedRouteId = (id) => { selectedRouteId = id; };
/** Forget the route list (a route added or removed): the next refreshRouteList builds it again. */
function resetRouteList() { parkItems = null; netItems = []; }

async function loadParks() {
  if (parkItems) return parkItems;
  const manifest = loadPreviewManifest();   // (alongside the catalog, not before it: PLAN 7.11)
  const cities = graphCities.length ? null : fetch('routes/cities/index.json').then((r) => r.json()).then((j) => { graphCities = j.cities || []; }).catch((err) => log('app', `Could not load the city maps: ${err.message}`, 'error'));
  try {
    const list = await (await fetch('routes/parks/index.json')).json();
    // (retired: the old Pittsburgh map — PGH replaces it. Its files stay for PGH's build tools, the QC tools and the tests)
    parkItems = list.filter((p) => !p.retired && !p.area).map((p) => ({ ...p, routeId: p.id, id: `builtin-park-${p.id}`, kind: 'route', url: p.file, group: 'Scenic routes — 3D' }));
  } catch {
    parkItems = [];
  }
  await cities;
  // the road-graph cities (PGH, CNY, SKAN): their free ride, their routes (tools/pgh_routes.mjs [--city <id>]: a few laid
  // out on the graph itself) and your own (from the map planner, kept in settings by segment names so they survive a
  // rebuilt graph). The graph itself loads only when the city's panel opens or one of its routes is picked.
  // A route mapped from elsewhere that follows its original less than 90 % of the way stays in Rough Drafts, marked approximate.
  netItems = [];
  await Promise.all(graphCities.map(async (c) => {
    const network = `routes/cities/${c.id}.json`, baseId = graphBase(c.id);
    const mine = [graphItem(c)];
    try {
      const list = await (await fetch(`routes/cities/${c.id}-presets.json`)).json();
      for (const pr of list) {
        const good = pr.followPct == null || pr.followPct >= 90;
        mine.push({ id: `builtin-graph-${pr.id}`, routeId: pr.id, kind: 'route', name: `${c.name} · ${pr.name}${good ? '' : ' (approximate)'}`, park: c.park, baseId,
          group: 'Scenic routes — 3D', ...(good ? {} : { stage: 'draft' }), network, graph: true, preset: pr.id, tags: pr.tags || [],
          note: (good ? '' : `Approximate: follows ${pr.followPct}% of the original route (${c.name} lacks some of its roads). `) + (pr.note || ''), lengthM: pr.lengthM, climbM: pr.climbM });
      }
    } catch { /* (no routes for this city yet) */ }
    for (const m of (settings.netRoutes || []).filter((x) => x.network === network)) {
      mine.push({ id: m.id, routeId: m.id, kind: 'route', name: `${c.name} · ${m.name}`, park: c.park, baseId, group: 'Scenic routes — 3D', network, graph: true,
        custom: true, keys: m.keys, tags: [], note: 'Your own route' });
    }
    netItems.push(...mine);
  }));
  // (in the cities' order, whichever loaded first)
  const order = new Map(graphCities.map((c, i) => [graphBase(c.id), i]));
  netItems.sort((x, y) => order.get(x.baseId) - order.get(y.baseId));
  await manifest;
  return parkItems;
}

async function refreshRouteList(selectId) {
  const [library, parks] = await Promise.all([store.listLibrary('route').catch(() => []), loadParks(), loadIdeas()]);
  const mine = library.map((r) => ({ ...r, group: 'My routes' }));
  // a city loop with a network is listed as its presets (the loop itself is one of them); it stays a scenery choice
  routeItems = [ENDLESS_ROUTE, ...parks, ...netItems, ...mine];   // (Demo Hills off the list — user, 25 Nov: "The other maps should be removed"; its files stay for the tests)
  if (selectId || !routeItems.some((r) => r.id === selectedRouteId)) selectedRouteId = selectId || defaultRouteId(routeItems);
  // The list shows straight from the catalog (PLAN 7.11): a park's numbers and outline are baked into it
  // (tools/build_routes.mjs), so no GPX or scenery is fetched first. Scenery loads when a ride starts (openWorld).
  renderRouteCards();
  renderScenery();
  // then, in the background: your own routes and the demo (no catalog numbers); a park's GPX only when it's previewed
  routesLoaded = Promise.all(routeItems.filter((it) => !it.stats && !it.baseId && !it.graph).map((it) => loadRouteItem(it).catch(() => null)))
    .then(() => { routesLoadedYet = true; renderRouteCards(); renderScenery(); if ($('cityDlg').open) { renderCity(); renderCityMap(); } });
  await previewSelectedRoute();
}
let routesLoaded = Promise.resolve(), routesLoadedYet = false;
/** A route's numbers for its card and goal tags: the loaded route, else the catalog's (the same fields). */
const routeStats = (it) => routeCache.get(it.id) || it.stats || null;
const outlines = new Map();
/** A card thumbnail's line: the loaded route's lap, else the catalog's outline (the way out). */
function routeOutline(it) {
  const r = it && routeCache.get(it.id);
  if (r) return lapView(r);
  if (!it?.outline) return null;
  if (!outlines.has(it.id)) outlines.set(it.id, { lat: it.outline.map((p) => p[0]), lon: it.outline.map((p) => p[1]) });
  return outlines.get(it.id);
}

// Ride goals: a filter over the route list. A network preset says its own (varied, new areas…); every route
// also gets flat / hilly from its climbing per km and short / long from its length (one lap or one way).
const GOALS = [['all', 'All'], ['flat', 'Flat'], ['hilly', 'Hilly'], ['short', 'Short'], ['long', 'Long'], ['varied', 'Varied'], ['new', 'New areas']];
function goalTags(it) {
  const r = routeStats(it);
  const km = r ? (r.lapM || (r.stageRoute ? r.turnS : r.turnS || r.total)) / 1000 : it.km;
  const climb = r ? (r.lapClimbM ?? (r.oneWay?.ascent ?? r.ascent)) : it.climbM;
  const tags = new Set(it.tags || []);
  if (it.free) return GOALS.map(([k]) => k).filter((k) => tags.has(k));   // a free ride is what you make it
  if (km > 0 && climb != null) {
    const perKm = climb / km;
    if (!tags.has('hilly') && perKm < 6) tags.add('flat');
    if (!tags.has('flat') && perKm >= 12) tags.add('hilly');
    if (!tags.has('long') && km < 15) tags.add('short');
    if (!tags.has('short') && km >= 30) tags.add('long');
  }
  return GOALS.map(([k]) => k).filter((k) => tags.has(k));
}
let routeGoal = GOALS.some(([k]) => k === settings.routeGoal) ? settings.routeGoal : 'all';
// (a small "Show" dropdown in the Routes heading, menu-simplify-test; the city panels keep their chip row)
function renderGoalSeg() {
  $('goalSel').innerHTML = GOALS.map(([k, label]) => `<option value="${k}">${k === 'all' ? 'All routes' : label}</option>`).join('');
  $('goalSel').value = routeGoal;
}
$('goalSel').addEventListener('change', (e) => {
  routeGoal = e.target.value;
  settings.routeGoal = routeGoal;
  saveSettings(settings);
  renderRouteCards();
});

// A city with a ride network (Pittsburgh) is one card: its presets, free ride and your own routes are in its panel.
let routeCards = [];   // routeItems with each city's items folded into one card (js/city-routes.js)
const CHEVRON = '<svg class="ic chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';
function renderRouteCards() {
  renderGoalSeg();
  routeCards = groupCityItems(routeItems);
  const label = Object.fromEntries(GOALS);
  const matches = (it) => goalTags(it).includes(routeGoal);
  // a city shows while any of its routes (or its free ride) suits the goal
  const shown = routeGoal === 'all' ? routeCards : routeCards.filter((it) => (it.city ? [...it.routes, ...(it.free ? [it.free] : [])].some(matches) : matches(it)));
  // the city (Pittsburgh) at the very top, above every park and outside the stage groups (PLAN 6.9)
  const { top, rest } = cityCardsFirst(shown);
  const card = (it) => {
    if (it.city) {
      const n = routeGoal === 'all' ? it.routes.length : it.routes.filter(matches).length;
      let sub = citySubline(it, 0);
      if (routeGoal !== 'all') sub = sub.replace(/\d+ routes?/, `${n} ${label[routeGoal].toLowerCase()} route${n === 1 ? '' : 's'}`);
      if (it.mine.length) sub += ` · ${it.mine.length} yours`;
      const sel = [...it.routes, it.free].find((x) => x?.id === selectedRouteId);
      return `<button class="rcard city-card ${sel ? 'on' : ''}" data-city="${escapeHtml(it.baseId)}" aria-haspopup="dialog"><canvas></canvas>
        <div class="city-text"><b>${escapeHtml(it.name)}</b><div class="rsub">${escapeHtml(sub)}</div>${sel ? `<div class="rsel">Selected · ${escapeHtml(shortName(sel.name))}</div>` : '<div class="rsel muted">Pick a route on the map</div>'}</div>${CHEVRON}</button>`;
    }
    const r = routeStats(it);
    const sub = !r ? (it.graph ? (it.preset ? `${fmtDist(it.lengthM, 1)} ${distUnit()} · ${fmtElev(it.climbM).toLocaleString()} ${elevUnit()} · choose your turns` : 'every street, trail and bridge · free ride') : routesLoadedYet ? 'Could not load' : '…') : r.stageRoute && r.oneWay
      ? `${fmtDist(r.turnS, 1)} ${distUnit()} to the finish · ${fmtElev(r.oneWay.ascent).toLocaleString()} ${elevUnit()}`
      : r.free ? `${r.network.nodes.size} junctions · choose every turn`
      : r.netRide ? `${fmtDist(r.lapM, 1)} ${distUnit()} ${r.netOpen ? 'one way' : 'loop'} · ${fmtElev(r.lapClimbM).toLocaleString()} ${elevUnit()} · choose your turns`
      : `${fmtDist(r.turnS || r.total, 1)} ${distUnit()} each way · ${fmtElev(r.ascent).toLocaleString()} ${elevUnit()}`;
    const tags = goalTags(it);
    return `<button class="rcard ${it.id === selectedRouteId ? 'on' : ''}" data-id="${it.id}"><canvas></canvas>
      <div><b>${escapeHtml(it.name.replace(' (built-in)', ''))}</b><div class="rsub">${escapeHtml(it.park || it.group)} · ${sub}</div>${tags.length ? `<div class="rtags">${tags.map((t) => `<span>${label[t]}</span>`).join('')}</div>` : ''}</div></button>`;
  };
  $('routeCards').innerHTML = (shown.length ? '' : '<p class="muted">No routes for that goal yet.</p>') + groupedCards([...top, ...rest], card, selectedRouteId)   /* (the city cards first in their section: Production or In Progress) */;
  watchIdeas($('routeCards')); watchMore($('routeCards'));
  drawThumbs();
}

// Card thumbnails need a laid-out canvas, so draw them whenever their pane is visible.
function drawThumbs() {
  for (const c of document.querySelectorAll('#routeCards canvas, #sceneCards canvas')) {
    if (!c.clientWidth) continue;
    const cityId = c.closest('.rcard').dataset.city;
    if (cityId) { drawCityThumb(c, routeCards.find((x) => x.city && x.baseId === cityId)); continue; }
    const id = c.closest('.rcard').dataset.id;
    const r = routeOutline(routeItems.find((x) => x.id === id) || parkItems?.find((x) => x.id === id));
    if (r) drawTrace(c, r, 0);
  }
  for (const c of document.querySelectorAll('#workoutList canvas')) {
    const w = workoutCache.get(c.closest('.wrow').dataset.id);
    if (w && c.clientWidth) drawWorkout(c, w, 0, settings.ftp, 1, { compact: true });
  }
}
$('routeCards').addEventListener('click', (e) => {
  const card = e.target.closest('.rcard');
  if (!card) return;
  if (card.dataset.city) { openCity(card.dataset.city); return; }
  selectedRouteId = card.dataset.id;
  for (const c of $('routeCards').querySelectorAll('.rcard')) c.classList.toggle('on', c === card);
  previewSelectedRoute();
});

export {
  routeItems, parkItems, netItems, graphCityOf, routeCache, selectedRouteId, setSelectedRouteId, resetRouteList,
  refreshRouteList, routesLoaded, routeOutline, GOALS, goalTags, routeGoal, routeCards, renderRouteCards,
  drawThumbs,
};
