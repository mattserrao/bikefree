// Toolbox core: the procedural model builder every regional pack and structure kit is made with. Low-poly,
// vertex-coloured, flat-shaded geometry merged into one BufferGeometry per model, in metres, Y up, +Z along
// the road. Primitives (cyl, cone, blob, box) sit on the ground (y = 0); M() composes a transform.
import * as THREE from '../../../../vendor/three.js';

export const linear = (hex) => new THREE.Color(hex);   // THREE.Color(hex) converts sRGB hex → linear working space
// Cartoon look: smooth shading instead of flat facets, for the length of one withSmooth(true, …) call;
// off by default (faceted).
let SMOOTH = false;
/** Build with smooth shading on for the length of fn() (other kits built on this Builder: Glacier). */
export function withSmooth(on, fn) { const was = SMOOTH; SMOOTH = !!on; try { return fn(); } finally { SMOOTH = was; } }

export class Builder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.prt = []; this.part = 0; this.anyPart = false; }
  /** Tag what follows as a surface kind (aTree attribute: bark, leaves …) for kits with a surface shader. */
  as(part) { this.part = part; if (part) this.anyPart = true; return this; }
  /** Add a geometry, transformed, flat-coloured (with optional per-vertex jitter). */
  add(geometry, matrix, color, jitter = 0, rand = Math.random) {
    // smooth: crowns and rocks (icosahedra) take unit-sphere normals, cylinders and cones keep their own
    // round normals; boxes and roofs keep hard edges because their source normals are already per face
    const smooth = SMOOTH && (geometry.userData.sphere || !!geometry.index);
    if (smooth && geometry.userData.sphere) {
      const p = geometry.attributes.position, n = new Float32Array(p.count * 3), v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).normalize(); n.set([v.x, v.y, v.z], i * 3); }
      geometry.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    }
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    g.applyMatrix4(matrix); if (!smooth) g.computeVertexNormals();
    const p = g.attributes.position.array, n = g.attributes.normal.array, c = linear(color);
    for (let i = 0; i < p.length; i += 9) {
      const j = rand(), k = SMOOTH ? 1 : 1 + (j - .5) * jitter;   // smooth: no per-facet jitter (it reads as facets); same draws
      for (let v = 0; v < 3; v++) {
        this.pos.push(p[i + v * 3], p[i + v * 3 + 1], p[i + v * 3 + 2]);
        this.nor.push(n[i + v * 3], n[i + v * 3 + 1], n[i + v * 3 + 2]);
        this.col.push(c.r * k, c.g * k, c.b * k);
        this.prt.push(this.part);
      }
    }
    g.dispose(); if (g !== geometry) geometry.dispose();
    return this;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.anyPart) g.setAttribute('aTree', new THREE.Float32BufferAttribute(this.prt, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

export const M = (x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
export const cyl = (rTop, rBot, h, seg) => new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, true).translate(0, h / 2, 0);
export const cone = (r, h, seg) => new THREE.ConeGeometry(r, h, seg, 1, true).translate(0, h / 2, 0);
export const blob = (detail) => { const g = new THREE.IcosahedronGeometry(1, detail); g.userData.sphere = true; return g; };
export const box = (w, h, d) => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
