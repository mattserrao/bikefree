// A network of areas (PLAN 5.4) on a small two-area fixture: edges on their own area's line, a portal on both,
// aprons mapped both ways, the area drawn as the path crosses the portal (swap inside an apron, poses on the area
// drawn: no jump, road under the rider), and the rest of the ride (prompt, laps, minimap, pacer) unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogRoute } from '../js/routes.js';
import { haversine } from '../js/gpx.js';
import { makeProjection, makeRouteIndex } from '../js/world/geo.js';
import { ghostAt } from '../js/world/ghost.js';
import { loadNetwork, areaS, NetRide, PathFollower, makePathRoute, edgeLines, keysToIds, optionsAt, SWAP_AHEAD_M } from '../js/network.js';

// The fixture, in metres east (x) and north (y) of the origin: an east-west street through the portal P (0, 0) and
// a street north from P to N.
//   west area: W (−2000, 0) → P (edge W>P), then on 400 m east (its apron on P>E)
//   east area: 400 m west of P (its apron on W>P) → P → N (edge P>N, 1500 m north) → back to P (a ghost) → E (edge P>E)
const ORIGIN = { lat: 40.44, lon: -80.0 };
const K = 6371008.8 * Math.PI / 180, KX = K * Math.cos(ORIGIN.lat * Math.PI / 180);
const ll = (x, y) => ({ lat: ORIGIN.lat + y / K, lon: ORIGIN.lon + x / KX });
function gpx(corners, ele) {
  const pts = [];
  for (let k = 1; k < corners.length; k++) {
    const [a, b] = [corners[k - 1], corners[k]], n = Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 10);
    for (let i = k === 1 ? 0 : 1; i <= n; i++) pts.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
  }
  const rows = pts.map(([x, y]) => { const p = ll(x, y); return `<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}"><ele>${ele(x, y).toFixed(2)}</ele></trkpt>`; });
  return `<?xml version="1.0"?><gpx><trk><name>fixture</name><trkseg>${rows.join('')}</trkseg></trk></gpx>`;
}
const height = (x, y) => 200 + Math.max(0, y) * 0.02;   // flat, but for a 2 % climb north to N
const west = buildCatalogRoute(gpx([[-2000, 0], [400, 0]], height), { id: 'fx-west', eleSmoothM: 0 });
const east = buildCatalogRoute(gpx([[-400, 0], [0, 0], [0, 1500], [0, 0], [2000, 0]], height), { id: 'fx-east', eleSmoothM: 0 });
east.scene = { city: { routeGhosts: [{ fromM: 1900, toM: 3400 }] } };
const json = {
  format: 'bikefree-network-2', id: 'fixture', origin: ORIGIN,
  areas: [
    { id: 'west', catalogId: 'fx-west', legM: 2400, aprons: [{ edge: 'e3', dir: 1, s: [2000, 2400], u0: 0 }] },
    { id: 'east', catalogId: 'fx-east', legM: 5400, ghosts: [{ fromM: 1900, toM: 3400 }], aprons: [{ edge: 'e1', dir: 1, s: [0, 400], u0: 1600 }] },
  ],
  nodes: [
    { id: 'W', name: 'West end', passes: { west: [0] }, deadEnd: true },
    { id: 'P', name: 'The portal', passes: { west: [2000], east: [400, 3400] }, portal: true },
    { id: 'N', name: 'North end', passes: { east: [1900] }, deadEnd: true },
    { id: 'E', name: 'East end', passes: { east: [5400] }, deadEnd: true },
  ],
  edges: [
    { id: 'e1', key: 'W>P', area: 'west', from: 'W', to: 'P', s: [0, 2000], lengthM: 2000, climbM: [0, 0], name: 'West street', toward: ['east to the portal', 'west'] },
    { id: 'e2', key: 'P>N', area: 'east', from: 'P', to: 'N', s: [400, 1900], lengthM: 1500, climbM: [30, 0], name: 'North street', toward: ['north', 'south to the portal'] },
    { id: 'e3', key: 'P>E', area: 'east', from: 'P', to: 'E', s: [3400, 5400], lengthM: 2000, climbM: [0, 0], name: 'East street', toward: ['east', 'west to the portal'] },
  ],
  presets: [
    { id: 'across', name: 'West to east and back', path: ['e1+', 'e3+', 'e3-', 'e1-'], lengthM: 8000, climbM: 0 },
    { id: 'north', name: 'West to north and back', path: ['e1+', 'e2+', 'e2-', 'e1-'], lengthM: 7000, climbM: 30 },
  ],
};
const net = loadNetwork(json, new Map([['west', west], ['east', east]]));
const proj = makeProjection(ORIGIN.lat, ORIGIN.lon);
const indexes = new Map([['west', makeRouteIndex(west, proj)], ['east', makeRouteIndex(east, proj)]]);
const indexOf = (id) => indexes.get(id);
const edge = (key) => [...net.edges.values()].find((e) => e.key === key);
const t = (key, dir = 1) => ({ e: edge(key), dir });

