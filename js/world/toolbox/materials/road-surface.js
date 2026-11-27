// Road surface: the road changes with the place and its condition instead of one asphalt from end to end.
// A scene describes stretches of road by kind; the shader adds what that kind of road shows — a fresh dark
// overlay, worn and polished wheel tracks, patches, sealed cracks, chip seal, frost-heaved and crumbling
// edges, faded paint, snowmelt running across the road, tunnel grime — over the road's own texture and
// paint. Each 300 m or so also varies a little within its stretch. No draw calls, no textures.
//
//   "road": {
//     "surface": "worn",                                    // the default for anywhere not in a zone
//     "zones": [ { "fromM": 0, "toM": 2200, "surface": "fresh" },
//                { "fromM": 41380, "toM": 41620, "surface": "alpine", "wet": 1 } ]   // later zones win
//   }
//
// Kinds: fresh, worn, chipseal, alpine, patched, tunnel, brick, cobble. Any number in a kind can be overridden in a zone
// (e.g. "patches": 0.9). Distances are along the road from the start (out-and-backs: the outbound half).
// A zone can also change the road's look without moving anything:
//   "pavedM": 6      the paved width (the rest of the 7 m strip becomes a gravel shoulder; edge lines move in)
//   "centre": 0      the centre line (1 painted, .4 faded and broken, 0 none)
//   "gravel": .6     loose gravel spread over the lanes in patches
//
// French roads ("markings": "fr"): the paint is drawn here in metres by the French rules instead of coming from
// the road's texture — a white T1 centre line (3 m on, 10 m off), T2 edge lines (3 m on, 3.5 m off) set in from
// the paving edge, short dashes and no edge lines through villages (town boards), a solid centre line round
// bends you can't see through and on hairpins, with the T3 warning dashes (3 m on, 1.33 m off) before it, no
// edge lines under 6.6 m of paving and no centre line under 5.2 m (or where a zone says "centre": 0). The
// asphalt gets the detail of the Alpine reference photos: light aggregate in a darker binder, bleached and oily
// mottling, the paving seam down the middle, and repair strips along the edges.
import * as THREE from '../../../../vendor/three.js';
import { HASH_GLSL } from './glsl-noise.js';   // [review 27 Nov] the shared sin-free hash and value noise
import { anchor } from '../core/shader-patch.js';   // [review 27 Nov] T8: a missing shader anchor throws

// tone (×brightness), warm (toward brown), wear (polished wheel tracks), patches, cracks, edge (crumbling
// edges and dust), fade (paint faded), speckle (chip-seal stones), runoff (snowmelt across the road), grime
const SURFACES = {
  fresh:    { tone: .78, warm: 0,   wear: .15, patches: .04, cracks: .05, edge: .15, fade: 0,   speckle: .1, runoff: 0,  grime: 0 },
  worn:     { tone: 1,   warm: .1,  wear: .6,  patches: .4,  cracks: .45, edge: .5,  fade: .25, speckle: .2, runoff: 0,  grime: 0 },
  chipseal: { tone: 1.06, warm: .35, wear: .35, patches: .2, cracks: .2,  edge: .45, fade: .15, speckle: .9, runoff: 0,  grime: 0 },
  alpine:   { tone: 1.1, warm: .2,  wear: .5,  patches: .7,  cracks: .85, edge: .85, fade: .35, speckle: .35, runoff: .6, grime: 0 },
  patched:  { tone: .95, warm: .1,  wear: .5,  patches: 1,   cracks: .6,  edge: .6,  fade: .3,  speckle: .2, runoff: 0,  grime: 0 },
  tunnel:   { tone: .72, warm: .15, wear: .8,  patches: .2,  cracks: .2,  edge: .3,  fade: .5,  speckle: .1, runoff: .2, grime: 1 },
  // [finish] red paving brick in running bond, laid across the road (Pittsburgh's hillside streets); asphalt patches stay
  brick:    { tone: 1,   warm: 0,   wear: .45, patches: .35, cracks: .1,  edge: .3,  fade: .6,  speckle: 0,  runoff: 0,  grime: 0, brick: 1 },
  // granite setts ("Belgian block") laid in courses across the road (Canton Ave, Wyoming St); no paint, few patches
  cobble:   { tone: 1,   warm: 0,   wear: .35, patches: .1,  cracks: 0,   edge: .3,  fade: 1,   speckle: 0,  runoff: 0,  grime: 0, cobble: 1, centre: 0 },
};
const KEYS = ['tone', 'warm', 'wear', 'patches', 'cracks', 'edge', 'fade', 'speckle', 'runoff', 'grime', 'pavedM', 'centre', 'gravel', 'brick', 'cobble'];
const LOOK = { pavedM: null, centre: 1, gravel: 0, brick: 0, cobble: 0 };   // defaults for the look-only settings (pavedM: full width)
const MAX_ZONES = 24;

