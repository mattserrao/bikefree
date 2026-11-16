# Adding scenic routes

Routes are defined in `routes/catalog.json`. Add a GPX and one catalog entry;
the preparation command validates them and generates the app catalog and offline
file list. It does not download maps or modify existing GPX tracks.

## Add a GPX

1. Put an elevation-bearing GPX under `routes/parks/`, for example `my-coast.gpx`.
2. Append an entry to `routes/catalog.json`:

```json
{
  "id": "my-coast",
  "name": "My coastal ride",
  "park": "Location, region",
  "file": "routes/parks/my-coast.gpx",
  "outAndBack": true,
  "expectedKm": [25, 35]
}
```

`expectedKm` is the allowed length of the **full lap**, including both legs for
an out-and-back. An out-and-back GPX must already contain A → B → A; a loop GPX
must return to its start. `outAndBack` tells the renderer to draw the shared road
once and provides the turnaround to the rider and cameras. Use `false` for loops.
Names are normal JSON text; GPX XML must escape `&` as `&amp;`.

3. Run these commands with Node 18+ and Python 3 installed:

```sh
npm run routes:build
npm test
npm run routes:check
```

The builder checks unique IDs, paths, GPX XML, elevation, loop closure, expected
length and return-leg symmetry. Out-and-back grades above 12% require inspection.
It recomputes the catalog's length and climbing using the app's own smoothing, so
the cards agree with the ride. It also generates `sw-assets.js`, including every
catalog route and its scenery dependencies. Do not hand-edit either generated file.
`routes:check` fails if generated files are stale; rerun `routes:build` after source
changes before committing. The app's existing personal GPX import still works.

## Optional road routing

Existing catalog entries have an optional `routing` object with waypoints, a
BRouter profile, points of interest and elevation options. To rebuild a track
from those definitions (requires internet access and Pillow):

```sh
python3 tools/build_park_routes.py bigsur
npm run routes:build
```

The Python router reads the same catalog. A GPX-only entry needs no `routing`
object. Road routing and scenery authoring are separate operations.

## Real terrain and northern-forest scenes (Route 28)

A scene can carry baked real terrain instead of authored landforms:

```sh
python3 tools/build_scene_terrain.py route28   # needs internet once (tiles cache in tools/.cache), numpy, scipy, Pillow
npm run routes:build
```

It writes `routes/scenes/<id>.terrain.bin` (30 m grid: elevation, signed distance to the
nearest lake shore, lake id) and a `terrainData` block in the scene JSON. Lakes come from
the USGS elevation itself — hydro-flattened water is exactly flat — so shorelines and lake
levels match the aerial imagery of the real horizon. Within the grid the stylized ground
follows the real hills; lakes are drawn on the grid with a sheltered-water shader.

Scene options used by Route 28:

- `kitExtensions: ["adirondack"]` — procedural northern-forest trees (white pine, spruce,
  hemlock, maple, birch at three levels of detail), saplings, goldenrod, blueberry, boulders,
  houses, camps, store, church, motel, boathouse, dock, canoes, motorboat, poles, mailboxes, guardrail.
- `vegetation.layout: "forest-edge"` with `species` weights, `edge.mownM` / `edge.shrubM`,
  `canopyM` (height of the distant canopy shell), `treeScale`, `coverScale`.
