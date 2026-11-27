// Toolbox: coast life kit, the default "life" on real-coast scenes (or "life": { "kit": "coast" }).
// Sea birds, grazing cattle and lighthouses from the scene's life block; first built for Big Sur:
//
// Life and landmarks on the real Big Sur coast: brown pelicans gliding in lines low over the sea,
// gulls wheeling along the cliffs, a California condor soaring over the ridges, cattle grazing the
// marine terrace by Point Sur, and the Point Sur lighthouse on its rock (its lamp turns at night).
// Birds flap in the vertex shader; everything is instanced.
import * as THREE from '../../../../vendor/three.js';
import { MeshBuilder } from '../core/mesh-builder.js';
import { randomSequence } from '../core/random.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _P = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1);   // [review 27 Nov] tick's scratch (was a V() per animal per frame)

// aWing: 0 body, ±1 along each wing (|x| from the body sets how far a vertex lifts)
export function birdGeometry(kind) {
  const M = new MeshBuilder({ aWing: 1 });
  const W = (w) => M.set({ aWing: [w] });
  // (Glacier: ravens and a golden eagle)
  const span = { condor: 2.9, pelican: 2.2, eagle: 2.1, raven: 1.2 }[kind] || 1.1;
  const body = { condor: '#1d1d1d', pelican: '#8a7f70', eagle: '#4a3524', raven: '#141416' }[kind] || '#f1f1ee';
  const wing = { condor: '#202020', pelican: '#6f6659', eagle: '#3f2d1f', raven: '#18181b' }[kind] || '#e4e6e8';
  const tip = { condor: '#e8e2d2', pelican: '#3a342c', eagle: '#2a1f17', raven: '#0e0e10' }[kind] || '#3b3f44';
  const L = span * .42;
  W(0); M.color(body); M.beam(V(0, 0, -L * .5), V(0, 0, L * .55), span * .09, span * .08);
  if (kind === 'pelican') { M.color('#c9a24a'); M.beam(V(0, -.02, L * .55), V(0, -.06, L * 1.05), .07, .06); }
  if (kind === 'condor') { M.color('#c46a52'); M.box(0, -.06, L * .62, .1, .1, .12); }
  if (kind === 'eagle') { M.color('#b08a4a'); M.box(0, -.02, L * .6, .16, .14, .2); }
  // wings: inner and outer panels, flat, with darker tips
  for (const side of [-1, 1]) {
    const a = V(side * span * .04, 0, .06 * span), b = V(side * span * .04, 0, -.12 * span);
    const c = V(side * span * .27, 0, -.15 * span), d = V(side * span * .27, 0, .05 * span);
    const e = V(side * span * .5, 0, -.1 * span), f = V(side * span * .5, 0, -.02 * span);
    W(0); M.color(wing);
    side > 0 ? M.quad(a, d, c, b) : M.quad(a, b, c, d);
    W(side); M.color(tip);
    side > 0 ? M.quad(d, f, e, c) : M.quad(d, c, e, f);
    // underside so the wing reads from below
    W(0); M.color(wing); side > 0 ? M.quad(a, b, c, d) : M.quad(a, d, c, b);
    W(side); M.color(tip); side > 0 ? M.quad(d, c, e, f) : M.quad(d, f, e, c);
  }
  M.color(body); W(0); M.beam(V(0, 0, -L * .5), V(0, 0, -L * .85), span * .12, span * .02);   // tail
  return M.geometry();
}

