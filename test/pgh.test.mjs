// PGH: the free-ride road graph (tools/build_pgh.py → routes/cities/pgh.json, js/graph.js, js/world/graph-world.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { graphNetwork, decodeGraph, nearestEdge } from '../js/graph.js';
import { loadNetwork, makePathRoute, optionsAt } from '../js/network.js';
import { qcGraph } from '../tools/qc_pgh.mjs';

const json = JSON.parse(readFileSync(new URL('../routes/cities/pgh.json', import.meta.url), 'utf8'));

test('PGH is rideable: every edge both ways through every junction, one connected piece, no jumps or steps (tools/qc_pgh.mjs)', () => {
  const r = qcGraph(json, { rides: 60, km: 20 });
  assert.deepEqual(r.fails.slice(0, 5), [], `${r.fails.length} rideability failures`);
  assert.ok(r.summary.km > 1000, `the corridor's streets: ${r.summary.km} km`);
  assert.ok(r.summary.waysChecked > 30000);   // (fewer since the cleanup: one way per divided road, no alleys or dead ends)
});

test('the graph rides on the network machinery: edges on the synthetic base line, mirrored for the way back', () => {
  const { base, network, graph } = graphNetwork(json);
  assert.equal(base.turnS * 2, base.total);
  const net = loadNetwork(network, base);
  for (const id of ['e0', `e${Math.floor(graph.edges.length / 2)}`, `e${graph.edges.length - 1}`]) {
    const e = graph.byId.get(id), ne = net.edges.get(id);
    // forward: the edge's own samples; backward: the same samples reversed on the way back
    for (const i of [0, e.n]) {
      const k = ne.s0 / 10 + i, kb = base.dist.length - 1 - k;
      assert.ok(Math.abs(base.lat[k] - e.lat[i]) < 1e-9 && Math.abs(base.lon[k] - e.lon[i]) < 1e-9);
      assert.ok(Math.abs(base.lat[kb] - e.lat[i]) < 1e-9);
    }
  }
  // a free ride from the start: a junction ahead with its ways, the path route on 10 m samples
  const route = makePathRoute(net, { id: 'pgh-free', name: 'PGH', path: null, first: network.freeRide.first });
  const up = route.netRide.upcoming(0);
  assert.ok(up.options.length >= 2 && up.options.some((o) => o.back));
  assert.ok(route.dist.length > 1000 && route.dist[1] === 10);
});

test('choosing a turn takes it: the path runs on along the chosen way', () => {
  const { base, network } = graphNetwork(json);
  const net = loadNetwork(network, base);
  const route = makePathRoute(net, { id: 'pgh-free', name: 'PGH', path: null, first: network.freeRide.first });
  const ride = route.netRide;
  let p = 0, up = ride.upcoming(p);
  while (up.options.filter((o) => !o.back).length < 2) { p = up.atP + 1; up = ride.upcoming(p); }
  const before = Math.max(0, up.atP - 100);
  up = ride.upcoming(before);
  const other = up.options.find((o, i) => i !== up.selected && !o.back);
  assert.ok(ride.pick(other.key, before));
  const i = ride.entryAt(up.atP + 1);
  assert.equal(ride.entries[i].t.e.id, other.t.e.id);
  assert.equal(ride.entries[i].t.dir, other.t.dir);
});

test('the start is the configured spot (PNC Park / the North Shore) and junction names read as streets', () => {
  const G = decodeGraph(json);
  const at = nearestEdge(G, json.start.lat, json.start.lon);
  assert.ok(Math.abs(at.e.lat[at.i] - json.start.lat) < 0.002);
  const named = json.nodes.filter((n) => / & /.test(n.name)).length;
  assert.ok(named / json.nodes.length > 0.5, `${named} of ${json.nodes.length} junctions named "A & B"`);
  // no highways: no motorway or trunk names along a long edge
  const net = graphNetwork(json);
  const long = net.network.edges.filter((e) => /Parkway|Interstate|I-376|I-279/.test(e.name));
  assert.deepEqual(long.map((e) => e.name), []);
  assert.ok(optionsAt(loadNetwork(net.network, net.base), { e: loadNetwork(net.network, net.base).edges.get('e0'), dir: 1 }).length >= 1);
});
