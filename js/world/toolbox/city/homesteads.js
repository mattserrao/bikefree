// Toolbox city: homesteads — what makes a rural house read as lived in (user, 22 Nov 2026, CNY / SKAN: "no driveways,
// awkward shapes"; chose driveways + mailboxes, clean shapes facing the road, and outbuildings):
//   driveway    from the garage door (or a parking pad beside the house) to the road it faces: asphalt in the
//               suburbs and villages, gravel on the farms; bent round the house's corner if it would cross it
//   mailbox     at the road end of every driveway, on its post, facing the road (the rural carrier's side)
//   outbuildings in the back or side yard: a garden shed, a detached garage, an above-ground pool, a swing set —
//               by the kind of place (suburb, village, farm)
// Plans are pure (data); drawing goes into the tile's street-kit mesh (boxes, roofs) and a draped strip mesh.
//
//   const H = planHomestead(R, ctx)  → { drive: { pts, w, gravel, pad }, mailbox, extras } | null
//   drawHomestead(M, H, groundH)     boxes and roofs into a MeshBuilder;  driveStrips(list, groundH) → BufferGeometry
import * as THREE from '../../../../vendor/three.module.min.js';
import { hash } from '../core/mesh-builder.js';

const corner = (r, a, b) => [r.cx + r.ux * a + r.vx * b, r.cz + r.uz * a + r.vz * b];
const sideSign = (i) => (i === 0 || i === 3 ? -1 : 1);

/**
 * R: a building-kit recipe (rects, front, parts, kind, key). ctx: roadNear(x, z, r) → { px, pz, half, y, dx, dz } | null,
 * free(x, z, pad) → true if no building, road or water there. Deterministic by R.key.
 */
