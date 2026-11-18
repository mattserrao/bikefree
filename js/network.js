// Ride networks: choose your turns (Pittsburgh first). Pure — no DOM, no three.js — so the session, the
// 3D world, the course QC and the tests all use the same path.
//
// A network (tools/build_network.mjs → routes/cities/<id>-network.json) is a set of junctions (nodes)
// joined by edges. In this first version every edge is a stretch of the city loop's own GPX ("the base
// route"), so the 3D world is the one built around that loop; an edge ridden backwards is the same
// stretch on the base route's way back (every catalog route is mirrored into there-and-back: [0, L] out,
// [L, 2L] back). A traversal is an edge and a direction ({ e, dir: +1 | -1 }).
//
// A ride follows a path: traversals one after another. The session rides a rolling linear "path route"
// (10 m samples, like any route) that is the path laid end to end, so physics, resistance, recording and
// the route selector all work as on any route. The path ahead is filled in by the plan (a preset's loop
// of traversals), or straight on once off it; at each junction the rider can pick another way before the
// choice locks. Positions in the path route ("path metres") map to the base route (world.s) for the 3D
// world, and through a junction the rider's pose follows a smooth curve from one traversal to the next.
//
// Areas (bikefree-network-2, PLAN 5.4): a city's network can span several areas, each built around its own
// base line (its own route, scenery and city data, all in one shared frame: the city's origin). Every edge
// lives on one area's line; a junction where two areas meet is a portal, on both lines. An area's line also
// runs an "apron" along the other areas' edges at its portals (drawn, not ridden as its own edge), so near a
// portal either area can draw the streets around the rider: `areaS` maps a place on an edge onto any area
// that covers it, `NetRide.areaFor` picks the area to draw, and poses are taken on the area drawn.
import { routeAt } from './gpx.js';
import { riderPose } from './world/pose.js';

const STEP = 10;
export const PROMPT_S = 15;        // the turn prompt shows about this many seconds before a junction…
export const PROMPT_MIN_M = 120;   // …and never later than this many metres before it
export const LOCK_M = 30;          // the choice locks this close to the junction
export const TURN_R = 13;          // a left turn's curve starts this far before the junction and ends this far after
export const RIGHT_R = 8;          // a right turn's (it stays in the near lane and hugs the kerb: a tighter turn)
export const UTURN_R = 9;          // the same for a U-turn ("back")
export const PASS_R = 6;           // passing straight through where the base route has a seam (the loop's start)
const AHEAD_M = 150000;            // the path route always reaches this far beyond the rider (and the planner)
const REFILL_M = 100000;           // …refilled once less than this is left
const HEADING_M = 15;              // an arm's heading for the turn's curve and speed cap: from the junction to this far along it
const LABEL_M0 = 10, LABEL_M1 = 40;   // …and for its label, order and the default rule: 10–40 m out, past the line's rounded corner (F84)
export const SWAP_AHEAD_M = 200;   // areas: the area drawn keeps drawing while it covers the rider and this far ahead
export const PRELOAD_M = 1500;     // …an area the path enters within this far ahead is loaded and built, hidden
export const RELEASE_M = 600;      // …and one not drawn, not ahead and not within this far behind is released
const CORNER = { minDeg: 60, decel: 2 };   // speed cap: sharper than this; the rider slows at this m/s²
// sharp corners inside a segment (no junction: Bakery Square's hairpin, F82) get the same gentle cap: the turn
// over ±ARC_M of the line, measured every SCAN_M; corners within END_M of a junction are the junction's (its own cap)
const BEND = { arcM: 15, scanM: 5, endM: 25, holdM: 10 };

const deg = (r) => (r * 180) / Math.PI;
const unit2 = (v) => { const l = Math.hypot(v.x, v.z) || 1; return { x: v.x / l, z: v.z / l }; };
export const travKey = (t) => `${t.e.id}${t.dir > 0 ? '+' : '-'}`;
const same = (a, b) => a && b && a.e === b.e && a.dir === b.dir;

/**
 * Load a network over its base route(s) (catalog routes, mirrored: the app's route frame). `base`: the route
 * (one area), or for a network of areas a Map (or object) of area id → that area's route.
 */
