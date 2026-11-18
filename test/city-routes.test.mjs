// City cards (js/city-routes.js): a network's routes folded into one card, the segment → routes lookup behind
// tapping the map, and the goal filter, on Pittsburgh's real network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { groupCityItems, citySubline, filterByGoal, segmentRoutes, pickOnSegment, pathEdges, nearestLine, fitProjection, mergeRivers, shortName, cityName, isNetItem } from '../js/city-routes.js';

const json = JSON.parse(readFileSync(new URL('../routes/cities/pittsburgh-network.json', import.meta.url), 'utf8'));
const base = { kind: 'route', park: 'Pittsburgh, Pennsylvania', stage: 'draft', baseId: 'builtin-park-pittsburgh', network: 'routes/cities/pittsburgh-network.json' };
const presets = json.presets.map((p) => ({ ...base, id: `builtin-net-${p.id}`, name: `Pittsburgh · ${p.name}`, preset: p.id, tags: p.tags, path: p.path }));
const free = { ...base, id: `builtin-netfree-${json.id}`, name: 'Pittsburgh · Free Ride', free: true, tags: ['varied'] };
const mine = { ...base, id: 'mynet-abc', name: 'Pittsburgh · My hills', custom: true, keys: ['A>B+'], tags: [] };
const other = { id: 'builtin-park-zion', kind: 'route', name: 'Zion', stage: 'progress' };
const demo = { id: 'builtin-demo-hills', kind: 'route', name: 'Demo Hills (built-in)' };

test('a network city is one card in the place of its first item; other routes are untouched', () => {
  const list = groupCityItems([other, ...presets.slice(0, 3), free, mine, ...presets.slice(3), demo]);
  assert.equal(list.length, 3);
  assert.equal(list[0], other);
  assert.equal(list[2], demo);
  const c = list[1];
  assert.equal(c.city, true);
  assert.equal(c.id, 'city-builtin-park-pittsburgh');
  assert.equal(c.name, 'Pittsburgh');
  assert.equal(c.stage, 'draft');
  assert.equal(c.free, free);
  assert.equal(c.routes.length, presets.length + 1, 'presets and your own routes, not the free ride');
  assert.deepEqual(c.mine, [mine]);
  assert.equal(citySubline(c, 8), `8 areas · ${presets.length + 1} routes · free ride`);
  assert.equal(citySubline({ routes: [1], free: null }, 1), '1 route');
  // two cities: two cards
  const b2 = presets.slice(0, 2).map((p) => ({ ...p, id: `${p.id}-x`, baseId: 'builtin-park-other', name: `Elsewhere · ${shortName(p.name)}` }));
  assert.deepEqual(groupCityItems([...presets.slice(0, 2), ...b2]).map((x) => x.name), ['Pittsburgh', 'Elsewhere']);
  assert.equal(isNetItem(other), false);
  assert.equal(cityName('Pittsburgh · Three Rivers Loop · reverse'), 'Pittsburgh');
  assert.equal(shortName('Pittsburgh · Three Rivers Loop · reverse'), 'Three Rivers Loop · reverse');
});

test('goal filter: the routes tagged with the goal, every route for All', () => {
  const tagsOf = (it) => it.tags || [];
  assert.equal(filterByGoal(presets, 'all', tagsOf).length, presets.length);
  const flat = filterByGoal(presets, 'flat', tagsOf);
  assert.ok(flat.length > 0 && flat.length < presets.length);
  assert.ok(flat.every((it) => it.tags.includes('flat')));
  assert.deepEqual(filterByGoal(presets, 'nonesuch', tagsOf), []);
});

test('segment → routes: every preset is listed on each segment it rides, once', () => {
  const index = segmentRoutes([...presets, free]);
  for (const p of presets) for (const e of pathEdges(p.path)) assert.ok(index.get(e).includes(p.id), `${p.id} on ${e}`);
  for (const ids of index.values()) assert.equal(new Set(ids).size, ids.length);
  assert.ok([...index.values()].every((ids) => !ids.includes(free.id)), 'a free ride has no path');
  for (const e of index.keys()) assert.ok(json.edges.some((x) => x.id === e), `${e} is a network edge`);
  assert.deepEqual(pathEdges(['e1+', 'e2-', 'e1-']), ['e1', 'e2']);
});

test('tapping a segment picks its first route, tapping it again cycles; only the routes shown count', () => {
  const index = segmentRoutes(presets);
  const [edge, ids] = [...index].find(([, v]) => v.length >= 3);
  const shown = presets.map((p) => p.id);
  let r = pickOnSegment(index, edge, shown);
  assert.deepEqual(r.ids, ids);
  assert.equal(r.selected, ids[0]);
  r = pickOnSegment(index, edge, shown, { lastEdge: edge, selected: r.selected });
  assert.equal(r.selected, ids[1]);
  r = pickOnSegment(index, edge, shown, { lastEdge: edge, selected: ids.at(-1) });
  assert.equal(r.selected, ids[0], 'round and round');
  // another segment starts at its own first
  const [edge2, ids2] = [...index].find(([k]) => k !== edge);
  assert.equal(pickOnSegment(index, edge2, shown, { lastEdge: edge, selected: ids[1] }).selected, ids2[0]);
  // a goal that hides some: only the shown ones
  const only = [ids[1]];
  assert.deepEqual(pickOnSegment(index, edge, only), { ids: only, selected: ids[1] });
  assert.deepEqual(pickOnSegment(index, edge, []), { ids: [], selected: null });
  assert.deepEqual(pickOnSegment(index, 'nope', shown), { ids: [], selected: null });
});

