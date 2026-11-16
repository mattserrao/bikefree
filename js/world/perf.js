// Performance overlay for the 3D view (I on the ride screen; ?perf=1 in the preview).
// Frame rate, frame time (median, 95th percentile, worst), draw calls and triangles summed over every
// render pass of a frame (post-processing renders more than once), against the M4 Air budget:
// under 600 draw calls and 2M triangles, 60 fps, no frame over 25 ms.
export const BUDGET = { calls: 600, triangles: 2e6, frameMs: 1000 / 60, worstMs: 25 };

export class PerfMonitor {
  constructor(renderer, container, describe = () => ({}), place = { top: '74px' }) {
    this.renderer = renderer;
    this.describe = describe;               // () => {quality, time, weather, route}
    renderer.info.autoReset = false;        // count every pass of a frame, not just the last
    this.times = new Float32Array(600);     // ~10 s of frame intervals (ms)
    this.n = 0; this.i = 0;
    this.calls = 0; this.triangles = 0;
    this.session = null;
    this.el = document.createElement('div');
    this.el.className = 'perf-overlay';
    this.el.hidden = true;
    this.el.setAttribute('aria-live', 'off');
    Object.assign(this.el.style, {
      position: 'absolute', left: '50%', transform: 'translateX(-50%)', zIndex: 30, ...place,
      font: '600 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace', color: '#e8eef6',
      background: 'rgba(12, 18, 26, .72)', padding: '7px 11px', borderRadius: '8px', pointerEvents: 'none',
      whiteSpace: 'pre', backdropFilter: 'blur(6px)',
    });
    container.appendChild(this.el);
    this._last = 0; this._shown = 0;
  }

  get visible() { return !this.el.hidden; }

  /** Show or hide; returns a one-line summary of the stretch just measured when hiding. */
  toggle(on = this.el.hidden) {
    this.el.hidden = !on;
    if (on) { this.session = { frames: 0, sumMs: 0, worst: 0, maxCalls: 0, maxTris: 0, over: 0, start: performance.now() }; this.n = 0; return null; }
    const s = this.session; this.session = null;
    if (!s || !s.frames) return null;
    const d = this.describe();
    return `${d.route || ''} · ${d.quality || ''} · ${d.time || ''}${d.weather ? ` · ${d.weather}` : ''}: ` +
      `${(1000 * s.frames / s.sumMs).toFixed(1000 * s.frames / s.sumMs < 10 ? 1 : 0)} fps avg over ${(s.sumMs / 1000).toFixed(0)} s, ` +
      `${s.over} frames over ${BUDGET.worstMs} ms (worst ${s.worst.toFixed(0)} ms), ` +
      `peak ${s.maxCalls} draw calls, ${(s.maxTris / 1e6).toFixed(2)}M triangles`;
  }

  /** Call at the start of a frame, before anything renders. */
  begin(now) {
    if (this._last) {
      const ms = now - this._last;
      if (ms < 5000) {   // slow frames are what this is for; only skip pauses (hidden tab, a stopped view)
        this.times[this.i] = ms; this.i = (this.i + 1) % this.times.length; this.n = Math.min(this.n + 1, this.times.length);
        const s = this.session;
        if (s) { s.frames++; s.sumMs += ms; s.worst = Math.max(s.worst, ms); if (ms > BUDGET.worstMs) s.over++; }
      }
    }
    this._last = now;
    this.renderer.info.reset();
  }

  /** Call after the last render pass of a frame. */
  end(now) {
    const info = this.renderer.info.render;
    this.calls = info.calls; this.triangles = info.triangles;
    const s = this.session;
    if (s) { s.maxCalls = Math.max(s.maxCalls, this.calls); s.maxTris = Math.max(s.maxTris, this.triangles); }
    if (!this.el.hidden && now - this._shown > 250) { this._shown = now; this._draw(); }
  }

  stats() {
    const list = Array.from(this.times.subarray(0, this.n)).sort((a, b) => a - b);
    const q = (p) => (list.length ? list[Math.min(list.length - 1, Math.floor(p * list.length))] : 0);
    const recent = []; for (let k = 1; k <= Math.min(this.n, 60); k++) recent.push(this.times[(this.i - k + this.times.length) % this.times.length]);
    const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
    return { fps: avg ? 1000 / avg : 0, median: q(.5), p95: q(.95), worst: list.length ? list[list.length - 1] : 0, calls: this.calls, triangles: this.triangles };
  }

  _draw() {
    const s = this.stats(), d = this.describe(), r = this.renderer;
    const mark = (v, limit) => (v > limit * 1.5 ? '✖' : v > limit ? '▲' : ' ');
    const size = { x: r.domElement.width, y: r.domElement.height };   // drawing-buffer pixels
    this.el.textContent =
      `${s.fps.toFixed(s.fps < 10 ? 1 : 0).padStart(3)} fps   frame ${s.median.toFixed(1)} ms · p95 ${s.p95.toFixed(1)}${mark(s.p95, BUDGET.frameMs)} · worst ${s.worst.toFixed(0)}${mark(s.worst, BUDGET.worstMs)} ms (10 s)\n` +
      `${String(s.calls).padStart(4)} draw calls${mark(s.calls, BUDGET.calls)}  ${(s.triangles / 1e6).toFixed(2)}M triangles${mark(s.triangles, BUDGET.triangles)}  ` +
      `${size ? `${size.x}×${size.y} @${r.getPixelRatio().toFixed(1)}x` : ''}\n` +
      `${[d.quality, d.time, d.weather, d.camera].filter(Boolean).join(' · ')}${this.session ? '   ● recording' : ''}`;
    this.el.style.color = s.p95 > BUDGET.frameMs * 1.5 || s.calls > BUDGET.calls * 1.5 ? '#ffb3a8' : s.p95 > BUDGET.frameMs || s.calls > BUDGET.calls ? '#ffe0a0' : '#e8eef6';
  }

  dispose() { this.el.remove(); this.renderer.info.autoReset = true; }
}
