// Regional pack "northern-rockies" (was the Glacier kit, Going-to-the-Sun; see ./meta.js): the Northern Rockies forest in three levels of detail — western red
// cedar and hemlock in the west-side valleys, Engelmann spruce, subalpine fir and western larch higher up,
// lodgepole pine and aspen on the dry east side — plus treeline krummholz and the subalpine ground cover:
// beargrass, Indian paintbrush, glacier lilies, huckleberry and Sitka alder in the avalanche chutes.
// Low-poly, vertex-coloured, built once per scene — no extra downloads. Unit height scale is metres.
import * as THREE from '../../../../vendor/three.module.min.js';
import { randomSequence } from '../core/random.js';
import { PACK_META } from './meta.js';
import { Builder, M, cyl, cone, blob, withSmooth } from '../core/model-builder.js';

// lod 0 near, 1 mid, 2 far (one or two primitives)
// Surface kinds (aTree), drawn by decorateTreeMaterial: 0 foliage, 1 bark, 2 cedar bark, 3 pine bark,
// 4 aspen bark, 5 aspen leaves, 6 lichen, 7 silver deadwood, 8 broadleaf shrub leaves
const BARK = 1, CEDAR = 2, PINE = 3, ASPEN = 4, ASPENLEAF = 5, LICHEN = 6, DEAD = 7, LEAF = 8;

/**
 * A tier of branches: a cone whose rim zigzags (branch tips out, notches in) and droops at the tips, with
 * smooth normals so the cartoon bands run around it. `under` adds a darker underside (seen from the low
 * chase camera: the shaded inside of the tree).
 */
