// Race day: the road as it is when the Tour comes through — closed to traffic and lined with people. Crowds by
// stretch (thin in the valleys, groups in the villages, a wall on the final climb, an orange crowd at Dutch Corner),
// flags, camper vans, tents and parked cars on the flat verges, metal crowd barriers, polka-dot summit banners,
// kilometre-to-go banners, the red flame at 1 km, the finish gantry and a TV helicopter. Generic colours and
// slogans only — no sponsors, no trademarks.
//
// Cheap by construction: everything is static and merged or instanced per stretch of road (one draw per kind per
// stretch, hidden past a reach); the cheering, the flags and the rotor move in the shaders. The crowd (race-day
// crowds plan, 27 Nov): nothing per person is built at load — the road's 25 m buckets make their people from their
// own seed as the camera nears; within the pool's reach they are impostor cards from an atlas photographed from the
// figures kit at load (one draw, no shadow cast; life/figures/impostors.js, life/crowd-pool.js), the nearest few
// (Balanced 40, within 12 m) are 3D figures, beyond the reach crowd cards (a strip of heads and shirts drawn by the
// shader) over a soft contact shadow on the ground; the people in the camps' chairs are cards too. Portable: a scene's "raceDay" block.
//
//   "raceDay": {
//     "crowd": [ { "fromM": 111600, "toM": 126900, "perM": 0.9, "rows": 3, "orange": 0.15 },
//                { "fromM": 120600, "toM": 121000, "perM": 1.4, "rows": 4, "orange": 0.85, "name": "Dutch Corner" } ],
//     "camps": [ { "fromM": 112000, "toM": 125000, "perKm": 30 } ],
//     "barriers": [ { "fromM": 123900, "toM": 127000 } ],
//     "kom": [ { "atM": 4800, "title": "Col Bayard" } ],
//     "kmToGo": [10, 5, 4, 3, 2], "flammeRouge": true, "finishM": 126960, "helicopter": true
//   }
import * as THREE from '../../../../vendor/three.js';
import { randomSequence } from '../core/random.js';
import { MeshBuilder } from '../core/mesh-builder.js';
import { Builder, M, box, cyl, cone } from '../core/model-builder.js';
import { Crowd, CLIP, FIT, randomLook, clipRate } from './figures/people.js';
import { bakeCrowdAtlas, POSE_OF } from './figures/impostors.js';   // [27 Nov] the crowd as impostor cards
import { CrowdPool, STRIDE, writePerson } from './crowd-pool.js';
import { staticVehicle, appendToBuilder, PAINTS } from './figures/vehicles.js';
import { staticCar } from './figures/cars.js';
import { HASH_GLSL } from '../materials/glsl-noise.js';   // [review 27 Nov] the shared sin-free hash
import { anchor } from '../core/shader-patch.js';   // [review 27 Nov] T8: a missing shader anchor throws

const ROAD_HALF = 3.5;
const BUCKET_M = 25;          // [27 Nov] the road's crowd buckets: each one's people come from its own seed, when the camera nears
const BUCKET_CACHE = 900;     // buckets kept made (the rest are made again, the same, when you come back)
const CARD_MERGE_M = 5000;    // crowd cards and contact shadows merged per 5 km
const CARD_CHUNK_M = 2000;    // camps and barriers per 2 km
const MOODS = [[CLIP.idle, CLIP.look, CLIP.photo, CLIP.idle], [CLIP.cheer, CLIP.cheer, CLIP.wave], [CLIP.clap]];
const ORANGE = ['#ff7a00', '#ff8c1a', '#f26a00', '#ffa033'];
// generic flags: [stripes direction, colours] (national tricolours and plain fan flags)
const FLAGS = [['v', '#0055a4', '#ffffff', '#ef4135'], ['h', '#ae1c28', '#ffffff', '#21468b'], ['v', '#000000', '#fdda24', '#ef3340'], ['d', '#c8102e', '#ffffff'],
  ['h', '#ffffff', '#005da4', '#ed1c24'], ['h', '#fcd116', '#003893', '#ce1126'], ['h', '#ff7a00', '#ff7a00', '#ff7a00'], ['h', '#d52b1e', '#ffffff', '#d52b1e'],
  ['c', '#d50000', '#009b3a', '#ffffff'], ['h', '#ffffff', '#d52b1e', '#ffffff']];

