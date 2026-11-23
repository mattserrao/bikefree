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
//   - LOD without pop-in (user, 22 Nov: "pop-in for trees is distracting"): each tree crosses from tier to tier at
//     its own distance (a jitter from its position, so the swaps are spread out, no ring; a few metres of hysteresis,
//     so a rider stopped at the line doesn't flicker), and when it crosses it dissolves into the other tier over
//     0.6 s — both drawn together with complementary screen-door dither, timed per tree (an instanced attribute:
//     when it swapped, which way), so only the trees that have just swapped are ever dithered. The frustum test has
//     a margin (a turn doesn't uncover gaps); a new tile's impostors dissolve in over a second and a half;
//   - wind in the vertex shader: three sines of rising frequency, scaled by height (tops move most), and a leaf
//     flutter near by; nothing far off.
//
//   const E = new TreeEngine({ renderer, parent, quality, uTime, lights: { hemi, sun }, kit })
//   E.setTile(key, trees)   trees: [{ x, y, z, sp, v, s, rot, tint, deep }]  (sp: species name in kit, v: variant, s: scale;
//                           deep: > 30 m from any road — the cards take it sooner)
//   E.removeTile(key); E.tick(camera); E.stats; E.dispose()
import * as THREE from '../../../../vendor/three.module.min.js';
import { decorateTreeMaterial } from '../packs/northern-rockies.js';
import { makeLeafTexture } from './upstate-trees.js';

// m: [near end, mid end] per quality; FADE: the crossfade's half width; IMP_END: where the impostors stop (the
// tiles beyond are released anyway)
// (user, 23 Nov: "trees can effectively be 2D" — a rider on a fixed road sees the woods past ~100 m from one side only:
//  the photographed cards take over much sooner than they did (480 m), and a tree deep in the woods, away from every
//  road, sooner still: DEEP of each band)
const BANDS = { low: [55, 150], balanced: [100, 210], high: [130, 280] };
const DEEP = [.55, .6];  // band scale for a tree > 30 m from any road (t.deep): seen only through the trees in front
const FADE = [15, 50];   // m: each tree swaps at its own distance within ± this of the band's edge
const HYST = 3;          // m: hysteresis at each band's edge
const FT = .6;           // s: a swap's dissolve
const STEP = 2.5;        // m: the camera moves this far between re-sorts (or turns ~3.5°)
/** A tree's swap jitter (0–1) from its position — the same in the shaders (teJ). */
// (a hash of the position on a 25 cm grid, small numbers only: the GPU's float maths gives the same answer for the
// instanced trees, whose position comes out of their matrices, and the impostors, whose position is an attribute)
const fr = (v) => v - Math.floor(v);
export const treeJitter = (x, z) => {
  const qx = Math.floor(x * 4 + .5), qz = Math.floor(z * 4 + .5);
  let a = fr(qx * .1031), b = fr(qz * .1031), c = fr(qx * .1031);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33); a += d; b += d; c += d;
  return fr((a + b) * c);
};
const ANGLES = 12;   // photos round each tree (cross-blended in the card: no snap as the angle changes)

const WIND_GLSL = /* glsl */`
  uniform float uLeaf;
  attribute vec2 aFade;   // (instanced) when this tree swapped tier (the world clock), and 1 steady / 2 fading in / 3 fading out
  varying float vKeep0; varying float vKeep1;
  float teLin(float d, float a, float b) { return clamp((d - a) / max(b - a, 1e-3), 0., 1.); }
  float teJ(vec2 p) { vec2 q = floor(p * 4. + .5); vec3 p3 = fract(vec3(q.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }`;
