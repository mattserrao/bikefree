// Real coastal landform for the stylized renderer (the Big Sur hero map): the ground is the real
// elevation around the route (tools/build_terrain_grid.py → "bikefree-terrain-grid-1"), with the GPX road
// pressed into it, bridges over the real gorges, creeks traced down the real valley floors, and the
// shoreline (a signed distance to the sea) for surf, cliffs and planting.
// Pure functions — no three.js — so the QC sweep and tests can use it in Node.
import { smoothstep } from './coast.js';

const ROAD_HALF = 3.5;   // half the road width (pose.js ROAD_WIDTH / 2): overlooks start at the road edge

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
  if (data.format !== 'bikefree-terrain-grid-1') throw new Error('Unsupported terrain data');
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

/** Lakes baked by tools/build_terrain_grid.py in "lakes" mode: a 20 m raster of lake ids, each lake at its own level. */
export function decodeLakes(data, T) {
  const L = data.lakes;
  if (!L) return null;
  const ids = new Uint8Array(L.nx * L.ny);
  for (let r = 0, k = 0; r < L.rle.length; r += 2) { ids.fill(L.rle[r], k, k + L.rle[r + 1]); k += L.rle[r + 1]; }
  const dx = (T.x1 - T.x0) / (L.nx - 1), dz = (T.z1 - T.z0) / (L.ny - 1);
  const list = L.list.map((l) => ({ ...l }));
  const byId = new Map(list.map((l) => [l.id, l]));
  const idAt = (x, z) => {
    const i = Math.round((x - T.x0) / dx), j = Math.round((z - T.z0) / dz);
    return i < 0 || j < 0 || i >= L.nx || j >= L.ny ? 0 : ids[j * L.nx + i];
  };
  return { ids, nx: L.nx, ny: L.ny, dx, dz, x0: T.x0, z0: T.z0, list, byId, idAt, lakeAt: (x, z) => byId.get(idAt(x, z)) || null };
}

