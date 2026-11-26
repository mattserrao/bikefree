// The landmarks' QC probe: with a QC run on (globalThis.BF_QC — tools/pgh-preview.html?qc=1, set by tools/qc_map.mjs),
// every solid piece a landmark builder makes — boxes, cylinders, pyramids, turned pieces, prisms, gables (hero-geom's
// QC_HOOK) — and every beam is recorded with its foot and top, under the landmark being built (QC.prims.cur), so
// tools/qc-map.js can tell a piece standing on the ground, the water or another piece from one hanging in the air.
// Off, it costs nothing: no builder is wrapped.
import { QC_HOOK } from './hero-geom.js';

export const qcOn = () => !!globalThis.BF_QC;

/** Watches builder S; records into QC.prims. */
export function qcProbe(S, QC) {
  const P = (QC.prims ||= []);
  const rec = (p) => P.push({ ...p, lm: P.cur });
  QC_HOOK.rec = rec;
  if (S.__qc) return P;
  S.__qc = true;
  const box = S.box.bind(S), cyl = S.cylinder.bind(S), beam = S.beam.bind(S), pyr = S.pyramid.bind(S);
  S.box = (x, y, z, w, h, l, yaw) => { rec({ x, z, y, top: y + h, r: Math.max(w, l) / 2, foot: Math.min(w, l) / 2, what: 'box' }); return box(x, y, z, w, h, l, yaw); };
  S.cylinder = (x, y, z, r, h, seg, rt) => { rec({ x, z, y, top: y + h, r: Math.max(r, rt ?? r), what: 'cylinder' }); return cyl(x, y, z, r, h, seg, rt); };
  S.pyramid = (x, y, z, w, h, l, yaw) => { rec({ x, z, y, top: y + h, r: Math.max(w, l) / 2, what: 'roof' }); return pyr(x, y, z, w, h, l, yaw); };
  S.beam = (a, b, w, h) => { P.push({ beam: true, a: { x: a.x, z: a.z }, b: { x: b.x, z: b.z }, top: Math.max(a.y, b.y) + h / 2, bot: Math.min(a.y, b.y) - h / 2, w }); return beam(a, b, w, h); };
  return P;
}
