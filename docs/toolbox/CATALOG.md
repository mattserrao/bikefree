# Texture catalog for kit authors

There are **768 additional named presets** in `texture-catalog.js`: 96 authored recipes, each with eight
named finishes or seasonal treatments, rendered by 47 shared pattern kernels. Together with the previous
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
- **Vegetation kernels** live in `js/world/toolbox/materials/catalog-vegetation.js` (spread into
  `CATALOG_PATTERNS`). What each card holds:
  - *leaves*: a sprig of `st.z` leaves alternating on a twig, terminal leaf on top (`st.z` = 1 gives one
    hero leaf). Outlines: maple 5 pointed lobes + shoulder teeth, white oak rounded forward lobes, beech
    elliptic with straight veins, birch ovate doubly serrate, aspen round with short tip and long petiole,
    willow lanceolate. Autumn finishes vary leaf to leaf (late-green, gold, red) and colour from the margin;
    frost rimes the margins. Pine = needle brush around a twig with terminal bud; spruce/fir = flat spray;
    fern/palm = pinnate fronds. Needle sprays fill their outline when distant instead of sparkling.
  - *grass*: one clump of fanned, crossing blades; `st.w` 0 lawn, 1 meadow seed spikes, 2 hairgrass
    panicle haze, 3 reed + cattail, 4 arching sedge with spikelets. Finish `cut` mows it short and dense.
    Clover: trifoliate heart leaflets with pale chevron plus a white clover head (`st.w` 0).
  - *flowers*: face-on bloom on a stem (radial `st.w` 0 daisy, 1 cornflower, 2 sunflower; cup 0 poppy,
    1 buttercup, 2 wild rose) or an upright raceme (spike 0 lavender, 1 lupine, 2 fireweed; bell = bluebells).
  - *bark*: smooth `st.w` 0 birch / 1 beech / 2 aspen; fissured 0 oak / 1 cedar / 2 redwood / 3 willow;
    scaled = Scots pine plates (orange increases above ~1.5 m of local trunk height); peeling = eucalyptus;
    diamond = palm leaf bases. Bark writes relief `h` and places its own finishes (`fxOwned`): moss from the
    base, the north (−z) side and fissures; lichen rosettes on proud bark; frost on ridges and the north side;
    rain-dark streaks with sheen. Trunks should have local y = height above the ground for this to read.
  - *wave 2 (gap recipes)*: alpine — `leaves/european-larch` (spur-shoot needle tufts, deciduous: turns
    gold), `leaves/subalpine-fir` (upturned flat spray), `trees/european-larch-bark`, `grass/alpine-meadow`,
    `flowers/trumpet-gentian`, `edelweiss`, `alpenrose` (shrub card), `arnica`; coast — `leaves/monterey-cypress`
    (scale-leaf cords), `trees/monterey-cypress-bark` (shaggy), `leaves/coast-live-oak` (spiny, glossy),
    `grass/coastal-sage-scrub` (shrub card), `grass/ice-plant`, `flowers/california-poppy`; city/park —
    `trees/london-plane-bark` (camouflage), `leaves/london-plane`, `leaves/honey-locust` (compound),
    `leaves/ginkgo` (fans), `grass/mown-park-lawn` (short, dense, even), `grass/ruderal-weeds` (dandelion,
    seed clock, chicory: crack weeds for lots and verges). Evergreen (no autumn tint): fir, cypress, live oak.
- **Organic overlays** (`overlays` family; layer with `{ overlay: { id, amount } }` on walls, rock or bark;
  local projection; alpha = coverage). Finish sets amount and state: light / medium / heavy, fresh, old,
  damp, dry, frosted. `english-ivy` (five-lobed leaf mat with vines, climbs from the foot, reach varies along
  the wall, tops the wall when heavy), `boston-ivy` (three-lobed; crimson when `old`), `moss-cushion` (up-facing
  tops, the damp foot and north faces), `crustose-lichen` (grey-green and orange rosettes, more on top/north
  faces), `green-algae-streaks` (streaks running down from varied heights, splash band, ledges and soffits).
  Placement uses `ly` (local height, m) and `up`, so build walls with local y = height above the ground.
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

