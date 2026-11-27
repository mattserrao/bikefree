// The city kit's materials (js/world/toolbox/city/city.js draws with them): the buildings' windows and facades, the
// streets' paint and height-slot depth rule, the brick streets, the night glows, the rivers and the street lamps.
// [review 27 Nov] Moved out of city.js (T14) with their shaders unchanged (test/shader-sources.test.mjs checks the
// generated source against its snapshot).
import * as THREE from '../../../../vendor/three.js';
import { FACADE_GLSL } from '../structures/buildings/facade-material.js';   // [buildings] brick, stone, metal and window detail
import { randomSequence } from '../core/random.js';   // [review 27 Nov] seeded content
import { nightGlowShader, withNightGlow } from '../materials/night-glow.js';   // [review 27 Nov] the shared night glow
import { HASH_GLSL } from '../materials/glsl-noise.js';   // [review 27 Nov] the shared sin-free hash and value noise
import { anchor } from '../core/shader-patch.js';   // [review 27 Nov] T8: a missing shader anchor throws

// [review 27 Nov] The street height-slot depth bias, in the vertex shader (keeps early-Z). It sat under USE_LOGDEPTHBUF,
// a define r187 no longer emits, so it never ran; graph maps have a plain 24-bit depth buffer and route worlds a
// reversed float one. Plain: a constant NDC step per slot (≈3 depth-buffer steps of 2^-24 at every distance, as depth
// precision falls with w² too). Reversed: a relative step (≈3 float32 ulps). Log depth keeps the fragment bias.
export const SLOT_BIAS_VERTEX = `#ifndef USE_LOGARITHMIC_DEPTH_BUFFER
#ifdef USE_REVERSED_DEPTH_BUFFER
gl_Position.z *= 1. + aSlot * 4e-7;
#else
gl_Position.z -= aSlot * 4e-7 * gl_Position.w;
#endif
#endif`;

/**
 * [buildings] The city's facades drawn with the building kit's surfaces (when the scene has a buildingKit): brick for
 * rowhouses, commercial blocks and works, stone for towers and civic buildings, metal sheds; weather streaks; and the
 * windows (on the same grid as before, so the street kit's sills and storefronts still line up) with frames, sashes,
 * blinds and curtains, a sky streak, stone lintels and sills. Sets bfWin / bfLit like the plain version.
 */
