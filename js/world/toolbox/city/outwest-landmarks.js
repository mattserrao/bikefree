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
      // (and 45 m out from each portal: no pole or wire runs into the rock face)
      for (const [f, sg] of [[fr[0], -1], [fr[n - 1], 1]]) for (let m = 0; m <= 45; m += 9) for (const sd of [-1, 1]) clear(f.x + f.tx * sg * m + f.nx * sd * 10, f.z + f.tz * sg * m + f.nz * sd * 10, 6);
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
      // Bryce's amphitheater: the hoodoos stand in rows (the joints the rain cut the plateau along) — fins and capped
      // spires in ranks stepping back from the road, short near it, towers far off; the odd lone spire between
      const R = new RockBuilder();
      let k = 0;
      const rowYaw = .6;   // (the joints' bearing: one set across the field)
      for (const [a, o] of l.points) {
        const q = local(a, o), d = L.wayDist ? L.wayDist(q.x, q.z, 80) : 80;
        if (d < 8) continue;
        const h1 = hash(++k), h2 = hash(k * 3.7), far = Math.min(1, d / 140);
        const h = 5 + far * 28 + h1 * 12, r = 1.2 + h * .09 + h2 * 1.1;
        R.hoodoo(q.x, H(q.x, q.z), q.z, h, r, k, H, { yaw: rowYaw }); clear(q.x, q.z, r * 1.8);
        // its rank: two to five more along the joint, a few metres apart, heights wandering
        const n = 2 + Math.floor(hash(k * 5.1) * (2 + far * 2)), ux = Math.cos(rowYaw), uz = -Math.sin(rowYaw);
        for (let j = 1; j <= n; j++) {
          const sd = (j % 2 ? 1 : -1) * Math.ceil(j / 2), step = r * 2.3 + hash(k * 9.1 + j) * 2.5;
          const x = q.x + ux * sd * step + (hash(k + j * 3.3) - .5) * 2, z = q.z + uz * sd * step + (hash(k * 2 + j) - .5) * 2;
          if (!offWay(x, z, 7)) continue;
          const hh = h * (.6 + hash(k * 7.7 + j) * .55);
          R.hoodoo(x, H(x, z), z, hh, r * (.75 + hash(k + j) * .4), k * 31 + j, H, { yaw: rowYaw }); clear(x, z, r * 1.5);
        }
      }
      keep(R, 'Hoodoo Rim');
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
      // a western street of false fronts, both sides of a dirt street running along axisDeg: each store a plain box
      // behind a tall board front — stepped, gabled or flat-capped — with a cornice, two upper windows, a painted sign
      // with its border, a door and shop windows under a porch roof on posts over the boardwalk; a two-storey saloon with
      // a balcony, a white church with a steeple at the far end, barrels, a trough and a wagon in the street
      const c = local(l.center[0], l.center[1]), a = (l.axisDeg || 0) * Math.PI / 180, u = { x: Math.sin(a), z: -Math.cos(a) };
      const F = makeFrame(c, u), g0 = H(c.x, c.z), V3 = (q, y) => new THREE.Vector3(q.x, y, q.z);
      const WOOD = ['#8a6a4a', '#9b7a55', '#7a5a3e', '#a58a68', '#6f5640'], PAINT = ['#b8a27a', '#8f4a36', '#5d6f74', '#c8b48e', '#7c6a4f', '#a6653e'];
      const SIGN = ['#e6dcc0', '#2f2a24', '#7a2a22', '#2c3d33'];
      S.color('#b39878'); S.box(c.x, g0 - .4, c.z, 16, .45, 130, F.yawU);   // (the street's packed dirt)
      for (let a0 = -60; a0 <= 70; a0 += 20) { const p = F.at(a0, 0); clear(p.x, p.z, 26); }
      // a board on the front plane (along u at b), from a0 to a1, y0 to y1, sticking out `out`
      const board = (a0, a1, b, y0, y1, out, col) => { const q = F.at((a0 + a1) / 2, b); S.color(col); S.box(q.x, y0, q.z, out, y1 - y0, Math.abs(a1 - a0), F.yawV); };
      for (const side of [-1, 1]) {
        let along = -55;
        for (let k = 0; along < 52; k++) {
          const saloon = side === 1 && k === 2;
          const w = saloon ? 14 : 8 + hash(k * 7 + side) * 5, deep = 12 + hash(k * 3 + side) * 6, h = saloon ? 7.6 : 4.2 + hash(k + side * 5) * 1.6;
          const front = saloon ? 10.2 : h + 1.8 + hash(k * 2.1) * 2;
          const ca = along + w / 2, fb = side * (8 + 2.4), q = F.at(ca, side * (8 + 2.4 + deep / 2)), g = H(q.x, q.z);
          const col = (saloon ? PAINT : hash(k * 1.7 + side) < .5 ? WOOD : PAINT)[k % 5], trim = hash(k * 4.9 + side) < .5 ? '#efe6cf' : '#4a3a2c';
          S.color(col); S.box(q.x, g - .5, q.z, deep, h + .5, w - .3, F.yawV);                  // the store
          S.color('#5e4a38'); S.pyramid(q.x, g + h, q.z, deep, 1.1, w - .3, F.yawV);            // its low roof behind the front
          // the false front: the board wall, its top stepped / gabled / flat, a cornice and the corner boards
          const top = saloon ? 'flat' : ['step', 'gable', 'flat', 'step'][Math.floor(hash(k * 6.1 + side) * 4)];
          board(along + .1, along + w - .1, fb, g - .5, g + front, .3, col);
          if (top === 'step') { board(along + w * .25, along + w * .75, fb, g + front, g + front + 1.1, .3, col); board(along + w * .22, along + w * .78, fb + side * -.05, g + front + 1.05, g + front + 1.3, .45, trim); }
          else if (top === 'gable') { const p = F.at(ca, fb); S.color(col); S.pyramid(p.x, g + front, p.z, .3, 1.6, w - .2, F.yawV); }
          board(along, along + w, fb - side * .08, g + front - .25, g + front + .05, .5, trim);   // the cornice
          for (const e of [along + .2, along + w - .2]) board(e - .12, e + .12, fb - side * .1, g - .3, g + front - .25, .14, trim);
          // upper windows (frames, dark glass, lit at night) above the porch
          const nW = saloon ? 4 : 2;
          for (let j = 0; j < nW; j++) {
            const wa = along + w * (j + .5) / nW, wq = F.at(wa, fb - side * .17), yb = g + (saloon ? 4.4 : 3.6);
            S.color(trim); S.box(wq.x, yb - .1, wq.z, .1, 1.6, 1.1, F.yawV);
            S.color('#2b3138'); S.box(wq.x - side * u.z * 0, yb, wq.z, .12, 1.35, .85, F.yawV);
            if (hash(k * 3.3 + j) < .5) glows.push({ x: wq.x, y: yb + .7, z: wq.z, size: 1.1, color: '#ffc77a' });
          }
          // the sign: a painted board with its border, over the porch roof
          const sc = SIGN[Math.floor(hash(k * 4.4 + side) * 4)], sq = F.at(ca, fb - side * .2);
          S.color(trim); S.box(sq.x, g + front - 1.55, sq.z, .08, 1.15, w * .68, F.yawV);
          S.color(sc); S.box(sq.x - side * u.z * 0, g + front - 1.48, sq.z, .12, 1.0, w * .62, F.yawV);
          S.color(sc === '#e6dcc0' ? '#3a2a20' : '#e8dcbc'); for (let j = 0; j < 5; j++) { const lq = F.at(ca + (j - 2) * w * .1, fb - side * .27); S.box(lq.x, g + front - 1.15 - (j % 2) * .2, lq.z, .05, .22, w * .07, F.yawV); }   // (its letters, suggested)
          // the door and the shop windows under the porch
          const dq = F.at(ca, fb - side * .12); S.color('#2a2420'); S.box(dq.x, g, dq.z, .1, 2.4, 1.3, F.yawV); S.color(trim); S.box(dq.x, g + 2.4, dq.z, .14, .15, 1.6, F.yawV);
          for (const wsd of [-1, 1]) { const wq = F.at(ca + wsd * w * .3, fb - side * .12); S.color(trim); S.box(wq.x, g + .65, wq.z, .1, 1.75, 1.6, F.yawV); S.color('#38414a'); S.box(wq.x, g + .75, wq.z, .14, 1.55, 1.35, F.yawV); }
          // the boardwalk, its porch roof on posts (the saloon's a balcony with a rail above)
          const bq = F.at(ca, side * (8 + 1.2)); S.color('#7d6448'); S.box(bq.x, g - .2, bq.z, 2.4, .5, w, F.yawV);
          S.color('#6a5440'); S.box(bq.x, g + 3.1, bq.z, 2.6, .18, w, F.yawV);
          for (let p = 0; p <= Math.round(w / 3.2); p++) { const pq = F.at(along + .3 + p * (w - .6) / Math.round(w / 3.2), side * 8.1); S.box(pq.x, g + .3, pq.z, .18, 2.8, .18, F.yawV); }
          if (saloon) { const r0 = F.at(along + .3, side * 8.1), r1 = F.at(along + w - .3, side * 8.1); S.color('#5a4634'); S.beam(V3(r0, g + 4.1), V3(r1, g + 4.1), .1, .1); for (let p = 0; p < 12; p++) { const pq = F.at(along + .4 + p * (w - .8) / 11, side * 8.1); S.box(pq.x, g + 3.3, pq.z, .06, .8, .06); } }
          // a hitching rail at every other store; barrels and a trough here and there
          if (k % 2 === 0) { const r0 = F.at(ca - 1.6, side * 7.2), r1 = F.at(ca + 1.6, side * 7.2); S.color('#5a4634'); S.box(r0.x, g, r0.z, .15, 1.05, .15); S.box(r1.x, g, r1.z, .15, 1.05, .15); S.beam(V3(r0, g + 1), V3(r1, g + 1), .12, .12); }
          if (hash(k * 8.8 + side) < .45) for (let j = 0; j < 2; j++) { const bq2 = F.at(along + 1 + j * .75, side * 7.6); S.color('#6e5236'); S.cylinder(bq2.x, g, bq2.z, .32, .9, 10, .28); S.color('#3a3530'); S.cylinder(bq2.x, g + .2, bq2.z, .335, .06, 10); S.cylinder(bq2.x, g + .7, bq2.z, .325, .06, 10); }
          if (k === 1) { const tq = F.at(ca, side * 6.6); S.color('#5c4a36'); S.box(tq.x, g, tq.z, .7, .6, 2.4, F.yawU); S.color('#5f7c86'); S.box(tq.x, g + .5, tq.z, .5, .06, 2.2, F.yawU); }
          if (hash(k * 9.3 + side) < .4) glows.push({ x: bq.x, y: g + 2.9, z: bq.z, size: 1.6, color: '#ffcf8a' });
          along += w + (hash(k * 5.9 + side) < .25 ? 4 : .4);
        }
      }
      // a wagon in the street: its bed, four spoked wheels, the tongue
      { const wq = F.at(-12, -2.5), g = H(wq.x, wq.z); S.color('#7a5b3c'); S.box(wq.x, g + .9, wq.z, 1.6, .5, 3.6, F.yawU);
        for (const [da, db] of [[-1.3, -.95], [1.3, -.95], [-1.3, .95], [1.3, .95]]) { const p = F.at(-12 + da, -2.5 + db); S.color('#4a3a2a'); S.cylinder(p.x, g + .55, p.z, .55, .08, 12); }
        const t0 = F.at(-10.2, -2.5), t1 = F.at(-7.6, -2.5); S.color('#5a4634'); S.beam(V3(t0, g + .9), V3(t1, g + .4), .1, .1); }
      // the church at the street's far end: white boards, a steep roof, a steeple
      { const cq = F.at(-72, 0), g = H(cq.x, cq.z); S.color('#e9e2d2'); S.box(cq.x, g - .5, cq.z, 9, 6.5, 14, F.yawU); S.color('#4a4038'); S.pyramid(cq.x, g + 6, cq.z, 9.4, 3.6, 14.4, F.yawU);
        const sq = F.at(-65.5, 0); S.color('#e9e2d2'); S.box(sq.x, g - .5, sq.z, 3, 11, 3, F.yawU); S.color('#4a4038'); S.pyramid(sq.x, g + 10.5, sq.z, 3.3, 5, 3.3, F.yawU);
        const dq = F.at(-64, 0); S.color('#5a3a2a'); S.box(dq.x, g, dq.z, 1.4, 2.4, .1, F.yawU); clear(cq.x, cq.z, 14); }
      // the water tower at the street's other end
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
