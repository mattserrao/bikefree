// PGH's bridges as models (user, 21 Nov: "work on all bridge models; ensure the 3 sister bridges are high quality"):
// every river crossing (and the big ravine spans) in PGH's box, each with its real structure — the Three Sisters'
// eyebar chains, the bowstring arches, Smithfield's lenticular trusses, the deck arches of the 40th Street and Liberty
// bridges, the trusses — on its OSM centreline. js/world/graph-bridges.js builds them; a bridge PGH rides is built
// round the ridden deck (its heights), the others (scenery: PGH has no road onto them) on their OSM line between the
// banks.
//   node tools/pgh_bridges.mjs → routes/cities/pgh-bridges.json
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pgh = JSON.parse(readFileSync(resolve(root, 'routes/cities/pgh.json'), 'utf8'));
let box = [90, -90, 180, -180];
for (const n of pgh.nodes) box = [Math.min(box[0], n.lat), Math.max(box[1], n.lat), Math.min(box[2], n.lon), Math.max(box[3], n.lon)];

// name → structure. style: what js/world/graph-bridges.js draws; colour: the paint; width: m, kerb to kerb of the
// roadway (sidewalks are the model's); decks: 2 = double-deck; spans: the river spans' share of the structure
// (the side spans and the main span) where the style needs it. The facts: pghbridges.com, HAER, Wikipedia.
const GOLD = '#d4a22c';
const BRIDGES = [
  // Allegheny River
  { name: 'Roberto Clemente Bridge', style: 'sister', color: GOLD, width: 11, lengthM: 269, mainM: 131, note: 'Sixth Street, 1928: self-anchored eyebar suspension, three spans (68.5 + 131 + 68.5 m)' },
  { name: 'Andy Warhol Bridge', style: 'sister', color: GOLD, width: 11, lengthM: 269, mainM: 131, note: 'Seventh Street, 1926' },
  { name: 'Rachel Carson Bridge', style: 'sister', color: GOLD, width: 11, lengthM: 256, mainM: 131, note: 'Ninth Street, 1927' },
  { name: 'Fort Duquesne Bridge', style: 'tied-arch', color: GOLD, width: 22, decks: 2, riseM: 32, note: '1969: double-deck steel tied (bowstring) arch, 130 m' },
  { name: 'Veterans Bridge', style: 'girder', color: '#6f8796', width: 26, note: '1987: continuous steel girders on concrete piers' },
  { name: 'David McCullough Bridge', style: 'through-arch', color: GOLD, width: 14, pylons: 'sphere', note: '16th Street, 1923: steel arches, granite pylons with bronze armillary spheres and winged horses' },
  { name: '31st Street Bridge', style: 'through-arch', color: GOLD, width: 13, note: '1928: steel through arch' },
  { name: '30th Street Bridge', style: 'girder', color: '#8a8e91', width: 9, note: 'to Herrs Island' },
  { name: 'Washington Crossing Bridge;40th Street Bridge', alias: ['40th Street Bridge'], style: 'deck-arch', color: '#8fb3cf', width: 12, arches: 3, pylons: 'obelisk', note: '1924: three open-spandrel deck arches (98 + 108 + 98 m), light blue, granite pylons and obelisks' },
  { name: 'Senator Robert D. Fleming Bridge', alias: ['62nd Street Bridge'], style: 'truss', color: '#7d8791', width: 14, note: '62nd Street, 1962: continuous through truss' },
  { name: 'Highland Park Bridge', style: 'deck-truss', color: '#6f8f86', width: 16, note: '1939: continuous deck truss' },
  { name: 'Fort Wayne Bridge', alias: ['Fort Wayne Railroad Bridge'], style: 'truss', color: '#3e4246', width: 10, decks: 2, rail: true, note: '1904: double-deck through truss (rail)' },
  { name: '33rd Street Bridge', style: 'truss', color: '#3e4246', width: 8, rail: true, note: 'rail truss' },
  { name: 'Brilliant Branch Railroad Bridge', alias: ['Brilliant Branch Bridge'], style: 'truss', color: '#3e4246', width: 8, rail: true, note: 'rail truss' },
  // Monongahela River
  { name: 'Fort Pitt Bridge', style: 'tied-arch', color: GOLD, width: 22, decks: 2, riseM: 36, note: '1959: double-deck bowstring arch, 229 m' },
  { name: 'Smithfield Street Bridge', style: 'lenticular', color: '#3f6f9c', accent: '#c9a24a', width: 8.5, note: '1883 (Lindenthal): two lenticular (Pauli) truss spans of 110 m, blue with gold, cast portals' },
  { name: 'Panhandle Bridge', style: 'truss', color: '#7d8791', width: 9, rail: true, note: '1903: through truss (the T)' },
  { name: 'Liberty Bridge', style: 'deck-arch', color: '#8a8e91', width: 14, arches: 2, cantilever: true, note: '1928: deck spandrel-braced arch (cantilever)' },
  { name: 'South 10th Street Bridge', style: 'suspension', color: '#5f7f9a', width: 12, towerM: 35, note: '1933: wire-cable suspension, 116 ft towers' },
  { name: 'Birmingham Bridge', style: 'tied-arch', color: '#6f8091', width: 20, riseM: 30, note: '1976: bowstring arch' },
  { name: 'Hot Metal Bridge', style: 'truss', color: '#3e4246', width: 9, pair: true, note: '1887/1900: two Parker through trusses side by side on shared piers' },
  { name: 'Hot Metal Bike/Pedestrian Bridge', style: 'truss', color: '#3e4246', width: 5, note: 'the old hot-metal rail span, now the trail' },
  { name: 'Glenwood Bridge', style: 'glenwood', color: '#7d8791', width: 17, note: '1966: welded deck truss that rises through the deck over the piers' },
  { name: 'Glenwood B&O Railroad Bridge', alias: ['W&P Subdivision'], style: 'truss', color: '#3e4246', width: 8, rail: true, note: '1884/1915: Pratt through truss' },
  { name: 'Homestead Grays Bridge', style: 'deck-truss', color: '#5f7f9a', width: 14, wichert: true, note: '1937: Wichert continuous deck truss, ~30 m over the river' },
  // Ohio River
  { name: 'West End Bridge', style: 'tied-arch', color: GOLD, width: 18, riseM: 46, note: '1932: steel tied arch, 238 m' },
  { name: 'McKees Rocks Bridge', style: 'through-arch', color: '#5f7f9a', width: 13, note: '1931: steel through arch' },
  // ravines
  { name: 'Bloomfield Bridge', style: 'deck-truss', color: '#7d8791', width: 14, note: '1986: over the Skunk Hollow ravine' },
  { name: 'Davis Avenue Bridge', style: 'girder', color: '#8a8e91', width: 5, note: 'footbridge over Riverview Park' },
];

