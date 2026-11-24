// Near 3D bark trunks (Camillus Forest Unique Area; user, 24 Nov: "focus on adding texture to tree trunks … Should
// trees very close to the rider path fade into 3D at a close view distance?" → "3D trunk, crown stays card", "~30 m",
// "Small bark textures", "Camillus Forest first").
//
// A tree the old growth gives a `cut` (its dominants near the trails) keeps its 2D card from the cut up — the crown —
// and, inside NEAR_TRUNK of the camera, a 3D trunk from the ground to a little past the cut: the very skeleton its card
// was photographed from (upstate-trees grow(): the first stem's points and radii), as a tapered tube with a butt swell,
// wrapped in a tiled bark texture with a normal map (tools/make_bark.py: maple's furrowed plates — maple and basswood —
// beech's smooth grey, hickory's strips), moss on the north side, darker and damp at the foot. The card's trunk below
// the cut and the 3D trunk dissolve in the same screen dither, the one exactly the other's complement (tree-engine.js
// NEAR_TRUNK), so the swap at ~24–32 m is a fine stipple over a second's riding, not a pop.
//
//   const nt = new NearTrunks(group, kit)
//   nt.cutOf(name, v)              the cut (m above the base, unscaled) for a species' variant, or 0
//   nt.draw(list)                  [{ x, y, z, rot, s, sy, name, v, tint }] — the trees near the camera now
//   nt.dispose()
import * as THREE from '../../../../vendor/three.module.min.js';
import { hash } from '../core/mesh-builder.js';
import { NEAR_TRUNK } from './tree-engine.js';

const BARK_OF = { sugarmapleF: 'maple', basswood: 'maple', whiteash: 'maple', beechF: 'beech', hickory: 'hickory' };
// each bark's colour against its card's trunk colour (the texture's mean is a little off the species' hex: matched so the
// dissolve between them doesn't show as a change of shade)
const BARK_TONE = { maple: [1.62, 1.42, 1.24], beech: [1.32, 1.3, 1.26], hickory: [1.72, 1.54, 1.36] };
const SEG = 14;

