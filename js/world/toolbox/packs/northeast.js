// Regional pack "northeast" (was the Adirondack kit, Route 28): northern forest trees (three levels of detail), forest-edge plants,
// boulders, and the lakeside built world (houses, camps, docks, boats, poles, mailboxes).
// Low-poly, vertex-coloured, built once per scene at load — no extra downloads.
import * as THREE from '../../../../vendor/three.js';
import { randomSequence } from '../core/random.js';
import { PACK_META } from './meta.js';
import { Builder, M, cyl, cone, blob, box, linear, withSmooth } from '../core/model-builder.js';

/** Gable roof prism: width across the ridge (x), depth along it (z), rise. */
function gable(w, d, rise, overhang = .4) {
  const W = w / 2 + overhang, D = d / 2 + overhang;
  const s = new THREE.Shape([new THREE.Vector2(-W, 0), new THREE.Vector2(W, 0), new THREE.Vector2(0, rise)]);
  return new THREE.ExtrudeGeometry(s, { depth: D * 2, bevelEnabled: false }).translate(0, 0, -D);
}

// ---------- Trees: unit height scale is metres ----------
// lod 0 near (≈500–900 tris), 1 mid (≈60–120), 2 far (≈12–24)
function whitePine(variant, lod) {
  // tall bare trunk; a few broad, flat, wind-swept sprays reaching mostly one way; a ragged flat top
  const rand = randomSequence(301 + variant), b = new Builder(), H = 27 + variant * 5;
  const lean = rand() * Math.PI * 2;
  b.add(cyl(.2, .45, H * .96, lod ? 4 : 7), M(), '#5a4433');
  if (lod === 2) {
    b.add(blob(0), M(Math.cos(lean) * 1.5, H * .82, Math.sin(lean) * 1.5, 5.2, 2.6, 4.2, -lean), '#2f4b37');
    b.add(blob(0), M(-Math.cos(lean) * 1.2, H * .66, -Math.sin(lean) * 1.2, 4, 1.8, 3.2, -lean), '#2a4532');
    return b.build();
  }
  const sprays = lod ? 3 : 5;
  for (let t = 0; t < sprays; t++) {
    const y = H * (.5 + .45 * t / sprays) + rand() * 1.2;
    const ang = lean + (rand() - .5) * 2.6 + (t % 2 ? Math.PI * .55 : 0);
    const reach = (6 - t * .5) * (.75 + rand() * .4);
    const x = Math.cos(ang) * reach * .8, z = Math.sin(ang) * reach * .8;
    // flat spray: wide, thin, tilted slightly down at the tip
    b.add(blob(lod ? 0 : 1), M(x, y, z, reach * .75, .55 + rand() * .3, reach * .4, -ang, 0, -.1), ['#2f4b37', '#3a5a40', '#28432f', '#34533b'][t % 4], .14, rand);
    if (!lod) b.add(cyl(.05, .14, reach * 1.1, 3), M(0, 0, 0, 1, 1, 1, 0, 0, -Math.PI / 2 + .12).premultiply(M(0, y - .3, 0, 1, 1, 1, -ang)), '#5a4433');
  }
  b.add(blob(0), M(Math.cos(lean) * .8, H * .985, Math.sin(lean) * .8, 3.2, .9, 2.4, -lean), '#33503a', .1, rand);
  return b.build();
}

function spruce(variant, lod) {
  const rand = randomSequence(401 + variant), b = new Builder(), H = 18 + variant * 4, R = 2.3 + variant * .3;
  b.add(cyl(.12, .3, H * .4, lod ? 4 : 6), M(), '#4d3b2e');
  if (lod === 2) { b.add(cone(R, H * .92, 5), M(0, H * .1, 0), '#24402f'); return b.build(); }
  const layers = lod ? 3 : 7;
  for (let k = 0; k < layers; k++) {
    const t = k / layers, r = R * (1 - t * .8) * (.92 + rand() * .16), h = H * (1.5 / layers);
    b.add(cone(r, h, lod ? 6 : 9), M(0, H * (.12 + t * .78), 0, 1, 1, 1, rand() * 3), ['#23402f', '#2b4a37', '#335240'][k % 3], .14, rand);
  }
  return b.build();
}