export function loadNetwork(json, base) {
  const v2 = json?.format === 'bikefree-network-2';
  if (!v2 && json?.format !== 'bikefree-network-1') throw new Error('Unsupported network format');
  const list = v2 ? json.areas : [{ id: MAIN, legM: json.legM, ghosts: json.ghosts }];
  const baseOf = (id) => (base instanceof Map ? base.get(id) : base?.dist ? base : base?.[id]);
  const areas = new Map();
  for (const a of list) {
    const b = baseOf(a.id);
    if (!b) throw new Error(`No route for area ${a.id} of the ${json.id} network`);
    const L = b.turnS || b.total;
    if (Math.abs(L - a.legM) > 0.5) throw new Error(`The network is out of date with its route${v2 ? ` (area ${a.id})` : ''} (run tools/build_network.mjs)`);
    areas.set(a.id, { id: a.id, json: a, base: b, L, total: b.total, aprons: [] });
  }
  const nodes = new Map(json.nodes.map((n) => [n.id, { ...n, arms: [] }]));
  const edges = new Map(json.edges.map((e) => [e.id, { ...e, area: e.area || MAIN, s0: e.s[0], s1: e.s[1], len: e.lengthM }]));
  const first = areas.values().next().value;
  const net = { id: json.id, json, areas, multi: areas.size > 1, origin: json.origin || null,
    base: first.base, L: first.L, total: first.total, nodes, edges, presets: json.presets || [], keySplits: json.keySplits || {} };
  for (const e of edges.values()) {
    e.A = areas.get(e.area);
    if (!e.A) throw new Error(`Network edge ${e.id}: no area ${e.area}`);
    if (!(e.s0 >= 0 && e.s1 <= e.A.L && e.len === e.s1 - e.s0 && e.len % STEP === 0)) throw new Error(`Network edge ${e.id} is not on the route's 10 m samples`);
    nodes.get(e.from).arms.push({ e, dir: 1 });
    nodes.get(e.to).arms.push({ e, dir: -1 });
  }
  // aprons: an area's line along another area's edge, from a portal ({edge, dir, s: [s0, s1], u0}: its samples
  // s0…s1 ride the edge from forward metre u0, forward (dir +1) or backward)
  for (const a of list) for (const ap of a.aprons || []) {
    const e = edges.get(ap.edge);
    if (!e) throw new Error(`Area ${a.id}: apron on a missing edge ${ap.edge}`);
    areas.get(a.id).aprons.push({ e, dir: ap.dir, s0: ap.s[0], s1: ap.s[1], u0: ap.u0 });
  }
  return net;
}
const MAIN = 'main';   // the one area of a network-1 (a single base line)

/** Base-route position (the app's route frame) of a point `u` metres along a traversal, on its edge's own area's line. */
export function worldS(net, t, u) {
  return t.dir > 0 ? t.e.s0 + u : t.e.A.total - (t.e.s1 - u);
}

/**
 * The same point on area `areaId`'s line: its own edge's, or an apron of that area along the edge; null when
 * that area doesn't cover it.
 */
export function areaS(net, areaId, t, u) {
  if (t.e.area === areaId) return worldS(net, t, u);
  const A = net.areas.get(areaId);
  if (!A) return null;
  const f = t.dir > 0 ? u : t.e.len - u;   // forward metre along the edge
  for (const ap of A.aprons) {
    if (ap.e !== t.e) continue;
    const k = ap.dir > 0 ? f - ap.u0 : ap.u0 - f;   // metres into the apron (its outbound way)
    if (k < -0.01 || k > ap.s1 - ap.s0 + 0.01) continue;
    const s = ap.s0 + Math.max(0, Math.min(ap.s1 - ap.s0, k));
    return (t.dir > 0) === (ap.dir > 0) ? s : A.total - s;   // riding the apron's way, or its mirrored return
  }
  return null;
}
/** The base route of the area an edge lives on. */
export const baseOf = (t) => t.e.A.base;
export const startNode = (t) => (t.dir > 0 ? t.e.from : t.e.to);
export const endNode = (t) => (t.dir > 0 ? t.e.to : t.e.from);
export const climbOf = (t) => t.e.climbM[t.dir > 0 ? 0 : 1];
export const towardOf = (t) => t.e.toward?.[t.dir > 0 ? 0 : 1] || t.e.name;

/** Flat direction (x east, z south: the 3D world's frame) from u0 to u1 along a traversal. */
function headingAlong(net, t, u0, u1) {
  const a = routeAt(baseOf(t), worldS(net, t, Math.max(0, Math.min(t.e.len, u0))));
  const b = routeAt(baseOf(t), worldS(net, t, Math.max(0, Math.min(t.e.len, u1))));
  const k = 6378137 * Math.PI / 180;
  return unit2({ x: (b.lon - a.lon) * k * Math.cos((a.lat * Math.PI) / 180), z: -(b.lat - a.lat) * k });
}

const GLYPH = (o) => (o.back ? '↶' : Math.abs(o.turn) < 25 ? '↑' : o.turn < 0 ? (o.turn > -65 ? '↖' : o.turn > -135 ? '←' : '↙') : (o.turn < 65 ? '↗' : o.turn < 135 ? '→' : '↘'));
const LABEL = (o) => (o.back ? 'Back' : Math.abs(o.turn) < 25 ? 'Straight' : o.turn < 0 ? (o.turn > -65 ? 'Bear left' : o.turn > -135 ? 'Left' : 'Sharp left') : (o.turn < 65 ? 'Bear right' : o.turn < 135 ? 'Right' : 'Sharp right'));

/**
 * The ways on from the end of traversal `t`: every arm of the junction it arrives at, each with its turn
 * angle (° right of straight on; "back" is −180, the leftmost), sorted left to right.
 */
export function optionsAt(net, t) {
  net._opts ||= new Map();
  const key = travKey(t);
  if (net._opts.has(key)) return net._opts.get(key);
  const node = net.nodes.get(endNode(t));
  // two turn angles: `angle` on the first 15 m (the curve the ride draws and its speed cap), `turn` 10–40 m out
  // (what the street does: the label, the order, straight on). A line that passes a junction twice rounds its
  // corners, so its first metres can bend ~30° off the street's way (F84: "bear left" for Forbes straight on at SQ)
  const turnOf = (u0, u1) => {
    const fwd = headingAlong(net, t, t.e.len - u1, t.e.len - u0);
    const right = { x: -fwd.z, z: fwd.x };
    return (t2) => { const h = headingAlong(net, t2, u0, u1); return deg(Math.atan2(h.x * right.x + h.z * right.z, h.x * fwd.x + h.z * fwd.z)); };
  };
  const near = turnOf(0, HEADING_M), far = turnOf(LABEL_M0, LABEL_M1);
  const list = node.arms.map((a) => {
    const t2 = { e: a.e, dir: a.dir };
    const back = a.e === t.e && a.dir === -t.dir;
    const angle = back ? -180 : near(t2), turn = back ? -180 : far(t2);
    const o = { t: t2, key: travKey(t2), back, angle, turn, to: net.nodes.get(endNode(t2)).name, toward: towardOf(t2),
      lengthM: t2.e.len, climbM: climbOf(t2) };
    o.glyph = GLYPH(o); o.label = LABEL(o);
    return o;
  }).sort((a, b) => a.turn - b.turn);
  net._opts.set(key, list);
  return list;
}

