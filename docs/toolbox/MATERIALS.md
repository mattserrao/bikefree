# Additional procedural materials

The following documents the first 20 additions. The subsequent [expanded catalog](CATALOG.md) provides
768 more presets for all ten material families, bringing this branch to 788 new options. All IDs and
factories below remain available.

First implementation on `toolbox-textures-test`, 18 Nov 2026. These are opt-in additions; all existing
materials, building surface codes, exports and scene defaults remain available. No routes were converted.

## Roads and trails: scene selection

`js/world/toolbox/materials/road-textures.js` exports `ROAD_TEXTURES` (descriptions and physical dimensions),
`ROAD_TEXTURE_CONTROLS` (defaults and limits), and `roadTextureSpec(id, controls)`.
The production `decorateRoad` factory in `materials/road-surface.js` selects these automatically.

| New surface ID | Use |
| --- | --- |
| `asphalt-fine` | Dense small aggregate, quiet road surface |
| `asphalt-coarse` | Coarser exposed aggregate |
| `concrete-broom` | Transverse broom finish |
| `concrete-slabs` | Three-metre slab joints |
| `gravel-compacted` | Compacted aggregate, loose edges |
| `limestone-path` | Pale crushed-stone path |
| `earth-packed` | Soil, longitudinal compaction and grit |
| `stone-setts` | Staggered 24 × 17 cm granite blocks |

Inside a stylized scene:

```json
{
  "road": {
    "surface": "asphalt-fine",
    "texture": { "seed": 17, "scale": 1, "variation": 0.65 },
    "zones": [
      { "fromM": 1000, "toM": 1800, "surface": "concrete-slabs", "texture": { "seed": 29 } },
      { "fromM": 2000, "toM": 2400, "surface": "worn" }
    ],
    "trail": { "surface": "limestone-path", "texture": { "seed": 5 } }
  }
}
```

`texture` controls are optional: seed is an integer 0–65535 (default 1), scale is .25–4 (default 1;
multiplies physical dimensions), variation is 0–1 (default .65). Zones inherit the parent road or trail's
controls and can override them. Trails have their own controls; the existing city route-kind system
decides where their geometry is used. Zones retain the existing 40 m blend at each boundary and the
24-zone limit. `wet` in a zone darkens the new surfaces as well.

New asphalt and concrete retain the road's lane paint. Gravel, limestone, earth and setts suppress paint.
Existing US/EU paint textures and French markings remain supported. Existing legacy wear/crack parameters
still work on legacy materials; the new patterns use their own grain/joints and variation controls rather
than inheriting asphalt crack and patch effects. Width narrowing and its gravel shoulder remain applied.
These are visual surface options; they do not change physics or road geometry.

Legacy IDs remain `fresh`, `worn`, `chipseal`, `alpine`, `patched`, `tunnel`, `brick`. Legacy-only scenes
keep the original road shader path. Unknown legacy IDs still fall back to worn; the linter now warns.

## Other kits: standalone material factory

`js/world/toolbox/materials/surface-library.js` exports `SURFACE_LIBRARY`, `toolboxSurfaceSpec`,
and `makeToolboxSurface`. These are code-level options for kit authors. They are **not** new names in
`buildingKit.styles` or replacements for the facade/terrain/tree shader systems.

| Family | New IDs |
| --- | --- |
| Buildings | `limewash-aged`, `stucco-warm`, `timber-weathered` |
| Masonry | `sandstone-courses`, `granite-blocks` |
| Terrain | `soil-forest`, `sand-rippled`, `meadow-turf` |
| Vegetation | `bark-birch`, `bark-oak` |
| Details | `metal-galvanized`, `paint-weathered` |

```js
import { makeToolboxSurface } from './materials/surface-library.js'; // from a toolbox module

const material = makeToolboxSurface('sandstone-courses', {
  seed: 17, scale: 1, variation: .65, color: '#b7a080',
});
const wall = new THREE.Mesh(wallGeometry, material);
// Share one material among compatible meshes/instances; dispose it when its owner is disposed.
```

The three numeric controls have the same bounds/defaults as road controls. `color` is an optional
`#rrggbb` sRGB override. Every catalog entry includes its default colour, roughness, dimensions,
description and consumer. Unknown IDs and invalid controls throw descriptive errors.

Patterns use world-space metres and dominant-face projection, so UV attributes are unnecessary.
Ground types use xz; walls and bark use height and the dominant horizontal axis. Static and instanced
meshes are supported. World axes determine pattern orientation; these are not local-UV textures that
rotate with an animated object. Avoid skinned/morphing geometry. Dominant-axis projection can show
seams on rounded or angled shapes; triplanar blending and species-specific wrapping remain future work.
These standalone factories add material appearances without the facade shader's doors/windows, tree
wind, terrain biome blending, water animation or baked-light customizations. Keep those existing
materials wherever those behaviours are needed. No animated water materials are added in this pass.

## Preview and verify

```sh
npm start
# http://localhost:8000/tools/textures-gallery.html
# http://localhost:8000/tools/textures-gallery.html?library=surfaces

npm run gallery:textures -- --out docs/toolbox/road-textures.png --verify
npm run gallery:textures -- --library surfaces --out docs/toolbox/kit-surfaces.png
npm run gallery:textures -- --condition golden --out /tmp/roads-golden.png
npm run gallery:textures -- --condition wet --out /tmp/roads-wet.png
```

The gallery uses the production factories on metre-scaled sample panels, plus a 75 cm close-up.
Road maps use the engine's base colour/paint conventions with deterministic grain, not a full route.
Original worn/fresh/brick appear for comparison. The optional browser verification checks seed
repeatability, changed seeds/scales, French markings, wet zone-only selection, and instanced materials.
Any page, shader or asset-load errors fail the snapshot command.

Validation for this pass: full Node suite; focused control/linter tests; WebGL gallery compilation;
before/after frozen screenshots at `goingtothesun@6000` and `pittsburgh@1500` (pixel-identical). These
two shots are a compatibility sample, not an exhaustive route guard. New shaders add fragment work;
hardware performance, moving-camera shimmer, and full route placement still need target-device review.
The new road layer adds no draw calls or texture-image files; standalone materials need the same draw
batching discipline as existing kit materials. Software rendering does not establish M4 performance.

## Next design review

Review the PNGs for palette, pattern strength and physical scale. The expansion proposal lists further
options (roof variants, dry stone, additional biome/seasonal surfaces, cloud shapes and regional mixes).
Decide which standalone materials deserve scene-level adapters before converting any route. Existing
numeric building surface codes must not be repurposed.
