// A rustic split-rail fence along the ways (user, 25 Nov 2026 — the Zwift reference: "a textured split-rail wooden
// fence, lamppost"): stretches of weathered post-and-two-rail fence a little out from the edge of the ways of the kinds
// a map names, on one side or both, with breaks; each post set on the ground, the rails hewn (four-sided, a little
// irregular, each its own shade) and textured in the shader — the grain along the rail, checks and splits, silver-grey
// weathering with brown where it's sheltered. A gap wherever another way passes within reach of the line, at the
// junctions, on decks and in water. One mesh per tile (in tile.extra).
// Options: { kinds: ['drive'], share: .35 (of each side in stretches), offset: 2 (m past the edge and any sidewalk: clear of the
// verge the QC keeps free — tools/qc-map.js edgeLip probes 1.2 m out),
// height: 1.05, post: 2.7 (m between posts), both: .4 (chance a stretch has its twin across the way) }.
import * as THREE from '../../../../vendor/three.js';
import { litMaterial } from '../materials/lit.js';
import { hash } from '../core/mesh-builder.js';
import { due } from '../core/jobs.js';

const vn = (x, seed) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f), a = hash(i * 127.1 + seed * 311.7), b = hash((i + 1) * 127.1 + seed * 311.7); return a + (b - a) * u; };

