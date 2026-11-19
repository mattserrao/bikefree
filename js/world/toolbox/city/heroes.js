// Pittsburgh's marquee landmarks, modelled from their real forms rather than from extruded map footprints:
// the U.S. Steel Tower (a triangle with notched corners and exposed Cor-Ten columns), BNY Mellon Center,
// Fifth Avenue Place (stepped crown and mast), the Gulf Tower (stepped pyramid lit as the weather beacon),
// the Grant Building's beacon (PITTSBURGH in Morse code), the Fort Pitt Blockhouse and the fort's bastions
// at the Point, and the cantilevered overlook decks along Grandview Avenue.
//
// Each hero is anchored by position in the scene (`heroes`: model, lat, lon) and replaces the map footprints
// it stands on. The scene's `views` add postcard camera positions for the scenic ("vista") camera.
// The landmarks outside downtown (Oakland's icons, the churches, the Homestead steel heritage: PLAN 7.7) are in
// city/landmark-heroes.js and share this build's builders and helpers.
import * as THREE from '../../../../vendor/three.module.min.js';
import { MeshBuilder } from '../core/mesh-builder.js';
import { ROAD_WIDTH } from '../../pose.js';
import { V, TAU, centroid, area2, orient, scaleRing, lerp2, inPoly, prism, cap, block, chamfer } from './hero-geom.js';
import { landmarkModels } from './landmark-heroes.js';

// ---------------------------------------------------------------- materials
/** Lit at night: an `aGlow` colour added as emission, scaled by the city's night. */
function neonMaterial(city) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .55, metalness: .1 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = city.night;
    shader.uniforms.uPulse = city.heroPulse;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aGlow; varying vec3 vGlow;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvGlow = aGlow;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight, uPulse; varying vec3 vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow * uNight * 2.2 * (.8 + .2 * uPulse);');
  };
  m.customProgramCacheKey = () => 'city-heroes-neon-1';
  return city.own(m);
}