/** A tier's swap dissolve (per tree: aFade) and the wind, patched into a material. */
function engineMaterial(material, uTime, leaf, key) {
  const prev = material.onBeforeCompile, prevKey = material.customProgramCacheKey ? material.customProgramCacheKey() : '';
  material.onBeforeCompile = (shader, r) => {
    prev?.call(material, shader, r);
    shader.uniforms.uTime = uTime; shader.uniforms.uLeaf = { value: leaf ? 1 : 0 };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${WIND_GLSL}${leaf || !/uniform float uTime/.test(shader.vertexShader) ? '\nuniform float uTime;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
          vec3 teO = (modelMatrix * instanceMatrix * vec4(0., 0., 0., 1.)).xyz;
          #else
          vec3 teO = (modelMatrix * vec4(0., 0., 0., 1.)).xyz;
          #endif
          float teD = length(teO.xz - cameraPosition.xz);
          vKeep0 = 1.; vKeep1 = 1.;
          #ifdef USE_INSTANCING
          float teK = clamp((uTime - aFade.x) / ${FT.toFixed(2)}, 0., 1.);
          if (aFade.y > 2.5) vKeep1 = 1. - teK; else if (aFade.y > 1.5) vKeep0 = teK;   // dissolving out / in
          #endif
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
  material.customProgramCacheKey = () => `${prevKey}|tree-engine-4-${key}`;
  return material;
}

/**
 * The leaf-cluster cards' material: the leaf texture alpha-tested, two-sided. Its alpha is scaled up with the mip
 * level (as the far tree cards do), so a far cluster keeps its fill instead of thinning to a speckle of dots.
 */
/** The per-instance swap attribute (aFade) on a pool's geometry, sized to its instances. */
function fadeAttr(im, n) {
  const g = im.geometry, a = g.attributes.aFade;
  if (a && a.count >= n) return;
  const at = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2); at.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aFade', at);
}

/** A copy of a kit's own material to wrap per tier (its shader hooks kept), remembering the original (the
 *  impostor photos use the original: no fade). */
function ownCopy(m) {
  const c = m.clone();
  c.onBeforeCompile = m.onBeforeCompile; if (m.customProgramCacheKey) c.customProgramCacheKey = m.customProgramCacheKey;
  c.userData.orig = m;
  return c;
}

function leafMaterial(map) {
  // alpha to coverage: under MSAA the cut-out edges get the multisample's soft coverage, not a stair-stepped cut (free
  // with MSAA on; a plain alpha test without it)
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, map, alphaTest: .45, alphaToCoverage: true, side: THREE.DoubleSide, roughness: .9 });
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
  constructor({ renderer, parent, quality = 'balanced', uTime, lights, kit, shadows = false }) {
    this.renderer = renderer; this.shadows = shadows; this.parent = parent; this.uTime = uTime; this.kit = kit;
    const [b0, b1] = BANDS[quality] || BANDS.balanced;
    this.b0 = b0; this.b1 = b1;
    this.group = new THREE.Group(); this.group.name = 'Trees (tree engine)'; parent.add(this.group);
    this.leafTexture = makeLeafTexture(quality === 'low' ? 256 : 512);
    // materials: per tier, wood and leaves; the near tier also for the understory (fading out at the near end)
    const wood = (key) => engineMaterial(decorateTreeMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95 }), { uTime }), uTime, false, key);
    const leaves = (key) => engineMaterial(leafMaterial(this.leafTexture), uTime, true, key);
    this.mats = [{ wood: wood('w0'), leaves: leaves('l0') }, { wood: wood('w1'), leaves: leaves('l1') }];
    // the models: every (species, variant) an entry; the understory near-only entries
    this.entries = []; this.index = new Map(); this._own = new Map();
    for (const [name, sp] of Object.entries(kit.species)) sp.variants.forEach((tiers, v) => this._entry(`${name}:${v}`, [tiers[0], tiers[1]], false));
    for (const [name, g] of Object.entries(kit.understory)) this._entry(`${name}:0`, [g.isBufferGeometry ? { wood: g, leaves: null } : g], true);
    this.tiles = new Map(); this._born = new Map();
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
        // a kit can bring its own material (a scene pack's tuned look): wrapped once with the engine's wind
        let mat = this.mats[tier][part];
        if (part === 'wood' && t.material) {
          // a kit's own material: wrapped once (a copy: the original stays as the kit made it, for the impostor photos)
          mat = this._own.get(t.material.uuid); if (!mat) this._own.set(t.material.uuid, (mat = engineMaterial(ownCopy(t.material), this.uTime, false, `own${this._own.size}`)));
        }
        const im = new THREE.InstancedMesh(geo, mat, 16);
        im.count = 0; im.visible = false; im.frustumCulled = false; im.name = `Trees ${key} ${part} ${tier ? 'mid' : 'near'}`;
        im.castShadow = this.shadows && tier === 0 && !nearOnly; im.receiveShadow = this.shadows;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.setColorAt(0, new THREE.Color(1, 1, 1));
        fadeAttr(im, 16);
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
    const list = this.entries.filter((e) => !e.nearOnly), cell = quality === 'low' ? 64 : quality === 'high' ? 160 : 128;
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
      for (const im of t) { const m = new THREE.Mesh(im.geometry, im.material.map ? leafM : im.material.userData.orig || woodM); g.push(m); scene.add(m); }
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
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uAtlas: { value: rt.texture }, uRows: { value: this.rows }, uNow: { value: 0 } }]),
      vertexShader: /* glsl */`
        attribute vec4 iA; attribute vec4 iB; attribute float iT; attribute vec2 iS;   // iA: x, y, z, rotation; iB: width, height, row, tint; iT: when its tile came; iS: its swap (when, 0 hidden / 1 shown / 2 in / 3 out)
        uniform float uRows; uniform float uNow;
        varying vec2 vUv; varying vec2 vUv2; varying float vBlend; varying float vKeep; varying float vOut; varying float vTint;
        #include <fog_pars_vertex>
        void main() {
          vec3 o = iA.xyz; vec2 to = o.xz - cameraPosition.xz; float d = length(to);
          // shown when the engine says (iS: the tree's tier), dissolving in or out as it swaps with the mid tier, and
          // in over 1.5 s after its tile comes
          float k = clamp((uNow - iS.x) / ${FT.toFixed(2)}, 0., 1.);
          vOut = iS.y > 2.5 ? 1. : 0.;
          vKeep = (iS.y > 2.5 ? 1. - k : iS.y > 1.5 ? k : 1.) * clamp((uNow - iT) / 1.5, 0., 1.);
          if (iS.y < .5 || vKeep <= 0. || iB.x <= 0.) { gl_Position = vec4(2., 2., 2., 1.); return; }
          vec2 dir = to / max(d, 1e-3);
          vec3 right = normalize(vec3(-dir.y, 0., dir.x));
          // the side it's seen from, in the tree's own frame (its rotation about y), → one of the photos
          float cr = cos(iA.w), sr = sin(iA.w);
          vec2 vl = vec2(-dir.x * cr + dir.y * sr, -dir.x * sr - dir.y * cr);
          float a = atan(vl.x, vl.y); if (a < 0.) a += 6.2831853;
          // the two photos either side of the view, and how far between (the card blends them)
          float fa = a / 6.2831853 * ${ANGLES}., f0 = mod(floor(fa), ${ANGLES}.), f1 = mod(f0 + 1., ${ANGLES}.);
          vBlend = fract(fa);
          vUv = vec2((f0 + uv.x) / ${ANGLES}., (iB.z + uv.y) / uRows);
          vUv2 = vec2((f1 + uv.x) / ${ANGLES}., (iB.z + uv.y) / uRows);
          vTint = iB.w;
          vec3 p = o + right * position.x * iB.x + vec3(0., position.y * iB.y, 0.);
          vec4 mvPosition = viewMatrix * vec4(p, 1.);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uAtlas; varying vec2 vUv; varying vec2 vUv2; varying float vBlend; varying float vKeep; varying float vOut; varying float vTint;
        #include <common>
        #include <fog_pars_fragment>
        void main() {
          vec4 c0 = texture2D(uAtlas, vUv), c1 = texture2D(uAtlas, vUv2), c = mix(c0, c1, vBlend);
          // the edge's coverage over about a pixel (alpha to coverage under MSAA: soft silhouettes, no sorting)
          float cov = clamp((c.a - .5) / max(fwidth(c.a), 1e-4) + .5, 0., 1.);
          if (cov <= 0.) discard;
          float teDz = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))));
          if (vOut > .5 ? vKeep <= teDz : vKeep <= 1. - teDz) discard;   // the complement of the mid tier's dissolve
          gl_FragColor = vec4(c.rgb / max(c.a, 1e-3) * vTint, cov);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    // (the atlas after the merge: UniformsUtils.merge won't clone a render target's texture — it set uAtlas to null,
    //  and the impostors drew nothing: every tree past the mid band was missing)
    this.impMat.uniforms.uAtlas.value = rt.texture;
    this.impMat.alphaToCoverage = true;
    this.impMat.customProgramCacheKey = () => 'tree-engine-impostor-5';
    this.impMesh = new THREE.Mesh(geo, this.impMat);
    this.impMesh.frustumCulled = false; this.impMesh.name = 'Trees (impostors)';
    this.group.add(this.impMesh);
  }
  /** Rebuild the impostors' instance data from every tile's trees (on tile changes only: the data is static). */
  _rebuildImpostors() {
    let n = 0; for (const t of this.tiles.values()) n += t.length;
    if (n > this.impCap) {
      this.impCap = Math.ceil(n * 1.3);
      this.iA = new Float32Array(this.impCap * 4); this.iB = new Float32Array(this.impCap * 4); this.iT = new Float32Array(this.impCap); this.iS = new Float32Array(this.impCap * 2);
      this.impGeo.setAttribute('iA', new THREE.InstancedBufferAttribute(this.iA, 4)); this.impGeo.setAttribute('iB', new THREE.InstancedBufferAttribute(this.iB, 4)); this.impGeo.setAttribute('iT', new THREE.InstancedBufferAttribute(this.iT, 1));
      this.impGeo.setAttribute('iS', new THREE.InstancedBufferAttribute(this.iS, 2)); this.impGeo.attributes.iS.setUsage(THREE.DynamicDrawUsage);
    }
    let k = 0;
    for (const [key, list] of this.tiles) {
      const born = this._born.get(key) ?? -99;
      for (const t of list) {
        const e = t.e; if (!e.imp) continue;
        this.iA.set([t.x, t.y, t.z, t.rot], k * 4); this.iB.set([e.imp.half * 2 * t.s, e.imp.top * t.sy, e.imp.row, t.tint], k * 4); this.iT[k] = born;
        this.iS[k * 2] = t.ts ?? -1e9; this.iS[k * 2 + 1] = t.tier === 2 ? 1 : 0; t.ik = k; k++;
      }
    }
    this.impGeo.instanceCount = k;
    this.impGeo.attributes.iA.needsUpdate = true; this.impGeo.attributes.iB.needsUpdate = true; this.impGeo.attributes.iT.needsUpdate = true; this.impGeo.attributes.iS.needsUpdate = true;
    this._at = null;   // (the tiers: a re-sort now)
    this.stats.far = k;
  }

  // ------------------------------------------------------------------ tiles
  setTile(key, trees) {
    const list = [];
    for (const t of trees) {
      const e = this.index.get(`${t.sp}:${t.v || 0}`); if (!e) continue;
      const j = treeJitter(t.x, t.z);
      list.push({ ...t, e, ik: -1, j0: (j - .5) * 2 * FADE[0], j1: (j - .5) * 2 * FADE[1], sy: t.sy ?? t.s, tint: t.tint ?? 1, r: Math.max(e.box.max.x - e.box.min.x, e.box.max.z - e.box.min.z) * .5 * t.s, h: e.box.max.y * (t.sy ?? t.s) });
    }
    // a tile that comes while the ride is under way dissolves in (its impostors; the first tiles are there at once)
    this._born.set(key, this._started && this.uTime.value > 3 ? this.uTime.value : -99);
    this.tiles.set(key, list);
    this._dirty = true; this._at = null;
  }
  removeTile(key) { this._born.delete(key); if (this.tiles.delete(key)) { this._dirty = true; this._at = null; } }

  /** Re-sort the trees round the camera when it has moved STEP m or turned ~3.5°; impostors when tiles changed. */
  tick(camera) {
    this.impMat.uniforms.uNow.value = this.uTime.value;
    if (!this._started && this.tiles.size) this._started = true;
    if (this._dirty) { this._dirty = false; this._rebuildImpostors(); }
    camera.getWorldDirection(this._dir);
    if (this._at && this._at.distanceTo(camera.position) < STEP && this._dir.dot(this._lastDir) > .998 && !(this._fadeUntil && this.uTime.value > this._fadeUntil)) return;
    this._fadeUntil = 0;
    this._at = camera.position.clone(); this._lastDir = this._dir.clone();
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); this._frustum.setFromProjectionMatrix(this._m);
    const b0 = this.b0, b1 = this.b1, cx = camera.position.x, cz = camera.position.z, now = this.uTime.value;
    const lists = this.entries.map(() => [[], []]);
    let near = 0, mid = 0, impDirty = false;
    const iS = this.iS;
    for (const list of this.tiles.values()) {
      for (const t of list) {
        const d = Math.hypot(t.x - cx, t.z - cz);
        // the tier (each tree at its own distance, with hysteresis): 0 near, 1 mid, 2 impostor (-1: none, the understory)
        const cur = t.tier, d0 = d - t.j0, d1 = d - t.j1;
        // (a far-only tree — a scene's far planting — stands aside inside the square of its real trees: hideFar)
        const hf = this.hideFar, hidden = t.farOnly && hf && t.x > hf[0] && t.x < hf[2] && t.z > hf[1] && t.z < hf[3];
        const B0 = t.deep ? b0 * DEEP[0] : b0, B1 = t.deep ? b1 * DEEP[1] : b1;
        const want = hidden ? -1 : t.e.nearOnly ? (d0 < B0 * .8 + (cur === 0 ? HYST : -HYST) ? 0 : -1)
          : d0 < B0 + (cur === 0 ? HYST : -HYST) ? 0 : d1 < B1 + (cur === 1 ? HYST : -HYST) ? 1 : 2;
        if (cur === undefined) { t.tier = want; t.from = -1; t.ts = -1e9; }
        else if (want !== cur) { t.from = cur; t.tier = want; t.ts = now; }
        const fading = now - t.ts < FT;
        // the impostor's state (only written when it changes)
        if (t.ik >= 0 && iS) {
          const mode = t.tier === 2 ? (fading ? 2 : 1) : fading && t.from === 2 ? 3 : 0;
          if (iS[t.ik * 2 + 1] !== mode || iS[t.ik * 2] !== t.ts) { iS[t.ik * 2] = t.ts; iS[t.ik * 2 + 1] = mode; impDirty = true; }
        }
        const inNear = t.tier === 0 || (fading && t.from === 0), inMid = t.tier === 1 || (fading && t.from === 1);
        if (!inNear && !inMid) continue;
        // in view (with a margin, ~8° and a few metres: a turn between re-sorts doesn't uncover gaps), or right beside
        if (d > 25) { this._sphere.center.set(t.x, t.y + t.h * .5, t.z); this._sphere.radius = Math.max(t.r, t.h * .6) + 4 + d * .14; if (!this._frustum.intersectsSphere(this._sphere)) continue; }
        const L = lists[t.e.i];
        if (inNear) { L[0].push(t); near++; t._m0 = t.tier === 0 ? (fading ? 2 : 1) : 3; }
        if (inMid) { L[1].push(t); mid++; t._m1 = t.tier === 1 ? (fading ? 2 : 1) : 3; }
      }
    }
    if (impDirty) this.impGeo.attributes.iS.needsUpdate = true;
    // dissolves under way: re-sort again once they're done (so the ones dissolved out leave the lists)
    this._fadeUntil = now + FT + .05;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
    this.entries.forEach((e, i) => lists[i].forEach((list, tier) => {
      for (let pi = 0; pi < (e.pools[tier] || []).length; pi++) {
        let im = e.pools[tier][pi];
        if (list.length > im.instanceMatrix.count) {
          const nim = new THREE.InstancedMesh(im.geometry, im.material, Math.ceil(list.length * 1.5));
          nim.name = im.name; nim.frustumCulled = false; nim.castShadow = im.castShadow; nim.receiveShadow = im.receiveShadow; nim.instanceMatrix.setUsage(THREE.DynamicDrawUsage); nim.setColorAt(0, c.set(1, 1, 1));
          fadeAttr(nim, nim.instanceMatrix.count);
          this.group.remove(im); im.dispose(); this.group.add(nim); e.pools[tier][pi] = im = nim;
        }
        const fa = im.geometry.attributes.aFade, fd = fa.array, mk = tier ? '_m1' : '_m0';
        list.forEach((t, k) => { q.setFromAxisAngle(Y, t.rot); p.set(t.x, t.y, t.z); s.set(t.s, t.sy, t.s); im.setMatrixAt(k, m.compose(p, q, s)); im.setColorAt(k, c.setScalar(t.tint)); fd[k * 2] = t.ts; fd[k * 2 + 1] = t[mk]; });
        fa.clearUpdateRanges(); fa.addUpdateRange(0, list.length * 2); fa.needsUpdate = true;
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
    for (const m of this._own.values()) m.dispose();   // (clones of the kit's own materials)
    this.impGeo.dispose(); this.impMat.dispose(); this.atlas.dispose(); this.leafTexture.dispose();
  }
}

/**
 * A tree-engine kit from a scene's regional pack assets (toolbox/packs: name, name-lod, name-far; each { geometry,
 * material }): every model with a -lod twin is a tree (its near and mid tiers, the scene's own materials); the rest
 * (logs, flowers, stones, shrubs) near-only understory.
 */
export function packKit(assets, isTree = (name) => !!assets[`${name}-lod`]) {
  const species = {}, understory = {};
  for (const [name, a] of Object.entries(assets)) {
    if (/-(lod|far)$/.test(name) || !a?.geometry?.isBufferGeometry) continue;
    if (isTree(name)) {
      const lod = assets[`${name}-lod`];
      a.geometry.computeBoundingBox();
      species[name] = { h: a.geometry.boundingBox.max.y, r: Math.max(a.geometry.boundingBox.max.x, a.geometry.boundingBox.max.z), variants: [[{ wood: a.geometry, leaves: null, material: a.material }, { wood: lod.geometry, leaves: null, material: lod.material }]], turn: [0] };
    } else understory[name] = { wood: a.geometry, leaves: null, material: a.material };
  }
  return { species, understory };
}
