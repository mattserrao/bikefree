// Ride networks (choose your turns): js/network.js on Pittsburgh's loop, and the session riding one.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makePathRoute, optionsAt, straightOn, cornerSpeed, LOCK_M, NetRide, PathFollower, FOLLOW_AHEAD_M } from '../js/network.js';
import { Session } from '../js/session.js';
import * as netMod from '../js/network.js';
import * as gpxMod from '../js/gpx.js';
import { loadCatalogNetwork, sweepTurns, checkPathRoutes } from '../tools/qc_network.mjs';

const index = JSON.parse(readFileSync(new URL('../routes/parks/index.json', import.meta.url), 'utf8'));
const item = index.find((r) => r.id === 'pittsburgh');
const { base, net, index: worldIndex } = loadCatalogNetwork(item);
const preset = (id) => net.presets.find((p) => p.id === id);
const keys = (ride, n = 4) => ride.entries.slice(0, n).map((x) => `${x.t.e.id}${x.t.dir > 0 ? '+' : '-'}`);


const edge = (key) => [...net.edges.values()].find((e) => e.key === key);
const len = (...keys) => keys.reduce((t, k) => t + edge(k).len, 0);
const gAt = len('A>B', 'B>E', 'E>F', 'F>G');   // East Carson & 10th, riding the Three Rivers Loop from the Water Steps

test('the network sits on its areas\' lines: edges on their 10 m samples, presets close up', () => {
  assert.equal(item.network, 'routes/cities/pittsburgh-network.json');
  assert.equal(net.L, base.turnS);
  // (a city of areas, PLAN 5.4) every area's line is its edges, its aprons (other areas' edges at its portals)
  // and its ghosts, once each; every edge of the city is on exactly one line
  for (const A of net.areas.values()) {
    const sum = [...net.edges.values()].filter((e) => e.area === A.id).reduce((t, e) => t + e.len, 0);
    const ghost = (A.json.ghosts || []).reduce((t, g) => t + g.toM - g.fromM, 0);
    const apron = A.aprons.reduce((t, ap) => t + ap.s1 - ap.s0, 0);
    assert.ok(Math.abs(sum + ghost + apron - A.L) < 30, `${A.id}: ${sum} + ${ghost} ghost + ${apron} apron vs ${A.L}`);
  }
  assert.equal([...net.edges.values()].reduce((t, e) => t + e.len, 0), 122510);   // the whole network: the one 58 km tour's 47.67 km, Polish Hill & Bloomfield's 7.16 km (PLAN 5.7), the GAP & Homestead's 14.48 km (PLAN 5.5), the North Side's 15.78 km (PLAN 5.8), the East End's 19.46 km (PLAN 5.10) and the South Side Slopes & the Dirty Dozen south's 17.96 km (PLAN 5.9)
  assert.deepEqual([...net.nodes.keys()].sort(), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'AL', 'EL', 'GV', 'HE', 'HP', 'LB', 'SQ', 'SY'].sort());
  const three = makePathRoute(net, preset('pgh-three-rivers'));
  const short = makePathRoute(net, preset('pgh-short-loop'));
  const jail = makePathRoute(net, preset('pgh-jail-trail'));
  assert.equal(three.lapM, len('A>B', 'B>E', 'E>F', 'F>G', 'G>Q', 'Q>H', 'H>G', 'G>GV', 'GV>D', 'D>C', 'C>R', 'R>A'));
  assert.ok(Math.abs(three.lapM - 18300) < 300, `${three.lapM}`);   // the loop as it always was
  assert.equal(short.lapM, len('A>B', 'B>E', 'E>F', 'F>G', 'G>GV', 'GV>D', 'D>C', 'C>R', 'R>A'));
  assert.equal(jail.lapM, len('E>I', 'I>S', 'S>H', 'H>G', 'E>F', 'F>G'));
  assert.ok(three.total > 140000 && short.total > 140000);   // the path runs far ahead for the planner
  for (let i = 0; i < three.dist.length; i += 997) assert.equal(three.dist[i], i * 10);
});