export function makeRealCoastLandscape(config, proj, index, route) {
  const T = decodeTerrain(config.terrainGrid, proj);
  // Inland mountains (Going-to-the-Sun): no sea; hydro-flattened lakes at their own levels instead
  const mountain = config.terrain === 'real-mountain';
  const lakes = mountain ? decodeLakes(config.terrainGrid, T) : null;
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
  // a structure that only stands on one side (the Triple Arches carry the valley half of the road): carve that side only
  const sideOf = (i, x, z) => { i = outbound(i); const j = Math.min(end, i + 1), k = Math.max(0, j - 1); const fx = index.xs[j] - index.xs[k], fz = index.zs[j] - index.zs[k]; return Math.sign((x - index.xs[i]) * -fz + (z - index.zs[i]) * fx) || 1; };
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
      if (downhill && (mountain ? !!lakes?.idAt(best.x, best.z) : best.h < -.5)) break;
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
    let pts = [...up.reverse(), ...down.slice(1)];
    // cut out loops (the up- and down-stream traces can double back over each other): overlapping
    // water ribbons flicker
    for (let i = 0; i < pts.length; i++) {
      for (let j = pts.length - 1; j > i + 2; j--) {
        if (Math.hypot(pts[j].x - pts[i].x, pts[j].z - pts[i].z) < 14) { pts = [...pts.slice(0, i + 1), ...pts.slice(j + 1)]; break; }
      }
    }
    const underIdx = pts.reduce((best, p, k) => (Math.hypot(p.x - low.x, p.z - low.z) < Math.hypot(pts[best].x - low.x, pts[best].z - low.z) ? k : best), 0);
    // smooth the path, measure it, and give it a water level that only ever falls downstream
    for (let pass = 0; pass < 3; pass++) for (let k = 1; k < pts.length - 1; k++) {
      pts[k] = { x: (pts[k - 1].x + pts[k].x * 2 + pts[k + 1].x) / 4, z: (pts[k - 1].z + pts[k].z * 2 + pts[k + 1].z) / 4 };
    }
    let s = 0;
    pts.forEach((p, k) => { if (k) s += Math.hypot(p.x - pts[k - 1].x, p.z - pts[k - 1].z); p.s = s; });
    const levels = pts.map((p) => T.at(p.x, p.z));
    for (let k = 1; k < levels.length; k++) levels[k] = Math.min(levels[k], levels[k - 1] - .02);
    const mouthIdx = mountain ? pts.findIndex((p) => lakes?.idAt(p.x, p.z)) : levels.findIndex((h) => h < .4);
    const last = mouthIdx > 0 ? mouthIdx : pts.length - 1;
    for (let k = 0; k <= last; k++) pts[k].y = Math.max(.13, levels[k] + .25);
    const ptsCut = pts.slice(0, last + 1);
    const bridgeS = ptsCut[Math.min(underIdx, ptsCut.length - 1)].s;
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
  // (mountain: the shore of the lakes — positive on land, negative on the water)
  const landAt = mountain ? (x, z) => (lakes?.idAt(x, z) ? -1 : 1) : T.at;
  const shore = makeShoreField(landAt, Math.max(T.x0, minX - pad), Math.max(T.z0, minZ - pad), Math.min(T.x1, maxX + pad), Math.min(T.z1, maxZ + pad), config.shoreCellM ?? 16);
  const inlandAt = (x, z) => shore.sample(x, z) ?? (landAt(x, z) >= 0 ? 4000 : -4000);

  // ---- Overlooks: the ground is levelled under each gravel pad (filled or cut), easing out over 12 m ----
  const pads = (config.lookouts || []).map((l) => {
    const side = l.side === 'inland' ? -1 : 1, w = l.widthM || 10, len = l.lengthM || 32, f = frameAt(l.atM);
    const rx = -f.fz * side, rz = f.fx * side, off = ROAD_HALF + w / 2;
    return { x: f.x + rx * off, z: f.z + rz * off, fx: f.fx, fz: f.fz, hw: w / 2, hl: len / 2, s: l.atM };
  });
  const padAt = (x, z, h) => {
    for (const p of pads) {
      const u = (x - p.x) * p.fx + (z - p.z) * p.fz, v = (x - p.x) * -p.fz + (z - p.z) * p.fx;
      const d = Math.hypot(Math.max(Math.abs(u) - p.hl, 0), Math.max(Math.abs(v) - p.hw, 0));
      // level with the road beside it (the pad follows the road's grade)
      if (d < 12) h += (frameAt(p.s + Math.max(-p.hl, Math.min(p.hl, u))).y - .6 - h) * (1 - smoothstep(0, 12, d));
    }
    return h;
  };

  // ---- Built sites (lodges, visitor centres, parking): level pads easing out over 14 m ----
  const sites = (config.sites || []).map((t) => {
    const p = proj.toLocal(t.lat, t.lon), a = (t.angle ?? 0) * Math.PI / 180;
    const hit = index.nearest(p.x, p.z, 600);
    return { ...t, ...p, ca: Math.cos(a), sa: Math.sin(a), hw: t.widthM / 2, hl: t.lengthM / 2,
      level: t.levelM ?? (t.atRoad && hit ? route.ele[outbound(hit.i)] - .25 : T.at(p.x, p.z)) };
  });
  const siteAt = (x, z, h) => {
    for (const t of sites) {
      const u = (x - t.x) * t.ca + (z - t.z) * t.sa, v = -(x - t.x) * t.sa + (z - t.z) * t.ca;
      const d = Math.hypot(Math.max(Math.abs(u) - t.hl, 0), Math.max(Math.abs(v) - t.hw, 0));
      if (d < 14) h += (t.level - h) * (1 - smoothstep(0, 14, d));
    }
    return h;
  };
  // ---- Islands in the lakes (Wild Goose Island): a low rocky mound ----
  const islands = (config.lakeIslands || []).map((l) => ({ ...l, ...proj.toLocal(l.lat, l.lon), a: (l.angle || 0) * Math.PI / 180 }));
  const islandAt = (x, z, h) => {
    for (const l of islands) {
      const dx = x - l.x, dz = z - l.z, u = dx * Math.cos(l.a) + dz * Math.sin(l.a), v = -dx * Math.sin(l.a) + dz * Math.cos(l.a);
      const r = Math.hypot(u / (l.lengthM / 2), v / (l.widthM / 2));
      if (r < 1.6) h = Math.max(h, (lakes?.lakeAt(l.x, l.z)?.level ?? h) - 3 + (l.heightM + 3) * Math.pow(Math.max(0, 1 - (r / 1.6) ** 2), .55));
    }
    return h;
  };
  const islandHit = (x, z) => islands.some((l) => { const dx = x - l.x, dz = z - l.z; const u = dx * Math.cos(l.a) + dz * Math.sin(l.a), v = -dx * Math.sin(l.a) + dz * Math.cos(l.a); return Math.hypot(u / (l.lengthM / 2), v / (l.widthM / 2)) < 1.25; });
  // ---- Glaciers: ice in the cirques, ragged at the edges and only above its terminus ----
  const glaciers = (config.glaciers || []).map((g) => { const p = proj.toLocal(g.lat, g.lon); return { ...g, ...p, base: T.at(p.x, p.z) - (g.dropM ?? 120), a: (g.angle || 0) * Math.PI / 180 }; });
  const glacierAt = (x, z) => {
    let k = 0;
    for (const g of glaciers) {
      const dx = x - g.x, dz = z - g.z;
      if (Math.abs(dx) > g.radiusM * 2 || Math.abs(dz) > g.radiusM * 2) continue;
      const u = dx * Math.cos(g.a) + dz * Math.sin(g.a), v = -dx * Math.sin(g.a) + dz * Math.cos(g.a);
      const n = Math.sin(x / 53 + Math.sin(z / 71) * 2) * .12 + Math.sin(z / 37 - x / 91) * .08;
      const r = Math.hypot(u / g.radiusM, v / (g.radiusM * (g.aspect || .6))) + n;
      const h = T.at(x, z);
      k = Math.max(k, (1 - smoothstep(.75, 1, r)) * smoothstep(g.base - 20, g.base + 40, h));
    }
    return k;
  };

  // ---- Height ----
  const baseHeight = (x, z) => T.at(x, z);
  // lake beds: shallows near the shore deepening to 14 m; a low lip just above the water on land
  const lakeBed = (x, z, h) => {
    const d = shore.sample(x, z);
    if (d == null || d > 30) return h;
    const lake = lakes.lakeAt(x, z) || (d > 0 ? nearLake(x, z) : null);
    if (!lake) return h;
    return d < 0 ? Math.min(h, lake.level - Math.min(14, .6 - d * .12)) : Math.max(h, lake.level + .35 + d * .04);
  };
  const nearLake = (x, z) => {
    for (const [ox, oz] of [[24, 0], [-24, 0], [0, 24], [0, -24], [17, 17], [-17, -17], [17, -17], [-17, 17]]) { const l = lakes.lakeAt(x + ox, z + oz); if (l) return l; }
    return null;
  };
  const heightAt = (x, z) => {
    let h = T.at(x, z);
    if (lakes) h = lakeBed(x, z, h);
    if (islands.length) h = islandAt(x, z, h);
    if (sites.length) h = siteAt(x, z, h);
    if (pads.length) h = padAt(x, z, h);   // before the road is pressed in, so the road always wins beside it
    const hit = index.nearest(x, z, 34);
    if (hit) {
      const s = route.dist[outbound(hit.i)], road = roadEle(hit.i, x, z) - .65;
      // a cliff road (Glacier) is cut into the slope in a narrow, steep cut: Big Sur's wide easing reads as a ramp
      const pressed = h + (road - h) * (1 - (mountain ? smoothstep(11, 24, hit.d) : smoothstep(8, 32, hit.d)));
      const b1 = bridges.length ? bridgeOfS(s, 14) : null;
      const sided = b1?.side && sideOf(hit.i, x, z) !== b1.side && hit.d > 4.5;
      const w = sided ? 0 : spanWeight(s) * (1 - smoothstep(14, 34, hit.d));
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
  // ---- Vegetation: golden grass on ridges and south faces, coastal scrub on north faces,
  //      redwood and oak in the canyons (from the shape of the real ground) ----
  const vegetationAt = (x, z) => {
    const h0 = T.at(x, z);
    let ring = 0;
    for (let k = 0; k < 8; k++) ring += T.at(x + Math.cos(k * .785) * 70, z + Math.sin(k * .785) * 70);
    ring /= 8;
    const gx = (T.at(x + 15, z) - T.at(x - 15, z)) / 30, gz = (T.at(x, z + 15) - T.at(x, z - 15)) / 30;
    const valley = Math.max(0, Math.min(1, (ring - h0) / 10)), ridge = Math.max(0, Math.min(1, (h0 - ring) / 10));
    const north = Math.max(0, Math.min(1, gz / .45));      // ground rising to the south faces north (shade, fog drip)
    const spray = smoothstep(40, 260, shore.sample(x, z) ?? 4000);
    const n = Math.sin(x / 97 + Math.sin(z / 131) * 2) * Math.sin(z / 83) * .15;
    const forest = Math.max(0, Math.min(1, valley * 1.5 + north * .45 - ridge * .9 - .3 + n)) * spray;
    const patchy = Math.sin(x / 61 + Math.sin(z / 47)) * Math.sin(z / 53 + x / 140) * .35;
    const scrub = Math.max(0, Math.min(1, .12 + north * .8 + valley * .5 - ridge * .4 + n * 2 + patchy - Math.abs(gx) * 0));
    return { forest, scrub, valley, ridge, north, spray };
  };
  // ---- Mountains (Glacier): forest below the treeline, thinning with height; avalanche chutes and cliffs
  //      stay open; the east side (past the divide) is drier: aspen groves and grassland ----
  const treeline = config.treelineM ?? 1950, divideX = config.divide ? proj.toLocal(config.divide[0], config.divide[1]).x : Infinity;
  const mountainVegetation = (x, z) => {
    const h0 = T.at(x, z);
    let ring = 0;
    for (let k = 0; k < 8; k++) ring += T.at(x + Math.cos(k * .785) * 80, z + Math.sin(k * .785) * 80);
    ring /= 8;
    const gx = (T.at(x + 15, z) - T.at(x - 15, z)) / 30, gz = (T.at(x, z + 15) - T.at(x, z - 15)) / 30, slope = Math.hypot(gx, gz);
    const valley = Math.max(0, Math.min(1, (ring - h0) / 12)), ridge = Math.max(0, Math.min(1, (h0 - ring) / 12));
    const north = Math.max(0, Math.min(1, gz / .45));
    const east = smoothstep(-2500, 2500, x - divideX);
    const n = Math.sin(x / 97 + Math.sin(z / 131) * 2) * Math.sin(z / 83) * .15;
    const tl = treeline - east * 120 + n * 150;
    const alpine = smoothstep(tl - 250, tl + 60, h0);
    // avalanche paths: long steep slopes below cliffs, bands of shrubs through the forest
    const chute = smoothstep(.55, .85, slope) * (.5 + .5 * Math.sin(x / 61 + z / 47 + Math.sin(z / 230) * 3));
    const dry = east * (1 - valley * .6) * (.6 + .4 * Math.sin(x / 210 + Math.sin(z / 170)));
    let forest = (1 - smoothstep(tl - 120, tl + 80, h0)) * (.88 + valley * .3 - ridge * .35 + north * .15 + n) * (1 - smoothstep(.9, 1.4, slope)) * (1 - chute * .85) * (1 - dry * .75);
    forest = Math.max(0, Math.min(1, forest)) + (1 - smoothstep(tl - 40, tl + 160, h0)) * alpine * .18 * (.5 + n * 3);   // krummholz islands at the treeline
    const scrub = Math.max(0, Math.min(1, .15 + chute * .9 + valley * .3 + alpine * .25 + dry * .2 + n));
    const moist = Math.max(0, Math.min(1, .55 + valley * .4 + north * .3 - ridge * .3 - dry * .6 - alpine * .2));
    const ice = glaciers.length ? glacierAt(x, z) : 0;
    return { forest: Math.max(0, Math.min(1, forest)) * (1 - ice), scrub: scrub * (1 - ice), valley, ridge, north, spray: 1, alpine, east, moist, slope, ice };
  };
  const waterLevelAt = (x, z) => {
    const c = creekHit(x, z, 0);
    if (c) return c.creek.positionAt(c.hit.s).y;
    if (mountain) return islands.length && islandHit(x, z) ? -Infinity : lakes?.lakeAt(x, z)?.level ?? -Infinity;
    return .05;
  };

  return {
    kind: mountain ? 'real-mountain' : 'real-coast', real: true, mountain, hasOcean: !mountain, coastSide: 1, gridLakes: lakes,
    sites, islands, glacierAt: glaciers.length ? glacierAt : null, sideOf, bridgeColors: config.bridgeColors,
    // the weather's fog bank lies on the lowest big lake (Lake McDonald), in the valleys around it
    fogBase: mountain ? Math.min(...(lakes?.list || []).filter((l) => l.areaHa > 200).map((l) => l.level), Infinity) : 0,
    // legacy fields (the authored-coast code paths are skipped when `real` is set)
    coast: [{ x: minX - pad, z: minZ - pad }, { x: minX - pad, z: maxZ + pad }], coastX: () => -1e6,
    inlandAt, shore, shoreAt: mountain ? (x, z) => shore.sample(x, z) ?? Infinity : undefined, terrain: T, landmarks: bridges, bridges, creeks, creekAt, heightAt, baseHeight, bridgeAt, bridgeOfS,
    waterLevelAt, frameAt, roadEle, vegetationAt: mountain ? mountainVegetation : vegetationAt, nearCreek: (x, z, pad = 0) => !!creekHit(x, z, pad), lakes: [], waterIslands: [],
    isWater: mountain ? (x, z, height) => height < waterLevelAt(x, z) + .3 || !!creekHit(x, z, 0) : (x, z, height) => height < .3 || !!creekHit(x, z, 0),
  };
}
