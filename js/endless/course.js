// The endless map's course (user, 24 Nov 2026: "use the building blocks to create an endless map. Every mile the user
// should be prompted if they'd like to change the terrain type, using the turn mechanism (do nothing, stay the same.
// Options of flat, rolling, climb, descend). The map should progress through different biomes"; chose a seeded biome
// sequence, moderate grades, a slow day cycle). Pure: no three.js, so the tests ride it.
//
// The road is generated ahead of the rider in 10 m samples:
//   heading   a sum of slow sines (bounded to ±55° of the long-term direction, so the road never comes back on itself:
//             the world can find the nearest road sample by its forward coordinate); the quicker bends grow with the
//             biome's twistiness (alpine and coast roads wind, farm roads run straight)
//   grade     by the terrain type of each mile: flat 0–1 %, rolling ±3 %, climb 5–7 %, descend −4 to −6 % (moderate);
//             a change eases in over 250 m from the mile mark; the road never goes below sea level (a descent there
//             levels out) or above 4,500 m (a climb levels out)
//   biomes    a seeded sequence: each biome lasts 3–5 miles, blending into the next over half a mile; the order is
//             shuffled every round, never the same biome twice in a row
//
// EndlessRide is the session's turn ride (session.turnRide): prompt(), choose(), update(), like js/network.js NetRide,
// so the ride screen's turn prompt, the handlebar ◀ ▶ and A / D work unchanged. Its options are the four terrain
// types; doing nothing keeps the current one.

export const MILE_M = 1609.344;
export const STEP = 10;
export const BIOMES = ['farmland', 'forest', 'alpine', 'coast', 'desert', 'arctic'];
export const BIOME_LABEL = { farmland: 'Upstate farmland', forest: 'Northern forest and lakes', alpine: 'Alpine mountains', coast: 'Sea coast', desert: 'Desert canyon', arctic: 'Arctic tundra' };
export const MODES = ['flat', 'rolling', 'climb', 'descend'];
export const MODE_LABEL = { flat: 'Flat', rolling: 'Rolling', climb: 'Climb', descend: 'Descend' };
const MODE_GLYPH = { flat: '▬', rolling: '∿', climb: '◢', descend: '◣' };
const TWIST = { farmland: 0.45, forest: 0.8, alpine: 1.25, coast: 1.1, desert: 0.7, arctic: 0.55 };
export const PROMPT_S = 15, PROMPT_MIN_M = 120, LOCK_M = 30;
const EASE_M = 250, BLEND_M = MILE_M / 2, AHEAD_M = 6000, REFILL_M = 4000;
const START_ELE = 320, FLOOR_ELE = 2, CEIL_ELE = 4500;
export const ORIGIN = { lat: 43.0, lon: -75.0 };

/** A small seeded random number generator (mulberry32). */
export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The seeded biome plan: [{ biome, from, to }] (metres), out past `toS`. The same seed always gives the same plan. */
export function biomePlan(seed, toS) {
  const r = rng(seed * 7919 + 17), out = [];
  let s = 0, last = null, bag = [];
  while (s < toS) {
    let biome;
    if (!out.length) biome = 'farmland';   // (every ride starts in the farmland: CNY's and SKAN's country)
    else {
      if (!bag.length) { bag = BIOMES.slice(); for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; } }
      biome = bag.shift();
      if (biome === last) { bag.push(biome); biome = bag.shift(); }
    }
    const len = (3 + Math.floor(r() * 3)) * MILE_M;
    out.push({ biome, from: s, to: s + len });
    s += len; last = biome;
  }
  return out;
}

/** Which biomes are at s: { a, b, t } — blending from a to b by t (0: all a). */
export function biomeAt(plan, s) {
  let i = 0;
  while (i < plan.length - 1 && plan[i].to <= s) i++;
  const cur = plan[i], next = plan[i + 1], prev = plan[i - 1];
  if (next && s > cur.to - BLEND_M / 2) return { a: cur.biome, b: next.biome, t: smooth(cur.to - BLEND_M / 2, cur.to + BLEND_M / 2, s) };
  if (prev && s < cur.from + BLEND_M / 2) return { a: prev.biome, b: cur.biome, t: smooth(cur.from - BLEND_M / 2, cur.from + BLEND_M / 2, s) };
  return { a: cur.biome, b: cur.biome, t: 0 };
}

