// Bridge clipping QC (user, 21 Nov: "check for clipping of road on bridges"): every bridge model against PGH's ridden
// decks — a walkway beside a scenery bridge (Smithfield's trail, the Fort Duquesne cycleway) must lie clear of the
// model's roadway and outside its structure's planes, and no pier may stand on a ridden way. Flat ground stands in for
// the terrain (the check is lateral). Exit code 1 on a clash.
//   node tools/pgh_bridge_clip.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeGraph } from '../js/graph.js';
import { makeProjection } from '../js/world/geo.js';
import { buildGraphBridges } from '../js/world/graph-bridges.js';
const j = JSON.parse(readFileSync(fileURLToPath(new URL('../routes/cities/pgh.json', import.meta.url)),'utf8'));
const G = decodeGraph(j); const proj = makeProjection(j.origin.lat, j.origin.lon);
for (const e of G.edges){ e.x=new Float64Array(e.n+1); e.z=new Float64Array(e.n+1); for(let i=0;i<=e.n;i++){const q=proj.toLocal(e.lat[i],e.lon[i]); e.x[i]=q.x; e.z[i]=q.z;} }
const world = { G, proj, widths: j.widths, _groundH: ()=>212, poolAt: ()=>216.6, wOf:(e)=>e.kind==='path'?3.6:(j.widths[e.kind]||7) };
const b = buildGraphBridges(world, JSON.parse(readFileSync(fileURLToPath(new URL('../routes/cities/pgh-bridges.json', import.meta.url)),'utf8')));
console.log("piers kept off ways:", JSON.stringify(b.qcPier));
for (const q of b.qc) if (q.beside.length) console.log(q.name, q.style, "hw", q.hw.toFixed(1), "planes", q.planes.map(v=>v.toFixed(1)).join("/"), q.beside.map(x=>x.name).join(","), "clash samples:", q.clash.length, q.clash.slice(0,12).join(" "));
const bad = b.qc.filter((q) => q.clash.length);
console.log(bad.length ? `CLASH: ${bad.map((q) => q.name).join(', ')}` : `ok: ${b.qc.length} bridges, no ridden deck under a model's roadway or through its structure; ${b.qcPier.length} piers left off ridden ways`);
process.exit(bad.length ? 1 : 0);
