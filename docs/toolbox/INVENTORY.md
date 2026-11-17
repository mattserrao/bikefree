# Toolbox review: every route's tools, textures and methods (16 Nov 2026)

This review was done before the restructure on `toolbox-test`. It records:
- what each route was built with
- where the same job had been solved more than once
- what was tied to a single route
- what moved, and what is left to do

The resulting layout and how to use it are in `TOOLBOX.md`.

## Before: one folder, tools named after routes

There were 48 modules in `js/world/`. Many shared parts were named after the route they were first built for, and other routes reached into them:

| Was | Used by | Problem |
| --- | --- | --- |
| `coast.js` | everything | It held the seeded random and `smoothstep` used by every kit, plus Acadia's authored coast. |
| `city-geometry.js` | traffic, wildlife, verge, visitors, city | The generic mesh builder was filed under the city. |
| `adirondack-kit.js` | Route 28, and the Glacier kit and landmarks | The generic model builder (`Builder`, `M`, primitives, smooth shading) was inside the Adirondack trees. |
| `glacier-kit.js` | Going-to-the-Sun, and the forest planner and scene builder | `kitExtensions: ["glacier"]` was hard-wired: `if (make === makeGlacierKit)` in the scene builder, `GLACIER_VARIANTS` in the forest planner, and the plant names in `build_routes.mjs`. |
| `glacier-landmarks.js` | Going-to-the-Sun | Tunnels, masonry guardwalls, arches, waterfalls and culverts were already data-driven, but sat behind a `glacier` key. |
| `glacier-life.js`, `coast-life.js` | Going-to-the-Sun, Big Sur | The landform chose the life kit (`mountain` → Glacier life, `real` → coast life). A scene couldn't ask for one. |
| `coastal-materials.js` | every stylized route | Ground, sea, lake and scenery materials were all called "coastal". |
| `coast-bridges.js`, `coastal-details.js` | every real-terrain route / every route | These are generic arch bridges and the signs, turnouts and `coastalRoadFrame` that every kit places by. |
| `stylized-terrain.js` (1,233 lines) | every stylized route | It also contained the far tree cards, the guardrail builder, the Going-to-the-Sun flower table and the planting noise. |

## Per route

**Route 28** (authored-region, USGS bake, gentle look)
- Tools: Adirondack kit (trees ×3 LOD, buildings, docks, boats, poles), forest-edge planner, settlement (villages, camps, poles), lake water and mist, Blender `coastal` and `regional` kits for grass and fern.
- Textures: none. Everything is vertex colour and procedural shaders; canvas textures are used only for tree cards, clouds and shadow blobs.
- Methods: nested LOD tiers, instanced pools, mid and far trees on Lambert, shadows only near the road, baked terrain grid.
- Not used: vista, baked light, verge, road surface, traffic, weather presets beyond the defaults.

**Big Sur** (real-coast)
- Tools: real-terrain landform with shoreline and surf, arch bridges, coast life (pelicans, gulls, condor, cattle, lighthouse), highway traffic, Blender `coastal` kit, guardrail, sea stacks, post chain.
- Methods: real grid to the horizon (`realHorizon: false`), the sea from the sea floor, instanced birds animated in the vertex shader.
- Not used: gentle look, baked light, vista, regional pack.

**Going-to-the-Sun** (real-mountain, gentle look)
- Tools: Glacier kit (rich trees, floor, flowers), vista kit (rock, snow, meadow, forest, haze, ridge ink, cumulus), road surface zones, verge, the landmarks module (tunnels, guardwalls, arches, waterfalls, lodges, snowbanks), wildlife, visitors, traffic with Red Jammers, weather (valley fog, peak clouds), arch bridges in masonry, stonework.
- Textures: the procedural bark and foliage shader (`decorateTreeMaterial`), masonry in world space, the cumulus atlas canvas.
- Methods: up to 450 draw calls (a hero allowance), fade-to-average under 2 px, a near-band cover boost.

**Pittsburgh** (authored-city, baked golden light)
- Tools: the whole city kit (street kit, junctions, road meets, street grade, riverfront, bridges, heroes, city life), baked lighting, weather (river fog), post chain, Blender kits for trees.
- Methods: GPU-baked shadow-height map and AO, time-sliced re-bakes, chunked city.
- Not used: gentle look. City content is partly Pittsburgh-specific in code: stadiums, the fountain, USS Requin and the hero models.

