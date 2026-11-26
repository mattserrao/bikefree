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
//   classifyHomes    'by-neighbours': a house with a barn near is a farmhouse, one in a dozen a village house, and
//                    the village cores' shops become storefront rows (SKAN's data has every house as kind 1)
const PITTSBURGH_STYLES = [{ preset: 'pittsburgh-rowhouse', kinds: ['rowhouse'] }, { preset: 'pittsburgh-frame', kinds: ['house', 'barn', 'shed'] }];
export const PROFILE_PRESETS = {
  upstate: { light: 'golden-upstate', roads: 'worn', ground: 'upstate', life: 'cyclists', dressing: 'country', season: 'early-fall', clouds: 0.5, verge: '#78974a',
    buildingStyles: [{ preset: 'cny-suburban', kinds: ['house', 'rowhouse'] }], hideInWater: false, classifyHomes: null, softCover: true },
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