function flagAtlas() {
  const c = document.createElement('canvas'); c.width = 64 * FLAGS.length; c.height = 48;
  const ctx = c.getContext('2d');
  FLAGS.forEach(([dir, ...cols], i) => {
    const x = i * 64;
    if (dir === 'v') cols.forEach((col, k) => { ctx.fillStyle = col; ctx.fillRect(x + k * 64 / cols.length, 0, 64 / cols.length + 1, 48); });
    else if (dir === 'h') cols.forEach((col, k) => { ctx.fillStyle = col; ctx.fillRect(x, k * 48 / cols.length, 64, 48 / cols.length + 1); });
    else if (dir === 'd') { ctx.fillStyle = cols[0]; ctx.fillRect(x, 0, 64, 48); ctx.fillStyle = cols[1]; ctx.fillRect(x + 20, 0, 8, 48); ctx.fillRect(x, 20, 64, 8); }
    else { ctx.fillStyle = cols[2]; ctx.fillRect(x, 0, 64, 48); ctx.fillStyle = cols[0]; ctx.fillRect(x, 0, 64, 16); ctx.fillStyle = cols[1]; ctx.fillRect(x, 32, 64, 16); }
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function flagMaterial(uTime, map) {
  const m = new THREE.MeshStandardMaterial({ map, side: THREE.DoubleSide, roughness: .8 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace(anchor('#include <common>'), '#include <common>\nuniform float uTime; attribute float iFlag; attribute float iPhase;')
      .replace(anchor('#include <begin_vertex>'), `#include <begin_vertex>
        // the cloth flaps out from the pole (u = 0) and the pole sways as it is waved
        float wave = sin(uTime * 7. + uv.x * 5. + iPhase) * .12 * uv.x;
        transformed.z += wave; transformed.x += sin(uTime * 2.2 + iPhase) * .25 * (position.y - 1.72);`)
      .replace(anchor('#include <uv_vertex>'), `#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = vec2((iFlag + uv.x) / ${FLAGS.length}., uv.y);\n#endif`);
  };
  m.customProgramCacheKey = () => 'bf-raceday-flags-1';
  return m;
}

function cardMaterial(uTime, near) {
  // a crowd card: a strip of people seen from the road, drawn in the shader (heads, shirts, raised arms)
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, side: THREE.DoubleSide, alphaTest: .5, transparent: false });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime; shader.uniforms.uNear = near;
    shader.vertexShader = shader.vertexShader
      .replace(anchor('#include <common>'), '#include <common>\nattribute vec3 aCard; varying vec3 vCard; varying float vCamD;')
      .replace(anchor('#include <begin_vertex>'), '#include <begin_vertex>\nvCard = aCard; vCamD = distance((modelMatrix * vec4(position, 1.)).xyz, cameraPosition);');
    shader.fragmentShader = shader.fragmentShader
      .replace(anchor('#include <common>'), `#include <common>
        uniform float uTime; varying vec3 vCard;
        uniform float uNear; varying float vCamD;
        ${HASH_GLSL}
        float cH(float n) { n = mod(n, 1009.); return hw21(vec2(n, 4.1)); }   // [review 27 Nov] the shared sin-free hash`)
      .replace(anchor('#include <color_fragment>'), `#include <color_fragment>
        {
          // vCard: x metres along the strip, y metres up, z seed (+ orange share in the integer part)
          if (vCamD < uNear) discard;   // near the camera the crowd is people
          float slot = floor(vCard.x / .55), seed = fract(vCard.z) * 97. + mod(slot, 1009.);
          float lx = fract(vCard.x / .55) - .5;
          float h = 1.55 + cH(seed) * .3 + floor(vCard.z) * 0. ;
          float orange = step(cH(seed + 7.), floor(vCard.z) / 100.);
          vec3 shirt = mix(vec3(cH(seed + 1.), cH(seed + 2.), cH(seed + 3.)) * .8 + .1, vec3(1., .48, 0.), orange);
          float body = step(abs(lx), .22) * step(vCard.y, h - .25);
          float head = step(length(vec2(lx * .55, vCard.y - h + .12)), .11);
          float arm = step(cH(seed + 4.), .4) * step(abs(abs(lx) - .27), .05) * step(h - .3, vCard.y) * step(vCard.y, h + .35 + sin(uTime * 6. + seed) * .08);
          float legs = step(vCard.y, .85) * step(abs(lx), .2);
          if (body + head + arm < .5) discard;
          diffuseColor.rgb = head > .5 ? vec3(.86, .66, .5) : legs > .5 ? vec3(.2, .22, .27) : shirt;
        }`);
  };
  m.customProgramCacheKey = () => 'bf-raceday-cards-1';
  return m;
}

/** Banner atlas: 512×128 cells — kilometres to go, the red flame, the finish, the summit banners. */
function bannerTexture(texts) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 128 * Math.ceil(texts.length / 2);
  const ctx = c.getContext('2d');
  texts.forEach((t, i) => {
    const x = (i % 2) * 512, y = Math.floor(i / 2) * 128;
    if (t.kind === 'kom') {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, 512, 128);
      ctx.fillStyle = '#d4151c';
      for (let k = 0; k < 40; k++) { ctx.beginPath(); ctx.arc(x + 16 + (k % 20) * 25 + (Math.floor(k / 20) % 2) * 12, y + 22 + Math.floor(k / 20) * 84, 8, 0, 6.3); ctx.fill(); }
      ctx.fillStyle = '#1b1b1b'; ctx.font = 'bold 40px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(t.text.toUpperCase(), x + 256, y + 66, 470);
    } else if (t.kind === 'flamme') {
      ctx.fillStyle = '#c8102e'; ctx.fillRect(x, y, 512, 128);
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 48px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('1 KM', x + 256, y + 66);
    } else if (t.kind === 'finish') {
      for (let k = 0; k < 32; k++) for (let j = 0; j < 2; j++) { ctx.fillStyle = (k + j) % 2 ? '#111' : '#fff'; ctx.fillRect(x + k * 16, y + 96 + j * 16, 16, 16); }
      ctx.fillStyle = '#ffdd00'; ctx.fillRect(x, y, 512, 96);
      ctx.fillStyle = '#111'; ctx.font = 'bold 56px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('ARRIVÉE', x + 256, y + 50);
    } else {
      ctx.fillStyle = '#1f4fa3'; ctx.fillRect(x, y, 512, 128);
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 54px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t.text, x + 256, y + 66);
    }
  });
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return { tex, rows: Math.ceil(texts.length / 2) };
}

