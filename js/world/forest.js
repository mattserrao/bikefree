// Northern-forest placement for "forest-edge" scenes: a continuous canopy that starts a few metres
// past a mown verge, thinned by distance from the camera in nested tiers (near ⊃ mid ⊃ far), so a
// tree never moves when its tile changes tier — trees only appear as you approach.
import * as THREE from '../../vendor/three.module.min.js';
import { randomSequence, smoothstep } from './coast.js';
import { SPECIES_VARIANTS } from './adirondack-kit.js';
import { GLACIER_VARIANTS } from './glacier-kit.js';

export const TILE_M = 192;
const CELL_M = 7.5;                     // jittered grid → ~178 candidates per hectare
const TIER_KEEP = [1, .62, .4];         // near / mid / far share of the full stand
const SUFFIX = ['', '-lod', '-far'];

export class ForestPlanner {
  constructor(config, landscape, index, heightAt, clearings, route = null) {
    const v = config.vegetation || {};
    this.route = route;
    // a scene can keep more of the stand in the outer tiers (Going-to-the-Sun: dense, even cover far off)
    this.keep = v.tierKeep || TIER_KEEP;
    // windows: every so often the trees between the road and a lake open up for a view across the water
    //   { everyM, lengthM, reachM (corridor: shore + road distance), keep (share of trees left standing) }
    this.windows = v.windows && route ? { everyM: 900, lengthM: 170, reachM: 260, keep: .1, ...v.windows } : null;
    this.species = Object.entries(v.species || { maple: .45, spruce: .2, hemlock: .12, birch: .13, whitepine: .1 });
    this.edge = { mown: v.edge?.mownM ?? 9, shrub: v.edge?.shrubM ?? 13 };
    this.landscape = landscape; this.index = index; this.heightAt = heightAt; this.clearings = clearings;
    this.seed = config.seed || 1;
    this.scale = v.treeScale || [.85, 1.15];
    // mountains (Glacier): species and density come from the landform's vegetation zones
    this.zones = !!landscape.mountain;
    this.density = v.forestDensity ?? 1;
  }

  /** 0…1 forest cover at a point (used by the trees and the distant canopy). */
  cover(x, z, roadD = null) {
    const d = roadD ?? (this.index.nearest(x, z, 60)?.d ?? 60);
    const shore = this.landscape.shoreAt ? this.landscape.shoreAt(x, z) : Infinity;
    if (shore < 3 || this.landscape.isWater?.(x, z, this.heightAt(x, z))) return 0;
    if (this.clearings?.at(x, z)) return 0;
    if (this.zones) return this.landscape.vegetationAt(x, z).forest * smoothstep(this.edge.mown - 1, this.edge.shrub + 3, d) * smoothstep(3, 14, shore);
    // lake glimpses: the woods thin out between the road and a nearby shore
    return smoothstep(this.edge.mown - 1, this.edge.shrub + 3, d) * smoothstep(3, 14, shore) * (.35 + .65 * smoothstep(150, 230, shore + d));
  }

  _pick(rand, shore, roadD) {
    // conifers and pines crowd the shores; birch likes the bright edges
    let total = 0;
    const weights = this.species.map(([name, w]) => {
      let k = w;
      if (shore < 150 && ['spruce', 'hemlock', 'whitepine'].includes(name)) k *= 1.9;
      if (roadD < 30 && name === 'birch') k *= 2.2;
      total += k; return [name, k];
    });
    let r = rand() * total;
    for (const [name, k] of weights) { r -= k; if (r <= 0) return name; }
    return weights.at(-1)[0];
  }

  /** Mountain species by zone: west-side cedar–hemlock valleys, spruce–fir–larch slopes, the dry east side. */
  _zoneSpecies(v, y, r) {
    if (v.alpine > .45) return r < .8 ? 'subfir' : 'espruce';
    if (v.east > .5) return v.valley > .35 && r < .3 ? 'espruce' : r < .45 ? 'aspen' : r < .82 ? 'lodgepole' : r < .92 ? 'subfir' : 'espruce';
    if (y < 1250) return v.valley + v.north > .5 ? (r < .45 ? 'cedar' : r < .8 ? 'whemlock' : r < .9 ? 'larch' : 'espruce') : (r < .25 ? 'cedar' : r < .5 ? 'whemlock' : r < .7 ? 'larch' : r < .85 ? 'lodgepole' : 'espruce');
    if (y < 1650) return r < .35 ? 'espruce' : r < .55 ? 'subfir' : r < .72 ? 'larch' : r < .9 ? 'lodgepole' : 'whemlock';
    return r < .55 ? 'subfir' : r < .88 ? 'espruce' : 'larch';
  }

