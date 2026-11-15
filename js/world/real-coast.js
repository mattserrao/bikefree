// Real coastal landform for the stylized renderer (the Big Sur hero map): the ground is the real
// elevation around the route (tools/build_terrain_grid.py → "bikefree-terrain-1"), with the GPX road
// pressed into it, bridges over the real gorges, creeks traced down the real valley floors, and the
// shoreline (a signed distance to the sea) for surf, cliffs and planting.
// Pure functions — no three.js — so the QC sweep and tests can use it in Node.
import { smoothstep } from './coast.js';

const decodeRows = (text, rowLength) => {
  const bin = typeof atob === 'function' ? atob(text) : Buffer.from(text, 'base64').toString('binary');
  const out = new Uint16Array(bin.length / 2);
  for (let k = 0, acc = 0; k < out.length; k++) {
    if (k % rowLength === 0) acc = 0;
    acc = (acc + (bin.charCodeAt(2 * k) | (bin.charCodeAt(2 * k + 1) << 8))) & 0xffff;
    out[k] = acc;
  }
  return out;
};

/** Decode once per data object (shared by the landscape, the renderer and the QC sweep). */
export function decodeTerrain(data, proj) {
  if (data._decoded?.proj === proj) return data._decoded;
  if (data.format !== 'bikefree-terrain-1') throw new Error('Unsupported terrain data');
  const nw = proj.toLocal(data.north, data.west), se = proj.toLocal(data.south, data.east);
  const { base, scale } = data, C = data.coarse, F = data.fine, B = F.block, R = B + 1;
  const coarse = decodeRows(C.h, C.nx);
  const fine = decodeRows(F.h, R);
  const slot = new Int32Array(F.bnx * F.bny).fill(-1);
  F.blocks.forEach((b, k) => { slot[b] = k; });
  const sx = (F.nx - 1) / (se.x - nw.x), sz = (F.ny - 1) / (se.z - nw.z);   // fine cells per metre
  const coarseAt = (x, z) => {
    let u = (x - nw.x) * sx / C.step, v = (z - nw.z) * sz / C.step;
    u = Math.max(0, Math.min(C.nx - 1.001, u)); v = Math.max(0, Math.min(C.ny - 1.001, v));
    const i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j, n = C.nx, k = j * n + i;
    return base + scale * ((coarse[k] * (1 - a) + coarse[k + 1] * a) * (1 - b) + (coarse[k + n] * (1 - a) + coarse[k + n + 1] * a) * b);
  };
  const at = (x, z) => {
    const u = (x - nw.x) * sx, v = (z - nw.z) * sz;
    if (u >= 0 && v >= 0) {
      const bi = Math.floor(u / B), bj = Math.floor(v / B);
      if (bi < F.bnx && bj < F.bny) {
        const s = slot[bj * F.bnx + bi];
        if (s >= 0) {
          const lu = u - bi * B, lv = v - bj * B, i = Math.min(B - 1, Math.floor(lu)), j = Math.min(B - 1, Math.floor(lv));
          const a = lu - i, b = lv - j, k = s * R * R + j * R + i;
          return base + scale * ((fine[k] * (1 - a) + fine[k + 1] * a) * (1 - b) + (fine[k + R] * (1 - a) + fine[k + R + 1] * a) * b);
        }
      }
    }
    return coarseAt(x, z);
  };
  const decoded = { proj, at, coarseAt, x0: nw.x, z0: nw.z, x1: se.x, z1: se.z };
  Object.defineProperty(data, '_decoded', { value: decoded, enumerable: false, configurable: true });
  return decoded;
}

