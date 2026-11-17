// Villages, lakeside camps, docks and boats, utility poles with wires, mailboxes and guardrails.
// Planned once per route from the real shoreline (no per-tile work), then drawn as instanced meshes.
import * as THREE from '../../../../vendor/three.module.min.js';
import { randomSequence } from '../core/random.js';
import { roadFrame } from '../roadside/details.js';
import { makeClearings } from '../vegetation/forest.js';

const VILLAGE = ['house0', 'house1', 'house2', 'house3', 'house4', 'house5'];

/** Pure planning (no three.js objects besides vectors) so QC/tests can check it. */
export function planSettlement(config, route, index, landscape) {
  const rand = randomSequence((config.seed || 1) * 13 + 5);
  const end = route.turnS || route.total;
  const items = [], clearings = [], boats = [], poles = [], rails = [], mailboxes = [];
  const shoreAt = landscape.shoreAt || (() => Infinity);
  const roadNear = (x, z, r) => index.nearest(x, z, r);
  const footprintOk = (x, z, r, minShore = 6) => {
    if (shoreAt(x, z) < minShore + r * .5 || landscape.bridgeAt(x, z, 20)) return false;
    const road = roadNear(x, z, 40);
    if (road && road.d < 9 + r * .5) return false;
    for (const it of items) if (Math.hypot(it.x - x, it.z - z) < it.r + r + 2) return false;
    const hs = [[r, 0], [-r, 0], [0, r], [0, -r]].map(([dx, dz]) => landscape.heightAt(x + dx, z + dz));
    return Math.max(...hs) - Math.min(...hs) < 2.6;
  };
  const place = (asset, x, z, faceX, faceZ, r, extra = {}) => {
    const hs = [[0, 0], [r * .6, 0], [-r * .6, 0], [0, r * .6], [0, -r * .6]].map(([dx, dz]) => landscape.heightAt(x + dx, z + dz));
    const y = Math.min(...hs) - .15;
    items.push({ asset, x, y, z, rot: Math.atan2(faceX, faceZ), r, ...extra });
    clearings.push({ x, z, r: r + (extra.lawn ?? 7) });
  };

  // Villages: both sides of the road, facing it, with a store, church and motel near the centre
  for (const town of config.towns || []) {
    const centre = (town.fromM + town.toM) / 2;
    const specials = ['store0', 'church0', 'motel0'].filter((a) => !(town.skip || []).includes(a));
    for (const side of [1, -1]) {
      for (let s = town.fromM + rand() * 10; s < Math.min(end, town.toM); s += (town.spacingM?.[0] ?? 16) + rand() * ((town.spacingM?.[1] ?? 30) - (town.spacingM?.[0] ?? 16))) {
        const special = Math.abs(s - centre) < 160 && specials.length && rand() < .5 ? specials.shift() : null;
        const r = special === 'motel0' ? 14 : special ? 9 : 6.5;
        const setback = (town.setbackM?.[0] ?? 13) + rand() * ((town.setbackM?.[1] ?? 22) - (town.setbackM?.[0] ?? 13)) + (special ? 4 : 0);
        const { position: p, right } = roadFrame(route, index, s, side * setback);
        if (!footprintOk(p.x, p.z, r, 4)) continue;
        place(special || VILLAGE[Math.floor(rand() * VILLAGE.length)], p.x, p.z, -right.x * side, -right.z * side, r, { lawn: 9 });
        if (rand() < .6) {
          const m = roadFrame(route, index, s + 4, side * 5.4).position;
          mailboxes.push({ x: m.x, y: landscape.heightAt(m.x, m.z), z: m.z, rot: Math.atan2(right.x * side, right.z * side) });
        }
      }
    }
  }

  // Lakeside camps: wherever a shore lies within reach of the road, a driveway leads to a cabin by the water
  const campRanges = config.camps || [];
  const inCampRange = (s) => campRanges.length === 0 || campRanges.some((c) => s >= c.fromM && s <= c.toM);
  const inTown = (s) => (config.towns || []).some((t) => s > t.fromM - 40 && s < t.toM + 40);
  let lastCamp = -Infinity;
  for (let s = 60; s < end - 60; s += 10) {
    if (!inCampRange(s) || inTown(s) || s - lastCamp < 55 + rand() * 90) continue;
    if ((config.lookouts || []).some((l) => Math.abs(l.atM - s) < 70)) continue;
    for (const side of rand() < .5 ? [1, -1] : [-1, 1]) {
      // walk out from the road toward the water
      let hit = null;
      for (let lat = 20; lat <= 190; lat += 6) {
        const { position: p } = roadFrame(route, index, s, side * lat);
        const sh = shoreAt(p.x, p.z);
        if (sh < 26) { hit = { lat, p }; break; }
      }
      if (!hit || hit.lat < 30) continue;
      const cabinLat = hit.lat - 14;
      const { position: c, right } = roadFrame(route, index, s, side * cabinLat);
      if (!footprintOk(c.x, c.z, 5.5, 8)) continue;
      // shore normal from the distance field
      const e = 6, gx = shoreAt(c.x + e, c.z) - shoreAt(c.x - e, c.z), gz = shoreAt(c.x, c.z + e) - shoreAt(c.x, c.z - e);
      const gl = Math.hypot(gx, gz) || 1, wx = -gx / gl, wz = -gz / gl;   // toward the water
      place(`camp${Math.floor(rand() * 3)}`, c.x, c.z, wx, wz, 5.5, { lawn: 8 });
      // driveway back to the road and a mailbox at the end
      const r0 = roadFrame(route, index, s, side * 6).position;
      const dx = c.x - r0.x, dz = c.z - r0.z, len = Math.hypot(dx, dz);
      clearings.push({ x: r0.x, z: r0.z, dx: dx / len, dz: dz / len, len, r: 3.2 });
      const m = roadFrame(route, index, s + 3.5, side * 5.4).position;
      mailboxes.push({ x: m.x, y: landscape.heightAt(m.x, m.z), z: m.z, rot: Math.atan2(-right.x * side, -right.z * side) });
      // dock (and sometimes a boathouse) out from the shore, a canoe pulled up beside it
      let sx = c.x, sz = c.z;
      for (let k = 0; k < 40 && shoreAt(sx, sz) > .5; k++) { sx += wx * 1.5; sz += wz * 1.5; }
      const level = landscape.waterLevelAt(sx + wx * 6, sz + wz * 6);
      if (Number.isFinite(level) && shoreAt(sx + wx * 12, sz + wz * 12) < -4) {
        const boatHouse = rand() < .3;
        items.push({ asset: boatHouse ? 'boathouse0' : 'dock0', x: sx - wx * (boatHouse ? -3 : 1), y: level + (boatHouse ? .1 : 0), z: sz - wz * (boatHouse ? -3 : 1), rot: Math.atan2(wx, wz), r: 3, water: true });
        clearings.push({ x: sx, z: sz, r: 6 });
        const a = Math.atan2(wx, wz) + Math.PI / 2;
        if (rand() < .7) boats.push({ asset: `canoe${Math.floor(rand() * 3)}`, x: sx - wx * 2 + Math.sin(a) * 3, z: sz - wz * 2 + Math.cos(a) * 3, y: landscape.heightAt(sx - wx * 2 + Math.sin(a) * 3, sz - wz * 2 + Math.cos(a) * 3) + .05, rot: a + .3 });
        if (rand() < .35) boats.push({ asset: 'motorboat0', x: sx + wx * 9 + Math.sin(a) * 2.6, z: sz + wz * 9 + Math.cos(a) * 2.6, y: level, rot: Math.atan2(wx, wz) });
      }
      lastCamp = s; break;
    }
  }

  // A few boats out on the open water near the road
  const lrand = randomSequence(77);
  for (let s = 200; s < end; s += 900) {
    for (const side of [1, -1]) {
      const lat = 120 + lrand() * 380, { position: p } = roadFrame(route, index, s, side * lat);
      if (shoreAt(p.x, p.z) > -45) continue;
      const level = landscape.waterLevelAt(p.x, p.z);
      boats.push({ asset: lrand() < .55 ? 'motorboat0' : `canoe${Math.floor(lrand() * 3)}`, x: p.x, z: p.z, y: level, rot: lrand() * 6.28, drift: true });
    }
  }

  // Utility poles on one side, every ~45 m; wires sag between them
  const poleCfg = config.poles;
  if (poleCfg) {
    const side = poleCfg.side === 'right' ? 1 : -1;
    for (let s = 10; s < end; s += poleCfg.spacingM || 45) {
      const { position: p, forward } = roadFrame(route, index, s, side * (poleCfg.lateralM || 7.2));
      if (landscape.bridgeAt(p.x, p.z, 10) || shoreAt(p.x, p.z) < 2) { poles.push(null); continue; }
      poles.push({ x: p.x, y: landscape.heightAt(p.x, p.z) - .3, z: p.z, rot: Math.atan2(forward.x, forward.z) });
    }
  }

  // Guardrail where the road runs right above water or a drop
  for (let s = 0; s < end; s += 4) {
    for (const side of [1, -1]) {
      const { position: p, forward } = roadFrame(route, index, s, side * 4.7);
      if (landscape.bridgeAt(p.x, p.z, 8)) continue;
      const out = roadFrame(route, index, s, side * 14).position;
      const drop = p.y - landscape.heightAt(out.x, out.z);
      if (shoreAt(out.x, out.z) < 6 || drop > 3.2) rails.push({ x: p.x, y: p.y, z: p.z, rot: Math.atan2(forward.x, forward.z), side });
    }
  }
  return { items, boats, poles, rails, mailboxes, clearings: makeClearings(clearings) };
}

