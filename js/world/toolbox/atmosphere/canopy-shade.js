// Canopy shade: dappled sunlight under the trees near the rider (user, 25 Nov 2026 — the Zwift reference, "dappled
// sunlight: canopy shadows break the road, verge and rider into sun patches"; bikefree's baked shadows had the crowns as
// solid blobs, 2 m texels, no light coming through).
//
// How it works (one small texture, one function in the lit shaders):
//   - a horizontal "canopy plane" a little above the rider (planeY). Every crown near the camera is drawn into a
//     256 × 256 RGBA8 map of that plane, 0.625 m texels (160 m square, re-centred as the camera moves on): where the ray
//     from the crown's centre toward the sun crosses the plane, an ellipse as wide as the crown and stretched along the
//     sun's azimuth by its depth (a low sun throws long shade). R: how dense the leaves are there (soft edged, the most
//     of overlapping crowns); G: the lowest crown bottom over that texel (so a crown's own leaves and anything above the
//     crowns aren't shaded by it).
//   - a lit surface at w follows its own ray toward the sun to the plane and reads the map there — the ground, the
//     road, the rider, a bush, a near tree's lower leaves all agree where the shade falls. Inside the shade, sun flecks:
//     two octaves of noise in the plane's coordinates, more holes where the crown is thin, swaying a little with the
//     wind. Beyond ~75 m from the camera it hands back to the bake.
//   - baked-light.js mixes it into bfBakedLight: inside a crown's shade this decides the sun (the bake's crown blobs and
//     their "cover" darkening give way to it); everywhere else the bake is unchanged. No bake (a map lit live): the
//     shade is not drawn (yet).
//
// The world gives the trees: an `{ x, y, z, r (crown radius), cy (crown centre above the base), ry (half depth),
// cb (crown bottom above the base) }` list near a point (canopyTrees(x, z, R)). A map turns it on with the
// "canopyShade" effect (toolbox/effects/canopy-shade.js).
import * as THREE from '../../../../vendor/three.js';
import { HASH_GLSL } from '../materials/glsl-noise.js';   // [review 27 Nov] the shared sin-free hash and value noise

const N = 256;               // texels a side
const CELL = 0.625;          // m a texel
const SIZE = N * CELL;       // 160 m
const MOVE = 16;             // m the camera moves before the map is re-centred and redrawn

const blank = new THREE.DataTexture(new Uint8Array([0, 128, 0, 255]), 1, 1, THREE.RGBAFormat); blank.needsUpdate = true;
/** Shared uniforms (every patched material reads these: the bake's patch spreads them in). */
export const CANOPY = {
  bfCanopyTex: { value: blank },
  bfCanopyBox: { value: new THREE.Vector4(0, 0, 1 / SIZE, 0) },   // x0, z0, 1/size, planeY
  bfCanopyK: { value: new THREE.Vector4(0, 0, 0, 0) },            // sunX/sunY, sunZ/sunY, on (0/1 × strength), time
};

/** GLSL: bfCanopy(world position) → (sun visibility 0–1, crown density there 0–1). Include-guarded (the bake's patch and
 *  the ground's litter both pull it in). */