export function planHomestead(R, ctx) {
  const r = R.rects?.[0]; if (!r) return null;
  const h = (k) => hash((R.key || R.id || 1) * 7.31 + k * 13.7);
  const farm = R.kind === 'farmhouse-ny', village = R.kind === 'village-house';
  const front = R.front ?? 0, fs = front % 2 === 0 ? sideSign(front) : -1;
  // where the car stands: the garage door, else a pad beside the house at its front corner
  const gar = R.parts?.garage;
  let sx, sz, pad = false;
  if (R.house?.drive) { const H = R.house, d = H.drive; sx = H.o[0] + H.a[0] * d.s + H.b[0] * d.t; sz = H.o[1] + H.a[1] * d.s + H.b[1] * d.t; }
  else if (gar) { const s = sideSign(gar.end); [sx, sz] = corner(r, s * (r.hu + 1.6), fs * (Math.min(r.hv, 1.9) + 1.2)); }
  else if (front % 2 === 0) { const s = h(1) < .5 ? -1 : 1; [sx, sz] = corner(r, s * (r.hu + 2.2), fs * (r.hv - 1.5)); pad = true; }
  else { const s = h(1) < .5 ? -1 : 1; [sx, sz] = corner(r, sideSign(front) * (r.hu - 1.5), s * (r.hv + 2.2)); pad = true; }
  const road = ctx.roadNear(sx, sz, farm ? 160 : 70);
  if (!road) return null;
  const ox = sx - road.px, oz = sz - road.pz, od = Math.hypot(ox, oz) || 1;
  const ex = road.px + ox / od * (road.half + .15), ez = road.pz + oz / od * (road.half + .15);
  const pts = [[sx, sz]];
  // bend round the house if the straight line would cross it (the rect grown by a metre)
  const crosses = (ax, az, bx, bz) => { for (let k = 1; k < 12; k++) { const t = k / 12, x = ax + (bx - ax) * t, z = az + (bz - az) * t, dx = x - r.cx, dz = z - r.cz, a = dx * r.ux + dz * r.uz, b = dx * r.vx + dz * r.vz; if (Math.abs(a) < r.hu + 1 && Math.abs(b) < r.hv + 1) return true; } return false; };
  if (crosses(sx, sz, ex, ez)) {
    const s = (sx - r.cx) * r.ux + (sz - r.cz) * r.uz >= 0 ? 1 : -1, toward = ((ex - r.cx) * r.vx + (ez - r.cz) * r.vz) >= 0 ? 1 : -1;
    pts.push(corner(r, s * (r.hu + 2.5), toward * (r.hv + 2.5)));
  }
  pts.push([ex, ez]);
  const gravel = farm ? h(2) < .85 : village ? h(2) < .2 : h(2) < .12;
  const drive = { pts, w: farm ? 2.8 : 2.8, gravel, pad: pad ? { x: sx, z: sz, yaw: Math.atan2(r.ux, r.uz), w: 3.4, l: 6 } : null, roadY: road.y };
  // the mailbox: at the road end, a step to the side, facing the road
  const tx = road.dx, tz = road.dz, side = h(3) < .5 ? -1 : 1;
  const mailbox = { x: ex + tx * side * 2 + ox / od * .7, z: ez + tz * side * 2 + oz / od * .7, yaw: Math.atan2(-ox / od, -oz / od) };
  if (!ctx.free(mailbox.x, mailbox.z, .3)) mailbox.x = NaN;
  // outbuildings: in the back yard (away from the road), clear of everything
  const extras = [];
  const back = [[0, 1], [-1, 0], [0, -1], [1, 0]][front];
  const want = farm ? [['shed', .3]] : village ? [['garage', gar ? 0 : .25], ['shed', .3], ['swing', .08]] : [['shed', .38], ['garage', gar ? 0 : .12], ['pool', .14], ['swing', .16]];
  want.forEach(([kind, p], q) => {
    if (h(10 + q) >= p) return;
    for (let tries = 0; tries < 4; tries++) {
      const along = (h(20 + q * 3 + tries) - .5) * 2 * (r.hu + 4), out = (back[0] ? r.hu : r.hv) + 5 + h(30 + q + tries) * 9;
      const [x, z] = back[0] ? corner(r, back[0] * out, along * .6) : corner(r, along, back[1] * out);
      const size = kind === 'garage' ? 4.5 : kind === 'pool' ? 3.3 : kind === 'swing' ? 2.5 : 2.2;
      if (!ctx.free(x, z, size)) continue;
      // a detached garage's door faces the road (the front), and the driveway comes to it
      const yaw = kind === 'garage' ? Math.atan2(-back[0] * r.ux - back[1] * r.vx, -back[0] * r.uz - back[1] * r.vz) : Math.atan2(r.ux, r.uz) + (kind === 'swing' ? h(40 + q) * 1.5 : 0);
      extras.push({ kind, x, z, yaw, seed: h(50 + q) });
      break;
    }
  });
  const g = extras.find((e) => e.kind === 'garage');
  if (g) {
    // the drive runs from the detached garage's door, past the house, to the road
    const gx = g.x + Math.sin(g.yaw) * 4.2, gz = g.z + Math.cos(g.yaw) * 4.2;
    const P = [[gx, gz]];
    if (crosses(gx, gz, ex, ez)) { const s2 = (gx - r.cx) * r.ux + (gz - r.cz) * r.uz >= 0 ? 1 : -1, toward = ((ex - r.cx) * r.vx + (ez - r.cz) * r.vz) >= 0 ? 1 : -1; P.push(corner(r, s2 * (r.hu + 2.5), toward * (r.hv + 2.5))); }
    P.push([ex, ez]);
    drive.pts = P; drive.pad = null;
  }
  // yard decorations (user, 23 Nov: "garden & lawn items, seasonal (fall), flags & signs, play & work"): by the front
  // steps, out on the front lawn, and round the back — each a few metres clear of everything
  const props = [];
  const fu = -back[0], fv = -back[1];   // the front, in the rect's (u, v)
  const at = (outF, along) => fu ? corner(r, fu * (r.hu + outF), along) : corner(r, along, fv * (r.hv + outF));
  const faceRoad = Math.atan2(fu * r.ux + fv * r.vx, fu * r.uz + fv * r.vz);
  const tryPut = (kind, outF, along, pad, q) => {
    const [x, z] = at(outF, along);
    if (!ctx.free(x, z, pad)) return false;
    if (drive.pts.some(([dx, dz]) => Math.hypot(dx - x, dz - z) < 2.2)) return false;
    props.push({ kind, x, z, yaw: faceRoad + (h(80 + q) - .5) * .6, seed: h(90 + q) });
    return true;
  };
  const span = fu ? r.hv : r.hu;
  // by the front steps: the fall display (pumpkins, mums, a corn-stalk bundle), often
  if (h(70) < (farm ? .55 : .75)) for (const o of [1.8, 2.6, 3.4]) if (tryPut('fall', o, (h(71) - .5) * span * .6, .3, 1)) break;
  // a porch flag on the front wall, now and then
  if (h(72) < .3) props.push({ kind: 'flag', ...(() => { const [x, z] = at(.15, (h(73) - .5) * span * 1.2); return { x, z }; })(), yaw: faceRoad, seed: h(74) });
  // out front: a birdbath, a gnome and planters, a lawn sign, a house-number post, a hay-bale display
  const FRONT = [['birdbath', .25], ['gnome', .2], ['sign', .18], ['number', .25], ['bale', farm ? .3 : .12], ['planter', .25]];
  FRONT.forEach(([kind, p], q) => { if (h(100 + q) < p) for (let tries = 0; tries < 3; tries++) if (tryPut(kind, 3 + h(110 + q * 3 + tries) * 6, (h(120 + q * 3 + tries) - .5) * span * 2, .6, 10 + q)) break; });
  // round the back: Adirondack chairs and a firepit, a trampoline, a woodpile, a kids' bike, a wheelbarrow, a lawn tractor
  const BACK = [['firepit', village ? .2 : .32], ['trampoline', village ? .1 : .16], ['woodpile', farm ? .5 : .28], ['bike', .2], ['wheelbarrow', farm ? .35 : .18], ['tractor', farm ? .3 : .14]];
  BACK.forEach(([kind, p], q) => { if (h(130 + q) < p) for (let tries = 0; tries < 3; tries++) if (tryPut(kind, -((fu ? r.hu : r.hv) * 2 + 3 + h(140 + q * 3 + tries) * 8), (h(150 + q * 3 + tries) - .5) * span * 2.2, kind === 'trampoline' ? 2.2 : 1, 30 + q)) break; });
  // a parked car (user, 23 Nov: parked cars everywhere, from the shared car kit): on the drive by the house, nose
  // in (a few backed in); most homes have one, a farm more often a truck (life/figures/cars.js pickCar 'farm')
  let car = null;
  if (h(60) < (farm ? .8 : .62) && drive.pts.length > 1) {
    const [ax, az] = drive.pts[0], [bx, bz] = drive.pts[1], dl = Math.hypot(bx - ax, bz - az);
    if (dl > 7) {
      const dx = (bx - ax) / dl, dz = (bz - az) / dl, off = 3.3 + h(61) * 1.5, x = ax + dx * off, z = az + dz * off;
      if (ctx.free(x, z, 1.1)) car = { x, z, yaw: Math.atan2(-dx, -dz) + (h(62) < .25 ? Math.PI : 0), seed: h(63), setting: farm ? 'farm' : 'driveway' };
    }
  }
  return { drive, mailbox, extras, car, props, key: R.key, kind: R.kind, road: { px: road.px, pz: road.pz, dx: road.dx, dz: road.dz, ox: ox / od, oz: oz / od } };
}