function hemlock(lod) {
  const rand = randomSequence(501), b = new Builder(), H = 20, R = 3.6;
  b.add(cyl(.16, .4, H * .5, lod ? 4 : 6), M(), '#5b4636');
  if (lod === 2) { b.add(blob(0), M(0, H * .55, 0, R, H * .45, R), '#2d4b39'); return b.build(); }
  const layers = lod ? 3 : 6;
  for (let k = 0; k < layers; k++) {
    const t = k / layers, r = R * (1 - t * .75);
    b.add(blob(lod ? 0 : 1), M(0, H * (.22 + t * .7), 0, r, H * .13, r, rand() * 3), ['#2d4b39', '#36553f', '#2a4635'][k % 3], .12, rand);
  }
  b.add(cone(.8, 2.4, 5), M(.35, H * .93, 0, 1, 1, 1, 0, 0, -.35), '#36553f');   // drooping leader
  return b.build();
}

const MAPLE_GREEN = ['#4b6e3d', '#58793f', '#41623a', '#62824a'];
const MAPLE_FALL = ['#c4502a', '#d97a2b', '#b23a24', '#e0a33a'];
function maple(variant, lod, fall) {
  const rand = randomSequence(601 + variant), b = new Builder(), H = 20 + variant * 3, palette = fall ? MAPLE_FALL : MAPLE_GREEN;
  b.add(cyl(.22, .38, H * .55, lod ? 4 : 7), M(), '#5d5146');
  if (lod === 2) { b.add(blob(0), M(0, H * .66, 0, 5.4, 6, 5.2), palette[0]); return b.build(); }
  const lobes = lod ? 3 : 5;
  for (let k = 0; k < lobes; k++) {
    const a = k * 2.4 + rand(), d = k ? 2.4 + rand() * 1.2 : 0;
    b.add(blob(lod ? 0 : 1), M(Math.cos(a) * d, H * (.58 + rand() * .2) + (k ? 0 : 2), Math.sin(a) * d, 3.8 + rand() * 1.2, 3.4 + rand(), 3.8 + rand()),
      palette[k % palette.length], .16, rand);
    if (!lod && k) b.add(cyl(.06, .14, d + 2, 4), M(0, H * .42, 0, 1, 1, 1, -a, 0, Math.PI / 2 - .7).premultiply(M()), '#5d5146');
  }
  return b.build();
}

function birch(variant, lod, fall) {
  const rand = randomSequence(701 + variant), b = new Builder(), H = 15 + variant * 3;
  const segs = lod ? 1 : 6;
  for (let k = 0; k < segs; k++) {   // white bark with dark bands
    const h = H * .75 / segs;
    b.add(cyl(.13, .18, h, lod ? 4 : 6), M(0, k * h, 0, 1, 1, 1, 0, 0, (rand() - .5) * .04), k % 2 ? '#e6e2d3' : '#d6d1c0');
    if (!lod) b.add(cyl(.185, .185, .12, 6), M(0, k * h + h * .5, 0), '#3b3934');
  }
  const leaf = fall ? ['#e2c049', '#d9b23c', '#ecd067'] : ['#7d9b52', '#8aa75b', '#6f8f4a'];
  if (lod === 2) { b.add(blob(0), M(0, H * .72, 0, 2.8, 4, 2.8), leaf[0]); return b.build(); }
  for (let k = 0; k < (lod ? 2 : 4); k++) {
    const a = k * 2.1;
    b.add(blob(lod ? 0 : 1), M(Math.cos(a) * 1.1, H * (.62 + k * .08), Math.sin(a) * 1.1, 2.1 + rand() * .6, 2.2, 2), leaf[k % 3], .15, rand);
  }
  return b.build();
}

function sapling(variant) {
  const rand = randomSequence(801 + variant), b = new Builder();
  b.add(cyl(.03, .05, 1.6, 4), M(), '#5b4a3a');
  if (variant) b.add(cone(.9, 2.4, 6), M(0, .3, 0), '#2f4e3a', .12, rand);
  else for (let k = 0; k < 3; k++) b.add(blob(0), M((rand() - .5) * .8, 1.2 + k * .45, (rand() - .5) * .8, .7, .55, .7), ['#6d8c4a', '#5c7d43'][k % 2], .15, rand);
  return b.build();
}

