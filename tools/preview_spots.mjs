// Route preview spots (PLAN 6.8): where along a route its 2–3 menu pictures are taken, and what they're called.
// Pure planning, no browser: tools/build_previews.mjs renders the spots this picks.
//
// Every route gets a Start picture, its Highlight (auto-picked: a scene `view`, a styled or named bridge, a
// landmark tower ahead, an overlook, the author's preview spot, a named sign …) and a third: the route's
// steepest climb when it is steep enough, else a second highlight, else a gentler climb. A hand pick per route
// in routes/previews/picks.json moves or renames any of them.
//
// A spot is in route metres (`atM`: a park's outbound leg, a network preset's path metres) and renders as
// `render`: { park (catalog id of the world drawn), s (the world's own route metre, so the riding direction is
// kept), subject? (a bridge, tower, landform or overlook view to point a postcard camera at and check in the frame),
// view? (a scene view's postcard camera) }.
// Pittsburgh presets render on their areas' own worlds (one world per area, many presets' spots each), so a
// spot shared by several presets is one image.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalogRoute } from '../js/routes.js';
import { loadNetwork, makePathRoute, worldS } from '../js/network.js';
import { haversine, carryAt } from '../js/gpx.js';
import { normalizeScene } from '../js/world/toolbox/scene-schema.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PICKS_FILE = 'routes/previews/picks.json';

// scores: which highlight wins (higher first)
// Spots that show a subject (a bridge, a tower, a landform, the view from an overlook) come first: the renderer
// points a postcard camera at the subject and checks it is in the picture (tools/build_previews.mjs)
export const SCORE = { pick: 1000, view: 100, arch: 85, styledBridge: 80, overlook: 65, feature: 62, hero: 55,
  col: 55, namedBridge: 48, summit: 42, landform: 44, stop: 40, preview: 38, parkPreview: 38, lookout: 36, sign: 35, town: 25, along: 1 };
// the postcard camera for a subject: metres back from the rider and up, and how much of the frame it must fill
export const SUBJECT_CAM = { bridge: { back: 10, up: 10, minFrac: 0.22 }, hero: { back: 6, up: 6, minFrac: 0.16 },
  landform: { back: 0, up: 20, minFrac: 0.08 }, overlook: { back: 0, up: 3, minFrac: 0.25 } };
// a climb worth a picture: the steepest window's average grade (city streets: short and steep; parks: long)
const CLIMB = { city: { windowM: 150, strong: 7, mild: 4 }, park: { windowM: 500, strong: 5, mild: 3 } };
const STEP = 10;