/** A small gable-roofed building into M: walls w × l (l along yaw), eaves at h, ridge `rise` above them. */
function gableHut(M, x, y, z, w, l, h, rise, yaw, wall, roof, door) {
  M.color(wall).box(x, y - .3, z, w, h + .3, l, yaw);
  const c = Math.cos(yaw), s = Math.sin(yaw), P = (dx, dy, dz) => new THREE.Vector3(x + dx * c + dz * s, y + dy, z - dx * s + dz * c);
  const ov = .25, W = w / 2 + ov, L = l / 2 + ov;
  M.color(roof);
  M.quad(P(-W, h - .1, -L), P(-W, h - .1, L), P(0, h + rise, L), P(0, h + rise, -L));
  M.quad(P(W, h - .1, L), P(W, h - .1, -L), P(0, h + rise, -L), P(0, h + rise, L));
  M.color(wall);
  M.triangle(P(-w / 2, h, l / 2), P(w / 2, h, l / 2), P(0, h + rise - .05, l / 2));
  M.triangle(P(w / 2, h, -l / 2), P(-w / 2, h, -l / 2), P(0, h + rise - .05, -l / 2));
  if (door) { M.color(door.c); const d = P(0, 0, l / 2 + .02); M.box(d.x, y, d.z, door.w, door.h, .06, yaw); }
}