const MARK_BIN = 2, MARK_W = 4096;
const CENTRE = { none: 0, t1: 1, town: 2, t3: 3, solid: 4 };

/** French markings along the road, one texel per 2 m: R = centre line kind, G = edge lines (dashed / solid). */
export function frenchMarkings(road, route, index, { widthM = 7, boards = [] } = {}) {
  const total = route.dist[route.dist.length - 1], n = Math.ceil(total / MARK_BIN) + 1;
  const H = Math.ceil(n / MARK_W), data = new Uint8Array(MARK_W * H * 4);
  const zones = road.zones || [];
  const zoneAt = (s) => { const z = { pavedM: road.pavedM ?? widthM, centre: road.centre ?? 1, edges: road.edges ?? true, tunnel: false }; for (const q of zones) if (s >= q.fromM && s < q.toM) { if (q.pavedM != null) z.pavedM = q.pavedM; if (q.centre != null) z.centre = q.centre; if (q.edges != null) z.edges = q.edges; if (q.surface === 'tunnel') z.tunnel = true; } return z; };
  // villages: between a town board and its end board
  const towns = [];
  boards.forEach((b, i) => { if (b.kind !== 'town') return; const e = boards.slice(i + 1).find((x) => x.kind === 'townEnd' && x.title === b.title); towns.push([b.atM, e ? e.atM : b.atM + 500]); });
  const inTown = (s) => towns.some(([a, b]) => s >= a && s <= b);
  // bends you can't see through: the heading turns more than 40° within 25 m either side
  let j = 0;
  const at = (s) => { while (j > 0 && route.dist[j] > s) j--; while (j < route.dist.length - 2 && route.dist[j + 1] < s) j++; return j; };
  const heading = (s) => { const a = at(Math.max(0, s - 4)), b = at(Math.min(total, s + 4)) + 1; return Math.atan2(index.zs[b] - index.zs[a], index.xs[b] - index.xs[a]); };
  const turn = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const s = k * MARK_BIN;
    let d = Math.abs(heading(Math.min(total, s + 25)) - heading(Math.max(0, s - 25))); if (d > Math.PI) d = 2 * Math.PI - d;
    turn[k] = d > .7 ? 1 : 0;
  }
  // solid round the bend and 20 m beyond it, the warning dashes for 40 m before and after that
  const solid = new Uint8Array(n), warn = new Uint8Array(n);
  for (let k = 0; k < n; k++) if (turn[k]) for (let q = Math.max(0, k - 10); q <= Math.min(n - 1, k + 10); q++) solid[q] = 1;
  for (let k = 0; k < n; k++) if (solid[k]) for (let q = Math.max(0, k - 20); q <= Math.min(n - 1, k + 20); q++) warn[q] = 1;
  for (let k = 0; k < n; k++) {
    const s = k * MARK_BIN, z = zoneAt(s), town = inTown(s);
    let c = z.centre > 0 && z.pavedM >= 5.2 ? CENTRE.t1 : CENTRE.none;
    if (c && town) c = CENTRE.town;
    if (c && warn[k]) c = CENTRE.t3;
    if (c && (solid[k] || z.tunnel)) c = CENTRE.solid;
    const edge = z.edges !== false && z.pavedM >= 6.6 && !town ? (z.tunnel ? 2 : 1) : 0;
    data.set([c * 50, edge * 100, 0, 255], k * 4);
  }
  const tex = new THREE.DataTexture(data, MARK_W, H);
  tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  return { texture: tex, dims: new THREE.Vector3(MARK_W, H, MARK_BIN) };
}