export class RaceDay {
  constructor(parent, landscape, route, index, uniforms, config = {}, quality = 'balanced', renderer = null) {
    this.L = landscape; this.route = route; this.index = index; this.u = uniforms; this.cfg = config;
    this.group = new THREE.Group(); this.group.name = 'Race day'; parent.add(this.group);
    this.end = route.turnS || route.total;
    this.chunks = []; this.dispose_ = [];
    this.reach = { people: config.peopleReachM ?? 230, cards: config.cardReachM ?? 2600, camps: config.campReachM ?? 3200 };
    const scale = quality === 'low' ? .45 : quality === 'ultra' ? 1.4 : quality === 'high' ? 1.2 : 1;
    const rand = randomSequence(2026);
    const F = (s) => landscape.frameAt(Math.max(0, Math.min(this.end - .5, s)));
    const free = (x, z, y, pad = 0) => !index.nearest(x, z, ROAD_HALF + .6 + pad) && !landscape.isWater?.(x, z, y) && !landscape.bridgeAt(x, z, 8) && !landscape.creekAt?.(x, z) && (!landscape.canPlant || landscape.canPlant(x, z));
    const barrierAt = (s) => (config.barriers || []).some((b) => s >= b.fromM && s <= b.toM);
    const tunnelAt = (s) => (config.noCrowd || []).some((b) => s >= b.fromM && s <= b.toM);

    const crowdAt = (s) => { let best = null; for (const c of config.crowd || []) if (s >= c.fromM && s < c.toM && (!best || (c.perM ?? 0) > (best.perM ?? 0))) best = c; return best; };
    // ---- people: seeded by the road (race-day crowds plan, 27 Nov). Nothing is built per person at load: the road is
    // cut into BUCKET_M buckets, and a bucket's people (where they stand, their look, pose and phase) come from its own
    // seed when the camera first comes near — the same people every time. Near the camera they're impostor cards in
    // one draw (life/crowd-pool.js); the nearest few are 3D figures; past the pool's reach, the crowd cards.
    this.crowdAt = crowdAt; this.tunnelAt = tunnelAt; this.barrierAt = barrierAt; this.free = free; this.F = F; this.scale = scale;
    this.buckets = [];
    for (let s0 = 30; s0 < this.end - 5; s0 += BUCKET_M) {
      const c = F(s0 + BUCKET_M / 2);
      this.buckets.push({ s0, x: c.x, y: c.y, z: c.z, people: null, block: null, used: 0 });
    }
    this.cache = 0;
    const Q = { low: [1500, 160, 0, 10], balanced: [4000, 250, 40, 12], high: [6000, 320, 80, 12], ultra: [8000, 380, 80, 12] }[quality] || [4000, 250, 40, 12];
    [this.poolCap, this.poolR, this.frontCap, this.frontR] = [Q[0], config.peopleReachM ?? Q[1], Q[2], Q[3]];
    this.reach.people = this.poolR;
    this.near = { value: new THREE.Vector4(0, -1e5, 0, 0) };
    this.atlas = bakeCrowdAtlas(renderer);
    if (this.atlas) {
      this._own(this.atlas);
      this.pool = new CrowdPool(this.group, { atlas: this.atlas, uTime: uniforms.uTime, near: this.near, capacity: this.poolCap, farM: this.poolR + BUCKET_M, name: 'Crowd (cards)' });
    } else this.frontCap = 0;   // (no renderer to bake with: the crowd cards only)
    this.nearCrowd = this.frontCap ? new Crowd(this.group, { uTime: uniforms.uTime, name: 'Crowd (front row)', capacity: this.frontCap, nearM: Infinity }) : null;
    // the front row's flags (the cards carry their own in the atlas)
    this.flagMat = this._own(flagMaterial(uniforms.uTime, this._own(flagAtlas())));
    if (this.frontCap) {
      const fg = this._own(new THREE.PlaneGeometry(.9, .6, 4, 1).translate(.45 - .27, 2.45, .12)), pg = this._own(new THREE.CylinderGeometry(.015, .015, 1.6, 4).translate(-.27, 1.95, .12));
      this.flagIds = new THREE.InstancedBufferAttribute(new Float32Array(this.frontCap), 1); this.flagPh = new THREE.InstancedBufferAttribute(new Float32Array(this.frontCap), 1);
      fg.setAttribute('iFlag', this.flagIds); fg.setAttribute('iPhase', this.flagPh);
      this.frontFlags = new THREE.InstancedMesh(fg, this.flagMat, this.frontCap); this.framePoles = new THREE.InstancedMesh(pg, this._own(new THREE.MeshStandardMaterial({ color: '#8c8c88' })), this.frontCap);
      for (const m of [this.frontFlags, this.framePoles]) { m.count = 0; m.frustumCulled = false; m.userData.dynamic = true; m.castShadow = true; this.group.add(m); }
      this.frontFlags.name = 'Fan flags (front row)'; this.framePoles.name = 'Flag poles (front row)';
    }
    this.peopleCount = 0;

    // ---- crowd cards (the far stand-in) and contact shadows under the crowd, where it's thick enough to read
    const cards = new Map(), strips = new Map(), camps = new Map();
    for (let s = 30; s < this.end - 5; s += 6) {
      const c = crowdAt(s);
      if (!c || (c.perM ?? 0) < .25 || tunnelAt(s)) continue;
      const a = F(s), b = F(s + 6), key = Math.floor(s / CARD_MERGE_M), fenced = barrierAt(s);
      for (const side of [1, -1]) {
        const lat = ROAD_HALF + (fenced ? 1.3 : 1.0) + .3;
        const A = { x: a.x - a.fz * side * lat, z: a.z + a.fx * side * lat }, B = { x: b.x - b.fz * side * lat, z: b.z + b.fx * side * lat };
        const ya = landscape.heightAt(A.x, A.z), yb = landscape.heightAt(B.x, B.z);
        if (Math.abs(ya - a.y) > 2.5 || Math.abs(yb - b.y) > 2.5 || !free(A.x, A.z, ya)) continue;
        (cards.get(key) || cards.set(key, []).get(key)).push({ A, B, ya, yb, s, seed: rand(), orange: c.orange ?? 0 });
        // a soft dark band on the ground under the rows: inner edge, middle, outer edge (the middle darkest)
        const l0 = ROAD_HALF + (fenced ? 1.4 : .7), l2 = l0 + (c.rows ?? 1) * .75 + .9, dark = Math.min(.42, .16 + (c.perM ?? .3) * .22);
        const row = [l0, (l0 + l2) / 2, l2].map((l, k) => [a, b].map((f) => { const x = f.x - f.fz * side * l, z = f.z + f.fx * side * l; return { x, y: landscape.heightAt(x, z) + .04, z, k: k === 1 ? dark : 0 }; }));
        (strips.get(key) || strips.set(key, []).get(key)).push(row);
      }
    }
    // camps: camper vans, tents, parked cars and folding chairs on the flatter verges
    for (const camp of config.camps || []) {
      for (let s = camp.fromM; s < Math.min(camp.toM, this.end); s += 1000 / Math.max(1, camp.perKm ?? 20) * (.5 + rand())) {
        const p = F(s), side = rand() < .5 ? 1 : -1, lat = ROAD_HALF + 4 + rand() * 8;
        const x = p.x - p.fz * side * lat, z = p.z + p.fx * side * lat, y = landscape.heightAt(x, z);
        const flat = Math.abs(landscape.heightAt(x + 3, z) - y) + Math.abs(landscape.heightAt(x, z + 3) - y);
        if (flat > 1.4 || !free(x, z, y, 2.5) || Math.abs(y - p.y) > 4) continue;
        const key = Math.floor(s / CARD_CHUNK_M);
        (camps.get(key) || camps.set(key, []).get(key)).push({ x, y, z, yaw: Math.atan2(p.fx, p.fz) + (rand() < .5 ? 0 : Math.PI) + (rand() - .5) * .3, kind: rand(), c: rand() });
      }
    }
    this.cardNear = { value: this.atlas ? this.poolR * .8 : 0 };
    const cardMat = this._own(cardMaterial(uniforms.uTime, this.cardNear));
    for (const [key, list] of cards) {
      const P = [], N = [], Cc = [], K = [], I = [];
      for (const c of list) {
        const len = Math.hypot(c.B.x - c.A.x, c.B.z - c.A.z), nx = -(c.B.z - c.A.z) / len, nz = (c.B.x - c.A.x) / len, b = P.length / 3;
        const seed = Math.round(c.orange * 100) + c.seed;
        for (const [x, y, z, u, v] of [[c.A.x, c.ya - .1, c.A.z, 0, 0], [c.B.x, c.yb - .1, c.B.z, len, 0], [c.B.x, c.yb + 2.05, c.B.z, len, 2.15], [c.A.x, c.ya + 2.05, c.A.z, 0, 2.15]]) {
          P.push(x, y, z); N.push(nx, 0, nz); Cc.push(1, 1, 1); K.push(u + c.s, v, seed);
        }
        I.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3)); g.setAttribute('aCard', new THREE.Float32BufferAttribute(K, 3)); g.setIndex(I);
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, cardMat); mesh.name = `Crowd cards ${(key * CARD_MERGE_M / 1000).toFixed(0)} km`; mesh.userData.bake = false; mesh.userData.standIn = true;   // the far stand-in for the people
      this._chunk(mesh, 'cards', g);
    }
    const stripMat = this._own(new THREE.MeshBasicMaterial({ color: '#000000', vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    stripMat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace(anchor('#include <color_fragment>'), '#include <color_fragment>\n diffuseColor = vec4(0., 0., 0., vColor.a);'); };
    stripMat.customProgramCacheKey = () => 'bf-crowd-contact-1';
    for (const [key, list] of strips) {
      const P = [], C = [], I = [];
      for (const row of list) {
        const b = P.length / 3;
        for (const [pa, pb] of row) for (const p of [pa, pb]) { P.push(p.x, p.y, p.z); C.push(0, 0, 0, p.k); }
        // vertices: (inner a, inner b), (mid a, mid b), (outer a, outer b)
        for (const k of [0, 2]) I.push(b + k, b + k + 1, b + k + 3, b + k, b + k + 3, b + k + 2);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 4)); g.setIndex(I); g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, stripMat); mesh.name = `Crowd contact shadow ${(key * CARD_MERGE_M / 1000).toFixed(0)} km`; mesh.userData.bake = false; mesh.renderOrder = 15;
      this._chunk(mesh, 'cards', g);
    }
    // camps: motorhomes, camper vans, tents, cars, chairs, parasols — merged per 2 km; the people in the chairs are
    // impostor cards (one draw for all of them)
    let rvGeo = null; const vanGeo = [], sitters = [];
    const sit = (x, y, z, yaw) => sitters.push({ x, y, z, yaw, look: randomLook(rand, { kids: .15, caps: .35 }), pose: POSE_OF[CLIP.sit], phase: rand(), rate: clipRate(CLIP.sit) });
    for (const [key, list] of camps) {
      const b = new Builder();
      for (const c of list) {
        const m = (x, y, z, ry = 0) => M(c.x + Math.cos(c.yaw) * x + Math.sin(c.yaw) * z, c.y + y, c.z - Math.sin(c.yaw) * x + Math.cos(c.yaw) * z, 1, 1, 1, c.yaw + ry);
        const at = (x, z, ry = 0) => sit(c.x + Math.cos(c.yaw) * x + Math.sin(c.yaw) * z, c.y, c.z - Math.sin(c.yaw) * x + Math.cos(c.yaw) * z, c.yaw + ry);
        if (c.kind < .45) {
          // a motorhome or a camper van, an awning, and people in folding chairs beside it
          const rv = c.c < .6;
          appendToBuilder(b, rv ? (rvGeo ||= staticVehicle('rv')) : (vanGeo[Math.floor(c.c * 10) % 3] ||= staticVehicle('camper', ['#2e86c1', '#e07a2f', '#3a7ca5'][Math.floor(c.c * 10) % 3])), m(0, 0, 0));
          b.add(box(2.6, .08, 2.2), m(2.45, 2.4, rv ? -.5 : 0), c.c < .5 ? '#2e86c1' : '#27ae60');
          for (const [x, z, ry] of [[2.3, -.6, -.4], [2.6, .7, .3]]) {
            b.add(box(.5, .06, .5), m(x, .44, z), '#3b5ba5'); b.add(box(.5, .5, .06), m(x, .44, z - .24), '#3b5ba5');
            for (const lx of [-.22, .22]) b.add(box(.03, .44, .03), m(x + lx, 0, z), '#666');
            if (rand() < .75) at(x, z + .1, ry);
          }
        } else if (c.kind < .7) {
          // a tent and a table
          b.add(cone(1.7, 1.7, 4), m(0, 0, 0, Math.PI / 4), ['#f39c12', '#2980b9', '#27ae60', '#c0392b'][Math.floor(c.c * 4)]);
          b.add(box(1.2, .75, .8), m(2.2, 0, 0), '#d8d3c6');
        } else if (c.kind < .9) {
          // a parked car
          const kind = ['sedan', 'hatch', 'suv', 'van'][Math.floor(c.c * 4)], paint = PAINTS[Math.floor(c.c * 97) % PAINTS.length];
          appendToBuilder(b, staticCar(kind, paint, 'lo'), m(0, 0, 0));
        } else {
          // a parasol and two chairs
          b.add(cyl(.03, .03, 2.2, 4), m(0, 0, 0), '#777');
          b.add(cone(1.4, .45, 8), m(0, 1.9, 0), ['#e74c3c', '#f1c40f', '#3498db'][Math.floor(c.c * 3)]);
          for (const x of [.7, -.7]) {
            b.add(box(.5, .06, .5), m(x, .44, 0), '#3b5ba5'); b.add(box(.5, .5, .06), m(x, .44, -.24), '#3b5ba5');
            if (rand() < .6) at(x, .1);
          }
        }
      }
      const mesh = new THREE.Mesh(b.build(), this._own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .75 })));
      mesh.name = `Race camps ${(key * CARD_CHUNK_M / 1000).toFixed(0)} km`; mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.geometry.computeBoundingSphere(); this._chunk(mesh, 'camps', mesh.geometry);
    }
    if (this.atlas && sitters.length) {
      const block = new Float32Array(sitters.length * STRIDE);
      sitters.forEach((p, i) => writePerson(block, i, p));
      this.sitters = new CrowdPool(this.group, { atlas: this.atlas, uTime: uniforms.uTime, near: { value: new THREE.Vector4(0, 0, 0, 0) }, capacity: sitters.length, farM: 700, name: 'Camp sitters (cards)' });
      this.sitters.show([block]);
    }
    this._barriers(F, rand);
    if (config.paint?.length) this._paint(F, rand);
    this._banners(F);
    if (config.helicopter) this._helicopter();
  }

  _own(x) { this.dispose_.push(x); return x; }
  _chunk(mesh, kind, geometry = null) { if (geometry) this._own(geometry); mesh.userData.kind = kind; if (!mesh.userData.dynamic) mesh.userData.bake = false;   // streams with the camera: receives the bake, never triggers one
    this.group.add(mesh); this.chunks.push(mesh); }

  _barriers(F) {
    // metal crowd barriers ("Vauban"): 2.5 m panels on both sides, in grey, merged per 2 km
    const by = new Map();
    for (const r of this.cfg.barriers || []) {
      for (let s = r.fromM; s < Math.min(r.toM, this.end - 1); s += 2.5) {
        const a = F(s), b = F(s + 2.4);
        for (const side of [1, -1]) {
          const lat = ROAD_HALF + .55;
          const A = { x: a.x - a.fz * side * lat, z: a.z + a.fx * side * lat }, B = { x: b.x - b.fz * side * lat, z: b.z + b.fx * side * lat };
          if (this.L.bridgeAt(A.x, A.z, 4)) continue;
          if (this.index.nearest(A.x, A.z, lat - .45) || this.index.nearest(B.x, B.z, lat - .45)) continue;   // the inside of a tight bend folds back on itself
          (by.get(Math.floor(s / CARD_CHUNK_M)) || by.set(Math.floor(s / CARD_CHUNK_M), []).get(Math.floor(s / CARD_CHUNK_M))).push({ A, B, ya: this.L.heightAt(A.x, A.z), yb: this.L.heightAt(B.x, B.z) });
        }
      }
    }
    for (const [key, list] of by) {
      const P = [], I = [];
      const bar = (ax, ay, az, bx, by_, bz, t) => {
        // a thin box along a→b, t thick
        const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1, nx = -dz / L * t, nz = dx / L * t, b = P.length / 3;
        P.push(ax - nx, ay - t, az - nz, bx - nx, by_ - t, bz - nz, bx + nx, by_ + t, bz + nz, ax + nx, ay + t, az + nz,
          ax - nx, ay + t, az - nz, bx - nx, by_ + t, bz - nz, bx + nx, by_ - t, bz + nz, ax + nx, ay - t, az + nz);
        I.push(b, b + 1, b + 2, b, b + 2, b + 3, b + 4, b + 5, b + 6, b + 4, b + 6, b + 7);
      };
      for (const p of list) {
        for (const h of [.15, 1.1]) bar(p.A.x, p.ya + h, p.A.z, p.B.x, p.yb + h, p.B.z, .03);
        for (let k = 0; k <= 8; k++) { const t = k / 8, x = p.A.x + (p.B.x - p.A.x) * t, z = p.A.z + (p.B.z - p.A.z) * t, y = p.ya + (p.yb - p.ya) * t; bar(x, y + .15, z, x + .001, y + 1.1, z + .001, .012); }
        bar(p.A.x, p.ya, p.A.z, p.A.x + .001, p.ya + .2, p.A.z + .001, .05);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals(); g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, this._own(new THREE.MeshStandardMaterial({ color: '#a9adb1', metalness: .5, roughness: .45, side: THREE.DoubleSide })));
      mesh.name = `Crowd barriers ${(key * CARD_CHUNK_M / 1000).toFixed(0)} km`; mesh.castShadow = true;
      this._chunk(mesh, 'camps', g);
    }
  }

  _paint(F, rand) {
    // painted words on the tarmac: generic cheers, hearts and invented riders' names, in white, yellow and orange
    const words = this.cfg.paintWords || ['ALLEZ', 'HUP HUP', 'VAS-Y', 'ALLEZ ALLEZ', 'FORZA', '♥', 'BRAVO', 'GO GO', 'COURAGE', 'ALLEZ JULES', 'HUP NOOR', 'ALLEZ LÉA', 'VAMOS', 'ALÉ', 'ON Y VA', 'ALLEZ TOM'];
    const c = document.createElement('canvas'); c.width = 1024; c.height = 64 * Math.ceil(words.length / 2);
    const ctx = c.getContext('2d'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    words.forEach((w, i) => {
      ctx.font = `bold ${w.length > 8 ? 44 : 54}px sans-serif`; ctx.fillStyle = '#ffffff';
      ctx.save(); ctx.translate((i % 2) * 512 + 256, Math.floor(i / 2) * 64 + 34); ctx.scale(1, .9); ctx.fillText(w, 0, 0, 480); ctx.restore();
    });
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const rows = Math.ceil(words.length / 2), P = [], U = [], C = [], I = [];
    const inks = ['#f4f4ee', '#f4f4ee', '#ffd400', '#ff7a00', '#f4f4ee'].map((h) => new THREE.Color(h));
    for (const r of this.cfg.paint) {
      for (let s = r.fromM; s < Math.min(r.toM, this.end - 20); s += 1000 / (r.perKm || 20) * (.5 + rand())) {
        const f = F(s), i = Math.floor(rand() * words.length), lat = (rand() - .5) * 2.4, len = 4.2 + rand() * 1.6, wid = 2.2 + rand() * .8;   // stretched along the road so it reads from the saddle
        const cx = f.x - f.fz * lat, cz = f.z + f.fx * lat;
        // written across the lane so the rider reads it coming up the hill
        const ax = -f.fz, az = f.fx, b = P.length / 3, ink = inks[Math.floor(rand() * inks.length)];
        const pts = [[-len / 2, -wid / 2], [len / 2, -wid / 2], [len / 2, wid / 2], [-len / 2, wid / 2]];
        const u0 = (i % 2) / 2, v1 = 1 - Math.floor(i / 2) / rows, v0 = v1 - 1 / rows;
        pts.forEach(([a, d], k) => {
          const x = cx + ax * a + f.fx * d, z = cz + az * a + f.fz * d;
          P.push(x, f.y + .17, z); C.push(ink.r, ink.g, ink.b);
          U.push(u0 + (k === 1 || k === 2 ? .5 : 0), k < 2 ? v0 : v1);
        });
        I.push(b, b + 2, b + 1, b, b + 3, b + 2);
      }
    }
    if (!I.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(P.length).fill(0).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
    g.setIndex(I); g.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({ map: this._own(tex), vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, alphaTest: .3, roughness: .9, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -8 });   // the road itself is offset -2 (world.js)
    const mesh = new THREE.Mesh(this._own(g), this._own(mat)); mesh.name = 'Road paint'; mesh.userData.bake = false; mesh.renderOrder = 20;   // after the road's own layers (render orders 2–11)
    this.group.add(mesh);
  }

  _banners(F) {
    // banners across the road on gantries: polka-dot summit banners, kilometres to go, the red flame, the finish
    const items = [];
    for (const k of this.cfg.kom || []) items.push({ atM: k.atM, kind: 'kom', text: k.title });
    const finish = this.cfg.finishM ?? this.end - 40;
    for (const km of this.cfg.kmToGo || []) if (finish - km * 1000 > 0) items.push({ atM: finish - km * 1000, kind: 'km', text: `${km} km` });
    if (this.cfg.flammeRouge) items.push({ atM: finish - 1000, kind: 'flamme', text: '1 km' });
    items.push({ atM: finish, kind: 'finish', text: 'Arrivée' });
    const { tex, rows } = bannerTexture(items);
    const P = [], U = [], N = [], I = [], posts = new Builder();
    items.forEach((it, i) => {
      const f = F(it.atM), w = ROAD_HALF * 2 + 3.6, hgt = it.kind === 'finish' ? 1.6 : 1.1, top = it.kind === 'finish' ? 7 : 5.8;
      const rx = -f.fz, rz = f.fx;   // across the road
      const c = [[-w / 2, top - hgt], [w / 2, top - hgt], [w / 2, top], [-w / 2, top]].map(([a, y]) => [f.x + rx * a, f.y + y, f.z + rz * a]);
      const u0 = (i % 2) / 2, u1 = u0 + .5, v1 = 1 - Math.floor(i / 2) / rows, v0 = v1 - 1 / rows;
      // two faces: the front (toward the oncoming rider) and the back
      for (const [order, nrm, mirror] of [[[0, 1, 2, 3], [-f.fx, 0, -f.fz], false], [[1, 0, 3, 2], [f.fx, 0, f.fz], true]]) {
        const b = P.length / 3;
        order.forEach((k, j) => { P.push(c[k][0] + nrm[0] * .02, c[k][1], c[k][2] + nrm[2] * .02); N.push(...nrm); const uu = [u0, u1, u1, u0][mirror ? [1, 0, 3, 2][j] : j]; U.push(mirror ? u0 + u1 - uu : uu, [v0, v0, v1, v1][j]); });
        I.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
      for (const a of [-w / 2 - .9, w / 2 + .9]) {   // clear of the verge posts at the road edge
        const x = f.x + rx * a, z = f.z + rz * a, y = this.L.heightAt(x, z);
        posts.add(cyl(.12, .14, f.y + top - y + .2, 6), M(x, y, z), it.kind === 'finish' ? '#f2f2f2' : '#3d4652');
      }
      if (it.kind === 'finish') posts.add(box(w + .6, .5, .6), M(f.x, f.y + top + .25, f.z, 1, 1, 1, Math.atan2(rx, rz) + Math.PI / 2), '#222a33');
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(this._own(g), this._own(new THREE.MeshStandardMaterial({ map: this._own(tex), roughness: .7 })));
    mesh.name = 'Race banners'; mesh.castShadow = true; mesh.userData.sign = true;
    const pm = new THREE.Mesh(this._own(posts.build()), this._own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .5, metalness: .3 })));
    pm.name = 'Banner gantries'; pm.castShadow = true;
    this.group.add(mesh, pm);
    this.bannerCount = items.length;
  }

  _helicopter() {
    // a TV helicopter holding station ahead of the rider, nose down a little, rotor turning
    const b = new Builder();
    b.add(box(1.8, 1.6, 4.2), M(0, 0, 0), '#e9eef2'); b.add(box(.6, .6, 4.5), M(0, .5, -4), '#e9eef2');
    b.add(box(1.7, .6, 1.6), M(0, .55, 1.8), '#3b4d5c'); b.add(box(.12, 1.4, .9), M(0, .6, -6.1), '#c0392b');
    for (const x of [-.9, .9]) b.add(box(.12, .12, 3.4), M(x, -.4, 0), '#555');
    this.heli = new THREE.Group(); this.heli.name = 'TV helicopter';
    const body = new THREE.Mesh(this._own(b.build()), this._own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .5 })));
    const rotor = new THREE.Mesh(this._own(new THREE.BoxGeometry(11, .06, .35)), this._own(new THREE.MeshStandardMaterial({ color: '#2b2b2b', transparent: true, opacity: .55 })));
    rotor.position.y = 1.4; this.rotor = rotor;
    this.heli.add(body, rotor);
    for (const o of [body, rotor]) { o.userData.dynamic = true; o.castShadow = true; }
    this.group.add(this.heli);
  }

  /** A bucket's people, from its own seed (the old load-time placement, a bucket at a time). */
  _makeBucket(bk, i) {
    const { L, F, free, crowdAt, tunnelAt, barrierAt, scale } = this, rand = randomSequence(2026 + i * 7919), people = [];
    for (let s = bk.s0; s < Math.min(bk.s0 + BUCKET_M, this.end - 5); s += 1) {
      const c = crowdAt(s);
      if (!c || tunnelAt(s)) continue;
      const per = (c.perM ?? .3) * scale, rows = c.rows ?? 1, p = F(s);
      // behind barriers on a sharp corner the panels kink at the road's 10 m joints: leave the corner empty
      if (barrierAt(s)) { const a = F(s - 6), b = F(s + 6); if (a.fx * b.fx + a.fz * b.fz < .94) continue; }
      for (const side of [1, -1]) {
        if (rand() > per) continue;   // people per metre per side
        for (let r = 0; r < rows; r++) {
          if (r && rand() > .75) continue;
          const fenced = barrierAt(s), lat = ROAD_HALF + (fenced ? 1.6 : .9) + r * .75 + rand() * .35;
          const j = (rand() - .5) * .5, x = p.x - p.fz * side * lat + p.fx * j, z = p.z + p.fx * side * lat + p.fz * j, y = L.heightAt(x, z);   // jitter along the road, never toward it
          if (Math.abs(y - p.y) > 2.5 || !free(x, z, y, fenced ? .9 : .3)) continue;   // behind the barriers, also on the inside of a bend
          const yaw = Math.atan2(p.fz * side, -p.fx * side) + (rand() - .5) * .9;   // facing the road
          const orange = rand() < (c.orange ?? 0), flag = rand() < (c.flags ?? .08), mood = rand() < (c.cheer ?? .55) ? (rand() < .7 ? 1 : 2) : 0;
          const look = randomLook(rand, { kids: .1, caps: .25, packs: .12, skirts: .1, ...(orange ? { shirt: ORANGE[people.length % ORANGE.length] } : {}) });
          if (orange && rand() < .5) look.pants = new THREE.Color('#ff8c1a');
          const table = MOODS[mood] || MOODS[0], clip = flag ? CLIP.flag : table[Math.floor(rand() * table.length)];
          if (clip === CLIP.photo) look.bits |= FIT.PROP;
          if (flag) { look.h = 1; look.g = 1; look.kid = false; }   // the flag's pole is built for an adult's raised hand
          const flagId = orange ? 6 : Math.floor(rand() * FLAGS.length);
          people.push({ x, y, z, yaw, look, clip, pose: Math.max(0, POSE_OF[clip]), phase: rand(), rate: clipRate(clip) * (.85 + rand() * .3), flagId, flag: flag ? new THREE.Color(FLAGS[flagId][1 + Math.floor(rand() * (FLAGS[flagId].length - 1))]) : null });
        }
      }
    }
    bk.people = people;
    bk.block = new Float32Array(people.length * STRIDE);
    people.forEach((p, k) => writePerson(bk.block, k, p));
    this.cache++;
  }

  /** Buckets within the pool's reach, nearest first; made as needed (all at once the first time, then a few ms a frame). */
  _refresh(cam, first) {
    const R = this.poolR + BUCKET_M, near = [];
    for (let i = 0; i < this.buckets.length; i++) {
      const b = this.buckets[i], d = Math.hypot(b.x - cam.x, b.y - cam.y, b.z - cam.z) - BUCKET_M / 2;
      if (d < R) near.push([d, i]);
    }
    near.sort((a, b) => a[0] - b[0]);
    const t0 = performance.now(), blocks = [], front = [];
    let n = 0, edge = this.poolR, waiting = false;
    for (const [d, i] of near) {
      const b = this.buckets[i];
      if (!b.people) {
        if (!first && performance.now() - t0 > 2.5) { waiting = true; edge = Math.min(edge, Math.max(0, d)); break; }
        this._makeBucket(b, i);
      }
      b.used = this.frame;
      if (n + b.people.length > this.poolCap) { edge = Math.min(edge, Math.max(0, d)); break; }
      n += b.people.length; blocks.push(b.block);
      if (d < this.frontR) front.push(b);
    }
    this.pool.show(blocks);
    this.peopleCount = n; this.frontBuckets = front;
    // the crowd cards take over where the pool stops (its reach, or its capacity, or a bucket still to be made)
    this.cardNear.value = edge;
    if (this.cache > BUCKET_CACHE) {   // forget the buckets used longest ago (made again, the same, on the way back)
      const old = this.buckets.filter((b) => b.people && b.used !== this.frame).sort((a, b) => a.used - b.used);
      for (const b of old.slice(0, this.cache - BUCKET_CACHE)) { b.people = null; b.block = null; this.cache--; }
    }
    return waiting;
  }

  /** Every frame: show the stretches near the camera, keep the pool round it, the nearest people in 3D, fly the helicopter. */
  tick(dt, camera, riderS = null) {
    const cam = camera.position || camera, cx = cam.x, cz = cam.z;
    this.frame = (this.frame || 0) + 1;
    for (const m of this.chunks) {
      const b = m.isInstancedMesh ? m.boundingSphere : m.geometry.boundingSphere;
      if (!b) continue;
      m.visible = Math.hypot(b.center.x - cx, b.center.z - cz) - b.radius < this.reach[m.userData.kind];
    }
    if (this.pool) {
      const moved = !this._at || Math.hypot(cam.x - this._at.x, cam.y - this._at.y, cam.z - this._at.z) > 3;
      if (moved || this._waiting) { this._waiting = this._refresh(cam, !this._at); this._at = { x: cam.x, y: cam.y, z: cam.z }; }
    }
    // the front row: the nearest people (up to the cap, within frontR) drawn as 3D figures; the cards drop the same ones
    let R = 0;
    if (this.nearCrowd) {
      const list = [];
      for (const b of this.frontBuckets || []) for (const p of b.people) { const d = Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z); if (d < this.frontR) list.push([d, p]); }
      list.sort((a, b) => a[0] - b[0]);
      R = list.length > this.frontCap ? (list[this.frontCap - 1][0] + list[this.frontCap][0]) / 2 : this.frontR;
      this.nearCrowd.begin(cam);
      let f = 0;
      const one = new THREE.Vector3(1, 1, 1), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), mtx = new THREE.Matrix4(), pos = new THREE.Vector3();
      for (const [d, p] of list) {
        if (d >= R) break;
        this.nearCrowd.add(p.look, p.x, p.y, p.z, p.yaw, p.clip, p.phase, p.rate);
        if (p.clip === CLIP.flag && this.frontFlags) {
          mtx.compose(pos.set(p.x, p.y, p.z), q.setFromAxisAngle(up, p.yaw), one);
          this.frontFlags.setMatrixAt(f, mtx); this.framePoles.setMatrixAt(f, mtx); this.flagIds.array[f] = p.flagId; this.flagPh.array[f] = p.phase * 6.28; f++;
        }
      }
      this.nearCrowd.end();
      if (this.frontFlags) {
        this.frontFlags.count = this.framePoles.count = f;
        this.frontFlags.instanceMatrix.needsUpdate = this.framePoles.instanceMatrix.needsUpdate = true; this.flagIds.needsUpdate = this.flagPh.needsUpdate = true;
      }
    }
    this.near.value.set(cam.x, cam.y, cam.z, R);
    if (this.heli) {
      this._t = (this._t || 0) + dt;
      const t = this._t;
      // hover ahead and to the side of the camera, drifting slowly
      const ang = t * .05;
      this.heli.position.set(cx + Math.cos(ang) * 180, this.L.heightAt(cx, cz) + 90 + Math.sin(t * .3) * 6, cz + Math.sin(ang) * 180);
      this.heli.rotation.set(-.08, -ang + Math.PI, 0);
      this.rotor.rotation.y += dt * 40;
    }
  }

  dispose() {
    this.nearCrowd?.dispose(); this.pool?.dispose(); this.sitters?.dispose();
    for (const m of this.chunks) m.dispose?.();
    this.frontFlags?.dispose(); this.framePoles?.dispose();
    this.dispose_.forEach((x) => x.dispose?.());
    this.group.removeFromParent();
  }
}
