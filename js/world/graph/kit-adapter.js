// The building kit's part of a graph city's chunk builder (js/world/graph-city.js): the homes it plans, sector by sector,
// drawn in place of the boxes; what they add outside their footprints (the trees and lamps keep off it); the house
// engine's close detail per 120 m cell, built as the camera nears it and dropped past it.
// [review 27 Nov] W14: out of GraphCity._kitAdapter as it was (self: the city — its world, host and inWater).
import * as THREE from '../../../vendor/three.js';
import { due } from '../toolbox/core/jobs.js';
import { dress } from '../toolbox/structures/buildings/kit.js';
import { Writer } from '../toolbox/structures/buildings/assemble.js';
import { buildBuilding } from '../toolbox/structures/building-engine.js';
import { makeFacadeMaterial } from '../toolbox/structures/buildings/facade-material.js';
import { canalAt } from '../toolbox/city/cny-landmarks.js';
import { gpuOnly } from './mesh.js';

const HOUSE_CLOSE_M = 160;   // the house engine's close detail (casings, rails, brackets) drawn this far
/** The landscape as a lakefront house reads it: never lower than `floor` (its footings go down into the water). */
const dryLand = (L, floor) => { const o = Object.create(L); o.heightAt = (x, z) => Math.max(L.heightAt(x, z), floor); return o; };

