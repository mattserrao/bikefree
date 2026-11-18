# Toolbox texture expansion proposal

Status: design exploration only; no texture or runtime changes yet.
Branch: `toolbox-textures-test`.
Baseline: `83110de5cdc4349257ab571f3d529b1245ebd37b` (`main`, 18 Nov 2026).

## Direction from the owner

- Improve variety, quantity and quality across the entire toolbox.
- Decide an order and proceed through all surface families.
- Explore and propose options before implementing textures.
- Preserve everything already in the toolbox; add reusable options for other agents.
- Visual direction is still open: richer current stylization, more realism, or selectable styles.

## Compatibility contract

Existing materials, exports, surface IDs, scene fields, aliases and defaults stay available. New appearances
are opt-in; existing scenes must render as before when they do not select a new option. Do not replace
legacy implementations just to centralize them. Add adapters or shared helpers only when their unchanged
output can be verified. Keep numeric building surface codes stable; allocate new codes for new patterns.

Keep all new surfaces authored in code and usable offline. Regional names, colours, distances and mixes
belong in scene data. Seed variation explicitly. Detail should fade to its average below about two pixels,
and remain coherent in world metres through corners, across meshes and at different camera distances.

## Where the existing surfaces live

Paths below are relative to the repository root. This is a source map, not a migration list.

| Family | Current sources | Existing capabilities to preserve |
| --- | --- | --- |
| Roads and paths | `js/world/toolbox/materials/road-surface.js`; `js/world/world.js` | Fresh, worn, chipseal, alpine, patched, tunnel and brick; zoned wear and wetness, French markings; generated road, trail and gravel base textures |
| Buildings | `js/world/toolbox/structures/buildings/facade-material.js`, `presets.js`; `js/world/toolbox/city/city.js` | Render, rubble, ashlar, brick, boards, logs, timber, concrete, metal, glass; roof families; windows, doors and weathering; shared facade GLSL |
| Masonry and concrete | `js/world/toolbox/materials/stonework.js`, `surfaces.js` | World-space rubble masonry, concrete grain and streaks |
| Terrain and water | `js/world/toolbox/materials/surfaces.js`; `js/world/toolbox/atmosphere/vista.js`; `js/world/terrain.js` | Slope/height/shore ground shading, rock formations, snow, canopy, distant detail, sea/lake shading and generated terrain detail |
| Vegetation | `js/world/toolbox/packs/northern-rockies.js`; `js/world/toolbox/vegetation/tree-cards.js`; `js/world/toolbox/materials/surfaces.js` | Procedural tree surfaces, generated far-tree cards, foliage and ground-cover wind |
| Small details and atmosphere | `js/world/toolbox/roadside/boards.js`, `details.js`, `verge.js`; `js/world/toolbox/city/street-kit.js`; `js/world/toolbox/atmosphere/vista.js` | Generated sign/number atlases, shop signs, roadside details and cumulus atlas |

## Proposed order and additions

Candidate names below are design proposals, not implemented preset IDs. Finish each family with examples
and validation before moving on. Review the visual direction on representative samples before multiplying
variants. The list covers all families; priorities within each can be adjusted during design review.