/** Add the surface to a road material (u across the road 0…1, v = metres / repeatM along it). */
export function decorateRoad(material, road, { widthM = 7, repeatM = 24, marks = null } = {}) {
  if (!road) return material;
  const fr = !!marks;
  const params = (z) => { const k = { ...LOOK, ...(SURFACES[z.surface] || SURFACES.worn) }; for (const key of KEYS) if (z[key] != null) k[key] = z[key]; k.pavedM ??= widthM; return k; };
  const base = params({ surface: road.surface || 'worn' });
  const zones = (road.zones || []).slice(0, MAX_ZONES).map((z) => ({ ...z, p: params(z) }));
  // (unused slots all zero: w = 0 ends the shader's loop. [F12] THREE.Vector4() is (0, 0, 0, 1): the empty slots
  // read as zones at 0–0 m with every setting 0, blended over the first 20 m — a 0 m paved width there drew a
  // dark V with edge lines at the start of every road, e.g. where the Jail Trail leaves Smithfield St)
  const pack = (fn) => Array.from({ length: MAX_ZONES }, (_, i) => (zones[i] ? fn(zones[i]) : new THREE.Vector4(0, 0, 0, 0)));
  const uniforms = {
    rsBaseA: { value: new THREE.Vector4(base.tone, base.warm, base.wear, base.patches) },
    rsBaseB: { value: new THREE.Vector4(base.cracks, base.edge, base.fade, base.speckle) },
    rsBaseC: { value: new THREE.Vector4(base.runoff, base.grime, base.pavedM, base.centre) },
    rsBaseD: { value: new THREE.Vector4(base.gravel, base.brick || 0, base.cobble || 0, 0) },
    rsSpan: { value: pack((z) => new THREE.Vector4(z.fromM, z.toM, z.wet || 0, 1)) },
    rsA: { value: pack((z) => new THREE.Vector4(z.p.tone, z.p.warm, z.p.wear, z.p.patches)) },
    rsB: { value: pack((z) => new THREE.Vector4(z.p.cracks, z.p.edge, z.p.fade, z.p.speckle)) },
    rsC: { value: pack((z) => new THREE.Vector4(z.p.runoff, z.p.grime, z.p.pavedM, z.p.centre)) },
    rsD: { value: pack((z) => new THREE.Vector4(z.p.gravel, z.p.brick || 0, z.p.cobble || 0, 0)) },
    rsDims: { value: new THREE.Vector2(widthM, repeatM) },
  };
  if (fr) { uniforms.rsMarks = { value: marks.texture }; uniforms.rsMarksDims = { value: marks.dims }; }
  const prev = material.onBeforeCompile, prevKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(anchor('#include <common>'), `#include <common>
        ${fr ? '#define RS_FR\n        uniform sampler2D rsMarks; uniform vec3 rsMarksDims;' : ''}
        uniform vec4 rsBaseA; uniform vec4 rsBaseB; uniform vec4 rsBaseC; uniform vec4 rsBaseD;
        uniform vec4 rsSpan[${MAX_ZONES}]; uniform vec4 rsA[${MAX_ZONES}]; uniform vec4 rsB[${MAX_ZONES}]; uniform vec4 rsC[${MAX_ZONES}]; uniform vec4 rsD[${MAX_ZONES}];
        uniform vec2 rsDims;
${HASH_GLSL}
        // a line of width w (m) at distance d (m), antialiased over a pixel of size px (m); thin lines fade out
        float rsLine(float d, float w, float px) { return (1. - smoothstep(w * .5, w * .5 + px, abs(d))) * smoothstep(px * .8, px * 2.5, w * 2.); }`)
      .replace(anchor('#include <map_fragment>'), `#include <map_fragment>
        #ifdef USE_MAP
        {
          // road coordinates in metres: x across (0 at the left edge), s along from the start
          float x = vMapUv.x * rsDims.x, s = vMapUv.y * rsDims.y;
          vec2 rsPx2 = fwidth(vec2(x, s)); float px = max(rsPx2.x, rsPx2.y) + 1e-4;
          // this stretch's kind: the scene default, then each zone over it (40 m blends at the ends)
          vec4 A = rsBaseA, B = rsBaseB, C = rsBaseC, D = rsBaseD; float wet = 0.;
          for (int i = 0; i < ${MAX_ZONES}; i++) {
            vec4 z = rsSpan[i];
            if (z.w < .5) break;
            float k = smoothstep(z.x - 20., z.x + 20., s) * (1. - smoothstep(z.y - 20., z.y + 20., s));
            A = mix(A, rsA[i], k); B = mix(B, rsB[i], k); C = mix(C, rsC[i], k); D = mix(D, rsD[i], k); wet = max(wet, z.z * k);
          }
          // a little variety within a stretch (every 300 m or so)
          float vary = vn2(vec2(s / 310., 4.2));
          float tone = A.x * (.95 + vary * .1), warm = A.y, wearK = A.z, patchK = A.w * (.6 + vary * .8);
          float crackK = B.x * (.7 + vary * .6), edgeK = B.y, fadeK = B.z, speckK = B.w, runK = C.x, grime = C.y;
          vec3 col = diffuseColor.rgb;${fr ? ' vec3 paintCol = col;' : ''}
          float lum = dot(col, vec3(.2126, .7152, .0722));
          float paintRaw = smoothstep(.16, .3, lum);                           // the lines (bright on dark asphalt)
          float paint = paintRaw;
          float W0 = rsDims.x, xc = x - W0 * .5;                               // across the road from its centre
          // which line is it? the centre pair, or the edge lines; the centre fades, breaks up or goes
          float centreLine = 1. - smoothstep(.3, .45, abs(xc));
          float keepCentre = C.w >= .99 ? 1. : C.w * step(.35, vn2(vec2(s * .08, 9.)) + C.w * .5);
          float edgeLine = smoothstep(W0 * .5 - .75, W0 * .5 - .6, abs(xc));
          float paved = C.z * .5;                                              // paved half-width (m)
          float narrowed = smoothstep(.05, .2, W0 * .5 - paved);
          paint *= mix(1., keepCentre, centreLine) * (1. - edgeLine * narrowed);
          ${fr ? `          {
            // the French markings, in metres (frenchMarkings): white paint on a plain road texture
            float bin = floor(max(s, 0.) / rsMarksDims.z);
            vec4 mk = texture2D(rsMarks, vec2((mod(bin, rsMarksDims.x) + .5) / rsMarksDims.x, (floor(bin / rsMarksDims.x) + .5) / rsMarksDims.y));
            float ck = floor(mk.r * 255. / 50. + .5), ek = floor(mk.g * 255. / 100. + .5);
            float pxs = max(rsPx2.y, 1e-4);
            // a dash of length on in every period, antialiased at its ends
            #define RS_DASH(per, on) (smoothstep(0., pxs, mod(s, per)) * (1. - smoothstep(on - pxs, on, mod(s, per))))
            float cOn = ck > 3.5 ? 1. : ck > 2.5 ? RS_DASH(4.33, 3.) : ck > 1.5 ? RS_DASH(6.5, 1.5) : ck > .5 ? RS_DASH(13., 3.) : 0.;
            float centreP = rsLine(xc, .12, px) * cOn * keepCentre;   // a zone's faded centre still breaks up
            float eOn = ek > 1.5 ? 1. : ek > .5 ? RS_DASH(6.5, 3.) : 0.;
            float edgeP = rsLine(abs(xc) - (C.z * .5 - .35), .18, px) * eOn;
            paintRaw = 0.; paint = max(centreP, edgeP);
            // road paint: a little off-white, dirtier toward the shoulder
            paintCol = vec3(.80, .79, .74) * (1. - edgeP * .06);
          }` : ''}
          vec3 bare = texture2D(map, vec2(.3, vMapUv.y)).rgb;                   // the asphalt between the lines
          vec3 asphalt = vec3(dot(mix(col, bare, paintRaw), vec3(.2126, .7152, .0722))) * tone;      // the surface under the paint
          asphalt = mix(asphalt, asphalt * vec3(1.08, 1.0, .88), warm);
          float W = rsDims.x, lane = W * .5;
          // polished wheel tracks, a darker oily strip down the middle of each lane
          float xl = mod(x, lane);
          float tracks = rsLine(xl - lane * .27, .7, px) + rsLine(xl - lane * .73, .7, px);
          asphalt *= 1. + tracks * .1 * wearK * (.7 + vn2(vec2(x, s * .05)) * .6);
          asphalt *= 1. - rsLine(xl - lane * .5, .9, px) * .035 * wearK;
          // patches: rectangles of newer, darker asphalt, a lane or a wheel path wide, 5–25 m long
          float cellS = floor(s / 17.);
          float ph = hw21(vec2(cellS, 1.7));
          if (ph < patchK * .55) {
            float p0 = cellS * 17. + hw21(vec2(cellS, 2.3)) * 8., p1 = p0 + 5. + hw21(vec2(cellS, 3.9)) * 20.;
            float side = step(.5, hw21(vec2(cellS, 5.1)));
            float x0 = side * lane + hw21(vec2(cellS, 6.3)) * 1.2, x1 = x0 + 1.6 + hw21(vec2(cellS, 7.7)) * (lane - 1.4);
            float inP = smoothstep(p0 - px, p0, s) * (1. - smoothstep(p1, p1 + px, s)) * smoothstep(x0 - px, x0, x) * (1. - smoothstep(x1, x1 + px, x));
            asphalt = mix(asphalt, asphalt * vec3(.7, .72, .76) * (.92 + hw21(vec2(cellS, 8.1)) * .14), inP);
            // the patch's seam: a thin dark rim of sealant
            float rim = max(max(rsLine(s - p0, .08, px), rsLine(s - p1, .08, px)), max(rsLine(x - x0, .08, px), rsLine(x - x1, .08, px)));
            asphalt *= 1. - rim * .45 * step(p0 - .1, s) * step(s, p1 + .1) * step(x0 - .1, x) * step(x, x1 + .1);
          }
          // sealed cracks: wandering transverse ones every 6–20 m, and along the centre joint and the edges
          float tc = s / (6. + 14. * (1. - crackK * .7));
          float tcI = floor(tc + .5);
          float tcD = (tc - tcI) * (6. + 14. * (1. - crackK * .7)) + (vn2(vec2(x * .8, tcI)) - .5) * 1.1;
          float trans = rsLine(tcD, .05, px) * step(hw21(vec2(tcI, 9.1)), crackK) * smoothstep(.2, .45, vn2(vec2(x * .5, tcI + 3.)));
          float longi = rsLine(x - lane + (vn2(vec2(s * .09, 1.)) - .5) * .5, .05, px) * smoothstep(.45, .6, vn2(vec2(s * .05, 2.))) * crackK * .7;
          ${fr ? `          longi = 0.;   // French roads: the centre joint is the paving seam below, not a crack
          trans *= .55; // and sealed cracks are fewer and fainter (the reference roads are well kept)` : ''}
          longi = max(longi, rsLine(x - W * .1 + (vn2(vec2(s * .11, 5.)) - .5) * .6, .04, px) * smoothstep(.4, .6, vn2(vec2(s * .04, 6.))) * crackK);
          asphalt *= 1. - max(trans, longi) * .55;
          // chip seal: a speckle of light and dark stones (fades to its average far off)
          float sp = vn2(vec2(x, s) * 16.) * .6 + vn2(vec2(x, s) * 37.) * .4;
          float spSmall = 1. - smoothstep(.015, .05, px);
          asphalt *= 1. + (mix(.5, sp, spSmall) - .5) * .22 * speckK;
          // [finish] brick: courses 10.5 cm deep laid across the road, bricks 21.5 cm long in running bond, dark sand
          // joints that fade to the brick's average far off; tracks polished darker; patches and cracks still show
          if (D.y > .01) {
            float rowH = .105, bl = .215, row = floor(s / rowH);
            float bx = (x + mod(row, 2.) * bl * .5) / bl, bc = floor(bx), fx = fract(bx), fy = fract(s / rowH);
            float nearB = 1. - smoothstep(.012, .05, px);
            float joint = max(1. - smoothstep(.0, .06, min(fx, 1. - fx)), 1. - smoothstep(.0, .1, min(fy, 1. - fy)));
            float bh = hw21(vec2(bc, row));
            vec3 brickCol = mix(vec3(.2, .085, .06), vec3(.29, .13, .085), bh) * (.8 + vn2(vec2(x * .4, s * .25)) * .3);   // weathered red-brown (linear)
            brickCol = mix(brickCol, vec3(.05, .045, .04), joint * .85 * nearB);
            brickCol = mix(brickCol, vec3(.19, .09, .065), (1. - nearB) * .35);
            brickCol *= 1. - tracks * .22 * wearK;
            brickCol = mix(brickCol, vec3(.11, .1, .095), smoothstep(.62, .7, vn2(vec2(x * .7, s * .12))) * .55);   // grime and sunken spots
            asphalt = mix(asphalt, brickCol * tone, D.y);
          }
          // cobble: granite setts ~12 cm deep and 20–28 cm long in courses across the road, rounded tops (lit a little
          // lighter in the middle), wide dark joints; grey-brown with some stones bluer or warmer; fades to its mean far off
          if (D.z > .01) {
            float rowH = .13, row = floor(s / rowH), off = hw21(vec2(row, 3.7)) * .24;
            float bl = .24, bx = (x + off) / bl, bc = floor(bx);
            float len = .8 + hw21(vec2(bc, row)) * .35, fx = fract(bx) / len, fy = fract(s / rowH);
            float nearC = 1. - smoothstep(.012, .05, px);
            float jx = min(fract(bx), 1. - fract(bx)), jy = min(fy, 1. - fy);
            float joint = max(1. - smoothstep(.0, .09, jx), 1. - smoothstep(.0, .13, jy));
            float ch = hw21(vec2(bc + 17., row));
            vec3 setCol = mix(vec3(.13, .125, .12), vec3(.2, .19, .175), ch);
            setCol = mix(setCol, vec3(.12, .13, .15), step(.82, hw21(vec2(bc, row + 5.))) * .6);     // bluer granite
            setCol = mix(setCol, vec3(.19, .15, .12), step(.88, hw21(vec2(bc + 3., row))) * .5);      // warmer stones
            setCol *= .9 + .2 * (1. - abs(fy - .5) * 2.) * (1. - abs(fract(bx) - .5) * 2.);             // rounded tops
            setCol = mix(setCol, vec3(.035, .033, .03), joint * .9 * nearC);
            setCol = mix(setCol, vec3(.14, .135, .125), (1. - nearC) * .4);
            setCol *= 1. - tracks * .12 * wearK;
            asphalt = mix(asphalt, setCol * tone, D.z);
            paint *= 1. - D.z;
          }
          ${fr ? `          {
            // aggregate: light grey stones a centimetre or two across in a darker binder (fades to its mean far off)
            float near = 1. - smoothstep(.006, .04, px);
            float ag = vn2(vec2(x, s) * 55.) * .55 + vn2(vec2(x, s) * 131.) * .45;
            float stones = smoothstep(.6, .78, ag);
            asphalt *= 1. + (mix(.2, stones, near) - .2) * .3;
            // bleached and oily mottling, a metre to a few metres across
            float mot = vn2(vec2(x * .33, s * .16)) * .6 + vn2(vec2(x * .9, s * .45)) * .4;
            asphalt *= .93 + mot * .14;
            // the seam down the middle where the two passes of the paver meet: a slightly darker, straighter line
            asphalt *= 1. - rsLine(xc - .03, .04, px) * .1 * (.4 + crackK);
            // repair strips along the edges: newer, darker asphalt a metre or so wide, tens of metres long
            float rs = floor(s / 61.), rside = step(.5, hw21(vec2(rs, 4.4))) * 2. - 1.;
            float rIn = step(hw21(vec2(rs, 2.2)), patchK * .45) * step(mod(s, 61.), 18. + hw21(vec2(rs, 3.3)) * 40.);
            float rw = .9 + hw21(vec2(rs, 5.5)) * .7, rEdge = C.z * .5 - rw + (vn2(vec2(s * .3, rs)) - .5) * .12;
            float strip = rIn * smoothstep(rEdge - px, rEdge + px, xc * rside);
            asphalt = mix(asphalt, asphalt * vec3(.78, .79, .82), strip);
          }` : ''}
          // the edges: dust and grit along the shoulders, crumbling in bites where the frost gets in
          float e = min(x, W - x);
          float bite = vn2(vec2(s * .35, x < lane ? 1. : 7.)) * .55 * edgeK;
          asphalt = mix(asphalt, vec3(.2, .18, .15), (1. - smoothstep(.0, .35 + bite, e)) * .55 * edgeK);
          asphalt = mix(asphalt, asphalt * vec3(1.15, 1.1, 1.), (1. - smoothstep(.2, .9, e)) * .5 * edgeK);
          // snowmelt: dark wet bands across the road below the snowfields, and wet stretches (zones)
          float rn = vn2(vec2(s / 47., 3.3));
          float run = smoothstep(.72, .76, rn + (vn2(vec2(x * .4, s * .2)) - .5) * .08) * runK;
          float damp = max(run, wet * (.7 + .3 * vn2(vec2(x * .6, s * .3))));
          asphalt = mix(asphalt, asphalt * vec3(.55, .6, .68), damp);
          // tunnels: grime darkest along the walls
          asphalt *= 1. - grime * (.15 + .3 * (1. - smoothstep(.0, 1.6, e)));
          // loose gravel spread over the lanes (patches thrown up from the shoulders and the cuts)
          float gv = D.x;
          if (gv > .01) {
            float gp = smoothstep(.55, .62, vn2(vec2(x * .35, s * .05)) * .7 + vn2(vec2(x * 1.3, s * .25)) * .3 + (1. - smoothstep(.0, 1.8, abs(abs(xc) - paved))) * .25);
            float grit = mix(.5, vn2(vec2(x, s) * 22.) * .6 + vn2(vec2(x, s) * 51.) * .4, 1. - smoothstep(.008, .03, px));
            asphalt = mix(asphalt, vec3(.24, .21, .17) * (.8 + grit * .4), gp * gv * .7);
          }
          // a narrower paved road: the rest of the strip is a gravel shoulder with a ragged paving edge
          float pe = paved + (vn2(vec2(s * .6, xc > 0. ? 3. : 8.)) - .5) * .18;
          float shoulder = smoothstep(pe - px, pe + px, abs(xc)) * narrowed;
          float grit2 = mix(.5, vn2(vec2(x, s) * 18.) * .6 + vn2(vec2(x, s) * 43.) * .4, 1. - smoothstep(.008, .03, px));
          vec3 gravelCol = vec3(.27, .24, .19) * (.82 + grit2 * .36 + vn2(vec2(x * 2., s * .3)) * .1);
          asphalt = mix(asphalt, gravelCol, shoulder);
          // paint: worn through in the wheel tracks and faded with age
          float paintLeft = paint * (1. - fadeK * (.5 + .5 * vn2(vec2(x * 3., s * .4)))) * (1. - tracks * .4 * wearK) * (1. - damp * .3);
          // the edge lines, repainted just inside the narrower paving
          float newEdge = rsLine(abs(xc) - (paved - .22), .11, px) * narrowed;
          vec3 edgePaint = vec3(.82, .79, .68) * (1. - damp * .25);
          ${fr ? `          newEdge = 0.;   // the French edge lines are drawn above, by the rules` : ''}
          diffuseColor.rgb = mix(mix(asphalt, ${fr ? 'paintCol' : 'col'} * (1. - damp * .25), paintLeft), edgePaint, newEdge * (1. - fadeK * .5 * vn2(vec2(x * 3., s * .4))));
        }
        #endif`);
  };
  material.customProgramCacheKey = () => `${prevKey}|road-surface-3${fr ? '-fr' : ''}`;
  material.needsUpdate = true;
  return material;
}
