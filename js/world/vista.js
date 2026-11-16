// Vista kit: the pieces that make a stylized route read at a distance, shared by every route that opts in
// with a "vista" block in its scene JSON. Each part is optional and costs no draw calls of its own:
//
//   "vista": {
//     "rock":   { "ribs": .9, "ledges": .7, "scree": .6 },   // mountain faces: gullies and spurs, ledges, loose rock
//     "snow":   { "gullies": .8, "ledges": .6 },              // snow held in the gullies and on the ledges
//     "meadow": { "mottle": .5 },                             // shrub patches and colour drift on open slopes
//     "forest": { "crowns": .8, "boost": 1.6 },               // distant canopy as crowns; partial cover reads denser
//     "haze":   { "strength": .55, "rangeM": 7000, "falloffM": 900, "baseM": 1000, "blue": .35 },  // aerial perspective
//     "ridgeInk": { "strength": .35, "thresh": .22, "startM": 450 },                  // faint outlines on far ridges
//     "clouds": { "count": 34, "minM": 6000, "maxM": 15000, "baseM": 2600, "spanM": 1200 }  // cartoon cumulus
//   }
//
// The ground parts are GLSL added to the scene's ground material (coastal-materials.js); they use the real
// landform's own normals and heights, so they follow the real place. Haze lives in the shared fog chunk
// (haze.js), ridge ink in post.js's final pass, and the clouds replace the soft cloud ring (one draw call).
import * as THREE from '../../vendor/three.module.min.js';

const DEFAULTS = {
  rock: { ribs: .9, ledges: .7, scree: .6, cuts: 0, ribWidthM: 30, ribLengthM: 170, reliefM: 22, ledgeM: 30 },
  snow: { gullies: .8, ledges: .6 },
  meadow: { mottle: .5 },
  forest: { crowns: .8, boost: 1.6 },
  haze: { strength: .55, rangeM: 7000, falloffM: 900, baseM: null, blue: .35 },
  ridgeInk: { strength: .35, thresh: .22, startM: 450 },
  clouds: { count: 34, minM: 6000, maxM: 15000, baseM: null, spanM: 1200 },
};

/** The scene's vista settings with defaults filled in, or null when the scene doesn't opt in. */
export function vistaConfig(scene) {
  const v = scene?.vista;
  if (!v) return null;
  const out = {};
  for (const [part, dflt] of Object.entries(DEFAULTS)) {
    if (v[part] === false || v[part] == null) continue;   // only the parts the scene lists
    out[part] = { ...dflt, ...(v[part] === true ? {} : v[part]) };
  }
  return out;
}

const f = (n) => Number(n).toFixed(4);

/**
 * GLSL for the ground material. `pars` goes at file scope (after the noise helpers), `color` at the end of
 * the colour code (inside main, before the weather), `normal` after normal_fragment_maps. Variables the
 * colour code sets (vk*) are read again by the normal code.
 */
