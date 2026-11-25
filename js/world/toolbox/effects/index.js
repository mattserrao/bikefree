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
//
// [blocks] One registry for both worlds (user, 24 Nov 2026: "modernize all maps to use the same common building
// blocks"): the free-ride graph maps read their JSON's "effects" block, the route scenes their scene JSON's
// "effects" field (scene-schema.js). Each effect lists what it needs from the world (NEEDS); one asked for in a world
// that lacks a need is skipped with a warning, never half-installed.
import { waterSurface } from './water-surface.js';
import { shoreline } from './shoreline.js';
import { village } from './village.js';
import { frontYards } from './front-yards.js';
import { sky } from './sky.js';
import { atmosphere } from './atmosphere.js';

export const EFFECTS = { water: waterSurface, shoreline, village, frontYards, sky, atmosphere };

/** The world methods each effect calls (checked at install; the properties they read — group, sun, sunDir, mats,
 *  TILE — may be set after the effects are installed, so they're read per frame and not checked here). */
export const NEEDS = {
  water: [],
  shoreline: ['surfaceH', 'waterTop'],
  village: [],
  frontYards: [],
  sky: [],
  atmosphere: ['surfaceH'],
};

/** The methods an effect calls that this world doesn't have (empty: it can be installed). */
export function missingNeeds(world, name) { return (NEEDS[name] || []).filter((k) => typeof world[k] !== 'function'); }

export function installEffects(world, cfg = {}) {
  const on = Object.entries(cfg || {}).filter(([k, v]) => EFFECTS[k] && v !== false).filter(([k]) => {
    const miss = missingNeeds(world, k);
    if (miss.length) console.warn(`effect ${k}: skipped, the world has no ${miss.join(', ')}`);
    return !miss.length;
  }).map(([k, v]) => {
    try { return { name: k, h: EFFECTS[k].install(world, v === true ? {} : v) || {} }; } catch (e) { console.warn(`effect ${k}:`, e); return null; }
  }).filter(Boolean);
  return {
    names: on.map((e) => e.name),
    tick(t, dt) { for (const e of on) if (!e.off) e.h.tick?.(t, dt); },
    /** Turn one effect off or on (the graphics menu): it stops ticking and hides what it draws. */
    set(name, v) { for (const e of on) if (e.name === name) { e.off = !v; e.h.setVisible?.(!!v); } },
    *tileJob(tile) { for (const e of on) if (e.h.tileJob) yield* e.h.tileJob(tile); },
    dispose() { for (const e of on) e.h.dispose?.(); },
  };
}
