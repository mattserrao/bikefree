// Deterministic authored landscape. GPX controls the road; this is an artistic
// coastal landform, not a replacement for surveyed terrain/elevation data.
import { makeRouteIndex } from '../core/geo.js';
import { smoothstep, ROAD_CORRIDOR_M } from '../core/random.js';

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
  // 1 on a bridge, easing to 0 over the last 12 m of deck at each end (and 28–40 m to the side), so the
  // ground meets the road right where the deck starts
  const bridgeWeight = (x, z) => {
    let w = 0;
    for (const b of landmarks) {
      if (b.asset !== 'bridge') continue;
      const along = Math.abs((x - b.x) * b.fx + (z - b.z) * b.fz), across = Math.abs((x - b.x) * -b.fz + (z - b.z) * b.fx);
      w = Math.max(w, smoothstep(b.span / 2 + 1, b.span / 2 - 11, along) * (1 - smoothstep(28, 40, across)));
    }
    return w;
  };
  const bridgeAt = (x, z, margin = 0) => landmarks.find((b) => b.asset === 'bridge'
    && Math.abs((x - b.x) * b.fx + (z - b.z) * b.fz) < b.span / 2 + margin
    && Math.abs((x - b.x) * -b.fz + (z - b.z) * b.fx) < 28);
  const creeks = landmarks.filter((b) => b.creekWidthM > 0).map((b) => {
    const positionAt = (t) => {
      const meander = Math.sin(t / 65) * 7 + Math.sin(t / 24) * 1.4;
      return { x: b.x - b.fz * t + b.fx * meander, z: b.z + b.fx * t + b.fz * meander };
    };
    let mouth = 20;
    while (mouth < 1800) { const p = positionAt(mouth); if (p.x < coastX(p.z)) break; mouth += 5; }
    const waterAt = (t) => .13 + Math.max(3, b.y - b.depth - 4) * (1 - smoothstep(-60, mouth, t));
    return { bridge: b, width: b.creekWidthM, mouth, start: -420, positionAt, waterAt };
  });
  const creekAt = (x, z) => creeks.find((c) => {
    const b = c.bridge, t = (x - b.x) * -b.fz + (z - b.z) * b.fx;
    if (t < c.start || t > c.mouth) return false;
    const along = (x - b.x) * b.fx + (z - b.z) * b.fz;
    return Math.abs(along - Math.sin(t / 65) * 7 - Math.sin(t / 24) * 1.4) < c.width / 2 + 1;
  });
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
    if (hit) {
      const road = route.ele[hit.i] - .65;
      // Wide, gently graded verge prevents triangles from crossing the narrow road. It fades out
      // over the bridge ends (instead of switching off) so the abutments don't leave a step.
      h += (road - h) * (1 - smoothstep(20, 110, hit.d)) * (1 - bridgeWeight(x, z));
    }
    for (const b of landmarks) {
      if (b.asset !== 'bridge') continue;
      const along = (x - b.x) * b.fx + (z - b.z) * b.fz;
      const across = (x - b.x) * -b.fz + (z - b.z) * b.fx;
      const canyon = 1 - smoothstep(b.span * .25, b.span * .55, Math.abs(along));
      const reach = 1 - smoothstep(450, 1300, Math.abs(across));
      h = h * (1 - canyon * reach) + Math.min(h, Math.max(2, b.y - b.depth - 4)) * canyon * reach;
    }
    for (const creek of creeks) {
      const b = creek.bridge;
      const t = (x - b.x) * -b.fz + (z - b.z) * b.fx;
      if (t < creek.start - 20 || t > creek.mouth + 15) continue;
      const along = (x - b.x) * b.fx + (z - b.z) * b.fz;
      const meander = Math.sin(t / 65) * 7 + Math.sin(t / 24) * 1.4;
      const channel = 1 - smoothstep(creek.width / 2, creek.width / 2 + 5, Math.abs(along - meander));
      const blend = smoothstep(creek.start - 20, creek.start + 20, t);
      h += (Math.min(h, creek.waterAt(t) - .5) - h) * channel * blend;
    }
    // Never above the road: the ground stays under the road surface across the whole corridor and rises
    // no steeper than 1:1 beside it (bridge abutments, canyon edges).
    if (hit) h = Math.min(h, route.ele[hit.i] - .65 + Math.max(0, hit.d - ROAD_CORRIDOR_M));
    return Math.max(-.5, h);
  };
  return { coast, coastX, landmarks, creeks, creekAt, heightAt, baseHeight, bridgeAt };
}
