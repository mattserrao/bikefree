// Regional style-C landforms. These are authored interpretations around the
// actual GPX, with explicit lakes, rivers, peaks, cliffs and bridge ranges.
import { makeRouteIndex } from './geo.js';
import { smoothstep, ROAD_CORRIDOR_M } from './coast.js';

function nearestSegment(points, x, z) {
  let best = null, distance = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1], dx = b.x - a.x, dz = b.z - a.z;
    const f = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    const px = a.x + dx * f, pz = a.z + dz * f, d = Math.hypot(x - px, z - pz);
    if (d < distance) { distance = d; best = { d, i, f, x: px, z: pz, y: a.y + (b.y - a.y) * f, s: (a.s || 0) + Math.hypot(dx, dz) * f }; }
  }
  return best;
}

export function makeRegionalLandscape(config, proj, index, route) {
  const end = route.turnIdx || route.dist.length - 1;
  const samples = Array.from({ length: Math.ceil(end / 6) }, (_, i) => i * 6);
  const broad = makeRouteIndex({ dist: samples, lat: samples.map((i) => route.lat[i]),
    lon: samples.map((i) => route.lon[i]), ele: samples.map((i) => route.ele[i]) }, proj, 256);
  const floor = config.baseElevationM ?? route.minEle - 12;
  const coastSide = config.oceanSide === 'east' ? -1 : 1;
  const hasOcean = !!config.coastline || config.biome === 'tropical';
  const minZ = Math.min(...index.zs), maxZ = Math.max(...index.zs), minX = Math.min(...index.xs);
  const coast = (config.coastline || []).map(([lat, lon]) => proj.toLocal(lat, lon)).sort((a, b) => a.z - b.z);
  if (!coast.length) coast.push({ x: minX - 22000, z: minZ - 12000 }, { x: minX - 22000, z: maxZ + 12000 });
  const coastX = (z) => {
    let i = 0; while (i < coast.length - 2 && coast[i + 1].z < z) i++;
    const a = coast[i], b = coast[i + 1], f = Math.max(0, Math.min(1, (z - a.z) / (b.z - a.z)));
    return a.x + (b.x - a.x) * f + (config.coastline ? Math.sin(z / 290) * 17 + Math.sin(z / 83) * 4 : 0);
  };
  const inlandAt = (x, z) => (x - coastX(z)) * coastSide;
  const lakes = (config.lakes || []).map((l) => {
    const p = proj.toLocal(l.lat, l.lon), rx = l.radiusM[0], rz = l.radiusM[1];
    let nearbyRoad = Infinity;
    for (let i = 0; i <= end; i += 5) if (Math.hypot((index.xs[i] - p.x) / rx, (index.zs[i] - p.z) / rz) < 1.35) nearbyRoad = Math.min(nearbyRoad, route.ele[i]);
    return { ...l, ...p, rx, rz, level: Math.min(l.elevationM, nearbyRoad - 2) };
  });
  const islands = (config.islands || []).map((l) => ({ ...l, ...proj.toLocal(l.lat, l.lon), rx: l.radiusM[0], rz: l.radiusM[1] }));
  const formations = (config.formations || []).map((f) => ({ ...f, ...proj.toLocal(f.lat, f.lon),
    rx: f.radiusM[0], rz: f.radiusM[1] }));
  const valley = config.valley ? config.valley.axis.map(([lat, lon]) => proj.toLocal(lat, lon)) : null;
  const valleyDirection = valley ? { x: valley[1].x - valley[0].x, z: valley[1].z - valley[0].z } : null;
  const valleyLength = valley ? Math.hypot(valleyDirection.x, valleyDirection.z) : 1;
  const formationHeight = (f, x, z) => {
    const nx = (x - f.x) / f.rx, nz = (z - f.z) / f.rz;
    const rough = f.shape === 'dome' || f.shape === 'half-dome' ? 1 : 1 + Math.sin(Math.atan2(nz, nx) * 7) * .065;
    const r = Math.hypot(nx, nz) * rough;
    if (r >= 1) return 0;
    let shape = f.shape === 'peak' ? Math.pow(1 - r, .85) : Math.pow(1 - r * r, f.shape === 'mesa' ? .16 : .5);
    if (f.shape === 'half-dome') shape *= 1 - smoothstep(.05, .3, -nx);
    return f.heightM * shape;
  };
  const baseHeight = (x, z) => {
    if (config.biome === 'tropical') {
      let h = -8;
      for (const l of islands) { const r = Math.hypot((x - l.x) / l.rx, (z - l.z) / l.rz); if (r < 1.15) h = Math.max(h, -8 + (l.heightM + 7) * Math.pow(Math.max(0, 1 - (r / 1.15) ** 2), .6)); }
      return h;
    }
    let h = floor + (Math.sin(x / 420 + Math.cos(z / 710)) * .55 + Math.sin(z / 280) * .25) * (config.reliefM || 30);
    if (config.coastline) {
      const inland = inlandAt(x, z);
      if (inland < 0) return -8;
      h = floor + inland * .035 + (25 + Math.sin(z / 380 + x / 620) * 22) * smoothstep(0, 220, inland);
    }
    if (valley) {
      const cross = Math.abs((x - valley[0].x) * -valleyDirection.z + (z - valley[0].z) * valleyDirection.x) / valleyLength;
      h += (config.valley.heightM || 650) * Math.pow(smoothstep(config.valley.widthM, config.valley.widthM + 600, cross), .45);
    }
    for (const f of formations) if (!f.island) h += formationHeight(f, x, z);
    return h;
  };
  const rivers = (config.rivers || []).map((r) => {
    const points = r.path.map(([lat, lon, elevation]) => {
      const p = proj.toLocal(lat, lon), hit = broad.nearest(p.x, p.z, 2400);
      return { ...p, y: elevation ?? (hit ? route.ele[samples[hit.i]] : floor + 8) - (r.depthM || 7) };
    });
    const distance = [0];
    for (let i = 1; i < points.length; i++) distance.push(distance.at(-1) + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
    points.forEach((p, i) => { p.s = distance[i]; });
    const at = (s) => {
      let i = 0; while (i < points.length - 2 && distance[i + 1] < s) i++;
      const a = points[i], b = points[i + 1], f = Math.max(0, Math.min(1, (s - distance[i]) / (distance[i + 1] - distance[i])));
      return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, y: a.y + (b.y - a.y) * f };
    };
    const waterAt = (s) => {
      const p = at(s), hit = broad.nearest(p.x, p.z, 500);
      return Math.min(p.y, hit ? route.ele[samples[hit.i]] - 6 : Infinity);
    };
    return { name: r.name, width: r.widthM || 12, points, start: 0, mouth: distance.at(-1), positionAt: at, waterAt };
  });
  const landmarks = [];
  const addBridge = (b, s) => {
    const i = Math.max(0, Math.min(end - 1, Math.floor(s / 10))), j = Math.min(end, i + 5), a = Math.max(0, i - 5);
    const dx = index.xs[j] - index.xs[a], dz = index.zs[j] - index.zs[a], len = Math.hypot(dx, dz) || 1;
    landmarks.push({ ...b, x: index.xs[i], z: index.zs[i], y: route.ele[i], s: route.dist[i], fx: dx / len, fz: dz / len,
      slope: (route.ele[j] - route.ele[a]) / len, asset: b.asset || 'viaduct', assetSpanM: b.asset === 'bridge' ? 218 : 192, assetDepthM: b.asset === 'bridge' ? 65 : 8 });
  };
  for (const b of config.landmarks || []) {
    let nearest = 0, d = Infinity;
    const p = proj.toLocal(b.lat, b.lon);
    for (let i = 0; i <= end; i++) { const a = Math.hypot(index.xs[i] - p.x, index.zs[i] - p.z); if (a < d) { nearest = i; d = a; } }
    addBridge(b, route.dist[nearest]);
  }
  const bridgeRanges = (config.bridgeRanges || []).map((b) => ({ ...b, toM: Math.min(b.toM, route.turnS || route.total) }));
  for (const b of bridgeRanges) for (let s = b.fromM; s < b.toM; s += 192) {
    const span = Math.min(192, b.toM - s);
    addBridge({ name: b.name, asset: 'viaduct', span, depth: b.depthM || 8, lateralM: b.lateralM || 0 }, s + span / 2);
  }
  // Add short, fitted bridge decks where a river actually crosses the GPX.
  for (const river of rivers) {
    let first = null;
    for (let i = 0; i <= end + 1; i++) {
      const hit = i <= end ? nearestSegment(river.points, index.xs[i], index.zs[i]) : null;
      const wet = hit && hit.d < river.width / 2 + 5;
      if (wet && first === null) first = i;
      if (!wet && first !== null) {
        const last = i - 1, span = route.dist[last] - route.dist[first] + 30;
        if (span < 320) {
          const middle = Math.floor((first + last) / 2), water = river.waterAt(nearestSegment(river.points, index.xs[middle], index.zs[middle]).s);
          addBridge({ name: `${river.name} crossing`, asset: 'viaduct', span: Math.max(34, span), depth: Math.max(8, route.ele[middle] - water + 2) }, route.dist[middle]);
        }
        first = null;
      }
    }
  }
  const bridgeAt = (x, z, margin = 0) => {
    for (const b of landmarks) {
      if (b.lateralM) continue;
      if (Math.abs((x - b.x) * b.fx + (z - b.z) * b.fz) < b.span / 2 + margin
        && Math.abs((x - b.x) * -b.fz + (z - b.z) * b.fx) < 26) return b;
    }
    return null;
  };
  // 1 on a bridge deck, easing to 0 over its last 12 m at each end: the ground meets the road where the deck starts
  const bridgeWeight = (x, z) => {
    let w = 0;
    for (const b of landmarks) {
      if (b.lateralM) continue;
      const along = Math.abs((x - b.x) * b.fx + (z - b.z) * b.fz), across = Math.abs((x - b.x) * -b.fz + (z - b.z) * b.fx);
      w = Math.max(w, smoothstep(b.span / 2 + 1, b.span / 2 - 11, along) * (1 - smoothstep(26, 38, across)));
    }
    return w;
  };
  const creekAt = (x, z) => rivers.find((r) => nearestSegment(r.points, x, z).d < r.width / 2 + 1);
  const waterLevelAt = (x, z) => {
    let y = hasOcean ? .05 : -Infinity;
    for (const l of lakes) if (Math.hypot((x - l.x) / l.rx, (z - l.z) / l.rz) < 1) y = Math.max(y, l.level);
    for (const r of rivers) { const hit = nearestSegment(r.points, x, z); if (hit.d < r.width / 2) y = Math.max(y, r.waterAt(hit.s)); }
    return y;
  };
  const heightAt = (x, z) => {
    let h = baseHeight(x, z);
    const near = broad.nearest(x, z, 1400);
    if (near && config.biome !== 'tropical') {
      const i = samples[near.i], correction = route.ele[i] - 2 - baseHeight(index.xs[i], index.zs[i]);
      h += correction * (1 - smoothstep(100, 1400, near.d));
    }
    for (const l of lakes) {
      const r = Math.hypot((x - l.x) / l.rx, (z - l.z) / l.rz);
      h += (Math.min(h, l.level - 15) - h) * (1 - smoothstep(.95, 1.3, r));
    }
    for (const f of formations) if (f.island) h = Math.max(h, (lakes[0]?.level || floor) - 5 + formationHeight(f, x, z));
    const road = index.nearest(x, z, 110);
    const bw = road ? bridgeWeight(index.xs[road.i], index.zs[road.i]) : 0;
    if (road) {
      // off a bridge: grade the verge to the road; on a bridge: only keep the ground below the deck
      const fill = h + (route.ele[road.i] - .65 - h) * (1 - smoothstep(22, 110, road.d));
      h = fill * (1 - bw) + Math.min(h, route.ele[road.i] - 1.5) * bw;
    }
    // Rivers: banks wide enough for the 6 m ground mesh to follow; beside the road (off a bridge) the
    // channel eases out over 12–30 m instead of stopping dead at 10 m, which left a cliff at the verge.
    const nearRoad = road ? (1 - bw) * (1 - smoothstep(12, 30, road.d)) : 0;
    for (const r of rivers) {
      const hit = nearestSegment(r.points, x, z), factor = (1 - smoothstep(r.width / 2, r.width / 2 + 14, hit.d)) * (1 - nearRoad);
      if (factor > 0) h += (Math.min(h, r.waterAt(hit.s) - .6) - h) * factor;
    }
    // Never above the road (see coast.js)
    if (road) h = Math.min(h, route.ele[road.i] - .65 + Math.max(0, road.d - ROAD_CORRIDOR_M));
    return h;
  };
  const colorAt = (x, z) => {
    for (const f of formations) if (f.color && formationHeight(f, x, z) > f.heightM * .45) return f.color;
    return null;
  };
  return { kind: config.biome, coastSide, hasOcean, coast, coastX, inlandAt, lakes, waterIslands: islands,
    landmarks, creeks: rivers, creekAt, heightAt, baseHeight, bridgeAt, waterLevelAt, colorAt,
    isWater: (x, z, height) => height < waterLevelAt(x, z) + .4 };
}
