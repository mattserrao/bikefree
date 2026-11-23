// The graphics effects: each is its own module, switched on per map by the graph JSON's "effects" block, e.g.
//   "effects": { "water": {}, "shoreline": { "reeds": 0.5 }, "village": {} }
// (a key present turns that effect on; its object holds the effect's options; absent → off). A map elsewhere opts in
// the same way: nothing in an effect knows which map it is in.
//
// An effect is { install(world, opts) → handle }, the handle any of:
//   tick(t, dt)        every frame (t: seconds)
//   *tileJob(tile)     after a tile's ground is built (a generator: yield when due()); meshes it makes go in
//                      tile.extra so the world releases them with the tile
//   dispose()
// The world it is given needs: scene, group, mats, sun, sunDir, camera, poolAt(x, z), surfaceH(x, z), waterTop(x, z)
// and (for tiles) TILE.
import { waterSurface } from './water-surface.js';
import { shoreline } from './shoreline.js';
import { village } from './village.js';
import { frontYards } from './front-yards.js';
import { sky } from './sky.js';
import { atmosphere } from './atmosphere.js';

export const EFFECTS = { water: waterSurface, shoreline, village, frontYards, sky, atmosphere };

/** Install the effects a map asks for; returns one handle that fans out to them. */
export function installEffects(world, cfg = {}) {
  const on = Object.entries(cfg || {}).filter(([k, v]) => EFFECTS[k] && v !== false).map(([k, v]) => {
    try { return { name: k, h: EFFECTS[k].install(world, v === true ? {} : v) || {} }; } catch (e) { console.warn(`effect ${k}:`, e); return null; }
  }).filter(Boolean);
  return {
    names: on.map((e) => e.name),
    tick(t, dt) { for (const e of on) e.h.tick?.(t, dt); },
    *tileJob(tile) { for (const e of on) if (e.h.tileJob) yield* e.h.tileJob(tile); },
    dispose() { for (const e of on) e.h.dispose?.(); },
  };
}
