// Toolbox vegetation: the tree engine — one way to draw trees for the whole game (user, 22 Nov 2026: "one tree engine
// for the game"; first used by the rural free-ride maps CNY and SKAN). It follows the methods the research turned up
// (EZ-Tree / three.js TreeGenerator, "fluffy" foliage, instanced LOD forests, impostors):
//   - a kit of trees grown as skeletons (vegetation/upstate-trees.js: curved tapered branches, leaf-cluster cards with
//     spherized normals), each species in variants, near and mid models;
//   - near and mid trees drawn from instanced pools, one per model and tier, re-sorted round the camera as it moves
//     (only the trees in view and in reach: a CPU frustum test per tree, visible ones packed to the front);
//   - beyond the mid tier, impostors: each model photographed from eight sides into one atlas at load (lit as the
//     world is), drawn as camera-facing cards that pick the photo for the side they're seen from — one draw call
//     for every far tree on the map;
//   - stochastic LOD between tiers: each tree swaps at its own distance within a band, so the swaps are spread out
//     (no ring of popping, no dither pattern). The tier materials keep a complementary screen-door fade (uBand) for
//     kits that want a dithered crossfade instead; the rural maps leave it open;
//   - wind in the vertex shader: three sines of rising frequency, scaled by height (tops move most), and a leaf
//     flutter near by; nothing far off.
//
//   const E = new TreeEngine({ renderer, parent, quality, uTime, lights: { hemi, sun }, kit })
//   E.setTile(key, trees)   trees: [{ x, y, z, sp, v, s, rot, tint }]  (sp: species name in kit, v: variant, s: scale)
//   E.removeTile(key); E.tick(camera); E.stats; E.dispose()
import * as THREE from '../../../../vendor/three.module.min.js';
import { decorateTreeMaterial } from '../packs/northern-rockies.js';
import { makeLeafTexture } from './upstate-trees.js';

// m: [near end, mid end] per quality; FADE: the crossfade's half width; IMP_END: where the impostors stop (the
// tiles beyond are released anyway)
const BANDS = { low: [60, 260], balanced: [120, 480], high: [160, 620] };
const FADE = [15, 50];   // m: each tree swaps at its own distance within ± this of the band's edge
const ANGLES = 8;

const WIND_GLSL = /* glsl */`
  uniform vec4 uBand; uniform float uLeaf;
  varying float vKeep0; varying float vKeep1;
  float teLin(float d, float a, float b) { return clamp((d - a) / max(b - a, 1e-3), 0., 1.); }`;
/** A tier's fade (uBand: in start, in end, out start, out end) and the wind, patched into a material. */
function engineMaterial(material, band, uTime, leaf, key) {
  const prev = material.onBeforeCompile, prevKey = material.customProgramCacheKey ? material.customProgramCacheKey() : '';
  const uBand = { value: new THREE.Vector4(...band) };
  material.onBeforeCompile = (shader, r) => {
    prev?.call(material, shader, r);
    shader.uniforms.uTime = uTime; shader.uniforms.uBand = uBand; shader.uniforms.uLeaf = { value: leaf ? 1 : 0 };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${WIND_GLSL}${leaf ? '\nuniform float uTime;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 teO = (modelMatrix * instanceMatrix * vec4(0., 0., 0., 1.)).xyz;
          float teD = length(teO.xz - cameraPosition.xz);
          vKeep0 = teLin(teD, uBand.x, uBand.y);           // fading in
          vKeep1 = 1. - teLin(teD, uBand.z, uBand.w);      // fading out
          // wind: three sines, rising in frequency, the tops moving most (height² over the model's ~20 m)
          float hk = clamp(position.y / 20., 0., 1.4); hk *= hk;
          float ph = teO.x * .05 + teO.z * .043;
          float sw = sin(uTime * 1.1 + ph) * .6 + sin(uTime * 2.3 + ph * 1.7) * .3 + sin(uTime * 4.7 + ph * 2.9 + position.x) * .1;
          transformed.x += sw * .22 * hk; transformed.z += sw * .12 * hk;
          if (uLeaf > .5 && teD < 160.) transformed += normal * sin(uTime * 9. + position.x * 3.1 + position.z * 2.7 + position.y) * .05 * (1. - teD / 160.);
        }`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vKeep0; varying float vKeep1;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        {
          // complementary screen-door dither: the tier fading in keeps where the one fading out drops
          float teDz = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))));
          if (vKeep0 <= 1. - teDz || vKeep1 <= teDz) discard;
        }`);
  };
  material.customProgramCacheKey = () => `${prevKey}|tree-engine-1-${key}`;
  material.userData.band = uBand;
  return material;
}

