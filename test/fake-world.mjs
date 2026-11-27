// A stand-in for the 3D worlds (js/world/world.js, graph-world.js, endless-world.js) in the DOM tests
// (test/dom-app.mjs points their imports here): no WebGL, just the calls the app makes. The test drives what
// readiness() reports through `fakeWorld` (ready, degraded) and reads back what the app asked of it.
export const fakeWorld = { instances: [], ready: true, degraded: [], waitingForArea: false };

class FakeWorld {
  constructor(canvas, route, opts = {}) {
    this.canvas = canvas; this.route = route; this.opts = opts; this.path = opts.path || null;
    this.calls = []; this.running = false; this.disposed = false; this.marks = null;
    fakeWorld.instances.push(this);
  }
  get waitingForArea() { return fakeWorld.waitingForArea; }
  readiness() {
    const done = fakeWorld.ready;
    return { ready: done, progress: done ? 1 : 0.5, failed: false, degraded: fakeWorld.degraded.slice(),
      steps: [{ key: 'scenery', label: 'Scenery', done: true }, { key: 'roads', label: 'Roads', done }] };
  }
  start() { this.running = true; this.calls.push('start'); }
  stop() { this.running = false; this.calls.push('stop'); }
  dispose() { this.disposed = true; this.calls.push('dispose'); }
  setSource(fn) { this.source = fn; }
  setPacerSource(fn) { this.pacerSource = fn; }
  setCourseMarks(m) { this.marks = m; }
  setPath(p) { this.path = p; }
  setPreload() {}
  setTimeOfDay() {}
  setWeather() {}
  setCamera() {}
  setGfx() {}
  weatherOptions() { return []; }
  togglePerf() { return ''; }
}

export class World extends FakeWorld {}
export class GraphWorld extends FakeWorld {}
export class EndlessWorld extends FakeWorld {}
export function setGeometryRelease() {}
