// Out West's landmarks (user, 26 Nov 2026: "a blend of many of the famous Utah and Arizona national parks (Arches,
// Bryce, Monument Valley, Zion) … Moody landscapes and detailed hero structures"), placed by tools/outwest_heroes.py
// (routes/cities/outwest-heroes.json) and built here with the other landmark models (pgh-landmarks.js):
//
//   ow_tunnel     the Kanab Creek tunnel: US 89 through a sandstone fin, three galleries in the downhill wall, the road
//                 shaded inside (a dark film over it, faded at the portals)
//   ow_hoodoos    Hoodoo Rim: Bryce's orange-and-white hoodoos, the tallest away from the road
//   ow_arches     the Arch Garden: a Delicate-style freestanding arch, a double window in a fin, a long thin span
//   ow_buttes     Butte Valley: two mittens, Merrick Butte, a long mesa, the Totem spire, the Three Sisters
//   ow_frontier   the Johnson Canyon movie set: false fronts on a boardwalk, hitching rails, a water tower
//
// The rock is one RockBuilder per landmark (its own mesh: culled on its own) in the shared red-rock material
// (toolbox/landscape/redrock.js); the movie set's timber in the landmarks' solid builder (S).
//   outwestLandmarkModels(ctx) → { models: { ow_*(l) }, finish() }   (finish: the rock meshes into the host's group)
import * as THREE from '../../../../vendor/three.js';
import { RockBuilder, redRockMaterial, ROCK } from '../landscape/redrock.js';
import { makeFrame } from './hero-geom.js';