export function vistaGroundGLSL(v, palette, vkAttr = false) {
  if (!v || !(v.rock || v.snow || v.meadow || v.forest)) return null;
  const R = v.rock || { ribs: 0, ledges: 0, scree: 0, ribWidthM: 30, ribLengthM: 170, reliefM: 0, ledgeM: 32 };
  const S = v.snow || { gullies: 0, ledges: 0 };
  const M = v.meadow || { mottle: 0 };
  const uniforms = {
    vkScree: { value: new THREE.Color(palette.scree || '#b3ab9c') },
    vkAlpine: { value: new THREE.Color(palette.meadow || '#93a566') },
    vkShrub: { value: new THREE.Color(palette.shrub || palette.forest || '#2e4635') },
    vkSnow: { value: new THREE.Color(palette.snow || '#eef2f3') },
    vkCutCol: { value: new THREE.Color(palette.cutRock || palette.rock || '#8e877c') },
    vkBurnCol: { value: new THREE.Color(palette.burn || '#a39d92') },
    vkFireweed: { value: new THREE.Color(palette.fireweed || '#c2649a') },
  };
  const cuts = vkAttr ? (R.cuts || 0) : 0;
  const pars = /* glsl */`
    uniform vec3 vkScree; uniform vec3 vkAlpine; uniform vec3 vkShrub; uniform vec3 vkSnow;
    uniform vec3 vkCutCol; uniform vec3 vkBurnCol; uniform vec3 vkFireweed;
    // gullies and spurs on one face projection: stretched along the fall line, warped so they wander,
    // octaves that would be narrower than about two pixels fade to their mean (no shimmer far away)
    float vkRibs(vec2 q, float px) {
      vec2 s = vec2(q.x / ${f(R.ribWidthM)}, q.y / ${f(R.ribLengthM)});
      s.x += bfNoise(vec2(q.x * .0035, q.y * .005)) * 2.4;
      float n = bfNoise(s), r = 1. - abs(2. * n - 1.);                      // ridged: sharp spurs, round gullies
      float fade1 = 1. - smoothstep(.35, .8, px * 2.1 / ${f(R.ribWidthM)});
      float fade2 = 1. - smoothstep(.35, .8, px * 4.3 / ${f(R.ribWidthM)});
      float a = r * .62 + mix(.5, bfNoise(s * 2.1 + 7.3), fade1) * .26 + mix(.5, bfNoise(s * 4.3 - 3.1), fade2) * .12;
      return a;
    }`;
  const color = /* glsl */`
    // ---- vista kit (js/world/vista.js) ----
    vec3 vkN = normalize(vBfGroundNormal);
    float vkPx = bfDistance * .0017 + .02;                       // about a pixel, in metres, at this distance
    vec2 vkW = abs(vkN.xz) + 1e-3; vkW /= vkW.x + vkW.y;          // which face projection (facing ±x or ±z)
    // the ground far off is built coarser and reads gentler than it is: steepen it with distance
    float vkSl = bfSlope * (1. + smoothstep(250., 2500., bfDistance) * .7);
    float vkFace = smoothstep(.07, .3, vkSl);                     // a mountain face, not a meadow
    float vkRib = .5, vkDx = 0., vkDz = 0.;                       // 0 gully … 1 spur
    if (vkSl > .07) {   // only on slopes: the meadows and valley floors skip the ribs
      float vkRibX = vkRibs(vec2(bp.z, bp.y), vkPx), vkRibZ = vkRibs(vec2(bp.x, bp.y), vkPx);
      vkRib = vkRibX * vkW.x + vkRibZ * vkW.y;
      // across-slope gradient of the ribs (for the lighting), one metre steps
      vkDx = vkRibs(vec2(bp.x + 1., bp.y), vkPx) - vkRibZ;
      vkDz = vkRibs(vec2(bp.z + 1., bp.y), vkPx) - vkRibX;
    }
    // ledges: bands that follow the (warped) contours; the tread holds grass or snow, the riser is rock
    float vkLy = bp.y + (bfFbm(bp.xz * .0045) - .5) * 46. + (vkRib - .5) * 8.;
    float vkL = fract(vkLy / ${f(R.ledgeM)});
    // a tread is about a fifth of a ledge: draw ledges only while a tread is a few pixels tall
    float vkLedgeFade = smoothstep(1.4, 3., ${f(R.ledgeM)} * .18 / vkPx);
    // narrow treads, each ledge broken up along its length (its own pattern per ledge)
    float vkBreak = smoothstep(.44, .58, bfFbm(bp.xz * .018 + floor(vkLy / ${f(R.ledgeM)}) * 3.7));
    float vkTread = smoothstep(.03, .08, vkL) * (1. - smoothstep(.17, .25, vkL)) * vkLedgeFade * vkBreak;
    float vkLedges = ${f(R.ledges)} * smoothstep(.14, .3, vkSl) * (1. - smoothstep(.82, .95, bfSlope));
    // rock on the spurs and the steep, the gullies stay green (or hold snow, or loose rock) a little longer
    float vkRock = smoothstep(.13, .3, vkSl + (vkRib - .5) * .35 * ${f(R.ribs)}) * vkFace;
    diffuseColor.rgb = mix(diffuseColor.rgb, bfStone * (.74 + vkRib * .42), vkRock * .85);
    diffuseColor.rgb = mix(diffuseColor.rgb, vkAlpine * (.82 + bfFine * .2), vkRock * vkTread * vkLedges * .55 * (1. - smoothstep(bfSnowLine - 150., bfSnowLine + 200., bp.y)));
    // loose rock: pale aprons in the gullies and on the moderate slopes below the faces, streaked downhill
    float vkScreeMask = ${f(R.scree)} * smoothstep(.1, .2, vkSl) * (1. - smoothstep(.36, .5, vkSl)) * (1. - smoothstep(.36, .5, vkRib))
      * smoothstep(.5, .54, bfFbm(bp.xz * .006 + 3.)) * smoothstep(bfSnowLine - 700., bfSnowLine - 350., bp.y);
    diffuseColor.rgb = mix(diffuseColor.rgb, vkScree * (.84 + vkRib * .3 + bfFine * .1), vkScreeMask);
    ${M.mottle > 0 ? `
    // open slopes: shrub patches and a slow drift between yellow-green and blue-green
    float vkOpen = (1. - vkRock) * (1. - smoothstep(.62, .72, bfSnow));
    float vkPatch = bfFbm(bp.xz * .045 + vec2(bfNoise(bp.xz * .004) * 3.));
    float vkPatchFade = 1. - smoothstep(.5, 1., vkPx * 1.6 / 22.);
    diffuseColor.rgb = mix(diffuseColor.rgb, vkShrub * 1.05, vkOpen * smoothstep(.56, .6, vkPatch) * mix(.4, .8, vkPatchFade) * ${f(M.mottle)});
    float vkDrift = bfFbm(bp.xz * .0016 + 11.);
    diffuseColor.rgb *= mix(vec3(1.), mix(vec3(1.04, 1.03, .9), vec3(.92, 1., 1.04), smoothstep(.35, .65, vkDrift)), vkOpen * ${f(M.mottle)});` : ''}
    ${cuts > 0 ? `
    // road cuts: the blasted face above the road — half-barrel drill marks, fracture lines, seeps staining
    // it dark and wet, a little moss at the foot
    float vkCutK = ${f(cuts)} * smoothstep(.7, 2.4, vVk.x) * smoothstep(.12, .3, bfSlope) * (1. - smoothstep(250., 450., bfDistance));
    // patterns sampled on each fixed face projection and blended (blending the coordinates would shear them)
    #define VK_FACE(F) (F(bp.z) * vkW.x + F(bp.x) * vkW.y)
    #define VK_SEEP(u) (bfNoise(vec2((u) * .18, 3.)) + bfNoise(vec2((u) * .5, bp.y * .03)) * .25)
    #define VK_GRAIN(u) bfNoise(vec2((u) * .35, bp.y * .06))
    float vkSeep = smoothstep(.62, .7, VK_FACE(VK_SEEP));
    vec3 vkCutRock = vkCutCol * (.82 + VK_FACE(VK_GRAIN) * .26);
    vkCutRock = mix(vkCutRock, vkCutRock * vec3(.55, .58, .52), vkSeep * .8);
    diffuseColor.rgb = mix(diffuseColor.rgb, vkCutRock, vkCutK);
    vkRock = max(vkRock, vkCutK);` : ''}
    ${vkAttr ? `
    // fire scars: grey ash ground, pink fireweed in drifts
    float vkBurnK = vVk.y;
    if (vkBurnK > .01) {
      // mostly green-grey regrowth, pink drifts of fireweed
      float vkFw = smoothstep(.58, .64, bfFbm(bp.xz * .09 + 7.) + (bfNoise(bp.xz * .6) - .5) * .12) * (1. - vkRock);
      vec3 vkRegrowth = mix(diffuseColor.rgb, vkBurnCol * .8, .4);
      diffuseColor.rgb = mix(diffuseColor.rgb, mix(vkRegrowth, mix(vkRegrowth, vkFireweed, .6), vkFw * .5), vkBurnK * .7);
    }` : ''}
    // snow held in the gullies and on the ledges below and above the snow line (north faces keep more)
    float vkNorth = max(0., -vkN.z);
    float vkSnowLvl = smoothstep(bfSnowLine - 320., bfSnowLine + 120., bp.y + vkNorth * 160. + (bfFbm(bp.xz * .002 + 9.) - .5) * 260.);
    float vkGullySnow = ${f(S.gullies)} * vkSnowLvl * (1. - smoothstep(.28, .36, vkRib + (1. - vkNorth) * .06)) * vkFace * (1. - smoothstep(.8, .95, bfSlope));
    float vkLedgeSnow = ${f(S.ledges)} * vkSnowLvl * vkTread * vkLedges * smoothstep(.45, .55, bfFbm(bp.xz * .01 + 5.) + vkNorth * .2);
    float vkSnowAll = max(vkGullySnow, vkLedgeSnow);
    diffuseColor.rgb = mix(diffuseColor.rgb, vkSnow * (.9 + vkRib * .1), vkSnowAll);
    float vkBump = ${f(R.reliefM * R.ribs)} * vkFace * (1. - vkSnowAll * .6);
    float vkStep = vkLedges * vkRock * (vkTread * 2. - .6);
    ${cuts > 0 ? 'vkBump *= 1. - vkCutK * .7;' : ''}`;
  const normal = /* glsl */`
    {
      // vista kit: the gullies, spurs and ledges catch the light (the cartoon bands follow them)
      vec3 vkNw = vkN - (vec3(vkDx, 0., 0.) * vkW.y + vec3(0., 0., vkDz) * vkW.x) * vkBump;
      vkNw.y += vkStep * .45 * (1. - abs(vkN.y));
      vkNw = normalize(vkNw);
      normal = normalize((viewMatrix * vec4(vkNw, 0.)).xyz);
      #ifdef DOUBLE_SIDED
        normal *= faceDirection;
      #endif
    }`;
  return { uniforms, pars, color, normal };
}

