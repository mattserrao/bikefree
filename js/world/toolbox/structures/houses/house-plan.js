// The house engine, part 1: the plan (pure, no three.js — tests can check it).
//
// Upstate New York's houses, by where they stand (user, 22 Nov 2026: "build a house engine that makes more detailed,
// quality houses, which match the prevailing style of the area"; all zones; full detail near, simple far):
//   suburbs (Camillus, Fairmount, Warners; kind 'house')     1950s–80s: ranch, Cape Cod, raised ranch, split-level,
//                                                            two-storey colonial
//   villages (Skaneateles, Camillus, Jordan; 'village-house') 1830s–1900s: Greek Revival (gable to the street, wide
//                                                            frieze, corner pilasters, side-hall door), Italianate (low
//                                                            hip, deep bracketed eaves, tall windows), upright-and-wing,
//                                                            a plain gable-front with a full porch
//   farms ('farmhouse-ny')                                    upright-and-wing, Greek Revival farmhouse, I-house with
//                                                            a rear ell
//
// A plan is a list of volumes on the house's own grid — s along the front (left → right seen from the street), t back
// from it (the front wall at t0) — each with its storeys, walls, roof and openings; plus the parts (porch, portico,
// stoop, dormers, chimneys, garage door, frieze, brackets, cupola). Footprint: the recipe's cleaned main rectangle
// (recipe.js cleanShape) gives the place, the frontage line and the size; the type gives the proportions.
import { randomSequence } from '../../core/random.js';