- `season: "summer" | "fall"` (the preview also takes `&season=fall`).
- `atmosphere`: `fogNearM`, `fogFarM`, `fogFarRealM`, `lakeMist` (morning and golden hour);
  valley haze (`js/world/haze.js`, every stylized scene): `haze` (strength ×, default 1), `hazeM` (how deep
  the low air is, default 75 m), `hazeBaseM` (its floor, default the route's lowest point).
- `towns`: `{ name, fromM, toM, setbackM, spacingM, skip }`; camps and docks are placed
  automatically wherever a shore is within ~190 m of the road (`camps: [{fromM,toM}]` limits them).
- `poles`: `{ side, spacingM, lateralM }` — utility poles with sagging wires.
- `signs[].kind`: `"dec"` (brown and yellow) or `"diamond"` (yellow warning) in addition to the defaults.
- Palette extras: `forestFloor`, `canopy`, `farTint`, `farTintAmount`, `shallowWater`.

QC adds `road-in-lake`, `lake-side`, `building-on-road`, `building-in-water` and `dock-on-land`
for these scenes.

## Real mountains with lakes (Going-to-the-Sun Road)

`terrain: "real-mountain"` is Big Sur's real-terrain pipeline (`real-coast.js`) without a sea:

```sh
python3 tools/build_terrain_grid.py goingtothesun   # "lakes" mode: terrainBuild.lakes = true
npm run routes:build
node tools/glacier_sides.mjs 41700 44345             # which side of the road falls away at those metres (+1 = right)
```

- **Terrain:** `terrainGridFile` (10 m within `fineM` of the road, 40 m out to `padM`), shipped as
  `<id>-terrain.grid.bin.gz`: the grid's JSON header plus the height rows as raw bytes, gzipped
  (`js/terrain-grid.js`; GitHub Pages compresses JSON but not binary, so the app inflates it itself).
  `node tools/pack_terrain_grid.mjs <old>-terrain.json` converts an older JSON grid. In `lakes` mode the
  baker finds the hydro-flattened lakes (dead-flat basins of at least `minLakeHa`), each with its own level,
  and writes a 20 m lake-id raster; `lakeNames: [[name, lat, lon]]` names them. The lake beds are pressed
  down and the lakes drawn at their levels; the weather's fog bank lies on the lowest big lake.
- **Vegetation:** `kitExtensions: ["glacier"]` (cedar, western hemlock, Engelmann spruce, subalpine fir,
  western larch, lodgepole, aspen, krummholz; beargrass, paintbrush, glacier lilies, huckleberry, alder,
  talus) with `vegetation.layout: "forest-edge"`. Species and density come from the landform: `treelineM`,
  `divide: [lat, lon]` (east of it is drier: aspen, lodgepole, grassland), avalanche chutes and cliffs stay
  open. `vegetation.forestDensity` scales the stand.
- **Rock and snow:** with `palette.argillite` the cliffs show formation bands (red argillite = `cliff`, green =
  `argillite`, grey limestone above 1,900 m, the dark sill at about 2,120 m); `snowLineM` sets midsummer
  snowfields in the cirques; `glaciers: [{ name, lat, lon, radiusM, aspect, angle, dropM }]` paint ice.
- **Built features:** `sites` (levelled, tree-free pads: `{ name, lat, lon, widthM, lengthM, angle, atRoad }`),
  `lakeIslands` (`{ lat, lon, lengthM, widthM, heightM, angle, trees }`), `bridges` with `style: "arches"` and
  `side` (built by the landmarks module; only that side is carved), `bridgeColors`, and a `glacier` block for
  `js/world/glacier-landmarks.js`: `guardwalls`, `tunnels` (`{ fromM, toM, windows, valleySide }`),
  `waterfalls` (along the road `{ fromM, toM, heightM }` or at a point `{ lat, lon, upM, downM }`),
  `buildings` (`logan-pass-visitor-center`, `lake-mcdonald-lodge`, `rising-sun`, `st-mary-visitor-center`),
  `parking` and `snowbanks`.
- **Life:** `life` with `goats`, `bighorn`, `marmots`, `squirrels`, `bears` (`{ atM, radiusM, count, lateralM, side }`),
  `ducks` and counts of `ravens` and `eagles` (`js/world/glacier-life.js`).
- **Weather:** `weather.presets` can include `smoke` (wildfire smoke); mountain scenes get cloud caps on the
  summits with `clouds` and `rain`. `signs[].kind: "nps"` is the brown park sign.

## Style-C scenery for every scenic route

Every scenic catalog entry has a `scene` path under `routes/scenes/`. Big Sur uses
`terrain: authored-coast`; the other nine use `terrain: authored-region`. Each scene
defines a palette, an authored coastline, a seed, roadside barrier ranges, and
landmarks with latitude/longitude coordinates. Optional `signs`, `lookouts`, and
`seaStacks` arrays place detailed road furniture, viewpoints and coastal rocks.
Each uses `atM` in metres along the outbound leg; dimensions such as `widthM`,
`lengthM`, `heightM`, and `offshoreM` are also metres. The preparation command
checks feature positions and positive dimensions. A bridge can also set
`creekWidthM` to carve and render a small creek through its authored canyon. The GPX remains the source for
the road and riding profile. The surrounding landforms are an artistic
interpretation, **not surveyed terrain or a replacement elevation dataset**.

The renderer builds nearby terrain at finer resolution, instances repeated
vegetation, and uses bundled models. Close vegetation uses detailed meshes and
denser grass/flower verges; distant trees use cheaper meshes with matching
silhouette heights. Ground and water shaders provide weathered stone, grass/soil
variation, shallow-water color, foam, waves and sun reflections. Cast shadows
anchor the rider, bridge and vegetation. Bridge geometry bends to the GPX so
the detailed deck, curbs and railings follow the riding surface. All ten scenic routes use bundled scenery without elevation or imagery service
requests. Each region has its own landforms, vegetation, water and palette:
Yosemite granite and the Merced River; Acadia coast and ponds; Teton peaks and
lakes; Crater Lake and Wizard Island; Monument Valley mesas; Big Sur coast and
Bixby; Glacier alpine ridges; Zion canyon and Virgin River; Keys islands and both
Seven Mile bridges; and Adirondack forest and lakes.

To author another region, copy the closest scene preset, set `title`, `seed`,
`palette` and `biome`, then adjust these optional fields:

- `formations`: latitude/longitude, `radiusM: [x, z]`, `heightM`, and `shape`
  (`peak`, `mesa`, `dome`, `half-dome`); `island: true` places a formation in a lake.
- `valley`: two latitude/longitude points in `axis`, a `widthM` and `heightM`.
- `lakes`: named ellipses with latitude/longitude, `radiusM`, and `elevationM`.
- `rivers`: named latitude/longitude `path`, `widthM` and `depthM`; short road
  crossings receive bridge decks fitted to the GPX.
- `islands`: tropical land ellipses with `radiusM` and `heightM`.
- `bridgeRanges`: `fromM`, `toM`, `depthM` and optional `lateralM` for parallel bridges.
- `vegetation`: asset names in `trees`, `shrubs` and `cover`; `treeDensity`,
  `density`, `vergeDensity` and optional `treelineM`; `snowLineM` colors high ground.
- `preview`: `positionM` and `camera` establish a useful initial review view.

Add the scene path to the new catalog entry and run `npm run routes:build`.
Check the full route with the preview slider and all quality settings. The builder
validates files, models and dimensions; it cannot judge an artistic composition.

Rebuild the original Blender coastal kit without third-party assets:

```sh
blender --background --python tools/build_coastal_assets.py
npm run routes:build
```

Build both kits (the regional builder also rebuilds the coastal kit):

```sh
blender --background --python tools/build_regional_assets.py
npm run routes:build
```

The kits export to `models/scenery/coastal.json` and `models/scenery/regional.json`. Source models use metres, Y up,
and +Z along the road; bridge decks sit at Y=0. The web renderer places the bridge
on the nearest outbound route sample and opens a canyon below its deck.

## Review a scene

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/tools/world-preview.html`. Use the position slider,
route picker, Ride/Pause, camera and lighting controls. Useful URLs:

- `?park=bigsur&pos=15420&cam=chase` — bridge approach.
- `?park=bigsur&pos=15670&cam=vista` — bridge structure and coast.
- `?park=bigsur&pos=17700&cam=chase&time=golden` — coast in warm light.
- `?park=bigsur&pos=15420&style=legacy` — previous renderer; needs tile services.

`clean=1` hides preview controls for captures. `speed=10` rides at 10 m/s. The
preview and main app use the same loader and renderer, including turnarounds.
Scenery detail has Light, Balanced and High settings in both the preview and
Settings. Balanced is the default for the M4 Air target; High increases vegetation
and shadow resolution, while Light turns off cast shadows and lowers density.
These are explicit settings, not measured hardware performance guarantees.
The preview also accepts `quality=low`, `quality=balanced`, or `quality=high`.
The service worker caches the preview and scene after successful installation.

To share a standalone preview that opens directly in Chrome, without a server:

```sh
node tools/package_preview.mjs /tmp/bikefree-bigsur-v0.11.1.html
```

This packages the actual WebGL scene, GPX and animated rider into one HTML file.
It is a visual review artifact, not the Bluetooth trainer app. Sustained frame
rate, thermal behaviour and Bluetooth operation still need checking on the M4 Air.

## Scene snapshots: look at the 3D views

`npm run snap` is the visual half of course QC. It renders route views headlessly in
Chrome and saves them as images, with the draw calls and triangles each view costs.

```sh
npm run snap -- route28@10650 route28@19050:morning route28@16200:drone pittsburgh
npm run snap -- --quality high bigsur@21800:golden route28@24450:fall
```

A shot is `<park>[@metres][:camera][:time][:season][:weather]`:
- camera: `chase`, `drone`, `vista`, `side` or `eye`
- time: `midday`, `morning`, `golden` or `night`
- season: `summer` or `fall`
- weather: `clear`, `marine`, `clouds` or `rain`

The frame is drawn the way the app draws it, including a scene's post-processing (Big Sur).

Without `@metres`, it uses the scene's preview spot.

Images and a `snapshots.json` summary go to `tools/snapshots/`, which is git-ignored.

Options:
- `--out <dir>`
- `--quality low|balanced|high`
- `--size 1280x720`
- `--chrome <path>`, or the `CHROME` environment variable

### Free-camera close-ups

`npm run snap:cam` puts the camera anywhere, for landmarks the ride cameras never frame (towers, the
fort, the stadiums). Each shot gives a camera and a target as latitude, longitude and altitude (metres),
and optionally a time of day:

```sh
npm run snap:cam -- pittsburgh --shots tools/shots/pittsburgh-landmarks.json --out /tmp/landmarks
```

### Postcard views

A scene's `views` give the scenic (`vista`) camera fixed postcard positions: within `rangeM` of a view's
distance along the route, the camera holds that view instead of orbiting the nearest landmark. Each view has
`cam` and `look` (lat, lon, and `up` metres above the ground, or `abs` metres above sea level) and `atM`
(or the route point nearest the camera). Pittsburgh's: the Point from the Ohio, the Golden Triangle from the
Monongahela, the Duquesne Incline deck, and (built at run time) the first Grandview Avenue overlook.
- `--software` (no GPU; slow but works on a server)

It serves the repo itself, waits until every queued scenery tile is built, then draws a single
frame. It exits with code 1 if the page logged an error. Needs `npm install` (playwright-core)
and Chrome.

## Course QC: check the full length for discontinuities

```sh
npm run qc                                  # every scenic route + Demo Hills → tools/qc-report.html
node tools/qc_course.mjs teton zion         # just these routes
node tools/qc_course.mjs --gpx ~/ride.gpx   # your own GPX (path checks only)
node tools/qc_course.mjs --strict           # warnings fail too (exit code 1)
```

The sweep rides each course end to end the way the app does — built and mirrored with the app's own
route code, rider placed with `js/world/pose.js` (shared with `world.js`), every metre, out and back and
across the lap seam — and flags anything that jumps. Consecutive hits merge into one finding with a
from–to range, its worst value and *view* / *ride* links into `tools/world-preview.html` at that spot
(run `npm start` and open the report from `tools/`).

| Layer | Check | Severity | What it catches |
| --- | --- | --- | --- |
| GPX | `gpx-hairpin` | warn | the track doubles back on itself (BRouter spurs, zig-zags); the planned end turnaround is info |
| GPX | `gpx-gap`, `gpx-spike` | warn | points > 60 m apart (straight chord); one point > 6 m off its neighbours' elevation |
| Road | `path-jog` | warn | the drawn road zig-zags sideways (opposite turns > 12° within 20 m), e.g. where a spur was cut |
| Ride path | `pose-jump`, `pose-height` | fail | rider moves > 0.6 m more than the step, or rises/falls > 0.35 m per metre |
| Ride path | `heading-snap`, `heading-sharp` | fail / warn | heading turns > 25 °/m (snap) or > 10 °/m (very tight); planned U-turns are info |
| Profile | `grade-step`, `grade-clamp`, `grade-mismatch` | fail / warn | grade jumps between 10 m samples (resistance jolt), pinned at ±25 %, or disagrees with elevation |
| Scenery | `road-buried` | fail | the drawn ground (6 m patch mesh, as rendered) reaches the road or shoulder surface |
| Scenery | `road-flooded` | fail | lake, river or sea level at the road surface |
| Scenery | `road-floating`, `verge-wall`, `verge-step` | warn | shoulder > 3 m above ground off a bridge; ground > 3 m above the road 8 m out; a > 1 m ledge 6 m out |
| Scenery | `mesh-coarse` | warn | a carve (river, channel) narrower than the 6 m ground mesh beside the road: jagged edge |
| Camera | `camera-lift` | warn | the chase camera is pushed > 0.75 m up by the ground (visible camera hop) |
| Overlooks | `lookout-floating`, `lookout-buried` | warn | an overlook's gravel pad sits > 0.6 m above the drawn ground, or the ground rises > 0.25 m through it |

Limits are in `LIMITS` at the top of `tools/qc_course.mjs`. `test/qc.test.mjs` runs the sweep over the
whole catalog, so `npm test` fails if a route regresses.

**Fixing GPX findings:** `python3 tools/build_park_routes.py --prune-existing [ids]` cuts spurs (including
short 30–400 m stubs) and smooths sideways jogs in the existing GPX files, offline, and moves the scene's
distance-based placements (signs, lookouts, roadside rails, preview position) to match. A full rebuild
from BRouter applies the same steps. The real far terrain (internet tiles) is not
checked; it starts 1.5 km from the road.

## Clipping & overlap QC: things drawn through each other

```sh
npm run qc:clipping                          # Pittsburgh (default) → tools/qc-clipping-report.html
node tools/qc_clipping.mjs zion bigsur       # other routes
node tools/qc_clipping.mjs --no-life         # skip the traffic simulation (~30 s instead of ~10 min)
options: --shots 4 (pictures per check)  --json out.json  --strict  --chrome /path/to/chrome (or CHROME_PATH)
```

Needs `npm install` (three-mesh-bvh, playwright-core) and Google Chrome. It opens the route's real 3D scene in
headless Chrome (bundled scenery only), builds every building chunk, indexes all static geometry with a BVH and
checks what you see while riding. Each spot on a there-and-back ride is reported once, at its one-way distance.

| Check | Severity | What it catches |
| --- | --- | --- |
| `rider-clips`, `surface-in-rider` | fail | anything solid, or another street/deck surface, inside the rider and bike (both lanes, every 2 m) |
| `camera-inside` | fail / warn | the chase camera inside a structure (fail) or inside a building/tree that just vanishes (warn) |
| `view-blocked` | warn | something between the chase camera and the rider |
| `vehicle-through-rider` | fail | a car, bus or train passing through the rider (life simulation) |
| `post-in-street`, `scenery-on-street` | warn | a street tree, lamp post or scattered rock/shrub/tree standing in a street, on a sidewalk or a path |
| `tree-in-solid`, `post-in-solid` | warn | a trunk or post inside a building, bridge or rail bed |
| `floating`, `sunk` | warn / info | a tree or post above (or buried in) whatever it stands on |
| `structure-through-building` | warn | a bridge, incline, rail track or landmark cutting through a building |
| `buildings-overlap` | warn / info | two building footprints drawn in the same place |
| `z-fight` | warn | two surfaces near the route closer than 6 mm with the same depth offset (they flicker) |
| `ground-over-street` | warn | the ground covering a street, sidewalk or path beside the route |
| `vehicle-clips-solid`, `boat-*`, `*-in-water` | warn | traffic into buildings/bridges, boats on land or through piers, things in the river |
| `vehicles-overlap`, `person-clips-solid` | info | traffic through traffic, people through posts: accepted as background life |

Limits are in `LIMITS` at the top of `tools/qc-clipping.js`. Pictures: the rider's view for ride checks, a close
camera on the spot otherwise (none for moving things). Software rendering in headless Chrome can show the ground
washed out; that's the renderer, not the scene.

**The rule behind the Pittsburgh fixes:** nothing may be drawn in the space over the route's road (its width plus
0.6 m, from just above the surface to 4.1 m up) — `landscape.inRouteTube()`, applied to streets, decks, bridges,
rails, inclines and shop fronts as they're built (`MeshBuilder.keepOutOf`). Objects placed beside streets go
through `CityScene._clearSpot` (true distance to the route's road, every street's carriageway, building footprints).

## Rendering performance (perf-test)

How the stylized scenes are drawn, for anyone adding scenery:

- **Frame pipeline** (`js/world/post.js`): every stylized scene renders into an offscreen target with its own
  MSAA (`samples` per detail level) and a 32-bit float depth buffer, so the renderer uses a **reversed depth
  buffer** (EXT_clip_control) instead of the logarithmic one. The logarithmic buffer wrote depth per pixel,
  which stopped the GPU skipping hidden pixels. Non-hero scenes draw exactly as before (8-bit, tone-mapped by
  the materials); hero scenes (`post: true`) keep the HDR target, bloom, grade and vignette. Custom shaders
  keep their `logdepthbuf` includes: they do nothing unless the fallback is in use.
- **Pooled scenery** (`js/world/pools.js`): ground patches share one mesh per 4.6 km block, and plants
  share one `InstancedMesh` per kind and 30° sector around the camera (split again at 400 m), instead of a
  mesh per tile. Tiles still exist as unrendered stand-ins (`terrain.patches`, `terrain.streamedGroups()`)
  for the QC tools. Pooled meshes are tagged `userData.pooled`.
- **Streaming in a time budget**: ground, plants, ground cover, forest and tree-card tiles are built as
  resumable jobs, nearest first, within `buildMs` per frame (COASTAL_QUALITY), and each layer swaps in only
  once all its wanted tiles are ready (no gaps). Calling `terrain.update(x, z)` without a budget builds
  everything at once (the tools do this).
- **Ground cover** streams in 96 m tiles within 220 m of the camera: full density to 110 m, half beyond
  (the same half at any time).
- **Tree cards**: beyond the real trees (outside forest-canopy and city scenes), each tree is one
  camera-facing silhouette, out to `farTreeM` (or to the real-horizon hand-off).
- **Shadows**: the shadow box moves in whole texels (no shimmer) and the map is redrawn when it moves, or
  every other frame. Only trees and rocks within ~260 m cast. Tools that render a single frame set
  `renderer.shadowMap.needsUpdate = true` first.
- **Water**: the sea and opaque lakes draw after the land (`renderOrder = 1`), so hidden water is never
  shaded; authored coastlines are a lookup texture, not a loop per pixel.

- **Baked lighting** (`js/world/baked-light.js`, scene `"lighting": { "baked": "golden" }`): the sun stays at
  the baked time (night still works); once the static scenery has streamed in, the GPU bakes a top-down
  sun-shadow height map and ambient occlusion for the whole route in a few slices, and the live shadow map
  keeps only moving things in a small box round the rider. Opt-in per scene; how-to, keys and costs in
  `docs/pittsburgh/detail/s1.md`. Streamed detail that comes and goes with the camera sets
  `userData.bake = false`; moving meshes set `userData.dynamic = true` (or use `DynamicDrawUsage`).
- **Riverfront promenades** (`js/world/riverfront.js`, scene `"riverfront": { "spans": [{ "fromM", "toM" }] }`):
  where the route runs beside a river, a smoothed river wall with a walk, railing and benches replaces the
  map's sawtooth bank (the ground past the wall goes under the water); optional `"waterSteps"`.