export function birdMaterial(uniforms, flap) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; attribute float aWing;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float bfPh = 0.;
        #ifdef USE_INSTANCING
          bfPh = instanceMatrix[3].x * .37 + instanceMatrix[3].z * .23;
        #endif
        // bursts of flapping between glides
        float bfBurst = smoothstep(.55, .8, sin(uTime * ${(flap * .18).toFixed(3)} + bfPh));
        float bfFlap = sin(uTime * ${flap.toFixed(2)} + bfPh * 3.) * (.15 + .85 * bfBurst);
        float bfReach = abs(position.x);
        transformed.y += bfFlap * bfReach * .55 + bfReach * .08 + abs(aWing) * bfFlap * .15;`);
  };
  m.customProgramCacheKey = () => `bf-bird-${flap}`;
  return m;
}

function cowGeometry() {
  const M = new MeshBuilder();
  M.color('#ffffff'); M.box(0, .75, 0, .75, .8, 1.7);                   // body (tinted per cow)
  M.box(0, 1.15, 1.0, .42, .42, .55);                                    // head
  M.color('#e9d8c8'); M.box(0, 1.08, 1.32, .34, .22, .1);                // muzzle
  M.color('#2a2522'); for (const [x, z] of [[-.25, -.6], [.25, -.6], [-.25, .6], [.25, .6]]) M.box(x, 0, z, .16, .78, .16);
  M.box(0, .95, -.88, .06, .5, .06);                                       // tail
  return M.geometry();
}

export class CoastLife {
  constructor(parent, landscape, proj, route, index, uniforms, config = {}) {
    this._nearRoad = (x, z) => !!index.nearest(x, z, 28);
    this.L = landscape; this.proj = proj; this.route = route; this.u = uniforms;
    this.group = new THREE.Group(); this.group.name = 'Coast life'; parent.add(this.group);
    this.rand = randomSequence(4411);
    this.disposables = [];
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._birds();
    for (const lh of config.lighthouses || []) this._lighthouse(lh);
    for (const herd of config.cattle || []) this._cattle(herd);
  }

  _own(x) { this.disposables.push(x); return x; }

  _birds() {
    const make = (kind, n, flap) => {
      const mesh = new THREE.InstancedMesh(this._own(birdGeometry(kind)), this._own(birdMaterial(this.u, flap)), n);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; mesh.castShadow = true; mesh.name = `Birds · ${kind}`;
      this.group.add(mesh); return mesh;
    };
    this.pelicans = make('pelican', 14, 5.5);
    this.gulls = make('gull', 16, 9);
    this.condors = make('condor', 2, 2.2);
    this.flocks = Array.from({ length: 2 }, () => ({ alive: false }));
    this.gullAgents = Array.from({ length: 16 }, () => ({ alive: false }));
    this.condorAgents = Array.from({ length: 2 }, () => ({ alive: false }));
  }

  // A point on the shore near (x, z): walk downhill in the shore field to the water's edge.
  _shoreNear(x, z, offshore) {
    const S = this.L.inlandAt;
    for (let k = 0; k < 60; k++) {
      const d = S(x, z), gx = S(x + 10, z) - S(x - 10, z), gz = S(x, z + 10) - S(x, z - 10), g = Math.hypot(gx, gz) || 1;
      const err = d + offshore;
      if (Math.abs(err) < 6) break;
      x -= gx / g * err * .8; z -= gz / g * err * .8;
    }
    const gx = S(x + 10, z) - S(x - 10, z), gz = S(x, z + 10) - S(x, z - 10), g = Math.hypot(gx, gz) || 1;
    return { x, z, tx: -gz / g, tz: gx / g };   // tangent along the shore
  }

  _spawnFlock(f, cam) {
    const a = this.rand() * Math.PI * 2, r = 250 + this.rand() * 450;
    const p = this._shoreNear(cam.x + Math.cos(a) * r, cam.z + Math.sin(a) * r, 40 + this.rand() * 140);
    const dir = this.rand() < .5 ? 1 : -1;
    Object.assign(f, { alive: true, x: p.x - p.tx * dir * 400, z: p.z - p.tz * dir * 400, tx: p.tx * dir, tz: p.tz * dir,
      y: 5 + this.rand() * 9, n: 4 + Math.floor(this.rand() * 4), speed: 10 + this.rand() * 3, life: 0 });
  }

  tick(dt, camera) {
    const cam = camera, t = this.u.uTime.value;
    // pelicans: lines skimming low over the swell, following the shore
    let k = 0;
    for (const f of this.flocks) {
      if (!f.alive || Math.hypot(f.x - cam.x, f.z - cam.z) > 1600 || f.life > 160) this._spawnFlock(f, cam);
      f.life += dt;
      // steer along the shore, holding the offshore distance
      const d = this.L.inlandAt(f.x, f.z);
      const gx = this.L.inlandAt(f.x + 10, f.z) - this.L.inlandAt(f.x - 10, f.z), gz = this.L.inlandAt(f.x, f.z + 10) - this.L.inlandAt(f.x, f.z - 10), g = Math.hypot(gx, gz) || 1;
      let tx = f.tx - gx / g * Math.max(-.4, Math.min(.4, (d + 90) / 200)), tz = f.tz - gz / g * Math.max(-.4, Math.min(.4, (d + 90) / 200));
      const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      f.tx += (tx - f.tx) * Math.min(1, dt * .5); f.tz += (tz - f.tz) * Math.min(1, dt * .5);
      const l2 = Math.hypot(f.tx, f.tz) || 1; f.tx /= l2; f.tz /= l2;
      f.x += f.tx * f.speed * dt; f.z += f.tz * f.speed * dt;
      const yaw = Math.atan2(f.tx, f.tz);
      for (let i = 0; i < f.n && k < this.pelicans.count; i++, k++) {
        // a staggered line, each bird rising and falling a little on its own
        const back = i * 3.2, side = (i % 2 ? 1 : -1) * i * .6;
        const x = f.x - f.tx * back - f.tz * side, z = f.z - f.tz * back + f.tx * side;
        const y = f.y + Math.sin(t * .6 + i * .9) * .7;
        this.e.set(0, yaw, Math.sin(t * .4 + i) * .08); this.q.setFromEuler(this.e);
        this.pelicans.setMatrixAt(k, this.m.compose(_P.set(x, y, z), this.q, ONE));
      }
    }
    for (; k < this.pelicans.count; k++) this.pelicans.setMatrixAt(k, this.m.makeScale(0, 0, 0));
    this.pelicans.instanceMatrix.needsUpdate = true;
    // gulls: wheeling over the cliffs and the surf
    this.gullAgents.forEach((a, i) => {
      if (!a.alive || Math.hypot(a.cx - cam.x, a.cz - cam.z) > 900) {
        const ang = this.rand() * Math.PI * 2, p = this._shoreNear(cam.x + Math.cos(ang) * 300, cam.z + Math.sin(ang) * 300, -10 + this.rand() * 80);
        const r = 15 + this.rand() * 45;
        // keep clear of the bridges: no circling through a deck or an arch
        if (this.L.bridges?.some((b) => Math.hypot(b.x - p.x, b.z - p.z) < r + b.span / 2 + 35)) { a.alive = false; return; }
        Object.assign(a, { alive: true, cx: p.x, cz: p.z, r, h: Math.max(14, (this.L.baseHeight(p.x, p.z) || 0) + 8 + this.rand() * 40), w: (.2 + this.rand() * .25) * (this.rand() < .5 ? 1 : -1), a: this.rand() * 6.28 });
      }
      if (!a.alive) { this.gulls.setMatrixAt(i, this.m.makeScale(0, 0, 0)); return; }
      a.a += a.w * dt;
      const x = a.cx + Math.cos(a.a) * a.r, z = a.cz + Math.sin(a.a) * a.r;
      const yaw = Math.atan2(-Math.sin(a.a) * Math.sign(a.w), Math.cos(a.a) * Math.sign(a.w));
      this.e.set(0, yaw, -Math.sign(a.w) * .35); this.q.setFromEuler(this.e);
      this.gulls.setMatrixAt(i, this.m.compose(_P.set(x, a.h + Math.sin(t + i) * 2, z), this.q, ONE));
    });
    this.gulls.instanceMatrix.needsUpdate = true;
    // condors: big slow circles high over the ridges inland
    this.condorAgents.forEach((a, i) => {
      if (!a.alive || Math.hypot(a.cx - cam.x, a.cz - cam.z) > 2500) {
        let best = null;
        for (let n = 0; n < 12; n++) {
          const ang = this.rand() * Math.PI * 2, r = 500 + this.rand() * 900, x = cam.x + Math.cos(ang) * r, z = cam.z + Math.sin(ang) * r;
          if (this.L.inlandAt(x, z) < 400) continue;
          const h = this.L.baseHeight(x, z);
          if (!best || h > best.h) best = { x, z, h };
        }
        if (!best) return;
        Object.assign(a, { alive: true, cx: best.x, cz: best.z, r: 80 + this.rand() * 120, h: best.h + 120 + this.rand() * 160, w: .07 + this.rand() * .05, a: this.rand() * 6.28 });
      }
      a.a += a.w * dt; a.cx += .8 * dt;
      const x = a.cx + Math.cos(a.a) * a.r, z = a.cz + Math.sin(a.a) * a.r;
      this.e.set(0, Math.atan2(-Math.sin(a.a), Math.cos(a.a)), -.25); this.q.setFromEuler(this.e);
      this.condors.setMatrixAt(i, this.m.compose(_P.set(x, a.h, z), this.q, ONE));
    });
    this.condors.instanceMatrix.needsUpdate = true;
    if (this.beam) this.beam.rotation.y = t * .9;
  }

  _lighthouse(lh) {
    const p = this.proj.toLocal(lh.lat, lh.lon), y = this.L.baseHeight(p.x, p.z);
    const M = new MeshBuilder({ aGlow: 1 });
    const G = (g) => M.set({ aGlow: [g] });
    G(0);
    M.color('#c9bb98'); M.cylinder(0, y - 1, 0, 2.1, 13, 12, 1.6);              // sandstone tower
    M.color('#2c2c2c'); M.cylinder(0, y + 12, 0, 2.4, .35, 12);                 // gallery
    M.color('#3a3a3a'); for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; M.box(Math.cos(a) * 2.3, y + 12.3, Math.sin(a) * 2.3, .06, .9, .06); }
    G(1); M.color('#fff2c4'); M.cylinder(0, y + 12.35, 0, 1.25, 2.1, 12);       // lantern glass
    G(0); M.color('#7c2b1f'); M.cylinder(0, y + 14.4, 0, 1.45, 1.1, 12, .15);  // roof
    M.color('#e9e1cf'); M.box(5.5, y - 1, 1, 7, 4.6, 9); M.color('#7c2b1f'); M.box(5.5, y + 3.6, 1, 7.6, .5, 9.6);   // keeper's quarters
    M.color('#cfc5ad'); M.box(-6, y - 1, -3, 5, 3.6, 6);
    const geometry = this._own(M.geometry());
    const material = this._own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .85 }));
    this.lampNight = { value: 0 };
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uNight = this.lampNight;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float aGlow; varying float vGlow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight; varying float vGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nif (vGlow > .5) totalEmissiveRadiance += vec3(1., .9, .65) * (.2 + uNight * 5.);');
    };
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(p.x, y * (1 - 1.35), p.z); mesh.scale.setScalar(1.35); mesh.castShadow = mesh.receiveShadow = true; mesh.name = 'Point Sur Lighthouse';
    this.group.add(mesh);
    // the turning beam (night only)
    const cone = new THREE.ConeGeometry(14, 260, 16, 1, true); cone.translate(0, -130, 0); cone.rotateZ(Math.PI / 2);
    const beamMat = new THREE.MeshBasicMaterial({ color: '#fff3c8', transparent: true, opacity: .08, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    this.beam = new THREE.Mesh(this._own(cone), this._own(beamMat));
    this.beam.position.set(p.x, y + 13.4, p.z); this.beam.visible = false; this.beam.name = 'Lighthouse beam';
    this.group.add(this.beam);
  }

  _cattle(herd) {
    const c = this.proj.toLocal(herd.lat, herd.lon), rand = randomSequence(911);
    const matrices = [], colors = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    const coat = ['#2a211c', '#3b2a20', '#6b4a33', '#2a211c', '#e8e2d6', '#8b5a3c'];
    for (let k = 0, tries = 0; k < (herd.count || 30) && tries < 600; tries++) {
      // grazing in loose groups on gentle ground, away from the road and the cliff edge
      const g = Math.floor(rand() * 4), ga = g * 1.7 + 1, gr = (herd.radiusM || 600) * .6;
      const x = c.x + Math.cos(ga) * gr * rand() + (rand() - .5) * 90, z = c.z + Math.sin(ga) * gr * rand() + (rand() - .5) * 90;
      const y = this.L.baseHeight(x, z), slope = Math.hypot(this.L.baseHeight(x + 4, z) - y, this.L.baseHeight(x, z + 4) - y) / 4;
      if (slope > .18 || this.L.inlandAt(x, z) < 60 || y < 3) continue;
      if (this.L.bridgeAt(x, z, 10) || this._nearRoad?.(x, z)) continue;
      q.setFromAxisAngle(V(0, 1, 0), rand() * Math.PI * 2);
      matrices.push(m.compose(V(x, y - .05, z), q, V(1, 1, 1)).clone()); colors.push(coat[Math.floor(rand() * coat.length)]);
      k++;
    }
    if (!matrices.length) return;
    const mesh = new THREE.InstancedMesh(this._own(cowGeometry()), this._own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95 })), matrices.length);
    matrices.forEach((mm, i) => { mesh.setMatrixAt(i, mm); mesh.setColorAt(i, new THREE.Color(colors[i])); });
    mesh.castShadow = mesh.receiveShadow = true; mesh.name = 'Cattle on the marine terrace'; mesh.computeBoundingSphere();
    this.group.add(mesh);
  }

  setNight(v) { if (this.lampNight) this.lampNight.value = v; if (this.beam) this.beam.visible = v > .5; }

  dispose() {
    this.group.removeFromParent();
    for (const m of [this.pelicans, this.gulls, this.condors]) m?.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
