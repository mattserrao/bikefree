import * as THREE from '../../vendor/three.module.min.js';
import { randomSequence } from './coast.js';

/** The same outbound-road frame is used for signs, markers and turnouts. */
export function coastalRoadFrame(route, index, distance, lateral = 0) {
  const s = Math.max(0, Math.min(route.turnS || route.total, distance));
  const i = Math.min((route.turnIdx || route.dist.length - 1) - 1, Math.floor(s / 10));
  const j = i + 1, f = Math.min(1, (s - route.dist[i]) / (route.dist[j] - route.dist[i] || 1));
  const forward = new THREE.Vector3(index.xs[j] - index.xs[i], route.ele[j] - route.ele[i], index.zs[j] - index.zs[i]).normalize();
  const right = new THREE.Vector3(-forward.z, 0, forward.x).normalize();
  const position = new THREE.Vector3(index.xs[i] + (index.xs[j] - index.xs[i]) * f,
    route.ele[i] + (route.ele[j] - route.ele[i]) * f, index.zs[i] + (index.zs[j] - index.zs[i]) * f).addScaledVector(right, lateral);
  return { position, forward, right };
}

/** Bend the detailed deck/rails to the GPX, rather than spanning its curved
 * approach with a straight model that can sit metres away from the road. */
export function fitBridgeToRoad(geometry, route, index, landmark) {
  const result = geometry.clone();
  const positions = result.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const stretch = landmark.span / (landmark.assetSpanM || 218);
    const depth = (landmark.depth || 65) / (landmark.assetDepthM || 65);
    const frame = coastalRoadFrame(route, index, landmark.s + z * stretch, (landmark.lateralM || 0) - x);
    const vertical = y < -1 ? (y + 1) * depth - 1 : y;
    positions.setXYZ(i, frame.position.x, frame.position.y + vertical, frame.position.z);
  }
  positions.needsUpdate = true;
  result.computeVertexNormals(); result.computeBoundingSphere();
  return result;
}

export class CoastalDetails {
  constructor(parent, route, index, landscape, kit, uniforms) {
    this.group = new THREE.Group(); this.group.name = 'Coastal landmarks and road furniture'; parent.add(this.group);
    this.route = route; this.index = index; this.landscape = landscape; this.kit = kit;
    this.uniforms = uniforms;
    this.geometries = new Set(); this.materials = new Set(); this.instances = [];
    if (!landscape.city) this._markers();
    this._signs(); this._lookouts(); if (!landscape.city) this._coastalRocks(); this._creeks();
  }

  _material(color, options = {}) {
    const material = new THREE.MeshStandardMaterial({ color, roughness: .92, ...options });
    this.materials.add(material); return material;
  }

  _mesh(geometry, material, name, shadow = true) {
    this.geometries.add(geometry);
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name;
    mesh.castShadow = shadow; mesh.receiveShadow = true; this.group.add(mesh); return mesh;
  }

