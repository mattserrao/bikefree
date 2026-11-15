// World-space surfaces keep the style-C palette while adding detail at both
// riding and scenic camera distances. Everything is procedural and offline.
import * as THREE from '../../vendor/three.module.min.js';

const noise = /* glsl */`
  float bfHash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * .1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }
  float bfNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(bfHash(i), bfHash(i + vec2(1., 0.)), f.x),
               mix(bfHash(i + vec2(0., 1.)), bfHash(i + 1.), f.x), f.y);
  }
  float bfFbm(vec2 p) {
    return bfNoise(p) * .57 + bfNoise(p * 2.07 + 17.) * .28 + bfNoise(p * 4.13 - 9.) * .15;
  }
`;

export function makeCoastalGroundMaterial(palette, config = {}, farUniform = null, uniforms = {}) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .98, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    // v0.11.2: x inner radius, y band, z on — beyond the hand-off the real far terrain takes over
    shader.uniforms.bfFar = farUniform || { value: new THREE.Vector4(1500, 400, 0, 0) };
    shader.uniforms.bfRock = { value: new THREE.Color(palette.rock) };
    shader.uniforms.bfSoil = { value: new THREE.Color('#a59370') };
    shader.uniforms.bfSnowLine = { value: config.snowLineM || 1000000 };
    shader.uniforms.uTime = uniforms.uTime || { value: 0 };
    shader.uniforms.bfCloud = uniforms.bfCloud || { value: new THREE.Vector4(0, 0, 0, 0) };
    shader.uniforms.bfWet = uniforms.bfWet || { value: 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBfGround; varying vec3 vBfGroundNormal;\nattribute float aRealH; uniform vec4 bfFar;')
      // Approaching the hand-off, the stylized ground eases onto the real terrain's height so the two meet without a step.
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        if (bfFar.z > .5) {
          float bfMorph = smoothstep(bfFar.x - 1000., bfFar.x - bfFar.y * .5, length(position.xz - cameraPosition.xz));
          transformed.y = mix(transformed.y, aRealH, bfMorph);
        }`)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvBfGround = (modelMatrix * vec4(transformed, 1.)).xyz; vBfGroundNormal = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vBfGround; varying vec3 vBfGroundNormal;
        uniform vec3 bfRock; uniform vec3 bfSoil; uniform float bfSnowLine; uniform vec4 bfFar;
        uniform float uTime; uniform vec4 bfCloud; uniform float bfWet;
        ${noise}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (bfFar.z > .5) {
          // complementary dither to the far terrain: each pixel shows exactly one of the two grounds
          float bfFarT = smoothstep(bfFar.x - bfFar.y * .5, bfFar.x + bfFar.y * .5, length(vBfGround.xz - cameraPosition.xz));
          float bfFarH = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))));
          if (bfFarH < bfFarT) discard;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 bp = vBfGround;
        float bfDistance = length(cameraPosition - bp);
        float bfNear = 1. - smoothstep(180., 1200., bfDistance);
        float bfSlope = 1. - abs(normalize(vBfGroundNormal).y);
        float bfCliff = smoothstep(.12, .48, bfSlope);
        float bfPatches = bfFbm(bp.xz * .025);
        float bfFine = bfFbm(bp.xz * .65);
        float bfGrass = bfFbm(bp.xz * .16 + vec2(0., bfNoise(bp.xz * .008) * 4.));
        diffuseColor.rgb *= .72 + bfPatches * .48;
        diffuseColor.rgb = mix(diffuseColor.rgb, bfSoil * (.82 + bfFine * .28), smoothstep(.62, .83, bfPatches) * .38 * (1. - bfCliff));
        diffuseColor.rgb *= 1. + (bfGrass - .5) * .23 * bfNear * (1. - bfCliff);
        float bfStrata = .5 + .5 * sin(bp.y * .29 + bfFbm(bp.xz * .022) * 6.);
        float bfSeams = smoothstep(.77, .94, bfStrata);
        float bfWeather = bfFbm(vec2(bp.x + bp.z, bp.y * 1.7) * .045);
        vec3 bfStone = bfRock * (.68 + bfWeather * .49 + bfStrata * .16);
        bfStone *= 1. - bfSeams * .14;
        diffuseColor.rgb = mix(diffuseColor.rgb, bfStone, bfCliff * .88);
        diffuseColor.rgb *= 1. + (bfFine - .5) * .12 * bfNear;
        float bfSnow = smoothstep(bfSnowLine, bfSnowLine + 240., bp.y) * smoothstep(.15, .65, abs(normalize(vBfGroundNormal).y));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.8, .82, .78), bfSnow);
        // weather: cloud shadows drifting over the hills, and damp ground in the rain
        float bfCloudN = bfFbm((bp.xz - bfCloud.zw * uTime * 9.) * .0011);
        float bfShadowC = smoothstep(.66 - bfCloud.x * .42, .74 - bfCloud.x * .42, bfCloudN) * bfCloud.y;
        diffuseColor.rgb *= 1. - bfShadowC * .45;
        diffuseColor.rgb *= 1. - bfWet * .2;
      `);
  };
  return material;
}

