import * as THREE from '../../vendor/three.module.min.js';
import { makeCoastLandscape, randomSequence, smoothstep } from './coast.js';
import { loadSceneryAssets } from './scenery-assets.js';

/** Bundled style-C coastal scene. No tile/imagery requests, including offline. */
export class StylizedTerrain {
  constructor(scene, proj, routeIndex, opts) {
    this.scene = scene;
    this.config = opts.route.scene;
    this.route = opts.route;
    this.index = routeIndex;
    this.landscape = makeCoastLandscape(this.config, proj, routeIndex, opts.route);
    this.uniforms = { uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSkyTop: { value: new THREE.Color() }, uSkyHorizon: { value: new THREE.Color() } };
    this.group = new THREE.Group();
    this.group.name = 'Big Sur · stylized coast';
    scene.add(this.group);
    this.patches = new Map();
    this.scatter = new Map();
    this.stats = { ready: 0, loading: 1, queued: 0, errors: 0 };
    this.palette = Object.fromEntries(Object.entries(this.config.palette).map(([k, v]) => [k, new THREE.Color(v)]));
    this.groundMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    this._makeOcean();
    this._makeClouds();
    this._makeShadows();
    this._makeRoadside();
    this.ready = loadSceneryAssets(this.config.assets).then((kit) => {
      if (this.disposed) { kit.dispose(); return; }
      this.kit = kit;
      this._makeLandmarks();
      this._lastX = Infinity;
      this.stats.loading = 0;
    }).catch((err) => { this.stats.loading = 0; this.stats.errors++; opts.onError?.(err); });
  }

