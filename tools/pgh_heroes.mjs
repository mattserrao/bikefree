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

// ---- the rest of PGH's landmarks (user, 21 Nov: "work through them all"): each with its outline and height for the
// bespoke models of js/world/toolbox/city/pgh-landmarks.js
const LM = JSON.parse(readFileSync(resolve(root, 'routes/cities/pgh-landmarks.json'), 'utf8')).landmarks;
const MODEL = {
  'Koppers Tower': 'koppers', 'Frick Building': 'frick', 'Mellon National Bank Building': 'mellonbank', 'Tower at PNC Plaza': 'pncplaza',
  'EQT Plaza': 'eqt', 'Heinz Hall': 'heinzhall', 'Benedum Center': 'benedum', 'Allegheny County Jail & Courthouse': 'courthouse',
  'Engine Company No. 1': 'engine1', 'Station Square P&LE terminal': 'pleterminal', 'Carnegie Library, Allegheny': 'carnegielib',
  "Children's Museum (Buhl Planetarium)": 'buhl', 'Andy Warhol Museum': 'warhol', 'Mattress Factory': 'mattress',
  'Soldiers and Sailors Monument (Allegheny Commons)': 'column', 'Korean War Veterans Memorial': 'korean', '"Point of View" (Washington & Guyasuta)': 'pointofview',
  'The Doughboy': 'statue', 'Troy Hill WWI Monument': 'obelisk', 'Vietnam Veterans Memorial': 'vietnam', 'Steelworkers Monument': 'steelworkers',
  'The Hiker': 'statue', 'Christopher Columbus statue': 'columbus', 'Edward Manning Bigelow statue': 'statue', 'George Washington memorial': 'statue',
  'Millennium Panther': 'panther', 'Heinz History Center': 'history', 'Produce Terminal': 'produce', 'Penn Brewery': 'brewery',
  'Hamerschlag Hall': 'hamerschlag', 'Forbes Field wall': 'forbes', 'Stephen Foster Memorial': 'foster', 'Mellon Institute': 'melloninst',
  'Frick Fine Arts': 'frickarts', 'Saint Josaphat': 'josaphat', 'Pittsburgh Zoo entrance': 'zoo', 'Union Project': 'unionproject',
  'Sandcastle': 'sandcastle', 'Randyland': 'randyland', 'National Aviary': 'aviary', 'Allegheny Observatory': 'observatory',
  'Station Square': 'stationsquare', 'Highland Park reservoirs': 'reservoir', 'Fort Pitt Museum': 'fortmuseum',
};
const FIX = { 'Carnegie Library, Allegheny': [40.45263, -80.00617] };   // (matched the wrong library: the Allegheny branch is on Federal Street)
// every area's footprints (for the heights)
const allB = [];
for (const file of new Set(scenes.map((f) => JSON.parse(readFileSync(resolve(root, 'routes/scenes', f), 'utf8')).cityData).filter(Boolean))) {
  if (!cache.has(file)) {
    const d = JSON.parse(readFileSync(resolve(root, file), 'utf8')), B = d.buildings;
    const ab = (t, T) => { const buf = b64(t); return new T(buf.buffer, buf.byteOffset, buf.byteLength / T.BYTES_PER_ELEMENT); };
    cache.set(file, { d, h: ab(B.h, Uint16Array), mh: ab(B.mh, Uint16Array), starts: ab(B.starts, Uint32Array), xy: ab(B.xy, Int16Array), B });
  }
  const C = cache.get(file), [o0, o1] = C.d.origin, u = C.d.unit;
  for (let k = 0; k < C.B.count; k++) { const ring = []; for (let i = C.starts[k]; i < C.starts[k + 1]; i++) ring.push([o0 + C.xy[i * 2] * u, o1 + C.xy[i * 2 + 1] * u]); allB.push({ ring, h: C.h[k] / 10, name: C.B.names[k] || '' }); }
}
const inRing = (ring, la, lo) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [ai, oi] = ring[i], [aj, oj] = ring[j]; if ((ai > la) !== (aj > la) && lo < ((oj - oi) * (la - ai)) / (aj - ai) + oi) c = !c; } return c; };
const landmarks = [];
for (const l of LM) {
  const model = MODEL[l.label];
  if (!model) continue;
  const center = FIX[l.label] || l.center;
  let ring = l.footprint === 'OSM outline' && !FIX[l.label] ? l.poly : null;
  // the map footprint under it: its outline (if OSM had none) and its height
  const under = allB.filter((b) => inRing(b.ring, center[0], center[1]) || (ring && ring.some(([a, o]) => inRing(b.ring, a, o))));
  const tall = under.sort((a, b) => b.h - a.h)[0];
  if (!ring && tall && ['building'].includes(l.type)) ring = tall.ring;
  landmarks.push({ label: l.label, model, type: l.type, center, ring: ring ? ring.map(([a, o]) => [+a.toFixed(7), +o.toFixed(7)]) : null, h: tall ? tall.h : null });
}
// the stadiums, as closed bowls (user, 21 Nov): their OSM outlines
const stadiums = LM.filter((l) => /PNC Park|Acrisure/.test(l.label)).map((l) => ({ name: l.label, ring: l.poly, center: l.center,
  seats: /PNC/.test(l.label) ? '#1d3f6e' : '#c9a227', open: true, heightM: /PNC/.test(l.label) ? 28 : 42 }));
