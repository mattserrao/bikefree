// Building kit: the facade shader. One material for every building, part and prop of the kit, so a whole
// stretch of village is one draw call. Everything is drawn from per-vertex attributes, with no textures:
//
//   aSurf  (u, v, L, code)   u along the face (m, left → right seen from outside), v up it (m; up the slope on
//                            roofs), L the face's length, code the surface (presets.js S)
//   aWin   (floorH, bayW, groundV, packed)   windows: storey height, bay width (exact, so windows sit
//                            symmetrically), the ground floor's level in v, and style + 16·door bay + 256·flags
//   aB     (seed, wear)      the building's seed and its weathering (age and upkeep)
//   aTrim  (rgb, frame)      shutter colour (sRGB) and the window-frame colour (index into FRAMES)
//   aAcc   (rgb, -)          accent colour: window surrounds, quoins, doors, signs
//   color  (sRGB)            the face's base colour
//
// The surface patterns (render, rubble, boards, logs, tiles, slate, lauze, metal seams…), windows (frames,
// muntins, curtains, reflections, shutters open or closed, sills, surrounds, flower boxes), doors, shopfronts,
// quoins, ivy and weathering (damp at the foot, drips under sills, sun fade, moss on shady roofs) are all
// drawn here. Every detail fades to its average once it's a couple of pixels, so nothing shimmers far off.
import * as THREE from '../../../../../vendor/three.module.min.js';

export const FRAMES = ['#efebe2', '#e4dac4', '#6b4a32', '#3b3d3f', '#9ea4a8'];
/** Flags (aWin.w / 256). */
export const F = { SHUTTERS: 1, SURROUNDS: 2, QUOINS: 4, FLOWERS: 8, SHOP: 16, GABLE: 32, SPARSE: 64, BARN: 128, IVY: 256, NOGROUND: 512, UPPERDOOR: 1024 };

const GLSL_COMMON = /* glsl */`
  attribute vec4 aSurf; attribute vec4 aWin; attribute vec2 aB; attribute vec4 aTrim; attribute vec4 aAcc;
  varying vec4 vSurf; flat varying vec4 vWin; flat varying vec2 vB; flat varying vec3 vTrim; flat varying float vFrame; flat varying vec3 vAcc;
  varying vec3 vWN; varying vec3 vWP;
`;

