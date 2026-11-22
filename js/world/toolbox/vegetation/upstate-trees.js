// Toolbox vegetation: upstate New York trees (CNY, SKAN; user, 22 Nov 2026: "redo trees in the Going-to-the-Sun
// style — branches; varied texture, shape and size; lifelike full-size trees; LOD changes by distance"). Built like
// the northern-rockies pack (Going-to-the-Sun): a trunk with real limbs and sub-branches, foliage in clumps at the
// branch ends (the clump shader lights their tips and shades the hollows), bark by species (decorateTreeMaterial's
// surface kinds), smooth cartoon shading, three levels of detail:
//   lod 0  near (≤ ~120 m): trunk, 4–6 limbs each with two sub-branches, 9–15 foliage clumps   (~900–1,600 tris)
//   lod 1  mid  (≤ ~450 m): trunk, 3–4 limbs, 5–7 clumps                                       (~150–260 tris)
//   lod 2  far  (≤ ~900 m): trunk and two or three crown masses                                (~45–70 tris)
// Species (the full upstate mix): sugar maple, red maple, red oak, white ash, black cherry, American beech, paper
// birch, weeping/black willow (by water), white pine, eastern hemlock, and Norway spruce (yards, windbreaks).
// Early fall (user): each broadleaf has three variants — green, turning, turned — and the planter picks among them
// so about a quarter of the trees show colour (maples most, oaks and beech least).
//
//   const kit = makeUpstateTrees()  → { species: { name: { h, r, kind, variants: [[g0, g1, g2], …], turn: [p0, p1, p2] } },
//                                       understory: { name: geometry } }
import * as THREE from '../../../../vendor/three.module.min.js';
import { randomSequence } from '../core/random.js';
import { Builder, M, cyl, cone, blob, withSmooth } from '../core/model-builder.js';
import { MOUNTAIN_BUILDERS } from '../packs/northern-rockies.js';

// surface kinds (decorateTreeMaterial): 0 foliage clumps, 1 bark, 3 plated bark (pine), 4 white bark with eyes (birch),
// 7 silver deadwood, 8 broadleaf shrub leaves
const LEAF = 0, BARK = 1, PLATED = 3, WHITE = 4, DEAD = 7, SHRUB = 8;
const Y = new THREE.Vector3(0, 1, 0);

/** A tapered limb from p along unit dir, length len: a cylinder turned from +Y onto dir. */
function limb(b, p, dir, len, r0, r1, seg, color) {
  const q = new THREE.Quaternion().setFromUnitVectors(Y, dir);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(1, 1, 1));
  b.add(cyl(r1, r0, len, seg), m, color);
}
const dirOf = (az, el) => new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
const mixHex = (a, b, t) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();

/**
 * A swept branch: a gently curved, tapered tube along pts (parallel-transport frames, so it doesn't twist), radius
 * radii[i] at each point, `seg` sides. Smooth normals. Returns an indexed geometry ready for Builder.add.
 */
