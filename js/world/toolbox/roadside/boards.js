// Road boards: the small roadside signs of a European road, all drawn into one texture atlas and merged into
// two draws (the boards and their posts), however many there are. Kinds:
//   "bend"     a numbered hairpin (Alpe d'Huez: "Virage n° 7", the altitude and the stage winners' names)
//   "town"     the town entry sign (white, red border, the name in capitals); "townEnd" adds the red bar
//   "col"      a pass summit (the col's name and altitude)
//   "info"     any short text board
// Placed by distance and side like every roadside kit. Portable: a scene's "boards" list.
//
//   "boards": [ { "atM": 120781, "kind": "bend", "number": 7, "alt": 1390, "lines": ["Gianni Bugno 1990"], "side": "left" },
//               { "atM": 33000, "kind": "town", "title": "Saint-Étienne-en-Dévoluy" } ]
import * as THREE from '../../../../vendor/three.js';
import { roadFrame } from './details.js';

const SW = 256, SH = 128, COLS = 8;
const SIZE = { bend: [1.05, .66, 1.75], town: [1.4, .6, 1.5], townEnd: [1.4, .6, 1.5], col: [1.6, .8, 1.8], info: [1.4, .7, 1.6] };   // width, height, height of the board's foot

function drawBoard(ctx, x, y, b) {
  const W = SW, H = SH, k = b.kind;
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = '#f7f6f1'; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'middle';
  if (k === 'bend') {
    ctx.strokeStyle = '#1f4fa3'; ctx.lineWidth = 6; ctx.strokeRect(5, 5, W - 10, H - 10);
    ctx.fillStyle = '#1f4fa3'; ctx.textAlign = 'center';
    ctx.font = 'bold 64px sans-serif'; ctx.fillText(String(b.number ?? ''), 52, 58);
    ctx.font = 'bold 13px sans-serif'; ctx.fillText('VIRAGE', 52, 100);
    ctx.textAlign = 'left';
    ctx.font = 'bold 16px sans-serif'; ctx.fillText(b.alt ? `Alt. ${b.alt} m` : '', 100, 26);
    ctx.font = '600 14px sans-serif';
    (b.lines || []).slice(0, 4).forEach((l, i) => ctx.fillText(l, 100, 52 + i * 20, W - 110));
  } else if (k === 'town' || k === 'townEnd') {
    ctx.strokeStyle = '#d02a24'; ctx.lineWidth = 9; ctx.strokeRect(8, 8, W - 16, H - 16);
    ctx.fillStyle = '#16161a'; ctx.textAlign = 'center';
    const name = (b.title || '').toUpperCase();
    ctx.font = `bold ${name.length > 18 ? 18 : name.length > 12 ? 24 : 30}px sans-serif`;
    ctx.fillText(name, W / 2, H / 2, W - 34);
    if (k === 'townEnd') { ctx.strokeStyle = '#d02a24'; ctx.lineWidth = 10; ctx.beginPath(); ctx.moveTo(20, H - 18); ctx.lineTo(W - 20, 18); ctx.stroke(); }
  } else if (k === 'col') {
    ctx.fillStyle = '#6b4a2e'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#f2ead8'; ctx.lineWidth = 4; ctx.strokeRect(7, 7, W - 14, H - 14);
    ctx.fillStyle = '#f2ead8'; ctx.textAlign = 'center';
    ctx.font = 'bold 22px sans-serif'; ctx.fillText((b.title || '').toUpperCase(), W / 2, 46, W - 30);
    ctx.font = '600 18px sans-serif'; ctx.fillText(b.alt ? `Altitude ${b.alt} m` : '', W / 2, 84);
  } else {
    ctx.strokeStyle = '#1f4fa3'; ctx.lineWidth = 5; ctx.strokeRect(5, 5, W - 10, H - 10);
    ctx.fillStyle = '#1f2a3a'; ctx.textAlign = 'center';
    ctx.font = 'bold 22px sans-serif'; ctx.fillText(b.title || '', W / 2, 44, W - 26);
    ctx.font = '600 15px sans-serif'; (b.lines || []).slice(0, 2).forEach((l, i) => ctx.fillText(l, W / 2, 78 + i * 20, W - 26));
  }
  ctx.restore();
}

