// Toolbox: roadside details (signs, markers, turnouts, fitted bridge decks) and roadFrame(), the outbound-road
// frame every kit uses to place things by distance and side. Every stylized scene.
import * as THREE from '../../../../vendor/three.js';
import { randomSequence } from '../core/random.js';
import { curveOn, curveXZ } from '../core/road-align.js';   // [w2-align]
import { HASH_GLSL } from '../materials/glsl-noise.js';   // [review 27 Nov] the shared sin-free hash and value noise
import { anchor } from '../core/shader-patch.js';   // [review 27 Nov] T8: a missing shader anchor throws

/** The same outbound-road frame is used for signs, markers and turnouts. */
export function roadFrame(route, index, distance, lateral = 0) {
  const s = Math.max(0, Math.min(route.turnS || route.total, distance));
  const i = Math.min((route.turnIdx || route.dist.length - 1) - 1, Math.floor(s / 10));
  const j = i + 1, f = Math.min(1, (s - route.dist[i]) / (route.dist[j] - route.dist[i] || 1));
  if (curveOn(route)) {
    // [w2-align] on the curved centre line (js/world/toolbox/core/road-align.js), so decks, rails and pads follow the drawn road
    const p = curveXZ(index, i, f), a = curveXZ(index, i, Math.max(0, f - .05)), b = curveXZ(index, i, Math.min(1, f + .05));
    const forward = new THREE.Vector3(b.x - a.x, (route.ele[j] - route.ele[i]) * (Math.min(1, f + .05) - Math.max(0, f - .05)), b.z - a.z).normalize();
    const right = new THREE.Vector3(-forward.z, 0, forward.x).normalize();
    return { position: new THREE.Vector3(p.x, route.ele[i] + (route.ele[j] - route.ele[i]) * f, p.z).addScaledVector(right, lateral), forward, right };
  }
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
    const frame = roadFrame(route, index, landmark.s + z * stretch, (landmark.lateralM || 0) - x);
    const vertical = y < -1 ? (y + 1) * depth - 1 : y;
    positions.setXYZ(i, frame.position.x, frame.position.y + vertical, frame.position.z);
  }
  positions.needsUpdate = true;
  result.computeVertexNormals(); result.computeBoundingSphere();
  return result;
}

