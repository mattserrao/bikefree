// Wildlife along Going-to-the-Sun Road: mountain goats on the ledges and in the Logan Pass meadows, bighorn
// sheep on the east-side slopes, hoary marmots and Columbian ground squirrels by the road at the pass, a
// grizzly working a meadow far below the road, ducks on Lake McDonald and St. Mary Lake, ravens wheeling
// over the pass and a golden eagle soaring above the Garden Wall. Instanced; only the birds, the bear and
// the ducks move.
import * as THREE from '../../vendor/three.module.min.js';
import { MeshBuilder } from './city-geometry.js';
import { randomSequence } from './coast.js';
import { birdGeometry, birdMaterial } from './coast-life.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

function legs(M, color, w, l, h, t = .12) { M.color(color); for (const [x, z] of [[-w, -l], [w, -l], [-w, l], [w, l]]) M.box(x, 0, z, t, h, t); }

function goat() {
  // shaggy white coat, a beard, short black horns
  const M = new MeshBuilder();
  M.color('#f2efe6'); M.box(0, .55, 0, .5, .6, 1.15); M.box(0, .62, .1, .56, .38, .6);
  M.box(0, .95, .62, .26, .3, .34); M.box(0, .7, .7, .14, .25, .1);
  legs(M, '#e6e2d6', .16, .4, .58, .13);
  M.color('#151515'); for (const x of [-.07, .07]) M.box(x, 1.22, .62, .04, .2, .05);
  return M.geometry();
}
function bighorn() {
  const M = new MeshBuilder();
  M.color('#8a7258'); M.box(0, .6, 0, .48, .55, 1.15); M.box(0, .98, .62, .24, .26, .36);
  M.color('#efe8da'); M.box(0, .6, -.58, .44, .42, .08); M.box(0, .9, .82, .14, .12, .06);
  legs(M, '#6e5a45', .15, .4, .62, .1);
  // heavy curled horns
  M.color('#b9a585'); for (const x of [-1, 1]) { M.box(x * .17, 1.05, .52, .12, .14, .26); M.box(x * .24, .92, .4, .1, .16, .12); M.box(x * .22, .82, .52, .09, .1, .14); }
  return M.geometry();
}
function bear() {
  // a grizzly: shoulder hump, dished face, grizzled brown
  const M = new MeshBuilder();
  M.color('#6b4f36'); M.box(0, .55, 0, .95, .85, 1.85); M.box(0, 1.15, .35, .8, .3, .6);
  M.box(0, .85, 1.1, .5, .45, .5); M.color('#4a3726'); M.box(0, .78, 1.42, .26, .22, .2);
  M.color('#a08566'); M.box(0, 1.35, .3, .6, .08, .45);
  legs(M, '#4e3a28', .32, .62, .6, .26);
  return M.geometry();
}
function marmot() {
  // a hoary marmot sitting up on a rock
  const M = new MeshBuilder();
  M.color('#8f877b'); M.box(0, 0, 0, .3, .42, .28); M.box(0, .38, .03, .2, .16, .18);
  M.color('#2a2723'); M.box(0, .42, .12, .14, .08, .04);
  M.color('#6a5c4a'); M.box(0, 0, -.18, .1, .08, .2);
  return M.geometry();
}
function squirrel() {
  const M = new MeshBuilder();
  M.color('#a3875f'); M.box(0, 0, 0, .1, .2, .1); M.box(0, .18, .01, .08, .07, .08);
  M.color('#8a6f4e'); M.box(0, 0, -.08, .05, .04, .1);
  return M.geometry();
}
function duck() {
  const M = new MeshBuilder();
  M.color('#5a5148'); M.box(0, 0, 0, .22, .14, .42); M.color('#2b3b33'); M.box(0, .12, .17, .1, .14, .12);
  M.color('#c9b48a'); M.box(0, .14, .25, .05, .03, .08);
  return M.geometry();
}

