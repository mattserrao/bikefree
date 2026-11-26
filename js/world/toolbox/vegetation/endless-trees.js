// Toolbox vegetation: the endless map's tree kit — CNY's and SKAN's upstate kit (upstate-trees.js: the defaults) with
// the other biomes' species added the same way (grown with the northern-rockies pack's conifer builder, three detail
// levels each), so one tree engine draws every biome:
//   alpine   subalpine fir, Engelmann spruce, larch (gold)      arctic   black spruce (thin, ragged), tamarack
//   coast    Monterey cypress (flat, wind-shorn), shore pine     desert   pinyon pine, one-seed juniper
// and the understory: krummholz, juniper mats, sagebrush, yucca, cholla, boulders, talus.
import { Builder, M, blob, cone, cyl, withSmooth } from '../core/model-builder.js';
import { randomSequence } from '../core/random.js';
import { MOUNTAIN_BUILDERS as MB } from '../packs/northern-rockies.js';
import { makeUpstateTrees } from './upstate-trees.js';

const C = MB.conifer;
const LOD3 = (fn) => [0, 1, 2].map((lod) => fn(lod));
const tiers = (variants) => variants.map((t) => t.map((g, k) => (k < 2 && g.isBufferGeometry ? { wood: g, leaves: null } : g)));

const EXTRA = {
  fir: { h: 16, r: 1.5, make: (v) => LOD3((lod) => C(7101 + v, { H: 14 + v * 3, R: 1.4 + v * .15, colors: ['#25412f', '#2c4936', '#33523d'], trunk: '#4d4036', trunkBase: .22, droop: .18, jag: .32, seg: 6, layers: 10, crown: .03, top: 'leader', lichen: true, under: 3 }, lod)) },
  alpspruce: { h: 26, r: 2.7, make: (v) => LOD3((lod) => C(7201 + v, { H: 24 + v * 4, R: 2.6 + v * .25, colors: ['#2c4a3d', '#345445', '#3b5b4a'], trunk: '#5a4434', trunkBase: .34, droop: .25, jag: .38, seg: 7, layers: 10, crown: .05, top: v ? 'broken' : 'leader', stubs: 2, lichen: true }, lod)) },
  larch: { h: 24, r: 2.6, make: (v) => LOD3((lod) => C(7301 + v, { H: 22 + v * 3, R: 2.6, colors: ['#d2a53a', '#ddb54a', '#c3922e'], trunk: '#8a5434', trunkBase: .4, droop: .1, jag: .5, seg: 6, layers: 8, crown: .1, top: 'leader' }, lod)) },
  blackspruce: { h: 9, r: 1, make: (v) => LOD3((lod) => C(7401 + v, { H: 7 + v * 2.5, R: .9 + v * .1, colors: ['#1f3529', '#26402f', '#2c4634'], trunk: '#3e352d', trunkBase: .12, droop: .35, jag: .6, seg: 5, layers: 9, crown: .18, top: 'nod', lichen: true }, lod)) },
  tamarack: { h: 12, r: 1.6, make: (v) => LOD3((lod) => C(7501 + v, { H: 10 + v * 2, R: 1.6, colors: ['#c9a440', '#d6b250', '#b88e34'], trunk: '#6e4a32', trunkBase: .2, droop: .1, jag: .55, seg: 5, layers: 7, crown: .1, top: 'leader' }, lod)) },
  cypress: { h: 14, r: 5.5, make: (v) => LOD3((lod) => cypress(7601 + v, v, lod)) },
  shorepine: { h: 12, r: 2.6, make: (v) => LOD3((lod) => C(7701 + v, { H: 10 + v * 2, R: 2.4, colors: ['#33502f', '#3d5a35', '#2e4a2b'], trunk: '#5b4232', trunkBase: .3, droop: .05, jag: .7, seg: 6, layers: 6, crown: .3, top: 'nod', lopsided: true }, lod)) },
  pinyon: { h: 7, r: 2.4, make: (v) => LOD3((lod) => C(7801 + v, { H: 6 + v * 1.5, R: 2.3, colors: ['#4a5f3c', '#536a43', '#425635'], trunk: '#6a5240', trunkBase: .28, droop: 0, jag: .8, seg: 6, layers: 5, crown: .45, top: 'nod', lopsided: v === 1 }, lod)) },
  juniperTree: { h: 5, r: 2, make: (v) => LOD3((lod) => C(7901 + v, { H: 4.5 + v, R: 1.9, colors: ['#5d735a', '#687e62', '#536850'], trunk: '#7a6450', trunkBase: .3, droop: 0, jag: .9, seg: 5, layers: 5, crown: .5, top: 'fork', lopsided: true }, lod)) },
};

