// Regional pack "alps" (first used by Alpe d'Huez; see ./meta.js): the forest and meadows of the French western
// Alps, in three levels of detail — walnut, ash, field maple and downy oak in the valleys, beech and silver fir on
// the shady side, Scots and Austrian black pine on the dry, sunny slopes (the Gap side, the Dévoluy limestone),
// Norway spruce and European larch higher up, Swiss stone pine (arolle) and dwarf mountain pine at the treeline —
// plus hazel, green alder, juniper, alpine rose and broom; hay meadows, alpine flowers (gentian, arnica, campanula,
// martagon lily, ox-eye daisy, umbellifers, willowherb), limestone boulders and scree; and the farm edge: round
// hay bales, post-and-rail fences, dry-stone walls, wayside crosses and fountain troughs.
// Low-poly, vertex-coloured, metres, built once per scene from the shared mountain builders.
import * as THREE from '../../../../vendor/three.module.min.js';
import { randomSequence } from '../core/random.js';
import { PACK_META } from './meta.js';
import { Builder, M, cyl, cone, blob, box, withSmooth } from '../core/model-builder.js';
import { MOUNTAIN_BUILDERS as B, SURFACE } from './northern-rockies.js';

const { BARK, PINE, DEAD, LEAF } = SURFACE;

// ---- conifers (the Rockies' tier builder, Alpine species and colours) ----
// Norway spruce: tall, dark, with long drooping branch tips ("curtain" spruce); variant 2 is a slender high-altitude form
const spruce = (v, lod) => B.conifer(5101 + v, { H: 30 + v * 3, R: v === 2 ? 2.2 : 3.3, colors: ['#22392d', '#29433a', '#2f4a3b'], trunk: '#5b4637',
  trunkBase: .42, droop: .46, jag: .3, seg: 8, layers: 11, crown: .04, top: 'leader', stubs: 2, under: 5 }, lod);
// silver fir: a softer, flat-topped ("stork's nest") crown, silver bark, upturned tiers
const fir = (v, lod) => B.conifer(5201 + v, { H: 28 + v * 4, R: 3.4, colors: ['#2a4836', '#31523d', '#2c4b38'], trunk: '#8b8a84',
  trunkBase: .45, droop: .1, jag: .25, seg: 8, layers: 9, crown: .12, top: v ? 'fork' : 'broken', under: 4 }, lod);

function larch(variant, lod, fall) {
  // European larch: open, airy, light green tufts on a tall red-brown trunk (gold in October)
  const rand = randomSequence(5301 + variant), b = new Builder(), H = 26 + variant * 6, R = 3;
  const leaf = fall ? ['#d7a53b', '#e2b84f', '#c79231'] : ['#7c9a4c', '#87a556', '#718f45'];
  b.as(PINE).add(cyl(.16, .5, H * .94, lod ? 4 : 6), M(), '#8a5134').as(0);
  if (lod === 2) { b.add(cone(R, H * .7, 5), M(0, H * .28, 0), leaf[0]); return b.build(); }
  if (!lod) B.stubs(b, rand, 5, H * .08, H * .26, 1.2, .38);
  b.as(0);
  const layers = lod ? 3 : 9;
  for (let k = 0; k < layers; k++) {
    const t = k / layers, r = R * (1 - t * .78) * (.75 + rand() * .45);
    b.add(B.whorl(r, H * .065, lod ? 4 : 6, .28, .6, rand), M((rand() - .5) * .6, H * (.28 + t * .66), (rand() - .5) * .6, 1, 1, 1, rand() * 6.28), leaf[k % 3]);
  }
  return b.build();
}