## Buildings, walls and roofs (kernels in `catalog-hard-surfaces.js`)

Every hard-surface recipe now has its own layout, relief and tooling, not only its own colour. Joints are
recessed (`h`), arrises carry a small *baked* edge light so shape survives the gentle look's toon bands, and
height ramps stay at least ~2.5 px wide so the bump never ticks along joints. Joints fade to their area-mean
colour and per-unit tone fades with distance, so walls settle to a stable average at 30 m and beyond.

- **Walls:** running bond (half-lap stretchers); Flemish bond (stretcher + burnt dark header in every course,
  headers centred on stretchers); English bond (alternating stretcher and finer header courses). Limestone
  ashlar (regular courses, crisp sawn faces, fine lime joints close in tone); granite (random course heights
  and lengths, rock-faced domes in a drafted margin, salt-and-pepper flecks); sandstone (thick/thin courses,
  bedding, diagonal batted tooling, soft eroded arrises). Rubble in pale lime mortar; dry stone (flat coursed
  slabs, dark voids, no mortar); knapped flint (dark nodules, cortex patches, narrow lime joints); gabion
  (packed stones behind a proud welded mesh with 1 m basket frames).
- **Buildings:** limewash over lumpy rubble (stones ghost through, the wash thins on high spots); trowelled
  stucco (sweeps, hairline cracks, a darker plinth band below 0.55 m); roughcast pebbledash; adobe mud
  plaster eroding to mud-brick courses with straw flecks; clapboard (`boards` shape 2: tapered laps, shadow
  line, random butt joints, peeling paint); board-and-batten (proud paler battens, nails, knots); round logs
  with pale chinking and checking cracks; timber framing (1 unit = a storey: posts, rails, braces and
  St Andrew's crosses per bay, recessed limewashed infill); board-formed concrete (lift tone, board imprint,
  form-tie cones with efflorescence runs); glass blocks (bevelled rims, rippled faces).
- **Roofs** (y runs up the slope): canal tiles (alternating rolled caps and pans, tapered, hand-laid offsets);
  Marseille interlocking tiles (twin ribs, side roll, even colour); slate (thin, half-lap, the odd clipped
  corner); stone lauze (thick irregular slabs, wavy butts, lichen); cedar (random widths, keyways, splits);
  standing seam (tall seams, pencil ribs, oil-canning); corrugated sheet (laps, screw rows, rust runs when
  aged); asphalt three-tab (slots, granule speckle).

Finishes are placed (`fxOwned=1`, `catHS_weather`): grime and rising damp with a salt line at the foot (local
y = 0 must be the foot of the wall, as kit walls are built), soot runs from above and dirt in recesses
(`catFinish` 6), moss in joints, on tops and at the foot, dust on ledges and in joints, re-pointed patches
with fresh mortar, and snow in recesses and on up-facing or pitched faces (roofs count faces of about 20° or
more as up-facing). The `boards` (shape 0, planks) and `concrete` (shape 1, utility) kernels still serve
`props/bench-planks` and `props/utility-concrete`. Cost: about 1.5–2.5× the old kernels' ALU. `brick` and
`ashlar` use about 6–10 hashes and no cell search; `rubble`, `gabion`, limewash and stucco use one 3×3 search;
the shared weathering adds about 5 value-noise taps.

