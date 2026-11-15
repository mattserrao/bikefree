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

export function makeCoastalGroundMaterial(palette, config = {}, farUniform = null, canopyUniform = null) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .98, side: THREE.DoubleSide });
  const canopy = !!canopyUniform;
  material.onBeforeCompile = (shader) => {
    if (canopy) {
      // Distant forest: beyond the last real trees the ground rises into a mottled canopy shell
      shader.uniforms.bfCanopy = canopyUniform;
      shader.uniforms.bfCanopyColor = { value: new THREE.Color(palette.canopy || '#2f4a36') };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aCanopy; uniform vec4 bfCanopy; varying float vBfCanopy;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vBfCanopy = aCanopy * smoothstep(bfCanopy.x, bfCanopy.x + bfCanopy.y, length(position.xz - cameraPosition.xz));
          transformed.y += vBfCanopy * bfCanopy.z;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 bfCanopyColor; varying float vBfCanopy;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          if (vBfCanopy > .001) {
            float bfCrowns = bfFbm(vBfGround.xz * .09) * .65 + bfNoise(vBfGround.xz * .31) * .35;
            vec3 bfTop = bfCanopyColor * (.62 + bfCrowns * .7);
            diffuseColor.rgb = mix(diffuseColor.rgb, bfTop, smoothstep(0., .6, vBfCanopy));
          }`);
    }
    // v0.11.2: x inner radius, y band, z on — beyond the hand-off the real far terrain takes over
    shader.uniforms.bfFar = farUniform || { value: new THREE.Vector4(1500, 400, 0, 0) };
    shader.uniforms.bfRock = { value: new THREE.Color(palette.rock) };
    shader.uniforms.bfSoil = { value: new THREE.Color('#a59370') };
    shader.uniforms.bfSnowLine = { value: config.snowLineM || 1000000 };
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
      `);
  };
  return material;
}

export function makeCoastalWaterMaterial(landscape, uniforms, waterColor, shallowColor) {
  const points = landscape.coast;
  const lakes = landscape.lakes || [], islands = landscape.waterIslands || [];
  return new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...uniforms, bfCoast: { value: points.map((p) => new THREE.Vector2(p.x, p.z)) },
      bfWater: { value: new THREE.Color(waterColor) }, bfShallow: { value: new THREE.Color(shallowColor || '#79beb1') },
      bfLakes: { value: lakes.length ? lakes.map((l) => new THREE.Vector4(l.x, l.z, l.rx, l.rz)) : [new THREE.Vector4()] },
      bfIslands: { value: islands.length ? islands.map((l) => new THREE.Vector4(l.x, l.z, l.rx, l.rz)) : [new THREE.Vector4()] } },
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
        float offshore = ${landscape.hasOcean === false ? '-100000.' : '(shoreline(p.y) - p.x) * ' + (landscape.coastSide || 1).toFixed(1)};
        ${islands.length ? `offshore = 100000.;
        for (int i = 0; i < ${islands.length}; i++) {
          vec4 l = bfIslands[i];
          offshore = min(offshore, (length((p - l.xy) / l.zw) - 1.) * min(l.z, l.w));
        }` : ''}
        for (int i = 0; i < ${lakes.length}; i++) {
          vec4 l = bfLakes[i];
          offshore = max(offshore, (1. - length((p - l.xy) / l.zw)) * min(l.z, l.w));
        }
        offshore = max(0., offshore);
        float waveDetail = 1. - smoothstep(500., 4500., length(cameraPosition - vBfSea));
        float swell = sin(p.x * .043 + p.y * .027 + uTime * .78);
        float crossWave = sin(p.y * .071 - p.x * .013 - uTime * .53);
        vec3 N = normalize(vec3((swell * .025 + crossWave * .012) * waveDetail, 1., cos(p.x * .029 - p.y * .047 + uTime * .61) * .028 * waveDetail));
        vec3 V = normalize(cameraPosition - vBfSea);
        vec3 R = reflect(-V, N);
        float fresnel = .035 + .42 * pow(1. - max(dot(N, V), 0.), 4.);
        vec3 sky = mix(uSkyHorizon, uSkyTop, sqrt(max(R.y, 0.)));
        float waterNoise = bfFbm(p * .008);
        vec3 color = mix(bfShallow, bfWater * (.78 + waterNoise * .3), smoothstep(5., 240., offshore));
        color *= .97 + (.018 * swell + .012 * crossWave) * waveDetail;
        color = mix(color, sky, fresnel);
        float sun = pow(max(dot(reflect(-normalize(uSunDir), N), V), 0.), 150.);
        float sparkle = smoothstep(.55, .95, bfNoise(p * .7 + uTime * .1));
        color += vec3(1., .91, .69) * sun * (.3 + sparkle * waveDetail * .55);
        float breaker = .5 + .5 * sin(offshore * .35 - uTime * 1.3 + bfNoise(p * .027) * 4.);
        float foam = smoothstep(.74, .96, breaker) * (1. - smoothstep(3., 48., offshore));
        foam += (1. - smoothstep(1., 6., offshore)) * .5;
        color = mix(color, vec3(.83, .9, .83), clamp(foam * .76, 0., .9));
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
      shader.uniforms.uTime = uniforms.uTime;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float bfPhase = 0.;
          #ifdef USE_INSTANCING
            bfPhase = instanceMatrix[3].x * .13 + instanceMatrix[3].z * .09;
          #endif
          transformed.x += sin(uTime * 1.1 + bfPhase) * min(position.y, 1.2) * .075;
          transformed.z += cos(uTime * .8 + bfPhase) * min(position.y, 1.2) * .035;
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

