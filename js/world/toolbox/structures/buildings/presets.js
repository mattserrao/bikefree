// Building kit: surface codes (shared with the facade shader) and regional style presets.
//
// A style says how the buildings of one stretch of road are made: which kinds of building it has, which
// colour schemes go together, what the walls and roofs are made of, the roof shapes and pitch, the windows,
// and how often each extra (balconies, dormers, woodpiles, sundials…) turns up. A scene picks a preset by
// name for each stretch and can override any key (colours belong to the place, so a scene usually brings
// its own `schemes`):
//
//   "buildingKit": { "styles": [ { "fromM": 0, "toM": 4800, "preset": "provence", "schemes": [ … ] }, … ] }
//
// Weights ({ name: weight }) are picked from with the building's seed, so a building always comes out the same.

/** Surface codes: what a face is made of. The facade shader draws the pattern (no textures, no geometry). */
export const S = {
  PLAIN: 0, RENDER: 1, ROUGH: 2, RUBBLE: 3, ASHLAR: 4, BRICK: 5, LAP: 6, BOARDS: 7, LOGS: 8, WSHINGLE: 9,
  TIMBER: 10, METAL: 11, CONCRETE: 12, GLASS: 13, BALUSTER: 14, GENOISE: 15, SUNDIAL: 16, WOOD: 17,
  DOOR: 18, GARAGE: 19, BARNDOOR: 20, AWNING: 21, LOGEND: 22, LEAF: 23, STEEL: 24, SOLAR: 25, GRAVEL: 26,
  SOIL: 27, SOFFIT: 28, POT: 29, RAILING: 30, BENCH: 31,
  // roofs
  R_CANAL: 40, R_TILE: 41, R_SCALE: 42, R_SLATE: 43, R_LAUZE: 44, R_SEAM: 45, R_CORR: 46, R_SHINGLE: 47, R_FLAT: 48,
};
/** Wall materials by name (style keys) → code. */
export const WALLS = { render: S.RENDER, rough: S.ROUGH, rubble: S.RUBBLE, ashlar: S.ASHLAR, brick: S.BRICK, lap: S.LAP,
  boards: S.BOARDS, logs: S.LOGS, shingle: S.WSHINGLE, timber: S.TIMBER, metal: S.METAL, concrete: S.CONCRETE, glass: S.GLASS };
export const ROOFS = { canal: S.R_CANAL, tile: S.R_TILE, scale: S.R_SCALE, slate: S.R_SLATE, lauze: S.R_LAUZE, seam: S.R_SEAM,
  corrugated: S.R_CORR, shingle: S.R_SHINGLE, flat: S.R_FLAT };
/** Window sets (the shader draws the window, frame, muntins, shutters, sill and surround). */
export const W = { NONE: 0, FRENCH: 1, FARM: 2, CHALET: 3, RESORT: 4, CHURCH: 5, BARN: 6, SASH: 7, SHOP: 8 };
export const WINDOW_SETS = { french: W.FRENCH, farm: W.FARM, chalet: W.CHALET, resort: W.RESORT, church: W.CHURCH, barn: W.BARN, sash: W.SASH };
/** Half width and bay width (m) of each window set: a bay is a window and the wall round it. */
export const WINDOW_BAY = { [W.FRENCH]: [.5, 2.9], [W.FARM]: [.33, 2.6], [W.CHALET]: [.6, 2.8], [W.RESORT]: [1.1, 3.4], [W.CHURCH]: [.45, 4.2],
  [W.BARN]: [.3, 3.2], [W.SASH]: [.45, 2.6] };

/** Typical colours of each roof material (a scheme can override the roof colour). */
export const ROOF_COLORS = {
  canal: ['#b0664a', '#b97a5c', '#a4604a', '#bd8a68'],
  tile: ['#8e5240', '#7a4a3a', '#86604e', '#6e4e42'],
  scale: ['#87503e', '#965e48', '#7a4a3c', '#6b5a50'],
  slate: ['#4e5258', '#5a5e63', '#45484d'],
  lauze: ['#7e7a72', '#8d877c', '#6f6c66', '#938a7a'],
  seam: ['#5f6164', '#6d5b4f', '#4c5156', '#7b7f80', '#4f5e52'],
  corrugated: ['#8a8d8f', '#7a6250', '#6e7476'],
  shingle: ['#7d7266', '#8a7c6a', '#6c645a'],
  flat: ['#8f8b84', '#7f7c76'],
};