export function outwestLandmarkModels({ S, glows, local, L, host }) {
  const meshes = [];
  const H = (x, z) => L.heightAt(x, z);
  const keep = (R, name) => { const m = R.mesh(redRockMaterial(), name); if (m) meshes.push(m); };
  const hash = (k) => { const s = Math.sin(k * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };
  const offWay = (x, z, r) => (L.wayDist ? L.wayDist(x, z, r + 2) >= r : true);
  const clear = (x, z, r) => host.addKeepOut?.(x, z, r);   // (the city's trees, poles and cars keep out of the rock)

  const models = {
    ow_tunnel(l) {
      const pts = l.path.map(([a, o]) => local(a, o));
      const R = new RockBuilder();
      const t = R.tunnel(pts, H, H, { hill: l.hill || 1, galleries: l.galleries || [] });
      keep(R, 'Kanab Creek Tunnel');
      if (!t) return;
      // the road in the bore's shade: a dark film just over it (the bore keeps out the sky), faded over 14 m at
      // each portal; lighter at each gallery
      const fr = t.frames, n = fr.length, half = 6.2, pos = [], col = [], idx = [];
      for (let i = 0; i < n; i += 3) { const f = fr[i]; clear(f.x, f.z, 9); clear(f.x + f.nx * 18, f.z + f.nz * 18, 12); clear(f.x - f.nx * 10, f.z - f.nz * 10, 5); }
      let s = 0;
      for (let i = 0; i < n; i++) {
        if (i) s += Math.hypot(fr[i].x - fr[i - 1].x, fr[i].z - fr[i - 1].z);
        const edge = Math.min(1, Math.min(s, t.total - s) / 14);
        const gal = (l.galleries || []).some((q) => Math.abs(s - q * t.total) < 6) ? .55 : 1;
        for (const sd of [-1, 1]) {
          pos.push(fr[i].x + fr[i].nx * sd * half, fr[i].y + .06, fr[i].z + fr[i].nz * sd * half);
          col.push(0, 0, 0, .62 * edge * gal);
        }
        if (i) { const a = 2 * (i - 1); idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4)); g.setIndex(idx);
      g.computeBoundingSphere();
      const film = new THREE.Mesh(g, host.own ? host.own(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })) : new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
      film.name = 'tunnel shade'; film.renderOrder = 2; meshes.push(film);
      // a lamp at each gallery's ceiling (night)
      for (const q of l.galleries || []) { const f = fr[Math.round(q * (n - 1))]; glows.push({ x: f.x, y: f.y + 7.6, z: f.z, size: 2.2, color: '#ffd9a0' }); }
    },

    ow_hoodoos(l) {
      const R = new RockBuilder(), c = local(l.center[0], l.center[1]);
      let k = 0;
      for (const [a, o] of l.points) {
        const q = local(a, o), g = H(q.x, q.z), d = L.wayDist ? L.wayDist(q.x, q.z, 60) : 60;
        if (d < 8) continue;
        // taller away from the road (the camera's close ones human-sized, the far ones towers); in clusters
        const h1 = hash(++k), h2 = hash(k * 3.7), far = Math.min(1, d / 120);
        const h = 6 + far * 26 + h1 * 12, r = 1.4 + h * .1 + h2 * 1.2;
        R.hoodoo(q.x, g, q.z, h, r, k, H); clear(q.x, q.z, r * 1.8);
        // a companion or two, close
        if (h2 > .45) for (let j = 0; j < (h2 > .8 ? 2 : 1); j++) {
          const aa = hash(k * 9.1 + j) * 6.283, dd = r * 2.4 + hash(k * 5.3 + j) * 4, x = q.x + Math.cos(aa) * dd, z = q.z + Math.sin(aa) * dd;
          if (offWay(x, z, 7)) { R.hoodoo(x, H(x, z), z, h * (.45 + hash(k + j) * .4), r * .7, k * 31 + j, H); clear(x, z, r * 1.3); }
        }
      }
      keep(R, 'Hoodoo Rim');
      void c;
    },

    ow_arches(l) {
      for (const [i, A] of (l.arches || []).entries()) {
        const R = new RockBuilder(), q = local(A.center[0], A.center[1]), yaw = (A.faceDeg || 0) * Math.PI / 180;
        const u = { x: Math.sin(yaw), z: -Math.cos(yaw) };   // (faceDeg: the road's bearing — the span runs along it, its face to the road)
        const F = { o: q, u };
        // a slickrock bench under it
        R.lathe(q.x, H(q.x, q.z), q.z, [[42, -2], [36, .8], [24, 2.2], [10, 2.8], [0, 3]], 28, { seed: 40 + i, rough: 1.2, freq: .06, ground: H, sink: 2,
          colorAt: (t) => new THREE.Color().copy(ROCK.slick[0]).lerp(ROCK.slick[2], t * .5) });
        const G = (x, z) => H(x, z) + 2.6;
        clear(q.x, q.z, A.kind === 'landscape' ? 34 : 30);
        if (A.kind === 'delicate') R.arch(F, G, { span: 11, height: 14, thick: 2.2, deep: 2.6, foot: 2.1, seed: 51 });
        else if (A.kind === 'window') {
          // the North and South Windows: two deep, heavy arches side by side through one sandstone fin — the fin's
          // ends and the buttress between them solid, the windows open
          for (const s of [-1, 1]) { const o = { x: q.x + u.x * s * 9.5, z: q.z + u.z * s * 9.5 }; R.arch({ o, u }, G, { span: 13, height: 12, thick: 5, deep: 8, foot: 1.5, seed: 62 + s, pedestal: false }); }
          for (const s of [-1, 1]) { const o = { x: q.x + u.x * s * 27, z: q.z + u.z * s * 27 }; R.fin({ o, u }, G, { len: 20, h: 20, w: 9, seed: 64 + s }); }
          R.fin({ o: q, u }, G, { len: 7, h: 19, w: 8.5, seed: 66 });
        } else R.arch(F, G, { span: 52, height: 15, thick: 2.4, deep: 3.4, foot: 3.2, seed: 71 });
        keep(R, `Arch Garden: ${A.kind}`);
      }
    },

    ow_buttes(l) {
      for (const [i, B] of (l.buttes || []).entries()) {
        const R = new RockBuilder(), q = local(B.center[0], B.center[1]), yaw = hash(i + 3) * Math.PI;
        clear(q.x, q.z, B.kind === 'spire' || B.kind === 'sisters' ? B.R * 3 : B.R * (B.kind === 'mesa' ? 3.2 : 2.3));
        if (B.kind === 'spire') R.spire(q.x, q.z, H, { r: B.R * .4, h: B.H, seed: 21 + i });
        else if (B.kind === 'sisters') for (let k = 0; k < 3; k++) { const x = q.x + (k - 1) * B.R * .6, z = q.z + (k % 2) * B.R * .25; R.spire(x, z, H, { r: B.R * (.16 + k * .03), h: B.H * (.7 + .15 * k), seed: 81 + k }); }
        else {
          R.butte(q.x, q.z, H, { R: B.R, H: B.H, aspect: B.kind === 'mesa' ? 2.6 : B.kind === 'mitten' ? 1.25 : 1.6, yaw, seed: 11 + i * 7, seg: B.kind === 'mesa' ? 150 : 120 });
          if (B.kind === 'mitten') {
            // the thumb: a tall narrow spire standing off one end, its foot in the butte's talus
            const ux = Math.cos(yaw), uz = Math.sin(yaw), x = q.x + ux * B.R * 1.62, z = q.z + uz * B.R * 1.62;
            R.spire(x, z, H, { r: B.R * .15, h: B.H * .9, seed: 91 + i });
          }
        }
        keep(R, B.name);
      }
    },

    ow_frontier(l) {
      // a western street of false fronts, both sides of a dirt street running along axisDeg
      const c = local(l.center[0], l.center[1]), a = (l.axisDeg || 0) * Math.PI / 180, u = { x: Math.sin(a), z: -Math.cos(a) };
      const F = makeFrame(c, u), g0 = H(c.x, c.z);
      const WOOD = ['#8a6a4a', '#9b7a55', '#7a5a3e', '#a58a68', '#6f5640'], PAINT = ['#b8a27a', '#8f4a36', '#5d6f74', '#c8b48e', '#7c6a4f'];
      S.color('#b39878'); S.box(c.x, g0 - .4, c.z, 16, .45, 120, F.yawU);   // (the street's packed dirt)
      for (let a0 = -60; a0 <= 70; a0 += 20) { const p = F.at(a0, 0); clear(p.x, p.z, 26); }
      for (const side of [-1, 1]) {
        let along = -52;
        for (let k = 0; along < 50; k++) {
          const w = 8 + hash(k * 7 + side) * 6, deep = 12 + hash(k * 3 + side) * 6, h = 4.2 + hash(k + side * 5) * 2.4, front = h + 1.8 + hash(k * 2.1) * 2.2;
          const ca = along + w / 2, q = F.at(ca, side * (8 + 2.4 + deep / 2)), g = H(q.x, q.z);
          const col = (hash(k * 1.7 + side) < .5 ? WOOD : PAINT)[k % 5];
          S.color(col); S.box(q.x, g - .5, q.z, deep, h + .5, w - .3, F.yawV);                // the store
          S.color('#5e4a38'); S.pyramid(q.x, g + h, q.z, deep, 1.2, w - .3, F.yawV);         // its low roof behind the front
          const fq = F.at(ca, side * (8 + 2.4 + .15)); S.color(col); S.box(fq.x, g - .5, fq.z, .3, front + .5, w - .2, F.yawV);   // the false front
          S.color('#3e3128'); S.box(fq.x, g + front - .1, fq.z, .5, .3, w, F.yawV);         // its cap
          const sq = F.at(ca, side * (8 + 2.4 - .05)); S.color(hash(k * 4.4) < .5 ? '#e6dcc0' : '#2f2a24'); S.box(sq.x, g + h + .4, sq.z, .08, 1.1, w * .62, F.yawV);   // the sign board
          S.color('#2a2a2c'); const dq = F.at(ca, side * (8 + 2.4 - .08)); S.box(dq.x, g, dq.z, .06, 2.4, 1.3, F.yawV);   // the door
          for (const wsd of [-1, 1]) { const wq = F.at(ca + wsd * w * .28, side * (8 + 2.4 - .08)); S.color('#38414a'); S.box(wq.x, g + .9, wq.z, .06, 1.5, 1.2, F.yawV); }
          // the boardwalk and its porch roof on posts
          const bq = F.at(ca, side * (8 + 1.2)); S.color('#7d6448'); S.box(bq.x, g - .2, bq.z, 2.4, .5, w, F.yawV);
          S.color('#6a5440'); S.box(bq.x, g + 3.1, bq.z, 2.6, .18, w, F.yawV);
          for (const p of [-1, 1]) { const pq = F.at(ca + p * (w / 2 - .3), side * 8.1); S.box(pq.x, g + .3, pq.z, .18, 2.8, .18, F.yawV); }
          // a hitching rail at every other store
          if (k % 2 === 0) { const r0 = F.at(ca - 1.6, side * 7.2), r1 = F.at(ca + 1.6, side * 7.2); S.color('#5a4634'); S.box(r0.x, g, r0.z, .15, 1.05, .15); S.box(r1.x, g, r1.z, .15, 1.05, .15); S.beam(new THREE.Vector3(r0.x, g + 1, r0.z), new THREE.Vector3(r1.x, g + 1, r1.z), .12, .12); }
          if (hash(k * 9.3 + side) < .4) glows.push({ x: bq.x, y: g + 2.9, z: bq.z, size: 1.6, color: '#ffcf8a' });
          along += w + (hash(k * 5.9 + side) < .25 ? 4 : .4);
        }
      }
      // the water tower at the street's far end
      const tq = F.at(62, 14), tg = H(tq.x, tq.z);
      S.color('#4d3c2e'); for (const [dx, dz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) S.box(tq.x + dx, tg, tq.z + dz, .3, 8, .3);
      S.color('#7a6048'); S.cylinder(tq.x, tg + 8, tq.z, 2.6, 4, 16); S.color('#4a3a2c'); S.cylinder(tq.x, tg + 12, tq.z, 2.8, 1.2, 16, .4);
    },
  };

  return {
    models,
    finish() {
      for (const m of meshes) { host.group.add(m); host.own?.(m.geometry); }
      return meshes.reduce((s, m) => s + (m.userData.tris || 0), 0);
    },
  };
}
