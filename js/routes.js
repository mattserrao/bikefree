// Shared route loading for the app, previews and build tools.
import { parseGpx, buildRoute, wrapDist } from './gpx.js';

// Never sample across the overlapping legs at a U-turn or start/finish.
export function headingSpan(route, distance, look = 6) {
  const x = wrapDist(route, distance);
  if (route.turnS) {
    const start = x <= route.turnS ? 0 : route.turnS;
    const end = x <= route.turnS ? route.turnS : route.total;
    return [Math.max(start, x - look), Math.min(end, x + look)];
  }
  return route.closed ? [x - look, x + look] : [Math.max(0, x - look), Math.min(route.total, x + look)];
}

export function buildCatalogRoute(text, item = {}) {
  const parsed = parseGpx(text);
  const route = buildRoute({ ...parsed, name: item.name?.replace(' (built-in)', '') || parsed.name });
  route.id = item.routeId || item.id || null;
  route.park = item.park || null;
  route.sceneUrl = item.scene || null;
  if (item.outAndBack) {
    route.outAndBack = true;
    route.turnIdx = Math.floor((route.dist.length - 1) / 2);
    route.turnS = route.dist[route.turnIdx];
  }
  return route;
}

export async function loadRouteScene(route, fetcher = fetch) {
  if (!route.sceneUrl || route.scene) return route;
  const response = await fetcher(new URL(`../${route.sceneUrl}`, import.meta.url));
  if (!response.ok) throw new Error(`Scenery could not load (${response.status})`);
  const scene = await response.json();
  if (scene.format !== 'bikefree-scene-1') throw new Error('Unsupported scenery format');
  route.scene = scene;
  return route;
}