function tube(pts, radii, seg) {
  const n = pts.length, pos = [], idx = [];
  let T = pts[1].clone().sub(pts[0]).normalize(), N = Math.abs(T.y) < .9 ? new THREE.Vector3(0, 1, 0).cross(T).normalize() : new THREE.Vector3(1, 0, 0).cross(T).normalize();
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const T2 = (i < n - 1 ? pts[i + 1].clone().sub(pts[i - 1]) : pts[i].clone().sub(pts[i - 1])).normalize();
      const ax = T.clone().cross(T2), l = ax.length();
      if (l > 1e-6) N.applyAxisAngle(ax.divideScalar(l), Math.acos(Math.max(-1, Math.min(1, T.dot(T2)))));
      T = T2;
    }
    const B = T.clone().cross(N).normalize();
    for (let k = 0; k < seg; k++) {
      const a = k / seg * Math.PI * 2, c = Math.cos(a) * radii[i], s = Math.sin(a) * radii[i];
      pos.push(pts[i].x + N.x * c + B.x * s, pts[i].y + N.y * c + B.y * s, pts[i].z + N.z * c + B.z * s);
    }
  }
  for (let i = 0; i + 1 < n; i++) for (let k = 0; k < seg; k++) {
    const a = i * seg + k, b = i * seg + (k + 1) % seg, c = a + seg, d = b + seg;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/**
 * A broadleaf tree grown as a skeleton (the EZ-Tree / three.js TreeGenerator way): every branch a curved, tapered
 * tube built section by section — each section tilted a little at random (gnarliness, more on thin branches), pulled
 * toward the light (or down: willow), the children spread up the parent at the golden angle, splayed out, each much
 * thinner than its parent (the pipe model). Leaves hang in clusters along the outer branches.
 *   lod 0: trunk + 3 levels, leaf-cluster cards (returned apart: { wood, leaves, crown }) and a hidden inner shell
 *   lod 1: trunk + 2 levels, solid foliage clumps round the crown
 *   lod 2: trunk + crown masses
 * o (species): H, R, trunkR, levels' children / angle / length, gnarl, up (gravitropism), droop, leader, flat, stems.
 */
function grow(seed, o, lod, turn, lodScale = 1) {
  const rand = randomSequence(seed), H = o.H, R = o.R;
  const wood = new Builder(); wood.as(o.bark);
  const clusters = [];   // leaf cluster spots { p, d (outward dir), size }
  const crown = { y: H * (o.fork + (1 - o.fork) * .52), ry: H * (1 - o.fork) * (o.flat ? .42 : .5) };
  const up = new THREE.Vector3(0, 1, 0);
  const maxLevel = lod === 0 ? 3 : lod === 1 ? 2 : 1;   // (lod 1: the clusters sit on the second level's branches)
  const queue = [];
  const stems = o.stems || 1;
  for (let s = 0; s < stems; s++) {
    const a = s * 2.4 + rand(), tilt = stems > 1 ? .12 + rand() * .08 : rand() * .04;
    queue.push({ level: 0, p: new THREE.Vector3(stems > 1 ? Math.cos(a) * .3 : 0, 0, stems > 1 ? Math.sin(a) * .3 : 0), d: new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt)),
      len: H * (o.leader ? .86 : o.fork + .08) * (stems > 1 ? .95 : 1), r: o.trunkR * (stems > 1 ? .75 : 1) });
  }
  const L = o.levels;   // per level (1..3): [children, start (0–1 up the parent), angle (rad from the parent), length ratio]
  while (queue.length) {
    const br = queue.shift(), lv = br.level;
    const sections = Math.max(2, (lod ? [5, 3, 2, 2] : [8, 5, 3, 2])[lv]), seg = lod ? [5, 4, 3, 3][lv] : [8, 6, 4, 3][lv];
    const pts = [br.p.clone()], radii = [br.r], dirs = [br.d.clone()];
    let p = br.p.clone(), d = br.d.clone();
    const step = br.len / sections;
    for (let i = 1; i <= sections; i++) {
      // gnarliness: thin branches wander more; gravitropism: pulled toward the light (or hanging: willow)
      const g = o.gnarl * (lv ? 1 : .35) / Math.max(.25, br.r * 4);
      d.x += (rand() - .5) * g; d.z += (rand() - .5) * g; d.y += (rand() - .5) * g * .5;
      d.lerp(o.droop && lv >= 2 ? new THREE.Vector3(d.x, -1, d.z).normalize() : up, (o.droop && lv >= 2 ? .18 : o.up) * (lv ? 1 : .3)).normalize();
      p = p.clone().addScaledVector(d, step);
      pts.push(p); dirs.push(d.clone());
      radii.push(br.r * Math.max(.06, 1 - (i / sections) * (lv === 0 && !o.leader ? .45 : .9)));
    }
    wood.add(tube(pts, radii, seg), new THREE.Matrix4(), lv ? o.trunk : o.trunk);
    if (lv === 0 && !lod && !o.stems) for (let k = 0; k < 5; k++) { const a = k * 1.26 + rand() * .4; wood.add(cone(br.r * .5, 1.3, 3), M(Math.cos(a) * br.r * .6, 0, Math.sin(a) * br.r * .6, 1, 1, 1, -a, 0, .32), o.trunk); }
    // children
    if (lv < maxLevel) {
      const [nc, start, angle, ratio] = L[lv];
      const count = lod && lv ? Math.max(2, Math.round(nc * .6)) : nc;
      for (let c = 0; c < count; c++) {
        const t = start + (1 - start) * (count > 1 ? c / (count - 1) : .5) * .94, fi = t * (pts.length - 1), i0 = Math.min(pts.length - 2, Math.floor(fi)), f = fi - i0;
        const cp = pts[i0].clone().lerp(pts[i0 + 1], f), cd = dirs[i0].clone().lerp(dirs[i0 + 1], f).normalize(), cr = radii[i0] + (radii[i0 + 1] - radii[i0]) * f;
        // golden-angle roll round the parent, splayed out by `angle`
        const roll = c * 2.39996 + rand() * .6 + seed;
        const side = new THREE.Vector3(1, 0, 0); if (Math.abs(cd.x) > .9) side.set(0, 0, 1);
        const n1 = side.cross(cd).normalize(), n2 = cd.clone().cross(n1);
        const out = n1.multiplyScalar(Math.cos(roll)).add(n2.multiplyScalar(Math.sin(roll)));
        const ang = angle * (.8 + rand() * .4);
        const nd = cd.clone().multiplyScalar(Math.cos(ang)).addScaledVector(out, Math.sin(ang)).normalize();
        const len = H * ratio * (1 - (t - start) * .4) * (.8 + rand() * .4);
        queue.push({ level: lv + 1, p: cp, d: nd, len, r: Math.max(.025, cr * (lv ? .55 : .62)) });
      }
    }
    // leaf clusters along the outer branches (and at the tip of every branch at the last level)
    if (lv >= maxLevel - (lod ? 0 : 1) && lv > 0) {
      const per = lod ? (lv === maxLevel ? 3 : 1) : 2;
      for (let k = 0; k < per; k++) {
        const t = lv === maxLevel ? .45 + .55 * (k + 1) / per : .55 + .45 * (k + 1) / per, i = Math.min(pts.length - 1, Math.round(t * (pts.length - 1)));
        clusters.push({ p: pts[i].clone(), size: (lv === maxLevel ? 1 : 1.25) * (.8 + rand() * .4) });
      }
    }
  }
  // the crown's centre (for spherized normals and depth shading): the clusters' mean
  const cc = new THREE.Vector3(); for (const c of clusters) cc.add(c.p); if (clusters.length) cc.divideScalar(clusters.length); else cc.set(0, crown.y, 0);
  let rad = 0, radY = 0; for (const c of clusters) { rad = Math.max(rad, Math.hypot(c.p.x - cc.x, c.p.z - cc.z)); radY = Math.max(radY, Math.abs(c.p.y - cc.y)); }
  rad = Math.max(rad, R * .5); radY = Math.max(radY, 1.5);
  // one tree turns one way (a maple orange, its neighbour red), the top and outside first
  const hue = o.fall[Math.floor(rand() * o.fall.length)], hue2 = o.fall[Math.floor(rand() * o.fall.length)];
  const colourAt = (p) => {
    const out = Math.min(1, Math.hypot((p.x - cc.x) / rad, (p.y - cc.y) / radY, (p.z - cc.z) / rad));
    const g = o.greens[Math.floor(rand() * o.greens.length)], u = rand(), top = (p.y - cc.y) / radY;
    let c = u < turn * (.75 + top * .35 + out * .3) ? (rand() < .7 ? hue : mixHex(hue, hue2, .5)) : u < turn * 1.4 ? mixHex(g, hue, .4) : g;
    return { c, out };
  };
  const leafKind = o.droop ? SHRUB : LEAF;
  if (lod === 2) {
    // far: crown masses over the clusters' extent
    wood.as(leafKind);
    for (let k = 0; k < 3; k++) { const a = k * 2.1 + rand(), d = k ? rad * .35 : 0; wood.add(blob(0), M(cc.x + Math.cos(a) * d, cc.y + (k ? -radY * .15 : radY * .1), cc.z + Math.sin(a) * d, rad * (k ? .75 : .95), radY * (k ? .8 : 1), rad * (k ? .75 : .95)), colourAt(cc).c, 0, rand); }
    return wood.build();
  }
  // near and mid: a hidden inner shell (darker: the canopy's shaded inside — keeps the crown from reading see-through),
  // then leaf-cluster cards — three crossed quads near, two larger ones mid — normals spherized from the crown's centre
  const shell = Math.min(rad, radY * 1.3) * .42;
  wood.as(leafKind).add(blob(1), M(cc.x, cc.y - radY * .12, cc.z, shell * 1.1, shell * .8, shell * 1.1), shadeHex(o.greens[0], .42), 0, rand);
  const pos = [], nor = [], uv = [], col = [], tw = [];
  const v = new THREE.Vector3(), qn = new THREE.Vector3();
  for (const c of clusters) {
    const { c: hex, out } = colourAt(c.p), k = new THREE.Color(hex).multiplyScalar((lod ? .84 : .72) + out * (lod ? .26 : .34));   // depth: darker inside
    const size = (lod ? 2.3 : 1.75) * c.size * (o.droop ? .9 : 1), quads = lod ? 2 : 3;
    for (let q = 0; q < quads; q++) {
      const yaw = rand() * Math.PI, pitch = q === 2 || (lod && q === 1) ? Math.PI / 2 - .3 + rand() * .3 : (rand() - .5) * .6;
      const ax = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw)), ay = new THREE.Vector3(0, Math.cos(pitch), 0).addScaledVector(new THREE.Vector3(-Math.sin(yaw), 0, Math.cos(yaw)), Math.sin(pitch));
      const hy = o.droop ? size * 1.5 : size;
      const corner = (sx, sy) => v.copy(c.p).addScaledVector(ax, sx * size).addScaledVector(ay, sy * hy - (o.droop ? hy * .6 : 0)).clone();
      const P = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, -1), corner(1, 1), corner(-1, 1)], U = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]];
      const u0 = (Math.floor(rand() * 2)) * .5, v0 = (Math.floor(rand() * 2)) * .5;   // one of the texture's four leaf clusters
      P.forEach((pp, i) => {
        pos.push(pp.x, pp.y, pp.z);
        qn.set((pp.x - cc.x) / rad, (pp.y - cc.y) / radY + .25, (pp.z - cc.z) / rad).normalize();
        nor.push(qn.x, qn.y, qn.z);
        uv.push(u0 + U[i][0] * .5, v0 + U[i][1] * .5);
        col.push(k.r, k.g, k.b);
        tw.push(Math.min(1, Math.max(0, pp.y / H)));
      });
    }
  }
  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); leaves.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  leaves.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); leaves.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  leaves.computeBoundingSphere(); leaves.computeBoundingBox();
  return { wood: wood.build(), leaves };
}
const shadeHex = (hex, k) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();

