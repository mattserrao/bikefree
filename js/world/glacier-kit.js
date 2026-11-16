// Procedural Glacier National Park kit: the Northern Rockies forest in three levels of detail — western red
// cedar and hemlock in the west-side valleys, Engelmann spruce, subalpine fir and western larch higher up,
// lodgepole pine and aspen on the dry east side — plus treeline krummholz and the subalpine ground cover:
// beargrass, Indian paintbrush, glacier lilies, huckleberry and Sitka alder in the avalanche chutes.
// Low-poly, vertex-coloured, built once per scene — no extra downloads. Unit height scale is metres.
import { randomSequence } from './coast.js';
import { Builder, M, cyl, cone, blob } from './adirondack-kit.js';

// lod 0 near, 1 mid, 2 far (one or two primitives)
function cedar(variant, lod) {
  // western red cedar: a broad, drooping cone of layered sprays on a flared, fluted red-brown trunk
  const rand = randomSequence(1201 + variant), b = new Builder(), H = 34 + variant * 6, R = 4.6 + variant * .6;
  b.add(cyl(.35, .95, H * .5, lod ? 5 : 8), M(), '#6b3f2c');
  if (lod === 2) { b.add(cone(R, H * .84, 6), M(0, H * .15, 0), '#2f4a33'); return b.build(); }
  const layers = lod ? 3 : 8;
  for (let k = 0; k < layers; k++) {
    const t = k / layers, r = R * (1 - t * .85) * (.9 + rand() * .2), h = H * (1.35 / layers);
    // sprays droop: each tier is a squat cone hung slightly lower at the rim
    b.add(cone(r, h, lod ? 6 : 10), M(0, H * (.16 + t * .74), 0, 1, 1, 1, rand() * 3), ['#304d35', '#3a5a3c', '#2b4530', '#41633f'][k % 4], .14, rand);
  }
  b.add(cone(.6, 2.6, 5), M(.3, H * .97, 0, 1, 1, 1, 0, 0, -.4), '#3a5a3c');
  return b.build();
}

function hemlock(variant, lod) {
  // western hemlock: soft, feathery, with the nodding leader
  const rand = randomSequence(1301 + variant), b = new Builder(), H = 30 + variant * 5, R = 3.8;
  b.add(cyl(.22, .55, H * .55, lod ? 4 : 6), M(), '#5b4636');
  if (lod === 2) { b.add(blob(0), M(0, H * .58, 0, R, H * .44, R), '#2b4737'); return b.build(); }
  const layers = lod ? 3 : 7;
  for (let k = 0; k < layers; k++) {
    const t = k / layers, r = R * (1 - t * .78);
    b.add(blob(0), M(0, H * (.24 + t * .68), 0, r, H * .11, r, rand() * 3), ['#2b4737', '#345442', '#284332'][k % 3], .12, rand);
  }
  b.add(cone(.7, 2.6, 5), M(.4, H * .94, 0, 1, 1, 1, 0, 0, -.45), '#345442');
  return b.build();
}

function spire(seed, H, R, colors, trunk, lod) {
  // spruce and subalpine fir: a dense, narrow spire, branches to the ground
  const rand = randomSequence(seed), b = new Builder();
  b.add(cyl(.1, .32, H * .35, lod ? 4 : 6), M(), trunk);
  if (lod === 2) { b.add(cone(R, H * .95, 5), M(0, H * .05, 0), colors[0]); return b.build(); }
  const layers = lod ? 3 : 8;
  for (let k = 0; k < layers; k++) {
    const t = k / layers, r = R * (1 - t * .85) * (.9 + rand() * .2), h = H * (1.45 / layers);
    b.add(cone(r, h, lod ? 5 : 8), M(0, H * (.06 + t * .84), 0, 1, 1, 1, rand() * 3), colors[k % colors.length], .13, rand);
  }
  return b.build();
}
const spruce = (variant, lod) => spire(1401 + variant, 26 + variant * 5, 2.5 + variant * .3, ['#28443a', '#2f4d40', '#355546'], '#4e3c30', lod);
const subalpineFir = (variant, lod) => spire(1501 + variant, 15 + variant * 4, 1.35 + variant * .2, ['#223d33', '#294538', '#2f4c3d'], '#4a3d33', lod);

function lodgepole(variant, lod) {
  // lodgepole pine: a tall straight pole with a short, tufted crown at the top
  const rand = randomSequence(1601 + variant), b = new Builder(), H = 22 + variant * 4;
  b.add(cyl(.12, .3, H * .92, lod ? 4 : 6), M(), '#6a5340');
  if (lod === 2) { b.add(blob(0), M(0, H * .8, 0, 1.9, H * .22, 1.9), '#33502f'); return b.build(); }
  for (let k = 0; k < (lod ? 2 : 5); k++) {
    const a = k * 2.2 + rand(), d = k ? .7 + rand() * .5 : 0;
    b.add(blob(0), M(Math.cos(a) * d, H * (.66 + k * .07), Math.sin(a) * d, 1.6 + rand() * .5, 1.5 + rand() * .6, 1.6 + rand() * .5), ['#33502f', '#3a5734', '#2e4a2c'][k % 3], .15, rand);
  }
  return b.build();
}

