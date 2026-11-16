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
  summits with `clouds` and `rain`. (Going-to-the-Sun now offers only clear, valley fog and clouds on the peaks.)
- **Distance:** see *Vista kit* below (Going-to-the-Sun uses all of it). `signs[].kind: "nps"` is the brown park sign.

## Vista kit: scenery that reads at a distance (any route)

`js/world/vista.js` is a set of opt-in pieces that make far terrain read as mountains, forest and air
instead of smooth colour ramps. A scene turns them on with a `vista` block; leave a part out and it's off.
None of them adds a draw call. Going-to-the-Sun is the first route to use it:

```json
"vista": {
  "rock":     { "ribs": 0.9, "ledges": 0.7, "scree": 0.6 },
  "snow":     { "gullies": 0.85, "ledges": 0.6 },
  "meadow":   { "mottle": 0.7 },
  "forest":   { "crowns": 0.85, "boost": 1.6 },
  "haze":     { "strength": 0.62, "rangeM": 5500, "falloffM": 900, "blue": 0.35 },
  "ridgeInk": { "strength": 0.35, "thresh": 0.22, "startM": 450 },
  "clouds":   { "count": 24, "minM": 6000, "maxM": 15000, "spanM": 1200 }
}
```

- **`rock`** (ground shader): gullies and spurs running down the fall line, on two fixed world-space
  projections so nothing swims. They bend the lighting, so the cartoon bands follow them. Also narrow,
  broken ledges along the contours, and pale loose rock in the gullies below the faces. Optional
  `ribWidthM`, `ribLengthM`, `reliefM` and `ledgeM` (defaults 30, 170, 22 and 30). The ground far off is
  built coarser, so it's steepened with distance before deciding what's a face.
- **`snow`**: snow held in the gullies and on the ledges around `snowLineM`. North faces keep more.
- **`meadow`**: shrub patches and a slow yellow-green to blue-green drift on open slopes. Uses
  `palette.shrub`, and `palette.scree` for the loose rock.
- **`forest`** (forest-edge scenes): the canopy beyond the real trees is drawn as crowns lit on the sun
  side, which fade to their average colour once they're a few pixels. `boost` makes partial cover read
  denser.