  /**
   * In a window (a gap in the trees for a view)? Between the road and a lake, or with `downhill`, on the low
   * side of the road where the land falls away toward the valley. Road distances cached per 32 m cell.
   */
  _inWindow(x, z, y, shore, roadHit, cache) {
    const W = this.windows;
    if (!W || (shore > W.reachM && !W.downhill && !W.at)) return false;
    let hit = roadHit;
    if (!hit) {
      const key = `${Math.floor(x / 32)},${Math.floor(z / 32)}`;
      if (!cache.has(key)) cache.set(key, this.index.nearest(Math.floor(x / 32) * 32 + 16, Math.floor(z / 32) * 32 + 16, W.reachM));
      hit = cache.get(key);
    }
    if (!hit) return false;
    const sM = this.route.dist[hit.i];
    const lake = shore + hit.d < W.reachM;
    const low = hit.d < (W.downhillM ?? W.reachM * .6) && y < hit.ele - 4;
    // the real viewpoints: always open toward the lake and down the valley
    if (W.at && (lake || low) && W.at.some((a) => Math.abs(sM - a) < (W.atLengthM ?? 160) / 2)) return true;
    if (!lake && !(W.downhill && low)) return false;
    return windowAt(sM, W, this.seed);
  }

  _zoneTile(cx, cz, tier) {
    const windowCache = new Map();
    const rand = randomSequence((cx * 92837111 ^ cz * 689287499) + this.seed * 7 + 31);
    const lists = {};
    const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const add = (name, x, y, z, k, rot, ky = k) => {
      q.setFromAxisAngle(up, rot); p.set(x, y, z); s.set(k, ky * (.92 + (rot % 1) * .16), k);
      (lists[name] ||= []).push(matrix.compose(p, q, s).clone());
    };
    const n = Math.round(TILE_M / CELL_M);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const jx = rand(), jz = rand(), rank = rand(), pick = rand(), size = rand(), rot = rand() * Math.PI * 2, extra = rand();
      if (rank > this.keep[tier]) continue;
      const x = cx * TILE_M + (i + .15 + jx * .7) * CELL_M, z = cz * TILE_M + (j + .15 + jz * .7) * CELL_M;
      const near = this.index.nearest(x, z, 60), roadD = near ? near.d : 60;
      if (roadD < this.edge.mown) continue;
      const shore = this.landscape.shoreAt ? this.landscape.shoreAt(x, z) : Infinity;
      if (shore < 3 || (this.clearings && this.clearings.at(x, z)) || this.landscape.bridgeAt(x, z, 10) || this.landscape.creekAt(x, z)) continue;
      const y = this.heightAt(x, z);
      if (this.windows && extra > this.windows.keep && this._inWindow(x, z, y, shore, near, windowCache)) continue;
      if (this.landscape.isWater?.(x, z, y)) continue;
      const v = this.landscape.vegetationAt(x, z);
      if (v.slope > 1.25) continue;   // cliffs
      const edge = smoothstep(this.edge.mown - 1, this.edge.shrub + 3, roadD) * smoothstep(3, 14, shore);
      // an old burn: silver snags, more thinly, over fireweed and young lodgepole
      const burn = this.landscape.burnAt?.(x, z) || 0;
      if (burn > .5 && pick < v.forest * edge * this.density) {
        if (extra < .36) add(`snag${size < .5 ? 0 : 1}${SUFFIX[tier]}`, x, y - .2, z, .7 + size * .45, rot);
        else if (extra < .58) add(`lodgepole${size < .5 ? 0 : 1}${SUFFIX[tier]}`, x, y - .1, z, .18 + size * .22, rot);   // young regrowth
        else if (tier === 0 && extra < .75) add('fireweed', x, y - .05, z, .9 + size * .4, rot);
        continue;
      }
      if (pick < v.forest * edge * this.density) {
        const species = this._zoneSpecies(v, y, extra);
        const variants = GLACIER_VARIANTS[species];
        const variant = tier ? 0 : Math.floor(size * variants) % variants;   // one variant beyond the near tier: fewer draw calls
        // trees shrink toward the treeline
        const k = (this.scale[0] + (this.scale[1] - this.scale[0]) * ((size * 7.31) % 1)) * (1 - v.alpine * .45);
        add(`${species}${variant}${SUFFIX[tier]}`, x, y - .2, z, k * (1 - v.alpine * .2), rot, k);
        continue;
      }
      // open ground: avalanche-chute alder, treeline krummholz, talus on the steep, meadow flowers by the road
      if (tier === 2) continue;
      if (v.alpine > .35 && v.alpine < .9 && extra < .12 * v.alpine) add(`krummholz${size < .5 ? 0 : 1}`, x, y - .1, z, .8 + size * .6, rot);
      else if (extra < v.scrub * .22 && v.slope > .3) add(`alder${size < .5 ? 0 : 1}`, x, y - .1, z, .8 + size * .7, rot);
      else if (v.slope > .55 && extra > .78) add(`talus${size < .6 ? 0 : 1}`, x, y - .15, z, .7 + size * 1.4, rot);
      else if (tier === 0 && extra > .5 && extra < .62) add(v.east > .5 ? 'huckleberry' : size < .55 ? 'beargrass' : 'huckleberry', x, y - .05, z, .8 + size * .5, rot);
    }
    return lists;
  }

  /** Instance lists for one tile at a tier (0 near, 1 mid, 2 far). */
  tile(cx, cz, tier) {
    if (this.zones) return this._zoneTile(cx, cz, tier);
    const rand = randomSequence((cx * 92837111 ^ cz * 689287499) + this.seed * 7 + 31);
    const lists = {};
    const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const add = (name, x, y, z, k, rot) => {
      q.setFromAxisAngle(up, rot); p.set(x, y, z); s.set(k, k * (.92 + (rot % 1) * .16), k);
      (lists[name] ||= []).push(matrix.compose(p, q, s).clone());
    };
    const n = Math.round(TILE_M / CELL_M);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      // every random draw happens for every point in the same order, whatever the tier
      const jx = rand(), jz = rand(), rank = rand(), pick = rand(), size = rand(), rot = rand() * Math.PI * 2, extra = rand();
      if (rank > this.keep[tier]) continue;
      const x = cx * TILE_M + (i + .15 + jx * .7) * CELL_M, z = cz * TILE_M + (j + .15 + jz * .7) * CELL_M;
      const near = this.index.nearest(x, z, 60), roadD = near ? near.d : 60;
      if (roadD < this.edge.mown) {
        if (tier === 0 && roadD > 6.5 && extra < .05) add('goldenrod', x, this.heightAt(x, z) - .05, z, .8 + size * .5, rot);
        continue;
      }
      const shore = this.landscape.shoreAt ? this.landscape.shoreAt(x, z) : Infinity;
      if (shore < 3 || (this.clearings && this.clearings.at(x, z))) continue;
      const y = this.heightAt(x, z);
      if (this.landscape.isWater?.(x, z, y)) continue;
      if (roadD < this.edge.shrub) {
        // the brushy edge: saplings, birch, goldenrod and the odd boulder
        if (tier === 2) continue;
        if (extra < .45) add(`sapling${extra < .2 ? 1 : 0}`, x, y - .05, z, .7 + size * .7, rot);
        else if (extra < .62) add(`birch${size < .5 ? 0 : 1}${SUFFIX[tier]}`, x, y - .1, z, .55 + size * .3, rot);
        else if (extra < .66 && tier === 0) add(`boulder${size < .6 ? 0 : 1}`, x, y - .2, z, .6 + size * .7, rot);
        else if (tier === 0) add(extra < .85 ? 'goldenrod' : 'blueberry', x, y - .05, z, .8 + size * .5, rot);
        continue;
      }
      if (shore < 8) continue;
      if (shore + roadD < 200 && extra > .3) continue;   // view corridor toward the water
      const species = this._pick(randomSequence(Math.floor(pick * 1e9)), shore, roadD);
      const variant = tier === 2 ? 0 : Math.floor(size * SPECIES_VARIANTS[species]) % SPECIES_VARIANTS[species];
      const k = this.scale[0] + (this.scale[1] - this.scale[0]) * ((size * 7.31) % 1);
      add(`${species}${variant}${SUFFIX[tier]}`, x, y - .2, z, k, rot);
      if (tier === 0 && extra < .06) add(`boulder${extra < .03 ? 0 : 1}`, x + 3, this.heightAt(x + 3, z) - .25, z, .5 + size * .6, rot);
      else if (tier === 0 && extra > .8) add(extra > .9 ? 'blueberry' : 'sapling1', x - 2.5, this.heightAt(x - 2.5, z) - .05, z, .8 + size * .4, rot);
    }
    return lists;
  }
}