/** The target grade (%) of a terrain type at s (phase: the mode's own wave, seeded). */
export function modeGrade(mode, s, ph = 0) {
  switch (mode) {
    case 'flat': return 0.5 + 0.5 * Math.sin(s / 520 + ph);
    case 'rolling': return 3 * Math.sin((2 * Math.PI * s) / (700 + 160 * Math.sin(s / 2300 + ph)) + ph);
    case 'climb': return 6 + Math.sin(s / 330 + ph) * 0.8 + Math.sin(s / 97 + ph * 2) * 0.2;
    case 'descend': return -5 - Math.sin(s / 330 + ph) * 0.8 - Math.sin(s / 97 + ph * 2) * 0.2;
    default: return 0;
  }
}

/**
 * The course: samples from 0 out to `length`, regenerated past a mile mark when its terrain type changes.
 *   x, z (m: z the long-term direction, x to its right), heading (rad), ele (m), grade (%), dist (m)
 */
export class Course {
  constructor(seed = 1, startMode = 'rolling') {
    this.seed = seed;
    const r = rng(seed);
    this.ph = [0, 1, 2, 3, 4, 5].map(() => r() * 6.283);
    this.modeAt = [startMode];          // modeAt[k]: the terrain type of mile k (from k miles to k + 1)
    this.plan = [];
    this.sea = new Map();               // a coast stint's sea level (by its place in the plan): 110 m under the road where it starts
    this.n = 0;
    this.cap = 0;
    this._grow(1024);
  }
  _grow(cap) {
    const old = this, k = ['x', 'z', 'heading', 'ele', 'grade', 'dist'];
    const next = {};
    for (const key of k) { next[key] = new Float64Array(cap); if (old[key]) next[key].set(old[key].subarray(0, this.n)); }
    Object.assign(this, next); this.cap = cap;
  }
  get length() { return this.n ? (this.n - 1) * STEP : 0; }
  mode(mile) { while (this.modeAt.length <= mile) this.modeAt.push(this.modeAt[this.modeAt.length - 1]); return this.modeAt[mile]; }

  _twistAt(s) { const b = biomeAt(this.plan, s); return TWIST[b.a] * (1 - b.t) + TWIST[b.b] * b.t; }
  _heading(s) {
    const p = this.ph, k = this._twistAt(s);
    let h = 0.42 * Math.sin(s / 1400 + p[0]) + 0.16 * Math.sin(s / 610 + p[1]);
    h += k * (0.2 * Math.sin(s / 230 + p[2]) + 0.09 * Math.sin(s / 95 + p[3]));
    return Math.max(-0.96, Math.min(0.96, h));
  }
  /** The eased target grade at s, from the miles' terrain types. */
  _target(s) {
    const mile = Math.floor(s / MILE_M), m0 = mile * MILE_M;
    const cur = this.mode(mile), prev = mile ? this.mode(mile - 1) : cur;
    const g = modeGrade(cur, s, this.ph[4]);
    if (prev === cur || s - m0 >= EASE_M) return g;
    return modeGrade(prev, s, this.ph[4]) + (g - modeGrade(prev, s, this.ph[4])) * smooth(m0, m0 + EASE_M, s);
  }

