// The graph maps' road surfaces (js/world/graph-world.js; the endless map's roads too): the ribbons' and junctions'
// surface shader (aRd: surface code, metres across, metres along, half width — asphalt, brick, setts, slabs, pavers,
// gravel, dirt, the spill), upstate New York's winter-worn asphalt, the rural maps' worn paint and the ways' sides.
// [review 27 Nov] W13: moved out of graph-world.js as pure factories, their cache keys and generated shaders unchanged
// byte for byte (test/world-materials.test.mjs against the snapshot of the old code); the patches go through
// patchShader (a missing anchor throws instead of being lost).
import * as THREE from '../../../../vendor/three.js';
import { patchShader } from '../core/shader-patch.js';
import { litMaterial } from './lit.js';
import { PBR_GLSL, ROAD_PBR } from './pbr-sets.js';
import { SURFACE, SURFACE_SUN, SURFACE_GLSL, withSurfaceDetail } from './surface-detail.js';
import { ROAD_LOOK } from './road-look.js';

/** src with each [anchor, code] patched in after its anchor, in order (patchShader: throws on a missing anchor). */
export const patch = (src, ...pairs) => pairs.reduce((s, [a, c]) => patchShader(s, a, c), src);

/** The clouds' clock (their shadows drifting over the ground and the roads; puddles' glints): seconds. */
export const CLOUD_T = { value: 0 };

/** The graph shaders' own hash and value noise (gwH, gwN). [review 27 Nov] Kept, not swapped for glsl-noise.js
 *  HASH_GLSL: that hash is a different function (sin-free), so every grain, crack and patch of the graph maps' roads
 *  and ground would move — a look change, not a refactor (test/shader-noise.test.mjs lists this file as the exception). */
export const GW_NOISE_GLSL = /* glsl */`
  float gwH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float gwN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(gwH(i), gwH(i + vec2(1., 0.)), f.x), mix(gwH(i + vec2(0., 1.)), gwH(i + vec2(1., 1.)), f.x), f.y); }
`;

/**
 * Upstate New York asphalt after a lot of winters (user, 22 Nov: "Upstate NY roads wear a lot due to the winter"):
 * the base oxidised to a pale blue-grey, varying by place (by world position, so overlapping surfaces agree); narrow country roads
 * in chip seal (pale, speckled with aggregate, smoothed and darker in the wheel paths); tar-snake crack sealing — a
 * meandering seam down the centre joint and along the wheel paths, and transverse frost cracks across the lanes every
 * 8–20 m; alligator cracking in the wheel paths where it's worst; cut-in rectangular patches and round cold-patched
 * potholes; the edge breaking up into the shoulder; a dusting of winter sand and salt along the edges. q: metres
 * (across from the centre, along); hw: half width; det: 1 close, 0 where the detail would shimmer.
 */
