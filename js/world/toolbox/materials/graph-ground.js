// The graph maps' ground (js/world/graph-world.js): its vertex colour (grass, cut slopes, river bed) under the city's
// land cover from a texture of codes, the desert's layered rock, the ground's small relief, a hero area's singletrack
// and big trees' roots, the PBR turf. [review 27 Nov] W13: moved out of graph-world.js as a pure factory, its cache
// key and generated shader unchanged byte for byte (test/world-materials.test.mjs); patches through patchShader.
import * as THREE from '../../../../vendor/three.js';
import { litMaterial } from './lit.js';
import { PBR_GLSL, PBR_NORMAL_GLSL, GROUND_PBR } from './pbr-sets.js';
import { SURFACE, SURFACE_SUN, SURFACE_GLSL } from './surface-detail.js';
import { GROUND_LOOK } from './road-look.js';
import { CANOPY, CANOPY_GLSL } from '../atmosphere/canopy-shade.js';
import { CLOUD_T, GW_NOISE_GLSL, patch } from './graph-road.js';

const ROOTS_N = 24;   // a hero area's big trees whose roots the ground draws (uRoots)

/**
 * The ground: its vertex colour (grass, cut slopes, river bed), and over it the city's land cover (aLandW: how much)
 * from a texture of codes (js/world/graph-city.js LAND): paved lots and yards, lawns and parks, the woods' floor,
 * plazas, sand — with a little noise in the edges so they aren't the grid's. low (Light, phones): one noise for the
 * land cover's shading, no wobble on its edges; rural: the upstate grass; soft: the covers' edges only wander;
 * desert: the red-rock covers and layered cliffs. m.userData.land: its land-cover and root uniforms (set per world).
 */