export const CANOPY_GLSL = /* glsl */`
#ifndef BF_CANOPY
#define BF_CANOPY
uniform sampler2D bfCanopyTex; uniform vec4 bfCanopyBox; uniform vec4 bfCanopyK;
${HASH_GLSL}
vec2 bfCanopy(vec3 w) {
  if (bfCanopyK.z <= 0.) return vec2(1., 0.);
  vec2 p = w.xz + bfCanopyK.xy * (bfCanopyBox.w - w.y);   // along the ray toward the sun, up (or down) to the plane
  vec2 uv = (p - bfCanopyBox.xy) * bfCanopyBox.z;
  if (uv.x <= 0. || uv.y <= 0. || uv.x >= 1. || uv.y >= 1.) return vec2(1., 0.);
  vec4 c = texture2D(bfCanopyTex, uv);
  float bottom = bfCanopyBox.w + (c.g * 255. - 128.) * .25;
  float dens = c.r * (1. - smoothstep(bottom - 1., bottom + 1.5, w.y));   // (under the crowns only)
  float fade = 1. - smoothstep(55., 78., length(w.xz - cameraPosition.xz));
  dens *= fade;
  if (dens <= .001) return vec2(1., 0.);
  // sun flecks: more where the crown is thin, fewer under the thick of it; swaying a little with the wind
  float t = bfCanopyK.w;
  vec2 q = p * 1.15 + vec2(sin(t * .9 + p.y * .07), cos(t * .7 + p.x * .06)) * .22;
  float n = vn2(q) * .55 + vn2(q * 2.6 + 17.) * .3 + vn2(q * .23 + 5.) * .15;
  float th = mix(.4, .58, c.r);
  // (soft dapples, user 26 Nov — "the sun patches look like paint"): each fleck is an image of the sun through a gap in
  // the leaves, its edge blurred by the sun's 0.53° width over the drop from the leaves (~1 cm a metre): flecks under a
  // high crown are soft, under a low branch crisp; a little more blur with distance so they never shimmer
  float drop = max(0., bottom - w.y), pen = clamp(.06 + drop * .016 + length(w.xz - cameraPosition.xz) * .0012, .06, .3);
  float holes = smoothstep(th - pen * .35, th + pen, n);
  return vec2(1. - dens * (1. - holes) * .93 * min(1., bfCanopyK.z), dens);
}
#endif
`;

/**
 * The canopy map: `update(camera, sunDir, trees)` (cheap: redraws only after the camera has moved MOVE m, or when told
 * the trees changed). trees(x, z, R) → crowns near (x, z).
 */
