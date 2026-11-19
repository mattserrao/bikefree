// Assisted conveyors (escalators): a stretch of a route the rider is carried along at a set pace, with the
// trainer at its lightest resistance (js/gpx.js carryAt / carrySpeed, the session, the pacer, a network path).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoute, carryAt, carryAhead, carrySpeed, CARRY_EASE_MPS2 } from '../js/gpx.js';
import { Session, CARRY_SIM_GRADE } from '../js/session.js';
import { Pacer } from '../js/pacer.js';
import { loadNetwork, makePathRoute, PathFollower } from '../js/network.js';

// a straight 1 km line, steeply down in its middle (an escalator: 14 m over 50 m)
const line = (n = 101) => Array.from({ length: n }, (_, i) => ({ lat: 40.44 + i * 10 / 111320, lon: -80, ele: i < 40 ? 223 : i > 45 ? 209 : 223 - (i - 40) * 14 / 5 }));
const route = () => Object.assign(buildRoute({ name: 'Escalator test', points: line(), eleSmoothM: 0 }), { carry: [{ from: 400, to: 450, mps: 3, label: 'Escalator' }] });

test('carryAt / carryAhead: the zone under you and the next one ahead', () => {
  const r = route();
  assert.equal(carryAt(r, 399), null);
  assert.equal(carryAt(r, 400).label, 'Escalator');
  assert.equal(carryAt(r, 449.9).mps, 3);
  assert.equal(carryAt(r, 450), null);
  assert.equal(carryAhead(r, 350).dist, 50);
  assert.equal(carryAhead(r, 300), null);   // beyond its 80 m reach
  assert.equal(carryAt({ ...r, carry: undefined }, 420), null);   // a route without conveyors
});

test('carrySpeed: eased onto the conveyor\'s pace both ways, a gentle slow-down before it', () => {
  const r = route();
  assert.equal(carrySpeed(r, 420, 0, 1), CARRY_EASE_MPS2);        // standing: carried up to pace
  assert.equal(carrySpeed(r, 420, 2.9, 1), 3);
  assert.equal(carrySpeed(r, 420, 8, 1), 8 - CARRY_EASE_MPS2);     // too fast: eased down
  assert.equal(carrySpeed(r, 420, 3, 1), 3);
  const cap = carrySpeed(r, 390, 15, 0.25);                        // 10 m before it at 54 km/h: capped
  assert.ok(Math.abs(cap - Math.sqrt(9 + 2 * CARRY_EASE_MPS2 * 10)) < 1e-9);
  assert.equal(carrySpeed(r, 200, 15, 0.25), 15);                  // far from it: unchanged
});

const stub = () => Object.assign(new EventTarget(), { vibrate() {} });
const sessions = [];
after(() => { for (const s of sessions) clearInterval(s._timer); });
function makeSession(shiftMode) {
  const sent = [];
  const trainer = Object.assign(new EventTarget(), { connected: true, busy: false, reconnecting: false, lastDataAt: 0, data: { powerW: 0, cadenceRpm: 0 },
    setGrade(g, o) { sent.push(['sim', g, o]); }, setErgWatts(w) { sent.push(['erg', w]); } });
  const s = new Session({ trainer, ride: stub(), hr: stub(), log: () => {}, settings: { shiftMode, difficulty: 100, startGear: 12, riderKg: 80, bikeKg: 9 } });
  clearInterval(s._timer); sessions.push(s);
  const tick = () => { trainer.lastDataAt = performance.now(); s._tick(); };
  return { s, sent, tick };
}

test('the session: carried at the pace without pedalling, the trainer at its lightest, no climb counted', () => {
  for (const mode of ['sim', 'erg']) {
    const { s, sent, tick } = makeSession(mode);
    const r = route();
    s.setRoute(r, 400);
    s.running = true;
    assert.equal(s.carry.label, 'Escalator');
    for (let i = 0; i < 12; i++) tick();   // 3 s, no power
    assert.ok(Math.abs(s.speedMps - 3) < 1e-9, `${mode}: carried at 3 m/s (${s.speedMps})`);
    assert.ok(s.routePos > 405);
    assert.equal(s.running, true);         // not auto-paused while carried
    const last = sent.at(-1);
    if (mode === 'sim') assert.deepEqual([last[0], last[1]], ['sim', CARRY_SIM_GRADE]);
    else assert.deepEqual(last, ['erg', 0]);
    assert.equal(s.target.source, 'carry');
    // the recording's grade is level on the conveyor
    s.recorder.start(Date.now()); s._lastSampleAt = 0; tick();
    assert.equal(s.recorder.samples?.at?.(-1)?.[7] ?? 0, 0);
  }
  // riding up an escalator adds no climb
  const { s, tick } = makeSession('sim');
  const up = Object.assign(buildRoute({ name: 'up', points: line().reverse(), eleSmoothM: 0 }), { carry: [{ from: 550, to: 600, mps: 3, label: 'Escalator' }] });
  s.setRoute(up, 550); s.running = true;
  for (let i = 0; i < 100 && s.routePos < 600; i++) tick();
  assert.ok(s.routePos >= 600 && s.elevGainM < 1, `no climb counted on the escalator (${s.elevGainM.toFixed(2)} m)`);
});

