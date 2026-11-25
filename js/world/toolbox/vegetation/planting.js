// Toolbox vegetation: the planting API — the one way a planner hands trees to the tree engine (user, 24 Nov 2026:
// "modernize all maps to use the same common building blocks"; review: claude/building-blocks-review.md).
//
// Planners decide where trees stand; the tree engine (tree-engine.js) draws them. Every planner speaks the same record:
//   { x, y, z, sp, v, s, sy, rot, farOnly? }   sp: the kit's species key, v: its variant (green / turning / turned),
//                                             s: width scale, sy: height scale, rot: yaw, farOnly: impostor only
// and plants a tile with plantTile(engine, key, trees).
//
//   planner        where it plants                                              module
//   rural          the graph maps: woods, hedgerows, yards, streets, edges      graph-city.js _ruralTrees
//   forest-edge    the route scenes' continuous canopy past a mown verge         forest.js ForestPlanner
//   scatter        the route scenes' per-tile scatter and far planting           stylized-terrain.js _scatter*
//   old-growth     a hero old-growth area (Camillus Forest)                      old-growth.js
// A new map picks a planner by its data (the graph maps' profile, a scene's "vegetation.layout") — never by its id.
import * as THREE from '../../../../vendor/three.module.min.js';

export const PLANNERS = {
  rural: 'js/world/graph-city.js _ruralTrees',
  'forest-edge': 'js/world/toolbox/vegetation/forest.js',
  scatter: 'js/world/stylized-terrain.js',
  'old-growth': 'js/world/toolbox/vegetation/old-growth.js',
};

/** One tree for the engine. */
export function treeRecord(x, y, z, sp, { v = 0, s = 1, sy = s, rot = 0, farOnly = false } = {}) {
  const t = { x, y, z, sp, v, s, sy, rot };
  if (farOnly) t.farOnly = true;
  return t;
}

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
/** A planner's instance matrices by model name ({ name: Matrix4[] }) as engine records (yaw only). */
export function recordsFromMatrices(lists, has = () => true) {
  const trees = [];
  for (const [name, matrices] of Object.entries(lists)) {
    if (!has(name)) continue;
    for (const m of matrices) { m.decompose(_p, _q, _s); _e.setFromQuaternion(_q, 'YXZ'); trees.push({ x: _p.x, y: _p.y, z: _p.z, sp: name, v: 0, s: _s.x, sy: _s.y, rot: _e.y }); }
  }
  return trees;
}

/** Plant (or replant) one tile of trees in the engine. */
export function plantTile(engine, key, trees) { engine.setTile(key, trees); }
