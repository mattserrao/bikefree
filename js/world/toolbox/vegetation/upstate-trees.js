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
 *   lod 0: trunk + 3 levels, leaf-cluster cards (returned apart: { wood, leaves, crown }); sparse sprays on inner limbs, no solid core
 *   lod 1: trunk + 2 levels, solid foliage clumps round the crown
 *   lod 2: trunk + crown masses
 * o (species): H, R, trunkR, levels' children / angle / length, gnarl, up (gravitropism), droop, leader, flat, stems.
 */
// wood thickness: trunks and limbs twice the old build (user: ~100% beefier); foliage unchanged
const BEEF = 2;
function grow(seed, o, lod, turn, lodScale = 1) {
  const rand = randomSequence(seed), H = o.H, R = o.R;
  const wood = new Builder(); wood.as(o.bark);
  const clusters = [];   // leaf cluster spots { p, d (outward dir), size }
  const crown = { y: H * (o.fork + (1 - o.fork) * .52), ry: H * (1 - o.fork) * (o.flat ? .42 : .5) };
  const up = new THREE.Vector3(0, 1, 0);
  // one skeleton for every level of detail (user, 23 Nov: "the shape of the tree changes as you get closer"): the
  // branches are always grown in full — the same random draws whatever the level — and a lower level draws fewer of
  // them (mid: the trunk and main limbs, no twigs) and merges the near model's leaf clusters into fewer, larger cards
  // that cover the same crown. So the outline and the limbs stay put as the tiers swap; only the detail changes.
  const maxLevel = o.dead ? 2 : 3, woodLevel = lod === 0 ? 3 : lod === 1 ? 2 : 1;
  const snapped = o.dead && turn !== 1 ? .55 + rand() * .15 : 1;   // (a snag: its top broken off)
  const queue = [];
  const stems = o.stems || 1;
  let trunk = null;   // the first stem's skeleton (a near 3D trunk can be built along it: old-growth.js)
  for (let s = 0; s < stems; s++) {
    const a = s * 2.4 + rand(), tilt = stems > 1 ? .12 + rand() * .08 : rand() * .04;
    queue.push({ level: 0, p: new THREE.Vector3(stems > 1 ? Math.cos(a) * .45 : 0, 0, stems > 1 ? Math.sin(a) * .45 : 0), d: new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt)),
      len: H * (o.leader ? .86 : o.fork + .08) * (stems > 1 ? .95 : 1) * snapped, r: o.trunkR * BEEF * (stems > 1 ? .75 : 1) });
  }
  const L = o.levels;   // per level (1..3): [children, start (0–1 up the parent), angle (rad from the parent), length ratio]
  while (queue.length) {
    const br = queue.shift(), lv = br.level;
    const sections = Math.max(2, [8, 5, 3, 2][lv]), seg = lod ? [5, 4, 3, 3][lv] : [8, 6, 4, 3][lv];
    const pts = [br.p.clone()], radii = [br.r], dirs = [br.d.clone()];
    let p = br.p.clone(), d = br.d.clone();
    const step = br.len / sections;
    for (let i = 1; i <= sections; i++) {
      // gnarliness: thin branches wander more; gravitropism: pulled toward the light (or hanging: willow)
      const g = o.gnarl * (lv ? 1 : .35) / Math.max(.25, br.r / BEEF * 4);
      d.x += (rand() - .5) * g; d.z += (rand() - .5) * g; d.y += (rand() - .5) * g * .5;
      d.lerp(o.droop && lv >= 2 ? new THREE.Vector3(d.x, -1, d.z).normalize() : up, (o.droop && lv >= 2 ? .18 : o.up) * (lv ? 1 : .3)).normalize();
      p = p.clone().addScaledVector(d, step);
      pts.push(p); dirs.push(d.clone());
      radii.push(br.r * Math.max(.06, 1 - (i / sections) * (lv === 0 && !o.leader ? .45 : .9)));
    }
    if (lv === 0 && !trunk) trunk = { pts: pts.map((q) => q.clone()), radii: radii.slice(), fork: L ? L[0][1] : 1 };
    if (lv <= woodLevel) {
      // (a lower level: every other point of the same branch — the same curve, fewer rings)
      const keep = lod ? pts.map((_, i) => i).filter((i) => i % 2 === 0 || i === pts.length - 1) : null;
      wood.add(keep ? tube(keep.map((i) => pts[i]), keep.map((i) => radii[i]), seg) : tube(pts, radii, seg), new THREE.Matrix4(), o.trunk);
    }
    if (lv === 0 && !o.stems) for (let k = 0; k < 5; k++) { const a = k * 1.26 + rand() * .4; if (!lod) wood.add(cone(br.r * .5, 1.3, 3), M(Math.cos(a) * br.r * .6, 0, Math.sin(a) * br.r * .6, 1, 1, 1, -a, 0, .32), o.trunk); }
    // children
    if (lv < maxLevel) {
      const [nc, start, angle, ratio] = L[lv];
      const count = nc;
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
        queue.push({ level: lv + 1, p: cp, d: nd, len, r: Math.max(.04, cr * (lv ? .55 : .62)) });
      }
    }
    // leaf clusters along the outer branches (and at the tip of every branch at the last level)
    // inner limbs: a few small sprays where light gets in (keeps the crown from reading hollow, without a solid core)
    if (lv === 1 && maxLevel > 1 && !o.droop) {
      const n = 2;
      for (let k = 0; k < n; k++) {
        const i = Math.min(pts.length - 1, Math.round((.5 + .4 * rand()) * (pts.length - 1)));
        if (rand() < .7) clusters.push({ p: pts[i].clone(), size: .55 + rand() * .2 });
      }
    }
    if (lv >= maxLevel - 1 && lv > 0) {
      const per = 2;
      for (let k = 0; k < per; k++) {
        const t = lv === maxLevel ? .45 + .55 * (k + 1) / per : .55 + .45 * (k + 1) / per, i = Math.min(pts.length - 1, Math.round(t * (pts.length - 1)));
        clusters.push({ p: pts[i].clone(), size: (lv === maxLevel ? 1 : 1.25) * (.8 + rand() * .4) });
      }
    }
  }
  if (o.dead) {
    // bare: no leaves; the leaning one tipped over ~12° (the base stays put)
    const g = wood.build();
    if (turn === 2) g.rotateZ(.21);
    return lod === 2 ? g : { wood: g, leaves: null };
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
  // every cluster's colour from the full set (so a merged card keeps the colour its part of the crown has near)
  for (const c of clusters) c.col = colourAt(c.p);
  if (lod === 1) mergeClusters(clusters, rand);
  const leafKind = o.droop ? SHRUB : LEAF, leafScale = Math.min(1, Math.max(.24, H / 12));
  if (lod === 2) {
    // far: crown masses over the clusters' extent
    wood.as(leafKind);
    for (let k = 0; k < 3; k++) { const a = k * 2.1 + rand(), d = k ? rad * .35 : 0; wood.add(blob(0), M(cc.x + Math.cos(a) * d, cc.y + (k ? -radY * .15 : radY * .1), cc.z + Math.sin(a) * d, rad * (k ? .75 : .95), radY * (k ? .8 : 1), rad * (k ? .75 : .95)), colourAt(cc).c, 0, rand); }
    return wood.build();
  }
  // near and mid: a hidden inner shell (darker: the canopy's shaded inside — keeps the crown from reading see-through),
  // then leaf-cluster cards — three crossed quads near, two larger ones mid — normals spherized from the crown's centre
  // (no inner shell any more: it read as a dense ball at the core. Sparse small sprays on the inner limbs fill instead.)
  wood.as(leafKind);
  const pos = [], nor = [], uv = [], col = [], tw = [];
  const v = new THREE.Vector3(), qn = new THREE.Vector3();
  for (const c of clusters) {
    const { c: hex, out } = c.col, k = new THREE.Color(hex).multiplyScalar((lod ? .86 : .8) + out * (lod ? .24 : .28));   // depth: darker inside
    // (a leaf cluster's size is a tree's: on a small plant — a shrub, a sapling, a seedling — scaled down with it, so a
    //  1.4 m seedling isn't a 4 m ball of leaf cards and a bush isn't a few huge blobs: user, 24 Nov, "bushes remain a
    //  weak spot"; their fullness comes from the fluff sheets below)
    const size = (lod ? c.half ?? 2.3 * c.size : 1.75 * c.size) * (o.droop ? .9 : 1) * leafScale, quads = lod ? 2 : 3;
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
  // a bush's fluff (user, 24 Nov: "Bushes remain a weak spot visually … fluff them with 2D vertical sheets over various
  // size to intermediate layers"): upright leaf sheets in three nested shells round the crown's middle — small and dark
  // deep inside, middling halfway, large and lit at the rim — each turned to face out (give or take), so the bush reads
  // as a full, soft mass with depth from any side, not a scatter of clusters on twigs
  if (o.fluff && lod === 0) {
    const shells = [[.3, 7, .32, .55], [.62, 11, .42, .74], [.92, 15, .5, .96]];   // [radius fraction, sheets, size (× crown radius), shade]
    for (const [fr, n, sz, shade] of shells) for (let q = 0; q < n * o.fluff; q++) {
      const a = q * 2.39996 + rand() * .7, hf = rand() * 2 - 1, ring = Math.sqrt(Math.max(0, 1 - hf * hf * .8));
      const size = rad * sz * (.75 + rand() * .5);
      const p = new THREE.Vector3(cc.x + Math.cos(a) * rad * fr * ring, Math.max(size * .85, cc.y + hf * radY * fr * .9), cc.z + Math.sin(a) * rad * fr * ring);
      const yaw = a + Math.PI / 2 + (rand() - .5) * 1.1;
      const ax = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw)), ay = new THREE.Vector3(0, 1, 0);
      const { c: hex } = colourAt(p), k = new THREE.Color(hex).multiplyScalar(shade * (.9 + rand() * .2));
      const corner = (sx, sy) => p.clone().addScaledVector(ax, sx * size).addScaledVector(ay, sy * size * .85);
      const P = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, -1), corner(1, 1), corner(-1, 1)], U = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]];
      const u0 = Math.floor(rand() * 2) * .5, v0 = Math.floor(rand() * 2) * .5;
      P.forEach((pp, i) => {
        pos.push(pp.x, pp.y, pp.z);
        qn.set((pp.x - cc.x) / rad, (pp.y - cc.y) / radY + .1, (pp.z - cc.z) / rad).normalize();
        nor.push(qn.x, qn.y, qn.z); uv.push(u0 + U[i][0] * .5, v0 + U[i][1] * .5); col.push(k.r, k.g, k.b); tw.push(Math.min(1, Math.max(0, pp.y / H)));
      });
    }
  }
  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); leaves.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  leaves.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); leaves.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  leaves.computeBoundingSphere(); leaves.computeBoundingBox();
  // (the crown's underside: the lowest leaves, a few strays aside — a near 3D trunk is cut a little below it)
  if (trunk) { const ys = clusters.map((c) => c.p.y).sort((a, b) => a - b); trunk.crown = ys.length ? ys[Math.floor(ys.length * .03)] : H * .5; }
  return { wood: wood.build(), leaves, trunk };
}
/**
 * The mid tier's foliage from the near tier's: the clusters gathered into about a third as many (k-means, seeded from
 * every third), each new card centred on its members and sized to reach the outer edge of their near cards — so the
 * crown's outline is the near model's, in fewer, larger cards. In place; sets c.half (the card's half size).
 */