/** Straight on: the arm with the smallest turn in the street (not back), or back at a dead end. */
export function straightOn(options) {
  let best = null;
  for (const o of options) if (!o.back && (!best || Math.abs(o.turn ?? o.angle) < Math.abs(best.turn ?? best.angle))) best = o;
  return best || options.find((o) => o.back) || null;
}

/**
 * Sharp corners inside an edge, off its junctions (F82): [{u, angle}] at forward metre u, the turn (°) over
 * ±BEND.arcM of the edge's line, one per corner (its sharpest point), only those over CORNER.minDeg. Cached.
 */
export function edgeBends(net, e) {
  net._bends ||= new Map();
  if (net._bends.has(e.id)) return net._bends.get(e.id);
  const t = { e, dir: 1 }, out = [];
  const k = 6378137 * Math.PI / 180;
  const xy = (u) => { const q = routeAt(baseOf(t), worldS(net, t, u)); return { x: q.lon * k * Math.cos((q.lat * Math.PI) / 180), z: -q.lat * k }; };
  let run = null;
  for (let u = BEND.endM; u <= e.len - BEND.endM; u += BEND.scanM) {
    const a = xy(u - BEND.arcM), b = xy(u), c = xy(u + BEND.arcM);
    let d = Math.atan2(c.z - b.z, c.x - b.x) - Math.atan2(b.z - a.z, b.x - a.x);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const angle = Math.abs(deg(d));
    if (angle >= CORNER.minDeg) { if (!run || angle > run.angle) run = { u, angle: run ? Math.max(run.angle, angle) : angle }; }
    else if (run) { out.push(run); run = null; }
  }
  if (run) out.push(run);
  net._bends.set(e.id, out);
  return out;
}

/** Speed limit (m/s) through a turn of `angle` degrees; null when it needs none. */
export function cornerSpeed(angle) {
  const a = Math.abs(angle);
  if (a < CORNER.minDeg) return null;
  // 60° → 10 m/s (36 km/h), 90° → 7.5, 135° → 5, 180° (U-turn) → 3.5
  const pts = [[60, 10], [90, 7.5], [135, 5], [180, 3.5]];
  for (let i = 1; i < pts.length; i++) {
    if (a <= pts[i][0]) { const [a0, v0] = pts[i - 1], [a1, v1] = pts[i]; return v0 + ((a - a0) / (a1 - a0)) * (v1 - v0); }
  }
  return 3.5;
}

/**
 * A ride on a network: the path (planned, or chosen as you go) and the path route the session rides.
 * Events: "change" (the path ahead changed: a choice, or the path was refilled).
 */
export class NetRide extends EventTarget {
  /**
   * @param net     loadNetwork()
   * @param route   the path route object to fill (makePathRoute); its arrays are replaced in place
   * @param plan    traversal keys (["e1+", "e3+"]) ridden round and round; null: straight on from `first`
   */
  constructor(net, route, { plan = null, first = null } = {}) {
    super();
    this.net = net;
    this.route = route;
    this.plan = plan ? plan.map((k) => this.trav(k)) : null;
    this.first = this.plan ? this.plan[0] : this.trav(first);
    this.reset();
  }

  trav(key) {
    const m = /^(.+)([+-])$/.exec(key || '');
    const e = m && this.net.edges.get(m[1]);
    if (!e) throw new Error(`No network edge ${key}`);
    return { e, dir: m[2] === '+' ? 1 : -1 };
  }

  /** Back to the start of the plan, nothing chosen. */
  reset() {
    this.entries = [{ t: this.first, p0: 0, planStep: this.plan ? 0 : null }];
    this.p = 0;
    this.lockedAt = -1;   // index of the last entry whose leading junction is locked
    this._fill(AHEAD_M);
    this._rebuild();
  }

  get lapM() { return this.plan ? this.plan.reduce((s, t) => s + t.e.len, 0) : null; }
  get lapClimbM() { return this.plan ? this.plan.reduce((s, t) => s + climbOf(t), 0) : null; }

