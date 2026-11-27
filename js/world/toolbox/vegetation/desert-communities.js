// Toolbox: the red-rock desert's plant communities (Out West; plants phase 4, 27 Nov 2026 — claude/desert-plant-life-
// plan.md). Which plants grow where, as a table: graph-city.js's land-cover loop asks desertCommunity() at each spot
// and plants from the answer. Every name here must be in the map's kit (upstate-trees.js makeUpstateTrees({ desert })):
// test/desert-plants.test.mjs holds them to it.
//
//   const cm = desertCommunity(city, x, z, landCode, metresFromRoad, LAND)  → { role, trees, shrubs, list, clump, tumble }
//   pickShrub(cm.list, r)  → a shrub's name

// [plants phase 4, 27 Nov] the red-rock desert's plant communities (claude/desert-plant-life-plan.md). Each: trees (the
// chance a cell's spot holds one, by the map's mix role), shrubs (the chance it holds a shrub) and their mix, tumble
// (a tumbleweed fetched up beside one), clump (the mean number more of the same round each shrub), grove (the chance a
// tree has a second beside it: pinyon-juniper canopy runs 15–30% — NRCS R048AY342UT — which one tree per 8 m can't
// reach). desertCommunity picks one from the cover, the height above sea level (the
// world's y), the slope and which way it faces, the creek and the road, and scales it: steep risers bare, benches and
// north faces fuller.
export const DESERT_COMMUNITIES = {
  riparian: { clump: 1.5, grove: .6, role: 'riparian', trees: .4, shrubs: .3, list: [['rabbitbrush', 30], ['saltbush', 25], ['sage2', 20], ['snakeweed', 15], ['tumbleweed', 10]] },
  dune: { clump: 2.5, role: 'woods', trees: .004, shrubs: .22, list: [['sandsage', 50], ['rabbitbrush', 14], ['ephedra', 14], ['snakeweed2', 10], ['yucca', 8], ['pricklyPear', 4]] },
  ponderosa: { clump: 1.5, grove: .3, role: 'ponderosa', trees: .3, shrubs: .34, list: [['manzanita', 32], ['bitterbrush', 28], ['sage', 18], ['cliffrose', 8], ['snakeweed', 8], ['yucca', 6]] },
  upper: { clump: 1.5, grove: .35, role: 'upper', trees: .32, shrubs: .36, list: [['bitterbrush', 22], ['cliffrose', 18], ['sage', 16], ['manzanita', 12], ['snakeweed', 12], ['yucca', 8], ['pricklyPear', 6], ['redrock', 6]] },
  pj: { clump: 1.5, grove: .35, role: 'woods', trees: .38, shrubs: .4, list: [['sage', 20], ['sage2', 12], ['snakeweed', 14], ['cliffrose', 12], ['yucca', 10], ['yuccaStalk', 3], ['pricklyPear', 12], ['bitterbrush', 6], ['cholla', 4], ['redrock', 7]] },
  sage: { clump: 3, role: 'woods', trees: .025, shrubs: .56, tumble: .07, list: [['sage', 22], ['sage2', 18], ['rabbitbrush', 16], ['snakeweed', 14], ['ephedra', 7], ['saltbush', 6], ['pricklyPear', 6], ['pricklyPear2', 2], ['yucca', 5], ['yuccaStalk', 2], ['cholla', 1], ['redrock', 1]] },
  lowflat: { clump: 3, role: 'woods', trees: .01, shrubs: .5, tumble: .06, list: [['saltbush', 24], ['blackbrush', 20], ['snakeweed', 18], ['sage', 14], ['rabbitbrush', 10], ['ephedra', 8], ['pricklyPear', 6]] },
  slick: { clump: 0.5, role: 'woods', trees: .02, shrubs: .13, list: [['redrock', 26], ['redrock2', 14], ['blackbrush', 16], ['sage', 12], ['barrel', 10], ['pricklyPear', 10], ['ephedra', 12]] },
  verge: { clump: 1, role: 'woods', trees: 0, shrubs: .45, tumble: .03, list: [['snakeweed', 34], ['snakeweed2', 16], ['rabbitbrush', 22], ['tumbleweed', 10], ['saltbush', 8], ['tumbleweed2', 4], ['sage2', 6]] },
};
export const pickShrub = (list, r) => { let tot = 0; for (const [, w] of list) tot += w; let a = 0; for (const [n, w] of list) { a += w / tot; if (r <= a) return n; } return list[list.length - 1][0]; };
/** The community at (x, z) on cover c, de m from the road's edge (the land-cover loop's spot), scaled for its ground. */
export function desertCommunity(city, x, z, c, de, LAND) {
  const W = city.world, h = (px, pz) => W._groundH(px, pz), y = h(x, z);
  const gx = (h(x + 8, z) - h(x - 8, z)) / 16, gz = (h(x, z + 8) - h(x, z - 8)) / 16, slope = Math.hypot(gx, gz);
  let base;
  // (the creek's band: water — the land's own water cells — within ~30 m; the world has no nearWater, so before this
  //  the desert's cottonwoods only grew on the odd wetland cell: the census found no riparian plants at all)
  let wet = c === LAND.wetland;
  for (let k = 0; k < 12 && !wet; k++) { const a = k * .5236, d = k % 2 ? 28 : 14; wet = city.landAt?.(x + Math.cos(a) * d, z + Math.sin(a) * d) === LAND.water || !!city.inWater?.(x + Math.cos(a) * d, z + Math.sin(a) * d); }
  if (wet) base = DESERT_COMMUNITIES.riparian;
  else if (c === LAND.sand) base = DESERT_COMMUNITIES.dune;
  else if (de > 3 && de < 10 && c !== LAND.pj) base = DESERT_COMMUNITIES.verge;   // (the road's disturbed strip)
  else if (c === LAND.slick) base = DESERT_COMMUNITIES.slick;
  else if (y > 1950 && c === LAND.pj) base = DESERT_COMMUNITIES.ponderosa;   // (the Moquith plateau's woods, ~2,000 m and up)
  else if (c === LAND.pj) base = y > 1720 ? DESERT_COMMUNITIES.upper : DESERT_COMMUNITIES.pj;
  else if (c === LAND.sage) base = y < 1560 ? DESERT_COMMUNITIES.lowflat : DESERT_COMMUNITIES.sage;
  else base = DESERT_COMMUNITIES.verge;   // (the town's ground: a weedy lot)
  // steep risers (the terraced cliff bands) bare; a north face (the ground rising to the south: +z is south) fuller
  const steep = 1 - Math.min(1, Math.max(0, (slope - .45) / .5)) * .75, north = gz > .12 ? 1.35 : gz < -.12 ? .85 : 1;
  return { ...base, trees: base.trees * steep * north, shrubs: Math.min(.9, base.shrubs * steep * north) };
}
