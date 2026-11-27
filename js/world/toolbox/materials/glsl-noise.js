// [blocks] Shared GLSL: value noise and fbm on a plane, the one copy every shader includes (the sky domes, the
// endless map's ground). h21: a hash; vn: smooth value noise; fbm: five octaves.
export const NOISE_GLSL = /* glsl */`
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float a = .5, s = 0.; for (int k = 0; k < 5; k++) { s += a * vn(p); p = p * 2.03 + 17.1; a *= .5; } return s; }
`;

// [review 27 Nov] Sin-free hashes and value noise, the one copy (~14 shaders carried their own). fract(sin(dot(p, k)) *
// 43758.5) loses its bits once the argument is large (GPU sin is only accurate near 0: world metres × 127 is ~1e5),
// so it repeats and correlates far from the origin; these are Dave Hoskins' "hash without sine" (MIT), exact for any
// input. hw21: vec2 → float; hw31: vec3 → float; hw22: vec2 → vec2; vn2 / vn3: smooth value noise on a plane / in
// space (vn2 is exactly the private copies' noise: the same hash and fade). Guarded, so two blocks of one shader can
// both include it. (h21 / vn / fbm above stay as they are: the sky domes and the endless ground draw with them.)
export const HASH_GLSL = /* glsl */`
#ifndef BF_HASH_GLSL
#define BF_HASH_GLSL
float hw21(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float hw31(vec3 p) { p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec2 hw22(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
float vn2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hw21(i), hw21(i + vec2(1., 0.)), f.x), mix(hw21(i + vec2(0., 1.)), hw21(i + 1.), f.x), f.y); }
float vn3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(hw31(i), hw31(i + vec3(1, 0, 0)), f.x), mix(hw31(i + vec3(0, 1, 0)), hw31(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hw31(i + vec3(0, 0, 1)), hw31(i + vec3(1, 0, 1)), f.x), mix(hw31(i + vec3(0, 1, 1)), hw31(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
#endif
`;