export class Boards {
  constructor(parent, route, index, boards = []) {
    this.group = new THREE.Group(); this.group.name = 'Road boards'; parent.add(this.group);
    const list = boards.filter((b) => b.atM <= (route.turnS || route.total));
    if (!list.length) return;
    const rows = Math.ceil(list.length / COLS);
    const canvas = document.createElement('canvas'); canvas.width = SW * COLS; canvas.height = SH * Math.max(1, 2 ** Math.ceil(Math.log2(rows)));
    const ctx = canvas.getContext('2d');
    const pos = [], uv = [], nor = [], idx = [], post = [], postIdx = [];
    const H = canvas.height;
    list.forEach((b, n) => {
      const cx = (n % COLS) * SW, cy = Math.floor(n / COLS) * SH;
      drawBoard(ctx, cx, cy, b);
      const [w, h, foot] = SIZE[b.kind] || SIZE.info;
      const side = b.side === 'left' ? -1 : 1;
      const { position: p, forward: f } = roadFrame(route, index, b.atM, side * (b.lateralM ?? 4.9));
      // facing the oncoming rider: the board's front looks back along the road
      const fx = -f.x, fz = -f.z, L = Math.hypot(fx, fz) || 1, nx = fx / L, nz = fz / L, rx = -nz, rz = nx;
      const y0 = p.y + foot, y1 = y0 + h;
      const c = [[-w / 2, y0], [w / 2, y0], [w / 2, y1], [-w / 2, y1]].map(([a, y]) => [p.x + rx * a, y, p.z + rz * a]);
      const u0 = cx / canvas.width, u1 = (cx + SW) / canvas.width, v1 = 1 - cy / H, v0 = 1 - (cy + SH) / H;
      const base = pos.length / 3;
      for (const [v, t] of [[c[0], [u0, v0]], [c[1], [u1, v0]], [c[2], [u1, v1]], [c[3], [u0, v1]]]) { pos.push(...v); uv.push(...t); nor.push(nx, 0, nz); }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      // the back of the board (plain), so it isn't invisible from behind
      const back = pos.length / 3;
      for (const v of [c[1], c[0], c[3], c[2]]) { pos.push(v[0] - nx * .03, v[1], v[2] - nz * .03); uv.push(u0 + 2 / canvas.width, v0 + 2 / H); nor.push(-nx, 0, -nz); }
      idx.push(back, back + 1, back + 2, back, back + 2, back + 3);
      // posts: one (small boards) or two
      for (const a of w > 1.2 ? [-w / 2 + .12, w / 2 - .12] : [0]) {
        const px = p.x + rx * a - nx * .05, pz = p.z + rz * a - nz * .05, s = .035, pb = post.length / 3;
        for (const [ox, oz] of [[-s, -s], [s, -s], [s, s], [-s, s]]) { post.push(px + ox, p.y - .2, pz + oz, px + ox, y1 - .05, pz + oz); }
        for (let e = 0; e < 4; e++) { const a0 = pb + e * 2, a1 = pb + ((e + 1) % 4) * 2; postIdx.push(a0, a1, a1 + 1, a0, a1 + 1, a0 + 1); }
      }
    });
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeBoundingSphere();
    this.mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: .6 }));
    this.mesh.name = `Road boards (${list.length})`; this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.userData.sign = true;
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute(post, 3)); pg.setIndex(postIdx); pg.computeVertexNormals();
    this.posts = new THREE.Mesh(pg, new THREE.MeshStandardMaterial({ color: '#9aa0a5', roughness: .5, metalness: .4, side: THREE.DoubleSide }));
    this.posts.name = 'Road board posts'; this.posts.castShadow = true;
    this.group.add(this.mesh, this.posts);
    this.count = list.length;
  }

  dispose() {
    if (!this.mesh) return;
    this.mesh.geometry.dispose(); this.mesh.material.map.dispose(); this.mesh.material.dispose();
    this.posts.geometry.dispose(); this.posts.material.dispose(); this.group.removeFromParent();
  }
}
