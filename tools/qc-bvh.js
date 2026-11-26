// Fast raycasts for the in-page QC checks (tools/qc-map.js, tools/qc-endless.js): every mesh gets a BVH
// (three-mesh-bvh, the same as tools/qc-clipping.js) and one raycaster casts against a coarse grid of their
// bounds, so a check can fire thousands of rays over a whole map. The preview pages map "three-mesh-bvh" in
// their import maps; without it (or outside a page) the caster falls back to plain three.js raycasts.
//
//   const cast = await bvhCaster(T, meshes, { cell: 64 });
//   cast.down(x, y0, z, far)   → the first hit straight down from (x, y0, z): { point, object, distance } | null
//   cast.any(x, y0, z, far)    → true if anything is hit (first hit only)
//   cast.stats                 → { meshes, built, rays, ms }
let BVH = null;
async function lib() {
  if (BVH !== null) return BVH;
  try { BVH = await import('three-mesh-bvh'); } catch { BVH = false; }
  return BVH;
}

export async function bvhCaster(T, meshes, { cell = 64 } = {}) {
  const B = await lib(), t0 = performance.now(), grid = new Map(), stats = { meshes: meshes.length, built: 0, rays: 0, ms: 0, bvh: !!B };
  const box = new T.Box3();
  for (const o of meshes) {
    const g = o.geometry;
    if (!g?.attributes?.position) continue;
    if (B && !g.boundsTree && !o.isInstancedMesh && !o.isSkinnedMesh) {
      try { g.boundsTree = new B.MeshBVH(g, { maxLeafSize: 12 }); stats.built++; } catch { /* a degenerate geometry: plain raycasts */ }
    }
    if (g.boundsTree && B) o.raycast = B.acceleratedRaycast;
    o.updateWorldMatrix(true, false);
    if (!g.boundingBox) g.computeBoundingBox();
    box.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
    for (let x = Math.floor(box.min.x / cell); x <= Math.floor(box.max.x / cell); x++) for (let z = Math.floor(box.min.z / cell); z <= Math.floor(box.max.z / cell); z++) {
      const k = `${x},${z}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(o);
    }
  }
  stats.ms = Math.round(performance.now() - t0);
  const rc = new T.Raycaster(), down = new T.Vector3(0, -1, 0), from = new T.Vector3();
  rc.firstHitOnly = true;
  const cast = (x, y0, z, far) => {
    stats.rays++;
    rc.set(from.set(x, y0, z), down); rc.far = far;
    let best = null;
    for (const o of grid.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`) || []) {
      let h; try { h = rc.intersectObject(o, false)[0]; } catch { continue; }
      if (h && (!best || h.distance < best.distance)) best = h;
    }
    return best;
  };
  return { down: cast, any: (x, y0, z, far) => !!cast(x, y0, z, far), stats };
}