/** Signed distance to the shoreline (land +, sea −) on a raster, by a two-pass chamfer transform. */
function makeShoreField(at, x0, z0, x1, z1, cell) {
  const nx = Math.ceil((x1 - x0) / cell) + 1, nz = Math.ceil((z1 - z0) / cell) + 1;
  const land = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) land[j * nx + i] = at(x0 + i * cell, z0 + j * cell) >= 0 ? 1 : 0;
  const BIG = 1e9;
  const pass = (inside) => {
    const d = new Float32Array(nx * nz);
    for (let k = 0; k < d.length; k++) d[k] = land[k] === inside ? BIG : 0;
    const a = cell, b = cell * Math.SQRT2;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i; let v = d[k]; if (!v) continue;
      if (i > 0) v = Math.min(v, d[k - 1] + a);
      if (j > 0) { v = Math.min(v, d[k - nx] + a); if (i > 0) v = Math.min(v, d[k - nx - 1] + b); if (i < nx - 1) v = Math.min(v, d[k - nx + 1] + b); }
      d[k] = v;
    }
    for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i; let v = d[k]; if (!v) continue;
      if (i < nx - 1) v = Math.min(v, d[k + 1] + a);
      if (j < nz - 1) { v = Math.min(v, d[k + nx] + a); if (i < nx - 1) v = Math.min(v, d[k + nx + 1] + b); if (i > 0) v = Math.min(v, d[k + nx - 1] + b); }
      d[k] = v;
    }
    return d;
  };
  const toSea = pass(1), toLand = pass(0);
  const field = new Float32Array(nx * nz);
  // half a cell either side of the boundary between a land and a sea sample
  for (let k = 0; k < field.length; k++) field[k] = land[k] ? toSea[k] - cell / 2 : -(toLand[k] - cell / 2);
  const sample = (x, z) => {
    let u = (x - x0) / cell, v = (z - z0) / cell;
    if (u < 0 || v < 0 || u > nx - 1 || v > nz - 1) return null;
    u = Math.min(nx - 1.001, u); v = Math.min(nz - 1.001, v);
    const i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j, k = j * nx + i;
    return (field[k] * (1 - a) + field[k + 1] * a) * (1 - b) + (field[k + nx] * (1 - a) + field[k + nx + 1] * a) * b;
  };
  return { nx, nz, x0, z0, cell, field, sample };
}

/** Nearest point on a polyline (with cumulative distance `s` on each point). */
function nearestOnLine(points, x, z) {
  let best = null, bd = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1], dx = b.x - a.x, dz = b.z - a.z;
    const f = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    const px = a.x + dx * f, pz = a.z + dz * f, d = Math.hypot(x - px, z - pz);
    if (d < bd) { bd = d; best = { d, i, f, s: a.s + (b.s - a.s) * f }; }
  }
  return best;
}