const CITY_FACADE_GLSL = /* glsl */`
  if (abs(vWNorm.y) < .5) {
    vec2 t = normalize(vec2(-vWNorm.z, vWNorm.x));
    float along = dot(vWPos.xz, t), up = vWPos.y - vBld.z;
    float px = max(length(vec2(dFdx(along), dFdy(along))), length(vec2(dFdx(vWPos.y), dFdy(vWPos.y)))) + 1e-5;
    float det = 1. - smoothstep(.025, .08, px), detW = 1. - smoothstep(.1, .3, px);
    float sd = fract(vBld.y * .0137 + .21), wear = .25 + .5 * fract(vBld.y * .071);
    bool glass = bfKind == 5 || bfKind == 6;
    // the wall: brick (rowhouses, most commercial blocks, works), stone (towers, civic, churches, a share of
    // commercial), painted brick, concrete (garages), corrugated metal (some works)
    vec3 base = diffuseColor.rgb, c = base;
    if (!glass && bfKind != 9 && bfKind != 10) {
      bool stone = bfKind == 4 || bfKind == 11 || bfKind == 7 || (bfKind == 2 && sd > .62);
      bool painted = (bfKind == 0 || bfKind == 2) && sd < .1;
      if (bfKind == 8) c = bkCourses(base, along, vWPos.y, detW, sd, 2.9, 3.2, .015, .06);
      else if (bfKind == 3 && sd > .6) c = base * (.88 + .16 * sin(6.2832 * along / .076) * det);
      else if (stone) c = bfKind == 7 ? bkRubble(base, along, vWPos.y, det, sd) : bkCourses(base, along, vWPos.y, det, sd, .42, .9, .01, .12);
      else c = bkCourses(base, along, vWPos.y, det, sd, .075, .23, .006, painted ? .05 : .22);
      if (painted) c = mix(c, base * 1.12, .55);
      // weather: long streaks from the parapet, soot low down, big soft patches
      c *= .95 + .1 * bkF(vec2(along, vWPos.y) * .15 + sd * 9.);
      c *= 1. - wear * .16 * smoothstep(.55, 1., vn2(vec2(along * 1.6, vWPos.y * .08) + sd * 5.));
      c *= 1. - wear * .12 * (1. - smoothstep(0., 1.4, up + 3.));
      diffuseColor.rgb = c;
    }
    if (vBld.w < .5) {
      bool small = bfKind == 0 || bfKind == 1;
      float fh = small ? 3.1 : glass ? 3.9 : 3.6;
      float cw = small ? 2.3 : glass ? 1.55 : bfKind == 9 ? 1.9 : 2.6;
      vec2 cell = vec2(along / cw, up / fh), id = floor(cell), f = fract(cell);
      vec2 lo = glass ? vec2(.05, .1) : vec2(.24, .28), hi = glass ? vec2(.95, .94) : vec2(.76, .86);
      bool shopRow = false;
      bfWin = step(lo.x, f.x) * step(f.x, hi.x) * step(lo.y, f.y) * step(f.y, hi.y);
      if (id.y < 1.) {
        shopRow = bfKind == 2 || (bfKind == 0 && hw21(id + vBld.y) > .45);
        if (shopRow) { lo = vec2(.07, .12); hi = vec2(.93, .78); bfWin = step(lo.x, f.x) * step(f.x, hi.x) * step(lo.y, f.y) * step(f.y, hi.y); }
        else bfWin *= step(.5, hw21(id.xx + vBld.y));
      }
      if (bfKind == 3 || bfKind == 8 || bfKind == 7) bfWin *= step(.55, hw21(vec2(id.y, vBld.y)));
      vec3 glassCol = (bfKind == 6 ? vec3(.07, .09, .11) : vec3(.13, .16, .2)) + uSkyTop * (glass ? .22 : .12) * (1. - uNight);
      if (glass) diffuseColor.rgb = mix(diffuseColor.rgb, glassCol, bfWin * .93);
      else {
        // the window in metres, centred
        vec2 hw = vec2((hi.x - lo.x) * .5 * cw, (hi.y - lo.y) * .5 * fh);
        vec2 q = vec2((f.x - (lo.x + hi.x) * .5) * cw, (f.y - (lo.y + hi.y) * .5) * fh);
        float h = hw21(id * 1.91 + vBld.y), h2 = hw21(id.yx * 2.7 + vBld.y * 3.1);
        bool brick = bfKind == 0 || bfKind == 2 || bfKind == 3;
        vec3 frameC = bfKind == 3 || bfKind == 8 ? vec3(.06, .065, .07) : mix(vec3(.82, .8, .76), vec3(.08, .07, .065), step(.82, fract(vBld.y * .37)));
        vec3 stoneC = bkLin(vec3(.78, .75, .69));
        float inWin = bfWin;
        // lintel and sill (only round real windows)
        if (inWin > .5 || bkBox(q, -hw - vec2(.2, .3), hw + vec2(.2, .35), px) > 0.) {
          bool has = id.y < 1. ? (shopRow || hw21(id.xx + vBld.y) > .5) : true;
          if (bfKind == 3 || bfKind == 8 || bfKind == 7) has = has && hw21(vec2(id.y, vBld.y)) > .55;
          if (has && !shopRow && brick) {
            vec3 lin = fract(vBld.y * .53) > .4 ? stoneC : diffuseColor.rgb * .8;
            diffuseColor.rgb = mix(diffuseColor.rgb, lin, bkBox(q, vec2(-hw.x - .12, hw.y + .02), vec2(hw.x + .12, hw.y + .26), px) * detW);
            diffuseColor.rgb = mix(diffuseColor.rgb, stoneC, bkBox(q, vec2(-hw.x - .08, -hw.y - .11), vec2(hw.x + .08, -hw.y - .01), px) * detW);
            // a dark drip below the sill
            diffuseColor.rgb *= 1. - wear * .3 * detW * step(abs(q.x), hw.x) * (1. - smoothstep(0., 1.1, -q.y - hw.y)) * step(hw.y, -q.y) * vn2(vec2(along * 9., vWPos.y * .4));
          }
        }
        // glass: a sky streak, blinds or curtains, the sash's meeting rail and frame
        vec3 g = glassCol;
        float streak = smoothstep(.15, .5, fract((q.x + q.y * .7) * .5 + h * 3.)) * (1. - smoothstep(.5, .85, fract((q.x + q.y * .7) * .5 + h * 3.)));
        g = mix(g, bkLin(vec3(.6, .7, .82)), (streak * .3 + .05) * (1. - uNight));
        if (!shopRow) {
          float blind = hw.y - (.15 + h2 * 1.2) * hw.y;
          if (h2 > .35) g = mix(g, mix(bkLin(vec3(.86, .84, .78)), bkLin(vec3(.74, .7, .62)), step(.7, h2)), step(blind, q.y) * .85 * (1. - uNight * .6));
          else if (h2 > .18) g = mix(g, bkLin(vec3(.82, .8, .76)), smoothstep(.55, .85, abs(q.x) / hw.x) * .6);
          float m = max(1. - smoothstep(.025, .025 + px, abs(q.y)), small ? 1. - smoothstep(.02, .02 + px, abs(q.x)) : 0.);
          g = mix(g, frameC, m * detW);
        }
        // (business pass, user 26 Nov — "window life"): frames in a building's own colour now and then (green, oxblood,
        // bronze), not only white or black
        float fv = fract(vBld.y * .61);
        if (fv > .78 && bfKind != 3 && bfKind != 8) frameC = fv > .93 ? bkLin(vec3(.2, .3, .24)) : fv > .86 ? bkLin(vec3(.36, .14, .12)) : bkLin(vec3(.33, .27, .2));
        float fr = 1. - bkBox(q, -hw + .06, hw - .06, px);
        g = mix(g, frameC, fr * detW);
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(glassCol, g, detW), bfWin * .95);
        // a window air conditioner in about one upper window in nine (older brick and stone blocks): a grey box on
        // the sill with its grille, a dark drip under it
        if (!shopRow && id.y >= 1. && hw21(id * 3.17 + vBld.y * 7.3) > .89 && (bfKind == 0 || bfKind == 2 || bfKind == 4)) {
          float ac = bkBox(q, vec2(-.34, -hw.y - .04), vec2(.34, -hw.y + .4), px);
          vec3 acC = bkLin(vec3(.72, .72, .69)) * (.9 + .1 * step(.5, fract(q.y * 18.)));
          diffuseColor.rgb = mix(diffuseColor.rgb, acC, ac * detW);
          diffuseColor.rgb *= 1. - .25 * detW * step(abs(q.x), .2) * step(q.y, -hw.y - .04) * (1. - smoothstep(0., .9, -hw.y - .04 - q.y));
        }
      }
      bfLit = bfWin * step(glass ? .5 : .58, hw21(id * 1.37 + vBld.y * 17.));
      // [business pass] at dusk and night more of an office block's windows burn (the cleaners, the late workers),
      // in two colour temperatures; a shop row's upper flats less
      if (uNight > .01 && !glass && bfKind == 2) bfLit = max(bfLit, bfWin * step(.42, hw21(id * 2.31 + vBld.y * 5.)));
    }
    // [business pass] wall detail on the masonry blocks (user, 26 Nov): a stone belt course at every floor line on
    // some, a cornice band under the parapet, cast-iron downspouts, a fire escape on a share of the older brick
    // blocks, and now and then a faded painted sign (a ghost sign) high on the wall
    if (!glass && (bfKind == 0 || bfKind == 2 || bfKind == 3 || bfKind == 4) && vBld.w < .5) {
      float fh2 = (bfKind == 0 || bfKind == 1) ? 3.1 : 3.6, fl = up / fh2, ff = fract(fl), top = bfTop > .5 ? bfTop : 1e4;
      vec3 trim = bkLin(vec3(.78, .74, .66)) * (.9 + .15 * fract(vBld.y * .29));
      if (fract(vBld.y * .43) > .45 && fl > .9) diffuseColor.rgb = mix(diffuseColor.rgb, trim, (1. - smoothstep(.035, .035 + px / fh2, abs(ff - .985))) * detW * .9);
      diffuseColor.rgb = mix(diffuseColor.rgb, trim * .92, bkBox(vec2(along, up), vec2(-1e5, top - 1.15), vec2(1e5, top - .7), px) * detW * step(.3, fract(vBld.y * .77)));
      // downspouts every 11–17 m, dark, with a lighter edge
      float sp = 11. + 6. * fract(vBld.y * .19), ds = abs(fract(along / sp + fract(vBld.y * .07)) - .5) * sp;
      diffuseColor.rgb = mix(diffuseColor.rgb, bkLin(vec3(.16, .16, .16)), (1. - smoothstep(.06, .06 + px, ds)) * step(.5, up) * step(up, top) * det * .85);
      // the fire escape: one bay of the older brick blocks — a black platform at each floor, a ladder between
      if ((bfKind == 0 || bfKind == 2) && fract(vBld.y * .91) > .62 && up > 3.4 && up < top - .6) {
        float bay = 2.6 * (1. + floor(fract(vBld.y * 1.3) * 3.)), bx = along - bay, w2 = 3.4;
        if (bx > -.2 && bx < w2) {
          float plat = 1. - smoothstep(.05, .05 + px, abs(ff - .02) * fh2);
          float rail = 1. - smoothstep(.03, .03 + px, abs(ff - .3) * fh2);
          float slat = (1. - smoothstep(.02, .02 + px, abs(fract(bx / .45) - .5) * .45)) * step(ff, .3);
          float stair = 1. - smoothstep(.05, .05 + px, abs((ff * fh2) - (mod(floor(fl), 2.) > .5 ? bx : w2 - bx) * .95));
          diffuseColor.rgb = mix(diffuseColor.rgb, bkLin(vec3(.06, .06, .065)), clamp(plat + rail * .9 + slat * .7 + stair * .9, 0., 1.) * det * .92);
        }
      }
      // a ghost sign: a faded painted panel with a lettered band, high on a third of the works and old blocks
      if ((bfKind == 3 || bfKind == 2) && fract(vBld.y * 1.77) > .7 && top > 7. && top < 1e3) {
        float gx = 2. + 6. * fract(vBld.y * 2.3), gw = 9. + 5. * fract(vBld.y * 3.1);
        float panel = bkBox(vec2(along, up), vec2(gx, top - 5.2), vec2(gx + gw, top - 1.6), px);
        float letters = step(.45, vn2(vec2(along * 1.4, floor((up - top) * 1.1)) + vBld.y)) * bkBox(vec2(along, up), vec2(gx + .6, top - 4.2), vec2(gx + gw - .6, top - 2.6), px);
        vec3 paint = mix(bkLin(vec3(.86, .82, .7)), bkLin(vec3(.55, .2, .16)), step(.5, fract(vBld.y * 5.7)));
        float fade = .38 + .2 * vn2(vec2(along, up) * .6);
        diffuseColor.rgb = mix(diffuseColor.rgb, paint, panel * fade * (1. - bfWin) * detW);
        diffuseColor.rgb = mix(diffuseColor.rgb, bkLin(vec3(.93, .9, .8)), letters * fade * (1. - bfWin) * detW * .8);
      }
      // weathering: streaks down from each window's sill corners and from the parapet, grime gathering near the base
      float streaks = vn2(vec2(along * 2.3, vWPos.y * .12) + vBld.y) * smoothstep(top - 4., top, up);
      diffuseColor.rgb *= 1. - wear * .14 * smoothstep(.6, .9, streaks);
      diffuseColor.rgb *= 1. - wear * .1 * (1. - smoothstep(.0, 2.2, up));
    }
  } else if (vBld.w > .5 && vWNorm.y > .5) {
    // flat roofs: gravel and patched membrane
    vec2 rp = vWPos.xz;
    diffuseColor.rgb *= (.9 + .2 * hw21(floor(rp * 18.))) * (.92 + .14 * smoothstep(.4, .7, vn2(rp * .35 + vBld.y)));
  }
`;

