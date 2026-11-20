// [w2-align] Keep a coarse ground mesh off the streets. Pure functions (Node + browser).
//
// A ground patch is a regular grid of vertices sampled from the landscape's height. Where a level street crosses
// a steep slope, the triangles between a street-level vertex and one up the bank interpolate *over* the street's
// uphill edge: the hillside cuts into the ribbon in a sawtooth that follows the mesh's diagonals (Mount
// Washington's ramps, 12.07 km). More vertices only halve it. Instead, lower just the vertices that cause it:
// for every sample point that must stay clear (a street's carriageway and sidewalks), the triangle under it is
// lowered at the vertex that stands highest (the bank's) first, until the mesh at the point is no higher than the ground there. Vertices at
// street level move last (rarely), so nothing much opens under the ribbon; the bank above just gets a steeper first metre or two.
//
// [audit-E1] And the other way: a street on an embankment (a ramp beside the carriageway below it). The mesh between
// a vertex on the bank's top and one at its toe sags under the street's edge — the street floats, and along it the
// ground saws up and down as the edge crosses the cells. Points marked `up` (the bank's top: landscape
// groundClearPoints) must not have the mesh more than `upTol` under the ground there: the triangle's highest vertex is
// raised first (never over the point's ground, nor more than `maxLift` over its own). Raises run before the clear
// points of the same call, so a lower street's clear points (the bank's toe) still win.

/**
 * Incremental form (the ground patch job feeds points a slice at a time between frames).
 * @param {Float32Array|Float64Array|number[]} h  vertex heights, row-major, (S+1)×(S+1); `apply()` lowers them in place
 * @param {number} x0 @param {number} z0  patch corner; @param {number} cell  vertex spacing (m); @param {number} S cells per side
 * @param {(x:number,z:number)=>number} heightAt  the ground's true height
 * @param {{clear?:number, maxDrop?:number}} [opts]  clear: how far below heightAt the mesh may stay (m); maxDrop: no
 *   vertex is lowered further than this (m) — at a cliff or a wall beside a street the mesh can't follow anyway,
 *   and a deep drop there would open a pit under whatever stands on the bank
 * @param {(x:number,z:number)=>boolean} [opts.fixed]  vertices that never move (the route's own bank and verge)
 * @param {(x:number,z:number)=>boolean} [opts.last]  vertices lowered only when the bank's can't do it alone (those on
 *   the streets themselves: already at street level, and a dip there shows beside the sidewalk)
 */
