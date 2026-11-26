// Toolbox: the lit-material factory (fidelity plan, steps 0 and 4). Scenery materials come from here, so the lighting
// model is one decision: PBR (MeshStandardMaterial, metalness 0) with a roughness per surface, lit by the sun and the
// sky's environment map (environment.js) — specular on wet road, glass and water, a matte sheen on asphalt.
// The shader patches (baked light, surface detail, canopy shade, road look) touch only chunks Standard shares with
// Lambert (common, color_fragment, begin_vertex, normal_fragment_maps, lights_fragment_begin), so they carry over.
import * as THREE from '../../../../vendor/three.js';

/** Roughness by surface: what each kind of scenery reads as under a low sun. */
export const ROUGHNESS = { ground: .95, asphalt: .9, paint: .6, concrete: .85, stone: .9, wood: .85, foliage: .8, water: .08, glass: .06, metal: .5, plastic: .55, default: .9 };

/** How much of the sky environment each surface takes (its ambient and its sheen): dark rough asphalt mostly keeps
 *  its own colour (the snapshots: at 1 the road read sky-blue at a glancing angle). */
export const ENV_INTENSITY = { asphalt: .55, paint: .7, ground: .85, default: 1 };

/** A lit scenery material: Standard, metalness 0, roughness from the surface kind (or params.roughness). */
export function litMaterial(params = {}, surface = 'default') {
  return new THREE.MeshStandardMaterial({ metalness: 0, roughness: ROUGHNESS[surface] ?? ROUGHNESS.default, envMapIntensity: ENV_INTENSITY[surface] ?? ENV_INTENSITY.default, ...params });
}
