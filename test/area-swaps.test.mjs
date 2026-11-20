// Smoother area swaps (PLAN 6.2, PLAN 5.4's city of areas): the route ribbon fades into the street where an apron
// ends mid-street (F133, js/world/road-align.js apronFades), each area keeps its own baked light and the swap shows
// it (F32, js/world/toolbox/atmosphere/baked-light.js), and the people and traffic are carried across a swap (F31:
// test/city-life-network.test.mjs rides it through the portals).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalogRoute } from '../js/routes.js';
import { makeProjection, makeRouteIndex } from '../js/world/geo.js';
import { apronFades, denseRoad } from '../js/world/road-align.js';
import { makeCityLandscape, cityStreets } from '../js/world/toolbox/city/landscape.js';

// (world.js and the bake draw on canvases at import or build: a stand-in is enough here)
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: () => () => {} }) }) };
const { streetWidthAt } = await import('../js/world/world.js');
const { BakedLighting } = await import('../js/world/toolbox/atmosphere/baked-light.js');

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/** A straight line east, `m` metres in 10 m samples, with the city data's aprons and ghosts. */
function line(m, city) {
  const n = m / 10 + 1, dist = Float64Array.from({ length: n }, (_, i) => i * 10);
  const route = { dist, ele: new Float64Array(n), scene: { city } };
  return { route, index: { xs: Float64Array.from(dist), zs: new Float64Array(n) }, n };
}

test('F133: an apron that ends mid-street fades over its last 50 m to the street\'s width; a portal end does not', () => {
  // a line 0–3000 m: an apron at its start (0–400, the portal at 400) and one ending at a ghost (2000–2400, then a ghost back)
  const { route, index, n } = line(3000, { routeAprons: [{ fromM: 0, toM: 400 }, { fromM: 2000, toM: 2400 }], routeGhosts: [{ fromM: 2400, toM: 3000 }] });
  const f = apronFades(route, index, n, { roadWidth: 7, fadeM: 50, widthAt: () => 5 });
  assert.deepEqual(f.ends.map((e) => [e.atM, e.toward]), [[0, 1], [2400, -1]], 'the line\'s start and the end before the ghost (not the portals at 400 and 2000)');
  const at = (m) => m / 10;
  assert.equal(f.alpha[at(0)], 0); assert.equal(f.alpha[at(2400)], 0);
  assert.equal(f.alpha[at(50)], 1); assert.equal(f.alpha[at(2350)], 1);
  assert.ok(f.alpha[at(20)] > 0 && f.alpha[at(20)] < f.alpha[at(30)] && f.alpha[at(30)] < 1, 'eased in between');
  assert.ok(Math.abs(f.half[at(0)] - 2.5) < 1e-6 && Math.abs(f.half[at(2400)] - 2.5) < 1e-6, 'the street\'s half width at the ends');
  assert.ok(f.half[at(100)] === 3.5 && f.half[at(1000)] === 3.5 && f.alpha[at(1000)] === 1, 'the road as it was away from the ends');
  // a street wider than the road: the road keeps its width and still fades
  const wide = apronFades(route, index, n, { roadWidth: 7, widthAt: () => 15 });
  assert.equal(wide.half[0], 3.5); assert.equal(wide.alpha[0], 0);
  // an end where another pass of the line is drawn (the line comes back to a portal there): no fade
  const back = line(3000, { routeAprons: [{ fromM: 2000, toM: 2400 }], routeGhosts: [{ fromM: 2400, toM: 2600 }] });
  back.index.xs[300] = 2400; back.index.zs[300] = 4;   // (the line's last sample passes 4 m from the apron's end)
  assert.equal(apronFades(back.route, back.index, back.n), null);
  // no aprons: nothing
  assert.equal(apronFades(line(500, {}).route, line(500, {}).index, 51), null);
});

