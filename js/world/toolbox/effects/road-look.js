// The road look (user, 25 Nov 2026 — the Zwift reference: "textured asphalt with aggregate, crisp double lines and
// dashes, a soft edge strip"): on a graph map's roads,
//   paint    the lines drawn in the road surface's own shader (graph-world.js SHADERPAINT): box-filtered across a pixel,
//            so they're crisp up close and a faint even line far off — no stair-steps or crawl, with or without MSAA (a
//            phone has none); worn a little, the aggregate showing through. One-way lane dashes stay geometry.
//   asphalt  a park drive's surface (PARKROAD): its tone (× rgb), the aggregate's speckle, a darker gutter along each
//            edge, fall leaves gathered there (leaves 0–1) and a few strays on the lanes.
// Options: { paint: true, asphalt: true, tone: [1.16, 1.15, 1.13], leaves: 0.8 }. Shader only: no draw calls.
import { ROAD_LOOK } from '../materials/road-look.js';

export const roadLook = {
  install(world, opts = {}) {
    const m = world.mats?.roadSurface; if (!m) return {};
    world.roadLook = { paint: opts.paint !== false };
    m.defines ||= {};
    if (opts.paint !== false) m.defines.SHADERPAINT = '';
    if (opts.asphalt !== false) m.defines.PARKROAD = '';
    m.needsUpdate = true;
    ROAD_LOOK.tone.value.fromArray(opts.tone || [1.16, 1.15, 1.13]);
    ROAD_LOOK.leaves.value = opts.leaves ?? .8;
    return { dispose() { ROAD_LOOK.tone.value.set(1, 1, 1); ROAD_LOOK.leaves.value = 0; } };
  },
};
