// Weather for the stylized scenery: clear, the marine layer (a fog bank lying on the sea and creeping
// up the canyons — the classic Big Sur summer morning), broken clouds whose shadows sweep the hills,
// and rain with a wet, shiny road. Wind moves grass, flowers and trees in every preset.
// Changes ease in over a few seconds. Works on every stylized route; the fog bank hugs the real
// shoreline where the scene has one (the Big Sur hero map), elsewhere it lies in the valleys.
import * as THREE from '../../../../vendor/three.module.min.js';

export const WEATHER = {
  clear: { label: 'Clear', cloud: .12, shadow: .5, wind: .3, bank: 0, rain: 0, overcast: 0, bankTop: 140 },
  marine: { label: 'Marine layer', cloud: .1, shadow: .4, wind: .22, bank: 1, rain: 0, overcast: .12, bankTop: 150 },
  clouds: { label: 'Clouds', cloud: .62, shadow: 1, wind: .6, bank: 0, rain: 0, overcast: .3, bankTop: 140 },
  rain: { label: 'Rain', cloud: 1, shadow: .25, wind: .9, bank: .55, rain: 1, overcast: 1, bankTop: 320 },
  // late-summer wildfire smoke (Glacier): an orange-brown haze that swallows the far ridges, a red sun
  smoke: { label: 'Wildfire smoke', cloud: .04, shadow: .25, wind: .15, bank: 0, rain: 0, overcast: .15, bankTop: 140, smoke: 1 },
};
const WHITE = new THREE.Color('#ffffff'), BANK_SHADE = new THREE.Color('#8f9aa6');
const KEYS = ['cloud', 'shadow', 'wind', 'bank', 'rain', 'overcast', 'bankTop', 'smoke', 'peaks'];
for (const w of Object.values(WEATHER)) { w.smoke ??= 0; w.peaks ??= 0; }
// clouds hanging on the summits (mountain scenes): with broken cloud, and low and thick in the rain
WEATHER.clouds.peaks = 1; WEATHER.rain.peaks = 1.3;

const noise = /* glsl */`
  float wHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  float wNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(wHash(i), wHash(i + vec2(1., 0.)), f.x), mix(wHash(i + vec2(0., 1.)), wHash(i + 1.), f.x), f.y); }
  float wFbm(vec2 p) { return wNoise(p) * .5 + wNoise(p * 2.03 + 7.) * .27 + wNoise(p * 4.1 - 3.) * .15 + wNoise(p * 8.3 + 1.) * .08; }
`;

const SMOKE = new THREE.Color('#b7987a');

export class Weather {
  /**
   * @param world  the World (scene, camera, sun, hemi, fog, road, terrain)
   * @param uniforms the scenery's shared uniforms: bfCloud (vec4 cover, shadow, wind x, wind z),
   *                 bfWind, bfWet, bfRough (all created by the stylized terrain), uTime
   */
  constructor(world, uniforms) {
    this.world = world; this.u = uniforms;
    this.key = 'clear';
    this.options = world.route.scene?.weather || {};   // per scene: presets offered, their labels, the fog's thickness
    this.base = world.terrain.fogBase || 0;              // the fog lies on the sea (0) or a city's rivers
    this.state = { ...WEATHER.clear };
    this.target = { ...WEATHER.clear };
    this.windDir = new THREE.Vector2(.82, .57).normalize();   // onshore northwesterly
    this.group = new THREE.Group(); this.group.name = 'Weather'; world.scene.add(this.group);
    this._makeBank();
    this._makeRain();
    this._wetRoad();
  }

  set(key, immediate = false) {
    this.key = WEATHER[key] ? key : 'clear';
    this.target = { ...WEATHER[this.key] };
    // a scene can make the bank lower and thinner (Pittsburgh: river fog the bridges stand above)
    if (this.target.bank && this.options.bankTop) this.target.bankTop = this.options.bankTop;
    if (this.target.bank && this.options.bank) this.target.bank *= this.options.bank;
    if (immediate) this.state = { ...this.target };
    this._apply();
  }