  /** Index of the entry holding path metre p. */
  entryAt(p) {
    const E = this.entries;
    let lo = 0, hi = E.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (E[mid].p0 <= p) lo = mid; else hi = mid - 1; }
    return lo;
  }
  endOf(i) { const x = this.entries[i]; return x.p0 + x.t.e.len; }

  /** What the path does after entry i when nothing is chosen: the plan's next step, else straight on. */
  _next(i) {
    const prev = this.entries[i];
    const opts = optionsAt(this.net, prev.t);
    const at = this._planStepOf(prev);
    if (at != null) {
      const step = (at + 1) % this.plan.length;
      const o = opts.find((x) => same(x.t, this.plan[step]));
      if (o) return { t: o.t, planStep: step };
    }
    return { t: straightOn(opts).t, planStep: null };
  }
  /** Which plan step an entry is: its own, or — off the plan — the step that rides the same way (rejoining). */
  _planStepOf(x) {
    if (!this.plan) return null;
    if (x.planStep != null) return x.planStep;
    const j = this.plan.findIndex((t) => same(t, x.t));
    return j < 0 ? null : j;
  }
  _fill(toP) {
    while (this.endOf(this.entries.length - 1) < toP) {
      const i = this.entries.length - 1;
      this.entries.push({ ...this._next(i), p0: this.endOf(i) });
    }
  }

  /** Lay the path out as a route: 10 m samples copied from the base route (edges sit on its samples; each edge from its own area's line). */
  _rebuild() {
    const net = this.net, r = this.route;
    const n = Math.round(this.endOf(this.entries.length - 1) / STEP) + 1;
    const dist = new Float64Array(n), lat = new Float64Array(n), lon = new Float64Array(n), ele = new Float64Array(n), grade = new Float64Array(n);
    let k = 0;
    for (const x of this.entries) {
      const len = x.t.e.len, first = k === 0 ? 0 : 1;   // a junction's sample is shared with the last entry
      const base = baseOf(x.t);
      for (let u = first * STEP; u <= len; u += STEP) {
        const i = Math.round(worldS(net, x.t, u) / STEP) % (base.dist.length - 1);
        dist[k] = k * STEP; lat[k] = base.lat[i]; lon[k] = base.lon[i]; ele[k] = base.ele[i]; grade[k] = base.grade[i];
        k++;
      }
    }
    let ascent = 0, descent = 0, minEle = Infinity, maxEle = -Infinity;
    for (let i = 0; i < n; i++) {
      minEle = Math.min(minEle, ele[i]); maxEle = Math.max(maxEle, ele[i]);
      if (i) { const d = ele[i] - ele[i - 1]; if (d > 0) ascent += d; else descent -= d; }
    }
    Object.assign(r, { dist, lat, lon, ele, grade, total: dist[n - 1], ascent, descent, minEle, maxEle });
    this.version = (this.version || 0) + 1;
  }

  /** The rider is at path metre p: lock the choice close to a junction, keep the path long enough. */
  update(p) {
    this.p = p;
    const i = this.entryAt(p);
    if (this.endOf(i) - p <= LOCK_M) this.lockedAt = Math.max(this.lockedAt, i);
    if (this.endOf(this.entries.length - 1) - p < REFILL_M) {
      this._fill(p + AHEAD_M);
      this._rebuild();
      this.dispatchEvent(new Event('change'));
    }
  }

  /** The next junction ahead of path metre p: where, how far, the options, which is picked, locked or not. */
  upcoming(p = this.p) {
    const i = this.entryAt(p);
    const opts = optionsAt(this.net, this.entries[i].t);
    const next = this.entries[i + 1];
    const end = this.endOf(i);
    return { i, node: this.net.nodes.get(endNode(this.entries[i].t)), atP: end, distTo: end - p, options: opts,
      selected: Math.max(0, opts.findIndex((o) => same(o.t, next?.t))), locked: this.lockedAt >= i,
      onPlan: !!(this.plan && next?.planStep != null) };
  }

  /** The turn prompt for a rider at p going `speed` m/s, or null while it's too far off. */
  prompt(p = this.p, speed = 0) {
    const up = this.upcoming(p);
    if (up.distTo > Math.max(PROMPT_MIN_M, PROMPT_S * speed)) return null;
    return up;
  }

  /** Move the choice at the next junction one way left (−1) or right (+1). Returns true if it changed. */
  choose(step, p = this.p) {
    const up = this.upcoming(p);
    if (up.locked || up.distTo <= LOCK_M) return false;
    const j = Math.max(0, Math.min(up.options.length - 1, up.selected + Math.sign(step)));
    if (j === up.selected) return false;
    return this.pick(up.options[j].key, p);
  }

  /** Take a given way (traversal key) at the next junction. */
  pick(key, p = this.p) {
    const up = this.upcoming(p);
    if (up.locked || up.distTo <= LOCK_M) return false;
    const o = up.options.find((x) => x.key === key);
    if (!o) return false;
    const prev = this.entries[up.i], at = this._planStepOf(prev);
    const step = at != null ? (at + 1) % this.plan.length : null;
    const planStep = step != null && same(o.t, this.plan[step]) ? step : this._planStepOf({ t: o.t, planStep: null });
    this.entries.length = up.i + 1;
    this.entries.push({ t: o.t, p0: up.atP, planStep });
    this._fill(p + AHEAD_M);
    this._rebuild();
    this.dispatchEvent(new Event('change'));
    return true;
  }

  /** Lap on the plan (1-based): one more each time the plan's loop is completed, on plan. */
  lapAt(p) {
    if (!this.plan) return 1;
    const last = this.plan.length - 1;
    let laps = 1;
    for (let i = 0; i < this.entries.length && this.endOf(i) <= p; i++) if (this.entries[i].planStep === last) laps++;
    return laps;
  }

  /** The stretch the ride-screen profile shows: the current lap on plan, else this edge and the next. */
  profileSpan(p) {
    const lap = this.lapM;
    const i = this.entryAt(p);
    if (lap && this.entries[i].planStep != null) {
      // back to where this lap began (the last entry with planStep 0 at or before i)
      let j = i;
      while (j > 0 && this.entries[j].planStep !== 0) j--;
      if (this.entries[j].planStep === 0) return [this.entries[j].p0, this.entries[j].p0 + lap];
    }
    return [this.entries[i].p0, this.endOf(Math.min(this.entries.length - 1, i + 1))];
  }

  /** Base-route position (the 3D world's) of path metre p (on its edge's own area's line). */
  worldS(p) {
    const i = this.entryAt(p), x = this.entries[i];
    return worldS(this.net, x.t, Math.max(0, Math.min(x.t.e.len, p - x.p0)));
  }

  /** Where path metre p is: { area, s } on `area`'s line when that area covers it (own edge or apron), else on its edge's own. */
  worldAt(p, area = null) {
    const x = this.entries[this.entryAt(p)], u = Math.max(0, Math.min(x.t.e.len, p - x.p0));
    if (area != null && area !== x.t.e.area) { const s = areaS(this.net, area, x.t, u); if (s != null) return { area, s }; }
    return { area: x.t.e.area, s: worldS(this.net, x.t, u) };
  }
  /**
   * The next U-turn on the path within `reach` metres of path metre p ("Back" at a junction, or a hairpin that
   * turns like one): its path metre, or null. The city's oncoming traffic keeps from passing you just before it
   * (after the turn it would be ahead of you in your own lane).
   */
  uturnAhead(p, reach = 800) {
    for (let j = this.entryAt(p) + 1; j < this.entries.length && this.entries[j].p0 - p <= reach; j++) {
      const J = this._junction(j);
      if (J && (J.back || Math.abs(J.angle) > 150)) return J.P;
    }
    return null;
  }

  /** Does area `area`'s line cover path metre p? */
  covers(area, p) {
    const x = this.entries[this.entryAt(p)];
    return x.t.e.area === area || areaS(this.net, area, x.t, Math.max(0, Math.min(x.t.e.len, p - x.p0))) != null;
  }
  /**
   * The area to draw at path metre p, given the one drawn now: it keeps drawing while it covers p and the next
   * SWAP_AHEAD_M; else the area that covers p and reaches furthest ahead (so the swap happens inside an apron,
   * where both show the same streets). One area: always it.
   */
  areaFor(p, current = null) {
    const net = this.net;
    if (!net.multi) return net.areas.keys().next().value;
    if (current != null && this.covers(current, p) && this.covers(current, p + SWAP_AHEAD_M / 2) && this.covers(current, p + SWAP_AHEAD_M)) return current;
    let best = null, reach = -1;
    for (const id of net.areas.keys()) {
      if (!this.covers(id, p)) continue;
      let d = 0;
      while (d < 2000 && this.covers(id, p + d + 50)) d += 50;
      if (d > reach || (d === reach && id === current)) { reach = d; best = id; }
    }
    return best ?? this.entries[this.entryAt(p)].t.e.area;
  }
  /** The areas the path is in from `behind` metres back to `ahead` metres on (the world keeps these loaded). */
  areasNear(p, ahead = PRELOAD_M, behind = RELEASE_M) {
    const out = new Set();
    for (let i = this.entryAt(Math.max(0, p - behind)); i < this.entries.length && this.entries[i].p0 <= p + ahead; i++) out.add(this.entries[i].t.e.area);
    return out;
  }

  /** The junction between entries i−1 and i: its curve radius, or 0 when the path runs straight on along the base route. */
  _junction(i) {
    if (i <= 0 || i >= this.entries.length) return null;
    const a = this.entries[i - 1], b = this.entries[i];
    // straight on along the base route: the same base position, but not at its own U-turns (the far end of the
    // way out, L, and the start, 0 = total), where carrying on along the base route means turning round. Across
    // areas: seamless on every line that covers both sides (an area's line running on into its apron)
    let seamless = null;
    for (const A of this.net.areas.values()) {
      const sa = areaS(this.net, A.id, a.t, a.t.e.len), sb = areaS(this.net, A.id, b.t, 0);
      if (sa == null || sb == null) continue;
      const atTurn = (x) => x < 0.5 || Math.abs(x - A.L) < 0.5 || A.total - x < 0.5;
      const here = Math.abs(sa - sb) < 0.5 && !atTurn(sa);
      seamless = seamless == null ? here : seamless && here;
    }
    if (seamless) return null;
    const o = optionsAt(this.net, a.t).find((x) => same(x.t, b.t));
    const angle = o ? o.angle : 0;
    const R = o?.back || Math.abs(angle) > 150 ? UTURN_R : Math.abs(angle) < 25 ? PASS_R : angle > 0 ? RIGHT_R : TURN_R;   // (a hairpin turns like a U-turn)
    return { P: b.p0, R, angle, back: !!o?.back };
  }

  /** Speed cap (m/s) at path metre p for the turn at the next (or the current) junction, or a sharp corner ahead inside a segment; null: none. */
  speedCap(p) {
    const i = this.entryAt(p);
    let cap = null;
    // corners inside segments (F82): the one the rider is in, or any within braking reach ahead
    for (let j = i; j < this.entries.length && this.entries[j].p0 <= p + 150; j++) {
      const x = this.entries[j];
      for (const c of edgeBends(this.net, x.t.e)) {
        const P = x.p0 + (x.t.dir > 0 ? c.u : x.t.e.len - c.u), d = P - p;
        if (d < -BEND.holdM || d > 150) continue;
        const v = cornerSpeed(c.angle);
        const allowed = Math.sqrt(v * v + 2 * CORNER.decel * Math.max(0, d - BEND.holdM));
        cap = cap == null ? allowed : Math.min(cap, allowed);
      }
    }
    for (const j of [i, i + 1]) {
      const J0 = this._junction(j);
      const J = J0 && { ...J0, R: this.net._fits?.get(`${travKey(this.entries[j - 1].t)}>${travKey(this.entries[j].t)}`) ?? J0.R };
      // tighter curves slow you more: the angle's speed, scaled for the curve's size
      const v = J && cornerSpeed(J.angle) && cornerSpeed(J.angle) * Math.sqrt(Math.min(1, J.R / TURN_R));
      if (v == null) continue;
      const d = J.P - p;   // + before the junction
      if (d < -J.R) continue;
      const allowed = Math.sqrt(v * v + 2 * CORNER.decel * Math.max(0, d - J.R));
      cap = cap == null ? allowed : Math.min(cap, allowed);
    }
    return cap != null && cap < 25 ? cap : null;   // (above 90 km/h it holds nobody back)
  }

  /**
   * The pose at path metre p (riderPose's shape: pos, fwd, flat, right, lateral, centre), on the base route
   * (route + its world index), `lane` × road width right of the centre line. Through a junction it follows a
   * cubic curve from the pose TURN_R before it on the way in to the pose TURN_R after it on the way out.
   */
  pose(p, index, lane, area = null) {
    const i = this.entryAt(p), x = this.entries[i], u = p - x.p0;
    const here = this._fit(i, index), next = this._fit(i + 1, index);
    if (here && u < here.R) return this._curve(i, here, p, index, lane, area);
    if (next && x.t.e.len - u < next.R) return this._curve(i + 1, next, p, index, lane, area);
    return this._basePose(x, u, index, lane, area);
  }
  /**
   * The junction with its curve fitted to the real streets: the turn's own radius, or wider (up to +9 m) where
   * the mapped corner is so tight the curve would swing faster than 20°/m. Cached per pair of ways.
   */
  _fit(i, index) {
    const J = this._junction(i);
    if (!J) return null;
    const a = this.entries[i - 1], b = this.entries[i];
    const key = `${travKey(a.t)}>${travKey(b.t)}`;
    const cache = (this.net._fits ||= new Map());
    if (!cache.has(key)) {
      let R = J.R;
      for (const r of [J.R, J.R + 3, J.R + 6, J.R + 9]) {
        R = r;
        if (r > Math.min(a.t.e.len, b.t.e.len) / 2) break;
        if (this._turnRate(i, { ...J, R: r }, index) <= 20) break;
      }
      cache.set(key, R);
    }
    return { ...J, R: cache.get(key) };
  }
  _turnRate(i, J, index) {
    let prev = null, worst = 0;
    for (let p = J.P - J.R; p <= J.P + J.R; p += 0.5) {
      const q = this._curve(i, J, p, index, 0.22);
      if (prev) {
        const c = Math.max(-1, Math.min(1, q.flat.x * prev.flat.x + q.flat.z * prev.flat.z));
        const d = Math.hypot(q.pos.x - prev.pos.x, q.pos.z - prev.pos.z) || 0.5;
        worst = Math.max(worst, (Math.acos(c) * 180) / Math.PI / d);
      }
      prev = q;
    }
    return worst;
  }
  /** A pose on a traversal's line: on area `area`'s line (the area drawn) where it covers the spot, else on its own. `index`: the route index, or a function of the area id. */
  _basePose(x, u, index, lane, area = null) {
    const uu = Math.max(0, Math.min(x.t.e.len, u));
    const s = area != null && area !== x.t.e.area ? areaS(this.net, area, x.t, uu) : null;
    const A = s != null ? this.net.areas.get(area) : x.t.e.A;
    return riderPose(A.base, typeof index === 'function' ? index(A.id) : index, s ?? worldS(this.net, x.t, uu), lane, { uturns: false });
  }
  _curve(i, J, p, index, lane, area = null) {
    const a = this.entries[i - 1], b = this.entries[i];
    const A = this._basePose(a, a.t.e.len - J.R, index, lane, area), B = this._basePose(b, J.R, index, lane, area);
    const w = Math.max(0, Math.min(1, (p - (J.P - J.R)) / (2 * J.R)));
    const chord = Math.hypot(B.pos.x - A.pos.x, B.pos.z - A.pos.z);
    const H = Math.max(chord, 1.2 * J.R);
    const tA = { x: A.flat.x * H, z: A.flat.z * H }, tB = { x: B.flat.x * H, z: B.flat.z * H };
    const w2 = w * w, w3 = w2 * w;
    const h00 = 2 * w3 - 3 * w2 + 1, h10 = w3 - 2 * w2 + w, h01 = -2 * w3 + 3 * w2, h11 = w3 - w2;
    const d00 = 6 * w2 - 6 * w, d10 = 3 * w2 - 4 * w + 1, d01 = -6 * w2 + 6 * w, d11 = 3 * w2 - 2 * w;
    const sm = w2 * (3 - 2 * w), dsm = 6 * w - 6 * w2;
    const pos = {
      x: h00 * A.pos.x + h10 * tA.x + h01 * B.pos.x + h11 * tB.x,
      y: A.pos.y + (B.pos.y - A.pos.y) * sm,
      z: h00 * A.pos.z + h10 * tA.z + h01 * B.pos.z + h11 * tB.z,
    };
    const dx = d00 * A.pos.x + d10 * tA.x + d01 * B.pos.x + d11 * tB.x;
    const dz = d00 * A.pos.z + d10 * tA.z + d01 * B.pos.z + d11 * tB.z;
    const dy = (B.pos.y - A.pos.y) * dsm;
    const fl = Math.hypot(dx, dz) || 1, l3 = Math.hypot(dx, dy, dz) || 1;
    const flat = { x: dx / fl, y: 0, z: dz / fl };
    const fwd = { x: dx / l3, y: dy / l3, z: dz / l3 };
    const right = { x: -flat.z, y: 0, z: flat.x };
    const lateral = A.lateral + (B.lateral - A.lateral) * sm;
    const centre = { x: pos.x - right.x * lateral, y: pos.y - (A.pos.y - A.centre.y), z: pos.z - right.z * lateral };
    return { pos, fwd, flat, right, lateral, centre };
  }

  /** Every edge as a lat/lon line (for the minimap), built once per network. */
  edgeLines() { return edgeLines(this.net); }

  /** The first `len` metres of a way on (an option at a junction) as a lat/lon line. */
  stub(t, len = 200) {
    const base = baseOf(t), out = { lat: [], lon: [] };
    for (let u = 0; u <= Math.min(len, t.e.len); u += STEP) {
      const i = Math.round(worldS(this.net, t, u) / STEP) % (base.dist.length - 1);
      out.lat.push(base.lat[i]); out.lon.push(base.lon[i]);
    }
    return out;
  }

  /** Junction passes along the path between path metres a and b (for start chips and arches). */
  nodesBetween(a, b) {
    const out = [];
    for (let i = 0; i < this.entries.length; i++) {
      const x = this.entries[i];
      if (x.p0 > b) break;
      if (x.p0 >= a) out.push({ name: this.net.nodes.get(startNode(x.t)).name, atM: x.p0 });
    }
    return out;
  }
}

