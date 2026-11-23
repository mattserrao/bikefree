// A small-town main street's sidewalk furniture, set out along a run of shop fronts: benches, flower barrels and
// hanging-basket planters, bike racks, litter bins and the flags a village hangs from its lamp posts.
// Modular: give it the fronts a facade dresser found (toolbox/city/street-kit.js `_frontsOf` shape: a, tx, tz, nx, nz,
// len, base) and the sidewalk's width; it writes into a MeshBuilder. Nothing here knows which map it is in.
//   villageFurniture(B, fronts, walkW, seed, { flags: true })
// B: a MeshBuilder (toolbox/core/mesh-builder.js).

const hash = (n) => { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };

// (each piece in the front's frame: t along the walk, n out to the street; MeshBuilder.box's w runs along t, l along n)
function bench(B, x, y, z, f, yn) {
  // a park bench: cast-iron ends, three slats on the seat and two on the back, facing the street
  const at = (u, v) => [x + f.tx * u + f.nx * v, z + f.tz * u + f.nz * v];
  B.color('#1e2420');
  for (const u of [-0.75, 0.75]) { const [px, pz] = at(u, 0); B.box(px, y, pz, 0.06, 0.78, 0.5, yn); }
  B.color('#6a4a2e');
  for (const v of [-0.14, 0, 0.14]) { const [px, pz] = at(0, v + 0.04); B.box(px, y + 0.42, pz, 1.7, 0.04, 0.1, yn); }
  for (const h of [0.58, 0.72]) { const [px, pz] = at(0, -0.22); B.box(px, y + h, pz, 1.7, 0.1, 0.035, yn); }
}
function barrel(B, x, y, z, k) {
  // a half-barrel of flowers (marigolds, petunias): staves, two hoops, a mound of bloom
  B.color('#7a5634').cylinder(x, y, z, 0.38, 0.55, 10);
  B.color('#2b2b2b').cylinder(x, y + 0.12, z, 0.395, 0.04, 10).cylinder(x, y + 0.42, z, 0.395, 0.04, 10);
  B.color('#3f6a2c').cylinder(x, y + 0.55, z, 0.36, 0.12, 9);
  B.color(['#e8a326', '#c2304a', '#f0d64a', '#b45bb8', '#f2f2ea'][Math.floor(hash(k) * 5)]);
  for (let q = 0; q < 6; q++) { const a = q * 1.05 + hash(k + q); B.box(x + Math.cos(a) * 0.22, y + 0.64, z + Math.sin(a) * 0.22, 0.13, 0.1, 0.13, a); }
}
function rack(B, x, y, z, f, yn) {
  // an inverted-U bike rack: two hoops, each across the walk
  B.color('#3a3d40');
  for (const u of [-0.45, 0.45]) {
    const px = x + f.tx * u, pz = z + f.tz * u;
    for (const v of [-0.3, 0.3]) B.box(px + f.nx * v, y, pz + f.nz * v, 0.05, 0.82, 0.05, yn);
    B.box(px, y + 0.8, pz, 0.05, 0.05, 0.65, yn);
  }
}
function bin(B, x, y, z) { B.color('#1f3328').cylinder(x, y, z, 0.27, 0.9, 10); B.color('#2a2a2a').cylinder(x, y + 0.9, z, 0.3, 0.06, 10); }
function flag(B, x, y, z, f, yn) {
  // a flag on a bracket off the building: a short pole out over the walk, the flag hanging from it
  B.color('#d9d4c8').box(x + f.nx * 0.7, y + 3.55, z + f.nz * 0.7, 0.04, 0.04, 1.4, yn);
  const fx = x + f.nx * 1.0, fz = z + f.nz * 1.0, y0 = y + 2.75;
  for (let k = 0; k < 7; k++) B.color(k % 2 ? '#f2f0ea' : '#b22234').box(fx, y0 + k * 0.1, fz, 0.012, 0.1, 0.9, yn);   // (the stripes)
  B.color('#3c3b6e').box(fx - f.nx * 0.27, y0 + 0.35, fz - f.nz * 0.27, 0.016, 0.35, 0.36, yn);   // (the canton, at the pole)
}

/** Furniture along `fronts` (shop walls on a sidewalk `walkW` m wide). Returns how many pieces it set. */
export function villageFurniture(B, fronts, walkW, seed, { flags = true, spots = null } = {}) {
  let n = 0;
  for (const f of fronts) {
    const W = f.walk ?? walkW;   // (the front's own sidewalk when it knows it)
    if (f.base == null || !(W >= 1.4)) continue;
    const yn = Math.atan2(f.nx, f.nz), kerb = Math.min(W - 0.45, Math.max(0.9, W * 0.78));   // (the street side of the walk)
    const step = 9 + 4 * hash(seed + f.i);
    for (let u = 2.5 + 3 * hash(seed * 3 + f.i); u < f.len - 1.5; u += step) {
      const k = seed * 131 + f.i * 17 + Math.round(u), r = hash(k);
      const x = f.a.x + f.tx * u + f.nx * kerb, z = f.a.z + f.tz * u + f.nz * kerb, y = f.base;
      if (r < 0.3) {
        bench(B, x - f.nx * 0.2, y, z - f.nz * 0.2, f, yn);
        // someone sitting on about half of them (two on some), facing the street
        if (spots && hash(k * 1.7) < .5) for (const u2 of hash(k * 2.3) < .3 ? [-.45, .45] : [(hash(k) - .5) * .8]) spots.push({ x: x - f.nx * .22 + f.tx * u2, z: z - f.nz * .22 + f.tz * u2, y: y - .08, yaw: yn, kind: 'sit' });
      }
      else if (r < 0.62) barrel(B, x, y, z, k);
      else if (r < 0.74) rack(B, x, y, z, f, yn);
      else if (r < 0.84) bin(B, x, y, z);
      else continue;
      n++;
    }
    // a flag on a bracket from the building on about half the fronts (village main streets fly them all summer)
    if (flags && hash(seed * 7 + f.i) < 0.5 && f.len > 6) { flag(B, f.a.x + f.tx * f.len * 0.5, f.base, f.a.z + f.tz * f.len * 0.5, f, yn); n++; }
  }
  return n;
}
