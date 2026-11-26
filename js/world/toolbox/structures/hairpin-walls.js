// Retaining walls on switchbacks: where two legs of a hairpin climb close together, the landscape keeps the
// ground at the lower road's level (real-terrain.js), so the upper road stands on a dry-stone wall. This kit
// draws that wall — from a low parapet down past the ground — wherever the road edge stands more than a metre
// above the ground beside it and another leg of the road is near. Merged into one mesh per 2 km.
//
//   "hairpinWalls": { "minDropM": 1, "parapetM": 0.55, "color": "#9a958a" }
import * as THREE from '../../../../vendor/three.js';

const ROAD_HALF = 3.5, EDGE = ROAD_HALF + .8, STEP = 2, CHUNK = 2000;

export class HairpinWalls {
  constructor(parent, landscape, route, config = {}) {
    this.group = new THREE.Group(); this.group.name = 'Hairpin walls'; parent.add(this.group);
    const L = landscape, end = route.turnS || route.total;
    if (!L.otherLegNear || !L.frameAt) return;
    const minDrop = config.minDropM ?? 1, parapet = config.parapetM ?? .55;
    const base = new THREE.Color(config.color || '#9a958a'), c = new THREE.Color();
    const chunks = new Map();
    for (const side of [1, -1]) {
      let run = null;
      const flush = () => { if (run && run.length > 1) (chunks.get(Math.floor(run[0].s / CHUNK)) || chunks.set(Math.floor(run[0].s / CHUNK), []).get(Math.floor(run[0].s / CHUNK))).push(run); run = null; };
      for (let s = 0; s < end; s += STEP) {
        const f = L.frameAt(s);
        const x = f.x - f.fz * side * EDGE, z = f.z + f.fx * side * EDGE;
        const g = L.heightAt(f.x - f.fz * side * (EDGE + .6), f.z + f.fx * side * (EDGE + .6));
        const drop = f.y - g;
        if (drop > minDrop && L.otherLegNear(f.x, f.z) && !L.bridgeAt(x, z, 6) && !L.onRoadAt?.(x, z) && !L.onRoadAt?.(x - f.fz * side * .5, z + f.fx * side * .5)) (run ||= []).push({ s, x, z, top: f.y + .12 + parapet, bottom: Math.min(g, f.y) - 1.5, nx: -f.fz * side, nz: f.fx * side });
        else flush();
      }
      flush();
    }
    this.count = 0;
    for (const [key, runs] of chunks) {
      const P = [], N = [], C = [], I = [];
      for (const run of runs) {
        for (let k = 0; k < run.length; k++) {
          const p = run[k], b = P.length / 3, tint = .88 + ((Math.sin(p.s * .37) + Math.sin(p.s * 1.13)) * .06);
          // the outer face (toward the lower ground), the parapet top, the inner face above the road
          for (const [x, y, z, nx, ny, nz] of [
            [p.x + p.nx * .5, p.bottom, p.z + p.nz * .5, p.nx, 0, p.nz], [p.x + p.nx * .5, p.top, p.z + p.nz * .5, p.nx, 0, p.nz],
            [p.x + p.nx * .5, p.top, p.z + p.nz * .5, 0, 1, 0], [p.x, p.top, p.z, 0, 1, 0],
            [p.x, p.top, p.z, -p.nx, 0, -p.nz], [p.x, p.top - parapet - .3, p.z, -p.nx, 0, -p.nz]]) {
            P.push(x, y, z); N.push(nx, ny, nz); c.copy(base).multiplyScalar(ny ? tint * 1.08 : tint); C.push(c.r, c.g, c.b);
          }
          if (k) for (const [u, v] of [[0, 1], [2, 3], [4, 5]]) {
            const a0 = b - 6 + u, a1 = b - 6 + v, b0 = b + u, b1 = b + v;
            I.push(a0, b0, a1, a1, b0, b1);
          }
        }
        this.count++;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setIndex(I); g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95, side: THREE.DoubleSide }));
      mesh.name = `Hairpin walls ${(key * CHUNK / 1000).toFixed(0)} km`; mesh.castShadow = true; mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  dispose() {
    this.group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    this.group.removeFromParent();
  }
}
