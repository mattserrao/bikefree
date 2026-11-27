// [F399] Static geometry's CPU copy, released once the GPU has it. three.js keeps every BufferAttribute's array after
// uploading it; for the city's final, never-touched-again meshes (sector buildings, the building kit's sectors, streets,
// sidewalks, the street kit's chunks, bridges, stadiums) that copy is pure duplication — ~300 MB on a Pittsburgh start,
// and on a phone the GPU's copy lives in the same memory.
//
// Opt-in twice: the app turns it on (setGeometryRelease(true); tools leave it off: the QC tools read the meshes'
// vertices), and a builder marks a geometry with releaseAfterUpload() only where nothing reads or merges it later.
// Bounds are computed first (culling and the bake use them); counts and draw ranges stay valid without the arrays.
// After the release a marked geometry can't be re-uploaded: a lost WebGL context can't restore it (the world isn't
// restored after a context loss anyway).
import * as THREE from '../../../../vendor/three.js';

let enabled = false;
export const releaseStats = { geometries: 0, bytes: 0 };
export function setGeometryRelease(on) { enabled = !!on; }

function drop() {
  if (!this.array) return;
  releaseStats.bytes += this.array.byteLength;
  this.array = null;
}

/** Mark a final, static geometry: its arrays are dropped right after their upload to the GPU. Returns it. */
export function releaseAfterUpload(geo) {
  if (!enabled || !geo || geo.userData.release) return geo;
  const attrs = [...Object.values(geo.attributes), geo.index].filter(Boolean);
  if (attrs.some((a) => a.isInterleavedBufferAttribute || a.isInstancedBufferAttribute || a.usage !== THREE.StaticDrawUsage)) return geo;
  if (Object.keys(geo.morphAttributes || {}).length) return geo;
  if (!geo.boundingSphere) geo.computeBoundingSphere();
  if (!geo.boundingBox) geo.computeBoundingBox();
  for (const a of attrs) a.onUpload(drop);
  geo.userData.release = true;
  releaseStats.geometries++;
  return geo;
}
