# Graphics effects

Each effect is a module here. A map turns it on in its graph JSON's `effects` block. An effect that is absent is off,
and nothing in an effect knows which map it is on.

```json
"effects": { "water": {}, "shoreline": { "reeds": 0.5 }, "village": {}, "frontYards": { "fence": 0.3 } }
```

For the generated maps, put the block in `tools/city/<map>.json`. `tools/build_pgh.py` copies it into
`routes/cities/<map>.json`.

| effect | what it does | options | cost |
|---|---|---|---|
| `water` | Lake surface: travelling ripples, gusty patches, sky reflection at grazing angles, sun glitter. It patches the world's own water material, so it covers every water plane. | `ripple` 1, `glint` 1, `sky` 0.4 | Shader only (no geometry). |
| `shoreline` | Wet-sand and pebble band on land, a pale lapping band on the water, reeds on gentle shores. Built per tile from the ground-meets-water contour. | `cell` 2 m, `beach` [1.5, 4] m, `shallows` 9 m, `reeds` 0.35 | Only tiles with a shore: 2 meshes plus 1 instanced reed mesh. |
| `village` | Shop rows in the `village` facade style (awnings, some striped; painted fronts; signs) and sidewalk furniture (benches, flower barrels, racks, bins, flags). | `style` 'village', `flags` true | Goes into the tile's existing meshes. |
| `sky` | Sky dome: zenith-to-haze gradient, glow round the sun, drifting lit clouds. Follows the scene's background, fog and sun. | `clouds` 0.42, `glow` 1, `speed` 1 | 1 draw call, shader only. |
| `frontYards` | Kit houses get picket fences or hedges on the front lot line, foundation shrubs and flower beds. | `fence` 0.22, `hedge` 0.2, `shrubs` 0.8 | Goes into the tile's street-kit mesh. |
| `canopyShade` | Dappled sun under the trees near the rider: a 160 m canopy map round the camera (`toolbox/atmosphere/canopy-shade.js`), each crown's shade along the sun ray, sun flecks through it; read by every material the baked lighting patches (road, ground, rider, bushes, near trees). Needs baked light (the upstate profile). | `strength` 1, `lift` 7 m | One 256² texture; CPU redraw in ~2 ms slices every 16 m. No draw calls. |
| `roadLook` | The road's paint drawn in its own shader (box-filtered: crisp near, no crawl, no MSAA needed) and a park drive's asphalt: lighter tone, aggregate speckle, a darker gutter with leaves. | `paint` true, `asphalt` true, `tone` [1.16, 1.15, 1.13], `leaves` 0.8 | Shader only; fewer paint triangles. |
| `grade` | ACES then a colour grade inside the tone mapping (every path: canvas, post pass, tree cards): saturation, contrast S-curve, warm tint, lift; and the key light: sun ×, sky light ×. | `saturation` 1.15, `contrast` .16, `warm` .4, `lift` .015, `sun` 1.12, `sky` .9, `exposure` 1 | Shader only. |
| `parkFence` | A weathered split-rail fence in stretches along the ways of the given kinds, gaps at junctions, crossing ways, decks and water; wood grain and checks in the shader. | `kinds` ['drive'], `share` .35, `offset` 1.3, `height` 1.05, `post` 2.7, `both` .4 | One mesh per tile. |
| `leafLitter` | Fall leaves on the lawns and yards: thickest under the crowns (the canopy map), a light scatter and drifts elsewhere. | `amount` 1 | Shader only. |

## Adding one

1. Write `install(world, opts)`. It returns `{ tick(t, dt)?, *tileJob(tile)?, dispose()? }`.
2. Register it in `index.js` (`EFFECTS`).
3. Meshes a `tileJob` makes go in `tile.extra`, which the world releases with the tile.
4. Keep the effect's geometry and shaders under `toolbox/`. The effect module only switches them on.

## Measuring

```sh
node tools/bench/bench.mjs --label before --effects none   # the same code, all effects off
node tools/bench/bench.mjs --label after                   # the effects the maps set
node tools/bench/bench.mjs --compare before after
```

Run the bench from a frozen copy of the tree (it reads files per view), on a quiet machine, and compare only runs
made on the same machine.

## Rolling out to another map

- **Graph maps** (`routes/cities/*.json`, e.g. PGH): add the `effects` block to `tools/city/<map>.json` and rebuild
  with `tools/build_pgh.py`. Start with `sky` and `water` (shader only), then `shoreline` (needs water in the map),
  then `village` and `frontYards` (they need the building kit's shop rows and houses). Bench each step.
- **Scene maps** (`routes/scenes/*.json`, e.g. Big Sur) don't run this module yet. Port an effect by calling
  `installEffects(world, cfg)` from the scene world with the hooks listed in `index.js`.
- **Shared kits that every map already uses** (no switch needed):
  - parked cars: `toolbox/life/figures/cars.js` (`ParkedCars`, `pickCar`, `staticCar`)
  - farm animals: `toolbox/life/figures/animals.js` (`Herds`; placed by `graph-city.js _animals` on rural graph
    maps)
  - shader warm-up: `toolbox/core/shader-warm.js` (`ShaderWarmer`; graph worlds; a scene world can add one the
    same way)

| `atmosphere` | Sun beams slanting through the crowns when the sun is low, ground mist over water and wet ground, drifting leaves, dust motes catching the light. One draw call each, animated in the vertex shader; beams and mist re-placed every ~35 m. | `beams` 1, `mist` 1, `leaves` 1, `motes` 1 (0 = off) | 4 draw calls, a few hundred tiny quads/points. |