test('areas: the network loads with its areas, a portal on both lines and the aprons', () => {
  assert.equal(net.multi, true);
  assert.deepEqual([...net.areas.keys()], ['west', 'east']);
  assert.equal(edge('W>P').A.base, west);
  assert.equal(edge('P>E').A.base, east);
  // the portal is the same place on both lines
  const pw = west.lat.length && { lat: west.lat[200], lon: west.lon[200] }, pe = { lat: east.lat[40], lon: east.lon[40] };
  assert.ok(haversine(pw, pe) < 0.5, `${haversine(pw, pe)}`);
  assert.equal(net.areas.get('west').aprons.length, 1);
  // a network-1 still loads as one area
  assert.throws(() => loadNetwork({ ...json, areas: json.areas.slice(0, 1) }, new Map([['west', west]])), /edge e2: no area east/);
});

test('areas: a place on an edge maps onto every area that covers it (own line, apron, either way)', () => {
  assert.equal(areaS(net, 'west', t('W>P'), 1800), 1800);
  assert.equal(areaS(net, 'east', t('W>P'), 1800), 200);             // the east line's apron
  assert.equal(areaS(net, 'east', t('W>P'), 1500), null);            // beyond the apron
  assert.equal(areaS(net, 'east', t('W>P', -1), 200), east.total - 200);   // riding west: the mirrored return
  assert.equal(areaS(net, 'west', t('P>E'), 300), 2300);
  assert.equal(areaS(net, 'west', t('P>N'), 10), null);              // the west line has no apron north
  // the same metre on two lines is the same place (one frame for the city)
  for (const [k, u, a] of [['W>P', 1700, 'east'], ['P>E', 250, 'west'], ['W>P', 1950, 'east']]) {
    const own = t(k), s1 = areaS(net, own.e.area, own, u), s2 = areaS(net, a, own, u);
    const A = net.areas.get(own.e.area).base, B = net.areas.get(a).base;
    const pA = indexOf(own.e.area), pB = indexOf(a);
    assert.ok(Math.hypot(pA.xs[s1 / 10] - pB.xs[s2 / 10], pA.zs[s1 / 10] - pB.zs[s2 / 10]) < 0.5 && Math.abs(A.ele[s1 / 10] - B.ele[s2 / 10]) < 0.01);
  }
});

/** Ride a plan through the portal at 1 m steps as the world does: the area drawn, the pose on it. */
function ride(plan, from, to, start = 'west') {
  const r = new NetRide(net, {}, { plan });
  let area = start, prev = null, worst = 0;
  const swaps = [], under = [];
  for (let p = from; p <= to; p += 1) {
    const next = r.areaFor(p, area);
    if (next !== area) { swaps.push({ p, from: area, to: next }); area = next; }
    assert.ok(r.covers(area, p), `the area drawn (${area}) covers ${p}`);
    const at = r.worldAt(p, area);
    assert.equal(at.area, area);
    if (ghostAt(net.areas.get(area).base, at.s > net.areas.get(area).L ? net.areas.get(area).total - at.s : at.s)) under.push(p);
    const q = r.pose(p, indexOf, 0.22, area);
    if (prev) worst = Math.max(worst, Math.hypot(q.pos.x - prev.pos.x, q.pos.z - prev.pos.z, q.pos.y - prev.pos.y) - 1);
    prev = q;
  }
  return { r, swaps, worst, under };
}

test('areas: straight across the portal — one swap inside the apron, past the junction, no jump', () => {
  const { swaps, worst, under } = ride(['e1+', 'e3+', 'e3-', 'e1-'], 1000, 3500);
  assert.deepEqual(swaps.map((x) => [x.from, x.to]), [['west', 'east']]);
  assert.ok(Math.abs(swaps[0].p - (2000 + SWAP_AHEAD_M)) <= 2, `swap at ${swaps[0].p}`);   // 200 m past the portal, in the west's apron
  assert.ok(worst < 0.05, `pose jump ${worst} m`);
  assert.deepEqual(under, [], 'no ghost under the rider');
});

