// Pick the landscape builder for a stylized scene (shared by the renderer and the QC sweep).
import { makeCoastLandscape } from './coast.js';
import { makeRegionalLandscape } from './regional-landscape.js';
import { makeCityLandscape } from './city-landscape.js';
import { makeRealCoastLandscape } from './real-coast.js';

export function landscapeBuilder(scene) {
  switch (scene?.terrain) {
    case 'authored-city': return makeCityLandscape;
    case 'authored-region': return makeRegionalLandscape;
    case 'real-coast': case 'real-mountain': return makeRealCoastLandscape;
    default: return makeCoastLandscape;
  }
}