export function makeCoastalWaterMaterial(landscape, uniforms, waterColor, shallowColor, shore = null) {
  const points = landscape.coast;
  const lakes = landscape.lakes || [], islands = landscape.waterIslands || [];
  return new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...uniforms, bfCoast: { value: points.map((p) => new THREE.Vector2(p.x, p.z)) },
      bfWater: { value: new THREE.Color(waterColor) }, bfShallow: { value: new THREE.Color(shallowColor || '#79beb1') },
      bfLakes: { value: lakes.length ? lakes.map((l) => new THREE.Vector4(l.x, l.z, l.rx, l.rz)) : [new THREE.Vector4()] },
      bfIslands: { value: islands.length ? islands.map((l) => new THREE.Vector4(l.x, l.z, l.rx, l.rz)) : [new THREE.Vector4()] },
      bfShore: { value: shore?.texture || null }, bfShoreBox: { value: shore?.box || new THREE.Vector4(0, 0, 1, 1) },
      bfRough: uniforms.bfRough || { value: 0 } },
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      #include <fog_pars_vertex>
      varying vec3 vBfSea;
      void main() {
        vBfSea = (modelMatrix * vec4(position, 1.)).xyz;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.);
        gl_Position = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      #include <fog_pars_fragment>
      varying vec3 vBfSea;
      uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSkyTop; uniform vec3 uSkyHorizon;
      uniform vec3 bfWater; uniform vec3 bfShallow;
      uniform vec2 bfCoast[${points.length}];
      uniform vec4 bfLakes[${Math.max(1, lakes.length)}];
      uniform vec4 bfIslands[${Math.max(1, islands.length)}];
      uniform sampler2D bfShore; uniform vec4 bfShoreBox; uniform float bfRough;
      ${noise}
      float shoreline(float z) {
        float x = bfCoast[0].x;
        for (int i = 0; i < ${points.length - 1}; i++) {
          if (z >= bfCoast[i].y) {
            float f = clamp((z - bfCoast[i].y) / (bfCoast[i + 1].y - bfCoast[i].y), 0., 1.);
            x = mix(bfCoast[i].x, bfCoast[i + 1].x, f);
          }
        }
        return x + sin(z / 290.) * 17. + sin(z / 83.) * 4.;
      }
      void main() {
        #include <logdepthbuf_fragment>
        vec2 p = vBfSea.xz;
${shore ? `
        // real coast: distance to the shoreline (R) and the sea floor (G) from the baked terrain
        vec2 bfUv = (p - bfShoreBox.xy) / bfShoreBox.zw;
        vec2 bfSh = (bfUv.x > 0. && bfUv.y > 0. && bfUv.x < 1. && bfUv.y < 1.) ? texture2D(bfShore, bfUv).rg : vec2(-3000., -45.);
        float offshore = max(0., -bfSh.r);
        float depth = max(0., -bfSh.g);
        float waveDetail = 1. - smoothstep(500., 4500., length(cameraPosition - vBfSea));
        float t = uTime;
        float swell = sin(p.x * .043 + p.y * .027 + t * .78);
        float crossWave = sin(p.y * .071 - p.x * .013 - t * .53);
        float chop = (bfNoise(p * .09 + t * .35) - .5) * bfRough;
        vec3 N = normalize(vec3((swell * .03 + crossWave * .014 + chop * .08) * waveDetail, 1., (cos(p.x * .029 - p.y * .047 + t * .61) * .03 + chop * .06) * waveDetail));
        vec3 V = normalize(cameraPosition - vBfSea);
        vec3 R = reflect(-V, N);
        float fresnel = .03 + .45 * pow(1. - max(dot(N, V), 0.), 4.);
        vec3 sky = mix(uSkyHorizon, uSkyTop, sqrt(max(R.y, 0.)));
        float waterNoise = bfFbm(p * .006 + t * .01);
        // kelp-dark patches offshore, turquoise over the sand and rock shelf
        vec3 deep = bfWater * (.74 + waterNoise * .32);
        deep = mix(deep, deep * vec3(.62, .72, .6), smoothstep(.62, .78, bfFbm(p * .012)) * smoothstep(40., 140., offshore) * (1. - smoothstep(260., 520., offshore)) * .7);
        vec3 color = mix(bfShallow * (1.05 + waterNoise * .1), deep, smoothstep(1., 16., depth));
        color *= .96 + (.02 * swell + .014 * crossWave) * waveDetail;
        color = mix(color, sky, fresnel);
        float sun = pow(max(dot(reflect(-normalize(uSunDir), N), V), 0.), 160.);
        float sparkle = smoothstep(.55, .95, bfNoise(p * .7 + t * .1));
        color += vec3(1., .92, .72) * sun * (.35 + sparkle * waveDetail * .7);
        // breakers: lines of white water rolling in to the shore, broken up along their length
        float along = bfNoise(p * .021 + vec2(0., t * .05)) * 5.;
        float phase = offshore * .075 + t * (.85 + bfRough * .3) + along;
        float crest = smoothstep(.86, .985, sin(phase)) * (1. - smoothstep(20., 150. + bfRough * 80., offshore)) * smoothstep(3., 12., offshore);
        float trail = smoothstep(.2, .95, sin(phase - .55)) * (1. - smoothstep(10., 70., offshore)) * .55;
        float lace = smoothstep(.45, .8, bfFbm(p * .16 + vec2(t * .07, -t * .05)));
        float swash = 1. - smoothstep(1.5, 9. + 4. * sin(t * .7 + along), offshore);
        float broken = smoothstep(.3, .7, bfFbm(p * .045 + vec2(t * .03, 0.)));
        float foam = max(crest * (.35 + broken * .65), trail * lace * broken) + swash * (.55 + lace * .45);
        foam *= waveDetail * .6 + .4;
        color = mix(color, vec3(.9, .95, .93), clamp(foam, 0., .92));
        // a soft wet band of spray-darkened water against the cliffs
        color *= 1. - (1. - smoothstep(0., 30., offshore)) * .08;
` : `
${old}`}
        gl_FragColor = vec4(color, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    fog: true,
  });
}