function whorl(r, h, seg, droop, jag, rand) {
  const n = seg * 2, pos = [0, h, 0], idx = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 + (rand() - .5) * .2, tip = i % 2 === 0;
    const rr = r * (tip ? 1 + (rand() - .5) * .22 : 1 - jag * (.8 + rand() * .4));
    const y = tip ? -droop * r * (.6 + rand() * .6) : -droop * r * .15 + h * .08;
    pos.push(Math.cos(a) * rr, y, Math.sin(a) * rr);
  }
  for (let i = 0; i < n; i++) idx.push(0, 1 + ((i + 1) % n), 1 + i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function underside(r, droop, seg) {
  const n = seg * 2, pos = [0, -droop * r * .25, 0], idx = [];
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, rr = r * (i % 2 ? .78 : .98); pos.push(Math.cos(a) * rr, -droop * r * (i % 2 ? .2 : .85), Math.sin(a) * rr); }
  for (let i = 0; i < n; i++) idx.push(0, 1 + i, 1 + ((i + 1) % n));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
const shade = (hex, k) => { const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString(); };

/** Dead lower limbs: thin grey stubs sticking out of the bare trunk. */
function stubs(b, rand, n, y0, y1, len, r0 = .12) {
  b.as(DEAD);
  for (let k = 0; k < n; k++) {
    const y = y0 + (y1 - y0) * rand(), a = rand() * 6.28, l = len * (.5 + rand() * .7);
    b.add(cyl(.015, .04, l, 3), M(Math.cos(a) * r0, y, Math.sin(a) * r0, 1, 1, 1, -a, 0, 1.35 + (rand() - .5) * .5), '#8c857a');
  }
}

/**
 * Conifer built from tiers. `o`: H height, R radius, colors (top-lit greens, light at the tips), trunk colour,
 * bark kind, droop and jag of the tiers, crown (0 to 1 up the trunk where foliage starts), top: 'leader' |
 * 'nod' (hemlock) | 'broken' | 'fork', lichen, stubs (dead lower limbs).
 */
function conifer(seed, o, lod) {
  const rand = randomSequence(seed), b = new Builder(), H = o.H, R = o.R;
  b.as(o.bark || BARK).add(cyl(o.trunkTop ?? .1, o.trunkBase ?? .34, H * (o.trunkH ?? .45), lod ? 4 : 7), M(), o.trunk);
  if (o.flare && !lod) for (let k = 0; k < 4; k++) { const a = k * 1.57 + rand() * .4; b.add(cone(o.trunkBase * .55, 1.6, 3), M(Math.cos(a) * o.trunkBase * .7, 0, Math.sin(a) * o.trunkBase * .7, 1, 1, 1, -a, 0, .25), o.trunk); }
  b.as(0);
  const crown = o.crown ?? .06;
  if (lod === 2) { b.add(cone(R * 1.02, H * (1 - crown), 6), M(0, H * crown, 0), o.colors[0]); return b.build(); }
  if (o.stubs && !lod) stubs(b, rand, o.stubs, H * .03, H * crown + 1, R * .45, (o.trunkBase ?? .34) * .8);
  b.as(0);
  const layers = lod ? 4 : (o.layers ?? 9), seg = lod ? 5 : (o.seg ?? 7);
  const top = o.top === 'broken' ? .84 : 1;
  for (let k = 0; k < layers; k++) {
    const t = k / layers;
    if (t > top - .05) break;
    const r = R * (1 - t * .86) * (.86 + rand() * .28), h = H * (1 - crown) * (1.55 / layers);
    const y = H * (crown + t * (1 - crown) * .9), lean = o.lopsided ? r * .18 : 0;
    const col = o.colors[k % o.colors.length];
    b.add(whorl(r, h, seg, o.droop ?? .22, o.jag ?? .35, rand), M(lean, y, (rand() - .5) * r * .08, 1, 1, 1, rand() * 6.28), col);
    if (!lod && k < (o.under ?? 4)) b.add(underside(r * .96, o.droop ?? .22, seg), M(lean, y + .02, 0, 1, 1, 1, rand() * 6.28), shade(col, .55));
    if (o.lichen && !lod && k < 4) {
      b.as(LICHEN);
      for (let j = 0; j < 3; j++) { const a = rand() * 6.28, d = r * (.35 + rand() * .4); b.add(cone(.05, .35 + rand() * .3, 3), M(Math.cos(a) * d, y - .35 - droopY(o, r), Math.sin(a) * d, 1, 1, 1, rand() * 3, Math.PI), '#8c977f'); }
      b.as(0);
    }
  }
  if (o.top === 'broken') {
    b.as(DEAD).add(cyl(.03, .1, H * .14, 4), M(0, H * .84, 0, 1, 1, 1, 0, .08, .05), '#9a948a');
  } else if (o.top === 'fork') {
    for (const sd of [-1, 1]) b.add(cone(R * .22, H * .14, lod ? 4 : 6), M(sd * R * .12, H * .9, 0, 1, 1, 1, 0, 0, sd * .25), o.colors[0]);
  } else if (o.top === 'nod') {
    b.add(cone(R * .16, H * .07, 5), M(R * .08, H * .955, 0, 1, 1, 1, 0, 0, -.5), o.colors[1]);
  } else {
    b.add(cone(R * .1, H * .08, 5), M(0, H * .94, 0), o.colors[1]);
  }
  return b.build();
}
const droopY = (o, r) => (o.droop ?? .22) * r * .6;

// western red cedar: broad, drooping sprays, a flared and buttressed red trunk; variant 2 has a candelabra top
const cedar = (v, lod) => conifer(1201 + v, { H: 34 + v * 5, R: 4.4 + v * .5, colors: ['#3d5f3c', '#46693f', '#365638', '#4c7043'], trunk: '#7a4630',
  bark: CEDAR, trunkBase: .95, trunkTop: .3, trunkH: .55, flare: true, droop: .5, jag: .3, seg: 8, layers: 9, crown: .14, top: v === 2 ? 'fork' : 'nod', under: 5 }, lod);
// western hemlock: soft, feathery tiers, the nodding leader
const hemlock = (v, lod) => conifer(1301 + v, { H: 30 + v * 5, R: 3.7, colors: ['#2f4d3a', '#38584a', '#2b4637'], trunk: '#5b4636',
  trunkBase: .55, trunkTop: .2, trunkH: .55, droop: .42, jag: .28, seg: 7, layers: 9, crown: .18, top: 'nod', stubs: 3 }, lod);
// Engelmann spruce: a tall, narrow spire with branches near the ground; variant 2 has a broken top
const spruce = (v, lod) => conifer(1401 + v, { H: 27 + v * 4, R: 2.6 + v * .25, colors: ['#2c4a3d', '#345445', '#3b5b4a'], trunk: '#5a4434',
  trunkBase: .34, droop: .25, jag: .38, seg: 7, layers: 10, crown: .05, top: v === 2 ? 'broken' : 'leader', lopsided: v === 1, stubs: 2, lichen: true }, lod);
// subalpine fir: very narrow, dense, with old-man's-beard lichen on the lower branches; variant 2 forks
const subalpineFir = (v, lod) => conifer(1501 + v, { H: 15 + v * 3, R: 1.35 + v * .15, colors: ['#25412f', '#2c4936', '#33523d'], trunk: '#4d4036',
  trunkBase: .22, droop: .18, jag: .32, seg: 6, layers: 10, crown: .03, top: v === 2 ? 'fork' : 'leader', lichen: true, under: 3 }, lod);

function lodgepole(v, lod) {
  // lodgepole pine: a tall straight pole that has shed its lower limbs (stubs), a short tufted crown
  const rand = randomSequence(1601 + v), b = new Builder(), H = 22 + v * 4;
  b.as(PINE).add(cyl(.12, .3, H * .92, lod ? 4 : 6), M(), '#7a5c42').as(0);
  if (lod === 2) { b.add(blob(0), M(0, H * .8, 0, 1.9, H * .22, 1.9), '#3a5733'); return b.build(); }
  if (!lod) stubs(b, rand, 9, H * .15, H * .6, 1.1, .22);
  b.as(0);
  const side = v === 2 ? 1 : 0;   // variant 2: a lopsided, wind-bent crown
  for (let k = 0; k < (lod ? 2 : 6); k++) {
    const a = k * 2.2 + rand(), d = k ? .7 + rand() * .6 : 0;
    b.add(blob(0), M(Math.cos(a) * d + side * .8, H * (.64 + k * .06), Math.sin(a) * d, 1.5 + rand() * .5, 1.3 + rand() * .5, 1.5 + rand() * .5), ['#3a5733', '#456239', '#33502f'][k % 3], .15, rand);
  }
  return b.build();
}

function larch(variant, lod, fall) {
  // western larch: tall and open, short soft tufts along a long trunk with plated bark (gold in October)
  const rand = randomSequence(1701 + variant), b = new Builder(), H = 32 + variant * 5, R = 2.6;
  const leaf = fall ? ['#d2a53a', '#ddb54a', '#c3922e'] : ['#58783f', '#638346', '#4f6f3b'];
  b.as(PINE).add(cyl(.18, .52, H * .92, lod ? 4 : 6), M(), '#8a5434').as(0);
  if (lod === 2) { b.add(cone(R, H * .62, 5), M(0, H * .36, 0), leaf[0]); return b.build(); }
  if (!lod) stubs(b, rand, 6, H * .1, H * .34, 1.3, .4);
  b.as(0);
  const layers = lod ? 3 : 8;
  for (let k = 0; k < layers; k++) {
    const t = k / layers, r = R * (1 - t * .8) * (.8 + rand() * .4);
    b.add(whorl(r, H * .07, lod ? 4 : 6, .12, .55, rand), M((rand() - .5) * .5, H * (.36 + t * .58), (rand() - .5) * .5, 1, 1, 1, rand() * 6.28), leaf[k % 3]);
  }
  return b.build();
}

function aspen(variant, lod, fall) {
  // quaking aspen: a slim white trunk (dark eyes drawn by the shader), a small round crown that shimmers
  const rand = randomSequence(1801 + variant), b = new Builder(), H = 14 + variant * 3;
  const leaf = fall ? ['#e4c047', '#ecd062', '#d9a936'] : ['#6a8c4d', '#749652', '#5f8247'];
  b.as(ASPEN).add(cyl(.1, .16, H * .75, lod ? 4 : 6), M(), '#e2dfd2');
  if (!lod) for (let k = 0; k < 3; k++) { const a = rand() * 6.28; b.add(cyl(.03, .06, 2.2, 3), M(Math.cos(a) * .08, H * (.5 + k * .08), Math.sin(a) * .08, 1, 1, 1, -a, 0, .7), '#d6d2c4'); }
  b.as(ASPENLEAF);
  if (lod === 2) { b.add(blob(0), M(0, H * .74, 0, 2.2, 3.4, 2.2), leaf[0]); return b.build(); }
  for (let k = 0; k < (lod ? 2 : 6); k++) {
    const a = k * 2.1 + rand();
    b.add(blob(0), M(Math.cos(a) * (k ? 1 : 0), H * (.62 + k * .06), Math.sin(a) * (k ? 1 : 0), 1.4 + rand() * .5, 1.5 + rand() * .4, 1.4 + rand() * .5), leaf[k % 3], .15, rand);
  }
  return b.build();
}

// ---- the forest floor: down logs with root wads, stumps, moss mats, fallen branches, small rocks ----
function log(variant) {
  const rand = randomSequence(2601 + variant), b = new Builder(), L = 7 + variant * 3, r = .28 + variant * .08;
  b.as(variant ? DEAD : BARK).add(cyl(r * .75, r, L, 7), M(0, r * .8, 0, 1, 1, 1, 0, 0, Math.PI / 2), variant ? '#9b958a' : '#5e4a3a');
  b.as(0).add(cyl(r * .55, r * .78, L * .7, 5), M(-L * .1, r * 1.55, 0, 1, .25, 1, 0, 0, Math.PI / 2), '#5c7a3e');   // moss along the top
  b.as(BARK);
  // the root wad at the foot: a flattened tangle, dark with soil
  b.add(blob(0), M(.3, r * 1.1, 0, .35, r * 3.2, r * 3.1), '#4a3b2e', .2, rand);
  for (let k = 0; k < 6; k++) { const a = k * 1.05; b.add(cyl(.03, .07, r * 3, 3), M(.25, r * 1.1, 0, 1, 1, 1, a, 0, Math.PI / 2 + .9), '#5a4836'); }
  // a few broken branch stubs
  b.as(DEAD);
  for (let k = 0; k < 4; k++) b.add(cyl(.02, .05, .8 + rand() * .6, 3), M(-L * (.2 + rand() * .7), r * 1.4, (rand() - .5) * .2, 1, 1, 1, rand() * 6.28, 0, .6 + rand()), '#857e72');
  return b.build();
}
function stump(variant) {
  const rand = randomSequence(2701 + variant), b = new Builder(), r = .35 + variant * .15, h = .5 + variant * .45;
  b.as(BARK).add(cyl(r * .92, r * 1.08, h, 7), M(), '#5d4a3a');
  b.as(DEAD).add(cyl(r * .86, r * .86, .04, 7), M(0, h, 0), '#b8a48a');   // the sawn or broken top
  b.as(0).add(blob(0), M(r * .4, h * .3, 0, r * .6, h * .4, r * .7), '#5f7c40', .1, rand);   // moss on the north side
  return b.build();
}
function mossMat(variant) {
  const rand = randomSequence(2801 + variant), b = new Builder();
  for (let k = 0; k < 4; k++) b.add(blob(0), M((rand() - .5) * 1.4, 0, (rand() - .5) * 1.2, .7 + rand() * .5, .1 + rand() * .06, .6 + rand() * .4), ['#56743a', '#4c6a35', '#62803f'][k % 3], .15, rand);
  return b.build();
}
function deadBranch(variant) {
  const rand = randomSequence(2901 + variant), b = new Builder();
  b.as(DEAD).add(cyl(.03, .06, 2.4 + variant, 3), M(0, .06, 0, 1, 1, 1, 0, 0, Math.PI / 2), '#8a8174');
  for (let k = 0; k < 3; k++) b.add(cyl(.01, .025, .6 + rand() * .5, 3), M(-(.4 + rand()) , .07, 0, 1, 1, 1, rand() * 6, 0, 1 + rand() * .8), '#7d7568');
  return b.build();
}
function stone(variant) {
  const rand = randomSequence(3001 + variant), b = new Builder();
  b.add(blob(0), M(0, .12, 0, .35 + variant * .25, .22 + variant * .15, .3 + variant * .2, rand() * 6), variant ? '#8b8478' : '#7d786f', .12, rand);
  b.add(blob(0), M(.05, .2 + variant * .15, 0, .25 + variant * .2, .06, .22 + variant * .16), '#5f7a42', .1, rand);   // moss cap
  return b.build();
}

function krummholz(variant) {
  // wind-pruned subalpine fir mats at the treeline, flagged downwind
  const rand = randomSequence(1901 + variant), b = new Builder();
  for (let k = 0; k < 5; k++) b.add(blob(0), M((rand() - .3) * 2.4, .45 + rand() * .3, (rand() - .5) * 1.6, 1.2 + rand() * .6, .55 + rand() * .3, 1 + rand() * .4), ['#223d33', '#2a4639'][k % 2], .14, rand);
  b.add(cone(.5, 2.2 + variant, 5), M(-.4, 0, 0), '#294538', .1, rand);
  return b.build();
}

function snag(variant, lod) {
  // a fire-killed conifer: a silver, bark-shed trunk, charcoal at the foot, a few broken stubs, a snapped top
  const rand = randomSequence(1901 + variant), b = new Builder(), H = 20 + variant * 6;
  b.add(cyl(.12, .42, H, lod ? 4 : 6), M(), variant ? '#a7a39a' : '#9c978d');
  b.add(cyl(.38, .44, .9 + variant * .5, lod ? 4 : 6), M(), '#4a4440');            // charred base
  if (lod === 2) return b.build();
  const stubs = lod ? 3 : 9;
  for (let k = 0; k < stubs; k++) {
    const y = H * (.35 + rand() * .55), a = rand() * 6.28, len = .7 + rand() * 1.4;
    b.add(cyl(.02, .06, len, 3), M(Math.cos(a) * .15, y, Math.sin(a) * .15, 1, 1, 1, -a, 0, 1.2 + rand() * .3), '#8f8a80');
  }
  return b.build();
}

// ---- grasses: blades in fountains, several kinds and greens ----
function blades(b, rand, n, h, spread, colors, tilt = .35, w = .03) {
  for (let k = 0; k < n; k++) {
    const a = k * 2.399 + rand() * .5, d = rand() * spread, hh = h * (.6 + rand() * .55);
    b.add(cone(w, hh, 3), M(Math.cos(a) * d, 0, Math.sin(a) * d, 1, 1, 1, -a, 0, tilt * (.4 + rand())), colors[k % colors.length], .12, rand);
  }
}
function bunchgrass() { const rand = randomSequence(3101), b = new Builder(); blades(b, rand, 11, .65, .1, ['#6f8a62', '#7f9a6c', '#8fa070']); return b.build(); }
function sedge() { const rand = randomSequence(3111), b = new Builder(); blades(b, rand, 12, .3, .14, ['#4f6b3c', '#577544', '#476236'], .5, .025); return b.build(); }
function meadowgrass() {
  const rand = randomSequence(3121), b = new Builder();
  blades(b, rand, 9, .38, .12, ['#8a9a52', '#97a65c', '#7d8e4a'], .3, .022);
  for (let k = 0; k < 3; k++) { const a = rand() * 6.28, d = rand() * .1; b.add(cyl(.006, .008, .5, 3), M(Math.cos(a) * d, 0, Math.sin(a) * d), '#9c9a62'); b.add(blob(0), M(Math.cos(a) * d, .5, Math.sin(a) * d, .02, .06, .02), '#c2b07a'); }
  return b.build();
}
function drygrass() { const rand = randomSequence(3131), b = new Builder(); blades(b, rand, 10, .42, .12, ['#b39a5c', '#c2a96a', '#a08a50'], .4, .024); return b.build(); }
function tuft(variant) {
  // the dense short grass right beside the road: four blades, two greens
  const rand = randomSequence(3141 + variant), b = new Builder();
  blades(b, rand, 5, .2 + variant * .06, .09, ['#4f6b37', '#5b7740', '#668247', '#4a6434'], .6, .026);
  return b.build();
}

// ---- shrubs ----
function thimbleberry() {
  // big soft maple-like leaves on a knee-to-waist-high clump
  const rand = randomSequence(3201), b = new Builder().as(LEAF);
  for (let k = 0; k < 7; k++) b.add(blob(0), M((rand() - .5) * 1.1, .35 + rand() * .45, (rand() - .5) * 1.1, .42, .14, .4, rand() * 6, (rand() - .5) * .5), ['#6f9a4a', '#7aa652', '#628b42'][k % 3], .12, rand);
  return b.build();
}
function willow() {
  // creek-side willow: slender upright stems, narrow grey-green leaf clusters
  const rand = randomSequence(3211), b = new Builder();
  for (let k = 0; k < 6; k++) {
    const a = k * 1.05 + rand() * .3, h = 1.5 + rand() * 1;
    b.as(BARK).add(cyl(.02, .035, h, 3), M(Math.cos(a) * .15, 0, Math.sin(a) * .15, 1, 1, 1, -a, 0, .2), '#6e5a44');
    b.as(LEAF).add(blob(0), M(Math.cos(a) * (.15 + h * .2), h * .8, Math.sin(a) * (.15 + h * .2), .28, .6, .28), ['#7d9466', '#88a070', '#718a5c'][k % 3], .1, rand);
  }
  return b.build();
}
function juniper() {
  // common juniper: a low, blue-green mat over the rocks
  const rand = randomSequence(3221), b = new Builder();
  for (let k = 0; k < 6; k++) b.add(blob(0), M((rand() - .5) * 1.8, .15 + rand() * .1, (rand() - .5) * 1.4, .55 + rand() * .3, .22 + rand() * .1, .5 + rand() * .3), ['#4f6e5a', '#587866', '#476552'][k % 3], .12, rand);
  return b.build();
}
function serviceberry() {
  // a twiggy shrub with clusters of small white blossom
  const rand = randomSequence(3231), b = new Builder();
  for (let k = 0; k < 5; k++) b.as(LEAF).add(blob(0), M((rand() - .5) * 1.2, .7 + rand() * .7, (rand() - .5) * 1.2, .5, .42, .48), ['#5f8045', '#6a8a4c'][k % 2], .12, rand);
  b.as(0);
  for (let k = 0; k < 9; k++) b.add(blob(0), M((rand() - .5) * 1.3, .9 + rand() * .8, (rand() - .5) * 1.3, .1, .08, .1), '#f1efe6');
  return b.build();
}

// ---- flowers ----
function spikes(seed, n, h, stem, color, tip, r = .14) {
  const rand = randomSequence(seed), b = new Builder();
  for (let k = 0; k < n; k++) {
    const a = k * 2.4 + rand(), d = rand() * r, hh = h * (.75 + rand() * .45), x = Math.cos(a) * d, z = Math.sin(a) * d;
    b.add(cyl(.01, .014, hh * .55, 3), M(x, 0, z), stem);
    b.add(cone(.055, hh * .5, 5), M(x, hh * .5, z), k % 2 ? color : tip, .15, rand);
  }
  return b.build();
}
function daisies(seed, n, h, color, centre) {
  const rand = randomSequence(seed), b = new Builder();
  for (let k = 0; k < n; k++) {
    const a = k * 2.4 + rand(), d = .05 + rand() * .14, hh = h * (.7 + rand() * .5), x = Math.cos(a) * d, z = Math.sin(a) * d;
    b.add(cyl(.008, .012, hh, 3), M(x, 0, z), '#5d7442');
    b.add(cone(.08, .025, 6), M(x, hh, z, 1, 1, 1, rand() * 3, (rand() - .5) * .4), color);      // petals: a flat cone
    b.add(cone(.03, .04, 4), M(x, hh + .005, z), centre);
  }
  return b.build();
}
const lupine = () => spikes(3301, 6, .55, '#5f7a4a', '#6b63c4', '#857ed6');
const arnica = () => daisies(3311, 5, .36, '#f0c232', '#c98a1c');
const aster = () => daisies(3321, 5, .42, '#9a7fd0', '#e8c547');
const monkeyflower = () => spikes(3331, 6, .28, '#5c7a46', '#d0508a', '#e06a9c', .18);

function fireweed() {
  // a clump of tall stems, pink-magenta spikes on top
  const rand = randomSequence(2101), b = new Builder();
  for (let k = 0; k < 5; k++) {
    const x = (rand() - .5) * .3, z = (rand() - .5) * .3, h = .7 + rand() * .45;
    b.add(cyl(.012, .016, h, 3), M(x, 0, z), '#5f7442');
    b.add(cone(.07, .32, 4), M(x, h - .05, z), '#c4569a', .15, rand);
  }
  return b.build();
}

function beargrass() {
  // a fountain of wiry leaves with a slim stalk ending in a creamy club of tiny flowers
  const rand = randomSequence(2001), b = new Builder();
  for (let k = 0; k < 9; k++) {
    const a = k * 2.4, tilt = .55 + rand() * .4;
    b.add(cone(.04, .55, 3), M(Math.cos(a) * .07, 0, Math.sin(a) * .07, 1, 1, 1, -a, 0, tilt), '#6c7f45', .15, rand);
  }
  b.add(cyl(.012, .018, .95, 3), M(), '#7f8b55');
  b.add(blob(0), M(0, 1.0, 0, .08, .17, .08), '#e9e1c4', .08, rand);
  return b.build();
}

function paintbrush() {
  const rand = randomSequence(2011), b = new Builder();
  for (let k = 0; k < 5; k++) {
    const a = k * 2.4, r = .1 + rand() * .12, x = Math.cos(a) * r, z = Math.sin(a) * r, h = .3 + rand() * .15;
    b.add(cyl(.01, .015, h, 3), M(x, 0, z), '#5f7448');
    b.add(cone(.05, .14, 4), M(x, h - .03, z), k % 2 ? '#d0452f' : '#e0662f', .2, rand);
  }
  return b.build();
}

function glacierLily() {
  const rand = randomSequence(2021), b = new Builder();
  for (let k = 0; k < 4; k++) {
    const a = k * 1.9, r = .08 + rand() * .1, x = Math.cos(a) * r, z = Math.sin(a) * r;
    b.add(cyl(.008, .012, .22, 3), M(x, 0, z), '#62773f');
    b.add(cone(.06, .07, 5), M(x, .2, z, 1, 1, 1, 0, Math.PI), '#e8c53a', .15, rand);
  }
  return b.build();
}

function huckleberry() {
  const rand = randomSequence(2031), b = new Builder();
  for (let k = 0; k < 5; k++) b.add(blob(0), M((rand() - .5) * .9, .28 + rand() * .15, (rand() - .5) * .9, .38, .26, .36), ['#4e6a38', '#5c7540', '#6a5a3a'][k % 3], .2, rand);
  return b.build();
}

function alder(variant) {
  // Sitka alder: low, dense, springy thickets in the avalanche chutes, bent downhill
  const rand = randomSequence(2041 + variant), b = new Builder();
  for (let k = 0; k < 6; k++) b.add(blob(0), M((rand() - .3) * 2.4, .5 + rand() * .5, (rand() - .5) * 1.8, 1.1 + rand() * .5, .6 + rand() * .25, .9 + rand() * .3), ['#56783f', '#628447', '#4c6c3a'][k % 3], .15, rand);
  return b.build();
}

function talus(variant) {
  const rand = randomSequence(2051 + variant), g = blob(variant ? 1 : 0), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (.8 + rand() * .4), Math.max(-.3, p.getY(i)) * (.55 + rand() * .25), p.getZ(i) * (.8 + rand() * .4));
  return new Builder().add(g, M(0, .12, 0), variant ? '#8f7f74' : '#8a8e84', .2, rand).build();
}

