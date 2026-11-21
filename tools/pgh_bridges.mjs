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
  { name: 'Smithfield Street Bridge', style: 'lenticular', color: '#3f6f9c', accent: '#c9a24a', width: 14, note: '1883 (Lindenthal): two lenticular (Pauli) truss spans of 110 m, blue with gold, cast portals' },
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

// OSM: the bridge ways (and the man_made=bridge outlines)
const nodes = new Map(), ways = [];
const dir = resolve(root, 'tools/.cache/osm-pgh');
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.osm')) continue;
  const txt = readFileSync(resolve(dir, f), 'utf8');
  for (const m of txt.matchAll(/<node id="(\d+)"[^>]*lat="([-\d.]+)" lon="([-\d.]+)"/g)) nodes.set(m[1], [+m[2], +m[3]]);
  for (const m of txt.matchAll(/<way id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g)) {
    const tags = {}; for (const t of m[2].matchAll(/k="([^"]*)" v="([^"]*)"/g)) tags[t[1]] = t[2];
    if (!tags.bridge || tags.bridge === 'no') continue;
    ways.push({ id: m[1], tags, refs: [...m[2].matchAll(/<nd ref="(\d+)"/g)].map((x) => x[1]) });
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
  const mid = chain[Math.floor(chain.length / 2)];
  if (mid[0] < box[0] - 0.01 || mid[0] > box[1] + 0.01 || mid[1] < box[2] - 0.01 || mid[1] > box[3] + 0.01) { console.log(`  ${b.name}: outside PGH`); continue; }
  // the other ways (sidewalks, a cycleway, the other carriageway): which side of the spine and how far, so the model
  // takes them in (a ridden walkway beside the roadway, e.g. Smithfield's trail, the Fort Duquesne cycleway)
  const extra = mine.filter((w) => !used.has(w.id)).map((w) => ({ kind: w.tags.highway || w.tags.railway || '', pts: w.pts.map(([la, lo]) => [+la.toFixed(6), +lo.toFixed(6)]) }));
  out.bridges.push({ ...b, path: chain.map(([la, lo]) => [+la.toFixed(6), +lo.toFixed(6)]), lengthOsm: Math.round(lenOf(chain)), extra });
  console.log(`  ${b.name}: ${b.style}, ${Math.round(lenOf(chain))} m (${used.size} way${used.size > 1 ? 's' : ''}, +${extra.length} beside)`);
}
writeFileSync(resolve(root, 'routes/cities/pgh-bridges.json'), JSON.stringify(out));
console.log(`bridges: ${out.bridges.length} → routes/cities/pgh-bridges.json`);
