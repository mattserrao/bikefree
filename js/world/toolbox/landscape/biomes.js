// Toolbox landscape: the endless map's biomes — each one a recipe of the shared blocks (the tree engine's species, the
// building engine's kinds, the ground's colours, the relief round the road, water), so the world blends any two.
// Pure data and functions (no three.js): the course (js/endless/course.js) picks the biome, the world draws it.
//
//   ground      grass / dry / rock / snow / sand colours, the forest floor under the woods; `fields` paints a patchwork of crops (farmland)
//   relief      near: hills beside the road (m); far: the backdrop's height (m) and its width; `walls`: canyon walls
//               rising past `wallAt` m; `sea`: the land drops to the sea on one side past `seaAt` m
//   lakes       how often a lake opens beside the road (0–1) and its size
//   trees       species weights (the tree kit's names) and how much of the land is wooded (cover 0–1, noise-threshold);
//               `edge`: the cleared margin either side of the road (m)
//   under       understory pieces near the road (weights), and how many per 100 m of road
//   homes       building-engine kinds and how often a homestead stands by the road (per mile)
//   snowAbove   snow on the ground this high over the road (m) — or everywhere (0)
//   verge       the mown verge's colour (default: the map profile's — CNY's)
//   sky         cloud cover; fog tint
export const BIOME_DEFS = {
  farmland: {
    ground: { grass: '#667f40', dry: '#ab975a', rock: '#8a8172', floor: '#56502f', snow: '#eef2f4', sand: '#b8a57a' }, fields: true,
    relief: { near: 18, far: 70, farW: 2400 },
    lakes: 0.15, lakeR: 140,
    trees: { cover: 0.32, edge: 9, species: { sugarmaple: 3, redmaple: 2, redoak: 1.2, whiteash: 1, blackcherry: .8, birch: .6, whitepine: 1, hemlock: .6, spruce: .3 } },
    under: { kinds: { dogwood: 2, buckthorn: 2, goldenrod: 3, sumac: 1.5, sapling: 1, rock: .5 }, per100: 6 },
    homes: { kinds: { 'farmhouse-ny': 3, barn: 2, shed: 1.5, house: 2 }, perMile: 5 },
    snowAbove: null, sky: { clouds: .45, fog: '#d9d8cf' },
  },
  forest: {
    ground: { grass: '#56703a', dry: '#7d7046', rock: '#7a756a', floor: '#4a4430', snow: '#eef2f4', sand: '#c2b48a' },
    relief: { near: 35, far: 160, farW: 2200 },
    lakes: 0.7, lakeR: 260,
    trees: { cover: 0.78, edge: 7, species: { whitepine: 2.2, hemlock: 1.6, spruce: 1.4, sugarmaple: 1.5, redmaple: 1.4, birch: 1.6, beech: 1, fir: .8 } },
    under: { kinds: { fern: 3, fern2: 2, sapling: 1.5, saplingPine: 1.5, rock: 1, rock2: .6, log: .6, stump: .5 }, per100: 9 },
    homes: { kinds: { house: 1, shed: 1 }, perMile: 0.8 },
    snowAbove: null, sky: { clouds: .5, fog: '#cdd6d2' },
  },
  alpine: {
    ground: { grass: '#708a4a', dry: '#a59a64', rock: '#8c8a84', floor: '#3f4a32', snow: '#f3f6f8', sand: '#a39b88' },
    relief: { near: 140, far: 1100, farW: 1500, peaks: true },
    lakes: 0.25, lakeR: 160,
    trees: { cover: 0.3, edge: 10, species: { fir: 3, alpspruce: 2.5, larch: 1.2, whitepine: .4 } },
    under: { kinds: { krummholz: 2, juniper: 2, talus: 2, talus2: 1, greyrock: 1.5, goldenrod: .6 }, per100: 8 },
    homes: { kinds: { house: 1, barn: 1 }, perMile: 0.6 },
    snowAbove: 380, sky: { clouds: .4, fog: '#d6dde4' },
  },
  coast: {
    ground: { grass: '#7f8f52', dry: '#b6a66a', rock: '#8e8276', floor: '#5a5438', snow: '#eef2f4', sand: '#d8c89c' },
    relief: { near: 45, far: 260, farW: 1600, sea: 1, seaAt: 90 },
    lakes: 0, lakeR: 0,
    trees: { cover: 0.22, edge: 8, species: { cypress: 3, shorepine: 2, whitepine: .5 } },
    under: { kinds: { sage: 2, sage2: 2, goldenrod: 1.5, greyrock: 1.5, juniper: 1 }, per100: 7 },
    homes: { kinds: { house: 2, shed: .5 }, perMile: 1.2 },
    snowAbove: null, verge: '#8d975c', sky: { clouds: .35, fog: '#d9e2e8' },
  },
  desert: {
    ground: { grass: '#b39a68', dry: '#c8a978', rock: '#b4643f', floor: '#a88a60', snow: '#eef2f4', sand: '#d9b98a' },
    relief: { near: 25, far: 260, farW: 2200, walls: 140, wallAt: 160 },
    lakes: 0, lakeR: 0,
    trees: { cover: 0.06, edge: 10, species: { pinyon: 2, juniperTree: 3 } },
    under: { kinds: { sage: 3, sage2: 2, yucca: 1.5, cholla: 1.2, redrock: 1.5, redrock2: .8 }, per100: 7 },
    homes: { kinds: { shed: 1 }, perMile: 0.2 },
    snowAbove: null, verge: '#b9a47c', sky: { clouds: .15, fog: '#e9d7bd' },
  },
  arctic: {
    ground: { grass: '#8d9177', dry: '#a7a083', rock: '#7d8085', floor: '#6c6a55', snow: '#f8fbfe', sand: '#c9c3b0' },
    relief: { near: 30, far: 260, farW: 2200, peaks: true },
    lakes: 0.45, lakeR: 200, frozen: true,
    trees: { cover: 0.18, edge: 9, species: { blackspruce: 4, tamarack: 1.5 } },
    under: { kinds: { krummholz: 2, snowrock: 2, talus: 1, juniper: .8 }, per100: 5 },
    homes: { kinds: { shed: 1, house: .5 }, perMile: 0.25 },
    snowAbove: 0, verge: '#a4a491', sky: { clouds: .6, fog: '#e4eaf0' },
  },
};

/** Pick a key from weights with a 0–1 number. */
export function pickWeighted(weights, u) {
  let sum = 0; for (const w of Object.values(weights)) sum += w;
  let t = u * sum;
  for (const [k, w] of Object.entries(weights)) { t -= w; if (t <= 0) return k; }
  return Object.keys(weights)[0];
}

/** Hex colour → [r, g, b] 0–1 (linear-ish: the vertex colours of the ground). */
export function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