export class GlacierLife {
  constructor(parent, landscape, route, index, uniforms, config = {}) {
    this.L = landscape; this.route = route; this.index = index; this.u = uniforms; this.cfg = config;
    this.group = new THREE.Group(); this.group.name = 'Glacier wildlife'; parent.add(this.group);
    this.rand = randomSequence(5521); this.disposables = [];
    this.material = this._own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95 }));
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(0, 0, 0, 'YXZ');
    const herds = (list, geometry, name, opts) => {
      const matrices = [];
      for (const h of list || []) matrices.push(...this._herd(h, opts));
      if (!matrices.length) return null;
      const mesh = new THREE.InstancedMesh(this._own(geometry), this.material, matrices.length);
      matrices.forEach((mm, i) => mesh.setMatrixAt(i, mm)); mesh.castShadow = mesh.receiveShadow = true;
      mesh.name = name; mesh.computeBoundingSphere(); this.group.add(mesh); return mesh;
    };
    herds(config.goats, goat(), 'Mountain goats', { maxSlope: 1.25, minRoad: 14 });
    herds(config.bighorn, bighorn(), 'Bighorn sheep', { maxSlope: .8, minRoad: 18 });
    herds(config.marmots, marmot(), 'Hoary marmots', { maxSlope: .9, minRoad: 9 });
    herds(config.squirrels, squirrel(), 'Ground squirrels', { maxSlope: .5, minRoad: 7 });
    // the bear walks slowly back and forth across its meadow
    this.bears = (config.bears || []).map((b) => this._herd({ ...b, count: 1 }, { maxSlope: .6, minRoad: b.lateralM || 150 })[0]).filter(Boolean)
      .map((m) => { const p = V().setFromMatrixPosition(m); return { x: p.x, z: p.z, a: this.rand() * 6.28, t: this.rand() * 100 }; });
    if (this.bears.length) {
      this.bearMesh = new THREE.InstancedMesh(this._own(bear()), this.material, this.bears.length);
      this.bearMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.bearMesh.castShadow = true; this.bearMesh.name = 'Grizzly'; this.bearMesh.frustumCulled = false;
      this.group.add(this.bearMesh);
    }
    // ducks paddling slowly near the shore
    this.ducks = [];
    for (const d of config.ducks || []) {
      const base = this._frame(d.atM), rand = randomSequence(Math.floor(d.atM));
      for (let k = 0, tries = 0; k < (d.count || 6) && tries < 400; tries++) {
        const x = base.x + (rand() - .5) * 600, z = base.z + (rand() - .5) * 600, shore = this.L.shoreAt?.(x, z) ?? Infinity;
        if (!(shore < -12 && shore > -90)) continue;
        this.ducks.push({ x, z, y: this.L.waterLevelAt(x, z) + .05, a: rand() * 6.28, w: (rand() - .5) * .1, r: 3 + rand() * 6 }); k++;
      }
    }
    if (this.ducks.length) {
      this.duckMesh = new THREE.InstancedMesh(this._own(duck()), this.material, this.ducks.length);
      this.duckMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.duckMesh.name = 'Ducks'; this.duckMesh.frustumCulled = false;
      this.group.add(this.duckMesh);
    }
    const birds = (kind, n, flap) => {
      const mesh = new THREE.InstancedMesh(this._own(birdGeometry(kind)), this._own(birdMaterial(uniforms, flap)), n);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; mesh.castShadow = true; mesh.name = `Birds · ${kind}`;
      this.group.add(mesh); return { mesh, agents: Array.from({ length: n }, () => ({ alive: false })) };
    };
    this.ravens = birds('raven', config.ravens ?? 4, 7);
    this.eagles = birds('eagle', config.eagles ?? 1, 2.6);
  }

  _own(x) { this.disposables.push(x); return x; }
  _frame(s) { return this.L.frameAt(Math.max(0, Math.min((this.route.turnS || this.route.total) - 1, s))); }

  /** Matrices for a group of animals around a point on the road (or beside it). */
  _herd(h, { maxSlope, minRoad }) {
    const out = [], base = this._frame(h.atM), rand = randomSequence(Math.floor(h.atM * 7) + 3);
    const side = h.side || (rand() < .5 ? 1 : -1), lat = h.lateralM || 0;
    const cx = base.x - base.fz * side * lat, cz = base.z + base.fx * side * lat;
    for (let k = 0, tries = 0; k < (h.count || 5) && tries < 800; tries++) {
      const r = Math.sqrt(rand()) * (h.radiusM || 300), a = rand() * Math.PI * 2;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, y = this.L.heightAt(x, z);
      const slope = Math.hypot(this.L.heightAt(x + 3, z) - y, this.L.heightAt(x, z + 3) - y) / 3;
      if (slope > maxSlope || this.index.nearest(x, z, minRoad) || this.L.isWater?.(x, z, y) || this.L.bridgeAt(x, z, 8)) continue;
      if (this.L.sites?.some((t) => Math.hypot(x - t.x, z - t.z) < Math.hypot(t.hw, t.hl))) continue;
      this.q.setFromAxisAngle(V(0, 1, 0), rand() * Math.PI * 2);
      const s = .9 + rand() * .25;
      out.push(this.m.compose(V(x, y - .04, z), this.q, V(s, s, s)).clone()); k++;
    }
    return out;
  }

  tick(dt, camera) {
    const cam = camera.position || camera, t = this.u.uTime.value;
    // the grizzly: a slow amble with a rolling gait, turning at the ends of its beat
    this.bears.forEach((b, i) => {
      b.t += dt;
      const along = Math.sin(b.t * .02) * 30, x = b.x + Math.cos(b.a) * along, z = b.z + Math.sin(b.a) * along;
      const dir = Math.cos(b.t * .02) >= 0 ? 1 : -1;
      this.e.set(0, Math.atan2(Math.cos(b.a) * dir, Math.sin(b.a) * dir), Math.sin(b.t * 2.4) * .03); this.q.setFromEuler(this.e);
      this.bearMesh.setMatrixAt(i, this.m.compose(V(x, this.L.heightAt(x, z) - .05 + Math.abs(Math.sin(b.t * 2.4)) * .05, z), this.q, V(1, 1, 1)));
    });
    if (this.bearMesh) this.bearMesh.instanceMatrix.needsUpdate = true;
    this.ducks.forEach((d, i) => {
      d.a += d.w * dt;
      const x = d.x + Math.cos(d.a) * d.r, z = d.z + Math.sin(d.a) * d.r;
      this.e.set(0, Math.atan2(-Math.sin(d.a) * Math.sign(d.w || 1), Math.cos(d.a) * Math.sign(d.w || 1)), 0); this.q.setFromEuler(this.e);
      this.duckMesh.setMatrixAt(i, Math.hypot(x - cam.x, z - cam.z) > 700 ? HIDE : this.m.compose(V(x, d.y + Math.sin(t * 1.3 + i) * .02, z), this.q, V(1, 1, 1)));
    });
    if (this.duckMesh) this.duckMesh.instanceMatrix.needsUpdate = true;
    // ravens circle low over the ground near you; the eagle soars high over the ridges
    const circle = ({ mesh, agents }, minR, maxR, above, speed, far) => {
      agents.forEach((a, i) => {
        if (!a.alive || Math.hypot(a.cx - cam.x, a.cz - cam.z) > far) {
          const ang = this.rand() * Math.PI * 2, d = 150 + this.rand() * (far * .5);
          const cx = cam.x + Math.cos(ang) * d, cz = cam.z + Math.sin(ang) * d;
          Object.assign(a, { alive: true, cx, cz, r: minR + this.rand() * (maxR - minR), h: this.L.heightAt(cx, cz) + above[0] + this.rand() * (above[1] - above[0]), w: speed * (.8 + this.rand() * .4) * (this.rand() < .5 ? 1 : -1), a: this.rand() * 6.28 });
        }
        a.a += a.w * dt;
        const x = a.cx + Math.cos(a.a) * a.r, z = a.cz + Math.sin(a.a) * a.r;
        this.e.set(0, Math.atan2(-Math.sin(a.a) * Math.sign(a.w), Math.cos(a.a) * Math.sign(a.w)), -Math.sign(a.w) * .3); this.q.setFromEuler(this.e);
        mesh.setMatrixAt(i, this.m.compose(V(x, Math.max(a.h, this.L.heightAt(x, z) + 25) + Math.sin(t * .7 + i) * 2, z), this.q, V(1, 1, 1)));
      });
      mesh.instanceMatrix.needsUpdate = true;
    };
    circle(this.ravens, 25, 70, [35, 90], .3, 900);
    circle(this.eagles, 120, 220, [180, 320], .09, 2600);
  }

  setNight(v) { this.group.visible = v < .5; }

  dispose() {
    this.group.removeFromParent();
    this.group.children.forEach((m) => m.isInstancedMesh && m.dispose());
    this.disposables.forEach((d) => d.dispose());
  }
}