  _makeShadows() {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(16, 16, 1, 16, 16, 15);
    gradient.addColorStop(0, 'rgba(27,48,31,.28)'); gradient.addColorStop(1, 'rgba(27,48,31,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 32, 32);
    const geometry = new THREE.PlaneGeometry(1, 1); geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.shadowAsset = { geometry, material };
  }

  _makeRoadside() {
    const posts = [], rails = [];
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3();
    const route = this.route, index = this.index;
    for (const range of this.config.roadside || []) {
      for (let s = range.fromM; s < range.toM; s += 8) {
        const i = Math.min(route.turnIdx - 2, Math.floor(s / 10)), j = i + 1;
        const f = (s - route.dist[i]) / (route.dist[j] - route.dist[i]);
        const x = index.xs[i] + (index.xs[j] - index.xs[i]) * f, z = index.zs[i] + (index.zs[j] - index.zs[i]) * f;
        if (this.landscape.bridgeAt(x, z, 12)) continue;
        const direction = new THREE.Vector3(index.xs[j] - index.xs[i], route.ele[j] - route.ele[i], index.zs[j] - index.zs[i]).normalize();
        const right = new THREE.Vector3(-direction.z, 0, direction.x).normalize();
        const side = range.side === 'inland' ? -1 : 1;
        position.set(x, route.ele[i] + (route.ele[j] - route.ele[i]) * f, z).addScaledVector(right, side * 4.1);
        const q = new THREE.Quaternion();
        scale.set(1, 1, 1);
        posts.push(matrix.compose(position.clone().add(new THREE.Vector3(0, .55, 0)), q, scale).clone());
        q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
        scale.set(1, 1, 8.15);
        rails.push(matrix.compose(position.clone().add(new THREE.Vector3(0, .95, 0)).addScaledVector(direction, 4), q, scale).clone());
      }
    }
    this.roadside = new THREE.Group();
    const material = new THREE.MeshLambertMaterial({ color: '#b7b5a1' });
    for (const [geometry, matrices] of [[new THREE.BoxGeometry(.16, 1.1, .16), posts], [new THREE.BoxGeometry(.16, .23, 1), rails]]) {
      const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
      matrices.forEach((m, i) => mesh.setMatrixAt(i, m)); mesh.computeBoundingSphere(); this.roadside.add(mesh);
    }
    this.group.add(this.roadside);
  }

  _makeClouds() {
    const rand = randomSequence(1101);
    const geometry = new THREE.SphereGeometry(1, 10, 6);
    const material = new THREE.MeshBasicMaterial({ color: '#f1f0df', transparent: true, opacity: .76, depthWrite: false, fog: true });
    const mesh = new THREE.InstancedMesh(geometry, material, 72);
    const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), scale = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0; i < 72; i++) {
      const group = Math.floor(i / 4), angle = group * 2.399;
      const radius = 8500 + Math.sin(group * 5) * 3000;
      p.set(Math.cos(angle) * radius + rand() * 700, 1800 + Math.sin(group * 3) * 400 + rand() * 120, Math.sin(angle) * radius + rand() * 350);
      scale.set(300 + rand() * 300, 65 + rand() * 75, 150 + rand() * 200);
      mesh.setMatrixAt(i, matrix.compose(p, q, scale));
    }
    mesh.computeBoundingSphere(); this.clouds = mesh; this.group.add(mesh);
  }

  _makeOcean() {
    const material = new THREE.MeshPhongMaterial({ color: this.config.palette.water, shininess: 70,
      specular: '#a5d9d3', transparent: false });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSeaPosition;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSeaPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vSeaPosition;\nuniform float uTime;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          float swell = sin(vSeaPosition.x * .012 + vSeaPosition.z * .009 + uTime * .4);
          float ripples = pow(max(0., sin(vSeaPosition.x * .105 - vSeaPosition.z * .07 + uTime * .32)), 22.);
          diffuseColor.rgb *= .97 + .035 * swell;
          diffuseColor.rgb += vec3(.006, .009, .008) * ripples;
        `);
    };
    this.ocean = new THREE.Mesh(new THREE.PlaneGeometry(160000, 160000), material);
    this.ocean.rotation.x = -Math.PI / 2;
    this.ocean.position.y = .05;
    this.group.add(this.ocean);
    // White surf follows the authored coastline rather than the road.
    const pos = [], idx = [];
    const start = this.landscape.coast[0].z - 6000, end = this.landscape.coast.at(-1).z + 6000;
    for (let z = start, i = 0; z <= end; z += 25, i++) {
      const x = this.landscape.coastX(z);
      pos.push(x - 5 - Math.sin(z / 37) * 2, .22, z, x + 1, .22, z);
      if (i) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    this.surf = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#e1ead4', transparent: true, opacity: .65, side: THREE.DoubleSide }));
    this.group.add(this.surf);
  }

  _makeLandmarks() {
    for (const landmark of this.landscape.landmarks) {
      const asset = this.kit.assets[landmark.asset];
      if (!asset) continue;
      const mesh = new THREE.Mesh(asset.geometry, asset.material);
      const forward = new THREE.Vector3(landmark.fx, landmark.slope, landmark.fz).normalize();
      const right = new THREE.Vector3(forward.z, 0, -forward.x).normalize();
      const up = forward.clone().cross(right).normalize();
      mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, forward));
      mesh.position.set(landmark.x, landmark.y, landmark.z);
      mesh.name = landmark.name;
      this.group.add(mesh);
    }
  }

  _makePatch(x, z, size) {
    const S = 16, N = S + 1;
    const positions = [], colors = [], indices = [];
    const c = new THREE.Color();
    const P = this.palette;
    for (let j = 0; j <= S; j++) for (let i = 0; i <= S; i++) {
      const px = x + size * i / S, pz = z + size * j / S;
      const y = this.heightAt(px, pz);
      positions.push(px, y, pz);
      const coastal = px - this.landscape.coastX(pz);
      const patch = .5 + Math.sin(px / 130 + Math.sin(pz / 260)) * Math.cos(pz / 190) * .5;
      c.copy(P.grass).lerp(P.meadow, smoothstep(.15, .9, patch) * .65);
      const rise = Math.hypot(this.heightAt(px + 16, pz) - y, this.heightAt(px, pz + 16) - y) / 16;
      c.lerp(P.rock, smoothstep(.45, 1.4, rise));
      c.lerp(P.cliff, (1 - smoothstep(20, 85, coastal)) * .65);
      c.multiplyScalar(.94 + Math.sin(px / 47 + pz / 73) * .035);
      colors.push(c.r, c.g, c.b);
      if (i < S && j < S) {
        const a = j * N + i, b = a + 1, d = a + N, e = d + 1;
        indices.push(a, d, b, b, d, e);
      }
    }
    // Skirts close gaps between different terrain levels of detail.
    for (const edge of [Array.from({ length: N }, (_, i) => i), Array.from({ length: N }, (_, i) => S * N + i),
      Array.from({ length: N }, (_, i) => i * N), Array.from({ length: N }, (_, i) => i * N + S)]) {
      const base = positions.length / 3;
      for (const k of edge) {
        positions.push(positions[k * 3], positions[k * 3 + 1] - Math.max(3, size / 48), positions[k * 3 + 2]);
        colors.push(...colors.slice(k * 3, k * 3 + 3));
      }
      for (let i = 0; i < S; i++) indices.push(edge[i], base + i, edge[i + 1], edge[i + 1], base + i, base + i + 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, this.groundMaterial);
    this.group.add(mesh);
    return mesh;
  }

  _makeScatter(cx, cz) {
    const size = 192, rand = randomSequence((cx * 73856093 ^ cz * 19349663) + this.config.seed);
    const lists = {};
    const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), scale = new THREE.Vector3();
    const add = (name, x, y, z, width, height = width) => {
      if (!this.kit.assets[name] && name !== 'shadow') return;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
      p.set(x, y, z); scale.set(width, height, width);
      (lists[name] ||= []).push(matrix.compose(p, q, scale).clone());
    };
    for (let k = 0; k < 180; k++) {
      const x = cx * size + rand() * size, z = cz * size + rand() * size;
      const inland = x - this.landscape.coastX(z), y = this.heightAt(x, z);
      if (inland < 10 || y < 1 || this.landscape.bridgeAt(x, z, 10)) continue;
      const road = this.index.nearest(x, z, 10);
      if (road && road.d < 7.5) continue;
      const slope = Math.hypot(this.heightAt(x + 4, z) - y, this.heightAt(x, z + 4) - y) / 4;
      if (slope > 1.3) continue;
      const pick = rand();
      if (pick < .025 && inland > 45 && (!road || road.d > 10) && slope < .55) {
        const width = .65 + rand() * .5;
        add(`cypress${Math.floor(rand() * 3)}`, x, y - .1, z, width, .8 + rand() * .35);
        add('shadow', x, y + .045, z, width * 8);
      } else if (pick < .38) {
        const width = .9 + rand() * 1.2;
        add(`shrub${Math.floor(rand() * 2)}`, x, y - .12, z, width);
        add('shadow', x, y + .04, z, width * 2.5);
      }
      else if (pick < .48) add(`rock${Math.floor(rand() * 2)}`, x, y - .3, z, .5 + rand() * 1.4);
      else if (pick < .63) add('flowers', x, y - .02, z, 1 + rand());
      else add('grass', x, y - .04, z, .8 + rand() * 1.4);
    }
    const group = new THREE.Group();
    for (const [name, matrices] of Object.entries(lists)) {
      const asset = name === 'shadow' ? this.shadowAsset : this.kit.assets[name];
      const mesh = new THREE.InstancedMesh(asset.geometry, asset.material, matrices.length);
      matrices.forEach((m, i) => mesh.setMatrixAt(i, m)); mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere(); group.add(mesh);
    }
    this.group.add(group);
    return group;
  }

  update(cx, cz) {
    if (Math.hypot(cx - this._lastX, cz - this._lastZ) < 36) return;
    this._lastX = cx; this._lastZ = cz;
    const show = new Set();
    const visit = (x, z, size) => {
      const d = Math.hypot(Math.max(x - cx, 0, cx - x - size), Math.max(z - cz, 0, cz - z - size));
      if (size > 96 && d < size * 1.15) {
        for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) visit(x + dx * size / 2, z + dz * size / 2, size / 2);
        return;
      }
      const key = `${x}/${z}/${size}`; show.add(key);
      if (!this.patches.has(key)) this.patches.set(key, this._makePatch(x, z, size));
    };
    const size = 1536, ix = Math.floor(cx / size), iz = Math.floor(cz / size);
    for (let x = ix - 5; x <= ix + 5; x++) for (let z = iz - 5; z <= iz + 5; z++) visit(x * size, z * size, size);
    for (const [key, mesh] of this.patches) {
      mesh.visible = show.has(key);
      if (!mesh.visible) { this.group.remove(mesh); mesh.geometry.dispose(); this.patches.delete(key); }
    }
    if (this.kit) {
      const visible = new Set(), sx = Math.floor(cx / 192), sz = Math.floor(cz / 192);
      for (let x = sx - 3; x <= sx + 3; x++) for (let z = sz - 3; z <= sz + 3; z++) {
        const key = `${x}/${z}`; visible.add(key);
        if (!this.scatter.has(key)) this.scatter.set(key, this._makeScatter(x, z));
      }
      for (const [key, group] of this.scatter) if (!visible.has(key)) {
        this.group.remove(group); group.children.forEach((m) => m.dispose()); this.scatter.delete(key);
      }
    }
    this.stats.ready = this.patches.size;
  }

  heightAt(x, z) { return this.landscape.heightAt(x, z); }
  get loadingCount() { return this.stats.loading; }
  dispose() {
    this.disposed = true;
    this.scene.remove(this.group);
    for (const mesh of this.patches.values()) mesh.geometry.dispose();
    for (const group of this.scatter.values()) group.children.forEach((m) => m.dispose());
    this.surf.geometry.dispose(); this.surf.material.dispose();
    this.ocean.geometry.dispose(); this.ocean.material.dispose();
    this.clouds.geometry.dispose(); this.clouds.material.dispose(); this.clouds.dispose();
    this.shadowAsset.geometry.dispose(); this.shadowAsset.material.map.dispose(); this.shadowAsset.material.dispose();
    this.roadside.children.forEach((m) => { m.geometry.dispose(); m.dispose(); });
    this.roadside.children[0]?.material.dispose();
    this.groundMaterial.dispose(); this.kit?.dispose();
    this.patches.clear(); this.scatter.clear();
  }
}