export function makeNorthernRockiesPack(opts = {}) {
  // cartoon look: crowns built with smooth shading, like the Adirondack kit
  return withSmooth(opts.smooth, () => buildGlacierKit(opts));
}

function buildGlacierKit(opts) {
  const fall = !!opts.fall, geos = {};
  const tree = (name, make) => { for (const lod of [0, 1, 2]) geos[`${name}${['', '-lod', '-far'][lod]}`] = make(lod); };
  tree('cedar0', (l) => cedar(0, l)); tree('cedar1', (l) => cedar(1, l));
  tree('whemlock0', (l) => hemlock(0, l)); tree('whemlock1', (l) => hemlock(1, l));
  tree('espruce0', (l) => spruce(0, l)); tree('espruce1', (l) => spruce(1, l));
  tree('subfir0', (l) => subalpineFir(0, l)); tree('subfir1', (l) => subalpineFir(1, l));
  tree('lodgepole0', (l) => lodgepole(0, l)); tree('lodgepole1', (l) => lodgepole(1, l));
  tree('larch0', (l) => larch(0, l, fall));
  tree('aspen0', (l) => aspen(0, l, fall)); tree('aspen1', (l) => aspen(1, l, fall));
  tree('snag0', (l) => snag(0, l)); tree('snag1', (l) => snag(1, l));
  // third variants: crown character (candelabra cedar, broken-top spruce, forked fir, wind-bent pine)
  tree('cedar2', (l) => cedar(2, l)); tree('espruce2', (l) => spruce(2, l)); tree('subfir2', (l) => subalpineFir(2, l)); tree('lodgepole2', (l) => lodgepole(2, l));
  Object.assign(geos, {
    log0: log(0), log1: log(1), stump0: stump(0), stump1: stump(1), mossmat0: mossMat(0), mossmat1: mossMat(1),
    branch0: deadBranch(0), branch1: deadBranch(1), stone0: stone(0), stone1: stone(1),
    bunchgrass: bunchgrass(), sedge: sedge(), meadowgrass: meadowgrass(), drygrass: drygrass(), tuft0: tuft(0), tuft1: tuft(1),
    thimbleberry: thimbleberry(), willow: willow(), juniper: juniper(), serviceberry: serviceberry(),
    lupine: lupine(), arnica: arnica(), aster: aster(), monkeyflower: monkeyflower(),
  });
  Object.assign(geos, {
    fireweed: fireweed(),
    krummholz0: krummholz(0), krummholz1: krummholz(1),
    beargrass: beargrass(), paintbrush: paintbrush(), glacierlily: glacierLily(), huckleberry: huckleberry(),
    alder0: alder(0), alder1: alder(1), talus0: talus(0), talus1: talus(1),
  });
  DRIFTS.forEach((n, i) => { if (geos[n]) geos[`${n}D`] = drift(geos[n], 3401 + i); });
  return geos;
}

