// The Point's ground, dressed (user, 21 Nov: "examine the Point and fill this in with accurate materials and textures"):
// what OSM maps in Point State Park — the lawns (the Great Lawn, the Flag Bastion), gardens, woods and scrub, the
// concrete plazas, the fountain and the reflecting pool, the walkways, the retaining walls and low walls, the trees —
// as areas, lines and points for the world (js/world/graph-world.js) to drape over its ground.
//   node tools/pgh_dressing.mjs → routes/cities/pgh-dressing.json
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pgh = JSON.parse(readFileSync(resolve(root, 'routes/cities/pgh.json'), 'utf8'));
const AREAS = [{ name: 'Point State Park', box: [40.4393, -80.0168, 40.4452, -80.0072] }];
const inBox = (b, [la, lo]) => la >= b[0] && la <= b[2] && lo >= b[1] && lo <= b[3];
const nodes = new Map(), ways = new Map(), rels = [];
const dir = resolve(root, 'tools/.cache/osm-pgh');
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.osm')) continue;
  const txt = readFileSync(resolve(dir, f), 'utf8');
  for (const m of txt.matchAll(/<node id="(\d+)"[^>]*lat="([-\d.]+)" lon="([-\d.]+)"[^>]*?(\/>|>([\s\S]*?)<\/node>)/g)) {
    const tags = {}; for (const t of (m[5] || '').matchAll(/k="([^"]*)" v="([^"]*)"/g)) tags[t[1]] = t[2];
    nodes.set(m[1], { p: [+m[2], +m[3]], tags });
  }
  for (const m of txt.matchAll(/<way id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g)) {
    const tags = {}; for (const t of m[2].matchAll(/k="([^"]*)" v="([^"]*)"/g)) tags[t[1]] = t[2];
    ways.set(m[1], { refs: [...m[2].matchAll(/<nd ref="(\d+)"/g)].map((x) => x[1]), tags });
  }
}
const kindOf = (t) => t.amenity === 'fountain' ? 'fountain' : t.water === 'reflecting_pool' || (t.natural === 'water' && t.water !== 'river') ? 'pool'
  : t.area === 'yes' && (t.highway === 'pedestrian' || t.highway === 'footway') ? 'plaza' : t['area:highway'] ? 'plaza'
  : t.landuse === 'grass' ? 'lawn' : t.leisure === 'garden' ? 'garden' : t.natural === 'wood' ? 'wood' : t.natural === 'scrub' ? 'scrub'
  : t.leisure === 'park' ? 'park' : null;
const out = { format: 'bikefree-dressing-1', note: 'tools/pgh_dressing.mjs: OSM areas, lines and points of the dressed places (Point State Park)', places: AREAS.map((a) => a.name), areas: [], lines: [], trees: [] };
const r6 = ([la, lo]) => [+la.toFixed(6), +lo.toFixed(6)];
// PGH's own ways (a walkway PGH already rides is drawn by the world as a road)
const pghPts = new Set();
for (const e of pgh.edges) { let la = 0, lo = 0; for (let i = 0; i < e.lat.length; i++) { la += e.lat[i]; lo += e.lon[i]; pghPts.add(`${Math.round(la * 1e-6 * 20000)},${Math.round(lo * 1e-6 * 15000)}`); } }
const onPgh = ([la, lo]) => { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (pghPts.has(`${Math.round(la * 20000) + a},${Math.round(lo * 15000) + b}`)) return true; return false; };
for (const a of AREAS) {
  for (const [, w] of ways) {
    const pts = w.refs.map((r) => nodes.get(r)?.p).filter(Boolean);
    if (pts.length < 2 || !pts.some((p) => inBox(a.box, p))) continue;
    const t = w.tags, closed = w.refs[0] === w.refs[w.refs.length - 1];
    const k = closed ? kindOf(t) : null;
    if (k) { out.areas.push({ kind: k, name: t.name || '', pts: pts.map(r6) }); continue; }
    if (t.barrier === 'retaining_wall') out.lines.push({ kind: 'retaining_wall', pts: pts.map(r6) });
    else if (t.barrier === 'wall') out.lines.push({ kind: 'wall', pts: pts.map(r6) });
    else if (['footway', 'path', 'pedestrian', 'steps', 'cycleway'].includes(t.highway) && t.area !== 'yes') {
      const share = pts.filter(onPgh).length / pts.length;
      if (share < 0.6) out.lines.push({ kind: t.highway === 'steps' ? 'steps' : 'walk', width: t.highway === 'pedestrian' ? 6 : t.highway === 'steps' ? 4 : 3, pts: pts.map(r6) });
    }
  }
  for (const [, n] of nodes) if (n.tags.natural === 'tree' && inBox(a.box, n.p)) out.trees.push(r6(n.p));
}
writeFileSync(resolve(root, 'routes/cities/pgh-dressing.json'), JSON.stringify(out));
const c = (arr, k) => arr.filter((x) => x.kind === k).length;
console.log(`dressing (${out.places.join(', ')}): areas ${out.areas.length} (${['park', 'lawn', 'garden', 'wood', 'scrub', 'plaza', 'fountain', 'pool'].map((k) => `${k} ${c(out.areas, k)}`).join(', ')}), lines ${out.lines.length} (${['retaining_wall', 'wall', 'walk', 'steps'].map((k) => `${k} ${c(out.lines, k)}`).join(', ')}), trees ${out.trees.length}`);