/**
 * Distant canopy as crowns (forest-edge scenes): replaces the fine mottling, which flickers at a few
 * pixels a tree, with crowns lit on the sun side that fade to their average colour once they get small.
 * Partial cover (open subalpine forest) is boosted so the far slopes read as an even, dense stand.
 */
export function vistaCanopyGLSL(v, vkAttr = false) {
  if (!v?.forest) return null;
  const F = v.forest;
  return /* glsl */`
    {
      float vkPxC = length(cameraPosition - vBfGround) * .0017 + .02;
      vec2 vkG = vBfGround.xz / 7.5, vkI = floor(vkG), vkF = fract(vkG) - .5;
      vec2 vkO = (vec2(bfHash(vkI + 3.1), bfHash(vkI + 7.7)) - .5) * .45;
      vec2 vkD = vkF - vkO;
      float vkCrown = 1. - smoothstep(.3, .42, length(vkD));
      float vkLit = smoothstep(-.1, .2, -vkD.x - vkD.y);               // the sun side of each crown
      float vkTone = mix(.5, .92 + vkLit * .32, vkCrown) * (.9 + bfHash(vkI) * .2);
      vkTone = mix(vkTone, .72, smoothstep(.12, .4, vkPxC / 7.5));      // small on screen: the average
      vec3 vkTop = bfCanopyColor * (vkTone + (bfFbm(vBfGround.xz * .012) - .5) * .18);
      ${vkAttr ? 'vkTop = mix(vkTop, vec3(.36, .35, .33) * vkTone * 1.2, vVk.y);   // burned: silver snags' : ''}
      float vkCover = min(1., vBfCanopy * ${f(F.boost)}) * (1. - (${vkAttr ? 'vVk.y' : '0.'}) * .5);
      diffuseColor.rgb = mix(diffuseColor.rgb, vkTop, smoothstep(0., .5, vkCover) * ${f(F.crowns)});
    }`;
}

