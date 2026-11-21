// Fix PGH's overpasses and underpasses that tools/pgh_crossings.mjs finds not right (user, 21 Nov):
//   no-deck  the upper way's deck extended over the lower way's width + 3 m each side, and its heights over the deck
//            smoothed (no peak), never below 4.5 m over the lower way
//   low      the lower way dipped to 4.5 m under the deck, eased over 60 m either side
//   clash    as low
//   kink     the way's last metres into the junction re-graded over up to 80 m
// Run after tools/pgh_crossings.mjs; then tools/map_pgh_routes.mjs --write (edges are renumbered).
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, save, KX, KY } from './pgh_graph_edit.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const file = resolve(root, 'routes/cities/pgh.json');
const json = JSON.parse(readFileSync(file, 'utf8'));
const X = JSON.parse(readFileSync(resolve(root, 'tools/.cache/pgh-crossings.json'), 'utf8')).filter((x) => x.kind !== 'ok');
const { nodes, E } = load(json);
const byId = new Map(E.map((e) => [e.id, e]));
const W = json.widths;
const near = (e, lat, lon) => { let bi = 0, bd = Infinity; for (let i = 0; i < e.lat.length; i++) { const d = Math.hypot((e.lon[i] - lon) * KX, (e.lat[i] - lat) * KY); if (d < bd) { bd = d; bi = i; } } return bi; };
const CLEAR = 4.5, done = [];
for (const x of X) {
  const up = byId.get(x.upperId), lo = byId.get(x.lowerId);
  if (x.kind === 'no-deck') {
    const ui = near(up, x.lat, x.lon), li = near(lo, x.lat, x.lon), n = up.lat.length - 1;
    const hd = (e, i) => Math.atan2((e.lat[Math.min(e.lat.length - 1, i + 1)] - e.lat[Math.max(0, i - 1)]) * KY, (e.lon[Math.min(e.lon.length - 1, i + 1)] - e.lon[Math.max(0, i - 1)]) * KX);
    const sinA = Math.max(0.3, Math.abs(Math.sin(hd(up, ui) - hd(lo, li))));
    const half = Math.ceil(((W[lo.kind] || 7) / 2 + 4) / sinA / 10) + 1;   // samples each side, the crossing's angle allowed for
    // the deck: the existing run through the crossing, grown to cover ±half samples
    let a = ui, b = ui;
    while (a > 0 && up.br[a - 1]) a--;
    while (b < n && up.br[b + 1]) b++;
    a = Math.max(1, Math.min(a, ui - half)); b = Math.min(n - 1, Math.max(b, ui + half));
    for (let i = a; i <= b; i++) up.br[i] = true;
    // the crossing near the way's end: the deck runs on into the ways at that junction (their first metres)
    for (const [end, rem] of [[0, half - ui], [1, ui + half - n]]) {
      if (rem <= 0) continue;
      if (end === 0) up.br[0] = up.br[1] = true; else up.br[n] = up.br[n - 1] = true;
      const j = end ? up.to : up.from;
      for (const o of E) {
        if (o === up) continue;
        const m = o.lat.length - 1;
        if (o.from === j) for (let k = 0; k <= Math.min(m - 1, rem + 1); k++) o.br[k] = true;
        if (o.to === j) for (let k = 0; k <= Math.min(m - 1, rem + 1); k++) o.br[m - k] = true;
      }
    }
    // clearance: where the deck is under CLEAR over the lower way, a gentle lift (±40 m); its heights stay otherwise
    const floor = Math.max(...[li - 1, li, li + 1].filter((k) => k >= 0 && k < lo.ele.length).map((k) => lo.ele[k])) + CLEAR + 0.1;
    const lift = floor - up.ele[ui];
    if (lift > 0) for (let i = 1; i < n; i++) { const d = Math.abs(i - ui) * 10; if (d >= 40) continue; const w = 1 - d / 40; up.ele[i] += lift * w * w * (3 - 2 * w); }
    done.push(`${up.name}: deck over ${lo.name} now ${(b - a + 1) * 10} m, ${(up.ele[ui] - lo.ele[li]).toFixed(1)} m clear`);
  } else if (x.kind === 'low' || x.kind === 'clash') {
    const ui = near(up, x.lat, x.lon), li = near(lo, x.lat, x.lon), n = lo.lat.length - 1;
    const need = lo.ele[li] - (up.ele[ui] - CLEAR);
    if (need <= 0) continue;
    for (let i = 0; i <= n; i++) { const d = Math.abs(i - li) * 10; if (d >= 60 || i === 0 || i === n) continue; const w = 1 - d / 60; lo.ele[i] -= need * w * w * (3 - 2 * w); }
    done.push(`${lo.name}: dipped ${need.toFixed(1)} m under ${up.name} (${(up.ele[ui] - lo.ele[li]).toFixed(1)} m clear)`);
  } else if (x.kind === 'kink') {
    const e = up, n = e.lat.length - 1, nid = nodes.get(e.from)?.name === x.lower ? 0 : 1;
    const idx = (k) => (nid ? n - k : k);
    const K = Math.min(8, n - 1);   // re-grade the first K samples (≤ 80 m) from the junction
    const z0 = e.ele[idx(0)], zK = e.ele[idx(K)];
    for (let k = 1; k < K; k++) e.ele[idx(k)] = z0 + ((zK - z0) * k) / K;
    done.push(`${e.name}: eased into ${x.lower} over ${K * 10} m (${(Math.abs(zK - z0) / (K * 10) * 100).toFixed(0)} %)`);
  }
}
save(json, nodes, E);
writeFileSync(file, JSON.stringify(json));
console.log(`fixed ${done.length} grade separations:\n  ` + done.join('\n  '));
