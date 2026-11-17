// Course arches: an inflatable START arch a short way into the ride and a FINISH arch over the planned
// finish line, so the rider can see where the ride begins and ends. Unlike the other roadside kits they
// aren't part of a scene: the app moves them whenever a ride is planned (world.setCourseMarks), so one
// world serves every start and length the route selector can choose. Any route, any look.
//
//   world.setCourseMarks({ start: { atM, title: 'START', sub: 'Avalanche Creek' },
//                          finish: { atM, title: 'FINISH', sub: 'Logan Pass' } })   // null to clear either
//
// Each arch: a segmented inflatable tube over the road (vertex colours, smooth shading), a two-sided
// banner (one shared canvas atlas) and ballast feet; a painted line across the road under it. About
// 5k triangles and 3 draw calls per arch. The legs reach down to the ground beside the road; the arch
// slides a few metres along the road if one side drops away (a cliff edge, a bridge).
import * as THREE from '../../../../vendor/three.module.min.js';
import { riderPose, routePoint, ROAD_WIDTH, ROAD_LIFT } from '../../pose.js';
import { wrapDist } from '../../../gpx.js';

export const ARCH = {
  halfSpan: 6.1,      // centre of each leg from the road's centre line (clear of verge posts and boards)
  height: 6.7,        // centre of the tube across the top, above the road
  corner: 1.7,        // radius of the rounded top corners
  tube: .56,          // tube radius
  radial: 14,         // segments around the tube
  bannerW: 7.8, bannerH: 1.95,
  maxDrop: 2.4,       // how far a leg may reach down to the ground below the road
  deckSpan: 4.5,      // no ground for a leg (a bridge, a cliff edge): the legs stand on the road's shoulders instead
};
const BLUE = new THREE.Color('#2f6fe4'), BLUE_DEEP = new THREE.Color('#1c3f99'), WHITE = new THREE.Color('#f6f7f4'),
  INK = new THREE.Color('#16181c'), BASE = new THREE.Color('#3a414c');
const STYLES = {
  start: { tube: (u, band) => (band % 5 === 2 ? WHITE : BLUE), leg: BLUE_DEEP },
  finish: { tube: (u, band, rad, top) => (top ? ((band + rad) % 2 ? INK : WHITE) : band % 5 === 2 ? BLUE : WHITE), leg: BLUE },
};
const BW = 1024, BH = 256;

/** The tube's centre line in the arch's own frame (x across the road, y up), from the left foot to the right. */
function archPath(dropL, dropR, X = ARCH.halfSpan) {
  const { height: H, corner: R } = ARCH;
  const pts = [], top = [];
  const line = (x0, y0, x1, y1, step, isTop = false) => {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let i = pts.length ? 1 : 0; i <= n; i++) { pts.push(new THREE.Vector2(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n)); top.push(isTop); }
  };
  const arc = (cx, cy, a0, a1) => {
    for (let i = 1; i <= 10; i++) { const a = a0 + (a1 - a0) * i / 10; pts.push(new THREE.Vector2(cx + Math.cos(a) * R, cy + Math.sin(a) * R)); top.push(true); }
  };
  line(-X, -dropL, -X, H - R, .42);
  arc(-X + R, H - R, Math.PI, Math.PI / 2);
  line(-X + R, H, X - R, H, .42, true);
  arc(X - R, H - R, Math.PI / 2, 0);
  line(X, H - R, X, -dropR, .42);
  return { pts, top };
}

