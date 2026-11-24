// Toolbox life: the woods' and old fields' wildlife (user, 24 Nov 2026, Camillus Forest: "No hikers in the Camillus
// woods" → "Wildlife instead: no people; a deer, chipmunks or birds at fixed spots"). Upstate New York's commonest:
// white-tailed deer (a doe and her yearlings browsing at the woods' edge or standing among the trunks), a flock of
// wild turkeys picking over a meadow, chipmunks on the fallen logs, and crows wheeling over the fields.
//
//   const life = new ForestLife(parent, { uTime })
//   life.place([{ kind: 'deer' | 'turkey' | 'chipmunk', x, y, z, yaw }…], [{ x, y, z, r }…  crows' circles])
//   life.tick(time)
//
// Instanced, one draw call a kind. The animals stay where they are put; a head goes down to graze (or peck) and comes
// up to look about, each on its own clock (a vertex attribute marks the head; the shader turns it about the neck);
// the crows circle, flapping in bursts (coast-life.js's birds).
import * as THREE from '../../../../vendor/three.module.min.js';
import { MeshBuilder } from '../core/mesh-builder.js';
import { birdGeometry, birdMaterial } from './coast-life.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** A white-tailed deer (a doe; +z forward, 0 at the hooves): fall's grey-brown coat, white throat, belly and tail's
 *  underside, black nose; the head and neck carry aHead = 1 (they swing down to graze about the withers). */
function deerGeometry() {
  const M = new MeshBuilder({ aHead: 1 });
  const H = (h) => M.set({ aHead: [h] });
  H(0);
  M.color('#7a634e'); M.beam(V(0, 1.02, -.5), V(0, 1.06, .48), .42, .46);            // the barrel
  M.color('#857059'); M.beam(V(0, 1.12, .38), V(0, 1.12, .58), .38, .34);             // the shoulders
  M.color('#efe9de'); M.beam(V(0, .86, -.35), V(0, .88, .3), .3, .08);                 // the belly
  M.color('#7a634e'); M.beam(V(0, 1.12, -.55), V(0, 1.0, -.72), .14, .1);              // the tail…
  M.color('#f4f1ea'); M.beam(V(0, 1.06, -.6), V(0, .96, -.74), .12, .05);              // …its white underside
  for (const [x, z] of [[-.14, .45], [.14, .45], [-.14, -.42], [.14, -.42]]) {
    M.color('#6e5a46'); M.beam(V(x, .9, z), V(x, .45, z + (z > 0 ? .02 : -.04)), .09, .09);
    M.color('#5c4b3b'); M.beam(V(x, .45, z + (z > 0 ? .02 : -.04)), V(x, .04, z), .055, .055);
    M.color('#2a2420'); M.box(x, 0, z, .06, .06, .08);
  }
  H(1);   // the neck and head
  M.color('#7f6852'); M.beam(V(0, 1.18, .55), V(0, 1.58, .78), .2, .22);
  M.color('#ece6da'); M.beam(V(0, 1.22, .66), V(0, 1.5, .84), .1, .08);               // the throat patch
  M.color('#806a54'); M.beam(V(0, 1.62, .74), V(0, 1.5, 1.06), .17, .2);              // the head
  M.color('#1d1a18'); M.box(0, 1.47, 1.04, .07, .06, .06);                             // the nose
  M.color('#7b6550'); for (const s of [-1, 1]) M.beam(V(s * .06, 1.7, .78), V(s * .18, 1.86, .74), .07, .03);   // ears
  return M.geometry();
}

/** A wild turkey hen (+z forward): dark bronze body, barred wings, a small bare blue-grey head on a thin neck (aHead). */
function turkeyGeometry() {
  const M = new MeshBuilder({ aHead: 1 });
  const H = (h) => M.set({ aHead: [h] });
  H(0);
  M.color('#3b2f25'); M.beam(V(0, .52, -.28), V(0, .56, .2), .34, .36);
  M.color('#5a4634'); for (const s of [-1, 1]) M.beam(V(s * .17, .55, .1), V(s * .17, .5, -.28), .04, .22);   // the wings, barred lighter
  M.color('#4a3a2c'); M.beam(V(0, .56, -.28), V(0, .5, -.5), .3, .08);                 // the tail, folded
  M.color('#8a7a62'); for (const s of [-1, 1]) M.beam(V(s * .07, .36, 0), V(s * .07, 0, .03), .035, .035);
  H(1);
  M.color('#3e3128'); M.beam(V(0, .62, .18), V(0, .8, .3), .1, .1);
  M.color('#8d97a8'); M.beam(V(0, .8, .29), V(0, .82, .4), .07, .07);
  M.color('#b8433a'); M.box(0, .74, .32, .03, .06, .03);
  return M.geometry();
}