test('East Carson & 10th: back, left, straight and right, sorted left to right', () => {
  const ride = new NetRide(net, {}, { plan: preset('pgh-three-rivers').path });
  const opts = optionsAt(net, ride.entries[3].t);   // arriving eastbound on East Carson
  assert.deepEqual(opts.map((o) => o.label), ['Back', 'Left', 'Straight', 'Right']);
  assert.equal(straightOn(opts).t.e.key, 'G>Q');   // straight: East Carson on to 27th and SouthSide Works
  assert.equal(opts[3].t.e.key, 'G>GV');           // right: up McArdle to Mount Washington
  for (const o of opts) assert.ok(o.lengthM > 0 && o.climbM >= 0 && o.toward);
});

test('Smithfield & Fort Pitt and SouthSide Works: the Jail Trail joins the loop', () => {
  const ride = new NetRide(net, {}, { plan: preset('pgh-three-rivers').path });
  const atE = optionsAt(net, ride.entries[1].t);   // southbound on Smithfield, at Fort Pitt Blvd
  assert.ok(atE.some((o) => o.t.e.key === 'E>I' && o.t.dir > 0 && /left/i.test(o.label)), 'the Jail Trail is a left turn');
  assert.equal(straightOn(atE).t.e.key, 'E>F');   // straight on: the Smithfield Street Bridge
  const jail = new NetRide(net, {}, { plan: preset('pgh-jail-trail').path });
  assert.equal(net.nodes.get(jail.upcoming(10).node.id).id, 'I');
  assert.equal(jail.upcoming(10).options[jail.upcoming(10).selected].t.e.key, 'I>S');   // the plan: over the Hot Metal Bridge
  assert.ok(jail.upcoming(10).options.some((o) => o.t.e.key === 'I>L'), 'Junction Hollow and Oakland offered at the bridge');
});

test('the path follows the plan, takes your turn, then rejoins the plan', () => {
  const r = makePathRoute(net, preset('pgh-three-rivers'));
  const ride = r.netRide;
  const key = (k) => { const e = edge(k.slice(0, -1)); return `${e.id}${k.at(-1)}`; };
  assert.deepEqual(keys(ride, 5), ['A>B+', 'B>E+', 'E>F+', 'F>G+', 'G>Q+'].map(key));
  const p = gAt - 120;
  const up = ride.upcoming(p);
  assert.equal(up.node.id, 'G');
  assert.equal(up.options[up.selected].label, 'Straight');
  assert.equal(up.onPlan, true);
  assert.equal(ride.choose(+1, p), true);   // right: skip the South Side
  assert.deepEqual(keys(ride, 7), ['A>B+', 'B>E+', 'E>F+', 'F>G+', 'G>GV+', 'GV>D+', 'D>C+'].map(key));   // McArdle is on the plan too, so it rejoins
  assert.equal(ride.choose(+1, p), false);   // nothing further right
  // the session's path route now runs straight from East Carson onto McArdle
  const i = gAt / 10, sMcArdle = edge('G>GV').s0 / 10;
  assert.ok(Math.abs(r.ele[i + 1] - base.ele[sMcArdle + 1]) < 1e-9);
});

test('a choice locks close to the junction', () => {
  const r = makePathRoute(net, preset('pgh-three-rivers'));
  const p = gAt - LOCK_M + 1;
  r.netRide.update(p);
  assert.equal(r.netRide.upcoming(p).locked, true);
  assert.equal(r.netRide.choose(+1, p), false);
  assert.equal(r.netRide.entries[4].t.e.key, 'G>Q');
});

test('the prompt shows ~15 s out and never later than 120 m', () => {
  const r = makePathRoute(net, preset('pgh-three-rivers'));
  assert.equal(r.netRide.prompt(gAt - 200, 5), null);    // 5 m/s: 75 m of warning is too little, so 120 m
  assert.ok(r.netRide.prompt(gAt - 119, 5));
  assert.ok(r.netRide.prompt(gAt - 200, 14));            // 14 m/s: 210 m out
});

