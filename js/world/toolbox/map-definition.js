// Toolbox: the map definition (fidelity plan, step 0) — the one shape every map resolves to, whichever world draws it:
// a free-ride road-graph map (routes/cities/<id>.json: "profile", "effects"), a route scene (routes/scenes/<id>.json:
// scene-schema.js fields) or the Endless map. Renderer-side code reads this instead of the source JSON, so a new map is
// data in one of the two source formats and comes out the same; step 7 moves the rest of the rules onto it.
//
//   resolveMapDefinition({ kind: 'graph' | 'scene' | 'endless', id, json })
//     → { id, kind, profile, effects, lighting, sky, budget, assets }
//   profile   the graph map profile (map-profile.js), or the same keys read from a scene (light, season, clouds)
//   effects   the effects registry's switches (toolbox/effects), {} when none
//   lighting  { baked: '<time>' | null, time: '<fixed time key>' | null }
//   budget    the tier targets (tools/qc/budgets.json _tiers, provisional): what QC and the perf overlay hold it to
//   assets    { textures: [...], models: [...] } the map declares (per-map manifest, step 3); [] when it declares none
import { mapProfile } from './map-profile.js';
import { normalizeScene } from './scene-schema.js';

/** The fidelity plan's tier budgets (provisional until the step 2 sweep; mirrored in tools/qc/budgets.json _tiers). */
export const TIER_BUDGETS = {
  low: { fps: 30, gpuMs: 18, calls: 150, triangles: 1.0e6, programs: 25, gpuMB: 200, heapMB: 250 },
  balanced: { fps: 60, gpuMs: 10.5, calls: 500, triangles: 3.5e6, programs: 40, gpuMB: 450, heapMB: 600 },
  high: { fps: 60, gpuMs: 11, calls: 600, triangles: 6.0e6, programs: 40, gpuMB: 700, heapMB: 800 },
  ultra: { fps: 60, gpuMs: 12, calls: 700, triangles: 9.0e6, programs: 50, gpuMB: 1000, heapMB: 900 },
};
/** A map's texture download cap (MB): QC fails a map over it (step 3). */
export const MAP_TEXTURE_MB = 8;

const assetsOf = (json) => ({ textures: [...(json?.assets?.textures || [])], models: [...(json?.assets?.models || [])] });

export function resolveMapDefinition({ kind, id = null, json = {} }) {
  if (kind === 'graph') {
    const profile = mapProfile(json);
    const baked = profile.light === 'golden-upstate' ? 'golden' : json?.lighting?.baked || null;
    // (sky: the profile's clouds, then the map's own air — effects.sky { airDensity, airFalloff, airBaseM, shafts, grade })
    return { id: id ?? json.id ?? null, kind, profile, effects: { ...(json.effects || {}) }, lighting: { baked, time: baked },
      sky: { clouds: profile.clouds, ...(json.effects?.sky || {}) }, budget: TIER_BUDGETS, assets: assetsOf(json) };
  }
  if (kind === 'scene') {
    const scene = normalizeScene({ ...json });
    const baked = scene.lighting?.baked || null;
    const profile = { light: baked ? `baked-${baked}` : 'free', season: scene.season || null, clouds: scene.sky?.clouds ?? null };
    return { id: id ?? scene.id ?? null, kind, profile, effects: { ...(scene.effects || {}) }, lighting: { baked, time: scene.timeOfDay || baked },
      sky: { clouds: profile.clouds }, budget: TIER_BUDGETS, assets: assetsOf(scene) };
  }
  if (kind === 'endless') {
    const profile = mapProfile({});
    return { id: id ?? 'endless', kind, profile, effects: { ...(json.effects || {}) }, lighting: { baked: null, time: 'cycle' },
      sky: { clouds: profile.clouds }, budget: TIER_BUDGETS, assets: assetsOf(json) };
  }
  throw new Error(`map definition: unknown kind ${kind}`);
}