const GLSL_FRAG = /* glsl */`
  uniform vec3 uSunDir;
  varying vec4 vSurf; flat varying vec4 vWin; flat varying vec2 vB; flat varying vec3 vTrim; flat varying float vFrame; flat varying vec3 vAcc;
  varying vec3 vWN; varying vec3 vWP;
  vec3 bkLin(vec3 c) { return pow(c, vec3(2.2)); }
  float bkH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float bkN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(bkH(i), bkH(i + vec2(1, 0)), f.x), mix(bkH(i + vec2(0, 1)), bkH(i + vec2(1, 1)), f.x), f.y); }
  float bkF(vec2 p) { return bkN(p) * .6 + bkN(p * 2.13 + 7.1) * .3 + bkN(p * 4.7 + 3.3) * .1; }
  // a line of width w (m) every period p along x, antialiased by the pixel size px
  float bkLine(float x, float p, float w, float px) { float d = abs(fract(x / p + .5) - .5) * p; return 1. - smoothstep(w * .5, w * .5 + px, d); }
  float bkBox(vec2 q, vec2 lo, vec2 hi, float px) { vec2 a = smoothstep(lo - px, lo, q) * (1. - smoothstep(hi, hi + px, q)); return a.x * a.y; }

  // ---- masonry and wood, each returning a colour around 'base' (and averaging to it far off)
  vec3 bkRubble(vec3 base, float u, float v, float det, float seed) {
    // irregular courses: the bed joints wander, stones vary in length and tone, a few big quoin-like ones
    float vw = v + (bkN(vec2(u * 1.7, seed)) - .5) * .09;
    float row = floor(vw / .26); float rv = fract(vw / .26);
    float len = .28 + .38 * bkH(vec2(row, seed + 4.));
    float x = u / len + bkH(vec2(row, seed)) * 3.;
    float col = floor(x + (bkN(vec2(row * 3.1, u * .8)) - .5) * .5); float cx = fract(x + (bkN(vec2(row * 3.1, u * .8)) - .5) * .5);
    float h = bkH(vec2(col, row) + seed * 17.);
    vec3 tint = mix(vec3(1.), vec3(1.07, .99, .9), step(.68, h)) * mix(vec3(1.), vec3(.94, .97, 1.03), step(h, .22));
    vec3 c = base * (.84 + .3 * bkH(vec2(row, col) + 2.3)) * tint;
    float edge = min(min(cx, 1. - cx) * len, min(rv, 1. - rv) * .26);
    c *= mix(1., .8 + .2 * smoothstep(0., .07, edge), det);
    float mortar = 1. - smoothstep(.01, .028, edge);
    c = mix(c, base * 1.08 + .015, mortar * .6);
    return mix(base * .97, c, det);
  }
  vec3 bkCourses(vec3 base, float u, float v, float det, float seed, float ch, float bw, float joint, float vary) {
    float row = floor(v / ch); float x = u / bw + mod(row, 2.) * .5; float col = floor(x);
    float h = bkH(vec2(col, row) + seed * 13.);
    vec3 c = base * (1. - vary * .5 + vary * h);
    float e = min(min(fract(x), 1. - fract(x)) * bw, min(fract(v / ch), 1. - fract(v / ch)) * ch);
    c = mix(c, base * 1.15, (1. - smoothstep(joint, joint * 2., e)) * .8);
    return mix(base, c, det);
  }
  vec3 bkBoards(vec3 base, float u, float v, float det, float seed, float w, bool horiz) {
    float x = horiz ? v : u, y = horiz ? u : v;
    float k = floor(x / w), f = fract(x / w);
    float h = bkH(vec2(k, seed * 9.));
    vec3 c = base * (.86 + .26 * h);
    c *= .93 + .1 * bkN(vec2(k * 3.1, y * 1.3));            // grain
    float gap = horiz ? (1. - smoothstep(0., .16, f)) * .45 : (1. - smoothstep(.03, .09, min(f, 1. - f))) * .55;
    c *= 1. - gap;
    return mix(base * .92, c, det);
  }

  // ---- roofs: u along the eaves, v up the slope (m)
  vec3 bkRoof(int code, vec3 base, float u, float v, float det, float seed, float wear) {
    vec3 c = base;
    if (code == 40) {          // canal tiles: rounded channels down the slope
      float col = floor(u / .21), row = floor(v / .42);
      float round_ = abs(sin(3.14159 * u / .21));
      float h = bkH(vec2(col, row) + seed);
      c = base * (.78 + .32 * round_) * (.86 + .28 * h);
      c *= 1. - (1. - smoothstep(0., .07, fract(v / .42))) * .35;
      c = mix(c, base * vec3(.7, .66, .6), step(.96, h) * .7);
    } else if (code == 41) {   // interlocking flat tiles
      float row = floor(v / .34); float x = u / .24 + mod(row, 2.) * .5;
      float h = bkH(vec2(floor(x), row) + seed);
      c = base * (.86 + .24 * h) * (.92 + .1 * abs(sin(6.2832 * x)));
      c *= 1. - (1. - smoothstep(0., .1, fract(v / .34))) * .4;
    } else if (code == 42) {   // fish-scale tiles (several shades: the Dauphiné's patterned roofs)
      float row = floor(v / .16); float x = u / .17 + mod(row, 2.) * .5;
      vec2 q = vec2(fract(x) - .5, fract(v / .16));
      float h = bkH(vec2(floor(x), row) + seed);
      c = base * (.8 + .34 * h) * mix(vec3(1.), vec3(.92, .95, 1.05), step(.75, h));
      float scallop = length(vec2(q.x * 1.06, (q.y - .55) * .9));
      c *= 1. - smoothstep(.42, .5, scallop) * .4 * step(q.y, .55);
    } else if (code == 43) {   // slate
      float row = floor(v / .2); float x = u / .26 + mod(row, 2.) * .5;
      float h = bkH(vec2(floor(x), row) + seed);
      c = base * (.84 + .3 * h) * mix(vec3(1.), vec3(.93, .97, 1.06), step(.6, h));
      c *= 1. - (1. - smoothstep(0., .1, fract(v / .2))) * .45;
      c *= 1. - bkLine(x, 1., .05, .02) * .3;
    } else if (code == 44) {   // lauze: big irregular stone slabs, lichen
      float rh = .38 + .14 * bkH(vec2(floor(v / .45), seed));
      float row = floor(v / rh); float x = u / (.5 + .3 * bkH(vec2(row, seed + 1.))) + bkH(vec2(row, 2.)) * 4.;
      float h = bkH(vec2(floor(x), row) + seed);
      c = base * (.78 + .4 * h) * mix(vec3(1.), vec3(1.06, 1., .9), step(.66, h));
      float e = min(min(fract(x), 1. - fract(x)) * .6, fract(v / rh) * rh);
      c *= .62 + .38 * smoothstep(0., .05, e);
      float lichen = step(.86, bkN(vec2(u, v) * 3.1 + seed)) * step(.4, bkH(floor(vec2(u, v) * 9.)));
      c = mix(c, bkLin(vec3(.78, .7, .38)), lichen * .55);
    } else if (code == 45) {   // standing-seam metal
      float seam = bkLine(u, .52, .035, .02);
      c = base * (.95 + .07 * bkN(vec2(u * .5, v * .3) + seed));
      c = mix(c, base * 1.28, seam);
      c = mix(c, base * .78, bkLine(u + .03, .52, .03, .02) * .6);
      float rust = wear * smoothstep(.55, .9, bkN(vec2(u * 3., v * .25) + seed * 5.));
      c = mix(c, bkLin(vec3(.52, .32, .2)), rust * .6);
    } else if (code == 46) {   // corrugated
      c = base * (.86 + .2 * sin(6.2832 * u / .076) * .5 + .1);
      float rust = wear * smoothstep(.5, .85, bkN(vec2(u * 2., v * .3) + seed * 5.));
      c = mix(c, bkLin(vec3(.5, .3, .18)), rust * .7);
    } else if (code == 47) {   // wood shingles, silvered
      float row = floor(v / .14); float x = u / .11 + mod(row, 2.) * .5 + bkH(vec2(row, seed)) * .3;
      float h = bkH(vec2(floor(x), row) + seed);
      c = base * (.8 + .34 * h);
      c *= 1. - (1. - smoothstep(0., .14, fract(v / .14))) * .45;
    } else if (code == 48) {   // flat: gravel and patched membrane
      c = base * (.9 + .2 * bkH(floor(vec2(u, v) * 18.)));
      c *= .92 + .14 * smoothstep(.4, .7, bkN(vec2(u, v) * .4 + seed));
    }
    c = mix(base * .97, c, det);
    // moss and dark weather on the shady slope, near the eaves
    float shade = smoothstep(.1, -.6, vWN.z) * .7 + .3;
    float moss = wear * shade * smoothstep(.5, .78, bkF(vec2(u, v) * .55 + seed * 7.)) * (1. - smoothstep(0., 4.5, v) * .5);
    if (code != 45 && code != 46 && code != 48) c = mix(c, bkLin(vec3(.42, .46, .24)), moss * .7);
    c *= 1. - wear * .12 * bkF(vec2(u * .3, v * .7) + seed);
    return c;
  }

  // ---- windows: returns the window's colour over 'wall' (a = coverage)
  vec3 bkGlass(vec2 q, vec2 hw, float h, float px) {
    vec3 g = bkLin(vec3(.2, .25, .3));
    float streak = smoothstep(.15, .5, fract((q.x + q.y * .7) * .6 + h * 3.)) * (1. - smoothstep(.5, .85, fract((q.x + q.y * .7) * .6 + h * 3.)));
    g = mix(g, bkLin(vec3(.6, .7, .82)), streak * .35 + .08);
    if (h > .45) g = mix(g, bkLin(vec3(.86, .85, .8)), (1. - smoothstep(hw.y * .9, hw.y * 1.05, q.y)) * .55 * step(.7, h) + step(h, .7) * smoothstep(.6, .9, abs(q.x) / hw.x) * .5);
    return g;
  }

  vec4 bkWindows(vec3 wall, float u, float v, float L, float px, float seed, float wear) {
    float fh = vWin.x, bw = vWin.y, gv = vWin.z, p = floor(vWin.w + .5);
    int ws = int(mod(p, 16.)); float doorBay = mod(floor(p / 16.), 16.); float flags = floor(p / 256.);
    bool shutters = mod(flags, 2.) > .5, surrounds = mod(floor(flags / 2.), 2.) > .5, flowers = mod(floor(flags / 8.), 2.) > .5;
    bool shop = mod(floor(flags / 16.), 2.) > .5, gable = mod(floor(flags / 32.), 2.) > .5, sparse = mod(floor(flags / 64.), 2.) > .5;
    bool barn = mod(floor(flags / 128.), 2.) > .5, noGround = mod(floor(flags / 512.), 2.) > .5, upperDoor = mod(floor(flags / 1024.), 2.) > .5;
    float vv = v - gv;
    if (vv < 0. || fh <= 0.) return vec4(wall, 0.);
    float bi = floor(u / bw), fi = floor(vv / fh);
    float cu = u - (bi + .5) * bw, fv = vv - fi * fh;
    if (gable) { bi = 0.; fi = 9.; cu = u - L * .5; fv = vv; if (L < 4.) return vec4(wall, 0.); }
    float h = bkH(vec2(bi, fi) + seed * 91.7), h2 = bkH(vec2(fi, bi) * 1.7 + seed * 13.1);
    // window size by set
    vec2 hw = vec2(.5, .7); float y0 = .95;
    if (ws == 2) { hw = vec2(.33, .42); y0 = 1.; }
    else if (ws == 3) { hw = vec2(.6, .65); y0 = .85; }
    else if (ws == 4) { hw = vec2(1.1, 1.12); y0 = .06; }
    else if (ws == 5) { hw = vec2(.42, (fh * .82 - 2.6) * .5); y0 = 2.6; }
    else if (ws == 6) { hw = vec2(.09, .4); y0 = 1.2; }
    else if (ws == 7) { hw = vec2(.45, .72); y0 = .8; }
    if (gable) { hw = ws == 6 ? vec2(.75, .8) : vec2(.32, .38); y0 = ws == 6 ? .3 : .55; }
    vec3 c = wall; float a = 0.;
    vec3 frameC = bkLin(vFrame < .5 ? vec3(.94, .92, .89) : vFrame < 1.5 ? vec3(.89, .85, .77) : vFrame < 2.5 ? vec3(.42, .29, .2) : vFrame < 3.5 ? vec3(.23, .24, .25) : vec3(.62, .64, .66));
    vec3 trim = vTrim, acc = vAcc;
    // ground floor: the door, shopfronts; barns: the big door
    bool isDoor = !gable && fi < .5 && abs(bi - doorBay) < .5 || upperDoor && fi > .5 && fi < 1.5 && abs(bi - doorBay) < .5;
    if (isDoor) {
      float dw = barn ? 1.35 : .55, dh = barn ? min(fh * .92, 3.2) : 2.25;
      vec2 q = vec2(cu, fv);
      float inD = bkBox(q, vec2(-dw, 0.), vec2(dw, dh), px);
      vec3 dc = barn ? bkBoards(mix(trim, bkLin(vec3(.45, .34, .25)), .55), u, v, 1., seed, .18, false) : trim * .78;
      if (!barn) {
        dc *= 1. - bkLine(q.x, dw, .03, px) * .35 * step(.1, abs(q.x));                 // two leaves
        float panel = bkBox(abs(q - vec2(0., 1.25)) , vec2(.1, 0.), vec2(dw - .12, .85), px) - bkBox(abs(q - vec2(0., 1.25)), vec2(.14, 0.), vec2(dw - .16, .81), px);
        dc *= 1. - panel * .3;
        dc = mix(dc, bkLin(vec3(.85, .8, .6)), (1. - smoothstep(.03, .045, length(q - vec2(.12, 1.05)))));
      } else {
        float brace = bkLine((q.x * .9 - q.y) , 2.2, .16, px) * step(abs(q.x), dw - .05) * step(q.y, dh - .05);
        dc = mix(dc, dc * .8, brace);
      }
      float sur = bkBox(q, vec2(-dw - .18, 0.), vec2(dw + .18, dh + .2), px) - inD;
      c = mix(c, surrounds || !barn ? acc : wall * .9, sur * (surrounds ? 1. : .0));
      c = mix(c, dc, inD);
      return vec4(c, max(inD, 0.));
    }
    if (shop && fi < .5 && !gable) {
      vec2 q = vec2(cu, fv);
      float sw = bw * .5 - .3;
      float glass = bkBox(q, vec2(-sw, .45), vec2(sw, 2.55), px);
      float riser = bkBox(q, vec2(-sw - .12, 0.), vec2(sw + .12, 2.7), px) - glass;
      vec3 sc = mix(bkLin(vec3(.18, .21, .24)), bkLin(vec3(.85, .78, .62)), smoothstep(.55, .8, bkN(q * 2.3 + bi)) * .35);
      sc = mix(sc, bkLin(vec3(.62, .72, .84)), smoothstep(.2, .9, fract((q.x + q.y * .6) * .4 + h)) * .2);
      c = mix(c, trim * .9, riser); c = mix(c, sc, glass);
      // the sign band across the wall
      float sign = bkBox(vec2(u, fv), vec2(.25, 2.8), vec2(L - .25, 3.15), px);
      vec3 signC = bkLin(mix(vec3(.55, .16, .14), vec3(.12, .27, .42), step(.5, bkH(vec2(seed, 3.)))));
      signC = mix(signC, bkLin(vec3(.95, .9, .78)), bkLine(u, .34, .16, px) * bkBox(vec2(u, fv), vec2(L * .3, 2.9), vec2(L * .7, 3.05), px));
      c = mix(c, signC, sign);
      return vec4(c, max(glass, sign));
    }
    if (barn && !gable) {
      // barns: a hay door in the middle of the top storey, slit vents low down
      if (fi < .5 || abs(bi - doorBay) > .5) { if (fi > .5) return vec4(c, 0.); hw = vec2(.08, .38); y0 = 1.25; if (h < .5) return vec4(c, 0.); }
      else { hw = vec2(.75, .85); y0 = .25; float inH = bkBox(vec2(cu, fv), vec2(-hw.x, y0), vec2(hw.x, y0 + 2. * hw.y), px);
        c = mix(c, bkBoards(trim * .6 + bkLin(vec3(.2, .15, .1)), u, v, 1., seed, .2, false) * .8, inH); return vec4(c, inH); }
    }
    if ((noGround && fi < .5) || (sparse && h < .45) || (!gable && fi > 0. && h > .985)) return vec4(c, 0.);
    if (abs(cu) > bw * .5 - .05) return vec4(c, 0.);
    vec2 q = vec2(cu, fv - y0 - hw.y);                        // centred on the glass
    float arch = ws == 5 ? max(0., q.y - hw.y + hw.x) : 0.;
    vec2 qa = vec2(q.x, q.y - arch);
    float inW = bkBox(qa, -hw, hw, px) * (ws == 5 ? 1. - step(hw.x, length(vec2(q.x, max(0., q.y - hw.y + hw.x)))) * step(hw.y - hw.x, q.y) : 1.);
    float frameW = .07;
    float inF = bkBox(q, -hw - frameW, hw + frameW, px);
    // surround and sill
    if (surrounds) c = mix(c, acc, bkBox(q, -hw - .19, hw + vec2(.19, .22), px) * .92);
    float sill = bkBox(q, vec2(-hw.x - .1, -hw.y - .11), vec2(hw.x + .1, -hw.y - frameW + .01), px);
    c = mix(c, ws == 3 ? frameC * .85 : bkLin(vec3(.83, .81, .77)), sill);
    // drips under the sill
    float drip = wear * (1. - smoothstep(0., 1.4, -q.y - hw.y)) * step(-q.y, hw.y + 1.4) * step(hw.y, -q.y) * step(abs(q.x), hw.x + .05) * bkN(vec2(u * 9., v * .4));
    c *= 1. - drip * .35;
    // the glass, frame, muntins
    vec3 g = bkGlass(q, hw, h2, px);
    float open = step(.985, h);
    g = mix(g, mix(bkLin(vec3(.2, .17, .15)), bkLin(vec3(.78, .74, .66)), smoothstep(.2, .6, abs(q.x) / hw.x) * .6), open);
    float side = sign(dot(normalize(uSunDir.xz + 1e-4), normalize(vec2(vWN.z, -vWN.x) + 1e-4)));
    float shade = max(smoothstep(hw.y - .16, hw.y - .02, q.y), smoothstep(hw.x - .12, hw.x - .01, q.x * side));
    g *= 1. - shade * .45;
    float m = 0.;
    if (ws == 1) m = max(bkLine(q.x, 100., .06, px), bkLine(q.y + hw.y, hw.y * 2. / 3., .045, px) * step(abs(q.y), hw.y - .05));
    else if (ws == 2) m = max(bkLine(q.x, 100., .05, px), bkLine(q.y + hw.y, hw.y * 2. / 3., .045, px) * step(abs(q.y), hw.y - .05));
    else if (ws == 3) m = max(bkLine(q.x, 100., .08, px), bkLine(q.y, 100., .06, px));
    else if (ws == 4) m = max(bkLine(q.x, 100., .06, px), bkLine(q.y - hw.y * .62, 100., .05, px));
    else if (ws == 5) m = bkLine(q.x, 100., .04, px) + bkLine(q.y, .45, .03, px) * .7;
    else if (ws == 7) m = max(bkLine(q.y, 100., .07, px), bkLine(q.x, hw.x, .04, px) * step(abs(q.x), hw.x - .05));
    g = mix(g, frameC, clamp(m, 0., 1.) * (1. - open));
    c = mix(c, frameC, inF);
    c = mix(c, g, inW);
    a = inF;
    // flower boxes (geraniums)
    if (flowers && (fi > .5 || ws == 3) && h2 > .25 && !gable) {
      vec2 fq = vec2(q.x, q.y + hw.y);
      float box = bkBox(fq, vec2(-hw.x - .06, -.02), vec2(hw.x + .06, .2), px);
      float fl = bkBox(fq, vec2(-hw.x - .04, .18), vec2(hw.x + .04, .42), px) * smoothstep(.35, .5, bkN(fq * vec2(9., 7.) + bi * 3.) + (.42 - fq.y) * 1.6 - .2);
      vec3 flc = mix(bkLin(vec3(.3, .45, .2)), mix(bkLin(vec3(.85, .12, .14)), bkLin(vec3(.93, .4, .62)), step(.6, h2)), step(.55, bkN(fq * 22. + h)));
      c = mix(c, ws == 3 || h2 > .7 ? bkLin(vec3(.45, .3, .2)) : bkLin(vec3(.7, .38, .25)), box);
      c = mix(c, flc, fl * (1. - box));
      a = max(a, box + fl);
    }
    // shutters: open beside the window, closed over it, the odd one half shut or missing
    if (shutters && !gable && ws != 4 && ws != 5) {
      float st = bkH(vec2(bi, fi) * 3.7 + seed);
      float miss = step(1. - wear * .25, bkH(vec2(fi, bi) + seed * 5.));
      vec3 sc = trim * (.92 + .16 * h2);
      sc = mix(sc, mix(sc, vec3(dot(sc, vec3(.33))), .5) * 1.25, wear * .5);   // sun-faded
      float sw = hw.x + .02, sh = hw.y + .04;
      float leafL, leafR;
      if (st < .62) {         // open
        leafL = bkBox(q, vec2(-hw.x - frameW - sw - .02, -sh), vec2(-hw.x - frameW - .02, sh), px);
        leafR = bkBox(q, vec2(hw.x + frameW + .02, -sh), vec2(hw.x + frameW + sw + .02, sh), px);
      } else if (st < .88) {  // closed
        leafL = bkBox(q, vec2(-hw.x - .02, -sh), vec2(0., sh), px); leafR = bkBox(q, vec2(0., -sh), vec2(hw.x + .02, sh), px);
      } else {                 // one shut
        leafL = bkBox(q, vec2(-hw.x - .02, -sh), vec2(0., sh), px); leafR = bkBox(q, vec2(hw.x + frameW + .02, -sh), vec2(hw.x + frameW + sw + .02, sh), px);
      }
      leafR *= 1. - miss;
      float leaf = clamp(leafL + leafR, 0., 1.);
      vec3 lc = sc;
      float fine = 1. - smoothstep(.012, .03, px);
      if (ws == 1 || ws == 7) lc *= 1. - bkLine(q.y, .065, .022, px) * .32 * fine;                 // louvres
      else { lc *= 1. - bkLine(q.x, .16, .02, px) * .3 * fine; lc *= 1. - bkLine(q.x * .7 - q.y, 1.3, .07, px) * .15; }   // planks, a Z brace
      c = mix(c, lc, leaf);
      a = max(a, leaf);
    }
    return vec4(c, clamp(a, 0., 1.));
  }

  vec3 bkSundial(vec3 base, float u, float v, float L, float H, float px) {
    vec2 q = vec2(u / L - .5, v / H);
    vec3 c = bkLin(vec3(.93, .88, .76));
    float border = 1. - bkBox(q, vec2(-.44, .07), vec2(.44, .93), px * .5);
    c = mix(c, bkLin(vec3(.62, .28, .18)), border);
    vec2 g = vec2(q.x, q.y - .8);
    float ang = atan(g.x, -g.y), r = length(g * vec2(L / H, 1.));
    float ray = (1. - smoothstep(.0, .03, abs(fract(ang / .2618 + .5) - .5))) * step(.18, r) * step(r, .65) * step(-.05, -g.y);
    c = mix(c, bkLin(vec3(.25, .2, .18)), ray * .8);
    c = mix(c, bkLin(vec3(.92, .68, .2)), 1. - smoothstep(.08, .1, r));
    float sky = smoothstep(.3, .95, q.y) * (1. - border) * .25;
    return mix(c, bkLin(vec3(.45, .62, .78)), sky * step(.12, r));
  }
`;