/** Every key a style can have, with generic defaults (a plain rendered village, pitched tile roofs). */
export const DEFAULT_STYLE = {
  // which kinds of building this stretch has (only those the footprint allows are drawn from)
  archetypes: { cottage: 1, village: 1, farmhouse: .6, chalet: 0, mazot: 0, block: .1, shed: 1 },
  // colour schemes that belong together: walls, shutters (trim), window frames, surrounds and doors (accent)
  schemes: [
    { wall: '#e3d6bd', trim: '#5f7f86', frame: '#efebe2', accent: '#f1ece2' },
    { wall: '#d9c4a0', trim: '#7d5a3c', frame: '#efebe2', accent: '#ece2cf' },
    { wall: '#ece4d4', trim: '#6c7d5c', frame: '#f3efe6', accent: '#d7cbb3' },
  ],
  walls: { render: .6, rough: .25, rubble: .15 },     // main body
  plinth: .4,                                          // share with a stone plinth (rendered walls)
  upper: {},                                           // material of a timber upper storey: { boards: .3 } (share)
  gable: {},                                           // material of the gable triangles: { boards: .3 }
  barn: { boards: .7, rubble: .3 },                    // barn ends of farmhouses, sheds
  roofs: { tile: .6, slate: .2, seam: .2 },
  forms: { gable: .7, halfHip: .15, hip: .15, stepped: 0 },
  pitch: 32, pitchJitter: 4, eaveM: .55, rakeM: .4,
  windows: 'french', shutters: .85, surrounds: .4, quoins: .25, flowerBoxes: .25, genoise: 0,
  balconies: .15, galleries: 0, dormers: .2, chimneys: .7, solar: .06, leanTo: .25, garage: .15, porch: .3,
  stair: .1, woodpile: .25, sundial: .02, shops: .5, ivy: .12,
  age: [.3, 1], upkeep: [.35, .95],
  stone: "#b3ab9c",                                    // stone colour (plinths, rubble walls, sills, steps)
  // ground dressing near the road (shares of buildings; each can be 0)
  dressing: { steps: .9, shrubs: .6, bins: .4, bench: .25, pots: .4, garden: .2, fence: .25, laundry: .08, dish: .15, hay: .3, bikes: .1, trough: .5 },
};