function pine(seed, o, lod) {
  // pines: a bare upper trunk (orange in Scots pine) and a flat, clumpy, umbrella crown
  const rand = randomSequence(seed), b = new Builder(), H = o.H;
  b.as(PINE).add(cyl(.14, .36, H * .85, lod ? 4 : 6), M(), o.trunk);
  if (!lod) b.add(cyl(.11, .15, H * .35, 5), M(0, H * .5, 0), o.upper);   // the bright upper trunk
  b.as(0);
  if (lod === 2) { b.add(blob(0), M(0, H * .78, 0, o.R, H * .16, o.R), o.colors[0]); return b.build(); }
  if (!lod) B.stubs(b, rand, 6, H * .2, H * .55, 1, .22);
  b.as(0);
  const n = lod ? 3 : o.clumps;
  for (let k = 0; k < n; k++) {
    const a = k * 2.3 + rand(), d = k ? o.R * (.35 + rand() * .45) : 0, y = H * (.66 + rand() * .2);
    if (!lod && k) b.as(PINE).add(cyl(.04, .08, d + .4, 3), M(0, y - .9, 0, 1, 1, 1, -a, 0, 1.1), o.trunk).as(0);   // the limb out to the clump
    b.add(blob(0), M(Math.cos(a) * d, y, Math.sin(a) * d, o.R * (.38 + rand() * .2), H * (.06 + rand() * .04), o.R * (.38 + rand() * .2)), o.colors[k % o.colors.length], .16, rand);
  }
  return b.build();
}
const scots = (v, lod) => pine(5401 + v, { H: 20 + v * 4, R: 4.2, trunk: '#6d5240', upper: '#c47a45', colors: ['#45603d', '#4e6a44', '#3e5838'], clumps: 7 }, lod);
const blackpine = (v, lod) => pine(5501 + v, { H: 18 + v * 3, R: 4.8, trunk: '#4b4038', upper: '#5c4c40', colors: ['#24382a', '#2b4230', '#203427'], clumps: 8 }, lod);

function arolle(variant, lod) {
  // Swiss stone pine: dense, dark, often several leaders (candelabra), branches to the ground, wind-shaped
  const rand = randomSequence(5601 + variant), b = new Builder(), H = 12 + variant * 3, R = 2.6;
  b.as(PINE).add(cyl(.18, .5, H * .8, lod ? 4 : 6), M(), '#5d4b3e').as(0);
  if (lod === 2) { b.add(cone(R, H * .95, 6), M(0, H * .05, 0), '#2a4232'); return b.build(); }
  const leaders = variant ? 3 : 1;
  for (let l = 0; l < leaders; l++) {
    const off = l ? (l === 1 ? -1 : 1) * R * .35 : 0, h = H * (l ? .82 : 1);
    for (let k = 0; k < (lod ? 4 : 8); k++) {
      const t = k / (lod ? 4 : 8), r = R * (1 - t * .75) * (l ? .7 : 1) * (.8 + rand() * .35);
      b.add(blob(0), M(off + (rand() - .5) * .4, h * (.1 + t * .82), (rand() - .5) * .4, r, h * .09, r), ['#2a4232', '#31493a', '#253c2d'][k % 3], .18, rand);
    }
  }
  return b.build();
}

// ---- broadleaves: a trunk, a few limbs, a crown of clumps ----
function broadleaf(seed, o, lod, fall) {
  const rand = randomSequence(seed), b = new Builder(), H = o.H, R = o.R;
  const leaf = fall && o.fall ? o.fall : o.colors;
  b.as(o.bark ?? BARK).add(cyl(o.trunkTop ?? .2, o.trunkBase ?? .42, H * (o.trunkH ?? .5), lod ? 4 : 7), M(), o.trunk);
  if (lod === 2) { b.as(LEAF).add(blob(0), M(0, H * .66, 0, R, H * .34, R), leaf[0]); return b.build(); }
  const limbs = lod ? 2 : (o.limbs ?? 4);
  for (let k = 0; k < limbs; k++) {
    const a = k * 2.4 + rand(), l = R * (.6 + rand() * .3);
    b.as(o.bark ?? BARK).add(cyl(.05, .13, l, 4), M(0, H * (o.trunkH ?? .5) * .9, 0, 1, 1, 1, -a, 0, .75 + rand() * .35), o.trunk);
  }
  b.as(LEAF);
  const n = lod ? 3 : (o.clumps ?? 8);
  for (let k = 0; k < n; k++) {
    const a = k * 2.2 + rand(), d = k ? R * (.3 + rand() * .45) : 0, y = H * (.55 + (k ? rand() * .3 : .22));
    b.add(blob(lod ? 0 : 1), M(Math.cos(a) * d, y, Math.sin(a) * d, R * (.42 + rand() * .2), H * (.15 + rand() * .07), R * (.42 + rand() * .2)), leaf[k % leaf.length], .14, rand);
  }
  return b.build();
}
const beech = (v, lod, fall) => broadleaf(5701 + v, { H: 24 + v * 4, R: 6, trunk: '#9a978e', bark: DEAD, trunkTop: .25, trunkBase: .5, trunkH: .48,
  colors: ['#4f7a3a', '#5a8642', '#466f34'], fall: ['#c77b2c', '#d48f35', '#b8691f'], clumps: 9 }, lod, fall);
