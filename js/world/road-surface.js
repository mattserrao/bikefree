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
// Kinds: fresh, worn, chipseal, alpine, patched, tunnel. Any number in a kind can be overridden in a zone
// (e.g. "patches": 0.9). Distances are along the road from the start (out-and-backs: the outbound half).
import * as THREE from '../../vendor/three.module.min.js';

// tone (×brightness), warm (toward brown), wear (polished wheel tracks), patches, cracks, edge (crumbling
// edges and dust), fade (paint faded), speckle (chip-seal stones), runoff (snowmelt across the road), grime
export const SURFACES = {
  fresh:    { tone: .78, warm: 0,   wear: .15, patches: .04, cracks: .05, edge: .15, fade: 0,   speckle: .1, runoff: 0,  grime: 0 },
  worn:     { tone: 1,   warm: .1,  wear: .6,  patches: .4,  cracks: .45, edge: .5,  fade: .25, speckle: .2, runoff: 0,  grime: 0 },
  chipseal: { tone: 1.06, warm: .35, wear: .35, patches: .2, cracks: .2,  edge: .45, fade: .15, speckle: .9, runoff: 0,  grime: 0 },
  alpine:   { tone: 1.1, warm: .2,  wear: .5,  patches: .7,  cracks: .85, edge: .85, fade: .35, speckle: .35, runoff: .6, grime: 0 },
  patched:  { tone: .95, warm: .1,  wear: .5,  patches: 1,   cracks: .6,  edge: .6,  fade: .3,  speckle: .2, runoff: 0,  grime: 0 },
  tunnel:   { tone: .72, warm: .15, wear: .8,  patches: .2,  cracks: .2,  edge: .3,  fade: .5,  speckle: .1, runoff: .2, grime: 1 },
};
const KEYS = ['tone', 'warm', 'wear', 'patches', 'cracks', 'edge', 'fade', 'speckle', 'runoff', 'grime'];
const MAX_ZONES = 24;

