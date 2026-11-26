// Toolbox: mountain road structures, turned on by a scene's "mountainRoad" block (old name "glacier").
// Placed by distance from the block's data, so any mountain route can use them; first built for
// Going-to-the-Sun, whose features are listed below.
//
// Going-to-the-Sun Road's built landmarks and signature features, on the real landform (real-mountain):
//  - the 1930s rubble-masonry guardwalls along every drop beside the road
//  - the West Side Tunnel (with its window galleries) and the East Side Tunnel: a tube through a rock mass
//    that restores the spur the road is pressed through, with masonry portals
//  - the Triple Arches: three stone arches carrying the valley half of the road over a gully
//  - waterfalls: the Weeping Wall pouring onto the road, Bird Woman, Haystack, Oberlin and Piegan Falls
//  - Logan Pass Visitor Center and its parking, Lake McDonald Lodge, Rising Sun, the St. Mary visitor centre,
//    midsummer snowbanks, and Wild Goose Island's handful of trees
// Everything is merged into a few vertex-coloured meshes (a draw call or two per landmark).
import * as THREE from '../../../../vendor/three.js';
import { randomSequence, smoothstep } from '../core/random.js';
import { Builder, M, blob, box } from '../core/model-builder.js';
import { decorateSceneryMaterial } from '../materials/surfaces.js';
import { appendToBuilder } from '../life/figures/vehicles.js';
import { staticCar } from '../life/figures/cars.js';
import { makeMasonryMaterial, makeParapetGeometry } from '../materials/stonework.js';

const ROAD_HALF = 3.5;
const STONE = ['#837d72', '#77716a', '#8c857a', '#6f6a63', '#7f786c', '#8a8174'];
// the guardwalls' rubble: local grey limestone with red and green argillite and a buff sandstone
const STONEWORK = ['#8a8276', '#7b746a', '#958c7f', '#86716a', '#7a7f70', '#9b907c'];
const PAINT = ['#b23a2e', '#1f3a5f', '#e9ecee', '#2b2b2b', '#7f8c8d', '#c5c9cc', '#28543c', '#d9c38a', '#4f6475', '#9db4c8'];
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Flat-shaded triangles with per-face colours (custom shapes the primitive builder can't make). */
class Tris {
  constructor() { this.pos = []; this.col = []; }
  tri(a, b, c, color) {
    const k = new THREE.Color(color);
    for (const p of [a, b, c]) { this.pos.push(p.x, p.y, p.z); this.col.push(k.r, k.g, k.b); }
  }
  quad(a, b, c, d, color) { this.tri(a, b, c, color); this.tri(a, c, d, color); }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals(); g.computeBoundingSphere();
    return g;
  }
}

const noise = /* glsl */`
  float gHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  float gNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(gHash(i), gHash(i + vec2(1., 0.)), f.x), mix(gHash(i + vec2(0., 1.)), gHash(i + 1.), f.x), f.y); }
  float gFbm(vec2 p) { return gNoise(p) * .55 + gNoise(p * 2.1 + 5.) * .3 + gNoise(p * 4.3 - 2.) * .15; }
`;