/** An eastern chipmunk sitting up on a log: russet with its dark-and-pale back stripes, tail up behind (aHead: the head). */
function chipmunkGeometry() {
  const M = new MeshBuilder({ aHead: 1 });
  M.set({ aHead: [0] });
  M.color('#9a6a3e'); M.beam(V(0, 0, -.04), V(0, .11, .03), .07, .08);
  M.color('#3a2a1e'); M.beam(V(0, .03, -.07), V(0, .11, -.01), .015, .02);
  M.color('#d9c7a8'); M.beam(V(0, .02, .03), V(0, .1, .05), .04, .02);
  M.color('#7d5734'); M.beam(V(0, .02, -.08), V(0, .12, -.15), .03, .03);
  M.set({ aHead: [1] });
  M.color('#9c6c40'); M.beam(V(0, .11, .03), V(0, .15, .07), .055, .055);
  return M.geometry();
}

function headMaterial(uTime, { swing = 1.05, pivot = [0, 1.12, .55], rate = .23, color = null } = {}) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; attribute float aHead;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        // the head down to graze (or peck) and back up to look about: each animal on its own clock (its place)
        if (aHead > .5) {
          float ph = 0.;
          #ifdef USE_INSTANCING
            ph = instanceMatrix[3].x * .71 + instanceMatrix[3].z * .37;
          #endif
          float cyc = sin(uTime * ${rate.toFixed(3)} + ph) * .5 + .5 + .25 * sin(uTime * ${(rate * 3.1).toFixed(3)} + ph * 2.);
          float a = -${swing.toFixed(3)} * smoothstep(.35, .7, cyc) + .08 * sin(uTime * 1.7 + ph);
          vec3 pv = vec3(${pivot.map((v) => v.toFixed(3)).join(', ')});
          vec3 q = transformed - pv; float c = cos(a), s = sin(a);
          transformed = pv + vec3(q.x, q.y * c - q.z * s, q.y * s + q.z * c);
        }`);
  };
  m.customProgramCacheKey = () => `forest-life-head-${swing}-${rate}-${pivot.join(',')}`;
  return m;
}

export class ForestLife {
  constructor(parent, { uTime }) {
    this.parent = parent; this.uTime = uTime;
    const kinds = {
      deer: [deerGeometry(), headMaterial(uTime, { swing: 1.15, pivot: [0, 1.18, .55], rate: .19 })],
      turkey: [turkeyGeometry(), headMaterial(uTime, { swing: 1.3, pivot: [0, .62, .18], rate: .9 })],
      chipmunk: [chipmunkGeometry(), headMaterial(uTime, { swing: .5, pivot: [0, .11, .03], rate: 2.3 })],
    };
    this.meshes = {};
    for (const [k, [g, m]] of Object.entries(kinds)) {
      const im = new THREE.InstancedMesh(g, m, 1); im.count = 0; im.name = `Forest life: ${k}`; im.frustumCulled = false; im.castShadow = false;
      parent.add(im); this.meshes[k] = im;
    }
    this.birdMesh = null; this.circles = [];
  }

  /** The animals, each { kind, x, y, z, yaw }; and the crows' circles { x, y, z, r }. */
  place(list, circles = []) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = V(0, 1, 0), s = V(1, 1, 1);
    for (const [k, im0] of Object.entries(this.meshes)) {
      const mine = list.filter((a) => a.kind === k);
      let im = im0;
      if (mine.length > im.instanceMatrix.count) {
        im = new THREE.InstancedMesh(im0.geometry, im0.material, mine.length); im.name = im0.name; im.frustumCulled = false;
        this.parent.remove(im0); im0.dispose(); this.parent.add(im); this.meshes[k] = im;
      }
      mine.forEach((a, i) => { q.setFromAxisAngle(Y, a.yaw); s.setScalar(a.s || 1); im.setMatrixAt(i, m.compose(V(a.x, a.y, a.z), q, s)); });
      im.count = mine.length; im.instanceMatrix.needsUpdate = true;
    }
    this.circles = circles;
    if (circles.length && !this.birdMesh) {
      const n = circles.reduce((a, c) => a + (c.n || 3), 0);
      this.birdMesh = new THREE.InstancedMesh(birdGeometry('raven'), birdMaterial({ uTime: this.uTime }, 9), n);
      this.birdMesh.name = 'Forest life: crows'; this.birdMesh.frustumCulled = false; this.parent.add(this.birdMesh);
    }
  }

  tick(time) {
    if (!this.birdMesh) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = V(1, 1, 1);
    let k = 0;
    for (const c of this.circles) for (let b = 0; b < (c.n || 3); b++) {
      const w = .16 + b * .013, a = time * w + b * 2.1 + c.x * .01, r = c.r * (1 + .15 * Math.sin(time * .2 + b));
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r, y = c.y + 3 * Math.sin(time * .3 + b * 1.7);
      // heading along the circle (counter-clockwise: the tangent), banked into it
      e.set(0, -a, -.35); q.setFromEuler(e);
      this.birdMesh.setMatrixAt(k++, m.compose(V(x, y, z), q, one));
    }
    this.birdMesh.count = k; this.birdMesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const im of Object.values(this.meshes)) { this.parent.remove(im); im.geometry.dispose(); im.material.dispose(); }
    if (this.birdMesh) { this.parent.remove(this.birdMesh); this.birdMesh.geometry.dispose(); this.birdMesh.material.dispose(); }
  }
}
