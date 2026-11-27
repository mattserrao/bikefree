// Crowd impostors (race-day crowds plan, 27 Nov): the figures kit photographed once at load into a small atlas, so a
// crowd of thousands draws as one card per person instead of a skinned figure each.
//
// The atlas holds paint weights, not colours (palette-masked): two RGBA textures, every texel the share of the shirt,
// trousers, skin, hair, flag cloth, shin and forearm at that spot, times a baked shade, and the coverage. A card's
// shader paints it from its own palette, so one atlas gives every look (the orange crowd at Dutch Corner too), long or
// short trousers and sleeves by the person. Shoes, eyes and props weigh nothing and draw dark.
//
// Cells: POSES × FRAMES (a clip's loop in 4 steps) × ANGLES (seen from 0°, 45°, 90°, 135° and 180° off their front;
// the other side is the mirror image). 64 × 128 px each, 1.5 × 3 m (room for a raised flag).
//
//   const atlas = bakeCrowdAtlas(renderer)       { tex0, tex1, rows, dispose() } (null without a renderer)
//   const mat = impostorMaterial(atlas, { uTime, near, farM })    near: { value: Vector4(cam x, y, z, radius) } — cards
//                                                                  inside the radius are dropped (drawn as 3D figures)
//   POSE_OF[clip]                                 the atlas pose for a figures clip (CLIP), or -1
import * as THREE from '../../../../../vendor/three.js';
import { CLIP, FIT, posedFigure, randomLook } from './people.js';
import { randomSequence } from '../../core/random.js';
import { anchor } from '../../core/shader-patch.js';

export const POSES = ['idle', 'look', 'photo', 'cheer', 'wave', 'clap', 'flag', 'sit'];
export const POSE_OF = Object.fromEntries(Object.entries(CLIP).map(([name, i]) => [i, POSES.indexOf(name)]));
export const FRAMES = 4, ANGLES = 5, COLS = 16, CELL_PX = [64, 128], CELL_M = [1.5, 3];
const CELLS = POSES.length * FRAMES * ANGLES, ROWS = Math.ceil(CELLS / COLS);
const RIG_FRAMES = 24;   // (the figures kit's keyframes per loop)

/** The flag a flag pose holds (as race-day.js hangs it on a person): a pole and a cloth, the cloth waving by frame. */
function flagGeometry(frame) {
  const cloth = new THREE.PlaneGeometry(.9, .6, 6, 1).translate(.45 - .27, 2.45, .12), P = cloth.attributes.position;
  for (let i = 0; i < P.count; i++) { const u = (P.getX(i) + .27) / .9; P.setZ(i, P.getZ(i) + Math.sin(frame / FRAMES * 6.283 + u * 5) * .12 * u); }
  cloth.computeVertexNormals();
  const pole = new THREE.CylinderGeometry(.015, .015, 1.6, 4).translate(-.27, 1.95, .12);
  const ch = (g, a0, a1) => { const n = g.attributes.position.count; g.setAttribute('aCh0', new THREE.Float32BufferAttribute(new Array(n).fill(a0).flat(), 4)); g.setAttribute('aCh1', new THREE.Float32BufferAttribute(new Array(n).fill(a1).flat(), 4)); return g; };
  return [ch(cloth.toNonIndexed(), [0, 0, 0, 0], [1, 0, 0, 0]), ch(pole.toNonIndexed(), [0, 0, 0, 0], [0, 0, 0, 0])];
}

