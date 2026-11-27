// A graph edge's drawn geometry (js/world/graph-world.js): the Catmull-Rom curve through its 10 m samples that the
// ribbons, the junctions and the people on the paths all follow, and its decks' spans.
// [review 27 Nov] W14/W15: pure functions out of GraphWorld (_curvePoint, _curve) and the deck "distance to the
// end" loop written twice (roadHash, the bank job's piers); the same arithmetic (test/world-graph.test.mjs).
// An edge here: { n, x, z, ele (Float64Array, n + 1 samples), bridges: [[a, b], …] }.

/** A drawn way's points per 10 m sample span (graph-world: SUB). */
export const SUB = 3;

/** A point on edge e's drawn centre line (the Catmull-Rom curve `curve` draws) at fractional sample f:
 *  {x, y, z, dx, dz} (dx, dz: unit, along increasing f). */
export function curvePoint(e, f) {
  f = Math.max(0, Math.min(e.n, f));
  const at = (g) => {
    const i = Math.min(e.n - 1, Math.floor(g)), t = g - i, P = (k) => Math.max(0, Math.min(e.n, k)), i0 = P(i - 1), i2 = P(i + 1), i3 = P(i + 2);
    const cr = (v) => { const p0 = v[i0], p1 = v[i], p2 = v[i2], p3 = v[i3]; return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t); };
    return { x: cr(e.x), z: cr(e.z), y: e.ele[i] + (e.ele[i2] - e.ele[i]) * t };
  };
  const p = at(f), a = at(Math.max(0, f - 0.05)), b = at(Math.min(e.n, f + 0.05)), l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { x: p.x, y: p.y, z: p.z, dx: (b.x - a.x) / l, dz: (b.z - a.z) / l };
}

/** A way drawn smooth: a Catmull-Rom curve through its samples from a to b, SUB points a span:
 *  [{x, z, y, i (the sample, fractional), s (m from a), dx, dz}]. */
export function curve(e, a, b) {
  const out = [], P = (k) => Math.max(0, Math.min(e.n, k));
  let s = 0, px = null, pz = null;
  for (let i = a; i < b || (i === b && true); i++) {
    for (let q = 0; q < (i === b ? 1 : SUB); q++) {
      const t = q / SUB, i0 = P(i - 1), i1 = i, i2 = P(i + 1), i3 = P(i + 2);
      // (past an end, the end's own line carried on — as js/graph.js pads the base line the rider rides, so the
      //  drawn curve and the ridden one are the same)
      const cr = (v) => { const p0 = i - 1 < 0 ? 2 * v[0] - v[Math.min(1, e.n)] : v[i0], p1 = v[i1], p2 = v[i2], p3 = i + 2 > e.n ? 2 * v[e.n] - v[Math.max(0, e.n - 1)] : v[i3]; return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t); };
      const x = i === b ? e.x[b] : cr(e.x), z = i === b ? e.z[b] : cr(e.z), y = i === b ? e.ele[b] : e.ele[i1] + (e.ele[i2] - e.ele[i1]) * t;
      if (px !== null) s += Math.hypot(x - px, z - pz);
      out.push({ x, z, y, i: i + t, s }); px = x; pz = z;
    }
    if (i === b) break;
  }
  for (let k = 0; k < out.length; k++) {
    const p0 = out[Math.max(0, k - 1)], p1 = out[Math.min(out.length - 1, k + 1)];
    let dx = p1.x - p0.x, dz = p1.z - p0.z; const l = Math.hypot(dx, dz) || 1; out[k].dx = dx / l; out[k].dz = dz / l;
  }
  return out;
}

/** An edge's decks by sample: deck[i] 1 inside a bridge span (its ends excluded), toEnd[i] the metres from sample i
 *  to the nearest sample off the deck (0 off it; Infinity on an edge that is all deck). */
export function deckSpans(e) {
  const deck = new Uint8Array(e.n + 1);
  for (const [a, b] of e.bridges) for (let i = a + 1; i < b; i++) deck[i] = 1;
  const toEnd = new Float32Array(e.n + 1).fill(Infinity);
  for (let i = 0; i <= e.n; i++) if (!deck[i]) toEnd[i] = 0;
  for (let i = 1; i <= e.n; i++) toEnd[i] = Math.min(toEnd[i], toEnd[i - 1] + 10);
  for (let i = e.n - 1; i >= 0; i--) toEnd[i] = Math.min(toEnd[i], toEnd[i + 1] + 10);
  return { deck, toEnd };
}
