// The canopy shade effect: dappled sun under the trees round the rider (toolbox/atmosphere/canopy-shade.js). It reads
// the world's trees (the graph worlds: the city's tiles' tree lists, crowns from the tree kit's sizes), redraws the
// canopy map as the camera moves on, and turns the shared uniforms on. Drawn by every material the baked lighting
// patches (a map with baked light: the upstate profile's golden hour — CNY, SKAN, NYC).
// Options: { strength: 1 (0–1: how dark the shade), lift: 7 (m: the canopy plane above the rider) }.
import * as THREE from '../../../../vendor/three.js';
import { CanopyShade } from '../atmosphere/canopy-shade.js';

const _sd = new THREE.Vector3();

const CONIFER = /pine|hemlock|spruce|arborvitae/;

/** The world's crowns near (x, z) for the canopy map: the graph city's tile lists, sized from its tree kit. */
function graphCanopyTrees(world) {
  return (x, z, R) => {
    const city = world.city, kit = city?.treeKit?.species, out = [];
    if (!city?.tiles || !kit) return out;
    const T = world.TILE || 400;
    for (const t of city.tiles.values()) {
      if (!t.trees || Math.abs(t.cx - x) > R + T / 2 || Math.abs(t.cz - z) > R + T / 2) continue;
      for (const tr of t.trees) {
        const sp = kit[tr.sp]; if (!sp || tr.sp === 'snag') continue;
        if (Math.abs(tr.x - x) > R || Math.abs(tr.z - z) > R) continue;
        const h = sp.h * (tr.sy ?? tr.s), r = sp.r * tr.s;
        const lx = tr.lean ? tr.lean[0] : 0, lz = tr.lean ? tr.lean[1] : 0;
        if (CONIFER.test(tr.sp)) out.push({ x: tr.x + lx * h * .5, y: tr.y, z: tr.z + lz * h * .5, r: r * .7, cy: h * .5, ry: h * .42, cb: h * .1, dens: 1 });
        else {
          // a leaning crown sits out over its lean (the crown's centre ~62% up)
          const cy = h * .62;
          out.push({ x: tr.x + lx * cy, y: tr.y, z: tr.z + lz * cy, r: r * .85, cy, ry: h * .28, cb: h * .34, dens: .92 });
        }
      }
    }
    return out;
  };
}

export const canopyShade = {
  install(world, opts = {}) {
    if (world.qualityKey === 'low' && opts.low === false) return {};
    const shade = new CanopyShade({ strength: opts.strength ?? 1, planeLift: opts.lift ?? 7 });
    shade.attach();
    // the crowns: any world's tree engine (graph maps: the city's; the endless world's; a scenic route's terrain's)
    const engines = () => {
      const out = [world.city?.forest, world.forest, world.terrain?._te];
      if (world.areas) for (const a of world.areas.values()) out.push(a.terrain?._te);
      return [...new Set(out.filter((e) => e && e.crownsNear))];
    };
    const engine = () => engines()[0] || null;
    const trees = (x, z, R) => { const E = engines(); return E.length ? E.flatMap((e) => e.crownsNear(x, z, R)) : graphCanopyTrees(world)(x, z, R); };
    const sunDir = () => world.sunDir || (world.sun ? _sd.copy(world.sun.position).sub(world.sun.target.position).normalize() : null);
    const groundY = () => { const c = world.camera.position; return world.ground && world._groundH ? world._groundH(c.x, c.z) : world.rider?.group ? world.rider.group.position.y : c.y - 2; };
    let lastTrees = 0, frame = 0;
    world.canopy = shade;
    return {
      tick(t) {
        const sd = sunDir(); if (!sd || !world.camera) return;
        // the city's trees changed (a tile came or went): redraw at the next step
        if ((frame++ & 31) === 0) { const n = engines().reduce((a, e) => a + e.tiles.size, 0) || world.city?.stats?.trees || 0; if (n !== lastTrees) { lastTrees = n; shade.dirty = true; } }
        shade.update(world.camera, sd, trees, groundY(), t, world._preload ? 12 : world.qualityKey === 'low' ? 1.2 : 2.5);
      },
      prepare() { const sd = sunDir(); if (!sd || !world.camera) return; shade.flush(world.camera, sd, trees, groundY(), 0); },
      setVisible(v) { shade.setVisible(v); },
      dispose() { shade.dispose(); if (world.canopy === shade) world.canopy = null; },
    };
  },
};