/** Sheltered lake water: tea-dark depths, soft shallows by the shore (aShore = metres to shore,
 * negative on the water), wind ripples, sky and a dark treeline in the reflection. No surf. */
export function makeLakeWaterMaterial(uniforms, waterColor, shallowColor, treeColor) {
  return new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...uniforms,
      bfWater: { value: new THREE.Color(waterColor || '#2f4a4a') }, bfShallow: { value: new THREE.Color(shallowColor || '#6b6a45') },
      bfTrees: { value: new THREE.Color(treeColor || '#1f3326') } },
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      #include <fog_pars_vertex>
      attribute float aShore;
      varying vec3 vBfLake; varying float vBfShore;
      void main() {
        vBfLake = (modelMatrix * vec4(position, 1.)).xyz; vBfShore = aShore;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.);
        gl_Position = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      #include <fog_pars_fragment>
      varying vec3 vBfLake; varying float vBfShore;
      uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSkyTop; uniform vec3 uSkyHorizon;
      uniform vec3 bfWater; uniform vec3 bfShallow; uniform vec3 bfTrees;
      ${noise}
      void main() {
        #include <logdepthbuf_fragment>
        vec2 p = vBfLake.xz;
        float dist = length(cameraPosition - vBfLake);
        float detail = 1. - smoothstep(300., 2500., dist);
        // cat's-paw wind patches: some water ruffled, some glassy
        float gust = smoothstep(.35, .75, bfFbm(p * .004 + vec2(uTime * .006, 0.)));
        float r1 = bfNoise(p * .55 + vec2(uTime * .35, uTime * .21)) - .5;
        float r2 = bfNoise(p * 1.3 - vec2(uTime * .27, -uTime * .31)) - .5;
        float amp = (.035 + gust * .11) * detail;
        vec3 N = normalize(vec3(r1 * amp, 1., r2 * amp));
        vec3 V = normalize(cameraPosition - vBfLake);
        vec3 R = reflect(-V, N);
        float fresnel = .03 + .6 * pow(1. - max(dot(N, V), 0.), 5.);
        // reflection: sky above, the dark far-shore treeline in a band just over the horizon
        vec3 sky = mix(uSkyHorizon, uSkyTop, sqrt(max(R.y, 0.)));
        float band = 1. - smoothstep(.02, .085 + bfNoise(vec2(atan(R.z, R.x) * 30., 0.)) * .05, R.y);
        vec3 refl = mix(sky, bfTrees * (.8 + bfNoise(p * .02) * .3), band * .92);
        float depth = smoothstep(0., 28., -vBfShore);
        vec3 body = mix(bfShallow, bfWater * (.85 + bfFbm(p * .01) * .25), depth);
        vec3 color = mix(body, refl, fresnel);
        float sun = pow(max(dot(reflect(-normalize(uSunDir), N), V), 0.), 220.);
        color += vec3(1., .93, .78) * sun * (.35 + gust * .5);
        // a thin, soft wet edge rather than surf
        color = mix(color, bfShallow * 1.15, (1. - smoothstep(0., 2.5, -vBfShore)) * .35);
        gl_FragColor = vec4(color, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    fog: true,
  });
}

/** Low mist lying on the water (morning and golden hour). */
export function makeLakeMistMaterial(uniforms, opacity) {
  return new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: uniforms.uTime, uSkyHorizon: uniforms.uSkyHorizon, bfMist: opacity },
    transparent: true, depthWrite: false,
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      #include <fog_pars_vertex>
      attribute float aShore; varying vec3 vBfMist; varying float vBfShore;
      void main() {
        vBfMist = (modelMatrix * vec4(position, 1.)).xyz; vBfShore = aShore;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.);
        gl_Position = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      #include <fog_pars_fragment>
      varying vec3 vBfMist; varying float vBfShore;
      uniform float uTime; uniform vec3 uSkyHorizon; uniform float bfMist;
      ${noise}
      void main() {
        #include <logdepthbuf_fragment>
        float wisps = bfFbm(vBfMist.xz * .012 + vec2(uTime * .01, uTime * .004));
        float a = bfMist * smoothstep(.3, .8, wisps) * smoothstep(0., 30., -vBfShore + 12.);
        a *= smoothstep(25., 120., length(cameraPosition - vBfMist));
        if (a < .01) discard;
        gl_FragColor = vec4(mix(uSkyHorizon, vec3(1.), .45), a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    fog: true,
  });
}