const ash = (v, lod, fall) => broadleaf(5801 + v, { H: 20 + v * 4, R: 4.8, trunk: '#7d786c', trunkTop: .18, trunkBase: .38, trunkH: .55,
  colors: ['#6a8f48', '#76994f', '#5d8241'], fall: ['#b6b14d', '#c3bb5c', '#a7a142'], clumps: 7, limbs: 5 }, lod, fall);
const walnut = (v, lod, fall) => broadleaf(5901 + v, { H: 15 + v * 2, R: 7, trunk: '#6b6259', trunkTop: .3, trunkBase: .55, trunkH: .38,
  colors: ['#5f8746', '#6a924d', '#55793f'], fall: ['#a8a04a', '#b5ab55', '#99913f'], clumps: 9, limbs: 5 }, lod, fall);
const fieldmaple = (v, lod, fall) => broadleaf(6001 + v, { H: 12 + v * 2, R: 4, trunk: '#6a5d4f', trunkTop: .15, trunkBase: .3, trunkH: .45,
  colors: ['#587f3e', '#638a45', '#4f7438'], fall: ['#d6a63b', '#e0b748', '#c99430'], clumps: 7 }, lod, fall);
const oak = (v, lod, fall) => broadleaf(6101 + v, { H: 11 + v * 2, R: 4.6, trunk: '#5e544a', trunkTop: .2, trunkBase: .42, trunkH: .4,
  colors: ['#5b7342', '#667c49', '#516a3b'], fall: ['#9a7a3c', '#a98846', '#8a6c33'], clumps: 8, limbs: 5 }, lod, fall);

// ---- shrubs ----
function hazel() {
  const rand = randomSequence(6201), b = new Builder();
  for (let k = 0; k < 7; k++) {
    const a = k * .9 + rand() * .3, h = 2.4 + rand() * 1.4;
    b.as(BARK).add(cyl(.025, .045, h, 3), M(Math.cos(a) * .25, 0, Math.sin(a) * .25, 1, 1, 1, -a, 0, .25), '#7a6450');
    b.as(LEAF).add(blob(0), M(Math.cos(a) * (.3 + h * .25), h * .85, Math.sin(a) * (.3 + h * .25), .8, .6, .8), ['#5f8a43', '#6b954a', '#56803d'][k % 3], .12, rand);
  }
  return b.build();
}
function alpenrose() {
  // alpine rose (Rhododendron ferrugineum): a low dark evergreen mound, pink-red flowers in July
  const rand = randomSequence(6211), b = new Builder().as(LEAF);
  for (let k = 0; k < 6; k++) b.add(blob(0), M((rand() - .5) * 1.4, .3 + rand() * .12, (rand() - .5) * 1.2, .55, .3, .5), ['#3d5a35', '#46633b', '#36522f'][k % 3], .12, rand);
  b.as(0);
  for (let k = 0; k < 16; k++) b.add(blob(0), M((rand() - .5) * 1.5, .52 + rand() * .15, (rand() - .5) * 1.3, .07, .05, .07), k % 3 ? '#d64b6e' : '#e2668a');
  return b.build();
}
function broom() {
  // broom: green whippy stems, yellow in early summer (the dry Gap and Champsaur slopes)
  const rand = randomSequence(6221), b = new Builder();
  for (let k = 0; k < 9; k++) {
    const a = k * 2.4 + rand(), h = .9 + rand() * .6;
    b.add(cone(.04, h, 3), M(Math.cos(a) * .2, 0, Math.sin(a) * .2, 1, 1, 1, -a, 0, .35 + rand() * .3), '#4f6e36', .1, rand);
    b.add(blob(0), M(Math.cos(a) * (.2 + h * .35), h * .85, Math.sin(a) * (.2 + h * .35), .14, .2, .14), '#e2c23a', .1, rand);
  }
  return b.build();
}
function lavender() {
  const rand = randomSequence(6231), b = new Builder();
  b.add(blob(0), M(0, .22, 0, .45, .25, .45), '#7f8f78', .1, rand);
  for (let k = 0; k < 14; k++) { const a = rand() * 6.28, d = rand() * .35; b.add(cone(.03, .22, 3), M(Math.cos(a) * d, .38, Math.sin(a) * d), k % 2 ? '#8a72b8' : '#7a62a8'); }
  return b.build();
}
function pinmugo(variant) {
  // dwarf mountain pine at the treeline: sprawling, dark, knee to head high
  const rand = randomSequence(6241 + variant), b = new Builder();
  for (let k = 0; k < 6; k++) b.add(blob(0), M((rand() - .4) * 2.6, .55 + rand() * .45, (rand() - .5) * 2, 1.1 + rand() * .5, .55 + rand() * .3, 1 + rand() * .3), ['#263f2e', '#2e4835'][k % 2], .14, rand);
  return b.build();
}