const NY_ROAD_GLSL = /* glsl */`
  vec2 nyCell(vec2 p) {   // distance to the nearest edge of a jittered cell net (alligator cracking): x edge, y cell id
    vec2 i = floor(p), f = fract(p); float d1 = 9., d2 = 9.; float id = 0.;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y)), o = vec2(gwH(i + g), gwH(i + g + 31.)) * .8 + .1, r = g + o - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = gwH(i + g + 7.); } else if (d < d2) d2 = d;
    }
    return vec2(sqrt(d2) - sqrt(d1), id);
  }
  vec3 nyWinterRoad(vec3 c, vec2 q, float hw, float det, float track, vec3 w) {
    // a junction's fan or disc has no running coordinates: its wear by world position, no edge, no wheel paths
    bool junc = hw < .5 || fwidth(q.x) + fwidth(q.y) < 1e-6;
    if (junc) { q = w.xz; hw = 60.; track = 0.; det = 1. - smoothstep(.015, .07, max(fwidth(w.x), fwidth(w.z))); }
    float along = q.y, ax = junc ? 0. : abs(q.x);
    // which kind of stretch: fresh blacktop (repaved) / old oxidised hot-mix / chip seal (narrow country roads)
    // (by world position only, so overlapping surfaces — a junction's fan over a ribbon's end — agree exactly)
    float stretch = fract(gwN(w.xz * .0011) * 1.7 + gwN(w.xz * .0037 + 5.) * .9);
    float chip = junc ? 0. : step(hw, 3.35);   // (the narrow country roads: chip seal end to end)
    float fresh = 0.;   // (a repaved stretch would need lane-aligned ends: left out)
    float age = (1. - fresh) * (.55 + .45 * gwN(w.xz * .006 + 1.7));
    vec3 lin = pow(c, vec3(1. / 2.2));                       // (work in the gamma colour, as the other surfaces do)
    vec3 oxid = lin * vec3(1.3, 1.33, 1.38), black = lin * .74;
    vec3 base = lin;                                            // (the road's own tone: everything is relative to it)
    lin = mix(black, oxid, age);
    if (chip > .5) {
      // chip seal: pale aggregate pressed into tar, the stones' speckle; the wheel paths ground smooth and darker
      float sp = gwH(floor(w.xz * 34.)), sp2 = gwH(floor(w.xz * 61.) + 5.);
      vec3 cs = base * vec3(1.5, 1.48, 1.44) * (.88 + .24 * gwN(w.xz * .8));
      cs *= mix(1., .82 + .36 * sp * .6 + .2 * sp2, det * det);
      lin = mix(cs, cs * .8, track * .8);
      lin = mix(lin, base * .8, smoothstep(.6, .9, gwN(w.xz * .03 + 4.)) * .35);   // bleeding tar in the hot spots
    }
    // a junction's fan (or a far, plain ribbon): no lane-aligned features, just the tone and the odd pothole
    if (junc) return pow(lin * (.96 + .08 * gwN(w.xz * .3)), vec3(2.2));
    float worn = smoothstep(.35, .8, gwN(w.xz * .012 + 9.)) * (1. - fresh);
    // tar snakes: the centre joint, and the wheel paths' edges, wandering
    float wob = (gwN(vec2(along * .12, 3.)) - .5) * .35 + (gwN(vec2(along * 1.3, 9.)) - .5) * .1;
    float tarW = .012 + .012 * gwN(vec2(along * .2, 1.));   // [surfaces] (was .022–.047: read as painted black lines)
    float snake = (1. - smoothstep(tarW * .6, tarW, abs(q.x - wob))) * step(.3, gwN(vec2(along * .025, 5.)));
    for (int s = 0; s < 2; s++) {
      float lane = (float(s) * 2. - 1.) * (hw * .5 + .55);
      float on = step(.62, gwN(vec2(along * .03, float(s) * 13. + 2.)));
      float wl = (gwN(vec2(along * .15, float(s) * 7. + 5.)) - .5) * .9 + (gwN(vec2(along * 1.7, float(s) * 3.)) - .5) * .12;
      snake = max(snake, on * (1. - smoothstep(tarW * .6, tarW, abs(q.x - lane - wl))));
    }
    // transverse frost cracks: every 8–20 m, across the whole width, kinked
    float seg = floor(along / 13.), sp = 13. * (.5 + .4 * (gwH(vec2(seg, 2.)) - .5));
    float tx = along - seg * 13. - sp - (gwN(vec2(q.x * .9, seg)) - .5) * .9 - q.x * (gwH(vec2(seg, 4.)) - .5) * .25;
    float trans = (1. - smoothstep(.014, .028, abs(tx))) * step(.25, gwH(vec2(seg, 6.))) * step(ax, hw - .15 * gwH(vec2(seg, 8.)) * hw);
    float sealed = step(.4, gwH(vec2(seg, 11.)));             // most are sealed (black tar), some are open hairlines
    snake = max(snake * step(.25, age + worn), trans * sealed);
    lin = mix(lin, base * .62, snake * .5 * det);   // (tar: dark, not black — close up they read as cracks, not lines)
    lin *= 1. - trans * (1. - sealed) * .45 * det;
    // alligator cracking in the wheel paths, in the worst stretches
    vec2 cell = nyCell(vec2(q.x, along) * 4.2);
    float gator = (1. - smoothstep(.012, .04, cell.x)) * track * smoothstep(.65, .95, worn) * (1. - chip);
    lin *= 1. - gator * .35 * det;
    lin *= 1. + (cell.y - .5) * .08 * track * worn * det;   // the broken pieces, each a shade apart
    // patches: cut-in rectangles of newer, darker asphalt (a lane's width or less), and round cold-patched potholes
    float pb = floor(along / 23.), ph = gwH(vec2(pb, 21.));
    if (ph > .62) {
      float p0 = pb * 23. + gwH(vec2(pb, 22.)) * 10., p1 = p0 + 2. + gwH(vec2(pb, 23.)) * 9.;
      float side = gwH(vec2(pb, 24.)) < .5 ? -1. : 1., wide = gwH(vec2(pb, 25.)) < .35 ? hw : hw * (.45 + .3 * gwH(vec2(pb, 26.)));
      float cx = side * (hw - wide * .5) * step(wide, hw - .01);
      float inP = step(p0, along) * step(along, p1) * step(abs(q.x - cx), wide * .5);
      vec3 pc = base * mix(.86, 1.04, gwH(vec2(pb, 27.)));   // (a shade off the road round it, not a dark slab: user, 24 Nov)
      float rim = 1. - smoothstep(0., .06, min(min(along - p0, p1 - along), wide * .5 - abs(q.x - cx)));
      lin = mix(lin, pc * (.92 + .12 * gwN(w.xz * 6.)), inP * (.3 + .45 * det) * (.55 + .45 * gwN(w.xz * .6 + pb)));   // (worn into the road: patchy)
      lin = mix(lin, base * .55, inP * rim * .45 * det);   // the sealed saw cut round it
    }
    vec2 hp = vec2(floor(along / 7.), floor((q.x + hw) / 1.6));
    if (gwH(hp + 40.) > .93 - worn * .06) {
      vec2 hc = vec2((hp.y + .5) * 1.6 - hw + (gwH(hp + 41.) - .5) * .8, (hp.x + .5) * 7. + (gwH(hp + 42.) - .5) * 4.);
      float r = .25 + gwH(hp + 43.) * .4, d = length((vec2(q.x, along) - hc) * vec2(1., .8)) + (gwN(vec2(q.x, along) * 4.) - .5) * .12;
      float pot = 1. - smoothstep(r - .05, r, d);
      lin = mix(lin, base * .6 * (.9 + .25 * gwN(w.xz * 9.)), pot * step(ax, hw - .2) * det);
    }
    // the edge breaking up into the shoulder: ragged, crumbled, gravel showing through
    float rag = hw - ax - .35 * gwN(vec2(along * .8, 3.)) - .25 * gwN(vec2(along * 3.1, 7.)) * (1. - fresh);
    float crumble = 1. - smoothstep(0., .18, rag);
    lin = mix(lin, vec3(.47, .44, .39) * (.85 + .3 * gwH(floor(w.xz * 20.))), crumble * .85);
    lin = mix(lin, lin * .78, (1. - smoothstep(.15, .5, rag)) * (1. - crumble) * .6 * det);   // the broken lip
    // winter's sand and salt along the edges and in the crown between the wheel paths, washed out by fall
    float grit = (1. - smoothstep(.3, 1.4, hw - ax)) * .5 + (1. - smoothstep(.2, .9, ax)) * .18 * (1. - track);
    lin = mix(lin, base * 1.9, grit * .22 * (.6 + .4 * gwN(w.xz * .5)));
    // fall leaves blown to the edges (user, 23 Nov: cheap wins): drifts in the last half metre, a few strays on
    // the lane, more where the woods come down to the road (by stretch)
    float drift = (1. - smoothstep(.2, .75, hw - ax)) * smoothstep(.35, .75, gwN(w.xz * .05 + 13.)) + .06;
    vec2 lq = mat2(.8, -.6, .6, .8) * w.xz * 6.5, lf = floor(lq);
    float leaf = step(1. - drift * .35, gwH(lf + 91.)) * (1. - smoothstep(.22, .34, length(fract(lq) - .5)));
    lin = mix(lin, mix(vec3(.55, .27, .1), vec3(.7, .52, .18), gwH(lf + 92.)) * (.75 + .3 * gwH(lf + 93.)), leaf * det * .85);
    return pow(lin, vec3(2.2));
  }
`;
/** Rural maps' road paint: worn by plows and salt — faded, scuffed through in the wheel paths, patchy by stretch. */
export function wornPaintMaterial() {
  const m = litMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }, 'paint');
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = patch(shader.vertexShader, ['#include <common>', 'varying vec3 vPW;'],
      ['#include <begin_vertex>', 'vPW = (modelMatrix * vec4(transformed, 1.)).xyz;']);
    shader.fragmentShader = patch(shader.fragmentShader, ['#include <common>', 'varying vec3 vPW;\n' + GW_NOISE_GLSL],
      ['#include <color_fragment>', `        {
          float stretch = gwN(vPW.xz * .004 + 2.), fade = .25 + .55 * stretch;         // some stretches freshly painted
          float scuff = smoothstep(.45, .75, gwN(vPW.xz * 1.7)) * .7 + smoothstep(.6, .9, gwN(vPW.xz * 9.)) * .3;
          float gone = clamp(fade * .7 + scuff * fade, 0., .92);
          vec3 road = pow(vec3(.36, .37, .38), vec3(2.2));
          diffuseColor.rgb = mix(diffuseColor.rgb * (.82 + .1 * stretch), road, gone);
        }`]);
  };
  m.customProgramCacheKey = () => 'graph-paint-worn-1';
  return m;
}