/** A drift clump: three copies of a flower clump spread over about a metre (keeps the vertex colours). */
function drift(geo, seed) {
  const rand = randomSequence(seed), parts = [];
  for (let k = 0; k < 3; k++) {
    const a = k * 2.1 + rand(), d = k ? .35 + rand() * .3 : 0, sc = .85 + rand() * .3;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6.28), new THREE.Vector3(sc, sc, sc));
    parts.push(geo.clone().applyMatrix4(m));
  }
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(geo.attributes)) {
    const size = geo.attributes[name].itemSize, arr = new Float32Array(parts.reduce((n, g) => n + g.attributes[name].array.length, 0));
    let o = 0; for (const g of parts) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  parts.forEach((g) => g.dispose()); out.computeBoundingSphere();
  return out;
}
const DRIFTS = PACK_META['northern-rockies'].drifts;

export const NORTHERN_ROCKIES_CATEGORY = Object.fromEntries(PACK_META['northern-rockies'].groundcover.map((n) => [n, 'groundcover']));
export const NORTHERN_ROCKIES_VARIANTS = PACK_META['northern-rockies'].variants;

/**
 * Surfaces for the near trees, shrubs and floor (no image textures): conifer foliage in clumps with sunlit
 * tips and dark hollows (the cartoon bands break up around them), bark by species — furrowed, stringy red
 * cedar, plated pine and larch, white aspen with black eyes, silver deadwood — moss at the foot of the
 * west-side trunks, and aspen leaves that shimmer in the wind. Fine detail fades out with distance.
 */
