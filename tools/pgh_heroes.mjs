// PGH's landmarks, from the Pittsburgh map's own hero models (js/world/toolbox/city/heroes.js, landmark-heroes.js,
// heroes-northshore.js): every scene's `heroes` merged (one per name), each with the map footprints round it (the
// models size and turn themselves from the footprint they stand on) — for js/world/graph-heroes.js to build in PGH.
//   node tools/pgh_heroes.mjs → routes/cities/pgh-heroes.json
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pgh = JSON.parse(readFileSync(resolve(root, 'routes/cities/pgh.json'), 'utf8'));
const scenes = readdirSync(resolve(root, 'routes/scenes')).filter((f) => /^pittsburgh(-[a-z]+)?\.json$/.test(f) && !/-city\.json$/.test(f));
// the PGH network's box (+ 400 m): a hero beyond it isn't seen from PGH
let la0 = 90, la1 = -90, lo0 = 180, lo1 = -180;
for (const n of pgh.nodes) { la0 = Math.min(la0, n.lat); la1 = Math.max(la1, n.lat); lo0 = Math.min(lo0, n.lon); lo1 = Math.max(lo1, n.lon); }
const inBox = (la, lo) => la > la0 - 0.004 && la < la1 + 0.004 && lo > lo0 - 0.005 && lo < lo1 + 0.005;
const heroes = new Map(), dataFor = new Map();
for (const f of scenes) {
  const s = JSON.parse(readFileSync(resolve(root, 'routes/scenes', f), 'utf8'));
  for (const h of s.heroes || []) {
    const key = `${h.model}:${h.name}`;
    if (heroes.has(key) || !inBox(h.lat, h.lon)) continue;
    heroes.set(key, { ...h, scene: f });
    if (s.cityData) dataFor.set(key, s.cityData);
  }
}
// the footprints within 150 m of each hero (its own area's map)
const kx = 111320 * Math.cos((40.44 * Math.PI) / 180), ky = 110540;
const cache = new Map(), out = [], seen = new Set();
const b64 = (t) => Buffer.from(t, 'base64');
for (const [key, h] of heroes) {
  const file = dataFor.get(key);
  if (!file) continue;
  if (!cache.has(file)) {
    const d = JSON.parse(readFileSync(resolve(root, file), 'utf8')), B = d.buildings;
    const ab = (t, T) => { const buf = b64(t); return new T(buf.buffer, buf.byteOffset, buf.byteLength / T.BYTES_PER_ELEMENT); };
    cache.set(file, { d, h: ab(B.h, Uint16Array), mh: ab(B.mh, Uint16Array), starts: ab(B.starts, Uint32Array), xy: ab(B.xy, Int16Array), B });
  }
  const C = cache.get(file), [o0, o1] = C.d.origin, u = C.d.unit;
  for (let k = 0; k < C.B.count; k++) {
    const i0 = C.starts[k], i1 = C.starts[k + 1];
    const ring = []; for (let i = i0; i < i1; i++) ring.push([o0 + C.xy[i * 2] * u, o1 + C.xy[i * 2 + 1] * u]);
    const [cl, co] = ring[0];
    if (Math.hypot((co - h.lon) * kx, (cl - h.lat) * ky) > 150) continue;
    const id = `${file}:${k}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ ring: ring.map(([a, b]) => [+a.toFixed(7), +b.toFixed(7)]), h: C.h[k] / 10, mh: C.mh[k] / 10, kind: C.B.kind[k], name: C.B.names[k] || '' });
  }
}
const list = [...heroes.values()];
writeFileSync(resolve(root, 'routes/cities/pgh-heroes.json'), JSON.stringify({ format: 'bikefree-heroes-1', note: 'tools/pgh_heroes.mjs: the Pittsburgh scenes\' hero landmarks within PGH, with the map footprints round them', heroes: list, buildings: out }));
const by = {}; for (const h of list) by[h.model] = (by[h.model] || 0) + 1;
console.log(`heroes: ${list.length} (${Object.entries(by).map(([k, v]) => `${k}${v > 1 ? ' ×' + v : ''}`).join(', ')}) · ${out.length} footprints round them`);
for (const h of list) console.log(`  ${h.model.padEnd(11)} ${h.name}`);
