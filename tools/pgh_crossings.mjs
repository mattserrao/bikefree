// PGH's overpasses and underpasses (user, 21 Nov: "ID them and determine if they're implemented properly").
// A grade separation is two ways crossing in plan with no junction between them. Each is checked against how the
// 3D world draws it (js/world/graph-world.js): a way is a deck (1 m fascia, parapets, ground ≥ 7 m below) only on
// its `bridges` runs; anywhere else it hangs a 3.5 m skirt down to the ground — a wall across any way under it.
//   ok        the upper way is a deck over the lower way's full width (+ 2 m), ≥ 4.5 m above it
//   low       a deck 3.5–4.5 m above (tight: a rider's head is ~2.2 m up, the deck 1 m deep)
//   clash     a deck under 3.5 m above (a rider rides into it)
//   no-deck   ≥ 3.5 m apart, but the upper way is not a deck there: its skirt walls off the lower way
//   level     under 1 m apart, no junction: two ways through each other (a missing junction, or a lost bridge)
//   tunnel    the lower way is drawn as a deck (OSM: a tunnel) — open to the sky, with parapets
// …and junction kinks: a junction whose height pulls a way off its line (> 12 % over its first 20 m where the way
// beyond runs under 6 %): a junction set to a bridge's height, or the road under it.
//   node tools/pgh_crossings.mjs → tools/.cache/pgh-crossings.json
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeGraph } from '../js/graph.js';
import { routeUse } from './pgh_usage.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const json = JSON.parse(readFileSync(resolve(root, 'routes/cities/pgh.json'), 'utf8'));
const lines = JSON.parse(readFileSync(resolve(root, 'tools/.cache/pgh-routes.json'), 'utf8')).map((r) => r.line);
const G = decodeGraph(json);
const { use } = routeUse(json, lines);
const W = json.widths;
const kx = 111320 * Math.cos((40.44 * Math.PI) / 180), ky = 110540;
const X = (lo) => (lo + 80) * kx, Y = (la) => (la - 40.44) * ky;
const deckOf = (e) => { const d = new Uint8Array(e.n + 1); for (const [a, b] of e.bridges) for (let i = a + 1; i < b; i++) d[i] = 1; return d; };
const decks = new Map(G.edges.map((e) => [e.id, deckOf(e)]));

// OSM bridges and tunnels near a spot (the cached tiles): what the real way is
const osmGrid = new Map();
{
  const dir = resolve(root, 'tools/.cache/osm-pgh');
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.osm')) continue;
    const txt = readFileSync(resolve(dir, f), 'utf8');
    const nodes = new Map();
    for (const m of txt.matchAll(/<node id="(\d+)"[^>]*lat="([-\d.]+)" lon="([-\d.]+)"/g)) nodes.set(m[1], [+m[2], +m[3]]);
    for (const m of txt.matchAll(/<way id="\d+"[^>]*>([\s\S]*?)<\/way>/g)) {
      const body = m[1];
      if (!/k="highway"/.test(body)) continue;
      const br = /k="bridge" v="(?!no)/.test(body), tu = /k="tunnel" v="(?!no)/.test(body);
      if (!br && !tu) continue;
      const name = (body.match(/k="name" v="([^"]*)"/) || [])[1] || (body.match(/k="highway" v="([^"]*)"/) || [])[1];
      const refs = [...body.matchAll(/<nd ref="(\d+)"/g)].map((x) => nodes.get(x[1])).filter(Boolean);
      for (let i = 1; i < refs.length; i++) {
        const [a, b] = [refs[i - 1], refs[i]], L = Math.hypot((X(b[1]) - X(a[1])), (Y(b[0]) - Y(a[0]))), k = Math.max(1, Math.ceil(L / 5));
        for (let j = 0; j <= k; j++) {
          const x = X(a[1] + ((b[1] - a[1]) * j) / k), y = Y(a[0] + ((b[0] - a[0]) * j) / k), key = `${Math.floor(x / 20)},${Math.floor(y / 20)}`;
          (osmGrid.get(key) || osmGrid.set(key, []).get(key)).push([x, y, br ? 'bridge' : 'tunnel', name]);
        }
      }
    }
  }
}
const osmNear = (x, y, r = 12) => {
  const out = new Map();
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const [px, py, t, n] of osmGrid.get(`${Math.floor(x / 20) + i},${Math.floor(y / 20) + j}`) || []) if (Math.hypot(px - x, py - y) < r) out.set(t + ':' + n, { t, n });
  return [...out.values()];
};

