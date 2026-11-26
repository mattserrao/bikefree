// [zwift-look] The road look's shared shader knobs (graph-world's road surface reads them; the roadLook effect sets
// them): the asphalt's tone (× rgb) and how many fall leaves gather at its edges (0–1).
import * as THREE from '../../../../vendor/three.module.min.js';

export const ROAD_LOOK = { tone: { value: new THREE.Vector3(1, 1, 1) }, leaves: { value: 0 } };
/** [zwift-look] The ground's: fall leaves on the grass (0–1; the leafLitter effect). */
export const GROUND_LOOK = { litter: { value: 0 } };