const SHEDS = [['#c9c2ae', '#5b4c42'], ['#8c3a2f', '#3e3a37'], ['#e4e1d8', '#4a4f55'], ['#9fae9a', '#3e4a44'], ['#a98d6d', '#4b4038']];
const POOLS = ['#4f86b3', '#6c95b8', '#3d73a3'];

const PUMPKIN = ['#d9701f', '#e07d24', '#c9651c'], MUMS = ['#b0372f', '#d6a12b', '#8a3f78', '#c8642a'];
/** One yard decoration (a homestead's props) into M. */
function drawProp(M, p, groundH) {
  const y = groundH(p.x, p.z), c = Math.cos(p.yaw), s = Math.sin(p.yaw), S = p.seed;
  const at = (a, b) => [p.x + a * c + b * s, p.z - a * s + b * c];   // a: across, b: toward the road
  const pumpkin = (a, b, r) => { const [x, z] = at(a, b); M.color(PUMPKIN[Math.floor(S * 7 + a * 3 + 3) % 3]).cylinder(x, y, z, r, r * 1.4, 8, r * .8); M.color('#4e5a2c').cylinder(x, y + r * 1.4, z, .03, .08, 4); };
  const mum = (a, b) => { const [x, z] = at(a, b); M.color('#6b4a33').cylinder(x, y, z, .17, .22, 6, .2); M.color(MUMS[Math.floor(S * 11 + a * 5 + 4) % 4]).cylinder(x, y + .22, z, .24, .2, 8, .12); };
  switch (p.kind) {
    case 'fall': {
      pumpkin(-.45, 0, .2); pumpkin(-.1, .15, .15); if (S < .6) pumpkin(.3, .05, .24);
      mum(.75, -.1); if (S > .4) mum(-.85, -.05);
      if (S < .45) { const [x, z] = at(1.25, -.2); M.color('#c8b06a'); for (let k = 0; k < 6; k++) { const a = k * 1.05; M.beam(new THREE.Vector3(x, y, z), new THREE.Vector3(x + Math.cos(a) * .18, y + 1.7, z + Math.sin(a) * .18), .05, .05); } M.color('#7a5a2e').cylinder(x, y + .7, z, .12, .08, 6); }
      break;
    }
    case 'flag': {
      const [bx, bz] = at(0, .05), [tx, tz] = at(0, .95);
      M.color('#8a8a86').beam(new THREE.Vector3(bx, y + 2.1, bz), new THREE.Vector3(tx, y + 2.6, tz), .03, .03);
      const fl = [['#b22234', '#f2f2f0'], ['#d0782a', '#5b3a22'], ['#2f5a8a', '#e9e4d6']][Math.floor(S * 3)];
      M.color(fl[0]).box(tx + s * -.02, y + 2.05, tz, .05, .6, .9, p.yaw + Math.PI / 2);
      M.color(fl[1]).box(tx, y + 2.15, tz, .06, .18, .88, p.yaw + Math.PI / 2);
      break;
    }
    case 'birdbath': M.color('#b9b5aa').cylinder(p.x, y, p.z, .14, .65, 8, .1); M.color('#c4c0b5').cylinder(p.x, y + .65, p.z, .38, .1, 12, .4); M.color('#7d97a3').cylinder(p.x, y + .74, p.z, .32, .02, 12); break;
    case 'gnome': M.color('#3d6fa8').cylinder(p.x, y, p.z, .1, .2, 6, .08); M.color('#e6c9a8').cylinder(p.x, y + .2, p.z, .07, .08, 6); M.color('#f1efe8').pyramid(p.x, y + .17, p.z, .14, .1, .1); M.color('#c0302a').pyramid(p.x, y + .28, p.z, .14, .2, .14); break;
    case 'planter': M.color(S < .5 ? '#7a5a3e' : '#9a4a30').box(p.x, y, p.z, .6, .45, .6, p.yaw); M.color(MUMS[Math.floor(S * 4) % 4]).cylinder(p.x, y + .45, p.z, .32, .22, 8, .14); break;
    case 'sign': { const [x, z] = at(0, 0); M.color('#6a6a66').box(x - c * .3, y, z + s * .3, .02, .7, .02, p.yaw).box(x + c * .3, y, z - s * .3, .02, .7, .02, p.yaw); M.color(['#1f4f8c', '#2f6b3a', '#f2f2ef', '#b23a2e'][Math.floor(S * 4)]).box(x, y + .45, z, .7, .45, .03, p.yaw); break; }
    case 'number': M.color('#e8e5dc').box(p.x, y, p.z, .14, 1.0, .14, p.yaw); M.color('#2b2b2b').box(p.x + s * .075, y + .7, p.z + c * .075, .1, .22, .01, p.yaw); M.color('#9c7a3a').box(p.x, y + 1.0, p.z, .2, .06, .2, p.yaw); break;
    case 'bale': { M.color('#c9b06a').box(p.x, y, p.z, 1.0, .45, .5, p.yaw); pumpkin(-.25, .05, .17); const [x, z] = at(.3, .05); M.color(MUMS[Math.floor(S * 4) % 4]).cylinder(x, y + .45, z, .2, .18, 8, .1); break; }
    case 'firepit': {
      M.color('#7d7b76').cylinder(p.x, y, p.z, .6, .3, 10, .58); M.color('#2b2724').cylinder(p.x, y + .28, p.z, .45, .03, 10);
      for (let k = 0; k < 3; k++) { const a = p.yaw + k * 2.1 + .4, x = p.x + Math.sin(a) * 1.7, z = p.z + Math.cos(a) * 1.7, col = ['#2f6b8c', '#c0302a', '#efece4', '#3f6b3a'][Math.floor(S * 4 + k) % 4];
        M.color(col).box(x, y + .3, z, .7, .08, .7, a).box(x - Math.sin(a) * .35, y + .3, z - Math.cos(a) * .35, .7, .8, .08, a);
        M.box(x + Math.cos(a) * .35, y, z - Math.sin(a) * .35, .06, .55, .7, a).box(x - Math.cos(a) * .35, y, z + Math.sin(a) * .35, .06, .55, .7, a); }
      break;
    }
    case 'trampoline': M.color('#5c6166').cylinder(p.x, y, p.z, 1.9, .8, 14, 1.9); M.color('#1d1f22').cylinder(p.x, y + .8, p.z, 1.75, .02, 14); M.color(S < .5 ? '#2f5f9c' : '#3c7a3a').cylinder(p.x, y + .78, p.z, 1.95, .06, 14); break;
    case 'woodpile': for (let k = 0; k < 3; k++) M.color(['#7a5a3a', '#8a6a46', '#6d5034'][k]).box(p.x, y + k * .32, p.z, 2.4 - k * .3, .32, .5, p.yaw); M.color('#4b4c4f').box(p.x, y + .96, p.z, 2.5, .03, .7, p.yaw); break;
    case 'bike': { const [x, z] = at(0, 0); M.color(['#c0302a', '#2f6b8c', '#d8a12b', '#8a3f78'][Math.floor(S * 4)]).beam(new THREE.Vector3(x - s * .4, y + .3, z - c * .4), new THREE.Vector3(x + s * .4, y + .3, z + c * .4), .04, .04); M.color('#1d1d1d'); for (const e of [-.4, .4]) M.cylinder(x + s * e, y + .05, z + c * e, .25, .04, 10); break; }
    case 'wheelbarrow': M.color(S < .5 ? '#2f6b3a' : '#b23a2e').box(p.x, y + .35, p.z, .6, .3, .9, p.yaw); M.color('#1d1d1d').cylinder(p.x + Math.sin(p.yaw) * .55, y + .02, p.z + Math.cos(p.yaw) * .55, .18, .08, 8); break;
    case 'tractor': M.color(S < .6 ? '#3a7a34' : '#c0302a').box(p.x, y + .3, p.z, .9, .5, 1.6, p.yaw); M.color('#262626').box(p.x - Math.sin(p.yaw) * .2, y + .75, p.z - Math.cos(p.yaw) * .2, .45, .35, .35, p.yaw); M.color('#d6b02a').box(p.x + Math.sin(p.yaw) * .5, y + .55, p.z + Math.cos(p.yaw) * .5, .85, .25, .5, p.yaw); M.color('#1d1d1d'); for (const e of [-.55, .55]) M.cylinder(p.x - Math.sin(p.yaw) * .5 + Math.cos(p.yaw) * e, y, p.z - Math.cos(p.yaw) * .5 - Math.sin(p.yaw) * e, .3, .2, 8); break;
  }
}