function mergeClusters(list, rand) {
  const k = Math.max(3, Math.round(list.length / 3)), near = (m) => 1.75 * m.size;
  let seeds = list.filter((_, i) => i % 3 === 0).slice(0, k).map((c) => c.p.clone());
  let groups;
  for (let it = 0; it < 4; it++) {
    groups = seeds.map(() => []);
    for (const c of list) { let bi = 0, bd = Infinity; seeds.forEach((s, i) => { const d = s.distanceToSquared(c.p); if (d < bd) { bd = d; bi = i; } }); groups[bi].push(c); }
    seeds = groups.map((g, i) => g.length ? g.reduce((a, c) => a.add(c.p), new THREE.Vector3()).divideScalar(g.length) : seeds[i]);
  }
  const out = [];
  groups.forEach((g, i) => {
    if (!g.length) return;
    const p = seeds[i];
    // its reach: the farthest member's card edge, a little in (the crossed cards overlap); its colour: the biggest member's
    let half = 0, big = g[0];
    for (const m of g) { half = Math.max(half, p.distanceTo(m.p) + near(m) * .95); if (m.size > big.size) big = m; }
    out.push({ p, size: big.size, half: Math.max(half, near(big)), col: big.col });
  });
  list.length = 0; list.push(...out);
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
  beech: { H: 21, R: 7, fork: .22, trunkR: .45, trunk: '#86837b', bark: BARK, leader: true, flat: true, gnarl: .2, up: .03,
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
  // ornamentals for the yards (user, 23 Nov): Japanese maple (small, low and spreading, deep red), flowering crab (a
  // small round crown on a short trunk, rust and red in fall), a clump of white birches
  jmaple: { H: 5, R: 3.2, fork: .18, trunkR: .12, trunk: '#4d3f36', bark: BARK, stems: 2, flat: true, gnarl: .35, up: .02,
    levels: [[5, .3, .95, .42], [3, .3, .7, .22], [3, .35, .6, .12]],
    greens: ['#7a2a24', '#8a3128', '#6a2420'], fall: ['#b0281c', '#c43a22', '#9e2218'], turn: [.55, .9] },
  crabapple: { H: 6.5, R: 3.6, fork: .3, trunkR: .16, trunk: '#4a3d33', bark: BARK, gnarl: .4, up: .04, flat: true,
    levels: [[5, .55, .8, .42], [3, .3, .7, .24], [3, .35, .6, .12]],
    greens: ['#4e7434', '#57803a', '#4a6c31'], fall: ['#b8562a', '#c9722e', '#a83a22'], turn: [.3, .65] },
  birchclump: { H: 12, R: 3.2, fork: .5, trunkR: .13, trunk: '#e6e2d6', bark: WHITE, leader: true, stems: 3, gnarl: .18, up: .08,
    levels: [[4, .45, .7, .26], [3, .3, .6, .16], [3, .4, .55, .09]],
    greens: ['#6f9a48', '#7ca452', '#668f43'], fall: ['#e2c548', '#d8b13a', '#ecd469'], turn: [.2, .7] },
  // a dead tree (snag; user, 23 Nov: "interspersed dead trees", ~6%, more visible): a grey, barkless trunk and a few
  // bare limbs, no leaves. Variants (turn = the variant): 0 broken off at two-thirds, 1 tall with its main limbs,
  // 2 leaning, its top snapped
  snag: { H: 19, R: 4, fork: .45, trunkR: .4, trunk: '#8c877c', bark: DEAD, leader: true, gnarl: .35, up: .03, dead: true,
    levels: [[4, .45, .85, .3], [2, .3, .7, .16], [1, .4, .6, .08]],
    greens: ['#6e6a60'], fall: ['#6e6a60'], turn: [0, 1, 2] },
};

// (user, 24 Nov, with photos of a golden beech–maple stand: the forest-grown forms — the Camillus woods only — at peak:
//  gold and yellow with some orange and the odd green crown; the rest of CNY stays early fall)
// forest-grown forms (Camillus Forest Unique Area, user 24 Nov: "when hiking through wooded areas, the trees are tall
// and mature … the tops of the trees extend high and cover the sky"): grown in a closed stand, each reaches for the
// light — a long, clean bole (the lower limbs shaded out and shed long ago), a narrow, high crown in the top third or
// so, limbs ascending. Only for a map with old growth (makeUpstateTrees({ oldGrowth: true })): the DEC's inventory —
// the old stand ~83 % sugar maple and ~13 % beech; bitternut hickory, basswood and white ash in the younger woods.
const FOREST_FORMS = {
  // sugar maple: a straight grey-brown bole to ~60 % of its height, a tall, rounded crown of ascending limbs
  sugarmapleF: { H: 29, R: 5.4, fork: .6, trunkR: .5, trunk: '#5a4d42', bark: PLATED, leader: true, gnarl: .15, up: .1,
    levels: [[7, .58, .6, .25], [4, .3, .62, .15], [3, .35, .6, .085]],
    greens: ['#6b8a34', '#77913a', '#5f7f31'], fall: ['#e2a62a', '#d98c24', '#eab838', '#cf7522'], turn: [.82, .96] },
  // American beech: the smooth elephant-grey bole, longer limbs a little lower, a broad top; bronze late
  beechF: { H: 26, R: 6.2, fork: .5, trunkR: .48, trunk: '#7f7c75', bark: BARK, leader: true, gnarl: .18, up: .06,
    levels: [[7, .5, .82, .29], [4, .3, .65, .17], [3, .35, .6, .095]],
    greens: ['#7a8c3a', '#86923e'], fall: ['#d4a83a', '#c99434', '#e0b848'], turn: [.72, .9] },
  // bitternut hickory: tall and straight, a smallish crown of stout ascending limbs; bright yellow early
  hickory: { H: 27, R: 4.8, fork: .58, trunkR: .42, trunk: '#6a6259', bark: PLATED, leader: true, gnarl: .2, up: .09,
    levels: [[6, .56, .58, .25], [3, .3, .6, .15], [3, .4, .55, .085]],
    greens: ['#7a8a38', '#84923c'], fall: ['#e4c43c', '#d9b42e', '#ecd050'], turn: [.95] },
  // basswood: a tall bole often with sprouts at its foot, a dense, broad crown of big heart-shaped leaves; yellowing
  basswood: { H: 27, R: 6, fork: .52, trunkR: .46, trunk: '#655c52', bark: BARK, leader: true, gnarl: .17, up: .07,
    levels: [[7, .52, .72, .27], [4, .3, .65, .16], [3, .35, .6, .09]],
    greens: ['#76903e', '#80983f'], fall: ['#d6c24e', '#c9b048'], turn: [.78] },
};

/**
 * A big fallen trunk (old growth's coarse woody debris, user: "dead logs … nurse logs and life"), lying along +x from
 * its root end: bark sloughing to grey wood, moss along the top, broken limb stubs; a nurse log carries a row of
 * seedlings (hemlock and maple) rooted in its rotting top. A tip-up's trunk keeps its root plate standing on end at the
 * foot (the pit-and-mound's mound — the hollow the plate tore up is the ground's own relief, old-growth.js).
 */
function bigLog(seed, { L = 15, r = .5, nurse = false, tipup = false } = {}) {
  const rand = randomSequence(seed), b = new Builder();
  b.as(nurse ? DEAD : BARK).add(cyl(r * .62, r, L, 8), M(L / 2, r * .85, 0, 1, 1, 1, 0, 0, Math.PI / 2), nurse ? '#7d7266' : '#5a4838');
  // moss: a soft green mat along the top, thicker on an old log
  // moss in patches (user, 24 Nov: "Moss: patchy, textured" — it was one flat green slab): cushions of differing size
  // and green along the top and down the shaded side, thicker on an old nurse log, bare bark showing between
  b.as(SHRUB);
  const patches = nurse ? 18 : 10;
  for (let k = 0; k < patches; k++) {
    const x = L * (.05 + rand() * .9), side = (rand() - .5) * 2.2, sz = r * (.18 + rand() * .32) * (nurse ? 1.2 : 1);
    const a = side * .9, y = r * .85 + Math.cos(a) * r * .98, z = Math.sin(a) * r * .98;
    b.add(blob(0), M(x, y, z, sz * (1.2 + rand()), sz * .35, sz, rand() * 6, a, 0), ['#5f7d3d', '#4f6c35', '#6a8644', '#7a8a46', '#55703a'][Math.floor(rand() * 5)], .2, rand);
    if (rand() < .4) b.add(blob(0), M(x + (rand() - .5) * sz, y + sz * .12, z, sz * .45, sz * .22, sz * .45), '#87964c', .2, rand);
  }
  b.as(DEAD);
  for (let k = 0; k < 5; k++) b.add(cyl(.03, .08, .7 + rand() * 1.2, 3), M(L * (.25 + rand() * .7), r * 1.4, (rand() - .5) * r, 1, 1, 1, rand() * 6.28, 0, .5 + rand() * .9), '#857e72');
  if (nurse) {
    // the seedlings along its back: little hemlocks (dark cones) and maples (a stem, a tuft of leaves)
    for (let k = 0; k < 8; k++) {
      const x = L * (.12 + k * .1 + rand() * .05), h = .35 + rand() * .7, y = r * 1.65;
      if (rand() < .5) { b.as(BARK).add(cyl(.015, .025, h, 3), M(x, y, (rand() - .5) * r * .6), '#5b4a3a'); b.as(LEAF).add(cone(h * .32, h * .8, 5), M(x, y + h * .25, (rand() - .5) * r * .4), '#2f4f37'); }
      else { b.as(BARK).add(cyl(.012, .02, h, 3), M(x, y, (rand() - .5) * r * .6), '#6a5646'); b.as(SHRUB).add(blob(0), M(x, y + h, (rand() - .5) * r * .5, h * .35, h * .2, h * .35), ['#5f8a3d', '#d68a2c', '#6c9342'][k % 3], .1, rand); }
    }
  }
  if (tipup) {
    // the root plate on end: a ragged disc of soil and roots 2.5–3.5 m across, a stone or two caught in it
    const R = 1.3 + rand() * .5;
    // (ragged, not a dome: three lobes of torn earth, a pale mineral-soil face, a lip of leaf litter on top —
    //  the plain dark disc read as a black ball against the litter: user's snapshots, 24 Nov)
    b.as(BARK).add(blob(1), M(-.25, R * .9, 0, .4, R, R * 1.05), '#6e5640', .35, rand);
    for (let k = 0; k < 3; k++) { const a = k * 2.1 + rand(); b.add(blob(1), M(-.25, R * .9 + Math.sin(a) * R * .55, Math.cos(a) * R * .6, .32, R * .55, R * .5), ['#7a6146', '#66503b', '#84694c'][k], .35, rand); }
    b.add(blob(0), M(-.02, R * .85, 0, .22, R * .7, R * .75), '#9a8264', .25, rand);
    b.as(SHRUB).add(blob(0), M(-.3, R * 1.85, 0, .5, .22, R * .8), '#a8782e', .2, rand);
    for (let k = 0; k < 14; k++) { const a = k / 14 * 6.28 + rand() * .3; b.add(cyl(.02, .07, R * (.5 + rand() * .5), 3), M(-.2, R * .9 + Math.sin(a) * R * .85, Math.cos(a) * R * .9, 1, 1, 1, 0, a, Math.PI / 2 + (rand() - .5) * .6), '#6f5a44'); }
    b.as(DEAD).add(blob(1), M(-.35, R * .5, R * .35, .35, .3, .4), '#8d8c84', .2, rand);
  } else {
    // a snapped end: splintered, pale
    b.as(DEAD).add(cone(r * .9, r * 1.4, 6), M(L + r * .4, r * .85, 0, 1, 1, 1, 0, 0, -Math.PI / 2), '#b4a68e', .3, rand);
  }
  return b.build();
}
/** Spring ephemerals gone to summer leaf (waterleaf, blue cohosh, touch-me-not; DEC's commonest understory plants): a
 *  low, soft clump of broad leaves, yellowing a little in September. */
function herb(seed) {
  // (user, 24 Nov: herbs "softer, yellowing"): a loose clump of broad, soft leaves on short stalks, held out and up, the
  // edges curling — waterleaf and touch-me-not in late September, more yellow than green now
  const rand = randomSequence(seed), b = new Builder(); b.as(SHRUB);
  const n = 9 + Math.floor(rand() * 4);
  for (let k = 0; k < n; k++) {
    const a = k * 2.4 + rand() * .6, tilt = 1. + rand() * .45, len = .14 + rand() * .1, h = .05 + rand() * .16;
    const col = ['#8f9c46', '#a8a44c', '#bfa64e', '#c9b25a', '#7f9442', '#b08a3c'][Math.floor(rand() * 6)];
    const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), base = out.clone().multiplyScalar(.04 + rand() * .08).setY(h);
    // the stalk
    b.add(cyl(.006, .008, h + .02, 3), M(base.x * .5, 0, base.z * .5), '#7d8a3e', 0, rand);
    const dir = out.clone().multiplyScalar(Math.sin(tilt)).setY(Math.cos(tilt)).normalize(), side = new THREE.Vector3(-out.z, 0, out.x);
    const face = new THREE.Vector3().crossVectors(side, dir).normalize();
    b.add(bladeGeo(.4), new THREE.Matrix4().makeBasis(side.clone().multiplyScalar(len * .85), dir.clone().multiplyScalar(len), face).setPosition(base), col, 0, rand);
  }
  return b.build();
}

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