**Zion** (authored-region)
- Tools: authored formations, valley and rivers, Blender `regional` kit, guardrail.
- The oldest style: no pack, look, vista or baked light.

**Alpe d'Huez** (wireframe)
- Engine only (`terrain.js` streaming AWS tiles as contours). No scenery kits.

**Deprecated and rough drafts** (Yosemite, Acadia, Teton, Crater Lake, Monument Valley, Seven Mile)
- The original style-C scatter with the Blender kits and authored landforms. Not migrated, as decided.
- They still build: the guard renders them before and after.

## Done on `toolbox-test` (no visual change)

- **Moved into `js/world/toolbox/` by category**, with generic names: `core`, `landscape`, `materials`, `packs`, `vegetation`, `structures`, `roadside`, `atmosphere`, `life` and `city`.
  - The engine stays in `js/world/`.
  - Every import and path mention was rewritten.
- **Split shared code out of route kits:**
  - `core/random.js` and `landscape/authored-coast.js` from `coast.js`
  - `core/model-builder.js` from the Adirondack kit
  - `vegetation/tree-cards.js` and `roadside/guardrail.js` from the scene builder
  - the planting noise into `core/random.js`
- **Generic names:**
  - `MountainRoad`, `Wildlife`, `ArchBridges`, `RoadsideDetails`, `roadFrame`
  - `makeNortheastPack`, `makeNorthernRockiesPack`
  - `makeGroundMaterial`, `makeSeaMaterial`, `SCENERY_QUALITY`
- **A pack registry** (`packs/index.js` and `packs/meta.js`):
  - Any route can list any pack.
  - Species variants, ground cover, flower zones and model lists live in one place.
  - The build validates pack models from the registry.
- **A scene schema** (`scene-schema.js`):
  - All 77 fields, each with the module that reads it.
  - `normalizeScene()` maps the old names: `kitExtensions` → `packs`, `glacier` → `mountainRoad`.
  - `life.kit` picks wildlife or coast life explicitly. The default is unchanged.
- **Extras:**
  - the scene linter (in `npm test`)
  - five biome presets with the standard look
  - `npm run new-route`
  - the toolbox gallery
  - the refactor guard (`snap --png --fingerprint`, `npm run guard`)

## Duplicates and gaps left for an upgrade pass

These change visuals, so the refactor-only pass left them alone:

1. **Two geometry builders.** `core/model-builder.js` (flat-shaded `Builder`) and `core/mesh-builder.js` (`MeshBuilder`) do overlapping jobs. Merge them into one API.
2. **Four bridge builders:**
   - arch bridges (real terrain)
   - fitted decks (`roadside/details.js`)
   - mountain-road arches
   - city bridges

   Make one bridge kit with styles: concrete arch, masonry arch, deck, steel truss.
3. **Three guardrails:**
   - post-and-rail (`roadside/guardrail.js`)
   - the northeast pack's `guardrail0` model (settlement)
   - masonry guardwalls (mountain road)

   Make one `roadside` kit with styles.
4. **Two traffic systems and two crowds.** `life/traffic.js` and `life/visitors.js` against the city's own cars and people in `city/life.js`.
5. **Two planting paths.**
   - The forest-edge planner has two hard-coded species planners: northeast lake forest and mountain zones.
   - Other routes use the scene builder's tile scatter.
   - Next: a data-driven species mix by zone, so a new region is data plus a pack.
6. **No pack for coast, desert or the Alps.** Big Sur, Zion and the older routes use the Blender kits. A new region (Mont Ventoux, Stelvio, Alpe d'Huez) needs a pack. An `alps` pack is the obvious next one.
7. **Route content still in code:**
   - Pittsburgh landmarks in `city/bridges.js` and `city/heroes.js`
   - the mountain-road `buildings` (Going-to-the-Sun lodges by name)
   - the coast life lighthouse model
8. **Standard look not yet on Big Sur, Zion or Pittsburgh.** The linter lists it. Baked light has been proven on the city and checked on the presets (see the PR). Bringing these routes to the standard is a visual change, done route by route.
9. **The scene builder is still big** (about 1,150 lines): sea, lakes, clouds, peak clouds and the scatter are still methods there. They're next to move out when they're next touched.
