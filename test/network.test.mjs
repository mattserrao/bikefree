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
const gAt = len('A>E', 'E>G');   // East Carson & 10th, riding the Three Rivers Loop from the Water Steps

test('the network sits on its tour: edges on its 10 m samples, presets close up', () => {
  assert.equal(item.network, 'routes/cities/pittsburgh-network.json');
  assert.equal(net.L, base.turnS);
  const sum = [...net.edges.values()].reduce((t, e) => t + e.len, 0);
  const ghost = (net.json.ghosts || []).reduce((t, g) => t + g.toM - g.fromM, 0);
  assert.ok(Math.abs(sum + ghost - net.L) < 30, `${sum} + ${ghost} ghost vs ${net.L}`);   // the edges and the ghosts cover the tour once
  assert.deepEqual([...net.nodes.keys()].sort(), ['A', 'D', 'E', 'G', 'H', 'I', 'J', 'K', 'O']);
  const three = makePathRoute(net, preset('pgh-three-rivers'));
  const short = makePathRoute(net, preset('pgh-short-loop'));
  const jail = makePathRoute(net, preset('pgh-jail-trail'));
  assert.equal(three.lapM, len('A>E', 'E>G', 'G>H', 'H>G', 'G>D', 'D>A'));
  assert.ok(Math.abs(three.lapM - 18300) < 300, `${three.lapM}`);   // the loop as it always was
  assert.equal(short.lapM, len('A>E', 'E>G', 'G>D', 'D>A'));
  assert.equal(jail.lapM, len('E>I', 'I>H', 'H>G', 'E>G'));
  assert.ok(three.total > 140000 && short.total > 140000);   // the path runs far ahead for the planner
  for (let i = 0; i < three.dist.length; i += 997) assert.equal(three.dist[i], i * 10);
});

test('East Carson & 10th: back, left, straight and right, sorted left to right', () => {
  const ride = new NetRide(net, {}, { plan: preset('pgh-three-rivers').path });
  const opts = optionsAt(net, ride.entries[1].t);   // arriving eastbound on East Carson
  assert.deepEqual(opts.map((o) => o.label), ['Back', 'Left', 'Straight', 'Right']);
  assert.equal(straightOn(opts).t.e.key, 'G>H');   // straight: East Carson on to SouthSide Works
  assert.equal(opts[3].t.e.key, 'G>D');            // right: up McArdle to Mount Washington
  for (const o of opts) assert.ok(o.lengthM > 0 && o.climbM >= 0 && o.toward);
});

test('Smithfield & Fort Pitt and SouthSide Works: the Jail Trail joins the loop', () => {
  const ride = new NetRide(net, {}, { plan: preset('pgh-three-rivers').path });
  const atE = optionsAt(net, ride.entries[0].t);   // southbound on Smithfield, at Fort Pitt Blvd
  assert.ok(atE.some((o) => o.t.e.key === 'E>I' && o.t.dir > 0 && /left/i.test(o.label)), 'the Jail Trail is a left turn');
  assert.equal(straightOn(atE).t.e.key, 'E>G');   // straight on: the Smithfield Street Bridge
  const jail = new NetRide(net, {}, { plan: preset('pgh-jail-trail').path });
  assert.equal(net.nodes.get(jail.upcoming(10).node.id).id, 'I');
  assert.equal(jail.upcoming(10).options[jail.upcoming(10).selected].t.e.key, 'I>H');   // the plan: over the Hot Metal Bridge
  assert.ok(jail.upcoming(10).options.some((o) => o.t.e.key === 'I>J'), 'Junction Hollow and Oakland offered at the bridge');
});

test('the path follows the plan, takes your turn, then rejoins the plan', () => {
  const r = makePathRoute(net, preset('pgh-three-rivers'));
  const ride = r.netRide;
  const key = (k) => { const e = edge(k.slice(0, -1)); return `${e.id}${k.at(-1)}`; };
  assert.deepEqual(keys(ride, 3), ['A>E+', 'E>G+', 'G>H+'].map(key));
  const p = gAt - 120;
  const up = ride.upcoming(p);
  assert.equal(up.node.id, 'G');
  assert.equal(up.options[up.selected].label, 'Straight');
  assert.equal(up.onPlan, true);
  assert.equal(ride.choose(+1, p), true);   // right: skip the South Side
  assert.deepEqual(keys(ride, 4), ['A>E+', 'E>G+', 'G>D+', 'D>A+'].map(key));   // McArdle is on the plan too, so it rejoins
  assert.equal(ride.choose(+1, p), false);   // nothing further right
  // the session's path route now runs straight from East Carson onto McArdle
  const i = gAt / 10, sMcArdle = edge('G>D').s0 / 10;
  assert.ok(Math.abs(r.ele[i + 1] - base.ele[sMcArdle + 1]) < 1e-9);
});

