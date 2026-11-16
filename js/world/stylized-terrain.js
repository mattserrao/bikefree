import * as THREE from '../../vendor/three.module.min.js';
import { randomSequence, smoothstep } from './coast.js';
import { loadSceneryAssets } from './scenery-assets.js';
import { makeCoastalGroundMaterial, makeCoastalWaterMaterial, makeLakeWaterMaterial, makeLakeMistMaterial, decorateSceneryMaterial } from './coastal-materials.js';
import { makeAdirondackKit, ADIRONDACK_CATEGORY } from './adirondack-kit.js';
import { ForestPlanner, TILE_M } from './forest.js';
import { planSettlement, Settlement } from './settlement.js';
import { CoastalDetails, fitBridgeToRoad, coastalRoadFrame } from './coastal-details.js';
import { landscapeBuilder } from './landscapes.js';
import { CityScene } from './city.js';
import { CoastBridges } from './coast-bridges.js';
import { HighwayTraffic } from './highway-traffic.js';
import { CoastLife } from './coast-life.js';
import { makeRouteIndex } from './geo.js';

export const COASTAL_QUALITY = {
  // forestRange: tiles of real trees in forest scenes; nearM/midM: tile-centre distances for the detail tiers
  low: { pixelRatio: 1, shadows: false, scatterRange: 2, candidates: 150, coverCandidates: 100, forestRange: 3, nearM: 0, midM: 380, buildsPerFrame: 2 },
  balanced: { pixelRatio: 1.5, shadows: true, scatterRange: 3, candidates: 230, coverCandidates: 320, forestRange: 4, nearM: 170, midM: 450, buildsPerFrame: 3 },
  high: { pixelRatio: 2, shadows: true, scatterRange: 4, candidates: 310, coverCandidates: 480, forestRange: 5, nearM: 240, midM: 560, buildsPerFrame: 4 },
};

/** Bundled style-C coastal scene. No tile/imagery requests, including offline. */
export class StylizedTerrain {
  constructor(scene, proj, routeIndex, opts) {
    this.scene = scene;
    this.config = opts.route.scene;
    this.proj = proj;
    this.route = opts.route;
    this.index = routeIndex;
    this.quality = COASTAL_QUALITY[opts.quality] || COASTAL_QUALITY.balanced;
    this.qualityKey = COASTAL_QUALITY[opts.quality] ? opts.quality : 'balanced';
    this.landscape = landscapeBuilder(this.config)(this.config, proj, routeIndex, opts.route);
    // fog (the weather's fog bank) lies on this level: the sea, or a city's rivers
    this.fogBase = this.landscape.fogBase ?? 0;
    if (this.landscape.fogField) this._makeRiverMask();
    this.inlandAt = this.landscape.inlandAt || ((x, z) => x - this.landscape.coastX(z));
    this.lookoutFootprints = (this.config.lookouts || []).map((l) => ({ ...l,
      ...coastalRoadFrame(this.route, routeIndex, l.atM, (l.side === 'inland' ? -1 : 1) * (3.5 + l.widthM / 2)) }));
    this.uniforms = { uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSkyTop: { value: new THREE.Color() }, uSkyHorizon: { value: new THREE.Color() },
      // weather (js/world/weather.js): cloud cover/shadow/drift, wind, wet ground, sea roughness
      bfCloud: { value: new THREE.Vector4(.12, .5, .8, .57) }, bfWind: { value: .3 }, bfWet: { value: 0 }, bfRough: { value: .7 } };
    this.group = new THREE.Group();
    this.group.name = `${this.config.title || this.route.name} · stylized scenery`;
    scene.add(this.group);
    this.patches = new Map();
    this.scatter = new Map();
    this.cover = new Map();
    this.landmarkGeometries = new Set();
    this.stats = { ready: 0, loading: 1, queued: 0, errors: 0 };
    this.palette = Object.fromEntries(Object.entries(this.config.palette).map(([k, v]) => [k, new THREE.Color(v)]));
    // Hand-off to the real far terrain (set by the world once it has loaded; off = stylized all the way out).
    this.farUniform = { value: new THREE.Vector4(opts.farInner ?? 1500, opts.farBand ?? 400, 0, 0) };
    // Northern forest scenes: a continuous canopy, villages and camps planned from the real shoreline
    this.forestLayout = this.config.vegetation?.layout === 'forest-edge';
    if (this.forestLayout) {
      this.settlementPlan = planSettlement(this.config, this.route, routeIndex, this.landscape);
      this.forest = new ForestPlanner(this.config, this.landscape, routeIndex, (x, z) => this.heightAt(x, z), this.settlementPlan.clearings);
      this.canopyUniform = { value: new THREE.Vector4(0, 160, this.config.vegetation.canopyM ?? 16, 1) };
      this._setCanopyStart();
      this.forestTiles = new Map(); this.forestQueue = [];
    }
    this.groundMaterial = makeCoastalGroundMaterial(this.config.palette, this.config, this.farUniform, this.canopyUniform, this.uniforms);
    this._makeOcean();
    this._makeClouds();
    this._makeShadows();
    this._makeRoadside();
    this.ready = loadSceneryAssets(this.config.assets, { uniforms: this.uniforms, extraPaths: this.config.extraAssets }).then((kit) => {
      if (this.disposed) { kit.dispose(); return; }
      this.kit = kit;
      if ((this.config.kitExtensions || []).includes('adirondack')) this._addAdirondackKit(kit);
      if (this.settlementPlan) this.settlement = new Settlement(this.group, this.settlementPlan, kit, this.uniforms);
      this._makeLandmarks();
      if (this.landscape.real) this.bridges = new CoastBridges(this.group, this.landscape, this.uniforms);
      if (this.landscape.real && this.config.life) {
        this.life = new CoastLife(this.group, this.landscape, this.proj, this.route, this.index, this.uniforms, this.config.life);
        this.life.setNight(this._night || 0);
      }
      if (this.config.traffic) {
        this.traffic = new HighwayTraffic(this.group, this.route, this.index, this.landscape, this.uniforms, this.qualityKey, this.config.traffic);
        this.traffic.setNight(this._night || 0);
      }
      this.details = new CoastalDetails(this.group, this.route, this.index, this.landscape, kit, this.uniforms);
      if (this.landscape.city) {
        this.city = new CityScene(this.group, this.route, this.index, this.landscape, kit, this.uniforms, this.qualityKey);
        this.city.setNight(this._night || 0);
      }
      this._lastX = Infinity;
      this.stats.loading = 0;
    }).catch((err) => { this.stats.loading = 0; this.stats.errors++; opts.onError?.(err); });
  }