test('F133: Pittsburgh\'s apron ends fade into the street they end on, at its own width', () => {
  const catalog = JSON.parse(read('routes/catalog.json')), net = JSON.parse(read('routes/cities/pittsburgh-network.json'));
  const proj = makeProjection(net.origin.lat, net.origin.lon);
  const want = { westend: [[0, 7.5], [4300, 15]], oakland: [[0, 3.4], [14960, 11]] };   // (the Liberty Bridge ramp / West End Bridge; Second Ave's trail / Forbes)
  for (const [id, ends] of Object.entries(want)) {
    const it = catalog.find((c) => c.id === net.areas.find((a) => a.id === id).catalogId);
    const r = buildCatalogRoute(read(it.file), it);
    const sc = JSON.parse(read(it.scene)); sc.city = JSON.parse(read(sc.cityData)); r.scene = sc;
    const ix = makeRouteIndex(r, proj), L = makeCityLandscape(sc, proj, ix, r);
    cityStreets(L, ix, r);
    const [dr, di] = denseRoad(r, ix), n = dr.turnIdx ? dr.turnIdx + 1 : dr.dist.length;
    const f = apronFades(dr, di, n, { roadWidth: 7, widthAt: streetWidthAt(L) });
    assert.deepEqual(f.ends.map((e) => [e.atM, e.streetW]), ends, `${id}: apron ends and the street widths there`);
    for (const e of f.ends) {
      assert.equal(f.alpha[e.i], 0, `${id} ${e.atM}: gone at the end`);
      assert.ok(Math.abs(f.half[e.i] - Math.min(7, e.streetW) / 2) < 1e-6, `${id} ${e.atM}: the street's width at the end`);
    }
    // only the last 50 m of each end change
    for (let j = 0; j < n; j++) if (f.ends.every((e) => Math.abs(dr.dist[j] - e.atM) > 50.01)) assert.ok(f.alpha[j] === 1 && f.half[j] === 3.5, `${id}: unchanged at ${dr.dist[j]} m`);
  }
});

/** A bake's maps as the bake makes them (render targets: dispose() counted). */
const maps = (tag) => { const t = (k) => ({ texture: { tag: `${tag}.${k}` }, disposed: 0, dispose() { this.disposed++; } }); return { sun: t('sun'), ao: t('ao'), box: [1, 2, 3, 4], K: [5, 6, 7, 8], sig: tag }; };

test('F32: each area keeps its own bake; a swap shows the new area\'s (baked ahead), or the old one\'s until its own is done', () => {
  const logs = [];
  const world = { area: { id: 'core' }, renderer: {}, log: (...a) => logs.push(a.join(' ')) };
  const B = new BakedLighting(world, { baked: 'midday' }, { midday: { elev: 58, az: 180 } });
  const core = maps('core'), north = maps('north'), north2 = maps('north2');
  // the drawn area's bake, and one baked ahead for the north side (as the bake's swap-in step stores them)
  B._state('core').res = core; B._show(core);
  B._state('north').res = north; B._state('north').bakedSig = 'north'; B._state('north').sig = 'north';
  assert.equal(B.uniforms.bfBakeSun.value.tag, 'core.sun');
  B._sig = 'core'; B._bakedSig = 'core';
  B.useArea('north', 'core');
  assert.equal(B.uniforms.bfBakeSun.value.tag, 'north.sun', 'the swap shows the area\'s own bake');
  assert.equal(B._bakedSig, 'north', 'its static set counts as baked (no re-bake unless it changes)');
  assert.deepEqual(B.swaps.map((s) => [s.id, s.prebaked]), [['north', true]]);
  // swapping back: the core's bake was kept
  B.useArea('core', 'north');
  assert.equal(B.uniforms.bfBakeSun.value.tag, 'core.sun');
  assert.equal(B._bakedSig, 'core');
  // into an area with no bake yet: the old one stays in use (it is the same streets there) and is not freed while shown
  B.useArea('oakland', 'core');
  assert.equal(B.uniforms.bfBakeSun.value.tag, 'core.sun');
  assert.equal(B.swaps.at(-1).prebaked, false);
  B.releaseArea('core');
  assert.equal(core.sun.disposed, 0, 'the core\'s maps are still shown: kept');
  const oak = maps('oakland'); B._state('oakland').res = oak; B._show(oak);
  assert.equal(core.sun.disposed + core.ao.disposed, 2, 'freed once the area\'s own bake is shown');
  // an area no longer near lets its bake go (_bakeAhead), and a released one too
  world._bakeAhead = () => [];
  B._bakeAhead();
  assert.equal(north.sun.disposed, 1, 'the north side\'s bake let go: not listed any more');
  B._state('north').res = north2; B.releaseArea('north');
  assert.equal(north2.sun.disposed, 1);
  B.dispose();
  assert.equal(oak.sun.disposed, 1, 'dispose frees what is shown');
});

// ---------------------------------------------------------------- [F220] a turn into an area never built: no blank screen
const { loadNetwork, NetRide, optionsAt } = await import('../js/network.js');
const { World, areaChoice } = await import('../js/world/world.js');
let _pgh = null;
/** Pittsburgh's network with every area's line (no scenery). */
function pittsburgh() {
  if (_pgh) return _pgh;
  const catalog = JSON.parse(read('routes/catalog.json')), json = JSON.parse(read('routes/cities/pittsburgh-network.json'));
  const base = new Map(json.areas.map((a) => { const it = catalog.find((c) => c.id === a.catalogId); const r = buildCatalogRoute(read(it.file), it); r.scene = { city: JSON.parse(read(JSON.parse(read(it.scene)).cityData)) }; return [a.id, r]; }));
  return (_pgh = loadNetwork(json, base));
}