test('a choice locks close to the junction', () => {
  const r = makePathRoute(net, preset('pgh-three-rivers'));
  const p = gAt - LOCK_M + 1;
  r.netRide.update(p);
  assert.equal(r.netRide.upcoming(p).locked, true);
  assert.equal(r.netRide.choose(+1, p), false);
  assert.equal(r.netRide.entries[2].t.e.key, 'G>H');
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
  assert.equal(r.netRide.lapAt(lap + gAt + len('G>D', 'D>A') + 10), 3);
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
  const third = () => r.netRide.entries[2].t;
  s.distanceM = gAt - 120;
  s._updateRoute();
  s._onPress('navRight');
  assert.equal(third().e.key, 'G>D');
  s._onPress('navLeft'); s._onPress('navLeft');
  assert.ok(third().e.key === 'H>G' && third().dir < 0);   // left: up 10th to the river trail
  s._onPress('navRight'); s._onPress('navRight'); s._onPress('navRight');
  assert.equal(third().e.key, 'G>D');   // right after all: the McArdle climb
  s.distanceM = gAt + len('G>D', 'D>A') + 20;
  s._updateRoute();
  assert.equal(s.routeLap, 2);
  assert.equal(laps, 1);
  s.setRoute(r, 0, null);   // a new ride: the plan again
  assert.equal(third().e.key, 'G>H');
});

test('free ride: no plan, straight on at every junction, no laps, a far-reaching path', () => {
  const json = JSON.parse(readFileSync(new URL('../routes/cities/pittsburgh-network.json', import.meta.url), 'utf8'));
  const r = makePathRoute(net, { id: 'free', name: 'Free', path: null, first: json.freeRide.first });
  assert.equal(r.free, true);
  assert.equal(r.lapM, null);
  assert.equal(r.netRide.lapAt(50000), 1);
  assert.ok(r.total > 140000);
  for (const x of r.netRide.entries.slice(1, 6)) assert.equal(x.planStep, null);
  // at East Carson & 10th (from Smithfield) straight on is East Carson; a right takes you up McArdle
  assert.equal(r.netRide.entries[1].t.e.key, 'E>G');
  assert.equal(r.netRide.entries[2].t.e.key, 'G>H');
  assert.ok(r.stops.length >= 3);
});

test('your own routes: the planner offers the ways on, a loop laps, a one-way route finishes at its end', () => {
  const { planNext, planCloses, keysToIds, idsToKeys } = netMod;
  const fromE = planNext(net, [], 'E');
  assert.deepEqual(fromE.map((o) => o.t.e.key).sort(), ['A>E', 'E>G', 'E>I']);
  const loop = keysToIds(net, ['E>I+', 'I>H+', 'H>G+', 'E>G-']);
  assert.equal(planCloses(net, loop), true);
  assert.deepEqual(idsToKeys(net, loop), ['E>I+', 'I>H+', 'H>G+', 'E>G-']);
  const after = planNext(net, loop.slice(0, 1));   // at the Hot Metal Bridge: the three ways on (back included)
  assert.equal(after.length, 3);
  const oneWay = keysToIds(net, ['E>H+', 'H>G+', 'G>A+']);   // a route saved before junctions I (Hot Metal Bridge) and D (West End) split E>H and G>A
  assert.deepEqual(idsToKeys(net, oneWay), ['E>I+', 'I>H+', 'H>G+', 'G>D+', 'D>A+']);
  assert.deepEqual(idsToKeys(net, keysToIds(net, ['G>A-'])), ['D>A-', 'G>D-']);
  const r = makePathRoute(net, { id: 'mine', name: 'Mine', path: oneWay });
  assert.equal(r.netOpen, true);
  assert.equal(r.lapM, len('E>I', 'I>H', 'H>G', 'G>D', 'D>A'));
  const { finishDistanceM } = gpxMod;
  assert.equal(finishDistanceM(r, 0), r.lapM);
  assert.equal(keysToIds(net, ['X>Y+']), null);   // a segment that's gone: plan it again
});

test('the West End Overlook: a dead end with only the way back, and a ghost the rider never rides', () => {
  const r = makePathRoute(net, preset('pgh-west-end'));
  const ride = r.netRide;
  const i = ride.entries.findIndex((x) => x.t.e.key === 'D>O' && x.t.dir > 0);
  const opts = optionsAt(net, ride.entries[i].t);
  assert.deepEqual(opts.map((o) => o.label), ['Back']);
  for (const x of ride.entries.slice(0, 12)) for (const g of net.json.ghosts) {
    const s0 = x.t.e.s0, s1 = x.t.e.s1;
    assert.ok(s1 <= g.fromM + 5 || s0 >= g.toM - 5, `${x.t.e.key} rides the ghost`);
  }
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
    assert.equal(pacer.own.entries[pacer.own.entryAt(gAt + 50)].t.e.key, 'G>H');
    assert.notEqual(ride.entries[ride.entryAt(gAt + 50)].t.e.key, 'G>H');
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