/** Add the surface to a road material (u across the road 0…1, v = metres / repeatM along it). */
export function decorateRoad(material, road, { widthM = 7, repeatM = 24 } = {}) {
  if (!road) return material;
  const params = (z) => { const k = { ...(SURFACES[z.surface] || SURFACES.worn) }; for (const key of KEYS) if (z[key] != null) k[key] = z[key]; return k; };
  const base = params({ surface: road.surface || 'worn' });
  const zones = (road.zones || []).slice(0, MAX_ZONES).map((z) => ({ ...z, p: params(z) }));
  const pack = (fn) => Array.from({ length: MAX_ZONES }, (_, i) => (zones[i] ? fn(zones[i]) : new THREE.Vector4()));
  const uniforms = {
    rsBaseA: { value: new THREE.Vector4(base.tone, base.warm, base.wear, base.patches) },
    rsBaseB: { value: new THREE.Vector4(base.cracks, base.edge, base.fade, base.speckle) },
    rsBaseC: { value: new THREE.Vector4(base.runoff, base.grime, 0, 0) },
    rsSpan: { value: pack((z) => new THREE.Vector4(z.fromM, z.toM, z.wet || 0, 1)) },
    rsA: { value: pack((z) => new THREE.Vector4(z.p.tone, z.p.warm, z.p.wear, z.p.patches)) },
    rsB: { value: pack((z) => new THREE.Vector4(z.p.cracks, z.p.edge, z.p.fade, z.p.speckle)) },
    rsC: { value: pack((z) => new THREE.Vector4(z.p.runoff, z.p.grime, 0, 0)) },
    rsDims: { value: new THREE.Vector2(widthM, repeatM) },
  };
  const prev = material.onBeforeCompile, prevKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec4 rsBaseA; uniform vec4 rsBaseB; uniform vec4 rsBaseC;
        uniform vec4 rsSpan[${MAX_ZONES}]; uniform vec4 rsA[${MAX_ZONES}]; uniform vec4 rsB[${MAX_ZONES}]; uniform vec4 rsC[${MAX_ZONES}];
        uniform vec2 rsDims;
        float rsHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
        float rsNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
          return mix(mix(rsHash(i), rsHash(i + vec2(1., 0.)), f.x), mix(rsHash(i + vec2(0., 1.)), rsHash(i + 1.), f.x), f.y); }
        // a line of width w (m) at distance d (m), antialiased over a pixel of size px (m); thin lines fade out
        float rsLine(float d, float w, float px) { return (1. - smoothstep(w * .5, w * .5 + px, abs(d))) * smoothstep(px * .8, px * 2.5, w * 2.); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        #ifdef USE_MAP
        {
          // road coordinates in metres: x across (0 at the left edge), s along from the start
          float x = vMapUv.x * rsDims.x, s = vMapUv.y * rsDims.y;
          vec2 rsPx2 = fwidth(vec2(x, s)); float px = max(rsPx2.x, rsPx2.y) + 1e-4;
          // this stretch's kind: the scene default, then each zone over it (40 m blends at the ends)
          vec4 A = rsBaseA, B = rsBaseB, C = rsBaseC; float wet = 0.;
          for (int i = 0; i < ${MAX_ZONES}; i++) {
            vec4 z = rsSpan[i];
            if (z.w < .5) break;
            float k = smoothstep(z.x - 20., z.x + 20., s) * (1. - smoothstep(z.y - 20., z.y + 20., s));
            A = mix(A, rsA[i], k); B = mix(B, rsB[i], k); C = mix(C, rsC[i], k); wet = max(wet, z.z * k);
          }
          // a little variety within a stretch (every 300 m or so)
          float vary = rsNoise(vec2(s / 310., 4.2));
          float tone = A.x * (.95 + vary * .1), warm = A.y, wearK = A.z, patchK = A.w * (.6 + vary * .8);
          float crackK = B.x * (.7 + vary * .6), edgeK = B.y, fadeK = B.z, speckK = B.w, runK = C.x, grime = C.y;
          vec3 col = diffuseColor.rgb;
          float lum = dot(col, vec3(.2126, .7152, .0722));
          float paint = smoothstep(.16, .3, lum);                              // the lines (bright on dark asphalt)
          vec3 asphalt = vec3(lum * (1. - paint) + .12 * paint) * tone;      // the surface under the paint
          asphalt = mix(asphalt, asphalt * vec3(1.08, 1.0, .88), warm);
          float W = rsDims.x, lane = W * .5;
          // polished wheel tracks, a darker oily strip down the middle of each lane
          float xl = mod(x, lane);
          float tracks = rsLine(xl - lane * .27, .7, px) + rsLine(xl - lane * .73, .7, px);
          asphalt *= 1. + tracks * .1 * wearK * (.7 + rsNoise(vec2(x, s * .05)) * .6);
          asphalt *= 1. - rsLine(xl - lane * .5, .9, px) * .07 * wearK;
          // patches: rectangles of newer, darker asphalt, a lane or a wheel path wide, 5–25 m long
          float cellS = floor(s / 17.);
          float ph = rsHash(vec2(cellS, 1.7));
          if (ph < patchK * .55) {
            float p0 = cellS * 17. + rsHash(vec2(cellS, 2.3)) * 8., p1 = p0 + 5. + rsHash(vec2(cellS, 3.9)) * 20.;
            float side = step(.5, rsHash(vec2(cellS, 5.1)));
            float x0 = side * lane + rsHash(vec2(cellS, 6.3)) * 1.2, x1 = x0 + 1.6 + rsHash(vec2(cellS, 7.7)) * (lane - 1.4);
            float inP = smoothstep(p0 - px, p0, s) * (1. - smoothstep(p1, p1 + px, s)) * smoothstep(x0 - px, x0, x) * (1. - smoothstep(x1, x1 + px, x));
            asphalt = mix(asphalt, asphalt * vec3(.7, .72, .76) * (.92 + rsHash(vec2(cellS, 8.1)) * .14), inP);
            // the patch's seam: a thin dark rim of sealant
            float rim = max(max(rsLine(s - p0, .08, px), rsLine(s - p1, .08, px)), max(rsLine(x - x0, .08, px), rsLine(x - x1, .08, px)));
            asphalt *= 1. - rim * .45 * step(p0 - .1, s) * step(s, p1 + .1) * step(x0 - .1, x) * step(x, x1 + .1);
          }
          // sealed cracks: wandering transverse ones every 6–20 m, and along the centre joint and the edges
          float tc = s / (6. + 14. * (1. - crackK * .7));
          float tcI = floor(tc + .5);
          float tcD = (tc - tcI) * (6. + 14. * (1. - crackK * .7)) + (rsNoise(vec2(x * .8, tcI)) - .5) * 1.1;
          float trans = rsLine(tcD, .05, px) * step(rsHash(vec2(tcI, 9.1)), crackK) * smoothstep(.2, .45, rsNoise(vec2(x * .5, tcI + 3.)));
          float longi = rsLine(x - lane + (rsNoise(vec2(s * .09, 1.)) - .5) * .5, .05, px) * smoothstep(.35, .55, rsNoise(vec2(s * .05, 2.))) * crackK;
          longi = max(longi, rsLine(x - W * .1 + (rsNoise(vec2(s * .11, 5.)) - .5) * .6, .04, px) * smoothstep(.4, .6, rsNoise(vec2(s * .04, 6.))) * crackK);
          asphalt *= 1. - max(trans, longi) * .55;
          // chip seal: a speckle of light and dark stones (fades to its average far off)
          float sp = rsNoise(vec2(x, s) * 16.) * .6 + rsNoise(vec2(x, s) * 37.) * .4;
          float spSmall = 1. - smoothstep(.015, .05, px);
          asphalt *= 1. + (mix(.5, sp, spSmall) - .5) * .22 * speckK;
          // the edges: dust and grit along the shoulders, crumbling in bites where the frost gets in
          float e = min(x, W - x);
          float bite = rsNoise(vec2(s * .35, x < lane ? 1. : 7.)) * .55 * edgeK;
          asphalt = mix(asphalt, vec3(.2, .18, .15), (1. - smoothstep(.0, .35 + bite, e)) * .55 * edgeK);
          asphalt = mix(asphalt, asphalt * vec3(1.15, 1.1, 1.), (1. - smoothstep(.2, .9, e)) * .5 * edgeK);
          // snowmelt: dark wet bands across the road below the snowfields, and wet stretches (zones)
          float rn = rsNoise(vec2(s / 47., 3.3));
          float run = smoothstep(.72, .76, rn + (rsNoise(vec2(x * .4, s * .2)) - .5) * .08) * runK;
          float damp = max(run, wet * (.7 + .3 * rsNoise(vec2(x * .6, s * .3))));
          asphalt = mix(asphalt, asphalt * vec3(.55, .6, .68), damp);
          // tunnels: grime darkest along the walls
          asphalt *= 1. - grime * (.15 + .3 * (1. - smoothstep(.0, 1.6, e)));
          // paint: worn through in the wheel tracks and faded with age
          float paintLeft = paint * (1. - fadeK * (.5 + .5 * rsNoise(vec2(x * 3., s * .4)))) * (1. - tracks * .4 * wearK) * (1. - damp * .3);
          diffuseColor.rgb = mix(asphalt, col * (1. - damp * .25), paintLeft);
        }
        #endif`);
  };
  material.customProgramCacheKey = () => `${prevKey}|road-surface`;
  material.needsUpdate = true;
  return material;
}