export const FOLLOW_AHEAD_M = 30;   // a follower holds on to its way this far ahead of it (a turn's curve: ≤ 22 m)

/**
 * Someone else riding a network ride's path (the pacer), on its own copy of that path. While the way it has come,
 * and the next FOLLOW_AHEAD_M metres, are still the rider's, it takes the rider's path as it is now (turns chosen
 * ahead of it included). When the rider changes a turn it has already passed (or is turning through), it keeps
 * the way it is on and carries on from there as the path would have: the plan, else straight on — and takes the
 * rider's path up again if it ever matches its own up to where it is (the turn changed back). So it never jumps. Positions are path metres, as for the rider; `pose`, `worldS`, `grade` and `latLon` place them.
 */
export class PathFollower {
  constructor(ride) {
    this.ride = ride;
    this.own = Object.create(NetRide.prototype);
    Object.assign(this.own, { net: ride.net, plan: ride.plan, first: ride.first, route: null, lockedAt: -1, entries: ride.entries.slice() });
    this.diverged = false;
    this.p = 0;
  }

  /** The follower is at path metre p (call as it moves): take up the rider's path while it still shares the way. */
  update(p) {
    this.p = p;
    const own = this.own, theirs = this.ride.entries;
    const k = own.entryAt(p + FOLLOW_AHEAD_M);
    let shared = theirs.length > k;
    for (let i = 0; shared && i <= k; i++) shared = same(own.entries[i].t, theirs[i].t) && own.entries[i].p0 === theirs[i].p0;
    if (shared) own.entries = theirs.slice();   // (the same way up to here: taking theirs moves nothing)
    this.diverged = !shared;
    if (own.endOf(own.entries.length - 1) - p < REFILL_M) own._fill(p + AHEAD_M);
    return this;
  }