const GLSL_MAIN = /* glsl */`
  {
    int code = int(vSurf.w + .5);
    float u = vSurf.x, v = vSurf.y, L = vSurf.z, seed = vB.x, wear = vB.y;
    float px = max(length(vec2(dFdx(u), dFdy(u))), length(vec2(dFdx(v), dFdy(v)))) + 1e-5;
    float det = 1. - smoothstep(.025, .08, px);     // fine courses (bricks, boards, tiles)
    float detW = 1. - smoothstep(.1, .3, px);       // windows, doors, quoins
    vec3 base = diffuseColor.rgb, c = base;
    // big soft patches so no wall is one flat colour, even new
    float blot = bkF(vec2(u, v) * .18 + seed * 11.);
    if (code >= 1 && code <= 13) {
      if (code == 1) c = base * (.95 + .1 * bkF(vec2(u, v) * .9 + seed) * det + .03);
      else if (code == 2) {
        c = base * (.9 + .2 * bkF(vec2(u, v) * 1.7 + seed));
        float bare = smoothstep(.74 - wear * .3, .8 - wear * .3, bkF(vec2(u * .3, v * .45) + seed * 3.));
        c = mix(c, bkRubble(base * vec3(.86, .84, .8), u, v, det, seed), bare * step(.25, wear));
      }
      else if (code == 3) c = bkRubble(base, u, v, det, seed);
      else if (code == 4) c = bkCourses(base, u, v, det, seed, .36, .72, .012, .16);
      else if (code == 5) c = bkCourses(base, u, v, det, seed, .075, .23, .006, .22);
      else if (code == 6) c = bkBoards(base, u, v, det, seed, .19, true);
      else if (code == 7) c = bkBoards(base, u, v, det, seed, .2, false);
      else if (code == 8) { float f = fract(v / .23); c = base * (.68 + .42 * sin(3.14159 * f)) * (.9 + .2 * bkH(vec2(floor(v / .23), seed))); c = mix(base * .92, c, det); }
      else if (code == 9) { c = bkCourses(base, u, v, det, seed, .16, .12, .01, .3); c *= 1. - (1. - smoothstep(0., .25, fract(v / .16))) * .3 * det; }
      else if (code == 10) {
        float post = bkLine(u, 1.2, .18, px), beam = bkLine(v - vWin.z, vWin.x > 0. ? vWin.x : 2.9, .2, px);
        float br = bkLine(fract(u / 1.2) * 1.2 - mod(v, 2.9) * .41, 1.2, .16, px);
        c = mix(base, bkLin(vec3(.3, .2, .14)), clamp(post + beam + br * .8, 0., 1.) * detW);
      }
      else if (code == 11) { c = base * (.88 + .16 * sin(6.2832 * u / .076) * det); c = mix(c, bkLin(vec3(.5, .3, .18)), wear * smoothstep(.6, .9, bkN(vec2(u * 2., v * .2) + seed)) * .6); }
      else if (code == 12) { c = bkCourses(base, u, v, detW, seed, 2.85, 3., .015, .08); }
      else if (code == 13) { c = mix(bkLin(vec3(.16, .2, .24)), bkLin(vec3(.55, .66, .78)), .2 + .2 * bkN(vec2(u, v) * .2)); c = mix(c, base, max(bkLine(u, 1.5, .08, px), bkLine(v, vWin.x > 0. ? vWin.x : 3.6, .12, px)) * detW); }
      // soft patches, sun fade high up, damp at the foot, long weather streaks
      c *= .95 + .1 * blot;
      float vv = v - vWin.z;
      float damp = (1. - smoothstep(0., .25 + .8 * wear, vv + .25 * bkN(vec2(u * 1.3, 0.)))) * (.12 + .4 * wear);
      c = mix(c, c * vec3(.7, .74, .66), damp);
      c *= 1. - wear * .16 * smoothstep(.55, 1., bkN(vec2(u * 1.8, v * .09) + seed)) ;
      // corner quoins
      float flags = floor(floor(vWin.w + .5) / 256.);
      if (mod(floor(flags / 4.), 2.) > .5 && vv > -.3) {
        float k = floor(v / .34), w = mod(k, 2.) < .5 ? .62 : .36;
        float q = max(step(u, w), step(L - u, w));
        float gap = bkLine(v, .34, .025, px) * .5;
        c = mix(c, vAcc * (1. - gap) * (.95 + .1 * bkH(vec2(k, step(u, w)))), q * detW);
      }
      // ivy up from one corner
      if (mod(floor(flags / 256.), 2.) > .5) {
        float iv = bkF(vec2(u * .7, v * .5) + seed * 3.) * 1.6 - u / 3.5 - max(0., vv) / 7. - .35;
        float leaf = smoothstep(0., .08, iv) * (.75 + .5 * bkH(floor(vec2(u, v) * 14.)) * det);
        c = mix(c, bkLin(vec3(.24, .36, .16)) * (.8 + .4 * bkN(vec2(u, v) * 6.)), clamp(leaf, 0., 1.));
      }
      // windows, doors and shopfronts
      if (vWin.x > 0. || mod(floor(flags / 32.), 2.) > .5) {
        vec4 w = bkWindows(c, u, v, L, px, seed, wear);
        // far off: the wall's average, windows and all
        float cov = .16;
        vec3 avg = mix(c, bkLin(vec3(.22, .26, .3)), cov);
        c = mix(avg, w.rgb, detW);
      }
    } else if (code >= 40) {
      c = bkRoof(code, base, u, v, det, seed, wear);
    } else if (code == 14) {   // balcony balustrade: planks with cut-outs
      float k = floor(u / .14), f = fract(u / .14);
      c = base * (.86 + .26 * bkH(vec2(k, seed)));
      c *= 1. - (1. - smoothstep(.02, .07, min(f, 1. - f))) * .5;
      float hole = (1. - smoothstep(.05, .07, length(vec2((f - 1.) * .14, (v - .55) * .55)))) + (1. - smoothstep(.05, .07, length(vec2(f * .14, (v - .55) * .55))));
      c = mix(c, base * .25, clamp(hole, 0., 1.) * mod(k, 2.));
      c *= 1. - bkLine(v, 100., .06, px) * .2;
      c = mix(base * .9, c, detW);
    } else if (code == 15) {   // génoise: rows of tile ends under the eaves
      float row = floor(v / .1); vec2 q = vec2(fract(u / .15 + mod(row, 2.) * .5) - .5, fract(v / .1));
      float arc = 1. - smoothstep(.32, .38, length(vec2(q.x, (q.y - .1) * .8)));
      c = mix(base * .9, base * .3, arc * step(.1, q.y) * det);
      c = mix(base * .85, c, detW);
    } else if (code == 16) { c = mix(base, bkSundial(base, u, v, L, vWin.x, px), detW); }
    else if (code == 17 || code == 31) c = bkBoards(base, u, v, det, seed, .16, true);
    else if (code == 19) c = base * (1. - bkLine(v, .5, .05, px) * .35 * detW);
    else if (code == 20) c = bkBoards(base, u, v, det, seed, .2, false);
    else if (code == 21) { float s = step(.5, fract(u / .6)); c = mix(base, bkLin(vec3(.93, .9, .84)), s); c *= 1. - bkLine(v, 100., .04, px) * .2; }
    else if (code == 22) {   // woodpile: log ends
      vec2 g = vec2(u / .17 + mod(floor(v / .15), 2.) * .5, v / .15);
      vec2 q = fract(g) - .5; float h = bkH(floor(g));
      float r = length(q * vec2(1., 1.13));
      c = mix(bkLin(vec3(.2, .14, .1)), base * (.85 + .3 * h) * (1. - smoothstep(.15, .45, r) * .25), 1. - smoothstep(.42, .5, r));
      c = mix(base * .7, c, det);
    } else if (code == 23) {   // foliage
      c = base * (.72 + .5 * bkN(vec2(u, v) * 5. + seed));
      c = mix(c, base * 1.35, step(.82, bkH(floor(vec2(u, v) * 11.))) * det);
      float fl = step(.93, bkH(floor(vec2(u, v) * 13.) + 7.)) * step(.5, fract(seed * 7.));
      c = mix(c, mix(bkLin(vec3(.95, .9, .82)), bkLin(vec3(.9, .3, .45)), step(.5, fract(seed * 13.))), fl * det);
    } else if (code == 25) {   // solar panels
      vec2 g = fract(vec2(u / .17, v / .17));
      c = mix(bkLin(vec3(.08, .12, .22)), bkLin(vec3(.2, .28, .45)), smoothstep(.2, .8, fract((u + v) * .3)) * .4);
      c = mix(c, bkLin(vec3(.7, .72, .75)), (1. - smoothstep(.04, .1, min(min(g.x, 1. - g.x), min(g.y, 1. - g.y)))) * .45 * det);
    } else if (code == 26) c = base * (.8 + .4 * bkH(floor(vec2(u, v) * 22.)) * det + .2 * (1. - det));
    else if (code == 27) { c = mix(base, bkLin(vec3(.28, .45, .18)), bkLine(u, .45, .18, px) * smoothstep(.3, .6, bkN(vec2(u, v) * 7.)) * det); }
    else if (code == 28) c = mix(base, base * 1.5, bkLine(u, .65, .12, px) * detW);   // soffit: rafter ends
    else if (code == 18) c = base;
    diffuseColor.rgb = c;
  }
`;

/** The kit's material (one per scene; MeshStandardMaterial so the cartoon look and baked light patch it). */
export function makeFacadeMaterial(uniforms = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, metalness: 0 });
  const sun = uniforms.uSunDir || { value: new THREE.Vector3(.3, .8, .2) };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSunDir = sun;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL_COMMON}`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        #ifdef USE_COLOR
          vColor.rgb = pow(color.rgb, vec3(2.2));
        #endif
        vSurf = aSurf; vWin = aWin; vB = aB; vTrim = pow(aTrim.rgb, vec3(2.2)); vFrame = aTrim.a * 255.; vAcc = pow(aAcc.rgb, vec3(2.2));`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWP = (modelMatrix * vec4(transformed, 1.)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_FRAG}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${GLSL_MAIN}`);
  };
  m.customProgramCacheKey = () => 'bf-building-kit-1';
  m.userData.buildingKit = true;
  return m;
}