  _setCanopyStart() {
    // the canopy shell rises where the last tier of real trees ends
    this.canopyUniform.value.x = this.quality.forestRange * TILE_M - 150;
  }

  _addAdirondackKit(kit) {
    const geos = makeAdirondackKit({ fall: this.config.season === 'fall' });
    const near = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95 });
    const far = new THREE.MeshLambertMaterial({ vertexColors: true });
    const soft = decorateSceneryMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .98, side: THREE.DoubleSide }), 'groundcover', this.uniforms);
    this.kitMaterials = [near, far, soft];
    for (const [name, geometry] of Object.entries(geos)) {
      const material = ADIRONDACK_CATEGORY[name] === 'groundcover' ? soft : /-(lod|far)$/.test(name) ? far : near;
      kit.assets[name] = { geometry, material };
    }
    const dispose = kit.dispose;
    kit.dispose = () => { dispose(); this.kitMaterials.forEach((m) => m.dispose()); };
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
        const i = Math.min((route.turnIdx || route.dist.length - 1) - 2, Math.floor(s / 10)), j = i + 1;
        if ((this.config.lookouts || []).some((l) => (l.side || 'ocean') === (range.side || 'ocean') && Math.abs(s - l.atM) < (l.lengthM || 32) / 2 + 30)) continue;   // open entry and exit for traffic pulling in
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
      matrices.forEach((m, i) => mesh.setMatrixAt(i, m)); mesh.castShadow = mesh.receiveShadow = true; mesh.computeBoundingSphere(); this.roadside.add(mesh);
    }
    this.group.add(this.roadside);
  }

  _makeClouds() {
    // Soft, unlit billboards: shaded spheres read as grey boulders hanging in the sky.
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    for (const [x, y, r, a] of [[64, 36, 30, .9], [40, 40, 22, .75], [88, 40, 24, .75], [52, 28, 20, .6], [78, 27, 18, .6]]) {
      const g = ctx.createRadialGradient(x, y, 1, x, y, r);
      g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 64);
    }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, color: '#ffffff', transparent: true, opacity: .8, depthWrite: false, fog: false });
    const rand = randomSequence(1101);
    this.clouds = new THREE.Group(); this.clouds.name = 'clouds';
    const base = Math.max(1800, this.route.maxEle + 1100);
    for (let i = 0; i < 26; i++) {
      const angle = i * 2.399 + rand() * .4, radius = 9000 + rand() * 7000;
      const sprite = new THREE.Sprite(material);
      sprite.position.set(Math.cos(angle) * radius, base + rand() * 900, Math.sin(angle) * radius);
      const w = 2200 + rand() * 2600; sprite.scale.set(w, w * (.32 + rand() * .12), 1);
      this.clouds.add(sprite);
    }
    this.group.add(this.clouds);
  }

  /** A city's rivers as the fog bank's "shore": distance to the water (R) and ground height (G). */
  _makeRiverMask() {
    const R = this.landscape.fogField(), data = new Uint16Array(R.nx * R.nz * 2);
    for (let k = 0; k < R.field.length; k++) { data[k * 2] = THREE.DataUtils.toHalfFloat(R.field[k]); data[k * 2 + 1] = THREE.DataUtils.toHalfFloat(R.ground[k]); }
    const texture = new THREE.DataTexture(data, R.nx, R.nz, THREE.RGFormat, THREE.HalfFloatType);
    texture.magFilter = texture.minFilter = THREE.LinearFilter; texture.needsUpdate = true;
    this.shoreTexture = texture;
    this.shoreBox = new THREE.Vector4(R.x0, R.z0, (R.nx - 1) * R.dx, (R.nz - 1) * R.dz);
  }

  /** Real coast: the shoreline distance (R) and ground height (G) as a texture for the water shader. */
  _makeShoreTexture() {
    const S = this.landscape.shore, T = this.landscape.terrain;
    const data = new Uint16Array(S.nx * S.nz * 2);
    for (let j = 0; j < S.nz; j++) for (let i = 0; i < S.nx; i++) {
      const k = j * S.nx + i;
      data[k * 2] = THREE.DataUtils.toHalfFloat(S.field[k]);
      data[k * 2 + 1] = THREE.DataUtils.toHalfFloat(T.at(S.x0 + i * S.cell, S.z0 + j * S.cell));
    }
    const texture = new THREE.DataTexture(data, S.nx, S.nz, THREE.RGFormat, THREE.HalfFloatType);
    texture.magFilter = texture.minFilter = THREE.LinearFilter; texture.needsUpdate = true;
    this.shoreTexture = texture;
    this.shoreBox = new THREE.Vector4(S.x0, S.z0, (S.nx - 1) * S.cell, (S.nz - 1) * S.cell);
    return { texture, box: this.shoreBox };
  }

  _makeOcean() {
    const shore = this.landscape.real ? this._makeShoreTexture() : null;
    const material = makeCoastalWaterMaterial(this.landscape, this.uniforms, this.config.palette.water, this.config.palette.shallowWater, shore);
    this.ocean = new THREE.Mesh(new THREE.PlaneGeometry(160000, 160000), material);
    this.ocean.rotation.x = -Math.PI / 2;
    this.ocean.position.y = .05;
    this.ocean.name = 'Sea';
    this.ocean.visible = this.landscape.hasOcean !== false;
    this.group.add(this.ocean);
    this.lakeMeshes = [];
    if (this.landscape.real) return;   // surf and shallows come from the shoreline texture
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
    this.surf = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#e1ead4', transparent: true, opacity: .28, side: THREE.DoubleSide }));
    this.group.add(this.surf);
    this.surf.visible = this.landscape.hasOcean !== false;
    this.lakeMeshes = [];
    if (this.landscape.terrain) this._makeTerrainLakes();
    for (const lake of this.landscape.lakes || []) {
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 96), material);
      mesh.rotation.x = -Math.PI / 2; mesh.scale.set(lake.rx, lake.rz, 1);
      mesh.position.set(lake.x, lake.level, lake.z); mesh.name = lake.name;
      this.lakeMeshes.push(mesh); this.group.add(mesh);
    }
  }

  // Real lakes from the baked shoreline: water drawn on the terrain grid, in ~800 m chunks so the
  // chunks beyond the hand-off can give way to the real horizon (whose aerial photos show the same lakes).
  _makeTerrainLakes() {
    const t = this.landscape.terrain, meta = this.config.terrainData, W = meta.width, H = meta.height, g = meta.grid;
    const water = this.config.water || {};
    const material = makeLakeWaterMaterial(this.uniforms, this.config.palette.water, water.shallowWater || this.config.palette.shallowWater, this.config.palette.canopy);
    this.mistOpacity = { value: 0 };
    this.mistMaterial = makeLakeMistMaterial(this.uniforms, this.mistOpacity);
    this.lakeMaterial = material;
    const nw = this.landscape.terrain.bounds, dx = (nw.maxX - nw.minX) / (W - 1), dz = (nw.maxZ - nw.minZ) / (H - 1);
    const levels = new Map(t.lakes.map((l) => [l.id, l.level]));
    const CH = 26;   // cells per chunk side (~800 m)
    const reach = (this.config.water?.nearRouteM ?? 3000);
    // "Within reach of the road" uses a coarse index (the 40 m road index scans ~26,000 grid cells per
    // query at this range, which froze the page for minutes on Route 28). Whole chunks clearly inside or
    // outside the reach are settled from their centre; only chunks straddling the edge test each cell.
    const coarse = makeRouteIndex(this.route, this.proj, Math.max(200, reach / 2));
    const near = (x, z, r) => coarse.nearest(x, z, r);
    const halfDiag = Math.hypot(CH * dx, CH * dz) / 2;
    for (let cj = 0; cj < H - 1; cj += CH) for (let ci = 0; ci < W - 1; ci += CH) {
      const ccx = nw.minX + Math.min(ci + CH / 2, W - 1) * dx, ccz = nw.minZ + Math.min(cj + CH / 2, H - 1) * dz;
      const hit = near(ccx, ccz, reach + halfDiag);
      if (!hit) continue;   // the whole chunk is beyond reach
      const allNear = hit.d + halfDiag <= reach;
      const pos = [], shore = [], idx = [], vid = new Map();
      const vert = (i, j, level) => {
        const key = j * W + i;
        if (vid.has(key)) return vid.get(key);
        const x = nw.minX + i * dx, z = nw.minZ + j * dz;
        pos.push(x, level + .12, z); shore.push(g.sdf[key] / 10);
        vid.set(key, pos.length / 3 - 1); return pos.length / 3 - 1;
      };
      for (let j = cj; j < Math.min(H - 1, cj + CH); j++) for (let i = ci; i < Math.min(W - 1, ci + CH); i++) {
        const k = j * W + i, corners = [k, k + 1, k + W, k + W + 1];
        if (!corners.some((c) => g.sdf[c] < 0)) continue;
        const id = corners.map((c) => g.ids[c]).find((v) => v) || 0, level = levels.get(id);
        if (level == null) continue;
        const cx = nw.minX + (i + .5) * dx, cz = nw.minZ + (j + .5) * dz;
        if (!allNear && !near(cx, cz, reach)) continue;
        const a = vert(i, j, level), b = vert(i + 1, j, level), c = vert(i, j + 1, level), d = vert(i + 1, j + 1, level);
        idx.push(a, c, b, b, c, d);
      }
      if (!idx.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('aShore', new THREE.Float32BufferAttribute(shore, 1));
      geo.setIndex(idx); geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, material); mesh.name = 'Lake'; mesh.receiveShadow = false;
      mesh.userData.r = geo.boundingSphere.radius; mesh.userData.c = geo.boundingSphere.center;
      this.lakeMeshes.push(mesh); this.group.add(mesh);
      const mist = new THREE.Mesh(geo, this.mistMaterial); mist.position.y = 1.6; mist.name = 'Lake mist'; mist.renderOrder = 2;
      mist.userData = mesh.userData; mist.visible = false;
      (this.mistMeshes ||= []).push(mist); this.group.add(mist);
    }
  }

  /** Morning mist on the lakes, a little at golden hour. */
  setTime(key) {
    if (!this.mistOpacity) return;
    const mist = this.config.atmosphere?.lakeMist ?? 0;
    this.mistOpacity.value = mist * ({ morning: 1, golden: .55 }[key] || 0);
    for (const m of this.mistMeshes || []) m.visible = this.mistOpacity.value > 0;
  }

  _makeLandmarks() {
    for (const landmark of this.landscape.landmarks) {
      const asset = this.kit.assets[landmark.asset];
      if (!asset) continue;
      const fitted = ['bridge', 'viaduct'].includes(landmark.asset) ? fitBridgeToRoad(asset.geometry, this.route, this.index, landmark) : null;
      if (fitted) this.landmarkGeometries.add(fitted);
      const mesh = new THREE.Mesh(fitted || asset.geometry, asset.material);
      const forward = new THREE.Vector3(landmark.fx, landmark.slope, landmark.fz).normalize();
      const right = new THREE.Vector3(forward.z, 0, -forward.x).normalize();
      const up = forward.clone().cross(right).normalize();
      if (!fitted) {
        mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, forward));
        mesh.position.set(landmark.x, landmark.y, landmark.z);
      }
      mesh.name = landmark.name;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData.road = !!fitted;
      (fitted || asset.geometry).computeBoundingSphere?.();
      mesh.userData.r = ((fitted || asset.geometry).boundingSphere?.radius || 0) * Math.max(mesh.scale.x, mesh.scale.z);
      (this.landmarkMeshes ||= []).push(mesh);
      this.group.add(mesh);
    }
  }

  _makePatch(x, z, size) {
    const S = 16, N = S + 1;
    const positions = [], colors = [], indices = [], normals = [], realH = [], canopy = [];
    const c = new THREE.Color();
    const P = this.palette;
    const floor = this.forestLayout && P.forestFloor;
    const real = this.farOn && this.realHeightAt;
    for (let j = 0; j <= S; j++) for (let i = 0; i <= S; i++) {
      const px = x + size * i / S, pz = z + size * j / S;
      const y = this.heightAt(px, pz);
      positions.push(px, y, pz);
      // real ground height here: the ground morphs toward it approaching the hand-off to the far terrain
      realH.push(real ? this._smoothRealHeight(px, pz, y) : y);
      const coastal = this.inlandAt(px, pz);
      const patch = .5 + Math.sin(px / 130 + Math.sin(pz / 260)) * Math.cos(pz / 190) * .5;
      c.copy(P.grass).lerp(P.meadow, smoothstep(.15, .9, patch) * .65);
      const hx = this.heightAt(px + 4, pz), hz = this.heightAt(px, pz + 4);
      const normal = new THREE.Vector3((y - hx) / 4, 1, (y - hz) / 4).normalize(); normals.push(normal.x, normal.y, normal.z);
      const rise = Math.hypot(hx - y, hz - y) / 4;
      c.lerp(P.rock, smoothstep(.45, 1.4, rise));
      c.lerp(P.cliff, (1 - smoothstep(20, 85, coastal)) * .65);
      if (this.landscape.real) {
        // Big Sur: golden grass, olive scrub on the shaded faces, dark canyon forest
        const v = this.landscape.vegetationAt(px, pz);
        c.copy(P.meadow).lerp(P.grass, smoothstep(.2, .75, v.scrub) * .9).lerp(P.forest, v.forest * .9);
        c.lerp(P.rock, smoothstep(.55, 1.3, rise) * .8);
        c.lerp(P.cliff, (1 - smoothstep(10, 70, coastal)) * smoothstep(.35, .9, rise) * .7);
        if (P.sand) c.lerp(P.sand, (1 - smoothstep(2.5, 6, y)) * (1 - smoothstep(60, 140, coastal)));
      }
      if (this.forest) {
        const cover = this.forest.cover(px, pz);
        canopy.push(cover);
        if (floor) c.lerp(floor, cover * .75);
      }
      const regionalColor = this.landscape.colorAt?.(px, pz);
      if (regionalColor) c.lerp(new THREE.Color(regionalColor), .8);
      // City bluffs (Mount Washington): the real slope shows through the land-use colour as banded sandstone
      if (regionalColor && P.bluff) c.lerp(P.bluff, smoothstep(.8, 1.6, rise) * (.55 + .3 * Math.sin(y * .9 + px * .01)));
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
      for (const depth of [0, Math.max(20, size * .6)]) for (const k of edge) {
        positions.push(positions[k * 3], positions[k * 3 + 1] - depth, positions[k * 3 + 2]);
        realH.push(realH[k] - depth);
        if (this.forest) canopy.push(canopy[k]);
        colors.push(...colors.slice(k * 3, k * 3 + 3));
      }
      for (let i = 0; i < S; i++) indices.push(base + i, base + N + i, base + i + 1, base + i + 1, base + N + i, base + N + i + 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('aRealH', new THREE.Float32BufferAttribute(realH, 1));
    if (this.forest) geometry.setAttribute('aCanopy', new THREE.Float32BufferAttribute(canopy, 1));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    geometry.attributes.normal.array.set(normals); geometry.computeBoundingSphere();
    // the morph toward real heights moves vertices up or down: keep the culling sphere honest
    let morph = 0;
    for (let k = 0; k < realH.length; k++) morph = Math.max(morph, Math.abs(realH[k] - positions[k * 3 + 1]));
    geometry.boundingSphere.radius += morph + (this.forest ? this.canopyUniform.value.z : 0);
    const mesh = new THREE.Mesh(geometry, this.groundMaterial);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  _makeScatter(cx, cz, detailed = false, coverOnly = false) {
    const size = 192, rand = randomSequence((cx * 73856093 ^ cz * 19349663) + this.config.seed + (coverOnly ? 7711 : 0));
    const lists = {};
    const onLookout = (x, z) => this.lookoutFootprints.some((l) => {
      const dx = x - l.position.x, dz = z - l.position.z;
      return Math.abs(dx * l.right.x + dz * l.right.z) < l.widthM / 2 + .8
        && Math.abs(dx * l.forward.x + dz * l.forward.z) < l.lengthM / 2 + .8;
    });
    const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), scale = new THREE.Vector3();
    const add = (name, x, y, z, width, height = width) => {
      if (!this.kit.assets[name] && name !== 'shadow') return;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
      p.set(x, y, z); scale.set(width, height, width);
      (lists[name] ||= []).push(matrix.compose(p, q, scale).clone());
    };
    const vegetation = this.config.vegetation || {};
    const count = (coverOnly ? this.quality.coverCandidates : this.quality.candidates) * (vegetation.density || 1);
    const coverScale = vegetation.coverScale || [.75, 1.95];
    for (let k = 0; k < count; k++) {
      const x = cx * size + rand() * size, z = cz * size + rand() * size;
      const inland = this.inlandAt(x, z), y = this.heightAt(x, z);
      if (inland < 10 || y < 1 || this.landscape.onStreet?.(x, z, 1) || this.landscape.isWater?.(x, z, y) || this.landscape.bridgeAt(x, z, 10) || this.landscape.creekAt(x, z) || onLookout(x, z)) continue;
      if (this.landscape.canPlant && !this.landscape.canPlant(x, z)) continue;
      const road = this.index.nearest(x, z, 10);
      if (road && road.d < 7.5) continue;
      const slope = Math.hypot(this.heightAt(x + 4, z) - y, this.heightAt(x, z + 4) - y) / 4;
      if (slope > 1.3) continue;
      const pick = rand();
      if (coverOnly) {
        const name = vegetation.cover ? vegetation.cover[Math.floor(pick * vegetation.cover.length)] : pick < .12 ? 'poppy' : pick < .18 ? 'lupine' : pick < .33 ? 'succulent' : pick < .4 ? 'flowers' : 'grass';
        const k = rand();
        // under the forest canopy: sparse ferns only
        if (this.forestLayout && !this.index.nearest(x, z, 14) && (k < .7 || name !== 'fern')) continue;
        add(name, x, y - .09, z, coverScale[0] + k * (coverScale[1] - coverScale[0]));
        continue;
      }
      if (this.landscape.real) {
        const v = this.landscape.vegetationAt(x, z);
        if (pick < v.forest * .5 && slope < 1.1) {
          // redwoods deep in the canyons, oaks and pines on their flanks, cypress on the sea bluffs
          const name = v.forest > .55 && v.valley > .3 ? `fir${Math.floor(rand() * 2)}` : rand() < .6 ? `broadleaf${Math.floor(rand() * 2)}` : `pine${Math.floor(rand() * 2)}`;
          const tree = !detailed && this.kit.assets[`${name}-lod`] ? `${name}-lod` : name;
          const tall = name.startsWith('fir') ? 1.3 + rand() * .7 : .8 + rand() * .45;
          add(tree, x, y - .15, z, .75 + rand() * .55, tall);
          if (detailed) add('shadow', x, y + .045, z, 8);
        } else if (inland < 220 && inland > 25 && pick > .985) {
          const name = `cypress${Math.floor(rand() * 3)}`;
          add(!detailed && this.kit.assets[`${name}-lod`] ? `${name}-lod` : name, x, y - .15, z, .8 + rand() * .5, .8 + rand() * .4);
        } else if (pick < .2 + v.scrub * .4) {
          const width = .6 + rand() * 1.2;
          add(rand() < .3 ? 'sage' : `shrub${Math.floor(rand() * 2)}`, x, y - .12, z, width, width * (.7 + v.scrub * .5));
          if (detailed) add('shadow', x, y + .04, z, width * 2.5);
        } else if (slope > .5 && pick < .8 && rand() < .25) add(`rock${Math.floor(rand() * 2)}`, x, y - .3, z, .5 + rand() * 1.4);
        else if (detailed && pick < .9) add('grass', x, y - .08, z, .9 + rand());
        continue;
      }
      const grove = .5 + Math.sin(x / 125 + Math.cos(z / 260)) * .32 + Math.sin(z / 180) * .22;
      if (grove > (this.config.biome === 'forest' ? .18 : .5) && pick < (vegetation.treeDensity ?? .14) * Math.max(this.config.biome === 'forest' ? .5 : 0, grove) && inland > 65 && slope < .8 && y < (vegetation.treelineM || Infinity)) {
        const width = .7 + rand() * .55;
        const name = vegetation.trees ? vegetation.trees[Math.floor(rand() * vegetation.trees.length)] : inland > 350 && grove > .7 ? `pine${Math.floor(rand() * 2)}` : `cypress${Math.floor(rand() * 3)}`;
        if (!name) continue;
        const tree = !detailed && this.kit.assets[`${name}-lod`] ? `${name}-lod` : name;
        add(tree, x, y - .15, z, width, .8 + rand() * .45);
        if (detailed) add('shadow', x, y + .045, z, width * 8);
      } else if (slope > .25 && pick < .16 && !this.index.nearest(x, z, 16)) {
        const width = .45 + rand() * .95;
        add(`outcrop${Math.floor(rand() * 2)}`, x, y - width * .9, z, width, width * (.65 + rand() * .65));
      } else if (pick < .57) {
        const width = .65 + rand() * 1.1;
        const shrub = vegetation.shrubs ? vegetation.shrubs[Math.floor(rand() * vegetation.shrubs.length)] : `shrub${Math.floor(rand() * 2)}`;
        add(shrub, x, y - .12, z, width);
        if (detailed) add('shadow', x, y + .04, z, width * 2.5);
      }
      else if (pick < .69) add(`rock${Math.floor(rand() * 2)}`, x, y - .3, z, .5 + rand() * 1.4);
      else if (detailed && pick < .79) add('grass', x, y - .08, z, .9 + rand());
    }
    if (coverOnly && !this.landscape.city) {
      // A denser verge reads from the bike without filling distant hills with
      // tiny meshes. These placements remain deterministic across quality tiers.
      for (let i = 0; i < (this.route.turnIdx || this.index.xs.length - 1); i += 2) {
        const x0 = this.index.xs[i], z0 = this.index.zs[i];
        if (x0 < cx * size || x0 >= (cx + 1) * size || z0 < cz * size || z0 >= (cz + 1) * size) continue;
        const dx = this.index.xs[i + 1] - x0, dz = this.index.zs[i + 1] - z0, len = Math.hypot(dx, dz) || 1;
        const vergeCount = (this.quality === COASTAL_QUALITY.low ? 28 : this.quality === COASTAL_QUALITY.high ? 132 : 96) * (vegetation.vergeDensity || 1);
        for (let k = 0; k < vergeCount; k++) {
          const off = (k % 2 ? -1 : 1) * (5.4 + rand() * 11), along = (rand() - .5) * 18;
          const x = x0 - dz / len * off + dx / len * along, z = z0 + dx / len * off + dz / len * along;
          if (this.inlandAt(x, z) < 8 || this.landscape.bridgeAt(x, z, 14) || this.landscape.creekAt(x, z) || onLookout(x, z)) continue;
          const y = this.heightAt(x, z), pick = rand();
          if (this.landscape.isWater?.(x, z, y)) continue;
          const name = vegetation.cover ? vegetation.cover[Math.floor(pick * vegetation.cover.length)] : pick < .2 ? 'poppy' : pick < .28 ? 'lupine' : pick < .42 ? 'succulent' : 'grass';
          add(name, x, y - .09, z, vegetation.coverScale ? coverScale[0] + rand() * (coverScale[1] - coverScale[0]) * .9 : .8 + rand() * .9);
        }
      }
    }
    const group = new THREE.Group();
    for (const [name, matrices] of Object.entries(lists)) {
      const asset = name === 'shadow' ? this.shadowAsset : this.kit.assets[name];
      const mesh = new THREE.InstancedMesh(asset.geometry, asset.material, matrices.length);
      matrices.forEach((m, i) => {
        mesh.setMatrixAt(i, m);
        if (name !== 'shadow') {
          const tint = this.config.biome === 'desert' && /^(rock|outcrop)/.test(name) ? new THREE.Color(this.config.palette.rock) : new THREE.Color();
          mesh.setColorAt(i, tint.multiplyScalar(.9 + (i % 5) * .04));
        }
      }); mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = /^(cypress|pine|fir|broadleaf|palm|rock|outcrop)/.test(name) && !name.endsWith('-lod');   // distant trees: no shadow pass
      mesh.receiveShadow = name !== 'shadow';
      mesh.computeBoundingSphere(); group.add(mesh);
    }
    this.group.add(group);
    return group;
  }

  update(cx, cz) {
    if (this.forestQueue) this._buildForestTiles(cx, cz);
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
    const ring = this.farOn ? 2 : 5;   // with the real far terrain on, the stylized ground only needs ~3 km
    for (let x = ix - ring; x <= ix + ring; x++) for (let z = iz - ring; z <= iz + ring; z++) visit(x * size, z * size, size);
    this._cullFar(cx, cz);
    this.clouds.position.set(cx, 0, cz);   // the sky travels with you
    for (const [key, mesh] of this.patches) {
      mesh.visible = show.has(key);
      if (!mesh.visible) { this.group.remove(mesh); mesh.geometry.dispose(); this.patches.delete(key); }
    }
    if (this.kit && this.forestLayout) this._planForestTiles(cx, cz);
    if (this.kit) {
      const visible = new Set(), sx = Math.floor(cx / 192), sz = Math.floor(cz / 192);
      const range = this.quality.scatterRange;
      for (let x = sx - range; x <= sx + range; x++) for (let z = sz - range; z <= sz + range; z++) {
        const detailed = Math.hypot((x + .5) * 192 - cx, (z + .5) * 192 - cz) < 260;
        const key = `${x}/${z}/${detailed}`; visible.add(key);
        if (!this.scatter.has(key) && !this.forestLayout) this.scatter.set(key, this._makeScatter(x, z, detailed));
      }
      for (const [key, group] of this.scatter) if (!visible.has(key)) {
        this.group.remove(group); group.children.forEach((m) => m.dispose()); this.scatter.delete(key);
      }
      const near = new Set();
      for (let x = sx - 1; x <= sx + 1; x++) for (let z = sz - 1; z <= sz + 1; z++) {
        const key = `${x}/${z}`; near.add(key);
        if (!this.cover.has(key)) this.cover.set(key, this._makeScatter(x, z, true, true));
      }
      for (const [key, group] of this.cover) if (!near.has(key)) {
        this.group.remove(group); group.children.forEach((m) => m.dispose()); this.cover.delete(key);
      }
    }
    this.stats.ready = this.patches.size;
  }

  // ---- Forest tiles: wanted tiers by distance, built a few per frame, nearest first ----
  _planForestTiles(cx, cz) {
    const range = this.quality.forestRange, sx = Math.floor(cx / TILE_M), sz = Math.floor(cz / TILE_M);
    const want = new Map();
    for (let x = sx - range; x <= sx + range; x++) for (let z = sz - range; z <= sz + range; z++) {
      const d = Math.hypot((x + .5) * TILE_M - cx, (z + .5) * TILE_M - cz);
      if (d > (range + .6) * TILE_M) continue;
      want.set(`${x}/${z}`, { x, z, d, tier: d < this.quality.nearM ? 0 : d < this.quality.midM ? 1 : 2 });
    }
    this.forestWant = want;
    // drop what is out of range; queue what is missing or at the wrong tier
    for (const [xy, tile] of this.forestTiles) if (!want.has(xy)) { this._disposeGroup(tile.group); this.forestTiles.delete(xy); }
    this.forestQueue = [...want.entries()].filter(([xy, w]) => this.forestTiles.get(xy)?.tier !== w.tier)
      .sort((a, b) => a[1].d - b[1].d);
  }

  _buildForestTiles() {
    const t0 = performance.now();
    let built = 0;
    while (this.forestQueue.length && built < this.quality.buildsPerFrame && performance.now() - t0 < 6) {
      const [xy, w] = this.forestQueue.shift();
      if (this.forestWant?.get(xy)?.tier !== w.tier) continue;
      const lists = this.forest.tile(w.x, w.z, w.tier);
      const group = new THREE.Group();
      for (const [name, matrices] of Object.entries(lists)) {
        const asset = this.kit.assets[name];
        if (!asset || !matrices.length) continue;
        const mesh = new THREE.InstancedMesh(asset.geometry, asset.material, matrices.length);
        matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
        mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
        mesh.castShadow = w.tier === 0 && !/^(goldenrod|blueberry)/.test(name);
        mesh.receiveShadow = w.tier === 0;
        group.add(mesh);
      }
      const old = this.forestTiles.get(xy);
      if (old) this._disposeGroup(old.group);
      this.forestTiles.set(xy, { tier: w.tier, group });
      this.group.add(group);
      built++;
    }
    this.stats.queued = this.forestQueue.length;
  }

  _disposeGroup(group) { this.group.remove(group); group.children.forEach((m) => m.dispose()); }

  // Real ground height, lightly smoothed: the stylized patches are coarser than the real terrain, so blending
  // toward a smoothed target keeps neighbouring patches from opening cracks in steep country.
  _smoothRealHeight(x, z, fallback) {
    let sum = 0, n = 0;
    for (const [dx, dz] of [[0, 0], [70, 0], [-70, 0], [0, 70], [0, -70]]) {
      const h = this.realHeightAt(x + dx, z + dz);
      if (h != null) { sum += h; n++; }
    }
    return n ? sum / n : fallback;
  }

  /** Turn the hand-off to the real far terrain on or off (off when it can't load, e.g. offline). */
  setFar(on) {
    on = !!on;
    if (on === !!this.farOn) return;
    this.farOn = on;
    this.farUniform.value.z = on ? 1 : 0;
    // rebuild the ground so every patch knows the real height it morphs toward
    for (const mesh of this.patches.values()) { this.group.remove(mesh); mesh.geometry.dispose(); }
    this.patches.clear();
    // rebuild now, not next frame: an empty frame would show the sea plane through the missing ground
    const x = this._lastX, z = this._lastZ;
    this._lastX = Infinity;
    if (Number.isFinite(x)) this.update(x, z);
  }

  // Beyond the hand-off, stylized stand-ins (mesas, peaks, lakes) would double up with the real ones.
  _cullFar(cx, cz) {
    const limit = this.farUniform.value.x + this.farUniform.value.y * 0.5;
    for (const m of this.landmarkMeshes || []) m.visible = !this.farOn || m.userData.road || Math.hypot(m.position.x - cx, m.position.z - cz) - (m.userData.r || 0) < limit;
    for (const m of this.lakeMeshes || []) {
      const c = m.userData.c, d = c ? Math.hypot(c.x - cx, c.z - cz) - m.userData.r : Math.hypot(m.position.x - cx, m.position.z - cz) - Math.max(m.scale.x, m.scale.y);
      m.visible = !this.farOn || d < limit;
    }
    if (this.mistMeshes) for (const m of this.mistMeshes) m.visible = this.mistOpacity.value > 0 && (!this.farOn || Math.hypot(m.userData.c.x - cx, m.userData.c.z - cz) - m.userData.r < limit);
  }

  /** Every frame (the city's traffic, people and boats move continuously). */
  tick(camera, dt, rider) {
    this.city?.tick(camera, dt, this.uniforms.uTime.value, rider);
    this.traffic?.tick(dt, rider);
    this.life?.tick(dt, camera);
  }

  setNight(v) {
    this._night = v; this.city?.setNight(v); this.traffic?.setNight(v); this.life?.setNight(v);
    const cloud = this.clouds?.children[0]?.material;
    if (cloud) cloud.color.set(v ? '#3b4157' : '#ffffff');
  }

  heightAt(x, z) { return this.landscape.heightAt(x, z); }
  setQuality(key) {
    this.quality = COASTAL_QUALITY[key] || COASTAL_QUALITY.balanced;
    this.qualityKey = COASTAL_QUALITY[key] ? key : 'balanced';
    this.city?.setQuality(this.qualityKey);
    if (this.forestTiles) {
      for (const tile of this.forestTiles.values()) this._disposeGroup(tile.group);
      this.forestTiles.clear(); this.forestQueue = []; this._setCanopyStart();
    }
    for (const map of [this.scatter, this.cover]) {
      for (const group of map.values()) { this.group.remove(group); group.children.forEach((m) => m.dispose()); }
      map.clear();
    }
    this._lastX = Infinity;
  }
  get loadingCount() { return this.stats.loading; }
  dispose() {
    this.disposed = true;
    this.scene.remove(this.group);
    for (const mesh of this.patches.values()) mesh.geometry.dispose();
    for (const group of this.scatter.values()) group.children.forEach((m) => m.dispose());
    for (const group of this.cover.values()) group.children.forEach((m) => m.dispose());
    this.details?.dispose();
    this.city?.dispose();
    this.landmarkGeometries.forEach((g) => g.dispose()); this.landmarkGeometries.clear();
    this.surf?.geometry.dispose(); this.surf?.material.dispose(); this.shoreTexture?.dispose(); this.bridges?.dispose(); this.traffic?.dispose(); this.life?.dispose();
    this.ocean.geometry.dispose(); this.ocean.material.dispose();
    this.lakeMeshes.forEach((m) => m.geometry.dispose());
    this.lakeMaterial?.dispose(); this.mistMaterial?.dispose();
    this.settlement?.dispose();
    for (const tile of this.forestTiles?.values() || []) tile.group.children.forEach((m) => m.dispose());
    const cloudMat = this.clouds.children[0]?.material; cloudMat?.map?.dispose(); cloudMat?.dispose();
    this.shadowAsset.geometry.dispose(); this.shadowAsset.material.map.dispose(); this.shadowAsset.material.dispose();
    this.roadside.children.forEach((m) => { m.geometry.dispose(); m.dispose(); });
    this.roadside.children[0]?.material.dispose();
    this.groundMaterial.dispose(); this.kit?.dispose();
    this.patches.clear(); this.scatter.clear(); this.cover.clear();
  }
}
