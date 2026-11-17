// Regional packs: what each procedural pack provides, as plain data (no three.js), so the build, the scene
// linter, the asset gallery and the docs can all read it in Node. The geometry itself is in the pack's own
// module (registered in ./index.js). test/toolbox.test.mjs checks that every list here matches what the
// pack really builds.
//
// A scene turns packs on with  "packs": ["northeast"]  (the old "kitExtensions": ["adirondack"] still works).
// A pack is a region's look: its tree species in three levels of detail (name, name-lod, name-far), its
// ground cover and its built world. Models are low-poly, vertex-coloured, metres, Y up, +Z along the road.

const lods = (names) => names.flatMap((n) => [n, `${n}-lod`, `${n}-far`]);

export const PACK_META = {
  northeast: {
    aliases: ['adirondack'],
    name: 'Northeast forest and lake country',
    region: 'Adirondacks / northern New England',
    firstUsedBy: 'route28',
    description: 'Northern hardwood–conifer forest (white pine, red spruce, hemlock, sugar maple, paper birch) with fall colour, forest-edge plants, boulders, and the lakeside built world: houses, camps, store, church, motel, boathouses, docks, canoes, motorboats, utility poles, mailboxes, guardrail.',
    // tree species → number of variants (each variant has three levels of detail)
    variants: { maple: 2, spruce: 2, hemlock: 1, birch: 2, whitepine: 2 },
    groundcover: ['goldenrod', 'blueberry'],
    models: {
      trees: lods(['whitepine0', 'whitepine1', 'spruce0', 'spruce1', 'hemlock0', 'maple0', 'maple1', 'birch0', 'birch1']),
      plants: ['sapling0', 'sapling1', 'goldenrod', 'blueberry'],
      rocks: ['boulder0', 'boulder1'],
      buildings: ['house0', 'house1', 'house2', 'house3', 'house4', 'house5', 'camp0', 'camp1', 'camp2', 'store0', 'church0', 'motel0', 'boathouse0'],
      water: ['dock0', 'canoe0', 'canoe1', 'canoe2', 'motorboat0'],
      roadside: ['pole0', 'mailbox0', 'guardrail0'],
    },
    options: { fall: 'season "fall": maples and birches turn' },
  },
  'northern-rockies': {
    aliases: ['glacier'],
    name: 'Northern Rockies mountain forest',
    region: 'Glacier National Park / northern Rockies',
    firstUsedBy: 'goingtothesun',
    description: 'Mountain forest by elevation zone (western red cedar and hemlock in the valleys, Engelmann spruce, subalpine fir and larch higher, lodgepole and aspen on the dry side, krummholz at treeline, burned snags), forest floor (logs, stumps, moss, branches, stones), shrubs, bunch grasses and subalpine wildflowers in single clumps and drifts, alder chutes and talus. Near trees carry the bark/foliage/moss surface shader.',
    variants: { cedar: 3, whemlock: 2, espruce: 3, subfir: 3, lodgepole: 3, larch: 1, aspen: 2, snag: 2 },
    // flower drifts by vegetation zone (vegetation.rich): the planner picks one flower per patch
    flowerZones: {
      valley: ['arnica', 'aster', 'arnica', 'fireweed', 'paintbrush'],
      subalpine: ['beargrass', 'lupine', 'paintbrush', 'arnica', 'alpineflowers', 'beargrass'],
      alpine: ['glacierlily', 'paintbrush', 'alpineflowers', 'glacierlily'],
      east: ['aster', 'lupine', 'paintbrush', 'arnica'],
      creek: ['monkeyflower', 'monkeyflower', 'arnica'],
    },
    drifts: ['lupine', 'arnica', 'aster', 'monkeyflower', 'paintbrush', 'glacierlily', 'beargrass', 'fireweed'],
    groundcover: ['lupineD', 'arnicaD', 'asterD', 'monkeyflowerD', 'paintbrushD', 'glacierlilyD', 'beargrassD', 'fireweedD', 'bunchgrass', 'sedge', 'meadowgrass', 'drygrass', 'tuft0', 'tuft1', 'lupine', 'arnica', 'aster', 'monkeyflower', 'fireweed', 'beargrass', 'paintbrush', 'glacierlily', 'huckleberry'],
    models: {
      trees: lods(['cedar0', 'cedar1', 'cedar2', 'whemlock0', 'whemlock1', 'espruce0', 'espruce1', 'espruce2', 'subfir0', 'subfir1', 'subfir2', 'lodgepole0', 'lodgepole1', 'lodgepole2', 'larch0', 'aspen0', 'aspen1', 'snag0', 'snag1']),
      floor: ['log0', 'log1', 'stump0', 'stump1', 'mossmat0', 'mossmat1', 'branch0', 'branch1', 'stone0', 'stone1'],
      grasses: ['bunchgrass', 'sedge', 'meadowgrass', 'drygrass', 'tuft0', 'tuft1'],
      shrubs: ['thimbleberry', 'willow', 'juniper', 'serviceberry', 'huckleberry', 'alder0', 'alder1', 'krummholz0', 'krummholz1'],
      flowers: ['lupine', 'arnica', 'aster', 'monkeyflower', 'fireweed', 'beargrass', 'paintbrush', 'glacierlily',
        'lupineD', 'arnicaD', 'asterD', 'monkeyflowerD', 'paintbrushD', 'glacierlilyD', 'beargrassD', 'fireweedD'],
      rocks: ['talus0', 'talus1'],
    },
    options: { fall: 'season "fall": larch and aspen turn', decorate: 'near trees get the bark/foliage surface shader' },
  },
};

/** Every model name a pack builds. */
export const packModels = (id) => Object.values(PACK_META[id]?.models || {}).flat();

/** Canonical pack id for a name or alias ('adirondack' → 'northeast'), or null. */
export function packId(name) {
  if (PACK_META[name]) return name;
  for (const [id, m] of Object.entries(PACK_META)) if (m.aliases.includes(name)) return id;
  return null;
}
