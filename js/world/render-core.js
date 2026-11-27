// The render core (fidelity plan, step 0): one place where every world (graph maps, route scenes, Endless) gets its
// renderer, its quality tier, its adaptive resolution and its GPU timing. The backend swap (step 1) happens here.
//
//   TIERS                      the one tier table (pixel ratio, MSAA, shadows, shadow map) — Phone (low), Balanced,
//                              High, Ultra
//   createRenderer(opts)       a configured renderer on the container (sRGB out, ACES, high-performance GPU)
//   QualityGovernor            drops render scale 1 → 0.7 when frames run long, then asks the world for less
//                              vegetation, then a shorter shadow reach; climbs back when there's headroom
//   GpuTimer                   GPU ms per named pass (EXT_disjoint_timer_query_webgl2 where there is one)
//   watchDeviceLoss(r, fn)     the GPU was reset (context lost): fn() rebuilds
//   snapShadowBox(...)         a live shadow box's centre on whole texels of its map (no shimmer as it follows)
//   teardownWorld(r, scene)    a world's last step: what's left in its scene, the figures' shared caches, the renderer
//                              and its WebGL context
import * as THREE from '../../vendor/three.js';
import { disposeCarGeometries } from './toolbox/life/figures/cars.js';
import { disposeAnimalGeometries } from './toolbox/life/figures/animals.js';
import { disposeVehicleGeometries } from './toolbox/life/figures/vehicles.js';
import { disposeRiderAssets } from './rider.js';

/** The tier table. pixelRatio caps the device's; samples: MSAA of the offscreen targets; shadowMap: live map px. */
export const TIERS = {
  low: { label: 'Phone', pixelRatio: 1, antialias: false, samples: 0, shadows: false, shadowMap: 1024, frameMs: 1000 / 30 },
  balanced: { label: 'Balanced', pixelRatio: 1.5, antialias: true, samples: 4, shadows: true, shadowMap: 1024, frameMs: 1000 / 60 },
  high: { label: 'High', pixelRatio: 2, antialias: true, samples: 4, shadows: true, shadowMap: 2048, frameMs: 1000 / 60 },
  ultra: { label: 'Ultra', pixelRatio: 2, antialias: true, samples: 4, shadows: true, shadowMap: 2048, frameMs: 1000 / 60 },
};
export const TIER_KEYS = Object.keys(TIERS);
export const tierOf = (key) => TIERS[key] || TIERS.balanced;
/** Whether a tier is at least another (Ultra counts as High everywhere High gets more): tierAtLeast('ultra', 'high'). */
export const tierAtLeast = (key, min) => TIER_KEYS.indexOf(key) >= TIER_KEYS.indexOf(min);

/** The device pixel ratio a tier draws at (× scale: the battery saver, the governor). */
export function pixelRatioFor(key, scale = 1) {
  return Math.min((globalThis.window?.devicePixelRatio) || 1, tierOf(key).pixelRatio) * scale;
}

/**
 * A renderer for a world, prepended to its container as the world canvas.
 * opts: { container, quality, antialias?, reversedDepth?, logDepth? }
 */
export function createRenderer({ container, quality = 'balanced', antialias, reversedDepth = false, logDepth = false }) {
  const tier = tierOf(quality);
  const renderer = new THREE.WebGLRenderer({
    antialias: antialias ?? tier.antialias, powerPreference: 'high-performance',
    ...(reversedDepth ? { reversedDepthBuffer: true } : {}), ...(logDepth ? { logarithmicDepthBuffer: true } : {}),
  });
  renderer.setPixelRatio(pixelRatioFor(quality));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  if (container) { container.prepend(renderer.domElement); renderer.domElement.className = 'world-canvas'; }
  return renderer;
}

/** The GPU was reset: fn(event) (the browser restores the context; the caller rebuilds its world). */
export function watchDeviceLoss(renderer, fn) {
  const el = renderer.domElement, h = (e) => { e.preventDefault?.(); fn(e); };
  el.addEventListener('webglcontextlost', h);
  return () => el.removeEventListener('webglcontextlost', h);
}

/**
 * [review 27 Nov] A directional light's shadow box centred near `target`, moved only in whole texels of its map
 * (2·span / mapSize m) across the light's view, so the shadow edges don't crawl as the box follows the rider. The
 * axes are the shadow camera's own (three's lookAt from the sun with +Y up: right = Y × d, up = d × right). Writes
 * the snapped centre to `out` (default: target) and returns it. As world.js _placeShadows.
 */
const _sr = new THREE.Vector3(), _su = new THREE.Vector3();
export function snapShadowBox(target, sunDir, span, mapSize, out = target) {
  const right = _sr.set(0, 1, 0).cross(sunDir);
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  right.normalize();
  const up = _su.copy(sunDir).cross(right).normalize(), texel = (2 * span) / mapSize;
  const a = Math.round(target.dot(right) / texel) * texel, b = Math.round(target.dot(up) / texel) * texel, c = target.dot(sunDir);
  return out.copy(right).multiplyScalar(a).addScaledVector(up, b).addScaledVector(sunDir, c);
}

/** Every texture a material holds (its maps, and textures in its uniforms). */
function texturesOf(m) {
  const out = [];
  for (const v of Object.values(m)) if (v?.isTexture) out.push(v);
  for (const u of Object.values(m.uniforms || {})) if (u?.value?.isTexture) out.push(u.value);
  return out;
}