export class CanopyShade {
  constructor({ strength = 1, planeLift = 7 } = {}) {
    this.strength = strength; this.planeLift = planeLift;
    this.data = new Uint8Array(N * N * 4);
    this.tex = new THREE.DataTexture(this.data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.tex.magFilter = THREE.LinearFilter; this.tex.minFilter = THREE.LinearFilter; this.tex.generateMipmaps = false;
    this.tex.flipY = false; this.tex.needsUpdate = true;
    this._at = null; this.dirty = true; this.U = CANOPY; this._job = null; this.back = null;
    this.stats = { trees: 0, ms: 0 };
  }
  /** Turn on (the shared uniforms point at this map). */
  attach() { CANOPY.bfCanopyTex.value = this.tex; CANOPY.bfCanopyK.value.z = this.strength; }
  detach() { if (CANOPY.bfCanopyTex.value === this.tex) { CANOPY.bfCanopyTex.value = blank; CANOPY.bfCanopyK.value.z = 0; } }
  setVisible(v) { CANOPY.bfCanopyK.value.z = v ? this.strength : 0; }

  /**
   * Per frame. Re-centres after the camera has moved MOVE m (or the trees changed): the new map is drawn into a back
   * buffer a slice at a time (budgetMs a frame: no hitch on a phone) and swapped in, with its box, when complete.
   */
  update(camera, sunDir, trees, groundY, time, budgetMs = 2.5) {
    const K = CANOPY.bfCanopyK.value;
    K.w = time;
    const sy = Math.max(.12, sunDir.y), kx = sunDir.x / sy, kz = sunDir.z / sy;
    K.x = kx; K.y = kz;
    const c = camera.position;
    if (!this._job && (this.dirty || !this._at || Math.hypot(c.x - this._at.x, c.z - this._at.z) >= MOVE)) {
      this.dirty = false; this._at = { x: c.x, z: c.z };
      this._job = this._draw(c, kx, kz, groundY, trees);
    }
    if (!this._job) return false;
    const t0 = performance.now(), end = t0 + (budgetMs <= 0 ? 1e9 : budgetMs);
    let r;
    do r = this._job.next(end); while (!r.done && performance.now() < end);
    this.stats.ms += performance.now() - t0;
    if (!r.done) return false;
    this._job = null;
    // the finished map: swap it in with its box
    const D = this.data; this.data = this.back; this.back = D;
    this.tex.image.data = this.data; this.tex.needsUpdate = true;
    CANOPY.bfCanopyBox.value.set(r.value.x0, r.value.z0, 1 / SIZE, r.value.planeY);
    return true;
  }
  /** Draw now, whole (the tools that draw one frame). */
  flush(camera, sunDir, trees, groundY, time) { this.dirty = true; this._job = null; this.update(camera, sunDir, trees, groundY, time, 0); }

  *_draw(c, kx, kz, groundY, trees) {
    this.stats = { trees: 0, ms: 0 };
    const planeY = groundY + this.planeLift;
    // the window centred where the camera's own shade comes from (up the sun ray from it): the shade round the camera
    const cx = Math.round((c.x + kx * this.planeLift) / CELL) * CELL, cz = Math.round((c.z + kz * this.planeLift) / CELL) * CELL;
    const x0 = cx - SIZE / 2, z0 = cz - SIZE / 2;
    const D = this.back ||= new Uint8Array(N * N * 4);
    for (let i = 0; i < N * N; i++) { D[i * 4] = 0; D[i * 4 + 1] = 255; D[i * 4 + 2] = 0; D[i * 4 + 3] = 255; }
    // the sun's azimuth in the plane (the ellipses' long axis), and how far a crown's depth stretches its shade
    const hl = Math.hypot(kx, kz) || 1, ax = kx / hl, az = kz / hl, stretch = Math.hypot(kx, kz);
    // every crown whose shade can reach the window: up to ~30 m tall, its shade thrown back along the sun ray
    const list = trees(cx - kx * 10, cz - kz * 10, SIZE * .75 + 30 * stretch);
    let end = yield;
    let n = 0;
    for (let q = 0; q < list.length; q++) {
      if ((q & 15) === 0 && performance.now() > end) end = yield;
      const t = list[q], ccY = t.y + t.cy;
      // where the ray from the crown's centre toward the sun crosses the plane (into the plane's frame)
      const px = t.x + kx * (planeY - ccY), pz = t.z + kz * (planeY - ccY);
      const a = Math.max(.6, t.r * .92), b = Math.hypot(a, t.ry * stretch);   // across, along the sun
      if (px + b < x0 || px - b > x0 + SIZE || pz + b < z0 || pz - b > z0 + SIZE) continue;
      n++;
      const bot = Math.max(0, Math.min(255, Math.round(128 + (t.y + t.cb - planeY) * 4)));
      const dens = t.dens ?? .95;
      const i0 = Math.max(0, Math.floor((px - b - x0) / CELL)), i1 = Math.min(N - 1, Math.ceil((px + b - x0) / CELL));
      const j0 = Math.max(0, Math.floor((pz - b - z0) / CELL)), j1 = Math.min(N - 1, Math.ceil((pz + b - z0) / CELL));
      const ib2 = 1 / (b * b), ia2 = 1 / (a * a);
      for (let j = j0; j <= j1; j++) {
        const z = z0 + (j + .5) * CELL - pz;
        for (let i = i0; i <= i1; i++) {
          const x = x0 + (i + .5) * CELL - px;
          const u = x * ax + z * az, v = -x * az + z * ax;   // along the sun, across
          const e = u * u * ib2 + v * v * ia2;
          if (e >= 1) continue;
          // soft edged: full in the middle, thinning over the outer third (a crown's edge lets more light through)
          const k = Math.min(1, (1 - e) * 2.6) * dens;
          const o = (j * N + i) * 4, cur = D[o] / 255;
          D[o] = Math.round(255 * (1 - (1 - cur) * (1 - k * .72)));
          if (bot < D[o + 1]) D[o + 1] = bot;
        }
      }
    }
    this.stats.trees = n;
    return { x0, z0, planeY };
  }
  dispose() { this.detach(); this.tex.dispose(); }
}
