// Riverside ways on the bank top (user, 21 Nov — F-PGH6): a way within 25 m of the shore (tools/pgh_shore.mjs) is
// raised to the bank it runs on — a walled bank's promenade, a natural bank's slope at that distance — never lowered,
// never on a deck. The lift eases out along the way (±60 m) and its junctions move with it (every way into them).
// Run tools/pgh_crossings.mjs + fix_separations_pgh.mjs after (a trail under a bridge must keep 4.5 m).
//   node tools/riverside_pgh.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeProjection } from '../js/world/geo.js';
import { decodeShore, bankProfile } from '../js/world/graph-world.js';
import { load, save } from './pgh_graph_edit.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const file = resolve(root, 'routes/cities/pgh.json');
const json = JSON.parse(readFileSync(file, 'utf8'));
const proj = makeProjection(json.origin.lat, json.origin.lon);
const shore = decodeShore(JSON.parse(readFileSync(resolve(root, json.shore), 'utf8')), proj);
const pool = json.waterLevelM, waterY = pool + 0.35;
const { nodes, E } = load(json);
const want = (la, lo) => {
  const q = proj.toLocal(la, lo), sh = shore.at(q.x, q.z);
  if (!sh || sh.s < -3 || sh.s > 25) return null;
  return sh.walled ? sh.top : bankProfile(Math.max(0, sh.s), sh.top, waterY, pool);
};
// the lift each sample wants (never down; not on a deck)
const lift = E.map((e) => e.lat.map((la, i) => { if (e.br[i]) return 0; const t = want(la, e.lon[i]); return t == null ? 0 : Math.max(0, t - e.ele[i]); }));
// junctions: the most any way into them wants there
const nl = new Map();
E.forEach((e, k) => { const n = e.lat.length - 1; for (const [id, v] of [[e.from, lift[k][0]], [e.to, lift[k][n]]]) nl.set(id, Math.max(nl.get(id) || 0, v)); });
let raised = 0, km = 0, most = 0;
E.forEach((e, k) => {
  const n = e.lat.length - 1, L = lift[k].slice();
  L[0] = nl.get(e.from); L[n] = nl.get(e.to);
  // spread: each sample takes the most of its neighbours' lift, eased off over 60 m (a ramp, not a step)
  const out = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) { const d = Math.abs(i - j) * 10; if (d >= 60 || !L[j]) continue; const w = 1 - d / 60; const v = L[j] * w * w * (3 - 2 * w); if (v > out[i]) out[i] = v; }
  out[0] = L[0]; out[n] = L[n];
  let any = false;
  for (let i = 0; i <= n; i++) if (!e.br[i] && out[i] > 0.05) { e.ele[i] += out[i]; any = true; km += 0.01; most = Math.max(most, out[i]); }
  if (any) raised++;
});
for (const [id, v] of nl) if (v > 0) nodes.get(id).ele += v;
save(json, nodes, E);
writeFileSync(file, JSON.stringify(json));
console.log(`riverside: raised ${raised} ways (${km.toFixed(1)} km of samples) onto the bank top, up to ${most.toFixed(1)} m`);