  /** Generate out to `toS` metres. */
  extend(toS) {
    if (!this.plan.length || this.plan[this.plan.length - 1].to < toS + 2 * MILE_M) this.plan = biomePlan(this.seed, toS + 8 * MILE_M);
    const need = Math.ceil(toS / STEP) + 1;
    if (need > this.cap) this._grow(Math.max(need, this.cap * 2));
    for (let i = this.n; i < need; i++) this._sample(i);
    this.n = Math.max(this.n, need);
  }
  _sample(i) {
    const s = i * STEP;
    this.dist[i] = s;
    this.heading[i] = this._heading(s);
    if (i === 0) { this.x[0] = 0; this.z[0] = 0; this.ele[0] = START_ELE; this.grade[0] = this._target(0); return; }
    const h = (this.heading[i - 1] + this.heading[i]) / 2;
    this.x[i] = this.x[i - 1] + Math.sin(h) * STEP;
    this.z[i] = this.z[i - 1] + Math.cos(h) * STEP;
    let g = this._target(s);
    // the sea's level and a ceiling: a descent levels out above the sea, a climb below the highest passes
    const e0 = this.ele[i - 1];
    const floor = Math.max(FLOOR_ELE, this._coastFloor(s, e0));
    if (g < 0) g *= smooth(floor, floor + 60, e0);
    if (g > 0) g *= 1 - smooth(CEIL_ELE - 150, CEIL_ELE, e0);
    this.grade[i] = g;
    this.ele[i] = e0 + (g / 100) * STEP;
  }
  /** The plan entry (index) of the coast stint at or blending in at s, or −1. */
  _coastAt(s) {
    const P = this.plan;
    for (let k = 0; k < P.length; k++) if (P[k].biome === 'coast' && s >= P[k].from - BLEND_M && s < P[k].to + BLEND_M) return k;
    return -1;
  }
  /** Inside a coast stint the road keeps above the sea: its level is fixed where the stint begins (110 m under the road: a cliff road). */
  _coastFloor(s, e0) {
    const k = this._coastAt(s);
    if (k < 0) return 0;
    if (!this.sea.has(k)) this.sea.set(k, e0 - Math.max(8, Math.min(110, e0 * .85)));
    return this.sea.get(k) + 10;
  }
  /** The sea's level at s (the coast's; 0 elsewhere). */
  seaLevel(s) { const k = this._coastAt(s); return k >= 0 && this.sea.has(k) ? this.sea.get(k) : 0; }
  /** Change mile k's terrain type (and every mile after it, until the next change): regenerates from that mile. */
  setMode(mile, mode) {
    if (!MODES.includes(mode)) throw new Error(`unknown terrain type ${mode}`);
    this.mode(mile);
    const was = this.modeAt[mile];
    if (was === mode) return false;
    for (let k = mile; k < this.modeAt.length; k++) { if (k > mile && this.modeAt[k] !== was) break; this.modeAt[k] = mode; }
    const from = Math.max(1, Math.floor((mile * MILE_M) / STEP));
    for (const [k] of this.sea) if (this.plan[k].from - BLEND_M >= mile * MILE_M) this.sea.delete(k);   // (a stint not reached yet: its sea level again)
    for (let i = from; i < this.n; i++) this._sample(i);
    return true;
  }
  /** Linear lookups at s. */
  at(s) {
    const x = Math.max(0, Math.min(this.length, s)), i = Math.min(this.n - 2, Math.floor(x / STEP)), f = (x - i * STEP) / STEP;
    const L = (a) => a[i] + (a[i + 1] - a[i]) * f;
    return { x: L(this.x), z: L(this.z), ele: L(this.ele), grade: L(this.grade), heading: L(this.heading) };
  }
  /** The sample index whose forward coordinate z is nearest `z` (the road only goes forward). */
  indexAtZ(z) {
    let lo = 0, hi = this.n - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.z[mid] < z) lo = mid + 1; else hi = mid; }
    return lo;
  }
}

/**
 * The turn ride for the endless map: every mile mark a "junction" whose ways are the four terrain types. The prompt
 * shows ~15 s before the mark; ◀ ▶ moves the choice; it locks 30 m before; doing nothing keeps the terrain type.
 */
