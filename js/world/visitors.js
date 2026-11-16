// Visitors: people at the stops along a scenic road — standing at the overlooks taking it in, wandering
// slowly around a car park or a lodge. One animated instanced mesh (legs and arms swing in the vertex
// shader); only the people near the camera are updated each frame. Portable: a scene's "visitors" block.
//
//   "visitors": {
//     "spots": [ { "site": "Logan Pass parking", "count": 14 },              // around a site pad
//                { "atM": 22312, "side": -1, "lateralM": 16, "radiusM": 14, "count": 6 } ],
//     "lookouts": 3,          // people at each overlook in the scene's "lookouts"
//     "walking": 0.45         // share who stroll (the rest stand, facing the view)
//   }
import * as THREE from '../../vendor/three.module.min.js';
import { MeshBuilder } from './city-geometry.js';
import { randomSequence } from './coast.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ROAD_HALF = 3.5;
const SHIRTS = ['#c0392b', '#2e86c1', '#f1c40f', '#27ae60', '#8e44ad', '#e67e22', '#ecf0f1', '#34495e', '#d35400', '#16a085', '#7f8c8d', '#e84393'];
const PANTS = ['#2c3e50', '#4a4a4a', '#6b5b45', '#1f3a5f', '#7a6a55', '#3b3b3b'];
const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];

function personGeometry() {
  // parts: 1 left leg, 2 right leg, 3 left arm, 4 right arm (they swing); masks pick shirt / pants / skin
  const M = new MeshBuilder({ aPart: 1, aMask: 3 });
  const P = (part, mask) => M.set({ aPart: [part], aMask: mask });
  P(1, [0, 1, 0]); M.box(-.1, .1, 0, .15, .84, .17); P(2, [0, 1, 0]); M.box(.1, .1, 0, .15, .84, .17);
  M.color('#2a2522'); P(1, [0, 0, 0]); M.box(-.1, 0, .03, .15, .1, .27); P(2, [0, 0, 0]); M.box(.1, 0, .03, .15, .1, .27);
  M.color('#fff'); P(0, [1, 0, 0]); M.box(0, .9, 0, .44, .62, .25);
  P(3, [1, 0, 0]); M.box(-.28, .92, 0, .11, .56, .13); P(4, [1, 0, 0]); M.box(.28, .92, 0, .11, .56, .13);
  P(3, [0, 0, 1]); M.box(-.28, .8, 0, .09, .12, .1); P(4, [0, 0, 1]); M.box(.28, .8, 0, .09, .12, .1);
  P(0, [0, 0, 1]); M.box(0, 1.52, 0, .22, .27, .24);
  M.color('#3a2e22'); P(0, [0, 0, 0]); M.box(0, 1.74, -.01, .24, .08, .26);
  M.color('#2b3b46'); P(0, [0, 0, 0]); M.box(0, .95, -.19, .3, .4, .14);   // a small day pack
  return M.geometry();
}