export class MountainRoad {
  constructor(parent, landscape, route, index, proj, config, kit, uniforms) {
    this.group = new THREE.Group(); this.group.name = 'Going-to-the-Sun landmarks'; parent.add(this.group);
    this.L = landscape; this.route = route; this.index = index; this.proj = proj; this.config = config; this.kit = kit; this.u = uniforms;
    this.cfg = config.mountainRoad || {};
    this.end = route.turnIdx || route.dist.length - 1;
    this.oneWay = route.turnS || route.total;
    this.material = decorateSceneryMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .93, side: THREE.DoubleSide }), 'concrete', uniforms);
    this.disposables = [this.material];
    this.tunnels = this.cfg.tunnels || [];
    this._guardwalls(this.cfg.guardwalls);
    for (const t of this.tunnels) this._tunnel(t);
    for (const b of landscape.bridges || []) if (b.style === 'arches') this._arches(b);
    this._waterfalls(this.cfg.waterfalls || []);
    const built = new Builder();
    this.cars = [];
    for (const b of this.cfg.buildings || []) this._building(b, built);
    for (const p of this.cfg.parking || []) this._parking(p, built);
    this._snowbanks(this.cfg.snowbanks || [], built);
    if (built.pos.length) this._mesh(built.build(), 'Lodges and visitor centres');
    this._islandTrees();
  }

  // ---- helpers ----
  F(s) { return this.L.frameAt(Math.max(0, Math.min(this.oneWay - .5, s))); }
  /** +1 / −1: the side of the road (right / left of the outbound direction) where the ground falls away. */
  _valleySide(s) {
    const p = this.F(s), a = this.L.baseHeight(p.x - p.fz * 16, p.z + p.fx * 16), b = this.L.baseHeight(p.x + p.fz * 16, p.z - p.fx * 16);
    return a < b ? 1 : -1;
  }
  _inTunnel(s, pad = 0) { return this.tunnels.some((t) => s > t.fromM - pad && s < t.toM + pad); }
  _local(lat, lon) { return this.proj.toLocal(lat, lon); }
  _mesh(geometry, name, material = this.material) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name; mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh); this.disposables.push(geometry);
    return mesh;
  }

  // ---- Guardwalls: the 1930s rubble-masonry parapets, knee-high with a rounded cap and regular openings,
  //      on a masonry footing wherever the ground falls away below the road edge ----
  _guardwalls(c) {
    if (!c) return;
    const rand = randomSequence(77), L = this.L, walls = [], feet = [], tints = [], footTints = [];
    const lookouts = this.config.lookouts || [], gaps = c.gaps || [];
    const segM = c.segmentM ?? 2.35, gapM = c.openingM ?? .75, step = segM + gapM;
    const m = new THREE.Matrix4(), up = V(0, 1, 0);
    for (let s = c.fromM; s < Math.min(c.toM, this.oneWay) - 3; s += step) {
      if (this._inTunnel(s, 4)) continue;
      const b0 = L.bridgeOfS?.(s, 4);
      if (b0 && !b0.style) continue;   // bridges carry their own parapets
      const len = segM * (.92 + rand() * .16);
      const p = this.F(s), q = this.F(s + len);
      for (const side of [-1, 1]) {
        if (lookouts.some((l) => (l.side === 'inland' ? -1 : 1) === side && Math.abs(s - l.atM) < (l.lengthM || 32) / 2 + 9)) continue;
        if (gaps.some((g) => s > g.fromM && s < g.toM && (!g.side || g.side === side))) continue;
        const rx = -p.fz * side, rz = p.fx * side;
        const drop = p.y - L.heightAt(p.x + rx * 18, p.z + rz * 18);   // beyond the flat bench the road is pressed into
        if (drop < (c.dropM ?? 2.4)) continue;
        const off = ROAD_HALF + 1.1;
        // the wall follows the road's grade (a sheared box), so it never steps
        const a = V(p.x + rx * off, p.y - .08, p.z + rz * off), b = V(q.x - q.fz * side * off, q.y - .08, q.z + q.fx * side * off);
        const f = b.clone().sub(a); if (Math.hypot(f.x, f.z) < .5) continue;
        const x = V(f.z, 0, -f.x).normalize();   // right-handed with (up, along): no mirrored faces
        const height = .62 + rand() * .08, width = .52;
        m.makeBasis(x.clone().multiplyScalar(width), up.clone().multiplyScalar(height), f).setPosition(a);
        walls.push(m.clone()); tints.push(.93 + rand() * .12);
        // footing: down to the ground where it falls away under the wall (on the arches the arcade carries it)
        if (b0?.style) continue;
        const ground = Math.min(L.heightAt(a.x, a.z), L.heightAt(b.x, b.z));
        const depth = Math.min(7, Math.min(a.y, b.y) - ground + 1.3);
        if (depth < .2) continue;
        const fa = a.clone().addScaledVector(up, -depth + .06);
        m.makeBasis(x.clone().multiplyScalar(width + .14), up.clone().multiplyScalar(depth), f).setPosition(fa);
        feet.push(m.clone()); footTints.push(.82 + rand() * .1);
      }
    }
    if (!walls.length) return;
    const material = makeMasonryMaterial({ stones: c.stones || STONEWORK, mortar: c.mortar || '#6f6a62', courseM: .27 });
    // one mesh per ~1.5 km of road, so the walls out of view are culled (a call or two per visible stretch)
    const build = (geometry, list, tint, name) => {
      const chunks = new Map(), col = new THREE.Color(), p3 = V(0, 0, 0);
      list.forEach((mm, i) => { p3.setFromMatrixPosition(mm); const k = `${Math.floor(p3.x / 1500)},${Math.floor(p3.z / 1500)}`; (chunks.get(k) || chunks.set(k, []).get(k)).push(i); });
      for (const ids of chunks.values()) {
        const mesh = new THREE.InstancedMesh(geometry, material, ids.length);
        ids.forEach((i, j) => { mesh.setMatrixAt(j, list[i]); mesh.setColorAt(j, col.setScalar(tint[i])); });
        mesh.instanceMatrix.needsUpdate = true; mesh.castShadow = mesh.receiveShadow = true; mesh.name = name;
        mesh.computeBoundingSphere(); this.group.add(mesh);
        (this.wallChunks ||= []).push(mesh);
      }
      this.disposables.push(geometry);
    };
    build(makeParapetGeometry(), walls, tints, 'Stone guardwalls');
    if (feet.length) build(new THREE.BoxGeometry(1, 1, 1).translate(0, .5, .5), feet, footTints, 'Guardwall footings');
    this.disposables.push(material);
    this.guardwallCount = walls.length;
  }

  /** Knee-high walls are a pixel tall past ~2 km: hide those stretches (called as the camera moves). */
  cullWalls(cx, cz, reachM = 2000) {
    for (const m of this.wallChunks || []) {
      const b = m.boundingSphere;
      m.visible = Math.hypot(b.center.x - cx, b.center.z - cz) - b.radius < reachM;
    }
  }

  // ---- Tunnels: an arched tube through a rock mass that restores the spur, with masonry portals ----
  _tunnel(t) {
    const L = this.L, valley = t.valleySide ?? this._valleySide((t.fromM + t.toM) / 2), T = new Tris();
    const HW = 4.4, WALL = 3.1, ROOF = 8.8, UPHILL = 34, rock = ['#7f776b', '#8a8174', '#746d62'];
    const lining = ['#6e6a62', '#77726a', '#66625b'];
    // cross-section (lateral, up): walls, then a round arch
    const section = [[-HW, -.5], [-HW, 1.1], [-HW, WALL]];
    for (let k = 1; k < 12; k++) { const a = Math.PI - k * Math.PI / 12; section.push([HW * Math.cos(a), WALL + HW * .8 * Math.sin(a)]); }
    section.push([HW, WALL], [HW, 1.1], [HW, -.5]);
    const at = (s, lat, upY) => { const p = this.F(s); return V(p.x - p.fz * lat, p.y + upY, p.z + p.fx * lat); };
    const len = t.toM - t.fromM, windows = t.windows ? [[len * .3 - 2.2, len * .3 + 2.2], [len * .68 - 2.6, len * .68 + 2.6]] : [];
    const step = 2;
    for (let s = t.fromM; s < t.toM - .01; s += step) {
      const e = Math.min(t.toM, s + step), u = (s + e) / 2 - t.fromM;
      for (let k = 0; k < section.length - 1; k++) {
        const [l0, y0] = section[k], [l1, y1] = section[k + 1];
        // the gallery windows: openings in the valley wall (between 1.1 and 3.1 m) looking out over the valley
        if (windows.some(([w0, w1]) => u > w0 && u < w1) && Math.sign(l0) === valley && Math.abs(l0) === HW && Math.abs(l1) === HW && y0 >= 1.1 && y1 <= WALL) continue;
        T.quad(at(s, l0, y0), at(e, l0, y0), at(e, l1, y1), at(s, l1, y1), lining[(k + Math.floor(s)) % 3]);
      }
    }
    // the rock mass: lateral from the valley wall to 34 m uphill, at least 8.8 m over the road
    const lats = [];
    for (let l = -UPHILL; l <= HW + .01; l += 3) lats.push(l);
    if (lats.at(-1) < HW) lats.push(HW);
    const lat = (k) => lats[k] * valley;   // lateral: the valley side at +HW·valley, uphill at −34·valley
    const capY = (s, l) => { const p = this.F(s), w = at(s, l, 0); return Math.max(L.baseHeight(w.x, w.z), p.y + ROOF); };
    const pt = (s, l) => { const w = at(s, l, 0); w.y = capY(s, l); return w; };
    const us = [];
    for (let s = t.fromM; s < t.toM; s += 3) us.push(s);
    us.push(t.toM);
    // the top of the rock mass is ground again: meadow and shrubs where it is gentle, rock where it is steep
    const turf = ['#5f7548', '#677c4c', '#58703f'];
    for (let i = 0; i < us.length - 1; i++) for (let k = 0; k < lats.length - 1; k++) {
      const a = pt(us[i], lat(k)), b = pt(us[i + 1], lat(k)), c = pt(us[i + 1], lat(k + 1)), d = pt(us[i], lat(k + 1));
      const n = new THREE.Vector3().crossVectors(c.clone().sub(a), d.clone().sub(b)).normalize();
      T.quad(a, b, c, d, Math.abs(n.y) > .72 ? turf[(i + k) % 3] : rock[(i + k) % 3]);
    }
    for (let i = 0; i < us.length - 1; i++) {
      // valley face: from the tube wall top up to the rock surface, and a skirt below the tube into the ground
      const lv = HW * valley, a = us[i], b = us[i + 1];
      T.quad(at(a, lv, WALL), at(b, lv, WALL), pt(b, lv), pt(a, lv), rock[i % 3]);
      const g = (s) => { const w = at(s, lv * 1.15, 0); return L.heightAt(w.x, w.z) - 1.5 - this.F(s).y; };
      T.quad(at(a, lv, g(a)), at(b, lv, g(b)), at(b, lv, -.5), at(a, lv, -.5), rock[(i + 1) % 3]);
      // uphill edge: down into the ground
      const lu = -UPHILL * valley, gu = (s) => { const w = at(s, lu, 0); return L.heightAt(w.x, w.z) - 2 - this.F(s).y; };
      T.quad(pt(a, lu), pt(b, lu), at(b, lu, gu(b)), at(a, lu, gu(a)), rock[(i + 2) % 3]);
    }
    // portals: the end faces, notched by the tunnel opening, and a ring of voussoirs
    const B = new Builder(), rand = randomSequence(311 + Math.floor(t.fromM));
    for (const [s, dir] of [[t.fromM, -1], [t.toM, 1]]) {
      const p = this.F(s), bottom = -1.6;
      // the face polygon: around the opening, up to the rock surface and back along it
      const left = Math.min(lat(0), lat(lats.length - 1)), right = Math.max(lat(0), lat(lats.length - 1));
      const poly = [[left, bottom], [-HW, bottom]];
      for (const [l, y] of section) poly.push([l, Math.max(y, bottom)]);
      poly.push([HW, bottom], [right, bottom]);
      const prof = [];
      for (let l = right; l >= left - .01; l -= 3) prof.push([l, capY(s, l) - p.y]);
      prof.push([left, capY(s, left) - p.y]);
      poly.push(...prof);
      for (let k = poly.length - 1; k > 0; k--) if (Math.hypot(poly[k][0] - poly[k - 1][0], poly[k][1] - poly[k - 1][1]) < .01) poly.splice(k, 1);
      const shape = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y)));
      const g = new THREE.ShapeGeometry(shape);
      const r = V(-p.fz, 0, p.fx), f = V(p.fx, 0, p.fz);
      g.applyMatrix4(new THREE.Matrix4().makeBasis(r, V(0, 1, 0), f).setPosition(p.x, p.y, p.z));
      const posA = g.attributes.position, tmp = new Tris();
      const idx = g.index.array;
      for (let k = 0; k < idx.length; k += 3) tmp.tri(V().fromBufferAttribute(posA, idx[k]), V().fromBufferAttribute(posA, idx[k + 1]), V().fromBufferAttribute(posA, idx[k + 2]), rock[k % 3]);
      T.pos.push(...tmp.pos); T.col.push(...tmp.col); g.dispose();
      // masonry ring: voussoirs around the arch and two pilasters, standing proud of the face
      const ringAt = (l, y) => V(p.x - p.fz * l + p.fx * dir * .35, p.y + y, p.z + p.fx * l + p.fz * dir * .35);
      for (let k = 0; k <= 12; k++) {
        const a = Math.PI - k * Math.PI / 12, c = ringAt((HW + .45) * Math.cos(a), WALL + (HW * .8 + .45) * Math.sin(a));
        B.add(box(.9, .7, .8), M(c.x, c.y - .35, c.z, 1, 1, 1, Math.atan2(p.fx, p.fz)), STONE[k % STONE.length], .1, rand);
      }
      for (const side of [-1, 1]) for (let y = -.3; y < WALL; y += .8) {
        const c = ringAt(side * (HW + .45), y);
        B.add(box(.95, .78, .85), M(c.x, c.y, c.z, 1, 1, 1, Math.atan2(p.fx, p.fz)), STONE[Math.floor(rand() * STONE.length)], .1, rand);
      }
    }
    this._mesh(T.geometry(), t.name);
    this._mesh(B.build(), `${t.name} portals`);
  }

  // ---- Triple Arches: a masonry arcade carrying the valley half of the road over a gully ----
  _arches(b) {
    const L = this.L, side = b.side ?? this._valleySide(b.s), T = new Tris(), n = b.count || 3;
    const off = ROAD_HALF + .9, thick = 1.1, len = b.toM - b.fromM, pier = 1.8, bay = (len - pier * (n + 1)) / n;
    const at = (s, lat, y) => { const p = this.F(s); return V(p.x - p.fz * lat * side, y, p.z + p.fx * lat * side); };
    const road = (s) => this.F(s).y;
    const opening = (s) => {
      // top of the opening at s (−Infinity inside a pier)
      const u = s - b.fromM;
      for (let k = 0; k < n; k++) {
        const x0 = pier * (k + 1) + bay * k, x = u - (x0 + bay / 2);
        if (Math.abs(x) < bay / 2) { const R = bay / 2, crown = road(s) - .9; return crown - R + Math.sqrt(Math.max(0, R * R - x * x)); }
      }
      return -Infinity;
    };
    const foot = (s) => { const w = at(s, off, 0); return L.heightAt(w.x, w.z) - 1.2; };
    const stone = (k) => STONE[k % STONE.length];
    const ds = .7;
    for (let s = b.fromM, i = 0; s < b.toM - .01; s += ds, i++) {
      const e = Math.min(b.toM, s + ds);
      for (const [lat, col] of [[off + thick / 2, stone(i)], [off - thick / 2, stone(i + 2)]]) {
        const o0 = opening(s), o1 = opening(e);
        const lo0 = o0 === -Infinity ? foot(s) : Math.max(foot(s), o0), lo1 = o1 === -Infinity ? foot(e) : Math.max(foot(e), o1);
        T.quad(at(s, lat, lo0), at(e, lat, lo1), at(e, lat, road(e) + .05), at(s, lat, road(s) + .05), col);
      }
      // intrados (the underside of each arch) and the pier faces
      const o0 = opening(s), o1 = opening(e);
      if (o0 !== -Infinity && o1 !== -Infinity) T.quad(at(s, off - thick / 2, o0), at(e, off - thick / 2, o1), at(e, off + thick / 2, o1), at(s, off + thick / 2, o0), '#7b705f');
      if ((o0 === -Infinity) !== (o1 === -Infinity)) {
        const sx = o0 === -Infinity ? e : s, top = o0 === -Infinity ? o1 : o0;
        T.quad(at(sx, off - thick / 2, foot(sx)), at(sx, off + thick / 2, foot(sx)), at(sx, off + thick / 2, top), at(sx, off - thick / 2, top), '#837765');
      }
      // the deck slab between the hillside and the arcade
      T.quad(at(s, -ROAD_HALF - 1, road(s) - .9), at(e, -ROAD_HALF - 1, road(e) - .9), at(e, off, road(e) - .9), at(s, off, road(s) - .9), '#7d7262');
    }
    this._mesh(T.geometry(), b.name || 'Triple Arches');
  }

  // ---- Waterfalls: animated ribbons of white water hugging the real rock ----
  _waterfalls(list) {
    if (!list.length) return;
    const L = this.L, pos = [], uv = [], idx = [];
    const ribbon = (pts, width, name) => {
      if (pts.length < 2) return;
      let v = 0;
      const base = pos.length / 3;
      for (let k = 0; k < pts.length; k++) {
        const a = pts[Math.max(0, k - 1)], c = pts[Math.min(pts.length - 1, k + 1)];
        let dx = c.x - a.x, dz = c.z - a.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        if (k) v += pts[k].distanceTo(pts[k - 1]);
        const w = width * (.7 + .3 * Math.min(1, k / 4)) * (pts[k].w ?? 1);
        pos.push(pts[k].x - dz * w / 2, pts[k].y, pts[k].z + dx * w / 2, pts[k].x + dz * w / 2, pts[k].y, pts[k].z - dx * w / 2);
        uv.push(0, v, 1, v);
        if (k) { const i = base + k * 2; idx.push(i - 2, i, i - 1, i - 1, i, i + 1); }
      }
    };
    // walk the real ground: up the steepest ascent, or down the steepest descent
    const walk = (x, z, dir, stopRise, maxLen) => {
      const pts = [V(x, L.heightAt(x, z), z)];
      const h0 = pts[0].y;
      for (let d = 0; d < maxLen; d += 4) {
        const p = pts.at(-1);
        let best = null;
        for (let k = 0; k < 16; k++) {
          const a = k * Math.PI / 8, cx = p.x + Math.cos(a) * 4, cz = p.z + Math.sin(a) * 4, h = L.heightAt(cx, cz);
          if (!best || (dir > 0 ? h > best.y : h < best.y)) best = V(cx, h, cz);
        }
        if ((dir > 0 ? best.y - p.y < .6 : p.y - best.y < .4) && d > (dir > 0 ? 14 : 0)) break;
        pts.push(best);
        if (dir > 0 ? best.y - h0 > stopRise : h0 - best.y > stopRise) break;
      }
      return pts;
    };
    const lift = (pts, k = 1.1) => pts.map((p) => Object.assign(V(p.x, L.heightAt(p.x, p.z) + k, p.z), { w: p.w }));
    // culverts: where a gully comes down to the road, a cascade runs to it and spills out below
    // a gully's line: straight up the steepest ground for a fixed length (gentle gullies too)
    const climb = (x, z, len, rise) => {
      const pts = [V(x, L.heightAt(x, z), z)];
      for (let d = 0; d < len; d += 4) {
        const p = pts.at(-1); let best = null;
        for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8, cx = p.x + Math.cos(a) * 4, cz = p.z + Math.sin(a) * 4, h = L.heightAt(cx, cz); if (!best || h > best.y) best = V(cx, h, cz); }
        if (best.y <= p.y + .05) break;
        pts.push(best);
        if (best.y - pts[0].y > rise) break;
      }
      return pts;
    };
    for (const c of this._culverts()) {
      const up = climb(c.inlet.x, c.inlet.z, 110, Math.max(14, c.riseM));
      // only real gullies: steep enough to tumble (a white plank across an open meadow reads wrong)
      const len = up.length > 1 ? Math.hypot(up.at(-1).x - up[0].x, up.at(-1).z - up[0].z) : 0;
      const steep = len > 12 && (up.at(-1).y - up[0].y) / len > .45;
      up.reverse().forEach((p, k) => { p.w = .45 + .55 * k / Math.max(1, up.length - 1); });   // narrower toward the top
      if (steep && up.length > 3) ribbon(lift(up, .25), .9 + c.k * .6, 'Cascade');
      const down = walk(c.outlet.x, c.outlet.z, -1, 22, 70);
      if (down.length > 2) ribbon(lift(down, .25), .9 + c.k * .5, 'Culvert outfall');
    }
    for (const f of list) {
      if (f.fromM != null) {
        // a wall of falling water beside the road (the Weeping Wall): many strands from the cut face up the cliff
        const side = f.side === 'valley' ? this._valleySide((f.fromM + f.toM) / 2) : -this._valleySide((f.fromM + f.toM) / 2);
        let k = 0;
        for (let s = f.fromM; s <= f.toM; s += f.spacingM || 4.5, k++) {
          const p = this.F(s), o = ROAD_HALF + 2.4, x = p.x - p.fz * side * o, z = p.z + p.fx * side * o;
          const strand = walk(x, z, 1, f.heightM || 16, 60).reverse();
          ribbon(lift(strand, .45), (f.widthM || 2.2) * (.7 + ((s * 13.7) % 1) * .6), f.name);
          // over the road: some strands spout from the lip of the cut and arc down into the near lane
          if (f.overRoad && k % 2 === 0) {
            const top = this.L.heightAt(x, z) + 3.5 + ((s * 7.1) % 1) * 2.5, reach = 1.8 + ((s * 3.7) % 1) * 1.6;
            const arc = [];
            for (let t = 0; t <= 1.0001; t += .125) {
              const off = o - (o - (ROAD_HALF - reach)) * t;
              arc.push(V(p.x - p.fz * side * off, p.y + .1 + (top - p.y - .1) * (1 - t * t), p.z + p.fx * side * off));
            }
            ribbon(arc, 1.1 + ((s * 5.3) % 1) * .8, f.name);
          }
        }
        continue;
      }
      const p = this._local(f.lat, f.lon);
      const top = walk(p.x, p.z, 1, f.upM ?? 120, 400).at(-1);
      // far falls sit on the coarser distant ground: lift them clear of it
      ribbon(lift(walk(top.x, top.z, -1, (f.upM ?? 120) + (f.downM ?? 40), 900), f.liftM ?? 5), f.widthM || 10, f.name);
    }
    if (!idx.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aUv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeBoundingSphere();
    const material = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: this.u.uTime, bfNight: { value: 0 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      vertexShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_vertex>
        #include <fog_pars_vertex>
        attribute vec2 aUv; varying vec2 vUv;
        void main() {
          vUv = aUv;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.);
          gl_Position = projectionMatrix * mvPosition;
          #include <logdepthbuf_vertex>
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_fragment>
        #include <fog_pars_fragment>
        uniform float uTime; uniform float bfNight; varying vec2 vUv;
        ${noise}
        void main() {
          #include <logdepthbuf_fragment>
          float flow = vUv.y * .09 + uTime * 1.5;
          float streak = gFbm(vec2(vUv.x * 7., flow));
          float fine = gNoise(vec2(vUv.x * 23., flow * 3.1));
          float edge = smoothstep(0., .22, vUv.x) * smoothstep(1., .78, vUv.x);
          float a = edge * (.28 + .62 * smoothstep(.32, .72, streak) + fine * .12);
          vec3 col = mix(vec3(.72, .82, .86), vec3(.98), smoothstep(.4, .8, streak));
          gl_FragColor = vec4(col * (1. - bfNight * .75), a * .9);
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.waterMaterial = material;
    const mesh = new THREE.Mesh(g, material); mesh.name = 'Waterfalls'; mesh.renderOrder = 3;
    this.group.add(mesh); this.disposables.push(g, material);
  }

  /**
   * Culverts (glacier.culverts {fromM, toM, minDepthM, maxCount}): where the ground on the uphill side dips
   * into a gully that reaches the road. Each gets a masonry headwall with a pipe below the road on the low
   * side; the waterfalls add a cascade down the gully and a spill from the pipe.
   */
  _culverts() {
    if (this._culvertList) return this._culvertList;
    const c = this.cfg.culverts, out = (this._culvertList = []);
    if (!c) return out;
    const L = this.L, T = L.terrain, prof = [];
    for (let s = c.fromM; s < Math.min(c.toM, this.oneWay - 50); s += 10) {
      const p = this.F(s), side = -this._valleySide(s), off = 30;
      prof.push({ s, p, side, h: T.at(p.x - p.fz * side * off, p.z + p.fx * side * off) });
    }
    const minD = c.minDepthM ?? 3;
    for (let i = 5; i < prof.length - 5; i++) {
      const a = prof[i];
      if (!(a.h < prof[i - 1].h && a.h <= prof[i + 1].h)) continue;
      const rim = Math.min(Math.max(prof[i - 4].h, prof[i - 5].h), Math.max(prof[i + 4].h, prof[i + 5].h));
      if (rim - a.h < minD || this._inTunnel(a.s, 30) || L.bridgeOfS?.(a.s, 30) || out.some((o) => Math.abs(o.s - a.s) < 150)) continue;
      if ((this.cfg.waterfalls || []).some((f) => f.fromM != null && a.s > f.fromM - 60 && a.s < f.toM + 60)) continue;
      const p = a.p, side = a.side;
      const inlet = { x: p.x - p.fz * side * (ROAD_HALF + 3), z: p.z + p.fx * side * (ROAD_HALF + 3) };
      const outlet = { x: p.x + p.fz * side * (ROAD_HALF + 2.6), z: p.z - p.fx * side * (ROAD_HALF + 2.6) };
      out.push({ s: a.s, p, side, inlet, outlet, riseM: Math.min(40, (rim - a.h) * 3), k: ((a.s * 7.3) % 1) });
      if (out.length >= (c.maxCount ?? 40)) break;
    }
    // headwalls: a masonry face with a dark pipe, below the road edge on the low side
    if (out.length) {
      const walls = [], pipes = [], m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = V(0, 1, 0);
      for (const o of out) {
        const ground = L.heightAt(o.outlet.x, o.outlet.z), y = Math.min(o.p.y - .9, ground + .9);
        q.setFromAxisAngle(up, Math.atan2(o.p.fx, o.p.fz));
        const off = ROAD_HALF + 2.0, x = o.p.x + o.p.fz * o.side * off, z = o.p.z - o.p.fx * o.side * off;
        walls.push(m.compose(V(x, y - 1.1, z), q, V(.55, Math.max(1.6, o.p.y - y + 1.1), 2.6)).clone());
        const px = o.p.x + o.p.fz * o.side * (off + .3), pz = o.p.z - o.p.fx * o.side * (off + .3);
        q.setFromUnitVectors(V(0, 1, 0), V(o.p.fz * o.side, 0, -o.p.fx * o.side));
        pipes.push(m.compose(V(px, y - .45, pz), q, V(1, 1, 1)).clone());
      }
      const material = makeMasonryMaterial({ stones: this.cfg.guardwalls?.stones || STONEWORK, mortar: '#6f6a62', courseM: .24 });
      const wallMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0), material, walls.length);
      walls.forEach((mm, i) => { wallMesh.setMatrixAt(i, mm); wallMesh.setColorAt(i, new THREE.Color(.9, .9, .9)); });
      wallMesh.name = 'Culvert headwalls'; wallMesh.castShadow = wallMesh.receiveShadow = true; wallMesh.computeBoundingSphere();
      const pipeGeo = new THREE.CylinderGeometry(.42, .42, .5, 10, 1, false);
      const pipeMesh = new THREE.InstancedMesh(pipeGeo, new THREE.MeshStandardMaterial({ color: '#1c1b19', roughness: 1 }), pipes.length);
      pipes.forEach((mm, i) => pipeMesh.setMatrixAt(i, mm)); pipeMesh.name = 'Culvert pipes'; pipeMesh.computeBoundingSphere();
      this.group.add(wallMesh, pipeMesh);
      this.disposables.push(wallMesh.geometry, material, pipeGeo, pipeMesh.material);
    }
    return out;
  }

  // ---- Buildings ----
  _place(b) {
    const p = this._local(b.lat, b.lon), hit = this.index.nearest(p.x, p.z, 2000);
    // face the road (or a given bearing): +z of the building points at it
    let a = b.angle != null ? b.angle * Math.PI / 180 : 0;
    if (b.angle == null && hit) a = Math.atan2(this.index.xs[hit.i] - p.x, this.index.zs[hit.i] - p.z);
    return { x: p.x, z: p.z, y: this.L.heightAt(p.x, p.z), a };
  }

  _building(b, B) {
    const { x, z, y, a } = this._place(b), rand = randomSequence(Math.floor(b.lat * 1e4));
    const at = (lx, ly, lz) => ({ x: x + lx * Math.cos(a) + lz * Math.sin(a), y: y + ly, z: z - lx * Math.sin(a) + lz * Math.cos(a) });
    const put = (geometry, lx, ly, lz, sx, sy, sz, color, ry = 0) => { const p = at(lx, ly, lz); B.add(geometry, M(p.x, p.y, p.z, sx, sy, sz, a + ry), color, .06, rand); };
    const gable = (w, d, rise, lx, ly, lz, color, ry = 0) => {
      const s = new THREE.Shape([new THREE.Vector2(-w / 2 - .6, 0), new THREE.Vector2(w / 2 + .6, 0), new THREE.Vector2(0, rise)]);
      put(new THREE.ExtrudeGeometry(s, { depth: d + 1.2, bevelEnabled: false }).translate(0, 0, -(d + 1.2) / 2), lx, ly, lz, 1, 1, 1, color, ry);
    };
    if (b.kind === 'logan-pass-visitor-center') {
      // a low stone-and-timber hall under a broad shallow roof, entrance facing the parking
      put(box(34, 1.3, 14), 0, -.4, 0, 1, 1, 1, '#8a7e6c');
      put(box(34, 3.4, 14), 0, .9, 0, 1, 1, 1, '#6b4a33');
      put(box(30, 1.2, 14.1), 0, 2.1, 0, 1, 1, 1, '#2d2a27');        // window band
      gable(14, 34, 3.2, 0, 4.3, 0, '#3f453f', Math.PI / 2);
      put(box(9, 4, 4), 0, -.4, 8, 1, 1, 1, '#7c5a3c');               // entrance porch
      gable(9, 4, 2.2, 0, 3.6, 8, '#3f453f');
      put(box(3.2, 2.4, .2), 0, 0, 10.1, 1, 1, 1, '#2d2a27');
      for (const s of [-1, 1]) put(box(1.1, 4.2, 1.1), s * 4, -.4, 9.6, 1, 1, 1, '#8a7e6c');
      // a flag pole and a boardwalk heading off toward Hidden Lake
      put(box(.15, 11, .15), 14, 0, 12, 1, 1, 1, '#c9c9c4');
      put(box(1.4, .5, 1), 14.6, 10, 12, 1, 1, 1, '#3c5a8a');
      for (let k = 0; k < 14; k++) put(box(2.2, .25, 3.1), -20 - k * 1.6, -.1 + k * .05, -10 - k * 2.8, 1, 1, 1, '#7a6247', .5);
    } else if (b.kind === 'lake-mcdonald-lodge') {
      // a three-storey Swiss-chalet lodge: stone ground floor, cream and brown upper storeys, deep eaves, balconies to the lake
      put(box(42, 3.6, 17), 0, -.5, 0, 1, 1, 1, '#8c806d');
      put(box(42, 6.2, 16), 0, 3.1, 0, 1, 1, 1, '#d6c9a8');
      put(box(42.2, .5, 16.2), 0, 6.2, 0, 1, 1, 1, '#5a3f2c');
      for (const fl of [3.4, 6.6]) put(box(42, .9, 15.4), 0, fl + .6, .2, 1, 1, 1, '#3a3330');   // window rows
      gable(17, 44, 6.5, 0, 9.3, 0, '#4b3a2c', Math.PI / 2);
      for (const fl of [3.1, 6.3]) { put(box(38, .25, 2.4), 0, fl, -9.2, 1, 1, 1, '#5a3f2c'); put(box(38, .9, .15), 0, fl + .25, -10.3, 1, 1, 1, '#6b4a33'); }
      put(box(3, 11, 3), 15, -.5, -4, 1, 1, 1, '#7d715f');               // stone chimney
      for (let k = 0; k < 5; k++) {
        const cx = -36 - (k % 3) * 11, cz = -6 + Math.floor(k / 3) * 16 + (rand() - .5) * 4;
        put(box(7, 3.2, 6), cx, -.4, cz, 1, 1, 1, '#6b4a33'); gable(6, 7, 2.2, cx, 2.8, cz, '#2f4733', Math.PI / 2);
      }
    } else if (b.kind === 'rising-sun') {
      // the motor inn: a camp store and an arc of small brown cabins with green roofs
      put(box(16, 3.8, 10), 0, -.4, 0, 1, 1, 1, '#6b4a33'); gable(10, 16, 3, 0, 3.4, 0, '#2f4733', Math.PI / 2);
      put(box(13, .3, 2.6), 0, 2.2, 6, 1, 1, 1, '#5a3f2c');
      for (let k = 0; k < 9; k++) {
        const t = (k - 4) * .26, cx = Math.sin(t) * 46, cz = -30 + Math.cos(t) * 18 - 18;
        put(box(5, 2.9, 4.4), cx, -.4, cz, 1, 1, 1, ['#6b4a33', '#7a5a3f'][k % 2], -t); gable(4.4, 5, 1.8, cx, 2.5, cz, '#2f4733', Math.PI / 2 - t);
      }
    } else if (b.kind === 'st-mary-visitor-center') {
      put(box(46, 1.2, 15), 0, -.4, 0, 1, 1, 1, '#857a6a');
      put(box(46, 3.8, 15), 0, .8, 0, 1, 1, 1, '#7d5b3e');
      put(box(40, 1.4, 15.1), 0, 2, 0, 1, 1, 1, '#2d2a27');
      put(box(48, .8, 18), 0, 4.6, 0, 1, 1, 1, '#4a4a46');
      put(box(.15, 10, .15), 16, 0, 12, 1, 1, 1, '#c9c9c4'); put(box(1.4, .5, 1), 16.6, 9, 12, 1, 1, 1, '#3c5a8a');
    }
  }

  _parking(p, B) {
    const site = this.L.sites?.find((t) => t.name === p.site);
    if (!site) return;
    const rand = randomSequence(901 + Math.floor(site.x)), a = Math.atan2(site.sa, site.ca);
    const at = (u, v) => ({ x: site.x + u * site.ca - v * site.sa, z: site.z + u * site.sa + v * site.ca });
    const c = at(0, 0);
    B.add(box(site.lengthM, .3, site.widthM), M(c.x, site.level - .2, c.z, 1, 1, 1, -a), '#4c4c49', .02, rand);
    // stalls in rows along the length, cars in most of them
    const rows = Math.floor(site.widthM / 14);
    for (let r = 0; r < rows; r++) for (let u = -site.lengthM / 2 + 3; u < site.lengthM / 2 - 3; u += 3) {
      const v = -site.widthM / 2 + 7 + r * 14, line = at(u - 1.5, v);
      B.add(box(.12, .02, 5), M(line.x, site.level + .11, line.z, 1, 1, 1, -a), '#e8e6dc', 0, rand);
      if (rand() < (p.fill ?? .7)) {
        // parked cars from the figures kit (the same models as the traffic), paint baked in
        const q = at(u, v + (rand() - .5) * .3), color = PAINT[Math.floor(rand() * PAINT.length)], k = rand();
        const kind = k < .3 ? 'suv' : k < .42 ? 'pickup' : k < .52 ? 'van' : k < .6 ? 'wagon' : k < .75 ? 'hatch' : 'sedan';
        const ry = -a + (r % 2 ? 0 : Math.PI) + (rand() - .5) * .08;
        appendToBuilder(B, staticCar(kind, color, 'lo', { rack: k > .55 && k < .6 }), new THREE.Matrix4().makeRotationY(ry).setPosition(q.x, site.level + .1, q.z));
      }
    }
  }

  // midsummer: old snowbanks lingering in the hollows around Logan Pass
  _snowbanks(list, B) {
    for (const n of list) {
      const c = this._local(n.lat, n.lon), rand = randomSequence(1301 + Math.floor(c.x));
      for (let k = 0; k < (n.count || 20); k++) {
        const r = Math.sqrt(rand()) * n.radiusM, a = rand() * Math.PI * 2, x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
        if (this.index.nearest(x, z, 11) || this.L.sites?.some((t) => Math.hypot(x - t.x, z - t.z) < Math.hypot(t.hw, t.hl) + 4)) continue;
        const w = 4 + rand() * 9, y = this.L.heightAt(x, z), h = .7 + rand() * 1.1, d = w * (.5 + rand() * .4), yaw = rand() * 6;
        // lie on the ground: skip steep slopes, tilt with the slope and sink by how much it falls away
        // under the bank (a flat bank on a slope floats on its downhill side)
        const gx = (this.L.heightAt(x + 3, z) - this.L.heightAt(x - 3, z)) / 6, gz = (this.L.heightAt(x, z + 3) - this.L.heightAt(x, z - 3)) / 6;
        const slope = Math.hypot(gx, gz);
        if (slope > .45) continue;
        const g = blob(1);
        B.add(g, M(x, y - .3 - slope * w * .5, z, w, h, d, yaw, -Math.atan(gz), Math.atan(gx)), '#eef1f2', .04, rand);
      }
    }
  }

  // Wild Goose Island: a few lopsided spruce and fir on a rock in the lake
  _islandTrees() {
    const lists = {};
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = V(0, 1, 0);
    for (const l of this.L.islands || []) {
      const rand = randomSequence(1777);
      for (let k = 0; k < (l.trees || 6); k++) {
        const u = (rand() - .5) * l.lengthM * .55, v = (rand() - .5) * l.widthM * .4;
        const x = l.x + u * Math.cos(l.a) - v * Math.sin(l.a), z = l.z + u * Math.sin(l.a) + v * Math.cos(l.a);
        const name = rand() < .6 ? 'espruce0' : 'subfir1';
        if (!this.kit.assets[name]) continue;
        q.setFromAxisAngle(up, rand() * 6.28).multiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), (rand() - .5) * .14));
        const k1 = .45 + rand() * .3;
        (lists[name] ||= []).push(m.compose(V(x, this.L.heightAt(x, z) - .3, z), q, V(k1, k1 * (.8 + rand() * .4), k1)).clone());
      }
    }
    for (const [name, matrices] of Object.entries(lists)) {
      const asset = this.kit.assets[name], mesh = new THREE.InstancedMesh(asset.geometry, asset.material, matrices.length);
      matrices.forEach((mm, i) => mesh.setMatrixAt(i, mm)); mesh.castShadow = mesh.receiveShadow = true;
      mesh.computeBoundingSphere(); mesh.name = 'Wild Goose Island trees'; this.group.add(mesh);
    }
  }

  setNight(v) { if (this.waterMaterial) this.waterMaterial.uniforms.bfNight.value = v; }

  dispose() {
    this.group.removeFromParent();
    this.group.children.forEach((m) => m.isInstancedMesh && m.dispose());
    for (const d of this.disposables) d.dispose();
  }
}
