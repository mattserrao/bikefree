// Dams from the map ("places.dams", tools/build_places.py): a concrete wall along the mapped crest line, from the
// gorge floor up to a crest a little above the reservoir, battered on the downstream face, with a parapet and a
// walkway. Built for the Barrage du Sautet (Alpe d'Huez stage); any route with mapped dams can switch it on with
// "dams": { "crestM": { "Barrage du Sautet": 772 } } (optional crest heights by name; default: the lower abutment).
import * as THREE from '../../../../vendor/three.module.min.js';

export class Dams {
  constructor(parent, places, landscape, proj, config = {}) {
    this.group = new THREE.Group(); this.group.name = 'Dams'; parent.add(this.group);
    const pos = [], col = [], idx = [];
    const C = new THREE.Color('#bdb8ad'), D = new THREE.Color('#a9a499'), P = new THREE.Color('#cfcbc2');
    const add = (v, c) => { pos.push(...v); col.push(c.r, c.g, c.b); return pos.length / 3 - 1; };
    const quad = (a, b, c, d, k) => { const i = add(a, k), j = add(b, k), m = add(c, k), n = add(d, k); idx.push(i, j, m, i, m, n); };
    for (const dam of places.dams || []) {
      if (dam.pts.length < 2) continue;
      const P0 = dam.pts.map(([la, lo]) => proj.toLocal(la, lo));
      const ends = [P0[0], P0.at(-1)].map((p) => landscape.heightAt(p.x, p.z));
      const crest = config.crestM?.[dam.name] ?? Math.min(...ends) - .5;
      let floor = crest;
      for (const p of P0) floor = Math.min(floor, landscape.heightAt(p.x, p.z));
      const depth = crest - floor;
      if (depth < 4) continue;   // a weir or a mapped line on flat ground: nothing to build
      const thick = Math.max(3, depth * .12);
      for (let i = 0; i < P0.length - 1; i++) {
        const a = P0[i], b = P0[i + 1], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
        const nx = -dz / L, nz = dx / L;   // across the wall
        const ga = landscape.heightAt(a.x, a.z) - 3, gb = landscape.heightAt(b.x, b.z) - 3;
        // upstream face (vertical) and the battered downstream face, both from the ground to the crest
        quad([a.x, ga, a.z], [b.x, gb, b.z], [b.x, crest, b.z], [a.x, crest, a.z], C);
        const bat = Math.max(thick, (crest - Math.min(ga, gb)) * .35);
        quad([b.x + nx * bat, gb, b.z + nz * bat], [a.x + nx * bat, ga, a.z + nz * bat], [a.x + nx * thick, crest, a.z + nz * thick], [b.x + nx * thick, crest, b.z + nz * thick], D);
        // the crest walkway and parapets
        quad([a.x, crest, a.z], [b.x, crest, b.z], [b.x + nx * thick, crest, b.z + nz * thick], [a.x + nx * thick, crest, a.z + nz * thick], P);
        for (const off of [0, thick]) quad([a.x + nx * off, crest, a.z + nz * off], [b.x + nx * off, crest, b.z + nz * off], [b.x + nx * off, crest + 1.1, b.z + nz * off], [a.x + nx * off, crest + 1.1, a.z + nz * off], P);
      }
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    this.mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .85, side: THREE.DoubleSide }));
    this.mesh.name = 'Dam walls'; this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
  }

  dispose() { this.mesh?.geometry.dispose(); this.mesh?.material.dispose(); this.group.removeFromParent(); }
}