function larch(variant, lod, fall) {
  // western larch: tall and open, short soft tufts along a long bare-ish trunk (gold in October)
  const rand = randomSequence(1701 + variant), b = new Builder(), H = 32 + variant * 5, R = 2.6;
  const leaf = fall ? ['#d2a53a', '#ddb54a', '#c3922e'] : ['#4f6f3e', '#5a7944', '#476637'];
  b.add(cyl(.18, .5, H * .92, lod ? 4 : 6), M(), '#7a4a32');
  if (lod === 2) { b.add(cone(R, H * .62, 5), M(0, H * .36, 0), leaf[0]); return b.build(); }
  const layers = lod ? 3 : 7;
  for (let k = 0; k < layers; k++) {
    const t = k / layers, r = R * (1 - t * .8) * (.85 + rand() * .3);
    b.add(cone(r, H * .09, lod ? 5 : 7), M((rand() - .5) * .4, H * (.36 + t * .58), (rand() - .5) * .4, 1, 1, 1, rand() * 3), leaf[k % 3], .16, rand);
  }
  return b.build();
}

function aspen(variant, lod, fall) {
  // quaking aspen: a slim white trunk with dark eyes, a small round crown (gold in fall)
  const rand = randomSequence(1801 + variant), b = new Builder(), H = 14 + variant * 3;
  const leaf = fall ? ['#e4c047', '#ecd062', '#d9a936'] : ['#62844a', '#6b8c4f', '#587a43'];
  const segs = lod ? 1 : 4;
  for (let k = 0; k < segs; k++) b.add(cyl(.1, .14, H * .7 / segs, lod ? 4 : 6), M(0, k * H * .7 / segs), k % 2 ? '#e8e6da' : '#d9d6c6');
  if (lod === 2) { b.add(blob(0), M(0, H * .74, 0, 2.2, 3.4, 2.2), leaf[0]); return b.build(); }
  for (let k = 0; k < (lod ? 2 : 4); k++) {
    const a = k * 2.1;
    b.add(blob(0), M(Math.cos(a) * .9, H * (.64 + k * .08), Math.sin(a) * .9, 1.7 + rand() * .5, 2, 1.7), leaf[k % 3], .15, rand);
  }
  return b.build();
}

function krummholz(variant) {
  // wind-pruned subalpine fir mats at the treeline, flagged downwind
  const rand = randomSequence(1901 + variant), b = new Builder();
  for (let k = 0; k < 5; k++) b.add(blob(0), M((rand() - .3) * 2.4, .45 + rand() * .3, (rand() - .5) * 1.6, 1.2 + rand() * .6, .55 + rand() * .3, 1 + rand() * .4), ['#223d33', '#2a4639'][k % 2], .14, rand);
  b.add(cone(.5, 2.2 + variant, 5), M(-.4, 0, 0), '#294538', .1, rand);
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

export function makeGlacierKit(opts = {}) {
  const fall = !!opts.fall, geos = {};
  const tree = (name, make) => { for (const lod of [0, 1, 2]) geos[`${name}${['', '-lod', '-far'][lod]}`] = make(lod); };
  tree('cedar0', (l) => cedar(0, l)); tree('cedar1', (l) => cedar(1, l));
  tree('whemlock0', (l) => hemlock(0, l)); tree('whemlock1', (l) => hemlock(1, l));
  tree('espruce0', (l) => spruce(0, l)); tree('espruce1', (l) => spruce(1, l));
  tree('subfir0', (l) => subalpineFir(0, l)); tree('subfir1', (l) => subalpineFir(1, l));
  tree('lodgepole0', (l) => lodgepole(0, l)); tree('lodgepole1', (l) => lodgepole(1, l));
  tree('larch0', (l) => larch(0, l, fall));
  tree('aspen0', (l) => aspen(0, l, fall)); tree('aspen1', (l) => aspen(1, l, fall));
  Object.assign(geos, {
    krummholz0: krummholz(0), krummholz1: krummholz(1),
    beargrass: beargrass(), paintbrush: paintbrush(), glacierlily: glacierLily(), huckleberry: huckleberry(),
    alder0: alder(0), alder1: alder(1), talus0: talus(0), talus1: talus(1),
  });
  return geos;
}

export const GLACIER_CATEGORY = { beargrass: 'groundcover', paintbrush: 'groundcover', glacierlily: 'groundcover', huckleberry: 'groundcover' };
export const GLACIER_VARIANTS = { cedar: 2, whemlock: 2, espruce: 2, subfir: 2, lodgepole: 2, larch: 1, aspen: 2 };