test('laps count each time the plan comes round, a shortcut lap included', () => {
  const r = makePathRoute(net, preset('pgh-three-rivers'));
  const lap = r.lapM;
  assert.equal(r.netRide.lapAt(lap - 300), 1);
  assert.equal(r.netRide.lapAt(lap + 10), 2);
  r.netRide.choose(+1, lap + gAt - 120);   // lap 2: right at East Carson & 10th
  assert.equal(r.netRide.lapAt(lap + gAt + len('G>GV', 'GV>D', 'D>C', 'C>R', 'R>A') + 10), 3);
});

test('every way through every junction rides smoothly (course QC)', () => {
  const turns = sweepTurns(net, worldIndex, { step: 0.5 });
  assert.ok(turns.length >= 44, `${turns.length} ways`);
  for (const t of turns) assert.ok(t.ok, `${t.node} ${t.from} → ${t.to}: jump ${t.jump.toFixed(2)} heading ${t.head.toFixed(1)} height ${t.height.toFixed(2)}`);
  for (const p of checkPathRoutes(net)) assert.ok(p.ok, `${p.preset} sample gap ${p.worstGap.toFixed(1)} m`);
});

test('corner speeds: none under 60°, slower the sharper', () => {
  assert.equal(cornerSpeed(30), null);
  assert.ok(cornerSpeed(90) < cornerSpeed(60));
  assert.ok(cornerSpeed(180) < cornerSpeed(135));
  const r = makePathRoute(net, preset('pgh-short-loop'));   // right at East Carson & 10th: ~90°
  assert.equal(r.netRide.speedCap(gAt - 2000), null);
  assert.ok(r.netRide.speedCap(gAt) < cornerSpeed(91) && r.netRide.speedCap(gAt) > 5);   // a right turn: tighter, a little slower
  assert.ok(r.netRide.speedCap(gAt - 70) > r.netRide.speedCap(gAt - 20));   // easing down into it
  assert.equal(r.netRide.speedCap(gAt + 80), null);                         // pedal back up after
});

const stub = () => Object.assign(new EventTarget(), { vibrate() {} });
const sessions = [];
const makeSession = () => { const s = new Session({ trainer: stub(), ride: stub(), hr: stub(), log: () => {}, settings: {} }); sessions.push(s); return s; };
after(() => { for (const s of sessions) clearInterval(s._timer); });

test('the session rides a network route: handlebar ◀ ▶ choose, laps, a fresh plan each ride', () => {
  const r = makePathRoute(net, preset('pgh-three-rivers'));
  const s = makeSession();
  let laps = 0;
  s.addEventListener('routeLap', () => laps++);
  s.setRoute(r, 0, null);
  const third = () => r.netRide.entries[4].t;   // after the Clemente Bridge, the Point, Smithfield and Station Square
  s.distanceM = gAt - 120;
  s._updateRoute();
  s._onPress('navRight');
  assert.equal(third().e.key, 'G>GV');
  s._onPress('navLeft'); s._onPress('navLeft');
  assert.ok(third().e.key === 'H>G' && third().dir < 0);   // left: up 10th to the river trail
  s._onPress('navRight'); s._onPress('navRight'); s._onPress('navRight');
  assert.equal(third().e.key, 'G>GV');   // right after all: the McArdle climb
  s.distanceM = gAt + len('G>GV', 'GV>D', 'D>C', 'C>R', 'R>A') + 20;
  s._updateRoute();
  assert.equal(s.routeLap, 2);
  assert.equal(laps, 1);
  s.setRoute(r, 0, null);   // a new ride: the plan again
  assert.equal(third().e.key, 'G>Q');
});

