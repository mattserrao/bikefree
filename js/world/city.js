// The city around a city route (Pittsburgh first): rivers, buildings with windows that light up
// at night, streets with sidewalks, street lamps and trees, the bridges and landmarks
// (js/world/city-bridges.js) and everything that moves (js/world/city-life.js).
// Data: "bikefree-city-1" from tools/build_city.py; ground from js/world/city-landscape.js.
import * as THREE from '../../vendor/three.module.min.js';
import { decodeCity, LAND, cityStreets, STREET_W } from './city-landscape.js';
import { MeshBuilder, ribbon, resample, hash } from './city-geometry.js';
import { buildBridges, buildStadiums, buildLandmarks } from './city-bridges.js';
import { CityLife } from './city-life.js';
import { ROAD_WIDTH } from './pose.js';

export { STREET_W };
const CHUNK = 320;

const KIND_COLORS = [
  ['#8c4a37', '#9a5a41', '#7b3f30', '#a46a4f', '#6e4a3a', '#b08a6a', '#94503c', '#c2b49a'],   // 0 brick rowhouses
  ['#c9c2b0', '#a9b6b8', '#d8ccb0', '#8e9a87', '#c08f6f', '#e2dccc', '#b7a58a'],               // 1 houses
  ['#b9ab93', '#a39a8c', '#c8bfae', '#8f8a83', '#d0c3a7', '#9e8b74', '#c4b8a4'],               // 2 commercial
  ['#8c8c86', '#7a7d80', '#9d978b', '#8b8274'],                                                // 3 industrial
  ['#c9c0ae', '#b5aea2', '#d6cfc0', '#a8a196', '#bfb39b'],                                     // 4 stone/concrete towers
  ['#6f8496', '#5d7487', '#7a8d99', '#4e6577', '#7c8a8f'],                                     // 5 glass towers
  ['#3c4a52'],                                                                                 // 6 PPG Place
  ['#8d8476', '#a09382'],                                                                      // 7 churches
  ['#a7a39a', '#9b978e'],                                                                      // 8 garages
  ['#5c3b2b'],                                                                                 // 9 U.S. Steel Tower
  ['#c9bba1'],                                                                                 // 10 Gulf Tower
  ['#c4b79c', '#b8a98d'],                                                                      // 11 civic stone
];

export class CityScene {
  constructor(parent, route, index, landscape, kit, uniforms, qualityKey = 'balanced') {
    this.group = new THREE.Group(); this.group.name = 'City'; parent.add(this.group);
    this.route = route; this.index = index; this.landscape = landscape; this.kit = kit;
    this.data = landscape.data; this.D = decodeCity(this.data, landscape.decoded.proj);
    this.uniforms = uniforms;
    this.night = { value: 0 };
    this.qualityKey = qualityKey;
    this.disposables = new Set();
    this.chunks = new Map();          // key → {buildings, streets, ...} meshes
    this._decodeStreets();
    this._decodeBuildings();
    this._materials();
    this._water();
    this._streetsAndLamps();
    this.bridges = buildBridges(this);
    this.stadiums = buildStadiums(this);
    this.landmarks = buildLandmarks(this);
    this._trees();
    this.life = new CityLife(this);
    this._pending = [...this.buildingChunks.keys()];
  }

  own(x) { this.disposables.add(x); return x; }

  // ---------------------------------------------------------------- data
  _decodeStreets() { this.streets = cityStreets(this.landscape, this.index, this.route); }

