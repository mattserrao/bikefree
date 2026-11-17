// Ride networks (choose your turns): js/network.js on Pittsburgh's loop, and the session riding one.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makePathRoute, optionsAt, straightOn, cornerSpeed, LOCK_M, NetRide } from '../js/network.js';
import { Session } from '../js/session.js';
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
  assert.equal(sum, net.L);   // the edges cover the tour once
  assert.deepEqual([...net.nodes.keys()].sort(), ['A', 'E', 'G', 'H']);
  const three = makePathRoute(net, preset('pgh-three-rivers'));
  const short = makePathRoute(net, preset('pgh-short-loop'));
  const jail = makePathRoute(net, preset('pgh-jail-trail'));
  assert.equal(three.lapM, len('A>E', 'E>G', 'G>H', 'H>G', 'G>A'));
  assert.ok(Math.abs(three.lapM - 18300) < 300, `${three.lapM}`);   // the loop as it always was
  assert.equal(short.lapM, len('A>E', 'E>G', 'G>A'));
  assert.equal(jail.lapM, len('E>H', 'H>G', 'E>G'));
  assert.ok(three.total > 140000 && short.total > 140000);   // the path runs far ahead for the planner
  for (let i = 0; i < three.dist.length; i += 997) assert.equal(three.dist[i], i * 10);
});

test('East Carson & 10th: back, left, straight and right, sorted left to right', () => {
  const ride = new NetRide(net, {}, { plan: preset('pgh-three-rivers').path });
  const opts = optionsAt(net, ride.entries[1].t);   // arriving eastbound on East Carson
  assert.deepEqual(opts.map((o) => o.label), ['Back', 'Left', 'Straight', 'Right']);
  assert.equal(straightOn(opts).t.e.key, 'G>H');   // straight: East Carson on to SouthSide Works
  assert.equal(opts[3].t.e.key, 'G>A');            // right: up McArdle to Mount Washington
  for (const o of opts) assert.ok(o.lengthM > 0 && o.climbM >= 0 && o.toward);
});

test('Smithfield & Fort Pitt and SouthSide Works: the Jail Trail joins the loop', () => {
  const ride = new NetRide(net, {}, { plan: preset('pgh-three-rivers').path });
  const atE = optionsAt(net, ride.entries[0].t);   // southbound on Smithfield, at Fort Pitt Blvd
  assert.ok(atE.some((o) => o.t.e.key === 'E>H' && o.t.dir > 0 && /left/i.test(o.label)), 'the Jail Trail is a left turn');
  assert.equal(straightOn(atE).t.e.key, 'E>G');   // straight on: the Smithfield Street Bridge
  const jail = new NetRide(net, {}, { plan: preset('pgh-jail-trail').path });
  assert.equal(net.nodes.get(jail.upcoming(10).node.id).id, 'H');
  assert.equal(jail.upcoming(10).options[jail.upcoming(10).selected].t.e.key, 'H>G');   // on along the river trail
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
  assert.deepEqual(keys(ride, 4), ['A>E+', 'E>G+', 'G>A+', 'A>E+'].map(key));   // McArdle is on the plan too, so it rejoins
  assert.equal(ride.choose(+1, p), false);   // nothing further right
  // the session's path route now runs straight from East Carson onto McArdle
  const i = gAt / 10, sMcArdle = edge('G>A').s0 / 10;
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
  assert.equal(r.netRide.lapAt(lap + gAt + edge('G>A').len + 10), 3);
});

test('every way through every junction rides smoothly (course QC)', () => {
  const turns = sweepTurns(net, worldIndex, { step: 0.5 });
  assert.equal(turns.length, 38);
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
  assert.equal(third().e.key, 'G>A');
  s._onPress('navLeft'); s._onPress('navLeft');
  assert.ok(third().e.key === 'H>G' && third().dir < 0);   // left: up 10th to the river trail
  s._onPress('navRight'); s._onPress('navRight'); s._onPress('navRight');
  assert.equal(third().e.key, 'G>A');   // right after all: the McArdle climb
  s.distanceM = gAt + edge('G>A').len + 20;
  s._updateRoute();
  assert.equal(s.routeLap, 2);
  assert.equal(laps, 1);
  s.setRoute(r, 0, null);   // a new ride: the plan again
  assert.equal(third().e.key, 'G>H');
});