test('free ride: no plan, straight on at every junction, no laps, a far-reaching path', () => {
  const json = JSON.parse(readFileSync(new URL('../routes/cities/pittsburgh-network.json', import.meta.url), 'utf8'));
  const r = makePathRoute(net, { id: 'free', name: 'Free', path: null, first: json.freeRide.first });
  assert.equal(r.free, true);
  assert.equal(r.lapM, null);
  assert.equal(r.netRide.lapAt(50000), 1);
  assert.ok(r.total > 140000);
  for (const x of r.netRide.entries.slice(1, 6)) assert.equal(x.planStep, null);
  // off the Clemente Bridge straight on is 6th St and Penn Avenue into the Strip, then Smallman St to Lawrenceville
  assert.equal(r.netRide.entries[1].t.e.key, 'M>B');
  assert.equal(r.netRide.entries[1].t.dir, -1);
  // up Butler St to 40th St (LB, PLAN 5.10), where straight on is Butler St on to Stanton Ave and the East End
  assert.equal(r.netRide.entries[2].t.e.key, 'LB>M');
  assert.equal(r.netRide.entries[3].t.e.key, 'LB>HE');
  assert.ok(r.stops.length >= 3);
});

test('your own routes: the planner offers the ways on, a loop laps, a one-way route finishes at its end', () => {
  const { planNext, planCloses, keysToIds, idsToKeys } = netMod;
  const fromE = planNext(net, [], 'E');
  assert.deepEqual(fromE.map((o) => o.t.e.key).sort(), ['B>E', 'E>F', 'E>I']);
  const loop = keysToIds(net, ['E>I+', 'I>S+', 'S>H+', 'H>G+', 'F>G-', 'E>F-']);
  assert.equal(planCloses(net, loop), true);
  assert.deepEqual(idsToKeys(net, loop), ['E>I+', 'I>S+', 'S>H+', 'H>G+', 'F>G-', 'E>F-']);
  // a route saved before junction S (the Hot Metal Bridge's south end, where the GAP leaves) split I>H
  assert.deepEqual(idsToKeys(net, keysToIds(net, ['E>I+', 'I>H+', 'H>G+', 'E>G-'])), ['E>I+', 'I>S+', 'S>H+', 'H>G+', 'F>G-', 'E>F-']);   // (and F, Station Square, split E>G: PLAN 5.9)
  assert.deepEqual(idsToKeys(net, keysToIds(net, ['H>G-', 'I>H-'])), ['H>G-', 'S>H-', 'I>S-']);
  const after = planNext(net, loop.slice(0, 1));   // at the Hot Metal Bridge: the three ways on (back included)
  assert.equal(after.length, 3);
  // a route saved before junctions S (the GAP at the Hot Metal Bridge) D (West End), C and R (the North Side) split I>H and G>A
  const oneWay = keysToIds(net, ['E>I+', 'I>H+', 'H>G+', 'G>A+']);
  assert.deepEqual(idsToKeys(net, oneWay), ['E>I+', 'I>S+', 'S>H+', 'H>G+', 'G>GV+', 'GV>D+', 'D>C+', 'C>R+', 'R>A+']);
  assert.deepEqual(idsToKeys(net, keysToIds(net, ['G>A-'])), ['R>A-', 'C>R-', 'D>C-', 'GV>D-', 'G>GV-']);
  // …and one saved before the North Side's junctions C and R (the West End Bridge's north end, Ridge Ave) split D>A, and GV (Grandview & McArdle) G>D
  assert.deepEqual(idsToKeys(net, keysToIds(net, ['G>D+', 'D>A+'])), ['G>GV+', 'GV>D+', 'D>C+', 'C>R+', 'R>A+']);
  // …and one saved before junction B (the Clemente Bridge, where the Allegheny Loop comes in) split A>E
  assert.deepEqual(idsToKeys(net, keysToIds(net, ['A>E+', 'E>G+'])), ['A>B+', 'B>E+', 'E>F+', 'F>G+']);
  assert.deepEqual(idsToKeys(net, keysToIds(net, ['E>G-', 'A>E-'])), ['F>G-', 'E>F-', 'B>E-', 'A>B-']);
  // …and one saved before junction LB (40th & Butler, where the East End leaves the Allegheny Loop) split N>M;
  // junction ids of two letters ("LB>HE") parse like one-letter ones
  assert.deepEqual(idsToKeys(net, keysToIds(net, ['P>N+', 'N>M+', 'M>B+'])), ['P>N+', 'N>LB+', 'LB>M+', 'M>B+']);
  assert.deepEqual(idsToKeys(net, keysToIds(net, ['M>B-', 'N>M-'])), ['M>B-', 'LB>M-', 'N>LB-']);
  assert.deepEqual(idsToKeys(net, keysToIds(net, ['LB>HE+', 'HE>HP+', 'HP>EL+'])), ['LB>HE+', 'HE>HP+', 'HP>EL+']);
  assert.deepEqual(planNext(net, [], 'HP').map((o) => o.t.e.key).sort(), ['HE>HP', 'HP>EL', 'HP>HE']);
  const r = makePathRoute(net, { id: 'mine', name: 'Mine', path: oneWay });
  assert.equal(r.netOpen, true);
  assert.equal(r.lapM, len('E>I', 'I>S', 'S>H', 'H>G', 'G>GV', 'GV>D', 'D>C', 'C>R', 'R>A'));
  const { finishDistanceM } = gpxMod;
  assert.equal(finishDistanceM(r, 0), r.lapM);
  assert.equal(keysToIds(net, ['X>Y+']), null);   // a segment that's gone: plan it again
});

