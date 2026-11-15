# bikefree
Indoor biking app for Mac. Enjoy $0 biking.

Runs in Chrome and connects directly to a Wahoo KICKR CORE 2 (Bluetooth FTMS) and Zwift Ride handlebars (Zwift controller protocol). See [PLAN.md](PLAN.md) for versions and goals.

## Run it

```sh
python3 -m http.server 8000
```

Open http://localhost:8000 in **Chrome** (Safari doesn't support Web Bluetooth). Quit Zwift, Zwift Companion and the Wahoo app first so they don't hold the Bluetooth connections.

## Riding

The app has two screens: a **menu** to set up, and a full-window **ride screen**.

1. **Devices** — tap Trainer, Handlebars and (optionally) Heart rate to pair.
2. **Ride type** — **Free ride** (you set the grade), **Route** (pick a card: ten scenic routes in 3D — four national-park loops plus six out-and-back classics — or your own GPX) or **Workout** (pick from the list; .zwo/.erg/.mrc). Free rides and workouts roll a park loop behind you — pick a *Scenery* card, or *None*.
3. The preview on the right shows the map, profile or workout chart. **Start riding** opens the ride screen full screen; the ride records as soon as you pedal.
4. On the bike: hoods **left = easier, right = harder** · ▲▼ grade or workout intensity · ▶ skip workout step · **A** pause · **Y** lap.
5. Pause (A, Space or the pause button) for **Resume** or **Finish ride** and a list of the controls (lap: Y / L, skip a workout step: ▶ / N). **Finish ride** → summary → *Save & download .fit* → upload at strava.com/upload/select.

Ride screen: power (3-second, coloured by zone, with a Z1–Z6 badge, a zone bar and the workout target) plus cadence, heart rate and gear along the bottom; time, distance and speed top left; grade (coloured by steepness), the next ½ mile, lap and distance to go — or the workout step — top right; the route profile or workout chart along the bottom edge.

Keyboard: ← → shift · ↑ ↓ grade/intensity · Space pause · L lap · N skip step · C camera · F full screen.

**Demo** (top right of the menu): try everything without a bike. The rider holds a steady speed — 15 mph to start, adjustable from 5 to 100 mph with the slider (menu or ride screen) or the `,` / `.` keys; power, cadence and heart rate are simulated. Demo rides are saved as "Demo · …".

**Profile** (top right): your name, height, weight and gender, plus your totals — rides, distance, riding time, climbing. Weight sets how hard climbs feel. Add riders for others in the house; each ride is saved to whoever rode it. Everything stays in this browser.

**Settings**: appearance (System — follows macOS — Light or Dark; colours match Machine Manager), units, weights, FTP, camera, time of day, scenery detail (Light / Balanced / High), handlebar buzz. *Advanced* holds the shifting method, difficulty, gear ratio, starting gear and the diagnostics log. A route's **⋯** menu has *Load GPX*, *Save for offline* and *Remove*. The ten scenic routes include their scenery in the app cache after the first successful online load; with internet, the real landscape (elevation and aerial photos) fills the distance beyond ~1.5 km. Custom GPX terrain uses separate downloads.

## Tests

```sh
npm install   # once, for the FIT decoder used in tests
npm test      # Node 18+
```

## Rebuilding the park routes and the rider

To add a GPX route, prepare the catalog, or rebuild the style-C regional scenery,
see [ROUTES.md](ROUTES.md). Route-by-route visual feedback is in
[SCENERY_REVIEW.md](SCENERY_REVIEW.md). `npm run routes:build` validates every catalog route
and generates the catalog and offline manifest; `npm run routes:check` verifies
that those generated files are current.

```sh
python3 tools/build_park_routes.py          # park GPX files (needs internet)
pip install bpy==5.2.3 && python3.11 tools/build_rider.py   # rider model → models/rider.json
```

The rider can also be built inside Blender: open `tools/build_rider.py` in the Text Editor and run it.

## Credits

3D world: [three.js](https://threejs.org) (MIT), elevation from [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/), aerial imagery from the USGS National Map (public domain), park routes routed with [BRouter](https://brouter.de) on OpenStreetMap data (© OpenStreetMap contributors, ODbL).

Zwift Ride protocol details come from [BikeControl](https://github.com/jonasbark/swiftcontrol) (MIT) and [ajchellew/zwiftplay](https://github.com/ajchellew/zwiftplay). Not affiliated with Zwift or Wahoo.
