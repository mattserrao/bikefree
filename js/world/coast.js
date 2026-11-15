// Deterministic authored landscape. GPX controls the road; this is an artistic
// coastal landform, not a replacement for surveyed terrain/elevation data.
import { makeRouteIndex } from './geo.js';
export const smoothstep = (a, b, v) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function randomSequence(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = (t + Math.imul(t ^ t >>> 7, 61 | t)) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function makeCoastLandscape(config, proj, index, route) {
  const sampled = Array.from({ length: Math.ceil((route.turnIdx || route.dist.length) / 5) }, (_, i) => i * 5);
  const broadRoute = { dist: sampled, lat: sampled.map((i) => route.lat[i]), lon: sampled.map((i) => route.lon[i]), ele: sampled.map((i) => route.ele[i]) };
  const broadIndex = makeRouteIndex(broadRoute, proj, 256);
  const coast = config.coastline.map(([lat, lon]) => proj.toLocal(lat, lon)).sort((a, b) => a.z - b.z);
  const coastX = (z) => {
    let i = 0;
    while (i < coast.length - 2 && coast[i + 1].z < z) i++;
    const a = coast[i], b = coast[i + 1];
    const f = Math.max(0, Math.min(1, (z - a.z) / (b.z - a.z)));
    return a.x + (b.x - a.x) * f + Math.sin(z / 290) * 17 + Math.sin(z / 83) * 4;
  };
  const landmarks = config.landmarks.map((landmark) => {
    const point = proj.toLocal(landmark.lat, landmark.lon);
    const end = route.turnIdx || route.dist.length - 1;
    let i = 0, best = Infinity;
    for (let j = 0; j < end; j++) {
      const d = Math.hypot(index.xs[j] - point.x, index.zs[j] - point.z);
      if (d < best) { best = d; i = j; }
    }
    const a = Math.max(0, i - 8), b = Math.min(end, i + 8);
    const dx = index.xs[b] - index.xs[a], dz = index.zs[b] - index.zs[a];
    const len = Math.hypot(dx, dz);
    return { ...landmark, x: index.xs[i], z: index.zs[i], y: route.ele[i], s: route.dist[i],
      fx: dx / len, fz: dz / len, slope: (route.ele[b] - route.ele[a]) / len };
  });
  const bridgeAt = (x, z, margin = 0) => landmarks.find((b) => b.asset === 'bridge'
    && Math.abs((x - b.x) * b.fx + (z - b.z) * b.fz) < b.span / 2 + margin
    && Math.abs((x - b.x) * -b.fz + (z - b.z) * b.fx) < 28);
  const baseHeight = (x, z) => {
    const inland = x - coastX(z);
    if (inland < 0) return -10 + Math.max(-30, inland * .1);
    const ridge = Math.sin(z / 770 + inland / 1050) * .5 + Math.sin(z / 317 - inland / 640) * .28;
    const detail = Math.sin(x / 76 + z / 116) * Math.sin(z / 63) * 3;
    return Math.max(0, inland * .22 + (28 + ridge * 47) * smoothstep(0, 180, inland)
      + Math.sin(inland / 780) ** 2 * 95 * smoothstep(100, 1100, inland) + detail * smoothstep(0, 30, inland));
  };
  const heightAt = (x, z) => {
    let h = baseHeight(x, z);
    const inland = x - coastX(z);
    if (inland < 0) return h;
    const broad = broadIndex.nearest(x, z, 900);
    if (broad) {
      const i = sampled[broad.i];
      const correction = route.ele[i] - baseHeight(index.xs[i], index.zs[i]);
      h += correction * (1 - smoothstep(80, 900, broad.d)) * smoothstep(0, 140, inland);
    }
    const hit = index.nearest(x, z, 110);
    if (hit && !bridgeAt(x, z, 6)) {
      const road = route.ele[hit.i] - .65;
      // Wide, gently graded verge prevents triangles from crossing the narrow road.
      h += (road - h) * (1 - smoothstep(20, 110, hit.d));
    }
    for (const b of landmarks) {
      if (b.asset !== 'bridge') continue;
      const along = (x - b.x) * b.fx + (z - b.z) * b.fz;
      const across = (x - b.x) * -b.fz + (z - b.z) * b.fx;
      const canyon = 1 - smoothstep(b.span * .25, b.span * .55, Math.abs(along));
      const reach = 1 - smoothstep(450, 1300, Math.abs(across));
      h = h * (1 - canyon * reach) + Math.min(h, Math.max(2, b.y - b.depth - 4)) * canyon * reach;
    }
    return Math.max(.3, h);
  };
  return { coast, coastX, landmarks, heightAt, baseHeight, bridgeAt };
}
