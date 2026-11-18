# Texture catalog for kit authors

There are **768 additional named presets** in `texture-catalog.js`: 96 authored recipes, each with eight
named finishes or seasonal treatments, rendered by 46 shared pattern kernels. Together with the previous
20 additions this branch provides **788 new options**. The original toolbox remains available.

These are code-generated material presets, not 768 hand-painted images or 768 different shader algorithms.
Seed variations do not count as presets. Every entry has a distinct effective parameter set. The browser
verification also renders all entries and rejects empty output and duplicate finishes within a recipe.
Structural patterns, colours, ageing, dust, moisture, frost, physical finish and cutout shape provide the
variation. Vehicle tyres, glazing and lenses have different treatment choices from body paint.

| Family | Recipes | Presets | Examples |
| --- | ---: | ---: | --- |
| Vehicles | 10 | 80 | Enamel, metallic and pearl paint, aluminium, chrome, rubber, tread, glass, tail-light lenses |
| Tree bark | 10 | 80 | Birch, oak, pine, cedar, beech, aspen, willow, eucalyptus, redwood, palm |
| Leaves | 10 | 80 | Maple, oak, beech, birch, aspen, willow, fern, pine, spruce, palm |
| Grass | 8 | 64 | Fescue, meadow grass, rye, bluegrass, hairgrass, reed, sedge, clover |
| Flowers | 10 | 80 | Daisy, poppy, buttercup, cornflower, lavender, bluebell, lupine, sunflower, rose, fireweed |
| Buildings | 10 | 80 | Limewash, stucco, roughcast, adobe, clapboard, batten, logs, timber framing, concrete, glass blocks |
| Walls | 10 | 80 | Running/Flemish/English brick, ashlar, rubble, dry stone, flint, gabions |
| Roofs | 8 | 64 | Canal/interlock clay, slate, lauze, cedar, metal seams, corrugations, asphalt shingles |
| Ground | 12 | 96 | Asphalt, chip seal, cobbles, setts, gravel, limestone, litter, soil, clay, sand, strata, snow |
| Props | 8 | 64 | Zinc, oxidized steel, paint, concrete, bench wood, canvas, rope, aggregate |
| **This catalog** | **96** | **768** | Plus 20 earlier road/path and standalone options |

## Discover and select

The public entry point is `js/world/toolbox/materials/index.js`. It re-exports the new catalog API and the
earlier factories without changing their names or behaviour. Data-only tools can import
`texture-catalog.js` directly, avoiding a Three.js import. A generated JSON mirror is available at
[`texture-catalog.json`](texture-catalog.json), including every ID, parameters, tags, usage and counts.

```js
import { findTextures, getTexture, makeCatalogMaterial } from './materials/index.js';

// Find options; query words match the ID and display name. Default page size is 100.
const flowers = findTextures({ family: 'flowers', tags: ['cutout'], limit: 100 });
const masonry = findTextures({ query: 'granite aged', offset: 0, limit: 20 });
const meta = getTexture('vehicles/coach-enamel/factory-gloss');

const bodyPaint = makeCatalogMaterial(meta.id, { seed: 17 });
const bark = makeCatalogMaterial('trees/scots-pine/mature', { scale: 1.2 });
const poppy = makeCatalogMaterial('flowers/field-poppy/fresh');
const brick = makeCatalogMaterial('walls/flemish-bond-brick/aged');
```

IDs follow `family/recipe/finish`. Use discovery rather than guessing valid finish names. Entries are
immutable; a factory call returns an independent material. Cache and share compatible material instances
within a kit, and dispose owned materials when the kit is disposed. No texture images are downloaded and
the catalog does not allocate 768 GPU materials on import. Material creation is explicit and lazy. Programs
are shared by pattern and compatible Three.js feature flags, rather than compiling one program per ID.

## Geometry and coordinate contract

Options: `seed` integer 0–65535 (default 1), `scale` .25–4 (default 1), `variation` 0–1 (default .65), optional
`color: '#rrggbb'` override, and `projection` where the material supports it. Unknown IDs and invalid values
produce errors. Primary/secondary/accent palettes and physical settings are discoverable on each entry.