/**
 * Cartoon cumulus: four cloud shapes in one texture, each a flat-bottomed heap with a lit top and a cool
 * shaded base. RGB carries the shading, alpha the shape, so the existing cloud shaders can draw it.
 */
export function makeCumulusAtlas() {
  const W = 512, H = 256, canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  let seed = 4242;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let k = 0; k < 4; k++) {
    const ox = (k % 2) * 256, oy = Math.floor(k / 2) * 128, base = oy + 104;
    const puffs = [];
    const n = 5 + Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) {
      const t = (i + .5) / n, x = ox + 30 + t * 196 + (rand() - .5) * 14;
      const r = 20 + Math.sin(t * Math.PI) * (26 + rand() * 18);
      puffs.push([x, base - r * .55 - Math.sin(t * Math.PI) * 14 - rand() * 8, r]);
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(ox, oy, 256, base - oy); ctx.clip();   // the flat base
    const draw = (color, dy, shrink) => {
      ctx.fillStyle = color;
      for (const [x, y, r] of puffs) { ctx.beginPath(); ctx.arc(x, y + dy, Math.max(1, r - shrink), 0, Math.PI * 2); ctx.fill(); }
    };
    draw('#c6d1e0', 0, 0);       // the shaded body
    draw('#e6ecf3', -6, 3);      // a mid band
    draw('#ffffff', -13, 7);     // the sunlit tops
    ctx.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, cells: [[0, .5], [.5, .5], [0, 0], [.5, 0]], cellSize: [.5, .5] };
}
