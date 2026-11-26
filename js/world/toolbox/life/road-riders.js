// Other riders on the road (gap 15 of the Zwift Ultra report, user 26 Nov: "Zwift always has company on the road"):
// a handful of cyclists in kits of other colours riding the rider's own way at their own pace, some ahead to catch,
// some behind that come past. Each is the full rider model (rider.js: pedalling, posture on the climbs), placed on the
// path in its own lane; one that drifts out of range is moved back into play out of sight (ahead past the haze, or
// behind the camera), so the road never empties and nobody pops in on screen.
//
//   const R = new RoadRiders(world, { count })   world: { scene, path, index, log?, disposed? }
//   R.tick(dt, p, speed)     p: the rider's path metre, speed (m/s)
//   R.dispose()
import * as THREE from '../../../../vendor/three.js';
import { loadRider } from '../../rider.js';

// kit colours: the atlas's orange turned by these hues (blue, green, red, purple, teal, yellow) and lightness
const KITS = [[205, 1], [115, .9], [-28, .95], [255, 1], [160, .95], [30, 1.1], [190, .7], [300, .9]];
const LANES = [.07, .37];   // (either side of the rider's own line, .22)

export class RoadRiders {
  constructor(world, { count = 6, seed = 7 } = {}) {
    this.world = world; this.count = count; this.riders = []; this.disposed = false;
    let s = seed;
    this.rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < count; i++) {
      const [hue, light] = KITS[i % KITS.length];
      const r = { model: null, p: null, lane: LANES[i % LANES.length], base: 7.2 + this.rand() * 3.6, speed: 0, crank: this.rand() * 6, cadence: 82 + this.rand() * 14,
        pose: { pos: new THREE.Vector3(), fwd: new THREE.Vector3() } };
      this.riders.push(r);
      loadRider({ kitHue: hue, kitLight: light }).then((m) => {
        if (this.disposed) return;
        m.group.name = `Road rider ${i + 1}`; m.group.visible = false; r.model = m; world.scene.add(m.group);
      }).catch((err) => world.log?.('3d', `Road rider model: ${err.message}`, 'debug'));
    }
  }

  /** Put a rider back in play: ahead past ~220 m, or behind out of the camera's view (it then comes past). */
  _place(r, p, ahead) {
    const d = ahead ? 160 + this.rand() * 260 : -(40 + this.rand() * 120);
    r.p = Math.max(0, p + d);
    r.speed = r.base;
  }

  tick(dt, p, speed) {
    const W = this.world;
    if (!W.path || p == null) return;
    const step = Math.min(dt, .1);
    this.riders.forEach((r, i) => {
      if (!r.model) return;
      if (r.p == null) { r.p = Math.max(0, p + (i % 3 !== 2 ? 22 + i * 30 : -(30 + i * 8))); r.speed = r.base; }   // (two in three start ahead, spread along the road)
      // out of range: ahead of a slower rider by 600 m, or dropped 300 m behind → back into play
      const gap = r.p - p;
      if (gap > 600 || gap < -300) this._place(r, p, gap < 0 || speed > r.base);
      // pace: their own speed, slower up a grade and quicker down (from the path's slope where they are)
      const pose = W.path.pose(r.p, W.index, r.lane);
      const slope = Math.max(-.12, Math.min(.12, pose.fwd.y || 0));
      const target = r.base * (1 - slope * 5.5);
      r.speed += (target - r.speed) * Math.min(1, step * .6);
      // keep a wheel's length off the rider in the same lane (no riding through them): ease off behind them
      if (Math.abs(r.lane - .22) < .1 && gap > -3 && gap < 2.5) r.speed = Math.min(r.speed, speed);
      r.p += r.speed * step;
      r.pose.pos.set(pose.pos.x, pose.pos.y, pose.pos.z); r.pose.fwd.set(pose.fwd.x, pose.fwd.y, pose.fwd.z);
      r.crank += (r.cadence / 60) * Math.PI * 2 * step * Math.min(1, r.speed / 6);
      r.model.group.visible = Math.abs(gap) < 700;
      r.model.update(r.pose.pos, r.pose.fwd, r.crank, r.speed, step, { grade: slope * 100, power: 180 + slope * 1200, ftp: 250, cadence: r.cadence });
    });
  }

  dispose() {
    this.disposed = true;
    for (const r of this.riders) if (r.model) this.world.scene.remove(r.model.group);
    this.riders = [];
  }
}