test('map: the projection fits the network in the box and a tap finds the nearest line', () => {
  const lines = [{ id: 'a', lat: [40.44, 40.45], lon: [-80.0, -80.0] }, { id: 'b', lat: [40.44, 40.44], lon: [-80.02, -79.98] }];
  const { X, Y } = fitProjection(lines, 400, 225, 20);
  for (const L of lines) for (let i = 0; i < L.lat.length; i++) {
    const x = X(L.lon[i]), y = Y(L.lat[i]);
    assert.ok(x >= 19.9 && x <= 380.1 && y >= 19.9 && y <= 205.1, `${x},${y} inside`);
  }
  assert.ok(Y(40.45) < Y(40.44), 'north up');
  const px = lines.map((L) => ({ id: L.id, pts: L.lat.map((la, i) => [X(L.lon[i]), Y(la)]) }));
  assert.equal(nearestLine(px, X(-80.0) + 3, (Y(40.44) + Y(40.45)) / 2, 14), 0);
  assert.equal(nearestLine(px, X(-80.015), Y(40.44) - 4, 14), 1);
  assert.equal(nearestLine(px, 2, 2, 14), -1);
});

test('rivers from each area\'s scene: the longest of each name', () => {
  const short = { name: 'Monongahela River', path: [[1, 1], [2, 2]] }, long = { name: 'Monongahela River', path: [[1, 1], [2, 2], [3, 3]] };
  const ohio = { name: 'Ohio River', path: [[0, 0], [1, 1]] };
  assert.deepEqual(mergeRivers([[short, ohio], null, [long]]), [long, ohio]);
});

test('the panel\'s list by area: each route under its main area, areas in the network\'s order (F103)', async () => {
  const { groupByArea } = await import('../js/city-routes.js');
  const edges = new Map(json.edges.map((e) => [e.id, { area: e.area, len: e.lengthM }]));
  const order = json.areas.map((a) => a.id);
  const groups = groupByArea(presets, (it) => it.path, (id) => edges.get(id), order);
  assert.equal(groups.reduce((n, g) => n + g.items.length, 0), presets.length);
  assert.deepEqual(groups.map((g) => g.area), order.filter((a) => groups.some((g) => g.area === a)));   // the network's order
  const where = (id) => groups.find((g) => g.items.some((it) => it.preset === id)).area;
  assert.equal(where('pgh-three-rivers'), 'core');
  assert.equal(where('pgh-schenley'), 'oakland');
  assert.equal(where('pgh-dirty-dozen'), 'slopes');
  assert.equal(where('pgh-highland-park'), 'eastend');
  // within an area, the presets keep their order
  for (const g of groups) assert.deepEqual(g.items, presets.filter((p) => g.items.includes(p)));
  // a route with no known segments goes last, on its own
  const lost = { id: 'x', path: [] };
  assert.equal(groupByArea([lost, presets[0]], (it) => it.path, (id) => edges.get(id), order).at(-1).area, null);
  // every area is named in the network (the headings)
  for (const a of json.areas) assert.ok(a.name, a.id);
});

test('the panel map zooms about the finger and pans within the map (F102)', async () => {
  const { zoomProjection, zoomAt, panBy, MAP_ZOOM_MAX } = await import('../js/city-routes.js');
  const lines = json.edges.map((e) => ({ id: e.id, lat: [40.40 + (e.lengthM % 97) / 1000, 40.46], lon: [-80.02, -79.93 + (e.lengthM % 89) / 1000] }));
  const w = 390, h = 220, P = fitProjection(lines, w, h, 12);
  assert.equal(zoomProjection(P, w, h, { k: 1 }), P);   // the whole map
  // the point under the finger stays put
  const lat = 40.44, lon = -79.96, px = P.X(lon), py = P.Y(lat);
  const v = zoomAt({ k: 1 }, w, h, px, py, 3);
  const Z = zoomProjection(P, w, h, v);
  assert.equal(v.k, 3);
  assert.ok(Math.abs(Z.X(lon) - px) < 1e-6 && Math.abs(Z.Y(lat) - py) < 1e-6);
  assert.ok(Math.abs(Z.scale - P.scale * 3) < 1e-9);
  // never past the map's edges, never out past the whole map, never deeper than the limit
  const far = panBy(v, w, h, 5000, -5000);
  assert.ok(far.ox >= w / 2 / far.k - 1e-9 && far.oy <= h - h / 2 / far.k + 1e-9);
  assert.deepEqual(zoomAt(v, w, h, 10, 10, 0.01), { k: 1, ox: w / 2, oy: h / 2 });
  assert.equal(zoomAt(v, w, h, px, py, 100).k, MAP_ZOOM_MAX);
  // a tap 22 px from a line at k 3 is 7 px of the whole map: lines 3× further apart
  assert.ok(Math.abs(Z.X(lon + 0.001) - Z.X(lon) - 3 * (P.X(lon + 0.001) - P.X(lon))) < 1e-6);
});
