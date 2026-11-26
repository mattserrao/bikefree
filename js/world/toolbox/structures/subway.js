// Subway kit: a lit cycle path beside a light-rail line underground — the tunnel, its platforms, the escalators
// that carry a rider down and up, the station headhouses on the street, trains on the tracks beside the path and
// a few people waiting. Lean cartoon style: flat bright colours with the light baked into vertex colours (an
// unlit material: the tunnel is lit by its own strips, not by the sun), merged meshes and instancing (~8 calls).
//
// Built along a route's line from its city data (tools/build_city.py `underground`, PLAN "Subway: North Side to
// Gateway"): `routeUnderground` [{fromM, toM}] (escalator top to escalator top), `routeConveyors` [{fromM, toM,
// dir: 'down'|'up', name}] (the escalators, outbound metres), `subway` {platforms: [{name, fromM, toM}],
// river: [a, b]} (the stretch under the river: aqua tiles and cool light). The line is the path's centre; the
// tracks run on its left (riding outbound) at TRACKS. Generic: any scene with these data and `subway` in its
// config gets it (another line, an incline's shaft later).
import * as THREE from '../../../../vendor/three.js';
import { routePoint } from '../../pose.js';
import { randomSequence } from '../core/random.js';
import { Builder, M, box, linear } from '../core/model-builder.js';
import { figureMaterial, staticCrowdMesh, randomLook, CLIP } from '../life/figures/people.js';
import { worldSound, noiseLoop, toneLoop } from '../core/sound.js';

const FLOOR = .1;                    // the path surface above the line (the rider's wheels)
export const TRACKS = [-4, -8];      // track centres, metres right of the line (left: negative)
const BED = -1.05;                   // the track bed under the path (a platform's height)
const WALL_L = -10.4;                // the tunnel's left wall (beyond the far track)
const EDGE = -2.2;                   // the platform edge / railing side of the path
const SHAFT = { l: -2.2, r: 3.8, h: 4.6, tread: [-1.4, 3.0] };   // an escalator shaft: walls, ceiling, treads
const TUBE = { wall: 3.4, h: 4.9 }, STATION = { wall: 6.5, h: 5.8 };
const LAND = { tile: '#efe6d2', tile2: '#e4d9c0', band: '#e8893a', ceil: '#dcd6c8', light: '#fff4cf' };
const RIVER = { tile: '#c4e6e8', tile2: '#b0dade', band: '#1fa59a', ceil: '#a9cfd6', light: '#d6f3ff' };
const STN = { tile: '#f7f5ef', tile2: '#ecebe4', ceil: '#e6e3dc' };
const PATH = '#4caf6e', WALK = '#c9c5bd', BEDC = '#5d5953', RAIL = '#b8bcc4', SAFETY = '#f2c230';
const STATION_BANDS = ['#e2b33c', '#3f86d8', '#d9534f', '#8e6bd1'];
// [F125] the trains: sections (one instance each) [offset of its centre behind the train's front, flipped: cab at the
// back]; two cars of two sections each, coupled cab to cab. secL: a section with its half of the bellows
const TRAIN = (() => {
  const secL = 12.9, carL = 2 * secL, gap = .7;
  return { secL, W: 2.65, carL, trainL: 2 * carL + gap, doors: [-3.4, 2.2], period: 150, dwell: 18, offset: 70,
    sections: [[secL / 2, false], [secL * 1.5, true], [carL + gap + secL / 2, false], [carL + gap + secL * 1.5, true]] };
})();
export { TRAIN };
const SIGNS = ['North Side', 'Gateway', 'Under the Allegheny', 'Bikes keep right ·  Trains on the left'];

const lerpC = (a, b, t) => linear(a).lerp(linear(b), t);