function goldenrod() {
  const rand = randomSequence(901), b = new Builder();
  for (let k = 0; k < 6; k++) {
    const a = k * 2.4, r = .18 + rand() * .2, x = Math.cos(a) * r, z = Math.sin(a) * r, h = .65 + rand() * .3;
    b.add(cyl(.012, .018, h, 3), M(x, 0, z), '#6f8650');
    b.add(cone(.07, .22, 4), M(x, h - .02, z, 1, 1, 1, 0, Math.PI), '#e2b931', .2, rand);
  }
  return b.build();
}

function blueberry() {
  const rand = randomSequence(911), b = new Builder();
  for (let k = 0; k < 4; k++) b.add(blob(0), M((rand() - .5) * .7, .16, (rand() - .5) * .7, .32, .17, .3), ['#4f6b3c', '#5f7744', '#6b5d3e'][k % 3], .2, rand);
  return b.build();
}

function boulder(variant) {
  const rand = randomSequence(951 + variant), g = blob(variant ? 1 : 0), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (.85 + rand() * .3), Math.max(-.25, p.getY(i)) * (.6 + rand() * .2), p.getZ(i) * (.85 + rand() * .3));
  return new Builder().add(g, M(0, .15, 0, variant ? 1 : .6, variant ? 1 : .6, variant ? 1 : .6), variant ? '#8b8a80' : '#9a988c', .18, rand).build();
}

// ---------- Built world ----------
const SIDING = ['#6b4a32', '#3f5a3f', '#7a5b3f', '#e6e1d2', '#8c3b2e', '#55606a', '#c9b48a'];
const ROOF = ['#3a3d3f', '#2f4733', '#5a2f28', '#4a4a48'];
function house(variant) {
  const rand = randomSequence(1001 + variant), b = new Builder();
  const w = 7 + rand() * 2.5, d = 9 + rand() * 3, h = variant % 2 ? 5.6 : 3.1, wall = SIDING[variant % SIDING.length];
  b.add(box(w, h, d), M(), wall, .05, rand);
  b.add(gable(w, d, w * .42), M(0, h, 0), ROOF[variant % ROOF.length]);
  b.add(box(.9, 2.6, .9), M(w * .25, h + .4, d * .2), '#7d6a5a');              // chimney
  b.add(box(w + .2, .3, 2.4), M(0, .4, d / 2 + 1.2), '#8a7a66');                 // porch deck
  b.add(gable(w + .2, 2.4, .7, .1), M(0, 2.9, d / 2 + 1.2), ROOF[(variant + 1) % ROOF.length]);
  for (const x of [-w / 2 + .1, w / 2 - .1]) b.add(box(.18, 2.5, .18), M(x, .4, d / 2 + 2.3), '#efe9da');
  // windows and trim (front and sides)
  for (const x of [-w * .28, w * .28]) b.add(box(1.1, 1.3, .08), M(x, 1.1, d / 2 + .03), '#2a3138');
  b.add(box(1, 2.1, .08), M(0, .4, d / 2 + .03), '#efe9da');
  for (const z of [-d * .25, d * .25]) for (const s of [-1, 1]) b.add(box(.08, 1.2, 1.1), M(s * (w / 2 + .03), 1.2, z), '#2a3138');
  if (h > 4) for (const x of [-w * .28, w * .28]) b.add(box(1, 1.1, .08), M(x, 3.6, d / 2 + .03), '#2a3138');
  return b.build();
}