  _decodeBuildings() {
    const B = this.data.buildings, D = this.D;
    const u8 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0)).buffer;
    const h = new Uint16Array(u8(B.h)), mh = new Uint16Array(u8(B.mh)), starts = new Uint32Array(u8(B.starts)), xy = new Int16Array(u8(B.xy));
    this.buildingChunks = new Map();
    this.buildings = [];
    for (let k = 0; k < B.count; k++) {
      const ring = D.points(xy, starts[k], starts[k + 1]);
      const b = { k, ring, h: h[k] / 10, mh: mh[k] / 10, kind: B.kind[k], name: B.names[k] || '' };
      this.buildings.push(b);
      const key = `${Math.floor(ring[0].x / CHUNK)},${Math.floor(ring[0].z / CHUNK)}`;
      if (!this.buildingChunks.has(key)) this.buildingChunks.set(key, []);
      this.buildingChunks.get(key).push(b);
    }
  }

  // ---------------------------------------------------------------- materials
  _materials() {
    const U = this.uniforms, night = this.night;
    // Buildings: vertex colour + procedural windows (glass by day, some lit warm at night).
    const bm = this.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .86, metalness: .02 }));
    bm.onBeforeCompile = (shader) => {
      shader.uniforms.uNight = night; shader.uniforms.uSkyTop = U.uSkyTop;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aBld; varying vec4 vBld; varying vec3 vWPos; varying vec3 vWNorm;')
        .replace('#include <fog_vertex>', '#include <fog_vertex>\nvBld = aBld; vWPos = (modelMatrix * vec4(transformed, 1.)).xyz; vWNorm = normalize(mat3(modelMatrix) * objectNormal);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uNight; uniform vec3 uSkyTop; varying vec4 vBld; varying vec3 vWPos; varying vec3 vWNorm;
          float bfH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float bfWin = 0., bfLit = 0.;
          int bfKind = int(vBld.x + .5);
          if (vBld.w < .5 && abs(vWNorm.y) < .5) {
            vec2 t = normalize(vec2(-vWNorm.z, vWNorm.x));
            float along = dot(vWPos.xz, t), up = vWPos.y - vBld.z;
            bool glass = bfKind == 5 || bfKind == 6;
            bool small = bfKind == 0 || bfKind == 1;
            float fh = small ? 3.1 : glass ? 3.9 : 3.6;
            float cw = small ? 2.3 : glass ? 1.55 : bfKind == 9 ? 1.9 : 2.6;
            vec2 cell = vec2(along / cw, up / fh), id = floor(cell), f = fract(cell);
            vec2 lo = glass ? vec2(.05, .1) : vec2(.24, .28), hi = glass ? vec2(.95, .94) : vec2(.76, .86);
            bfWin = step(lo.x, f.x) * step(f.x, hi.x) * step(lo.y, f.y) * step(f.y, hi.y);
            if (id.y < 1.) bfWin = (bfKind == 2 || (bfKind == 0 && bfH(id + vBld.y) > .45)) ? step(.07, f.x) * step(f.x, .93) * step(.12, f.y) * step(f.y, .78) : bfWin * step(.5, bfH(id.xx + vBld.y));
            if (bfKind == 3 || bfKind == 8 || bfKind == 7) bfWin *= step(.55, bfH(vec2(id.y, vBld.y)));
            vec3 glassCol = (bfKind == 6 ? vec3(.07, .09, .11) : vec3(.13, .16, .2)) + uSkyTop * (glass ? .22 : .12) * (1. - uNight);
            diffuseColor.rgb = mix(diffuseColor.rgb, glassCol, bfWin * (glass ? .93 : .86));
            bfLit = bfWin * step(glass ? .5 : .58, bfH(id * 1.37 + vBld.y * 17.));
          }`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, .22, bfWin);')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += mix(vec3(1., .74, .42), vec3(.85, .9, 1.), step(.8, bfH(vWPos.xz * .01 + vBld.y))) * bfLit * uNight * 1.25;`);
    };
    bm.customProgramCacheKey = () => 'city-buildings-1';
    this.buildingMaterial = bm;

    // Streets: asphalt with lane paint; sidewalks; paths.
    const c = document.createElement('canvas'); c.width = 64; c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#505457'; ctx.fillRect(0, 0, 64, 256);
    for (let k = 0; k < 2500; k++) { const g = 70 + Math.random() * 26; ctx.fillStyle = `rgba(${g},${g + 2},${g + 4},.45)`; ctx.fillRect(Math.random() * 64, Math.random() * 256, 1, 1); }
    ctx.fillStyle = '#d9d6c8'; ctx.fillRect(3, 0, 1.5, 256); ctx.fillRect(59.5, 0, 1.5, 256);
    ctx.fillStyle = '#d6b44c'; ctx.fillRect(30.5, 0, 1.4, 150); ctx.fillRect(32.6, 0, 1.4, 150);
    const tex = this.own(new THREE.CanvasTexture(c)); tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const offset = (f) => ({ polygonOffset: true, polygonOffsetFactor: f, polygonOffsetUnits: f });
    this.streetMaterial = this.own(new THREE.MeshStandardMaterial({ map: tex, roughness: .93, ...offset(-1.6) }));
    this.sidewalkMaterial = this.own(new THREE.MeshStandardMaterial({ color: '#aca59a', roughness: .95, ...offset(-1.1) }));
    this.pathMaterial = this.own(new THREE.MeshStandardMaterial({ color: '#9d978a', roughness: .95, ...offset(-1.3) }));
    this.solidMaterial = this.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .8, metalness: .1 }));
    this.glowMaterial = this._glowMaterial();
  }

  /** Camera-facing additive glows, faded in with the night (lamps, beacons, headlights). */
  _glowMaterial() {
    const m = new THREE.ShaderMaterial({
      uniforms: { uNight: this.night },
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
    return this.own(m);
  }

  // ---------------------------------------------------------------- rivers
  _water() {
    const D = this.D, level = this.landscape.level;
    // Water mask → soft distance-to-bank texture (blurred), for shallow colour and bank foam.
    const W = D.lx, H = D.ly, mask = new Float32Array(W * H);
    for (let i = 0; i < mask.length; i++) mask[i] = D.land[i] === LAND.water ? 1 : 0;
    const blur = (src, r) => {
      const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
      for (let y = 0; y < H; y++) { let acc = 0; for (let x = -r; x < W + r; x++) { if (x + r < W) acc += src[y * W + Math.min(W - 1, x + r)]; if (x - r - 1 >= 0) acc -= src[y * W + x - r - 1]; if (x >= 0 && x < W) tmp[y * W + x] = acc / (2 * r + 1); } }
      for (let x = 0; x < W; x++) { let acc = 0; for (let y = -r; y < H + r; y++) { if (y + r < H) acc += tmp[Math.min(H - 1, y + r) * W + x]; if (y - r - 1 >= 0) acc -= tmp[(y - r - 1) * W + x]; if (y >= 0 && y < H) out[y * W + x] = acc / (2 * r + 1); } }
      return out;
    };
    const deep = blur(blur(mask, 3), 3);
    const tex = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) { tex[i * 4] = mask[i] * 255; tex[i * 4 + 1] = Math.min(255, deep[i] * 255); tex[i * 4 + 3] = 255; }
    const dt = this.own(new THREE.DataTexture(tex, W, H)); dt.magFilter = dt.minFilter = THREE.LinearFilter; dt.needsUpdate = true;
    const U = this.uniforms;
    const mat = this.own(new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: U.uTime, uSunDir: U.uSunDir, uSkyTop: U.uSkyTop, uSkyHorizon: U.uSkyHorizon,
        uNight: this.night, uMask: { value: dt }, uBox: { value: new THREE.Vector4(D.x0, D.z0, D.x1 - D.x0, D.z1 - D.z0) },
        uDeep: { value: new THREE.Color('#2f5a5c') }, uShallow: { value: new THREE.Color('#5d7f6a') } },
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
        uniform float uTime, uNight; uniform vec3 uSunDir, uSkyTop, uSkyHorizon, uDeep, uShallow; uniform sampler2D uMask; uniform vec4 uBox;
        varying vec3 vW;
        float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
          float a = fract(sin(dot(i, vec2(12.9, 78.2))) * 43758.5), b = fract(sin(dot(i + vec2(1, 0), vec2(12.9, 78.2))) * 43758.5),
                c = fract(sin(dot(i + vec2(0, 1), vec2(12.9, 78.2))) * 43758.5), d = fract(sin(dot(i + vec2(1, 1), vec2(12.9, 78.2))) * 43758.5);
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
        void main() {
          #include <logdepthbuf_fragment>
          vec2 uv = (vW.xz - uBox.xy) / uBox.zw;
          vec4 m = texture2D(uMask, uv);
          if (m.r < .02) discard;
          vec2 p = vW.xz;
          float near = 1. - smoothstep(300., 2600., length(cameraPosition.xz - p));
          float r1 = n2(p * .09 + vec2(uTime * .35, uTime * .12)), r2 = n2(p * .23 - vec2(uTime * .2, -uTime * .41));
          vec3 N = normalize(vec3((r1 - .5) * .09 * near, 1., (r2 - .5) * .09 * near));
          vec3 V = normalize(cameraPosition - vW);
          float fres = .04 + .5 * pow(1. - max(dot(N, V), 0.), 4.);
          vec3 R = reflect(-V, N);
          vec3 sky = mix(uSkyHorizon, uSkyTop, sqrt(max(R.y, 0.)));
          vec3 col = mix(uShallow, uDeep, smoothstep(.15, .85, m.g)) * (.92 + n2(p * .01) * .16);
          col = mix(col, sky, fres);
          float sun = pow(max(dot(reflect(-normalize(uSunDir), N), V), 0.), 120.);
          col += vec3(1., .92, .72) * sun * .7 * (1. - uNight);
          col *= mix(1., .16, uNight);
          // city lights on the water at night: warm streaks near the banks
          float streak = smoothstep(.62, .95, n2(vec2(p.x * .06, p.y * .6) + uTime * .05)) * (1. - smoothstep(.2, .8, m.g));
          col += vec3(1., .72, .38) * streak * uNight * .55;
          col = mix(col, vec3(.78, .82, .76), (1. - smoothstep(.0, .14, m.g)) * .35 * (1. - uNight * .7));
          gl_FragColor = vec4(col, 1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
      fog: true,
    }));
    const geo = this.own(new THREE.PlaneGeometry(D.x1 - D.x0, D.z1 - D.z0, 1, 1)); geo.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(geo, mat);
    this.water.position.set((D.x0 + D.x1) / 2, level, (D.z0 + D.z1) / 2);
    this.water.name = 'Rivers'; this.water.renderOrder = 0;
    this.group.add(this.water);
  }

  // ---------------------------------------------------------------- buildings
  _buildChunk(key) {
    const list = this.buildingChunks.get(key);
    const B = new MeshBuilder({ aBld: 4 });
    const extras = new MeshBuilder();   // spires, rooftop details (plain vertex colour)
    const roofTint = new THREE.Color();
    for (const b of list) {
      if (b.kind === 12) continue;   // the submarine is a landmark, not a building
      let ring = b.ring;
      let area = 0;
      for (let i = 0; i < ring.length; i++) { const a = ring[i], c = ring[(i + 1) % ring.length]; area += a.x * c.z - c.x * a.z; }
      if (area > 0) ring = ring.slice().reverse();   // walls wound to face outwards
      let ground = Infinity, top = -Infinity;
      for (const p of ring) { const g = this.landscape.heightAt(p.x, p.z); ground = Math.min(ground, g); top = Math.max(top, g); }
      // On steep ground the tall side shows: measure the height from the uphill corner for small buildings.
      const y0 = ground + b.mh - (b.mh ? 0 : .8), y1 = (b.h < 20 ? Math.max(ground + b.h, top + b.h * .7) : ground + b.h);
      const palette = KIND_COLORS[b.kind] || KIND_COLORS[2];
      const seed = hash(b.k * 7919 + 13);
      const base = new THREE.Color(palette[Math.floor(seed * palette.length)]).multiplyScalar(.9 + hash(b.k) * .18);
      B.color(base).set({ aBld: [b.kind, seed * 100, ground, 0] });
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], c = ring[(i + 1) % ring.length];
        B.quad(new THREE.Vector3(a.x, y0, a.z), new THREE.Vector3(c.x, y0, c.z), new THREE.Vector3(c.x, y1, c.z), new THREE.Vector3(a.x, y1, a.z));
      }
      // flat roof, a little darker (tar and gravel), with a parapet colour band from the walls
      roofTint.copy(base).lerp(new THREE.Color(b.kind === 6 ? '#2f3a40' : '#6a6762'), .65);
      B.color(roofTint).set({ aBld: [b.kind, seed * 100, ground, 1] });
      const contour = ring.map((p) => new THREE.Vector2(p.x, p.z));
      let tris;
      try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch { tris = []; }
      const first = B.count;
      for (const p of ring) B.vertex(p.x, y1, p.z, 0, 1, 0);
      for (const [i, j, k] of tris) {
        const ax = ring[j].x - ring[i].x, az = ring[j].z - ring[i].z, bx = ring[k].x - ring[i].x, bz = ring[k].z - ring[i].z;
        if (az * bx - ax * bz > 0) B.tri(first + i, first + j, first + k); else B.tri(first + i, first + k, first + j);
      }
      this._rooftop(extras, b, ring, y1, seed);
    }
    const mesh = new THREE.Mesh(this.own(B.geometry()), this.buildingMaterial);
    mesh.castShadow = mesh.receiveShadow = true; mesh.name = `Buildings ${key}`;
    this.group.add(mesh);
    const out = [mesh];
    if (extras.count) {
      const em = new THREE.Mesh(this.own(extras.geometry()), this.solidMaterial);
      em.castShadow = em.receiveShadow = true; this.group.add(em); out.push(em);
    }
    this.chunks.set(key, out);
  }

  /** Rooftops that make the skyline: PPG Place's glass spires, the Gulf Tower's stepped pyramid, masts, water tanks. */
  _rooftop(M, b, ring, y1, seed) {
    let cx = 0, cz = 0; for (const p of ring) { cx += p.x; cz += p.z; } cx /= ring.length; cz /= ring.length;
    if (b.kind === 6 && b.h > 18) {
      M.color('#2e3a42');
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], c = ring[(i + 1) % ring.length], len = Math.hypot(c.x - a.x, c.z - a.z), n = Math.floor(len / 6);
        const yaw = Math.atan2(c.x - a.x, c.z - a.z);
        M.pyramid(a.x, y1, a.z, 2.6, b.h > 100 ? 11 : 6, 2.6, yaw);
        for (let k = 1; k < n; k++) { const f = k / n; M.pyramid(a.x + (c.x - a.x) * f, y1, a.z + (c.z - a.z) * f, 1.8, b.h > 100 ? 6 : 3.6, 1.8, yaw); }
      }
      if (b.h > 100) M.pyramid(cx, y1, cz, 9, 26, 9);
    } else if (b.kind === 10) {
      M.color('#c9bba1');
      let r = 0; for (const p of ring) r = Math.min(r || Infinity, Math.hypot(p.x - cx, p.z - cz));
      const w = r * 1.5;
      for (let k = 0; k < 4; k++) M.box(cx, y1 + k * 4.5, cz, w * (1 - k * .2), 4.5, w * (1 - k * .2));
      M.pyramid(cx, y1 + 18, cz, w * .2, 6);
    } else if (b.name === 'Fifth Avenue Place' || b.name === 'BNY Mellon Center') {
      M.color('#8d9aa3'); M.cylinder(cx, y1, cz, .5, 30, 6, .15);
    } else if (b.h > 60) {
      M.color('#7b7f82'); M.box(cx, y1, cz, 9, 4.5, 9);
    } else if (b.kind === 0 && seed > .8 && b.h < 14) {
      M.color('#5a524b'); M.box(cx, y1, cz, 1.2, 1.4, 1.2);   // chimney
    } else if ((b.kind === 2 || b.kind === 3) && seed > .86) {
      M.color('#7d6b58'); M.cylinder(cx, y1 + 3.5, cz, 2.2, 3.5, 10, 2.2);   // water tank
      M.color('#5d5650'); M.pyramid(cx, y1 + 7, cz, 4.6, 1.8);
      for (const [dx, dz] of [[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5]]) M.box(cx + dx, y1, cz + dz, .25, 3.5, .25);
    }
  }

  // ---------------------------------------------------------------- streets, sidewalks and lamps
  _streetsAndLamps() {
    const roads = new Map(), walks = new Map(), paths = new Map();
    const get = (map, x, z) => { const key = `${Math.floor(x / 512)},${Math.floor(z / 512)}`; if (!map.has(key)) map.set(key, new MeshBuilder()); return map.get(key); };
    const lamps = [];
    this.streets.forEach((st, k) => {
      const p0 = st.pts[0], lift = .1 + (8 - st.cls) * .006 + (k % 3) * .002;
      if (st.cls === 8) { ribbon(get(paths, p0.x, p0.z), st.pts, st.width, lift + .02, 8); return; }
      ribbon(get(roads, p0.x, p0.z), st.pts, st.width, lift, 24);
      if (!st.bridge && st.cls >= 2 && st.cls <= 6) ribbon(get(walks, p0.x, p0.z), st.pts, st.width + 5, .06, 8);
      // lamps every ~34 m, alternating sides
      if (st.cls >= 1 && st.cls <= 6) {
        let acc = hash(k) * 30, side = k % 2 ? 1 : -1;
        for (let i = 1; i < st.pts.length; i++) {
          const a = st.pts[i - 1], b = st.pts[i], len = Math.hypot(b.x - a.x, b.z - a.z);
          acc += len;
          if (acc < 34) continue;
          acc = 0; side = -side;
          const dx = (b.x - a.x) / (len || 1), dz = (b.z - a.z) / (len || 1), off = st.width / 2 + .9;
          const x = b.x - dz * off * side, z = b.z + dx * off * side;
          const c = this.landscape.landAt(x, z);
          if (c === LAND.water || c === LAND.building) continue;
          const onRoad = this.index.nearest(x, z, 6);
          if (onRoad && onRoad.d < ROAD_WIDTH / 2 + 1.2) continue;   // never a lamp post in the rider's road
          lamps.push({ x, z, y: st.bridge ? b.y : this.landscape.heightAt(x, z), yaw: Math.atan2(dz * side, -dx * side), bridge: st.bridge });
        }
      }
    });
    // the route itself: lamps along streets and riverfront trails
    const r = this.route, end = r.turnIdx || r.dist.length - 1;
    for (let i = 3; i < end - 3; i += 3) {
      const s = r.dist[i], kind = this.landscape.routeKindAt(s);
      const every = kind === 'road' ? 36 : 30;
      if (Math.floor(s / every) === Math.floor(r.dist[i - 3] / every)) continue;
      const dx = this.index.xs[i + 1] - this.index.xs[i - 1], dz = this.index.zs[i + 1] - this.index.zs[i - 1], len = Math.hypot(dx, dz) || 1;
      for (const side of kind === 'road' ? [-1, 1] : [Math.floor(s / every) % 2 ? 1 : -1]) {
        const off = ROAD_WIDTH / 2 + (kind === 'road' ? 2.6 : 1.6);
        const x = this.index.xs[i] - dz / len * off * side, z = this.index.zs[i] + dx / len * off * side;
        const c = this.landscape.landAt(x, z);
        const onBridge = !!this.landscape.bridgeAt(x, z, 0);
        if (!onBridge && (c === LAND.water || c === LAND.building)) continue;
        lamps.push({ x, z, y: onBridge ? r.ele[i] : this.landscape.heightAt(x, z), yaw: Math.atan2(dz / len * side, -dx / len * side), bridge: onBridge });
      }
    }
    for (const [map, mat, name] of [[roads, this.streetMaterial, 'Streets'], [walks, this.sidewalkMaterial, 'Sidewalks'], [paths, this.pathMaterial, 'Paths']]) {
      for (const [key, builder] of map) {
        const mesh = new THREE.Mesh(this.own(builder.geometry()), mat);
        mesh.receiveShadow = true; mesh.name = `${name} ${key}`; mesh.renderOrder = 1;
        this.group.add(mesh);
      }
    }
    this.lamps = lamps;
    this._lampMeshes(lamps);
  }

  _lampMeshes(lamps) {
    const pole = new MeshBuilder();
    pole.color('#3a3d40'); pole.cylinder(0, 0, 0, .1, 7.2, 6, .07); pole.beam(new THREE.Vector3(0, 7.1, 0), new THREE.Vector3(0, 7.25, 1.6), .1, .1);
    pole.color('#2e3033'); pole.box(0, 6.95, 1.75, .5, .3, .8);
    pole.color('#fff4d6'); pole.box(0, 6.9, 1.75, .36, .06, .6);
    const poleGeo = this.own(pole.geometry());
    const poleMat = this.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .6, metalness: .4 }));
    poleMat.onBeforeCompile = (shader) => {
      shader.uniforms.uNight = this.night;
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += step(.95, vColor.b) * vec3(1., .85, .6) * uNight * 3.;');
    };
    poleMat.customProgramCacheKey = () => 'city-lamp-1';
    const glowGeo = this.own(new THREE.PlaneGeometry(1, 1));
    const poolTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
      const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31); gr.addColorStop(0, 'rgba(255,214,150,.55)'); gr.addColorStop(1, 'rgba(255,214,150,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return this.own(new THREE.CanvasTexture(c));
    })();
    const poolMat = this.own(new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    this.poolMaterial = poolMat;
    const poolGeo = this.own(new THREE.PlaneGeometry(1, 1)); poolGeo.rotateX(-Math.PI / 2);
    const byChunk = new Map();
    for (const l of lamps) { const key = `${Math.floor(l.x / 640)},${Math.floor(l.z / 640)}`; if (!byChunk.has(key)) byChunk.set(key, []); byChunk.get(key).push(l); }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    for (const list of byChunk.values()) {
      const poles = new THREE.InstancedMesh(poleGeo, poleMat, list.length);
      const glows = new THREE.InstancedMesh(glowGeo, this.glowMaterial, list.length);
      const pools = new THREE.InstancedMesh(poolGeo, poolMat, list.length);
      const colors = new Float32Array(list.length * 3);
      const glowGeoChunk = this.own(glowGeo.clone());
      glowGeoChunk.setAttribute('aGlow', new THREE.InstancedBufferAttribute(colors, 3));
      glows.geometry = glowGeoChunk;
      list.forEach((l, i) => {
        q.setFromAxisAngle(Y, l.yaw); p.set(l.x, l.y - .1, l.z);
        poles.setMatrixAt(i, m.compose(p, q, s));
        const head = new THREE.Vector3(0, 6.85, 1.75).applyQuaternion(q).add(p);
        glows.setMatrixAt(i, m.compose(head, new THREE.Quaternion(), new THREE.Vector3(4.2, 4.2, 4.2)));
        colors.set([1, .78, .5], i * 3);
        const ground = l.bridge ? l.y + .2 : this.landscape.heightAt(head.x, head.z) + .2;
        pools.setMatrixAt(i, m.compose(new THREE.Vector3(head.x, ground, head.z), new THREE.Quaternion(), new THREE.Vector3(17, 1, 17)));
      });
      for (const im of [poles, glows, pools]) { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); this.group.add(im); }
      poles.castShadow = true; poles.receiveShadow = true;
      glows.renderOrder = 5; pools.renderOrder = 3;
      (this.nightOnly ||= []).push(glows, pools);
    }
  }

  /** Night glows at fixed points: [{x, y, z, size, color}] → one instanced mesh. */
  addGlows(list, name = 'Glows') {
    if (!list.length) return null;
    const geo = this.own(new THREE.PlaneGeometry(1, 1));
    const colors = new Float32Array(list.length * 3), c = new THREE.Color();
    const im = new THREE.InstancedMesh(geo, this.glowMaterial, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    list.forEach((g, i) => {
      im.setMatrixAt(i, m.compose(new THREE.Vector3(g.x, g.y, g.z), q, new THREE.Vector3(g.size || 3, g.size || 3, g.size || 3)));
      c.set(g.color || '#ffe2b0'); colors.set([c.r, c.g, c.b], i * 3);
    });
    geo.setAttribute('aGlow', new THREE.InstancedBufferAttribute(colors, 3));
    im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.name = name; im.renderOrder = 5;
    im.visible = this.night.value > .01;
    (this.nightOnly ||= []).push(im); this.group.add(im);
    return im;
  }

  // ---------------------------------------------------------------- trees along streets
  _trees() {
    const spots = [];
    this.streets.forEach((st, k) => {
      if (st.bridge || st.cls < 3 || st.cls > 6) return;
      let acc = hash(k * 3) * 15;
      for (let i = 1; i < st.pts.length; i++) {
        const a = st.pts[i - 1], b = st.pts[i], len = Math.hypot(b.x - a.x, b.z - a.z);
        acc += len; if (acc < 15) continue; acc = 0;
        for (const side of [-1, 1]) {
          if (hash(k * 131 + i * 17 + side) < .5) continue;
          const dx = (b.x - a.x) / (len || 1), dz = (b.z - a.z) / (len || 1), off = st.width / 2 + 2.3;
          spots.push({ x: b.x - dz * off * side, z: b.z + dx * off * side, seed: hash(k * 7 + i * 3 + side) });
        }
      }
    });
    const T = this.data.trees ? new Int16Array(Uint8Array.from(atob(this.data.trees), (c) => c.charCodeAt(0)).buffer) : [];
    for (let i = 0; i < T.length; i += 2) { const p = this.D.local(T[i], T[i + 1]); spots.push({ ...p, seed: hash(i) }); }
    // a light street tree: trunk + two lumpy crowns (~40 triangles), coloured per instance
    const M = new MeshBuilder();
    M.color('#5b4636'); M.cylinder(0, 0, 0, .16, 3.2, 5, .12);
    const crown = new THREE.IcosahedronGeometry(1, 0).toNonIndexed(), pos = crown.attributes.position;
    for (const [ox, oy, oz, r] of [[0, 4.8, 0, 2.4]]) {
      M.color('#ffffff');
      for (let k = 0; k < pos.count; k += 3) {
        const v = [0, 1, 2].map((j) => new THREE.Vector3(pos.getX(k + j) * r + ox, pos.getY(k + j) * r * .9 + oy, pos.getZ(k + j) * r + oz));
        M.triangle(v[0], v[1], v[2]);
      }
    }
    crown.dispose();
    const geo = this.own(M.geometry());
    const mat = this.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95, flatShading: true }));
    const greens = ['#5f8a3e', '#6f9a45', '#557d38', '#7a9b4a', '#4f7434', '#8aa452'].map((c) => new THREE.Color(c));
    const lists = new Map();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
    for (const t of spots) {
      const c = this.landscape.landAt(t.x, t.z);
      if (c === LAND.water || c === LAND.building) continue;
      const road = this.index.nearest(t.x, t.z, 650);
      if (!road || road.d < ROAD_WIDTH / 2 + 1.6) continue;   // near the ride only
      const key = `${Math.floor(t.x / 480)},${Math.floor(t.z / 480)}`, w = .75 + t.seed * .5;
      q.setFromAxisAngle(Y, t.seed * 40);
      if (!lists.has(key)) lists.set(key, []);
      lists.get(key).push({ m: m.compose(new THREE.Vector3(t.x, this.landscape.heightAt(t.x, t.z) - .1, t.z), q, new THREE.Vector3(w, w * (.85 + t.seed * .3), w)).clone(), seed: t.seed });
    }
    for (const list of lists.values()) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((t, i) => { im.setMatrixAt(i, t.m); im.setColorAt(i, greens[Math.floor(t.seed * 997) % greens.length]); });
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
      im.castShadow = im.receiveShadow = true; im.name = 'Street trees'; this.group.add(im);
    }
    this.treeCount = spots.length;
  }

  // ---------------------------------------------------------------- per-frame
  /** Build a few building chunks per frame, nearest first, so the ride never stalls. */
  _stream(cx, cz) {
    if (!this._pending.length) return;
    const t0 = performance.now();
    this._pending.sort((a, b) => {
      const [ax, az] = a.split(',').map(Number), [bx, bz] = b.split(',').map(Number);
      return Math.hypot((bx + .5) * CHUNK - cx, (bz + .5) * CHUNK - cz) - Math.hypot((ax + .5) * CHUNK - cx, (az + .5) * CHUNK - cz);
    });
    while (this._pending.length && performance.now() - t0 < (this._warm ? 7 : 400)) this._buildChunk(this._pending.pop());
    this._warm = true;
  }

  tick(camera, dt, time, rider) {
    this._stream(camera.x, camera.z);
    this.life.tick(camera, dt, time, rider);
    this.landmarks?.tick?.(time, dt);
  }

  setNight(v) {
    this.night.value = v;
    this.landmarks?.setNight?.(v);
    if (this.poolMaterial) this.poolMaterial.opacity = v;
    for (const m of this.nightOnly || []) m.visible = v > 0.01;
  }

  setQuality(key) { this.qualityKey = key; this.life.setQuality(key); }

  dispose() {
    this.life.dispose();
    this.group.parent?.remove(this.group);
    this.group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
    for (const x of this.disposables) x.dispose?.();
    this.disposables.clear();
  }
}