test('areas: back the other way — the east draws on into its apron, then the west', () => {
  const { swaps, worst } = ride(['e1+', 'e3+', 'e3-', 'e1-'], 4000, 7000, 'east');
  assert.deepEqual(swaps.map((x) => [x.from, x.to]), [['east', 'west']]);
  assert.ok(Math.abs(swaps[0].p - (6000 + SWAP_AHEAD_M)) <= 2, `swap at ${swaps[0].p}`);
  assert.ok(worst < 0.05, `pose jump ${worst} m`);
});

test('areas: a turn onto an edge the west line doesn\'t cover — the swap comes before the junction, in the east\'s apron', () => {
  const { r, swaps, worst } = ride(['e1+', 'e2+', 'e2-', 'e1-'], 1000, 3000);
  assert.deepEqual(swaps.map((x) => [x.from, x.to]), [['west', 'east']]);
  assert.ok(swaps[0].p > 1600 && swaps[0].p <= 2000 - SWAP_AHEAD_M + 2, `swap at ${swaps[0].p}`);
  assert.ok(worst < 0.3, `pose jump ${worst} m`);   // (a left turn's curve, 1 m steps)
  // the options as on one line; the east line itself turns north at P (its own corner), so the turn rides it
  // seamlessly there, as a single line's pass through a junction does
  const opts = optionsAt(net, r.entries[0].t);
  assert.deepEqual(opts.map((o) => o.label), ['Back', 'Left', 'Straight']);
  assert.equal(r._junction(1), null);
  // straight across from W>P onto P>E: the west line runs on into its apron but the east line doesn't (its P>E
  // starts after the ghost): a short pass curve, which on a straight street is straight
  assert.equal(new NetRide(net, {}, { plan: ['e1+', 'e3+', 'e3-', 'e1-'] })._junction(1).R, 6);
});

test('areas: the prompt, the lock and the laps don\'t notice the areas', () => {
  const route = makePathRoute(net, net.presets.find((p) => p.id === 'across'), { id: 'fx' });
  const r = route.netRide;
  assert.equal(route.lapM, 8000);
  const up = r.upcoming(1900);
  assert.equal(up.node.id, 'P');
  assert.equal(r.prompt(1900, 8).node.id, 'P');
  assert.equal(r.prompt(2150, 8), null);   // past the portal (and before the swap) nothing to choose until E
  assert.equal(r.upcoming(2150).node.id, 'E');
  assert.equal(r.lapAt(8100), 2);
  // the path route: samples from each edge's own line, continuous through the portal
  for (let i = 1; i < 800; i++) assert.ok(haversine({ lat: route.lat[i - 1], lon: route.lon[i - 1] }, { lat: route.lat[i], lon: route.lon[i] }) < 10.5, `sample ${i}`);
  assert.ok(Math.abs(route.ele[300] - 200) < 1e-9);
});

test('areas: minimap lines from each edge\'s own line; the pacer follows its own copy across; saved keys still map', () => {
  const lines = edgeLines(net);
  const wp = lines.find((l) => l.e.key === 'W>P'), pe = lines.find((l) => l.e.key === 'P>E');
  assert.ok(haversine({ lat: wp.lat.at(-1), lon: wp.lon.at(-1) }, { lat: pe.lat[0], lon: pe.lon[0] }) < 0.5);
  const route = makePathRoute(net, net.presets.find((p) => p.id === 'across'), { id: 'fx' });
  const pacer = new PathFollower(route.netRide);
  let prev = null;
  for (let p = 1500; p < 2600; p += 5) {
    pacer.update(p);
    const q = pacer.latLon(p);
    if (prev) assert.ok(haversine(prev, q) < 5.5);
    prev = q;
  }
  assert.deepEqual(keysToIds(net, ['W>P+', 'P>E+', 'P>E-', 'W>P-']), ['e1+', 'e3+', 'e3-', 'e1-']);
  // the areas the world keeps loaded: the drawn one, ahead 1.5 km and 600 m behind
  const r = route.netRide;
  assert.deepEqual([...r.areasNear(300)].sort(), ['west']);
  assert.deepEqual([...r.areasNear(800)].sort(), ['east', 'west']);
  assert.deepEqual([...r.areasNear(2700)].sort(), ['east']);
});