// ---- species: proportions at their model size (the planter scales each to its own height)
const SPECIES = {
  // levels: per level [children, start (0–1 up the parent), splay (rad from the parent), length (× H)]
  // sugar maple: dense oval crown, a short trunk dividing into several stout ascending limbs; brilliant orange in fall
  sugarmaple: { H: 22, R: 6.5, fork: .34, trunkR: .45, trunk: '#5e5145', bark: BARK, gnarl: .22, up: .06,
    levels: [[6, .7, .62, .46], [4, .3, .65, .24], [3, .35, .6, .12]],
    greens: ['#4e7a37', '#57833c', '#476f33', '#5d8a40'], fall: ['#e07b22', '#d8641f', '#eaa232', '#c94b1d'], turn: [0, .4, .85] },
  // red maple: smaller, rounder, smooth grey bark; scarlet early (wet ground and roadsides)
  redmaple: { H: 18, R: 5.2, fork: .3, trunkR: .32, trunk: '#7c7a74', bark: BARK, gnarl: .25, up: .05,
    levels: [[5, .65, .7, .46], [4, .3, .7, .25], [3, .35, .6, .13]],
    greens: ['#55803c', '#4d7737', '#5f8842'], fall: ['#c4321e', '#d84a24', '#a8261b', '#e06a2a'], turn: [0, .45, .9] },
  // red oak: broad, spreading crown on heavy, crooked, near-horizontal limbs off a central leader; turns late, russet
  redoak: { H: 24, R: 8, fork: .32, trunkR: .55, trunk: '#4f453c', bark: BARK, leader: true, flat: true, gnarl: .4, up: .02,
    levels: [[7, .32, 1.15, .4], [4, .25, .7, .22], [3, .35, .7, .11]],
    greens: ['#41622f', '#4a6c34', '#3b5a2b'], fall: ['#8e4a22', '#a35a28', '#7a4a2a'], turn: [0, 0, .45] },
  // white ash: tall, open oval crown, a straight leader, opposite-ish ascending branches; purple-bronze and yellow early
  whiteash: { H: 24, R: 5.5, fork: .42, trunkR: .42, trunk: '#6e675d', bark: BARK, leader: true, gnarl: .15, up: .08,
    levels: [[6, .42, .8, .34], [3, .3, .6, .2], [3, .4, .55, .1]],
    greens: ['#567a3a', '#5e8240', '#4f7235'], fall: ['#c8a845', '#8c5a5e', '#b9903f'], turn: [0, .3, .8] },
  // black cherry: tall and narrow, dark scaly bark, an irregular, leaning crown
  blackcherry: { H: 20, R: 4.6, fork: .45, trunkR: .34, trunk: '#3d3430', bark: PLATED, leader: true, gnarl: .32, up: .05,
    levels: [[5, .45, .75, .3], [3, .3, .7, .19], [3, .4, .6, .1]],
    greens: ['#4c7233', '#557b38'], fall: ['#d08a33', '#c25f2a', '#d9ac3e'], turn: [0, .3, .7] },
  // American beech: smooth silver-grey trunk, long limbs from low down, a broad low crown; golden-bronze late
  beech: { H: 21, R: 7, fork: .22, trunkR: .45, trunk: '#9a9890', bark: BARK, leader: true, flat: true, gnarl: .2, up: .03,
    levels: [[7, .2, 1.05, .4], [4, .3, .65, .22], [3, .35, .6, .11]],
    greens: ['#5a843c', '#628c42', '#527a37'], fall: ['#c9a440', '#b9893a'], turn: [0, .1, .4] },
  // paper birch: white stems (two or three from the base), a light airy crown, yellow in fall
  birch: { H: 17, R: 3.8, fork: .5, trunkR: .2, trunk: '#e6e2d6', bark: WHITE, leader: true, stems: 2, gnarl: .18, up: .08,
    levels: [[5, .45, .7, .26], [3, .3, .6, .16], [3, .4, .55, .09]],
    greens: ['#6f9a48', '#7ca452', '#668f43'], fall: ['#e2c548', '#d8b13a', '#ecd469'], turn: [0, .45, .9] },
  // willow (black / weeping, by water): a short, leaning trunk, arching limbs, drooping yellow-green curtains
  willow: { H: 15, R: 6.5, fork: .3, trunkR: .5, trunk: '#5b5046', bark: BARK, droop: true, gnarl: .3, up: .04,
    levels: [[5, .7, .8, .45], [4, .3, .7, .28], [3, .3, .5, .16]],
    greens: ['#8aab52', '#7d9c48', '#96b45c'], fall: ['#c2b347'], turn: [0, .15, .35] },
};