/**
 * [review 27 Nov] A world's last step (graph maps, route scenes, Endless), after its own parts' dispose(): whatever is
 * still in the scene — geometry, materials and their textures — then the figures' shared geometry caches (cars,
 * vehicles, animals, the rider's model: built for this renderer, cleared so the next world builds its own), then the
 * renderer and its WebGL context (forceContextLoss: the browser frees the GPU memory now, not at some later GC —
 * a phone that rides two maps in a row ran out of it), and its canvas.
 */
export function teardownWorld(renderer, scene) {
  scene?.traverse((o) => {
    o.geometry?.dispose?.();
    if (o.material) for (const m of [].concat(o.material)) { for (const t of texturesOf(m)) t.dispose(); m.dispose?.(); }
    o.skeleton?.dispose?.();
  });
  if (scene) { scene.environment = null; if (scene.background?.isTexture) scene.background.dispose(); }
  for (const f of [disposeCarGeometries, disposeVehicleGeometries, disposeAnimalGeometries, disposeRiderAssets]) { try { f(); } catch { /* (a cache never built) */ } }
  if (!renderer) return;
  renderer.dispose();
  try { renderer.forceContextLoss(); } catch { /* (already lost) */ }
  renderer.domElement?.remove();
}

/** Automation (headless snapshots, QC): no adaptive changes, so frames are comparable run to run. */
const AUTOMATED = (() => { try { return !!globalThis.navigator?.webdriver; } catch { return false; } })();

/**
 * Adaptive quality. Feed it each frame's time and it walks one ladder, a few seconds between moves:
 *   level 0  full resolution
 *   1..3     render scale 0.9, 0.8, 0.7
 *   4        + a nearer horizon (fewer tiles, less vegetation: onLevel)
 *   5        + a shorter shadow reach
 * Two kinds of sample:
 *   work time (the GPU timer's ms per frame): down past 85 % of the budget, up below 60 %
 *   frame interval (no timer: vsync quantises it, so it reads ~the budget when all is well): down when frames are
 *   missed (the average past 120 % of the budget), up again after 15 s of steady frames
 * The budget is the tier's frame time, or the frame-rate cap's (setTarget: the battery saver's 30 fps).
 */
export class QualityGovernor {
  constructor({ quality = 'balanced', onScale = () => {}, onLevel = () => {}, enabled = !AUTOMATED } = {}) {
    this.tierMs = tierOf(quality).frameMs; this.capMs = 0; this.onScale = onScale; this.onLevel = onLevel; this.enabled = enabled;
    this.level = 0; this.avg = 0; this.since = 0; this.frames = 0;
  }
  get budget() { return Math.max(this.tierMs, this.capMs); }
  get scale() { return [1, .9, .8, .7, .7, .7][this.level]; }
  setQuality(quality) { this.tierMs = tierOf(quality).frameMs; }
  /** A frame-rate cap (fps; 0: none): the interval the frames are meant to take. */
  setTarget(fps) { this.capMs = fps > 0 ? 1000 / fps : 0; }
  /** ms: this frame's time; dt: seconds since the last call; interval: ms is the frame interval, not work time. */
  sample(ms, dt, interval = false) {
    if (!this.enabled || !(ms > 0) || ms > 500) return;   // (a stall — a tab switch, a load — says nothing)
    this.frames++; this.since += dt;
    this.avg = this.frames < 10 ? ms : this.avg * .95 + ms * .05;
    if (this.since < 3) return;
    const b = this.budget;
    let next = this.level;
    if (interval) {
      if (this.avg > b * 1.2 && this.level < 5) next++;
      else if (this.avg < b * 1.08 && this.level > 0 && this.since > 15) next--;
    } else if (this.avg > b * .85 && this.level < 5) next++;
    else if (this.avg < b * .6 && this.level > 0) next--;
    if (next === this.level) return;
    const scaled = this.scale; this.level = next; this.since = 0;
    if (this.scale !== scaled) this.onScale(this.scale);
    this.onLevel(this.level);
  }
}

/** GPU ms per named pass where the timer query extension exists (desktop Chrome); otherwise nothing is recorded. */
export class GpuTimer {
  constructor(renderer) {
    const gl = renderer.getContext?.();
    this.gl = gl; this.ext = gl?.getExtension?.('EXT_disjoint_timer_query_webgl2') || null;
    this.pending = []; this.ms = {}; this.open = null;
  }
  get available() { return !!this.ext; }
  begin(name) {
    if (!this.ext || this.open) return;
    const q = this.gl.createQuery(); this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q); this.open = { name, q };
  }
  end() {
    if (!this.open) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT); this.pending.push(this.open); this.open = null;
  }
  /** Collect finished queries (call once a frame); smoothed ms per pass in this.ms. */
  poll() {
    if (!this.ext) return this.ms;
    const gl = this.gl, disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    this.pending = this.pending.filter(({ name, q }) => {
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return true;
      if (!disjoint) { const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; this.ms[name] = this.ms[name] == null ? ms : this.ms[name] * .9 + ms * .1; }
      gl.deleteQuery(q); return false;
    });
    return this.ms;
  }
}