function material(uTime) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .85 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; attribute float aPart; attribute vec3 aMask; attribute vec3 iA; attribute vec3 iB; attribute vec3 iC; attribute vec2 iAnim;`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position);
        float gait = iAnim.y;                                // 0 standing, 1 strolling
        float sw = sin(uTime * 6.2 + iAnim.x) * .42 * gait;
        float ang = aPart > .5 && aPart < 1.5 ? sw : aPart > 1.5 && aPart < 2.5 ? -sw : aPart > 2.5 && aPart < 3.5 ? -sw * .8 : aPart > 3.5 ? sw * .8 : 0.;
        float pivot = aPart < 2.5 ? .92 : 1.45;
        if (aPart > .5) { float y = transformed.y - pivot, z = transformed.z, c = cos(ang), s = sin(ang); transformed.y = pivot + y * c - z * s; transformed.z = y * s + z * c; }
        // standing: a slow shift of weight
        transformed.x += sin(uTime * .8 + iAnim.x) * .025 * transformed.y * (1. - gait);
        transformed.y += abs(sw) * .035;`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        vColor.rgb = vColor.rgb * clamp(1. - aMask.x - aMask.y - aMask.z, 0., 1.) + iA * aMask.x + iB * aMask.y + iC * aMask.z;`);
  };
  m.customProgramCacheKey = () => 'bf-visitors-1';
  return m;
}

export class Visitors {
  constructor(parent, landscape, route, index, uniforms, config = {}, quality = 'balanced', lookouts = []) {
    this.L = landscape; this.route = route; this.index = index; this.u = uniforms;
    this.group = new THREE.Group(); this.group.name = 'Visitors'; parent.add(this.group);
    const rand = (this.rand = randomSequence(6061));
    const scale = quality === 'low' ? .5 : quality === 'high' ? 1.25 : 1;
    const walking = config.walking ?? .45, people = [];
    const spot = (cx, cz, rIn, rOut, count, face) => {
      for (let k = 0, tries = 0; k < Math.round(count * scale) && tries < 400; tries++) {
        const a = rand() * Math.PI * 2, r = rIn + Math.sqrt(rand()) * (rOut - rIn), x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        const y = this.L.heightAt(x, z);
        if (this.index.nearest(x, z, ROAD_HALF + .9) || this.L.isWater?.(x, z, y)) continue;
        const walk = rand() < walking;
        people.push({ cx, cz, r: Math.hypot(x - cx, z - cz), a: Math.atan2(z - cz, x - cx), x, z, y, walk, w: (walk ? .9 + rand() * .5 : 0) * (rand() < .5 ? 1 : -1), yaw: face ?? rand() * 6.28, phase: rand() * 6.28 });
        k++;
      }
    };
    for (const sp of config.spots || []) {
      if (sp.site) {
        const t = (this.L.sites || []).find((x) => x.name === sp.site);
        if (t) spot(t.x, t.z, sp.innerM ?? 2, sp.radiusM ?? Math.hypot(t.hw, t.hl) * .9, sp.count ?? 8);
        continue;
      }
      const p = this.L.frameAt(sp.atM), side = sp.side ?? 1, lat = sp.lateralM ?? 12;
      spot(p.x - p.fz * side * lat, p.z + p.fx * side * lat, 0, sp.radiusM ?? 12, sp.count ?? 5);
    }
    // overlooks: a few people at the rail looking out (facing away from the road)
    for (const l of config.lookouts ? lookouts : []) {
      const p = this.L.frameAt(l.atM), side = l.side === 'inland' ? -1 : 1, lat = ROAD_HALF + (l.widthM || 9) * .6;
      const face = Math.atan2(-p.fz * side, p.fx * side);
      spot(p.x - p.fz * side * lat, p.z + p.fx * side * lat, 0, Math.min(10, (l.lengthM || 30) / 3), config.lookouts, face);
    }
    this.people = people;
    const geometry = personGeometry(), n = Math.max(1, people.length);
    for (const [k, size] of [['iA', 3], ['iB', 3], ['iC', 3], ['iAnim', 2]]) geometry.setAttribute(k, new THREE.InstancedBufferAttribute(new Float32Array(n * size), size));
    this.mat = material(uniforms.uTime);
    this.mesh = new THREE.InstancedMesh(geometry, this.mat, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.name = 'Visitors';
    const col = new THREE.Color(), set = (attr, i, hex) => { col.set(hex); geometry.attributes[attr].setXYZ(i, col.r, col.g, col.b); };
    people.forEach((p, i) => {
      set('iA', i, SHIRTS[Math.floor(rand() * SHIRTS.length)]); set('iB', i, PANTS[Math.floor(rand() * PANTS.length)]); set('iC', i, SKIN[Math.floor(rand() * SKIN.length)]);
      geometry.attributes.iAnim.setXY(i, p.phase, p.walk ? 1 : 0);
    });
    this.mesh.count = people.length;
    this.group.add(this.mesh);
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.hide = new THREE.Matrix4().makeScale(0, 0, 0); this.up = V(0, 1, 0);
    this._place(null, 0, true);
  }

  _place(cam, dt, all = false) {
    const { m, q, up } = this;
    this.people.forEach((p, i) => {
      const near = all || !cam || Math.hypot(p.x - cam.x, p.z - cam.z) < 600;
      if (!near) { this.mesh.setMatrixAt(i, this.hide); return; }
      if (p.walk && dt) {
        // stroll around the spot on a slowly wandering circle
        p.a += p.w * dt / Math.max(4, p.r);
        const x = p.cx + Math.cos(p.a) * p.r, z = p.cz + Math.sin(p.a) * p.r;
        if (!this.index.nearest(x, z, ROAD_HALF + .9)) { p.yaw = Math.atan2(x - p.x, z - p.z); p.x = x; p.z = z; p.y = this.L.heightAt(x, z); }
        else p.w = -p.w;   // turn back at the road
      }
      q.setFromAxisAngle(up, p.yaw);
      this.mesh.setMatrixAt(i, m.compose(V(p.x, p.y - .03, p.z), q, V(1, 1, 1)));
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  tick(dt, camera) { this._place(camera.position || camera, dt); }

  dispose() {
    this.group.removeFromParent();
    this.mesh.geometry.dispose(); this.mesh.dispose(); this.mat.dispose();
  }
}
