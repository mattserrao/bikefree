// Visitors: people at the stops along a scenic road — standing at the overlooks taking it in, wandering
// slowly around a car park or a lodge, some with a dog or a stroller, kids among them. Built from the figures kit
// (figures/people.js): detailed near the camera, light further off, animated by baked clips in the vertex shader.
// Portable: a scene's "visitors" block.
//
//   "visitors": {
//     "spots": [ { "site": "Logan Pass parking", "count": 14 },              // around a site pad
//                { "atM": 22312, "side": -1, "lateralM": 16, "radiusM": 14, "count": 6 } ],
//     "lookouts": 3,          // people at each overlook in the scene's "lookouts"
//     "walking": 0.45,        // share who stroll (the rest stand, facing the view)
//     "kids": 0.14, "dogs": 0.12, "strollers": 0.06   // optional: shares among visitors / strollers
//   }
import * as THREE from '../../../../vendor/three.js';
import { randomSequence } from '../core/random.js';
import { pedestrians } from './population.js';   // [27 Nov] no pedestrians
import { Crowd, CLIP, FIT, randomLook, dogLook, clipRate, PALETTES } from './figures/people.js';

const ROAD_HALF = 3.5;
// standing at a view: mostly looking, some taking photos or on the phone, a few chatting (idle)
const STANDING = [[CLIP.look, .35], [CLIP.photo, .25], [CLIP.idle, .25], [CLIP.phone, .15]];
const pickClip = (rand, table) => { let r = rand(); for (const [c, w] of table) { r -= w; if (r <= 0) return c; } return table[0][0]; };

export class Visitors {
  constructor(parent, landscape, route, index, uniforms, config = {}, quality = 'balanced', lookouts = []) {
    this.L = landscape; this.route = route; this.index = index; this.u = uniforms;
    this.group = new THREE.Group(); this.group.name = 'Visitors'; parent.add(this.group);
    const rand = (this.rand = randomSequence(6061));
    const scale = pedestrians(quality === 'low' ? .5 : quality === 'ultra' ? 1.5 : quality === 'high' ? 1.25 : 1);   // [27 Nov] no pedestrians: nobody at the overlooks
    const walking = config.walking ?? .45, people = [];
    const spot = (cx, cz, rIn, rOut, count, face) => {
      for (let k = 0, tries = 0; k < Math.round(count * scale) && tries < 400; tries++) {
        const a = rand() * Math.PI * 2, r = rIn + Math.sqrt(rand()) * (rOut - rIn), x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        const y = this.L.heightAt(x, z);
        if (this.index.nearest(x, z, ROAD_HALF + .9) || this.L.isWater?.(x, z, y)) continue;
        const walk = rand() < walking;
        const look = randomLook(rand, { kids: config.kids ?? .14, packs: .3, caps: .2 });
        let clip = walk ? CLIP.stroll : pickClip(rand, STANDING);
        if (walk && !look.kid && rand() < (config.dogs ?? .12)) { look.dog = dogLook(rand); look.h = .97 + rand() * .05; clip = CLIP.leash; }
        else if (walk && !look.kid && rand() < (config.strollers ?? .06)) { look.stroller = new THREE.Color(PALETTES.strollers[Math.floor(rand() * PALETTES.strollers.length)]); clip = CLIP.push; }
        if (clip === CLIP.photo || clip === CLIP.phone) look.bits |= FIT.PROP;
        const speed = walk ? (look.kid ? .7 : .8 + rand() * .35) : 0;
        people.push({ cx, cz, r: Math.hypot(x - cx, z - cz), a: Math.atan2(z - cz, x - cx), x, z, y, walk, w: speed * (rand() < .5 ? 1 : -1), yaw: face ?? rand() * 6.28, phase: rand(), look, clip, rate: clipRate(clip, speed, look) });
        k++;
      }
    };
    for (const sp of config.spots || []) {
      if (sp.site) {
        const t = (this.L.sites || []).find((x) => x.name === sp.site);
        if (t) spot(t.x, t.z, sp.innerM ?? 2, sp.radiusM ?? Math.hypot(t.hw, t.hl) * .9, sp.count ?? 8);
        continue;
      }
      const p = this.L.frameAt(sp.atM), side = sp.side ?? 1, lat = sp.lateralM ?? 12;
      spot(p.x - p.fz * side * lat, p.z + p.fx * side * lat, 0, sp.radiusM ?? 12, sp.count ?? 5);
    }
    // overlooks: a few people at the rail looking out (facing away from the road)
    for (const l of config.lookouts ? lookouts : []) {
      const p = this.L.frameAt(l.atM), side = l.side === 'inland' ? -1 : 1, lat = ROAD_HALF + (l.widthM || 9) * .6;
      const face = Math.atan2(-p.fz * side, p.fx * side);
      spot(p.x - p.fz * side * lat, p.z + p.fx * side * lat, 0, Math.min(10, (l.lengthM || 30) / 3), config.lookouts, face);
    }
    this.people = people;
    const n = Math.max(1, people.length);
    this.crowd = new Crowd(this.group, { uTime: uniforms.uTime, name: 'Visitors', capacity: n, nearM: quality === 'low' ? 25 : quality === 'ultra' ? 80 : quality === 'high' ? 60 : 40,
      dogs: people.filter((p) => p.look.dog).length, strollers: people.filter((p) => p.look.stroller).length });
    this._place(null, 0, true);
  }

  _place(cam, dt, all = false) {
    this.crowd.begin(cam || { x: 0, y: 0, z: 0 });
    for (const p of this.people) {
      const near = all || !cam || Math.hypot(p.x - cam.x, p.z - cam.z) < 600;
      if (!near) continue;
      if (p.walk && dt) {
        // stroll around the spot on a slowly wandering circle
        p.a += p.w * dt / Math.max(4, p.r);   // w: metres a second along the circle
        const x = p.cx + Math.cos(p.a) * p.r, z = p.cz + Math.sin(p.a) * p.r;
        if (!this.index.nearest(x, z, ROAD_HALF + .9)) { p.yaw = Math.atan2(x - p.x, z - p.z); p.x = x; p.z = z; p.y = this.L.heightAt(x, z); }
        else p.w = -p.w;   // turn back at the road
      }
      this.crowd.add(p.look, p.x, p.y - .03, p.z, p.yaw, p.clip, p.phase, p.rate);
    }
    this.crowd.end();
  }

  tick(dt, camera) { this._place(camera.position || camera, dt); }

  dispose() {
    this.group.removeFromParent();
    this.crowd.dispose();
  }
}