// ---- meadows: hay grass and the summer flowers ----
function haygrass() {
  const rand = randomSequence(6301), b = new Builder();
  B.blades(b, rand, 12, .55, .14, ['#8ea05a', '#9aab62', '#83964f'], .25, .022);
  for (let k = 0; k < 4; k++) { const a = rand() * 6.28, d = rand() * .12; b.add(cyl(.006, .008, .7, 3), M(Math.cos(a) * d, 0, Math.sin(a) * d), '#a3a066'); b.add(blob(0), M(Math.cos(a) * d, .7, Math.sin(a) * d, .022, .07, .022), '#c4b27a'); }
  return b.build();
}
function shortgrass() { const rand = randomSequence(6311), b = new Builder(); B.blades(b, rand, 10, .22, .14, ['#5f7f3e', '#6a8a45', '#577539'], .55, .026); return b.build(); }
function drygrass() { const rand = randomSequence(6321), b = new Builder(); B.blades(b, rand, 10, .4, .12, ['#b8a466', '#c4b172', '#a8955a'], .4, .024); return b.build(); }
const gentian = () => B.spikes(6401, 4, .14, '#4f6b3a', '#2f4fbf', '#3d5fd0', .12);
const arnica = () => B.daisies(6411, 5, .32, '#efb52e', '#c97f1a');
const campanula = () => B.spikes(6421, 6, .38, '#5a7443', '#7f6bc4', '#9483d4', .14);
const marguerite = () => B.daisies(6431, 6, .48, '#f3f1ea', '#e8c03a');
const willowherb = () => B.spikes(6441, 5, .95, '#5d7343', '#c24f8c', '#d0659c', .16);
function martagon() {
  const rand = randomSequence(6451), b = new Builder();
  for (let k = 0; k < 2; k++) {
    const x = (rand() - .5) * .2, h = .8 + rand() * .3;
    b.add(cyl(.01, .014, h, 3), M(x, 0, 0), '#5b7140');
    for (let j = 0; j < 4; j++) b.add(cone(.05, .07, 5), M(x + Math.cos(j * 1.6) * .07, h - j * .08, Math.sin(j * 1.6) * .07, 1, 1, 1, 0, Math.PI), '#c46b8f', .12, rand);
  }
  return b.build();
}
function umbels() {
  // white umbellifers (wild chervil, hogweed) — tall lacy heads along the verges
  const rand = randomSequence(6461), b = new Builder();
  for (let k = 0; k < 4; k++) {
    const a = k * 2.3, d = rand() * .2, h = .9 + rand() * .45, x = Math.cos(a) * d, z = Math.sin(a) * d;
    b.add(cyl(.01, .015, h, 3), M(x, 0, z), '#6b7f4b');
    b.add(cone(.2, .06, 7), M(x, h, z, 1, 1, 1, 0, Math.PI), '#efeee4', .1, rand);
  }
  return b.build();
}

// ---- rock: pale limestone (Dévoluy) and dark crystalline (Oisans) ----
function boulder(variant) {
  const rand = randomSequence(6501 + variant), g = blob(1), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (.8 + rand() * .45), Math.max(-.2, p.getY(i)) * (.55 + rand() * .3), p.getZ(i) * (.8 + rand() * .4));
  const col = ['#bdb6a6', '#c6bfae', '#6f6e6c', '#7c7a75'][variant];
  return new Builder().add(g, M(0, .2, 0, .9, .9, .9), col, .18, rand).build();
}