export class RoadsideDetails {
  constructor(parent, route, index, landscape, kit, uniforms) {
    this.group = new THREE.Group(); this.group.name = 'Coastal landmarks and road furniture'; parent.add(this.group);
    this.route = route; this.index = index; this.landscape = landscape; this.kit = kit;
    this.uniforms = uniforms;
    this.geometries = new Set(); this.materials = new Set(); this.instances = [];
    if (!landscape.city && this.route.scene?.reflectorPosts !== false) this._markers();   // "reflectorPosts": false where the verge kit has the road's own posts
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
      const { position, forward } = roadFrame(this.route, this.index, s, 4.75);
      if (this.landscape.bridgeAt(position.x, position.z, 16)) continue;
      // no posts across an overlook's entrance (traffic pulls in there)
      if ((this.route.scene.lookouts || []).some((l) => Math.abs(s - l.atM) < (l.lengthM || 32) / 2 + 30)) continue;
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
    const poles = {};
    for (const sign of this.route.scene.signs || []) {
      const side = sign.side === 'inland' ? -1 : 1;
      const { position, forward } = roadFrame(this.route, this.index, sign.atM, side * (sign.lateralM || 5.7));
      const diamond = sign.kind === 'diamond';
      const canvas = document.createElement('canvas'); canvas.width = diamond ? 256 : 1024; canvas.height = 256;
      const ctx = canvas.getContext('2d');
      // kinds: default green guide sign, 'warning', 'dec' (Adirondack brown with yellow letters), 'diamond' (yellow warning)
      const style = { warning: ['#d4ae54', '#463d2a', '#352e23'], dec: ['#5a3e27', '#e8c25a', '#e8c25a'], nps: ['#4a3324', '#efe4cc', '#f2e9d4'], diamond: ['#e8b92e', '#1f1d19', '#1f1d19'] }[sign.kind] || ['#405b46', '#eee9d5', '#f4efda'];
      if (diamond) {
        ctx.beginPath(); ctx.moveTo(128, 4); ctx.lineTo(252, 128); ctx.lineTo(128, 252); ctx.lineTo(4, 128); ctx.closePath();
        ctx.fillStyle = style[0]; ctx.fill(); ctx.strokeStyle = style[1]; ctx.lineWidth = 8; ctx.stroke();
      } else {
        ctx.fillStyle = style[0]; ctx.fillRect(0, 0, canvas.width, 256);
        ctx.strokeStyle = style[1]; ctx.lineWidth = 7; ctx.strokeRect(14, 14, canvas.width - 28, 228);
      }
      ctx.fillStyle = style[2]; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (diamond) {
        ctx.font = '700 96px sans-serif'; ctx.fillText(sign.symbol || '!', 128, 118);
        ctx.font = '700 26px sans-serif'; ctx.fillText(sign.label || '', 128, 182, 130);
      } else {
        ctx.font = sign.kind === 'dec' || sign.kind === 'nps' ? '700 64px Georgia, serif' : '600 61px sans-serif'; ctx.fillText(sign.label, 512, 104, 930);
        ctx.font = sign.kind === 'dec' || sign.kind === 'nps' ? '400 32px Georgia, serif' : '400 30px sans-serif'; ctx.fillText(sign.subtitle || 'CALIFORNIA HIGHWAY 1', 512, 183, 930);
      }
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      const material = this._material('#ffffff', { map: texture, side: THREE.DoubleSide, ...(diamond ? { alphaTest: .5, transparent: false } : {}) });
      const mesh = this._mesh(diamond ? new THREE.PlaneGeometry(1.25, 1.25) : new THREE.BoxGeometry(3.5, .88, .07), material, sign.label || sign.symbol);
      mesh.position.copy(position).add(new THREE.Vector3(0, diamond ? 2.1 : 2.3, 0));
      mesh.userData.sign = true;   // its own supports hold it up (the clipping QC knows)
      mesh.lookAt(mesh.position.clone().addScaledVector(forward, sign.direction === 'return' ? 1 : -1));
      const color = sign.kind === 'dec' || sign.kind === 'nps' ? '#5a3e27' : '#9d9f89';
      for (const offset of diamond ? [0] : [-1.15, 1.15]) {
        // the posts stand just behind the board (not through it)
        const right = new THREE.Vector3(-forward.z, 0, forward.x), behind = new THREE.Vector3(forward.x, 0, forward.z).normalize().multiplyScalar(sign.direction === 'return' ? -.26 : .26);
        const p = position.clone().addScaledVector(right, offset).add(diamond ? new THREE.Vector3() : behind);
        (poles[color] ||= []).push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y + (diamond ? .95 : .93), p.z), new THREE.Quaternion(), new THREE.Vector3(1, diamond ? 1.9 / 1.86 : 1, 1)));   // up to the board's lower edge
      }
    }
    // every sign's supports in one draw call per colour
    for (const [color, matrices] of Object.entries(poles)) this._instances(new THREE.CylinderGeometry(.045, .045, 1.86, 6), this._material(color), matrices, 'Sign support');
  }

  _lookouts() {
    for (const lookout of this.route.scene.lookouts || []) {
      const side = lookout.side === 'inland' ? -1 : 1;
      const width = lookout.widthM || 10, length = lookout.lengthM || 32;
      const { position, forward, right } = roadFrame(this.route, this.index, lookout.atM, side * (3.5 + width / 2));
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
      // the pad follows the road's own curve and grade in 4 m pieces (a rigid slab floats or sinks at its ends)
      const padMaterial = this._material('#ffffff', { map: texture });
      const pieceGeometry = new THREE.BoxGeometry(width, .9, 4.15), pieces = [];
      this.geometries.add(pieceGeometry);
      for (let d = -length / 2; d < length / 2 - .01; d += 4) {
        const a = roadFrame(this.route, this.index, lookout.atM + d, side * (3.5 + width / 2));
        const b = roadFrame(this.route, this.index, lookout.atM + Math.min(length / 2, d + 4), side * (3.5 + width / 2));
        // right-handed frame: z along the road (with its grade), x level across it, y = z × x
        const zA = b.position.clone().sub(a.position).normalize();
        const xA = new THREE.Vector3(0, 1, 0).cross(zA).normalize(), yA = zA.clone().cross(xA).normalize();
        const centre = a.position.clone().lerp(b.position, .5); centre.y -= .35;
        pieces.push(new THREE.Matrix4().makeBasis(xA, yA, zA).setPosition(centre));
      }
      // one draw call each for the pad, the posts and the rails (they were a mesh apiece)
      const gravelMesh = this._instances(pieceGeometry, padMaterial, pieces, 'Coastal overlook gravel', false);
      gravelMesh.castShadow = false;
      const wood = this._material('#918568'), posts = [], rails = [];
      for (let d = -length / 2; d <= length / 2; d += 4) {
        const p = position.clone().addScaledVector(forward, d).addScaledVector(right, side * (width / 2 - .3));
        posts.push(new THREE.Matrix4().setPosition(p.x, p.y + .53, p.z));
        if (d + 4 <= length / 2) rails.push(new THREE.Matrix4().makeRotationFromQuaternion(rotation).setPosition(p.clone().addScaledVector(forward, 2).add(new THREE.Vector3(0, .85, 0))));
      }
      this._instances(new THREE.BoxGeometry(.14, 1.1, .14), wood, posts, 'Overlook timber');
      if (rails.length) this._instances(new THREE.BoxGeometry(.1, .13, 4.1), wood, rails, 'Overlook rail');
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
      if (v > 0 || v < -60 || rand() > (v > -14 ? .28 : .025)) continue;
      const x = S.x0 + (i + rand() - .5) * S.cell, z = S.z0 + (j + rand() - .5) * S.cell;
      if (this.landscape.nearCreek(x, z, 10)) continue;   // not in a creek mouth
      const wide = (.3 + rand() * 1.1) * (v > -14 ? 1 : 1.6);
      position.set(x, -1.4 - rand() * .8, z); rotation.setFromAxisAngle(up, rand() * 6.28);
      scale.set(wide, .35 + rand() * .9, wide * (.6 + rand() * .5));
      groups[`outcrop${rand() > .5 ? 1 : 0}`].push(matrix.compose(position, rotation, scale).clone());
    }
    for (const stack of this.route.scene.seaStacks || []) {
      const frame = roadFrame(this.route, this.index, stack.atM);
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
      const frame = roadFrame(this.route, this.index, stack.atM);
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
        const positions = [], uv = [], indices = [], foam = [];
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
            // white water where the creek drops quickly (rapids, cascades)
            foam.push(Math.min(1, Math.max(0, (creek.waterAt(t - 8) - creek.waterAt(t + 8)) / 16 - .012) * 18));
          }
          if (i) for (const pair of bank ? [0, 2] : [0]) {
            const a = (i - 1) * columns + pair;
            indices.push(a, a + 1, a + columns, a + 1, a + columns + 1, a + columns);
          }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geometry.setAttribute('aFoam', new THREE.Float32BufferAttribute(foam, 1));
        geometry.setIndex(indices); geometry.computeVertexNormals();
        return geometry;
      };
      this._mesh(makeRibbon(creek.width + 5, true), this._material('#9b987e', { side: THREE.DoubleSide }), 'Creek gravel banks', false);
      const material = this._material('#67948c', { roughness: .32, metalness: .08, side: THREE.DoubleSide });
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = this.uniforms.uTime;
        shader.vertexShader = shader.vertexShader.replace(anchor('#include <common>'), '#include <common>\nvarying vec2 vBfCreek; attribute float aFoam; varying float vBfFoam;')
          .replace(anchor('#include <begin_vertex>'), '#include <begin_vertex>\nvBfCreek = uv; vBfFoam = aFoam;');
        shader.fragmentShader = shader.fragmentShader.replace(anchor('#include <common>'), `#include <common>
            varying vec2 vBfCreek; uniform float uTime; varying float vBfFoam;
${HASH_GLSL}`)
          .replace(anchor('#include <color_fragment>'), `#include <color_fragment>
            float bfFlow = sin(vBfCreek.y * 35. - uTime * 1.6 + sin(vBfCreek.x * 18.) * 2.);
            diffuseColor.rgb *= .96 + bfFlow * .055;
            // rapids: white water streaming downstream, thickest mid-channel and over the steepest drops
            float bfWW = vn2(vec2(vBfCreek.x * 9., vBfCreek.y * 12. - uTime * 3.2)) * .6 + vn2(vec2(vBfCreek.x * 23., vBfCreek.y * 30. - uTime * 5.)) * .4;
            float bfMid = 1. - abs(vBfCreek.x - .5) * 1.4;
            float bfWhite = smoothstep(.55 - vBfFoam * .35, .62 - vBfFoam * .35, bfWW * bfMid + vBfFoam * .2) * smoothstep(.02, .15, vBfFoam + .03);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.93, .96, .97), bfWhite * .85);
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
