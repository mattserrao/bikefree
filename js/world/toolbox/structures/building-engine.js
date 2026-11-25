// Toolbox: the building engine — one front door for every building in the game (user, 24 Nov 2026: "modernize all
// maps to use the same common building blocks … the Pittsburgh map contains a lot of buildings. It may be a building
// engine needs to be created so the city retains its realism level"; chose "one front door": same output, one API).
//
// A map's building is a footprint plus a kind (and the zone it stands in). The engine says which generator draws each
// kind, and draws a planned building through the right one:
//
//   generator       kinds                                            module
//   house-engine    house, village-house, farmhouse-ny               structures/houses/ (regional plans, close detail)
//   building-kit    rowhouse, house, cottage, village, farmhouse,    structures/buildings/ (recipe → assemble)
//                   chalet, mazot, block, shed, barn
//   farm            barn-ny, freestall, shed-ny                      city/cny-farms.js (red boards, gambrels, silos)
//   city-facades    tower, block, shop-row, other                    city/city.js (the facade shader's chunks)
//   footprints      (route scenes' older map footprints)             structures/footprints.js
//   settlement      (pack models: Route 28's villages and camps)     structures/settlement.js
//   named           (a scene's named models: the GTTS lodges)        structures/mountain-road.js
//
// The kit's recipe decides house-engine vs kit per building (a style with houseEngine: the CNY presets); the engine's
// buildBuilding() then draws it through that generator, so every caller (the route scenes' BuildingKit and
// CityBuildingKit, the graph maps' GraphCity) draws a building the same way. New kinds (Pittsburgh's own house plans,
// an endless map's biomes) register here and every map can use them.
import { buildHouse, CHIMNEYS } from './houses/house-engine.js';
import { HOUSE_KINDS } from './houses/house-plan.js';
import { assemble } from './buildings/assemble.js';

export const GENERATORS = {
  'house-engine': { module: 'structures/houses/', kinds: [...HOUSE_KINDS] },
  'building-kit': { module: 'structures/buildings/', kinds: ['rowhouse', 'house', 'cottage', 'village', 'farmhouse', 'chalet', 'mazot', 'block', 'shed', 'barn'] },
  farm: { module: 'city/cny-farms.js', kinds: ['barn-ny', 'freestall', 'shed-ny'] },
  'city-facades': { module: 'city/city.js', kinds: ['tower', 'block', 'shop-row', 'other'] },
  footprints: { module: 'structures/footprints.js', kinds: ['footprint'] },
  settlement: { module: 'structures/settlement.js', kinds: ['pack-model'] },
  named: { module: 'structures/mountain-road.js', kinds: ['named'] },
};

// The graph maps' footprint codes (tools/pgh_city.py, tools/city/*.json → <map>-city.json "kind") as engine kinds.
//   0 rowhouse · 1 house · 12 (skipped: under a deck) · 13 barn · 14 shed (SKAN) · 20 farmhouse · 21 barn · 22 free-stall
//   barn · 23 village house · 24 shed (CNY) · anything else: a city building (the facade chunks)
export const MAP_KINDS = { 0: 'rowhouse', 1: 'house', 13: 'barn', 14: 'shed', 20: 'farmhouse-ny', 23: 'village-house' };
export const FARM_CODES = new Set([21, 22, 24]);
const FARM_KINDS = { 21: 'barn-ny', 22: 'freestall', 24: 'shed-ny' };

/** The engine kind of a graph map's footprint code: a home the kit plans, a farm building, or a city building. */
export function kindOfCode(code) {
  if (MAP_KINDS[code]) return MAP_KINDS[code];
  if (FARM_CODES.has(code)) return FARM_KINDS[code];
  return 'other';
}

/** Which generator draws a planned kit building (a recipe, recipe.js planBuildings). */
export function generatorOf(R) { return R.house ? 'house-engine' : 'building-kit'; }

/**
 * Draw one planned building through its generator.
 *   w      the main writer (walls, roofs, openings: always drawn)
 *   d      the near-detail writer
 *   close  the house engine's close-detail writer (casings, rails, gutters; a NullWriter where a map has none)
 *   land   the landscape (heightAt …) it stands on
 * Returns the generator's result (the dressing reads it).
 */
export function buildBuilding(R, w, d, close, land) {
  return R.house ? buildHouse(R, R.house, w, d, close, land) : assemble(R, w, d, land);
}

/** The house engine's close detail for a planned house (only a house-engine building has it). */
export function buildCloseDetail(R, w, d, close, land) {
  if (R.house) buildHouse(R, R.house, w, d, close, land);
}

export { CHIMNEYS };
