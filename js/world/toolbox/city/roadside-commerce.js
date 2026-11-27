// Roadside businesses (business pass, user 26 Nov — "gas station, fast food / diner, strip mall + pylon sign"): the
// pieces every American road has, placed where OpenStreetMap maps them (tools/fetch_commerce.py →
// routes/cities/<id>-commerce.json). The buildings themselves are already drawn from the city data; this adds what
// makes them read as what they are:
//   fuel       a filling station: the forecourt, the pump canopy on its columns (its fascia in the brand's colour, the
//              underside lit), pump islands, the shop behind, the price sign on its pylon by the road
//   fast_food  the chain's look on its building: a coloured mansard band round the roof, a tall pole sign by the road,
//              the drive-thru's menu board
//   strip      a strip mall: a continuous canopy along its shopfronts on posts, a fascia band, and the pylon sign by
//              the road with its tenants' panels
// All in one merged mesh (rebuilt as the rider moves through the map: the places within reach), so they cost one draw call.
//
//   const C = new RoadsideCommerce(world, city, json)    C.tick(camera)    C.dispose()
import * as THREE from '../../../../vendor/three.js';
import { MeshBuilder, hash } from '../core/mesh-builder.js';
import { litMaterial } from '../materials/lit.js';

const BRANDS = ['#c8102e', '#0a4ea2', '#1d7a3a', '#f2b705', '#e35205', '#6b2c91', '#00838f'];
const CHAINS = ['#b5221a', '#d99a1c', '#7a3b1e', '#1f6b6b', '#c4301f', '#2b4c8c'];
const REACH = 900, MOVE = 220;

export class RoadsideCommerce {
  constructor(world, city, json) {
    this.world = world; this.city = city; this.mesh = null; this.at = null;
    this.material = litMaterial({ vertexColors: true }, 'default');
    this.places = (json.places || []).map((p) => {
      const q = world.proj.toLocal(p.lat, p.lon);
      return { ...p, x: q.x, z: q.z, pts: p.ring ? p.ring.map(([la, lo]) => world.proj.toLocal(la, lo)) : null };
    });
  }

