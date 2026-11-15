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