/** Eastern white pine: tall, with long horizontal limbs carrying flat, layered sprays; a ragged, often flagged top. */
function whitePine(v, lod) {
  // eastern white pine: a tall straight trunk, long near-horizontal limbs in whorls, each carrying a flat, ragged,
  // layered spray of needles (dark blue-green, lighter at the tips); the crown open and irregular, the top flagged
  const rand = randomSequence(5101 + v), b = new Builder(), H = 30 + v * 3, lean = rand() * 6.28;
  b.as(PLATED); limb(b, new THREE.Vector3(), dirOf(lean, Math.PI / 2 - .02), H * .97, .55, .12, lod ? 5 : 7, '#584536');
  if (!lod) MOUNTAIN_BUILDERS.stubs(b, rand, 6, H * .1, H * .4, 1.2, .45);
  b.as(LEAF);
  if (lod === 2) {
    b.add(blob(0), M(Math.cos(lean) * 1.6, H * .8, Math.sin(lean) * 1.6, 5.6, 3, 4.6, -lean), '#2f4d36');
    b.add(blob(0), M(-Math.cos(lean), H * .6, -Math.sin(lean), 4.6, 2.4, 4, -lean), '#2a4630');
    return b.build();
  }
  const whorls = lod ? 5 : 9;
  for (let t = 0; t < whorls; t++) {
    const y = H * (.38 + .58 * t / whorls) + (rand() - .5), arms = lod ? 3 : 4 + (rand() < .4 ? 1 : 0);
    for (let a = 0; a < arms; a++) {
      if (rand() < .15) continue;   // a missing limb: the open, irregular crown
      const az = lean * .4 + a / arms * 6.28 + (rand() - .5) * 1.1 + t * .9, reach = (7 - t * .55) * (.6 + rand() * .55);
      if (reach < 1) continue;
      b.as(PLATED); limb(b, new THREE.Vector3(0, y - .3, 0), dirOf(az, .1 + rand() * .12), reach, .18, .05, lod ? 3 : 4, '#584536'); b.as(LEAF);
      // the spray: two or three flat, overlapping pads along the outer limb, the outermost lightest
      const pads = lod ? 1 : 3;
      for (let k = 0; k < pads; k++) {
        const f = .45 + k * .25, len = reach * (.5 - k * .07), x = Math.cos(az) * reach * f, z = Math.sin(az) * reach * f;
        // a jagged, slightly drooping disc of needles (the Going-to-the-Sun conifers' tier), squashed along the limb
        b.add(MOUNTAIN_BUILDERS.whorl(len, .55, lod ? 5 : 7, .2, .42, rand), M(x, y + .1 + (rand() - .5) * .5 - k * .15, z, 1, 1, .7, -az + (rand() - .5) * .5), ['#2b4734', '#33523b', '#3d5f43'][k], 0, rand);
        if (!lod) b.add(MOUNTAIN_BUILDERS.underside(len * .95, .2, 7), M(x, y + .08 - k * .15, z, 1, 1, .7, -az), '#1f3528', 0, rand);
      }
    }
  }
  b.add(blob(0), M(Math.cos(lean) * .7, H * .99, Math.sin(lean) * .7, 2.4, .9, 1.8, -lean), '#33513a', 0, rand);
  return b.build();
}
// eastern hemlock and Norway spruce: the Going-to-the-Sun conifer builder (tiers with drooping, jagged rims)
const hemlock = (v, lod) => MOUNTAIN_BUILDERS.conifer(5201 + v, { H: 22 + v * 3, R: 4.2, colors: ['#2c4a38', '#355643', '#294536'], trunk: '#5b4636',
  trunkBase: .5, trunkTop: .18, trunkH: .55, droop: .45, jag: .28, seg: 7, layers: 9, crown: .12, top: 'nod', stubs: 3 }, lod);
