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

test('the network sits on the loop: edges on its 10 m samples, presets close up', () => {
  assert.equal(item.network, 'routes/cities/pittsburgh-network.json');
  assert.equal(net.L, base.turnS);
  const sum = [...net.edges.values()].reduce((s, e) => s + e.len, 0);
  assert.equal(sum, net.L);   // the edges cover the loop once
  const three = makePathRoute(net, preset('pgh-three-rivers'));
  const short = makePathRoute(net, preset('pgh-short-loop'));
  assert.equal(three.lapM, net.L);
  assert.equal(short.lapM, 13720);
  assert.ok(three.total > 140000 && short.total > 140000);   // the path runs far ahead for the planner
  for (let i = 0; i < three.dist.length; i += 997) assert.equal(three.dist[i], i * 10);
});

test('East Carson & 10th: back, left, straight and right, sorted left to right', () => {
  const ride = new NetRide(net, {}, { plan: preset('pgh-three-rivers').path });
  const opts = optionsAt(net, ride.entries[0].t);   // arriving eastbound on East Carson
  assert.deepEqual(opts.map((o) => o.label), ['Back', 'Left', 'Straight', 'Right']);
  assert.equal(straightOn(opts).key, 'e2+');
  assert.equal(opts[3].key, 'e3+');   // right: up McArdle to Mount Washington
  for (const o of opts) assert.ok(o.lengthM > 0 && o.climbM >= 0 && o.toward);
});

test('the path follows the plan, takes your turn, then rejoins the plan', () => {
  const r = makePathRoute(net, preset('pgh-three-rivers'));
  const ride = r.netRide;
  assert.deepEqual(keys(ride), ['e1+', 'e2+', 'e3+', 'e1+']);
  const up = ride.upcoming(5900);
  assert.equal(up.node.id, 'G');
  assert.equal(up.options[up.selected].label, 'Straight');
  assert.equal(up.onPlan, true);
  assert.equal(ride.choose(+1, 5900), true);   // right: skip the South Side
  assert.deepEqual(keys(ride), ['e1+', 'e3+', 'e1+', 'e2+']);   // McArdle is on the plan too, so it rejoins
  assert.equal(ride.choose(+1, 5900), false);   // nothing further right
  assert.equal(r.total > 140000, true);
  // the session's path route now runs straight from East Carson onto McArdle
  assert.ok(Math.abs(r.ele[602] - base.ele[602]) < 1e-9 && Math.abs(r.ele[603] - base.ele[1062]) < 1e-9);
});

test('a choice locks close to the junction', () => {
  const r = makePathRoute(net, preset('pgh-three-rivers'));
  const p = 6020 - LOCK_M + 1;
  r.netRide.update(p);
  assert.equal(r.netRide.upcoming(p).locked, true);
  assert.equal(r.netRide.choose(+1, p), false);
  assert.deepEqual(keys(r.netRide, 2), ['e1+', 'e2+']);
});

test('the prompt shows ~15 s out and never later than 120 m', () => {
  const r = makePathRoute(net, preset('pgh-three-rivers'));
  assert.equal(r.netRide.prompt(6020 - 200, 5), null);    // 5 m/s: 75 m of warning is too little, so 120 m
  assert.ok(r.netRide.prompt(6020 - 119, 5));
  assert.ok(r.netRide.prompt(6020 - 200, 14));            // 14 m/s: 210 m out
});

test('laps count each time the plan comes round, a shortcut lap included', () => {
  const r = makePathRoute(net, preset('pgh-three-rivers'));
  assert.equal(r.netRide.lapAt(18000), 1);
  assert.equal(r.netRide.lapAt(18320), 2);
  r.netRide.choose(+1, 18310 + 5900);   // lap 2: right at East Carson & 10th
  assert.equal(r.netRide.lapAt(18310 + 13720 + 10), 3);
});

test('every way through every junction rides smoothly (course QC)', () => {
  const turns = sweepTurns(net, worldIndex, { step: 0.5 });
  assert.equal(turns.length, 20);
  for (const t of turns) assert.ok(t.ok, `${t.node} ${t.from} → ${t.to}: jump ${t.jump.toFixed(2)} heading ${t.head.toFixed(1)} height ${t.height.toFixed(2)}`);
  for (const p of checkPathRoutes(net)) assert.ok(p.ok, `${p.preset} sample gap ${p.worstGap.toFixed(1)} m`);
});

test('corner speeds: none under 60°, slower the sharper', () => {
  assert.equal(cornerSpeed(30), null);
  assert.ok(cornerSpeed(90) < cornerSpeed(60));
  assert.ok(cornerSpeed(180) < cornerSpeed(135));
  const r = makePathRoute(net, preset('pgh-short-loop'));   // right at East Carson & 10th: 91°
  assert.equal(r.netRide.speedCap(4000), null);
  assert.ok(Math.abs(r.netRide.speedCap(6020) - cornerSpeed(91)) < 0.05);
  assert.ok(r.netRide.speedCap(5950) > r.netRide.speedCap(6000));   // easing down into it
  assert.equal(r.netRide.speedCap(6100), null);                      // pedal back up after
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
  s.distanceM = 5900;
  s._updateRoute();
  s._onPress('navRight');
  assert.deepEqual(keys(r.netRide, 2), ['e1+', 'e3+']);
  s._onPress('navLeft'); s._onPress('navLeft');
  assert.deepEqual(keys(r.netRide, 2), ['e1+', 'e2-']);   // left: up 10th to the river trail
  s._onPress('navRight'); s._onPress('navRight'); s._onPress('navRight');
  assert.deepEqual(keys(r.netRide, 2), ['e1+', 'e3+']);   // right after all: the McArdle climb
  s.distanceM = 6020 + 7700 + 20;
  s._updateRoute();
  assert.equal(s.routeLap, 2);
  assert.equal(laps, 1);
  s.setRoute(r, 0, null);   // a new ride: the plan again
  assert.deepEqual(keys(r.netRide, 2), ['e1+', 'e2+']);
});