/** self: the GraphCity; detailReachM: how far the homes' detail meshes draw (a mesh's userData.reach overrides). */
export function makeKitAdapter(self, { detailReachM }) {
  const material = makeFacadeMaterial(self.host.uniforms), group = new THREE.Group();
  group.name = 'Buildings (building kit)'; self.host.group.add(group);
  const plans = new Map(), lists = new Map(), extents = new Map(), details = [];
  // the houses' close detail, per 120 m cell: built when the camera comes within reach, dropped past it (user, 23 Nov:
  // "even on high … should not run out of memory" — built up front it was 50–65 MB in the villages)
  const closeCells = new Map();   // cell key → { tile, houses: [R], box, mesh, pending }
  let closeJob = null;
  const addExt = (e) => { for (let i = Math.floor((e.x - e.r) / 20); i <= Math.floor((e.x + e.r) / 20); i++) for (let j = Math.floor((e.z - e.r) / 20); j <= Math.floor((e.z + e.r) / 20); j++) { const k = i * 100003 + j; let a = extents.get(k); if (!a) extents.set(k, (a = [])); a.push(e); } };
  return {
    group, material, details, plans,
    /** A sector's plan is in: its homes, and what they add outside their footprints (for the trees and lamps). */
    planned(plan) {
      // (none in the canal: a footprint OSM puts in the channel, or a house the clean shape pushed into it)
      for (const R of plan.buildings) R.inCanal = (R.rects.length ? R.rects : [{ cx: R.x, cz: R.z, ux: 1, uz: 0, vx: 0, vz: 1, hu: 1, hv: 1 }])
        .some((r) => [[0, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]].some(([a, b]) => canalAt(r.cx + r.ux * a * r.hu + r.vx * b * r.hv, r.cz + r.uz * a * r.hu + r.vz * b * r.hv, .5)));
      // (a lakefront house whose footprint runs past the drawn shore: stood on its floor above the water, not in it;
      //  one whose middle is in the lake is left out)
      if (self.world.ground) for (const R of plan.buildings) {
        if (R.inCanal) continue;
        const pts = (R.rects.length ? R.rects : [{ cx: R.x, cz: R.z, ux: 1, uz: 0, vx: 0, vz: 1, hu: 1, hv: 1 }]).flatMap((r) => [[0, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]].map(([a, b]) => [r.cx + r.ux * a * r.hu + r.vx * b * r.hv, r.cz + r.uz * a * r.hu + r.vz * b * r.hv]));
        const wet = pts.filter(([x, z]) => self.inWater(x, z)).length;
        if (!wet) continue;
        if (self.inWater(R.x, R.z) || wet > pts.length / 2) { R.inCanal = true; continue; }
        R.floorAbove = self.world.poolAt(R.x, R.z) + 0.9;
      }
      for (const R of plan.buildings) {
        plans.set(R.key, R);
        if (R.inCanal) continue;   // (taken, never drawn)
        for (const [k, r] of R.rects.entries()) {
          const front = k === 0 ? R.front : -1, porch = R.parts.frontPorch ? R.parts.frontPorch.depth + 0.3 : R.parts.porch || R.dress ? 1.2 : 0;
          const ea = R.form === 'flat' ? 0.3 : (R.form === 'hip' ? R.eave : R.rake) + 0.2, eb = R.form === 'flat' ? 0.3 : R.eave + 0.2;
          const ext = [eb + (front === 0 ? porch : 0), ea + (front === 1 ? porch : 0), eb + (front === 2 ? porch : 0), ea + (front === 3 ? porch : 0)];
          addExt({ rect: r, ext, x: r.cx, z: r.cz, r: Math.hypot(r.hu, r.hv) + Math.max(...ext) });
        }
        for (const it of R.dressing || []) addExt({ x: it.x, z: it.z, r: Math.max(...it.size.slice(0, 2)) * 0.6 + 0.2, item: true });
      }
    },
    occupied(x, z, pad = 0) {
      for (const e of extents.get(Math.floor(x / 20) * 100003 + Math.floor(z / 20)) || []) {
        if (Math.hypot(e.x - x, e.z - z) > e.r + pad) continue;
        if (e.item) return true;
        const r = e.rect, dx = x - r.cx, dz = z - r.cz, a = dx * r.ux + dz * r.uz, b = dx * r.vx + dz * r.vz;
        if (a > -r.hu - e.ext[3] - pad && a < r.hu + e.ext[1] + pad && b > -r.hv - e.ext[0] - pad && b < r.hv + e.ext[2] + pad) return true;
      }
      return false;
    },
    take(b, key) { const R = plans.get(b.k); if (!R) return false; if (!lists.has(key)) lists.set(key, []); lists.get(key).push(R); return true; },
    *chunkBuiltJob(key) {
      const list = lists.get(key); lists.delete(key);
      if (!list?.length) return;
      const w = new Writer(8192), d = new Writer(4096), L = self.host.landscape;
      // the house engine's close detail (casings, rails, brackets, gutters): one mesh per 120 m cell, drawn to ~160 m,
      // built later when the camera nears the cell (_closeJob); here a writer that's thrown away
      const scrap = new Writer(4096), closeOf = (R) => {
        const k = `${key}|${Math.floor(R.x / 120)},${Math.floor(R.z / 120)}`; let c = closeCells.get(k);
        if (!c) closeCells.set(k, (c = { tile: key, houses: [], box: new THREE.Box3(), mesh: null }));
        c.houses.push(R); c.box.expandByPoint(new THREE.Vector3(R.x, (L.heightAt?.(R.x, R.z) ?? 0), R.z)); scrap.n = 0; scrap.ni = 0; return scrap;
      };
      for (const R of list) {
        if (due()) yield;
        if (R.inCanal) continue;
        const LR = R.floorAbove ? dryLand(L, R.floorAbove) : L;
        const res = buildBuilding(R, w, d, R.house ? closeOf(R) : null, LR);   // [blocks] (closeOf only for the house engine's)
        if (R.dressing?.length) for (const it of R.dressing) dress(d, it, R, L, res);
      }
      if (w.n) { const m = gpuOnly(new THREE.Mesh(w.geometry(), material)); m.name = `Homes ${key}`; m.castShadow = m.receiveShadow = true; group.add(m); }
      if (d.n) { const dm = gpuOnly(new THREE.Mesh(d.geometry(), material)); dm.userData.bake = false; dm.name = `Home detail ${key}`; dm.receiveShadow = true; dm.geometry.computeBoundingBox(); dm.userData.box = dm.geometry.boundingBox; group.add(dm); details.push(dm); }
      for (const c of closeCells.values()) if (c.tile === key) c.box.expandByScalar(18);   // (the houses' own size round their centres)
    },
    tick(cam) {
      for (const m of details) m.visible = m.userData.box.distanceToPoint(cam) < (m.userData.reach || detailReachM);
      for (const c of closeCells.values()) {
        const d = c.box.distanceToPoint(cam);
        if (c.mesh) { c.mesh.visible = d < HOUSE_CLOSE_M; if (d > HOUSE_CLOSE_M + 140 && closeJob?.c !== c) { group.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh = null; } }
      }
    },
    /** The nearest cell within reach whose close detail isn't built, built as a job (sliced: graph-city stream). */
    *closeJob(cam) {
      let best = null, bd = HOUSE_CLOSE_M + 60;
      for (const c of closeCells.values()) if (!c.mesh) { const d = c.box.distanceToPoint(cam); if (d < bd) { bd = d; best = c; } }
      if (!best) return false;
      closeJob = { c: best };
      const W = new Writer(8192), D = new Writer(4096), C = new Writer(4096), L = self.host.landscape;
      for (const R of best.houses) {
        if (due()) yield;
        if (!closeCells.has(`${best.tile}|${Math.floor(R.x / 120)},${Math.floor(R.z / 120)}`)) { closeJob = null; return true; }   // (its tile released meanwhile)
        W.n = W.ni = 0; D.n = D.ni = 0;
        buildBuilding(R, W, D, C, R.floorAbove ? dryLand(L, R.floorAbove) : L);
      }
      if (C.n) { const cm = gpuOnly(new THREE.Mesh(C.geometry(), material)); cm.userData.bake = false; cm.name = `House close detail ${best.tile}`; cm.receiveShadow = true; cm.visible = best.box.distanceToPoint(cam) < HOUSE_CLOSE_M; group.add(cm); best.mesh = cm; }
      else best.mesh = new THREE.Object3D();   // (nothing to draw: marked done)
      closeJob = null;
      return true;
    },
    /** A tile's cells forgotten (graph-city _release). */
    releaseTile(key) { for (const [k, c] of closeCells) if (c.tile === key) { if (c.mesh) { group.remove(c.mesh); c.mesh.geometry?.dispose(); } closeCells.delete(k); } },
  };
}
