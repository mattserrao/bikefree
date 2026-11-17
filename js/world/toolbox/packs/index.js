// Regional pack registry: the one place the scene builder looks up a pack's geometry and materials.
// To add a pack: write its module (built on ../core/model-builder.js), describe it in ./meta.js, and
// register it here. Any route can then list it in "packs".
import { makeNortheastPack } from './northeast.js';
import { makeNorthernRockiesPack, decorateTreeMaterial } from './northern-rockies.js';
import { PACK_META, packId } from './meta.js';

const categories = (id) => Object.fromEntries(PACK_META[id].groundcover.map((n) => [n, 'groundcover']));

export const PACKS = {
  northeast: { make: makeNortheastPack, category: categories('northeast') },
  // near trees get the bark / foliage / moss surface shader (the pack tags each surface in its aTree attribute)
  'northern-rockies': { make: makeNorthernRockiesPack, category: categories('northern-rockies'), decorateNear: decorateTreeMaterial },
};

/** The packs a scene asks for, in the order it lists them (old names accepted). */
export function scenePacks(scene) {
  return (scene.packs || scene.kitExtensions || []).map(packId).filter((id) => id && PACKS[id]).map((id) => ({ id, ...PACKS[id] }));
}

export { PACK_META, packId };