// ---------------------------------------------------------------- the build
export function buildHeroes(city) {
  const scene = city.route.scene || {}, L = city.landscape, D = city.D;
  const out = { tick: null, landmarks: [] };
  city.heroPulse = { value: 0 };
  const W = new MeshBuilder({ aBld: 4 });      // walls with the city's windows (lit at night)
  const S = new MeshBuilder();                 // plain solid details
  const N = new MeshBuilder({ aGlow: 3 });     // surfaces that light up at night
  const glows = [], beacons = [];
  const local = (lat, lon) => D.proj.toLocal(lat, lon);
  const ground = (ring) => { let g = Infinity; for (const p of ring) g = Math.min(g, L.heightAt(p.x, p.z)); return g; };
  const groundMax = (ring) => { let g = -Infinity; for (const p of ring) g = Math.max(g, L.heightAt(p.x, p.z)); return g; };
  const wall = (kind, seed, g, roof = 0, color = null) => { if (color) W.color(color); return W.set({ aBld: [kind, seed * 100, g, roof] }); };

  /** The map footprints a hero stands on (centroid within `r` metres, or the anchor inside it); they're hidden. */
  const claim = (p, r = 18, minH = 0) => {
    const found = [];
    for (const b of city.buildings) {
      if (b.h < minH || Math.abs(b.bb[0] - p.x) > 150 || Math.abs(b.bb[2] - p.z) > 150) continue;
      const c = centroid(b.ring);
      if (Math.hypot(c.x - p.x, c.z - p.z) < r || inPoly(b.ring, p.x, p.z)) found.push(b);
    }
    for (const b of found) b.hero = true;
    return found.sort((a, b) => b.h - a.h);
  };

  /** Map buildings the hero's plan cuts into (any corner of either inside the other) give way to it. */
  const clearUnder = (plan) => {
    const c = centroid(plan); let r = 0; for (const q of plan) r = Math.max(r, Math.hypot(q.x - c.x, q.z - c.z));
    for (const b of city.buildings) {
      if (b.hero || b.bb[1] < c.x - r || b.bb[0] > c.x + r || b.bb[3] < c.z - r || b.bb[2] > c.z + r) continue;
      if (b.ring.some((q) => inPoly(plan, q.x, q.z)) || plan.some((q) => inPoly(b.ring, q.x, q.z))) b.hero = true;
    }
  };

  const models = {
    // U.S. Steel Tower: 256 m, an equilateral triangle with notched corners, 18 exposed Cor-Ten columns
    ussteel(p, o) {
      const [b] = claim(p, 30, 60);
      const ring0 = b ? b.ring : null, c = ring0 ? centroid(ring0) : p;
      let a0 = (o.yawDeg || 0) * Math.PI / 180, R = o.radiusM || 46;
      if (ring0) { let far = 0; for (const q of ring0) { const d = Math.hypot(q.x - c.x, q.z - c.z); if (d > far) { far = d; a0 = Math.atan2(q.z - c.z, q.x - c.x); } } R = Math.min(52, far); }
      const tri = [0, 1, 2].map((k) => ({ x: c.x + Math.cos(a0 + k * TAU / 3) * R, z: c.z + Math.sin(a0 + k * TAU / 3) * R }));
      const plan = chamfer(tri, .11, .09), g = ground(plan), H = o.heightM || 256;
      clearUnder(scaleRing(plan, 1.06, c));
      wall(9, .31, g, 0, '#4f3226'); block(W, plan, g - 1, g + H);
      // the columns stand proud of the glass: six on each face, Cor-Ten weathered dark
      S.color('#4a2c20');
      for (let k = 0; k < 3; k++) {
        const A = tri[k], Bv = tri[(k + 1) % 3], len = Math.hypot(Bv.x - A.x, Bv.z - A.z), nx = (Bv.z - A.z) / len, nz = -(Bv.x - A.x) / len;
        const sgn = ((A.x + Bv.x) / 2 - c.x) * nx + ((A.z + Bv.z) / 2 - c.z) * nz > 0 ? 1 : -1;
        for (let j = 0; j < 6; j++) {
          const q = lerp2(A, Bv, .27 + j * .092);
          S.box(q.x + nx * sgn * 1.2, g, q.z + nz * sgn * 1.2, 2.6, H + .6, 2.2, Math.atan2(Bv.x - A.x, Bv.z - A.z));
        }
      }
      S.color('#3c2a22'); block(S, scaleRing(plan, .78, c), g + H, g + H + 5);
      beacons.push({ x: c.x, y: g + H + 7, z: c.z });
    },

    // BNY Mellon Center: 221 m, grey granite with notched corners, a stepped crown with a lit band
    bny(p, o) {
      const found = claim(p, 20, 60), b = found[0];
      if (!b) return;
      const ring = b.ring, c = centroid(ring), g = ground(ring), H = o.heightM || b.h;
      clearUnder(scaleRing(ring, 1.03, c));
      wall(5, .57, g, 0, '#6d767c'); prism(W, ring, g - 1, g + H - 12);
      wall(5, .57, g, 1, '#4f565b'); cap(W, ring, g + H - 12);
      const r1 = scaleRing(ring, .93, c), r2 = scaleRing(ring, .82, c);
      wall(5, .58, g, 0, '#7a8389'); block(W, r1, g + H - 12, g + H - 4);
      N.color('#8f969a').set({ aGlow: [.75, .85, 1] }); prism(N, scaleRing(ring, .935, c), g + H - 4.6, g + H - 3.6);
      S.color('#6f777c'); block(S, r2, g + H - 4, g + H);
      beacons.push({ x: c.x, y: g + H + 2, z: c.z });
    },

    // Fifth Avenue Place: a granite shaft with cut corners, a stepped pyramid crown (lit) and a 30 m mast
    fifth(p, o) {
      const found = claim(p, 20, 60), body = found.find((b) => b.mh === 0) || found[0];
      if (!body) return;
      const ring = chamfer(body.ring.length === 4 ? body.ring : scaleRing(body.ring, 1), .16), c = centroid(ring), g = ground(body.ring);
      const top = o.bodyM || 150;
      clearUnder(scaleRing(ring, 1.03, c));
      wall(4, .83, g, 0, '#b49c97'); prism(W, ring, g - 1, g + top);
      for (let k = 0; k < 5; k++) {
        const f0 = .96 - k * .17, y0 = g + top + k * 4.6;
        S.color(k % 2 ? '#a99996' : '#b9a7a2'); block(S, scaleRing(ring, f0, c), y0, y0 + 4.6);
        N.color('#c9b8b2').set({ aGlow: [1, .93, .82] }); prism(N, scaleRing(ring, f0 + .012, c), y0 + 3.9, y0 + 4.6);
      }
      S.color('#8d9aa3'); S.cylinder(c.x, g + top + 23, c.z, .9, 33, 8, .25);
      beacons.push({ x: c.x, y: g + top + 57, z: c.z });
    },

    // Gulf Tower: 177 m Art Deco limestone, setbacks, a stepped pyramid modelled on the Mausoleum at
    // Halicarnassus, lit at night as the weather beacon (blue for fair and colder, orange for warmer)
    gulf(p, o) {
      const found = claim(p, 25);
      const fp = found.slice().sort((a, b) => Math.abs(area2(b.ring)) - Math.abs(area2(a.ring)))[0]?.ring;
      let ring = fp && fp.length === 4 ? fp : [-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ x: p.x + sx * 20, z: p.z + sz * 20 * sx })));
      ring = scaleRing(ring, .86);
      const c = centroid(ring), g = ground(ring), H = o.heightM || 177;
      clearUnder(scaleRing(ring, 1.03, c));
      wall(11, .21, g, 0, '#cdbf9f'); prism(W, ring, g - 1, g + 30);
      const shaft = chamfer(scaleRing(ring, .84, c), .08);
      wall(11, .22, g); prism(W, shaft, g + 30, g + 132);
      wall(11, .22, g, 1); cap(W, ring, g + 30);
      const s1 = scaleRing(shaft, .9, c), s2 = scaleRing(shaft, .8, c);
      wall(11, .23, g); prism(W, s1, g + 132, g + 140); cap(W, shaft, g + 132);
      prism(W, s2, g + 140, g + 147); cap(W, s1, g + 140);
      // the step pyramid: nine courses, each edge lit
      const steps = 9, y0 = g + 147, top = g + H - 6;
      for (let k = 0; k < steps; k++) {
        const f = .74 * (1 - k / steps) + .1, ya = y0 + (top - y0) * k / steps, yb = y0 + (top - y0) * (k + 1) / steps;
        const r = scaleRing(s2, f, c);
        S.color('#cbbd9f'); block(S, r, ya, yb);
        N.color('#d6c9ad').set({ aGlow: k < 2 ? [.95, .35, .6] : [.25, .55, 1] }); prism(N, scaleRing(s2, f + .01, c), yb - .7, yb);
      }
      N.color('#e8dcc0').set({ aGlow: [1, .55, .15] }); block(N, scaleRing(s2, .1, c), top, top + 3.5);
      S.color('#b7a98d'); S.pyramid(c.x, top + 3.5, c.z, 3, 2.5);
      out.gulfLantern = { x: c.x, y: top + 2, z: c.z };
    },

    // Grant Building: its rooftop beacon has spelled P-I-T-T-S-B-U-R-G-H in Morse code since 1929
    grant(p) {
      const [b] = claim(p, 25, 60);
      if (!b) return;
      b.hero = false;   // the building itself stays as drawn: only the mast and beacon are added
      const c = centroid(b.ring), g = ground(b.ring);
      S.color('#5b6166'); S.cylinder(c.x, g + b.h, c.z, .45, 14, 6, .2);
      out.morse = { x: c.x, y: g + b.h + 14.5, z: c.z };
    },

    // Fort Pitt Blockhouse (1764): [w2-polish] a five-sided redoubt: a dressed-stone footing, brick walls laid in
    // courses with a stone band at the floor line, two rows of gun loops (dark slots with stone sills and lintels)
    // on every face, a plank door, a timber plate at the eaves and a five-sided hipped roof of shingle courses
    // rising to a short finial, with a brick chimney through it. All in the solid-detail builder.
    blockhouse(p) {
      const found = claim(p, 6), b = found.find((q) => q.h < 16);
      // always five sides: the map's footprint gives the size, centre and turn (its longest edge)
      let c = p, R = 5.2, turn = 0;
      if (b) {
        c = centroid(b.ring);
        R = Math.max(3.5, Math.min(8, Math.sqrt(Math.abs(area2(b.ring)) / 2 / (2.5 * Math.sin(TAU / 5)))));
        let best = 0;
        b.ring.forEach((a, i) => { const q = b.ring[(i + 1) % b.ring.length], len = Math.hypot(q.x - a.x, q.z - a.z); if (len > best) { best = len; turn = Math.atan2(q.z - a.z, q.x - a.x) - TAU / 10 - TAU / 4; } });
      }
      const ring = orient(Array.from({ length: 5 }, (_, k) => ({ x: c.x + Math.cos(turn + k * TAU / 5) * R, z: c.z + Math.sin(turn + k * TAU / 5) * R })));
      const g = ground(ring), floor = g + 3.1, eaves = g + 6.2;
      const faceOut = (A, B, C2, D2, want) => { const n = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(D2, A)); if (n.dot(want) >= 0) S.quad(A, B, C2, D2); else S.quad(A, D2, C2, B); };
      S.color('#8e8678'); block(S, scaleRing(ring, 1.05, c), g - .6, g + .7);                       // stone footing
      S.color('#9a9286'); block(S, scaleRing(ring, 1.065, c), g + .7, g + .82);                      // its weathered cap
      const courses = 7;
      for (let k = 0; k < courses; k++) {                                                           // brick, in courses
        const y0 = g + .82 + (eaves - g - .82) * k / courses, y1 = g + .82 + (eaves - g - .82) * (k + 1) / courses;
        S.color(k % 2 ? '#8b4b36' : '#83452f'); prism(S, ring, y0, y1);
      }
      S.color('#b2a691'); prism(S, scaleRing(ring, 1.018, c), floor - .12, floor + .12);            // stone band at the floor line
      S.color('#6f5a45'); block(S, scaleRing(ring, 1.08, c), eaves, eaves + .32);                    // timber plate at the eaves
      // gun loops: two rows, three per face (the door face: the upper row and two below)
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], q = ring[(i + 1) % ring.length], len = Math.hypot(q.x - a.x, q.z - a.z);
        const tx = (q.x - a.x) / len, tz = (q.z - a.z) / len;
        let nx = tz, nz = -tx; const m0 = lerp2(a, q, .5); if ((m0.x - c.x) * nx + (m0.z - c.z) * nz < 0) { nx = -nx; nz = -nz; }
        const yaw = Math.atan2(nx, nz);
        for (const [y, ts] of [[g + 1.9, i === 0 ? [.18, .82] : [.22, .5, .78]], [g + 4.5, [.22, .5, .78]]]) for (const t of ts) {
          const m = lerp2(a, q, t);
          S.color('#17120f'); S.box(m.x + nx * .02, y, m.z + nz * .02, .62, .2, .06, yaw);           // the slot
          S.color('#b2a691'); S.box(m.x + nx * .04, y - .09, m.z + nz * .04, .82, .09, .1, yaw);     // sill
          S.box(m.x + nx * .04, y + .2, m.z + nz * .04, .82, .1, .1, yaw);                           // lintel
        }
        if (i === 0) {   // a plank door with a stone surround, on the first face
          S.color('#b2a691'); S.box(m0.x + nx * .03, g + .8, m0.z + nz * .03, 1.5, 2.45, .1, yaw);
          S.color('#3d2b1f'); S.box(m0.x + nx * .07, g + .82, m0.z + nz * .07, 1.1, 2.2, .06, yaw);
        }
      }
      // five-sided hipped roof in shingle courses: each course a little proud of the one above (a dark drip line)
      const apexY = eaves + 3.4, n = 7, eave = scaleRing(ring, 1.14, c);
      const at = (f, k) => ({ x: c.x + (eave[k].x - c.x) * (1 - f), z: c.z + (eave[k].z - c.z) * (1 - f) });
      for (let j = 0; j < n; j++) {
        const f0 = j / n, f1 = (j + 1) / n, y0 = eaves + .32 + (apexY - eaves - .32) * f0, y1 = eaves + .32 + (apexY - eaves - .32) * f1;
        for (let k = 0; k < 5; k++) {
          const k2 = (k + 1) % 5, a0 = at(f0, k), b0 = at(f0, k2), a1 = at(f1 - .02, k), b1 = at(f1 - .02, k2);
          const mx = (a0.x + b0.x) / 2 - c.x, mz = (a0.z + b0.z) / 2 - c.z;
          S.color(j % 2 ? '#4f4741' : ((k + j) % 3 ? '#574e46' : '#5c534a'));
          faceOut(V(a0.x, y0, a0.z), V(b0.x, y0, b0.z), V(b1.x, y1 + .04, b1.z), V(a1.x, y1 + .04, a1.z), V(mx, 1, mz));
          S.color('#2f2a26'); faceOut(V(a0.x, y0 - .07, a0.z), V(b0.x, y0 - .07, b0.z), V(b0.x, y0, b0.z), V(a0.x, y0, a0.z), V(mx, 0, mz));   // the course's edge
        }
      }
      S.color('#3e3833'); S.cylinder(c.x, apexY - .05, c.z, .22, .7, 6, .05);                       // finial
      // brick chimney rising through the roof
      const ch = lerp2(c, ring[2], .38);
      S.color('#7b4a37'); S.box(ch.x, eaves, ch.z, .8, apexY - eaves + .6, .8);
      S.color('#8e8678'); S.box(ch.x, apexY + .6, ch.z, .95, .18, .95);
    },

    // Fort Pitt (1759-61): a five-bastioned pentagon. The Flag and Monongahela bastions are rebuilt in brick
    // (the museum is inside the Monongahela bastion); the others are marked by granite outlines in the lawn.
    fort(p, o) {
      const R = o.radiusM || 72, names = ['Flag', 'Monongahela', 'Ohio', 'Music', 'Grenadier'];
      const rebuilt = new Set(o.rebuilt || ['Flag', 'Monongahela']), traced = new Set(o.traced || ['Ohio', 'Music']);
      const bearings = [180, 252, 324, 36, 108].map((b) => (b + (o.turnDeg || 0)) * Math.PI / 180);
      const dirOf = (br) => ({ x: Math.sin(br), z: -Math.cos(br) });   // local x east, z south
      const clear = (x, z, pad = 3) => {
        const r = L.routeDist(x, z);
        if (r && r.d < ROAD_WIDTH / 2 + pad) return false;
        // (ramp decks passing well overhead don't count; the park's footpaths run round the bastions)
        const gx = L.heightAt(x, z);
        if (L.streetsNear(x, z, 1).some((o) => city.streets[o.k].cls < 8 && !(city.streets[o.k].bridge && o.y > gx + 5))) return false;
        const b = city.buildingNear(x, z, 1);
        return L.waterAt(x, z) < .2 && (!b || b.hero);
      };
      const tracery = (a, b) => {
        const len = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(len / 3));
        S.color('#cfccc3');
        for (let k = 0; k < n; k++) {
          const q0 = lerp2(a, b, k / n), q1 = lerp2(a, b, (k + 1) / n), m = lerp2(q0, q1, .5);
          if (!clear(m.x, m.z, 1)) continue;
          S.beam(V(q0.x, L.heightAt(q0.x, q0.z) + .05, q0.z), V(q1.x, L.heightAt(q1.x, q1.z) + .05, q1.z), .7, .1);
        }
      };
      const shapes = bearings.map((br) => {
        const u = dirOf(br), v = { x: -u.z, z: u.x }, at = (along, side) => ({ x: p.x + u.x * along + v.x * side, z: p.z + u.z * along + v.z * side });
        return { tip: at(R, 0), s1: at(R - 26, -19), s2: at(R - 26, 19), f1: at(R - 36, -14), f2: at(R - 36, 14) };
      });
      // the Monongahela bastion houses the museum: the map's footprint for it gives way to the bastion
      claim(lerp2(lerp2(shapes[1].f1, shapes[1].f2, .5), shapes[1].tip, .4), 24).forEach((b) => { if (b.h > 16) b.hero = false; });
      shapes.forEach((sh0, k) => {
        const name = names[k];
        // the rebuilt bastions sit hard against today's roads: shrink one toward its tip until it's clear
        // (the placement is good to ~±20 m: each may also shift up to 12 m; the largest clear fit wins)
        let sh = sh0, ok = false;
        const tries = [];
        for (const f of rebuilt.has(name) ? [1, .85, .7, .55] : [1]) for (let dx = -12; dx <= 12; dx += 6) for (let dz = -12; dz <= 12; dz += 6) tries.push([f, dx, dz]);
        tries.sort((a, b) => b[0] - a[0] || Math.hypot(a[1], a[2]) - Math.hypot(b[1], b[2]));
        for (const [f, dx, dz] of tries) {
          const sc = (q) => { const r = lerp2(sh0.tip, q, f); return { x: r.x + dx, z: r.z + dz }; };
          sh = { tip: sc(sh0.tip), s1: sc(sh0.s1), s2: sc(sh0.s2), f1: sc(sh0.f1), f2: sc(sh0.f2) };
          const o = [sh.f1, sh.s1, sh.tip, sh.s2, sh.f2];
          ok = o.every((q) => clear(q.x, q.z)) && [.25, .5, .75].every((t) => { const m = lerp2(lerp2(sh.f1, sh.f2, .5), sh.tip, t); return clear(m.x, m.z); })
            && [0, 1, 2, 3, 4].every((i) => { const m = lerp2(o[i], o[(i + 1) % 5], .5); return clear(m.x, m.z); });
          if (ok) break;
          if (!rebuilt.has(name)) { sh = sh0; break; }
        }
        if (!ok) sh = sh0;
        shapes[k] = sh;
        const outline = [sh.f1, sh.s1, sh.tip, sh.s2, sh.f2];
        (out.fort ||= []).push(`${name}: ${rebuilt.has(name) && ok ? 'rebuilt' : 'outline'}`);
        if (rebuilt.has(name) && ok) {
          const g = ground(outline), gt = groundMax(outline) + 4;
          S.color('#8e5642'); prism(S, outline, g - .5, gt);
          S.color('#b3a894'); prism(S, scaleRing(outline, 1.012), gt - .45, gt + .15);   // stone coping
          S.color('#668f48'); cap(S, scaleRing(outline, .985), gt + .15);                 // grass on the rampart
          S.color('#7d4c3a'); prism(S, [sh.f2, sh.f1], g - .5, gt);                       // the gorge wall at the back
          glows.push({ x: sh.tip.x, y: gt + 1, z: sh.tip.z, size: 6, color: '#ffdca0' });
        } else if (traced.has(name) || rebuilt.has(name)) {
          for (let i = 0; i < outline.length - 1; i++) tracery(outline[i], outline[i + 1]);
        }
      });
      // curtain walls between the bastions, as granite lines
      for (let k = 0; k < 5; k++) tracery(shapes[k].f2, shapes[(k + 1) % 5].f1);
      // the flag on the Flag bastion
      const flag = shapes[0];
      if (rebuilt.has('Flag')) {
        const m = lerp2(lerp2(flag.f1, flag.f2, .5), flag.tip, .45), g = groundMax([flag.tip, flag.f1, flag.f2]) + 4.2;
        if (clear(m.x, m.z)) { S.color('#d8d8d8'); S.cylinder(m.x, g, m.z, .12, 14, 6, .08); S.color('#b0283a'); S.box(m.x + .9, g + 12, m.z, 1.8, 1.1, .05); }
      }
    },
  };

  // [7.7] Oakland's icons, the churches on the routes and the Homestead steel heritage
  Object.assign(models, landmarkModels({ city, L, W, S, N, glows, beacons, out, claim, clearUnder, ground, groundMax, wall, local }));

  for (const h of scene.heroes || []) {
    const fn = models[h.model];
    if (fn) fn(local(h.lat, h.lon), h);
  }
  overlooks(city, S, N, glows, out, scene);
  /** [7.7] Does a hero stand at (x, z) (within `pad`)? The city's trees keep off them. */
  out.covers = (x, z, pad = 0) => (out.zones || []).some((o) => {
    if (o.F) { const dx = x - o.F.c.x, dz = z - o.F.c.z; if (Math.hypot(dx, dz) > o.r + pad) return false; return Math.abs(dx * o.F.u.x + dz * o.F.u.z) < o.hl + pad && Math.abs(dx * o.F.v.x + dz * o.F.v.z) < o.hw + pad; }
    return Math.hypot(x - o.c.x, z - o.c.z) < o.r + pad;
  });

  // ---------------------------------------------------------------- meshes
  const add = (B, mat, name) => {
    if (!B.count) return null;
    B.keepOutOf(L.inRouteTube, { whole: true });
    const m = new THREE.Mesh(city.own(B.geometry()), mat);
    m.castShadow = m.receiveShadow = true; m.name = name; city.group.add(m);
    return m;
  };
  add(W, city.buildingMaterial, 'Landmark towers');
  add(S, city.solidMaterial, 'Landmarks');
  add(N, neonMaterial(city), 'Landmark lights');
  city.addGlows(glows, 'Landmark lamps');
  city.addGlows(beacons.map((b) => ({ ...b, size: 6, color: '#ff3b2e' })), 'Tower beacons');
  const lantern = out.gulfLantern && city.addGlows([{ ...out.gulfLantern, size: 22, color: '#ff9a3c' }], 'Gulf Tower beacon');
  const morse = out.morse && city.addGlows([{ ...out.morse, size: 12, color: '#ff2a1a' }], 'Grant Building beacon');

  // PITTSBURGH in Morse code, a dot every 0.3 s; the Gulf Tower's lantern breathes
  const code = 'PITTSBURGH'.split('').map((ch) => ({ P: '.--.', I: '..', T: '-', S: '...', B: '-...', U: '..-', R: '.-.', G: '--.', H: '....' })[ch]);
  const timeline = [];
  for (const letter of code) { for (const sym of letter) { timeline.push([1, sym === '.' ? 1 : 3], [0, 1]); } timeline.push([0, 2]); }
  timeline.push([0, 6]);
  const total = timeline.reduce((a, [, n]) => a + n, 0), m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  out.tick = (time) => {
    city.heroPulse.value = .5 + .5 * Math.sin(time * 1.3);
    if (morse) {
      let t = Math.floor((time / .3) % total), on = 0;
      for (const [v, n] of timeline) { if (t < n) { on = v; break; } t -= n; }
      const s = on ? 12 : .001;
      morse.setMatrixAt(0, m4.compose(V(out.morse.x, out.morse.y, out.morse.z), q, V(s, s, s))); morse.instanceMatrix.needsUpdate = true;
    }
    if (lantern) {
      const s = 18 + 6 * city.heroPulse.value;
      lantern.setMatrixAt(0, m4.compose(V(out.gulfLantern.x, out.gulfLantern.y, out.gulfLantern.z), q, V(s, s, s))); lantern.instanceMatrix.needsUpdate = true;
    }
  };

  // ---------------------------------------------------------------- postcard views for the scenic camera
  const route = city.route, index = city.index, end = route.turnIdx || route.dist.length - 1;
  const nearestS = (x, z) => { const r = index.nearest(x, z, 2000); return r ? route.dist[Math.min(end, r.i)] : null; };
  for (const v of scene.views || []) {
    const cp = local(v.cam.lat, v.cam.lon), lp = local(v.look.lat, v.look.lon);
    const camY = (v.cam.abs ?? (Math.max(L.heightAt(cp.x, cp.z), L.level) + (v.cam.up ?? 30)));
    const lookY = (v.look.abs ?? (L.heightAt(lp.x, lp.z) + (v.look.up ?? 0)));
    const s = v.atM ?? nearestS(cp.x, cp.z);
    out.landmarks.push({ name: v.name, s, x: lp.x, y: lookY, z: lp.z, fx: 0, fz: 1, slope: 0, asset: null, range: v.rangeM || 700,
      view: { pos: V(cp.x, camY, cp.z), look: V(lp.x, lookY, lp.z) } });
  }
  return out;
}

