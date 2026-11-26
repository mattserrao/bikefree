// The colour grade and key light (user, 25 Nov 2026 — the Zwift reference: "saturated warm palette, strong sun/shade
// contrast, bright sky through gaps, slight glow"):
//   grade   ACES, then a grade in the tone mapping itself (renderer.toneMapping = CustomToneMapping), so every path
//           gets it — the plain canvas (phones, Balanced) and the post pass's composite (desktop High) alike, and the
//           tree cards' own shader: saturation, an S-curve of contrast in display space, a warm tint, a little lift
//   light   the sun and the sky light scaled (sun ×, sky ×): a stronger key against a softer fill — the shade reads
//           as shade, the sun as sun; exposure ×
// Options: { saturation: 1.15, contrast: .16, warm: .4, lift: .015, sun: 1.12, sky: .9, exposure: 1,
//            shadows: [r, g, b], highlights: [r, g, b], split: .5 }. Shader only.
//   split toning (fidelity plan step 4, "the LUT grade" — analytic, so no 3D texture and no extra pass): the shadows
//   tinted one way, the highlights another, by luminance (e.g. Out West: violet shade, amber light — a moody desert)
import * as THREE from '../../../../vendor/three.js';

const ORIG = THREE.ShaderChunk.tonemapping_pars_fragment;
const DEFAULT = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
const f = (v) => Number(v).toFixed(4);

/** The grade's GLSL (a CustomToneMapping that runs ACES first). */
export function gradeChunk({ saturation = 1.15, contrast = .16, warm = .4, lift = .015, shadows = null, highlights = null, split = .5 } = {}) {
  const v3 = (a) => `vec3( ${a.map(f).join(', ')} )`;
  const tone = shadows || highlights ? `{ float sl = smoothstep( .0, ${f(split)}, l ), sh = 1. - sl;
    g *= mix( vec3( 1. ), ${v3(shadows || [1, 1, 1])}, sh * .9 ) * mix( vec3( 1. ), ${v3(highlights || [1, 1, 1])}, sl * smoothstep( ${f(split)}, 1., l + .3 ) ); }` : '';
  return /* glsl */`vec3 CustomToneMapping( vec3 color ) {
    vec3 c = ACESFilmicToneMapping( color );
    float l = dot( c, vec3( .2126, .7152, .0722 ) );
    c = max( vec3( 0. ), mix( vec3( l ), c, ${f(saturation)} ) );
    vec3 g = pow( c, vec3( 1. / 2.2 ) );
    g = mix( g, g * g * ( 3. - 2. * g ), ${f(contrast)} );
    g = g * ( 1. - ${f(lift)} ) + ${f(lift)};
    g *= 1. + ${f(warm)} * vec3( .035, .008, -.045 ) * smoothstep( .15, .9, l + .2 );
    ${tone}
    return clamp( pow( max( g, vec3( 0. ) ), vec3( 2.2 ) ), 0., 1. );
  }`;
}

export const grade = {
  install(world, opts = {}) {
    const r = world.renderer; if (!r) return {};
    THREE.ShaderChunk.tonemapping_pars_fragment = ORIG.replace(DEFAULT, gradeChunk(opts));
    r.toneMapping = THREE.CustomToneMapping;
    world.lightTune = { sun: opts.sun ?? 1.12, sky: opts.sky ?? .9, exposure: opts.exposure ?? 1 };
    return {
      setVisible(v) { r.toneMapping = v ? THREE.CustomToneMapping : THREE.ACESFilmicToneMapping; },
      dispose() { THREE.ShaderChunk.tonemapping_pars_fragment = ORIG; },
    };
  },
};
