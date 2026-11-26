// Toolbox: arch bridges, built for every gorge on a real-terrain scene's road. First built for Big Sur:
//
// Procedural concrete bridges for the real-coast landform (Big Sur): every span the road takes over
// a real gorge gets a deck with parapets; the deep ones (Bixby Creek, Rocky Creek, Garrapata) get the
// open-spandrel arch of the 1930s Highway 1 bridges — twin ribs, spandrel columns, and tall piers that
// reach the real ground. Built from instanced boxes so the whole set is a handful of draw calls.
import * as THREE from '../../../../vendor/three.js';
import { decorateSceneryMaterial } from '../materials/surfaces.js';
import { ROAD_WIDTH } from '../../pose.js';

const DECK_HALF = ROAD_WIDTH / 2 + 1.7;   // road + walkway
const RIB = 3.0;                           // ribs either side of the centre line

export class ArchBridges {
  constructor(parent, landscape, uniforms) {
    this.group = new THREE.Group(); this.group.name = 'Highway 1 bridges'; parent.add(this.group);
    this.L = landscape;
    this.boxes = [];       // [matrix] concrete
    this.rails = [];       // [matrix] parapet
    for (const b of landscape.bridges) if (!b.style) this._bridge(b);   // styled ones (the Triple Arches) are built elsewhere
    const unit = new THREE.BoxGeometry(1, 1, 1);
    this.geometry = unit;
    // a scene can dress them in its own stone (Glacier: rubble masonry)
    const colors = landscape.bridgeColors || {};
    this.concrete = decorateSceneryMaterial(new THREE.MeshStandardMaterial({ color: colors.structure || '#d6d0c1', roughness: .93 }), 'concrete', uniforms);
    this.railMaterial = decorateSceneryMaterial(new THREE.MeshStandardMaterial({ color: colors.rail || '#e3ddce', roughness: .9 }), 'concrete', uniforms);
    for (const [list, material, name] of [[this.boxes, this.concrete, 'Bridge structure'], [this.rails, this.railMaterial, 'Bridge parapets']]) {
      const mesh = new THREE.InstancedMesh(unit, material, list.length);
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true; mesh.castShadow = mesh.receiveShadow = true; mesh.name = name;
      mesh.computeBoundingSphere(); this.group.add(mesh);
    }
  }

  // A box from a to b (centre line), w wide (across), h tall (perpendicular), in the vertical plane of `right`.
  _beam(list, a, b, w, h, right = null) {
    const d = new THREE.Vector3().subVectors(b, a), len = d.length();
    if (len < .01) return;
    const z = d.clone().normalize();
    const x = right ? right.clone().projectOnPlane(z).normalize() : new THREE.Vector3(-z.z, 0, z.x).normalize();
    if (x.lengthSq() < .5) x.set(1, 0, 0);
    const y = new THREE.Vector3().crossVectors(z, x).normalize();
    const m = new THREE.Matrix4().makeBasis(x, y, z);
    m.scale(new THREE.Vector3(w, h, len));
    m.setPosition(a.clone().add(b).multiplyScalar(.5));
    list.push(m);
  }

  _column(list, x, z, top, bottom, w, d, forward) {
    if (top - bottom < .3) return;
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const m = new THREE.Matrix4().makeBasis(right, new THREE.Vector3(0, 1, 0), forward);
    m.scale(new THREE.Vector3(w, top - bottom, d));
    m.setPosition(x, (top + bottom) / 2, z);
    list.push(m);
  }