export function makeRealCoastLandscape(config, proj, index, route) {
  const T = decodeTerrain(config.terrainGrid, proj);
  const end = route.turnIdx || route.dist.length - 1;
  const outbound = (i) => (i > end ? Math.max(0, 2 * end - i) : i);
  // Road height at (x, z) projected onto the route segment next to sample i (not a 10 m staircase).
  const roadEle = (i, x, z) => {
    i = outbound(i);
    const j = i < end && (i === 0 || (x - index.xs[i]) * (index.xs[i + 1] - index.xs[i]) + (z - index.zs[i]) * (index.zs[i + 1] - index.zs[i]) > 0) ? i + 1 : i - 1;
    const dx = index.xs[j] - index.xs[i], dz = index.zs[j] - index.zs[i], l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - index.xs[i]) * dx + (z - index.zs[i]) * dz) / l2));
    return route.ele[i] + (route.ele[j] - route.ele[i]) * t;
  };

  // ---- Bridges: spans of the road over real gorges ----
  const frameAt = (s) => {
    const i = Math.min(end - 1, Math.max(0, Math.floor(s / 10))), j = i + 1;
    const f = Math.max(0, Math.min(1, (s - route.dist[i]) / (route.dist[j] - route.dist[i] || 1)));
    const dx = index.xs[j] - index.xs[i], dz = index.zs[j] - index.zs[i], l = Math.hypot(dx, dz) || 1;
    return { x: index.xs[i] + dx * f, z: index.zs[i] + dz * f, y: route.ele[i] + (route.ele[j] - route.ele[i]) * f, fx: dx / l, fz: dz / l };
  };
  const bridges = (config.bridges || []).map((b) => {
    const mid = frameAt((b.fromM + b.toM) / 2);
    let floorY = Infinity;
    for (let s = b.fromM; s <= b.toM; s += 4) { const p = frameAt(s); floorY = Math.min(floorY, T.at(p.x, p.z)); }
    return { ...b, ...mid, s: (b.fromM + b.toM) / 2, span: b.toM - b.fromM, depth: mid.y - floorY, floorY,
      asset: 'arch-bridge', slope: 0 };
  });
  const spanWeight = (s) => {
    let w = 0;
    // the carve-out fades over the last 12 m of deck, so the abutments meet the ground
    for (const b of bridges) w = Math.max(w, smoothstep(b.fromM - 2, b.fromM + 12, s) * (1 - smoothstep(b.toM - 12, b.toM + 2, s)));
    return w;
  };
  const bridgeOfS = (s, margin = 0) => bridges.find((b) => s > b.fromM - margin && s < b.toM + margin);
  const bridgeAt = (x, z, margin = 0) => {
    const hit = index.nearest(x, z, 30);
    return hit ? bridgeOfS(route.dist[outbound(hit.i)], margin) || null : null;
  };

  // ---- Creeks: traced down (and up) the real valley floor from the deepest point under each bridge ----
  const trace = (x, z, dir, length, downhill) => {
    const pts = [{ x, z }];
    let px = x, pz = z, ax = dir.x, az = dir.z;
    for (let walked = 0; walked < length; walked += 12) {
      let best = null;
      for (let k = -6; k <= 6; k++) {
        const a = Math.atan2(az, ax) + k * Math.PI / 18, cx = px + Math.cos(a) * 12, cz = pz + Math.sin(a) * 12;
        const h = T.at(cx, cz) + Math.abs(k) * .05;
        if (!best || h < best.h) best = { x: cx, z: cz, h };
      }
      ax = best.x - px; az = best.z - pz; const l = Math.hypot(ax, az); ax /= l; az /= l;
      px = best.x; pz = best.z; pts.push({ x: px, z: pz });
      if (downhill && best.h < -.5) break;
    }
    return pts;
  };
  const creeks = [];
  for (const b of bridges) {
    if (!b.creek) continue;
    let low = null;
    for (let s = b.fromM; s <= b.toM; s += 3) { const p = frameAt(s); const h = T.at(p.x, p.z); if (!low || h < low.h) low = { ...p, h }; }
    // downstream: whichever side of the road the ground falls away to
    const rx = -low.fz, rz = low.fx, side = T.at(low.x + rx * 40, low.z + rz * 40) < T.at(low.x - rx * 40, low.z - rz * 40) ? 1 : -1;
    const down = trace(low.x, low.z, { x: rx * side, z: rz * side }, 1600, true);
    const up = trace(low.x, low.z, { x: -rx * side, z: -rz * side }, b.creek.upstreamM || 450, false);
    const pts = [...up.reverse(), ...down.slice(1)];
    // smooth the path, measure it, and give it a water level that only ever falls downstream
    for (let pass = 0; pass < 3; pass++) for (let k = 1; k < pts.length - 1; k++) {
      pts[k] = { x: (pts[k - 1].x + pts[k].x * 2 + pts[k + 1].x) / 4, z: (pts[k - 1].z + pts[k].z * 2 + pts[k + 1].z) / 4 };
    }
    let s = 0;
    pts.forEach((p, k) => { if (k) s += Math.hypot(p.x - pts[k - 1].x, p.z - pts[k - 1].z); p.s = s; });
    const levels = pts.map((p) => T.at(p.x, p.z));
    for (let k = 1; k < levels.length; k++) levels[k] = Math.min(levels[k], levels[k - 1] - .02);
    const mouthIdx = levels.findIndex((h) => h < .4);
    const last = mouthIdx > 0 ? mouthIdx : pts.length - 1;
    for (let k = 0; k <= last; k++) pts[k].y = Math.max(.13, levels[k] + .25);
    const ptsCut = pts.slice(0, last + 1);
    const bridgeS = ptsCut[up.length - 1].s;
    for (const p of ptsCut) p.s -= bridgeS;   // t = 0 under the bridge, upstream negative
    const at = (t) => {
      let k = 0; while (k < ptsCut.length - 2 && ptsCut[k + 1].s < t) k++;
      const a = ptsCut[k], c = ptsCut[k + 1], f = Math.max(0, Math.min(1, (t - a.s) / (c.s - a.s || 1)));
      return { x: a.x + (c.x - a.x) * f, z: a.z + (c.z - a.z) * f, y: a.y + (c.y - a.y) * f };
    };
    const xs = ptsCut.map((p) => p.x), zs = ptsCut.map((p) => p.z), width = b.creek.widthM || 4;
    creeks.push({ name: b.creek.name, bridge: b, width, points: ptsCut, start: ptsCut[0].s, mouth: ptsCut.at(-1).s,
      positionAt: (t) => at(t), waterAt: (t) => at(t).y,
      box: [Math.min(...xs) - 20, Math.min(...zs) - 20, Math.max(...xs) + 20, Math.max(...zs) + 20] });
  }
  const creekHit = (x, z, pad) => {
    for (const c of creeks) {
      if (x < c.box[0] || z < c.box[1] || x > c.box[2] || z > c.box[3]) continue;
      const hit = nearestOnLine(c.points, x, z);
      if (hit && hit.d < c.width / 2 + pad) return { creek: c, hit };
    }
    return null;
  };
  const creekAt = (x, z) => creekHit(x, z, 1)?.creek || null;

  // ---- Shoreline field around the route ----
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i <= end; i++) { minX = Math.min(minX, index.xs[i]); maxX = Math.max(maxX, index.xs[i]); minZ = Math.min(minZ, index.zs[i]); maxZ = Math.max(maxZ, index.zs[i]); }
  const pad = config.shorePadM ?? 3500;
  const shore = makeShoreField(T.at, Math.max(T.x0, minX - pad), Math.max(T.z0, minZ - pad), Math.min(T.x1, maxX + pad), Math.min(T.z1, maxZ + pad), config.shoreCellM ?? 16);
  const inlandAt = (x, z) => shore.sample(x, z) ?? (T.at(x, z) >= 0 ? 4000 : -4000);

  // ---- Height ----
  const baseHeight = (x, z) => T.at(x, z);
  const heightAt = (x, z) => {
    let h = T.at(x, z);
    const hit = index.nearest(x, z, 34);
    if (hit) {
      const s = route.dist[outbound(hit.i)], road = roadEle(hit.i, x, z) - .65;
      const pressed = h + (road - h) * (1 - smoothstep(8, 32, hit.d));
      const w = spanWeight(s) * (1 - smoothstep(14, 34, hit.d));
      h = pressed + (Math.min(h, road - 1.5) - pressed) * w;
    }
    const c = creekHit(x, z, 9);
    if (c) {
      const water = c.creek.positionAt(c.hit.s).y;
      const k = 1 - smoothstep(c.creek.width / 2, c.creek.width / 2 + 8, c.hit.d);
      if (!(hit && hit.d < 12 && spanWeight(route.dist[outbound(hit.i)]) < .5)) h += (Math.min(h, water - .5) - h) * k;
    }
    return h;
  };
  const waterLevelAt = (x, z) => {
    const c = creekHit(x, z, 0);
    return c ? c.creek.positionAt(c.hit.s).y : .05;
  };

  return {
    kind: 'real-coast', real: true, hasOcean: true, coastSide: 1,
    // legacy fields (the authored-coast code paths are skipped when `real` is set)
    coast: [{ x: minX - pad, z: minZ - pad }, { x: minX - pad, z: maxZ + pad }], coastX: () => -1e6,
    inlandAt, shore, terrain: T, landmarks: bridges, bridges, creeks, creekAt, heightAt, baseHeight, bridgeAt, bridgeOfS,
    waterLevelAt, frameAt, roadEle, lakes: [], waterIslands: [],
    isWater: (x, z, height) => height < .3 || !!creekHit(x, z, 0),
  };
}
