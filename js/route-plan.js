// Route selector: where along a route a ride starts, and how far it goes (by time, distance or climbing).
// Pure functions, unit-tested in Node (test/route-plan.test.mjs).
//
// Positions are in the app's route frame: every route is ridden there and back, [0, turn] the way out
// and [turn, total] the way back, so "Reverse" is simply starting on the way back. A start is a leg
// (reverse or not) plus an offset in metres from the beginning of that leg, in the riding direction.
import { haversine, routeAt, wrapDist, finishDistanceM } from './gpx.js';
import { stepSpeed, DEFAULTS } from './physics.js';

const STEP_M = 10;

/** Length of one leg (the way out). */
export const legLength = (route) => route.turnS || route.total;

/** Route position of a start: the way out (or the way back if reverse), offsetM along it. */
export function startPosition(route, { reverse = false, offsetM = 0 } = {}) {
  const leg = legLength(route);
  const off = Math.max(0, Math.min(leg - STEP_M, Math.round((Number(offsetM) || 0) / STEP_M) * STEP_M));
  return ((reverse ? leg : 0) + off) % route.total;
}

/**
 * Named stops along the way out: the nearest point on the outbound leg to each [lat, lon] in `pois`
 * ({ name: [lat, lon] }), kept when it's within maxM of the road. Sorted by distance along the leg.
 */
export function findStops(route, pois, { maxM = 400 } = {}) {
  const leg = legLength(route);
  const n = Math.min(route.lat.length - 1, Math.round(leg / STEP_M));
  const stops = [];
  for (const [name, at] of Object.entries(pois || {})) {
    const [lat, lon] = Array.isArray(at) ? at : [at?.lat, at?.lon];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    let best = Infinity, bi = 0;
    for (let i = 0; i <= n; i++) {
      const d = haversine({ lat, lon }, { lat: route.lat[i], lon: route.lon[i] });
      if (d < best) { best = d; bi = i; }
    }
    if (best <= maxM) stops.push({ name, atM: bi * STEP_M });
  }
  return stops.sort((a, b) => a.atM - b.atM);
}

/** Stops in riding order for a direction, each with its offset from the start of that leg. */
export function stopsForDirection(route, stops, reverse) {
  const leg = legLength(route);
  const list = (stops || []).map((s) => ({ ...s, offsetM: reverse ? leg - s.atM : s.atM }))
    .filter((s) => s.offsetM >= 0 && s.offsetM < leg - STEP_M);
  return list.sort((a, b) => a.offsetM - b.offsetM);
}

/** The stop nearest a route position (either leg), if it's within maxM along the road. */
export function stopNear(route, stops, posM, maxM = 600) {
  const leg = legLength(route);
  const x = wrapDist(route, posM);
  const out = x <= leg ? x : route.total - x;   // the way back retraces the way out
  let best = null;
  for (const s of stops || []) {
    const d = Math.abs(s.atM - out);
    if (d <= maxM && (!best || d < best.d)) best = { ...s, d };
  }
  return best;
}

/**
 * Ride the route from startM at a steady power on the same road physics as the session, until one of
 * the limits is reached. Returns the distance, moving time and climbing.
 * limits: { distM, timeS, climbM } (any of them), maxM caps the distance (e.g. the finish line); v0 the
 * speed at the start (m/s; 0 from a standstill).
 */
export function simulateRide(route, startM, { watts = 150, params = DEFAULTS, distM = Infinity, timeS = Infinity, climbM = Infinity, maxM = Infinity, v0 = 4 } = {}) {
  const cap = Math.min(distM, maxM, route.closed ? 500000 : route.total - startM);   // 500 km is plenty
  const W = Math.max(30, watts);
  let d = 0, t = 0, climb = 0, v = v0;
  let lastEle = routeAt(route, startM).ele;
  const dt = 0.5;
  while (d < cap && t < timeS && climb < climbM && t < 48 * 3600) {
    const grade = routeAt(route, startM + d).grade;
    v = stepSpeed(v, W, grade, Math.min(dt, timeS - t), params);
    const step = Math.min(v * Math.min(dt, timeS - t), cap - d);
    d += step;
    t += v > 0.05 ? step / v : Math.min(dt, timeS - t);
    const ele = routeAt(route, startM + d).ele;
    if (ele > lastEle) climb += ele - lastEle;
    lastEle = ele;
  }
  return { distM: d, timeS: t, climbM: climb };
}

/**
 * Plan a ride from a start: how far it goes for a length goal, and where it ends.
 * length: { mode: 'open' | 'time' | 'dist' | 'climb', value } (value: minutes, metres, metres of climbing).
 * pointToPoint + stopAtEnd: the finish line caps the ride. Returns
 *   { distM, timeS, climbM, endM, capped } — distM null when the ride is open-ended.
 */
export function planRide(route, startM, length, { watts, params, pointToPoint = false, stopAtEnd = true } = {}) {
  const toFinish = pointToPoint && stopAtEnd ? finishDistanceM(route, startM) : Infinity;
  const mode = length?.mode || 'open';
  const value = Number(length?.value) || 0;
  if (mode === 'open' && !Number.isFinite(toFinish)) return { distM: null, timeS: null, climbM: null, endM: null, capped: false };
  const limits = mode === 'time' ? { timeS: value * 60 } : mode === 'dist' ? { distM: value } : mode === 'climb' ? { climbM: value } : {};
  const sim = simulateRide(route, startM, { watts, params, ...limits, maxM: toFinish });
  const capped = mode !== 'open' && Number.isFinite(toFinish) && sim.distM >= toFinish - 1;
  return { ...sim, endM: startM + sim.distM, capped };
}

/** Where the START arch stands: about ten seconds of easy pedalling from a standstill (on the road's own
 *  grades), kept between 15 and 60 m and short of a finish that's closer than that. */
export function startArchM(route, startM, { params = DEFAULTS, finishM = null, seconds = 10, watts = 90 } = {}) {
  const roll = simulateRide(route, startM, { watts, params, timeS: seconds, v0: 0 }).distM;
  let d = Math.max(15, Math.min(60, roll));
  if (finishM != null) d = Math.min(d, finishM * 0.5);
  return startM + d;
}