// OSM: the bridge ways (and the man_made=bridge outlines); the main roads (the bridges' approaches: below)
const nodes = new Map(), ways = [], roads = new Map();
const ROAD_KINDS = /^(motorway|trunk|primary|secondary)(_link)?$/;
const dir = resolve(root, 'tools/.cache/osm-pgh');
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.osm')) continue;
  const txt = readFileSync(resolve(dir, f), 'utf8');
  for (const m of txt.matchAll(/<node id="(\d+)"[^>]*lat="([-\d.]+)" lon="([-\d.]+)"/g)) nodes.set(m[1], [+m[2], +m[3]]);
  for (const m of txt.matchAll(/<way id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g)) {
    const tags = {}; for (const t of m[2].matchAll(/k="([^"]*)" v="([^"]*)"/g)) tags[t[1]] = t[2];
    const refs = [...m[2].matchAll(/<nd ref="(\d+)"/g)].map((x) => x[1]);
    if (ROAD_KINDS.test(tags.highway || '') && !roads.has(m[1])) roads.set(m[1], { id: m[1], tags, refs });
    if (!tags.bridge || tags.bridge === 'no') continue;
    ways.push({ id: m[1], tags, refs });
  }
}
const seen = new Set();
const uniq = ways.filter((w) => !seen.has(w.id) && seen.add(w.id));
const M_LAT = 111320, M_LON = 111320 * Math.cos(40.44 * Math.PI / 180);
const dist = (a, b) => Math.hypot((a[0] - b[0]) * M_LAT, (a[1] - b[1]) * M_LON);
const lenOf = (pts) => pts.reduce((s, p, i) => s + (i ? dist(pts[i - 1], p) : 0), 0);
const RANK = { motorway: 0, trunk: 0, primary: 0, secondary: 0, tertiary: 0, residential: 1, unclassified: 1, rail: 0, light_rail: 0, cycleway: 2, footway: 3, path: 3 };

