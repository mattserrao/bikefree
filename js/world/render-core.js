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
import * as THREE from '../../vendor/three.js';

/** The tier table. pixelRatio caps the device's; samples: MSAA of the offscreen targets; shadowMap: live map px. */
export const TIERS = {
  low: { label: 'Phone', pixelRatio: 1, antialias: false, samples: 0, shadows: false, shadowMap: 1024, frameMs: 1000 / 30 },
  balanced: { label: 'Balanced', pixelRatio: 1.5, antialias: true, samples: 4, shadows: true, shadowMap: 1024, frameMs: 1000 / 60 },
  high: { label: 'High', pixelRatio: 2, antialias: true, samples: 4, shadows: true, shadowMap: 2048, frameMs: 1000 / 60 },
  ultra: { label: 'Ultra', pixelRatio: 2, antialias: true, samples: 4, shadows: true, shadowMap: 2048, frameMs: 1000 / 60 },
};
export const TIER_KEYS = Object.keys(TIERS);
export const tierOf = (key) => TIERS[key] || TIERS.balanced;

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

/** Automation (headless snapshots, QC): no adaptive changes, so frames are comparable run to run. */
const AUTOMATED = (() => { try { return !!globalThis.navigator?.webdriver; } catch { return false; } })();

/**
 * Adaptive quality. Feed it each frame's work time (ms); it holds a smoothed value against the tier's frame budget
 * (budget × 0.85 to step down, × 0.6 to step back up, a few seconds between moves) and walks one ladder:
 *   level 0  full resolution
 *   1..3     render scale 0.9, 0.8, 0.7
 *   4        + less vegetation (onLevel lets the world thin new tiles)
 *   5        + shorter shadow reach
 */
export class QualityGovernor {
  constructor({ quality = 'balanced', onScale = () => {}, onLevel = () => {}, enabled = !AUTOMATED } = {}) {
    this.budget = tierOf(quality).frameMs; this.onScale = onScale; this.onLevel = onLevel; this.enabled = enabled;
    this.level = 0; this.avg = 0; this.since = 0; this.frames = 0;
  }
  get scale() { return [1, .9, .8, .7, .7, .7][this.level]; }
  setQuality(quality) { this.budget = tierOf(quality).frameMs; }
  /** ms: this frame's time (render work, or the frame interval); dt: seconds since the last call. */
  sample(ms, dt) {
    if (!this.enabled || !(ms > 0)) return;
    this.frames++; this.since += dt;
    this.avg = this.frames < 10 ? ms : this.avg * .95 + ms * .05;
    if (this.since < 3) return;
    let next = this.level;
    if (this.avg > this.budget * .85 && this.level < 5) next++;
    else if (this.avg < this.budget * .6 && this.level > 0) next--;
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