/**
 * The leaf-cluster cards' material: the leaf texture alpha-tested, two-sided. Its alpha is scaled up with the mip
 * level (as the far tree cards do), so a far cluster keeps its fill instead of thinning to a speckle of dots.
 */
function leafMaterial(map) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, map, alphaTest: .45, side: THREE.DoubleSide, roughness: .9 });
  const size = map.image?.width || 512;
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', `
      #ifdef USE_MAP
        vec2 teTx = vMapUv * ${size.toFixed(1)};
        float teLod = max(0., .5 * log2(max(dot(dFdx(teTx), dFdx(teTx)), dot(dFdy(teTx), dFdy(teTx)))));
        diffuseColor.a = min(1., diffuseColor.a * (1. + teLod * .35));
      #endif
      #include <alphatest_fragment>`);
  };
  m.customProgramCacheKey = () => `tree-engine-leaf-${size}`;
  return m;
}

export class TreeEngine {
  constructor({ renderer, parent, quality = 'balanced', uTime, lights, kit }) {
    this.renderer = renderer; this.parent = parent; this.uTime = uTime; this.kit = kit;
    const [b0, b1] = BANDS[quality] || BANDS.balanced;
    this.b0 = b0; this.b1 = b1;
    this.group = new THREE.Group(); this.group.name = 'Trees (tree engine)'; parent.add(this.group);
    this.leafTexture = makeLeafTexture(quality === 'low' ? 256 : 512);
    // materials: per tier, wood and leaves; the near tier also for the understory (fading out at the near end)
    const wood = (band, key) => engineMaterial(decorateTreeMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95 }), { uTime }), band, uTime, false, key);
    const leaves = (band, key) => engineMaterial(leafMaterial(this.leafTexture), band, uTime, true, key);
    const near = [-2, -1, 1e8, 1e9], mid = [-2, -1, 1e8, 1e9];   // (the swaps are per tree: see tick)
    this.mats = [{ wood: wood(near, 'w0'), leaves: leaves(near, 'l0') }, { wood: wood(mid, 'w1'), leaves: leaves(mid, 'l1') }];
    // the models: every (species, variant) an entry; the understory near-only entries
    this.entries = []; this.index = new Map();
    for (const [name, sp] of Object.entries(kit.species)) sp.variants.forEach((tiers, v) => this._entry(`${name}:${v}`, [tiers[0], tiers[1]], false));
    for (const [name, g] of Object.entries(kit.understory)) this._entry(`${name}:0`, [g.isBufferGeometry ? { wood: g, leaves: null } : g], true);
    this.tiles = new Map();
    this._impostors(lights, quality);
    this.stats = { near: 0, mid: 0, far: 0 };
    this._at = null; this._dir = new THREE.Vector3();
    this._frustum = new THREE.Frustum(); this._m = new THREE.Matrix4(); this._sphere = new THREE.Sphere();
  }

  _entry(key, tiers, nearOnly) {
    const e = { key, nearOnly, pools: [], box: null };
    tiers.forEach((t, tier) => {
      if (!t) return;
      const parts = [];
      for (const [part, geo] of [['wood', t.wood], ['leaves', t.leaves]]) {
        if (!geo) continue;
        const im = new THREE.InstancedMesh(geo, this.mats[tier][part], 16);
        im.count = 0; im.visible = false; im.frustumCulled = false; im.name = `Trees ${key} ${part} ${tier ? 'mid' : 'near'}`;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.setColorAt(0, new THREE.Color(1, 1, 1));
        this.group.add(im); parts.push(im);
      }
      e.pools[tier] = parts;
      if (tier === 0) { const b = new THREE.Box3(); for (const g of [t.wood, t.leaves]) if (g) { g.computeBoundingBox(); b.union(g.boundingBox); } e.box = b; }
    });
    e.i = this.entries.length; this.entries.push(e); this.index.set(key, e);
  }

  // ------------------------------------------------------------------ impostors
  /** Photograph every tree entry from ANGLES sides (lit as the world) into one atlas: a row per entry. */
  _impostors(lights, quality) {
    const list = this.entries.filter((e) => !e.nearOnly), cell = quality === 'low' ? 64 : 128;
    const W = cell * ANGLES, H = cell * list.length;
    const rt = new THREE.WebGLRenderTarget(W, H, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, samples: 0 });
    const scene = new THREE.Scene();
    const hemi = new THREE.HemisphereLight(lights?.hemi?.color || 0xffffff, lights?.hemi?.groundColor || 0x666655, lights?.hemi?.intensity ?? 1.2);
    const sun = new THREE.DirectionalLight(lights?.sun?.color || 0xffffff, lights?.sun?.intensity ?? 1.6);
    scene.add(hemi, sun, sun.target);
    const sunDir = lights?.sun ? lights.sun.position.clone().sub(lights.sun.target.position).normalize() : new THREE.Vector3(.3, .8, .4).normalize();
    const woodM = decorateTreeMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95 }), { uTime: { value: 0 } });
    const leafM = leafMaterial(this.leafTexture);
    const r = this.renderer, prev = { target: r.getRenderTarget(), autoClear: r.autoClear, color: r.getClearColor(new THREE.Color()), alpha: r.getClearAlpha(), scissor: r.getScissorTest() };
    r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.clear(); r.autoClear = false; r.setScissorTest(true);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, 0, .1, 400);
    list.forEach((e, row) => {
      const t = e.pools[0], g = [], b = e.box, half = Math.max(-b.min.x, b.max.x, -b.min.z, b.max.z) * 1.02, top = b.max.y * 1.01;
      for (const im of t) { const m = new THREE.Mesh(im.geometry, im.material.map ? leafM : woodM); g.push(m); scene.add(m); }
      e.imp = { row, half, top };
      cam.left = -half; cam.right = half; cam.top = top; cam.bottom = 0; cam.updateProjectionMatrix();
      for (let k = 0; k < ANGLES; k++) {
        const a = k / ANGLES * Math.PI * 2, D = 200;
        cam.position.set(Math.sin(a) * D, 0, Math.cos(a) * D); cam.lookAt(0, 0, 0);
        // the light keeps its place in the world: the tree turns, not the sun (one angle's photo is one side lit)
        sun.position.copy(sunDir).multiplyScalar(100);
        r.setViewport(k * cell, row * cell, cell, cell); r.setScissor(k * cell, row * cell, cell, cell);
        r.render(scene, cam);
      }
      for (const m of g) scene.remove(m);
    });
    r.setScissorTest(prev.scissor); r.autoClear = prev.autoClear; r.setClearColor(prev.color, prev.alpha); r.setRenderTarget(prev.target);
    const sz = new THREE.Vector2(); r.getSize(sz); r.setViewport(0, 0, sz.x, sz.y);
    woodM.dispose(); leafM.dispose();
    this.atlas = rt; this.rows = list.length;
    // the card: a unit quad standing on its base, turned to the camera about its vertical axis in the shader
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-.5, 0, 0, .5, 0, 0, .5, 1, 0, -.5, 1, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.impGeo = geo; this.impCap = 0;
    const [b0, b1] = [this.b0, this.b1];
    this.impMat = new THREE.ShaderMaterial({
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uAtlas: { value: rt.texture }, uRows: { value: this.rows }, uBand: { value: new THREE.Vector2(b1 - FADE[1], b1 + FADE[1]) } }]),
      vertexShader: /* glsl */`
        attribute vec4 iA; attribute vec4 iB;   // iA: x, y, z, rotation; iB: width, height, row, tint
        uniform float uRows; uniform vec2 uBand;
        varying vec2 vUv; varying float vKeep; varying float vTint;
        #include <fog_pars_vertex>
        void main() {
          vec3 o = iA.xyz; vec2 to = o.xz - cameraPosition.xz; float d = length(to);
          float j = fract(fract(iA.w * 7.31) + 1.);
          vKeep = 1.;
          if (d < mix(uBand.x, uBand.y, j) || iB.x <= 0.) { gl_Position = vec4(2., 2., 2., 1.); return; }
          vec2 dir = to / max(d, 1e-3);
          vec3 right = normalize(vec3(-dir.y, 0., dir.x));
          // the side it's seen from, in the tree's own frame (its rotation about y), → one of the photos
          float cr = cos(iA.w), sr = sin(iA.w);
          vec2 vl = vec2(-dir.x * cr + dir.y * sr, -dir.x * sr - dir.y * cr);
          float a = atan(vl.x, vl.y); if (a < 0.) a += 6.2831853;
          float frame = mod(floor(a / 6.2831853 * ${ANGLES}. + .5), ${ANGLES}.);
          vUv = vec2((frame + uv.x) / ${ANGLES}., (iB.z + uv.y) / uRows);
          vTint = iB.w;
          vec3 p = o + right * position.x * iB.x + vec3(0., position.y * iB.y, 0.);
          vec4 mvPosition = viewMatrix * vec4(p, 1.);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uAtlas; varying vec2 vUv; varying float vKeep; varying float vTint;
        #include <common>
        #include <fog_pars_fragment>
        void main() {
          vec4 c = texture2D(uAtlas, vUv);
          if (c.a < .5) discard;
          gl_FragColor = vec4(c.rgb / max(c.a, 1e-3) * vTint, 1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.impMat.customProgramCacheKey = () => 'tree-engine-impostor-1';
    this.impMesh = new THREE.Mesh(geo, this.impMat);
    this.impMesh.frustumCulled = false; this.impMesh.name = 'Trees (impostors)';
    this.group.add(this.impMesh);
  }
  /** Rebuild the impostors' instance data from every tile's trees (on tile changes only: the data is static). */
  _rebuildImpostors() {
    let n = 0; for (const t of this.tiles.values()) n += t.length;
    if (n > this.impCap) {
      this.impCap = Math.ceil(n * 1.3);
      this.iA = new Float32Array(this.impCap * 4); this.iB = new Float32Array(this.impCap * 4);
      this.impGeo.setAttribute('iA', new THREE.InstancedBufferAttribute(this.iA, 4)); this.impGeo.setAttribute('iB', new THREE.InstancedBufferAttribute(this.iB, 4));
    }
    let k = 0;
    for (const list of this.tiles.values()) for (const t of list) {
      const e = t.e; if (!e.imp) continue;
      this.iA.set([t.x, t.y, t.z, t.rot], k * 4); this.iB.set([e.imp.half * 2 * t.s, e.imp.top * t.sy, e.imp.row, t.tint], k * 4); k++;
    }
    this.impGeo.instanceCount = k;
    this.impGeo.attributes.iA.needsUpdate = true; this.impGeo.attributes.iB.needsUpdate = true;
    this.stats.far = k;
  }

  // ------------------------------------------------------------------ tiles
  setTile(key, trees) {
    const list = [];
    for (const t of trees) {
      const e = this.index.get(`${t.sp}:${t.v || 0}`); if (!e) continue;
      const j = ((t.rot * 7.31) % 1 + 1) % 1;
      list.push({ ...t, e, j0: (j - .5) * 2 * FADE[0], j1: (j - .5) * 2 * FADE[1], sy: t.sy ?? t.s, tint: t.tint ?? 1, r: Math.max(e.box.max.x - e.box.min.x, e.box.max.z - e.box.min.z) * .5 * t.s, h: e.box.max.y * (t.sy ?? t.s) });
    }
    this.tiles.set(key, list);
    this._dirty = true; this._at = null;
  }
  removeTile(key) { if (this.tiles.delete(key)) { this._dirty = true; this._at = null; } }

  /** Re-sort the trees round the camera when it has moved ~12 m or turned ~6°; impostors when tiles changed. */
  tick(camera) {
    if (this._dirty) { this._dirty = false; this._rebuildImpostors(); }
    camera.getWorldDirection(this._dir);
    if (this._at && this._at.distanceTo(camera.position) < 12 && this._dir.dot(this._lastDir) > .995) return;
    this._at = camera.position.clone(); this._lastDir = this._dir.clone();
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); this._frustum.setFromProjectionMatrix(this._m);
    const reach = this.b1 + FADE[1], b0 = this.b0, cx = camera.position.x, cz = camera.position.z;
    const lists = this.entries.map(() => [[], []]);
    let near = 0, mid = 0;
    for (const list of this.tiles.values()) {
      for (const t of list) {
        const d = Math.hypot(t.x - cx, t.z - cz);
        if (d > reach) continue;
        // in view (with a margin), or right beside the camera
        if (d > 25) { this._sphere.center.set(t.x, t.y + t.h * .5, t.z); this._sphere.radius = Math.max(t.r, t.h * .6) + 2; if (!this._frustum.intersectsSphere(this._sphere)) continue; }
        const L = lists[t.e.i];
        // each tree swaps at its own distance within the band (stochastic LOD: the swaps are spread out, so no ring
        // of popping and no dither pattern), the same distances the impostor shader uses
        if (d < b0 + t.j0) { L[0].push(t); near++; }
        else if (!t.e.nearOnly && d < this.b1 + t.j1) { L[1].push(t); mid++; }
      }
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
    this.entries.forEach((e, i) => lists[i].forEach((list, tier) => {
      for (let pi = 0; pi < (e.pools[tier] || []).length; pi++) {
        let im = e.pools[tier][pi];
        if (list.length > im.instanceMatrix.count) {
          const nim = new THREE.InstancedMesh(im.geometry, im.material, Math.ceil(list.length * 1.5));
          nim.name = im.name; nim.frustumCulled = false; nim.instanceMatrix.setUsage(THREE.DynamicDrawUsage); nim.setColorAt(0, c.set(1, 1, 1));
          this.group.remove(im); im.dispose(); this.group.add(nim); e.pools[tier][pi] = im = nim;
        }
        list.forEach((t, k) => { q.setFromAxisAngle(Y, t.rot); p.set(t.x, t.y, t.z); s.set(t.s, t.sy, t.s); im.setMatrixAt(k, m.compose(p, q, s)); im.setColorAt(k, c.setScalar(t.tint)); });
        im.count = list.length; im.visible = list.length > 0;
        im.instanceMatrix.clearUpdateRanges(); im.instanceMatrix.addUpdateRange(0, list.length * 16); im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) { im.instanceColor.clearUpdateRanges(); im.instanceColor.addUpdateRange(0, list.length * 3); im.instanceColor.needsUpdate = true; }
      }
    }));
    this.stats.near = near; this.stats.mid = mid;
  }

  dispose() {
    this.group.removeFromParent();
    for (const e of this.entries) for (const tier of e.pools) for (const im of tier || []) im.dispose();
    for (const t of this.mats) { t.wood.dispose(); t.leaves.dispose(); }
    this.impGeo.dispose(); this.impMat.dispose(); this.atlas.dispose(); this.leafTexture.dispose();
  }
}