const spruce = (v, lod) => MOUNTAIN_BUILDERS.conifer(5301 + v, { H: 20 + v * 3, R: 3.6, colors: ['#25412f', '#2d4b37', '#345440'], trunk: '#4d3b2e',
  trunkBase: .36, droop: .5, jag: .3, seg: 7, layers: 10, crown: .03, top: 'leader', under: 5 }, lod);

// ---- understory: forest-edge and hedgerow shrubs, sumac (scarlet in early fall), saplings, ferns, logs and stumps
function shrubClump(seed, colors, n, r, h) {
  const rand = randomSequence(seed), b = new Builder();
  b.as(BARK); for (let k = 0; k < 3; k++) limb(b, new THREE.Vector3((rand() - .5) * r * .5, 0, (rand() - .5) * r * .5), dirOf(rand() * 6.28, 1.1 + rand() * .3), h * .7, .05, .02, 3, '#5b4a3a');
  b.as(SHRUB);
  for (let k = 0; k < n; k++) { const a = k * 2.4 + rand(), d = rand() * r * .55; b.add(blob(1), M(Math.cos(a) * d, h * (.45 + rand() * .35), Math.sin(a) * d, r * (.4 + rand() * .2), h * (.3 + rand() * .12), r * (.4 + rand() * .2), rand() * 6), colors[k % colors.length], 0, rand); }
  return b.build();
}
function sumac(seed) {
  // staghorn sumac: a few bare, forked stems with long pinnate fronds held up and out — scarlet and orange in September
  const rand = randomSequence(seed), b = new Builder();
  for (let s = 0; s < 4; s++) {
    const a = rand() * 6.28, base = new THREE.Vector3(Math.cos(a) * .6 * rand(), 0, Math.sin(a) * .6 * rand()), h = 2 + rand() * 1.4;
    b.as(BARK); limb(b, base, dirOf(a, 1.25), h, .06, .03, 4, '#6a5646');
    b.as(SHRUB);
    for (let f = 0; f < 4; f++) { const az = a + f * 1.57 + rand() * .4; b.add(cone(.22, 1.5, 4), M(base.x + Math.cos(a) * .3, h * .95, base.z + Math.sin(a) * .3, 1, 1, .35, -az, 0, 1.1), ['#c2321e', '#d9542a', '#e07a2e', '#8a8a38'][(s + f) % 4], 0, rand); }
    b.add(cone(.07, .35, 4), M(base.x + Math.cos(a) * .3, h * .95, base.z + Math.sin(a) * .3), '#7a2418');   // the dark red seed cone
  }
  return b.build();
}
function fern(seed) {
  const rand = randomSequence(seed), b = new Builder(); b.as(SHRUB);
  for (let k = 0; k < 7; k++) { const a = k * .9 + rand() * .4; b.add(cone(.14, .9, 3), M(Math.cos(a) * .15, .05, Math.sin(a) * .15, 1, 1, .3, -a, 0, 1.05), ['#5f8a3c', '#6c9444', '#a69443'][k % 3], 0, rand); }
  return b.build();
}