export function decorateTreeMaterial(material, uniforms) {
  const prev = material.onBeforeCompile, prevKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aTree; varying float vTK; varying vec3 vTO; varying vec3 vTW; uniform float uTime;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vTK = aTree; vTO = position;
        {
          vec4 tw = vec4(transformed, 1.);
          #ifdef USE_INSTANCING
            tw = instanceMatrix * tw;
          #endif
          tw = modelMatrix * tw;
          // aspen leaves quake
          if (aTree > 4.5 && aTree < 5.5) transformed += objectNormal * sin(uTime * 11. + tw.x * 3.1 + tw.z * 2.3 + position.y * 4.) * .07;
          vTW = tw.xyz;
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vTK; varying vec3 vTO; varying vec3 vTW; uniform float uTime;
        float tH(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
        float tN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
          return mix(mix(tH(i), tH(i + vec2(1., 0.)), f.x), mix(tH(i + vec2(0., 1.)), tH(i + 1.), f.x), f.y); }
        float tClump(vec3 w) { return tN(w.xz * 1.5 + w.y * .7) * .6 + tN(vec2(w.x + w.z, w.y) * 2.9) * .4; }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float tPx = length(cameraPosition - vTW) * .0017;
        float tFine = 1. - smoothstep(.04, .16, tPx);          // bark and leaf detail fade past ~60 m
        float tA = atan(vTO.z, vTO.x);
        if (vTK < .5 || (vTK > 7.5 && vTK < 8.5)) {
          // foliage: clumps lit at the tips, hollows between them
          float c = tClump(vTW * (vTK > 7.5 ? 1.8 : 1.));
          diffuseColor.rgb *= mix(1., .78 + c * .42, .35 + .65 * (1. - smoothstep(.1, .5, tPx)));
        } else if (vTK < 1.5) {
          float f = tN(vec2(tA * 6., vTO.y * .7));
          diffuseColor.rgb *= mix(1., .7 + smoothstep(.3, .7, f) * .42, tFine);
          float moss = (1. - smoothstep(.4, 2., vTO.y)) * smoothstep(.45, .6, tN(vec2(tA * 3., vTO.y * 2.)));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.24, .3, .14), moss * .4);
        } else if (vTK < 2.5) {
          // red cedar: long stringy strips, mossy buttresses
          float f = tN(vec2(tA * 16., vTO.y * .2)) * .7 + tN(vec2(tA * 41., vTO.y * .5)) * .3;
          diffuseColor.rgb *= mix(1., .74 + f * .44, tFine);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.24, .3, .14), (1. - smoothstep(.3, 1.6, vTO.y)) * smoothstep(.5, .62, tN(vec2(tA * 4., vTO.y * 1.5))) * .45);
        } else if (vTK < 3.5) {
          // pine and larch: orange-brown plates between dark cracks
          float f = tN(vec2(tA * 4.5, vTO.y * 1.6));
          float crack = 1. - smoothstep(.04, .1, abs(f - .5));
          diffuseColor.rgb *= mix(1., (1.04 + (tN(vec2(tA * 9., vTO.y * 3.)) - .5) * .2) * (1. - crack * .5), tFine);
        } else if (vTK < 4.5) {
          // aspen: chalky white, black eyes where branches fell, dark rough bark at the foot
          vec2 cell = vec2(floor(tA * 1.6), floor(vTO.y / .8));
          vec2 lc = vec2(fract(tA * 1.6) - .5, fract(vTO.y / .8) - .5);
          float eye = step(tH(cell), .45) * (1. - smoothstep(.12, .2, length(lc * vec2(1., 3.2) - vec2((tH(cell + 3.) - .5) * .4, 0.))));
          diffuseColor.rgb *= 1. - eye * .78 * tFine;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.12, .11, .1), (1. - smoothstep(.4, 1.3, vTO.y + (tN(vec2(tA * 5., 1.)) - .5) * .5)) * .75);
        } else if (vTK < 5.5) {
          // aspen leaves: silver undersides flashing as they turn
          float flick = .5 + .5 * sin(uTime * 13. + vTW.x * 5.3 + vTW.z * 4.1 + vTW.y * 3.);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.25, 1.3, 1.15), flick * .35 * (.4 + .6 * tFine));
          diffuseColor.rgb *= .85 + tClump(vTW * 2.) * .3;
        } else if (vTK > 6.5 && vTK < 7.5) {
          // silver deadwood: weathered, checked with fine cracks
          float f = tN(vec2(tA * 22., vTO.y * .3));
          diffuseColor.rgb *= mix(1., .82 + f * .3, tFine);
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if ((vTK < .5 || (vTK > 4.5 && vTK < 5.5) || (vTK > 7.5 && vTK < 8.5)) && tPx < .5) {
          // clumps catch the light: tilt the normal toward each clump's centre
          vec3 tw = vTW * (vTK > 4.5 ? 2. : 1.);
          float c0 = tClump(tw), cx = tClump(tw + vec3(.35, 0., 0.)), cz = tClump(tw + vec3(0., 0., .35)), cy = tClump(tw + vec3(0., .35, 0.));
          vec3 g = vec3(cx - c0, cy - c0, cz - c0) * 2.6 * (1. - smoothstep(.2, .5, tPx));
          normal = normalize(normal - (viewMatrix * vec4(g, 0.)).xyz);
        }`);
  };
  material.customProgramCacheKey = () => `${prevKey}|bf-glacier-trees-1`;
  return material;
}

// Shared builders for other mountain packs (alps): the same shapes, other species and colours.
export const MOUNTAIN_BUILDERS = { conifer, whorl, underside, stubs, blades, spikes, daisies, drift, log, stump, mossMat, deadBranch, stone, talus, alder, willow, juniper, krummholz };
export const SURFACE = { BARK, CEDAR, PINE, ASPEN, ASPENLEAF, LICHEN, DEAD, LEAF };