function cypress(seed, v, lod) {
  // Monterey cypress: a short, leaning trunk and flat, wind-shorn tiers of dark green spreading to the lee
  const rand = randomSequence(seed), b = new Builder(), H = 12 + v * 3;
  b.add(cyl(.18, .45, H * .7, lod ? 4 : 6), M(0, 0, 0, 1, 1, 1, 0, 0, .18), '#5a4535');
  const n = lod === 2 ? 2 : lod ? 4 : 7;
  for (let k = 0; k < n; k++) {
    const y = H * (.45 + k * .55 / n), d = 1.2 + rand() * 1.6;
    b.add(blob(lod === 2 ? 0 : 1), M(1.4 + d * .6, y, (rand() - .5) * 2, 3.2 + rand() * 1.6, .9 + rand() * .5, 2.4 + rand(), rand() * .6), ['#24402d', '#2b4a33', '#1f3a29'][k % 3], .15, rand);
  }
  return b.build();
}
function sage(seed) {
  const rand = randomSequence(seed), b = new Builder();
  for (let k = 0; k < 7; k++) b.add(blob(0), M((rand() - .5) * 1.1, .3 + rand() * .2, (rand() - .5) * 1.1, .45 + rand() * .2, .3 + rand() * .15, .45 + rand() * .2), ['#8c9a7c', '#97a487', '#7f8e72'][k % 3], .12, rand);
  return b.build();
}
function yucca(seed) {
  const rand = randomSequence(seed), b = new Builder();
  for (let k = 0; k < 22; k++) { const a = k * 2.4 + rand(), t = .5 + rand() * .7; b.add(cone(.05, .9, 3), M(0, .1, 0, 1, 1, 1, a, 0, t), ['#6e8a4a', '#7c9655'][k % 2], .1, rand); }
  b.add(cyl(.02, .03, 2.2, 3), M(0, 0, 0), '#9a8a5a'); b.add(blob(0), M(0, 2.3, 0, .14, .45, .14), '#efe6c4');
  return b.build();
}
function cholla(seed) {
  const rand = randomSequence(seed), b = new Builder();
  b.add(cyl(.09, .11, 1.1, 5), M(), '#7f9058');
  for (let k = 0; k < 5; k++) { const a = rand() * 6.28; b.add(cyl(.06, .08, .6, 4), M(Math.cos(a) * .08, .6 + rand() * .4, Math.sin(a) * .08, 1, 1, 1, a, 0, .8), '#899a60', .1, rand); }
  return b.build();
}
function boulder(seed, s, color) {
  const rand = randomSequence(seed), b = new Builder();
  b.add(blob(1), M(0, s * .35, 0, s, s * .7, s * (.8 + rand() * .3), rand() * 6), color, .2, rand);
  return b.build();
}

/** The endless map's kit: { species, understory } for the tree engine. */
export function makeEndlessTrees() {
  const kit = makeUpstateTrees();
  withSmooth(true, () => {
    for (const [name, o] of Object.entries(EXTRA)) kit.species[name] = { h: o.h, r: o.r, variants: tiers([0, 1].map((v) => o.make(v))), turn: [0, 0] };
    Object.assign(kit.understory, {
      krummholz: MB.krummholz(0), juniper: MB.juniper(), talus: MB.talus(0), talus2: MB.talus(1),
      sage: sage(8101), sage2: sage(8102), yucca: yucca(8201), cholla: cholla(8301),
      redrock: boulder(8401, 1.4, '#a5583a'), redrock2: boulder(8402, 2.2, '#b5684a'),
      greyrock: boulder(8501, 1.2, '#8a8a84'), snowrock: boulder(8601, 1.1, '#9da3a8'),
    });
  });
  return kit;
}
