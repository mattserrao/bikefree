// World sound: a tiny Web Audio mixer for ambience in the 3D world (the subway first: trains arriving and leaving,
// the escalators' hum, the station chime). Everything is synthesised (no audio files), quiet by default, and off
// with Settings → "World sounds". No dependencies (the app imports it to apply the setting; kits use it to play).
//
//   import { worldSound } from '…/core/sound.js';
//   const hum = worldSound.loop('hum', (ctx, out) => …);   // a looping voice: its build connects to `out`
//   hum.set(.4);                                           // its level now (eased)
//   worldSound.play('chime', .5);                          // a one-shot by name (SHOTS below)
//   worldSound.touch();                                    // each frame something plays: without it for 0.5 s the
//                                                          // mixer fades out and the context suspends (ride paused,
//                                                          // tab hidden, area unloaded)
// The context is made on the first use and resumed on the first tap or key (browsers' autoplay rules).

const FADE = .12;   // seconds: level changes ease over this

class WorldSound {
  constructor() {
    this.enabled = true;
    this.volume = .35;       // master level (quiet: the app has no other audio)
    this.ctx = null; this.master = null; this.loops = new Map();
    this._last = 0; this._awake = false; this._timer = null;
  }

  /** Settings → World sounds. */
  setEnabled(on) {
    this.enabled = !!on;
    if (this.master) this.master.gain.setTargetAtTime(this.enabled && this._awake ? this.volume : 0, this.ctx.currentTime, FADE);
    if (!this.enabled && this.ctx?.state === 'running') this.ctx.suspend().catch(() => {});
  }
  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); this.setEnabled(this.enabled); }

  /** The audio context (made on first use), or null where there's no Web Audio or sound is off. */
  get context() {
    if (!this.enabled) return null;
    if (this.ctx) return this.ctx;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    try { this.ctx = new AC(); } catch { return null; }
    this.master = this.ctx.createGain(); this.master.gain.value = 0; this.master.connect(this.ctx.destination);
    const wake = () => { if (this.enabled && this._awake) this.ctx.resume().catch(() => {}); };
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) globalThis.addEventListener?.(ev, wake, { passive: true });
    this._timer = setInterval(() => this._watch(), 250);
    return this.ctx;
  }

  /** Something is playing this frame: keep the mixer awake. */
  touch() {
    const ctx = this.context; if (!ctx) return false;
    this._last = performance.now();
    if (!this._awake) { this._awake = true; this.master.gain.setTargetAtTime(this.volume, ctx.currentTime, .3); if (ctx.state !== 'running') ctx.resume().catch(() => {}); }
    return true;
  }
  _watch() {
    if (!this._awake || performance.now() - this._last < 500) return;
    this._awake = false;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, .15);
    setTimeout(() => { if (!this._awake && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }, 900);
  }

  /** A looping voice by name (made once by build(ctx, out)); returns { set(level) }. */
  loop(name, build) {
    if (this.loops.has(name)) return this.loops.get(name);
    const ctx = this.context;
    if (!ctx) return { set() {}, stop() {} };
    const out = ctx.createGain(); out.gain.value = 0; out.connect(this.master);
    const stops = build(ctx, out) || [];
    const v = { level: 0, set: (level) => { level = Math.max(0, level); if (Math.abs(level - v.level) < .004) return; v.level = level; out.gain.setTargetAtTime(level, ctx.currentTime, FADE); },
      stop: () => { out.gain.setTargetAtTime(0, ctx.currentTime, .1); setTimeout(() => { for (const s of stops) try { s.stop(); } catch { /* */ } out.disconnect(); }, 500); this.loops.delete(name); } };
    this.loops.set(name, v);
    return v;
  }

  /** A one-shot from SHOTS at a level (0–1). */
  play(name, level = 1) {
    const ctx = this.context; if (!ctx || !this._awake || level < .01) return;
    SHOTS[name]?.(ctx, this.master, Math.min(1, level));
  }

  /** A buffer of noise (white, or brown: smoother, lower), seconds long, shared by name. */
  noise(kind = 'white', seconds = 2) {
    const ctx = this.ctx, key = `${kind}${seconds}`;
    (this._noise ||= new Map());
    if (this._noise.has(key)) return this._noise.get(key);
    const n = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0, seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
    for (let i = 0; i < n; i++) { const w = rnd(); if (kind === 'brown') { last = (last + .02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
    this._noise.set(key, buf);
    return buf;
  }
}

/** Looping sources: noise through a filter, a held tone. Each returns the source (to stop it). */
export function noiseLoop(ctx, out, { kind = 'brown', type = 'lowpass', freq = 200, q = .7, gain = 1 } = {}) {
  const src = ctx.createBufferSource(); src.buffer = worldSound.noise(kind, 3); src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.value = gain;
  src.connect(f).connect(g).connect(out); src.start();
  return Object.assign(src, { filter: f });
}
export function toneLoop(ctx, out, freq, gain = .2, type = 'sine') {
  const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
  const g = ctx.createGain(); g.gain.value = gain; o.connect(g).connect(out); o.start();
  return o;
}

/** A tone with a quick attack and a bell-like decay. */
function bell(ctx, out, freq, at, level, dur = 1.2) {
  for (const [mul, k] of [[1, 1], [2.01, .35], [3.02, .12]]) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq * mul;
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(level * k, at + .012); g.gain.exponentialRampToValueAtTime(.0005, at + dur);
    o.connect(g).connect(out); o.start(at); o.stop(at + dur + .05);
  }
}
const SHOTS = {
  /** The station chime before an announcement: three rising notes. */
  chime(ctx, out, level) { const t = ctx.currentTime + .02; [523.25, 659.25, 783.99].forEach((f, k) => bell(ctx, out, f, t + k * .32, .22 * level, 1.4)); },
  /** Doors closing: two quick falling tones. */
  doors(ctx, out, level) { const t = ctx.currentTime + .02; bell(ctx, out, 987.77, t, .16 * level, .5); bell(ctx, out, 783.99, t + .22, .16 * level, .7); },
  /** Brakes as a train stops: a squeal sliding down, under a hiss. */
  brakes(ctx, out, level) {
    const t = ctx.currentTime + .02, src = ctx.createBufferSource(); src.buffer = worldSound.noise('white', 2);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 18; f.frequency.setValueAtTime(3400, t); f.frequency.exponentialRampToValueAtTime(1900, t + 1.6);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.18 * level, t + .25); g.gain.linearRampToValueAtTime(0, t + 1.8);
    src.connect(f).connect(g).connect(out); src.start(t); src.stop(t + 2);
    const h = ctx.createBufferSource(); h.buffer = worldSound.noise('white', 2);
    const hf = ctx.createBiquadFilter(); hf.type = 'highpass'; hf.frequency.value = 2500;
    const hg = ctx.createGain(); hg.gain.setValueAtTime(0, t + 1.5); hg.gain.linearRampToValueAtTime(.05 * level, t + 1.6); hg.gain.exponentialRampToValueAtTime(.0005, t + 2.4);
    h.connect(hf).connect(hg).connect(out); h.start(t + 1.5); h.stop(t + 2.5);
  },
  /** Traction motors winding up as a train pulls away. */
  depart(ctx, out, level) {
    const t = ctx.currentTime + .02;
    for (const [f0, f1, k] of [[220, 760, 1], [330, 1140, .4]]) {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + 6);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.035 * k * level, t + 1); g.gain.linearRampToValueAtTime(.025 * k * level, t + 5); g.gain.linearRampToValueAtTime(0, t + 7);
      o.connect(lp).connect(g).connect(out); o.start(t); o.stop(t + 7.1);
    }
  },
};

export const worldSound = new WorldSound();
