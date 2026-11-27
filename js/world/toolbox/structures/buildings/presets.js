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
  R_CANAL: 40, R_TILE: 41, R_SCALE: 42, R_SLATE: 43, R_LAUZE: 44, R_SEAM: 45, R_CORR: 46, R_SHINGLE: 47, R_FLAT: 48, R_ASPHALT: 49,
};
/** Wall materials by name (style keys) → code. */
export const WALLS = { render: S.RENDER, rough: S.ROUGH, rubble: S.RUBBLE, ashlar: S.ASHLAR, brick: S.BRICK, lap: S.LAP,
  boards: S.BOARDS, logs: S.LOGS, shingle: S.WSHINGLE, timber: S.TIMBER, metal: S.METAL, concrete: S.CONCRETE, glass: S.GLASS };
export const ROOFS = { canal: S.R_CANAL, tile: S.R_TILE, scale: S.R_SCALE, slate: S.R_SLATE, lauze: S.R_LAUZE, seam: S.R_SEAM,
  corrugated: S.R_CORR, shingle: S.R_SHINGLE, flat: S.R_FLAT, asphalt: S.R_ASPHALT };
/** Window sets (the shader draws the window, frame, muntins, shutters, sill and surround). */
export const W = { NONE: 0, FRENCH: 1, FARM: 2, CHALET: 3, RESORT: 4, CHURCH: 5, BARN: 6, SASH: 7, SHOP: 8, PICTURE: 9, TALL: 10, LOW: 11 };
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
  // standing seam: galvanised, weathered, and the upstate farm colours (barn red, forest green, a faded blue)
  seam: ['#5f6164', '#6d5b4f', '#4c5156', '#7b7f80', '#4f5e52', '#7a2f28', '#8e3b2f', '#3f5e47', '#4a5f6e', '#9a9c9a'],
  corrugated: ['#8a8d8f', '#7a6250', '#6e7476'],
  shingle: ['#7d7266', '#8a7c6a', '#6c645a'],
  flat: ['#8f8b84', '#7f7c76'],
  // asphalt shingle: the greys and browns of real lots (weathered light grey, charcoal, driftwood, a muted green, a red)
  asphalt: ['#4b4d50', '#5c5752', '#3f4244', '#6a5f55', '#4d5547', '#5a4640', '#77736c', '#33363a', '#7f7464', '#4f5a4e', '#5a3e38', '#66686b'],
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
  windows: 'french', shutters: .85, surrounds: .4, lintels: 0, quoins: .25, flowerBoxes: .25, genoise: 0,
  balconies: .15, galleries: 0, dormers: .2, chimneys: .7, solar: .06, leanTo: .25, garage: .15, porch: .3, frontPorch: 0,
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
  // Pittsburgh row houses (South Side, Lawrenceville-style rows): brick, two or three storeys, attached, stone lintels and
  // sills, a stoop, a side-gabled roof along the street (slate or asphalt) or a flat roof behind a cornice, front dormers
  'pittsburgh-rowhouse': {
    archetypes: { village: 1, cottage: .35, shed: .4, farmhouse: 0, chalet: 0, mazot: 0, block: 0 },
    schemes: [
      { wall: '#9a5a44', trim: '#2f3a33', frame: '#efebe2', accent: '#d8cfbd' },
      { wall: '#8a4c3a', trim: '#3a2c26', frame: '#e4dac4', accent: '#cfc4ae' },
      { wall: '#a8664c', trim: '#24313d', frame: '#efebe2', accent: '#e2d8c4' },
      { wall: '#7f4a3b', trim: '#4a3a2e', frame: '#efebe2', accent: '#c9bfaa' },
      { wall: '#b07a5c', trim: '#2b3540', frame: '#efebe2', accent: '#ddd3bf' },
      { wall: '#c9bda4', trim: '#5a2e2a', frame: '#efebe2', accent: '#efe7d8' },
    ],
    walls: { brick: .82, lap: .12, render: .06 }, plinth: .55, gable: {}, barn: { boards: 1 },
    roofs: { asphalt: .5, slate: .35, flat: .15 }, forms: { gable: .62, flat: .38 }, pitch: 30, pitchJitter: 6, eaveM: .3, rakeM: 0,
    windows: 'sash', shutters: .06, surrounds: 0, lintels: .85, quoins: 0, flowerBoxes: .05, genoise: 0, attached: true,
    balconies: 0, galleries: 0, dormers: .35, chimneys: .55, solar: .03, leanTo: 0, garage: 0, porch: .35, frontPorch: .12, stair: 0, woodpile: 0,
    sundial: 0, shops: .35, ivy: .08, age: [.45, 1], upkeep: [.25, .9], stone: '#bdb3a0',
    dressing: { steps: 1, shrubs: .25, bins: .55, bench: .05, pots: .35, garden: 0, fence: .1, laundry: 0, dish: .25, hay: 0, bikes: .1, trough: 0 },
  },
  // Pittsburgh frame houses (Mount Washington, the West End, the South Side Slopes): two or three storeys of painted
  // siding or brick, steep front gables, a deep front porch on posts, asphalt or slate roofs, dormers
  'pittsburgh-frame': {
    archetypes: { cottage: 1, chalet: 0, village: .25, shed: .6, farmhouse: 0, mazot: 0, block: 0 },
    schemes: [
      { wall: '#e8e4da', trim: '#2f3d4a', frame: '#f4f2ec', accent: '#f4f2ec' },
      { wall: '#d9cfa6', trim: '#4a5a44', frame: '#f4f2ec', accent: '#f4f2ec' },
      { wall: '#a9b7b9', trim: '#2f3540', frame: '#f4f2ec', accent: '#f1efe8' },
      { wall: '#c7d0bb', trim: '#5a3a2e', frame: '#f4f2ec', accent: '#f4f2ec' },
      { wall: '#8d9aa6', trim: '#ece8de', frame: '#f4f2ec', accent: '#ece8de' },
      { wall: '#e2cfb0', trim: '#6a2e2a', frame: '#f4f2ec', accent: '#f4f2ec' },
      { wall: '#b5644e', trim: '#2e2e2e', frame: '#efebe2', accent: '#d8cfbd' },
    ],
    walls: { lap: .62, brick: .22, shingle: .1, render: .06 }, plinth: .7, gable: { lap: .3, shingle: .15 }, barn: { boards: 1 },
    roofs: { asphalt: .7, slate: .22, seam: .08 }, forms: { gable: .72, hip: .2, halfHip: .08 }, pitch: 38, pitchJitter: 6, eaveM: .35, rakeM: .25,
    windows: 'sash', shutters: .22, surrounds: 0, lintels: .3, quoins: 0, flowerBoxes: .04, genoise: 0, frontEnd: .55,
    balconies: 0, galleries: 0, dormers: .3, chimneys: .55, solar: .04, leanTo: .06, garage: .05, porch: .2, frontPorch: .7, stair: 0, woodpile: 0,
    sundial: 0, shops: 0, ivy: .06, age: [.3, 1], upkeep: [.3, .95], stone: '#a9a294',
    dressing: { steps: 1, shrubs: .5, bins: .55, bench: .15, pots: .4, garden: .08, fence: .3, laundry: .03, dish: .25, hay: 0, bikes: .12, trough: 0 },
  },
  // CNY's suburbs (user, 22 Nov: "houses are also too generic and have far too many windows"): Camillus, Fairmount and
  // Warners — ranches and two-storey colonials of vinyl siding in the usual pale colours, some brick fronts, shutters,
  // attached garages, low gable and hip roofs of asphalt shingle; a window every ~4.4 m, not every 2.6 m
  'cny-suburban': {
    houseEngine: true,   // (structures/houses: the regional house types, built in full near the road)
    cleanShapes: true,   // (recipe.js cleanShape: tidy rectangles squared to the road, set back, an occasional wing)
    archetypes: { cottage: 1, village: .12, farmhouse: .2, chalet: 0, mazot: 0, block: 0, shed: .5 },
    schemes: [
      { wall: '#eceae3', trim: '#2f3a44', frame: '#f6f5f0', accent: '#f6f5f0' },   // white, black shutters
      { wall: '#d9cfb8', trim: '#5b4636', frame: '#f6f5f0', accent: '#f1ece0' },   // almond
      { wall: '#c6c9c7', trim: '#2b3a4c', frame: '#f6f5f0', accent: '#f6f5f0' },   // light grey
      { wall: '#aab9c5', trim: '#f2f0ea', frame: '#f6f5f0', accent: '#f2f0ea' },   // pale blue
      { wall: '#bcc4a9', trim: '#3f4a36', frame: '#f6f5f0', accent: '#f6f5f0' },   // sage
      { wall: '#e3d7a9', trim: '#3d4f3a', frame: '#f6f5f0', accent: '#f6f5f0' },   // butter yellow
      { wall: '#8494a3', trim: '#f2f0ea', frame: '#f6f5f0', accent: '#f2f0ea' },   // slate blue
      { wall: '#c8b394', trim: '#4a3b30', frame: '#f6f5f0', accent: '#efe8da' },   // tan
      { wall: '#7d8a7c', trim: '#f2f0ea', frame: '#f6f5f0', accent: '#f2f0ea' },   // dark sage
    ],
    walls: { lap: .78, brick: .1, shingle: .07, render: .05 }, plinth: .3, gable: { lap: .2, shingle: .1 }, barn: { boards: 1 },
    roofs: { asphalt: .95, seam: .05 }, forms: { gable: .6, hip: .34, halfHip: .06 }, pitch: 27, pitchJitter: 7, eaveM: .4, rakeM: .3,
    windows: 'sash', bayM: 4.4, ranch: .45, maxFloors: 2,
    shutters: .5, surrounds: 0, lintels: 0, quoins: 0, flowerBoxes: .02, genoise: 0, frontEnd: .15,
    balconies: 0, galleries: 0, dormers: .1, chimneys: .35, solar: .06, leanTo: .05, garage: .55, porch: .25, frontPorch: .35, stair: 0, woodpile: .03,
    sundial: 0, shops: 0, ivy: .02, age: [.1, .7], upkeep: [.55, 1], stone: '#b9b4a8',
    dressing: { steps: 1, shrubs: .7, bins: .5, bench: .05, pots: .2, garden: .12, fence: .15, laundry: 0, dish: .2, hay: 0, bikes: .1, trough: 0 },
  },
  // Out West's Kanab (26 Nov 2026): the desert town — low ranch houses in stucco and adobe colours, low hipped roofs in
  // tile, standing seam or pale asphalt, wide eaves for the sun, few shutters, no dormers; the odd board-and-batten
  'kanab-western': {
    houseEngine: true, cleanShapes: true,
    archetypes: { cottage: 1, village: .05, farmhouse: .12, chalet: 0, mazot: 0, block: 0, shed: .35 },
    schemes: [
      { wall: '#d8b48c', trim: '#6b4a34', frame: '#efe6d6', accent: '#efe6d6', roof: '#8e5240' },   // adobe tan, tile
      { wall: '#e6d2b0', trim: '#5a4636', frame: '#f4efe4', accent: '#f4efe4' },                     // sand stucco
      { wall: '#c98e66', trim: '#4e3a2c', frame: '#efe6d6', accent: '#efe6d6', roof: '#7a4a3a' },    // terracotta
      { wall: '#efe7d8', trim: '#7a5236', frame: '#f6f2ea', accent: '#f6f2ea' },                     // white stucco
      { wall: '#b9a58a', trim: '#4a3b30', frame: '#efe6d6', accent: '#efe6d6' },                     // dun
      { wall: '#a8b0a0', trim: '#4a3b30', frame: '#f2eee4', accent: '#f2eee4' },                     // sage green
      { wall: '#9c6e52', trim: '#e9dcc4', frame: '#efe6d6', accent: '#efe6d6' },                     // board-and-batten brown
    ],
    // (user, 26 Nov: "mixed, true to Kanab" — tan and white stucco, red brick, some sandstone or siding; metal and
    //  asphalt roofs, the odd tile; mostly ranches, a few raised ranches and capes)
    walls: { render: .45, brick: .25, lap: .18, rubble: .12 }, plinth: .2, gable: { lap: .3 }, barn: { boards: .5, metal: .5 },
    houseWalls: { render: .45, brick: .25, lap: .18, sandstone: .12 },
    houseTypes: { house: { ranch: .72, raised: .1, cape: .12, split: .06 }, rowhouse: { ranch: .8, cape: .2 } },
    roofs: { seam: .42, asphalt: .48, tile: .1 }, forms: { gable: .45, hip: .52, halfHip: .03 }, pitch: 18, pitchJitter: 5, eaveM: .7, rakeM: .45,
    windows: 'sash', bayM: 4.6, ranch: .8, maxFloors: 2,
    shutters: .08, surrounds: .2, lintels: 0, quoins: 0, flowerBoxes: 0, genoise: 0, frontEnd: .1,
    balconies: 0, galleries: 0, dormers: 0, chimneys: .2, solar: .15, leanTo: .08, garage: .6, porch: .4, frontPorch: .3, stair: 0, woodpile: .05,
    sundial: 0, shops: 0, ivy: 0, age: [.1, .6], upkeep: [.5, .95], stone: '#c4a582',
    dressing: { steps: 1, shrubs: .3, bins: .5, bench: .05, pots: .3, garden: .03, fence: .25, laundry: 0, dish: .25, hay: .02, bikes: .1, trough: .02 },
  },
  // Kanab's pioneer houses (user, 26 Nov): the 1870s-1910s brick and sandstone houses of the old town blocks — a
  // storey and a half, steep gables, a hall-and-parlor or I-house front, a small porch, tall sash windows
  'kanab-pioneer': {
    houseEngine: true, cleanShapes: true,
    archetypes: { cottage: 1, village: .2, farmhouse: 0, chalet: 0, mazot: 0, block: 0, shed: .3 },
    schemes: [
      { wall: '#e9e1d0', trim: '#4a3b30', frame: '#f4efe4', accent: '#f4efe4' },   // whitewashed
      { wall: '#d9c2a0', trim: '#5a4636', frame: '#f4efe4', accent: '#f4efe4' },   // plaster tan
      { wall: '#c9a27a', trim: '#4e3a2c', frame: '#efe6d6', accent: '#efe6d6' },   // adobe
    ],
    walls: { brick: .55, rubble: .3, render: .15 }, plinth: .4, gable: {}, barn: { boards: 1 },
    houseWalls: { brick: .55, sandstone: .33, render: .12 },
    houseTypes: { 'village-house': { ihouse: .4, gablefront: .3, upright: .3 }, house: { ihouse: .4, gablefront: .3, upright: .3 } },
    roofs: { seam: .45, shingle: .3, asphalt: .25 }, forms: { gable: .85, hip: .15 }, pitch: 36, pitchJitter: 5, eaveM: .35, rakeM: .2,
    windows: 'sash', bayM: 3.4, ranch: .2, maxFloors: 2,
    shutters: .05, surrounds: .3, lintels: .6, quoins: .05, flowerBoxes: 0, genoise: 0, frontEnd: .2,
    balconies: 0, galleries: 0, dormers: .1, chimneys: .7, solar: .03, leanTo: .3, garage: .15, porch: .5, frontPorch: .55, stair: 0, woodpile: .1,
    sundial: 0, shops: 0, ivy: 0, age: [.5, .95], upkeep: [.5, .95], stone: '#c7a37c',
    dressing: { steps: 1, shrubs: .3, bins: .4, bench: .1, pots: .3, garden: .08, fence: .45, laundry: 0, dish: .1, hay: 0, bikes: .1, trough: 0 },
  },
  // Out West's adobe (user, 26 Nov 2026: "adobe structures in the buildings of the map — residential and rural", half
  // of the homes): Pueblo Revival — one storey of earth-plastered walls in tan, rose, ochre and sand, flat roofs behind
  // soft parapets stepped up over the front, vigas and canales (assemble.js puebloRoof), small deep-set windows, a
  // portal on posts, a low adobe wall round the yard; turquoise or blue doors and trim
  'kanab-pueblo': {
    houseEngine: false, cleanShapes: true, pueblo: true,
    archetypes: { cottage: 1, village: .15, farmhouse: 0, chalet: 0, mazot: 0, block: 0, shed: .3 },
    schemes: [
      { wall: '#c9a27a', trim: '#3f7f8a', frame: '#e9dcc4', accent: '#3f7f8a' },   // adobe tan, turquoise
      { wall: '#c98e7a', trim: '#2f5d7a', frame: '#efe2cc', accent: '#2f5d7a' },   // rose, Taos blue
      { wall: '#cf9e5a', trim: '#5a3e2c', frame: '#efe2cc', accent: '#3f7f8a' },   // ochre
      { wall: '#d9bf94', trim: '#3f7f8a', frame: '#f1e7d4', accent: '#7a3a2c' },   // sand, red door
      { wall: '#a87a58', trim: '#e8dcc4', frame: '#e8dcc4', accent: '#2f5d7a' },   // earth brown
      { wall: '#d6b08a', trim: '#4e6b3a', frame: '#efe2cc', accent: '#4e6b3a' },   // pale adobe, sage
    ],
    walls: { rough: 1 }, plinth: 0, gable: {}, barn: { rough: .7, boards: .3 },
    roofs: { flat: 1 }, forms: { flat: 1 }, pitch: 8, pitchJitter: 2, eaveM: 0, rakeM: 0,
    windows: 'farm', bayM: 3.6, ranch: 1, maxFloors: 1,
    shutters: 0, surrounds: .5, lintels: .7, quoins: 0, flowerBoxes: 0, genoise: 0, frontEnd: 0,
    balconies: 0, galleries: 0, dormers: 0, chimneys: 0, solar: .05, leanTo: .2, garage: .25, porch: .55, frontPorch: .45, stair: 0, woodpile: .15,
    sundial: 0, shops: 0, ivy: 0, age: [.2, .9], upkeep: [.5, .95], stone: '#b9906c',
    dressing: { steps: .8, shrubs: .3, bins: .4, bench: .15, pots: .6, garden: .05, fence: .55, laundry: 0, dish: .1, hay: 0, bikes: .05, trough: 0 },
  },
  // Out West's rural adobe: ranch outbuildings and old homesteads of earth walls, flat or low seam roofs
  'kanab-adobe-ranch': {
    houseEngine: false, cleanShapes: true, pueblo: true,
    archetypes: { cottage: .5, village: 0, farmhouse: .2, chalet: 0, mazot: 0, block: 0, shed: 1 },
    schemes: [
      { wall: '#b88a64', trim: '#5a4636', frame: '#d8cbb4', accent: '#5a4636' },
      { wall: '#a87a58', trim: '#4a3b30', frame: '#d8cbb4', accent: '#4a3b30' },
      { wall: '#c9a27a', trim: '#3f7f8a', frame: '#e0d6c4', accent: '#3f7f8a' },
    ],
    walls: { rough: 1 }, plinth: 0, gable: {}, barn: { rough: 1 },
    roofs: { flat: .6, seam: .4 }, forms: { flat: .6, shed: .4 }, pitch: 10, pitchJitter: 3, eaveM: .2, rakeM: .1,
    windows: 'farm', bayM: 4.5, ranch: 1, maxFloors: 1,
    shutters: 0, surrounds: 0, lintels: .5, quoins: 0, flowerBoxes: 0, genoise: 0, frontEnd: 0,
    balconies: 0, galleries: 0, dormers: 0, chimneys: 0, solar: 0, leanTo: .4, garage: 0, porch: .2, frontPorch: 0, stair: 0, woodpile: .2,
    sundial: 0, shops: 0, ivy: 0, age: [.5, 1], upkeep: [.3, .8], stone: '#a8825e',
    dressing: { steps: .3, shrubs: .1, bins: .1, bench: 0, pots: .2, garden: 0, fence: .4, laundry: 0, dish: 0, hay: .2, bikes: 0, trough: .3 },
  },
  // Kanab's barns and sheds (user, 26 Nov: "timber pole barns with metal roofs"): low, wide, boards or steel, seam roofs
  'kanab-barn': {
    houseEngine: false, cleanShapes: true,
    archetypes: { cottage: 0, village: 0, farmhouse: .1, chalet: 0, mazot: 0, block: 0, shed: 1 },
    schemes: [
      { wall: '#8a6a50', trim: '#4a3b30', frame: '#d8cbb4', accent: '#d8cbb4', roof: '#8a8d8f' },   // weathered boards, galvanised
      { wall: '#a5a8a6', trim: '#5a5e60', frame: '#e0e0dc', accent: '#e0e0dc', roof: '#7a2f28' },   // steel, red roof
      { wall: '#b9a58a', trim: '#4a3b30', frame: '#e0d6c4', accent: '#e0d6c4', roof: '#5f6164' },   // tan steel, grey roof
    ],
    walls: { boards: .5, metal: .5 }, plinth: 0, gable: { boards: 1 }, barn: { boards: .5, metal: .5 },
    roofs: { seam: .7, corrugated: .3 }, forms: { gable: 1 }, pitch: 16, pitchJitter: 4, eaveM: .5, rakeM: .3,
    windows: 'barn', bayM: 5, ranch: 1, maxFloors: 1,
    shutters: 0, surrounds: 0, lintels: 0, quoins: 0, flowerBoxes: 0, genoise: 0, frontEnd: 0,
    balconies: 0, galleries: 0, dormers: 0, chimneys: 0, solar: .05, leanTo: .45, garage: 0, porch: 0, frontPorch: 0, stair: 0, woodpile: .05,
    sundial: 0, shops: 0, ivy: 0, age: [.3, .9], upkeep: [.4, .85], stone: '#c4a582',
    dressing: { steps: 0, shrubs: .1, bins: .2, bench: 0, pots: 0, garden: 0, fence: .3, laundry: 0, dish: 0, hay: .3, bikes: 0, trough: .2 },
  },
  // CNY's village cores (Camillus, Warners, Amboy, Memphis…; tools/pgh_city.py "the country", kind 16): houses of the
  // 1850s-1920s — two storeys of clapboard, the gable to the street, a front porch on most, steeper roofs, no garages
  'cny-village': {
    houseEngine: true,   // (structures/houses: the regional house types, built in full near the road)
    cleanShapes: true,   // (recipe.js cleanShape: tidy rectangles squared to the road, set back, an occasional wing)
    archetypes: { cottage: 1, village: .3, farmhouse: 0, chalet: 0, mazot: 0, block: 0, shed: .4 },
    schemes: [
      { wall: '#f1efe8', trim: '#2f3a44', frame: '#f6f5f0', accent: '#f6f5f0' },   // white, black shutters
      { wall: '#e7d9a6', trim: '#f4f1e8', frame: '#f6f5f0', accent: '#f4f1e8' },   // yellow, white trim
      { wall: '#9fb09a', trim: '#f4f1e8', frame: '#f6f5f0', accent: '#f4f1e8' },   // sage
      { wall: '#b9c4cc', trim: '#f4f1e8', frame: '#f6f5f0', accent: '#f4f1e8' },   // pale blue
      { wall: '#c9a77e', trim: '#4a3427', frame: '#f6f5f0', accent: '#f0e6d4' },   // tan, brown trim
      { wall: '#8c3f34', trim: '#f2efe6', frame: '#f6f5f0', accent: '#f2efe6' },   // red brick colour
      { wall: '#e9e4da', trim: '#3c5a3e', frame: '#f6f5f0', accent: '#f6f5f0' },   // white, green shutters
    ],
    walls: { lap: .82, brick: .1, shingle: .08 }, plinth: .5, gable: { lap: .15, shingle: .2 }, barn: { boards: 1 },
    roofs: { asphalt: .8, slate: .15, seam: .05 }, forms: { gable: .82, hip: .14, halfHip: .04 }, pitch: 38, pitchJitter: 5, eaveM: .35, rakeM: .25,
    windows: 'sash', bayM: 3.6, ranch: 0, maxFloors: 2,
    shutters: .45, surrounds: .1, lintels: 0, quoins: 0, flowerBoxes: .03, genoise: 0, frontEnd: .6,
    balconies: 0, galleries: 0, dormers: .15, chimneys: .55, solar: .03, leanTo: .2, garage: .08, porch: .3, frontPorch: .72, stair: 0, woodpile: .05,
    sundial: 0, shops: 0, ivy: .05, age: [.35, .9], upkeep: [.5, 1], stone: '#b9b4a8',
    dressing: { steps: 1, shrubs: .6, bins: .5, bench: .1, pots: .35, garden: .15, fence: .35, laundry: 0, dish: .15, hay: 0, bikes: .1, trough: 0 },
  },
  // CNY's farmhouses (kind 13: a house with a barn by it): white clapboard, two storeys, a steep side gable, a wing at
  // the back (the lean-to), a porch across the front; a woodpile, a garden, laundry
  'cny-farmhouse': {
    houseEngine: true,   // (structures/houses: the regional house types, built in full near the road)
    cleanShapes: true,   // (recipe.js cleanShape: tidy rectangles squared to the road, set back, an occasional wing)
    archetypes: { cottage: 1, village: 0, farmhouse: 0, chalet: 0, mazot: 0, block: 0, shed: .2 },
    schemes: [
      { wall: '#f3f1ea', trim: '#2f3a44', frame: '#f6f5f0', accent: '#f6f5f0' },
      { wall: '#efece3', trim: '#3c5a3e', frame: '#f6f5f0', accent: '#f6f5f0' },
      { wall: '#f1eee6', trim: '#7a2a22', frame: '#f6f5f0', accent: '#f6f5f0' },
      { wall: '#e8dfc4', trim: '#f4f1e8', frame: '#f6f5f0', accent: '#f4f1e8' },
      { wall: '#d8d6cf', trim: '#2f3a44', frame: '#f6f5f0', accent: '#f6f5f0' },
    ],
    walls: { lap: .92, shingle: .08 }, plinth: .6, gable: { lap: .1 }, barn: { boards: 1 },
    roofs: { asphalt: .6, seam: .4 }, forms: { gable: .92, hip: .08 }, pitch: 40, pitchJitter: 4, eaveM: .3, rakeM: .2,
    windows: 'sash', bayM: 3.8, ranch: 0, maxFloors: 2,
    shutters: .3, surrounds: 0, lintels: 0, quoins: 0, flowerBoxes: .02, genoise: 0, frontEnd: .2,
    balconies: 0, galleries: 0, dormers: .05, chimneys: .7, solar: .04, leanTo: .55, garage: .1, porch: .3, frontPorch: .7, stair: 0, woodpile: .4,
    sundial: 0, shops: 0, ivy: .03, age: [.4, .95], upkeep: [.45, .95], stone: '#b5ad9c',
    dressing: { steps: 1, shrubs: .4, bins: .5, bench: .1, pots: .15, garden: .4, fence: .2, laundry: .2, dish: .2, hay: .2, bikes: .05, trough: .1 },
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
