// Loading a route from the list (a park's GPX, a road graph and its presets) and the menu's preview of it.
// (Part of the app: js/app.js imports every module in js/app/.)
import { buildCatalogRoute } from '../routes.js';
import { loadNetwork, makePathRoute, keysToIds } from '../network.js';
import { $, log, session } from './core.js';
import { renderPreview } from './preview.js';
import { courseMarks, world } from './ride-screen.js';
import { routeItems, graphCityOf, routeCache, selectedRouteId } from './routes-menu.js';
import { renderOffline } from './offline-ui.js';

// ---------- Route loading ----------
let previewRoute = null;   // the route the menu's preview shows
// Loads in flight, by item id / network URL: the city's ~40 routes load together, and each used to fetch and parse
// the city loop, its scenery and all 11 areas' GPX again (and build the network again) — 600+ requests before the
// list showed (PLAN 7.11). Now each is fetched and built once.
const routeLoads = new Map();
function loadRouteItem(item) {
  if (routeCache.has(item.id)) return Promise.resolve(routeCache.get(item.id));
  if (!routeLoads.has(item.id)) routeLoads.set(item.id, loadRouteItemNow(item).finally(() => routeLoads.delete(item.id)));
  return routeLoads.get(item.id);
}
const graphNets = new Map();   // [pgh] a road graph's network by URL: its free ride and its routes share one
const graphNetsDone = new Map(), graphMaps = new Map(), graphMapLabels = new Map();   // (loaded: for the city card's map, which draws synchronously)
function graphNet(url, name) {
  if (!graphNets.has(url)) {
    graphNets.set(url, Promise.all([fetch(url).then((r) => r.json()), import('../graph.js')]).then(([json, { graphNetwork }]) => {
      const { base, network } = graphNetwork(json, { name });
      const net = loadNetwork(network, base);
      graphNetsDone.set(url, net); if (json.map) graphMaps.set(url, json.map); if (json.mapLabels) graphMapLabels.set(url, json.mapLabels);
      return net;
    }).catch((err) => { graphNets.delete(url); throw err; }));
  }
  return graphNets.get(url);
}
async function loadRouteItemNow(item) {
  if (item.graph) {
    // [pgh] a free-ride road graph (js/graph.js): every edge on a synthetic base line, ridden by the network machinery;
    // its routes (laid out on it: tools/pgh_routes.mjs) are presets of the same network
    const cityName = graphCityOf(item.baseId)?.name || 'PGH';
    const net = await graphNet(item.network, cityName);
    let preset = item.preset ? (net.json.presets || []).find((x) => x.id === item.preset) : null;
    if (item.preset && !preset) throw new Error(`${item.name} is not in the ${cityName} map any more`);
    if (item.custom) {
      // your own route from the map planner (kept by segment names)
      const path = keysToIds(net, item.keys);
      if (!path) throw new Error(`${item.name} uses roads the ${cityName} map no longer has — plan it again`);
      preset = { id: item.routeId, name: item.name, path };
    }
    const route = makePathRoute(net, preset ? { ...preset, id: item.routeId } : { id: item.routeId, name: item.name, path: null, first: net.json.freeRide.first },
      { id: item.routeId, name: item.name, park: item.park });
    route.note = item.note || '';
    route.scene = null;
    route.graph = true;
    if (!preset) route.stops = route.stops.slice(0, 8);   // (a free ride over a whole city: its first few junctions as start points, not hundreds)
    route.netRide.addEventListener('change', () => { if (session.route === route && world?.path === route.netRide) world.setCourseMarks(courseMarks()); });
    routeCache.set(item.id, route);
    return route;
  }
  const text = item.text ?? await (await fetch(item.url)).text();
  const route = buildCatalogRoute(text, item);
  route.sourceFile = item.file;
  // (its scenery — MBs of city, terrain and places data — loads when a ride starts: openWorld, PLAN 7.11)
  routeCache.set(item.id, route);
  return route;
}

async function previewSelectedRoute() {
  const item = routeItems.find((r) => r.id === selectedRouteId);
  $('routeDelete').hidden = !item || item.id.startsWith('builtin');
  $('routeOffline').hidden = !item?.park;
  if (!item) return;
  try {
    previewRoute = await loadRouteItem(item);
    // a network route not being ridden: show its plan, not the turns chosen on the last ride
    if (previewRoute.netRide && session.route !== previewRoute) previewRoute.netRide.reset();
  } catch (err) {
    previewRoute = null;
    log('app', `Could not load route: ${err.message}`, 'error');
    return;
  }
  renderOffline();
  renderPreview();
}

const closeMenus = () => { for (const d of document.querySelectorAll('details.more')) d.open = false; };
document.addEventListener('click', (e) => { if (!e.target.closest('details.more')) closeMenus(); });

export { previewRoute, loadRouteItem, graphNetsDone, graphMaps, graphMapLabels, graphNet, previewSelectedRoute, closeMenus };