export function decorateSceneryMaterial(material, category, uniforms) {
  material.onBeforeCompile = (shader) => {
    if (category === 'groundcover') {
      shader.uniforms.uTime = uniforms.uTime; shader.uniforms.bfWind = uniforms.bfWind || { value: .3 };
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; uniform float bfWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float bfPhase = 0.;
          #ifdef USE_INSTANCING
            bfPhase = instanceMatrix[3].x * .13 + instanceMatrix[3].z * .09;
          #endif
          float bfW = .5 + bfWind * 2.;
          transformed.x += sin(uTime * (1.1 + bfWind) + bfPhase) * min(position.y, 1.2) * .075 * bfW;
          transformed.z += cos(uTime * .8 + bfPhase) * min(position.y, 1.2) * .035 * bfW;
        `);
    } else if (category === 'foliage') {
      // trees and shrubs lean and sway with the wind (more at the top)
      shader.uniforms.uTime = uniforms.uTime; shader.uniforms.bfWind = uniforms.bfWind || { value: .3 };
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; uniform float bfWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float bfPhase = 0.;
          #ifdef USE_INSTANCING
            bfPhase = instanceMatrix[3].x * .07 + instanceMatrix[3].z * .05;
          #endif
          float bfTop = max(position.y, 0.) * .12;
          float bfGust = .55 + .45 * sin(uTime * .37 + bfPhase * .3);
          transformed.x += (sin(uTime * 1.25 + bfPhase) * .5 + .7) * bfTop * bfTop * bfWind * bfGust * .22;
          transformed.z += cos(uTime * .9 + bfPhase) * bfTop * bfTop * bfWind * bfGust * .08;
        `);
    } else if (category === 'concrete') {
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBfConcrete;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvBfConcrete = (modelMatrix * vec4(transformed, 1.)).xyz;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vBfConcrete;\n${noise}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float bfStreaks = bfNoise(vec2((vBfConcrete.x + vBfConcrete.z) * .65, vBfConcrete.y * .025));
          float bfGrain = bfNoise(vBfConcrete.xz * 2. + vBfConcrete.y);
          diffuseColor.rgb *= .88 + bfStreaks * .16 + bfGrain * .07;
        `);
    }
  };
  material.customProgramCacheKey = () => `coastal-${category}-2`;
  return material;
}