const out = { format: 'bikefree-bridges-1', note: 'tools/pgh_bridges.mjs: PGH\'s bridges, their structure and their OSM centreline (lat, lon)', bridges: [] };
for (const b of BRIDGES) {
  const names = [b.name, ...(b.alias || [])];
  const mine = uniq.filter((w) => names.includes(w.tags['bridge:name']) || names.includes(w.tags.name)).map((w) => ({ ...w, pts: w.refs.map((r) => nodes.get(r)).filter(Boolean) }))
    .filter((w) => w.pts.length >= 2 && !w.tags.man_made);
  if (!mine.length) { console.log(`  ${b.name}: not in OSM's PGH tiles`); continue; }
  const rank = (w) => RANK[w.tags.highway || w.tags.railway] ?? 4;
  const best = Math.min(...mine.map(rank));
  const pool = mine.filter((w) => rank(w) === best);
  // chain the main ways end to end (a carriageway in pieces), from the longest; the other direction's carriageway
  // (a dual one) runs alongside and is left out
  pool.sort((p, q) => lenOf(q.pts) - lenOf(p.pts));
  let chain = pool[0].pts.slice();
  const used = new Set([pool[0].id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const w of pool) {
      if (used.has(w.id)) continue;
      const a = w.pts[0], z = w.pts[w.pts.length - 1], h = chain[0], t = chain[chain.length - 1];
      // joins at an end and heads on (not back along the chain: that's the other carriageway)
      const ok = (p, q) => dist(p, q) < 3;
      if (ok(a, t) && dist(z, chain[0]) > lenOf(chain) * 0.5) { chain = chain.concat(w.pts.slice(1)); used.add(w.id); grew = true; }
      else if (ok(z, h) && dist(a, t) > lenOf(chain) * 0.5) { chain = w.pts.slice(0, -1).concat(chain); used.add(w.id); grew = true; }
    }
  }
  // a dual carriageway (one OSM way each direction, Smithfield's, the forts'): the spine is the middle of the two
  {
    const other = pool.filter((w) => !used.has(w.id) && lenOf(w.pts) > lenOf(chain) * 0.4);
    if (other.length) {
      const near = (p) => { let best = null; for (const w of other) for (let i = 0; i + 1 < w.pts.length; i++) {
        const a = w.pts[i], b = w.pts[i + 1], ax = (a[1] - p[1]) * M_LON, az = (a[0] - p[0]) * M_LAT, bx = (b[1] - p[1]) * M_LON, bz = (b[0] - p[0]) * M_LAT;
        const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, -(ax * dx + az * dz) / (dx * dx + dz * dz || 1))), qx = ax + dx * t, qz = az + dz * t, d = Math.hypot(qx, qz);
        if (!best || d < best.d) best = { d, qx, qz }; } return best; };
      const offs = chain.map(near).filter((o) => o && o.d > 2.5 && o.d < 22);
      if (offs.length > chain.length * 0.6) {
        chain = chain.map((p) => { const o = near(p); return o && o.d > 2.5 && o.d < 22 ? [p[0] + o.qz / 2 / M_LAT, p[1] + o.qx / 2 / M_LON] : p; });
        console.log(`    ${b.name}: centred between its two carriageways (${(offs.reduce((a, o) => a + o.d, 0) / offs.length).toFixed(1)} m apart)`);
      }
    }
  }
  const mid = chain[Math.floor(chain.length / 2)];
  if (mid[0] < box[0] - 0.01 || mid[0] > box[1] + 0.01 || mid[1] < box[2] - 0.01 || mid[1] > box[3] + 0.01) { console.log(`  ${b.name}: outside PGH`); continue; }
  // the other ways (sidewalks, a cycleway, the other carriageway): which side of the spine and how far, so the model
  // takes them in (a ridden walkway beside the roadway, e.g. Smithfield's trail, the Fort Duquesne cycleway)
  const extra = mine.filter((w) => !used.has(w.id)).map((w) => ({ kind: w.tags.highway || w.tags.railway || '', pts: w.pts.map(([la, lo]) => [+la.toFixed(6), +lo.toFixed(6)]) }));
  out.bridges.push({ ...b, path: chain.map(([la, lo]) => [+la.toFixed(6), +lo.toFixed(6)]), lengthOsm: Math.round(lenOf(chain)), extra });
  console.log(`  ${b.name}: ${b.style}, ${Math.round(lenOf(chain))} m (${used.size} way${used.size > 1 ? 's' : ''}, +${extra.length} beside)`);
}
// ---------------------------------------------------------------- approaches
// (user, 21 Nov: "bridge near the point that isn't connected to anything") A bridge PGH doesn't ride (the Fort Duquesne,
// the Fort Pitt: interstates) stopped where OSM's bridge way stops — mid-river at the Fort Duquesne, whose viaducts carry
// on to the Point's interchange. The approaches: from each such bridge's ends, the main roads joined to it (motorways,
// trunks, their ramps; primary and secondary roads PGH doesn't have) followed out while they are bridges (viaducts,
// ramps), then on at grade until they meet a road PGH has (or 300 m, or a tunnel's mouth). js/world/graph-bridges.js
// draws the viaducts (decks on girders and bents) and the stretches at grade (asphalt on the ground).
{
  // PGH's ways (where an approach lands): every 10 m sample, gridded
  const G = new Map(), gk = (la, lo) => `${Math.floor(la * 2000)},${Math.floor(lo * 2000)}`;
  for (const e of pgh.edges) {
    if (e.kind === 'path') continue;
    let la = 0, lo = 0;
    for (let i = 0; i < e.lat.length; i++) { la += e.lat[i]; lo += e.lon[i]; const p = [la * 1e-6, lo * 1e-6], k = gk(...p); if (!G.has(k)) G.set(k, []); G.get(k).push(p, e.name || ''); }
  }
  const pghNear = (p, r = 9) => { const [a, b] = gk(...p).split(',').map(Number); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const L = G.get(`${a + i},${b + j}`); if (L) for (let q = 0; q < L.length; q += 2) if (dist(L[q], p) < r) return L[q + 1] || true; } return null; };
  const isPgh = (w) => { const pts = w.refs.map((r) => nodes.get(r)).filter(Boolean); if (pts.length < 2) return false; let hit = 0; for (const p of pts) if (pghNear(p, 6)) hit++; return hit >= pts.length * 0.7; };
  const byNode = new Map();
  for (const w of roads.values()) for (const r of w.refs) { if (!byNode.has(r)) byNode.set(r, []); byNode.get(r).push(w); }
  const bridgeWayIds = new Set(), bridgeNodes = new Map();   // node → the bridge it ends (its chain's ways' nodes)
  for (const b of out.bridges) {
    const names = new Set([b.name, ...(b.alias || [])]);
    for (const w of uniq) if (names.has(w.tags['bridge:name']) || names.has(w.tags.name)) { bridgeWayIds.add(w.id); for (const r of w.refs) bridgeNodes.set(r, b.name); }
  }
  // seeds: the main roads leaving a scenery bridge's ways (a bridge PGH rides is reached by PGH's own roads)
  const ridden = new Set(out.bridges.filter((b) => pgh.edges.some((e) => e.name === b.name && e.kind !== 'path' && e.bridges?.length)).map((b) => b.name));
  const nodeIdx = new Map(), nodesOut = [], waysOut = [], taken = new Set();
  const nodeOf = (r, fixed) => { if (!nodeIdx.has(r)) { const [la, lo] = nodes.get(r); nodeIdx.set(r, nodesOut.length); nodesOut.push([+la.toFixed(6), +lo.toFixed(6), fixed || 0]); } const k = nodeIdx.get(r); if (fixed) nodesOut[k][2] = fixed; return k; };
  const queue = [];
  // (only a bridge whose ends don't already meet PGH's roads: one an approach must carry on from)
  const loose = new Set(out.bridges.filter((b) => !ridden.has(b.name) && [b.path[0], b.path[b.path.length - 1]].some((p) => !pghNear(p, 25))).map((b) => b.name));
  for (const [r, name] of bridgeNodes) {
    if (!loose.has(name)) continue;
    for (const w of byNode.get(r) || []) if (!bridgeWayIds.has(w.id)) queue.push({ w, from: r, run: 0, grade: 0, bridge: name });
  }
  const lanesOf = (t) => +t.lanes || (/link/.test(t.highway) ? 1 : t.oneway === 'yes' ? 2 : 2);
  while (queue.length) {
    const { w, from, run, grade, bridge } = queue.shift();
    if (taken.has(w.id) || bridgeWayIds.has(w.id)) continue;
    if (w.tags.tunnel && w.tags.tunnel !== 'no') continue;
    if (isPgh(w)) continue;   // (a road PGH has: the approach has landed)
    const onBridge0 = w.tags.bridge && w.tags.bridge !== 'no';
    if (!onBridge0 && grade > 0) continue;   // (at grade: one way on from the last viaduct, no further)
    if (!onBridge0 && !/^(motorway|trunk)/.test(w.tags.highway) && !(w.tags.layer > 0)) continue;   // (a street at grade: left to the city)
    taken.add(w.id);
    // walk the way from the node it was reached at
    const refs = w.refs[0] === from ? w.refs : w.refs[w.refs.length - 1] === from ? w.refs.slice().reverse() : w.refs;
    const onBridge = w.tags.bridge && w.tags.bridge !== 'no';
    let d = 0, cut = refs.length, landed = false;
    for (let i = 1; i < refs.length; i++) {
      const a = nodes.get(refs[i - 1]), z = nodes.get(refs[i]); if (!a || !z) { cut = i; break; }
      d += dist(a, z);
      if (!onBridge && pghNear(z, 9)) { cut = i + 1; landed = true; break; }
      if (!onBridge && grade + d > 160) { cut = i + 1; break; }
    }
    const use = refs.slice(0, cut).filter((r) => nodes.has(r));
    if (use.length < 2) continue;
    const ks = use.map((r, i) => nodeOf(r, bridgeNodes.has(r) && !bridgeWayIds.has(w.id) && i === 0 ? 1 : 0));
    if (!onBridge) nodesOut[ks[ks.length - 1]][2] = landed || cut < refs.length ? 2 : nodesOut[ks[ks.length - 1]][2];   // (2: on the ground)
    if (bridgeNodes.has(use[0])) nodesOut[ks[0]][2] = 1;   // (1: on a bridge's end: its deck's height)
    waysOut.push({ n: ks, bridge: onBridge ? 1 : 0, lanes: lanesOf(w.tags), link: /link/.test(w.tags.highway) ? 1 : 0, layer: +w.tags.layer || 0, bridgeName: bridge });
    if (run + d > 3000 || !onBridge) continue;   // (a viaduct is followed to the ground: cut short it would hang in the air)
    const end = use[use.length - 1];
    for (const v of byNode.get(end) || []) if (!taken.has(v.id)) queue.push({ w: v, from: end, run: run + d, grade: onBridge ? 0 : grade + d, bridge });
  }
  // a node where a viaduct meets a stretch at grade sits on the ground
  const touch = new Map();
  waysOut.forEach((w) => { for (const k of [w.n[0], w.n[w.n.length - 1]]) { if (!touch.has(k)) touch.set(k, []); touch.get(k).push(w); } });
  for (const [k, list] of touch) if (!nodesOut[k][2] && list.some((w) => !w.bridge) && list.some((w) => w.bridge)) nodesOut[k][2] = 2;
  out.approaches = { note: 'the scenery bridges\' approaches: nodes [lat, lon, fixed (1: a bridge end, 2: on the ground)], ways (n: node indices; bridge: a viaduct)', nodes: nodesOut, ways: waysOut };
  const lenOfWay = (w) => w.n.reduce((a, k, i) => a + (i ? dist(nodesOut[w.n[i - 1]], nodesOut[k]) : 0), 0);
  const per = new Map(); for (const w of waysOut) per.set(w.bridgeName, (per.get(w.bridgeName) || 0) + lenOfWay(w));
  for (const [k, v] of per) console.log(`    ${k}: ${Math.round(v)} m`);
  console.log(`  approaches: ${waysOut.length} ways, ${Math.round(waysOut.filter((w) => w.bridge).reduce((a, w) => a + lenOfWay(w), 0))} m of viaduct, ${Math.round(waysOut.filter((w) => !w.bridge).reduce((a, w) => a + lenOfWay(w), 0))} m at grade`);
}
writeFileSync(resolve(root, 'routes/cities/pgh-bridges.json'), JSON.stringify(out));
console.log(`bridges: ${out.bridges.length} → routes/cities/pgh-bridges.json`);