function camp(variant) {
  const rand = randomSequence(1101 + variant), b = new Builder(), w = 6 + rand() * 1.5, d = 7.5 + rand() * 2;
  const wall = ['#5b3e2a', '#3c4f37', '#6d4c33'][variant % 3], trim = variant % 2 ? '#e8e1cf' : '#9b2f25';
  for (let k = 0; k < 7; k++) b.add(cyl(.17, .17, d, 6), M(0, .17 + k * .4, -d / 2, 1, 1, 1, 0, Math.PI / 2).premultiply(M(-w / 2 + .17, 0, 0)), wall, .08, rand)
    .add(cyl(.17, .17, d, 6), M(0, .17 + k * .4, -d / 2, 1, 1, 1, 0, Math.PI / 2).premultiply(M(w / 2 - .17, 0, 0)), wall, .08, rand);
  b.add(box(w - .2, 2.8, d - .2), M(), wall);
  b.add(gable(w, d, w * .5, .7), M(0, 2.8, 0), ['#2f4733', '#3a3d3f', '#5a2f28'][variant % 3]);
  b.add(box(w + .6, .25, 2.2), M(0, .35, d / 2 + 1.1), '#7a6650');
  for (const x of [-w * .25, w * .25]) b.add(box(1, 1.1, .08), M(x, 1.1, d / 2 + .03), '#272d31').add(box(1.2, .12, .1), M(x, 2.25, d / 2 + .05), trim);
  b.add(box(.9, 2, .08), M(0, .35, d / 2 + .03), trim);
  b.add(box(.8, 3.2, .8), M(-w * .3, 2.4, -d * .2), '#6e6458');
  return b.build();
}

function store() {
  const b = new Builder(), w = 12, d = 14;
  b.add(box(w, 4.2, d), M(), '#e2dccb');
  b.add(gable(w, d, 3.6), M(0, 4.2, 0), '#3a3d3f');
  b.add(box(w + .2, 6.8, .3), M(0, 0, d / 2), '#8c3b2e');            // false front
  b.add(box(w - 2, .9, .1), M(0, 4.9, d / 2 + .2), '#efe9da');         // sign board
  b.add(box(w + 1, .3, 3), M(0, .35, d / 2 + 1.6), '#8a7a66');
  b.add(box(w + 1, .2, 3.2), M(0, 3.3, d / 2 + 1.6), '#3a3d3f');
  for (const x of [-w / 2, -w / 6, w / 6, w / 2]) b.add(box(.18, 3, .18), M(x, .35, d / 2 + 3), '#efe9da');
  for (const x of [-w * .3, w * .3]) b.add(box(3, 2, .08), M(x, .8, d / 2 + .2), '#2a3138');
  return b.build();
}

function church() {
  const b = new Builder(), w = 9, d = 15;
  b.add(box(w, 6, d), M(), '#eeeae0');
  b.add(gable(w, d, 4.5), M(0, 6, 0), '#3a3d3f');
  b.add(box(3.2, 11, 3.2), M(0, 0, d / 2 + 1.2), '#eeeae0');
  b.add(cone(2.4, 7, 4), M(0, 11, d / 2 + 1.2, 1, 1, 1, Math.PI / 4), '#3a3d3f');
  for (const z of [-d * .3, 0, d * .3]) for (const s of [-1, 1]) b.add(box(.08, 2.6, 1.1), M(s * (w / 2 + .03), 2, z), '#33424f');
  return b.build();
}

function motel() {
  const b = new Builder(), w = 26, d = 8;
  b.add(box(w, 3.2, d), M(), '#d9cfb8');
  b.add(gable(d, w, 1.6, .9), M(0, 3.2, 0, 1, 1, 1, Math.PI / 2), '#5a2f28');
  for (let k = 0; k < 6; k++) {
    const x = -w / 2 + 2.2 + k * 4.3;
    b.add(box(1, 2.1, .08), M(x, 0, d / 2 + .03), ['#8c3b2e', '#3f5a3f'][k % 2]).add(box(1.4, 1.1, .08), M(x + 1.6, 1, d / 2 + .03), '#2a3138');
  }
  return b.build();
}

function boathouse() {
  const b = new Builder(), w = 5.5, d = 9;
  for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, 0, d / 2]) b.add(cyl(.12, .12, 2.5, 5), M(x, -2, z), '#4a3c30');
  b.add(box(w, 2.8, d), M(0, .3, 0), '#5b3e2a');
  b.add(box(w - 1.2, 2, .1), M(0, .3, d / 2 + .02), '#1e2326');     // boat door
  b.add(gable(w, d, 2.2, .5), M(0, 3.1, 0), '#2f4733');
  return b.build();
}

function dock() {
  const b = new Builder(), L = 12;
  b.add(box(2, .2, L), M(0, .35, L / 2), '#8a7356', .1);
  for (const z of [1, L / 2, L - .5]) for (const x of [-.9, .9]) b.add(cyl(.1, .1, 2.6, 5), M(x, -2, z), '#4a3c30');
  b.add(box(2.2, .25, 2), M(0, .45, L - 1), '#7a6650');
  return b.build();
}