  worldS(p) { return this.own.worldS(p); }
  worldAt(p, area = null) { return this.own.worldAt(p, area); }
  pose(p, index, lane, area = null) { return this.own.pose(p, index, lane, area); }
  _at(p) { const x = this.own.entries[this.own.entryAt(p)]; return routeAt(baseOf(x.t), this.worldS(p)); }
  /** % grade at path metre p (the base route's, the way the follower rides it). */
  grade(p) { return this._at(p).grade; }
  /** Where path metre p is on the map. */
  latLon(p) { const a = this._at(p); return { lat: a.lat, lon: a.lon }; }
}

/**
 * A path route: the object the session rides (a route like gpx.js builds, open, 10 m samples) for a
 * preset on a network, with `netRide` driving it and `base` the route the 3D world is built around.
 */
export function makePathRoute(net, preset, { id, name, park } = {}) {
  const route = { name: name || preset.name, id: id || preset.id, park: park || net.base.park, closed: false,
    hasElevation: net.base.hasElevation, network: net, base: net.base, preset: preset.id, tags: preset.tags || [] };
  // a preset rides its plan round and round; a free ride (no plan) starts on `first` and goes where you turn;
  // a one-way plan (your own route that ends somewhere else) finishes at its end
  route.netRide = new NetRide(net, route, preset.path ? { plan: preset.path } : { first: preset.first });
  route.free = !preset.path;
  route.netOpen = !!preset.path && !planCloses(net, preset.path);
  route.lapM = route.netRide.lapM;
  route.lapClimbM = route.netRide.lapClimbM;
  // named start points: the junctions along the first lap (a free ride: its first 25 km), then the base route's
  // own stops where the plan rides them forward
  const span = route.lapM || 25000;
  const stops = route.netRide.nodesBetween(0, span - 1);
  for (const x of route.netRide.entries) {
    if (x.p0 >= span) break;
    if (x.t.dir < 0) continue;
    for (const s of baseOf(x.t).stops || []) if (s.atM > x.t.e.s0 && s.atM < x.t.e.s1) stops.push({ name: s.name, atM: x.p0 + s.atM - x.t.e.s0 });
  }
  route.stops = stops.sort((a, b) => a.atM - b.atM);
  if (route.free) route.stops = route.stops.filter((st, i, all) => all.findIndex((o) => o.name === st.name) === i);   // each junction once
  return route;
}