export class Subway {
  /** cfg: the scene's `subway` ({}), data: the city data, ground: the area's ground material (its holes). */
  constructor(parent, route, index, data, uniforms, cfg = {}, ground = null, landscape = null) {
    this.group = new THREE.Group(); this.group.name = 'Subway'; parent.add(this.group);
    this.route = route; this.index = index; this.cfg = cfg; this.uniforms = uniforms; this.L = landscape;
    this.disposables = [];
    if (data.heads) { this._headsOnly(data, ground); return; }
    const under = data.routeUnderground?.[0], sub = data.subway || {}, conv = (data.routeConveyors || []).filter((c) => c.kind !== 'stadium');   // (F355: a stadium's escalator copied onto an apron is the stadium kit's)
    if (!under) return;
    this.under = under; this.conv = conv; this.platforms = sub.platforms || []; this.river = sub.river || [Infinity, Infinity];
    // the tube with the tracks: from the first escalator's foot to the last's (the shafts are their own)
    const feet = conv.map((c) => (c.dir === 'down' ? c.toM : c.fromM));
    this.s0 = Math.min(...feet); this.s1 = Math.max(...feet);
    this.mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true });
    this.glow = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true, toneMapped: false, side: THREE.DoubleSide });
    this.disposables.push(this.mat, this.glow);
    const T = new Builder(), G = new Builder(), S = new Builder();
    this._tube(T, G);
    for (const c of conv) this._shaft(c, T, G, S);
    this._ends(T);
    this._dressing(S);
    this._mesh(T.build(), this.mat, 'Subway tunnel');
    this._mesh(G.build(), this.glow, 'Subway lights');
    this._mesh(S.build(), this.mat, 'Subway fittings');
    this._treads();
    this._glass();
    this._signs();
    this._trains();
    this._people();
    if (ground?.userData.holes) this._holes(ground.userData.holes);
    this.sound = cfg.sound === false ? null : new SubwaySound();   // [subway sound] (Settings → World sounds)
    this.t = 0;
  }

  /**
   * [F123] The stations' headhouses only, for a neighbouring area that rides past them on the street (the core: General
   * Robinson St by Red Lot 5A, Stanwix St and Liberty Ave by Gateway), so they don't pop in at the swap. `data.heads`:
   * [{name, dir, fromM, toM, s0, route, index}] — each escalator in the subway line's metres and a short piece of that
   * line round it (its own 10 m samples from s0: the same frames, so the same headhouse, shaft and treads as the
   * subway area draws); `data.platforms` (the station colours). No tube, trains or people: the shaft ends in a wall
   * at its foot. The ground opens over each shaft as in the subway area.
   */
  _headsOnly(data, ground) {
    this.spans = data.heads;
    this.conv = data.heads.map((h) => ({ fromM: h.fromM, toM: h.toM, dir: h.dir, name: h.name, mps: 3 }));
    this.platforms = data.platforms || []; this.river = [Infinity, Infinity];
    this.s0 = this.s1 = NaN;   // (no tube)
    this.mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true });
    this.glow = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true, toneMapped: false, side: THREE.DoubleSide });
    this.disposables.push(this.mat, this.glow);
    const T = new Builder(), G = new Builder(), S = new Builder();
    for (const c of this.conv) {
      this._shaft(c, T, G, S);
      // the shaft's foot: a tiled wall where the subway area's platform opens
      const foot = c.dir === 'down' ? c.toM : c.fromM, f = this.F(foot);
      this.quad(T, this.at(f, SHAFT.l, FLOOR), this.at(f, SHAFT.r, FLOOR), this.at(f, SHAFT.r, SHAFT.h), this.at(f, SHAFT.l, SHAFT.h), linear(STN.tile));
    }
    this._mesh(T.build(), this.mat, 'Subway headhouses');
    this._mesh(G.build(), this.glow, 'Subway headhouse lights');
    this._mesh(S.build(), this.mat, 'Subway headhouse fittings');
    this._treads();
    this._glass();
    this._signs();
    if (ground?.userData.holes) this._holes(ground.userData.holes);
    this.t = 0;
  }

  // ---- frames along the line ----
  /** {x, y, z, fx, fz, rx, rz}: a point of the line, its flat forward and right (+ = right riding outbound). */
  F(s) {
    if (this.spans) {   // [F123] headhouses only: the piece of the subway line round this metre
      const h = this.spans.find((q) => s >= q.s0 - 1 && s <= q.s0 + q.route.total + 1) || this.spans[0], u = s - h.s0;
      const p = routePoint(h.route, h.index, u), a = routePoint(h.route, h.index, u - 1.5), b = routePoint(h.route, h.index, u + 1.5);
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1, fx = (b.x - a.x) / l, fz = (b.z - a.z) / l;
      return { x: p.x, y: p.y, z: p.z, fx, fz, rx: -fz, rz: fx };
    }
    const p = routePoint(this.route, this.index, s), a = routePoint(this.route, this.index, s - 1.5), b = routePoint(this.route, this.index, s + 1.5);
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1, fx = (b.x - a.x) / l, fz = (b.z - a.z) / l;
    return { x: p.x, y: p.y, z: p.z, fx, fz, rx: -fz, rz: fx };
  }
  at(f, lat, h) { return new THREE.Vector3(f.x + f.rx * lat, f.y + h, f.z + f.rz * lat); }
  quad(B, a, b, c, d, col) {
    const g = new THREE.BufferGeometry().setFromPoints([a, b, c, a, c, d]);
    B.add(g, new THREE.Matrix4(), col);
  }
  /** Quads between two cross-sections (same point count): one colour per piece from colOf(k). */
  strip(B, f0, f1, sec0, sec1, colOf) {
    for (let k = 0; k < sec0.length - 1; k++) {
      const c = colOf(k); if (!c) continue;
      this.quad(B, this.at(f0, ...sec0[k]), this.at(f1, ...sec1[k]), this.at(f1, ...sec1[k + 1]), this.at(f0, ...sec0[k + 1]), c);
    }
  }
  _mesh(geometry, material, name) {
    const m = new THREE.Mesh(geometry, material); m.name = name; m.frustumCulled = true;
    this.group.add(m); this.disposables.push(geometry); return m;
  }

  // ---- what kind of place s is ----
  station(s) { const p = this.platforms.find((q) => s > q.fromM - 25 && s < q.toM + 25); if (!p) return 0; const d = Math.max(p.fromM - s, s - p.toM, 0); return Math.max(0, 1 - d / 25); }
  riverT(s) { return Math.max(0, Math.min(1, Math.min(s - this.river[0] + 15, this.river[1] + 15 - s) / 30)); }
  look(s) {
    const r = this.riverT(s), st = this.station(s), base = r > 0 ? RIVER : LAND;
    const pick = (k) => { const c = lerpC(LAND[k], RIVER[k], r); return st > 0 && STN[k] ? c.lerp(linear(STN[k]), st) : c; };
    const pi = this.platforms.findIndex((q) => s > q.fromM - 25 && s < q.toM + 25);
    const band = pi >= 0 && st > .5 ? linear(STATION_BANDS[pi % STATION_BANDS.length]) : pick('band');
    return { tile: pick('tile'), tile2: pick('tile2'), band, ceil: pick('ceil'), light: lerpC(LAND.light, RIVER.light, r), base, st };
  }

  // ---- the tube: track bed, platform edge, path, walkway, tiled walls, ceiling; light strips ----
  _tube(T, G) {
    const step = 1.5;
    for (let s = this.s0; s < this.s1 - .01; s += step) {
      const e = Math.min(this.s1, s + step), f0 = this.F(s), f1 = this.F(e), L = this.look(s + step / 2);
      const st0 = this.station(s), st1 = this.station(e);
      const W = (st) => TUBE.wall + (STATION.wall - TUBE.wall) * st, H = (st) => TUBE.h + (STATION.h - TUBE.h) * st;
      const shade = .9 + .1 * Math.cos((2 * Math.PI * (s + step / 2)) / 9);   // brighter under each ceiling lamp
      const tone = (c, k = 1) => c.clone().multiplyScalar(shade * k);
      // floor pieces (left to right): track bed, platform edge face, safety strip, path, walkway
      const floor = (st) => [[WALL_L, BED], [EDGE, BED], [EDGE, FLOOR], [EDGE + .6, FLOOR], [-1.5, FLOOR], [-1.38, FLOOR], [2.48, FLOOR], [2.6, FLOOR], [W(st), FLOOR]];
      const fc = [linear(BEDC), linear('#8f8a80'), linear(SAFETY), linear('#3d8f5c'), linear('#f4f4f0'), linear(PATH), linear('#f4f4f0'), linear(WALK)];
      this.strip(T, f0, f1, floor(st0), floor(st1), (k) => tone(fc[k]));
      // the centre line: dashes
      if (Math.floor(s / 3) % 2 === 0) this.quad(T, this.at(f0, .5, FLOOR + .01), this.at(f1, .5, FLOOR + .01), this.at(f1, .62, FLOOR + .01), this.at(f0, .62, FLOOR + .01), linear('#fbe9a0'));
      // right wall: tile rows to the band, the band, rows above, then the chamfer and the ceiling, the left wall
      const rows = [FLOOR, .6, 1.2, 1.5, 2.1, 2.55, 2.7, 3.2];
      const right = (st) => rows.map((h) => [W(st), h]).concat([[W(st) - 1.2, H(st)], [-9.2, H(st)], [WALL_L, H(st) - 1.2]]).concat([3.2, 2.4, 1.6, .8, 0, BED].map((h) => [WALL_L, h]));
      const alt = Math.floor(s / step) % 2;
      this.strip(T, f0, f1, right(st0), right(st1), (k) => {
        if (k === 2) return tone(L.band);
        if (k === 5) return null;   // the LED strip (glow)
        if (k >= 7 && k <= 8) return tone(L.ceil, k === 8 ? .96 : .9);
        const t = (k + alt) % 2 ? L.tile : L.tile2;
        return tone(t, k > 9 ? .86 : 1);
      });
      // the path light: an LED strip along the right wall, and the ceiling lamps' strip over the path
      this.quad(G, this.at(f0, W(st0) - .02, 2.55), this.at(f1, W(st1) - .02, 2.55), this.at(f1, W(st1) - .02, 2.7), this.at(f0, W(st0) - .02, 2.7), L.light);
      this.quad(G, this.at(f0, .1, H(st0) - .03), this.at(f1, .1, H(st1) - .03), this.at(f1, 1.1, H(st1) - .03), this.at(f0, 1.1, H(st0) - .03), L.light);
      this.quad(G, this.at(f0, -6.4, H(st0) - .03), this.at(f1, -6.4, H(st1) - .03), this.at(f1, -5.6, H(st1) - .03), this.at(f0, -5.6, H(st0) - .03), L.light.clone().multiplyScalar(.8));
    }
  }

  // ---- an escalator shaft: walls, ceiling, the landing at its foot and its top, the headhouse on the street ----
  _shaft(c, T, G, S) {
    const down = c.dir === 'down', top = down ? c.fromM : c.toM, foot = down ? c.toM : c.fromM, out = down ? -1 : 1;   // out: towards the street
    const a = Math.min(top, foot), b = Math.max(top, foot);
    // the shaft runs past the top into the headhouse (8 m) and joins the tube at the foot
    const s0 = down ? a - 8 : a, s1 = down ? b : b + 8;
    const step = 1;
    for (let s = s0; s < s1 - .01; s += step) {
      const e = Math.min(s1, s + step), f0 = this.F(s), f1 = this.F(e), L = this.look(s);
      const shade = .9 + .1 * Math.cos((2 * Math.PI * s) / 6);
      const sec = [[SHAFT.r, FLOOR], [SHAFT.r, 1.1], [SHAFT.r, 1.4], [SHAFT.r, SHAFT.h - .8], [SHAFT.r - .8, SHAFT.h], [SHAFT.l + .8, SHAFT.h], [SHAFT.l, SHAFT.h - .8], [SHAFT.l, 1.4], [SHAFT.l, 1.1], [SHAFT.l, FLOOR]];
      this.strip(T, f0, f1, sec, sec, (k) => (k === 1 || k === 7 ? L.band.clone().multiplyScalar(shade) : (k === 3 || k === 4 || k === 5 ? linear(LAND.ceil).multiplyScalar(shade * .95) : linear(STN.tile).multiplyScalar(shade))));
      // floor beside the treads (not the treads: their own animated mesh)
      const inTread = s >= a - .01 && e <= b + .01;
      for (const [l0, l1] of inTread ? [[SHAFT.l, SHAFT.tread[0]], [SHAFT.tread[1], SHAFT.r]] : [[SHAFT.l, SHAFT.r]]) {
        this.quad(T, this.at(f0, l0, FLOOR), this.at(f1, l0, FLOOR), this.at(f1, l1, FLOOR), this.at(f0, l1, FLOOR), linear(inTread ? '#9aa0a8' : WALK).multiplyScalar(shade));
      }
      this.quad(G, this.at(f0, .3, SHAFT.h - .03), this.at(f1, .3, SHAFT.h - .03), this.at(f1, 1.3, SHAFT.h - .03), this.at(f0, 1.3, SHAFT.h - .03), linear(LAND.light));
      // balustrades: a skirt along each side of the treads with a black handrail on top
      if (inTread) for (const l of SHAFT.tread) {
        const w = l < 1 ? -.12 : .12;
        this.quad(S, this.at(f0, l, FLOOR), this.at(f1, l, FLOOR), this.at(f1, l, FLOOR + .35), this.at(f0, l, FLOOR + .35), linear('#c8ccd2'));
        this.quad(S, this.at(f0, l + w, FLOOR + .95), this.at(f1, l + w, FLOOR + .95), this.at(f1, l + w, FLOOR + 1.05), this.at(f0, l + w, FLOOR + 1.05), linear('#1d1f22'));
        this.quad(S, this.at(f0, l - w * .2, FLOOR + 1.05), this.at(f1, l - w * .2, FLOOR + 1.05), this.at(f1, l + w * 1.4, FLOOR + 1.05), this.at(f0, l + w * 1.4, FLOOR + 1.05), linear('#1d1f22'));
      }
    }
    // how far down the shaft its ceiling still rises above the ground (there the ground opens: _holes)
    let open = 12;
    if (this.L?.heightAt) for (let d = 0; d < 60; d += 1) {
      const f = this.F(top - out * d), p = this.at(f, .8, 0);
      if (f.y + SHAFT.h + 1 < this.L.heightAt(p.x, p.z)) break;
      open = d + 3;
    }
    // the headhouse: a glass pavilion over the shaft's top, open to the street, with a canopy and its name
    const h0 = top + out * 7, h1 = top - out * Math.max(16, open + 2), ft = this.F(top);
    (this.heads ||= []).push({ c, top, h0, h1, open, name: c.name });
    const roofY = ft.y + 4.4, Lh = [-3.2, 4.8];
    for (let s = Math.min(h0, h1); s < Math.max(h0, h1) - .01; s += 2) {
      const e = Math.min(Math.max(h0, h1), s + 2), f0 = this.F(s), f1 = this.F(e);
      const roof = (f, l) => { const p = this.at(f, l, 0); p.y = roofY; return p; };
      this.quad(S, roof(f0, Lh[0] - .6), roof(f1, Lh[0] - .6), roof(f1, Lh[1] + .6), roof(f0, Lh[1] + .6), linear('#eeebe4'));
      const fasc = (f, l, y) => { const p = this.at(f, l, 0); p.y = y; return p; };
      for (const l of [Lh[0] - .6, Lh[1] + .6]) this.quad(S, fasc(f0, l, roofY), fasc(f1, l, roofY), fasc(f1, l, roofY + .45), fasc(f0, l, roofY + .45), linear('#1fa59a'));
      // steel posts at the corners of each bay
      for (const l of Lh) { const p = this.at(f0, l, 0); S.add(box(.18, 1, .18), M(p.x, Math.min(p.y, ft.y) - 1, p.z, 1, roofY - Math.min(p.y, ft.y) + 1, 1), '#41474f'); }
    }
    // the back wall (the far end from the street) and a low plinth along the sides
    const fb = this.F(h1);
    this.quad(S, (() => { const p = this.at(fb, Lh[0], 0); p.y = ft.y - 3; return p; })(), (() => { const p = this.at(fb, Lh[1], 0); p.y = ft.y - 3; return p; })(),
      (() => { const p = this.at(fb, Lh[1], 0); p.y = roofY; return p; })(), (() => { const p = this.at(fb, Lh[0], 0); p.y = roofY; return p; })(), linear('#dcd8cf'));
  }

  // ---- the tube's ends: a wall with the tracks' tunnel mouth (dark) beside the shaft's opening ----
  _ends(T) {
    for (const [s, dir] of [[this.s0, 1], [this.s1, -1]]) {
      const f = this.F(s), st = this.station(s + dir), Wr = TUBE.wall + (STATION.wall - TUBE.wall) * st, H = TUBE.h + (STATION.h - TUBE.h) * st;
      const wall = linear(STN.tile), dark = linear('#14161a'), dark2 = linear('#22252b');
      const q = (l0, h0, l1, h1, c) => this.quad(T, this.at(f, l0, h0), this.at(f, l1, h0), this.at(f, l1, h1), this.at(f, l0, h1), c);
      // over the track bed, round the tracks' tunnel mouth: the wall is cut round the opening (it was one quad with
      // the dark mouth drawn on it, the same plane: they fought for depth, a black wedge on the wall)
      const M0 = -9.6, M1 = -2.5, MH = 3.9, D = 6;   // the mouth's sides, its top and how deep it goes on (dark)
      q(WALL_L, BED, M0, H, wall); q(M1, BED, EDGE, H, wall); q(M0, MH, M1, H, wall);
      // the mouth: a short dark tunnel going on beyond the wall (sides, roof, back), level with the end
      const bx = -dir * f.fx * D, bz = -dir * f.fz * D, on = (v) => new THREE.Vector3(v.x + bx, v.y, v.z + bz);
      const P = (l, h) => this.at(f, l, h);
      this.quad(T, P(M0, BED), on(P(M0, BED)), on(P(M0, MH)), P(M0, MH), dark2);
      this.quad(T, P(M1, BED), on(P(M1, BED)), on(P(M1, MH)), P(M1, MH), dark2);
      this.quad(T, P(M0, MH), on(P(M0, MH)), on(P(M1, MH)), P(M1, MH), dark);
      this.quad(T, P(M0, BED), on(P(M0, BED)), on(P(M1, BED)), P(M1, BED), linear(BEDC).multiplyScalar(.45));
      this.quad(T, on(P(M0, BED)), on(P(M1, BED)), on(P(M1, MH)), on(P(M0, MH)), dark);
      q(SHAFT.r, FLOOR, Wr, H, wall);           // right of the shaft
      q(EDGE, SHAFT.h, SHAFT.r, H, wall);       // over the shaft's opening
    }
  }

  // ---- rails, railing, benches, the tracks' sleepers ----
  _dressing(S) {
    const rand = randomSequence(5150);
    for (let s = this.s0; s < this.s1 - 2; s += 2) {
      const f0 = this.F(s), f1 = this.F(s + 2);
      for (const tc of TRACKS) for (const o of [-.72, .72]) {
        const l = tc + o;
        this.quad(S, this.at(f0, l - .04, BED + .16), this.at(f1, l - .04, BED + .16), this.at(f1, l + .04, BED + .16), this.at(f0, l + .04, BED + .16), linear(RAIL));
      }
      // the railing between path and tracks: posts every 2 m and a top rail
      const p = this.at(f0, EDGE + .12, FLOOR);
      S.add(box(.07, 1, .07), M(p.x, p.y, p.z, 1, 1.05, 1), SAFETY);
      this.quad(S, this.at(f0, EDGE + .12, 1.08), this.at(f1, EDGE + .12, 1.08), this.at(f1, EDGE + .12, 1.16), this.at(f0, EDGE + .12, 1.16), linear(SAFETY));
      this.quad(S, this.at(f0, EDGE + .12, .55), this.at(f1, EDGE + .12, .55), this.at(f1, EDGE + .12, .6), this.at(f0, EDGE + .12, .6), linear(SAFETY));
      // benches on the platforms
      if (this.station(s) > .9 && Math.round(s) % 14 === 0) {
        const q = this.at(f0, 5.6, FLOOR), yaw = Math.atan2(-f0.rx, -f0.rz);
        S.add(box(1.8, .45, .5), M(q.x, q.y, q.z, 1, 1, 1, yaw + Math.PI / 2), '#7a5a3c', .05, rand);
      }
    }
  }

  // ---- escalator treads: steps scrolling the way the rider rides (tick) ----
  _treads() {
    const c = document.createElement('canvas'); c.width = 32; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#8d939b'; g.fillRect(0, 0, 32, 64);
    for (let y = 0; y < 64; y += 4) { g.fillStyle = y % 8 ? '#7d838b' : '#a2a8b0'; g.fillRect(0, y, 32, 2); }
    g.fillStyle = '#f2c230'; g.fillRect(0, 0, 32, 5); g.fillRect(0, 0, 2, 64); g.fillRect(30, 0, 2, 64);
    const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
    this.treadTex = tex;
    const pos = [], uv = [];
    for (const cv of this.conv) for (let s = cv.fromM; s < cv.toM - .01; s += 1) {
      const e = Math.min(cv.toM, s + 1), f0 = this.F(s), f1 = this.F(e);
      const v = [this.at(f0, SHAFT.tread[0], FLOOR + .02), this.at(f1, SHAFT.tread[0], FLOOR + .02), this.at(f1, SHAFT.tread[1], FLOOR + .02), this.at(f0, SHAFT.tread[1], FLOOR + .02)];
      for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(v[k].x, v[k].y, v[k].z); uv.push(k === 2 || k === 3 ? 1 : 0, (k === 1 || k === 2 ? e : s) / .45); }
    }
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g2.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const m = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
    this.disposables.push(tex, m);
    this._mesh(g2, m, 'Escalator treads');
  }

  // ---- glass: the headhouses' walls and the balustrades' panels (one transparent mesh) ----
  _glass() {
    const B = new Builder();
    for (const h of this.heads || []) {
      const ft = this.F(h.top), roofY = ft.y + 4.4;
      for (let s = Math.min(h.h0, h.h1); s < Math.max(h.h0, h.h1) - .01; s += 2) {
        const f0 = this.F(s), f1 = this.F(Math.min(Math.max(h.h0, h.h1), s + 2));
        for (const l of [-3.2, 4.8]) {
          const a = this.at(f0, l, 0), b = this.at(f1, l, 0);
          const lo = Math.min(a.y, b.y, ft.y) - .2;
          this.quad(B, new THREE.Vector3(a.x, lo, a.z), new THREE.Vector3(b.x, lo, b.z), new THREE.Vector3(b.x, roofY, b.z), new THREE.Vector3(a.x, roofY, a.z), '#9fd3e6');
        }
      }
    }
    for (const cv of this.conv) for (let s = cv.fromM; s < cv.toM - .01; s += 1) {
      const f0 = this.F(s), f1 = this.F(Math.min(cv.toM, s + 1));
      for (const l of SHAFT.tread) this.quad(B, this.at(f0, l, FLOOR + .35), this.at(f1, l, FLOOR + .35), this.at(f1, l, FLOOR + .95), this.at(f0, l, FLOOR + .95), '#bfe6f0');
    }
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: .35, depthWrite: false, side: THREE.DoubleSide });
    this.disposables.push(m);
    this._mesh(B.build(), m, 'Subway glass');
  }

  // ---- signs: one atlas of names (generic, no agency marks), quads on the walls and over the headhouses ----
  _signs() {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
    const g = c.getContext('2d');
    SIGNS.forEach((t, i) => {
      g.fillStyle = '#16324a'; g.fillRect(0, i * 128, 1024, 128);
      g.fillStyle = i < 2 ? STATION_BANDS[i] : i === 2 ? RIVER.band : '#4caf6e'; g.fillRect(0, i * 128 + 110, 1024, 18);
      g.fillStyle = '#ffffff'; g.font = `bold ${i === 3 ? 54 : 74}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(t, 512, i * 128 + 56);
    });
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const pos = [], uv = [];
    const add = (f, lat, y0, w, hgt, row, face = -1) => {
      // a board on the right wall (facing left, into the tunnel) or across the way (face 0: facing the rider)
      const a = this.at(f, lat, y0), d = face ? { x: -f.fx, z: -f.fz } : { x: f.rx, z: f.rz };   // (read from inside the tunnel)
      const half = w / 2, P = [[-half, 0], [half, 0], [half, hgt], [-half, hgt]].map(([u, v]) => new THREE.Vector3(a.x + d.x * u, a.y + v, a.z + d.z * u));
      const v0 = 1 - (row + 1) / 4, v1 = 1 - row / 4, U = [[0, v0], [1, v0], [1, v1], [0, v1]];
      for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(P[k].x, P[k].y, P[k].z); uv.push(...U[k]); }
    };
    if (!this.spans) this.platforms.forEach((p, i) => {   // (not with the headhouses only: F123)
      const row = Math.min(1, i);
      for (let s = p.fromM + 8; s < p.toM - 4; s += 16) add(this.F(s), STATION.wall - .05, 2.0, 4.2, .52, row);
      add(this.F((p.fromM + p.toM) / 2), 1.2, STATION.h - 1.4, 3.2, .4, row, 0);   // hanging over the path
    });
    for (const s of [this.river[0], this.river[1]]) if (Number.isFinite(s)) add(this.F(s), TUBE.wall - .05, 3.0, 4.6, .5, 2);
    for (let s = this.s0 + 120; s < this.s1 - 120; s += 160) add(this.F(s), TUBE.wall - .05, 3.0, 3.8, .42, 3);
    for (const h of this.heads || []) {
      const f = this.F(h.top + (h.h0 - h.top) * .9);
      add(f, .8, 4.85, 5.2, .65, h.name === 'Gateway' ? 1 : 0, 0);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const m = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false });
    this.disposables.push(tex, m);
    this._mesh(geo, m, 'Subway signs');
  }

  // ---- trains: two-car light-rail trains on both tracks, never on the path ----
  // [F125] A stylised take on Pittsburgh's light-rail cars: each car two sections on an articulation (bellows), cabs
  // at both ends (coupled cab to cab), white with a red skirt and a black window band, lit windows with riders in
  // them, a pantograph, an amber destination sign. One instance per section, so a train bends on the curve. Doors
  // (two per side per section) slide open on the platform side while it dwells (a vertex shader: Builder part =
  // which leaf). Head- and tail-lights are camera-facing glows (bright in the dark mouths, through the tunnel air).
  _trains() {
    const { secL, W } = TRAIN, half = secL / 2, rand = randomSequence(6215);
    const B = new Builder();
    const WHITE = '#eceef0', RED = '#c8202e', BLACK = '#1b1e22', LIT = '#ffe08f', ROOF = '#c4c8cd';
    // body (the cab end at +z: its nose tapers in over the last 1.3 m)
    const body = half - 1.3, zb0 = -half + .42, Lb = body - zb0, zc = (body + zb0) / 2;
    B.add(box(W, .6, Lb), M(0, .45, zc), RED);
    B.add(box(W, .5, Lb), M(0, 1.05, zc), WHITE);
    B.add(box(W - .02, 1.0, Lb), M(0, 1.55, zc), BLACK);
    B.add(box(W, .65, Lb), M(0, 2.55, zc), WHITE);
    B.add(box(W - .25, .25, Lb), M(0, 3.2, zc), ROOF);
    // windows: lit panes (proud of the black band) between pillars, with riders' heads and shoulders in them
    for (const sx of [-1, 1]) for (let z = zb0 + .9; z < body - .7; z += 1.65) {
      if (TRAIN.doors.some((d) => Math.abs(z - d) < 1.25)) continue;
      B.add(box(.02, .78, 1.3), M(sx * (W / 2 + .005), 1.65, z), LIT);
      if (rand() < .55) { const zz = z + (rand() - .5) * .6; B.add(box(.025, .34, .42), M(sx * (W / 2 + .006), 1.65, zz), '#4a4540'); B.add(box(.025, .24, .2), M(sx * (W / 2 + .007), 2.0, zz), '#4a4540'); }
    }
    // door openings (the lit inside, seen when the leaves slide) and the leaves (parts 1–4: side × slide)
    for (const sx of [-1, 1]) for (const dz of TRAIN.doors) {
      B.add(box(.02, 2.15, 1.34), M(sx * (W / 2 + .004), .5, dz), '#ffd67a');
      for (const sl of [-1, 1]) {
        B.as((sx < 0 ? 1 : 3) + (sl < 0 ? 0 : 1));
        const z = dz + sl * .34;
        B.add(box(.04, 2.1, .66), M(sx * (W / 2 + .03), .52, z), '#d3d7dc');
        B.add(box(.05, .8, .46), M(sx * (W / 2 + .035), 1.62, z), LIT);
        B.add(box(.05, 2.1, .06), M(sx * (W / 2 + .035), .52, z + sl * .3), '#f2b630');
        B.as(0);
      }
    }
    // the cab nose: a red lower front, a wrap-round black windscreen, an amber destination sign, a white cap
    const nz = body, nl = 1.3;
    B.add(box(W * .96, .95, nl * .9), M(0, .45, nz + nl * .45), RED);
    B.add(box(W * .9, 1.15, nl * .7), M(0, 1.4, nz + nl * .5), BLACK);
    B.add(box(W * .82, .3, nl * .55), M(0, 2.55, nz + nl * .45), '#ffb43a');
    B.add(box(W * .92, .55, nl * .6), M(0, 2.85, nz + nl * .3), WHITE);
    B.add(box(W * .8, .2, nl * .4), M(0, 3.2, nz + nl * .2), ROOF);
    for (const x of [-.85, .85]) B.add(box(.34, .16, .05), M(x, .82, nz + nl * .9), '#fff6d8');   // head/tail lamp housings
    // the articulation's half at -z: dark bellows ribs
    for (let k = 0; k < 4; k++) B.add(box(W * .86, 2.7, .08), M(0, .55, -half + .06 + k * .11), k % 2 ? '#2f3237' : '#45494f');
    // roof gear and (on the cab half) a pantograph
    B.add(box(1.2, .3, 2.6), M(0, 3.45, -1.5), '#8d939b');
    const bar = (x0, y0, z0, x1, y1, z1, t = .06) => { const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1), l = a.distanceTo(b);
      const g = new THREE.BoxGeometry(t, t, l); const m = new THREE.Matrix4().lookAt(b, a, new THREE.Vector3(0, 1, 0)).setPosition(a.clone().add(b).multiplyScalar(.5)); B.add(g, m, '#2b2e33'); };
    bar(0, 3.75, 1.8, 0, 4.35, 2.8); bar(0, 4.35, 2.8, 0, 4.85, 1.9); bar(-.7, 4.85, 1.9, .7, 4.85, 1.9, .08);
    const geo = B.build();
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aTree; attribute vec2 aDoor;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          if (aTree > .5) {   // a door leaf: slides along the car when this section's doors on its side are open
            float side = aTree < 2.5 ? -1. : 1., sl = mod(aTree, 2.) > .5 ? -1. : 1.;
            transformed.z += sl * .62 * aDoor.x * step(.5, side * aDoor.y);
          }`);
    };
    mat.customProgramCacheKey = () => 'subway-train-2';
    this.trainMat = mat;
    const n = 8;
    this.trains = new THREE.InstancedMesh(geo, mat, n);
    this._door = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2); this._door.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aDoor', this._door);
    this.trains.name = 'Subway trains'; this.trains.frustumCulled = false;
    this.group.add(this.trains); this.disposables.push(geo, mat);
    // lamps: head (warm white) at the front, tail (red) at the back of each train
    this.lamps = glowSprites(12, 'Subway train lights'); this.group.add(this.lamps); this.disposables.push(this.lamps.geometry, this.lamps.material);
    this.carL = TRAIN.carL;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._q2 = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._sc = new THREE.Vector3(1, 1, 1);
  }

  /** Where a train's front is at time t (outbound metres; dir +1 outbound on the near track, −1 on the far one). */
  trainFront(t, dir) { return this.trainState(t, dir)?.front ?? null; }
  /**
   * A train's state at time t: { front (outbound metres), open (doors 0–1), leg (0 in, 1 dwell, 2 run, 3 dwell, 4 out),
   * u (seconds into the leg), d (the leg's seconds) }, or null while it's in the tunnels beyond (hidden).
   */
  trainState(t, dir) {
    const PERIOD = TRAIN.period, len = TRAIN.trainL, P0 = this.platforms[0], P1 = this.platforms[1];
    // outbound (near track): in from the first mouth, dwell at the first platform, run, dwell at the second, out of
    // the far mouth; inbound (far track) the other way. The front stops at the platform's far end each way.
    const seq = dir > 0
      ? [this.s0 - 4, P0 ? P0.toM - 2 : this.s0 + 60, P1 ? P1.toM - 2 : this.s1 - 2, this.s1 + len + 4]
      : [this.s1 + 4, P1 ? P1.fromM + 2 : this.s1 - 60, P0 ? P0.fromM + 2 : this.s0 + 2, this.s0 - len - 4];
    const legs = [[seq[0], seq[1], 9], [seq[1], seq[1], TRAIN.dwell], [seq[1], seq[2], Math.abs(seq[2] - seq[1]) / 11 + 6], [seq[2], seq[2], TRAIN.dwell], [seq[2], seq[3], 9]];
    let u = ((t + (dir > 0 ? 0 : TRAIN.offset)) % PERIOD + PERIOD) % PERIOD;
    for (let k = 0; k < legs.length; k++) {
      const [a, b, d] = legs[k];
      if (u < d) {
        const q = u / d, e = q * q * (3 - 2 * q);
        // doors: open 2.5 s after it stops, close 3 s before it leaves (1.5 s each way)
        const open = a === b ? Math.max(0, Math.min(1, (u - 2.5) / 1.5, (d - 3 - u) / 1.5)) : 0;
        return { front: a + (b - a) * e, open, leg: k, u, d };
      }
      u -= d;
    }
    return null;
  }

  _people() {
    const rand = randomSequence(4127), list = [];
    for (const p of this.platforms) for (let k = 0; k < 7; k++) {
      const s = p.fromM + 6 + rand() * (p.toM - p.fromM - 12), f = this.F(s), lat = 3.4 + rand() * 2.6, q = this.at(f, lat, FLOOR);
      const yaw = Math.atan2(-f.rx, -f.rz) + (rand() - .5) * 1.2;
      list.push({ look: randomLook(rand), x: q.x, y: q.y, z: q.z, yaw, clip: rand() < .7 ? CLIP.idle : CLIP.look, phase: rand(), rate: 1 });
    }
    if (!list.length) return;
    this.peopleMat = figureMaterial(this.uniforms.uTime);
    this.people = staticCrowdMesh(list, this.peopleMat, 'Subway riders', 'hi');
    this.group.add(this.people); this.disposables.push(this.peopleMat, this.people.geometry);
  }

  // ---- the ground opens over each shaft's top (inside its headhouse) ----
  _holes(holes) {
    (this.heads || []).slice(0, 4).forEach((h, i) => {
      const down = h.c.dir === 'down', dir = down ? 1 : -1;
      // from the top to where the shaft's ceiling is 1 m under the ground (the escalator's slope: ~0.28)
      const a = h.top - dir * 1.5, b = h.top + dir * h.open, fa = this.F(a), fb = this.F(b), fm = this.F((a + b) / 2);
      const ca = this.at(fa, .8, 0), cb = this.at(fb, .8, 0);
      const len = Math.hypot(cb.x - ca.x, cb.z - ca.z), ux = (cb.x - ca.x) / len, uz = (cb.z - ca.z) / len;
      holes.a.value[i].set((ca.x + cb.x) / 2, (ca.z + cb.z) / 2, ux, uz);
      holes.b.value[i].set(len / 2, (SHAFT.r - SHAFT.l) / 2 + .3, 1, 0);
      void fm;
    });
    this.holes = holes;
  }

  /** Every frame: trains move, the escalators' steps run the way the rider rides. */
  tick(dt, rider) {
    this.t += dt;
    if (this.treadTex) this.treadTex.offset.y -= (rider?.dir < 0 ? -1 : 1) * 3 * dt / .45;
    if (!this.trains) return;
    let n = 0, nl = 0;
    const states = [];
    for (const [dir, lat] of [[1, TRACKS[0]], [-1, TRACKS[1]]]) {
      const st = this.trainState(this.t, dir);
      states.push(st && { ...st, dir, lat });
      if (!st) continue;
      TRAIN.sections.forEach(([off, flip], k) => {
        const c = st.front - dir * off;
        if (c < this.s0 - 30 || c > this.s1 + 30) return;
        const a = this._trackF(c - TRAIN.secL / 2 + .5), b = this._trackF(c + TRAIN.secL / 2 - .5), m = this._trackF(c);
        let fx = (b.x - a.x) * dir, fy = (b.y - a.y) * dir, fz = (b.z - a.z) * dir;
        const l = Math.hypot(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l;
        this._q.setFromUnitVectors(_Z, this._v.set(fx, fy, fz));
        if (flip) this._q.multiply(this._q2.setFromAxisAngle(_Y, Math.PI));
        const px = m.x + m.rx * lat, py = m.y + BED + .25, pz = m.z + m.rz * lat;
        this._m.compose(this._v.set(px, py, pz), this._q, this._sc);
        this.trains.setMatrixAt(n, this._m);
        // the doors on the platform side (the path's, right of the line): the section's local +x is (fz, −fx) turned
        const sx = flip ? -1 : 1, side = Math.sign(((fz * m.rx - fx * m.rz) * sx) || 1);
        this._door.setXY(n, st.open, side); n++;
        // lamps: head-lights on the lead cab, tail-lights on the last
        if (k === 0 || k === TRAIN.sections.length - 1) {
          const end = k === 0 ? 1 : -1, ex = px + fx * TRAIN.secL / 2 * end, ez = pz + fz * TRAIN.secL / 2 * end, ey = py + fy * TRAIN.secL / 2 * end + .9;
          for (const o of [-.85, .85]) {
            const lx = ex + fz * o, lz = ez - fx * o;
            setGlow(this.lamps, nl++, lx, ey, lz, k === 0 ? 2.6 : 1.3, k === 0 ? _HEAD : _TAIL);
          }
          if (k === 0) setGlow(this.lamps, nl++, ex, ey + 1.95, ez, 2.2, _HEAD);   // the high centre lamp over the windscreen
        }
      });
    }
    this.trains.count = n; this.trains.instanceMatrix.needsUpdate = true; this._door.needsUpdate = true;
    this.lamps.count = nl; this.lamps.instanceMatrix.needsUpdate = true; this.lamps.geometry.attributes.aGlow.needsUpdate = true;
    this.trainStates = states;
    this.sound?.update(this, rider, dt);   // [subway sound]
  }

  /** The tracks' frame at s: the line's in the tube; beyond its ends (into the dark mouths) it runs straight on, level. */
  _trackF(s) {
    const e = s < this.s0 ? this.s0 : s > this.s1 ? this.s1 : null;
    if (e == null) return this.F(s);
    const f = this.F(e), d = s - e;
    return { ...f, x: f.x + f.fx * d, z: f.z + f.fz * d };
  }

  setNight() {}

  dispose() {
    this.sound?.dispose();
    if (this.holes) for (const v of this.holes.b.value) v.z = 0;
    this.group.removeFromParent();
    for (const d of this.disposables) d.dispose?.();
    this.trains?.dispose();
  }
}
/**
 * [subway sound] The subway's ambience, from the trains' timetable and where the rider is (the line's metres): a low
 * tunnel air underground, the escalators' hum near them, a train's rumble as it comes and goes (louder the nearer
 * it is and the faster it moves), its brakes as it stops, the door tones before it leaves, its motors winding up,
 * and the station chime ~8 s before a train comes in at the platform you're near. Quiet; heard only below ground
 * (and faintly at the headhouses).
 */
