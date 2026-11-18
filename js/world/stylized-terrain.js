import * as THREE from '../../vendor/three.module.min.js';
import { randomSequence, smoothstep, vhash, vnoise } from './toolbox/core/random.js';
import { makeTreeCards } from './toolbox/vegetation/tree-cards.js';
import { loadSceneryAssets } from './toolbox/packs/blender-kits.js';
import { makeGroundMaterial, makeSeaMaterial, makeLakeWaterMaterial, makeLakeMistMaterial, decorateSceneryMaterial } from './toolbox/materials/surfaces.js';
import { scenePacks, PACK_META } from './toolbox/packs/index.js';
import { normalizeScene, lifeKit } from './toolbox/scene-schema.js';
import { ForestPlanner, TILE_M, makeClearings } from './toolbox/vegetation/forest.js';
import { GroundBlocks, InstancePool, packMatrices, proxyGroup } from './toolbox/core/pools.js';
import { MountainRoad } from './toolbox/structures/mountain-road.js';
import { planSettlement, Settlement } from './toolbox/structures/settlement.js';
import { RoadsideDetails, fitBridgeToRoad, roadFrame } from './toolbox/roadside/details.js';
import { landscapeBuilder } from './toolbox/landscape/index.js';
import { CityScene } from './toolbox/city/city.js';
import { ArchBridges } from './toolbox/structures/arch-bridges.js';
import { HighwayTraffic } from './toolbox/life/traffic.js';
import { CoastLife } from './toolbox/life/coast-life.js';
import { Wildlife } from './toolbox/life/wildlife.js';
import { groundDrape, DRAPE_MAX_DROP, DRAPE_MAX_PATCH } from './toolbox/landscape/ground-drape.js';   // [w2-align]
import { makeRouteIndex } from './geo.js';
import { vistaConfig, makeCumulusAtlas } from './toolbox/atmosphere/vista.js';
import { Verge } from './toolbox/roadside/verge.js';
import { buildGuardrail } from './toolbox/roadside/guardrail.js';
import { Visitors } from './toolbox/life/visitors.js';
import { planFootprints, Footprints } from './toolbox/structures/footprints.js';
import { BuildingKit } from './toolbox/structures/buildings/kit.js';
import { Cables } from './toolbox/structures/cables.js';
import { Dams } from './toolbox/structures/dam.js';
import { RaceDay } from './toolbox/life/race-day.js';
import { HairpinWalls } from './toolbox/structures/hairpin-walls.js';
import { Boards } from './toolbox/roadside/boards.js';

// Tree cards stream in large tiles, at a fraction of the scatter's candidate density.
const FAR_TREE_TILE_M = 768, FAR_TREE_DENSITY = .3;

// flowers by zone (vegetation.rich): the northern-rockies pack's drifts (toolbox/packs/meta.js)
const FLOWERS = PACK_META['northern-rockies'].flowerZones;
// Ground cover by zone for mountain scenes: Going-to-the-Sun's by default, or a pack's from "vegetation.zones"
// (flowers: the pack's flowerZones; grasses: [name, cutoff] by zone; under: four plants under the trees).
const GRASSES = {
  east: [['drygrass', .55], ['bunchgrass', 1]], alpine: [['sedge', .6], ['grass', 1]],
  subalpine: [['meadowgrass', .4], ['bunchgrass', .7], ['grass', 1]], valley: [['meadowgrass', .45], ['sedge', .75], ['grass', 1]],
};
function coverZones(Z) {
  return { flowers: Z?.pack ? PACK_META[Z.pack].flowerZones : FLOWERS, grasses: { ...GRASSES, ...(Z?.grasses || {}) },
    under: Z?.under || ['fern', 'huckleberry', 'sedge', 'mossmat0'], dryBelowM: Z?.dryBelowM || 0 };
}
const pickGrass = (list, k) => { for (const [n, c] of list) if (k < c) return n; return list.at(-1)[0]; };

// Ground cover streams in small tiles: full density within COVER_FULL_M of the camera, half out to COVER_RANGE_M.
const COVER_TILE_M = 96, COVER_FULL_M = 110, COVER_RANGE_M = 220;
const fract = (v) => v - Math.floor(v);

/** Run a build job (generator) to the end at once. */
function runJob(job) { for (;;) { const r = job.next(); if (r.done) return r.value; } }

export const SCENERY_QUALITY = {
  // forestRange: tiles of real trees in forest scenes; nearM/midM: tile-centre distances for the detail tiers;
  // buildMs: time per frame for building streamed tiles (ground, plants, forest) while riding;
  // farTreeM: how far the flat tree cards reach beyond the real trees (0 = none)
  low: { pixelRatio: 1, samples: 2, shadows: false, scatterRange: 2, candidates: 150, coverCandidates: 100, forestRange: 3, nearM: 0, midM: 380, buildMs: 3, farTreeM: 0 },
  balanced: { pixelRatio: 2, samples: 2, shadows: true, scatterRange: 3, candidates: 230, coverCandidates: 320, forestRange: 4, nearM: 170, midM: 450, buildMs: 4, farTreeM: 1600 },
  high: { pixelRatio: 2, samples: 4, shadows: true, scatterRange: 4, candidates: 310, coverCandidates: 480, forestRange: 5, nearM: 240, midM: 560, buildMs: 5, farTreeM: 2200 },
};

