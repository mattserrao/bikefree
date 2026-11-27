// The graph world's mesh helpers. [review 27 Nov] W14: Mesher out of graph-world.js (the tile jobs' triangle
// gatherer) and gpuOnly out of graph-city.js, as they were.
import * as THREE from '../../../vendor/three.js';

const ZERO4 = [0, 0, 0, 3];   // (a triangle with no road attribute: surface 0, half width 3)

/** Triangles with flat colours, gathered then made one mesh. */
export class Mesher {
  /** `road`: the road surface's attribute too (aRd: surface code, metres across from the centre, metres along, half width). */
  constructor(road = false) { this.pos = []; this.col = []; this.nrm = []; this.rd = road ? [] : null; }
  _tri(a, b, c, color, ra = null, rb = null, rc = null) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const p of [a, b, c]) { this.pos.push(p[0], p[1], p[2]); this.col.push(color.r, color.g, color.b); this.nrm.push(nx, ny, nz); }
    if (this.rd) for (const r of [ra, rb, rc]) this.rd.push(...(r || ZERO4));
  }
  /** A road quad with its aRd per corner. */
  quadX(a, b, c, d, color, r) { this._tri(a, b, c, color, r[0], r[1], r[2]); this._tri(a, c, d, color, r[0], r[2], r[3]); }
  discX(x, y, z, r, color, seg = 14, surf = 0) {
    const rd = [surf, 0, 0, r];
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      this._tri([x, y, z], [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r], [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r], color, rd, rd, rd);
    }
  }
  quad(a, b, c, d, color, flip = false) {
    if (flip) { this._tri(a, c, b, color); this._tri(a, d, c, color); }
    else { this._tri(a, b, c, color); this._tri(a, c, d, color); }
  }
  /** A vertical wall under/over the edge p0 → p1, from y + y0 to y + y1. */
  wall(p0, p1, y0, y1, color, flip) {
    this.quad([p0[0], p0[1] + y0, p0[2]], [p1[0], p1[1] + y0, p1[2]], [p1[0], p1[1] + y1, p1[2]], [p0[0], p0[1] + y1, p0[2]], color, flip);
  }
  mesh(material) {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.rd) g.setAttribute('aRd', new THREE.Float32BufferAttribute(this.rd, 4));
    g.computeBoundingSphere();
    return new THREE.Mesh(g, material);
  }
}

/** A static mesh's arrays let go once they're on the GPU (no second copy in the page's memory: phones, user 23 Nov —
 *  "even on high … should not run out of memory"); its bounds kept first. Not for anything read back later. */
export function gpuOnly(m) {
  const g = m.geometry; g.computeBoundingSphere(); if (!g.boundingBox) g.computeBoundingBox();
  const drop = function () { if (!globalThis.BF_KEEP_GEOMETRY) this.array = null; };   // (BF_KEEP_GEOMETRY: a bench that uploads the scene to a second renderer)
  for (const a of Object.values(g.attributes)) a.onUpload(drop);
  g.index?.onUpload(drop);
  return m;
}