- **`haze`** (`haze.js`, the shared fog chunk): aerial perspective. Distance fades toward a pale sky blue
  (the horizon colour moved `blue` of the way to the zenith), thicker in the low air than on the tops
  (`falloffM` above `baseM`, default the route's lowest point), so each ridge separates from the one behind.
- **`ridgeInk`** (`post.js`'s final pass): a soft line in the ridge's own colour, darker, where one ridge
  stands in front of another, from `startM` out. Works with or without the cartoon `look`.
- **`clouds`**: cartoon cumulus (four flat-bottomed shapes in one texture, lit tops, cool bases) in place of
  the soft cloud ring, lower and closer so they sit among the peaks. Still one draw call.

Every detail fades to its average once it's smaller than about two pixels, so nothing shimmers far off.
The rock work is skipped on flat ground.

**Forest additions** (`forest.js`, used with the vista kit but separate from it):
- `vegetation.tierKeep: [near, mid, far]` keeps more of the stand in the outer tiers. The default is
  `[1, .62, .4]`; Going-to-the-Sun uses `[1, .66, .5]`.
- `vegetation.windows: { everyM, lengthM, reachM, downhill, downhillM, keep }` opens a gap in the trees
  every `everyM` or so, each a little different. A gap clears the trees between the road and a lake
  (`shore + road distance < reachM`). With `downhill`, it also clears the low side of the road, within
  `downhillM`. `keep` is the share of trees left standing.
  `windowAt(sM, windows, seed)` lists where the gaps fall.

## Road surface and stonework (any route)

**Road surface** (`js/world/road-surface.js`): the road changes with the place and its condition. A scene's
`road` block names the default kind, and zones override it (later zones win, with 40 m blends at the ends):

```json
"road": {
  "surface": "worn",
  "zones": [
    { "fromM": 0, "toM": 2200, "surface": "fresh" },
    { "fromM": 41380, "toM": 41620, "surface": "alpine", "wet": 1 },
    { "fromM": 50200, "toM": 56500, "surface": "patched", "runoff": 0.35 }
  ]
}
```

- **Kinds:** `fresh`, `worn`, `chipseal`, `alpine`, `patched` and `tunnel`.
- **What the shader draws:** a darker fresh overlay or a bleached old one, polished wheel tracks, patches with sealed seams, sealed cracks (crossing and along the joints), chip-seal grain, crumbling and dusty edges, faded paint, snowmelt crossing the road, and tunnel grime.
- **Overrides:** any of `tone`, `warm`, `wear`, `patches`, `cracks`, `edge`, `fade`, `speckle`, `runoff` and `grime` can be set in a zone.
- **Variety:** each ~300 m also varies a little within its zone.
- **Limits:** up to 24 zones. Distances are along the road (on an out-and-back, the outbound half).

The rain preset's wet road is added on top of this.

**Look-only settings for a zone:** the road's geometry, lanes and traffic stay as they are.
- `pavedM` is the paved width. The rest of the 7 m strip becomes a gravel shoulder with a ragged paving edge, and the edge lines are repainted inside it.
- `centre` sets the centre line: 1 is painted, 0.4 is faded and broken, and 0 is none.
- `gravel` spreads loose gravel over the lanes in patches.

**Stonework** (`js/world/stonework.js`):
- `makeMasonryMaterial({ stones, mortar, courseM, moss, mossM })` draws rubble masonry from world position: wavy courses, stones of mixed length and colour, recessed joints, weather streaks, and moss at the foot.
- Because the pattern comes from world position, it doesn't stretch with the box it's on, and it carries on from one segment to the next.
- `makeParapetGeometry()` is a unit parapet with battered sides and a rounded cap.

Going-to-the-Sun's guardwalls use both:
- They're knee-high, with a rounded cap and regular openings.
- Each one follows the road's grade.
- A masonry footing runs down to the ground where the slope falls away.
- They're grouped into 1.5 km stretches, and stretches past 2 km are hidden.
- `glacier.guardwalls` takes `segmentM`, `openingM`, `stones` and `mortar`.

## Life along the road (any route)

- **Verge** (`js/world/verge.js`, the scene's `verge` block):
  - mile or kilometre markers (`markers.units`)
  - tall snow poles (`poles` ranges)
  - white delineators (`posts` ranges)
  - fallen rock on the shoulder and the bench below the deeper road cuts (`debris` ranges)
  - Grouped per 1.5 km and hidden past `reachM`.
- **Visitors** (`js/world/visitors.js`, the `visitors` block):
  - People stand or slowly stroll at `spots`: a `site` by name, or `{ atM, side, lateralM, radiusM }`.
  - `lookouts: n` puts n people at each overlook.
  - `walking` is the share who stroll.
  - One animated instanced mesh. Half as many people on Light.
- **Traffic mix:** `traffic.mix` sets each kind's weight. It can add `jammer` (Glacier's Red Jammer tour buses). Jammers also park at overlooks.
- **Streams** (`streams: [{ name, fromM, toM, widthM, minRoadM, searchM }]`, real-terrain scenes): a creek along a valley floor beside the road, found by taking the lowest ground to one side and registered like the bridge creeks, so it carves a channel, keeps trees out and is drawn. All creeks show white water where they drop quickly.
- **Burns** (`burns: [{ lat, lon, lengthM, widthM, angle }]`, real-mountain): old fire scars.
  - silver snags, young lodgepole and fireweed
  - grey-green ground with pink drifts
  - a thinned, silver distant canopy
  - Needs the vista kit for the ground tint (`palette.burn`, `palette.fireweed`).
- **Road cuts** (`vista.rock.cuts`): the blasted face above the road, found from how far the ground was cut down for the road, with seeps staining it dark (`palette.cutRock`).
- **Glacier extras** (`glacier`):
  - `culverts: { fromM, toM, minDepthM, maxCount }`: masonry headwalls where gullies reach the road, cascades down the steep ones and a spill below.
  - `waterfalls[].overRoad`: Weeping Wall strands arcing onto the near lane.
- **Wildlife set pieces** (`life.moments`): `{ kind: goat|bighorn|marmot, atM, count, where: uphill|valley|shoulder|wall, lateralM, spacingM }` puts animals where the chase camera sees them. `wall` sits them on the guardwall.
- **View windows:** `vegetation.windows.at: [metres]` opens the trees at the real viewpoints, toward the lake and down the valley, over `atLengthM`. Random windows stay toward the lake only when `downhill` is false.

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
- `preview`: `positionM` sets a useful initial review spot (the view is always the chase camera).
- `look`: `"gentle"` or `"bold"` lays the cartoon look over the scenery (`js/world/look.js`: toon bands, colour grade,
  smooth crowns, flat road, ink outlines drawn in `post.js`'s final pass). Route 28 uses `"gentle"` with
  `"timeOfDay": "midday"`. Preview `?look=none|gentle|bold`, snapshot tags `:current`, `:gentle`, `:bold`.

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
route picker, Ride/Pause and lighting controls. Useful URLs:

- `?park=bigsur&pos=15420` — bridge approach.
- `?park=bigsur&pos=17700&time=golden` — coast in warm light.
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
npm run snap -- route28@10650 route28@19050:morning route28@16200 pittsburgh
npm run snap -- --quality high bigsur@21800:golden route28@24450:fall
```

A shot is `<park>[@metres][:time][:season][:weather]`, always from the chase camera:
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

Retired with the scenic (`vista`) camera on 16 Nov 2026: the chase camera is now the only view.
A scene's `views` (Pittsburgh's postcard positions) are still in its JSON but nothing reads them; use
`snap:cam` for close-ups of landmarks.
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