export const HOUSE_KINDS = ['house', 'village-house', 'farmhouse-ny'];
const TYPES = {
  house: { ranch: .3, cape: .2, raised: .14, split: .12, colonial: .24 },
  'village-house': { greek: .34, italianate: .26, upright: .2, gablefront: .2 },
  'farmhouse-ny': { upright: .5, greekfarm: .2, ihouse: .3 },
};
const pickW = (w, r) => { let tot = 0; for (const k in w) tot += w[k]; let a = 0; for (const k in w) { a += w[k] / tot; if (r <= a) return k; } return Object.keys(w).pop(); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Openings along a wall of length len: n windows evenly (none if too short), as { at, w, kind }. */
function even(len, n, kind = 'win', margin = 1) {
  const out = []; if (n < 1 || len < 2) return out;
  const step = (len - 2 * margin) / n;
  for (let k = 0; k < n; k++) out.push({ at: margin + step * (k + .5), w: Math.min(step, 1.7), kind });
  return out;
}
const sideWins = (len, per = 4.6) => even(len, Math.max(1, Math.round(len / per)), 'win', 1.2);

/**
 * Plan the house for recipe R (after recipe.js has its main rect and front). Returns the plan, or null to leave the
 * building to the generic kit. rand: a number source (deterministic per building).
 */
export function planHouse(R) {
  if (!HOUSE_KINDS.includes(R.kind) || !R.rects?.length || R.outline) return null;
  if (!['cottage', 'village', 'farmhouse'].includes(R.archetype)) return null;
  const rand = randomSequence(Math.floor(R.seed * 2 ** 31) ^ 0x5eed);
  const r0 = R.rects[0];
  // the house's grid from the recipe's main block and front wall: b points back (away from the road), a to the right
  const f = R.front ?? 0;
  const n = f === 0 ? [-r0.vx, -r0.vz] : f === 1 ? [r0.ux, r0.uz] : f === 2 ? [r0.vx, r0.vz] : [-r0.ux, -r0.uz];
  const b = [-n[0], -n[1]], a = [-b[1], b[0]];
  const frontT = -(f % 2 === 0 ? r0.hv : r0.hu);
  const area = R.rects.reduce((s, r) => s + 4 * r.hu * r.hv, 0);
  const type = pickW(TYPES[R.kind], rand());
  const P = { type, o: [r0.cx, r0.cz], a, b, vols: [], parts: {}, seed: R.seed };
  const build = BUILD[type];
  build(P, area, frontT, rand, R);
  // the volumes as the kit's rects (u along the longer side, v = (−uz, ux)), the main body first
  P.rects = P.vols.filter((v) => !v.noRect).map((v) => volRect(P, v));
  return P;
}

/** A volume's rectangle in world space (the kit's rect format). */
export function volRect(P, v) {
  const sc = (v.s0 + v.s1) / 2, tc = (v.t0 + v.t1) / 2, cx = P.o[0] + P.a[0] * sc + P.b[0] * tc, cz = P.o[1] + P.a[1] * sc + P.b[1] * tc;
  const hs = (v.s1 - v.s0) / 2, ht = (v.t1 - v.t0) / 2;
  let ux, uz, hu, hv;
  if (hs >= ht) { [ux, uz] = P.a; hu = hs; hv = ht; } else { [ux, uz] = P.b; hu = ht; hv = hs; }
  return { cx, cz, ux, uz, vx: -uz, vz: ux, hu, hv };
}
/** World point of the house grid's (s, t). */
export const at = (P, s, t) => [P.o[0] + P.a[0] * s + P.b[0] * t, P.o[1] + P.a[1] * s + P.b[1] * t];

// ------------------------------------------------------------------ the types
// a volume: { name, s0, s1, t0, t1, floors, fh (storey height), lift (its floor above the house's ground floor),
//   wall: 'lap' | 'brick' | 'shingle', lower: { code, h } (a brick or stone lower part), roof: { form, ridge: 's'|'t',
//   pitch (deg), eave, rake }, open: { front, right, back, left }: [{ at, w, kind: win|door|pic|tall|low|garage }],
//   lowOpen: the same for a raised ranch's lower level, gableWin: [true/false per gable end] }
const siding = (rand, brick = .1, shingle = .08) => { const r = rand(); return r < brick ? 'brick' : r < brick + shingle ? 'shingle' : 'lap'; };

const BUILD = {
  /** Ranch: one long storey, low gable or hip, a picture window, often an attached garage at one end. */
  ranch(P, area, t0, rand) {
    const D = 8 + rand() * 1.6, W = clamp(area / D, 11, 19), garage = rand() < .6, gs = rand() < .5 ? -1 : 1;
    const hip = rand() < .4, pitch = 20 + rand() * 6;
    const body = { name: 'body', s0: -W / 2, s1: W / 2, t0, t1: t0 + D, floors: 1, fh: 2.75, lift: 0, wall: siding(rand, .28, .06),
      roof: { form: hip ? 'hip' : 'gable', ridge: 's', pitch, eave: .45, rake: .3 } };
    if (body.wall === 'lap' && rand() < .3) body.lower = { code: 'brick', h: 1.0, front: true };   // a brick wainscot across the front
    // the front: door off centre, the picture window beside it, bedrooms' windows along the rest
    const dAt = W * (gs > 0 ? .38 : .62), pAt = dAt + (gs > 0 ? -2.8 : 2.8);
    const fr = [{ at: dAt, w: 1.4, kind: 'door' }, { at: pAt, w: 3, kind: 'pic' }];
    for (const x of gs > 0 ? [W * .72, W * .9] : [W * .1, W * .28]) fr.push({ at: x, w: 1.4, kind: 'win' });
    if (gs > 0) fr.push({ at: W * .1, w: 1.4, kind: 'win' }); else fr.push({ at: W * .9, w: 1.4, kind: 'win' });
    body.open = { front: fr, right: sideWins(D, 5), back: sideWins(W, 4.2), left: sideWins(D, 5) };
    P.vols.push(body);
    if (garage) addGarage(P, body, gs, rand, { roof: body.roof.form === 'hip' ? 'hip' : 'gable', pitch, lower: .25 });
    P.parts.stoop = { s: body.s0 + dAt, w: 2.2, d: 1.3, roof: rand() < .45 ? 'gable' : null };
    if (rand() < .5) P.parts.shutters = true;
    P.parts.chimneys = [{ s: (rand() - .5) * W * .4, t: t0 + D * .55, w: 1.2, d: .7, interior: true }];
    P.parts.cornerBoards = body.wall !== 'brick';
  },
  /** Cape Cod: a storey and a half, steep side gable, symmetrical front round a centre door, dormers. */
  cape(P, area, t0, rand) {
    const D = 7.6 + rand() * 1, W = clamp(area / D * .9, 9, 12.5), pitch = 42 + rand() * 6;
    const body = { name: 'body', s0: -W / 2, s1: W / 2, t0, t1: t0 + D, floors: 1, fh: 2.6, lift: 0, wall: siding(rand, .05, .28),
      roof: { form: 'gable', ridge: 's', pitch, eave: .25, rake: .2 }, gableWin: [true, true], gableFloors: 2 };
    const fr = [{ at: W / 2, w: 1.5, kind: 'door' }];
    const pair = W > 10.5;
    for (const sg of [-1, 1]) { fr.push({ at: W / 2 + sg * 2.1, w: 1.3, kind: 'win' }); if (pair) fr.push({ at: W / 2 + sg * 3.6, w: 1.3, kind: 'win' }); }
    body.open = { front: fr, right: sideWins(D, 4.5), back: sideWins(W, 4), left: sideWins(D, 4.5) };
    P.vols.push(body);
    const nd = rand() < .65 ? (W > 10 ? 3 : 2) : rand() < .5 ? 2 : 0;
    if (nd) P.parts.dormers = { list: Array.from({ length: nd }, (_, k) => ({ s: -W / 2 + W * (k + .5) / nd, w: 1.5 })), side: 'front' };
    else P.parts.shedDormer = { s0: -W / 2 + 1.2, s1: W / 2 - 1.2, side: 'back' };
    P.parts.shutters = rand() < .75;
    P.parts.chimneys = [{ s: (rand() < .5 ? -1 : 1) * (W / 2 + .35), t: t0 + D / 2, w: 1.4, d: .7, exterior: true }];
    P.parts.stoop = { s: 0, w: 2, d: 1.2, roof: null };
    if (rand() < .35) addGarage(P, body, rand() < .5 ? -1 : 1, rand, { roof: 'gable', pitch: 30, breezeway: true });
    P.parts.cornerBoards = true;
  },
  /** Raised ranch (split foyer): the lower level half out of the ground in brick, the main floor over it, the door
   *  between the two in the middle, a garage door in the lower level at one end. */
  raised(P, area, t0, rand) {
    const D = 8.4 + rand() * 1.2, W = clamp(area / D, 12, 16), pitch = 21 + rand() * 5, gs = rand() < .5 ? -1 : 1;
    const body = { name: 'body', s0: -W / 2, s1: W / 2, t0, t1: t0 + D, floors: 1, fh: 2.7, lift: 1.25, wall: rand() < .15 ? 'brick' : 'lap',
      lower: { code: rand() < .75 ? 'brick' : 'concrete', h: 2.45, below: 1.2, all: true }, roof: { form: 'gable', ridge: 's', pitch, eave: .45, rake: .3 } };
    const mid = W / 2, gar = rand() < .55;
    const up = [{ at: mid, w: 1.6, kind: 'blank' }, { at: mid - 2.5, w: 3, kind: 'pic' }, { at: mid + 2.6, w: 1.4, kind: 'win' }, { at: mid + 4.6, w: 1.4, kind: 'win' }, { at: mid - 4.9, w: 1.4, kind: 'win' }];
    body.open = { front: up.filter((o) => o.at > .9 && o.at < W - .9), right: sideWins(D, 5), back: sideWins(W, 4.2), left: sideWins(D, 5) };
    const low = [];
    if (gar) low.push({ at: gs > 0 ? W - 2.8 : 2.8, w: 5.2, kind: 'garage' });
    for (const x of gar ? (gs > 0 ? [W * .2, W * .38] : [W * .62, W * .8]) : [W * .2, W * .35, W * .65, W * .8]) low.push({ at: x, w: 1.4, kind: 'low' });
    body.lowOpen = { front: low, right: [], back: even(W, 2, 'low', 2), left: [] };
    P.vols.push(body);
    if (gar) P.parts.garageDoor = { s: body.s0 + (gs > 0 ? W - 2.8 : 2.8), w: 4.9, lowLevel: true };
    // the split foyer: the door at mid-level, a landing and steps up to it
    P.parts.foyer = { s: 0, w: 1.6 };
    P.parts.stoop = { s: 0, w: 2.2, d: 1.5, roof: rand() < .3 ? 'gable' : null, high: true };
    P.parts.shutters = rand() < .55;
    P.parts.cornerBoards = body.wall !== 'brick';
    P.parts.chimneys = rand() < .5 ? [{ s: (rand() - .5) * W * .5, t: t0 + D * .5, w: 1.1, d: .7, interior: true }] : [];
  },
  /** Split-level: a one-storey wing and a two-storey section a half level apart, the garage under the upper part. */
  split(P, area, t0, rand) {
    const D = 8.5 + rand() * 1, W = clamp(area / D, 13, 18), side = rand() < .5 ? -1 : 1, W2 = W * (.42 + rand() * .08), W1 = W - W2;
    const pitch = 22 + rand() * 5, wall = siding(rand, .1, .1);
    const sA = side > 0 ? -W / 2 : W / 2 - W1, sB = side > 0 ? -W / 2 + W1 : -W / 2;
    const wing = { name: 'body', s0: sA, s1: sA + W1, t0, t1: t0 + D, floors: 1, fh: 2.75, lift: 0, wall, roof: { form: 'gable', ridge: 's', pitch, eave: .45, rake: .3 } };
    const two = { name: 'split', s0: sB, s1: sB + W2, t0: t0 - .6, t1: t0 + D - .6, floors: 2, fh: 2.6, lift: -1.2, wall: rand() < .5 ? wall : 'lap',
      lower: { code: rand() < .6 ? 'brick' : 'lap', h: 2.6 }, roof: { form: rand() < .6 ? 'gable' : 'hip', ridge: 's', pitch, eave: .45, rake: .3 } };
    wing.open = { front: [{ at: W1 * (side > 0 ? .7 : .3), w: 1.4, kind: 'door' }, { at: W1 * (side > 0 ? .32 : .68), w: 3, kind: 'pic' }], right: sideWins(D, 5), back: sideWins(W1, 4), left: sideWins(D, 5) };
    const gar = rand() < .6;
    two.open = { front: gar ? [] : even(W2, 2, 'win', 1.2), right: sideWins(D, 5), back: sideWins(W2, 4), left: sideWins(D, 5) };
    two.upOpen = { front: even(W2, 2, 'win', 1.2) };   // the upper storey's windows (over the garage)
    if (gar) { two.open.front = [{ at: W2 / 2, w: 3.4, kind: 'garage' }]; P.parts.garageDoor = { s: two.s0 + W2 / 2, w: 2.8, t: two.t0, vol: 'split' }; }
    P.vols.push(wing, two);
    P.parts.stoop = { s: wing.s0 + W1 * (side > 0 ? .7 : .3), w: 2, d: 1.2, roof: null };
    P.parts.shutters = rand() < .4;
    P.parts.cornerBoards = true;
    P.parts.chimneys = [{ s: (two.s0 + two.s1) / 2 + side * W2 * .2, t: t0 + D * .45, w: 1.1, d: .7, interior: true }];
  },
  /** Two-storey colonial: side gable, five bays round a centre door (three on a small one), a portico or porch, an
   *  attached two-car garage at one end. */
  colonial(P, area, t0, rand) {
    const D = 8 + rand() * 1.4, W = clamp(area / D * .8, 10.5, 14), pitch = 30 + rand() * 6;
    const body = { name: 'body', s0: -W / 2, s1: W / 2, t0, t1: t0 + D, floors: 2, fh: 2.75, lift: 0, wall: siding(rand, .14, .06),
      roof: { form: rand() < .82 ? 'gable' : 'hip', ridge: 's', pitch, eave: .35, rake: .25 }, gableWin: [rand() < .5, rand() < .5] };
    const five = W > 11.8;
    const fr = [{ at: W / 2, w: 1.5, kind: 'door' }];
    for (const sg of [-1, 1]) { fr.push({ at: W / 2 + sg * (five ? 2.3 : 2.6), w: 1.3, kind: 'win' }); if (five) fr.push({ at: W / 2 + sg * 4.6, w: 1.3, kind: 'win' }); }
    body.open = { front: fr, right: sideWins(D, 4.5), back: sideWins(W, 3.6), left: sideWins(D, 4.5) };
    P.vols.push(body);
    if (rand() < .55) addGarage(P, body, rand() < .5 ? -1 : 1, rand, { roof: 'gable', pitch: pitch - 4, cars: 2 });
    if (rand() < .3) P.parts.porch = { s0: -W / 2 + .4, s1: W / 2 - .4, d: 2.2, posts: five ? 6 : 4, rail: false, roof: 'shed' };
    else P.parts.portico = { s: 0, w: 2.4, d: 1.5, pediment: rand() < .6 };
    P.parts.shutters = rand() < .8;
    P.parts.chimneys = [{ s: (rand() < .5 ? -1 : 1) * (W / 2 + .35), t: t0 + D / 2, w: 1.5, d: .7, exterior: true }];
    P.parts.cornerBoards = body.wall !== 'brick';
  },
  /** Greek Revival: the gable end to the street like a temple front — a wide frieze, corner pilasters, the gable
   *  closed into a pediment by returns, a side-hall door with sidelights; often a lower wing to one side. */
  greek(P, area, t0, rand, R, farm = false) {
    const W = 7 + rand() * 1.6, D = clamp(area / W * .8, 9.5, 13.5), pitch = 32 + rand() * 5;
    const body = { name: 'body', s0: -W / 2, s1: W / 2, t0, t1: t0 + D, floors: 2, fh: 3.2, lift: 0, wall: 'lap',
      roof: { form: 'gable', ridge: 't', pitch, eave: .3, rake: .3 }, gableWin: [true, false], frieze: .55, tallWin: true };
    const dSide = rand() < .5 ? .25 : .75;
    const fr = [{ at: W * dSide, w: 1.8, kind: 'door' }];
    for (const x of dSide < .5 ? [W * .55, W * .8] : [W * .2, W * .45]) fr.push({ at: x, w: 1.3, kind: 'tall' });
    body.open = { front: fr, right: sideWins(D, 3.4).map((o) => ({ ...o, kind: 'tall' })), back: sideWins(W, 3.4).map((o) => ({ ...o, kind: 'tall' })), left: sideWins(D, 3.4).map((o) => ({ ...o, kind: 'tall' })) };
    P.vols.push(body);
    P.parts.pediment = true; P.parts.pilasters = true; P.parts.doorSurround = { s: -W / 2 + W * dSide, sidelights: true };
    if (rand() < (farm ? .7 : .45)) {
      // the wing: a storey and a half, side gable, set back a little, its own porch along the front
      const ws = rand() < .5 ? -1 : 1, WW = 6 + rand() * 2.5, DW = 6 + rand();
      const wing = { name: 'wing', s0: ws > 0 ? W / 2 : -W / 2 - WW, s1: ws > 0 ? W / 2 + WW : -W / 2, t0: t0 + 1.2, t1: t0 + 1.2 + DW, floors: 1, fh: 3, lift: 0, wall: 'lap',
        roof: { form: 'gable', ridge: 's', pitch: pitch - 2, eave: .3, rake: .25 }, frieze: .4 };
      wing.open = { front: [{ at: WW * .3, w: 1.5, kind: 'door' }, { at: WW * .7, w: 1.3, kind: 'tall' }], right: [], back: sideWins(WW, 4), left: [] };
      if (ws > 0) wing.open.right = sideWins(DW, 4); else wing.open.left = sideWins(DW, 4);
      P.vols.push(wing);
      P.parts.porch = { s0: wing.s0 + .2, s1: wing.s1 - .2, t: wing.t0, d: 2, posts: 3, rail: rand() < .5, roof: 'shed', square: true };
    } else if (rand() < .5) P.parts.porch = { s0: -W / 2 + .2, s1: W / 2 - .2, d: 2.2, posts: 4, rail: rand() < .4, roof: 'shed', columns: true };
    else P.parts.stoop = { s: -W / 2 + W * dSide, w: 2, d: 1.4, roof: null };
    P.parts.shutters = rand() < .6;
    P.parts.chimneys = [{ s: (rand() - .5) * W * .3, t: t0 + D * .7, w: .9, d: .7, interior: true }];
  },
  greekfarm(P, area, t0, rand, R) { BUILD.greek(P, area, t0, rand, R, true); },
  /** Italianate: a tall near-cube with a low hip, deep eaves on paired brackets, tall windows under hoods, a front
   *  porch of chamfered posts, now and then a cupola. */
  italianate(P, area, t0, rand) {
    const W = clamp(Math.sqrt(area) * .95, 8.5, 11), D = clamp(area / W, 9.5, 12.5);
    const body = { name: 'body', s0: -W / 2, s1: W / 2, t0, t1: t0 + D, floors: 2, fh: 3.4, lift: 0, wall: rand() < .3 ? 'brick' : 'lap',
      roof: { form: 'hip', ridge: 's', pitch: 18 + rand() * 4, eave: .85, rake: .85 }, tallWin: true, frieze: .5 };
    const three = W > 9.2, dAt = rand() < .6 ? W / 2 : W * .78;
    const fr = [{ at: dAt, w: 1.8, kind: 'door' }];
    for (const x of three ? (dAt === W / 2 ? [W * .2, W * .8] : [W * .22, W * .5]) : [W * .25]) fr.push({ at: x, w: 1.3, kind: 'tall' });
    body.open = { front: fr, right: sideWins(D, 3.3).map((o) => ({ ...o, kind: 'tall' })), back: sideWins(W, 3.3).map((o) => ({ ...o, kind: 'tall' })), left: sideWins(D, 3.3).map((o) => ({ ...o, kind: 'tall' })) };
    P.vols.push(body);
    P.parts.brackets = true; P.parts.hoods = true;
    P.parts.doorSurround = { s: -W / 2 + dAt, sidelights: false, double: true };
    if (rand() < .6) P.parts.porch = { s0: -W / 2 + .3, s1: W / 2 - .3, d: 2.4, posts: 4, rail: rand() < .6, roof: 'shed', chamfered: true, brackets: true };
    else P.parts.portico = { s: -W / 2 + dAt, w: 2.6, d: 1.8, pediment: false, brackets: true };
    if (rand() < .15) P.parts.cupola = { s: 0, t: t0 + D / 2 };
    P.parts.shutters = rand() < .35;
    P.parts.chimneys = [{ s: -W * .3, t: t0 + D * .35, w: .9, d: .6, interior: true }, { s: W * .3, t: t0 + D * .65, w: .9, d: .6, interior: true }];
  },
  /** Upright-and-wing: a two-storey gable-front upright and a storey-and-a-half wing to one side, a porch in the L. */
  upright(P, area, t0, rand, R) {
    const farm = R.kind === 'farmhouse-ny';
    const W = 6.5 + rand() * 1.3, D = 8.5 + rand() * 2, ws = rand() < .5 ? -1 : 1, WW = 6.5 + rand() * 2.5, DW = 6 + rand() * 1.2, pitch = 38 + rand() * 6;
    const up = { name: 'body', s0: ws > 0 ? -W / 2 - WW / 2 : -W / 2 + WW / 2, t0, t1: t0 + D, floors: 2, fh: 2.9, lift: 0, wall: 'lap',
      roof: { form: 'gable', ridge: 't', pitch, eave: .3, rake: .25 }, gableWin: [true, false] };
    up.s1 = up.s0 + W;
    const wing = { name: 'wing', s0: ws > 0 ? up.s1 : up.s0 - WW, s1: ws > 0 ? up.s1 + WW : up.s0, t0: t0 + 1.5, t1: t0 + 1.5 + DW, floors: 1, fh: 2.9, lift: 0, wall: 'lap',
      roof: { form: 'gable', ridge: 's', pitch: pitch - 3, eave: .3, rake: .25 } };
    up.open = { front: even(W, 2, 'win', 1), right: ws > 0 ? [] : sideWins(D, 3.8), back: sideWins(W, 3.5), left: ws > 0 ? sideWins(D, 3.8) : [] };
    wing.open = { front: [{ at: WW * (ws > 0 ? .3 : .7), w: 1.5, kind: 'door' }, { at: WW * (ws > 0 ? .72 : .28), w: 1.3, kind: 'win' }], right: ws > 0 ? sideWins(DW, 4) : [], back: sideWins(WW, 4), left: ws > 0 ? [] : sideWins(DW, 4) };
    P.vols.push(up, wing);
    P.parts.porch = { s0: wing.s0 + .15, s1: wing.s1 - .15, t: wing.t0, d: 1.5 + 0.0, posts: 3, rail: rand() < .4, roof: 'shed', square: true };
    if (farm && rand() < .5) {
      // a back kitchen ell
      const E = { name: 'ell', s0: up.s0 + .8, s1: up.s1 - .8, t0: up.t1, t1: up.t1 + 5 + rand() * 2, floors: 1, fh: 2.7, lift: 0, wall: 'lap', roof: { form: 'gable', ridge: 't', pitch: pitch - 6, eave: .3, rake: .2 } };
      E.open = { front: [], right: sideWins(E.t1 - E.t0, 3.5), back: [{ at: (E.s1 - E.s0) / 2, w: 1.4, kind: 'door' }], left: sideWins(E.t1 - E.t0, 3.5) };
      P.vols.push(E);
    }
    P.parts.shutters = rand() < .3;
    P.parts.cornerBoards = true; P.parts.returns = rand() < .6;
    P.parts.chimneys = [{ s: (wing.s0 + wing.s1) / 2, t: wing.t0 + DW * .5, w: .8, d: .6, interior: true }];
  },
  /** A plain two-storey gable-front (the villages' 1880s–1910s infill): a full-width front porch. */
  gablefront(P, area, t0, rand) {
    const W = 6.8 + rand() * 1.4, D = clamp(area / W * .85, 9, 12.5), pitch = 40 + rand() * 6;
    const body = { name: 'body', s0: -W / 2, s1: W / 2, t0, t1: t0 + D, floors: 2, fh: 2.9, lift: 0, wall: siding(rand, .05, .2),
      roof: { form: 'gable', ridge: 't', pitch, eave: .3, rake: .25 }, gableWin: [true, false] };
    const dl = rand() < .5;
    body.open = { front: [{ at: dl ? 1.5 : W - 1.5, w: 1.5, kind: 'door' }, { at: dl ? W * .65 : W * .35, w: 1.3, kind: 'win' }, ...(W > 7.6 ? [{ at: dl ? W - 1.1 : 1.1, w: 1.2, kind: 'win' }] : [])],
      right: sideWins(D, 3.8), back: sideWins(W, 3.5), left: sideWins(D, 3.8) };
    P.vols.push(body);
    P.parts.porch = { s0: -W / 2, s1: W / 2, d: 2.4, posts: 4, rail: rand() < .65, roof: 'shed', square: true };
    P.parts.shutters = rand() < .35; P.parts.cornerBoards = true; P.parts.returns = rand() < .4;
    P.parts.chimneys = [{ s: 0, t: t0 + D * .6, w: .8, d: .6, interior: true }];
  },
  /** I-house: two storeys, one room deep, side gable, three or five bays, chimneys at both ends, a kitchen ell behind. */
  ihouse(P, area, t0, rand) {
    const D = 6 + rand() * .8, W = clamp(area / D * .65, 10, 14), pitch = 36 + rand() * 6;
    const body = { name: 'body', s0: -W / 2, s1: W / 2, t0, t1: t0 + D, floors: 2, fh: 2.9, lift: 0, wall: 'lap',
      roof: { form: 'gable', ridge: 's', pitch, eave: .3, rake: .25 } };
    const five = W > 12;
    const fr = [{ at: W / 2, w: 1.5, kind: 'door' }];
    for (const sg of [-1, 1]) { fr.push({ at: W / 2 + sg * (five ? 2.2 : 3), w: 1.3, kind: 'win' }); if (five) fr.push({ at: W / 2 + sg * 4.6, w: 1.3, kind: 'win' }); }
    body.open = { front: fr, right: [], back: sideWins(W, 4), left: [] };
    const E = { name: 'ell', s0: -2.8 + (rand() - .5) * 2, t0: t0 + D, floors: 1, fh: 2.8, lift: 0, wall: 'lap', roof: { form: 'gable', ridge: 't', pitch: pitch - 6, eave: .3, rake: .2 } };
    E.s1 = E.s0 + 5.6; E.t1 = E.t0 + 6 + rand() * 2;
    E.open = { front: [], right: sideWins(E.t1 - E.t0, 3.4), back: [{ at: 2.8, w: 1.4, kind: 'door' }], left: sideWins(E.t1 - E.t0, 3.4) };
    P.vols.push(body, E);
    if (rand() < .5) P.parts.porch = { s0: -W / 2 + .3, s1: W / 2 - .3, d: 2.2, posts: five ? 6 : 4, rail: rand() < .4, roof: 'shed', square: true };
    else P.parts.stoop = { s: 0, w: 2, d: 1.3, roof: rand() < .4 ? 'gable' : null };
    P.parts.shutters = rand() < .5; P.parts.cornerBoards = true; P.parts.returns = rand() < .5;
    P.parts.chimneys = [-1, 1].map((sg) => ({ s: sg * (W / 2 - .45), t: t0 + D / 2, w: .8, d: .7, interior: true }));
  },
};

/** An attached garage at one end (gs: −1 left, +1 right), its door to the street; a breezeway between on a Cape. */
function addGarage(P, body, gs, rand, o = {}) {
  const cars = o.cars || (rand() < .55 ? 2 : 1), Wg = cars === 2 ? 7 : 4.2, Dg = 7 + rand() * .5, gap = o.breezeway ? 3 : 0;
  const s0 = gs > 0 ? body.s1 + gap : body.s0 - gap - Wg, t0 = body.t0 + (o.breezeway ? 1.2 : rand() < .5 ? 0 : .6);
  const g = { name: 'garage', s0, s1: s0 + Wg, t0, t1: t0 + Dg, floors: 1, fh: 2.6, lift: -(o.lower ?? .2), wall: body.wall === 'brick' ? 'lap' : body.wall, garage: true,
    roof: { form: o.roof === 'hip' ? 'hip' : 'gable', ridge: rand() < .7 ? 's' : 't', pitch: o.pitch || 24, eave: .4, rake: .3 } };
  g.open = { front: [{ at: Wg / 2, w: Wg - .8, kind: 'garage' }], right: gs > 0 ? [{ at: Dg / 2, w: 1.3, kind: 'win' }] : [], back: [], left: gs < 0 ? [{ at: Dg / 2, w: 1.3, kind: 'win' }] : [] };
  P.vols.push(g);
  P.parts.garageDoor = { s: s0 + Wg / 2, w: cars === 2 ? 4.9 : 2.7, t: t0, vol: 'garage' };
  if (gap) {
    const bw = { name: 'breezeway', s0: gs > 0 ? body.s1 : s0 + Wg, s1: gs > 0 ? s0 : body.s0, t0: t0 + 1, t1: t0 + Dg - 1.5, floors: 1, fh: 2.4, lift: 0, wall: body.wall,
      roof: { form: 'gable', ridge: 's', pitch: 22, eave: .3, rake: 0 }, noRect: true };
    bw.open = { front: [{ at: (bw.s1 - bw.s0) / 2, w: 1.3, kind: 'win' }], right: [], back: [], left: [] };
    P.vols.push(bw);
  }
}