/** The kit: every species' variants in three levels of detail, and the understory pieces. */
export function makeUpstateTrees() {
  return withSmooth(true, () => {
    const species = {};
    for (const [name, o] of Object.entries(SPECIES)) {
      const k = Object.keys(SPECIES).indexOf(name);
      const variants = o.turn.map((turn, v) => [0, 1, 2].map((lod) => grow(4001 + k * 37 + v * 7, o, lod, turn)));
      species[name] = { h: o.H, r: o.R, variants, turn: o.turn, wet: !!o.droop };
    }
    species.whitepine = { h: 30, r: 5.5, variants: [0, 1].map((v) => [0, 1, 2].map((lod) => whitePine(v, lod))), turn: [0, 0] };
    species.hemlock = { h: 22, r: 4.2, variants: [0, 1].map((v) => [0, 1, 2].map((lod) => hemlock(v, lod))), turn: [0, 0] };
    species.spruce = { h: 20, r: 3.6, variants: [0, 1].map((v) => [0, 1, 2].map((lod) => spruce(v, lod))), turn: [0, 0] };
    // every species' near and mid tiers as { wood, leaves } (leaves: the leaf-cluster cards, null for the conifers)
    for (const s of Object.values(species)) for (const t of s.variants) for (const k of [0, 1]) if (t[k].isBufferGeometry) t[k] = { wood: t[k], leaves: null };
    const understory = {
      dogwood: shrubClump(6101, ['#5a7d3a', '#6a8740', '#8a4a3a'], 5, 2.2, 2.4),          // red-osier dogwood / honeysuckle
      buckthorn: shrubClump(6111, ['#4d7232', '#557a36', '#62843d'], 6, 2.8, 3.2),
      goldenrod: MOUNTAIN_BUILDERS.spikes ? MOUNTAIN_BUILDERS.spikes(6121, 9, .9, '#6f8650', '#e2b931', '#d9a92c', .35) : shrubClump(6121, ['#d9b334'], 3, .6, .9),
      sumac: sumac(6131), sumac2: sumac(6132),
      fern: fern(6141),
      sapling: grow(6151, { ...SPECIES.sugarmaple, H: 5, R: 1.6, trunkR: .07 }, 1, .3),
      saplingPine: whitePine(0, 1).scale(.24, .2, .24),
      log: MOUNTAIN_BUILDERS.log(0), stump: MOUNTAIN_BUILDERS.stump(0), stump2: MOUNTAIN_BUILDERS.stump(1),
    };
    return { species, understory };
  });
}