let textures = null;
function barkTextures() {
  if (textures) return textures;
  const L = new THREE.TextureLoader();
  const load = (f, srgb) => {
    const t = L.load(new URL(`../../../../textures/${f}`, import.meta.url).href);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  textures = {};
  for (const b of ['maple', 'beech', 'hickory']) textures[b] = { map: load(`bark-${b}.jpg`, true), normal: load(`bark-${b}-n.jpg`, false) };
  return textures;
}

/** The trunk along a skeleton ({ pts, radii, crown, fork }), from just under the ground to `top`. */
function trunkGeometry(T, top, seed) {
  const n = T.pts.length;
  // the point and radius at a height, straight between the skeleton's points (as the card's tube is)
  const at = (y) => {
    let i = 0; while (i < n - 2 && T.pts[i + 1].y < y) i++;
    const a = T.pts[i], b = T.pts[i + 1], f = Math.max(0, Math.min(1, (y - a.y) / Math.max(1e-3, b.y - a.y)));
    return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, r: T.radii[i] + (T.radii[i + 1] - T.radii[i]) * f };
  };
  const r0 = T.radii[0], around = Math.max(2, Math.round(2 * Math.PI * r0 / 1.5));   // the bark's tiles round the trunk (~1.5 m each)
  const ys = []; for (let y = -.4; y < 1.6; y += .25) ys.push(y); for (let y = 1.6; y < top; y += .9) ys.push(y); ys.push(top);
  const pos = [], uv = [], idx = [];
  ys.forEach((y, j) => {
    const p = at(Math.max(0, y));
    // the butt swell: wider over the first metre or so (the root flares, where there are, stand round it)
    const swell = 1 + .32 * Math.exp(-Math.max(0, y) / .8);
    for (let k = 0; k <= SEG; k++) {
      const a = (k % SEG) / SEG * Math.PI * 2;
      // an irregular outline (a trunk isn't a lathe's): buttress lobes low down, a slight wobble all the way up
      const lobe = 1 + (.09 * Math.exp(-Math.max(0, y) / 1.2)) * Math.sin(a * 5 + seed) + .025 * (hash(seed * 31 + k * 7 + (j >> 2)) - .5);
      const r = p.r * swell * lobe;
      pos.push(p.x + Math.cos(a) * r, y, p.z + Math.sin(a) * r);
      uv.push(k / SEG * around, y / 1.7);
    }
  });
  for (let j = 0; j + 1 < ys.length; j++) for (let k = 0; k < SEG; k++) {
    const a = j * (SEG + 1) + k, b = a + 1, c = a + SEG + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  // (the seam: its two columns share one normal, so the lighting doesn't break down the trunk's side)
  const N = g.attributes.normal;
  for (let j = 0; j < ys.length; j++) {
    const a = j * (SEG + 1), b = a + SEG;
    const nx = N.getX(a) + N.getX(b), ny = N.getY(a) + N.getY(b), nz = N.getZ(a) + N.getZ(b), l = Math.hypot(nx, ny, nz) || 1;
    N.setXYZ(a, nx / l, ny / l, nz / l); N.setXYZ(b, nx / l, ny / l, nz / l);
  }
  g.computeBoundingSphere();
  return g;
}

function barkMaterial(bark) {
  const t = barkTextures()[bark];
  const m = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, normalScale: new THREE.Vector2(1.4, 1.4), roughness: .93, metalness: 0 });
  m.color.setRGB(...BARK_TONE[bark]);
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vTrk; varying float vYb; varying vec3 vWN;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          mat4 im = modelMatrix;
          #ifdef USE_INSTANCING
            im = modelMatrix * instanceMatrix;
          #endif
          vec3 io = (im * vec4(0., 0., 0., 1.)).xyz;
          vTrk = 1. - smoothstep(${NEAR_TRUNK[0].toFixed(1)}, ${NEAR_TRUNK[1].toFixed(1)}, length(io.xz - cameraPosition.xz));
          vYb = position.y; vWN = normalize(mat3(im) * objectNormal);
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vTrk; varying float vYb; varying vec3 vWN;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        // the card's dither, complemented (tree-engine.js: the card's trunk gone where vTrk > the dither)
        float teDz = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))));
        if (vTrk <= teDz) discard;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          // moss on the north (−z) side, low; the foot darker where it's damp and splashed with soil
          float north = smoothstep(-.1, .75, -vWN.z), low = 1. - smoothstep(1.5, 7., vYb);
          float mo = north * (.35 + .65 * low) * smoothstep(.25, .6, diffuseColor.g + .15);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.29, .36, .17) * (.8 + diffuseColor.g), mo * .55);
          diffuseColor.rgb *= mix(.62, 1., smoothstep(-.1, 1.1, vYb));
        }`);
  };
  m.customProgramCacheKey = () => `near-trunk-1-${bark}`;
  return m;
}

export class NearTrunks {
  constructor(group, kit) {
    this.group = group; this.kit = kit; this.meshes = new Map(); this.mats = {}; this.info = new Map();
  }
  /** The skeleton's cut for a species' variant (unscaled m above its base): just under the crown and its first limbs. */
  cutOf(name, v) {
    const key = `${name}:${v}`;
    if (this.info.has(key)) return this.info.get(key).cut;
    const T = this.kit?.species?.[name]?.variants?.[v]?.[0]?.trunk;
    let info = { cut: 0 };
    if (T && BARK_OF[name]) {
      const n = T.pts.length, fy = T.pts[Math.min(n - 1, Math.max(1, Math.round(T.fork * (n - 1))))].y;
      const cut = Math.max(3, Math.min(T.crown * .9, fy - .3));
      info = { cut, T, top: cut + 1.8, bark: BARK_OF[name] };
    }
    this.info.set(key, info);
    return info.cut;
  }
  _mesh(key, n) {
    let im = this.meshes.get(key);
    if (im && im.instanceMatrix.count >= n) return im;
    const info = this.info.get(key);
    const geo = im ? im.geometry : trunkGeometry(info.T, info.top, hash(key.length * 977 + key.charCodeAt(0)) * 6.28);
    const mat = this.mats[info.bark] ||= barkMaterial(info.bark);
    if (im) { this.group.remove(im); im.dispose(); }
    im = new THREE.InstancedMesh(geo, mat, Math.max(8, Math.ceil(n * 1.5)));
    im.name = `Near bark trunks ${key}`; im.frustumCulled = false; im.receiveShadow = true;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.setColorAt(0, new THREE.Color(1, 1, 1));
    this.group.add(im); this.meshes.set(key, im);
    return im;
  }
  /** The trunks near the camera now: [{ x, y, z, rot, s, sy, name, v, tint }]. */
  draw(list) {
    const by = new Map();
    for (const t of list) { const key = `${t.name}:${t.v}`; if (!this.cutOf(t.name, t.v)) continue; (by.get(key) || by.set(key, []).get(key)).push(t); }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), sc = new THREE.Vector3(), c = new THREE.Color();
    for (const [key, im] of this.meshes) if (!by.has(key)) im.count = 0;
    let n = 0;
    for (const [key, ts] of by) {
      const im = this._mesh(key, ts.length);
      ts.forEach((t, k) => { q.setFromAxisAngle(Y, t.rot); p.set(t.x, t.y, t.z); sc.set(t.s, t.sy, t.s); im.setMatrixAt(k, m.compose(p, q, sc)); im.setColorAt(k, c.setScalar(t.tint ?? 1)); });
      im.count = ts.length; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
      n += ts.length;
    }
    return n;
  }
  hide() { for (const im of this.meshes.values()) im.count = 0; }
  dispose() {
    for (const im of this.meshes.values()) { this.group.remove(im); im.geometry.dispose(); im.dispose(); }
    for (const m of Object.values(this.mats)) m.dispose();
    this.meshes.clear();
  }
}
