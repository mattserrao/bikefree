// Fall leaves on the grass (user, 25 Nov 2026 — the Zwift reference: "textured grass with fall leaf litter"): the
// graph ground's lawns and yards get leaves — thickest under the crowns (the canopy map round the camera: canopyShade),
// a light scatter everywhere and drifts here and there; flecks near, their colour's mean farther off. Shader only.
// Options: { amount: 1 (0–1) }.
import { GROUND_LOOK } from '../materials/road-look.js';

export const leafLitter = {
  install(world, opts = {}) {
    const m = world.mats?.ground; if (!m) return {};
    m.defines ||= {}; m.defines.LITTER = ''; m.needsUpdate = true;
    GROUND_LOOK.litter.value = opts.amount ?? 1;
    return { setVisible(v) { GROUND_LOOK.litter.value = v ? opts.amount ?? 1 : 0; }, dispose() { GROUND_LOOK.litter.value = 0; } };
  },
};