/** Draw a plan with the kit's geometries. */
export class Settlement {
  constructor(parent, plan, kit, uniforms) {
    this.group = new THREE.Group(); this.group.name = 'Villages, camps and road furniture'; parent.add(this.group);
    this.plan = plan; this.uniforms = uniforms; this.meshes = []; this.owned = [];
    const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    const lists = {};
    const put = (name, x, y, z, rot) => { q.setFromAxisAngle(up, rot); (lists[name] ||= []).push(matrix.compose(new THREE.Vector3(x, y, z), q, one).clone()); };
    for (const it of plan.items) put(it.asset, it.x, it.y, it.z, it.rot);
    for (const b of plan.boats) put(b.asset, b.x, b.y, b.z, b.rot);
    for (const m of plan.mailboxes) put('mailbox0', m.x, m.y, m.z, m.rot);
    for (const p of plan.poles) if (p) put('pole0', p.x, p.y, p.z, p.rot);
    for (const r of plan.rails) put('guardrail0', r.x, r.y - .1, r.z, r.rot + (r.side > 0 ? 0 : Math.PI) * 0);
    for (const [name, matrices] of Object.entries(lists)) {
      const asset = kit.assets[name];
      if (!asset) continue;
      const mesh = new THREE.InstancedMesh(asset.geometry, asset.material, matrices.length);
      matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
      mesh.castShadow = !/^(mailbox|guardrail)/.test(name); mesh.receiveShadow = true; mesh.name = name;
      this.meshes.push(mesh); this.group.add(mesh);
    }
    this.boats = plan.boats.filter((b) => b.drift);
    this._wires();
  }

