// Toolbox: far tree cards — the flat, camera-facing silhouettes that carry a forest out past the real trees
// (Balanced and High). Used by every stylized scene with trees.
import * as THREE from '../../../../vendor/three.js';
import { litMaterial } from '../materials/lit.js';
import { anchor } from '../core/shader-patch.js';   // [review 27 Nov] T8: a missing shader anchor throws

/**
 * The tree-card materials: an alpha-tested silhouette (conifer or broadleaf) on a quad that turns about
 * its vertical axis to face the camera, lit from above like the canopy, with the scene's fog and wind.
 * `hide` (minX, minZ, maxX, maxZ) is the square where the real trees stand: cards there are dropped.
 */
export function makeTreeCards(uniforms) {
  const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const shade = (x0, x1) => { const g = ctx.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#b8b8b8'); return g; };
  // left half: conifer (tiers of a narrow cone); right half: broadleaf (a rounded crown on a short trunk)
  ctx.fillStyle = '#5a4a3c'; ctx.fillRect(29, 108, 6, 20); ctx.fillRect(93, 92, 6, 36);
  ctx.fillStyle = shade(6, 58);
  for (let k = 0; k < 5; k++) {
    const top = 2 + k * 20, half = 13 + k * 4.4;
    ctx.beginPath(); ctx.moveTo(32, top); ctx.lineTo(32 + half, top + 30); ctx.lineTo(32 - half, top + 30); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = shade(66, 126);
  for (const [x, y, r] of [[96, 48, 26], [80, 62, 18], [112, 62, 17], [96, 30, 18], [96, 72, 20]]) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const geometry = new THREE.PlaneGeometry(1, 1); geometry.translate(0, .5, 0);
  const hide = { value: new THREE.Vector4(0, 0, 0, 0) }, reach = { value: 1e9 };
  const make = (u0) => {
    const material = litMaterial({ map: texture, alphaTest: .3, side: THREE.DoubleSide });
    // 7.3b: no alpha-to-coverage — a far card is a few pixels tall, all edge, and Apple GPUs resolve partial
    // coverage as a dither pattern (a fine speckle over the distant forest). A plain alpha test instead, with
    // the mip-blurred alpha scaled up by mip level so distant cards keep their size rather than thinning out.
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(anchor('#include <alphatest_fragment>'), `
        #ifdef USE_MAP
          vec2 bfTx = vMapUv * 128.;
          float bfLod = max(0., .5 * log2(max(dot(dFdx(bfTx), dFdx(bfTx)), dot(dFdy(bfTx), dFdy(bfTx)))));
          diffuseColor.a *= 1. + bfLod * .2;
        #endif
        #include <alphatest_fragment>`);
      shader.uniforms.bfHide = hide; shader.uniforms.bfReach = reach; shader.uniforms.uTime = uniforms.uTime; shader.uniforms.bfWind = uniforms.bfWind || { value: .3 };
      shader.vertexShader = shader.vertexShader
        .replace(anchor('#include <common>'), '#include <common>\nuniform vec4 bfHide; uniform float bfReach; uniform float uTime; uniform float bfWind;')
        .replace(anchor('#include <uv_vertex>'), `#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = vec2(${u0.toFixed(2)} + uv.x * .5, uv.y);\n#endif`)
        .replace(anchor('#include <beginnormal_vertex>'), 'vec3 objectNormal = vec3(0., 1., 0.);')
        .replace(anchor('#include <project_vertex>'), `
          vec4 bfC = modelMatrix * instanceMatrix * vec4(0., 0., 0., 1.);
          vec3 bfR = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
          float bfW = length(instanceMatrix[0].xyz), bfH = length(instanceMatrix[1].xyz);
          float bfSway = sin(uTime * 1.1 + bfC.x * .07 + bfC.z * .05) * bfWind * .04 * position.y * bfH;
          vec3 bfP = bfC.xyz + bfR * (position.x * bfW + bfSway) + vec3(0., position.y * bfH, 0.);
          vec4 mvPosition = viewMatrix * vec4(bfP, 1.);
          gl_Position = projectionMatrix * mvPosition;
          // where the real trees stand: off screen
          // and beyond the reach (where the ground starts to morph toward the real horizon)
          if ((bfC.x > bfHide.x && bfC.z > bfHide.y && bfC.x < bfHide.z && bfC.z < bfHide.w) || length(bfC.xz - cameraPosition.xz) > bfReach) gl_Position = vec4(2., 2., 2., 1.);`);
    };
    material.customProgramCacheKey = () => `bf-tree-card-${u0}`;
    return { geometry, material };
  };
  const cards = { conifer: make(0), broadleaf: make(.5), hide, reach };
  cards.dispose = () => { texture.dispose(); geometry.dispose(); cards.conifer.material.dispose(); cards.broadleaf.material.dispose(); };
  return cards;
}