export function groundDrape(h, x0, z0, cell, S, heightAt, { clear = 0, maxDrop = Infinity, fixed = null, last = null, upTol = .3, maxLift = 3 } = {}) {
  const N = S + 1, drop = new Float64Array(N * N);
  // free: 0 fixed, 1 lowered only when the others can't do it (on a street), 2 lowered first (the bank)
  const free = new Uint8Array(N * N).fill(2);
  if (fixed || last) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = x0 + i * cell, z = z0 + j * cell;
    if (fixed?.(x, z)) free[j * N + i] = 0; else if (last?.(x, z)) free[j * N + i] = 1;
  }
  return {
    /** @param {Iterable<{x:number,z:number,up?:boolean}>} points  where the drawn ground must not rise above the
     *  ground (or, `up`, sink more than upTol under it) */
    add(points) {
      const list = Array.isArray(points) ? points : [...points];
      for (const p of list) if (p.up) raise(p);
      for (const p of list) {
        if (p.up) continue;
        const u = (p.x - x0) / cell, w = (p.z - z0) / cell;
        if (!(u >= 0 && w >= 0 && u <= S && w <= S)) continue;
        const i = Math.min(S - 1, Math.floor(u)), j = Math.min(S - 1, Math.floor(w)), fu = u - i, fw = w - j;
        // the mesh's triangles (a, d, b) and (b, d, e): a = (i, j), b = (i+1, j), d = (i, j+1), e = (i+1, j+1)
        const a = j * N + i, b = a + 1, d = a + N, e = d + 1;
        const tri = fu + fw <= 1 ? [[a, 1 - fu - fw], [b, fu], [d, fw]] : [[e, fu + fw - 1], [d, 1 - fu], [b, 1 - fw]];
        const t = heightAt(p.x, p.z) - clear;
        let m = 0;
        for (const [k, wt] of tri) m += wt * (h[k] - drop[k]);
        let over = m - t;
        if (over <= 1e-3) continue;
        // lower the bank's vertex standing highest above the point first, as far as needed but no more than 1 m
        // below the point; then the next, if that one alone can't (capped, or too little weight); street vertices last
        const order = tri.filter(([k, wt]) => wt > 1e-6 && free[k])
          .sort((p1, p2) => free[p2[0]] - free[p1[0]] || (h[p2[0]] - drop[p2[0]]) - (h[p1[0]] - drop[p1[0]]));
        for (const [k, wt] of order) {
          const above = h[k] - drop[k] - t;
          if (over <= 1e-3) break;
          if (above <= 0) continue;
          const dk = Math.min(above + 1, over / wt, maxDrop - drop[k]);
          if (dk <= 0) continue;
          drop[k] += dk; over -= wt * dk;
        }
      }
    },
    /** Move the vertices; returns {n: vertices moved, max: deepest drop (m), drop: how far each vertex moved (m, ≥ 0)}. */
    apply() {
      let n = 0, max = 0;
      const moved = new Float64Array(drop.length);
      for (let k = 0; k < drop.length; k++) if (drop[k] !== 0) { h[k] -= drop[k]; n++; max = Math.max(max, drop[k]); moved[k] = Math.abs(drop[k]); }
      return { n, max, drop: moved };
    },
  };
  // [audit-E1] a bank-top point: lift the triangle's highest (free) vertices until the mesh there is within upTol of the ground
  function raise(p) {
    const u = (p.x - x0) / cell, w = (p.z - z0) / cell;
    if (!(u >= 0 && w >= 0 && u <= S && w <= S)) return;
    const i = Math.min(S - 1, Math.floor(u)), j = Math.min(S - 1, Math.floor(w)), fu = u - i, fw = w - j;
    const a = j * N + i, b = a + 1, d = a + N, e = d + 1;
    const tri = fu + fw <= 1 ? [[a, 1 - fu - fw], [b, fu], [d, fw]] : [[e, fu + fw - 1], [d, 1 - fu], [b, 1 - fw]];
    const t = heightAt(p.x, p.z);
    let m = 0;
    for (const [k, wt] of tri) m += wt * (h[k] - drop[k]);
    let under = t - upTol - m;
    if (under <= 1e-3) return;
    const order = tri.filter(([k, wt]) => wt > .15 && free[k]).sort((p1, p2) => (h[p2[0]] - drop[p2[0]]) - (h[p1[0]] - drop[p1[0]]));
    for (const [k, wt] of order) {
      if (under <= 1e-3) break;
      const cur = h[k] - drop[k], room = Math.min(t - cur, h[k] + maxLift - cur);
      const dk = Math.min(room, under / wt);
      if (dk <= 0) continue;
      drop[k] -= dk; under -= wt * dk;
    }
  }
}

/** One-shot form: lower `h` for all `points` at once. Returns how many vertices were lowered. */
export function drapeGround(h, x0, z0, cell, S, points, heightAt, clear = 0, maxDrop = Infinity) {
  const d = groundDrape(h, x0, z0, cell, S, heightAt, { clear, maxDrop });
  d.add(points);
  return d.apply().n;
}

/** The cap the app uses (m): see groundDrape's maxDrop. */
export const DRAPE_MAX_DROP = 4;
/** Patches up to this size (m) are draped: 96 m (6 m cells) and 192 m (12 m cells), within ~440 m of the camera. */
export const DRAPE_MAX_PATCH = 192;
