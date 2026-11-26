// Valley haze: the scene's distance fog gains a height term, so the air thickens low in the valleys and
// over the water and thins on the ridges. It is added to three.js's own fog chunks, so every fogged
// material (built-in or our own shaders that include the fog chunks) gets it for a few instructions.
//
// The parameters live in one shared object, HAZE ({x: base height m, y: thickness m, z: strength 0–1}),
// handed by reference to every material's uniforms (three clones uniform values only when they are
// vectors or colours; a plain object stays shared). A shader without the uniform reads zeros: no haze.
import * as THREE from '../../../../vendor/three.js';

export const HAZE = { x: 0, y: 80, z: 0 };
// Aerial perspective (vista kit, js/world/toolbox/atmosphere/vista.js): distant ground fades toward a pale sky blue, more in
// the low air than on the ridgetops, so each ridge separates from the one behind it. Shared the same way:
// AERIAL = {x: distance scale m, y: strength 0–1, z: height falloff m, w: base height m}; strength 0 = off.
export const AERIAL = { x: 8000, y: 0, z: 900, w: 0 };
export const AERIAL_COLOR = { r: .66, g: .76, b: .86 };

let installed = false;
export function installHaze() {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying float vFogDepth;\n\tvarying float vFogWorldY;\n#endif';
  // world height from the view-space position: the view matrix is a rotation and a translation
  C.fog_vertex = '#ifdef USE_FOG\n\tvFogDepth = - mvPosition.z;\n'
    + '\tvFogWorldY = dot( vec3( viewMatrix[ 0 ][ 1 ], viewMatrix[ 1 ][ 1 ], viewMatrix[ 2 ][ 1 ] ), mvPosition.xyz - viewMatrix[ 3 ].xyz );\n#endif';
  C.fog_pars_fragment = C.fog_pars_fragment.replace('varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying float vFogWorldY;\n\tuniform vec3 bfHaze;\n\tuniform vec4 bfAerial;\n\tuniform vec3 bfAerialColor;');
  C.fog_fragment = C.fog_fragment.replace('\tgl_FragColor.rgb = mix(',
    '\t// valley haze: thick at the base height, thinning upward, only with some distance\n'
    + '\tfogFactor = max( fogFactor, bfHaze.z * ( 1.0 - exp( - vFogDepth / 1600.0 ) ) * exp( - max( vFogWorldY - bfHaze.x, 0.0 ) / max( bfHaze.y, 1.0 ) ) );\n'
    + '\t// aerial perspective: layered ridges, paler and bluer with distance, the low air thicker than the tops\n'
    + '\tif ( bfAerial.y > 0.0 ) gl_FragColor.rgb = mix( gl_FragColor.rgb, bfAerialColor, bfAerial.y * ( 1.0 - exp( - vFogDepth / bfAerial.x ) ) * exp( - max( vFogWorldY - bfAerial.w, 0.0 ) / bfAerial.z ) );\n'
    + '\tgl_FragColor.rgb = mix(');
  for (const shader of Object.values(THREE.ShaderLib)) Object.assign(shader.uniforms, { bfHaze: { value: HAZE }, bfAerial: { value: AERIAL }, bfAerialColor: { value: AERIAL_COLOR } });
  Object.assign(THREE.UniformsLib.fog, { bfHaze: { value: HAZE }, bfAerial: { value: AERIAL }, bfAerialColor: { value: AERIAL_COLOR } });
}