/** Bundled style-C coastal scene. No tile/imagery requests, including offline. */
export class StylizedTerrain {
  constructor(scene, proj, routeIndex, opts) {
    this.scene = scene;
    this.config = normalizeScene(opts.route.scene);   // old field names → the toolbox's
    this.proj = proj;
    this.route = opts.route;
    this.index = routeIndex;
    this.quality = SCENERY_QUALITY[opts.quality] || SCENERY_QUALITY.balanced;
    this.qualityKey = SCENERY_QUALITY[opts.quality] ? opts.quality : 'balanced';
    this.lookKey = opts.look || null;   // cartoon look test: the kit is built with smooth shading
    this.landscape = landscapeBuilder(this.config)(this.config, proj, routeIndex, opts.route);
    // fog (the weather's fog bank) lies on this level: the sea, or a city's rivers
    this.fogBase = this.landscape.fogBase ?? 0;
    if (this.landscape.fogField) this._makeRiverMask();
    this.inlandAt = this.landscape.inlandAt || ((x, z) => x - this.landscape.coastX(z));
    this.lookoutFootprints = (this.config.lookouts || []).map((l) => ({ ...l,
      ...roadFrame(this.route, routeIndex, l.atM, (l.side === 'inland' ? -1 : 1) * (3.5 + l.widthM / 2)) }));
    // (a city's areas share one set: the weather and the time drive them all — PLAN 5.4)
    this.uniforms = opts.uniforms || { uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSkyTop: { value: new THREE.Color() }, uSkyHorizon: { value: new THREE.Color() },
      // weather (js/world/toolbox/atmosphere/weather.js): cloud cover/shadow/drift, wind, wet ground, sea roughness
      bfCloud: { value: new THREE.Vector4(.12, .5, .8, .57) }, bfWind: { value: .3 }, bfWet: { value: 0 }, bfRough: { value: .7 } };
    this.group = new THREE.Group();
    this.group.name = `${this.config.title || this.route.name} · stylized scenery`;
    scene.add(this.group);
    this.patches = new Map();
    this.farTrees = new Map();
    this.scatter = new Map();
    this.cover = new Map();
    this.landmarkGeometries = new Set();
    this.stats = { ready: 0, loading: 1, queued: 0, errors: 0 };
    this.palette = Object.fromEntries(Object.entries(this.config.palette).map(([k, v]) => [k, new THREE.Color(v)]));
    // Hand-off to the real far terrain (set by the world once it has loaded; off = stylized all the way out).
    this.farUniform = { value: new THREE.Vector4(opts.farInner ?? 1500, opts.farBand ?? 400, 0, 0) };
    // Northern forest scenes: a continuous canopy, villages and camps planned from the real shoreline
    this.forestLayout = this.config.vegetation?.layout === 'forest-edge';
    // real buildings from the map (toolbox/structures/footprints.js): planned now so the trees keep clear of them
    this.footprintPlan = this.landscape.real && this.config.places?.buildings ? planFootprints(this.config, this.proj, routeIndex) : null;
    if (this.footprintPlan) {
      const yards = makeClearings(this.footprintPlan.clearings);
      const prev = this.landscape.canPlant;
      this.landscape.canPlant = (x, z) => !yards.at(x, z) && (!prev || prev(x, z));
    }
    if (this.forestLayout) {
      this.settlementPlan = planSettlement(this.config, this.route, routeIndex, this.landscape);
      // built sites (lodges, visitor centres, parking) are cleared of trees too
      const sites = (this.landscape.sites || []).map((t) => ({ x: t.x, z: t.z, r: Math.hypot(t.hw, t.hl) + 6 }));
      const yards = this.footprintPlan?.clearings || [];
      const clearings = sites.length || yards.length ? makeClearings([...this.settlementPlan.clearings.items, ...sites, ...yards]) : this.settlementPlan.clearings;
      this.forest = new ForestPlanner(this.config, this.landscape, routeIndex, (x, z) => this.heightAt(x, z), clearings, this.route);
      this.canopyUniform = { value: new THREE.Vector4(0, 160, this.config.vegetation.canopyM ?? 16, 1) };
      this._setCanopyStart();
      this.forestTiles = new Map(); this.forestQueue = [];
    }
    this.vista = vistaConfig(this.config);   // vista kit (js/world/toolbox/atmosphere/vista.js): distance detail, haze, clouds
    this.groundMaterial = makeGroundMaterial(this.config.palette, this.config, this.farUniform, this.canopyUniform, this.uniforms, this.vista, this._vkAttr());
    this._makeOcean();
    this._makeClouds();
    this._makeShadows();
    this._makeRoadside();
    this.ready = loadSceneryAssets(this.config.assets, { uniforms: this.uniforms, extraPaths: this.config.extraAssets }).then((kit) => {
      if (this.disposed) { kit.dispose(); return; }
      this.kit = kit;
      for (const pack of scenePacks(this.config)) this._addPack(kit, pack);   // regional packs (toolbox/packs)
      if (this.settlementPlan) this.settlement = new Settlement(this.group, this.settlementPlan, kit, this.uniforms);
      // map footprints: the building kit when the scene asks for it (toolbox/structures/buildings), else the plain extrusions
      if (this.footprintPlan) this.footprints = this.config.buildingKit
        ? new BuildingKit(this.group, this.footprintPlan, this.landscape, this.config, this.uniforms, this.index)
        : new Footprints(this.group, this.footprintPlan, this.landscape, this.config, this.uniforms);
      // lifts and power lines, dams (toolbox/structures): from the map, when the scene has a places file
      if (this.config.places && this.config.cables) this.cables = new Cables(this.group, this.config.places, this.landscape, this.proj, this.index, this.config.cables);
      if (this.config.places?.dams?.length && this.config.dams) this.dams = new Dams(this.group, this.config.places, this.landscape, this.proj, this.config.dams);
      if (this.config.boards?.length) this.boards = new Boards(this.group, this.route, this.index, this.config.boards);   // bend, town and col boards (toolbox/roadside)
      this._makeLandmarks();
      if (this.landscape.real) this.bridges = new ArchBridges(this.group, this.landscape, this.uniforms);
      // life kit (toolbox/life): wildlife or coast life, by "life.kit" or the landform
      const life = lifeKit(this.config, this.landscape);
      if (life === 'wildlife') this.life = new Wildlife(this.group, this.landscape, this.route, this.index, this.uniforms, this.config.life);
      else if (life === 'coast') this.life = new CoastLife(this.group, this.landscape, this.proj, this.route, this.index, this.uniforms, this.config.life);
      this.life?.setNight(this._night || 0);
      if (this.config.traffic) {
        this.traffic = new HighwayTraffic(this.group, this.route, this.index, this.landscape, this.uniforms, this.qualityKey, this.config.traffic);
        this.traffic.setNight(this._night || 0);
      }
      this.details = new RoadsideDetails(this.group, this.route, this.index, this.landscape, kit, this.uniforms);
      if (this.config.verge && this.landscape.frameAt) this.verge = new Verge(this.group, this.landscape, this.route, this.config.verge);
      if (this.config.hairpinWalls) this.hairpinWalls = new HairpinWalls(this.group, this.landscape, this.route, this.config.hairpinWalls);   // retaining walls on switchbacks (toolbox/structures)
      if (this.config.raceDay && this.landscape.frameAt) this.raceDay = new RaceDay(this.group, this.landscape, this.route, this.index, this.uniforms, this.config.raceDay, this.qualityKey);   // race day (toolbox/life)
      if (this.config.visitors && this.landscape.frameAt) this.visitors = new Visitors(this.group, this.landscape, this.route, this.index, this.uniforms, this.config.visitors, this.qualityKey, this.config.lookouts || []);
      if (this.config.mountainRoad) {   // tunnels, masonry guardwalls, arches, waterfalls (toolbox/structures)
        this.landmarks = new MountainRoad(this.group, this.landscape, this.route, this.index, this.proj, this.config, kit, this.uniforms);
        this.landmarks.setNight(this._night || 0);
      }
      if (this.landscape.city) {
        const t0 = performance.now();
        this.city = new CityScene(this.group, this.route, this.index, this.landscape, kit, this.uniforms, this.qualityKey);
        this.cityMs = Math.round(performance.now() - t0);   // (areas, PLAN 5.4: what building an area costs)
        this.city.setNight(this._night || 0);
      }
      this._lastX = Infinity;
      this.stats.loading = 0;
    }).catch((err) => { this.stats.loading = 0; this.stats.errors++; opts.onError?.(err); });
  }

  /** Ground carries the vista kit's road-cut / fire-scar attribute (mountain scenes with rock cuts or burns). */
  _vkAttr() { return !!(this.vista && this.landscape.mountain && (this.vista.rock?.cuts || this.landscape.burnAt)); }

  _setCanopyStart() {
    // the canopy shell rises where the last tier of real trees ends
    this.canopyUniform.value.x = this.quality.forestRange * TILE_M - 150;
  }