/** Photograph the figures into the atlas with the world's renderer (state restored after). */
export function bakeCrowdAtlas(renderer) {
  if (!renderer?.setRenderTarget) return null;
  const [cw, ch] = CELL_PX, W = COLS * cw, H = ROWS * ch;
  const opts = { depthBuffer: true, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter };
  const targets = [new THREE.WebGLRenderTarget(W, H, opts), new THREE.WebGLRenderTarget(W, H, opts)];
  const pass = { value: 0 };
  // the shade: light from above and in front (the figure's frame), soft enough to read from any side
  const mat = new THREE.ShaderMaterial({
    uniforms: { uPass: pass }, side: THREE.DoubleSide, blending: THREE.NoBlending,
    vertexShader: 'attribute vec4 aCh0; attribute vec4 aCh1; varying vec4 v0; varying vec4 v1; varying vec3 vN; void main() { v0 = aCh0; v1 = aCh1; vN = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: `uniform float uPass; varying vec4 v0; varying vec4 v1; varying vec3 vN;
      void main() {
        vec3 n = normalize(vN) * (gl_FrontFacing ? 1. : -1.);
        float shade = .26 + .56 * max(dot(n, normalize(vec3(.3, .85, .45))), 0.) + .06 * n.y;
        gl_FragColor = uPass < .5 ? vec4(v0.rgb * shade, 1.) : vec4(v0.a * shade, v1.rgb * shade);
      }`,
  });
  // one adult in the middle of the kit's range: short hair, sleeves and long trousers (the masks pick them per card)
  const look = randomLook(randomSequence(77), { kids: 0, caps: 0, packs: 0, skirts: 0, jackets: 0, hoodies: 0, beanies: 0, longHair: 0 });
  Object.assign(look, { h: 1, g: 1, kid: false, hair: 1 });
  look.bits &= FIT.STYLE - 1;   // (short hair: the style bits cleared)
  const base = (look.bits & ~(FIT.CAP | FIT.PACK | FIT.JACKET | FIT.HOOD | FIT.BEANIE | FIT.LONG_HAIR | FIT.SKIRT | FIT.PROP)) | FIT.SLEEVES | FIT.LONG_PANTS;
  const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-CELL_M[0] / 2, CELL_M[0] / 2, CELL_M[1], 0, .1, 100);
  const r = renderer, prev = { target: r.getRenderTarget(), autoClear: r.autoClear, color: r.getClearColor(new THREE.Color()), alpha: r.getClearAlpha(), scissor: r.getScissorTest() };
  const meshes = [];
  POSES.forEach((pose, pi) => {
    for (let f = 0; f < FRAMES; f++) {
      look.bits = base | (pose === 'photo' ? FIT.PROP : 0);
      const parts = [posedFigure(look, CLIP[pose], { frame: Math.round(f * RIG_FRAMES / FRAMES), lod: 'hi', channels: true }), ...(pose === 'flag' ? flagGeometry(f) : [])];
      meshes.push({ cell: (pi * FRAMES + f) * ANGLES, parts: parts.map((g) => new THREE.Mesh(g, mat)) });
    }
  });
  r.setClearColor(0x000000, 0); r.autoClear = false;
  targets.forEach((rt, k) => {
    pass.value = k;
    rt.texture.generateMipmaps = true;
    r.setRenderTarget(rt); r.setScissorTest(false); r.setViewport(0, 0, W, H); r.clear(true, true, false);
    rt.texture.generateMipmaps = false;   // (built once, with the last photo)
    r.setScissorTest(true);
    meshes.forEach(({ cell, parts }, m) => {
      for (const p of parts) scene.add(p);
      for (let a = 0; a < ANGLES; a++) {
        const c = cell + a, x = (c % COLS) * cw, y = Math.floor(c / COLS) * ch, th = a * Math.PI / (ANGLES - 1);
        cam.position.set(Math.sin(th) * 20, 0, Math.cos(th) * 20); cam.lookAt(0, 0, 0);
        if (m === meshes.length - 1 && a === ANGLES - 1) rt.texture.generateMipmaps = true;
        r.setRenderTarget(rt); r.setViewport(x, y, cw, ch); r.setScissor(x, y, cw, ch);
        r.render(scene, cam);
      }
      for (const p of parts) scene.remove(p);
    });
  });
  r.setScissorTest(prev.scissor); r.autoClear = prev.autoClear; r.setClearColor(prev.color, prev.alpha); r.setRenderTarget(prev.target);
  const sz = new THREE.Vector2(); r.getSize(sz); r.setViewport(0, 0, sz.x, sz.y);
  for (const { parts } of meshes) for (const p of parts) p.geometry.dispose();
  mat.dispose();
  return { tex0: targets[0].texture, tex1: targets[1].texture, rows: ROWS, bytes: W * H * 4 * 2 * 4 / 3, dispose: () => targets.forEach((t) => t.dispose()) };
}

/** Pack a colour (0–1 channels) into one float: 8 bits a channel (exact in a float32). */
export const packColor = (c) => Math.round(c.r * 255) * 65536 + Math.round(c.g * 255) * 256 + Math.round(c.b * 255);

/**
 * The cards' material: a unit quad per person (instance data, 16 floats: x, y, z, yaw | height, girth, pose, phase |
 * shirt, trousers, skin, hair | flag, outfit bits (1 sleeves, 2 long trousers), clip loops per second, 0), turned to
 * the camera about its vertical axis, the atlas cell picked by the view angle and the clip's step. Lit as the ground
 * is (normal up), no shadow cast. near.w: cards closer than this are dropped; farM: and farther than this.
 */
export function impostorMaterial(atlas, { uTime, near, farM = 400 }) {
  const m = new THREE.MeshStandardMaterial({ roughness: .9, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uTime, uCrowdNear: near, uCrowdFar: { value: farM }, tCrowd0: { value: atlas.tex0 }, tCrowd1: { value: atlas.tex1 } });
    shader.vertexShader = shader.vertexShader
      .replace(anchor('#include <common>'), `#include <common>
        uniform float uTime; uniform vec4 uCrowdNear; uniform float uCrowdFar;
        attribute vec4 iPos; attribute vec4 iLook; attribute vec4 iCol; attribute vec4 iExtra;
        varying vec2 vAUv; varying vec3 vShirt; varying vec3 vPants; varying vec3 vSkin; varying vec3 vHair; varying vec3 vFlag; varying vec2 vFit;
        vec3 bfUnpack(float f) { return vec3(floor(f / 65536.), mod(floor(f / 256.), 256.), mod(f, 256.)) / 255.; }`)
      .replace(anchor('#include <beginnormal_vertex>'), 'vec3 objectNormal = vec3(0., 1., 0.);')
      .replace(anchor('#include <begin_vertex>'), `vec3 transformed;
        {
          vec3 o = iPos.xyz; float yaw = iPos.w;
          vec3 toCam = cameraPosition - (modelMatrix * vec4(o, 1.)).xyz;
          vec2 d = normalize(toCam.xz + vec2(1e-5));
          float th = atan(dot(d, vec2(cos(yaw), -sin(yaw))), dot(d, vec2(sin(yaw), cos(yaw))));   // off their front, + to their left
          float a = clamp(floor(abs(th) / ${(Math.PI / (ANGLES - 1)).toFixed(6)} + .5), 0., ${ANGLES - 1}.);
          float fr = floor(fract(uTime * iExtra.z + iLook.w) * ${FRAMES}.);
          float cell = (iLook.z * ${FRAMES}. + fr) * ${ANGLES}. + a;
          float ux = position.x + .5;
          if (th < 0.) ux = 1. - ux;   // the other side: the mirror image
          vAUv = vec2((mod(cell, ${COLS}.) + ux) / ${COLS}., (floor(cell / ${COLS}.) + position.y) / ${ROWS}.);
          vec3 right = vec3(d.y, 0., -d.x);
          transformed = o + right * (position.x * ${CELL_M[0].toFixed(2)} * iLook.y) + vec3(0., position.y * ${CELL_M[1].toFixed(2)} * iLook.x, 0.);
          float dist = length(toCam);
          if (dist < uCrowdNear.w || dist > uCrowdFar) transformed = o;   // (collapsed: drawn as a 3D figure, or too far)
          vShirt = bfUnpack(iCol.x); vPants = bfUnpack(iCol.y); vSkin = bfUnpack(iCol.z); vHair = bfUnpack(iCol.w); vFlag = bfUnpack(iExtra.x);
          vFit = vec2(mod(iExtra.y, 2.), floor(iExtra.y / 2.));
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace(anchor('#include <common>'), `#include <common>
        uniform sampler2D tCrowd0; uniform sampler2D tCrowd1;
        varying vec2 vAUv; varying vec3 vShirt; varying vec3 vPants; varying vec3 vSkin; varying vec3 vHair; varying vec3 vFlag; varying vec2 vFit;`)
      .replace(anchor('#include <color_fragment>'), `#include <color_fragment>
        {
          vec4 a0 = texture2D(tCrowd0, vAUv), a1 = texture2D(tCrowd1, vAUv);
          if (a0.a < .5) discard;
          a0.rgb /= a0.a; a1 /= a0.a;
          vec3 shin = vFit.y > .5 ? vPants : vSkin, fore = vFit.x > .5 ? vShirt : vSkin;
          diffuseColor.rgb = a0.r * vShirt + a0.g * vPants + a0.b * vSkin + a1.r * vHair + a1.g * vFlag + a1.b * shin + a1.a * fore;
        }`);
  };
  m.customProgramCacheKey = () => 'bf-crowd-impostor-1';
  return m;
}