/** The inflatable: a tube swept along the path, pinched every ~1.25 m into pillow segments, one colour per quad. */
function archBody(kind, dropL, dropR, X = ARCH.halfSpan) {
  const { pts, top } = archPath(dropL, dropR, X);
  const style = STYLES[kind], N = ARCH.radial, r0 = ARCH.tube;
  const P = [], Nn = [], C = [];
  // arc length along the path, for the pillow segments and colour bands
  const len = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const ring = (i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const t = new THREE.Vector2().subVectors(b, a).normalize(), nrm = new THREE.Vector2(-t.y, t.x);   // in the arch plane
    const seg = 1.25, ph = (len[i] % seg) / seg;
    const r = r0 * (0.9 + 0.1 * Math.sin(ph * Math.PI));   // pillow bulge between seams
    const out = [];
    for (let k = 0; k <= N; k++) {
      const a2 = (k / N) * Math.PI * 2, cs = Math.cos(a2), sn = Math.sin(a2);
      const n = new THREE.Vector3(nrm.x * cs, nrm.y * cs, sn);   // z: along the road
      out.push({ p: new THREE.Vector3(pts[i].x + n.x * r, pts[i].y + n.y * r, n.z * r), n });
    }
    return out;
  };
  const rings = pts.map((_, i) => ring(i));
  for (let i = 0; i < pts.length - 1; i++) {
    const band = Math.floor(((len[i] + len[i + 1]) / 2) / 1.25);
    const low = Math.max(pts[i].y, pts[i + 1].y) < 1.1;   // the leg's foot
    for (let k = 0; k < N; k++) {
      const col = low ? style.leg : style.tube((len[i] / len[len.length - 1]), band, k, top[i] && top[i + 1]);
      const q = [rings[i][k], rings[i + 1][k], rings[i + 1][k + 1], rings[i][k + 1]];
      for (const j of [0, 1, 2, 0, 2, 3]) { P.push(q[j].p.x, q[j].p.y, q[j].p.z); Nn.push(q[j].n.x, q[j].n.y, q[j].n.z); C.push(col.r, col.g, col.b); }
    }
  }
  // end caps are below ground; ballast feet: a rounded-off block under each leg
  for (const [x, y] of [[-X, -dropL], [X, -dropR]]) addBlock(P, Nn, C, x, y - .05, 0, 1.5, .45, 1.5, BASE);
  fixWinding(P, Nn, C);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.computeBoundingSphere();
  return g;
}

/** Make every triangle wind counter-clockwise around its own normal (so front faces aren't culled). */
function fixWinding(P, Nn, C) {
  for (let t = 0; t < P.length; t += 9) {
    const ax = P[t], ay = P[t + 1], az = P[t + 2];
    const ux = P[t + 3] - ax, uy = P[t + 4] - ay, uz = P[t + 5] - az, vx = P[t + 6] - ax, vy = P[t + 7] - ay, vz = P[t + 8] - az;
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const nx = Nn[t] + Nn[t + 3] + Nn[t + 6], ny = Nn[t + 1] + Nn[t + 4] + Nn[t + 7], nz = Nn[t + 2] + Nn[t + 5] + Nn[t + 8];
    if (cx * nx + cy * ny + cz * nz >= 0) continue;
    for (const A of [P, Nn, C]) for (let k = 0; k < 3; k++) { const a = A[t + 3 + k]; A[t + 3 + k] = A[t + 6 + k]; A[t + 6 + k] = a; }
  }
}

function addBlock(P, Nn, C, x, y, z, w, h, l, col) {
  const faces = [
    [[1, 0, 0], [[1, 0, -1], [1, 1, -1], [1, 1, 1], [1, 0, 1]]], [[-1, 0, 0], [[-1, 0, 1], [-1, 1, 1], [-1, 1, -1], [-1, 0, -1]]],
    [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]], [[0, 0, 1], [[1, 0, 1], [1, 1, 1], [-1, 1, 1], [-1, 0, 1]]],
    [[0, 0, -1], [[-1, 0, -1], [-1, 1, -1], [1, 1, -1], [1, 0, -1]]],
  ];
  for (const [n, q] of faces) for (const j of [0, 1, 2, 0, 2, 3]) {
    const [a, b, c] = q[j];
    P.push(x + a * w / 2, y + b * h, z + c * l / 2); Nn.push(...n); C.push(col.r, col.g, col.b);
  }
}

