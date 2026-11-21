// PGH's riverbanks as lines (user, 21 Nov — F-PGH6): the water's edge where the terrain puts it (the ground grid at
// pool + 1.2 m, the level the world turns ground into river bed), traced and smoothed into clean curves, with what the
// bank is at each point: walled (OSM has a wall / retaining wall / quay / embankment within 25 m) or natural, and its
// top height. The world (js/world/graph-world.js) draws a bank along each line — a vertical stone face up to a flat
// promenade where walled, a firm sloped bank elsewhere — and shapes the ground to it.
//
//   node tools/pgh_shore.mjs → routes/cities/pgh-shore.json
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTerrainGrid } from '../js/terrain-grid.js';
import { decodeTerrain } from '../js/world/toolbox/landscape/real-terrain.js';
import { makeProjection } from '../js/world/geo.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const pgh = JSON.parse(readFileSync(resolve(root, 'routes/cities/pgh.json'), 'utf8'));
const grid = parseTerrainGrid(gunzipSync(readFileSync(resolve(root, pgh.ground))));
const proj = makeProjection(pgh.origin.lat, pgh.origin.lon);
const T = decodeTerrain(grid, proj);
const POOL = pgh.waterLevelM, WET = POOL + 1.2;
const C = grid.coarse, cell = 20;
const H = (i, j) => T.at(T.x0 + i * cell, T.z0 + j * cell);

// 1. marching squares on the grid's nodes (bilinear between them: the contour the world's ground has)
const segs = [];
const nx = C.nx, nz = C.ny;
const hv = new Float32Array(nx * nz);
for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) hv[j * nx + i] = H(i, j);
const P = (i, j) => [T.x0 + i * cell, T.z0 + j * cell];
const lerp = (a, b, ha, hb) => { const t = (WET - ha) / (hb - ha); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
  const h = [hv[j * nx + i], hv[j * nx + i + 1], hv[(j + 1) * nx + i + 1], hv[(j + 1) * nx + i]];
  const c = [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)];
  const code = h.reduce((s, v, k) => s | ((v >= WET ? 1 : 0) << k), 0);
  if (code === 0 || code === 15) continue;
  const E = [0, 1, 2, 3].map((k) => ((h[k] >= WET) !== (h[(k + 1) % 4] >= WET) ? lerp(c[k], c[(k + 1) % 4], h[k], h[(k + 1) % 4]) : null));
  const pts = E.filter(Boolean);
  if (pts.length === 2) segs.push(pts);
  else if (pts.length === 4) { segs.push([E[0], E[1]]); segs.push([E[2], E[3]]); }
}
// 2. chain into lines
const key = (p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
const ends = new Map();
segs.forEach((s, k) => { for (const p of s) (ends.get(key(p)) || ends.set(key(p), []).get(key(p))).push(k); });
const used = new Uint8Array(segs.length), lines = [];
for (let k = 0; k < segs.length; k++) {
  if (used[k]) continue;
  used[k] = 1;
  const line = [segs[k][0], segs[k][1]];
  for (const dir of [1, 0]) {
    for (;;) {
      const tip = dir ? line[line.length - 1] : line[0];
      const nxt = (ends.get(key(tip)) || []).find((m) => !used[m]);
      if (nxt == null) break;
      used[nxt] = 1;
      const s = segs[nxt], o = key(s[0]) === key(tip) ? s[1] : s[0];
      if (dir) line.push(o); else line.unshift(o);
    }
  }
  lines.push(line);
}
const len = (l) => l.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - l[i - 1][0], p[1] - l[i - 1][1]) : 0), 0);
// near the network only, and real river edges (not puddles in a low field: ≥ 200 m)
const net = new Set();
for (const e of pgh.edges) { let la = 0, lo = 0; for (let i = 0; i < e.lat.length; i++) { la += e.lat[i]; lo += e.lon[i]; const q = proj.toLocal(la * 1e-6, lo * 1e-6); net.add(`${Math.floor(q.x / 300)},${Math.floor(q.z / 300)}`); } }
const nearNet = (p) => { const cx = Math.floor(p[0] / 300), cz = Math.floor(p[1] / 300); for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) if (net.has(`${cx + a},${cz + b}`)) return true; return false; };
let keep = lines.filter((l) => len(l) >= 200 && l.some(nearNet));
// 3. smooth: Chaikin ×3, then 5 m steps
const chaikin = (l) => { const closed = Math.hypot(l[0][0] - l[l.length - 1][0], l[0][1] - l[l.length - 1][1]) < 1; const o = [l[0]]; for (let i = 0; i < l.length - 1; i++) { const [a, b] = [l[i], l[i + 1]]; o.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]); } o.push(l[l.length - 1]); if (closed) o[o.length - 1] = o[0]; return o; };
const resample = (l, step) => { const o = [l[0]]; let carry = 0; for (let i = 1; i < l.length; i++) { const [a, b] = [l[i - 1], l[i]]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); let s = step - carry; while (s <= L) { o.push([a[0] + ((b[0] - a[0]) * s) / L, a[1] + ((b[1] - a[1]) * s) / L]); s += step; } carry = L - (s - step); } return o; };
keep = keep.map((l) => resample(chaikin(chaikin(chaikin(l))), 5));

