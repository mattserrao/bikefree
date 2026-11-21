// The riverbank as the world now draws it (js/world/graph-world.js: ground shaped by the shore lines, embankments and
// cuts), at the analysis spots of tools/pgh_riverbank.py — before/after numbers for F-PGH6.
//   node tools/pgh_riverbank_check.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTerrainGrid } from '../js/terrain-grid.js';
import { decodeTerrain } from '../js/world/toolbox/landscape/real-terrain.js';
import { makeProjection } from '../js/world/geo.js';
import { decodeGraph } from '../js/graph.js';
import { GraphWorld, roadHash, decodeShore } from '../js/world/graph-world.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const pgh = JSON.parse(readFileSync(resolve(root, 'routes/cities/pgh.json'), 'utf8'));
const proj = makeProjection(pgh.origin.lat, pgh.origin.lon);
const G = decodeGraph(pgh);
for (const e of G.edges) { e.x = new Float64Array(e.n + 1); e.z = new Float64Array(e.n + 1); for (let i = 0; i <= e.n; i++) { const q = proj.toLocal(e.lat[i], e.lon[i]); e.x[i] = q.x; e.z[i] = q.z; } }
const W = { pools: (pgh.pools || []).map((p) => { const a = proj.toLocal(p.box[0], p.box[1]), b = proj.toLocal(p.box[2], p.box[3]); return { level: p.level, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z) }; }), poolAt: GraphWorld.prototype.poolAt, ground: decodeTerrain(parseTerrainGrid(gunzipSync(readFileSync(resolve(root, pgh.ground)))), proj), shore: decodeShore(JSON.parse(readFileSync(resolve(root, pgh.shore), 'utf8')), proj),
  cut: roadHash(G.edges, pgh.widths), waterY: pgh.waterLevelM + 0.35 };
const H = (x, z) => GraphWorld.prototype._groundH.call(W, x, z);
const A = JSON.parse(readFileSync(resolve(root, 'tools/.cache/pgh-riverbank.json'), 'utf8'));
const pool0 = pgh.waterLevelM;
const tot = { spots: 0, walled: 0, wallSmeared: 0, lowBank: 0, before: { walledSmeared: 0, lowBank: 0 } };
const byArea = {}, drawn = [];
for (const s of A.spots) {
  const q = proj.toLocal(s.lat, s.lon), sh = W.shore.at(q.x, q.z), pool = W.poolAt(q.x, q.z), wy = pool + 0.35;
  if (!sh) continue;
  // the drawn profile across the nearest shore line, from 20 m out to 40 m in
  const L = W.shore.lines, nx0 = 0;
  // normal: from the shore lookup at two points
  let best = null;
  for (const Li of L) for (let i = 0; i < Li.n; i += 1) { const d = Math.hypot(Li.x[i] - q.x, Li.z[i] - q.z); if (!best || d < best.d) best = { d, L: Li, i }; }
  const { L: Ln, i } = best, nx = Ln.nx[i], nz = Ln.nz[i], x0 = Ln.x[i], z0 = Ln.z[i];
  const prof = []; for (let d = -20; d <= 40; d += 1) prof.push([d, H(x0 + nx * d, z0 + nz * d)]);
  let edge = -20; for (let k = prof.length - 1; k >= 0; k--) if (prof[k][1] < wy) { edge = prof[k][0] + 1; break; }   // (the water's edge: the land's side of the last wet point)
  const top = Math.max(...prof.filter(([d]) => d >= edge && d <= edge + 25).map(([, h]) => h));
  const spread = (prof.find(([d, h]) => d >= edge && h - wy >= 0.8 * (top - wy))?.[0] ?? 40) - edge;
  const h5 = H(x0 + nx * (edge + 5), z0 + nz * (edge + 5)) - pool;
  const walled = sh.walled;
  const area = (byArea[s.area] ||= { n: 0, walled: 0, smeared: 0, low: 0, smeared0: 0, low0: 0 });
  area.n++; tot.spots++;
  if (s.cls.includes('walled-smeared')) { area.smeared0++; tot.before.walledSmeared++; }
  if (s.cls.includes('low-bank')) { area.low0++; tot.before.lowBank++; }
  if (s.walled.length) { area.walled++; tot.walled++; if (spread > 8 && top - pool > 2) { area.smeared++; tot.wallSmeared++; } }
  if (h5 < 1.5) { area.low++; tot.lowBank++; if (process.env.DEBUG && s.area === process.env.DEBUG) console.log('low', s.lat, s.lon, 'edge', edge, 'h5', h5.toFixed(1), 'walled', walled, 's', sh.s.toFixed(1), 'top', (sh.top - pool).toFixed(1), prof.filter(([d]) => d % 5 === 0).map(([d, h]) => d + ':' + (h - pool).toFixed(1)).join(' ')); }
  const cls = [];
  if (s.walled.length && spread > 8 && top - pool > 2) cls.push('walled-smeared');
  if (h5 < 1.5) cls.push('low-bank');
  drawn.push({ lat: s.lat, lon: s.lon, area: s.area, cls, shift: 0, bank: +(top - pool).toFixed(1), spread, walled: s.walled, way: s.way, drawnWall: !!walled });
}
writeFileSync(resolve(root, 'tools/.cache/pgh-riverbank-drawn.json'), JSON.stringify({ spots: drawn }));
console.log(`riverbank as drawn: ${tot.spots} spots · walled banks smeared (> 8 m to the top) ${tot.before.walledSmeared} → ${tot.wallSmeared} · low banks (< 1.5 m, 5 m in) ${tot.before.lowBank} → ${tot.lowBank}`);
for (const [a, v] of Object.entries(byArea).sort((p, q) => q[1].n - p[1].n)) console.log(`  ${a.padEnd(28)} smeared ${String(v.smeared0).padStart(3)} → ${String(v.smeared).padStart(3)} · low ${String(v.low0).padStart(3)} → ${String(v.low).padStart(3)}`);
