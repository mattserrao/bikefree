// Shader warm-up: compile the scene's shader programs before they are first drawn.
//
// A program compiles the first time a material/object combination is drawn; on a ride that's a hitch each time
// something new turns up (a new tile's houses, the first chat group, the first cow). The warmer calls
// renderer.compileAsync on the whole scene (it skips frustum culling, so things behind or far off compile too):
//   - once behind the loading screen (warmer.ready says when it's done; worlds add it as a loading step),
//   - again, quietly, whenever the scene has grown (new objects or materials streamed in), at most every `everyS`.
// three.js only builds programs it doesn't have yet, so a re-run with nothing new costs a scene traversal.
// Modular: any world with a renderer, scene and camera can use it (graph worlds do; see graph-world.js).

export class ShaderWarmer {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {{ everyS?: number, target?: () => (THREE.WebGLRenderTarget|null) }} [opt]
   */
  constructor(renderer, scene, camera, opt = {}) {
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.everyS = opt.everyS ?? 1.5;
    this.target = opt.target || (() => null);
    this.ready = false;      // the first full compile finished
    this.busy = false;
    this.runs = 0;           // compiles started (for tests and the bench)
    this._sig = -1; this._t = 0; this._started = false;
  }

  /** A cheap fingerprint of what the scene holds: visible meshes, and the distinct materials among them. */
  signature() {
    let n = 0; const mats = new Set();
    this.scene.traverseVisible((o) => {
      if (!o.material) return;
      n++;
      if (Array.isArray(o.material)) for (const m of o.material) mats.add(m.id); else mats.add(o.material.id);
    });
    return n * 4096 + mats.size;
  }

  /** Compile now (returns a promise). Safe to call while one is running: it waits for that one. */
  compile() {
    if (this.busy) return this._p;
    const R = this.renderer;
    if (!R?.compileAsync) { this.ready = true; return Promise.resolve(); }
    this.busy = true; this.runs++;
    this._sig = this.signature();
    const prev = R.getRenderTarget();
    let p;
    try { R.setRenderTarget(this.target()); p = R.compileAsync(this.scene, this.camera); }
    catch (e) { p = Promise.reject(e); }
    finally { R.setRenderTarget(prev); }
    this._p = Promise.resolve(p).catch(() => {}).then(() => { this.busy = false; this.ready = true; });
    return this._p;
  }

  /** Each frame: the first compile once `start` is true, then a re-compile when the scene has grown. */
  tick(dt, start = true) {
    if (!start) return;
    if (!this._started) { this._started = true; this.compile(); return; }
    if (this.busy) return;
    this._t += dt;
    if (this._t < this.everyS) return;
    this._t = 0;
    if (this.signature() !== this._sig) this.compile();
  }

  /** For a loading screen: 0 until the first compile has run, 1 after. */
  get progress() { return this.ready ? 1 : this._started ? 0.5 : 0; }
}