| Order | Family | Candidate additions | Quality work |
| --- | --- | --- | --- |
| 1 | Roads and paths | Fine and coarse asphalt; aged rural asphalt; utility-cut repairs; broom-finished concrete; slab cycleway; compacted gravel; crushed limestone; packed earth; cobblestone; stone setts | Aggregate with real scale, less obvious repetition, direction-aware repairs and joints, readable transitions between zones |
| 2 | Buildings and masonry | Brick bond choices (running, Flemish, English); dressed limestone, sandstone and granite; dry-stone wall; limewash and aged stucco; board-and-batten; weathered timber; stone and clay roof variations | Material-specific grain, mortar depth cues, restrained colour variation, joint continuity, weathering tied to exposure |
| 3 | Terrain and water | Sandy and loamy soil; forest litter; meadow turf; scree and talus; limestone, granite and layered sandstone; sand, mud and river gravel; optional shallow-water bed types | Blend by slope and land cover, reduce tiling, coordinate near and distant detail, preserve existing shoreline masks and water behaviour |
| 4 | Vegetation | Additional bark profiles (birch, beech, oak); needle and broadleaf surface variants; moss and lichen accents; dry and lush ground-cover variations | Species-readable silhouettes and surface detail, less uniform crowns, consistent card/model colours, stable distant appearance |
| 5 | Details and atmosphere | Painted and galvanized metal; rusted steel; aged timber furniture; sign-paint wear; additional cloud atlas shapes | Coherent wear scale, readable signs, shared atlas use where practical, no extra geometry solely for tiny surface detail |

Wetness, age, colour and seed should usually be parameters of a material rather than separate copies.
New structural patterns (cobblestone versus asphalt, for example) need a pattern implementation rather
than just renamed parameter presets. Separate their implementation effort in the eventual task list.

## Proposed interface for future agents

Extend the current scene interfaces (`road`, `road.trail`, `buildingKit.styles`, `palette`, `vista`,
`vegetation`) where the new option naturally belongs. Avoid introducing a second competing scene system.
The exact field names and supported combinations will be decided after the first sample review.

Add a discoverable catalog under `js/world/toolbox/materials/` describing each new option:

- Stable ID, family, description, regional/use examples and implementation module.
- Supported consumers (a road pattern must not claim facade compatibility without an adapter).
- Parameters with defaults, units and ranges; deterministic seed behaviour.
- Supported quality levels, resource cost, dependencies and combinations that are unsupported.
- A copyable scene example that is checked by the scene linter.

The catalog should describe existing options as well as new ones without forcing existing call sites
through a new renderer. Agent documentation must distinguish shipped options from proposed ones.
Unknown new IDs should produce useful validation errors; preserve legacy fallback behaviour where
changing it would break existing consumers.

## Preview and evaluation proposal

Expand the existing toolbox gallery (`tools/toolbox-gallery.html`) with labelled material comparisons.
Use the production material factories, not an imitation shader written just for previews. Show original
and proposed options on flat surfaces, corners, slopes and building faces with a metre reference.
Include close and riding-distance views, midday and low-angle light, dry and wet where supported, and
multiple seeds. Include a moving-camera check for shimmer and seams. Keep generated outputs in the
existing snapshot workflow; no publishing or route conversion is part of this proposal.

Before any implementation, record representative baseline route shots with the existing guard. After
changes, compare scenes that do not opt in, then capture new options separately. Preserve known baseline
exceptions rather than hiding them. Run `npm test` and `npm run lint:scenes`; add focused checks for actual
new behaviour (ID resolution, scene selection, seed stability and unchanged legacy defaults). Shader
compilation and visual inspection are also required; passing Node tests does not verify rendered quality.

Measure frame time, shader compilation, texture memory and draw calls as well as triangles. Aim to stay
within the documented Balanced target of 600 calls / 2 M scenery triangles on M4 Air. Software-rendered
checks can establish correctness but cannot establish performance on the target device. Avoid promising
that procedural detail is free: more fragment work can reduce frame rate without adding draw calls.

## Decisions for the next design review

1. Visual direction: richer current stylization, more realism, or selectable styles?
2. Which places or reference materials should the library represent beyond the existing US and Alpine routes?
3. Should we keep one consistent style across routes, or allow each route to choose its level of detail?
4. Which existing surfaces feel weakest, and which should serve as the quality reference?

Suggested first review: asphalt, compacted gravel, stone setts, brick and limewash samples. This tests
fine grain, loose aggregate, large joints, repeating patterns and weathering before expanding the library.
Implementation begins after the design review; this document does not claim any candidates are shipped.