function canoe(color) {
  const b = new Builder(), g = new THREE.SphereGeometry(1, 10, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  b.add(g, M(0, .38, 0, .42, .38, 2.6), color);
  b.add(box(.7, .04, .25), M(0, .3, .6), '#8a7356').add(box(.7, .04, .25), M(0, .3, -.8), '#8a7356');
  return b.build();
}

function motorboat() {
  const b = new Builder(), g = new THREE.SphereGeometry(1, 10, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  b.add(g, M(0, .7, -.2, 1.05, .7, 3), '#efeee8');
  b.add(box(1.9, .5, 1.2), M(0, .7, .4), '#2b5a86');
  b.add(box(1.6, .5, .08), M(0, 1.2, .9, 1, 1, 1, 0, -.4), '#6f8796');
  return b.build();
}

function pole() {
  const b = new Builder();
  b.add(cyl(.12, .16, 10, 6), M(), '#5c4a39');
  b.add(box(2.4, .14, .14), M(0, 9.1, 0), '#5c4a39');
  for (const x of [-1, 0, 1]) b.add(cyl(.05, .05, .2, 5), M(x, 9.24, 0), '#bfc5c0');
  b.add(cyl(.3, .3, .9, 7), M(.32, 7.2, 0), '#8b9091');   // transformer on some poles is cheap enough on all
  return b.build();
}

function mailbox() {
  const b = new Builder();
  b.add(box(.1, 1.05, .1), M(), '#6b5440');
  b.add(box(.24, .26, .5), M(0, 1.05, 0), '#3c4146');
  b.add(box(.04, .16, .04), M(.13, 1.25, -.15), '#b33a2b');
  return b.build();
}

function guardrail() {
  // one 4 m bay of weathered box-beam / W-beam on wooden posts; x across, z along
  const b = new Builder();
  b.add(box(.18, 1.05, .18), M(0, -.1, 0), '#6b5a45');
  b.add(box(.06, .32, 4), M(-.12, .55, 2), '#8e928b');
  return b.build();
}

/** Asset table. Names stay plain so the scene JSON can list them. */
export function makeNortheastPack(opts = {}) {
  const fall = !!opts.fall;
  return withSmooth(opts.smooth, () => buildKit(fall));
}

function buildKit(fall) {
  const geos = {};
  const tree = (name, make) => { for (const lod of [0, 1, 2]) geos[`${name}${['', '-lod', '-far'][lod]}`] = make(lod); };
  tree('whitepine0', (l) => whitePine(0, l)); tree('whitepine1', (l) => whitePine(1, l));
  tree('spruce0', (l) => spruce(0, l)); tree('spruce1', (l) => spruce(1, l));
  tree('hemlock0', (l) => hemlock(l));
  tree('maple0', (l) => maple(0, l, fall)); tree('maple1', (l) => maple(1, l, fall));
  tree('birch0', (l) => birch(0, l, fall)); tree('birch1', (l) => birch(1, l, fall));
  Object.assign(geos, {
    sapling0: sapling(0), sapling1: sapling(1), goldenrod: goldenrod(), blueberry: blueberry(),
    boulder0: boulder(0), boulder1: boulder(1),
    house0: house(0), house1: house(1), house2: house(2), house3: house(3), house4: house(4), house5: house(5),
    camp0: camp(0), camp1: camp(1), camp2: camp(2), store0: store(), church0: church(), motel0: motel(),
    boathouse0: boathouse(), dock0: dock(), canoe0: canoe('#b8422e'), canoe1: canoe('#2f6a52'), canoe2: canoe('#d9a33a'),
    motorboat0: motorboat(), pole0: pole(), mailbox0: mailbox(), guardrail0: guardrail(),
  });
  return geos;
}

/** Category for the shared materials (wind on soft plants, double-sided thin parts). */
export const NORTHEAST_CATEGORY = Object.fromEntries(PACK_META.northeast.groundcover.map((n) => [n, 'groundcover']));
export const SPECIES_VARIANTS = PACK_META.northeast.variants;
export const FOREST_SPECIES = Object.keys(SPECIES_VARIANTS);