class SubwaySound {
  constructor() { this.prev = new Map(); this.voices = null; }
  _voices() {
    return this.voices ||= {
      air: worldSound.loop('subway-air', (ctx, out) => [noiseLoop(ctx, out, { kind: 'brown', freq: 260, gain: .6 })]),
      hum: worldSound.loop('subway-escalator', (ctx, out) => [toneLoop(ctx, out, 100, .25), toneLoop(ctx, out, 150, .08, 'triangle'), noiseLoop(ctx, out, { kind: 'white', type: 'bandpass', freq: 900, q: 1.4, gain: .05 })]),
      rumble: worldSound.loop('subway-train', (ctx, out) => { const n = noiseLoop(ctx, out, { kind: 'brown', freq: 140, q: 1.1, gain: 1.4 }); this._rf = n.filter; return [n, toneLoop(ctx, out, 55, .18, 'triangle')]; }),
    };
  }
  update(sub, rider, dt) {
    if (rider?.out == null || !worldSound.touch()) return;
    const V = this._voices(), r = rider.out, U = sub.under;
    const fall = (d, R) => { const k = Math.max(0, 1 - d / R); return k * k; };
    const deep = r > U.fromM + 4 && r < U.toM - 4 ? 1 : 0;
    const nearTop = Math.min(...sub.conv.map((c) => Math.abs(r - (c.dir === 'down' ? c.fromM : c.toM))));
    const hear = deep || fall(nearTop, 40) * .5;   // up at the headhouses: faintly
    V.air.set(.18 * (deep ? 1 : fall(nearTop, 30)));
    const dEsc = Math.min(...sub.conv.map((c) => Math.max(0, c.fromM - r, r - c.toM)));
    V.hum.set(.3 * fall(dEsc, 45) * Math.max(hear, fall(dEsc, 45)));
    // trains: the nearest one's rumble; events by leg
    let loud = 0, pitch = 0;
    for (const st of sub.trainStates || []) {
      if (!st) continue;
      const tail = st.front - st.dir * TRAIN.trainL, d = Math.hypot(Math.max(0, Math.min(st.front, tail) - r, r - Math.max(st.front, tail)), Math.abs(st.lat));
      const moving = st.leg % 2 === 0 ? Math.sin(Math.PI * Math.min(1, st.u / st.d)) * .7 + .3 : .15;
      const lv = fall(d, 220) * moving * hear;
      if (lv > loud) { loud = lv; pitch = moving; }
      const pv = this.prev.get(st.dir), stopAt = st.leg === 1 || st.leg === 3 ? st.front : null;
      const level = fall(Math.abs(r - st.front), 160) * hear;
      if (pv && pv.leg !== st.leg) {
        if (stopAt != null) worldSound.play('brakes', level);
        if (st.leg === 2 || st.leg === 4) worldSound.play('depart', level);
      }
      if (pv && pv.leg === st.leg && stopAt != null && pv.u < st.d - 4.5 && st.u >= st.d - 4.5) worldSound.play('doors', level);
      // the chime: ~8 s before it stops at a platform, heard near that platform
      if (pv && pv.leg === st.leg && (st.leg === 0 || st.leg === 2)) {
        const left = st.d - st.u, was = pv.d - pv.u;
        if (was > 8 && left <= 8) {
          const P = sub.platforms[(st.dir > 0) === (st.leg === 0) ? 0 : 1];
          if (P) worldSound.play('chime', fall(Math.max(0, P.fromM - r, r - P.toM), 120) * hear);
        }
      }
      this.prev.set(st.dir, { leg: st.leg, u: st.u, d: st.d });
    }
    V.rumble.set(.55 * loud);
    if (this._rf) this._rf.frequency.setTargetAtTime(90 + 170 * pitch, this._rf.context.currentTime, .3);
    void dt;
  }
  dispose() { if (this.voices) for (const v of Object.values(this.voices)) v.stop(); this.voices = null; }
}