// ---- the farm edge ----
function haybale(variant) {
  // a round bale lying on its side: straw, or wrapped in dark green plastic
  const b = new Builder(), r = .75, w = 1.2;
  b.add(cyl(r, r, w, 12), M(-w / 2, r, 0, 1, 1, 1, 0, 0, -Math.PI / 2), variant ? '#2f3d33' : '#d4b86a');
  for (const s of [-1, 1]) b.add(new THREE.CircleGeometry(r, 12), M(s * w / 2, r, 0, 1, 1, 1, s * Math.PI / 2), variant ? '#2a3a2f' : '#c9a85c');
  return b.build();
}
function fence() {
  // 6 m of post-and-rail fence (pasture), grey weathered wood
  const b = new Builder();
  for (let k = 0; k < 3; k++) b.add(box(.12, 1.15, .12), M(k * 3 - 3, 0, 0), '#7d7465');
  for (const y of [.5, .95]) b.add(box(6.2, .08, .06), M(0, y, 0), '#8a8172');
  return b.build();
}
function stonewall() {
  // 6 m of dry-stone wall: knee high, uneven top
  const rand = randomSequence(6601), b = new Builder();
  for (let k = 0; k < 10; k++) b.add(box(.68, .55 + rand() * .25, .55), M(-2.75 + k * .61, 0, (rand() - .5) * .06, 1, 1, 1, (rand() - .5) * .1), ['#a39d90', '#958f82', '#aaa396'][k % 3], .06, rand);
  return b.build();
}
function cross() {
  // a wayside cross on a stone plinth
  const b = new Builder();
  b.add(box(.7, .5, .7), M(), '#a7a092');
  b.add(box(.12, 2.4, .12), M(0, .5, 0), '#3f3a35');
  b.add(box(.9, .1, .1), M(0, 2.3, 0), '#3f3a35');
  return b.build();
}
function trough() {
  // a village fountain-trough: a stone basin and the spout post
  const b = new Builder();
  b.add(box(2.2, .75, .9), M(), '#b2ab9d');
  b.add(box(2, .05, .7), M(0, .68, 0), '#5b8a96');
  b.add(box(.3, 1.4, .3), M(-1.2, 0, 0), '#aaa395');
  b.add(cyl(.03, .03, .4, 4), M(-1.05, 1.15, 0, 1, 1, 1, 0, 0, Math.PI / 2), '#6c6a66');
  return b.build();
}

export function makeAlpsPack(opts = {}) {
  return withSmooth(opts.smooth, () => buildAlps(opts));
}

function buildAlps(opts) {
  const fall = !!opts.fall, geos = {};
  const tree = (name, make) => { for (const lod of [0, 1, 2]) geos[`${name}${['', '-lod', '-far'][lod]}`] = make(lod); };
  for (let v = 0; v < 3; v++) tree(`aspruce${v}`, (l) => spruce(v, l));
  for (let v = 0; v < 2; v++) tree(`afir${v}`, (l) => fir(v, l));
  for (let v = 0; v < 2; v++) tree(`alarch${v}`, (l) => larch(v, l, fall));
  for (let v = 0; v < 2; v++) tree(`scots${v}`, (l) => scots(v, l));
  for (let v = 0; v < 2; v++) tree(`blackpine${v}`, (l) => blackpine(v, l));
  for (let v = 0; v < 2; v++) tree(`arolle${v}`, (l) => arolle(v, l));
  for (let v = 0; v < 2; v++) tree(`beech${v}`, (l) => beech(v, l, fall));
  for (let v = 0; v < 2; v++) tree(`ash${v}`, (l) => ash(v, l, fall));
  tree('walnut0', (l) => walnut(0, l, fall));
  tree('fieldmaple0', (l) => fieldmaple(0, l, fall));
  tree('oak0', (l) => oak(0, l, fall));
  Object.assign(geos, {
    hazel: hazel(), alpenrose: alpenrose(), broom: broom(), lavender: lavender(), pinmugo0: pinmugo(0), pinmugo1: pinmugo(1),
    greenalder0: B.alder(0), greenalder1: B.alder(1), ajuniper: B.juniper(), awillow: B.willow(),
    haygrass: haygrass(), shortgrass: shortgrass(), adrygrass: drygrass(),
    gentian: gentian(), aarnica: arnica(), campanula: campanula(), marguerite: marguerite(), willowherb: willowherb(), martagon: martagon(), umbels: umbels(),
    limestone0: boulder(0), limestone1: boulder(1), gneiss0: boulder(2), gneiss1: boulder(3), ascree0: B.talus(0), ascree1: B.talus(1),
    alog0: B.log(0), alog1: B.log(1), astump: B.stump(1), amoss: B.mossMat(0), abranch: B.deadBranch(1), astone: B.stone(1),
    haybale0: haybale(0), haybale1: haybale(1), fence0: fence(), stonewall0: stonewall(), cross0: cross(), trough0: trough(),
  });
  PACK_META.alps.drifts.forEach((n, i) => { if (geos[n]) geos[`${n}D`] = B.drift(geos[n], 6701 + i); });
  return geos;
}