export function groundMaterial(low = false, rural = false, soft = false, desert = false) {
  const m = litMaterial({ vertexColors: true }, 'ground');
  m.defines = {};
  if (soft) m.defines.SOFTCOVER = '';   // (NYC: the covers' edges only wander — no scatter of grains, read as a blocky stipple)
  if (low) m.defines.LOWQ = '';
  if (rural) m.defines.NYGRASS = '';
  if (desert) m.defines.DESERT = '';   // (Out West: the red-rock covers, 40–42)
  const blank = new THREE.DataTexture(new Uint8Array([1]), 1, 1, THREE.RedFormat); blank.needsUpdate = true;
  const U = { uLand: { value: blank }, uLandBox: { value: new THREE.Vector4(0, 0, 1, 1) }, uLandOn: { value: 0 },
    // a hero area's big trees near the camera (old-growth.js): x, z, trunk radius, seed — their root tops and bare soil
    uRoots: { value: Array.from({ length: ROOTS_N }, () => new THREE.Vector4()) }, uRootN: { value: 0 } };
  m.userData.land = U;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U, CANOPY); shader.uniforms.uPbrA = GROUND_PBR.albedo; shader.uniforms.uPbrN = GROUND_PBR.nra; shader.uniforms.uPbrOn = GROUND_PBR.on; shader.uniforms.uLitter = GROUND_LOOK.litter; shader.uniforms.uCloudT = CLOUD_T; shader.uniforms.uSurf = SURFACE; shader.uniforms.uSurfSun = SURFACE_SUN;
    shader.vertexShader = patch(shader.vertexShader, ['#include <common>', 'attribute float aLandW; attribute float aTread; varying float vLandW; varying vec3 vGW; varying float vTread;'],
      ['#include <begin_vertex>', 'vLandW = aLandW; vTread = aTread; vGW = (modelMatrix * vec4(transformed, 1.)).xyz;']);
    shader.fragmentShader = patch(shader.fragmentShader, ['#include <common>', 'uniform sampler2D uLand; uniform vec4 uLandBox; uniform float uLandOn; uniform float uCloudT; uniform vec4 uRoots[24]; uniform float uRootN; varying float vLandW; varying vec3 vGW; varying float vTread;\nuniform sampler2D uPbrA, uPbrN; uniform float uPbrOn;\nfloat bfPbrW = 0.; float bfPbrR = .95; vec3 bfPbrN = vec3(0., 0., 1.);\n' + GW_NOISE_GLSL + SURFACE_GLSL + PBR_GLSL + (m.defines.LITTER !== undefined ? CANOPY_GLSL + '\nuniform float uLitter;\n' : '')],
      ['#include <roughnessmap_fragment>', 'roughnessFactor = mix(roughnessFactor, bfPbrR, bfPbrW);'],
      ['#include <emissivemap_fragment>', `        #if defined(DESERT) && !defined(LOWQ)
        {
          // [evidence 27 Nov] the cliffs as layered rock (the photos' buttes are beds of red and pale sandstone, ledges
          // and overhang shadows, varnish streaks — the 12.8 m ground read as smooth orange hills): per pixel on the steep
          // ground, beds ~2.6 m deep wandering with the land, each its own shade; a shadow line under each bed; streaks
          // down the face; the bed tops tilted up in the light. Fades with distance and where the beds get finer than a pixel.
          vec3 nW = normalize(cross(dFdx(vGW), dFdy(vGW))); if (nW.y < 0.) nW = -nW;
          float steep = smoothstep(.1, .3, 1. - nW.y);   // (25°–45° and steeper: the 12.8 m ground softens the real faces)
          if (steep > .001) {
            float camD = length(vGW - cameraPosition);
            float y = vGW.y + gwN(vGW.xz * .02) * 6. + gwN(vGW.xz * .11) * 1.2;
            float yb = y / 2.6, bedI = floor(yb), f = fract(yb);
            float aa = 1. - smoothstep(.25, .7, fwidth(yb));   // (beds finer than a pixel: their mean)
            float bed = gwH(vec2(bedI, 3.7));
            vec3 bc = bed < .62 ? vec3(.39, .125, .068) : bed < .9 ? vec3(.55, .3, .155) : vec3(.63, .53, .38);   // (linear: red sRGB 168/99/74, pale 196/148/110, white 208/192/165)
            bc *= .86 + .22 * gwH(vec2(bedI, 9.1));
            float ledge = smoothstep(0., .08, f) * (1. - smoothstep(.86, 1., f));
            float varn = smoothstep(.55, .85, gwN(vec2(dot(vGW.xz, vec2(.71, .71)) * .35, vGW.y * .025)));
            vec3 rock = bc * mix(1., mix(.62, 1., ledge), aa) * (1. - .3 * varn);
            float fade = 1. - smoothstep(1800., 4200., camD);
            vec3 mean = vec3(.43, .18, .09) * .9;
            diffuseColor.rgb = mix(diffuseColor.rgb, mix(mean, rock, aa), steep * mix(.5, .85, fade));
            float dfy = (smoothstep(0., .08, f) - smoothstep(.86, 1., f)) * aa;
            normal = normalize(normal + (viewMatrix * vec4(0., dfy * .55 * steep * fade, 0., 0.)).xyz);
          }
        }
        #endif`],
      ['#include <normal_fragment_maps>', `        ${PBR_NORMAL_GLSL}
        #ifndef LOWQ
        {
          // the ground's small relief near the camera (the height grid is 12.8 m: hummocks, ruts and hollows of 1–6 m
          // in the light alone, no vertices — user, 24 Nov: "finer ground near the road")
          float rd = 1. - smoothstep(40., 160., length(vGW - cameraPosition));
          if (rd > 0.) {
            vec2 p = vGW.xz * .32; float e = .35;
            float h0 = gwN(p) + gwN(p * 2.7 + 7.) * .45, hx = gwN(p + vec2(e, 0.)) + gwN((p + vec2(e, 0.)) * 2.7 + 7.) * .45, hz = gwN(p + vec2(0., e)) + gwN((p + vec2(0., e)) * 2.7 + 7.) * .45;
            vec3 g = vec3(h0 - hx, 0., h0 - hz) * .55 * rd;
            normal = normalize(normal + (viewMatrix * vec4(g, 0.)).xyz);
          }
        }
        #endif`],
      ['#include <color_fragment>', `        int sdCh = 2;
        if (uLandOn > .5 && vLandW > .01) {
          vec2 size = uLandBox.zw - uLandBox.xy;
          #ifdef LOWQ
          vec2 uv = (vGW.xz - uLandBox.xy) / size;
          float k = floor(texture2D(uLand, uv).r * 255. + .5);
          float n = gwN(vGW.xz * .35);
          #else
          // the cover read through a wander (±3.5 m) and a scatter of grains (±3 m, 0.4 m grains): the edge between two
          // covers a ragged, feathered strip where each creeps into the other, not a 6 m staircase (user, 24 Nov)
          vec2 gr = floor(vGW.xz * 2.5);
          vec2 uv0 = (vGW.xz - uLandBox.xy) / size;
          // (an old-growth hero area's covers — dark litter beside bright hay — read the grains as a checker up close:
          //  there the edge only wanders, a soft ragged line, no scatter)
          float kh = floor(texture2D(uLand, uv0).r * 255. + .5), grains = kh > 29.5 && kh < 33.5 ? 0. : 6.;
          #ifdef SOFTCOVER
          grains = 0.;
          #endif
          vec2 uv = uv0 + ((vec2(gwN(vGW.xz * .21), gwN(vGW.xz * .21 + 19.)) - .5) * 7. + (vec2(gwN(vGW.xz * .9 + 5.), gwN(vGW.xz * .9 + 23.)) - .5) * (6. - grains) * .5 + (vec2(gwH(gr + 3.1), gwH(gr + 8.7)) - .5) * grains * (1. - smoothstep(60., 220., length(vGW - cameraPosition)))) / size;
          float k = floor(texture2D(uLand, uv).r * 255. + .5);
          // water isn't wobbled: a canal or a creek is only a few cells wide, and the wobble broke it into pools
          // (user, 22 Nov: "the water in the canal … is cutting out")
          float k0 = floor(texture2D(uLand, uv0).r * 255. + .5);
          if (k0 > 2.5 && k0 < 3.5) k = 3.; else if (k > 2.5 && k < 3.5) k = k0;
          float n = gwN(vGW.xz * .35) * .6 + gwN(vGW.xz * 2.3) * .4;
          #endif
          vec3 lc = vec3(-1.);
          if (k < .5) lc = mix(vec3(.43, .42, .4), vec3(.52, .5, .47), n);                   // paved: lots, yards of the works
          else if (k < 1.5) lc = mix(vec3(.38, .52, .24), vec3(.47, .6, .3), n) * (1. - .16 * smoothstep(.62, .8, gwN(vGW.xz * .025 + 3.)));   // grass, parks (darker damp hollows)
          else if (k < 2.5) {
            // the woods' floor (user, 23 Nov: "areas under trees should be more brown dirt, with leaf litter texture"):
            // brown earth under last year's leaves, patches of moss, a light scatter of this fall's colour
            lc = mix(vec3(.29, .22, .14), vec3(.39, .3, .19), n);
            lc = mix(lc, vec3(.27, .31, .17), smoothstep(.6, .78, gwN(vGW.xz * .08 + 31.)) * .75);
            #ifndef LOWQ
            lc *= .86 + .26 * gwN(vGW.xz * 4.3);
            vec2 lq = mat2(.82, -.57, .57, .82) * vGW.xz * 5. + (vec2(gwN(vGW.xz * 1.7), gwN(vGW.xz * 1.7 + 7.)) - .5) * 1.6, lf = floor(lq);
            float lr = length(fract(lq) - .5 + (vec2(gwH(lf + 2.), gwH(lf + 3.)) - .5) * .3);
            lc = mix(lc, mix(vec3(.6, .3, .12), vec3(.7, .55, .2), gwH(lf + 5.)), step(.93, gwH(lf + 13.)) * (1. - smoothstep(.18, .3, lr)) * .55);
            lc = mix(lc, vec3(.2, .15, .1), step(.95, gwH(floor(vGW.xz * 3.) + 71.)) * .4);   // (a dark twig, a damp hollow)
            lc *= 1. + .45 * smoothstep(.72, .8, gwN(vGW.xz * .45 + 17.)) * smoothstep(.4, .6, gwN(vGW.xz * .07 + 5.));   // (dappled sun through the crowns)
            #endif
          }
          else if (k < 3.5 && k > 2.5) lc = mix(vec3(.17, .31, .38), vec3(.22, .37, .44), n);  // water: a canal or a pond at its own level (CNY's Erie Canal; PGH's rivers are under the water plane anyway)
          else if (k < 4.5 && k > 3.5) lc = vec3(.42, .4, .36);                               // under a building
          #ifdef DESERT
          else if (k < 5.5 && k > 4.5) lc = mix(vec3(.84, .67, .54), vec3(.9, .74, .6), n) * (.92 + .12 * sin(dot(vGW.xz, vec2(.8, .6)) * .35 + gwN(vGW.xz * .05) * 6.));   // the Coral Pink dunes: ripples (calibrated 27 Nov: pale coral, chroma ~24, hue ~68°, as photographed)
          #else
          else if (k < 5.5 && k > 4.5) lc = vec3(.66, .6, .46);                               // sand, bare rock
          #endif
          else if (k < 6.5 && k > 5.5) lc = mix(vec3(.62, .59, .54), vec3(.68, .65, .6), n);  // plaza
          else if (k < 7.5 && k > 6.5) lc = mix(vec3(.3, .42, .22), vec3(.38, .44, .25), n);  // beyond: suburbs and hills
          else if (k > 7.5 && k < 8.5) {
            lc = mix(vec3(.4, .54, .27), vec3(.5, .58, .33), n);  // yards: lawns
          }
          else if (k > 9.5 && k < 10.5) {
            // crops (a rural map's WorldCover cropland, SKAN): field by field — corn, soybeans, a hay cutting, wheat
            // stubble, a ploughed field — each a ~150 m patch, with its rows
            vec2 fc = floor((vGW.xz + (vec2(gwN(vGW.xz * .004), gwN(vGW.xz * .004 + 9.)) - .5) * 90.) / vec2(165., 120.));
            float f = gwH(fc + 7.3), g = step(.5, gwH(fc - 2.7)) * .5;
            vec3 c1 = f < .3 ? vec3(.31, .42, .17) : f < .48 ? vec3(.42, .5, .21) : f < .62 ? vec3(.36, .47, .19) : f < .78 ? vec3(.6, .55, .33) : vec3(.47, .4, .28);
            #ifdef LOWQ
            lc = c1 * (.93 + .12 * n);
            #else
            float a = g * 3.1416, row = sin(dot(vGW.xz, vec2(cos(a), sin(a))) * 2.4);
            lc = c1 * (.92 + .1 * n) * (1. + row * (f < .62 ? .07 : .04));
            #endif
          }
          else if (k > 10.5 && k < 11.5) {
            // pasture and hay: brighter grass, a mown field's swaths here and there
            float f = gwH(floor((vGW.xz + (vec2(gwN(vGW.xz * .004 + 3.), gwN(vGW.xz * .004 + 5.)) - .5) * 90.) / vec2(150., 130.)) - 4.1);
            lc = mix(vec3(.41, .54, .24), vec3(.49, .58, .29), n) * (f > .72 ? 1.05 : f < .25 ? .93 : 1.);
            #ifndef LOWQ
            if (f > .82) lc *= 1. + .025 * sin(dot(vGW.xz, f > .91 ? vec2(1., 0.) : vec2(0., 1.)) * 1.1);
            #endif
          }
          else if (k > 11.5 && k < 12.5) lc = mix(vec3(.3, .37, .2), vec3(.4, .42, .25), n);  // wetland: sedge and brush
          else if (k > 19.5 && k < 27.5) {
            // CNY's fields (tools/pgh_city.py "the country"): crop rows along the field's long axis (20-23 corn, 24-27
            // grain stubble; the code's last two bits the rows' heading, 0 east-west … 3 north-west), faded to their
            // mean far off so they don't shimmer
            float dIx = mod(k - 20., 4.), a = dIx * .7853982, ns = sign(uLandBox.y - uLandBox.w);
            vec2 rowN = vec2(-ns * sin(a), cos(a));   // across the rows (world x, z; the rows run (cos a, ns sin a), ns: north's sign in z)
            float corn = step(k, 23.5), per = mix(.55, .9, corn), q = dot(vGW.xz, rowN) / per;
            float fw = fwidth(q), row = mix(.5 + .5 * sin(q * 6.2831853), .5, clamp(fw * 1.6, 0., 1.));
            float field = gwN(vGW.xz * .013 + k * 3.1);   // a field's own shade (and the swaths of a mower)
            float swath = mix(.5 + .5 * sin(dot(vGW.xz, rowN) * .785), .5, clamp(fwidth(dot(vGW.xz, rowN) * .125) * 1.6, 0., 1.));
            vec3 leaf = mix(vec3(.2, .38, .1), vec3(.3, .47, .13), field), soil = vec3(.38, .3, .2);
            vec3 stub = mix(vec3(.76, .62, .34), vec3(.84, .72, .42), field), stubD = vec3(.6, .49, .3);
            lc = corn > .5 ? mix(soil, leaf, .55 + .45 * row) * (.94 + n * .12) : mix(stubD, stub, row * .6 + swath * .4) * (.95 + n * .1);
          }
          else if (k < 28.5 && k > 27.5) {
            // hay and pasture: mottled grass, mown in broad lighter swaths
            float sw = .5 + .5 * sin(vGW.x * .45 + gwN(vGW.xz * .02) * 9.);
            sw = mix(sw, .5, clamp(fwidth(vGW.x * .45) * .6, 0., 1.));
            lc = mix(vec3(.5, .58, .26), vec3(.64, .66, .32), n * .6 + sw * .4);
          }
          else if (k < 29.5 && k > 28.5) lc = mix(vec3(.5, .43, .32), vec3(.6, .53, .41), n * .7 + gwN(vGW.xz * .09) * .3);   // farmyard: gravel and packed earth
          else if ((k > 29.5 && k < 31.5) || (k > 32.5 && k < 33.5)) {
            // an old-growth hero area's floor (user, 24 Nov, with photos of a golden beech–maple stand): a thick carpet of
            // this fall's leaves — gold, tan, orange, a few still green — over last year's brown; twigs; lit in long bars
            // of low sun between the trunks' shadows (the golden-hour sun from the west-south-west: the bars run along it);
            // the blowdown greener with its brambles and seedlings
            float blow = step(32.5, k);
            lc = mix(vec3(.5, .34, .15), vec3(.62, .45, .2), n);
            lc = mix(lc, vec3(.36, .25, .13), smoothstep(.6, .8, gwN(vGW.xz * .05 + 11.)) * .4);   // last year's brown, where the new fall is thin
            lc = mix(lc, vec3(.3, .33, .15), blow * smoothstep(.45, .7, gwN(vGW.xz * .08 + 3.)) * .5);
            // (on Low too — phones' default: the floor was a flat orange there, user 24 Nov: "Full detail on Low too")
            lc *= .86 + .26 * gwN(vGW.xz * 3.7);
            for (int q = 0; q < 3; q++) {
              float sc = q == 0 ? 3.6 : q == 1 ? 6.3 : 10.1;
              vec2 lq = mat2(.82, -.57, .57, .82) * vGW.xz * sc + (vec2(gwN(vGW.xz * 1.3 + float(q) * 5.), gwN(vGW.xz * 1.3 + 7.)) - .5) * 1.8, lf = floor(lq);
              float lr = length(fract(lq) - .5 + (vec2(gwH(lf + 2.), gwH(lf + 3.)) - .5) * .35), hl = gwH(lf + 5. + float(q) * 9.);
              vec3 leaf = hl < .3 ? vec3(.86, .6, .18) : hl < .55 ? vec3(.8, .48, .14) : hl < .75 ? vec3(.66, .5, .28) : hl < .9 ? vec3(.5, .32, .16) : vec3(.5, .52, .2);
              lc = mix(lc, leaf, step(.55 - float(q) * .08, gwH(lf + 13.)) * (1. - smoothstep(.2, .34, lr)) * .7);
            }
            vec2 tw = mat2(.6, -.8, .8, .6) * vGW.xz; float tl = abs(fract(tw.x * .9 + gwN(tw * .4) * 2.) - .5);
            lc = mix(lc, vec3(.2, .13, .08), step(.97, gwH(floor(vec2(tw.x * .9, tw.y * 3.)) + 41.)) * (1. - smoothstep(.0, .05, tl)) * .7);   // twigs
            // the sun in bars between the trunks' long shadows (along the sun's azimuth, 250°: local (−.94, .34))
            vec2 sunA = vec2(-.94, .34), sunP = vec2(.34, .94);
            float bar = gwN(vec2(dot(vGW.xz, sunP) * .42, dot(vGW.xz, sunA) * .018 + 5.)) * .7 + gwN(vec2(dot(vGW.xz, sunP) * 1.1, dot(vGW.xz, sunA) * .05)) * .3;
            lc *= mix(.62, 1.12, smoothstep(.42, .58, bar));
            lc *= mix(.92, 1.05, blow);
          }
          else if (k > 31.5 && k < 32.5) {
            // the hero area's old fields under the tall grass (user, 24 Nov: "Ground color in meadows should be trampled
            // straw/grass color"): last year's grass laid flat — pale straw and tan, matted in swirls, a little green
            // coming through at the foot, darker hollows where it's thick
            float comb = gwN(vec2(dot(vGW.xz, vec2(.94, .34)) * .5, dot(vGW.xz, vec2(-.34, .94)) * 4.));
            float swirl = gwN(vGW.xz * .21 + vec2(comb * 1.5));
            lc = mix(vec3(.6, .52, .33), vec3(.74, .66, .44), n * .5 + swirl * .5);
            lc = mix(lc, vec3(.5, .52, .3), smoothstep(.62, .82, gwN(vGW.xz * .05 + 4.)) * .3);
            lc *= .88 + .16 * comb;
            // the tall grass's own colour along the trail where its 3D clumps have faded out (past ~25–40 m: old-growth.js
            // GRASS_FADE — user, 24 Nov: "Fixed tiles + grow-in + floor blend"): the hay tops seen from above, combed by
            // the wind, so the field reads as grass all the way out and a clump grows up out of its own colour
            if (vTread > 10. && vTread < 69.) {
              float gtd = abs(vTread - 50.), gcd = length(vGW - cameraPosition);
              float tallG = smoothstep(.7, 1.3, gtd) * (1. - smoothstep(7.5, 9.5, gtd)) * smoothstep(18., 34., gcd);
              vec3 tops = mix(vec3(.6, .5, .3), vec3(.72, .62, .4), gwN(vGW.xz * 1.7) * .6 + comb * .4) * (.86 + .2 * gwN(vec2(dot(vGW.xz, vec2(.94, .34)) * 3., dot(vGW.xz, vec2(-.34, .94)) * .4)));
              lc = mix(lc, tops, tallG * .85);
            }
            lc *= .9 + .18 * gwN(vec2(dot(vGW.xz, vec2(.7, .7)) * 3.5, dot(vGW.xz, vec2(-.7, .7)) * .6));   // the matted blades' streaks
          }
          #ifdef DESERT
          // [out-west] the red-rock covers (tools/pgh_city.py DESERT_LAND): the ground's own sand and sandstone show through
          // (lc stays unset) — pinyon-juniper duff a shade darker with needle litter, sage flats flecked grey-green, the
          // slickrock bare; the flecks fade to their mean off past ~150 m
          // the town's ground (43, WorldCover built-up — 27 Nov, from photos of Kanab: gravel lots, verges and dry lawns,
          // pale grey-tan with green where it's watered; albedo ~0.25–0.3, not the slickrock's pink sand)
          if (k > 42.5 && k < 43.5) {
            float fd = 1. - smoothstep(40., 160., length(vGW - cameraPosition));
            vec3 grav = mix(vec3(.62, .58, .5), vec3(.7, .66, .57), n), lawn = mix(vec3(.42, .48, .3), vec3(.5, .53, .34), n);
            vec3 tg = mix(grav, lawn, smoothstep(.55, .75, gwN(vGW.xz * .03 + 11.)) * .8);
            tg *= .9 + .2 * gwH(floor(vGW.xz * 3.)) * fd;
            diffuseColor.rgb = mix(diffuseColor.rgb, pow(tg, vec3(2.2)), vLandW * .92);
          }
          if (k > 39.5 && k < 42.5) {
            float fd = 1. - smoothstep(40., 160., length(vGW - cameraPosition));
            // (small round specks — pebbles, a tuft, a dark crust — on a 25 cm cell, not the square cells' checker)
            vec2 spq = vGW.xz * 4., spf = floor(spq);
            float sp = step(k < 40.5 ? .72 : k < 41.5 ? .8 : .94, gwH(spf + k)) * (1. - smoothstep(.18, .34, length(fract(spq) - .5 - (vec2(gwH(spf + 3.), gwH(spf + 7.)) - .5) * .3)));
            vec3 sage = pow(mix(vec3(.46, .5, .4), vec3(.56, .58, .46), n), vec3(2.2));
            diffuseColor.rgb *= mix(1., k < 40.5 ? .84 : k < 41.5 ? .95 : 1.04, vLandW);
            diffuseColor.rgb = mix(diffuseColor.rgb, k < 41.5 ? sage : diffuseColor.rgb * .7, sp * vLandW * mix(.06, .4, fd));
            if (k < 40.5) diffuseColor.rgb = mix(diffuseColor.rgb, pow(vec3(.36, .28, .2), vec3(2.2)), smoothstep(.6, .8, gwN(vGW.xz * .12 + 7.)) * .35 * vLandW);
            // [plants phase 3] biological soil crust on the undisturbed sand between the shrubs: dark, lumpy, in patches a
            // few metres across (pinnacled cyanobacteria and lichen — grey-black over the red), its lumps only up close
            float crust = smoothstep(.55, .72, gwN(vGW.xz * .18 + 31.)) * (k < 41.5 ? 1. : .4);
            float lump = mix(.75, gwN(vGW.xz * 6.) * .5 + gwH(floor(vGW.xz * 9.)) * .5, fd);
            diffuseColor.rgb = mix(diffuseColor.rgb, pow(vec3(.27, .24, .21), vec3(2.2)) * (.8 + .4 * lump), crust * .55 * vLandW);
          }
          #endif
          #ifdef NYGRASS
          // the rural maps in early fall (user, 22 Nov: "grass + farms need to improve"): corn gone tan, soybeans gold,
          // and the grass close by with blades in it — lawns mown in stripes, pastures and hay tufted, with dry patches
          if (k > 19.5 && k < 23.5) lc = mix(lc, lc.g > .3 ? vec3(.5, .46, .25) : lc, .55);
          if (k > 9.5 && k < 10.5) {
            vec2 fc = floor((vGW.xz + (vec2(gwN(vGW.xz * .004), gwN(vGW.xz * .004 + 9.)) - .5) * 90.) / vec2(165., 120.));
            float f = gwH(fc + 7.3);
            if (f < .3) lc = mix(lc, vec3(.5, .46, .25), .6); else if (f < .48) lc = mix(lc, vec3(.62, .55, .24), .7);
          }
          bool grassy = (k > .5 && k < 1.5) || (k > 6.5 && k < 8.5) || (k > 10.5 && k < 11.5) || (k > 27.5 && k < 28.5);
          if (lc.x >= 0. && grassy) {
            float gd = 1. - smoothstep(.02, .16, max(fwidth(vGW.x), fwidth(vGW.z)));   // near: blades; far: their mean
            float bl = gwN(vGW.xz * 7.3) * .55 + gwN(vGW.xz * 21.) * .45;
            lc *= 1. + (bl - .5) * .28 * gd;
            float dry = smoothstep(.62, .8, gwN(vGW.xz * .045 + 13.)) * (k > 7.5 && k < 8.5 ? .35 : 1.);
            lc = mix(lc, vec3(.6, .57, .34), dry * .45);                                   // dry, gone-over patches
            if (k > 7.5 && k < 8.5) { vec2 yc = floor(vGW.xz / 30.); float ya = gwH(yc + 3.) * 3.1416; lc *= 1. + .07 * sign(sin(dot(vGW.xz, vec2(cos(ya), sin(ya))) * 3.4)) * gd * step(.25, gwH(yc + 4.)); }   // a lawn's mown stripes, each yard its own way
            if (k > 10.5 && k < 11.5 || k > 27.5) lc = mix(lc, lc * vec3(1.05, .98, .85), smoothstep(.55, .75, gwN(vGW.xz * .5)) * .5);   // tussocks, seed heads
          }
          #endif
          if ((k > 1.5 && k < 2.5) || (k > 29.5 && k < 31.5) || (k > 32.5 && k < 33.5)) sdCh = 1;   // (the woods' floor: stone dust and grit, not turf)
          // (the ground's tint carried into the cover is a ratio to the green ground's mean: on the desert's red sand it
          //  came out (1.4, .9, 1.4) — every lot and paved yard in Out West magenta [evidence 27 Nov, pixel probe: code 0,
          //  albedo (164, 123, 128)] — so the desert's covers keep their own colour)
          float tintOff = step(19.5, k) * .7;
          #ifdef DESERT
          tintOff = 1.;
          #endif
          if (lc.x >= 0.) diffuseColor.rgb = mix(diffuseColor.rgb, pow(lc, vec3(2.2)) * mix(clamp(diffuseColor.rgb / vec3(.25, .39, .14), .6, 1.4), vec3(1.), tintOff), vLandW * (k > 19.5 || (k > 1.5 && k < 2.5) ? .95 : .85));   // (CNY's fields: their own colour, less of the ground's tint)
          #ifdef LITTER
          // [zwift-look] fall's leaves on the grass (leafLitter effect): thickest under the crowns (the canopy map near the
          // camera), a light scatter everywhere, drifts here and there; flecks near, their colour's mean farther off
          if ((k > .5 && k < 1.5) || (k > 7.5 && k < 8.5)) {
            vec2 lcn = bfCanopy(vGW);
            float ld = length(vGW - cameraPosition), ldet = 1. - smoothstep(15., 45., ld);
            float dens = uLitter * (.04 + .45 * lcn.y + .12 * smoothstep(.6, .85, gwN(vGW.xz * .035 + 3.)));
            vec3 lacc = vec3(0.); float lcov = 0.;
            for (int q = 0; q < 2; q++) {
              float sc = q == 0 ? 5.2 : 8.6;
              vec2 lq = mat2(.8, -.6, .6, .8) * vGW.xz * sc + float(q) * 3.7, lf = floor(lq);
              float lr = length(fract(lq) - .5 + (vec2(gwH(lf + 2.), gwH(lf + 3.)) - .5) * .3), hl = gwH(lf + 5. + float(q) * 9.);
              vec3 leaf = hl < .3 ? vec3(.7, .52, .18) : hl < .55 ? vec3(.66, .38, .14) : hl < .85 ? vec3(.55, .42, .24) : vec3(.56, .26, .12);
              float on = step(1. - dens * .5, gwH(lf + 13.)) * (1. - smoothstep(.16, .3, lr));
              lacc = mix(lacc, leaf, on); lcov = max(lcov, on);
            }
            vec3 lmean = pow(vec3(.66, .43, .17), vec3(2.2));
            diffuseColor.rgb = mix(diffuseColor.rgb, pow(lacc, vec3(2.2)) * (.8 + .3 * gwN(vGW.xz * 3.)), lcov * ldet * .9);
            diffuseColor.rgb = mix(diffuseColor.rgb, lmean, (1. - ldet) * dens * .12);
          }
          #endif
        }
        // a hero area's singletrack, worn into the floor (old-growth.js: aTread = its signed distance from the line the
        // tires take, + 50; 0 on every other ground): user, 24 Nov — "Start with the ground material and almost overlay
        // wear from a bike passing over": the litter or straw packed down to earth along a ragged, wandering band, the
        // tire's own groove down its middle, leaves drifted back over it here and there
        if (vTread > 10.) {
          float td = vTread - 50.;
          float wob = (gwN(vGW.xz * .35) - .5) * .3 + (gwN(vGW.xz * 2.3) - .5) * .14;
          float ad = abs(td + wob * .35);
          float wear = 1. - smoothstep(.22, .62 + wob * .4, ad);
          float groove = 1. - smoothstep(.015, .08, abs(td + (gwN(vGW.xz * .6 + 7.) - .5) * .16));
          float drift = step(.86, gwH(floor(vGW.xz * 6.5) + 31.)) * (1. - wear * .6);
          // packed earth: darker and duller than the leaves or straw it's worn through, fine grit in it
          vec3 earth = pow(mix(vec3(.3, .22, .15), vec3(.4, .31, .21), gwN(vGW.xz * 4.) * .6 + gwN(vGW.xz * 19.) * .4), vec3(2.2));
          diffuseColor.rgb = mix(diffuseColor.rgb, earth, wear * (1. - drift) * .95);
          diffuseColor.rgb *= 1. - groove * wear * .25;
          // the leaves and straw pushed aside by the tires, banked a little lighter along the edges
          diffuseColor.rgb *= 1. + .14 * smoothstep(.45, .65, ad) * (1. - smoothstep(.7, 1.1, ad));
          // a big tree's foot (user, 24 Nov: "trees disturb the ground with their growth … the tops of exposed roots …
          // the ground swollen slightly near their base" → "Root tops breaking the litter", "Bare soil between roots"):
          // round each one near the camera, the tops of its roots running out through the leaves, bare earth between
          // them close in; the swelling itself is the skirt's (old-growth.js floorH)
          if (length(vGW.xz - cameraPosition.xz) < 110.) for (int i = 0; i < ${ROOTS_N}; i++) {   // (the trees round the camera only: no loop for the far floor)
            if (float(i) >= uRootN) break;
            vec4 f = uRoots[i]; vec2 dv = vGW.xz - f.xy; float r = length(dv) / f.z;
            if (r > 4.4) continue;
            float a = atan(dv.y, dv.x) + (.25 * sin(r * 1.7 + f.w) + (gwN(vGW.xz * 3.) - .5) * .35) * smoothstep(1.6, 3., r);   // (true to the 3D roots' bearings close in)
            float ridge = pow(abs(cos(a * 3. + f.w)), 10. + r * 4.) + .6 * pow(abs(cos(a * 5. + f.w * 1.7)), 26.) * (1. - smoothstep(1.8, 2.8, r));
            float reach = 1. - smoothstep(2.2, 3.6 + .7 * sin(a * 2. + f.w), r);
            float soil = (1. - smoothstep(1.7, 3.1 + .6 * gwN(vGW.xz * 1.3 + f.w), r)) * (1. - min(1., ridge));
            vec3 dirt = pow(mix(vec3(.24, .18, .13), vec3(.33, .25, .17), gwN(vGW.xz * 5.)), vec3(2.2));
            vec3 bark = pow(mix(vec3(.36, .31, .26), vec3(.45, .4, .34), gwN(vGW.xz * 9. + f.w)), vec3(2.2));
            diffuseColor.rgb = mix(diffuseColor.rgb, dirt, soil * .7 * (1. - step(.86, gwH(floor(vGW.xz * 6.5) + 31.))));
            diffuseColor.rgb = mix(diffuseColor.rgb, bark, min(1., ridge) * reach * .85);
            diffuseColor.rgb *= 1. - .18 * smoothstep(.5, 1.2, ridge) * reach * (1. - smoothstep(0., .9, abs(cos(a * 3. + f.w + .25))));
          }
        }
        #ifndef LOWQ
        // the ground's texture near the camera: turf, or the woods' floor's grit (user, 24 Nov — Zwift parity)
        diffuseColor.rgb *= surfaceDetail(vGW.xz, sdCh, sdCh == 1 ? 5. : 3., length(vGW - cameraPosition), sdCh == 1 ? .6 : .8);
        if (uPbrOn > .5 && sdCh == 2) {
          // [surfaces] the PBR turf on grass (hex-tiled, 2.5 m): clumps, dry patches, relief, as a ratio to its own mean so the
          // map's greens stay; it fades out by 45 m (the grass cards and the cover's colour carry it beyond)
          PbrSample ps = pbrSurface(uPbrA, uPbrN, vGW.xz / 2.5);
          vec3 mean = max(textureLod(uPbrA, vec2(.5), 12.).rgb, vec3(.01));
          float w = smoothstep(45., 18., length(vGW - cameraPosition));
          diffuseColor.rgb *= mix(vec3(1.), clamp(ps.albedo / mean, .4, 2.), w * .7) * mix(1., ps.ao, w * .8);
          bfPbrW = w * .8; bfPbrR = ps.roughness; bfPbrN = ps.normal;
        }
        #else
        if (vTread > 10.) diffuseColor.rgb *= surfaceDetail(vGW.xz, sdCh, sdCh == 1 ? 5. : 3., length(vGW - cameraPosition), sdCh == 1 ? .6 : .8);   // (a hero area's floor: on Low too)
        #endif
        #ifdef NYGRASS
        diffuseColor.rgb *= 1. - .2 * smoothstep(.55, .75, gwN((vGW.xz + uCloudT * vec2(3., 1.2)) * .0025));   // a cloud's shadow drifting over (user, 23 Nov)
        #endif`]);
  };
  m.customProgramCacheKey = () => `pgh-ground-land-23${low ? '-low' : ''}${rural ? '-ny2' : ''}${desert ? '-desert' : ''}`;
  return m;
}
