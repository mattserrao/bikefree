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

/**
 * Every route rides there and back (v0.11.3): at either end the rider U-turns and heads the other way,
 * endlessly. A route that isn't already an out-and-back is mirrored into one (A → B → A; on a loop A is the
 * start/finish, so laps alternate direction). Samples stay exactly 10 m apart, as the rest of the app
 * assumes, so the far end is the last whole 10 m sample (at most 10 m short of the original end).
 */
export function mirrorRoute(r) {
  if (r.outAndBack) return r;
  const last = r.dist.length - 1;
  const K = Math.abs(r.dist[last] - last * 10) < 1e-6 ? last : last - 1;   // last sample on the 10 m grid
  if (K < 2) return r;
  const N = 2 * K + 1;
  const dist = new Float64Array(N), lat = new Float64Array(N), lon = new Float64Array(N), ele = new Float64Array(N), grade = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const src = i <= K ? i : 2 * K - i;
    dist[i] = i * 10; lat[i] = r.lat[src]; lon[i] = r.lon[src]; ele[i] = r.ele[src];
    grade[i] = i <= K ? r.grade[src] : -r.grade[src];
  }
  let ascent = 0, descent = 0;
  for (let i = 1; i < N; i++) { const d = ele[i] - ele[i - 1]; if (d > 0) ascent += d; else descent -= d; }
  return { ...r, dist, lat, lon, ele, grade, total: dist[N - 1], ascent, descent, closed: true,
    outAndBack: true, turnIdx: K, turnS: K * 10, mirrored: true, oneWay: { total: K * 10, closedLoop: !!r.closed } };
}

/** Where a ride starts along a there-and-back route: Forward from the start, or Reverse from the far end,
 *  then a fraction (0, ⅓, ⅔) of the way along in that direction. */
export function routeStartM(route, { reverse = false, fraction = 0 } = {}) {
  const leg = route.turnS || route.total;
  return ((reverse ? leg : 0) + Math.max(0, Math.min(1, fraction)) * leg) % route.total;
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
  return item.mirror === false ? route : mirrorRoute(route);
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