/** Every edge as a lat/lon line, each from its own area's line (the minimap, the planner), built once per network. */
export function edgeLines(net) {
  if (!net._lines) {
    net._lines = [...net.edges.values()].map((e) => {
      const n = e.len / STEP + 1, lat = new Float64Array(n), lon = new Float64Array(n), base = e.A.base;
      for (let k = 0; k < n; k++) { const i = e.s0 / STEP + k; lat[k] = base.lat[i]; lon[k] = base.lon[i]; }
      return { id: e.id, e, lat, lon };
    });
  }
  return net._lines;
}

/** Does a plan (traversal keys) end where it starts, so it can be ridden round and round? */
export function planCloses(net, keys) {
  if (!keys?.length) return false;
  const t = (k) => { const m = /^(.+)([+-])$/.exec(k); return { e: net.edges.get(m[1]), dir: m[2] === '+' ? 1 : -1 }; };
  return endNode(t(keys[keys.length - 1])) === startNode(t(keys[0]));
}

/**
 * The map planner (js/app.js): the ways on from where a plan has got to — from a junction (no steps yet) every
 * arm, after a step every way out of the junction it arrives at (back included). [{key, t, toward, lengthM, climbM}]
 */
export function planNext(net, keys, startId = null) {
  const node = keys.length ? (() => { const m = /^(.+)([+-])$/.exec(keys[keys.length - 1]); const e = net.edges.get(m[1]); return m[2] === '+' ? e.to : e.from; })() : startId;
  const n = net.nodes.get(node);
  if (!n) return [];
  return n.arms.map((a) => { const t = { e: a.e, dir: a.dir }; return { key: travKey(t), t, toward: towardOf(t), lengthM: a.e.len, climbM: climbOf(t), to: net.nodes.get(endNode(t)).name }; });
}