/**
 * The roads' surface (aRd: surface code, metres across, metres along, half width): asphalt with grain, polished wheel
 * tracks, patches and sealed cracks that come and go by place (the Pittsburgh map's road-surface look); red paving
 * brick in running bond laid across the street; granite setts (Belgian block); concrete slabs with joints; pavers;
 * gravel and dirt. Patterns fade to their average when a brick is a few pixels, so nothing shimmers far off.
 */
/** low (Light, phones): the patterns only up close (brick, setts, slabs, pavers), plain asphalt with one noise. */
export function roadSurfaceMaterial(low = false, ny = false, spill = false) {
  const m = litMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: spill, polygonOffsetFactor: spill ? -1 : 0, polygonOffsetUnits: spill ? -3 : 0 }, 'asphalt');
  m.defines = {};
  if (spill) m.defines.SPILL = '';
  if (low) m.defines.LOWQ = '';
  if (ny) m.defines.NYWEAR = '';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uCloudT = CLOUD_T; shader.uniforms.uSurf = SURFACE; shader.uniforms.uSurfSun = SURFACE_SUN;
    shader.uniforms.uRoadTone = ROAD_LOOK.tone; shader.uniforms.uRoadLeaves = ROAD_LOOK.leaves;
    shader.uniforms.uPbrA = ROAD_PBR.albedo; shader.uniforms.uPbrN = ROAD_PBR.nra; shader.uniforms.uPbrOn = ROAD_PBR.on;
    shader.vertexShader = patch(shader.vertexShader, ['#include <common>', 'attribute vec4 aRd; varying vec4 vRd; varying vec3 vGW;'],
      ['#include <begin_vertex>', 'vRd = aRd; vGW = (modelMatrix * vec4(transformed, 1.)).xyz;']);
    shader.fragmentShader = patch(shader.fragmentShader, ['#include <common>', 'varying vec4 vRd; varying vec3 vGW; uniform float uCloudT; uniform vec3 uRoadTone; uniform float uRoadLeaves;\nuniform sampler2D uPbrA, uPbrN; uniform float uPbrOn;\nfloat bfPbrW = 0.; float bfPbrR = .85; vec3 bfPbrN = vec3(0., 0., 1.);\n' + GW_NOISE_GLSL + SURFACE_GLSL + PBR_GLSL + (ny ? NY_ROAD_GLSL : '')],
      ['#include <roughnessmap_fragment>', 'roughnessFactor = mix(roughnessFactor, bfPbrR, bfPbrW);'],
      ['#include <normal_fragment_maps>', `        if (bfPbrW > 0.) {   // [surfaces] the set's relief, in a frame laid on the road (u along world x, v along world z)
          vec3 nw = normalize(transpose(mat3(viewMatrix)) * normal), tw = normalize(vec3(1., 0., 0.) - nw * nw.x), bw = -cross(nw, tw);
          vec3 pw = normalize(tw * bfPbrN.x * .8 + bw * bfPbrN.y * .8 + nw * bfPbrN.z);
          normal = normalize(mix(normal, normalize(mat3(viewMatrix) * pw), bfPbrW));
        }`],
      ['#include <color_fragment>', `        {
          vec3 c = diffuseColor.rgb;
          float pcode = floor((vRd.x + .25) / 64.);   // ([zwift-look] the shader's paint lines: roadLook)
          int sf = int(vRd.x + .25 - pcode * 64.);
          bool bank = fract(vRd.x) > .25 && fract(vRd.x) < .75;   // a raised trail's embankment (_trailBank)
          bool bankWoods = vRd.w > 50.;
          vec4 rdw = vRd; if (bankWoods) rdw.w -= 100.;
          vec3 cover = c; float bankG = 1.;
          vec2 q = vRd.yz;
          #ifdef SPILL
          sf -= 20;
          {
            // the spill (_spillJob): dense by the shoulder's foot, scattered grains farther out; how far it reaches and
            // how thick it lies wander along the edge (q.y: metres along) and in patches
            float t = clamp((abs(q.x) - rdw.w - 3.) / 1.5, 0., 1.);
            float reach = .25 + .75 * gwN(vec2(q.y * .07, 3.3 + sign(q.x) * 5.)), thick = .45 + .55 * gwN(vGW.xz * .15 + 8.);
            float solid = (1. - smoothstep(reach * .3, reach, t)) * thick;
            if (gwH(floor(vGW.xz * 16.)) > solid * 1.1 + .02 || t > reach) discard;
          }
          #endif
          float px = max(fwidth(q.y), fwidth(q.x)) + 1e-4, det = 1. - smoothstep(.015, .07, px);
          float wear = .25 + .65 * gwN(vGW.xz * .004 + 3.1);
          float track = 1. - smoothstep(0., .45, abs(abs(abs(q.x) - rdw.w * .5) - .85));
          #ifdef LOWQ
          if (det < .02 && sf >= 1 && sf <= 4) sf = sf == 1 ? 11 : 0;   // far off: brick as its plain colour, the others as asphalt
          if (sf == 11) c = pow(vec3(.38, .2, .15), vec3(2.2)); else
          #endif
          if (sf == 1) {           // red paving brick, running bond, laid across
            float row = floor(q.y / .105), u = q.x / .215 + .5 * mod(row, 2.);
            vec2 cell = vec2(floor(u), row), f = vec2(fract(u), fract(q.y / .105));
            vec3 br = mix(vec3(.36, .16, .12), vec3(.5, .25, .18), gwH(cell)) * (.82 + .25 * gwH(cell + 7.));
            float mortar = max(1. - smoothstep(.0, .07, f.x) * smoothstep(.0, .07, 1. - f.x), 1. - smoothstep(.0, .12, f.y) * smoothstep(.0, .12, 1. - f.y));
            vec3 pat = mix(br, vec3(.16, .14, .13), mortar * .8);
            c = mix(vec3(.38, .2, .15), pat, det) * (1. - .14 * track);
            c = mix(c, vec3(.27, .28, .29), step(.9, gwN(vGW.xz * .3 + 5.)) * .85);   // an asphalt patch
            c = pow(c, vec3(2.2));
          } else if (sf == 2) {    // granite setts
            float row = floor(q.y / .16), u = q.x / .26 + .37 * mod(row, 3.);
            vec2 cell = vec2(floor(u), row), f = vec2(fract(u), fract(q.y / .16));
            vec3 st = vec3(.44, .43, .42) * (.78 + .32 * gwH(cell));
            float jt = max(1. - smoothstep(.0, .09, f.x) * smoothstep(.0, .09, 1. - f.x), 1. - smoothstep(.0, .12, f.y) * smoothstep(.0, .12, 1. - f.y));
            c = pow(mix(vec3(.4), mix(st, vec3(.2, .2, .19), jt * .8), det), vec3(2.2));
          } else if (sf == 3) {    // concrete slabs, joints every 4.5 m and down the middle
            float slab = floor(q.y / 4.5);
            c = c * (.94 + .1 * gwH(vec2(slab, floor(q.x / 3.)))) * (.95 + .08 * gwN(vGW.xz * 2.));
            float j = max(1. - smoothstep(0., .035, abs(fract(q.y / 4.5) - .5) * 4.5 - 2.22), 1. - smoothstep(0., .03, abs(q.x)));
            c *= 1. - .35 * j * det;
          } else if (sf == 4) {    // pavers
            vec2 cell = floor(vec2(q.x, q.y) / .6), f = fract(vec2(q.x, q.y) / .6);
            float jt = max(1. - smoothstep(0., .06, f.x) * smoothstep(0., .06, 1. - f.x), 1. - smoothstep(0., .06, f.y) * smoothstep(0., .06, 1. - f.y));
            c = mix(c, c * (.82 + .3 * gwH(cell)) * (1. - .4 * jt), det);
          } else if (sf == 5 || sf == 6) {   // gravel, dirt
            // (user, 22 Nov: a "gravel" texture for the towpath): stone dust, loose and darker toward the edges, pebbles.
            // (23 Nov: "too uniform … needs ruts, wandering, puddles"): the worn line wanders side to side along the
            // path, packed and a little darker; the edges are ragged into the grass; patches of fresh grey gravel, damp
            // dark spots and leaf litter come and go; now and then a shallow puddle in the worn line, the sky in it
            vec3 g = sf == 5 ? vec3(.62, .57, .48) : vec3(.54, .42, .28);
            float w = max(rdw.w, 1.);
            float wan = (gwN(vec2(q.y * .021, 3.7)) - .5) * w * .5 + (gwN(vec2(q.y * .09, 8.1)) - .5) * w * .14;
            float lineD = abs(q.x - wan), worn = 1. - smoothstep(w * .2, w * .5, lineD);
            float rag = (gwN(vec2(q.y * .35, 9.3)) - .5) * .5 + (gwN(vec2(q.y * 1.7, 4.4)) - .5) * .18;
            float edge = smoothstep(.55, .85, abs(q.x) / w + rag * .3);
            float grain = gwN(vGW.xz * 22.) * .6 + gwN(vGW.xz * 47.) * .4, peb = step(.96, gwH(floor(vGW.xz * 11.) + 17.)) * gwH(floor(vGW.xz * 11.) + 3.);
            float tone = .9 + .22 * (grain - .5) * det + .16 * (gwN(vGW.xz * 1.3) - .5) - .14 * edge - .09 * worn;
            vec3 col = g * tone;
            col = mix(col, col * mix(.62, 1.25, peb), step(.001, peb) * det * (.4 + .6 * edge));
            // patches: fresh gravel (grey, lighter), damp ground (darker, browner), leaf litter (rust and ochre flecks)
            float pFresh = smoothstep(.66, .74, gwN(vGW.xz * .07 + 12.3)), pDamp = smoothstep(.62, .72, gwN(vGW.xz * .11 + 41.7));
            col = mix(col, vec3(.66, .65, .62) * (.92 + .16 * grain), pFresh * (sf == 5 ? .7 : 0.));   // (fresh grey gravel: the gravel ways only — a dirt singletrack stays earth-brown)
            col = mix(col, col * vec3(.68, .66, .6), pDamp * .8);
            float litter = smoothstep(.55, .75, gwN(vGW.xz * .05 + 27.)) * (.4 + .6 * edge), leafF = step(.92, gwH(floor(vGW.xz * 9.) + 61.));
            col = mix(col, mix(vec3(.55, .33, .16), vec3(.62, .5, .22), gwH(floor(vGW.xz * 7.) + 5.)), leafF * litter * det);
            // (no grass creeping in at the edges: user, 23 Nov — the side carries the path's colour and texture; the
            // shoulder is drawn in this surface too, its across past the half-width: loose, a little darker)
            // puddles: in the worn line, a few per hundred metres; muddy rims, the sky's grey-blue in the middle
            float pn = gwN(vec2(q.y * .42, (q.x - wan) * .62) + 53.) * step(.55, gwN(vec2(q.y * .03, 7.7))), pud = smoothstep(.8, .83, pn) * worn * (1. - edge);
            float rim = smoothstep(.75, .8, pn) * worn * (1. - pud);
            col = mix(col, col * vec3(.62, .58, .52), rim * .8);
            col = mix(col, vec3(.46, .5, .55) * (.85 + .2 * gwN(vGW.xz * 3.)), pud * .9);
            col += vec3(1., .9, .7) * pud * step(.985, gwH(floor(vGW.xz * 24.) + floor(uCloudT * 3.) * 7.)) * 1.6 * det;   // (the low sun glinting on it)
            c = pow(col, vec3(2.2));
            if (bank) {
              // the embankment (user, 24 Nov): the trail's gravel spills over the crest and thins out in grains (how far
              // wanders), then the ground cover — grass, or under the woods the litter — darker toward the foot;
              // stones bedded in the slope here and there, and under the woods roots crossing it
              float o = abs(q.x) - w;
              float crest = .45 + .9 * gwN(vec2(q.y * .09, 13.1)) + .3 * gwN(vec2(q.y * .4, 2.7));
              float gm = 1. - smoothstep(crest * .4, crest, o);
              gm = smoothstep(-.08, .08, gm * 1.15 - .05 - gwH(floor(vGW.xz * 24.)) * mix(1., .6, det));   // (fine grains: 4 cm)
              vec3 gc = cover * (.85 + .3 * gwN(vGW.xz * .8)) * (1. - .18 * smoothstep(1.5, 4.5, o));
              if (bankWoods) { vec2 lq = mat2(.8, -.6, .6, .8) * vGW.xz * 5.5, lf = floor(lq); gc = mix(gc, pow(mix(vec3(.55, .33, .16), vec3(.62, .5, .22), gwH(lf + 5.)), vec3(2.2)) * .8, step(.9, gwH(lf + 33.)) * (1. - smoothstep(.2, .32, length(fract(lq) - .5))) * det * .6); }
              float stone = gwH(floor(vGW.xz * 1.6) + 77.), sr = length(fract(vGW.xz * 1.6) - .5 - (vec2(gwH(floor(vGW.xz * 1.6) + 2.), gwH(floor(vGW.xz * 1.6) + 9.)) - .5) * .3);
              float st = step(.9, stone) * (1. - smoothstep(.16, .24, sr)) * smoothstep(.6, 1.2, o);
              vec3 stc = pow(vec3(.5, .49, .45), vec3(2.2)) * (.8 + .4 * gwH(floor(vGW.xz * 1.6) + 5.)) * (1.15 - sr * 1.6);
              float rt = 0.;
              if (bankWoods) { float rq = q.y * .8 + sin(o * 2.1 + q.y * .3) * .25; rt = (1. - smoothstep(.02, .06, abs(fract(rq * .35) - .5))) * step(.55, gwN(vec2(floor(rq * .35), 4.))) * smoothstep(.5, 1., o) * (1. - smoothstep(3.5, 5., o)); }
              c = mix(gc, c, gm); bankG = gm;
              c = mix(c, stc, st * det);
              c = mix(c, pow(vec3(.27, .2, .14), vec3(2.2)), rt * det * .85);
            }
          } else {                 // asphalt
            #ifdef LOWQ
            c *= (.94 + .12 * wear) * (1. - wear * .1 * track);
            #else
            float g = gwN(vGW.xz * 4.1) * .5 + gwN(vGW.xz * 19.) * .5;
            c *= .9 + .2 * mix(.5, g, det);
            c *= 1. - wear * .1 * track;                                                     // polished wheel tracks
            float pa = gwN(vGW.xz * .09 + 7.3);
            c = mix(c, c * 1.16, step(.74 - wear * .12, pa) * .7);                           // patches
            float cr = abs(gwN(vGW.xz * .55 + 11.) - .5);
            c *= 1. - wear * .22 * step(.62, gwN(vGW.xz * .05 + 2.)) * (1. - smoothstep(.0, .01, cr)) * det;   // sealed cracks (in the worn places)
            c *= 1. - .08 * (1. - smoothstep(0., .5, rdw.w - abs(q.x)));                     // the edge, darker
            if (uPbrOn > .5) {
              // [surfaces] the PBR asphalt (hex-tiled, 3.5 m): its aggregate and stains as a ratio to its own average (the
              // map's palette and wear stay), its relief and roughness; it fades with the detail so far road stays even
              PbrSample ps = pbrSurface(uPbrA, uPbrN, vGW.xz / 3.5);
              vec3 mean = max(textureLod(uPbrA, vec2(.5), 12.).rgb, vec3(.01));
              float w = det * smoothstep(60., 25., length(vGW - cameraPosition));
              c *= mix(vec3(1.), clamp(ps.albedo / mean, .3, 2.5), w * .85) * mix(1., ps.ao, w);
              bfPbrW = w; bfPbrR = ps.roughness; bfPbrN = ps.normal;
            }
            #endif
            #ifdef NYWEAR
            c = nyWinterRoad(c, q, rdw.w, det, track, vGW);
            #endif
          }
          #ifdef PARKROAD
          if (sf == 0 && !bank) {
            // [zwift-look] a park drive's asphalt (roadLook): a shade lighter and warmer, the aggregate's speckle, a
            // darker gutter along each edge where the leaves gather, a few strays on the lanes
            float ax = abs(q.x), hw = rdw.w;
            c *= uRoadTone;
            float gut = 1. - smoothstep(.15, .55, hw - ax);
            c *= 1. - .18 * gut;
            #ifndef LOWQ
            float spk = gwH(floor(vGW.xz * 26.)), spk2 = gwH(floor(vGW.xz * 43.) + 7.);
            c *= mix(1., .9 + .2 * spk * .7 + .12 * spk2, det);
            #endif
            if (uRoadLeaves > 0.) {
              float drift = gut * smoothstep(.3, .7, gwN(vGW.xz * .07 + 13.)) * 1.2 + .012;
              vec2 lq = mat2(.8, -.6, .6, .8) * vGW.xz * 6.5, lf = floor(lq);
              float leaf = step(1. - drift * .4, gwH(lf + 91.)) * (1. - smoothstep(.22, .34, length(fract(lq) - .5)));
              c = mix(c, pow(mix(vec3(.62, .32, .1), vec3(.78, .6, .2), gwH(lf + 92.)) * (.75 + .3 * gwH(lf + 93.)), vec3(2.2)), leaf * det * .85 * uRoadLeaves);
            }
          }
          #endif
          #ifdef SHADERPAINT
          if (pcode > .5 && !bank) {
            // [zwift-look] the paint, box-filtered across a pixel (crisp near, a faint even line far off — no crawl, no
            // MSAA needed): edge lines, the bike lane's double line, a double or dashed yellow centre
            float aaX = max(fwidth(q.x), 1e-3), aaY = max(fwidth(q.y), 1e-3), hw = rdw.w;
            float cw = 0., cy = 0.;
            #define BFL(c0, h) (clamp((q.x - (c0) + (h)) / aaX + .5, 0., 1.) - clamp((q.x - (c0) - (h)) / aaX + .5, 0., 1.))
            if (mod(pcode, 2.) > .5) cw = max(cw, max(BFL(hw - .35, .07), BFL(-(hw - .35), .07)));
            if (mod(floor(pcode / 2.), 2.) > .5) cw = max(cw, max(BFL(-(hw - 2.2), .1), BFL(-(hw - 2.2) - .35, .1)));
            if (mod(floor(pcode / 4.), 2.) > .5) cy = max(cy, max(BFL(-.18, .06), BFL(.18, .06)));
            if (mod(floor(pcode / 8.), 2.) > .5) {
              bool pth = mod(floor(pcode / 16.), 2.) > .5;
              float dl = pth ? 3. : 3.3, per = pth ? 9. : 10., m = mod(q.y, per);
              float on = clamp((dl - m) / aaY + .5, 0., 1.) * clamp(m / aaY + .5, 0., 1.);
              cy = max(cy, BFL(0., pth ? .05 : .07) * on);
            }
            #undef BFL
            // worn a little: patchy, the aggregate showing through near the camera
            float pw = (.82 + .18 * gwN(vGW.xz * 1.9)) * mix(1., .86 + .2 * gwH(floor(vGW.xz * 30.)), det);
            vec3 pcol = cy > cw ? pow(vec3(.89, .71, .23), vec3(2.2)) : pow(vec3(.93, .92, .88), vec3(2.2));
            c = mix(c, pcol * pw, max(cw, cy) * .94);
          }
          #endif
          #ifndef LOWQ
          // the surface's texture near the camera (asphalt aggregate; a trail's gravel): user, 24 Nov — Zwift parity
          { float sdist = length(vGW - cameraPosition); c *= (bank && bankG < .5) ? surfaceDetail(vGW.xz, bankWoods ? 1 : 2, bankWoods ? 5. : 3., sdist, .8) : (sf == 5 || sf == 6) ? surfaceDetail(vGW.xz, 1, 3.5, sdist, .9) : surfaceDetail(vGW.xz, 0, 5., sdist, .75); }
          #endif
          diffuseColor.rgb = c * (1. - .2 * smoothstep(.55, .75, gwN((vGW.xz + uCloudT * vec2(3., 1.2)) * .0025)));   // (a cloud's shadow drifting over)
          #ifdef SPILL
          diffuseColor.rgb *= .84;   // (thin over the ground: a shade darker, so it doesn't read as a pale band)
          #endif
        }`]);
  };
  m.customProgramCacheKey = () => `pgh-road-surface-13${low ? '-low' : ''}${ny ? '-ny1' : ''}${spill ? '-spill' : ''}${Object.keys(m.defines || {}).join('')}`;
  return m;
}

/** The ways' sides (verges, shoulders, kerbs, embankments): vertex colour, and near the camera the surface texture
 *  (user, 24 Nov — Zwift parity). */
export function sideMaterial(low = false) {
  const m = litMaterial({ vertexColors: true, side: THREE.DoubleSide }, 'asphalt');
  return low ? m : withSurfaceDetail(m, 'graph-side');
}