// ---------------------------------------------------------------- Grandview Avenue overlooks
/**
 * The overlook decks along Grandview Avenue: concrete half-moons cantilevered out over the bluff on brackets,
 * with railings, benches, a coin-operated viewer and a lamp. Placed where the real ground falls away hardest
 * on the city side of the route (`scene.overlooks`: fromM, toM, count), each at least 200 m from the next.
 * The best one also gets a postcard view toward the Point.
 */
function overlooks(city, S, N, glows, out, scene) {
  const cfg = scene.overlooks;
  if (!cfg) return;
  const L = city.landscape, route = city.route, index = city.index, end = route.turnIdx || route.dist.length - 1;
  const towardP = cfg.toward ? L.decoded.proj.toLocal(cfg.toward.lat, cfg.toward.lon) : null;
  const cands = [];
  for (let s = cfg.fromM; s <= cfg.toM; s += 10) {
    const i = Math.min(end - 2, Math.round(s / 10));
    if (L.routeBridges.some((b) => s > b.fromM - 20 && s < b.toM + 20)) continue;
    const dx = index.xs[i + 1] - index.xs[i - 1], dz = index.zs[i + 1] - index.zs[i - 1], len = Math.hypot(dx, dz) || 1;
    for (const side of [-1, 1]) {
      const nx = -dz / len * side, nz = dx / len * side, x = index.xs[i], z = index.zs[i], e = route.ele[i];
      const drop = e - L.terrainAt(x + nx * 34, z + nz * 34), near = e - L.terrainAt(x + nx * 14, z + nz * 14);
      if (drop < 22 || near < 3) continue;
      // facing the city: the side toward the target, if one is given
      const face = towardP ? (towardP.x - x) * nx + (towardP.z - z) * nz : 1;
      if (face <= 0) continue;
      cands.push({ s, i, side, nx, nz, drop, x, z, e });
    }
  }
  cands.sort((a, b) => b.drop - a.drop);
  const picked = [];
  for (const c of cands) { if (picked.length < (cfg.count || 4) && picked.every((p) => Math.abs(p.s - c.s) > (cfg.spacingM || 200))) picked.push(c); }
  picked.sort((a, b) => a.s - b.s);
  for (const c of picked) {
    const r = 6.5, off = ROAD_WIDTH / 2 + 3.2 + r * .15, cx = c.x + c.nx * off, cz = c.z + c.nz * off, y = c.e - .15;
    const yaw = Math.atan2(c.nx, c.nz), seg = 14;   // (the viewer faces out)
    // a half-moon: outward n = (nx, nz), along the road t = (-nz, nx)
    const arc = Array.from({ length: seg + 1 }, (_, k) => { const a = -Math.PI / 2 + Math.PI * k / seg; return { x: cx + (c.nx * Math.cos(a) - c.nz * Math.sin(a)) * r, z: cz + (c.nz * Math.cos(a) + c.nx * Math.sin(a)) * r }; });
    const deck = arc;
    // deck slab with an edge band
    S.color('#b9b3a6'); block(S, deck, y - .55, y);
    S.color('#9a9488'); prism(S, scaleRing(deck, 1.01, { x: cx, z: cz }), y - .8, y - .5);
    // brackets down to the slope
    S.color('#8f897d');
    for (let k = 1; k < seg; k += 3) {
      const q = arc[k], g = L.terrainAt(q.x, q.z);
      if (y - g > 1.5) S.beam(V(q.x, y - .6, q.z), V(cx + (q.x - cx) * .2, Math.max(g, y - 9), cz + (q.z - cz) * .2), .45, .45);
    }
    // railing: posts and a top rail round the arc
    S.color('#2f3438');
    for (let k = 0; k <= seg; k++) { const q = arc[k]; S.box(q.x, y, q.z, .1, 1.1, .1); if (k) { const a = arc[k - 1]; S.beam(V(a.x, y + 1.05, a.z), V(q.x, y + 1.05, q.z), .08, .08); S.beam(V(a.x, y + .55, a.z), V(q.x, y + .55, q.z), .05, .05); } }
    // two benches facing the view, a coin-operated viewer, a lamp
    for (const sgn of [-1, 1]) {   // (on the deck itself: the roadside strip behind it has the street lamps)
      const bx = cx - c.nz * sgn * 3 + c.nx * 1.6, bz = cz + c.nx * sgn * 3 + c.nz * 1.6;
      S.color('#6b4a33'); S.box(bx, y + .42, bz, .5, .08, 1.8, Math.atan2(-c.nz, c.nx) + Math.PI / 2);
      S.color('#2f3438'); S.box(bx, y, bz, .4, .42, .1, Math.atan2(-c.nz, c.nx) + Math.PI / 2);
    }
    const vx = cx + c.nx * (r - 1.2), vz = cz + c.nz * (r - 1.2);
    S.color('#2c4f6e'); S.cylinder(vx, y, vz, .08, 1.05, 6); S.box(vx, y + 1.05, vz, .28, .22, .42, yaw);
    const lx = cx + c.nz * (r - 1) + c.nx * .6, lz = cz - c.nx * (r - 1) + c.nz * .6;
    S.color('#2f3438'); S.cylinder(lx, y, lz, .07, 4.2, 6);
    glows.push({ x: lx, y: y + 4.3, z: lz, size: 7, color: '#ffe0a8' });
  }
  // the postcard: from the first deck, over the railing toward the Point
  const best = picked.slice().sort((a, b) => b.drop - a.drop)[0];
  if (best && towardP) {
    const lookP = cfg.look ? L.decoded.proj.toLocal(cfg.look.lat, cfg.look.lon) : towardP;
    const deckX = best.x + best.nx * (ROAD_WIDTH / 2 + 3.2 + 6.5 * .15), deckZ = best.z + best.nz * (ROAD_WIDTH / 2 + 3.2 + 6.5 * .15);
    out.landmarks.push({ name: 'Grandview Overlook', s: best.s, x: lookP.x, y: L.level + 40, z: lookP.z, fx: 0, fz: 1, slope: 0, asset: null, range: 450,
      view: { pos: V(deckX - best.nx * 1.5, best.e + 4.5, deckZ - best.nz * 1.5), look: V(lookP.x, L.level + (cfg.look?.up ?? 55), lookP.z) } });
  }
  out.overlooks = picked.map((c) => c.s);
}