test('sharp corners inside a segment get the junctions\' gentle speed cap (F82: Bakery Square\'s hairpin)', () => {
  const { edgeBends } = netMod;
  const r = makePathRoute(net, preset('pgh-squirrel-hill'));   // Forbes from K, then EL>SQ backwards: Beechwood, Fifth Ave, Penn Ave by Bakery Square
  const e = edge('EL>SQ');
  const bend = edgeBends(net, e).find((c) => Math.abs(e.s0 + c.u - 16490) < 30);
  assert.ok(bend, 'the Penn/Fifth hairpin by Bakery Square is a corner');
  const at = len('SQ>K') + e.len - bend.u;   // its path metre (ridden backwards)
  const cap = r.netRide.speedCap(at);
  assert.ok(cap != null && Math.abs(cap - cornerSpeed(bend.angle)) < 0.01, `${cap}`);
  assert.ok(r.netRide.speedCap(at - 60) > cap && r.netRide.speedCap(at - 60) < 25);   // easing down into it
  assert.equal(r.netRide.speedCap(at + 40), null);                                     // pedal back up after
  // gentle: never under the U-turn's speed, and no corner sits in a junction's own reach
  for (const x of net.edges.values()) for (const c of edgeBends(net, x)) {
    assert.ok(cornerSpeed(c.angle) >= 3.5 && c.u >= 25 && c.u <= x.len - 25);
  }
  // a straight segment has none (East Carson Street)
  assert.deepEqual(edgeBends(net, edge('G>Q')), []);
});

test('turn labels follow the street, not the line\'s rounded corner at a junction it passes twice (F84)', () => {
  const at = (inKey) => { const m = /^(.+)([+-])$/.exec(inKey); return optionsAt(net, { e: edge(m[1]), dir: m[2] === '+' ? 1 : -1 }); };
  const labels = (inKey) => Object.fromEntries(at(inKey).filter((o) => !o.back).map((o) => [`${o.t.e.key}${o.t.dir > 0 ? '+' : '-'}`, o.label]));
  // Forbes & Shady (SQ): Forbes straight on, Shady Ave a right angle either way
  assert.deepEqual(labels('EL>SQ+'), { 'SQ>K+': 'Straight', 'SQ>EL+': 'Right' });
  assert.deepEqual(labels('SQ>EL-'), { 'EL>SQ-': 'Left', 'SQ>K+': 'Right' });
  assert.deepEqual(labels('SQ>K-'), { 'SQ>EL+': 'Left', 'EL>SQ-': 'Straight' });
  // the Clemente Bridge's south end (B): 6th St runs straight onto the bridge
  assert.deepEqual(labels('M>B+'), { 'B>E+': 'Left', 'A>B-': 'Straight' });
  // Highland Park (HE): from Mellon Terrace the default is Bunkerhill on, not the turn onto N Highland
  assert.equal(straightOn(at('LB>HE+')).t.e.key, 'HP>HE');
  // order: left to right by the street's turn; the curve keeps its own angle (first 15 m)
  for (const e of net.edges.values()) for (const dir of [1, -1]) {
    const o = optionsAt(net, { e, dir });
    for (let i = 1; i < o.length; i++) assert.ok(o[i].turn >= o[i - 1].turn);
    for (const x of o) assert.ok(Number.isFinite(x.angle) && Number.isFinite(x.turn));
  }
});