- **Cars and moving objects:** default `local` projection follows the object. Assign materials to body,
  tyre, glazing and trim slots separately. A texture does not turn a merged single-material vehicle into
  separate parts. Models are assumed to use metre units; object scaling also scales local patterns.
- **Bark:** default `cylindrical` projection wraps around the local y axis, with local y as trunk height.
  Centre the trunk geometry on that axis. Branches need their own coordinates/meshes or a kit adapter.
  Cylindrical projection has an angular seam; it is not a UV unwrap of an entire branching tree.
- **Leaves, grass and flowers:** use a card with UVs 0…1, such as `THREE.PlaneGeometry`, and a material from
  the matching family. The shader supplies an alpha-test silhouette with double-sided drawing. These are
  surface/card patterns, not new plant meshes. They can be instanced and need no downloaded atlas.
  `uv` projection is required. Scaling a card changes its physical size, not its alpha silhouette.
- **Ground:** defaults to world xz for horizontal surfaces; static world coordinates remain coherent
  across placed pieces. Rotation-aware face projection is available for other solid materials via
  `projection: 'world'`. Dominant-axis projection can show seams on curved or diagonal objects.
- **Buildings/walls/roofs/props:** default local face projection on mesh geometry. Windows, facade trim,
  roof shapes and building recipes remain the responsibility of their existing kits.

Materials use `MeshPhysicalMaterial` with per-preset roughness, metalness and clearcoat. Glazing uses
simple transparency, not an optical refraction simulation; manage sorting when assembling a vehicle.
Frost/snow/moss/dust treatments are surface colour/finish effects and do not add accumulated geometry.

These factories support static and instanced meshes. They do not silently compose the existing tree
wind, figure skinning, facade window shader, terrain biome blending or baked-light shader modifications.
Use existing materials wherever those behaviours are required until a kit-specific adapter is added.
No existing route or kit is automatically converted. Catalog IDs are **not** new `road.surface` or
`buildingKit.styles` values: use the factory in a kit, or use the earlier road-specific scene options in
[`MATERIALS.md`](MATERIALS.md). Seasonal variants are artistic choices; scenes must select appropriate
species and seasonal combinations for their place.

## Browse, render, and verify

```sh
npm start
# http://localhost:8000/tools/catalog-gallery.html
# Filter by family, search, show every finish, and page through all 768 entries.

npm run gallery:catalog -- --selection featured --limit 20 --out /tmp/overview.png
npm run gallery:catalog -- --family flowers --limit 24 --out /tmp/flowers.png
npm run gallery:catalog -- --family leaves --selection all --query sugar-maple --out /tmp/seasons.png
npm run gallery:catalog -- --selection featured --out /tmp/checked.png --verify
node tools/build_texture_catalog.mjs --check
```

The final command's WebGL verification checks all 768 entries, all 46 kernels on instances, pixel coverage,
per-recipe finish duplicates, and deterministic/different seeds. Compilation and page errors fail the
snapshot command. [Overview PNG](catalog/overview.png); family PNGs are in `docs/toolbox/catalog/`.

The Node tests verify counts, eight entries per recipe, effective parameter uniqueness, metadata,
discovery/pagination, factory creation, controls and the generated JSON mirror. Run `npm run routes:build`
after runtime source changes to update offline assets. Full Node tests and WebGL checks do not establish
target-device frame rates. Review moving-camera shimmer, distant plant cards, transparent layering and
material batching in the target kit before adopting many options on a route. This pass does not claim
that every variant has been placed on a complete route or individually art-directed on target hardware.

Recorded validation, 18 Nov 2026: the full Node suite passed (33 test files), followed by focused checks
after the final source changes. Chromium/SwiftShader verified all 768 entries and 46 instanced kernels,
with zero empty renders and zero duplicate finishes within recipes. Seed repeatability and seed changes
passed. Thirteen PNG sheets were generated: one overview, ten families, vehicle finishes and leaf seasons.
The generated JSON catalog matches runtime data, and the offline manifest includes the new modules.
