// The shoreline: where the ground meets a lake or river, a band of wet sand and pebbles on the land side, a pale
// shallow-water band lapping on the water side (fading out), and reed clumps in the shallows of gentle shores — in
// place of the hard line the ground's triangles cut through the water plane.
//
// Per tile, after its ground is built: the drawn ground (world.surfaceH) less the water top (world.waterTop) is
// sampled on a fine grid and its zero contour traced (marching squares); each contour vertex is offset along the
// field's own gradient, so neighbouring pieces share their edges (no seams, no overlaps).
// Options: { cell: 2 (m), beach: [1.5, 4] (m inland), shallows: 9 (m out), reeds: 0.35 (clumps per 10 m of gentle shore) }
import * as THREE from '../../../../vendor/three.module.min.js';
import { due } from '../core/jobs.js';

const hash = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };

/** One reed clump (a fan of tapered blades and a few seed heads), ~1.4 m tall, base at the origin. */
function reedClump() {
  const pos = [], col = [];
  const blade = (ang, lean, h, w, c) => {
    const dx = Math.cos(ang), dz = Math.sin(ang), px = -dz * w, pz = dx * w, tx = dx * lean, tz = dz * lean;
    pos.push(-px, 0, -pz, px, 0, pz, tx, h, tz);
    col.push(...c, ...c, c[0] * 1.25, c[1] * 1.2, c[2] * 1.1);
  };
  for (let k = 0; k < 11; k++) {
    const a = k * 2.399, r = hash(k, 3), g = [0.34 + 0.12 * r, 0.42 + 0.1 * r, 0.2];
    blade(a, 0.15 + 0.35 * hash(k, 7), 0.9 + 0.6 * hash(k, 9), 0.035, g);
  }
  for (let k = 0; k < 3; k++) {   // cattail heads: a dark brown spindle on a stalk
    const a = k * 2.1 + 0.4, x = Math.cos(a) * 0.12, z = Math.sin(a) * 0.12, y0 = 1.05 + 0.2 * hash(k, 1), b = [0.32, 0.22, 0.13];
    for (let s = 0; s < 3; s++) {
      const q = s * 2.094, cx = Math.cos(q) * 0.045, cz = Math.sin(q) * 0.045, q2 = q + 2.094, ex = Math.cos(q2) * 0.045, ez = Math.sin(q2) * 0.045;
      pos.push(x + cx, y0, z + cz, x + ex, y0, z + ez, x, y0 + 0.28, z); col.push(...b, ...b, ...b);
      pos.push(x + ex, y0, z + ez, x + cx, y0, z + cz, x, y0 - 0.06, z); col.push(...b, ...b, ...b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export const shoreline = {
  install(world, opts = {}) {
    const CELL = opts.cell ?? 2, [B0, B1] = opts.beach ?? [1.5, 4], SH = opts.shallows ?? 9, REEDS = opts.reeds ?? 0.35;
    const uTime = { value: 0 };
    const lap = (m) => {
      // the water band's edge laps: its alpha breathes along the shore
      m.onBeforeCompile = (s) => {
        s.uniforms.uTime = uTime;
        s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 bfShoreP;').replace('#include <project_vertex>', '#include <project_vertex>\nbfShoreP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 bfShoreP;\nuniform float uTime;')
          .replace('#include <opaque_fragment>', 'diffuseColor.a *= 0.78 + 0.22 * sin(uTime * 1.3 + bfShoreP.x * 0.31 + bfShoreP.z * 0.23);\n#include <opaque_fragment>');
      };
      m.customProgramCacheKey = () => 'bf-shore-lap-1';
      return m;
    };
    const mats = {
      beach: new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      shallows: lap(new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })),
      reed: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    };
    const reed = reedClump();
    const top = (x, z) => world.waterTop(x, z);
    const walled = (x, z) => { const sh = world.shore?.at?.(x, z); return !!(sh && sh.walled && sh.s > -16 && sh.s < 30); };
    // the colours along the bands (rgba): wet sand at the water, dry pebbles, then the grass's own colour (alpha 0)
    const WET = [0.36, 0.33, 0.27, 0.95], PEB = [0.6, 0.56, 0.47, 0.75], DRY = [0.62, 0.6, 0.48, 0];
    const FOAM = [0.8, 0.86, 0.82, 0.72], SHAL = [0.47, 0.66, 0.63, 0.5], DEEP = [0.3, 0.48, 0.55, 0];

    return {
      tick(t) { uTime.value = t; },
      *tileJob(t) {
        const T = world.TILE, x0 = t.i * T, z0 = t.j * T;
        // a cheap look first: no water near this tile, or all of it under water → nothing to do
        let lo = Infinity, hi = -Infinity;
        for (let j = 0; j <= 8; j++) for (let i = 0; i <= 8; i++) { const x = x0 + (i * T) / 8, z = z0 + (j * T) / 8, s = world.surfaceH(x, z) - top(x, z); lo = Math.min(lo, s); hi = Math.max(hi, s); }
        if (lo > 4 || hi < -1) return;
        const n = Math.round(T / CELL), n1 = n + 1, S = new Float32Array(n1 * n1);
        for (let j = 0; j <= n; j++) {
          if (due()) yield;
          for (let i = 0; i <= n; i++) { const x = x0 + i * CELL, z = z0 + j * CELL; S[j * n1 + i] = world.surfaceH(x, z) - top(x, z); }
        }
        const field = (x, z) => world.surfaceH(x, z) - top(x, z);
        const grad = (x, z) => { const e = 0.8, gx = field(x + e, z) - field(x - e, z), gz = field(x, z + e) - field(x, z - e), l = Math.hypot(gx, gz) || 1; return [gx / l, gz / l, l / (2 * e)]; };
        // the contour's segments (marching squares), each end on a cell edge
        const segs = [];
        const edgePt = (i0, j0, i1, j1) => { const a = S[j0 * n1 + i0], b = S[j1 * n1 + i1], f = a / (a - b); return [x0 + (i0 + (i1 - i0) * f) * CELL, z0 + (j0 + (j1 - j0) * f) * CELL]; };
        for (let j = 0; j < n; j++) {
          if (due()) yield;
          for (let i = 0; i < n; i++) {
            const a = S[j * n1 + i], b = S[j * n1 + i + 1], c = S[(j + 1) * n1 + i + 1], d = S[(j + 1) * n1 + i];
            const code = (a > 0) | ((b > 0) << 1) | ((c > 0) << 2) | ((d > 0) << 3);
            if (code === 0 || code === 15) continue;
            const E = [() => edgePt(i, j, i + 1, j), () => edgePt(i + 1, j, i + 1, j + 1), () => edgePt(i, j + 1, i + 1, j + 1), () => edgePt(i, j, i, j + 1)];
            const pairs = { 1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 5: [[3, 0], [1, 2]], 6: [[0, 2]], 7: [[3, 2]], 8: [[2, 3]], 9: [[0, 2]], 10: [[0, 1], [2, 3]], 11: [[1, 2]], 12: [[1, 3]], 13: [[0, 1]], 14: [[0, 3]] }[code];
            for (const [p, q] of pairs) segs.push([E[p](), E[q]()]);
          }
        }
        if (!segs.length) return;
        // the bands: each contour point offset inland (beach) and out (shallows) along the gradient, shared by its
        // two segments through a cache keyed on the point (they meet exactly on the cell edge)
        const cache = new Map();
        const ptOf = ([x, z]) => {
          const key = `${Math.round(x * 100)},${Math.round(z * 100)}`;
          let P = cache.get(key);
          if (!P) {
            const [gx, gz, slope] = grad(x, z), wB = B0 + (B1 - B0) * hash(Math.round(x / 6), Math.round(z / 6)), y0 = top(x, z);
            const land = (d) => { const px = x + gx * d, pz = z + gz * d; return [px, world.surfaceH(px, pz) + 0.04, pz]; };
            const sea = (d) => [x - gx * d, y0 + 0.015, z - gz * d];
            P = { x, z, slope, wall: walled(x, z), rows: [land(wB), land(wB * 0.45), [x, Math.max(y0 + 0.03, world.surfaceH(x, z) + 0.04), z], sea(SH * 0.12), sea(SH * 0.4), sea(SH)] };
            cache.set(key, P);
          }
          return P;
        };
        const bPos = [], bCol = [], wPos = [], wCol = [];
        const ROWC = [DRY, PEB, WET], WROWC = [FOAM, FOAM, SHAL, DEEP];
        const quad = (pos, col, A, B, c0, c1) => {
          pos.push(...A[0], ...B[0], ...B[1], ...A[0], ...B[1], ...A[1]);
          col.push(...c0, ...c0, ...c1, ...c0, ...c1, ...c1);
        };
        let reedN = 0; const reeds = [];
        for (let k = 0; k < segs.length; k++) {
          if ((k & 255) === 0 && due()) yield;
          const A = ptOf(segs[k][0]), B = ptOf(segs[k][1]);
          if (A.wall || B.wall) continue;   // (a walled river front: the wall is the edge)
          // beach rows 0→1→2 (outer, mid, at the water); water rows 2→3→4→5
          for (let r = 0; r < 2; r++) quad(bPos, bCol, [A.rows[r], A.rows[r + 1]], [B.rows[r], B.rows[r + 1]], ROWC[r], ROWC[r + 1]);
          for (let r = 2; r < 5; r++) quad(wPos, wCol, [A.rows[r], A.rows[r + 1]], [B.rows[r], B.rows[r + 1]], WROWC[r - 2], WROWC[r - 1]);
          // reeds on gentle shores (a shallow slope), in patches
          const len = Math.hypot(B.x - A.x, B.z - A.z), mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
          if (REEDS > 0 && A.slope < 0.35 && hash(Math.round(mx / 25), Math.round(mz / 25)) < 0.45 && hash(mx, mz) < (REEDS * len) / 10) {
            const [gx, gz] = grad(mx, mz), d = 0.4 + 1.6 * hash(mz, mx);
            reeds.push([mx - gx * d, top(mx, mz) - 0.3, mz - gz * d, hash(mx * 3, mz), 0.7 + 0.6 * hash(mz * 3, mx)]); reedN++;
          }
        }
        const mesh = (pos, col, mat, name) => {
          if (!pos.length) return;
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
          g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
          g.computeVertexNormals();
          const m = new THREE.Mesh(g, mat); m.name = name; m.renderOrder = 2;
          world.group.add(m); (t.extra ||= []).push(m);
        };
        mesh(bPos, bCol, mats.beach, 'shore beach');
        mesh(wPos, wCol, mats.shallows, 'shore shallows');
        // fix the normals of the bands to straight up (the beach drapes on the ground; the water band is flat)
        for (const m of t.extra.slice(-2)) if (m.name?.startsWith('shore')) { const nr = m.geometry.attributes.normal; for (let q = 0; q < nr.count; q++) nr.setXYZ(q, 0, 1, 0); }
        if (reedN) {
          const im = new THREE.InstancedMesh(reed.clone(), mats.reed, reedN), M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), P3 = new THREE.Vector3(), S3 = new THREE.Vector3();
          reeds.forEach(([x, y, z, a, s], q) => { Q.setFromAxisAngle(Y, a * 6.283); S3.set(s, s * (0.85 + 0.3 * a), s); im.setMatrixAt(q, M4.compose(P3.set(x, y, z), Q, S3)); });
          im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.name = 'shore reeds';
          world.group.add(im); t.extra.push(im);
        }
      },
      dispose() { reed.dispose(); for (const m of Object.values(mats)) m.dispose(); },
    };
  },
};