// segment grid
const seg = new Map();
for (const e of G.edges) for (let i = 0; i < e.n; i++) {
  const x0 = X(e.lon[i]), y0 = Y(e.lat[i]), x1 = X(e.lon[i + 1]), y1 = Y(e.lat[i + 1]);
  for (let gx = Math.floor(Math.min(x0, x1) / 40); gx <= Math.floor(Math.max(x0, x1) / 40); gx++)
    for (let gy = Math.floor(Math.min(y0, y1) / 40); gy <= Math.floor(Math.max(y0, y1) / 40); gy++) (seg.get(gx + ',' + gy) || seg.set(gx + ',' + gy, []).get(gx + ',' + gy)).push([e, i]);
}
const N = new Map(json.nodes.map((n) => [n.id, n]));
const found = new Map();
for (const list of seg.values()) for (let p = 0; p < list.length; p++) for (let q = p + 1; q < list.length; q++) {
  const [a, i] = list[p], [b, j] = list[q];
  if (a === b) continue;
  const ax = X(a.lon[i]), ay = Y(a.lat[i]), bx = X(a.lon[i + 1]), by = Y(a.lat[i + 1]);
  const cx = X(b.lon[j]), cy = Y(b.lat[j]), dx = X(b.lon[j + 1]), dy = Y(b.lat[j + 1]);
  const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (Math.abs(den) < 1e-9) continue;
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den, u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) continue;
  const x = ax + t * (bx - ax), y = ay + t * (by - ay);
  // a shared junction near: not a separation (the ways meet there)
  const shared = [a.from, a.to].filter((n) => n === b.from || n === b.to);
  if (shared.some((n) => Math.hypot(X(N.get(n).lon) - x, Y(N.get(n).lat) - y) < 25)) continue;
  const key = [a.id, b.id].sort().join('|') + '|' + Math.round(x / 15) + ',' + Math.round(y / 15);
  if (found.has(key)) continue;
  const za = a.ele[i] + t * (a.ele[i + 1] - a.ele[i]), zb = b.ele[j] + u * (b.ele[j + 1] - b.ele[j]);
  const [up, ui, lo, li, zu, zl] = za >= zb ? [a, i + t, b, j + u, za, zb] : [b, j + u, a, i + t, zb, za];
  found.set(key, { x, y, up, ui, lo, li, dz: zu - zl, ang: Math.abs(Math.atan2(den, (bx - ax) * (dx - cx) + (by - ay) * (dy - cy))) });
}
const out = [];
for (const c of found.values()) {
  const { up, ui, lo, li, dz } = c;
  // the deck must cover the lower way's width (crossed at an angle) + 2 m each side
  const sinA = Math.max(0.3, Math.abs(Math.sin(c.ang)));
  const need = ((W[lo.kind] || 7) / 2 + 2) / sinA;
  const dU = decks.get(up.id), dL = decks.get(lo.id);
  const s0 = Math.max(0, Math.floor(ui - need / 10)), s1 = Math.min(up.n, Math.ceil(ui + need / 10));
  let covered = true; for (let k = s0; k <= s1; k++) if (!dU[k]) covered = false;
  const anyDeck = dU[Math.round(ui)] || dU[Math.floor(ui)] || dU[Math.ceil(ui)];
  const lowerDeck = dL[Math.round(li)];
  const osm = osmNear(c.x, c.y);
  const kind = dz < 1 ? 'level' : !covered ? 'no-deck' : dz < 3.5 ? 'clash' : dz < 4.5 ? 'low' : lowerDeck && osm.some((o) => o.t === 'tunnel') ? 'tunnel' : 'ok';
  const lat = c.y / ky + 40.44, lon = c.x / kx - 80;
  const ridden = use.get(up.id) === 0 || use.get(lo.id) === 0;
  const osmTxt = osm.length ? osm.map((o) => `${o.t} (${o.n})`).join(', ') : 'none';
  let fix = '';
  if (kind === 'level') fix = osm.length ? `OSM has a ${osm[0].t} here (${osm[0].n}): lift/lower it ≥ 4.5 m and make it a deck` : 'A level crossing with no junction: add a junction (or drop the minor way)';
  else if (kind === 'no-deck') fix = anyDeck ? `The deck ends too close: extend ${up.name}'s deck ${Math.round(need)} m either side` : osm.some((o) => o.t === 'bridge') ? `OSM has a bridge (${osm.find((o) => o.t === 'bridge').n}) but PGH lost it: make ${up.name} a deck here` : `Make ${up.name} a deck over ${lo.name} (an underpass)`;
  else if (kind === 'clash') fix = `Only ${dz.toFixed(1)} m: lower ${lo.name} or lift the deck to ≥ 4.5 m`;
  else if (kind === 'low') fix = `${dz.toFixed(1)} m: tight but rideable; ≥ 4.5 m preferred`;
  else if (kind === 'tunnel') fix = `${lo.name} is a tunnel drawn as an open deck: fine to ride; a roof/portal would be nicer`;
  out.push({ kind, lat: +lat.toFixed(6), lon: +lon.toFixed(6), upper: up.name, upperKind: up.kind, upperId: up.id, lower: lo.name, lowerKind: lo.kind, lowerId: lo.id,
    dz: +dz.toFixed(1), deck: !!anyDeck, covered, osm: osmTxt, ridden, fix });
}
// junction kinks
for (const [nid, n] of N) {
  for (const e of G.edges) for (const end of [0, 1]) {
    if ((end ? e.to : e.from) !== nid || e.n < 5) continue;
    const at = (k) => e.ele[end ? e.n - k : k];
    const near = Math.abs(at(2) - at(0)) / 20, beyond = Math.abs(at(Math.min(e.n, 5)) - at(2)) / ((Math.min(e.n, 5) - 2) * 10);
    if (near > 0.12 && beyond < 0.06) out.push({ kind: 'kink', lat: n.lat, lon: n.lon, upper: e.name, upperKind: e.kind, upperId: e.id, lower: n.name, lowerKind: '', lowerId: '',
      dz: +(at(2) - at(0)).toFixed(1), deck: false, covered: false, osm: osmNear(X(n.lon), Y(n.lat), 25).map((o) => `${o.t} (${o.n})`).join(', ') || 'none',
      ridden: use.get(e.id) === 0, fix: `${e.name} drops ${Math.abs(at(2) - at(0)).toFixed(1)} m in its last 20 m into ${n.name}: the junction sits at another way's height` });
  }
}
const count = {};
for (const o of out) count[o.kind] = (count[o.kind] || 0) + 1;
writeFileSync(resolve(root, 'tools/.cache/pgh-crossings.json'), JSON.stringify(out));
console.log('grade separations and junction kinks:', count, '· on a route:', out.filter((o) => o.ridden).length);
for (const k of ['level', 'no-deck', 'clash', 'low', 'tunnel', 'kink']) for (const o of out.filter((x) => x.kind === k).slice(0, 4))
  console.log(`  ${k.padEnd(7)} ${o.upper} over ${o.lower} · ${o.dz} m · OSM ${o.osm} · ${o.lat},${o.lon}${o.ridden ? ' · route' : ''}`);