/** The mailboxes and outbuildings of a homestead into the street-kit mesh M. groundH(x, z) → y. */
export function drawHomestead(M, H, groundH) {
  for (const p of H.props || []) drawProp(M, p, groundH);
  const mb = H.mailbox;
  if (mb && Number.isFinite(mb.x)) {
    const y = groundH(mb.x, mb.z), c = Math.cos(mb.yaw), s = Math.sin(mb.yaw);
    M.color('#6b5440').box(mb.x, y - .3, mb.z, .1, 1.35, .1, mb.yaw);
    M.color(hash(mb.x * 3.1) < .7 ? '#2e3236' : '#d9d6cf').box(mb.x + s * .1, y + 1.05, mb.z + c * .1, .24, .25, .48, mb.yaw);
    M.color('#b8322a').box(mb.x + s * .05 + c * .13, y + 1.17, mb.z + c * .05 - s * .13, .03, .16, .05, mb.yaw);
  }
  for (const e of H.extras) {
    const y = groundH(e.x, e.z), [wall, roof] = SHEDS[Math.floor(e.seed * SHEDS.length) % SHEDS.length];
    if (e.kind === 'shed') gableHut(M, e.x, y, e.z, 2.4 + e.seed, 3 + e.seed * 1.2, 2.1, .9, e.yaw, wall, roof, { c: '#efece4', w: 1.3, h: 1.85 });
    else if (e.kind === 'garage') gableHut(M, e.x, y, e.z, 4, 6.2, 2.6, 1.3, e.yaw, wall, roof, { c: '#e6e3dc', w: 2.6, h: 2.2 });
    else if (e.kind === 'pool') {
      // an above-ground pool: a round wall of blue-grey panels, the water just under the rim, a little ladder
      const R = 2.4 + e.seed * 1.2;
      M.color('#b9c3c9').cylinder(e.x, y - .2, e.z, R, 1.4, 16);
      M.color(POOLS[Math.floor(e.seed * 3) % 3]).cylinder(e.x, y + 1.05, e.z, R - .08, .1, 16);
      M.color('#d9dde0').box(e.x + R + .2, y, e.z, .5, 1.5, .12, e.yaw);
    } else if (e.kind === 'swing') {
      // a swing set: an A-frame each end, a top bar, two swings
      const c = Math.cos(e.yaw), s = Math.sin(e.yaw), L = 1.8, H2 = 2.3, at = (a, b, hgt) => new THREE.Vector3(e.x + a * c + b * s, y + hgt, e.z - a * s + b * c);
      M.color(e.seed < .5 ? '#5d8a3f' : '#6b5440');
      for (const end of [-L, L]) { M.beam(at(-.9, end, 0), at(0, end, H2), .08); M.beam(at(.9, end, 0), at(0, end, H2), .08); }
      M.beam(at(0, -L - .1, H2), at(0, L + .1, H2), .09);
      M.color('#2f2f30');
      for (const b of [-.7, .7]) { M.beam(at(0, b - .2, H2), at(0, b - .2, .5), .02); M.beam(at(0, b + .2, H2), at(0, b + .2, .5), .02); M.color('#c7442e').box(at(0, b, .45).x, y + .42, at(0, b, .45).z, .25, .05, .5, e.yaw); M.color('#2f2f30'); }
    }
  }
}