  _bridge(b) {
    const L = this.L, P = (s) => L.frameAt(s);
    const ground = (x, z) => L.baseHeight(x, z);
    // deck and parapets, in 4 m pieces that follow the road's curve and grade
    const step = 4;
    for (let s = b.fromM; s < b.toM - .01; s += step) {
      const e = Math.min(b.toM, s + step), p = P(s), q = P(e);
      const f = new THREE.Vector3(p.fx, 0, p.fz), r = new THREE.Vector3(-p.fz, 0, p.fx);
      const a = new THREE.Vector3(p.x, p.y - .75, p.z), c = new THREE.Vector3(q.x, q.y - .75, q.z);
      this._beam(this.boxes, a, c.clone().addScaledVector(f, .05), DECK_HALF * 2, 1.45, r);
      for (const side of [-1, 1]) {
        const o = r.clone().multiplyScalar(side * (DECK_HALF - .2));
        // open balustrade: a low curb, square posts and a capping rail — you can see the sea between them
        this._beam(this.rails, a.clone().add(o).setY(p.y + .2), c.clone().add(o).setY(q.y + .2), .34, .4, r);
        this._beam(this.rails, a.clone().add(o).setY(p.y + 1.02), c.clone().add(o).setY(q.y + 1.02), .36, .2, r);
        for (const k of [0, .5]) {
          const m = a.clone().lerp(c, k).add(o);
          this._column(this.rails, m.x, m.z, m.y + .75 + .17, m.y + .75 - .33, .26, .26, f);
        }
        // fascia: a slightly proud band under the parapet reads as the deck edge from below
        this._beam(this.boxes, a.clone().add(o).setY(p.y - 1.25), c.clone().add(o).setY(q.y - 1.25), .5, .7, r);
      }
    }
    const mid = P(b.s), depth = b.depth;
    const forward = (s) => { const p = P(s); return new THREE.Vector3(p.fx, 0, p.fz); };
    const arch = b.arch || depth > 22;
    // the arch springs from the gorge walls at about a third of the deck height below the deck
    let a0 = b.s, a1 = b.s;
    if (arch) {
      const target = mid.y - Math.max(8, depth * .78);
      // walk out from the deepest point until the ground climbs to the springing level
      let low = b.s, lowH = Infinity;
      for (let s = b.fromM; s <= b.toM; s += 2) { const p = P(s), h = ground(p.x, p.z); if (h < lowH) { lowH = h; low = s; } }
      a0 = low; a1 = low;
      while (a0 > b.fromM + 6) { const p = P(a0); if (ground(p.x, p.z) > target) break; a0 -= 2; }
      while (a1 < b.toM - 6) { const p = P(a1); if (ground(p.x, p.z) > target) break; a1 += 2; }
      const spring0 = (() => { const p = P(a0); return Math.max(ground(p.x, p.z), target); })();
      const spring1 = (() => { const p = P(a1); return Math.max(ground(p.x, p.z), target); })();
      const crown = (a0 + a1) / 2, half = (a1 - a0) / 2, top = mid.y - 3.6;
      // y = lerp(spring0, spring1, u) + (top − lerp) · 4u(1 − u): exact at both springings, crown under the deck
      const yArch = (s) => { const u = (s - a0) / (a1 - a0), base = spring0 + (spring1 - spring0) * u; return base + (top - base) * 4 * u * (1 - u); };
      for (const side of [-1, 1]) {
        let prev = null;
        for (let s = a0; s <= a1 + .01; s += 3) {
          const p = P(s), r = new THREE.Vector3(-p.fz, 0, p.fx);
          const pt = new THREE.Vector3(p.x, yArch(s), p.z).addScaledVector(r, side * RIB);
          if (prev) this._beam(this.boxes, prev, pt, 2.1, 2.5, r);
          prev = pt;
        }
      }
      // cross-bracing between the ribs, and spandrel columns from the ribs to the deck
      for (let s = a0 + 4; s < a1 - 2; s += 7.5) {
        const p = P(s), y = yArch(s), r = new THREE.Vector3(-p.fz, 0, p.fx), f = forward(s);
        this._beam(this.boxes, new THREE.Vector3(p.x, y, p.z).addScaledVector(r, -RIB), new THREE.Vector3(p.x, y, p.z).addScaledVector(r, RIB), .9, .9);
        if (P(s).y - 1.5 - y > 1.2) for (const side of [-1, 1]) {
          const c = new THREE.Vector3(p.x, 0, p.z).addScaledVector(r, side * RIB);
          this._column(this.boxes, c.x, c.z, p.y - 1.4, y + .6, .85, .85, f);
        }
      }
      // the two great piers at the springings
      for (const s of [a0, a1]) {
        const p = P(s), f = forward(s);
        this._column(this.boxes, p.x, p.z, p.y - 1.4, ground(p.x, p.z) - 2, RIB * 2 + 3.2, 4.2, f);
      }
    }
    // approach piers: twin columns to the real ground with tie beams up the height
    for (let s = b.fromM + 14; s < b.toM - 10; s += arch ? 11 : 24) {
      if (arch && s > a0 - 4 && s < a1 + 4) continue;
      const p = P(s), f = forward(s), r = new THREE.Vector3(-p.fz, 0, p.fx);
      let foot = Infinity;
      for (const side of [-1, 1]) { const c = new THREE.Vector3(p.x, 0, p.z).addScaledVector(r, side * RIB); foot = Math.min(foot, ground(c.x, c.z)); }
      if (p.y - 1.4 - foot < 1.5) continue;
      for (const side of [-1, 1]) {
        const c = new THREE.Vector3(p.x, 0, p.z).addScaledVector(r, side * RIB);
        this._column(this.boxes, c.x, c.z, p.y - 1.4, ground(c.x, c.z) - 1.5, 1.25, 1.25, f);
      }
      for (let y = p.y - 1.4 - 14; y > foot + 4; y -= 14) {
        this._beam(this.boxes, new THREE.Vector3(p.x, y, p.z).addScaledVector(r, -RIB), new THREE.Vector3(p.x, y, p.z).addScaledVector(r, RIB), .8, .9);
      }
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.group.children.forEach((m) => m.dispose());
    this.geometry.dispose(); this.concrete.dispose(); this.railMaterial.dispose();
  }
}