test('the pacer is carried too', () => {
  const p = new Pacer(150);
  p.reset(0); p.dist = 410;
  p.step(4, () => -28, { riderKg: 80, bikeKg: 9, crr: .004, cda: .32 }, (d) => (d >= 400 && d < 450 ? { mps: 3 } : null));
  assert.ok(Math.abs(p.speed - 3) < 1e-9 && p.dist > 410 && p.dist < 425);
});

test('a network edge\'s conveyors land on the path either way round, and the pacer\'s copy sees them', () => {
  const base = buildRoute({ name: 'line', points: line(), eleSmoothM: 0 });
  base.turnS = null;
  const json = { format: 'bikefree-network-1', id: 't', legM: base.total, nodes: [{ id: 'A', lat: 0, lon: 0 }, { id: 'B', lat: 0, lon: 0 }],
    edges: [{ id: 'e1', key: 'A>B', from: 'A', to: 'B', s: [0, 990], lengthM: 990, climbM: [0, 14], name: 'x', conveyors: [{ u0: 400, u1: 450, mps: 3, label: 'Escalator' }] }],
    presets: [{ id: 'p', name: 'p', path: ['e1+', 'e1-'] }] };
  const net = loadNetwork(json, base);
  const r = makePathRoute(net, net.presets[0]);
  const zones = r.carry.filter((z) => z.from < 2000);
  assert.deepEqual(zones.map((z) => [z.from, z.to]), [[400, 450], [1530, 1580]]);
  assert.equal(carryAt(r, 1555).label, 'Escalator');
  const f = new PathFollower(r.netRide); f.update(0);
  assert.equal(f.carry(420).mps, 3);
  assert.equal(f.carry(1540).mps, 3);
  assert.equal(f.carry(1520), null);
});

test('Pittsburgh\'s subway (NS>GW): its two escalators are conveyors on the path, down at North Side, up at Gateway', async () => {
  const { readFileSync } = await import('node:fs');
  const { loadCatalogNetwork } = await import('../tools/qc_network.mjs');
  const index = JSON.parse(readFileSync(new URL('../routes/parks/index.json', import.meta.url), 'utf8'));
  const { net } = loadCatalogNetwork(index.find((r) => r.id === 'pittsburgh'));
  const e = [...net.edges.values()].find((x) => x.key === 'NS>GW');
  assert.equal(e.area, 'subway');
  assert.equal(e.conveyors.length, 2);
  const r = makePathRoute(net, net.presets.find((p) => p.id === 'pgh-subway-point'));
  const a = [...net.edges.values()].find((x) => x.key === 'A>NS').len;
  const z = r.carry.filter((c) => c.from < r.lapM);
  assert.deepEqual(z.map((c) => [c.from - a, c.to - a]), e.conveyors.map((c) => [c.u0, c.u1]));
  // riding down the first: the line drops ~13 m over its ~48 m; up the second: it climbs as much
  const ele = (s) => r.ele[Math.round(s / 10)];
  assert.ok(ele(z[0].from - 10) - ele(z[0].to + 10) > 12, 'down at North Side');
  assert.ok(ele(z[1].to + 10) - ele(z[1].from - 10) > 12, 'up at Gateway');
  // a route saved over the Clemente Bridge and the Point before the subway split them still maps (key history)
  const { keysToIds, idsToKeys } = await import('../js/network.js');
  assert.deepEqual(idsToKeys(net, keysToIds(net, ['A>B+', 'B>E+'])), ['A>NS+', 'NS>B+', 'B>GW+', 'GW>E+']);
});
