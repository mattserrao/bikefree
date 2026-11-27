// Toolbox: the map profile — the rules a free-ride road-graph map is drawn by, as data instead of a list of map ids
// (user, 24 Nov 2026: "update all maps to the same rules … when conflicts arise, CNY and SKAN should win and be
// defaults"; review in the bikefree Project doc claude/building-blocks-review.md).
//
// A graph map's JSON may carry "profile": a preset name ("upstate" | "city") or an object
// { "preset": "city", …overrides }. With no profile a map gets the defaults, which are CNY's and SKAN's.
//
//   light      'golden-upstate'  a fixed low sun (GOLDEN_UPSTATE) with its shadows baked round the rider
//              'free'            the rider's own time-of-day setting, live sun (PGH)
//   roads      'worn'            upstate winter-worn asphalt and worn paint, trail banks, road-end trims, spill aprons
//              'city'            clean city asphalt and fresh paint
//   ground     'upstate'         the ground shader's upstate grass and early-fall crops (NYGRASS)
//              'desert'          red-rock country: sand on the flats, sandstone on the slopes, strata bands by height
//              'plain'
//   life       'cyclists'        other cyclists and walkers, no cars (graph-life.js)
//              'none'
//   dressing   'country'         homesteads, farmland, animals; sparse yard trees; parked cars only by shops; country cars
//              'city'            denser yard and street trees, car parks, city cars
//   season     'early-fall' | 'summer'   the tree kit's colour
//   clouds     the sky dome's cloud cover (0–1)
//   verge      the mown verge's colour
//   buildingStyles   the building kit's styles for the map's homes (toolbox/structures/buildings/presets.js)
//   softCover        the land covers' edges only wander (a soft ragged line), no scatter of grains — read as a blocky
//                    stipple (NYC's review; on every map since the 25 Nov fix pass, CNY's meadow/forest edges)
//   hideInWater      hide map footprints standing past the drawn shore (SKAN's lakefront)
//   classifyHomes    'town-core': houses within townCore.r of townCore's centre are a share (townCore.share) village
//                    houses, heights capped at maxBuildingM; falseFronts: commercial blocks get Western false fronts
//   classifyHomes    'by-neighbours': a house with a barn near is a farmhouse, one in a dozen a village house, and
//                    the village cores' shops become storefront rows (SKAN's data has every house as kind 1)
const PITTSBURGH_STYLES = [{ preset: 'pittsburgh-rowhouse', kinds: ['rowhouse'] }, { preset: 'pittsburgh-frame', kinds: ['house', 'barn', 'shed'] }];
export const PROFILE_PRESETS = {
  upstate: { light: 'golden-upstate', roads: 'worn', ground: 'upstate', life: 'cyclists', dressing: 'country', season: 'early-fall', clouds: 0.5, verge: '#78974a',
    buildingStyles: [{ preset: 'cny-suburban', kinds: ['house', 'rowhouse'] }], hideInWater: false, classifyHomes: null, softCover: true },
  // (Out West, 26 Nov 2026: red-rock desert round Kanab — golden hour baked, desert ground by slope and strata, dry
  // shrubland cover, cottonwoods by the washes, pinyon and juniper on the benches)
  desert: { light: 'golden-upstate', roads: 'worn', ground: 'desert', life: 'cyclists', dressing: 'country', season: 'early-fall', clouds: 0.35, verge: '#a99a6a',
    buildingStyles: [{ preset: 'kanab-pueblo', kinds: ['house', 'village-house'], share: .5 }, { preset: 'kanab-adobe-ranch', kinds: ['barn', 'shed'], share: .2 },
      { preset: 'kanab-pioneer', kinds: ['village-house'] }, { preset: 'kanab-barn', kinds: ['barn', 'shed', 'farmhouse-ny'] },
      { preset: 'kanab-western', kinds: ['house', 'rowhouse'] }], hideInWater: false, softCover: true, puebloShops: .3,
    // Kanab's old town (user, 26 Nov): a third of its houses the pioneer type; two storeys at most unless named; false fronts
    farTerrain: true, classifyHomes: 'town-core', townCore: { lat: 37.0475, lon: -112.5266, r: 650, share: .35 }, maxBuildingM: 10.5, falseFronts: true,
    treeMix: { woods: [['juniper', 60], ['pinyon', 40]], wet: [['cottonwood', 1]], hedge: [['juniper', 70], ['cottonwood', 30]],
      // (town, user 26 Nov: cottonwood, Arizona ash, Russian olive, juniper)
      yard: [['cottonwood', 30], ['aash', 25], ['rolive', 20], ['juniper', 20], ['pinyon', 5]], street: [['cottonwood', 40], ['aash', 40], ['rolive', 20]],
      pasture: [['juniper', 70], ['cottonwood', 30]],
      orn: [['rolive', 40], ['juniper', 45], ['pinyon', 15]], arbor: [['juniper', 1]], osm: [['cottonwood', 50], ['aash', 50]] },
    // the desert's fall golden hour: a lower, redder sun, warm dust in the air, red light bounced up off the rock
    wind: [.75, .66], windK: 1.25,   // (the afternoon wind up the desert from the south-west)
    // [evidence 27 Nov] a clear sky with the sun 11° up gives level ground about 1.5–2× as much direct light as sky light
    // (clear-sky irradiance: ~600 W/m² beam × sin 11° ≈ 115 against ~60 diffuse); it had 0.7×, so the sky's blue
    // outweighed the sun on the flats and the near sand went mauve (matched shots: land hue 30–41° toward magenta)
    sun: { elev: 11, az: 248, sky: '#93abd2', fog: '#e2c3a0', hemiSky: '#ffd6aa', hemiGround: '#9a5a3a', sun: '#ffb36a', sunI: 5.0, hemiI: .8, exposure: .98 } },
  city: { light: 'free', roads: 'city', ground: 'plain', life: 'none', dressing: 'city', season: 'summer', clouds: 0.35, verge: '#7b8556',
    buildingStyles: PITTSBURGH_STYLES, hideInWater: false, classifyHomes: null, softCover: true },
};
export const DEFAULT_PROFILE = 'upstate';
export { PITTSBURGH_STYLES };

/** The resolved profile of a graph map's JSON (always a full object; unknown keys are kept for new kits). */
export function mapProfile(json) {
  const p = json?.profile;
  const spec = typeof p === 'string' ? { preset: p } : p || {};
  const base = PROFILE_PRESETS[spec.preset || DEFAULT_PROFILE];
  if (!base) throw new Error(`map profile: unknown preset "${spec.preset}"`);
  const { preset, ...over } = spec;
  return { preset: preset || DEFAULT_PROFILE, ...base, ...over };
}