test('saved routes from before every split map onto the way they rode (the key history, F40/F58)', () => {
  const { keysToIds, idsToKeys } = netMod;
  const map = (keys) => idsToKeys(net, keysToIds(net, keys));
  const splits = {
    'E>H': ['E>I', 'I>S', 'S>H'],             // the Jail Trail & Hot Metal Bridge (junctions I, then S) — not the Smithfield Street Bridge
    'G>A': ['G>GV', 'GV>D', 'D>C', 'C>R', 'R>A'],
    'A>E': ['A>B', 'B>E'],
    'I>J': ['I>L', 'L>J'],
    'I>H': ['I>S', 'S>H'],
    'N>M': ['N>LB', 'LB>M'],
    'D>A': ['D>C', 'C>R', 'R>A'],
    'E>G': ['E>F', 'F>G'],
    'G>D': ['G>GV', 'GV>D'],
    'G>H': ['G>Q', 'Q>H'],
  };
  for (const [old, pieces] of Object.entries(splits)) {
    assert.deepEqual(map([`${old}+`]), pieces.map((k) => `${k}+`), old);
    assert.deepEqual(map([`${old}-`]), [...pieces].reverse().map((k) => `${k}-`), `${old} backwards`);
    // the pieces ride the old segment's length
    const ids = keysToIds(net, [`${old}+`]);
    assert.equal(ids.length, pieces.length);
  }
  // a whole route saved in phase 3 (E>H, H>G, E>G back) is the Jail Trail loop it was
  assert.deepEqual(map(['E>H+', 'H>G+', 'E>G-']), ['E>I+', 'I>S+', 'S>H+', 'H>G+', 'F>G-', 'E>F-']);
  // the history is a chain from each old segment's start to its end
  for (const old of Object.keys(net.keySplits)) {
    const keys = map([`${old}+`]).map((k) => k.slice(0, -1).split('>'));
    assert.equal(keys[0][0], old.split('>')[0]);
    assert.equal(keys[keys.length - 1][1], old.split('>')[1]);
  }
});

test('the West End Overlook: a dead end with only the way back, and a ghost the rider never rides', () => {
  const r = makePathRoute(net, preset('pgh-west-end'));
  const ride = r.netRide;
  const i = ride.entries.findIndex((x) => x.t.e.key === 'D>O' && x.t.dir > 0);
  const opts = optionsAt(net, ride.entries[i].t);
  assert.deepEqual(opts.map((o) => o.label), ['Back']);
  for (const x of ride.entries.slice(0, 12)) for (const g of x.t.e.A.json.ghosts || []) {
    const s0 = x.t.e.s0, s1 = x.t.e.s1;
    assert.ok(s1 <= g.fromM + 5 || s0 >= g.toM - 5, `${x.t.e.key} rides the ghost`);
  }
  // the overlook is an area of its own: the ride swaps into it 200 m up the spur, and back 200 m down the West End Bridge
  assert.equal(edge('D>O').area, 'westend');
  assert.equal(ride.areaFor(len('A>B', 'B>E', 'E>F', 'F>G', 'G>Q', 'Q>H', 'H>G', 'G>GV', 'GV>D') + 150, 'core'), 'core');
  assert.equal(ride.areaFor(len('A>B', 'B>E', 'E>F', 'F>G', 'G>Q', 'Q>H', 'H>G', 'G>GV', 'GV>D') + 250, 'core'), 'westend');
});

