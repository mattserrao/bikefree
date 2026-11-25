// Visual QC for any free-ride graph map, run in the page on the built world: tools/qc_map.mjs loads
// tools/pgh-preview.html?qc=1 at each site (the landmarks' QC probes on: js/world/toolbox/city/qc-probe.js), then calls
// runMapQC(world, THREE, opts) and gets the counts of each fault round the camera (radius m), with a few examples each.
// First written for NYC's review (25 Nov: "Preview the map as a critical, QC tester for visual issues … free floating
// structures. Poor intersections, lack of smoothing of turns / roads"); a check that needs data a map doesn't have
// (ring pools, landmark basins, benches, allées) counts nothing there.
//
//   strayWater     the ground drawing water (land cover) where no pool is: blocky teal cells
//   bankShard      ground poking up through a pool's water, inside its outline (pools drawn on outlines)
//   bankCliff      the water's edge standing over a drop: the water plane's rim above the ground beside it
//   dryBasin       a fountain basin with no water in it (landmarks report their basins)
//   bridgeDup      a way's own deck drawn where a landmark bridge model stands (two bridges)
//   floating       a landmark piece standing on nothing: not the ground, the water, a way or another piece
//   waterOverWay   a pool's water above a way beside it
//   pathPaint      painted centre lines on paths and the bridle path (where the map's profile says unpainted)
//   edgeLip        anything 12 cm over a way just beside its edge: a raised lip
//   edgeDitch      a step down at a way's edge (30 cm within 0.4 m, 80 cm within 1.2 m)
//   joinGap        two ways meeting at a bend with a hole or a step at the bend's outside
//   sharpCorner    a junction corner with no curb return (no arc)
//   alleeTrees     an allée's planned trees standing / planned (the map's city data: allee)
//   gritEdges      the land cover's grain scatter on (blocky stipple at cover edges)
//   benchOnWay     a bench overlapping a way, beside the bridle path or a drive, or facing away from its way
//   viewBlocked    trees between a landmark and the nearest way it should be seen from
export function runMapQC(w, T, { radius = 420, heroes = null } = {}) {
  const cx = w.camera.position.x, cz = w.camera.position.z, near = (x, z, r = radius) => Math.hypot(x - cx, z - cz) < r;
  const ll = (x, z) => { const p = w.proj.toLatLon(x, z); return [+p.lat.toFixed(5), +p.lon.toFixed(5)]; };
  const out = {}, ex = {};
  const add = (k, x, z, note = '') => { out[k] = (out[k] || 0) + 1; (ex[k] ||= []).length < 6 && ex[k].push([...ll(x, z), note].filter((v) => v !== '')); };
  const zero = (...ks) => { for (const k of ks) out[k] ||= 0; };
  zero('strayWater', 'bankShard', 'bankCliff', 'dryBasin', 'bridgeDup', 'floating', 'waterOverWay', 'pathPaint', 'edgeLip', 'edgeDitch', 'joinGap', 'sharpCorner', 'benchOnWay', 'viewBlocked');
  const E = w.G.edges.filter((e) => { for (let i = 0; i <= e.n; i += 3) if (near(e.x[i], e.z[i])) return true; return false; });
  const inRing = (r, x, z) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c; } return c; };
  const ringDist = (r, x, z) => { let d = Infinity; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)); d = Math.min(d, Math.hypot(a.x + dx * t - x, a.z + dz * t - z)); } return inRing(r, x, z) ? -d : d; };
  const pools = (w.pools || []).filter((p) => p.ring);
  const G = (x, z) => w._groundH(x, z);
  const WATER_ABOVE = 0.35;

  // 1 stray water: land-cover water cells (4 m) with no pool there
  const city = w.city, LANDW = 3;
  // (only on a map whose pools are drawn on their outlines: elsewhere — SKAN's lakes — the cover is the water)
  if (city?.land && pools.length) for (let x = cx - radius; x < cx + radius; x += 4) for (let z = cz - radius; z < cz + radius; z += 4) {
    if (!near(x, z) || city.landAt(x, z) !== LANDW) continue;
    if (!pools.some((p) => x > p.x0 - 6 && x < p.x1 + 6 && z > p.z0 - 6 && z < p.z1 + 6 && ringDist(p.ring, x, z) < 4)) add('strayWater', x, z);
  }
  // 2 the banks: round each pool's outline
  for (const p of pools) {
    const r = p.ring, top = p.level + WATER_ABOVE;
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length], L = Math.hypot(b.x - a.x, b.z - a.z), nx = (b.z - a.z) / (L || 1), nz = -(b.x - a.x) / (L || 1);
      for (let t = 0; t < L; t += 4) {
        const x = a.x + (b.x - a.x) * t / L, z = a.z + (b.z - a.z) * t / L;
        if (!near(x, z)) continue;
        // which side is out: the one not in the ring
        const s = inRing(r, x + nx * 2, z + nz * 2) ? -1 : 1, ox = nx * s, oz = nz * s;
        if (G(x - ox * 3, z - oz * 3) > top + 0.05) add('bankShard', x - ox * 3, z - oz * 3, p.name);
        // the water plane reaches 2 m past the outline: there the ground should be up to the water, not a drop under it
        const g2 = G(x + ox * 2.2, z + oz * 2.2);
        const underDeck = E.some((e) => e.bridges.some(([a0, b0]) => { for (let k = a0; k <= b0; k++) if (Math.hypot(e.x[k] - x, e.z[k] - z) < 14) return true; return false; }));
        if (g2 < top - 0.6 && !underDeck && !E.some((e) => wayNear(e, x + ox * 2.2, z + oz * 2.2, 1))) add('bankCliff', x + ox * 2.2, z + oz * 2.2, `${p.name} ${(top - g2).toFixed(1)} m (cap ${(w.cut.cap(x + ox * 2.2, z + oz * 2.2) - top).toFixed(1)})`);
      }
    }
  }
  function wayNear(e, x, z, pad) { const h = w.wOf(e) / 2 + pad; for (let i = 0; i <= e.n; i++) if (Math.abs(e.x[i] - x) < h + 10 && Math.abs(e.z[i] - z) < h + 10) { const j = Math.min(e.n, i + 1), dx = e.x[j] - e.x[i], dz = e.z[j] - e.z[i], l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - e.x[i]) * dx + (z - e.z[i]) * dz) / l2)); if (Math.hypot(e.x[i] + dx * t - x, e.z[i] + dz * t - z) < h) return true; } return false; }
  // 7 a pool above the way beside it
  for (const e of E) for (let i = 0; i <= e.n; i += 2) {
    if (e.bridges.some(([a, b]) => i >= a && i <= b)) continue;
    const half = w.wOf(e) / 2, dx = e.x[Math.min(e.n, i + 1)] - e.x[Math.max(0, i - 1)], dz = e.z[Math.min(e.n, i + 1)] - e.z[Math.max(0, i - 1)], l = Math.hypot(dx, dz) || 1;
    for (const s of [-1, 1]) {
      const x = e.x[i] - dz / l * s * (half + 2.5), z = e.z[i] + dx / l * s * (half + 2.5), lvl = w.poolAt(x, z);
      if (lvl > -1e3 && lvl + WATER_ABOVE > e.ele[i] - 0.3 && pools.some((p) => ringDist(p.ring, x, z) < 3)) add('waterOverWay', e.x[i], e.z[i], `${e.name || e.kind} water ${(lvl + WATER_ABOVE - e.ele[i]).toFixed(1)} m over`);
    }
  }
  // 8 paint on paths
  if (w.profile?.pathPaint === false) for (const e of E) if (['path', 'bridle'].includes(e.kind) && w._paintOf(e).centre) add('pathPaint', e.x[e.n >> 1], e.z[e.n >> 1], e.name || e.kind);
  // 9 edges: rays down at 0.4, 1.2 and 2.5 m beyond each way's edge, against everything drawn there
  const meshes = []; w.scene.traverseVisible((o) => { if (o.isMesh && !o.isInstancedMesh && o.geometry?.attributes?.position?.array && !/rider|Rowboats|Ducks|Squirrels|sky/i.test(o.name)) meshes.push(o); });
  const rc = new T.Raycaster(), down = new T.Vector3(0, -1, 0);
  const topAt = (x, z, y0) => { rc.set(new T.Vector3(x, y0 + 6, z), down); rc.far = 30; let best = null; for (const o of meshes) { const bs = o.geometry.boundingSphere; if (bs) { const c = bs.center.clone().applyMatrix4(o.matrixWorld); if (Math.hypot(c.x - x, c.z - z) > bs.radius + 1) continue; } try { const h = rc.intersectObject(o, false)[0]; if (h && (!best || h.distance < best.distance)) best = h; } catch {} } return best; };
  let edgeN = 0;
  for (const e of E) for (let i = 1; i < e.n; i += 4) {
    if (!near(e.x[i], e.z[i], radius * 0.6) || e.bridges.some(([a, b]) => i >= a - 1 && i <= b + 1)) continue;
    if (w.jn && [e.from, e.to].some((v) => w.jn.has(v)) && (i < 3 || i > e.n - 3)) continue;
    const half = w.wOf(e) / 2, dx = e.x[i + 1] - e.x[i - 1], dz = e.z[i + 1] - e.z[i - 1], l = Math.hypot(dx, dz) || 1, y = e.ele[i] + 0.12;
    for (const s of [-1, 1]) {
      edgeN++;
      const at = (d) => { const x = e.x[i] - dz / l * s * (half + d), z = e.z[i] + dx / l * s * (half + d); return [x, z, topAt(x, z, y)]; };
      const near1 = at(0.4), near2 = at(1.2);
      // (a lip: anything 12 cm over the way just beside it; a ditch: a step down at the edge — 30 cm within 0.4 m, or
      //  80 cm within 1.2 m — steeper than a verge's slope)
      for (const [x, z, h, lim] of [[...near1, 0.3], [...near2, 0.8]]) {
        if (!h || w.poolAt(x, z) + WATER_ABOVE >= h.point.y - 0.05) continue;
        if (/landmark|Bench|lamp/i.test(h.object.name)) continue;
        if (h.point.y > y + 0.12 && !(w.walkOf?.(e) > 0) && !E.some((o) => o !== e && wayNear(o, x, z, 0.2))) { add('edgeLip', x, z, `${e.kind} +${(h.point.y - y).toFixed(2)} m (${h.object.name || h.object.parent?.name || 'mesh'})`); break; }
        if (h.point.y < y - lim) { add('edgeDitch', x, z, `${e.kind} -${(y - h.point.y).toFixed(2)} m`); break; }
      }
    }
  }
  out.edgeSamples = edgeN;
  // 10 joins: two ways meeting at a bend (a round join filling the outside); junction corners without a curb return
  for (const [id, list] of w.arms || []) {
    const nd = w.G.nodes?.find?.((q) => q.id === id) || null;
    const e0 = list[0].e, x = list[0].end ? e0.x[e0.n] : e0.x[0], z = list[0].end ? e0.z[e0.n] : e0.z[0];
    if (!near(x, z)) continue;
    if (list.length === 2) {
      // the bend's outside, just inside the wider way's edge along the bisector: road surface there, at the road's height?
      const dirs = list.map(({ e, end }) => { const k = end ? e.n - 1 : 1; const dx = e.x[k] - x, dz = e.z[k] - z, l = Math.hypot(dx, dz) || 1; return { x: dx / l, z: dz / l, h: w.wOf(e) / 2, e, y: e.ele[end ? e.n : 0] }; });
      const turn = Math.PI - Math.acos(Math.max(-1, Math.min(1, dirs[0].x * dirs[1].x + dirs[0].z * dirs[1].z)));
      if (turn < 0.35) continue;
      let bx = -(dirs[0].x + dirs[1].x), bz = -(dirs[0].z + dirs[1].z); const bl = Math.hypot(bx, bz) || 1; bx /= bl; bz /= bl;
      const r = Math.max(dirs[0].h, dirs[1].h) * 0.8, y = dirs[0].y + 0.1, h = topAt(x + bx * r, z + bz * r, y);
      if (!h || Math.abs(h.point.y - y) > 0.12) add('joinGap', x, z, `${(turn * 57.3).toFixed(0)}° ${dirs[0].e.kind}/${dirs[1].e.kind} ${h ? (h.point.y - y).toFixed(2) : 'hole'}`);
      void nd;
    } else {
      const J = w.jn?.get(id);
      if (!J) continue;
      // (a corner under 35° or over 140° wants no curb return — a sliver or a near-straight side: counted apart, not a fault)
      for (const c of J.corners) if (!c.arc && c.gap < Math.PI * 0.86 && c.gap > 0.3 && (c.gap < 0.61 || c.gap > 2.44)) out.skewCorner = (out.skewCorner || 0) + 1;
      for (const c of J.corners) if (!c.arc && c.gap >= 0.61 && c.gap <= 2.44) add('sharpCorner', x, z, `${(c.gap * 57.3).toFixed(0)}° ${c.A.e.kind}/${c.B.e.kind}`);
    }
  }
  // 11 the allée's trees, 12 the ground's grain
  const trees = []; for (const t of city?.tiles?.values?.() || []) for (const q of t.trees || []) if (near(q.x, q.z)) trees.push(q);
  out.trees = trees.length;
  if (heroes?.allee) {
    let want = 0, have = 0;
    for (const [la, lo] of heroes.allee) { const p = w.proj.toLocal(la, lo); if (!near(p.x, p.z)) continue; want++; if (trees.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 1.5)) have++; else add('alleeMissing', p.x, p.z); }
    out.alleeTrees = `${have}/${want}`;
  }
  out.gritEdges = w.profile?.softCover && w._grainOn !== false ? 1 : 0;   // (only where the map asks for soft cover edges)
  // 3, 13 basins and benches (what nycPark and the landmark models report)
  const lm = w.heroes?.landmarks;
  for (const b of lm?.qc?.basins || []) if (near(b.x, b.z) && !b.water) add('dryBasin', b.x, b.z, b.name);
  for (const b of lm?.qc?.benches || []) {
    if (!near(b.x, b.z)) continue;
    const onWay = E.find((e) => wayNear(e, b.x, b.z, 0.55));
    if (onWay) { add('benchOnWay', b.x, b.z, `on ${onWay.kind}`); continue; }
    if (['bridle', 'drive'].includes(b.kind)) add('benchOnWay', b.x, b.z, `beside the ${b.kind}`);
    else if (b.facing === false) add('benchOnWay', b.x, b.z, 'faces away');
  }
  // 4-5 bridge models over the way's own deck
  for (const m of lm?.qc?.bridges || []) {
    if (!near(m.x, m.z)) continue;
    const e = E.find((q) => q.bridges.length && q.bridges.some(([a, b]) => { for (let i = a; i <= b; i++) if (Math.hypot(q.x[i] - m.x, q.z[i] - m.z) < 30) return true; return false; }));
    if (e && !(w.modelDecks?.get(e.id))) add('bridgeDup', m.x, m.z, `${m.name}: ${e.name || e.kind} deck drawn too`);
    if (!e && !m.onWay) add('bridgeDup', m.x, m.z, `${m.name}: model off the way`);
  }
  // 6-7 floating landmark pieces: each solid piece's foot (the models report them) with nothing under it — not the
  //  ground or the water within 0.35 m, nor another piece (a ray down from just under the foot)
  const prims = (lm?.qc?.prims || []).filter((p) => near(p.x ?? p.a.x, p.z ?? p.a.z, radius + 60));
  const segD = (a, b, x, z) => { const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)); return Math.hypot(a.x + dx * t - x, a.z + dz * t - z); };
  for (const p of prims) {
    if (p.beam || !near(p.x, p.z)) continue;
    const g = Math.max(G(p.x, p.z), w.poolAt(p.x, p.z) + WATER_ABOVE);
    if (p.y - g < 0.35) continue;
    if (E.some((e) => wayNear(e, p.x, p.z, 0.3)) && p.y - (wayY(p.x, p.z) ?? -1e9) < 0.4) continue;
    const held = prims.some((q) => q !== p && q.top >= p.y - 0.45 && (q.beam ? q.bot <= p.y + 0.02 : q.y <= p.y + 0.02) && (q.beam ? segD(q.a, q.b, p.x, p.z) <= q.w / 2 + (p.foot ?? p.r) + 0.3 : Math.hypot(q.x - p.x, q.z - p.z) <= Math.max(q.r, p.r) + 0.3));   // (either over the other: a rail on its posts, a deck on its piles)
    // (else a ray down from under its foot — its middle and four points round it — onto anything drawn: walls built
    //  outside the probe, PGH's towers, hold their roofs)
    let under = held;
    if (!under) for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      // (from just over the foot: a flush top — a tower's roof under its pinnacles — is caught; the piece's own
      //  underside faces down and isn't hit from above)
      const k = (p.foot ?? p.r) * 0.5; rc.set(new T.Vector3(p.x + dx * k, p.y + 0.05, p.z + dz * k), down); rc.far = 0.65;
      for (const o of meshes) { try { if (rc.intersectObject(o, false).length) { under = true; break; } } catch {} }
      if (under) break;
    }
    if (!under) add('floating', p.x, p.z, `${p.lm} ${p.what} ${(p.y - g).toFixed(1)} m up`);
  }
  function wayY(x, z) { let best = null; for (const e of E) for (let i = 0; i <= e.n; i++) { const d = Math.hypot(e.x[i] - x, e.z[i] - z); if (d < w.wOf(e) / 2 + 2 && (!best || d < best.d)) best = { d, y: e.ele[i] + 0.12 }; } return best?.y; }
  // 14 views: trees between each landmark and the nearest way sample (40–160 m off)
  for (const v of lm?.qc?.views || []) {
    if (!near(v.x, v.z)) continue;
    let best = null;
    for (const e of E) for (let i = 0; i <= e.n; i++) { const d = Math.hypot(e.x[i] - v.x, e.z[i] - v.z); if (d > 25 && d < 160 && (!best || d < best.d)) best = { d, x: e.x[i], z: e.z[i] }; }
    if (!best) continue;
    const dx = v.x - best.x, dz = v.z - best.z, L = Math.hypot(dx, dz);
    const block = trees.filter((q) => { const t = ((q.x - best.x) * dx + (q.z - best.z) * dz) / (L * L); if (t < 0.08 || t > 0.85) return false; return Math.hypot(best.x + dx * t - q.x, best.z + dz * t - q.z) < 3; }).length;
    if (block) add('viewBlocked', v.x, v.z, `${v.name}: ${block} trees`);
  }
  return { at: ll(cx, cz), counts: out, examples: ex };
}

export const runParkQC = runMapQC;   // (the first name, NYC)