// ---------- names ----------
const SMALL = new Set(['of', 'the', 'and', 'at', 'on', 'to', 'in', 'a', 'du', 'de', 'la', 'le', 'des', 'en']);
/** "P.J. McARDLE ROADWAY" → "P.J. McArdle Roadway"; already mixed-case names are kept. */
export function titleCase(label) {
  const t = String(label || '').trim();
  if (!t || t.replace(/\bMc/g, 'MC') !== t.toUpperCase()) return t;   // (McARDLE counts as capitals)
  return t.toLowerCase().split(/(\s+)/).map((w, i) => {
    if (/^\s+$/.test(w)) return w;
    if (i > 0 && SMALL.has(w)) return w;
    if (/^mc[a-z]/.test(w)) return 'Mc' + w[2].toUpperCase() + w.slice(3);
    if (/^([a-z]\.)+[a-z]?\.?$/.test(w)) return w.toUpperCase();   // P.J.
    return w.replace(/(^|[-'])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase());
  }).join('');
}
/** OSM's "Washington Crossing Bridge;40th Street Bridge" → the name riders use (the last). */
const oneName = (n) => String(n || '').split(';').map((x) => x.trim()).filter(Boolean).pop() || '';
export const slug = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const ROLE_WORD = { start: 'Start', highlight: 'Highlight', climb: 'Climb', summit: 'Summit', along: 'Along' };
export function caption(spot) {
  const word = ROLE_WORD[spot.kind === 'summit' ? 'summit' : spot.kind === 'along' ? 'along' : spot.role] || 'Highlight';
  if (spot.role === 'climb') return `${word} · ${spot.name ? `${spot.name}, ` : ''}${spot.gradePct} %`;
  return spot.name ? `${word} · ${spot.name}` : word;
}

// ---------- geometry ----------
const R = 6371008.8, RAD = Math.PI / 180;
function bearing(a, b) {
  const y = Math.sin((b.lon - a.lon) * RAD) * Math.cos(b.lat * RAD);
  const x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lon - a.lon) * RAD);
  return Math.atan2(y, x) / RAD;
}
const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

// ---------- tracks ----------
/**
 * A track: the ridden stretch the pictures choose from, as 10 m samples
 * { p (route metre), park, s (world metre on that park's own route), out (outbound metre: where scene items
 * are placed), dir (+1 outbound, -1 its return), lat, lon, ele, grade, name (a network edge's name) }.
 */
export function parkTrack(route, park) {
  const leg = route.turnS || route.total, n = Math.floor(leg / STEP);
  const samples = [];
  for (let i = 0; i <= n; i++) samples.push({ p: i * STEP, park, s: i * STEP, out: i * STEP, dir: 1, lat: route.lat[i], lon: route.lon[i], ele: route.ele[i], grade: route.grade[i], name: null });
  return { span: n * STEP, samples, city: false };
}
/** A network path's first lap (a free ride: its first `spanM`), sample by sample on each edge's own area. */
export function pathTrack(net, route, spanM = 25000) {
  const span = route.lapM || spanM, samples = [];
  for (const x of route.netRide.entries) {
    if (x.p0 >= span) break;
    const t = x.t, A = t.e.A, base = A.base, park = A.json?.catalogId || A.id;
    for (let u = samples.length ? STEP : 0; u <= t.e.len && x.p0 + u <= span; u += STEP) {
      const s = worldS(net, t, u), i = Math.round(s / STEP) % (base.dist.length - 1);
      samples.push({ p: x.p0 + u, park, s, out: t.dir > 0 ? t.e.s0 + u : t.e.s1 - u, dir: t.dir, lat: base.lat[i], lon: base.lon[i], ele: base.ele[i], grade: base.grade[i], name: t.e.name, carry: !!carryAt(route, x.p0 + u), node: u === 0 ? net.nodes.get(t.dir > 0 ? t.e.from : t.e.to)?.name : null });
    }
  }
  return { span: samples.length ? samples[samples.length - 1].p : 0, samples, city: true };
}
const at = (track, p) => track.samples[Math.max(0, Math.min(track.samples.length - 1, Math.round(p / STEP)))];
const heading = (track, i) => { const S = track.samples, a = S[Math.max(0, i - 2)], b = S[Math.min(S.length - 1, i + 3)]; return bearing(a, b); };

// ---------- candidates ----------
/**
 * Scene items as candidates of one park (world): placed ones in outbound metres (`atM`, or a span `fromM`–`toM`),
 * others by lat/lon (landmarks to look at). The same data whichever route rides through.
 */
export function sceneCandidates(park, scene, { city = null, stops = [], leg = Infinity } = {}) {
  const C = [];
  const signs = (scene.signs || []).filter((s) => s.kind !== 'diamond' && s.label && Number.isFinite(s.atM));
  const signName = (atM, reach) => { let best = null, d = reach; for (const s of signs) { const k = Math.abs(s.atM - atM); if (k <= d) { d = k; best = s; } } return best ? titleCase(best.label) : null; };
  (scene.views || []).forEach((v, k) => C.push({ park, kind: 'view', name: v.name, score: SCORE.view - k, atM: v.atM, rangeM: v.rangeM ?? 400, cam: v.cam, view: v.name }));
  // bridges: a city's route bridges (tools/build_city.py), a park's named ones
  for (const b of city?.routeBridges || []) {
    const name = oneName(b.name), styled = b.style && b.style !== 'girder';
    if (!styled && !/bridge/i.test(name)) continue;
    C.push({ park, kind: 'bridge', name: /bridge/i.test(name) ? name : `${name} bridge`, score: styled ? SCORE.styledBridge : SCORE.namedBridge, fromM: b.fromM, toM: b.toM });
  }
  for (const b of scene.bridges || []) if (b.name && Number.isFinite(b.fromM)) C.push({ park, kind: 'bridge', name: b.name, score: b.arch ? SCORE.arch : SCORE.namedBridge + 10, fromM: b.fromM, toM: b.toM });
  for (const b of scene.bridgeRanges || []) if (b.name) C.push({ park, kind: 'bridge', name: b.name, score: SCORE.namedBridge + 20, fromM: b.fromM, toM: b.toM, intoM: 600 });
  // a city's overlooks (Grandview Avenue): look over the city from the middle of the row
  const ov = scene.overlooks;
  if (ov && Number.isFinite(ov.fromM)) {
    const mid = (ov.fromM + ov.toM) / 2, name = signName(mid, (ov.toM - ov.fromM) / 2 + 300);
    if (ov.look) C.push({ park, kind: 'overlook', name: name ? `the view from ${name}` : 'the overlooks', score: SCORE.overlook, atM: mid, subject: { pts: [{ lat: ov.look.lat, lon: ov.look.lon, up: ov.look.up ?? 40 }], radius: 350 } });
  }
  for (const l of scene.lookouts || []) if (Number.isFinite(l.atM)) C.push({ park, kind: 'lookout', name: signName(l.atM, 400) || 'the overlook', score: SCORE.lookout, atM: l.atM, beforeM: 40 });
  // landmarks to look at: a city's hero towers, a park's named landforms and lakes
  for (const h of scene.heroes || []) if (Number.isFinite(h.lat)) {
    const tall = (h.heightM || h.bodyM || 0) >= 140;
    const H = h.heightM || h.bodyM || 30;
    C.push({ park, kind: 'hero', name: h.name, score: SCORE.hero - (tall ? 0 : 10), lat: h.lat, lon: h.lon, height: H, radius: h.radiusM || 15, nearM: tall ? 250 : 120, farM: tall ? 1400 : 380 });
  }
  for (const f of [...(scene.formations || []), ...(scene.lakes || [])]) if (f.name && Number.isFinite(f.lat)) {
    const lake = !f.heightM;
    C.push({ park, kind: 'landform', name: f.name, score: SCORE.landform, lat: f.lat, lon: f.lon, height: f.heightM || 1, radius: (Array.isArray(f.radiusM) ? f.radiusM[0] : f.radiusM) || 200, nearM: 300, farM: lake ? 2500 : 9000 });
  }
  // the Tour stage's named places (Alpe d'Huez): cols and named crowd spots (the 21 bends, Dutch Corner)
  const towns = new Set((scene.boards || []).filter((b) => b.kind === 'town').map((b) => b.title));
  for (const b of scene.boards || []) if (b.kind === 'col' && Number.isFinite(b.atM)) C.push({ park, kind: 'col', name: b.title, score: SCORE.col, atM: b.atM, beforeM: 120 });
  for (const c of scene.raceDay?.crowd || []) if (c.name && /, the start$/.test(c.name)) C.push({ park, kind: 'feature', name: c.name.replace(/, the start$/, ''), score: SCORE.sign, atM: c.fromM });
  for (const c of scene.raceDay?.crowd || []) if (c.name && !towns.has(c.name) && !/start/i.test(c.name)) C.push({ park, kind: 'feature', name: c.name, score: SCORE.feature, atM: Math.min(c.toM ?? c.fromM + 200, c.fromM + 150) });
  for (const t of scene.towns || []) C.push({ park, kind: 'town', name: t.name, score: SCORE.town, atM: (t.fromM + t.toM) / 2 });
  for (const b of scene.boards || []) if (b.kind === 'town' && Number.isFinite(b.atM)) C.push({ park, kind: 'town', name: b.title, score: SCORE.town, atM: b.atM + 60 });
  for (const s of stops) if (Number.isFinite(s.atM) && s.name) C.push({ park, kind: 'stop', name: s.name, score: SCORE.stop, atM: s.atM, beforeM: 60 });
  for (const s of signs) C.push({ park, kind: 'sign', name: titleCase(s.label), score: SCORE.sign, atM: s.atM, beforeM: 50 });
  // the author's preview spot: named after what's near it
  const pv = scene.preview?.positionM;
  // (a park's is its author's hero view; a city area's is a generic one)
  if (Number.isFinite(pv) && pv <= leg) C.push({ park, kind: 'preview', name: null, score: city ? SCORE.preview : SCORE.parkPreview, atM: pv });
  return C.filter((c) => !Number.isFinite(c.atM) || c.atM <= leg + 1);
}

/** Where a candidate lies on a track (the first time it's ridden), as a spot, or null. */
function place(track, c) {
  const S = track.samples;
  if (c.kind === 'view' && !Number.isFinite(c.atM)) {
    // a view without a route metre: when the route passes within 300 m of its camera
    let best = null, d = 300;
    for (let i = 0; i < S.length; i += 3) { if (S[i].park !== c.park) continue; const k = haversine(S[i], c.cam); if (k < d) { d = k; best = S[i]; } }
    return best && { ...c, p: best.p, render: { park: c.park, view: c.view } };
  }
  if (Number.isFinite(c.lat) && c.kind !== 'view') {
    // a landmark: from a stretch riding toward it (within ~16°), at a distance it fills the view
    let best = null, cost = Infinity;
    for (let i = 0; i < S.length; i += 3) {
      if (S[i].park !== c.park || S[i].under) continue;
      const d = haversine(S[i], c);
      if (d < c.nearM || d > c.farM) continue;
      const off = angleDiff(heading(track, i), bearing(S[i], c));
      if (off > 16) continue;
      const k = off + Math.abs(d - (c.nearM + c.farM) / 3) / c.farM * 10;
      if (k < cost) { cost = k; best = S[i]; }
    }
    if (!best) return null;
    // looked at: its foot, middle and top (and its width), from a postcard camera over the road
    const pts = [0, 0.5, 1].map((f) => ({ lat: c.lat, lon: c.lon, up: Math.round(c.height * f) }));
    return { ...c, p: best.p, render: { park: best.park, s: best.s, subject: subjectOf(c, { pts, radius: c.radius }) } };
  }
  // placed in outbound metres: find the samples riding it (either way)
  const hit = (out) => S.find((x) => x.park === c.park && Math.abs(x.out - out) <= STEP / 2);
  let p = null, subject = c.subject ? subjectOf(c, c.subject) : null;
  if (Number.isFinite(c.fromM)) {
    // a bridge: seen from its approach (far enough back to take it all in), its deck's ends and middle the subject
    const a = hit(c.fromM), b = hit(c.toM);
    if (!a || !b) return null;
    const [e, x] = a.p <= b.p ? [a, b] : [b, a];   // riding onto it at e, off it at x
    const len = x.p - e.p;
    if (len < 20) return null;
    let pts, back;
    if (c.intoM) { const q = e.p + c.intoM; pts = [q + 150, q + 500, Math.min(x.p, q + 1200)]; back = -c.intoM; }   // a long bridge (Seven Mile): out on the deck
    else { pts = [e.p, (e.p + x.p) / 2, x.p]; back = Math.max(70, Math.min(350, len * 0.9)); }
    p = e.p - back;
    while (p > 20 && at(track, p).park !== c.park) p += 10;   // stay on the bridge's own world
    subject = subjectOf(c, { pts: pts.map((q) => ({ s: Math.round(at(track, q).s), up: 2 })) });
  } else {
    if (Number.isFinite(c.atM) && c.kind === 'view') {
      const x = S.find((y) => y.park === c.park && Math.abs(y.out - c.atM) <= (c.rangeM ?? 400));
      return x && { ...c, p: x.p, render: { park: c.park, view: c.view } };
    }
    const x = hit(c.atM);
    if (!x) return null;
    p = x.p - (c.beforeM ?? 0);
  }
  p = Math.max(20, Math.min(track.span - 10, p));
  const y = at(track, p);
  if (subject && y.park !== c.park) return null;
  return { ...c, p, render: { park: y.park, s: y.s, ...(subject ? { subject } : {}) } };
}
/** A subject to frame and check: points ({s, up} on the world's road, or {lat, lon, up} over the ground). */
function subjectOf(c, { pts, radius = 0 }) {
  return { name: c.name, kind: c.kind, pts, ...(radius ? { radius: Math.round(radius) } : {}), ...SUBJECT_CAM[c.kind] };
}

/** The steepest climb: the window of `windowM` with the highest average grade (riding direction). */
export function steepestClimb(track) {
  const K = track.city ? CLIMB.city : CLIMB.park, S = track.samples, w = Math.round(K.windowM / STEP);
  let best = null;
  const carried = new Int32Array(S.length + 1);   // escalators (conveyors) so far: an escalator isn't a climb
  for (let i = 0; i < S.length; i++) carried[i + 1] = carried[i] + (S[i].carry || S[i].under ? 1 : 0);
  for (let i = 0; i + w < S.length; i++) {
    if (carried[i + w + 1] - carried[i]) continue;
    const g = (S[i + w].ele - S[i].ele) / K.windowM * 100;
    if (!best || g > best.avg) best = { i, avg: g };
  }
  if (!best || best.avg <= 0) return null;
  let max = 0;
  for (let k = best.i; k <= best.i + w; k++) max = Math.max(max, S[k].grade);
  const p = S[best.i].p + K.windowM * 0.3;   // a third of the way up: the rest of the wall ahead
  return { p, fromM: S[best.i].p, toM: S[best.i + w].p, avg: best.avg, gradePct: Math.round(Math.max(max, best.avg)), strong: best.avg >= K.strong, mild: best.avg >= K.mild };
}

/**
 * Pick a route's spots from its track and candidates: [{ role, kind, name, atM, caption, render }].
 * picks: the route's hand overrides ({ start | highlight | third: { atM?, name?, aim?, view?, off? } }).
 */
export function pickSpots(track, candidates, { picks = {}, startName = null, startFallback = null, routeName = '', rejected = new Set() } = {}) {
  const span = track.span, gap = Math.max(250, Math.min(3000, span * 0.1));
  // (nothing underground but a view: a tunnel shows nothing of the place; nothing the renderer found its subject
  // missing from: `rejected` picture names)
  const placed = candidates.map((c) => place(track, c)).filter((c) => c && (c.kind === 'view' || !at(track, c.p).under) && !rejected.has(imageName(c.render)));
  // a nameless preview spot borrows the nearest name
  const nearName = (p, reach) => { let best = null, d = reach; for (const c of placed) if (c.name && c.kind !== 'hero' && c.kind !== 'landform' && Math.abs(c.p - p) <= d) { d = Math.abs(c.p - p); best = c.name; } return best || at(track, p).name; };
  for (const c of placed) if (!c.name) c.name = nearName(c.p, track.city ? 600 : 2000);
  for (const c of placed) if (!c.name && c.kind === 'summit') c.name = 'the high point';
  const spotAt = (p, extra = {}) => { const y = at(track, p); return { atM: Math.round(y.p), render: { park: y.park, s: Math.round(y.s) }, ...extra }; };
  const out = [], names = new Set();
  // Start: just in, named after the junction or the first named place within the gap
  const first = placed.filter((c) => c.p < Math.min(gap, 400) && c.score >= SCORE.sign && c.kind !== 'hero' && c.kind !== 'landform').sort((a, b) => b.score - a.score)[0];
  const start = { role: 'start', kind: 'start', name: picks.start?.name || startName || first?.name || startFallback || null, ...spotAt(picks.start?.atM ?? 20) };
  if (first && !picks.start?.name && !startName) first.used = true;
  if (start.name) names.add(start.name);
  out.push(start);
  const far = (p) => out.every((o) => Math.abs(o.atM - p) >= gap);
  const known = (n) => n && [...names].some((m) => m.includes(n) || n.includes(m));
  const best = (pred = () => true) => placed.filter((c) => !c.used && !known(c.name) && far(c.p) && pred(c)).sort((a, b) => b.score - a.score || a.p - b.p)[0];
  const asSpot = (c, role) => { c.used = true; if (c.name) names.add(c.name); return { role, kind: c.kind, name: c.name || null, atM: Math.round(c.p), render: c.render }; };
  const hand = (role, pick) => {
    if (pick.view) { const c = placed.find((x) => x.view === pick.view); if (c) return { ...asSpot(c, role), name: pick.name || c.name }; }
    if (pick.of) { const c = placed.find((x) => x.name === pick.of && !x.used); if (c) return { ...asSpot(c, role), name: pick.name || c.name }; }
    const p = pick.atM ?? 20, s = spotAt(p);
    return { role, kind: 'pick', name: pick.name ?? nearName(p, 400), ...s };
  };
  // Highlight
  let h = picks.highlight ? hand('highlight', picks.highlight) : null;
  if (!h) { const c = best((x) => x.score > SCORE.along); if (c) h = asSpot(c, 'highlight'); }
  if (!h) {
    // nothing named along it: its highest point, or halfway
    const S = track.samples; let top = S[0];
    for (const x of S) if (x.ele > top.ele) top = x;
    const p = far(top.p) && top.p > gap ? top.p : span / 2;
    h = { role: 'highlight', kind: 'along', name: nearName(p, 500) || routeName || null, ...spotAt(p) };
  }
  out.push(h);
  // Third: a steep climb, else a second highlight (another kind first), else a gentler climb
  const climb = steepestClimb(track);
  const climbSpot = (c) => {
    // a city climb is named by its street sign (Canton Avenue), else its network segment; a park's by what's near
    const sign = track.city && placed.filter((x) => x.kind === 'sign' && x.p >= c.fromM - 300 && x.p <= c.toM + 100).sort((a, b) => Math.abs(a.p - c.p) - Math.abs(b.p - c.p))[0];
    const name = track.city ? (sign?.name || at(track, c.p).name) : nearName(c.p, 1500);
    return { role: 'climb', kind: 'climb', name, gradePct: c.gradePct, ...spotAt(c.p) };
  };
  let third = null;
  if (picks.third?.off) third = null;
  else if (picks.third) third = hand(picks.third.climb ? 'climb' : 'highlight', picks.third);
  else if (climb?.strong && far(climb.p)) third = climbSpot(climb);
  else {
    const c = best((x) => x.score >= SCORE.sign && x.kind !== h.kind) || best((x) => x.score >= SCORE.sign);
    if (c) third = asSpot(c, 'highlight');
    else if (climb?.mild && far(climb.p)) third = climbSpot(climb);
  }
  if (third?.role === 'climb' && picks.third?.climb && third.gradePct == null) third.gradePct = Math.round(at(track, third.atM).grade);
  if (third) out.push(third);
  // a highest point ridden to: say so
  for (const o of out) if (o.kind === 'summit') o.role = 'highlight';
  for (const o of out) o.caption = caption(o);
  return out;
}

// ---------- the repo's routes ----------
const readJson = (root, p) => JSON.parse(readFileSync(resolve(root, p), 'utf8'));
/** Loads the catalog, scenes, city data and the network once (shared by every route's plan). */
export function loadSources(root = ROOT) {
  const catalog = readJson(root, 'routes/catalog.json');
  const cache = new Map();
  const memo = (k, f) => { if (!cache.has(k)) cache.set(k, f()); return cache.get(k); };
  const item = (id) => catalog.find((c) => c.id === id);
  const route = (id) => memo(`r:${id}`, () => buildCatalogRoute(readFileSync(resolve(root, item(id).file), 'utf8'), item(id)));
  const scene = (id) => memo(`s:${id}`, () => (item(id)?.scene ? normalizeScene(readJson(root, item(id).scene)) : {}));
  const city = (id) => memo(`c:${id}`, () => { const s = scene(id); return s.cityData && existsSync(resolve(root, s.cityData)) ? readJson(root, s.cityData) : null; });
  const picks = existsSync(resolve(root, PICKS_FILE)) ? readJson(root, PICKS_FILE) : {};
  const networks = catalog.filter((c) => c.network).map((c) => {
    const json = readJson(root, c.network);
    const bases = json.format === 'bikefree-network-2' ? new Map(json.areas.map((a) => [a.id, route(a.catalogId)])) : route(c.id);
    return { item: c, json, net: loadNetwork(json, bases) };
  });
  return { root, catalog, item, route, scene, city, picks, networks };
}

/** Samples in a tunnel or an escalator shaft (city data `routeUnderground`, outbound metres). */
function markUnderground(src, track) {
  for (const x of track.samples) x.under = (src.city(x.park)?.routeUnderground || []).some((g) => x.out > g.fromM && x.out < g.toM);
}

/** Candidates of one park (world), cached. */
function candidatesOf(src, park) {
  src._cands ||= new Map();
  if (!src._cands.has(park)) {
    const r = src.route(park), leg = r.turnS || r.total, C = sceneCandidates(park, src.scene(park), { city: src.city(park), stops: r.stops || [], leg });
    // a park's highest point, when the road climbs to it (a pass, a summit finish)
    let top = 0;
    for (let i = 0; i * STEP <= leg; i++) if (r.ele[i] > r.ele[top]) top = i;
    if (!src.item(park)?.area && r.ele[top] - r.minEle >= 200 && top * STEP > 500) C.push({ park, kind: 'summit', name: null, score: SCORE.summit, atM: Math.max(0, top * STEP - 80) });
    src._cands.set(park, C);
  }
  return src._cands.get(park);
}

/**
 * Every route in the menu with its spots: each listed park route (catalog entries that aren't an area of a city),
 * each preset of a ride network, and the network's free ride. `only`: one route id.
 */
export function planRoutes(src, { only = null } = {}) {
  const plans = [];
  for (const it of src.catalog) {
    if (it.area || it.network) continue;   // a city's areas are its presets' worlds; a network is listed as its presets
    if (only && only !== it.id) continue;
    const r = src.route(it.id), track = parkTrack(r, it.id);
    markUnderground(src, track);
    const scene = src.scene(it.id);
    plans.push({ id: it.id, name: it.name, kind: 'park', spots: pickSpots(track, candidatesOf(src, it.id), { picks: src.picks[it.id], rejected: src.rejected || new Set(), routeName: scene.title || it.name.split(' · ')[0], startFallback: it.name.split(' · ')[0] }) });
  }
  for (const { item, json, net } of src.networks) {
    const parks = [...net.areas.values()].map((A) => A.json?.catalogId || item.id);
    const cands = [...new Set(parks)].flatMap((p) => candidatesOf(src, p));
    // a view or landmark copied into every area's scene counts once (the first area that has it)
    const seen = new Set(), uniq = cands.filter((c) => { if (!((c.kind === 'view' && !Number.isFinite(c.atM)) || c.kind === 'hero')) return true; const k = `${c.kind}:${c.name}`; if (seen.has(k)) return false; seen.add(k); return true; });
    const list = [...(json.presets || []).map((pr) => ({ id: pr.id, name: pr.name, preset: pr })),
      ...(json.freeRide ? [{ id: `${json.id}-free`, name: json.freeRide.name, preset: { id: `${json.id}-free`, name: json.freeRide.name, path: null, first: json.freeRide.first, prefer: json.freeRide.prefer } }] : [])];
    for (const { id, name, preset } of list) {
      if (only && only !== id) continue;
      const route = makePathRoute(net, preset, { id, name });
      const track = pathTrack(net, route);
      markUnderground(src, track);
      // any area's copy of a landmark may be the one the path rides past: match each on every area
      const mine = uniq.flatMap((c) => ((c.kind === 'view' && !Number.isFinite(c.atM)) || c.kind === 'hero') ? parks.map((p) => ({ ...c, park: p })) : [c]);
      const startName = track.samples[0]?.node || null;
      plans.push({ id, name, kind: preset.path ? 'preset' : 'free', spots: pickSpots(track, mine, { picks: src.picks[id], rejected: src.rejected || new Set(), startName, routeName: name }) });
    }
  }
  return plans;
}
/** The image a spot renders to (shared by every route with the same spot). */
export function imageName(render) {
  if (render.view) return `${render.park}-view-${slug(render.view)}.webp`;
  return `${render.park}-${Math.round(render.s)}${render.subject ? `-${slug(render.subject.name)}` : ''}.webp`;
}