// 4. OSM walls
const walls = new Map();
{
  const dir = resolve(root, 'tools/.cache/osm-pgh');
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.osm')) continue;
    const txt = readFileSync(resolve(dir, f), 'utf8');
    const nodes = new Map();
    for (const m of txt.matchAll(/<node id="(\d+)"[^>]*lat="([-\d.]+)" lon="([-\d.]+)"/g)) nodes.set(m[1], [+m[2], +m[3]]);
    for (const m of txt.matchAll(/<way id="\d+"[^>]*>([\s\S]*?)<\/way>/g)) {
      const b = m[1];
      if (!/k="barrier" v="(wall|retaining_wall)"|k="man_made" v="(quay|embankment|breakwater)"/.test(b)) continue;
      const refs = [...b.matchAll(/<nd ref="(\d+)"/g)].map((x) => nodes.get(x[1])).filter(Boolean).map(([la, lo]) => { const q = proj.toLocal(la, lo); return [q.x, q.z]; });
      for (let i = 1; i < refs.length; i++) {
        const [a, c] = [refs[i - 1], refs[i]], L = Math.hypot(c[0] - a[0], c[1] - a[1]), k = Math.max(1, Math.ceil(L / 5));
        for (let j = 0; j <= k; j++) { const x = a[0] + ((c[0] - a[0]) * j) / k, z = a[1] + ((c[1] - a[1]) * j) / k, kk = `${Math.floor(x / 25)},${Math.floor(z / 25)}`; (walls.get(kk) || walls.set(kk, []).get(kk)).push([x, z]); }
      }
    }
  }
}
const wallNear = (x, z, r) => { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const [px, pz] of walls.get(`${Math.floor(x / 25) + a},${Math.floor(z / 25) + b}`) || []) if (Math.hypot(px - x, pz - z) < r) return true; return false; };

// 5. per point: land normal, walled, bank top
const out = [];
let walledM = 0, totalM = 0;
for (const l of keep) {
  const n = l.length;
  if (n < 4) continue;
  const nrm = [], walled = [], top = [];
  for (let i = 0; i < n; i++) {
    const a = l[Math.max(0, i - 2)], b = l[Math.min(n - 1, i + 2)];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
    let nx_ = -tz, nz_ = tx;
    const [x, z] = l[i];
    if (T.at(x + nx_ * 15, z + nz_ * 15) < T.at(x - nx_ * 15, z - nz_ * 15)) { nx_ = -nx_; nz_ = -nz_; }
    nrm.push([nx_, nz_]);
    // walled: an OSM wall within 25 m on the land side or at the edge
    let w = false;
    for (let s = -15; s <= 35 && !w; s += 5) if (wallNear(x + nx_ * s, z + nz_ * s, 8)) w = true;   // (the terrain edge sits up to ~15 m off the real one)
    walled.push(w);
    const prof = []; for (let s = 6; s <= 30; s += 2) prof.push(T.at(x + nx_ * s, z + nz_ * s));
    prof.sort((p, q) => p - q);
    const t = w ? prof[Math.floor(prof.length * 0.8)] : T.at(x + nx_ * 14, z + nz_ * 14);
    top.push(Math.min(POOL + 14, Math.max(POOL + (w ? 3 : 1.9), t)));
  }
  // walled runs: no flicker (runs and gaps under 30 m go)
  const fix = (v, want) => { for (let i = 0; i < n;) { if (v[i] !== want) { i++; continue; } let j = i; while (j < n && v[j] === want) j++; if ((j - i) * 5 < 30 && i > 0 && j < n) for (let k = i; k < j; k++) v[k] = !want; i = j; } };
  fix(walled, false); fix(walled, true);
  // tops: smoothed along the line (±25 m), a wall's promenade level along its run
  const sm = top.map((_, i) => { let s = 0, c = 0; for (let k = Math.max(0, i - 5); k <= Math.min(n - 1, i + 5); k++) if (walled[k] === walled[i]) { s += top[k]; c++; } return s / c; });
  const ll = l.map(([x, z]) => proj.toLatLon(x, z));
  const d = (a) => a.map((v, i) => (i ? v - a[i - 1] : v));
  const runs = []; for (let i = 0; i < n;) { if (!walled[i]) { i++; continue; } let j = i; while (j < n && walled[j]) j++; runs.push([i, j - 1]); walledM += (j - i) * 5; i = j; }
  totalM += (n - 1) * 5;
  out.push({ lat: d(ll.map((p) => Math.round(p.lat * 1e6))), lon: d(ll.map((p) => Math.round(p.lon * 1e6))), top: d(sm.map((v) => Math.round(v * 10))),
    side: d(nrm.map(([a, b]) => Math.round(Math.atan2(b, a) * 1000))), walled: runs });
}
writeFileSync(resolve(root, 'routes/cities/pgh-shore.json'), JSON.stringify({ format: 'bikefree-shore-1', pool: POOL, edge: WET, unit: { latlon: 1e-6, top: 0.1, side: 0.001 },
  note: 'tools/pgh_shore.mjs: the water edge (ground at pool + 1.2 m) traced and smoothed; side = the land side (radians, local x/z), top = the bank top (m), walled = runs of point indices', lines: out }));
console.log(`shore: ${out.length} lines, ${(totalM / 1000).toFixed(1)} km (${(walledM / 1000).toFixed(1)} km walled) from ${lines.length} raw contours`);