test('F220: every way a choice can take into another area is built well ahead of where it is drawn (the world\'s need set)', () => {
  // for every junction and every arm: ride up to it straight on, choose the arm at the prompt (150 m before it, ~15 s at
  // 10 m/s), and look at each area the world then wants drawn: before the choice — 300 m before it is wanted (30 s at 10 m/s) (or from
  // the start of the way in) — it was already in the need set the world builds hidden (the path's areas within
  // 1.5 km, and every arm's of the junctions ahead: areasReachable)
  const net = pittsburgh(), LEAD = 300;   // (7.8c: REACH_M 300)
  let checked = 0, minLead = Infinity;
  for (const e of net.edges.values()) for (const dir of [1, -1]) {
    const key = `${e.id}${dir > 0 ? '+' : '-'}`, len = e.len;
    for (const o of optionsAt(net, { e, dir })) {
      const ride = new NetRide(net, {}, { first: key });
      ride.update(len - 150);
      if (!ride.pick(o.key, len - 150)) assert.ok(same(ride.entries[1].t, o.t), `${key} → ${o.key}: picked`);
      let cur = ride.areaFor(len - 150, null);
      for (let q = len - 150; q < len + 1500 && q < ride.endOf(1); q += 10) {
        const want = ride.areaFor(q, cur);
        if (want === cur) continue;
        cur = want;
        const p1 = Math.max(0, q - LEAD);
        if (p1 >= len - 150) continue;   // (wanted more than LEAD after the choice: the chosen path's own areas cover it)
        const before = new NetRide(net, {}, { first: key });
        before.update(p1);
        const need = new Set([...before.areasNear(p1), ...before.areasReachable(p1)]);
        assert.ok(need.has(want), `${key} → ${o.key}: area ${want} wanted ${Math.round(q - len)} m past the junction, not in the need set ${Math.round(q - p1)} m before (${[...need]})`);
        checked++; minLead = Math.min(minLead, q - p1);
      }
    }
  }
  assert.ok(checked > 5, `swaps after a choice checked: ${checked}`);   // (7.8c: with a 300 m lead most swaps come after the choice, covered by the path's own areas)
  if (process.env.LIFE_SIM_REPORT) console.log('F220 swaps checked', checked, 'shortest lead', minLead);
});
const same = (a, b) => a.e === b.e && a.dir === b.dir;

test('F220: while the wanted area builds, the drawn one stays while it covers the rider; a fade only off its streets; a failed area never fades', () => {
  assert.equal(areaChoice({ want: 'a', current: 'a' }), 'stay');
  assert.equal(areaChoice({ want: 'b', current: 'a', ready: true }), 'swap');
  assert.equal(areaChoice({ want: 'b', current: 'a', ready: false, covers: true }), 'stay', 'on the apron: keep drawing');
  assert.equal(areaChoice({ want: 'b', current: 'a', ready: false, covers: false }), 'wait', 'off its streets: the fade');
  assert.equal(areaChoice({ want: 'b', current: 'a', ready: false, failed: true, covers: false }), 'stay', 'failed: no fade');
});

test('F220: an area that fails to load is not asked for again every frame (backoff, then given up)', async () => {
  let loads = 0;
  const w = Object.assign(Object.create(World.prototype), { areas: new Map(), log() {}, disposed: false,
    areaSet: { load: () => { loads++; return Promise.reject(new Error('offline')); } } });
  w._ensureArea('oakland');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(w.areas.has('oakland'), false);
  assert.equal(w._areaFailed('oakland'), true, 'marked failed');
  for (let k = 0; k < 5; k++) w._ensureArea('oakland');
  assert.equal(loads, 1, 'not loaded again while it is held back');
  // after the back-off it is tried again; after AREA_TRIES failures not again this ride
  for (let k = 0; k < 4; k++) { if (w._areaFails.get('oakland').until !== Infinity) w._areaFails.get('oakland').until = 0; w._ensureArea('oakland'); await new Promise((r) => setTimeout(r, 0)); }
  assert.equal(loads, 3);
  assert.equal(w._areaFails.get('oakland').until, Infinity);
});

test('F220: an area released half built (an arm not taken) disposes cleanly: its city has no life yet', async () => {
  const { CityScene } = await import('../js/world/toolbox/city/city.js');
  const THREE = await import('../vendor/three.module.min.js');
  const half = Object.assign(Object.create(CityScene.prototype), { group: new THREE.Group(), disposables: new Set() });
  assert.doesNotThrow(() => half.dispose());
  assert.doesNotThrow(() => Object.create(CityScene.prototype).dispose(), 'nothing built yet');
});