/** The driveways (and pads) as draped strips: one geometry for a tile. */
export function driveStrips(list, groundH) {
  const pos = [], col = [];
  const asphalt = new THREE.Color('#55565a'), gravel = new THREE.Color('#a89e88');
  const push = (a, b, c, k) => { for (const p of [a, b, c]) pos.push(p[0], p[1], p[2]); for (let i = 0; i < 3; i++) col.push(k.r, k.g, k.b); };
  for (const H of list) {
    const d = H.drive, base = d.gravel ? gravel : asphalt, w = d.w / 2;
    for (let s = 0; s + 1 < d.pts.length; s++) {
      const [ax, az] = d.pts[s], [bx, bz] = d.pts[s + 1], L = Math.hypot(bx - ax, bz - az); if (L < .3) continue;
      const tx = (bx - ax) / L, tz = (bz - az) / L, nx = -tz, nz = tx, n = Math.max(1, Math.ceil(L / 2));
      const last = s + 2 === d.pts.length;
      const at = (k) => { const t = k / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t; let y = groundH(x, z) + .07; if (last && (1 - t) * L < 1.5) y = Math.max(y, d.roadY + .13); return [x, y, z]; };
      for (let k = 0; k < n; k++) {
        const p = at(k), q = at(k + 1), sh = (hash(p[0] * 1.3 + p[2] * .7) - .5) * .06, kc = base.clone().multiplyScalar(1 + sh);
        const A = [p[0] + nx * w, p[1], p[2] + nz * w], B = [p[0] - nx * w, p[1], p[2] - nz * w], C = [q[0] - nx * w, q[1], q[2] - nz * w], D = [q[0] + nx * w, q[1], q[2] + nz * w];
        push(A, C, B, kc); push(A, D, C, kc);
      }
    }
    if (d.pad) {
      const { x, z, yaw, w: pw, l } = d.pad, c = Math.cos(yaw), s = Math.sin(yaw);
      const P = (a, b) => { const px = x + a * c + b * s, pz = z - a * s + b * c; return [px, groundH(px, pz) + .07, pz]; };
      const A = P(-pw / 2, -l / 2), B = P(pw / 2, -l / 2), C = P(pw / 2, l / 2), D = P(-pw / 2, l / 2);
      push(A, C, B, base); push(A, D, C, base);
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // (both windings were pushed in one order: make every triangle face up)
  const p = g.attributes.position.array, nrm = g.attributes.normal.array;
  for (let i = 0; i < p.length; i += 9) if (nrm[i + 1] < 0) { for (let k = 0; k < 3; k++) { const t = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = t; } }
  g.computeVertexNormals();
  return g;
}

/** Is (x, z) within r of any of these homesteads' driveways? */
export function nearDrive(list, x, z, r) {
  for (const H of list) {
    const P = H.drive.pts, w = H.drive.w / 2 + r;
    for (let s = 0; s + 1 < P.length; s++) {
      const [ax, az] = P[s], [bx, bz] = P[s + 1], dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      if (Math.hypot(ax + dx * t - x, az + dz * t - z) < w) return true;
    }
    if (H.drive.pad && Math.hypot(H.drive.pad.x - x, H.drive.pad.z - z) < 3.5 + r) return true;
  }
  return false;
}