/**
 * The leaf-cluster texture: four clusters (one per quarter), each a spray of small pointed leaves in light greys
 * (vertex colour tints them by species and season), a little darker toward the middle, on transparent ground.
 */
export function makeLeafTexture(size = 512) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d'), rand = randomSequence(777), h = size / 2;
  for (let q = 0; q < 4; q++) {
    const ox = (q % 2) * h, oy = Math.floor(q / 2) * h;
    for (let k = 0; k < 130; k++) {
      const r = Math.pow(rand(), .65) * h * .44, a = rand() * 6.28, x = ox + h / 2 + Math.cos(a) * r, y = oy + h / 2 + Math.sin(a) * r;
      const L = h * (.08 + rand() * .04), W = L * (.5 + rand() * .2), rot = a + (rand() - .5) * 1.2;
      const v = Math.round(255 * (.72 + rand() * .28) * (.86 + .14 * r / (h * .44)));
      g.save(); g.translate(x, y); g.rotate(rot);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.beginPath(); g.moveTo(-L * .5, 0); g.quadraticCurveTo(0, -W, L * .5, 0); g.quadraticCurveTo(0, W, -L * .5, 0); g.fill();
      g.strokeStyle = `rgba(0,0,0,.18)`; g.lineWidth = Math.max(1, size / 512); g.beginPath(); g.moveTo(-L * .45, 0); g.lineTo(L * .45, 0); g.stroke();
      g.restore();
    }
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** The early-fall pick among a species' variants (green / turning / turned): about a quarter of the trees in colour. */
export function fallVariant(sp, r) {
  const n = sp.variants.length;
  if (n === 2) return r < .5 ? 0 : 1;
  return r < .66 ? 0 : r < .86 ? 1 : 2;
}