  _makeBank() {
    const terrain = this.world.terrain, shore = terrain.shoreTexture;
    this.bankUniforms = {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: this.u.uTime, bfBank: { value: new THREE.Vector4(0, 150, 0, 0) },   // amount, top, layer base, layer index
      bfSunDir: { value: new THREE.Vector3(0, 1, 0) }, bfLit: { value: new THREE.Color('#ffffff') }, bfShade: { value: new THREE.Color('#9eabb6') },
      bfShore: { value: shore || null }, bfShoreBox: { value: terrain.shoreBox || new THREE.Vector4(0, 0, 1, 1) },
      bfWindDir: { value: this.windDir },
    };
    this.bankLayers = [];
    const geometry = new THREE.PlaneGeometry(26000, 26000, 1, 1); geometry.rotateX(-Math.PI / 2);
    this.bankGeometry = geometry;
    const LAYERS = 7;
    for (let k = 0; k < LAYERS; k++) {
      const material = new THREE.ShaderMaterial({
        uniforms: { ...this.bankUniforms, bfLayer: { value: k / (LAYERS - 1) } },
        transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
        vertexShader: /* glsl */`
          #include <common>
          #include <logdepthbuf_pars_vertex>
          #include <fog_pars_vertex>
          varying vec3 vW;
          void main() {
            vW = (modelMatrix * vec4(position, 1.)).xyz;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.);
            gl_Position = projectionMatrix * mvPosition;
            #include <logdepthbuf_vertex>
            #include <fog_vertex>
          }`,
        fragmentShader: /* glsl */`
          #include <common>
          #include <logdepthbuf_pars_fragment>
          #include <fog_pars_fragment>
          varying vec3 vW;
          uniform float uTime; uniform vec4 bfBank; uniform float bfLayer; uniform vec3 bfSunDir;
          uniform vec3 bfLit; uniform vec3 bfShade; uniform sampler2D bfShore; uniform vec4 bfShoreBox; uniform vec2 bfWindDir;
          ${noise}
          void main() {
            #include <logdepthbuf_fragment>
            if (bfBank.x < .01) discard;
            vec2 p = vW.xz + bfWindDir * uTime * 2.2;
            // over the sea it is solid; it reaches inland in fingers up the canyons
            float inland = -3000., ground = -50.;
            ${shore ? `vec2 uv = (vW.xz - bfShoreBox.xy) / bfShoreBox.zw;
            if (uv.x > 0. && uv.y > 0. && uv.x < 1. && uv.y < 1.) { vec2 sh = texture2D(bfShore, uv).rg; inland = sh.r; ground = sh.g; }` : ''}
            // the upper layers stop at the shore; only the lowest creep up the canyons
            float reach = (120. + wFbm(vW.xz * .0006 + 3.) * 1300.) * (1. - bfLayer * .85);
            float mask = 1. - smoothstep(reach * .3 - 40., reach, inland);
            float n = wFbm(p * .0016 + bfLayer * 1.7) * .65 + wFbm(p * .0062 - bfLayer * 2.3) * .35;
            // thick in the middle layers, ragged at the top of the bank
            float shape = smoothstep(.12 + bfLayer * .3, .42 + bfLayer * .2, n * (1.15 - bfLayer * .12));
            float a = shape * mask * bfBank.x * (bfLayer > .8 ? .6 : .55);
            // keep it soft right in front of the camera (no hard plane edge)
            float dc = length(cameraPosition - vW);
            a *= smoothstep(4., 70., dc);
            // no hard line where a layer meets the hillside
            a *= smoothstep(0., 28., vW.y - ground);
            if (a < .004) discard;
            float lit = mix(.55, 1., bfLayer) * (.75 + .25 * n);
            vec3 col = mix(bfShade, bfLit, lit);
            gl_FragColor = vec4(col, a);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
            #include <fog_fragment>
          }`,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 5 + k; mesh.frustumCulled = false; mesh.visible = false;
      this.bankLayers.push(mesh); this.group.add(mesh);
    }
  }

  _makeRain() {
    const N = 5200, pos = new Float32Array(N * 2 * 3), seed = new Float32Array(N * 2 * 4);
    for (let i = 0; i < N; i++) {
      const s = [Math.random(), Math.random(), Math.random(), Math.random()];
      for (let e = 0; e < 2; e++) { seed.set(s, (i * 2 + e) * 4); pos.set([0, e, 0], (i * 2 + e) * 3); }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.rainUniforms = { uTime: this.u.uTime, bfRain: { value: 0 }, bfCam: { value: new THREE.Vector3() }, bfWindDir: { value: this.windDir }, bfColor: { value: new THREE.Color('#c9d1d8') } };
    const material = new THREE.ShaderMaterial({
      uniforms: this.rainUniforms, transparent: true, depthWrite: false,
      vertexShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec4 aSeed; uniform float uTime; uniform vec3 bfCam; uniform vec2 bfWindDir; varying float vA;
        void main() {
          const vec3 box = vec3(70., 34., 70.);
          vec3 p = aSeed.xyz * box;
          p.y = mod(p.y - uTime * (8.5 + aSeed.w * 2.5), box.y);
          // wrap around the camera so the rain is always where you are
          vec3 c = bfCam - box * .5;
          p.xz = mod(p.xz - c.xz, box.xz) + c.xz;
          p.y += c.y;
          vec3 slant = vec3(bfWindDir.x, -6., bfWindDir.y) * .11;
          p += slant * position.y;
          vA = .22 + aSeed.w * .2;
          vec4 mv = modelViewMatrix * vec4(p, 1.);
          vA *= smoothstep(1., 4., -mv.z) * (1. - smoothstep(25., 40., -mv.z));
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <logdepthbuf_pars_fragment>
        uniform float bfRain; uniform vec3 bfColor; varying float vA;
        void main() {
          #include <logdepthbuf_fragment>
          gl_FragColor = vec4(bfColor, vA * bfRain);
          #include <colorspace_fragment>
        }`,
    });
    this.rain = new THREE.LineSegments(geometry, material);
    this.rain.frustumCulled = false; this.rain.renderOrder = 20; this.rain.visible = false;
    this.group.add(this.rain);
  }

  /** A wet road: darker, smoother asphalt that picks up the sky, with puddles along the edges. */
  _wetRoad(road = this.world.road) {
    const meshes = road?.isGroup ? road.children : road ? [road] : [];
    const list = meshes.map((m) => m.material).filter((m) => m.isMeshStandardMaterial);
    // (areas, PLAN 5.4: each area's road joins the list as it is built; a released one leaves it)
    this.roadMaterials = [...(this.roadMaterials || []).filter((m) => !m.userData.disposed), ...list];
    for (const material of list) {
      material.userData.dry = { roughness: material.roughness, color: material.color.clone() };
      // keep whatever the road already adds (the road surface, road-surface.js)
      const prev = material.onBeforeCompile, prevKey = material.customProgramCacheKey();
      material.onBeforeCompile = (shader, renderer) => {
        prev.call(material, shader, renderer);
        shader.uniforms.bfWet = this.u.bfWet;
        shader.uniforms.bfSkyH = this.u.uSkyHorizon || { value: new THREE.Color('#c6d2d8') };
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\nuniform float bfWet; uniform vec3 bfSkyH;\n${noise}`)
          .replace('#include <fog_fragment>', `
            #ifdef USE_MAP
              float puddle = smoothstep(.58, .72, wFbm(vMapUv * vec2(9., 2.2))) * (smoothstep(.2, .02, vMapUv.x) + smoothstep(.8, .98, vMapUv.x) + .35);
            #else
              float puddle = 0.;
            #endif
            float fr = pow(1. - clamp(dot(normalize(normal), normalize(vViewPosition)), 0., 1.), 4.);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, bfSkyH * .8, bfWet * clamp(fr * .75 + puddle * .45, 0., .8));
            #include <fog_fragment>`);
      };
      material.customProgramCacheKey = () => `${prevKey}|bf-wet-road`;
      material.needsUpdate = true;
    }
  }

  _apply() {
    const w = this.world, s = this.state;
    // light: the sun dims and the sky greys under cloud; the world re-applies its time-of-day light
    w._weatherLight = { overcast: s.overcast, rain: s.rain, smoke: s.smoke };
    w.terrain?.setPeakClouds?.(s.peaks, s.rain);
    w._applyLight?.();
    this.u.bfCloud.value.set(s.cloud, s.shadow * (1 - s.overcast * .7), this.windDir.x * (1 + s.wind * 3), this.windDir.y * (1 + s.wind * 3));
    this.u.bfWind.value = s.wind;
    this.u.bfRough.value = .4 + s.wind * .9 + s.rain * .6;
    this.u.bfWet.value = s.rain;
    for (const m of this.roadMaterials) {
      m.roughness = m.userData.dry.roughness + (.32 - m.userData.dry.roughness) * s.rain;
      m.color.copy(m.userData.dry.color).multiplyScalar(1 - s.rain * .38);
    }
    this.rainUniforms.bfRain.value = s.rain;
    this.rain.visible = s.rain > .02;
    this.bankUniforms.bfBank.value.set(s.bank, s.bankTop, 0, 0);
    for (const l of this.bankLayers) { l.visible = s.bank > .01; l.material.uniforms.bfBank.value.set(s.bank, s.bankTop, 0, 0); }
  }

  /** Every frame: ease toward the target, keep the bank and rain around the camera, thicken the air inside the fog. */
  tick(dt) {
    const k = 1 - Math.exp(-dt / 2.2);
    let moving = false;
    for (const key of KEYS) {
      const d = this.target[key] - this.state[key];
      if (Math.abs(d) > 1e-3) { this.state[key] += d * k; moving = true; } else this.state[key] = this.target[key];
    }
    if (moving) this._apply();
    const cam = this.world.camera.position, s = this.state;
    this.rainUniforms.bfCam.value.copy(cam);
    if (s.bank > .01) {
      const n = this.bankLayers.length;
      this.bankLayers.forEach((l, i) => {
        l.position.set(Math.round(cam.x / 500) * 500, this.base + 6 + (s.bankTop - 6) * Math.pow(i / (n - 1), .9), Math.round(cam.z / 500) * 500);
      });
      const sun = this.world.sun;
      this.bankUniforms.bfLit.value.copy(sun.color).multiplyScalar(.85 + .15 * (1 - s.overcast)).lerp(WHITE, .5);
      this.bankUniforms.bfShade.value.copy(this.world.hemi.color).multiplyScalar(.72).lerp(BANK_SHADE, .5);
    }
    // inside the bank (or in rain) the air closes in
    const L = this.world.terrain?.landscape;
    if (s.rain > .02 && L?.sheltered) this.rain.visible = !L.sheltered(cam.x, cam.z);   // [glasshouse] no rain under glass
    const inland = L?.fogInlandAt ? L.fogInlandAt(cam.x, cam.z) : L?.inlandAt ? L.inlandAt(cam.x, cam.z) : -1000;
    const reach = 1 - Math.min(1, Math.max(0, (inland - 300) / 900));
    const inside = s.bank * reach * Math.min(1, Math.max(0, (this.base + s.bankTop - cam.y) / 35));
    const fog = this.world.scene.fog, base = this.world._fogBase;
    if (fog && base) {
      const thick = Math.max(inside, s.rain * .55);
      fog.near = base.near + (8 - base.near) * thick;
      const close = inside > s.rain * .55 ? 650 : 2600 * (1 - s.rain * .4);
      fog.far = base.far + (Math.max(450, close) - base.far) * Math.max(thick, s.overcast * .25);
      fog.color.copy(base.color).lerp(this.bankUniforms.bfShade.value, Math.max(inside * .85, s.overcast * .6));
      if (s.smoke > .001) {
        // smoke: the near ridges go brown-grey, the far ones disappear
        fog.near += (60 - fog.near) * s.smoke;
        fog.far += (5200 - fog.far) * s.smoke;
        fog.color.lerp(SMOKE, s.smoke * .85);
      }
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.bankGeometry.dispose(); this.bankLayers.forEach((l) => l.material.dispose());
    this.rain.geometry.dispose(); this.rain.material.dispose();
  }
}