const _Z = new THREE.Vector3(0, 0, 1), _Y = new THREE.Vector3(0, 1, 0);
const _HEAD = new THREE.Color('#fff2cc'), _TAIL = new THREE.Color('#ff3a2a');

/** Camera-facing additive glows (an instanced quad; per-instance colour `aGlow`), always on, through the fog. */
function glowSprites(n, name) {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.setAttribute('aGlow', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
  const mat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */`
      attribute vec3 aGlow; varying vec3 vColor; varying vec2 vUv;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        vUv = uv; vColor = aGlow;
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(0., 0., 0., 1.);
        mv.xy += (uv - .5) * length(instanceMatrix[0].xyz);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vColor; varying vec2 vUv;
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        float r = length(vUv - .5) * 2.;
        float a = exp(-r * r * 5.) * .8 + exp(-r * r * 60.);
        if (a < .004) discard;
        gl_FragColor = vec4(vColor * a, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const im = new THREE.InstancedMesh(geo, mat, n);
  im.name = name; im.frustumCulled = false; im.count = 0; im.renderOrder = 6;
  return im;
}
const _gm = new THREE.Matrix4(), _gq = new THREE.Quaternion(), _gv = new THREE.Vector3(), _gs = new THREE.Vector3();
function setGlow(im, i, x, y, z, size, color) {
  im.setMatrixAt(i, _gm.compose(_gv.set(x, y, z), _gq, _gs.set(size, size, size)));
  im.geometry.attributes.aGlow.setXYZ(i, color.r, color.g, color.b);
}