// the inclines: the map's funicular rails
const inclines = [];
{
  const seenR = new Set();
  for (const [file, C] of cache) for (const r of C.d.rails || []) {
    if (r.kind !== 'funicular') continue;
    const key = (r.name || '') + r.path.length;
    if (seenR.has(key)) continue; seenR.add(key);
    inclines.push({ name: r.name || 'Incline', path: r.path.map(([a, o]) => [+(C.d.origin[0] + a * C.d.unit).toFixed(7), +(C.d.origin[1] + o * C.d.unit).toFixed(7)]) });
  }
}
// Phipps: the Oakland scene's glasshouse plan
const phipps = (() => { try { return JSON.parse(readFileSync(resolve(root, 'routes/scenes/pittsburgh-oakland.json'), 'utf8')).glasshouses?.[0] || null; } catch { return null; } })();
// Grandview's overlooks and the subway's entrances, from OSM
const osmPts = [];
for (const f of readdirSync(resolve(root, 'tools/.cache/osm-pgh'))) {
  if (!f.endsWith('.osm')) continue;
  const txt = readFileSync(resolve(root, 'tools/.cache/osm-pgh', f), 'utf8');
  for (const m of txt.matchAll(/<node id="(\d+)"[^>]*lat="([-\d.]+)" lon="([-\d.]+)"[^>]*>([\s\S]*?)<\/node>/g)) {
    if (/k="tourism" v="viewpoint"/.test(m[4])) osmPts.push({ kind: 'viewpoint', id: m[1], p: [+m[2], +m[3]], name: (m[4].match(/k="name" v="([^"]*)"/) || [])[1] || '' });
    if (/k="railway" v="subway_entrance"|k="railway" v="train_station_entrance"/.test(m[4])) osmPts.push({ kind: 'entrance', id: m[1], p: [+m[2], +m[3]], name: (m[4].match(/k="name" v="([^"]*)"/) || [])[1] || '' });
  }
}
const uniq = (a) => { const s2 = new Set(); return a.filter((x) => (s2.has(x.id) ? false : s2.add(x.id))); };
const overlooks = uniq(osmPts.filter((o) => o.kind === 'viewpoint' && o.p[0] > 40.428 && o.p[0] < 40.442 && o.p[1] > -80.026 && o.p[1] < -80.000)).map((o) => ({ name: o.name, p: o.p }));
const stationNames = ['Allegheny', 'North Side', 'Gateway', 'Wood Street', 'Steel Plaza', 'First Avenue'];
const entrances = uniq(osmPts.filter((o) => o.kind === 'entrance')).map((o) => ({ name: o.name, p: o.p }));
const stations = LM.filter((l) => stationNames.includes(l.label)).map((l) => {
  const near = entrances.filter((e) => Math.hypot((e.p[1] - l.center[1]) * kx, (e.p[0] - l.center[0]) * ky) < 180);
  return { name: l.label, center: l.center, entrances: near.length ? near.map((e) => e.p) : [l.center] };
});
writeFileSync(resolve(root, 'routes/cities/pgh-heroes.json'), JSON.stringify({ format: 'bikefree-heroes-1', note: 'tools/pgh_heroes.mjs: the Pittsburgh scenes\' hero landmarks within PGH, with the map footprints round them; the other landmarks for the bespoke models; stadiums, inclines, Phipps, overlooks and subway entrances', heroes: list, buildings: out, landmarks, stadiums, inclines, phipps, overlooks, stations }));
const by = {}; for (const h of list) by[h.model] = (by[h.model] || 0) + 1;
console.log(`heroes: ${list.length} (${Object.entries(by).map(([k, v]) => `${k}${v > 1 ? ' ×' + v : ''}`).join(', ')}) · ${out.length} footprints round them`);
console.log(`landmarks to model: ${landmarks.length} (${landmarks.filter((l) => l.ring).length} with an outline, ${landmarks.filter((l) => l.h).length} with a height) · stadiums ${stadiums.length} · inclines ${inclines.length} (${inclines.map((i) => i.name).join(', ')}) · Phipps ${phipps ? 'yes' : 'no'} · overlooks ${overlooks.length} · stations ${stations.length} (${stations.reduce((s2, x) => s2 + x.entrances.length, 0)} entrances)`);
