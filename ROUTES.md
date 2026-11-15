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

## Style-C scenery: Big Sur prototype

Big Sur's optional `scene` field points to `routes/scenes/bigsur.json`. The scene
defines a palette, an authored coastline, a seed, roadside barrier ranges and
landmarks with latitude/longitude coordinates. The GPX remains the source for
the road and riding profile. The surrounding landforms are an artistic
interpretation, **not surveyed terrain or a replacement elevation dataset**.

The renderer builds nearby terrain at finer resolution, instances repeated
vegetation, and uses bundled models. Big Sur makes no elevation or imagery
service requests. Other scenic routes retain their existing terrain renderer
until the Big Sur art direction has been reviewed. Further regions need their
own landform presets and assets; copying this coastline is not a forest, desert
or alpine scene authoring workflow.

Rebuild the original Blender coastal kit without third-party assets:

```sh
blender --background --python tools/build_coastal_assets.py
npm run routes:build
```

The kit exports to `models/scenery/coastal.json`. Source models use metres, Y up,
and +Z along the road; bridge decks sit at Y=0. The web renderer places the bridge
on the nearest outbound route sample and opens a canyon below its deck.

## Review a scene

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/tools/world-preview.html`. Use the position slider,
Ride/Pause, camera and lighting controls. Useful URLs:

- `?park=bigsur&pos=15420&cam=chase` — bridge approach.
- `?park=bigsur&pos=15670&cam=vista` — bridge structure and coast.
- `?park=bigsur&pos=17700&cam=chase&time=golden` — coast in warm light.
- `?park=bigsur&pos=15420&style=legacy` — previous renderer; needs tile services.

`clean=1` hides preview controls for captures. `speed=10` rides at 10 m/s. The
preview and main app use the same loader and renderer, including turnarounds.
The service worker caches the preview and scene after successful installation.

To share a standalone preview that opens directly in Chrome, without a server:

```sh
node tools/package_preview.mjs /tmp/bikefree-bigsur-v0.11.1.html
```

This packages the actual WebGL scene, GPX and animated rider into one HTML file.
It is a visual review artifact, not the Bluetooth trainer app. Sustained frame
rate, thermal behaviour and Bluetooth operation still need checking on the M4 Air.