  _instances(geometry, material, matrices, name, owned = true) {
    if (owned) this.geometries.add(geometry);
    const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m)); mesh.instanceMatrix.needsUpdate = true;
    mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true; mesh.computeBoundingSphere();
    this.instances.push(mesh); this.group.add(mesh); return mesh;
  }

  _markers() {
    const posts = [], bands = [], reflectors = [];
    const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), unit = new THREE.Vector3(1, 1, 1);
    for (let s = 40; s < (this.route.turnS || this.route.total); s += 90) {
      const { position, forward } = coastalRoadFrame(this.route, this.index, s, 4.75);
      if (this.landscape.bridgeAt(position.x, position.z, 16)) continue;
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), forward);
      posts.push(matrix.compose(position.clone().add(new THREE.Vector3(0, .6, 0)), q, unit).clone());
      bands.push(matrix.compose(position.clone().add(new THREE.Vector3(0, .88, 0)), q, unit).clone());
      reflectors.push(matrix.compose(position.clone().add(new THREE.Vector3(0, 1.02, -.075)), q, unit).clone());
    }
    this._instances(new THREE.BoxGeometry(.13, 1.2, .13), this._material('#ddd7bd'), posts, 'Reflector posts');
    this._instances(new THREE.BoxGeometry(.135, .23, .135), this._material('#424b43'), bands, 'Marker bands');
    this._instances(new THREE.BoxGeometry(.065, .1, .015), this._material('#edc56a', { emissive: '#9a6d28', emissiveIntensity: .18 }), reflectors, 'Amber reflectors');
  }

  _signs() {
    for (const sign of this.route.scene.signs || []) {
      const side = sign.side === 'inland' ? -1 : 1;
      const { position, forward } = coastalRoadFrame(this.route, this.index, sign.atM, side * (sign.lateralM || 5.7));
      const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = sign.kind === 'warning' ? '#d4ae54' : '#405b46'; ctx.fillRect(0, 0, 1024, 256);
      ctx.strokeStyle = sign.kind === 'warning' ? '#463d2a' : '#eee9d5'; ctx.lineWidth = 7; ctx.strokeRect(14, 14, 996, 228);
      ctx.fillStyle = sign.kind === 'warning' ? '#352e23' : '#f4efda'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '600 61px sans-serif'; ctx.fillText(sign.label, 512, 104, 930);
      ctx.font = '400 30px sans-serif'; ctx.fillText(sign.subtitle || 'CALIFORNIA HIGHWAY 1', 512, 183, 930);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      const material = this._material('#ffffff', { map: texture, side: THREE.DoubleSide });
      const mesh = this._mesh(new THREE.BoxGeometry(3.5, .88, .07), material, sign.label);
      mesh.position.copy(position).add(new THREE.Vector3(0, 2.3, 0));
      mesh.lookAt(mesh.position.clone().addScaledVector(forward, sign.direction === 'return' ? 1 : -1));
      const postMaterial = this._material('#9d9f89');
      for (const offset of [-1.15, 1.15]) {
        const pole = this._mesh(new THREE.CylinderGeometry(.045, .045, 2.4, 6), postMaterial, 'Sign support');
        const right = new THREE.Vector3(-forward.z, 0, forward.x);
        pole.position.copy(position).addScaledVector(right, offset).y += 1.2;
      }
    }
  }

  _lookouts() {
    for (const lookout of this.route.scene.lookouts || []) {
      const side = lookout.side === 'inland' ? -1 : 1;
      const width = lookout.widthM || 10, length = lookout.lengthM || 32;
      const { position, forward, right } = coastalRoadFrame(this.route, this.index, lookout.atM, side * (3.5 + width / 2));
      const across = right.clone().negate(), up = forward.clone().cross(across).normalize();
      const rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, up, forward));
      // Flat verge and a slightly irregular gravel pad give the viewpoint a usable approach.
      const gravel = document.createElement('canvas'); gravel.width = gravel.height = 128;
      const ctx = gravel.getContext('2d'), rand = randomSequence(Math.floor(lookout.atM));
      ctx.fillStyle = '#bcb08e'; ctx.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 2100; i++) {
        const g = Math.floor(135 + rand() * 70); ctx.fillStyle = `rgb(${g},${g - 5},${g - 20})`;
        ctx.fillRect(rand() * 128, rand() * 128, 1 + rand(), 1 + rand());
      }
      const texture = new THREE.CanvasTexture(gravel); texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(4, 10);
      const pad = this._mesh(new THREE.BoxGeometry(width, .9, length), this._material('#ffffff', { map: texture }), 'Coastal overlook gravel');
      pad.position.copy(position); pad.position.y -= .35; pad.quaternion.copy(rotation);
      const wood = this._material('#918568');
      for (let d = -length / 2; d <= length / 2; d += 4) {
        const p = position.clone().addScaledVector(forward, d).addScaledVector(right, side * (width / 2 - .3));
        const post = this._mesh(new THREE.BoxGeometry(.14, 1.1, .14), wood, 'Overlook timber');
        post.position.copy(p).y += .53;
        if (d + 4 <= length / 2) {
          const rail = this._mesh(new THREE.BoxGeometry(.1, .13, 4.1), wood, 'Overlook rail');
          rail.position.copy(p).addScaledVector(forward, 2).y += .85; rail.quaternion.copy(rotation);
        }
      }
      if (this.kit.assets.bench) {
        const asset = this.kit.assets.bench;
        for (const along of [-7, 7]) {
          const bench = new THREE.Mesh(asset.geometry, asset.material); bench.name = 'Ocean-facing bench';
          bench.position.copy(position).addScaledVector(forward, along).addScaledVector(right, side * 2.1);
          bench.lookAt(bench.position.clone().addScaledVector(right, -side)); bench.castShadow = bench.receiveShadow = true;
          this.group.add(bench);
        }
      }
    }
  }

  /** Real coast: rocks scattered along the true shoreline, and the sea stacks set offshore of the road. */
  _realCoastRocks() {
    const S = this.landscape.shore, rand = randomSequence(7741), groups = { outcrop0: [], outcrop1: [] };
    const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), position = new THREE.Vector3(), scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let j = 1; j < S.nz - 1; j++) for (let i = 1; i < S.nx - 1; i++) {
      const v = S.field[j * S.nx + i];
      if (v > 0 || v < -60 || rand() > (v > -14 ? .5 : .05)) continue;
      const x = S.x0 + (i + rand() - .5) * S.cell, z = S.z0 + (j + rand() - .5) * S.cell;
      const wide = (.3 + rand() * 1.1) * (v > -14 ? 1 : 1.6);
      position.set(x, -1.4 - rand() * .8, z); rotation.setFromAxisAngle(up, rand() * 6.28);
      scale.set(wide, .35 + rand() * .9, wide * (.6 + rand() * .5));
      groups[`outcrop${rand() > .5 ? 1 : 0}`].push(matrix.compose(position, rotation, scale).clone());
    }
    for (const stack of this.route.scene.seaStacks || []) {
      const frame = coastalRoadFrame(this.route, this.index, stack.atM);
      const side = stack.side === 'inland' ? -1 : 1;
      let off = 0;
      for (; off < 2500; off += 4) { const p = frame.position.clone().addScaledVector(frame.right, side * off); if (this.landscape.inlandAt(p.x, p.z) < -stack.offshoreM) break; }
      const p = frame.position.clone().addScaledVector(frame.right, side * off);
      position.set(p.x, -2, p.z);
      scale.set(stack.widthM / 7, stack.heightM / 5, stack.widthM / 8);
      rotation.setFromAxisAngle(up, stack.atM * .001);
      groups.outcrop0.push(matrix.compose(position, rotation, scale).clone());
    }
    for (const [name, matrices] of Object.entries(groups)) {
      const asset = this.kit.assets[name];
      if (asset) this._instances(asset.geometry, asset.material, matrices, 'Shoreline rocks and sea stacks', false);
    }
  }

  _coastalRocks() {
    if (this.landscape.real) return this._realCoastRocks();
    if (this.landscape.hasOcean === false || this.landscape.kind === 'tropical') return;
    const coastSide = this.landscape.coastSide || 1;
    const rand = randomSequence(7741), groups = { outcrop0: [], outcrop1: [] };
    const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), position = new THREE.Vector3(), scale = new THREE.Vector3();
    for (let z = this.landscape.coast[0].z; z < this.landscape.coast.at(-1).z; z += 75) {
      const x = this.landscape.coastX(z) + coastSide * (rand() * 15 - 12);
      const wide = .3 + rand() * .9;
      position.set(x, -1.6, z + rand() * 32); rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6.28);
      scale.set(wide, .4 + rand() * .8, wide * .8);
      groups[`outcrop${rand() > .5 ? 1 : 0}`].push(matrix.compose(position, rotation, scale).clone());
    }
    for (const stack of this.route.scene.seaStacks || []) {
      // Config uses distance along the GPX to avoid baking projection coordinates.
      const frame = coastalRoadFrame(this.route, this.index, stack.atM);
      const sz = frame.position.z;
      position.set(this.landscape.coastX(sz) - coastSide * stack.offshoreM, -1.5, sz);
      scale.set(stack.widthM / 7, stack.heightM / 5, stack.widthM / 8);
      rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), stack.atM * .001);
      groups.outcrop0.push(matrix.compose(position, rotation, scale).clone());
    }
    for (const [name, matrices] of Object.entries(groups)) {
      const asset = this.kit.assets[name];
      if (asset) this._instances(asset.geometry, asset.material, matrices, 'Shoreline rocks and sea stacks', false);
    }
  }

  _creeks() {
    for (const creek of this.landscape.creeks) {
      const makeRibbon = (width, bank) => {
        const positions = [], uv = [], indices = [];
        const offsets = bank ? [-width / 2, -creek.width / 2, creek.width / 2, width / 2] : [-width / 2, width / 2];
        const columns = offsets.length;
        for (let t = creek.start, i = 0; t <= creek.mouth; t += 6, i++) {
          const p = creek.positionAt(t), next = creek.positionAt(t + 1);
          const previous = creek.positionAt(t - 1);
          const dx = next.x - previous.x, dz = next.z - previous.z, len = Math.hypot(dx, dz) || 1;
          for (const offset of offsets) {
            const x = p.x - dz / len * offset, z = p.z + dx / len * offset;
            const y = bank ? this.landscape.heightAt(x, z) + .025 : creek.waterAt(t);
            positions.push(x, y, z); uv.push(offset / width + .5, t / 16);
          }
          if (i) for (const pair of bank ? [0, 2] : [0]) {
            const a = (i - 1) * columns + pair;
            indices.push(a, a + 1, a + columns, a + 1, a + columns + 1, a + columns);
          }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geometry.setIndex(indices); geometry.computeVertexNormals();
        return geometry;
      };
      this._mesh(makeRibbon(creek.width + 5, true), this._material('#9b987e', { side: THREE.DoubleSide }), 'Creek gravel banks', false);
      const material = this._material('#67948c', { roughness: .32, metalness: .08, side: THREE.DoubleSide });
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = this.uniforms.uTime;
        shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vBfCreek;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBfCreek = uv;');
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vBfCreek; uniform float uTime;')
          .replace('#include <color_fragment>', `#include <color_fragment>
            float bfFlow = sin(vBfCreek.y * 35. - uTime * 1.6 + sin(vBfCreek.x * 18.) * 2.);
            diffuseColor.rgb *= .96 + bfFlow * .055;
          `);
      };
      const name = creek.name || creek.bridge?.creekName || creek.bridge?.name.replace(/ Bridge$/, '') || 'River';
      this._mesh(makeRibbon(creek.width, false), material, `${name} water`, false);
    }
  }

  dispose() {
    this.group.removeFromParent(); this.instances.forEach((m) => m.dispose());
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => { m.map?.dispose(); m.dispose(); });
  }
}
