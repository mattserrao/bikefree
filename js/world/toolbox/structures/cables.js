// Cables on the map: ski lifts and power lines from OpenStreetMap ("places.lifts", "places.power",
// tools/build_places.py). Lifts get steel pylons along their mapped line, a station at each end, the haul rope and,
// on chair lifts and gondolas, chairs or cabins hanging from it; drag lifts get short poles. Power lines get wooden
// poles (minor lines) or lattice towers (high voltage) with sagging wires. Everything is merged: one draw for the
// steel and stations, one for the wires, per kind. Portable: any route with a places file and "cables": {…}.
//
//   "cables": { "lifts": true, "power": true, "reachM": 7000 }
import * as THREE from '../../../../vendor/three.js';
import { Builder, M, cyl, box, cone } from '../core/model-builder.js';

const SPAN = { chair_lift: 110, gondola: 160, cable_car: 400, mixed_lift: 130, drag_lift: 80, t_bar: 80, j_bar: 80, platter: 70, rope_tow: 50, magic_carpet: 1e9 };
const TALL = { chair_lift: 11, gondola: 15, cable_car: 30, mixed_lift: 12, drag_lift: 6, t_bar: 6, j_bar: 6, platter: 5, rope_tow: 3 };

export class Cables {
  constructor(parent, places, landscape, proj, index, config = {}) {
    this.group = new THREE.Group(); this.group.name = 'Lifts and power lines'; parent.add(this.group);
    this.reach = config.reachM ?? 7000;
    const L = landscape, local = (p) => proj.toLocal(p[0], p[1]);
    const steel = new Builder(), wires = [], meshes = [];
    const along = (pts, step, fn) => {
      // walk a polyline, calling fn at every `step` metres and at both ends
      const P = pts.map(local);
      let acc = 0;
      fn(P[0], P[1], 0, true);
      for (let i = 0; i < P.length - 1; i++) {
        const a = P[i], b = P[i + 1], len = Math.hypot(b.x - a.x, b.z - a.z);
        while (acc + step < len) { acc += step; const t = acc / len; fn({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, b, 0, false); }
        acc -= len;
      }
      const n = P.length;
      fn(P[n - 1], P[n - 2], 0, true, true);
      return P;
    };
    if (config.lifts !== false) {
      for (const lift of places.lifts || []) {
        if (lift.kind === 'magic_carpet') continue;
        const tall = TALL[lift.kind] ?? 10, span = SPAN[lift.kind] ?? 110;
        const tops = [];
        along(lift.pts, span, (p, toward, _, end, last) => {
          const y = L.heightAt(p.x, p.z), dir = Math.atan2(toward.x - p.x, toward.z - p.z) + (last ? Math.PI : 0);
          if (end && tall > 4) {
            // a station: a low shed with the bullwheel under a roof
            steel.add(box(7, 4.5, 9), M(p.x, y - .3, p.z, 1, 1, 1, dir), '#d6d1c6');
            steel.add(box(8, .6, 10.5), M(p.x, y + 4.2, p.z, 1, 1, 1, dir), '#3d4a57');
            tops.push({ x: p.x, y: y + 4, z: p.z });
          } else {
            steel.add(cyl(.25, .35, tall, 6), M(p.x, y, p.z), '#8d9399');
            steel.add(box(4.2, .35, .35), M(p.x, y + tall, p.z, 1, 1, 1, dir + Math.PI / 2), '#6f757b');
            tops.push({ x: p.x, y: y + tall, z: p.z });
          }
        });
        // the haul rope (two strands) and what hangs from it
        for (let i = 0; i < tops.length - 1; i++) {
          const a = tops[i], b = tops[i + 1];
          const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1, nx = -dz / len * 1.9, nz = dx / len * 1.9;
          for (const sd of [-1, 1]) wires.push(a.x + nx * sd, a.y, a.z + nz * sd, b.x + nx * sd, b.y, b.z + nz * sd);
          if (/chair|gondola|mixed/.test(lift.kind)) {
            for (let t = .15; t < 1; t += 24 / len) {
              const sd = (Math.floor(t * len / 24) % 2) ? 1 : -1, x = a.x + dx * t + nx * sd, z = a.z + dz * t + nz * sd, y = a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * len * .015;
              const dir = Math.atan2(dx, dz);
              steel.add(cyl(.03, .03, 2.2, 3), M(x, y - 2.2, z), '#55595e');
              if (lift.kind === 'gondola') steel.add(box(1.8, 1.9, 1.6), M(x, y - 4.1, z, 1, 1, 1, dir), '#c0392b');
              else steel.add(box(2.4, .5, .7), M(x, y - 2.7, z, 1, 1, 1, dir), '#2e3d4f');
            }
          }
        }
      }
    }
    if (config.power !== false) {
      for (const line of places.power || []) {
        const high = line.kind === 'line', span = high ? 280 : 55, tall = high ? 24 : 8.5;
        const tops = [];
        along(line.pts, span, (p, toward) => {
          const y = L.heightAt(p.x, p.z), dir = Math.atan2(toward.x - p.x, toward.z - p.z);
          if (index.nearest(p.x, p.z, 4.5)) return;   // never in the road
          if (high) {
            // a lattice tower: a tapering four-legged mast with two cross-arms
            for (const [ox, oz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) steel.add(cyl(.12, .16, tall, 3), M(p.x + ox * 1.2, y, p.z + oz * 1.2, 1, 1, 1, 0, oz * .05, -ox * .05), '#8b9096');
            steel.add(box(9, .4, .5), M(p.x, y + tall * .78, p.z, 1, 1, 1, dir + Math.PI / 2), '#8b9096');
            steel.add(box(6, .4, .5), M(p.x, y + tall * .92, p.z, 1, 1, 1, dir + Math.PI / 2), '#8b9096');
            steel.add(cone(.8, 3, 4), M(p.x, y + tall, p.z), '#8b9096');
          } else {
            steel.add(cyl(.12, .16, tall, 5), M(p.x, y, p.z), '#6e5a44');
            steel.add(box(1.6, .12, .12), M(p.x, y + tall - .4, p.z, 1, 1, 1, dir + Math.PI / 2), '#5e4c3a');
          }
          tops.push({ x: p.x, y: y + tall - (high ? tall * .2 : .45), z: p.z, dir });
        });
        for (let i = 0; i < tops.length - 1; i++) {
          const a = tops[i], b = tops[i + 1], len = Math.hypot(b.x - a.x, b.z - a.z), sag = len * (high ? .03 : .025);
          for (const off of high ? [-3.8, 0, 3.8] : [-.6, .6]) {
            const nx = Math.cos(a.dir) * off, nz = -Math.sin(a.dir) * off;
            let px = a.x + nx, py = a.y, pz = a.z + nz;
            for (let k = 1; k <= 6; k++) {
              const t = k / 6, x = a.x + (b.x - a.x) * t + nx, z = a.z + (b.z - a.z) * t + nz, y = a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * sag;
              wires.push(px, py, pz, x, y, z); px = x; py = y; pz = z;
            }
          }
        }
      }
    }
    if (steel.pos.length) {
      const mesh = new THREE.Mesh(steel.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .7, metalness: .2 }));
      mesh.name = 'Lift pylons, stations and power poles'; mesh.castShadow = true; mesh.receiveShadow = true;
      this.group.add(mesh); meshes.push(mesh);
    }
    if (wires.length) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3));
      const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#2b2b2a', transparent: true, opacity: .7 }));
      lines.name = 'Cables and wires'; lines.userData.bake = false;
      this.group.add(lines); meshes.push(lines);
    }
    this.meshes = meshes;
  }

  dispose() { for (const m of this.meshes) { m.geometry.dispose(); m.material.dispose(); } this.group.removeFromParent(); }
}