/** Edge ids from spec keys ("E>H+") and back, for routes saved in settings (ids can change when the network grows). */
export function keysToIds(net, specKeys) {
  const out = [];
  const edges = [...net.edges.values()];
  for (const k of specKeys) {
    const m = /^(.+)>(.+)([+-])$/.exec(k);
    if (!m) return null;
    const e = edges.find((x) => x.key === `${m[1]}>${m[2]}`);
    if (e) { out.push(`${e.id}${m[3]}`); continue; }
    // a segment a new junction split (a saved route from before): the network's key history knows its pieces
    // (F40: the chain of fewest pieces can be another way, e.g. E>H's Jail Trail vs the Smithfield Street Bridge)
    const hist = splitKeys(net, `${m[1]}>${m[2]}`);
    if (hist) {
      const ids = hist.map((key) => edges.find((x) => x.key === key)?.id);
      if (ids.some((id) => !id)) return null;
      out.push(...(m[3] === '+' ? ids.map((id) => `${id}+`) : ids.reverse().map((id) => `${id}-`)));
      continue;
    }
    // the segment was split by a new junction (a saved route from before): the chain of new segments that runs
    // the same way from its start to its end, through junctions only (no dead ends), shortest first
    const [from, to] = m[3] === '+' ? [m[1], m[2]] : [m[2], m[1]];
    const chain = splitChain(net, from, to, m[3] === '+' ? 1 : -1);
    if (!chain) return null;
    out.push(...chain);
  }
  return out;
}
function splitKeys(net, key, depth = 0) {
  const pieces = net.keySplits?.[key];
  if (!pieces || depth > 8) return null;
  const has = (k) => [...net.edges.values()].some((x) => x.key === k);
  const out = [];
  for (const p of pieces) {
    if (has(p)) { out.push(p); continue; }
    const sub = splitKeys(net, p, depth + 1);
    if (!sub) return null;
    out.push(...sub);
  }
  return out;
}
function splitChain(net, from, to, dir) {
  // forward pieces (+): edges whose key runs from→…→to in base order; backward (-): the same chain reversed
  const fwd = [...net.edges.values()].filter((e) => !net.nodes.get(e.to)?.deadEnd && !net.nodes.get(e.from)?.deadEnd);
  const [a, b] = dir > 0 ? [from, to] : [to, from];
  const queue = [[a, []]], seen = new Set([a]);
  while (queue.length) {
    const [node, path] = queue.shift();
    if (path.length > 4) continue;
    for (const e of fwd.filter((x) => x.from === node)) {
      const p = [...path, e];
      if (e.to === b) return (dir > 0 ? p : p.reverse()).map((x) => `${x.id}${dir > 0 ? '+' : '-'}`);
      if (!seen.has(e.to)) { seen.add(e.to); queue.push([e.to, p]); }
    }
  }
  return null;
}
export const idsToKeys = (net, ids) => ids.map((k) => { const m = /^(.+)([+-])$/.exec(k); return `${net.edges.get(m[1]).key}${m[2]}`; });