The catalog gallery takes `?look=gentle|bold` (the app's toon bands) and `?view=close|mid|far|triple`. The
`triple` view shows hard surfaces at about 3 m, 14 m and 55 m side by side. Snapshot equivalents are
`--look gentle --view triple`. Hard-surface samples stand on y = 0, and roof samples are pitched toward the sky.

### Wave 2: alpine village, Going-to-the-Sun, industrial city and grime overlays

- **Alpine village:**
  - `buildings/pastel-crepi`: sprayed pastel render with painted window surrounds on a 3.2 × 2.9 m storey
    grid, plus a band under each floor line.
  - `buildings/larch-chalet-boards`: vertical boards, brown-black on faces toward +z/−x, honey where sheltered,
    grey in the splash zone.
  - `walls/mountain-stone-lime`: field stone with wide lime joints smeared over the edges.
  - `walls/hairpin-parapet`: rough coursed stone with a cap course. The parapet height is `st.z` metres (1 m).
  - `roofs/larch-shingle`: small silvered shingles.
  - `roofs/zinc-snow-stop`: standing-seam zinc with a snow-stop rail every 1.6 m.
- **Going-to-the-Sun:** `walls/ccc-rubble-guardwall`: flat red/green argillite slabs in grey mortar under a
  cap course.
- **Industrial (darker, coarser, grimy, unlike the tidy residential recipes):**
  - `riveted-bridge-steel`: "Aztec gold" plates with laps and rivet rows; paint chips to red primer, then rust.
  - `mill-corrugated-siding`: rust rises from the foot and from laps every 3 m.
  - `weathering-steel-sheet`
  - `sooty-industrial-brick`: dressed-stone lintel band at 2.55–2.8 m of every 3.2 m storey.
  - `concrete-retaining-wall`: board marks; a row of weep holes at 0.45 m with rust and salt runs.
  - `steel-grate-deck`
  - `cast-iron-storefront`: moulded frames and petalled bosses.
  - `concrete-sidewalk`: tooled margins, an expansion joint every third panel, stains and gum.
  - `belgian-block-alley-wall`
  - `ghost-sign-brick`: faded painted panel of abstract block glyphs. These are not words.
  - `city-steps`: 0.3 m treads with steel nosing, 0.17 m risers with drip stains.
  - Industrial finishes (`grimy`, `rusty`, `oily`, `graffitied`) are placed by `catHS_weather`:
    - grime goes into joints and the foot;
    - rust blooms at recesses and runs;
    - oil darkens and glosses low areas and tops;
    - graffiti adds stylised tags (no words) between 0.3 and 2.1 m.
- **Grime overlays:** use `makeCatalogMaterial(baseId, { overlay: { id } })`. Alpha is coverage. Placement
  uses `ly`/`up`, and the base's height (`catHBelow`) for joints.
  - `soot-streaks`: from ledges every `st.x` m (default 2.6 m).
  - `rust-bleed`: runs from fixings on a 1.2 × 1.6 m grid.
  - `efflorescence`: salt bloom at the foot with a tide line, and in low joints.
  - `graffiti-tags`
  - `flyposting`: A2 posters in a 0.9–2.3 m band, torn when old.
  - `water-stain-runs`
  - Overlay finishes set the amount (light/medium/heavy), fresh or old (faded and torn), damp/dry and frosted.

Geometry contract: placement measures from local y = 0 at the foot of the wall. Storey-grid features (crépi
surrounds, lintel bands, ghost signs) use projected metres, so they line up across faces. Cost: the industrial
kernels cost about the same as brick (`riveted-steel` uses about 14 hashes; `sheet-metal` and `cast-iron` use
under 10, with no cell search). Each overlay adds about 3–8 noise taps on top of its base. Brick and ashlar
now fade joints to a soft bed-joint rhythm at mid range, then to their mean. Rubble cells are domain-warped,
and dry stone is coursed random-length slabs, so they no longer read as Voronoi.

## Ground, props and vehicles (kernels in `catalog-ground-props.js`)

Each ground recipe has its own structure *and* value range, so they separate at a glance from a bike's
grazing view: asphalt (dark binder, sparse chips, glossy tar-snake crack sealant, fresh/oxidised patches),
chip seal (dense angular faceted chips, darker flushed-binder patches), rounded cobbles (domed stones,
polished crowns, gritty sand joints), granite setts / Belgian block (`setts` kernel: rows of bevelled,
slightly tilted blocks with salt-and-pepper speckle), river gravel (loose rounded multi-coloured pebbles with
shadowed fines), crushed limestone (pale, low-contrast faceted chips in powdery fines), woodland litter (four
layers of ovate, lance and lobed leaves with contact shadows, twigs, soil gaps), loamy earth (dark crumbly
clods, a few stones, trampled packed patches), red clay (drying cracks with curled plate edges, smooth wet
hollows), beach sand (asymmetric wind ripples, dark minerals in troughs, glints), layered rock (terraced
beds with ragged shadowed lips and joints; horizontal strata on cliffs) and snow crust (sastrugi with lit
windward and blue lee faces, glazed ice in hollows). Every ground kernel uses at most one 3×3 cell search
(litter: four single-cell lookups) and fades detail to a matched average with distance; metre-scale macro
noise breaks repetition at 5–30 m. Relief (bump) comes from `h`; per-recipe depths are in the data column.

These kernels place their own finishes (`fxOwned=1`): damp darkens the gaps first, lowers roughness and
fills puddles only in macro hollows on up-facing ground; frost coats sky-facing proud tops; moss grows in
joints and shady patches; dust packs into crevices; compacted flattens and loose deepens the relief; worn
polishes crowns. Vehicle and prop kernels place finishes by geometry: road grime and stone chips below
local y ≈ 0.3 m (build vehicles with their origin at ground level), dust on up-facing faces, rain beads on
top and runs on vertical faces, rust from high-curvature edges, pits and down-streaks (oxidized), mud in
tread grooves and splashed low, chalky bloom on open rubber, rime on up faces and edges. Kernels: paint
(orange peel, metallic flake, pearl flop, patchy primer), hammer (hammertone dimples; galvanised spangle
with white rust), metal (brushed grain, chrome, weathering-steel patina with pits and runs), rubber
(sidewall rings and lettering band), tread (chevron blocks, grooves with depth, sipes), glass, lens
(cube-corner reflector cells and optic ribs), fabric (plain weave), rope (three-strand lay).
Large-scale (10–35 m) tone drift and warm/cool weathering zones keep ground from going flat at 15–60 m.

### Rock, road markings and water (same module)

- **Rock** (local projection; on vertical faces q.y is up, so beds and streaks read correctly on cliffs):
  `adirondack-granite`, `alpine-limestone` (karren flutes, clints/grikes, ink streaks), `argillite-strata`
  (red/green beds, Going-to-the-Sun), `sandstone-road-cut` (cross-bedding, drill half-pipes),
  `serpentine-sea-cliff` (polished green facets, veins; Big Sur), `scree-talus`, `granite-riprap`,
  `firn-snowfield` (sun cups, dirty ridges), `glacier-ice` (crevasse lines, ogives), `seep-wet-rock`.
  Finishes are placed by `catGP_rock`: damp/wet darken the cracks first (wet adds glossy down-streaks on steep
  faces), lichen rosettes on proud faces (fading to a tint at distance), moss and snow on up-facing ledges and
  cracks, rime, sun-bleaching of exposed faces.
- **Markings** are designed as overlays (`makeCatalogMaterial('ground/road-asphalt/dry', { overlay: { id } })`):
  alpha = paint coverage; standalone they draw on their own asphalt/concrete. Placement is in exact metres,
  with travel along +y of the projection (world z on world-projected ground) and the road repeating every
  `st.x` metres across (centre at x = 0). Recipes: US double-yellow + white edges, French dashes
  (3 m/10 m centre, 3 m/3.5 m edges), lane skip lines, Tour-style painted lettering (random glyphs, not names),
  zebra crossing, green bike lane with bike-and-rider symbol, sharrow, crack sealant, tyre skid marks,
  utility-cut patch, manhole cover + storm grate, painted kerb (blocks along local x). Finishes (worn, faded,
  dusty, rain-dark, tyre-marked, patched, frosted) only use overlay-safe variables (`metres`, `fx`, `catFinish`).
- **Water** (opaque, no simulation): sandy lake bed, river cobble bed, glacial silt, tannin bog bed, shoreline
  wet band (water line at projection y = 0, so build the shore with the water surface at y = 0), wet sand with
  swash lines, kelp wrack, tidal rock pool, lake surface. Water finishes tint the water column (clear/murky/
  glacial/tannin), change depth (shallow), caustics (still/windy) or add skim ice (frosted).
- **Extras:** `ground/pine-needle-duff`, `ground/summer-litter`, `ground/brick-pavers` (Pittsburgh brick street);
  `props/w-beam-guardrail`, `props/jersey-barrier` (origin at ground), `props/reflective-sheeting`.

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
snapshot command. Preview PNGs are not kept in the repo: render them with the commands above.

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
