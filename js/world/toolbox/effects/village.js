// A small-town main street: the city's shop rows dressed in the "village" facade style (toolbox/city/street-kit.js:
// more awnings, striped canvas, painted fronts) and their sidewalks furnished (toolbox/city/village-street.js:
// benches, flower barrels, bike racks, bins, flags). Options: { style: 'village', flags: true }.
// The city reads world.shopStyle and world.villageStreets as it builds a tile; nothing per frame.
export const village = {
  install(world, opts = {}) {
    world.shopStyle = opts.style || 'village';
    world.villageStreets = { flags: opts.flags ?? true };
    return { dispose() { world.shopStyle = null; world.villageStreets = null; } };
  },
};