/**
 * Buildings: vertex colour + procedural windows (glass by day, some lit warm at night). [buildings] With a buildingKit in
 * the scene (`facades`), the walls also get the kit's brick, stone, render and metal, and the windows frames, sashes,
 * blinds, lintels and sills (CITY_FACADE_GLSL). U: the city's uniforms (uSkyTop); nightOf(): the night uniform at
 * compile time (a host's own, softer window light — js/world/graph-heroes.js — may be set after the material is made).
 */
export function cityBuildingMaterial(U, nightOf, facades) {
  const bm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .86, metalness: .02 });
  bm.onBeforeCompile = (shader) => {
    shader.uniforms.uSkyTop = U.uSkyTop;
    shader.vertexShader = shader.vertexShader
      .replace(anchor('#include <common>'), '#include <common>\nattribute vec4 aBld; varying vec4 vBld; varying vec3 vWPos; varying vec3 vWNorm;')
      .replace(anchor('#include <fog_vertex>'), '#include <fog_vertex>\nvBld = aBld; vWPos = (modelMatrix * vec4(transformed, 1.)).xyz; vWNorm = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace(anchor('#include <common>'), `#include <common>
          uniform vec3 uSkyTop; varying vec4 vBld; varying vec3 vWPos; varying vec3 vWNorm;
          ${HASH_GLSL}
          ${facades ? FACADE_GLSL : ''}`)
      .replace(anchor('#include <color_fragment>'), `#include <color_fragment>
          float bfWin = 0., bfLit = 0.;
          int bfKind = int(mod(vBld.x + .5, 16.));   // (aBld.x: kind + 16 × the building's height in m, when known)
          float bfTop = floor((vBld.x + .5) / 16.);
          ${facades ? CITY_FACADE_GLSL : ''}
          if (!${facades ? 'true' : 'false'} && vBld.w < .5 && abs(vWNorm.y) < .5) {
            vec2 t = normalize(vec2(-vWNorm.z, vWNorm.x));
            float along = dot(vWPos.xz, t), up = vWPos.y - vBld.z;
            bool glass = bfKind == 5 || bfKind == 6;
            bool small = bfKind == 0 || bfKind == 1;
            float fh = small ? 3.1 : glass ? 3.9 : 3.6;
            float cw = small ? 2.3 : glass ? 1.55 : bfKind == 9 ? 1.9 : 2.6;
            vec2 cell = vec2(along / cw, up / fh), id = floor(cell), f = fract(cell);
            vec2 lo = glass ? vec2(.05, .1) : vec2(.24, .28), hi = glass ? vec2(.95, .94) : vec2(.76, .86);
            // [fidelity step 10] façade depth: the punched windows set 15 cm into the wall — the glass seen through the
            // opening shifted by the view (parallax), the reveal (jamb and head in shade) showing round it, a sill below
            vec3 bfV = normalize(cameraPosition - vWPos); float bfDn = max(dot(bfV, vWNorm), .2);
            vec2 bfSh = glass ? vec2(0.) : vec2(dot(bfV.xz, t) / cw, bfV.y / fh) / bfDn * .15;
            vec2 fg = f + bfSh;
            float bfOpen = step(lo.x, f.x) * step(f.x, hi.x) * step(lo.y, f.y) * step(f.y, hi.y);
            bfWin = bfOpen * step(lo.x, fg.x) * step(fg.x, hi.x) * step(lo.y, fg.y) * step(fg.y, hi.y);
            if (!glass) {
              diffuseColor.rgb *= 1. - .45 * max(bfOpen - bfWin, 0.);   // the reveal, in shade
              float bfSill = step(lo.x - .03, f.x) * step(f.x, hi.x + .03) * step(lo.y - .045, f.y) * step(f.y, lo.y - .005);
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.72, .7, .66), bfSill * step(1., id.y) * .85);
            }
            if (id.y < 1.) bfWin = (bfKind == 2 || (bfKind == 0 && hw21(id + vBld.y) > .45)) ? step(.07, f.x) * step(f.x, .93) * step(.12, f.y) * step(f.y, .78) : bfWin * step(.5, hw21(id.xx + vBld.y));
            if (bfKind == 3 || bfKind == 8 || bfKind == 7) bfWin *= step(.55, hw21(vec2(id.y, vBld.y)));
            vec3 glassCol = (bfKind == 6 ? vec3(.07, .09, .11) : vec3(.13, .16, .2)) + uSkyTop * (glass ? .22 : .12) * (1. - uNight);
            // (the glass mirrors the sky more at a glancing angle: Fresnel)
            glassCol += uSkyTop * pow(1. - bfDn, 4.) * .5 * (1. - uNight);
            diffuseColor.rgb = mix(diffuseColor.rgb, glassCol, bfWin * (glass ? .93 : .86));
            bfLit = bfWin * step(glass ? .5 : .58, hw21(id * 1.37 + vBld.y * 17.));
          }`)
      .replace(anchor('#include <roughnessmap_fragment>'), '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, .22, bfWin);');
    // (windowNight: a host's own, softer window light — js/world/graph-heroes.js) [review 27 Nov] the shared night glow
    nightGlowShader(shader, nightOf(), 'mix(vec3(1., .74, .42), vec3(.85, .9, 1.), step(.8, hw21(vWPos.xz * .01 + vBld.y))) * bfLit * uNight * 1.25');
  };
  bm.customProgramCacheKey = () => facades ? 'city-buildings-facades-1' : 'city-buildings-2';
  return bm;
}

/**
 * Streets: asphalt with lane paint, and (scene "brickStreets") brick streets; both with the height-slot depth rule.
 * own(x): the city's disposables (the textures and materials are its own). junctions: the city has junction meshes.
 */
export function cityStreetMaterials(own, junctions) {
  // [s1-lanes] three paint styles side by side (u 0–.75 in thirds, see streetPaint): two-way with a double yellow
  // centre line; one-way multi-lane (divided highways, one-way pairs): yellow left edge, dashed white lanes;
  // one-way single lane (ramps): edge lines only. [junctions] u .77–.98: the white block for crosswalks and stop
  // lines (junction-mesh.js PAINT_U); junction surfaces sample the plain asphalt of the two-way style (u .02–.11)
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = junctions ? '#555c60' : '#505457'; ctx.fillRect(0, 0, 256, 256);   // [junctions] the route's road's asphalt
  const ar = randomSequence(4127);   // [review 27 Nov] seeded (TOOLBOX rule 3: the asphalt the same every build)
  for (let k = 0; k < 10000; k++) { const g = 70 + ar() * 26; ctx.fillStyle = `rgba(${g},${g + 2},${g + 4},.45)`; ctx.fillRect(ar() * 256, ar() * 256, 1, 1); }
  ctx.fillStyle = '#e4e1d6'; ctx.fillRect(196, 0, 56, 256);   // [junctions] crosswalk and stop-line white
  ctx.fillStyle = '#d9d6c8'; ctx.fillRect(3, 0, 1.5, 256); ctx.fillRect(59.5, 0, 1.5, 256);
  ctx.fillStyle = '#d6b44c'; ctx.fillRect(30.5, 0, 1.4, 150); ctx.fillRect(32.6, 0, 1.4, 150);
  ctx.fillStyle = '#d6b44c'; ctx.fillRect(64 + 4, 0, 1.6, 256); ctx.fillRect(128 + 4, 0, 1.6, 256);
  ctx.fillStyle = '#d9d6c8'; ctx.fillRect(64 + 58.5, 0, 1.5, 256); ctx.fillRect(128 + 58.5, 0, 1.5, 256);
  for (const x of [64 + 23, 64 + 41]) ctx.fillRect(x, 0, 1.3, 96);
  const tex = own(new THREE.CanvasTexture(c)); tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const offset = (f) => ({ polygonOffset: true, polygonOffsetFactor: f, polygonOffsetUnits: f });
  const streetMaterial = own(new THREE.MeshStandardMaterial({ map: tex, roughness: .93, ...offset(-1.6) }));
  // Each road ribbon carries its height slot (aSlot), and the depth test settles overlaps by it: where two
  // streets meet at one height, the higher slot always wins, at any distance (their surfaces drift a few cm
  // relative to each other inside a junction, which a 2 cm lift alone can't outweigh).
  streetMaterial.userData.slotDepthBias = true;
  streetMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(anchor('#include <common>'), '#include <common>\nattribute float aSlot; varying float vSlot;')
      .replace(anchor('#include <begin_vertex>'), '#include <begin_vertex>\nvSlot = aSlot;')
      // [junctions] road paint (slot 9: crosswalks, stop lines, the plain asphalt over the route's road in a junction) is
      // drawn a hair nearer along the view ray (same pixel, nearer depth), so it always wins over the road it lies on
      .replace(anchor('#include <project_vertex>'), '#include <project_vertex>\nif (aSlot > 8.5) { mvPosition.xyz *= .9994; gl_Position = projectionMatrix * mvPosition; }\n' + SLOT_BIAS_VERTEX);
    shader.fragmentShader = shader.fragmentShader.replace(anchor('#include <common>'), '#include <common>\nvarying float vSlot;')
      .replace(anchor('#include <logdepthbuf_fragment>'), '#include <logdepthbuf_fragment>\n#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )\ngl_FragDepth -= vSlot * 2e-6;\n#endif');
  };
  streetMaterial.customProgramCacheKey = () => 'city-streets-slot-4';   // [junctions]; [review 27 Nov] slot bias in the vertex shader
  // [finish] brick streets (scene "brickStreets"): Pittsburgh's red paving brick in running bond, laid across the street,
  // worn darker in the wheel tracks, with the odd asphalt patch. One 256 px tile is the street's width × 4 m.
  let brickMaterial;
  {
    const b = document.createElement('canvas'); b.width = b.height = 256;
    const g = b.getContext('2d'), rnd = (() => { let t = 7; return () => ((t = (t * 16807) % 2147483647) / 2147483647); })();
    g.fillStyle = '#2e2926'; g.fillRect(0, 0, 256, 256);   // mortar / sand joints
    const rows = 32, rh = 256 / rows, bw = 5.6;
    const reds = ['#6e3a2e', '#623326', '#774032', '#5a2f26', '#6c3d31', '#653a2f', '#7a4536'];
    for (let r = 0; r < rows; r++) for (let x = -(r % 2) * bw / 2; x < 256; x += bw) {
      g.fillStyle = reds[Math.floor(rnd() * reds.length)]; g.fillRect(x + .45, r * rh + .45, bw - .9, rh - .9);
    }
    for (const cx of [64, 192]) { const gr = g.createLinearGradient(cx - 34, 0, cx + 34, 0); gr.addColorStop(0, 'rgba(25,20,18,0)'); gr.addColorStop(.5, 'rgba(25,20,18,.28)'); gr.addColorStop(1, 'rgba(25,20,18,0)'); g.fillStyle = gr; g.fillRect(cx - 34, 0, 68, 256); }   // wheel tracks
    g.fillStyle = 'rgba(70,72,74,.85)'; g.fillRect(150, 40, 60, 34); g.fillRect(20, 180, 44, 26);   // asphalt patches
    const bt = own(new THREE.CanvasTexture(b)); bt.wrapT = THREE.RepeatWrapping; bt.repeat.set(1, 6); bt.colorSpace = THREE.SRGBColorSpace; bt.anisotropy = 8;
    brickMaterial = own(new THREE.MeshStandardMaterial({ map: bt, roughness: .9, ...offset(-1.6) }));
    brickMaterial.userData.slotDepthBias = true;
    brickMaterial.onBeforeCompile = streetMaterial.onBeforeCompile;   // the same height-slot depth rule as the streets
    // [review 27 Nov] the streets' key too: the same shader (only the map differs, a uniform), so one program, not two
    // (its own '-brick' key compiled an identical twin: Pittsburgh at night, 58 programs → 57)
    brickMaterial.customProgramCacheKey = streetMaterial.customProgramCacheKey;
  }
  return { streetMaterial, brickMaterial };
}

/** Camera-facing additive glows, faded in with the night (lamps, beacons, headlights). */
export function cityGlowMaterial(night) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uNight: night },
    vertexShader: /* glsl */`
        attribute vec3 aGlow; varying vec3 vColor; varying vec2 vUv;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main() {
          vUv = uv; vColor = aGlow;
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(0., 0., 0., 1.);
          float size = length(instanceMatrix[0].xyz);
          mv.xy += (uv - .5) * size;
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
    fragmentShader: /* glsl */`
        uniform float uNight; varying vec3 vColor; varying vec2 vUv;
        #include <logdepthbuf_pars_fragment>
        void main() {
          #include <logdepthbuf_fragment>
          float r = length(vUv - .5) * 2.;
          float a = (exp(-r * r * 4.) * .9 + exp(-r * r * 40.)) * uNight;
          if (a < .004) discard;
          gl_FragColor = vec4(vColor * a, a);
        }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  return m;
}

/**
 * The rivers: flow-mapped ripples carried downstream, the Allegheny green and the Monongahela browner, sky and sun on
 * the water, city lights at night. dt: the water mask (r) and its blurred depth (g); box [x0, z0, x1, z1]: the mask's
 * extent; hole [x0, z0, x1, z1]: an area left out (the city's box, for the water beyond it); fields: the flow texture.
 */
export function cityRiverMaterial(U, night, dt, [x0, z0, x1, z1], hole = null, fields = null) {
  return new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: U.uTime, uSunDir: U.uSunDir, uSkyTop: U.uSkyTop, uSkyHorizon: U.uSkyHorizon,
      uNight: night, uMask: { value: dt }, uBox: { value: new THREE.Vector4(x0, z0, x1 - x0, z1 - z0) }, uHole: { value: new THREE.Vector4(...(hole || [1, 1, -1, -1])) },
      uDeep: { value: new THREE.Color('#2f5a5c') }, uShallow: { value: new THREE.Color('#5d7f6a') },
      uFlow: { value: fields || dt }, uHasFlow: { value: fields ? 1 : 0 },
      // the Allegheny runs green and clear, the Monongahela browner; the Ohio is their blend
      uAlleDeep: { value: new THREE.Color('#284a42') }, uAlleShallow: { value: new THREE.Color('#4c7563') },
      uMonDeep: { value: new THREE.Color('#584f34') }, uMonShallow: { value: new THREE.Color('#7f744e') } },
    vertexShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_vertex>
        #include <fog_pars_vertex>
        varying vec3 vW;
        void main() { vW = (modelMatrix * vec4(position, 1.)).xyz; vec4 mvPosition = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mvPosition;
          #include <logdepthbuf_vertex>
          #include <fog_vertex>
        }`,
    fragmentShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_fragment>
        #include <fog_pars_fragment>
        uniform float uTime, uNight, uHasFlow; uniform vec3 uSunDir, uSkyTop, uSkyHorizon, uDeep, uShallow, uAlleDeep, uAlleShallow, uMonDeep, uMonShallow;
        uniform sampler2D uMask, uFlow; uniform vec4 uBox, uHole;
        varying vec3 vW;
        ${HASH_GLSL}
        void main() {
          #include <logdepthbuf_fragment>
          if (vW.x > uHole.x && vW.z > uHole.y && vW.x < uHole.z && vW.z < uHole.w) discard;
          vec2 uv = (vW.xz - uBox.xy) / uBox.zw;
          vec4 m = texture2D(uMask, uv);
          if (m.r < .02) discard;
          vec2 p = vW.xz;
          float near = 1. - smoothstep(300., 2600., length(cameraPosition.xz - p));
          vec4 fl = texture2D(uFlow, uv);
          vec2 dir = uHasFlow > .5 ? fl.rg * 2. - 1. : vec2(0.);
          float flowing = clamp(length(dir) * 1.4, 0., 1.); dir = flowing > .01 ? normalize(dir) : vec2(1., 0.);
          // the current: ripples carried downstream (flow-mapped: two phases, cross-faded), plus long slick lines
          float ph = fract(uTime * .04), w0 = abs(ph - .5) * 2.;
          vec2 o0 = dir * ph * 46. * flowing, o1 = dir * fract(ph + .5) * 46. * flowing;
          float r1 = mix(vn2((p - o1) * .09 + vec2(uTime * .05)), vn2((p - o0) * .09 + vec2(7.3, 1.1) + vec2(uTime * .05)), w0);
          float r2 = mix(vn2((p - o1) * .23 + 3.1), vn2((p - o0) * .23 + 9.4), w0);
          vec2 q = vec2(dot(p, dir), dot(p, vec2(-dir.y, dir.x)));
          float slick = smoothstep(.55, .9, vn2(vec2((q.x - uTime * 1.1) * .012, q.y * .11))) * flowing;
          vec3 N = normalize(vec3((r1 - .5) * .09 * near, 1., (r2 - .5) * .09 * near));
          vec3 V = normalize(cameraPosition - vW);
          float fres = .04 + .5 * pow(1. - max(dot(N, V), 0.), 4.);
          vec3 R = reflect(-V, N);
          vec3 sky = mix(uSkyHorizon, uSkyTop, sqrt(max(R.y, 0.)));
          float alle = uHasFlow > .5 ? fl.b : .5, blend = uHasFlow > .5 ? fl.a : 1.;
          vec3 deepC = mix(mix(uMonDeep, uAlleDeep, alle), uDeep, blend), shallowC = mix(mix(uMonShallow, uAlleShallow, alle), uShallow, blend);
          vec3 col = mix(shallowC, deepC, smoothstep(.15, .85, m.g)) * (.92 + vn2(p * .01) * .16);
          col *= 1. + slick * .07;
          col = mix(col, sky, fres * (1. - slick * .5) * .8);
          // the sun on the water: a broad warm sheen, a tight highlight, and sparkles that glitter in it
          vec3 Ls = normalize(uSunDir);
          float spec = max(dot(reflect(-Ls, N), V), 0.);
          float low = 1. - smoothstep(.15, .6, Ls.y);   // strongest with the sun low (golden hour)
          float sparkle = step(.93, vn2(p * 1.7 + vec2(uTime * 2.3, -uTime * 1.9))) * pow(spec, 12.) * near;
          col += vec3(1., .86, .6) * (pow(spec, 140.) * .8 + pow(spec, 22.) * .18 * (.4 + low) + sparkle * 1.4 * (.5 + low)) * (1. - uNight);
          col *= mix(1., .16, uNight);
          // city lights on the water at night: streaks stretched toward the viewer, strongest near the banks
          vec2 toCam = normalize(cameraPosition.xz - p + 1e-3);
          vec2 sq = vec2(dot(p, vec2(-toCam.y, toCam.x)), dot(p, toCam));
          float lights = smoothstep(.7, .95, vn2(vec2(sq.x * .45, sq.y * .018 + uTime * .02))) * (1. - smoothstep(.15, .75, m.g));
          float wob = .75 + .25 * sin(sq.y * .5 + uTime * 2. + sq.x);
          col += mix(vec3(1., .74, .4), vec3(.85, .9, 1.), step(.6, vn2(vec2(sq.x * .2, 3.)))) * lights * wob * uNight * .7;
          col = mix(col, vec3(.78, .82, .76), (1. - smoothstep(.0, .14, m.g)) * .35 * (1. - uNight * .7));
          gl_FragColor = vec4(col, 1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    fog: true,
  });
}

/** The street lamps' posts: the lamp head's lens (vertex colour blue ≥ .95) glows after dark. */
export function cityLampMaterial(night) {
  const poleMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .6, metalness: .4 });
  withNightGlow(poleMat, night, 'step(.95, vColor.b) * vec3(1., .85, .6) * uNight * 3.', 'city-lamp-1');   // [review 27 Nov] the shared night glow
  return poleMat;
}