  _wires() {
    const pts = [], poles = this.plan.poles;
    for (let i = 0; i < poles.length - 1; i++) {
      const a = poles[i], b = poles[i + 1];
      if (!a || !b || Math.hypot(a.x - b.x, a.z - b.z) > 70) continue;
      for (const off of [-1, 0, 1]) {
        const ax = a.x + Math.cos(a.rot) * off, az = a.z - Math.sin(a.rot) * off, bx = b.x + Math.cos(b.rot) * off, bz = b.z - Math.sin(b.rot) * off;
        const ay = a.y + 9.35, by = b.y + 9.35;
        for (let k = 0; k < 8; k++) {
          const t0 = k / 8, t1 = (k + 1) / 8, sag = (t) => 4 * t * (1 - t) * .9;
          pts.push(ax + (bx - ax) * t0, ay + (by - ay) * t0 - sag(t0), az + (bz - az) * t0, ax + (bx - ax) * t1, ay + (by - ay) * t1 - sag(t1), az + (bz - az) * t1);
        }
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const m = new THREE.LineBasicMaterial({ color: '#2b2b2a', transparent: true, opacity: .75 });
    this.wires = new THREE.LineSegments(g, m); this.wires.name = 'Power lines';
    this.owned.push(g, m); this.group.add(this.wires);
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.meshes.forEach((m) => m.dispose()); this.owned.forEach((o) => o.dispose());
  }
}