  /** A regional pack's models join the kit: near, far (-lod/-far) and soft ground-cover materials shared by all. */
  _addPack(kit, { make, category, decorateNear }) {
    const geos = make({ fall: this.config.season === 'fall', smooth: !!this.lookKey });
    const near = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95 });
    // a pack can give its near trees a surface shader (northern-rockies: bark, foliage clumps, aspen flutter, moss)
    if (decorateNear) decorateNear(near, this.uniforms);
    const far = new THREE.MeshLambertMaterial({ vertexColors: true });
    const soft = decorateSceneryMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .98, side: THREE.DoubleSide }), 'groundcover', this.uniforms);
    const first = !this.kitMaterials;
    (this.kitMaterials ||= []).push(near, far, soft);
    for (const [name, geometry] of Object.entries(geos)) {
      const material = category[name] === 'groundcover' ? soft : /-(lod|far)$/.test(name) ? far : near;
      kit.assets[name] = { geometry, material };
    }
    if (!first) return;   // several packs: one dispose for all their materials
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
    this.roadside = buildGuardrail(this.config, this.route, this.index, this.landscape);   // toolbox/roadside/guardrail.js
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
    // one draw call for the whole ring: camera-facing quads drawn by a small shader (was a Sprite each)
    // vista kit: cartoon cumulus (four shapes in one texture), lower and closer, so they sit among the peaks
    const C = this.vista?.clouds, atlas = C ? makeCumulusAtlas() : null;
    const rand = randomSequence(1101);
    const base = C ? (C.baseM ?? this.route.maxEle + 900) : Math.max(1800, this.route.maxEle + 1100);
    const centers = [], corners = [], sizes = [], cells = [], idx = [];
    for (let i = 0, n = C ? C.count : 26; i < n; i++) {
      const angle = i * 2.399 + rand() * .4, radius = C ? C.minM + rand() * (C.maxM - C.minM) : 9000 + rand() * 7000;
      const c = [Math.cos(angle) * radius, base + rand() * (C ? C.spanM : 900), Math.sin(angle) * radius];
      const w = C ? (900 + rand() * 1400) * radius / 10000 : 2200 + rand() * 2600, h = w * (C ? .5 : .32 + rand() * .12), k = centers.length / 3;
      const cell = atlas ? atlas.cells[Math.floor(rand() * 4)] : [0, 0];
      for (const [u, v] of [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]]) { centers.push(...c); corners.push(u, v); sizes.push(w, h); cells.push(...cell); }
      idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(centers, 3));
    geo.setAttribute('aCorner', new THREE.Float32BufferAttribute(corners, 2));
    geo.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 2));
    geo.setAttribute('aCell', new THREE.Float32BufferAttribute(cells, 2));
    geo.setIndex(idx);
    const material = new THREE.ShaderMaterial({
      uniforms: { map: { value: atlas ? atlas.texture : texture }, color: { value: new THREE.Color('#ffffff') }, opacity: { value: atlas ? .97 : .8 },
        uCellSize: { value: new THREE.Vector2(...(atlas ? atlas.cellSize : [1, 1])) } },
      transparent: true, depthWrite: false, fog: false,
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec2 aCorner; attribute vec2 aSize; attribute vec2 aCell; uniform vec2 uCellSize; varying vec2 vUv;
        void main() {
          vUv = aCell + (aCorner + .5) * uCellSize;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.);
          mvPosition.xy += aCorner * aSize;
          gl_Position = projectionMatrix * mvPosition;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform sampler2D map; uniform vec3 color; uniform float opacity; varying vec2 vUv;
        void main() {
          #include <logdepthbuf_fragment>
          vec4 t = texture2D(map, vUv);
          gl_FragColor = vec4(color * t.rgb, t.a * opacity);
          if (gl_FragColor.a < .005) discard;
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    // `color` mirrors SpriteMaterial's, so night can tint it
    Object.defineProperty(material, 'color', { get: () => material.uniforms.color.value });
    this.clouds = new THREE.Mesh(geo, material); this.clouds.name = 'clouds';
    this.clouds.frustumCulled = false; this.clouds.renderOrder = -1;
    this.group.add(this.clouds);
    if (this.landscape.mountain) this._makePeakClouds(texture);
  }

  // Mountains: cloud caps that hang on the summits and drift through the cirques (weather "clouds" and "rain")
  _makePeakClouds(texture) {
    const T = this.landscape.terrain, rand = randomSequence(2207);
    const end = this.route.turnIdx || this.index.xs.length - 1;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i <= end; i += 20) { minX = Math.min(minX, this.index.xs[i]); maxX = Math.max(maxX, this.index.xs[i]); minZ = Math.min(minZ, this.index.zs[i]); maxZ = Math.max(maxZ, this.index.zs[i]); }
    const peaks = [];
    for (let x = minX - 7000; x <= maxX + 7000; x += 450) for (let z = minZ - 7000; z <= maxZ + 7000; z += 450) {
      const h = T.at(x, z);
      if (h < (this.config.snowLineM || 2250) + 50) continue;
      let top = true;
      for (let k = 0; k < 8 && top; k++) if (T.at(x + Math.cos(k * .785) * 700, z + Math.sin(k * .785) * 700) > h) top = false;
      if (top) peaks.push({ x, z, h });
    }
    // one draw call: camera-facing quads drawn by a small shader (a Sprite per cloud would be one call each)
    const centers = [], corners = [], sizes = [], phases = [], idx = [];
    for (const p of peaks) for (let k = 0; k < 3; k++) {
      const w = 700 + rand() * 900, h = w * (.34 + rand() * .14), cx = p.x + (rand() - .5) * 600, cy = p.h - 120 + rand() * 260, cz = p.z + (rand() - .5) * 600, ph = rand() * 6.28;
      const base = centers.length / 3;
      for (const [u, v] of [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]]) { centers.push(cx, cy, cz); corners.push(u, v); sizes.push(w, h); phases.push(ph); }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(centers, 3));
    geo.setAttribute('aCorner', new THREE.Float32BufferAttribute(corners, 2));
    geo.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 2));
    geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
    geo.setIndex(idx); geo.computeBoundingSphere(); geo.boundingSphere.radius += 1500;
    this.peakUniforms = { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), map: { value: texture }, uTime: this.uniforms.uTime,
      bfOpacity: { value: 0 }, bfColor: { value: new THREE.Color('#f4f5f6') }, bfDrop: { value: 0 } };
    this.peakMaterial = new THREE.ShaderMaterial({
      uniforms: this.peakUniforms, transparent: true, depthWrite: false, fog: true,
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        #include <fog_pars_vertex>
        attribute vec2 aCorner; attribute vec2 aSize; attribute float aPhase; uniform float uTime; uniform float bfDrop; varying vec2 vUv;
        void main() {
          vUv = aCorner + .5;
          vec3 c = position + vec3(sin(uTime * .02 + aPhase) * 120., -bfDrop, cos(uTime * .017 + aPhase) * 90.);
          vec4 mvPosition = modelViewMatrix * vec4(c, 1.);
          mvPosition.xy += aCorner * aSize;
          gl_Position = projectionMatrix * mvPosition;
          #include <logdepthbuf_vertex>
          #include <fog_vertex>
        }`,
      fragmentShader: `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        #include <fog_pars_fragment>
        uniform sampler2D map; uniform float bfOpacity; uniform vec3 bfColor; varying vec2 vUv;
        void main() {
          #include <logdepthbuf_fragment>
          vec4 t = texture2D(map, vUv);
          gl_FragColor = vec4(bfColor * t.rgb, t.a * bfOpacity);
          if (gl_FragColor.a < .01) discard;
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.peakClouds = new THREE.Mesh(geo, this.peakMaterial); this.peakClouds.name = 'peak clouds'; this.peakClouds.visible = false; this.peakClouds.renderOrder = 4;
    this.group.add(this.peakClouds);
  }

  /** Weather: how much cloud hangs on the peaks (0 none, 1 broken caps, >1 low and heavy in the rain). */
  setPeakClouds(amount, rain = 0) {
    if (!this.peakClouds) return;
    this.peakUniforms.bfOpacity.value = Math.min(.92, amount * .75);
    this.peakUniforms.bfColor.value.set(rain > .3 ? '#c9ced2' : '#f4f5f6');
    this.peakClouds.visible = amount > .02;
    this.peakUniforms.bfDrop.value = rain * 160;
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
    const material = makeSeaMaterial(this.landscape, this.uniforms, this.config.palette.water, this.config.palette.shallowWater, shore);
    this.ocean = new THREE.Mesh(new THREE.PlaneGeometry(160000, 160000), material);
    this.ocean.rotation.x = -Math.PI / 2;
    this.ocean.position.y = .05;
    this.ocean.name = 'Sea';
    this.ocean.visible = this.landscape.hasOcean !== false;
    // drawn after the land: with a normal depth buffer the GPU then skips the (costly) water under hills
    this.ocean.renderOrder = 1;
    this.group.add(this.ocean);
    this.lakeMeshes = [];
    if (this.landscape.gridLakes) this._makeGridLakes();
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
      if (!mesh.material.transparent) mesh.renderOrder = 1;   // after the land (see the sea)
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
      if (!mesh.material.transparent) mesh.renderOrder = 1;   // after the land (see the sea)
      this.lakeMeshes.push(mesh); this.group.add(mesh);
      const mist = new THREE.Mesh(geo, this.mistMaterial); mist.position.y = 1.6; mist.name = 'Lake mist'; mist.renderOrder = 2;
      mist.userData = mesh.userData; mist.visible = false;
      (this.mistMeshes ||= []).push(mist); this.group.add(mist);
    }
  }

  // Mountain lakes (build_terrain_grid.py "lakes" mode): water at each lake's own level on the 20 m lake
  // raster, in ~800 m chunks so they cull; the shore distance shades shallows and the far-shore treeline.
  _makeGridLakes() {
    const L = this.landscape.gridLakes, shore = this.landscape.shore, water = this.config.water || {};
    const material = makeLakeWaterMaterial(this.uniforms, this.config.palette.water, water.shallowWater || this.config.palette.shallowWater, this.config.palette.canopy || this.config.palette.forest);
    this.mistOpacity = { value: 0 };
    this.mistMaterial = makeLakeMistMaterial(this.uniforms, this.mistOpacity);
    this.lakeMaterial = material;
    const W = L.nx, H = L.ny, CH = 120;   // ~2.4 km chunks: the lakes are big and flat, few draw calls
    const lakeOf = (k) => L.byId.get(L.ids[k]);
    for (let cj = 0; cj < H - 1; cj += CH) for (let ci = 0; ci < W - 1; ci += CH) {
      const pos = [], sh = [], idx = [], vid = new Map();
      const vert = (i, j, level) => {
        const key = j * W + i;
        if (vid.has(key)) return vid.get(key);
        const x = L.x0 + i * L.dx, z = L.z0 + j * L.dz;
        pos.push(x, level + .12, z); sh.push(shore.sample(x, z) ?? -60);
        vid.set(key, pos.length / 3 - 1); return pos.length / 3 - 1;
      };
      for (let j = cj; j < Math.min(H - 1, cj + CH); j++) for (let i = ci; i < Math.min(W - 1, ci + CH); i++) {
        const k = j * W + i, corners = [k, k + 1, k + W, k + W + 1];
        const lake = corners.map(lakeOf).find(Boolean);
        if (!lake) continue;
        const a = vert(i, j, lake.level), b = vert(i + 1, j, lake.level), c = vert(i, j + 1, lake.level), d = vert(i + 1, j + 1, lake.level);
        idx.push(a, c, b, b, c, d);
      }
      if (!idx.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('aShore', new THREE.Float32BufferAttribute(sh, 1));
      geo.setIndex(idx); geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, material); mesh.name = 'Lake'; mesh.receiveShadow = false;
      mesh.userData.r = geo.boundingSphere.radius; mesh.userData.c = geo.boundingSphere.center;
      if (!mesh.material.transparent) mesh.renderOrder = 1;   // after the land (see the sea)
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

  _makePatch(x, z, size) { return runJob(this._patchJob(x, z, size)); }

  /** A ground patch, built a row at a time (yields between rows so the ride can spread it over frames). */
  *_patchJob(x, z, size) {
    // the finest (96 m) patches: 16 cells (6 m); the scene can ask for finer ground where the road turns back on itself
    const fine = size <= 96 && this.config.groundMesh?.fineCells && this.landscape.fineGroundAt?.(x + 1, z + 1);
    const S = fine ? this.config.groundMesh.fineCells : 16, N = S + 1;
    const positions = [], colors = [], indices = [], normals = [], realH = [], canopy = [], vk = [];
    const vkOn = this._vkAttr();
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
      if (this.landscape.mountain) {
        // Glacier: subalpine meadows, dark conifer forest below the treeline, talus and rock on the steep ground
        const v = this.landscape.vegetationAt(px, pz);
        c.copy(P.meadow).lerp(P.grass, v.moist).lerp(P.forest, v.forest * .92);
        // mapped land cover: hay meadows, ploughed and mown fields, villages, scree (palette keys are optional)
        if (v.lc === 5 && P.farmland) c.lerp(P.farmland, .55 + .3 * vnoise(px / 60, pz / 60));
        else if ((v.lc === 4 || v.lc === 13) && P.hay) c.lerp(P.hay, .45 + .35 * vnoise(px / 45, pz / 45));
        else if (v.lc === 10 && P.village) c.lerp(P.village, .35);
        else if (v.lc === 8 && P.scree) c.lerp(P.scree, .7);
        else if (v.lc === 7 && P.rock) c.lerp(P.rock, .55);
        c.lerp(P.rock, smoothstep(.5, 1.2, rise) * .7);
        c.lerp(P.sand, (1 - smoothstep(4, 22, coastal)) * .8);   // lake shore gravel
        const ice = this.landscape.glacierAt?.(px, pz) || 0;
        if (ice) c.lerp(P.ice || P.snow, ice);
      } else if (this.landscape.real) {
        // Big Sur: golden grass, olive scrub on the shaded faces, dark canyon forest
        const v = this.landscape.vegetationAt(px, pz);
        c.copy(P.meadow).lerp(P.grass, smoothstep(.2, .75, v.scrub) * .9).lerp(P.forest, v.forest * .9);
        c.lerp(P.rock, smoothstep(.55, 1.3, rise) * .8);
        c.lerp(P.cliff, (1 - smoothstep(10, 70, coastal)) * smoothstep(.35, .9, rise) * .7);
        if (P.sand) c.lerp(P.sand, (1 - smoothstep(2.5, 6, y)) * (1 - smoothstep(60, 140, coastal)));
      }
      if (vkOn) {
        // vista kit: how deep the road cut is here (real ground above the pressed ground), and fire scars
        const cut = this.landscape.baseHeight ? Math.max(0, this.landscape.baseHeight(px, pz) - y) : 0;
        const burn = this.landscape.burnAt?.(px, pz) || 0;
        vk.push(this.index.nearest(px, pz, 40) ? cut : 0, burn);
        if (burn) { c.lerp(P.burn || P.rock, burn * .3); }
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
      if (i === S && j % 2) yield;
    }
    // [w2-align] keep the mesh off the streets: lower the bank vertices whose triangles would cover a street's
    // uphill edge (js/world/toolbox/landscape/ground-drape.js), a slice of street points at a time
    if (size <= DRAPE_MAX_PATCH && this.landscape.groundClearPoints) {
      const hs = new Float64Array(N * N);
      for (let k = 0; k < N * N; k++) hs[k] = positions[k * 3 + 1];
      const drape = groundDrape(hs, x, z, size / S, S, (px, pz) => this.heightAt(px, pz), { maxDrop: DRAPE_MAX_DROP, fixed: this.landscape.groundDrapeFixed, last: this.landscape.groundDrapeLast });
      const points = this.landscape.groundClearPoints(x, z, x + size, z + size, Math.max(2, size / S / 3));
      for (let k = 0; k < points.length; k += 120) { drape.add(points.slice(k, k + 120)); yield; }
      const { drop } = drape.apply();
      for (let k = 0; k < N * N; k++) if (drop[k] > 0) {
        positions[k * 3 + 1] = hs[k];
        if (!real) realH[k] = hs[k];
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
        if (vkOn) vk.push(vk[k * 2], vk[k * 2 + 1]);
        colors.push(...colors.slice(k * 3, k * 3 + 3));
      }
      for (let i = 0; i < S; i++) indices.push(base + i, base + N + i, base + i + 1, base + i + 1, base + N + i, base + N + i + 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('aRealH', new THREE.Float32BufferAttribute(realH, 1));
    if (this.forest) geometry.setAttribute('aCanopy', new THREE.Float32BufferAttribute(canopy, 1));
    if (vkOn) geometry.setAttribute('aVk', new THREE.Float32BufferAttribute(vk, 2));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    geometry.attributes.normal.array.set(normals); geometry.computeBoundingSphere();
    // the morph toward real heights moves vertices up or down: keep the culling sphere honest
    let morph = 0;
    for (let k = 0; k < realH.length; k++) morph = Math.max(morph, Math.abs(realH[k] - positions[k * 3 + 1]));
    geometry.boundingSphere.radius += morph + (this.forest ? this.canopyUniform.value.z : 0);
    // an unrendered stand-in (the ground pool draws every patch in one call); QC tools inspect these
    const mesh = new THREE.Mesh(geometry, this.groundMaterial);
    mesh.userData.patch = fine ? { x, z, size, fine } : { x, z, size };
    // the pool's blocks share one vertex layout: finer patches (groundMesh.fineCells) have a pool of their own
    const poolKey = fine ? 'groundPoolFine' : 'groundPool';
    if (!this[poolKey]) {
      const attributes = { position: 3, normal: 3, color: 3, aRealH: 1 };
      if (this.forest) attributes.aCanopy = 1;
      if (vkOn) attributes.aVk = 2;
      this[poolKey] = new GroundBlocks(this.group, this.groundMaterial, { vertices: positions.length / 3, indices: Uint32Array.from(indices), attributes });
    }
    return mesh;
  }

  _makeScatter(cx, cz, detailed = false, coverOnly = false, thin = false) { return runJob(this._scatterJob(cx, cz, detailed, coverOnly, thin)); }

  /**
   * A tile of plants and rocks, built a few dozen candidates at a time. Ground cover uses smaller tiles
   * (COVER_TILE_M) kept within COVER_RANGE_M of the camera; `thin` keeps half of it (the same half at
   * any time, picked by position) for the outer ring, where knee-high plants are a few pixels tall.
   */
  *_scatterJob(cx, cz, detailed = false, coverOnly = false, thin = false) {
    const size = coverOnly ? COVER_TILE_M : 192, rand = randomSequence((cx * 73856093 ^ cz * 19349663) + this.config.seed + (coverOnly ? 7711 : 0));
    const lists = {};
    const onLookout = (x, z) => this.lookoutFootprints.some((l) => {
      const dx = x - l.position.x, dz = z - l.position.z;
      return Math.abs(dx * l.right.x + dz * l.right.z) < l.widthM / 2 + .8
        && Math.abs(dx * l.forward.x + dz * l.forward.z) < l.lengthM / 2 + .8;
    });
    const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), scale = new THREE.Vector3();
    const add = (name, x, y, z, width, height = width) => {
      if (!this.kit.assets[name] && name !== 'shadow') return;
      const turn = rand() * Math.PI * 2;
      if (thin && fract(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) < .5) return;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), turn);
      p.set(x, y, z); scale.set(width, height, width);
      (lists[name] ||= []).push(matrix.compose(p, q, scale).clone());
    };
    const vegetation = this.config.vegetation || {};
    const count = (coverOnly ? this.quality.coverCandidates * (size / 192) ** 2 * (vegetation.coverBoost || 1) : this.quality.candidates) * (vegetation.density || 1);
    const coverScale = vegetation.coverScale || [.75, 1.95];
    for (let k = 0; k < count; k++) {
      if (k % 24 === 23) yield;
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
        if (this.landscape.mountain) {
          // under the forest: ferns and huckleberry; in the meadows: beargrass, paintbrush, glacier lilies
          const v = this.landscape.vegetationAt(x, z), byRoad = this.index.nearest(x, z, 14);
          const cover = this.forest ? this.forest.cover(x, z) : v.forest;
          // an old burn: fireweed in drifts, a little grass
          if ((this.landscape.burnAt?.(x, z) || 0) > .5) { add(pick < .45 ? 'fireweed' : pick < .8 ? 'grass' : 'huckleberry', x, y - .06, z, coverScale[0] + k * (coverScale[1] - coverScale[0])); continue; }
          if (vegetation.rich) {
            // drifts of one flower, grass kinds by zone, a brighter strip along the verge
            const Z = this._coverZones ||= coverZones(vegetation.zones);
            if (cover > .45) { if (k < .45 || byRoad) add(Z.under[k < .5 ? 0 : k < .62 ? 1 : k < .8 ? 2 : 3], x, y - .05, z, coverScale[0] + k * (coverScale[1] - coverScale[0])); continue; }
            const zone = this.landscape.nearCreek?.(x, z, 14) ? 'creek' : v.east > .5 || (Z.dryBelowM && (v.south ?? 0) > .45 && y < Z.dryBelowM) ? 'east' : v.alpine > .45 ? 'alpine' : v.alpine > .1 || v.moist < .55 ? 'subalpine' : 'valley';
            const drift = vnoise(x / 16, z / 16) * .7 + vnoise(x / 5, z / 5) * .3;
            const verge = byRoad && byRoad.d < 11.5 ? .3 : 0;
            if (drift + verge > .6) {
              const list = Z.flowers[zone], cell = vhash(Math.floor(x / 28), Math.floor(z / 28));
              const flower = list[Math.floor(cell * list.length) % list.length];
              add(flower, x, y - .05, z, coverScale[0] + k * (coverScale[1] - coverScale[0]) * .8);
              continue;
            }
            const kind = vnoise(x / 9 + 50, z / 9);
            const grass = pickGrass(Z.grasses[zone === 'creek' ? 'valley' : zone], kind);
            add(grass, x, y - .05, z, .8 + k * .6);
            continue;
          }
          const plant = cover > .45 ? (k < .5 ? 'fern' : k < .62 ? 'huckleberry' : null)
            : v.east > .5 ? (pick < .55 ? 'grass' : pick < .7 ? 'huckleberry' : pick < .8 ? 'paintbrush' : 'sage')
            : v.alpine > .4 ? (pick < .14 ? 'beargrass' : pick < .38 ? 'glacierlily' : pick < .6 ? 'paintbrush' : pick < .8 ? 'alpineflowers' : 'grass')
            : (pick < .12 ? 'beargrass' : pick < .3 ? 'paintbrush' : pick < .52 ? 'alpineflowers' : pick < .7 ? 'huckleberry' : 'grass');
          if (!plant || (cover > .45 && !byRoad && k > .35)) continue;
          add(plant, x, y - .06, z, coverScale[0] + k * (coverScale[1] - coverScale[0]));
          continue;
        }
        // under the forest canopy: sparse ferns only
        if (this.forestLayout && !this.index.nearest(x, z, 14) && (k < .7 || name !== 'fern')) continue;
        add(name, x, y - .09, z, coverScale[0] + k * (coverScale[1] - coverScale[0]));
        continue;
      }
      if (this.landscape.mountain) {
        const v = this.landscape.vegetationAt(x, z);
        if (pick < v.forest * .62 && slope < 1.15) {
          // west-side cedar and hemlock in the valleys, spruce and subalpine fir up high, lodgepole and aspen on the dry east side
          const r = rand();
          const name = v.alpine > .5 ? `fir${r < .7 ? 1 : 0}` : v.east > .5 ? (r < .45 ? `broadleaf${Math.floor(rand() * 2)}` : `pine${Math.floor(rand() * 2)}`) : r < .75 ? `fir${Math.floor(rand() * 2)}` : `pine${Math.floor(rand() * 2)}`;
          const tree = !detailed && this.kit.assets[`${name}-lod`] ? `${name}-lod` : name;
          const tall = (name.startsWith('fir') ? 1.35 + rand() * .75 : .85 + rand() * .45) * (1 - v.alpine * .45);
          add(tree, x, y - .15, z, (.7 + rand() * .5) * (1 - v.alpine * .3), tall);
          if (detailed) add('shadow', x, y + .045, z, 8);
        } else if (pick < .18 + v.scrub * .45) {
          const width = .6 + rand() * 1.1;
          add(rand() < .25 ? 'sage' : `shrub${Math.floor(rand() * 2)}`, x, y - .12, z, width, width * (.7 + v.scrub * .4));
          if (detailed) add('shadow', x, y + .04, z, width * 2.5);
        } else if (slope > .45 && pick < .85 && rand() < .35) add(`rock${Math.floor(rand() * 2)}`, x, y - .3, z, .5 + rand() * 1.3);
        else if (detailed && pick < .92) add(v.alpine > .3 && rand() < .5 ? 'alpineflowers' : 'grass', x, y - .08, z, .8 + rand() * .8);
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
        yield;
        const dx = this.index.xs[i + 1] - x0, dz = this.index.zs[i + 1] - z0, len = Math.hypot(dx, dz) || 1;
        const vergeCount = (this.quality === SCENERY_QUALITY.low ? 28 : this.quality === SCENERY_QUALITY.high ? 132 : 96) * (vegetation.vergeDensity || 1);
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
    // Going-to-the-Sun: dense short grass right beside the road in the near cover tiles (the chase camera
    // looks along the verge), on a jittered ~0.9 m grid from the shoulder out to 12 m
    if (coverOnly && !thin && vegetation.rich && this.landscape.mountain && this.kit.assets.tuft0) {
      const g = .9;
      for (let gx = 0; gx < size / g; gx++) {
        if (gx % 8 === 7) yield;
        for (let gz = 0; gz < size / g; gz++) {
          const x = cx * size + (gx + rand()) * g, z = cz * size + (gz + rand()) * g;
          const road = this.index.nearest(x, z, 12);
          if (!road || road.d < 4.9) { rand(); continue; }
          const y = this.heightAt(x, z);
          if (this.landscape.isWater?.(x, z, y) || this.landscape.creekAt(x, z) || onLookout(x, z) || Math.abs(y - road.ele) > 3.5) { rand(); continue; }
          if ((this.landscape.burnAt?.(x, z) || 0) > .5 && rand() < .5) continue;
          rand(); add('tuft0', x, y - .03, z, .7 + vnoise(x / 4, z / 4) * .8);
        }
      }
    }
    // Going-to-the-Sun: flower drifts in the meadows near the road — patches of one flower, thick in the
    // middle and thinning to the edges, by zone (valley, subalpine, alpine, the dry east side, creeks)
    if (coverOnly && !thin && vegetation.rich && this.landscape.mountain) {
      const g = 1.6;
      for (let gx = 0; gx < size / g; gx++) {
        if (gx % 6 === 5) yield;
        for (let gz = 0; gz < size / g; gz++) {
          const x = cx * size + (gx + rand()) * g, z = cz * size + (gz + rand()) * g, r = rand();
          const drift = vnoise(x / 16, z / 16) * .7 + vnoise(x / 5, z / 5) * .3;
          if (drift < .6 || r > (drift - .6) * 4) continue;
          const road = this.index.nearest(x, z, 45);
          if (!road || road.d < 5.2) continue;
          const v = this.landscape.vegetationAt(x, z);
          if (v.slope > .9 || (this.forest && this.forest.cover(x, z) > .45)) continue;
          const y = this.heightAt(x, z);
          if (this.landscape.isWater?.(x, z, y) || this.landscape.creekAt(x, z) || onLookout(x, z)) continue;
          const zone = (this.landscape.burnAt?.(x, z) || 0) > .5 ? null : this.landscape.nearCreek?.(x, z, 14) ? 'creek' : v.east > .5 ? 'east' : v.alpine > .45 ? 'alpine' : v.alpine > .1 || v.moist < .55 ? 'subalpine' : 'valley';
          const list = zone ? FLOWERS[zone] : ['fireweed'];
          const flower = list[Math.floor(vhash(Math.floor(x / 28), Math.floor(z / 28)) * list.length) % list.length];
          add(this.kit.assets[`${flower}D`] ? `${flower}D` : flower, x, y - .05, z, .85 + r * .5);
        }
      }
    }
    const packed = {};
    for (const [name, matrices] of Object.entries(lists)) {
      let colors = null;
      if (name !== 'shadow') {
        const tint = this.config.biome === 'desert' && /^(rock|outcrop)/.test(name) ? new THREE.Color(this.config.palette.rock) : new THREE.Color(1, 1, 1);
        colors = new Float32Array(matrices.length * 3);
        for (let i = 0; i < matrices.length; i++) { const k = .9 + (i % 5) * .04; colors.set([tint.r * k, tint.g * k, tint.b * k], i * 3); }
      }
      packed[name] = { matrices: packMatrices(matrices), colors };
    }
    // drawn by the instance pools; the group is an unrendered stand-in for QC tools
    return { x: cx * size, z: cz * size, size, detailed, lists: packed, group: proxyGroup(packed, (n) => this._asset(n)) };
  }

  _asset(name) { return name === 'shadow' ? this.shadowAsset : this.kit.assets[name]; }

  /** Shadow flags for a pooled plant: near trees and rocks cast (see the shadow range in SCENERY_QUALITY). */
  _scatterFlags(name, tile) {
    return { cast: !!tile.detailed && /^(cypress|pine|fir|broadleaf|palm|rock|outcrop)/.test(name) && !name.endsWith('-lod'), receive: name !== 'shadow' };
  }

  /**
   * Stream the ground and scenery around (cx, cz). Missing tiles are built nearest first within
   * `budgetMs` (the ride passes a few ms a frame; tools call it without one and get everything at once).
   * Each layer swaps in only once all of its wanted tiles are built, so nothing opens a gap meanwhile.
   */
  update(cx, cz, budgetMs = Infinity) {
    if (!this.groundPool) budgetMs = Infinity;   // nothing on screen yet: build it all now
    const deadline = performance.now() + budgetMs;
    if (Math.hypot(cx - this._lastX, cz - this._lastZ) >= 36) this._plan(cx, cz);
    if (this._want) this._build(deadline);
    this.stats.ready = this.patches.size;
  }

  /** What should be shown around (cx, cz): ground patches (quadtree), scatter, cover and forest tiles. */
  _plan(cx, cz) {
    this._lastX = cx; this._lastZ = cz;
    const want = { at: [cx, cz], patches: new Map(), scatter: new Map(), cover: new Map(), forest: null };
    const visit = (x, z, size) => {
      const d = Math.hypot(Math.max(x - cx, 0, cx - x - size), Math.max(z - cz, 0, cz - z - size));
      if (size > 96 && d < size * 1.15) {
        for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) visit(x + dx * size / 2, z + dz * size / 2, size / 2);
        return;
      }
      want.patches.set(`${x}/${z}/${size}`, { x, z, size, d });
    };
    const size = 1536, ix = Math.floor(cx / size), iz = Math.floor(cz / size);
    const ring = this.farOn ? 2 : 5;   // with the real far terrain on, the stylized ground only needs ~3 km
    for (let x = ix - ring; x <= ix + ring; x++) for (let z = iz - ring; z <= iz + ring; z++) visit(x * size, z * size, size);
    this._cullFar(cx, cz);
    this.clouds.position.set(cx, 0, cz);   // the sky travels with you
    if (this.kit) {
      const sx = Math.floor(cx / 192), sz = Math.floor(cz / 192), range = this.quality.scatterRange;
      want.scatterSquare = [sx, sz, range];
      if (!this.forestLayout) for (let x = sx - range; x <= sx + range; x++) for (let z = sz - range; z <= sz + range; z++) {
        const d = Math.hypot((x + .5) * 192 - cx, (z + .5) * 192 - cz), detailed = d < 260;
        want.scatter.set(`${x}/${z}/${detailed}`, { x, z, detailed, d });
      }
      // ground cover: a circle of small tiles around the camera, full near, thinned in the outer ring
      const T = COVER_TILE_M, tx = Math.floor(cx / T), tz = Math.floor(cz / T), r = Math.ceil(COVER_RANGE_M / T);
      for (let x = tx - r; x <= tx + r; x++) for (let z = tz - r; z <= tz + r; z++) {
        const d = Math.hypot(Math.max(x * T - cx, 0, cx - (x + 1) * T), Math.max(z * T - cz, 0, cz - (z + 1) * T));
        if (d > COVER_RANGE_M) continue;
        const thin = d > COVER_FULL_M;
        want.cover.set(`${x}/${z}/${thin}`, { x, z, d, thin });
      }
      if (this.forestLayout) want.forest = this._planForestTiles(cx, cz);
      want.far = this._planFarTrees(cx, cz);
    }
    want.queue = [];
    for (const layer of ['patches', 'cover', 'scatter', 'forest', 'far']) for (const [key, w] of want[layer] || []) {
      if (!this._built(layer, key, w)) want.queue.push([layer, key, w]);
    }
    want.queue.sort((a, b) => a[2].d - b[2].d);
    want.dirty = new Set(['patches', 'cover', 'scatter', 'forest', 'far']);
    this._want = want;
    this.forestQueue = want.queue.filter((q) => q[0] === 'forest');   // tools wait on this
  }

  _built(layer, key, w) {
    if (layer === 'patches') return this.patches.has(key);
    if (layer === 'scatter') return this.scatter.has(key);
    if (layer === 'cover') return this.cover.has(key);
    if (layer === 'far') return this.farTrees.has(key);
    return this.forestTiles.get(key)?.tier === w.tier;
  }

  _build(deadline) {
    const want = this._want;
    let steps = 0;
    // at least one step a frame, then as many as fit in the budget; a tile can take several frames
    while (want.queue.length && (steps === 0 || performance.now() < deadline)) {
      const item = want.queue[0], [layer, key, w] = item;
      if (this._built(layer, key, w)) { want.queue.shift(); continue; }
      item.job ||= layer === 'patches' ? this._patchJob(w.x, w.z, w.size)
        : layer === 'scatter' ? this._scatterJob(w.x, w.z, w.detailed)
        : layer === 'cover' ? this._scatterJob(w.x, w.z, true, true, w.thin)
        : layer === 'far' ? this._farTreeJob(w.x, w.z)
        : (function* (t) { return t._makeForestTile(w); })(this);
      const step = item.job.next();
      steps++;
      if (!step.done) continue;
      want.queue.shift();
      (layer === 'patches' ? this.patches : layer === 'scatter' ? this.scatter : layer === 'cover' ? this.cover : layer === 'far' ? this.farTrees : this.forestTiles).set(key, step.value);
    }
    if (this.forestQueue) this.forestQueue = want.queue.filter((q) => q[0] === 'forest');
    this.stats.queued = want.queue.length;
    // swap in every layer whose wanted tiles are all built (and drop what is no longer wanted)
    const [cx, cz] = want.at;
    for (const layer of [...want.dirty]) {
      const wanted = want[layer];
      if (!wanted) { want.dirty.delete(layer); continue; }
      if (want.queue.some((q) => q[0] === layer)) continue;
      want.dirty.delete(layer);
      if (layer === 'patches') {
        for (const key of [...this.patches.keys()]) if (!wanted.has(key)) { this.patches.get(key).geometry.dispose(); this.patches.delete(key); }
        const all = [...this.patches].map(([k, m]) => [k, { ...m.userData.patch, geometry: m.geometry }]);
        if (this.groundPool) this.groundPool.set(new Map(all.filter(([, p]) => !p.fine)));
        if (this.groundPoolFine) this.groundPoolFine.set(new Map(all.filter(([, p]) => p.fine)));
      } else {
        const map = layer === 'forest' ? this.forestTiles : layer === 'far' ? this.farTrees : this[layer];
        for (const key of [...map.keys()]) if (!wanted.has(key)) map.delete(key);
        this._pool(layer).set(map.values(), cx, cz);
        // the tree cards step aside where the real trees are (the scatter square around the camera)
        if (layer === 'far' && this.farCards) this.farCards.reach.value = this.farOn ? this.farUniform.value.x - this.farUniform.value.y * .5 - 60 : 1e9;
        if (layer === 'scatter' && this.farCards) {
          const [sx, sz, r] = want.scatterSquare;
          this.farCards.hide.value.set((sx - r) * 192, (sz - r) * 192, (sx + r + 1) * 192, (sz + r + 1) * 192);
        }
      }
    }
  }

  _pool(layer) {
    this.pools ||= {};
    if (!this.pools[layer] && layer === 'far') {
      this.pools.far = new InstancePool(this.group, 'Tree cards', (n) => this._farCardAsset(n), () => ({ cast: false, receive: false }));
    }
    if (!this.pools[layer]) {
      const flags = layer === 'forest'
        ? (name, tile) => ({ cast: tile.tier === 0 && !/^(goldenrod|blueberry|mossmat|branch|stone|juniper|fireweed|beargrass|huckleberry|talus|amoss|abranch|astone|ajuniper|alpenrose|lavender|ascree)/.test(name), receive: tile.tier === 0 })
        : (name, tile) => this._scatterFlags(name, tile);
      this.pools[layer] = new InstancePool(this.group, layer === 'cover' ? 'Ground cover' : layer === 'forest' ? 'Forest' : 'Scenery', (n) => this._asset(n), flags);
    }
    return this.pools[layer];
  }

  // ---- Tree cards: one camera-facing silhouette per tree beyond the real trees (not in forest-canopy scenes) ----
  _planFarTrees(cx, cz) {
    const want = new Map();
    if (this.forestLayout || this.landscape.city || !this.quality.farTreeM) return want;
    // with the real horizon on, stop short of where the ground starts to morph toward it
    const reach = this.farOn ? this.farUniform.value.x - this.farUniform.value.y * .5 - 100 : this.quality.farTreeM;
    const inner = (this.quality.scatterRange + .5) * 192, T = FAR_TREE_TILE_M;
    const tx = Math.floor(cx / T), tz = Math.floor(cz / T), r = Math.ceil(reach / T);
    for (let x = tx - r; x <= tx + r; x++) for (let z = tz - r; z <= tz + r; z++) {
      const near = Math.hypot(Math.max(x * T - cx, 0, cx - (x + 1) * T), Math.max(z * T - cz, 0, cz - (z + 1) * T));
      const far = Math.hypot(Math.max(Math.abs(x * T - cx), Math.abs((x + 1) * T - cx)), Math.max(Math.abs(z * T - cz), Math.abs((z + 1) * T - cz)));
      if (near > reach || far < inner) continue;   // out of reach, or wholly inside the real trees
      want.set(`${x}/${z}/${this.farOn ? 1 : 0}`, { x, z, d: near });
    }
    return want;
  }

  /** A tile of tree cards: the same planting rules as the scatter's trees, at a lower density. */
  *_farTreeJob(tx, tz) {
    const T = FAR_TREE_TILE_M, rand = randomSequence((tx * 19349663 ^ tz * 83492791) + this.config.seed + 4409);
    const vegetation = this.config.vegetation || {}, L = this.landscape;
    const lists = { conifer: [], broadleaf: [] }, colors = { conifer: [], broadleaf: [] };
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    const count = this.quality.candidates * (T / 192) ** 2 * FAR_TREE_DENSITY * (vegetation.density || 1);
    const add = (name, x, y, z, width, tall) => {
      const kind = /^(broadleaf|palm)/.test(name) ? 'broadleaf' : 'conifer', size = this._farCardSize(name);
      if (!size) return;
      p.set(x, y - .3, z); sc.set(size.w * width * 1.1, size.h * width * tall, 1);
      lists[kind].push(m.compose(p, q, sc).clone());
      const c = size.color, k = 1.05 + rand() * .3;   // a touch lighter: flat cards read darker than the lit models
      colors[kind].push(c.r * k, c.g * k, c.b * k);
    };
    for (let k = 0; k < count; k++) {
      if (k % 24 === 23) yield;
      const x = tx * T + rand() * T, z = tz * T + rand() * T, pick = rand(), r1 = rand(), r2 = rand(), r3 = rand();
      const inland = this.inlandAt(x, z), y = this.heightAt(x, z);
      if (inland < 10 || y < 1 || L.isWater?.(x, z, y) || L.creekAt(x, z)) continue;
      if (L.canPlant && !L.canPlant(x, z)) continue;
      const slope = Math.hypot(this.heightAt(x + 6, z) - y, this.heightAt(x, z + 6) - y) / 6;
      if (L.mountain || L.real) {
        const v = L.vegetationAt(x, z);
        if (pick >= v.forest * (L.mountain ? .62 : .5) || slope > 1.1) continue;
        const name = L.mountain ? (v.east > .5 && r1 < .45 ? 'broadleaf0' : 'fir0') : (v.forest > .55 && v.valley > .3 ? 'fir0' : r1 < .6 ? 'broadleaf0' : 'pine0');
        add(name, x, y, z, .75 + r2 * .5, (name.startsWith('fir') ? 1.3 + r3 * .7 : .85 + r3 * .45) * (1 - (v.alpine || 0) * .45));
        continue;
      }
      const grove = .5 + Math.sin(x / 125 + Math.cos(z / 260)) * .32 + Math.sin(z / 180) * .22;
      if (!(grove > (this.config.biome === 'forest' ? .18 : .5) && pick < (vegetation.treeDensity ?? .14) * Math.max(this.config.biome === 'forest' ? .5 : 0, grove)
        && inland > 65 && slope < .8 && y < (vegetation.treelineM || Infinity))) continue;
      const name = vegetation.trees ? vegetation.trees[Math.floor(r1 * vegetation.trees.length)] : inland > 350 && grove > .7 ? 'pine0' : 'cypress0';
      if (name) add(name, x, y, z, .7 + r2 * .55, .8 + r3 * .45);
    }
    const packed = {};
    for (const kind of ['conifer', 'broadleaf']) if (lists[kind].length) packed[kind] = { matrices: packMatrices(lists[kind]), colors: Float32Array.from(colors[kind]) };
    return { x: tx * T, z: tz * T, size: T, lists: packed };
  }

  /** Card width, height and colour for a tree model (from the model's own size and mean vertex colour). */
  _farCardSize(name) {
    this._cardSizes ||= {};
    if (name in this._cardSizes) return this._cardSizes[name];
    const asset = this.kit.assets[`${name}-lod`] || this.kit.assets[name];
    let out = null;
    if (asset) {
      const g = asset.geometry; if (!g.boundingBox) g.computeBoundingBox();
      const b = g.boundingBox, color = new THREE.Color(.2, .3, .2), c = g.attributes.color;
      if (c) {
        // the foliage's colour: the mean of the upper two thirds (leaves, not trunk)
        let r = 0, gg = 0, bb = 0, n = 0;
        const pos = g.attributes.position, cut = b.min.y + (b.max.y - b.min.y) / 3;
        for (let i = 0; i < c.count; i++) if (pos.getY(i) > cut) { r += c.getX(i); gg += c.getY(i); bb += c.getZ(i); n++; }
        if (n) color.setRGB(r / n, gg / n, bb / n);
      }
      out = { w: Math.max(b.max.x - b.min.x, b.max.z - b.min.z), h: b.max.y - Math.max(0, b.min.y), color };
    }
    return (this._cardSizes[name] = out);
  }

  _farCardAsset(kind) {
    if (!this.farCards) this.farCards = makeTreeCards(this.uniforms);
    return this.farCards[kind];
  }

  /** Every streamed tile's stand-in group (for QC tools): scatter, ground cover and forest. */
  streamedGroups() {
    return [...this.scatter.values(), ...this.cover.values(), ...(this.forestTiles?.values() || [])].map((t) => t.group);
  }

  // ---- Forest tiles: wanted tiers by distance ----
  _planForestTiles(cx, cz) {
    const range = this.quality.forestRange, sx = Math.floor(cx / TILE_M), sz = Math.floor(cz / TILE_M);
    const want = new Map();
    for (let x = sx - range; x <= sx + range; x++) for (let z = sz - range; z <= sz + range; z++) {
      const d = Math.hypot((x + .5) * TILE_M - cx, (z + .5) * TILE_M - cz);
      if (d > (range + .6) * TILE_M) continue;
      want.set(`${x}/${z}`, { x, z, d, tier: d < this.quality.nearM ? 0 : d < this.quality.midM ? 1 : 2 });
    }
    return want;
  }

  _makeForestTile(w) {
    const lists = this.forest.tile(w.x, w.z, w.tier), packed = {};
    for (const [name, matrices] of Object.entries(lists)) if (this.kit.assets[name] && matrices.length) packed[name] = { matrices: packMatrices(matrices), colors: null };
    return { x: w.x * TILE_M, z: w.z * TILE_M, size: TILE_M, tier: w.tier, lists: packed, group: proxyGroup(packed, (n) => this._asset(n)) };
  }

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
    for (const mesh of this.patches.values()) mesh.geometry.dispose();
    this.patches.clear();
    this.groundPool?.clear(); this.groundPoolFine?.clear();
    // rebuild now, not next frame: an empty frame would show the sea plane through the missing ground
    const x = this._lastX, z = this._lastZ;
    this._lastX = Infinity;
    if (Number.isFinite(x)) this.update(x, z);
  }

  // Beyond the hand-off, stylized stand-ins (mesas, peaks, lakes) would double up with the real ones.
  _cullFar(cx, cz) {
    this.landmarks?.cullWalls?.(cx, cz);
    this.footprints?.cull(cx, cz);
    this.verge?.cull(cx, cz);
    const limit = this.farUniform.value.x + this.farUniform.value.y * 0.5;
    for (const m of this.landmarkMeshes || []) m.visible = !this.farOn || m.userData.road || Math.hypot(m.position.x - cx, m.position.z - cz) - (m.userData.r || 0) < limit;
    // a scene can stop drawing lakes beyond a distance (lakeReachM: small far tarns cost a call each)
    const lakeReach = this.config.water?.lakeReachM ?? Infinity;
    for (const m of this.lakeMeshes || []) {
      const c = m.userData.c, d = c ? Math.hypot(c.x - cx, c.z - cz) - m.userData.r : Math.hypot(m.position.x - cx, m.position.z - cz) - Math.max(m.scale.x, m.scale.y);
      m.visible = (!this.farOn || d < limit) && d < lakeReach;
    }
    if (this.mistMeshes) for (const m of this.mistMeshes) m.visible = this.mistOpacity.value > 0 && (!this.farOn || Math.hypot(m.userData.c.x - cx, m.userData.c.z - cz) - m.userData.r < limit);
  }

  /**
   * Areas (PLAN 5.4): an area built but not drawn yet streams its ground, plants and city chunks around the
   * camera at a small frame budget, so it is ready when the world swaps to it. Its life doesn't run.
   */
  prepare(cx, cz, budgetMs = 2) {
    const deadline = performance.now() + budgetMs;
    if (Math.hypot(cx - this._lastX, cz - this._lastZ) >= 36) this._plan(cx, cz);
    if (this._want) this._build(deadline);
    this.stats.ready = this.patches.size;
    this.city?._stream(cx, cz, Math.max(.5, deadline - performance.now()));
  }

  /** Every frame (the city's traffic, people and boats move continuously). */
  tick(camera, dt, rider) {
    this.city?.tick(camera, dt, this.uniforms.uTime.value, rider);
    this.traffic?.tick(dt, rider);
    this.life?.tick(dt, camera);
    this.visitors?.tick(dt, camera);
    this.raceDay?.tick(dt, camera);
  }

  setNight(v) {
    this._night = v; this.city?.setNight(v); this.landmarks?.setNight(v); this.traffic?.setNight(v); this.life?.setNight(v);
    this.clouds?.material.color.set(v ? '#3b4157' : '#ffffff');
  }

  heightAt(x, z) { return this.landscape.heightAt(x, z); }
  setQuality(key) {
    this.quality = SCENERY_QUALITY[key] || SCENERY_QUALITY.balanced;
    this.qualityKey = SCENERY_QUALITY[key] ? key : 'balanced';
    this.city?.setQuality(this.qualityKey);
    if (this.forestTiles) { this.forestTiles.clear(); this.forestQueue = []; this._setCanopyStart(); }
    this.scatter.clear(); this.cover.clear(); this.farTrees.clear();
    for (const pool of Object.values(this.pools || {})) pool.clear();
    // rebuild at once at the new detail (no budget), so the scenery doesn't vanish for a few frames
    const x = this._lastX, z = this._lastZ;
    this._lastX = Infinity;
    if (Number.isFinite(x)) this.update(x, z);
  }
  get loadingCount() { return this.stats.loading; }
  dispose() {
    this.disposed = true;
    this.scene.remove(this.group);
    for (const mesh of this.patches.values()) mesh.geometry.dispose();
    this.groundPool?.dispose(); this.groundPoolFine?.dispose();
    for (const pool of Object.values(this.pools || {})) pool.dispose();
    this.farCards?.dispose();
    this.details?.dispose(); this.verge?.dispose(); this.visitors?.dispose();
    this.city?.dispose();
    this.landmarkGeometries.forEach((g) => g.dispose()); this.landmarkGeometries.clear();
    this.surf?.geometry.dispose(); this.surf?.material.dispose(); this.landmarks?.dispose(); this.shoreTexture?.dispose(); this.bridges?.dispose(); this.traffic?.dispose(); this.life?.dispose();
    this.ocean.geometry.dispose(); this.ocean.material.dispose();
    this.lakeMeshes.forEach((m) => m.geometry.dispose());
    this.lakeMaterial?.dispose(); this.mistMaterial?.dispose();
    this.settlement?.dispose(); this.footprints?.dispose(); this.cables?.dispose(); this.dams?.dispose(); this.boards?.dispose(); this.raceDay?.dispose(); this.hairpinWalls?.dispose();
    this.clouds.material.uniforms.map.value.dispose(); this.clouds.material.dispose(); this.clouds.geometry.dispose(); this.peakMaterial?.dispose(); this.peakClouds?.geometry.dispose();
    this.shadowAsset.geometry.dispose(); this.shadowAsset.material.map.dispose(); this.shadowAsset.material.dispose();
    this.roadside.children.forEach((m) => { m.geometry.dispose(); m.dispose(); });
    this.roadside.children[0]?.material.dispose();
    this.groundMaterial.dispose(); this.kit?.dispose();
    this.patches.clear(); this.scatter.clear(); this.cover.clear();
  }
}