  tick(camera) {
    const c = camera.position, W = this.world;
    if (!W.ground || (this.at && Math.hypot(c.x - this.at.x, c.z - this.at.z) < MOVE)) return;
    this.at = { x: c.x, z: c.z };
    const M = new MeshBuilder();
    let n = 0;
    for (const p of this.places) {
      if (Math.hypot(p.x - c.x, p.z - c.z) > REACH) continue;
      const r = this.city.roadNear(p.x, p.z, 70);
      if (!r) continue;
      if (p.kind === 'fuel') this._fuel(M, p, r); else if (p.kind === 'fast_food') this._fastFood(M, p, r); else if (p.kind === 'strip') this._strip(M, p, r);
      n++;
    }
    if (this.mesh) { this.mesh.parent?.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
    if (!n) return;
    this.mesh = new THREE.Mesh(M.geometry(), this.material);
    this.mesh.name = 'Roadside businesses'; this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    W.scene.add(this.mesh);
  }

  _y(x, z) { const h = this.world.surfaceH?.(x, z) ?? this.world.heightAt?.(x, z); return Number.isFinite(h) ? h : 0; }

  /** The footprint's centre, its long side's direction and its size along / across that side. */
  _rect(pts) {
    let cx = 0, cz = 0; for (const p of pts) { cx += p.x; cz += p.z; } cx /= pts.length; cz /= pts.length;
    let yaw = 0, best = 0;
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], l = Math.hypot(b.x - a.x, b.z - a.z); if (l > best) { best = l; yaw = Math.atan2(b.x - a.x, b.z - a.z); } }
    const ux = Math.sin(yaw), uz = Math.cos(yaw);
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of pts) { const a = (p.x - cx) * ux + (p.z - cz) * uz, b = (p.x - cx) * uz - (p.z - cz) * ux; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
    const ac = (a0 + a1) / 2, bc = (b0 + b1) / 2;
    return { x: cx + ux * ac + uz * bc, z: cz + uz * ac - ux * bc, yaw, L: a1 - a0, Wd: b1 - b0, ux, uz };
  }

  /** A pylon sign by the road at (x, z): two posts, panels stacked (colours), a cap. */
  _pylon(M, x, z, yaw, h, panels, w = 2.6) {
    const y = this._y(x, z), ax = Math.cos(yaw), az = -Math.sin(yaw);
    M.color('#4a4d50'); for (const s of [-1, 1]) M.box(x + ax * s * w * .35, y, z + az * s * w * .35, .28, h, .28, yaw);
    let top = y + h;
    for (const col of panels) { top -= 1.05; M.color(col); M.box(x, top, z, w, 1, .35, yaw); M.color('#f4f1e8'); M.box(x, top + .38, z, w * .7, .18, .37, yaw); }
    M.color('#2f3133'); M.box(x, y + h, z, w + .3, .25, .45, yaw);
  }

  _fuel(M, p, r) {
    const brand = BRANDS[Math.floor(hash(p.x * .13 + p.z * .07) * BRANDS.length)];
    let cx = p.x, cz = p.z, yaw = Math.atan2(r.dx, r.dz), L = 16, Wd = 9;
    if (p.pts && p.pts.length > 3) { const R = this._rect(p.pts); if (R.L * R.Wd < 700 && R.L > 6) { cx = R.x; cz = R.z; yaw = R.yaw; L = R.L; Wd = Math.max(6, R.Wd); } }
    const ux = Math.sin(yaw), uz = Math.cos(yaw), vx = uz, vz = -ux, y = this._y(cx, cz);
    // away from the road: the side the shop stands on
    const away = Math.sign((cx - r.px) * vx + (cz - r.pz) * vz) || 1;
    M.color('#9a9892'); M.box(cx + vx * away * 4, y - .08, cz + vz * away * 4, Wd + 14, .12, L + 8, yaw);   // the forecourt
    M.color('#eeeeea');
    for (const a of [-.36, .36]) for (const b of [-.3, .3]) M.box(cx + ux * a * L + vx * b * Wd, y, cz + uz * a * L + vz * b * Wd, .5, 4.7, .5, yaw);
    M.color('#f4f3ef'); M.box(cx, y + 4.7, cz, Wd, .75, L, yaw);   // the canopy
    M.color(brand); M.box(cx, y + 4.82, cz, Wd + .1, .38, L + .1, yaw);   // its fascia stripe
    M.color('#fff6dc'); M.box(cx, y + 4.62, cz, Wd - .6, .08, L - .6, yaw);   // the lit underside
    for (const a of [-.22, .22]) for (const b of [-.18, .18]) {
      const ix = cx + ux * a * L + vx * b * Wd, iz = cz + uz * a * L + vz * b * Wd;
      M.color('#bdbbb4'); M.box(ix, y, iz, 1.1, .2, 3.4, yaw);
      for (const s of [-1, 1]) { M.color(s > 0 ? brand : '#e8e8e4'); M.box(ix + ux * s * .9, y + .2, iz + uz * s * .9, .55, 1.7, .5, yaw); }
    }
    // the shop: across the forecourt from the road, its glass toward the pumps
    const sx = cx + vx * away * (Wd / 2 + 8), sz = cz + vz * away * (Wd / 2 + 8);
    M.color('#d8cfbd'); M.box(sx, y, sz, 9, 4.2, Math.min(18, L + 2), yaw);
    M.color('#22303a'); M.box(sx - vx * away * 4.52, y + .2, sz - vz * away * 4.52, .1, 2.6, Math.min(16, L), yaw);
    M.color(brand); M.box(sx - vx * away * 4.55, y + 3.2, sz - vz * away * 4.55, .15, .8, Math.min(17, L + 1), yaw);
    // the price sign at the road's edge
    const ex = r.px + (cx - r.px) * ((r.half + 2.5) / Math.max(1, r.d)), ez = r.pz + (cz - r.pz) * ((r.half + 2.5) / Math.max(1, r.d));
    this._pylon(M, ex, ez, Math.atan2(r.dx, r.dz), 6.5, [brand, '#1c1d1f', '#1c1d1f'], 2.4);
  }

  _fastFood(M, p, r) {
    const chain = CHAINS[Math.floor(hash(p.x * .31 + p.z * .17) * CHAINS.length)];
    if (p.pts && p.pts.length > 3) {
      const R = this._rect(p.pts);
      if (R.L < 45 && R.Wd < 35) {
        // the mansard: a sloped band round the roof edge in the chain's colour, a light coping on top
        const y = this._y(R.x, R.z) + 3.3, hl = R.L / 2, hw = R.Wd / 2;
        for (const [ox, oz, w, l] of [[0, hl, R.Wd + .8, .5], [0, -hl, R.Wd + .8, .5], [hw, 0, .5, R.L + .8], [-hw, 0, .5, R.L + .8]]) {
          const x = R.x + R.uz * ox + R.ux * oz, z = R.z - R.ux * ox + R.uz * oz;
          M.color(chain); M.box(x, y, z, w, 1.3, l, R.yaw);
          M.color('#ece7da'); M.box(x, y + 1.3, z, w + .1, .18, l + .1, R.yaw);
        }
        // the drive-thru's menu board on the side away from the road
        const away = Math.sign((R.x - r.px) * R.uz - (R.z - r.pz) * R.ux) || 1, bx = R.x + R.uz * away * (hw + 3.5), bz = R.z - R.ux * away * (hw + 3.5), by = this._y(bx, bz);
        M.color('#3a3c3f'); M.box(bx, by, bz, .2, 1.1, .2, R.yaw); M.color('#1d1f22'); M.box(bx, by + 1.1, bz, .25, 1.3, 2, R.yaw);
        M.color(chain); M.box(bx, by + 2.4, bz, .3, .25, 2.1, R.yaw);
      }
    }
    // the tall pole sign by the road
    const ex = r.px + (p.x - r.px) * ((r.half + 3) / Math.max(1, r.d)), ez = r.pz + (p.z - r.pz) * ((r.half + 3) / Math.max(1, r.d));
    const y = this._y(ex, ez), yaw = Math.atan2(r.dx, r.dz);
    M.color('#55585b'); M.cylinder(ex, y, ez, .22, 8.5, 8, .2);
    M.color(chain); M.box(ex, y + 8.5, ez, 3.2, 2.2, .45, yaw);
    M.color('#f6f2e6'); M.box(ex, y + 9.2, ez, 2.4, .5, .47, yaw);
  }

  _strip(M, p, r) {
    if (!p.pts || p.pts.length < 4) return;
    const R = this._rect(p.pts);
    // the long side nearer the road carries the canopy
    const side = Math.sign((r.px - R.x) * R.uz - (r.pz - R.z) * R.ux) || 1, hw = R.Wd / 2, y = this._y(R.x, R.z);
    const fx = R.x + R.uz * side * (hw + 1.3), fz = R.z - R.ux * side * (hw + 1.3);
    M.color('#cfc8b6'); M.box(fx, y + 3.7, fz, 2.6, .5, R.L, R.yaw);
    M.color('#b8ad96'); M.box(fx + R.uz * side * 1.3, y + 3.3, fz - R.ux * side * 1.3, .2, 1.1, R.L + .2, R.yaw);   // the sign fascia
    const n = Math.max(2, Math.round(R.L / 6));
    M.color('#8d8679');
    for (let k = 0; k <= n; k++) { const a = -R.L / 2 + R.L * k / n; M.box(fx + R.ux * a + R.uz * side * 1.1, y, fz + R.uz * a - R.ux * side * 1.1, .3, 3.7, .3, R.yaw); }
    const ex = r.px + (R.x - r.px) * ((r.half + 3) / Math.max(1, r.d)), ez = r.pz + (R.z - r.pz) * ((r.half + 3) / Math.max(1, r.d));
    const tenants = [0, 1, 2, 3].map((k) => BRANDS[Math.floor(hash(R.x * .7 + k * 3.1) * BRANDS.length)]);
    this._pylon(M, ex, ez, Math.atan2(r.dx, r.dz), 8.5, tenants, 3.2);
  }

  dispose() { if (this.mesh) { this.mesh.parent?.remove(this.mesh); this.mesh.geometry.dispose(); } this.material.dispose(); }
}