/** Is route distance sM inside a view window? Each window a little different in length and placement. */
export function windowAt(sM, W, seed = 1) {
  const k = Math.floor(sM / W.everyM);
  const h = Math.sin(k * 12.9898 + seed) * 43758.5453, r = h - Math.floor(h);
  const start = k * W.everyM + r * (W.everyM - W.lengthM * 1.4), len = W.lengthM * (.7 + r * .7);
  return sM > start && sM < start + len;
}

/** Spatial lookup of cleared ground (lawns, camp lots, driveways). */
export function makeClearings(items, cell = 64) {
  const grid = new Map();
  const put = (c, k) => { const key = `${k[0]},${k[1]}`; (grid.get(key) || grid.set(key, []).get(key)).push(c); };
  for (const c of items) {
    const r = c.r + (c.len || 0);
    for (let x = Math.floor((c.x - r) / cell); x <= Math.floor((c.x + r) / cell); x++)
      for (let z = Math.floor((c.z - r) / cell); z <= Math.floor((c.z + r) / cell); z++) put(c, [x, z]);
  }
  return {
    items,
    at(x, z) {
      const list = grid.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`);
      if (!list) return false;
      for (const c of list) {
        if (c.len) {   // capsule from (x,z) along (dx,dz) for len metres
          const t = Math.max(0, Math.min(c.len, (x - c.x) * c.dx + (z - c.z) * c.dz));
          if (Math.hypot(x - c.x - c.dx * t, z - c.z - c.dz * t) < c.r) return true;
        } else if (Math.hypot(x - c.x, z - c.z) < c.r) return true;
      }
      return false;
    },
  };
}