// shrubs as small multi-stemmed 'trees' for grow(): H and R at model size, a low fork, short dense branching
const SHRUBS = {
  dogwood: { H: 2.6, R: 1.5, fluff: 1, fork: .25, trunkR: .035, trunk: '#7a3328', bark: BARK, stems: 5, gnarl: .3, up: .1,
    levels: [[4, .35, .55, .45], [3, .3, .6, .25], [2, .4, .6, .12]],
    greens: ['#5a7d3a', '#6a8740', '#55763a'], fall: ['#8a3a34', '#a3473c', '#7a2f2c'], turn: [.55] },
  buckthorn: { H: 3.4, R: 1.9, fluff: 1, fork: .22, trunkR: .045, trunk: '#4f4339', bark: BARK, stems: 4, gnarl: .35, up: .08,
    levels: [[5, .3, .6, .45], [3, .3, .6, .25], [2, .4, .6, .12]],
    greens: ['#4d7232', '#557a36', '#62843d'], fall: ['#8a9a3c'], turn: [.15] },
};
// ---- understory: forest-edge and hedgerow shrubs, sumac (scarlet in early fall), saplings, ferns, logs and stumps
function shrubClump(seed, colors, n, r, h) {
  const rand = randomSequence(seed), b = new Builder();
  b.as(BARK); for (let k = 0; k < 3; k++) limb(b, new THREE.Vector3((rand() - .5) * r * .5, 0, (rand() - .5) * r * .5), dirOf(rand() * 6.28, 1.1 + rand() * .3), h * .7, .05, .02, 3, '#5b4a3a');
  b.as(SHRUB);
  for (let k = 0; k < n; k++) { const a = k * 2.4 + rand(), d = rand() * r * .55; b.add(blob(1), M(Math.cos(a) * d, h * (.45 + rand() * .35), Math.sin(a) * d, r * (.4 + rand() * .2), h * (.3 + rand() * .12), r * (.4 + rand() * .2), rand() * 6), colors[k % colors.length], 0, rand); }
  return b.build();
}
function sumac(seed) {
  // staghorn sumac: a clump of bare, leaning stems, each topped by a spray of long pinnate fronds that arch out and
  // droop, their narrow leaflets in pairs — scarlet and orange in September, a few still green; a dark red seed cone
  const rand = randomSequence(seed), b = new Builder(), Q = new THREE.Quaternion(), S = new THREE.Vector3(.75, 1, .28);
  const leaflet = (p, dir, len, col) => { Q.setFromUnitVectors(Y, dir); b.add(cone(.05, len, 3), new THREE.Matrix4().compose(p, Q, S), col, 0, rand); };
  const stems = 5 + Math.floor(rand() * 3);
  for (let s = 0; s < stems; s++) {
    const a = rand() * 6.28, r0 = .2 + rand() * .7, base = new THREE.Vector3(Math.cos(a) * r0, 0, Math.sin(a) * r0), h = 1.6 + rand() * 1.8;
    const lean = dirOf(a, 1.2 + rand() * .2), top = base.clone().addScaledVector(lean, h);
    b.as(BARK); limb(b, base, lean, h, .055, .03, 4, '#6a5646');
    b.as(SHRUB);
    const hue = rand(), tones = hue < .55 ? ['#c62f1c', '#d8432a', '#b52619'] : hue < .85 ? ['#df6a2a', '#e5862f', '#c9502a'] : ['#8a9a3c', '#a39a3a', '#7d8c38'];
    const fronds = 5 + Math.floor(rand() * 3);
    for (let f = 0; f < fronds; f++) {
      const az = a + f * (6.28 / fronds) + rand() * .5, d0 = dirOf(az, .35 + rand() * .35), L = .7 + rand() * .4;
      const side = new THREE.Vector3().crossVectors(d0, Y).normalize();
      const pairs = 6;
      for (let j = 0; j < pairs; j++) {
        const t = (j + 1) / (pairs + 1), p = top.clone().addScaledVector(d0, t * L); p.y -= .4 * t * t;
        const len = .28 * (1 - t * .45), col = tones[(j + f) % 3];
        for (const sg of [-1, 1]) leaflet(p, side.clone().multiplyScalar(sg).addScaledVector(d0, .45).add(new THREE.Vector3(0, -.3, 0)).normalize(), len, col);
      }
      const tip = top.clone().addScaledVector(d0, L); tip.y -= .4;
      leaflet(tip, d0.clone().add(new THREE.Vector3(0, -.4, 0)).normalize(), .24, tones[f % 3]);
    }
    if (rand() < .6) b.add(cone(.07, .32, 4), M(top.x, top.y - .05, top.z), '#7a2418');   // the seed cone
  }
  return b.build();
}
// a flat leaf blade, both faces: base at the origin, tip at +y (length 1), widest at `at` up it, width 1
function bladeGeo(at = .4) {
  const P = [0, 0, 0, -.5, at, 0, -.18, .82, 0, 0, 1, 0, .18, .82, 0, .5, at, 0], N = [], I = [];
  const pos = [...P, ...P];
  for (let k = 0; k < 6; k++) N.push(0, 0, 1); for (let k = 0; k < 6; k++) N.push(0, 0, -1);
  for (const [a, b, c] of [[0, 5, 4], [0, 4, 3], [0, 3, 2], [0, 2, 1]]) { I.push(a, b, c); I.push(c + 6, b + 6, a + 6); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setIndex(I);
  return g;
}
function fern(seed) {
  // (user, 24 Nov: "green paper strips" → "Real fern fronds"): a crown of arching, twice-divided fronds — each a
  // rachis with paired pinnae, long in the middle and tapering to a fine tip, each pinna a row of little lobes — the
  // fronds of late September: most still green, some gone yellow, a few bronze and drooping. Drawn in 3D near the path
  // (near-trunks.js NearPlants), its card farther off.
  const rand = randomSequence(seed), b = new Builder(), Q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  const lobe = (p, dir, up, len, w, col) => {
    // a blade along dir, its face turned toward `up` (the frond's own top)
    const x = new THREE.Vector3().crossVectors(dir, up).normalize(), zN = new THREE.Vector3().crossVectors(x, dir).normalize();
    const m = new THREE.Matrix4().makeBasis(x.multiplyScalar(w), dir.clone().multiplyScalar(len), zN).setPosition(p);
    b.add(bladeGeo(.45), m, col, 0, rand);
  };
  b.as(SHRUB);
  const fronds = 7 + Math.floor(rand() * 3);
  for (let f = 0; f < fronds; f++) {
    const a = f * 2.4 + rand() * .5, L = .75 + rand() * .45, up = .45 + rand() * .3, out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const r = rand(), col = r < .1 ? '#8a5a2c' : r < .3 ? '#b49a46' : r < .4 ? '#9c9a44' : ['#4c7432', '#587f37', '#62893d'][f % 3];
    const droop = r < .1 ? .35 : 0;
    const at = (t) => out.clone().multiplyScalar(L * t + .03).add(new THREE.Vector3(0, Math.max(.02, (up - droop) * Math.sin(Math.PI * t * .7) - (.12 + droop) * t * t), 0));
    const N = 10;
    for (let k = 1; k <= N; k++) {
      const t = k / N, p0 = at(t - 1 / N), p = at(t), d = p.clone().sub(p0), dl = d.length(); d.normalize();
      const side = new THREE.Vector3().crossVectors(d, Y).normalize(), top = new THREE.Vector3().crossVectors(side, d).normalize();
      lobe(p0, d, top, dl * 1.05, .018, col);   // the rachis
      const plen = (.22 * Math.sin(Math.PI * Math.min(1, t * 1.1)) + .025) * (.9 + rand() * .2);
      for (const sg of [-1, 1]) {
        const pd = side.clone().multiplyScalar(sg).addScaledVector(d, .45).addScaledVector(top, -.12).normalize();
        // a pinna: lobes along it, shrinking to its tip
        const lobes = Math.max(1, Math.min(2, Math.round(plen / .09)));
        for (let q = 0; q < lobes; q++) {
          const u = (q + .5) / lobes, c = p.clone().addScaledVector(pd, plen * u);
          const ld = d.clone().addScaledVector(pd, .4).normalize(), lw = plen * .5 * (1 - u * .6);
          lobe(c, ld, top, Math.max(.02, lw), lw * .55, col);
        }
        lobe(p, pd, top, plen, .02, col);   // its midrib
      }
    }
  }
  void Q; void Z;
  return b.build();
}
function rock(seed, w, h) {
  // a fieldstone: a lichen-grey boulder half sunk, a moss cap on top
  const rand = randomSequence(seed), b = new Builder(); b.as(BARK);
  b.add(blob(1), M(0, h * .35, 0, w, h, w * (.7 + rand() * .3), rand() * 6), ['#8a8a82', '#7d7c74', '#95938a'][Math.floor(rand() * 3)], 0, rand);
  b.add(blob(1), M(w * .1, h * .8, 0, w * .6, h * .25, w * .5, rand() * 6), '#5f6f3c', 0, rand);
  return b.build();
}

/** The kit: every species' variants in three levels of detail, and the understory pieces. */
export function makeUpstateTrees({ oldGrowth = false } = {}) {
  return withSmooth(true, () => {
    const species = {};
    for (const [name, o] of Object.entries(SPECIES)) {
      const k = Object.keys(SPECIES).indexOf(name);
      const variants = o.turn.map((turn, v) => [0, 1, 2].map((lod) => grow(4001 + k * 37 + v * 7, o, lod, turn)));
      species[name] = { h: o.H, r: o.R, variants, turn: o.turn, wet: !!o.droop };
    }
    // the forest-grown forms: only where a map has old growth (each variant a row in the impostor atlas)
    if (oldGrowth) for (const [name, o] of Object.entries(FOREST_FORMS)) {
      const k = Object.keys(FOREST_FORMS).indexOf(name);
      species[name] = { h: o.H, r: o.R, variants: o.turn.map((turn, v) => [0, 1, 2].map((lod) => grow(4701 + k * 41 + v * 9, o, lod, turn))), turn: o.turn, forest: true };
    }
    species.whitepine = { h: 30, r: 5.5, variants: [0, 1].map((v) => [0, 1, 2].map((lod) => whitePine(v, lod))), turn: [0, 0] };
    species.hemlock = { h: 22, r: 4.2, variants: [0, 1].map((v) => [0, 1, 2].map((lod) => hemlock(v, lod))), turn: [0, 0] };
    species.spruce = { h: 20, r: 3.6, variants: [0, 1].map((v) => [0, 1, 2].map((lod) => spruce(v, lod))), turn: [0, 0] };
    // yard evergreens: Colorado blue spruce (a blue-grey cone) and arborvitae (a narrow dark-green column)
    species.bluespruce = { h: 10, r: 2.8, variants: [0, 1].map((v) => [0, 1, 2].map((lod) => MOUNTAIN_BUILDERS.conifer(5401 + v, { H: 9 + v * 2, R: 2.8, colors: ['#62818a', '#6d8d94', '#57747c'], trunk: '#4d3b2e',
      trunkBase: .22, droop: .25, jag: .25, seg: 7, layers: 9, crown: .02, top: 'leader', under: 3 }, lod))), turn: [0, 0] };
    species.arborvitae = { h: 6, r: 1.1, variants: [0, 1].map((v) => [0, 1, 2].map((lod) => MOUNTAIN_BUILDERS.conifer(5501 + v, { H: 5.5 + v, R: 1.1, colors: ['#3f5f33', '#4a6b3a', '#36552e'], trunk: '#4d3b2e',
      trunkBase: .1, droop: .05, jag: .15, seg: 6, layers: 8, crown: .3, top: 'leader', under: 2 }, lod))), turn: [0, 0] };
    // every species' near and mid tiers as { wood, leaves } (leaves: the leaf-cluster cards, null for the conifers)
    for (const s of Object.values(species)) for (const t of s.variants) for (const k of [0, 1]) if (t[k].isBufferGeometry) t[k] = { wood: t[k], leaves: null };
    const understory = {
      // the shrubs grown as the trees are (user, 23 Nov: "confirm shrubs are included in the new tree generating"): several
      // thin stems from the ground, short twiggy branching, leaf-cluster cards — not the old solid blobs
      dogwood: grow(6101, SHRUBS.dogwood, 0, .55),          // red-osier dogwood / honeysuckle: red stems, wine-red turning
      buckthorn: grow(6111, SHRUBS.buckthorn, 0, .15),      // buckthorn / honeysuckle thicket: stays green late
      goldenrod: MOUNTAIN_BUILDERS.spikes ? MOUNTAIN_BUILDERS.spikes(6121, 9, .9, '#6f8650', '#e2b931', '#d9a92c', .35) : shrubClump(6121, ['#d9b334'], 3, .6, .9),
      sumac: sumac(6131), sumac2: sumac(6132),
      fern: fern(6141), fern2: fern(6142),
      rock: rock(6161, .55, .4), rock2: rock(6162, .9, .55),
      sapling: grow(6151, { ...SPECIES.sugarmaple, H: 5, R: 1.6, trunkR: .07, fluff: .6 }, 0, .3),
      saplingPine: whitePine(0, 1).scale(.24, .2, .24),
      log: MOUNTAIN_BUILDERS.log(0), stump: MOUNTAIN_BUILDERS.stump(0), stump2: MOUNTAIN_BUILDERS.stump(1),
    };
    if (oldGrowth) Object.assign(understory, {
      herb: herb(6231), seedling: grow(6241, { ...SPECIES.sugarmaple, H: 1.4, R: .5, trunkR: .02 }, 1, .2),
      beechSapling: grow(6251, { ...FOREST_FORMS.beechF, H: 4.5, R: 1.5, trunkR: .06, fork: .3, fluff: .6 }, 0, .1),
    });
    // the old growth's fallen trunks: 3D models drawn by old-growth.js (not cards, so not in the engine's atlas)
    const logs = oldGrowth ? { bigLog: bigLog(6201, { L: 16, r: .52 }), nurseLog: bigLog(6211, { L: 13, r: .6, nurse: true }), tipup: bigLog(6221, { L: 17, r: .5, tipup: true }), log: MOUNTAIN_BUILDERS.log(1) } : {};
    return { species, understory, logs };
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