function woodMaterial() {
  const m = litMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aGr; varying vec2 vGr; varying vec3 vWW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGr = aGr; vWW = (modelMatrix * vec4(transformed, 1.)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec2 vGr; varying vec3 vWW;
      float pfH(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
      float pfN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(pfH(i), pfH(i + vec2(1., 0.)), f.x), mix(pfH(i + vec2(0., 1.)), pfH(i + 1.), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          // aGr: x metres along the piece's grain, y across it (round the rail or post); the grain's long streaks,
          // a check (split) here and there, silver weathering on top, brown in the sheltered underside
          float d = length(vWW - cameraPosition), fine = 1. - smoothstep(25., 70., d);
          float g = pfN(vec2(vGr.x * .9, vGr.y * 22.)) * .6 + pfN(vec2(vGr.x * 3.1, vGr.y * 55.)) * .4;
          float chk = (1. - smoothstep(.0, .035, abs(fract(vGr.y * 3.3 + pfN(vec2(vGr.x * .35, 7.)) * .8) - .5))) * step(.55, pfN(vec2(vGr.x * .25, vGr.y * 2.)));
          vec3 c = diffuseColor.rgb * mix(1., .78 + g * .42, fine) * (1. - chk * .45 * fine);
          float top = clamp(vNormal.y, 0., 1.);
          diffuseColor.rgb = mix(c, c * vec3(1.18, 1.17, 1.14), top * .5);
        }`);
  };
  m.customProgramCacheKey = () => 'park-fence-wood-1';
  return m;
}

export const parkFence = {
  install(world, opts = {}) {
    const kinds = new Set(opts.kinds || ['drive']), share = opts.share ?? .35, offset = opts.offset ?? 2, H = opts.height ?? 1.05, P = opts.post ?? 2.7, both = opts.both ?? .4;
    const mat = woodMaterial();
    return {
      *tileJob(t) {
        if (!world.ground || !t.pieces?.length) return;
        const mine = t.pieces.filter((p) => kinds.has(p.e.kind) && !p.e._cf); if (!mine.length) return;
        // the other ways' segments near this tile, on a 10 m grid (the fence breaks where one comes within reach)
        const grid = new Map(), C = 10, key = (i, j) => i * 100003 + j, x0 = t.i * world.TILE - 40, z0 = t.j * world.TILE - 40, x1 = x0 + world.TILE + 80, z1 = z0 + world.TILE + 80;
        for (const [, tt] of world.tiles) {
          if (Math.abs(tt.cx - t.cx) > world.TILE * 1.1 || Math.abs(tt.cz - t.cz) > world.TILE * 1.1) continue;
          for (const { e, a, b } of tt.pieces) for (let i = a; i < b; i++) {
            const mx = (e.x[i] + e.x[i + 1]) / 2, mz = (e.z[i] + e.z[i + 1]) / 2; if (mx < x0 || mx > x1 || mz < z0 || mz > z1) continue;
            const k = key(Math.floor(mx / C), Math.floor(mz / C)); (grid.get(k) || grid.set(k, []).get(k)).push(e, i);
          }
        }
        const clear = (x, z, own) => {
          const gi = Math.floor(x / C), gj = Math.floor(z / C);
          for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
            const arr = grid.get(key(gi + a, gj + b)); if (!arr) continue;
            for (let k = 0; k < arr.length; k += 2) {
              const e = arr[k], i = arr[k + 1]; if (e === own) continue;
              const ax = e.x[i], az = e.z[i], dx = e.x[i + 1] - ax, dz = e.z[i + 1] - az, l2 = dx * dx + dz * dz || 1;
              const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), d = Math.hypot(x - ax - dx * u, z - az - dz * u);
              if (d < world.wOf(e) / 2 + (world.walkOf?.(e) || 0) + 2.2) return false;
            }
          }
          return true;
        };
        const pos = [], nor = [], col = [], gr = [], idx = [];
        // a hewn piece from p to q (centre line), w × h section, rolled by `roll`: four faces, their grain along it
        const piece = (p, q, w, h, tone, seed) => {
          const ax = q[0] - p[0], ay = q[1] - p[1], az = q[2] - p[2], L = Math.hypot(ax, ay, az) || 1;
          const T = [ax / L, ay / L, az / L];
          let U = Math.abs(T[1]) > .9 ? [1, 0, 0] : [0, 1, 0];
          let S = [T[1] * U[2] - T[2] * U[1], T[2] * U[0] - T[0] * U[2], T[0] * U[1] - T[1] * U[0]]; const sl = Math.hypot(...S); S = S.map((v) => v / sl);
          U = [S[1] * T[2] - S[2] * T[1], S[2] * T[0] - S[0] * T[2], S[0] * T[1] - S[1] * T[0]];
          const c = new THREE.Color(tone).multiplyScalar(.85 + hash(seed) * .3);
          const faces = [[S, U, w, h], [U, S, h, w], [S, U, -w, h], [U, S, -h, w]];
          for (let f = 0; f < 4; f++) {
            const [N, V, a, b] = faces[f], sn = Math.sign(a) || 1, an = Math.abs(a) / 2, bn = Math.abs(b) / 2;
            const base = pos.length / 3;
            for (const [s, v] of [[0, -1], [0, 1], [1, 1], [1, -1]]) {
              const pt = s ? q : p;
              pos.push(pt[0] + N[0] * an * sn + V[0] * bn * v, pt[1] + N[1] * an * sn + V[1] * bn * v, pt[2] + N[2] * an * sn + V[2] * bn * v);
              nor.push(N[0] * sn, N[1] * sn, N[2] * sn); col.push(c.r, c.g, c.b); gr.push(s * L + seed % 7, f * .25 + v * .1);
            }
            // (wound so the face looks out along its normal)
            const P0 = base * 3, e1 = [pos[P0 + 6] - pos[P0], pos[P0 + 7] - pos[P0 + 1], pos[P0 + 8] - pos[P0 + 2]], e2 = [pos[P0 + 3] - pos[P0], pos[P0 + 4] - pos[P0 + 1], pos[P0 + 5] - pos[P0 + 2]];
            const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
            if (cx * N[0] * sn + cy * N[1] * sn + cz * N[2] * sn > 0) idx.push(base, base + 2, base + 1, base, base + 3, base + 2); else idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
          }
        };
        const half = (e) => world.wOf(e) / 2 + (world.walkOf?.(e) || 0);
        for (const { e, a, b } of mine) {
          if (due()) yield;
          const lenEnd = e.n * 10, seedE = (e.n * 37 + Math.round(e.x[0] * 3 + e.z[0] * 5)) % 7919;
          for (const side of [-1, 1]) {
            // which stretches of this side run a fence (a slow noise along the way; across, the same stretch now and then)
            const on = (s) => { const n = vn(s / 55, seedE + side * 13); const twin = vn(s / 55, seedE - side * 13) > 1 - share && hash(Math.floor(s / 55) + seedE) < both; return n > 1 - share || twin; };
            let prev = null;
            const s0 = Math.ceil(a * 10 / P) * P, s1 = b * 10;
            for (let s = s0; s <= s1 + .01; s += P) {
              const i = Math.min(e.n - 1, Math.floor(s / 10)), f = s / 10 - i;
              const okHere = s > 16 && s < lenEnd - 16 && !e._deck?.[i] && !e._deck?.[i + 1] && on(s);
              if (!okHere) { prev = null; continue; }
              const dx = e.x[i + 1] - e.x[i], dz = e.z[i + 1] - e.z[i], l = Math.hypot(dx, dz) || 1, nx = -dz / l * side, nz = dx / l * side;
              const off = half(e) + offset, x = e.x[i] + dx * f + nx * off, z = e.z[i] + dz * f + nz * off;
              const gy = world._groundH(x, z);
              if (!clear(x, z, e) || world.poolAt(x, z) > gy - .2) { prev = null; continue; }
              const seed = Math.round(s * 7 + side * 3 + seedE);
              const lean = (hash(seed * 1.3) - .5) * .06;
              const top = [x + nx * lean, gy + H + (hash(seed * 2.1) - .5) * .08, z + nz * lean];
              piece([x, gy - .25, z], top, .17, .17, '#7b6f60', seed);
              if (prev) for (const [hy, k] of [[.42, 0], [.86, 1]]) {
                const sag = (hash(seed * 3.7 + k) - .5) * .05;
                piece([prev.x, prev.gy + hy * H + sag, prev.z], [x, gy + hy * H - sag, z], .13, .1, k ? '#8a7d6b' : '#7e705e', seed * 5 + k);
              }
              prev = { x, z, gy };
            }
          }
        }
        if (!idx.length) return;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aGr', new THREE.Float32BufferAttribute(gr, 2)); g.setIndex(idx);
        g.computeBoundingSphere();
        const m = new THREE.Mesh(g, mat); m.name = `Split-rail fence ${t.key}`; m.receiveShadow = true; m.userData.bake = false;
        world.group.add(m); (t.extra ||= []).push(m);
      },
      dispose() { mat.dispose(); },
    };
  },
};
