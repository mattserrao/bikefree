// NYC: Central Park (user, 25 Nov: "a very detailed recreation of Central Park, with routes that follow the paths there
// … building shells that surround that park, but the player cannot freeplay navigate outside it"): tools/build_pgh.py
// --city nyc (tools/city/nyc.json: the park's own outline as the area) → routes/cities/nyc.json; tools/nyc_pools.py (the
// park's waters as ring pools); tools/pgh_city.py --city nyc; tools/nyc_heroes.py (the landmarks and the wall's gates);
// tools/pgh_routes.mjs --city nyc --write.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { graphNetwork, decodeGraph, nearestEdge } from '../js/graph.js';
import { loadNetwork, makePathRoute, planCloses } from '../js/network.js';
import { qcGraph } from '../tools/qc_pgh.mjs';
import { mapProfile } from '../js/world/toolbox/map-profile.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const json = read('routes/cities/nyc.json'), cfg = read('tools/city/nyc.json'), heroes = read('routes/cities/nyc-heroes.json');
const outline = read('tools/city/nyc-area.json');
const ring = (outline.polygon || outline.ring || outline.points || outline).map((p) => (Array.isArray(p) ? p : [p.lat, p.lon]));
const inside = (la, lo, r = ring) => { let ins = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [a1, o1] = r[i], [a2, o2] = r[j]; if ((a1 > la) !== (a2 > la) && lo < (o2 - o1) * (la - a1) / (a2 - a1) + o1) ins = !ins; } return ins; };

test('NYC is rideable: one connected piece, no dead ends (tools/qc_pgh.mjs)', () => {
  const r = qcGraph(json, { rides: 40, km: 20 });
  assert.deepEqual(r.fails.slice(0, 5), [], `${r.fails.length} rideability failures`);
  assert.ok(r.summary.km > 45 && r.summary.km < 90, `${r.summary.km} km`);
});

test('NYC stays in the park: every way inside Central Park\'s outline (the gates are closed)', () => {
  const G = decodeGraph(json);
  let out = 0, n = 0;
  for (const e of G.edges) for (let i = 0; i < e.n; i++) { n++; if (!inside(e.lat[i], e.lon[i])) out++; }
  assert.ok(out / n < 0.003, `${out} of ${n} samples outside the park`);
});

test('NYC has the drives as one loop and the bridle path, both ways', () => {
  const G = decodeGraph(json);
  const drive = G.edges.filter((e) => e.kind === 'drive').reduce((a, e) => a + e.n * 10, 0) / 1000;
  const bridle = G.edges.filter((e) => e.kind === 'bridle').reduce((a, e) => a + e.n * 10, 0) / 1000;
  assert.ok(drive > 10, `drives ${drive} km`); assert.ok(bridle > 4, `bridle ${bridle} km`);
  assert.ok(!json.edges.some((e) => e.oneway), 'free both ways');
});

test('NYC\'s waters are ring pools (the Reservoir, the Lake, the Harlem Meer, the Pond, Turtle Pond)', () => {
  for (const name of ['Reservoir', 'The Lake', 'Harlem Meer', 'The Pond', 'Turtle Pond']) {
    const p = json.pools.find((q) => (q.name || '').includes(name));
    assert.ok(p, name); assert.ok(p.ring && p.ring.length >= 8, `${name} has its outline`); assert.equal(p.dam, false);
  }
});

test('NYC\'s landmarks: the park\'s own models, each with a place, and the wall with its entrances', () => {
  const models = new Set(heroes.landmarks.map((l) => l.model));
  for (const m of ['bethesda', 'bowbridge', 'boathouse', 'belvedere', 'reservoir', 'gapstow', 'wollman', 'carousel', 'imagine', 'obelisk', 'conservatory', 'columbus']) assert.ok(models.has(`nyc_${m}`), m);
  for (const l of heroes.landmarks) assert.ok(l.center && inside(l.center[0], l.center[1], ring.map(([a, o]) => [a, o])) || /Columbus|Maine|Pulitzer/.test(l.label), `${l.label} in the park`);
  assert.ok(heroes.park.gates.length > 40, 'the entrances');
  assert.ok(heroes.park.outline.length >= 20);
});

test('NYC\'s profile: the park in peak fall, no cars, open lawns, park life', () => {
  const p = mapProfile(json);
  assert.equal(p.season, 'peak-fall'); assert.equal(p.cars, false); assert.equal(p.life, 'park'); assert.equal(p.openLawns, true);
  assert.ok(json.start && existsSync(new URL(`../${json.heroes}`, import.meta.url)));
  const G = decodeGraph(json), at = nearestEdge(G, json.start.lat, json.start.lon);
  assert.ok(Math.abs(at.e.lat[at.i] - json.start.lat) < 0.002);
  const cities = read('routes/cities/graph-cities.json');
  assert.ok(cities.some((c) => c.id === 'nyc'));
});

test('NYC\'s four rides: the Full Loop, the Lower Loop, the Landmarks tour, the Bridle path and Harlem Hill', () => {
  const list = read('routes/cities/nyc-presets.json');
  const { base, network } = graphNetwork(json);
  const net = loadNetwork(network, base);
  assert.deepEqual(list.map((x) => x.id).sort(), ['nyc-bridle-harlem-hill', 'nyc-full-loop', 'nyc-landmarks', 'nyc-lower-loop']);
  for (const p of net.presets) {
    assert.ok(planCloses(net, p.path), `${p.name} does not close`);
    const r = makePathRoute(net, p);
    assert.ok(Math.abs(r.lapM - list.find((x) => x.id === p.id).lengthM) < 50);
  }
  const full = list.find((x) => x.id === 'nyc-full-loop');
  assert.ok(full.lengthM > 9300 && full.lengthM < 10600, `the Full Loop ${full.lengthM} m (6.1 mi)`);
});
