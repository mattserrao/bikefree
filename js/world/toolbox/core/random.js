// Toolbox core: deterministic randomness and easing shared by every kit (seeded, so a scene builds the
// same every time), and the road corridor the ground must stay below.
export const smoothstep = (a, b, v) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Half-width of the road corridor (road + shoulder + a little) the ground must stay below. */
export const ROAD_CORRIDOR_M = 8;

export function randomSequence(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = (t + Math.imul(t ^ t >>> 7, 61 | t)) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// smooth value noise for planting patterns (flower drifts, grass kinds)
export const vhash = (i, j) => { const h = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return h - Math.floor(h); };
export function vnoise(x, z) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, u = fx * fx * (3 - 2 * fx), w = fz * fz * (3 - 2 * fz);
  return (vhash(i, j) * (1 - u) + vhash(i + 1, j) * u) * (1 - w) + (vhash(i, j + 1) * (1 - u) + vhash(i + 1, j + 1) * u) * w;
}