/** One banner in the atlas: row 0 the start, row 1 the finish. */
function drawBanner(ctx, row, kind, title, sub) {
  const y0 = row * BH;
  ctx.save(); ctx.translate(0, y0);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const font = (w, px) => `${w} ${px}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  if (kind === 'start') {
    const g = ctx.createLinearGradient(0, 0, 0, BH); g.addColorStop(0, '#3a7bf0'); g.addColorStop(1, '#1f4fbf');
    ctx.fillStyle = g; ctx.fillRect(0, 0, BW, BH);
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(0, BH - 16, BW, 16);
    // chevrons pointing the way, both ends
    ctx.fillStyle = '#ffffff';
    for (const side of [-1, 1]) for (let k = 0; k < 2; k++) {
      const cx = BW / 2 + side * (BW / 2 - 70 - k * 46);
      ctx.beginPath(); ctx.moveTo(cx - 16, 92); ctx.lineTo(cx + 8, 128); ctx.lineTo(cx - 16, 164); ctx.lineTo(cx - 2, 164); ctx.lineTo(cx + 22, 128); ctx.lineTo(cx - 2, 92); ctx.closePath(); ctx.fill();
    }
    ctx.font = font(900, sub ? 132 : 150); ctx.fillText(title || 'START', BW / 2, sub ? 96 : 128, BW - 300);
    if (sub) { ctx.globalAlpha = .9; ctx.font = font(800, 48); ctx.fillText(sub.toUpperCase(), BW / 2, 194, BW - 320); ctx.globalAlpha = 1; }
  } else {
    ctx.fillStyle = '#fbfbf8'; ctx.fillRect(0, 0, BW, BH);
    const sq = 28;
    for (const yy of [0, BH - sq * 2]) for (let r = 0; r < 2; r++) for (let c = 0; c < BW / sq; c++) {
      ctx.fillStyle = (r + c) % 2 ? '#16181c' : '#fbfbf8'; ctx.fillRect(c * sq, yy + r * sq, sq, sq);
    }
    ctx.fillStyle = '#16181c'; ctx.font = font(900, sub ? 104 : 124); ctx.fillText(title || 'FINISH', BW / 2, sub ? 108 : 128, BW - 120);
    if (sub) { ctx.fillStyle = '#2459d8'; ctx.font = font(800, 40); ctx.fillText(sub.toUpperCase(), BW / 2, 168, BW - 160); }
  }
  ctx.restore();
}

/** The banner quad, both faces (each reads the right way round from its own side). */
function bannerGeometry(row, X = ARCH.halfSpan) {
  const { height: H, tube } = ARCH;
  // as wide as fits between the rounded corners, at the texture's own 4 : 1
  const w = Math.min(ARCH.bannerW, 2 * (X - ARCH.corner) + .9), h = w * ARCH.bannerH / ARCH.bannerW;
  const yTop = H - tube * .55, yBot = yTop - h;
  const v1 = 1 - row / 2, v0 = v1 - .5;
  const P = [], N = [], U = [], I = [];
  for (const nz of [-1, 1]) {
    // each face's own left → right as seen from its side (front: −z, where the viewer's right is −x), so
    // the text reads correctly from both, and the corners run counter-clockwise
    const z = nz * .04, b = P.length / 3, xl = nz < 0 ? w / 2 : -w / 2, xr = -xl;
    P.push(xl, yBot, z, xr, yBot, z, xr, yTop, z, xl, yTop, z);
    for (let k = 0; k < 4; k++) N.push(0, 0, nz);
    U.push(0, v0, 1, v0, 1, v1, 0, v1);
    I.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I); g.computeBoundingSphere();
  return g;
}

/** The painted line across the road: solid white (start) or chequered (finish), following the road's slope. */
function roadLine(kind, world, s, right) {
  const P = [], C = [], half = ROAD_WIDTH / 2 - .15, depth = kind === 'finish' ? 1.0 : .5;
  const cols = kind === 'finish' ? 14 : 1, rows = kind === 'finish' ? 2 : 1;
  const at = (lat, along) => {
    const c = routePoint(world.route, world.index, s + along);
    return [c.x + right.x * lat, c.y + ROAD_LIFT + .03, c.z + right.z * lat];
  };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const col = kind === 'finish' ? ((r + c) % 2 ? INK : WHITE) : WHITE;
    const l0 = -half + (2 * half) * c / cols, l1 = -half + (2 * half) * (c + 1) / cols;
    const a0 = -depth / 2 + depth * r / rows, a1 = -depth / 2 + depth * (r + 1) / rows;
    const q = [at(l0, a0), at(l1, a0), at(l1, a1), at(l0, a1)];
    for (const j of [0, 2, 1, 0, 3, 2]) { P.push(...q[j]); C.push(col.r, col.g, col.b); }
  }
  const Nn = new Array(P.length).fill(0).map((_, k) => (k % 3 === 1 ? 1 : 0));
  fixWinding(P, Nn, C);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
  g.computeBoundingSphere();
  return g;
}

export class CourseArches {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group(); this.group.name = 'Course arches';
    world.scene.add(this.group);
    this.canvas = document.createElement('canvas'); this.canvas.width = BW; this.canvas.height = BH * 2;
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8;
    this.bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .5, metalness: 0 });
    this.bannerMat = new THREE.MeshStandardMaterial({ map: this.tex, roughness: .7 });
    this.lineMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .8, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -8 });
    this.arches = { start: null, finish: null };
    this.marks = {};
  }

  /** Place (or clear) the arches. marks: { start: {atM, title, sub} | null, finish: {atM, title, sub} | null } (route metres). */
  set(marks = {}) {
    const ctx = this.canvas.getContext('2d');
    ctx.clearRect(0, 0, BW, BH * 2);
    for (const [row, kind] of [[0, 'start'], [1, 'finish']]) {
      const m = marks[kind];
      drawBanner(ctx, row, kind, m?.title, m?.sub);
      this._clear(kind);
      if (m && Number.isFinite(m.atM)) this.arches[kind] = this._build(kind, row, m.atM, m.archShiftM);
    }
    this.tex.needsUpdate = true;
    this.marks = marks;
  }

  /** Ground height beside the road (null where the terrain doesn't know yet). */
  _ground(x, z) {
    const t = this.world.terrain;
    const y = t?.heightAt?.(x, z);
    return Number.isFinite(y) ? y : null;
  }

  /** The road frame at s, and how far each leg must reach down to the ground (0 where it's level or higher). */
  _fit(s) {
    const w = this.world, pose = riderPose(w.route, w.index, s, 0);
    const c = pose.centre, right = { x: -pose.flat.z, z: pose.flat.x };
    const road = c.y + ROAD_LIFT;
    const drop = (side) => {
      const x = c.x + right.x * ARCH.halfSpan * side, z = c.z + right.z * ARCH.halfSpan * side;
      const g = this._ground(x, z);
      const bridge = w.terrain?.landscape?.bridgeAt?.(x, z, 3);
      return { d: g == null ? 0 : Math.max(0, road - g), bridge: !!bridge };
    };
    const L = drop(-1), R = drop(1);
    return { c, road, right, flat: pose.flat, dropLeft: L.d, dropRight: R.d, bad: Math.max(L.d, R.d) + (L.bridge || R.bridge ? 50 : 0) };
  }

  _build(kind, row, atM, shift = kind === 'start' ? [0, 4, -4, 8, 12, 18, 25, 35] : [0, 3, -3, 6, -6, 10, -10]) {
    const w = this.world, route = w.route;
    // the travel direction at the mark, so the banner faces the rider coming up to it
    const s0 = route.closed ? wrapDist(route, atM) : Math.max(0, Math.min(route.total, atM));
    let best = null;
    for (const ds of shift) {
      const s = route.closed ? wrapDist(route, s0 + ds) : Math.max(0, Math.min(route.total, s0 + ds));
      const f = this._fit(s);
      if (!best || f.bad < best.bad - .3) best = { ...f, s };
      if (f.bad <= .8) break;
    }
    // the arch's local −x is the road's right (see the rotation below). Nowhere for a leg to stand (a bridge,
    // a drop-off): a narrower arch with its feet on the shoulders
    const deck = best.bad > ARCH.maxDrop;
    const dropNeg = deck ? .1 : best.dropRight + .25, dropPos = deck ? .1 : best.dropLeft + .25;
    const g = new THREE.Group(); g.name = kind === 'start' ? 'Start arch' : 'Finish arch';
    const body = new THREE.Mesh(archBody(kind, dropNeg, dropPos, deck ? ARCH.deckSpan : ARCH.halfSpan), this.bodyMat);
    const banner = new THREE.Mesh(bannerGeometry(row, deck ? ARCH.deckSpan : ARCH.halfSpan), this.bannerMat);
    body.name = `${g.name} tube`; banner.name = `${g.name} banner`; banner.userData.sign = true;
    g.add(body, banner);
    // the arch's frame: local +z along the way the rider is going (so local +x is the road's left), and the
    // banner's front (−z) faces the rider coming up to it
    g.position.set(best.c.x, best.road, best.c.z);
    g.rotation.y = Math.atan2(best.flat.x, best.flat.z);
    // the line on the road, exactly at the mark (the arch may stand a few metres off it)
    const pose = riderPose(route, w.index, s0, 0);
    const line = new THREE.Mesh(roadLine(kind, w, s0, { x: -pose.flat.z, z: pose.flat.x }), this.lineMat);
    line.name = `${g.name} line`; line.renderOrder = 20; line.userData.bake = false;
    for (const o of [body, banner]) { o.castShadow = true; o.receiveShadow = true; o.userData.dynamic = true; }
    this.group.add(g, line);
    return { group: g, line, s: best.s };
  }

  _clear(kind) {
    const a = this.arches[kind];
    if (!a) return;
    for (const o of [a.group, a.line]) {
      o.removeFromParent();
      o.traverse((m) => { if (m.geometry) m.geometry.dispose(); });
    }
    this.arches[kind] = null;
  }

  dispose() {
    this._clear('start'); this._clear('finish');
    this.tex.dispose(); this.bodyMat.dispose(); this.bannerMat.dispose(); this.lineMat.dispose();
    this.group.removeFromParent();
  }
}