/** Regional presets (data only). Scenes pick one per stretch and override what the real place needs. */
export const STYLE_PRESETS = {
  // dry south-facing Provence edge (Gap): ochre render, canal tiles at a low pitch, génoise eaves, painted shutters
  provence: {
    archetypes: { cottage: 1, village: 1, farmhouse: .5, chalet: 0, mazot: 0, block: .15, shed: 1 },
    schemes: [
      { wall: '#e6c99a', trim: '#6f8f9a', frame: '#f2ece0', accent: '#f3ead8' },
      { wall: '#edd9b4', trim: '#8a6d9a', frame: '#f2ece0', accent: '#e7d6b6' },
      { wall: '#e3b58a', trim: '#5b7f6a', frame: '#f2ece0', accent: '#f0e3cb' },
      { wall: '#f0e2c6', trim: '#4f7d93', frame: '#f4efe5', accent: '#dcc29a' },
      { wall: '#e2a983', trim: '#9aa79a', frame: '#f4efe5', accent: '#f1e4cc' },
    ],
    walls: { render: .75, rough: .2, rubble: .05 }, plinth: .2, roofs: { canal: 1 },
    forms: { gable: .75, hip: .25 }, pitch: 22, pitchJitter: 3, eaveM: .3, rakeM: .1, genoise: .8, surrounds: .55, quoins: .2,
    dormers: 0, balconies: .1, flowerBoxes: .2,
  },
  // Champsaur and Dévoluy (Hautes-Alpes): grey limestone rubble, long farmhouses with plank barn ends, sheet-metal
  // and slate roofs, half-hipped ends, sundials
  'hautes-alpes': {
    archetypes: { cottage: .8, village: .7, farmhouse: 1.2, chalet: .15, mazot: .3, block: .08, shed: 1 },
    schemes: [
      { wall: '#cfc6b3', trim: '#6b4a35', frame: '#ece6da', accent: '#e6dfd0' },
      { wall: '#d8cdb6', trim: '#55665a', frame: '#ece6da', accent: '#c9bda6' },
      { wall: '#c2b8a6', trim: '#7a5a42', frame: '#e7e0d2', accent: '#ddd3c0' },
      { wall: '#dccbaa', trim: '#5f6f7a', frame: '#ece6da', accent: '#efe7d6' },
    ],
    walls: { rubble: .45, rough: .35, render: .2 }, plinth: .5, gable: { boards: .25 }, barn: { boards: .8, rubble: .2 },
    roofs: { seam: .35, slate: .25, tile: .2, lauze: .2 }, forms: { gable: .45, halfHip: .4, hip: .15 },
    pitch: 34, eaveM: .6, rakeM: .45, surrounds: .35, quoins: .35, sundial: .06, woodpile: .45, leanTo: .4, stair: .2,
  },
  // Trièves / Matheysine / Beaumont (Isère): rendered houses, steep fish-scale tile roofs, crow-stepped gables
  dauphine: {
    archetypes: { cottage: 1, village: 1, farmhouse: .9, chalet: .1, mazot: 0, block: .08, shed: 1 },
    schemes: [
      { wall: '#e2d4b8', trim: '#6a7f6a', frame: '#efeae0', accent: '#f0e8d8' },
      { wall: '#d6c09c', trim: '#7a4e36', frame: '#efeae0', accent: '#e8dcc4' },
      { wall: '#e8dcc8', trim: '#5b6d82', frame: '#f2ede4', accent: '#d2c2a4' },
      { wall: '#cdb592', trim: '#8a5d40', frame: '#efeae0', accent: '#ecdfc6' },
    ],
    walls: { render: .45, rough: .35, rubble: .2 }, plinth: .4, gable: { boards: .1 }, barn: { boards: .6, rubble: .4 },
    roofs: { scale: .4, tile: .35, slate: .15, seam: .1 }, forms: { gable: .4, halfHip: .3, stepped: .3 },
    pitch: 44, pitchJitter: 5, eaveM: .45, rakeM: .2, surrounds: .45, quoins: .35, dormers: .3, woodpile: .35,
  },
  // the Oisans (Bourg-d'Oisans, Huez): render and stone, slate and lauze, wooden balconies on the upper floors
  oisans: {
    archetypes: { cottage: 1, village: 1, farmhouse: .7, chalet: .5, mazot: .25, block: .15, shed: 1 },
    schemes: [
      { wall: '#ddd0b8', trim: '#6b4a32', frame: '#ece6da', accent: '#e9e0cd' },
      { wall: '#c9bba2', trim: '#58675a', frame: '#ece6da', accent: '#ddd1bc' },
      { wall: '#e7dcc6', trim: '#7d5638', frame: '#efe9dd', accent: '#cdbfa6' },
      { wall: '#d3c2a2', trim: '#5c6b78', frame: '#ece6da', accent: '#ebe1cc' },
    ],
    walls: { render: .4, rough: .3, rubble: .3 }, plinth: .5, upper: { boards: .25 }, gable: { boards: .35 }, barn: { boards: .8, logs: .2 },
    roofs: { slate: .35, lauze: .25, seam: .3, tile: .1 }, forms: { gable: .65, halfHip: .2, hip: .15 },
    pitch: 33, eaveM: .8, rakeM: .6, balconies: .4, galleries: .25, woodpile: .45, sundial: .04, dormers: .15,
  },
  // a modern ski resort (L'Alpe d'Huez, Superdévoluy): apartment blocks with balcony bands, newer chalets with
  // stone ground floors and timber above, low roofs, everything kept up
  'ski-resort': {
    archetypes: { cottage: .2, village: .2, farmhouse: 0, chalet: 1.2, mazot: .1, block: 1.4, shed: .6 },
    schemes: [
      { wall: '#ece6da', trim: '#7a4f2e', frame: '#6a4428', accent: '#d8cdb8' },
      { wall: '#e2d6c0', trim: '#5a3d26', frame: '#5a3d26', accent: '#c9bba2' },
      { wall: '#f1ece2', trim: '#8a5a36', frame: '#7a4f2e', accent: '#e0d4bd' },
      { wall: '#d7c9b0', trim: '#6a4428', frame: '#4f3826', accent: '#efe7d8' },
    ],
    walls: { render: .7, rubble: .15, concrete: .15 }, plinth: .6, upper: { boards: .55 }, gable: { boards: .7 }, barn: { boards: 1 },
    roofs: { seam: .55, slate: .2, lauze: .1, flat: .15 }, forms: { gable: .7, hip: .2, halfHip: .1 },
    pitch: 26, pitchJitter: 3, eaveM: 1.1, rakeM: .9, windows: 'chalet', shutters: .25, surrounds: 0, quoins: 0, flowerBoxes: .35,
    balconies: .85, galleries: .5, dormers: .1, chimneys: .4, solar: .12, leanTo: .05, garage: .2, woodpile: .15, sundial: 0, shops: .7,
    age: [0, .35], upkeep: [.75, 1], ivy: 0,
    dressing: { steps: .9, shrubs: .35, bins: .5, bench: .35, pots: .55, garden: 0, fence: .1, laundry: 0, dish: .2, hay: 0, bikes: .2, trough: .2 },
  },
};

/** The style for one stretch: defaults ← preset ← the scene's own keys. */
export function resolveStyle(entry = {}) {
  const preset = STYLE_PRESETS[entry.preset] || {};
  const out = { ...DEFAULT_STYLE, ...preset, ...entry };
  out.dressing = { ...DEFAULT_STYLE.dressing, ...(preset.dressing || {}), ...(entry.dressing || {}) };
  out.archetypes = { ...DEFAULT_STYLE.archetypes, ...(preset.archetypes || {}), ...(entry.archetypes || {}) };
  out.fromM = entry.fromM ?? 0; out.toM = entry.toM ?? Infinity;
  return out;
}

/** Pick a key from { key: weight } with a uniform number in [0, 1). */
export function pick(weights, r) {
  const entries = Object.entries(weights || {}).filter(([, w]) => w > 0);
  if (!entries.length) return null;
  let total = 0; for (const [, w] of entries) total += w;
  let x = r * total;
  for (const [k, w] of entries) { if ((x -= w) < 0) return k; }
  return entries[entries.length - 1][0];
}