test('the pacer keeps its way: a turn changed behind it moves it not at all, one ahead of it it takes (F3)', () => {
  const lane = 0.07, at = (f, p) => f.pose(p, worldIndex, lane).pos;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  for (const pacerAt of [gAt + 25, gAt + 3, gAt - 12]) {   // past East Carson & 10th, in the turn's curve, entering it
    const ride = new NetRide(net, {}, { plan: preset('pgh-three-rivers').path });
    const pacer = new PathFollower(ride).update(pacerAt);
    const before = at(pacer, pacerAt), planned = ride.upcoming(gAt - 200).selected;
    // the rider, 200 m back, takes another way at the junction (the plan goes straight on to SouthSide Works)
    const other = ride.upcoming(gAt - 200).options.findIndex((o, j) => j !== planned && !o.back);
    assert.ok(ride.pick(ride.upcoming(gAt - 200).options[other].key, gAt - 200));
    assert.ok(dist(ride.pose(pacerAt, worldIndex, lane).pos, before) > (pacerAt < gAt ? .2 : 3), 'the rider\'s new path does move that metre (the old jump)');
    pacer.update(pacerAt);
    assert.ok(pacer.diverged);
    assert.ok(dist(at(pacer, pacerAt), before) < 1e-6, `pacer at ${pacerAt - gAt} m from the junction moved ${dist(at(pacer, pacerAt), before).toFixed(2)} m`);
    // and it rides on along its own way, smoothly, onto the plan's next edge (G>H, East Carson to SouthSide Works)
    let prev = before, worst = 0;
    for (let p = pacerAt; p < pacerAt + 400; p += 0.5) { const q = at(pacer.update(p), p); worst = Math.max(worst, dist(q, prev)); prev = q; }
    assert.ok(worst < 0.8, `pacer step ${worst.toFixed(2)} m`);
    assert.equal(pacer.own.entries[pacer.own.entryAt(gAt + 50)].t.e.key, 'G>Q');
    assert.notEqual(ride.entries[ride.entryAt(gAt + 50)].t.e.key, 'G>Q');
    assert.ok(Number.isFinite(pacer.grade(gAt + 50)));
  }
  // a turn changed ahead of the pacer (before it is FOLLOW_AHEAD_M from the junction): it takes the rider's new way
  const ride = new NetRide(net, {}, { plan: preset('pgh-three-rivers').path });
  const pacer = new PathFollower(ride).update(gAt - FOLLOW_AHEAD_M - 20);
  const up = ride.upcoming(gAt - 300), other = up.options.find((o, j) => j !== up.selected && !o.back);
  assert.ok(ride.pick(other.key, gAt - 300));
  pacer.update(gAt - FOLLOW_AHEAD_M - 19);
  assert.ok(!pacer.diverged);
  for (const p of [gAt - 5, gAt + 60, gAt + 500]) assert.equal(pacer.worldS(p), ride.worldS(p));
  // the turn changed back while the pacer rides its own way: the rider's path matches its own again, and it follows it
  const r2 = new NetRide(net, {}, { plan: preset('pgh-three-rivers').path }), f2 = new PathFollower(r2).update(gAt + 25);
  const u2 = r2.upcoming(gAt - 200), keep = u2.options[u2.selected].key;
  r2.pick(u2.options.find((o, j) => j !== u2.selected && !o.back).key, gAt - 200);
  assert.ok(f2.update(gAt + 26).diverged);
  r2.pick(keep, gAt - 190);
  assert.ok(!f2.update(gAt + 27).diverged);
  assert.equal(f2.worldS(gAt + 900), r2.worldS(gAt + 900));
});

test('a U-turn ahead on the path: "Back" at the end of the way out (the city life keeps oncoming traffic from passing just before it)', () => {
  const ride = new NetRide(net, {}, { plan: preset('pgh-mt-washington').path });   // G>D, D>C, C>R, R>A, back R>A, C>R, D>C, G>D
  const k = ride.entries.findIndex((x) => x.t.e.key === 'R>A');
  const back = ride.entries[k].p0 + ride.entries[k].t.e.len;   // the Water Steps' "Back"
  assert.equal(ride.uturnAhead(back - 300), back);
  assert.equal(ride.uturnAhead(back - 900), null);   // (beyond its reach)
  assert.equal(ride.uturnAhead(10, 3000), null);     // (up McArdle: no junction in the first 3 km)
});
