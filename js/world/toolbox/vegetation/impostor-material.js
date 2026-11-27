// The tree engine's impostor cards (js/world/toolbox/vegetation/tree-engine.js): each far tree a camera-facing card
// that blends the two of its ANGLES photos either side of the view, from the engine's atlas (a row per entry);
// dissolving in and out as it swaps tiers, relit by the atlas's normals when the engine baked them.
// [review 27 Nov] Moved out of tree-engine.js (T14) with its shader unchanged (test/shader-sources.test.mjs).
import * as THREE from '../../../../vendor/three.js';
import { TREE_GRADE, NEAR_TRUNK, NEAR_PLANT } from './tree-engine.js';   // (used at call time only: the cycle is safe)
import { SURFACE } from '../materials/surface-detail.js';

/** Photos round each tree in the atlas (the engine's bake takes this many). */
export const ANGLES = 12;

/**
 * The impostor material over atlas (W × H px, `rows` entries). o: the engine's { ft (its tier swap in s), tileIn (a new
 * tile's fade in s), msaa (alpha to coverage), normAtlas (the baked normals, or null), bakeSun (the sun they were baked in) }.
 */
export function impostorMaterial(atlas, rows, W, H, o) {
  const m = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uAtlas: { value: atlas }, uRows: { value: rows }, uNow: { value: 0 }, uAtlasSize: { value: new THREE.Vector2(W, H) }, uNorm: { value: null }, uRelight: { value: 0 }, uSunNow: { value: new THREE.Vector3(0, 1, 0) }, uSunBake: { value: new THREE.Vector3(0, 1, 0) } }]),
    vertexShader: /* glsl */`
        attribute vec4 iA; attribute vec4 iB; attribute float iT; attribute vec2 iS;   // iA: x, y, z, rotation; iB: width, height, row, tint; iT: when its tile came; iS: its swap (when, 0 hidden / 1 shown / 2 in / 3 out)
        attribute vec2 iL;    // [zwift-look] the lean: the top's offset per metre up (x, z)
        attribute vec3 iH;    // [plants phase 1] a colour tint (r, g, b): one shrub's shape serves several plants
        attribute float iC;   // a trunk cut (m above the base; 0: none): below it, near the camera, a 3D trunk stands in
        uniform float uRows; uniform float uNow;
        varying vec2 vUv; varying vec2 vUv2; varying float vBlend; varying float vKeep; varying float vOut; varying float vTint; varying vec3 vHue;
        varying float vH; varying float vCut; varying float vTrunk; varying float vGrade; varying vec3 vWP; varying vec2 vRot;
        #include <fog_pars_vertex>
        void main() {
          vec3 o = iA.xyz; vec2 to = o.xz - cameraPosition.xz; float d = length(to);
          // shown when the engine says (iS: the tree's tier), dissolving in or out as it swaps with the mid tier, and
          // in over 1.5 s after its tile comes
          float k = clamp((uNow - iS.x) / ${o.ft.toFixed(2)}, 0., 1.);
          vOut = iS.y > 2.5 ? 1. : 0.;
          vKeep = (iS.y > 2.5 ? 1. - k : iS.y > 1.5 ? k : 1.) * clamp((uNow - iT) / ${o.tileIn.toFixed(2)}, 0., 1.);
          // a card the camera is about to pass through (a sapling at the trail's edge, a trunk at a bend): gone in a
          // dither inside ~3 m — a card that close is all magnified blur (Camillus Forest's narrow trails, 24 Nov)
          vKeep *= smoothstep(1.4, 3.4, d);
          if (iS.y < .5 || vKeep <= 0. || iB.x <= 0.) { gl_Position = vec4(2., 2., 2., 1.); return; }
          vec2 dir = to / max(d, 1e-3);
          vec3 right = normalize(vec3(-dir.y, 0., dir.x));
          // the side it's seen from, in the tree's own frame (its rotation about y), → one of the photos
          float cr = cos(iA.w), sr = sin(iA.w); vRot = vec2(cr, sr);
          vec2 vl = vec2(-dir.x * cr + dir.y * sr, -dir.x * sr - dir.y * cr);
          float a = atan(vl.x, vl.y); if (a < 0.) a += 6.2831853;
          // the two photos either side of the view, and how far between (the card blends them)
          float fa = a / 6.2831853 * ${ANGLES}., f0 = mod(floor(fa), ${ANGLES}.), f1 = mod(f0 + 1., ${ANGLES}.);
          vBlend = fract(fa);
          vUv = vec2((f0 + uv.x) / ${ANGLES}., (iB.z + uv.y) / uRows);
          vUv2 = vec2((f1 + uv.x) / ${ANGLES}., (iB.z + uv.y) / uRows);
          // (iB.w: the tint, plus 10 × a colour grade — 1 a hero woods' tree, 2 its understory: old-growth.js)
          vGrade = floor(iB.w / 10.); vTint = iB.w - vGrade * 10.; vHue = iH;
          vec3 p = o + right * position.x * iB.x + vec3(0., position.y * iB.y, 0.);
          p.xz += iL * position.y * iB.y;
          // (a tree beside the path, inside ~30 m: its card's trunk gives way to a 3D bark trunk, in the same dither as
          //  the trunk's own — old-growth.js NEAR_TRUNK — the crown stays the card: user, 24 Nov)
          vH = position.y * iB.y; vWP = p;
          // (a negative cut: the whole card gives way, nearer — a fern, a herb: near-trunks.js NearPlants)
          vCut = iC < 0. ? 1e4 : iC;
          vTrunk = iC > 0. ? 1. - smoothstep(${NEAR_TRUNK[0].toFixed(1)}, ${NEAR_TRUNK[1].toFixed(1)}, d) : iC < 0. ? 1. - smoothstep(${NEAR_PLANT[0].toFixed(1)}, ${NEAR_PLANT[1].toFixed(1)}, d) : 0.;
          vec4 mvPosition = viewMatrix * vec4(p, 1.);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
    fragmentShader: /* glsl */`
        uniform sampler2D uAtlas; uniform sampler2D uSurf; uniform vec2 uAtlasSize; varying vec2 vUv; varying vec2 vUv2; varying float vBlend; varying float vKeep; varying float vOut; varying float vTint; varying vec3 vHue;
        varying float vH; varying float vCut; varying float vTrunk; varying float vGrade; varying vec3 vWP; varying vec2 vRot;
        uniform sampler2D uNorm; uniform float uRelight; uniform vec3 uSunNow, uSunBake;
        #include <common>
        #include <fog_pars_fragment>
        ${TREE_GRADE}
        // a cubic B-spline sample from four bilinear taps: smooth, no blocks, when the card's magnified
        // [review 27 Nov] every mipmapped sample below takes its gradients from outside the branches (textureGrad): the
        // magnified-card branch isn't uniform across a pixel quad, where implicit derivatives are undefined (iPhone)
        vec4 cubic(vec2 uv, vec2 gx, vec2 gy) {
          vec2 st = uv * uAtlasSize - .5, i = floor(st), f = st - i;
          vec2 w0 = (1. - f) * (1. - f) * (1. - f) / 6., w1 = (4. - 6. * f * f + 3. * f * f * f) / 6., w3 = f * f * f / 6., w2 = 1. - w0 - w1 - w3;
          vec2 s0 = w0 + w1, s1 = w2 + w3, o0 = i - .5 + w1 / s0, o1 = i + 1.5 + w3 / s1;
          return (textureGrad(uAtlas, vec2(o0.x, o0.y) / uAtlasSize, gx, gy) * s0.x + textureGrad(uAtlas, vec2(o1.x, o0.y) / uAtlasSize, gx, gy) * s1.x) * s0.y
               + (textureGrad(uAtlas, vec2(o0.x, o1.y) / uAtlasSize, gx, gy) * s0.x + textureGrad(uAtlas, vec2(o1.x, o1.y) / uAtlasSize, gx, gy) * s1.x) * s1.y;
        }
        void main() {
          vec2 gx = dFdx(vUv), gy = dFdy(vUv), gx2 = dFdx(vUv2), gy2 = dFdy(vUv2);
          vec2 tpx = (abs(gx) + abs(gy)) * uAtlasSize;   // (fwidth(vUv))
          float mag = clamp(1.25 - max(tpx.x, tpx.y) * 1.25, 0., 1.);
          vec4 c0, c1;
          if (mag > 0.) { c0 = cubic(vUv, gx, gy); c1 = cubic(vUv2, gx2, gy2); } else { c0 = textureGrad(uAtlas, vUv, gx, gy); c1 = textureGrad(uAtlas, vUv2, gx2, gy2); }
          vec4 c = mix(c0, c1, vBlend);
          // (the photo's colour, un-premultiplied from its own alpha before the edge is roughened below: dividing by the
          //  roughened alpha brightened every part-covered texel up to 3× — the washed-out, too-light bushes, user 24 Nov,
          //  whose small, magnified cards are mostly part-covered edge)
          float a0 = c.a;
          // a near card, magnified past its photo's texels (user, 24 Nov: "softening the pixelation", trees staying 2D):
          // leaf clusters from the detail texture break up the blocks of colour and roughen the silhouette's staircase
          if (mag > 0.) {
            vec2 k1 = uAtlasSize / 22., k2 = uAtlasSize / 9.;
            float lf = textureGrad(uSurf, vUv * k1, gx * k1, gy * k1).g, lf2 = textureGrad(uSurf, vUv * k2 + .37, gx * k2, gy * k2).g;
            c.rgb *= 1. + (lf * .6 + lf2 * .4 - .5) * .75 * mag;
            c.a = clamp(c.a + (lf2 - .5) * .55 * mag * smoothstep(.15, .85, c.a) * (1. - smoothstep(.85, 1., c.a)) * 2., 0., 1.);
          }
          // the edge's coverage over about a pixel (alpha to coverage under MSAA: soft silhouettes, no sorting)
          // (a hero woods' crown against the sky: its edge feathered over ~2.5 px, not a stepped cut-out — user, 24 Nov)
          float cov = clamp((c.a - .5) / max(fwidth(c.a) * (vGrade > .5 ? 2.5 : 1.), 1e-4) + .5, 0., 1.);
          if (cov <= 0.) discard;
          ${o.msaa ? '' : `// no alpha to coverage (phones): a plain cut at half alpha. The card's faint edge texels, drawn solid with their
          // colour un-premultiplied from a few levels of 8-bit, came out near white: the light halo round the trees.
          if (c.a < .5) discard;`}
          float teDz = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))));
          if (vOut > .5 ? vKeep <= teDz : vKeep <= 1. - teDz) discard;   // the complement of the mid tier's dissolve
          if (vH < vCut && vTrunk > teDz) discard;   // the 3D trunk's place (its own dither the exact complement)
          vec3 col = c.rgb / max(a0, .3);
          if (vGrade > .5) {
            // a hero woods' tree seen from below: its side photo gives way, in a dither, to the overhead leaf layer (the
            // crowns' undersides: old-growth.js canopy) as it comes overhead — user, 24 Nov: "Underside view"
            vec3 dv = vWP - cameraPosition;
            float up = vGrade < 1.5 ? smoothstep(.72, .92, dv.y / max(length(dv), 1e-3)) : 0.;
            // (under MSAA a smooth fade in the edge's coverage — a fixed stipple overhead read as a screen; phones: the dither)
            ${o.msaa ? 'cov *= 1. - up; if (cov <= 0.) discard;' : 'if (up > teDz) discard;'}
            col = treeGrade(col, vGrade, vH);
          }
          if (uRelight > .5) {
            // the photo relit: its normal (the tree's frame) against the sun now (turned into the tree's frame) over the sun
            // it was photographed in — the lit side follows the real sun however the tree is turned
            vec3 n = normalize(mix(texture2D(uNorm, vUv).xyz, texture2D(uNorm, vUv2).xyz, vBlend) * 2. - 1.);
            vec3 sT = vec3(uSunNow.x * vRot.x - uSunNow.z * vRot.y, uSunNow.y, uSunNow.x * vRot.y + uSunNow.z * vRot.x);
            float d0 = max(dot(n, uSunBake), 0.), d1 = max(dot(n, sT), 0.);
            col *= clamp((.6 + d1) / (.6 + d0), .65, 1.5);
          }
          gl_FragColor = vec4(col * vTint * vHue, cov);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
  });
  // (the atlas after the merge: UniformsUtils.merge won't clone a render target's texture — it set uAtlas to null,
  //  and the impostors drew nothing: every tree past the mid band was missing)
  m.uniforms.uAtlas.value = atlas;
  m.uniforms.uSurf = SURFACE;   // (the shared detail texture: a blank until loaded)
  m.alphaToCoverage = !!o.msaa;
  m.customProgramCacheKey = () => `tree-engine-impostor-17-${o.ft}-${o.msaa ? 1 : 0}`;
  if (o.normAtlas) { const U = m.uniforms; U.uNorm.value = o.normAtlas.texture; U.uRelight.value = 1; U.uSunBake.value.copy(o.bakeSun); }
  return m;
}