export class EndlessRide extends EventTarget {
  constructor(route, course) {
    super();
    this.route = route; this.course = course;
    this.p = 0; this.lockedAt = -1; this.version = 0;
    this.pending = new Map();   // mile → mode chosen in its prompt (applied when chosen, so the world sees it at once)
    this._fill(AHEAD_M);
  }
  reset() {
    this.p = 0; this.lockedAt = -1;
    this.course = this.route.course = new Course(this.course.seed, this.course.modeAt[0]);
    this._fill(AHEAD_M);
    this.dispatchEvent(Object.assign(new Event('change'), { fromS: 0 }));
  }
  _fill(toS) {
    this.course.extend(toS);
    this._rebuild();
  }
  _rebuild() {
    const C = this.course, n = C.n, r = this.route;
    const dist = C.dist.slice(0, n), ele = C.ele.slice(0, n), grade = C.grade.slice(0, n), lat = new Float64Array(n), lon = new Float64Array(n);
    const kLon = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
    let ascent = 0, descent = 0, minEle = Infinity, maxEle = -Infinity;
    for (let i = 0; i < n; i++) {
      lat[i] = ORIGIN.lat + C.z[i] / 111320; lon[i] = ORIGIN.lon + C.x[i] / kLon;
      minEle = Math.min(minEle, ele[i]); maxEle = Math.max(maxEle, ele[i]);
      if (i) { const d = ele[i] - ele[i - 1]; if (d > 0) ascent += d; else descent -= d; }
    }
    Object.assign(r, { dist, ele, grade, lat, lon, total: dist[n - 1], ascent, descent, minEle, maxEle });
    this.version++;
  }
  /** The rider is at p: lock the choice close to the mark, keep the road long enough ahead. */
  update(p) {
    this.p = p;
    const mark = Math.ceil(p / MILE_M + 1e-9) * MILE_M;
    if (mark - p <= LOCK_M) this.lockedAt = Math.max(this.lockedAt, Math.round(mark / MILE_M));
    if (this.course.length - p < REFILL_M) {
      const from = this.course.length;
      this._fill(p + AHEAD_M);
      this.dispatchEvent(Object.assign(new Event('change'), { fromS: from, grown: true }));
    }
  }
  /** The next mile mark ahead of p, its options and the one picked. */
  upcoming(p = this.p) {
    const k = Math.floor(p / MILE_M + 1e-9) + 1, atP = k * MILE_M;
    const cur = this.course.mode(k), was = this.course.mode(k - 1);
    const options = MODES.map((m) => ({ key: m, mode: m, label: MODE_LABEL[m], glyph: MODE_GLYPH[m], back: false,
      toward: m === was ? `${MODE_LABEL[m].toLowerCase()}, as now` : MODE_LABEL[m].toLowerCase(), lengthM: MILE_M, climbM: this._climbOf(m, atP) }));
    const b = biomeAt(this.course.plan, atP);
    return { i: k, node: { id: `mile-${k}`, name: `Mile ${k}${b.t > .05 && b.t < .95 ? '' : ` · ${BIOME_LABEL[b.t >= .5 ? b.b : b.a]}`}` }, atP, distTo: atP - p,
      options, selected: MODES.indexOf(cur), locked: this.lockedAt >= k, onPlan: false, mile: k };
  }
  _climbOf(mode, from) {
    let c = 0;
    for (let s = from; s < from + MILE_M; s += 50) c += Math.max(0, modeGrade(mode, s, this.course.ph[4])) * 0.5;
    return c;
  }
  /** The prompt for a rider at p going `speed` m/s, or null while the mark is too far off. */
  prompt(p = this.p, speed = 0) {
    const up = this.upcoming(p);
    if (up.distTo > Math.max(PROMPT_MIN_M, PROMPT_S * speed)) return null;
    return up;
  }
  /** Move the choice one way (−1 / +1). Returns true if it changed. */
  choose(step, p = this.p) {
    const up = this.upcoming(p);
    if (up.locked || up.distTo <= LOCK_M) return false;
    const j = Math.max(0, Math.min(MODES.length - 1, up.selected + Math.sign(step)));
    if (j === up.selected) return false;
    return this.pick(MODES[j], p);
  }
  pick(mode, p = this.p) {
    const up = this.upcoming(p);
    if (up.locked || up.distTo <= LOCK_M) return false;
    if (!this.course.setMode(up.mile, mode)) return false;
    this._rebuild();
    this.dispatchEvent(Object.assign(new Event('change'), { fromS: up.atP }));
    return true;
  }
  lapAt() { return 1; }
  /** The terrain type and biome under p (the HUD). */
  stateAt(p = this.p) {
    const mile = Math.floor(p / MILE_M), b = biomeAt(this.course.plan, p);
    const mode = this.course.mode(mile), biome = b.t < .5 ? b.a : b.b;
    return { mile, mode, label: MODE_LABEL[mode], biome, biomeLabel: BIOME_LABEL[biome], toMark: (mile + 1) * MILE_M - p };
  }
}

/** The route the session rides: an open route whose samples grow as you ride, driven by an EndlessRide. */
export function makeEndlessRoute({ id = 'endless', name = 'Endless', seed = 1, startMode = 'rolling' } = {}) {
  const route = { id, name, park: 'A world without end', closed: false, hasElevation: true, endless: true, free: false, stops: [], tags: ['varied'],
    note: 'Six biomes in a seeded sequence: farmland, northern forest and lakes, alpine mountains, the coast, desert canyons and arctic tundra' };
  route.course = new Course(seed, startMode);
  route.endlessRide = new EndlessRide(route, route.course);
  return route;
}
