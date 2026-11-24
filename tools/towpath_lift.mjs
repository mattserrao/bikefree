#!/usr/bin/env node
// Raises the towpath to its traditional height above the canal (user, 23 Nov: "There is a section of the towpath that
// is below the canal. Raise the towpath so it sits at its traditional height above the canal").
//
//   node tools/towpath_lift.mjs routes/cities/cny.json [--above 1.0] [--dry]
//
// The canal's water stands just over the ground along its line (cny-landmarks canal(): the highest ground across its
// width + 0.12 m, smoothed). Every path edge running beside a canal (within 30 m of its line) is lifted wherever it is
// less than --above metres over that level, the lift eased in over 40 m either side (no step); a junction on the lifted
// towpath moves with it, and the other ways into it ease up to it over 40 m. Writes the graph in place.
import { readFile, writeFile } from 'node:fs/promises';
import { decodeGraph } from '../js/graph.js';
import { makeProjection } from '../js/world/geo.js';
import { loadTerrainGrid } from '../js/terrain-grid.js';
import { decodeTerrain } from '../js/world/toolbox/landscape/real-terrain.js';

const args = process.argv.slice(2), file = args[0];
const opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : Number(args[i + 1]); };
const ABOVE = opt('--above', 1.0), dry = args.includes('--dry'), EASE = 40, NEAR = 30;
const json = JSON.parse(await readFile(file, 'utf8'));
const G = decodeGraph(json), proj = makeProjection(json.origin.lat, json.origin.lon);
const grid = await loadTerrainGrid((await readFile(new URL(`../${json.ground}`, import.meta.url))).buffer);
const ground = decodeTerrain(grid, proj), gAt = (x, z) => ground.at(x, z);
const heroes = JSON.parse(await readFile(file.replace(/\.json$/, '-heroes.json'), 'utf8'));

// the canals' water level, sampled every 4 m along their lines
const W = [];
for (const l of heroes.landmarks.filter((l) => l.model === 'canal' && !l.creek)) {
  const P = l.path.map(([a, o]) => proj.toLocal(a, o)), hw = 7.5, S = [];
  for (let i = 0; i + 1 < P.length; i++) {
    const a = P[i], b = P[i + 1], d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(d / 4)), nx = -(b.z - a.z) / d, nz = (b.x - a.x) / d;
    for (let k = 0; k < n; k++) { const x = a.x + (b.x - a.x) * k / n, z = a.z + (b.z - a.z) * k / n; S.push({ x, z, y: Math.max(gAt(x, z), gAt(x + nx * hw, z + nz * hw), gAt(x - nx * hw, z - nz * hw)) + .12 }); }
  }
  for (let pass = 0; pass < 3; pass++) for (let i = 1; i + 1 < S.length; i++) S[i].y = Math.max(S[i].y - .3, (S[i - 1].y + S[i].y * 2 + S[i + 1].y) / 4);
  W.push(...S);
}
const level = (x, z) => { let best = null, bd = NEAR; for (const s of W) { const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; best = s; } } return best?.y ?? null; };

// each path edge beside a canal: the lift its samples need, eased along it
const lifts = new Map(), nodeLift = new Map();
let worst = 0, lifted = 0, where = null;
for (const e of G.edges) {
  if (e.kind !== 'path') continue;
  const need = new Float64Array(e.n + 1);
  let any = false;
  for (let i = 0; i <= e.n; i++) {
    const q = proj.toLocal(e.lat[i], e.lon[i]), y = level(q.x, q.z);
    if (y == null) continue;
    need[i] = Math.max(0, y + ABOVE - e.ele[i]);
    if (need[i] > 0) { any = true; if (need[i] > worst) { worst = need[i]; where = [e.lat[i].toFixed(5), e.lon[i].toFixed(5)]; } }
  }
  if (!any) continue;
  // eased: each sample lifted by the most any sample within EASE m needs, less in proportion to the distance
  const out = new Float64Array(e.n + 1), K = EASE / 10;
  for (let i = 0; i <= e.n; i++) for (let j = Math.max(0, i - K); j <= Math.min(e.n, i + K); j++) {
    const t = Math.abs(i - j) / K, f = 1 - t * t * (3 - 2 * t);
    out[i] = Math.max(out[i], need[j] * f);
  }
  lifts.set(e, out); lifted++;
  for (const [id, i] of [[e.from, 0], [e.to, e.n]]) nodeLift.set(id, Math.max(nodeLift.get(id) || 0, out[i]));
}
// the edges' ends meet their junctions' lifts (the towpath's own ends included: the most any edge there needs)
for (const e of G.edges) {
  const a = nodeLift.get(e.from) || 0, b = nodeLift.get(e.to) || 0;
  if (!a && !b && !lifts.has(e)) continue;
  const own = lifts.get(e) || new Float64Array(e.n + 1), K = EASE / 10;
  for (let i = 0; i <= e.n; i++) {
    const ta = Math.min(1, i / K), tb = Math.min(1, (e.n - i) / K);
    const fa = 1 - ta * ta * (3 - 2 * ta), fb = 1 - tb * tb * (3 - 2 * tb);
    own[i] = Math.max(own[i], a * fa, b * fb);
  }
  own[0] = a || own[0]; own[e.n] = b || own[e.n];
  lifts.set(e, own);
}
console.log(`towpath: ${lifted} path edges beside the canal lifted, up to ${worst.toFixed(2)} m (at ${where}); ${nodeLift.size} junctions`);
if (dry) process.exit(0);

// write back: the edges' ele (deltas in the graph's unit) and the junctions'
const ke = json.unit?.ele ?? 0.1;
for (const [e, L] of lifts) {
  const raw = json.edges.find((r) => r.id === e.id);
  let prev = 0;
  raw.ele = Array.from(e.ele, (v, i) => { const q = Math.round((v + L[i]) / ke); const d = q - prev; prev = q; return d; });
}
for (const n of json.nodes) { const L = nodeLift.get(n.id); if (L) n.ele = Math.round((n.ele + L) * 10) / 10; }
await writeFile(file, JSON.stringify(json));
console.log(`wrote ${file}`);
