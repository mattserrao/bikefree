// Visual QC for the endless map, run in the page on its built world (tools/endless-preview.html): tools/qc_map.mjs
// endless places the rider at each site, then calls runEndlessQC(world, THREE) — the same report shape as
// tools/qc-map.js (counts, examples), over the course within reach of the rider. The endless world has one road and
// no graph, so its checks are its own:
//
//   roadHole       no road surface at the road's centre line, or one at the wrong height (a gap between chunks)
//   edgeLip        anything 12 cm over the road just beside its edge
//   edgeDitch      a step down at the road's edge (60 cm within 0.4 m, 90 cm within 1.2 m) — past the world's own
//                  gravel shoulder, which falls 0.3–0.5 m over its first 1.5 m
//   treeOnRoad     a tree (or understory) standing on the road or its shoulder (within 1.5 m of the edge)
//   waterOverRoad  a lake's water or the sea at or above the road beside it
//   floating       a home's piece standing over the ground (its lowest point 0.4 m up at its middle)
//   buried         a home sunk 1.5 m or more into the ground at its middle (its door under the ground)
import { bvhCaster } from './qc-bvh.js';
import { defectId } from './qc-defects.js';

export async function runEndlessQC(w, T, { radius = 600 } = {}) {
  const C = w.course, STEP = 10, HALF = 3.3;
  const out = {}, ex = {}, defects = [];
  // (each fault also a defect with a stable id: its check and where along the course, 4 m cells — tools/qc-defects.js)
  const add = (k, s, note = '') => {
    out[k] = (out[k] || 0) + 1; (ex[k] ||= []).length < 6 && ex[k].push([`${Math.round(s)} m`, note].filter((v) => v !== ''));
    if (defects.length < 400) defects.push({ id: defectId(k, s, 0), check: k, at: [`${Math.round(s)} m`], s: Math.round(s), note });
  };
  for (const k of ['roadHole', 'edgeLip', 'edgeDitch', 'treeOnRoad', 'waterOverRoad', 'floating', 'buried']) out[k] = 0;
  const r = w.rider?.group?.position || w.camera.position, i0 = w._near(r.x, r.z).i;
  const ia = Math.max(0, i0 - Math.round(radius / STEP)), ib = Math.min(C.n - 1, i0 + Math.round(radius / STEP));
  const meshes = []; w.scene.traverseVisible((o) => { if (o.isMesh && !o.isInstancedMesh && o.geometry?.attributes?.position?.array && !/rider|sky/i.test(o.name)) meshes.push(o); });
  const cast = await bvhCaster(T, meshes), topAt = (x, z, y0) => cast.down(x, y0 + 6, z, 30);   // (BVH: tools/qc-bvh.js)
  // the road: its centre every 10 m, its edges every 30 m
  for (let i = ia; i <= ib; i++) {
    const h = C.heading[i], rx = Math.cos(h), rz = -Math.sin(h), y = C.ele[i] + 0.06, s = i * STEP;
    // (a chunk not streamed yet, or dropped behind, is not a hole; nor a chunk's first row with the chunk before it not
    //  built — the ray lands exactly on the mesh's open edge)
    const built = w.roads?.get?.(Math.floor(i / 20)) && (i % 20 || w.roads.get(i / 20 - 1));
    const hit = built ? topAt(C.x[i], C.z[i], y) : null;
    if (built && (!hit || Math.abs(hit.point.y - y) > 0.12)) add('roadHole', s, hit ? `${(hit.point.y - y).toFixed(2)} m (${hit.object.name || 'mesh'})` : 'nothing');
    if (i % 3) continue;
    // (the world's gravel shoulder falls ~0.3–0.5 m over its first 1.5 m by design: a ditch is a drop past that)
    for (const side of [-1, 1]) for (const [d, lim] of [[0.4, 0.6], [1.2, 0.9]]) {
      const x = C.x[i] + rx * (HALF + d) * side, z = C.z[i] + rz * (HALF + d) * side, q = topAt(x, z, y);
      if (!q || /^Road/.test(q.object.name)) continue;
      if (q.point.y > y + 0.12) { add('edgeLip', s, `+${(q.point.y - y).toFixed(2)} m (${q.object.name || 'mesh'})`); break; }
      if (q.point.y < y - lim) { add('edgeDitch', s, `-${(y - q.point.y).toFixed(2)} m`); break; }
    }
    // water beside the road
    for (const side of [-1, 1]) {
      const x = C.x[i] + rx * (HALF + 3) * side, z = C.z[i] + rz * (HALF + 3) * side, G = w._ground(x, z);
      const lvl = G.water ? G.water.level : (G.bi?.A?.relief?.sea || G.bi?.B?.relief?.sea) ? C.seaLevel?.(s) : null;
      if (lvl != null && lvl > y - 0.3) { add('waterOverRoad', s, `${(lvl - y).toFixed(2)} m`); break; }
    }
  }
  // trees on the road
  for (const list of w.forest?.tiles?.values?.() || []) for (const t of list) {
    if (t.x == null) continue;
    const nr = w._near(t.x, t.z);
    if (nr.i < ia || nr.i > ib) continue;
    if (Math.abs(nr.d) < HALF + 1.5) add('treeOnRoad', nr.s, `${t.sp || 'tree'} ${Math.abs(nr.d).toFixed(1)} m off the centre`);
  }
  // the homes: each mesh's lowest point against the ground at its middle
  for (const h of w.homes?.values?.() || []) for (const m of [h.mesh, h.detail].filter(Boolean)) {
    m.updateMatrixWorld?.(true);
    const box = new T.Box3().setFromObject(m);
    if (!isFinite(box.min.y)) continue;
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2, nr = w._near(cx, cz);
    if (nr.i < ia || nr.i > ib) continue;
    const g = w._ground(cx, cz).y;
    if (box.min.y > g + 0.4) add('floating', nr.s, `a home's ${m === h.mesh ? 'walls' : 'detail'} ${(box.min.y - g).toFixed(1)} m up`);
    if (box.min.y < g - 1.5 && box.max.y < g + 2) add('buried', nr.s, `${(g - box.min.y).toFixed(1)} m down`);
  }
  const st = window.route?.endlessRide?.stateAt?.(w.p);
  return { at: [`${Math.round(i0 * STEP)} m`, st?.biome || ''], counts: out, examples: ex, defects, rays: cast.stats };
}
