// [w2-align] Keep a coarse ground mesh off the streets. Pure functions (Node + browser).
//
// A ground patch is a regular grid of vertices sampled from the landscape's height. Where a level street crosses
// a steep slope, the triangles between a street-level vertex and one up the bank interpolate *over* the street's
// uphill edge: the hillside cuts into the ribbon in a sawtooth that follows the mesh's diagonals (Mount
// Washington's ramps, 12.07 km). More vertices only halve it. Instead, lower just the vertices that cause it:
// for every sample point that must stay clear (a street's carriageway and sidewalks), the triangle under it is
// lowered at the vertex that stands highest (the bank's) first, until the mesh at the point is no higher than the ground there. Vertices at
// street level move last (rarely), so nothing much opens under the ribbon; the bank above just gets a steeper first metre or two.

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
export function groundDrape(h, x0, z0, cell, S, heightAt, { clear = 0, maxDrop = Infinity, fixed = null, last = null } = {}) {
  const N = S + 1, drop = new Float64Array(N * N);
  // free: 0 fixed, 1 lowered only when the others can't do it (on a street), 2 lowered first (the bank)
  const free = new Uint8Array(N * N).fill(2);
  if (fixed || last) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = x0 + i * cell, z = z0 + j * cell;
    if (fixed?.(x, z)) free[j * N + i] = 0; else if (last?.(x, z)) free[j * N + i] = 1;
  }
  return {
    /** @param {Iterable<{x:number,z:number}>} points  where the drawn ground must not rise above the ground */
    add(points) {
      for (const p of points) {
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
    /** Lower the vertices; returns {n: vertices lowered, max: deepest drop (m)}. */
    apply() {
      let n = 0, max = 0;
      for (let k = 0; k < drop.length; k++) if (drop[k] > 0) { h[k] -= drop[k]; n++; max = Math.max(max, drop[k]); }
      return { n, max, drop };
    },
  };
}


/** The cap the app uses (m): see groundDrape's maxDrop. */
export const DRAPE_MAX_DROP = 4;
/** Patches up to this size (m) are draped: 96 m (6 m cells) and 192 m (12 m cells), within ~440 m of the camera. */
export const DRAPE_MAX_PATCH = 192;
