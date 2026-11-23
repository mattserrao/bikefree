// Front yards on the building kit's houses (toolbox/city/front-yards.js): picket fences and hedges on the front lot
// line, foundation shrubs, flower beds. Options: { fence: 0.22, hedge: 0.2, shrubs: 0.8 } (chances per house).
// The city reads world.frontYards as it builds a tile's homesteads; nothing per frame.
export const frontYards = {
  install(world, opts = {}) {
    world.frontYards = { fence: opts.fence ?? 0.22, hedge: opts.hedge ?? 0.2, shrubs: opts.shrubs ?? 0.8 };
    return { dispose() { world.frontYards = null; } };
  },
};
