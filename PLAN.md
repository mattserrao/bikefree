# bikefree — Plan

A free indoor biking app for Mac. Runs as a web app in Chrome and talks directly to the trainer and handlebars over Bluetooth (Web Bluetooth). No accounts, no subscription.

## Hardware

- **Zwift Ride** smart frame and handlebars
- **Wahoo KICKR CORE 2** (Zwift Ride version) with a Zwift Cog — single gear, so virtual shifting is required

## How it connects

| Device | Protocol | Notes |
|---|---|---|
| KICKR CORE 2 | Bluetooth FTMS (`0x1826`), open standard | Read power, cadence, speed. Control resistance with SIM (grade) or ERG (target watts). |
| Zwift Ride handlebars | Zwift controller protocol (`0xFC82` / `00000001-19CA-…`), reverse-engineered | Write `RideOn` to start; button presses arrive as protobuf messages. Reference: [BikeControl](https://github.com/jonasbark/swiftcontrol) (MIT). |

### Known risk: Zwift Ride firmware lock

- **Ride V1 (firmware ≤ 1.2.x):** a plain `RideOn` handshake works.
- **Ride V2 (firmware 1.3+):** Zwift locks the controller service. It must be "unlocked" by connecting it in the Zwift app (free account is enough) about once every 24 hours, then fully closing Zwift.
- v0.1 reads the firmware version and tells you which case you're in.
- **Don't update the handlebar firmware** in Zwift Companion unless we've checked it's safe.

## Versions

### v0.1 — Connect and test *(branch `v0.1-test`)* ✅
**Goal:** prove Chrome on the Mac can talk to both devices.
- [x] Connect to KICKR CORE 2; show live power, cadence, speed
- [x] Take FTMS control; set ERG target watts and SIM grade from test controls
- [x] Connect to Zwift Ride handlebars; read firmware version; complete `RideOn` handshake (fw 1.2.0, V1)
- [x] Log every button press (named) plus raw bytes for debugging
- **Done when:** you can pedal, see numbers, feel resistance change, and see button presses in the log

### v0.2 — Virtual shifting + dashboard *(branch `v0.2`)* ✅
**Goal:** a usable free ride.
- [x] 24 virtual gears; left hood buttons/paddle = easier, right = harder; handlebar buzz on shift
- [x] Two shifting methods (Settings → Shifting method):
  - ERG (default): trainer holds the watts for your cadence × gear on the current grade
  - SIM (experimental): grade sent to the trainer is scaled by virtual ÷ real gear ratio (real ratio auto-estimated)
- [x] Big dashboard tiles: power, 3s power, cadence, gear, speed, time, distance, avg power, climbed
- [x] Virtual speed/distance from a rider + bike physics model (weights in Settings); coasting handled
- [x] Grade control: slider, −/+ buttons, D-pad ▲▼, arrow keys
- [x] Auto-start when you pedal, auto-pause when stopped; A button / Space to start or pause
- [x] Auto-reconnect if a device drops (retries for about a minute)
- [x] Difficulty % setting; settings saved in the browser
- [x] On-bike check: 30-minute ride; pick ERG or SIM; tune gear ratios and difficulty — confirmed working
- **Done when:** a 30-minute ride feels natural with shifting

### v0.3 — Save rides *(branch `v0.5`)* ✅
**Goal:** keep a record of every ride.
- [x] Record 1-second samples (power, cadence, speed, distance, altitude, HR, grade, position on routes)
- [x] Export `.fit` file (verified with Garmin's FIT SDK decoder); upload to Strava/Garmin manually
- [x] Heart-rate strap support (direct Bluetooth), or HR relayed by the trainer (KICKR Bridge)
- [x] Finish ride → summary (time, distance, avg/normalized/max power, cadence, speed, climb, kJ, HR) and lap table
- [x] Laps: Lap button, Y button or `L`; automatic laps on workout steps and ride-type changes
- [x] Ride history (saved in the browser) with re-download and delete
- [x] Crash recovery: in-progress ride autosaved every 15 s and offered back on reload
- [x] On-bike check: upload a real ride to Strava and confirm the data — confirmed working
- **Done when:** a ride uploads to Strava with correct data

### v0.4 — GPX routes *(branch `v0.5`)* ✅
**Goal:** ride real roads with terrain-based resistance.
- [x] Load a `.gpx` file (tracks or routes); resample every 10 m; smooth elevation; grade along the route
- [x] Distance moves you along the route; trainer resistance follows the grade
- [x] Elevation profile coloured by grade with position marker; route outline; grade now, next ½ mi, to go, climb left, % done
- [x] Route position, altitude and grade in the `.fit` export (shows as a Virtual Ride with a map on Strava)
- [x] Routes saved in your library; built-in "Demo Hills" route for testing
- [x] Finishing a route opens the ride summary (or keep riding)
- [x] On-bike check: a known local climb feels right — confirmed working
- **Done when:** a known local climb feels right

### v0.5 — Structured workouts *(branch `v0.5`)* ✅
**Goal:** follow interval workouts in ERG mode.
- [x] Import `.zwo` (Zwift), `.erg` (watts) and `.mrc` (% FTP) files; saved in your library
- [x] Four built-in workouts (Endurance 45, Sweet Spot 3×10, VO2 Max 5×3, Quick Spin 20)
- [x] FTP setting; trainer holds each step's target in ERG; ramps follow smoothly
- [x] Free-ride steps (and after the workout ends) go back to virtual shifting
- [x] Workout chart coloured by zone with progress; target, step time left, next step, time left
- [x] Intensity −/+ 5% (D-pad ▲▼, arrow keys); skip step (D-pad ▶); handlebar buzz on each new step
- [x] One lap per workout step in the `.fit` file
- [x] On-bike check: complete a built-in workout end to end — confirmed working
- **Done when:** a full workout runs cleanly and the laps show up on Strava

### v0.6 — National park loops in 3D (three.js) *(branch `v0.6`)* ✅
**Goal:** ride four real national park loops in a 3D world built from real terrain and aerial photos, lapping as long as you like.

**The four loops** (closed loops on real roads; built by `tools/build_park_routes.py`)

| Loop | Park | Distance | Climbing | Feel |
|---|---|---|---|---|
| Yosemite Valley Loop (Northside + Southside Drives) | Yosemite, CA | 12.8 mi | ~500 ft | Easy, flat valley floor under El Capitan |
| Acadia Park Loop Road (the loop itself, without the Hulls Cove access road) | Acadia, ME | 20.1 mi | ~1,650 ft | Moderate, rolling coast: Sand Beach, Thunder Hole, Jordan Pond |
| Grand Teton Loop: US-89/191 + Teton Park Road | Grand Teton, WY | 44.6 mi | ~1,350 ft | Long, rolling, the Teton Range beside you |
| Crater Lake Rim Drive (counterclockwise) | Crater Lake, OR | 31.9 mi | ~3,900 ft | Hard, high-altitude rim around the caldera |

- [x] Routed on real roads with BRouter (OpenStreetMap), one-way roads respected, automatic removal of out-and-back spurs; elevation sampled from the same terrain tiles the 3D world uses
- [x] Distances checked against published figures (e.g. Crater Lake 31.9 mi / 3,913 ft vs 31.9 mi / 3,916 ft on Komoot)

**Endless laps**
- [x] Detect closed loops (start and end within 150 m); close any small gap
- [x] Wrap-around elevation smoothing and grade: no bump at the start/finish line
- [x] Ride on into lap 2, 3, …; distance and climbing keep adding up; handlebar buzz at each new lap
- [x] Lap counter in route stats and the 3D overlay; one `.fit` lap per loop lap

**3D world (three.js, vendored — no build step)**
- [x] Streaming terrain quadtree from AWS Terrain Tiles; detail increases near the rider; distant mountains stay visible
- [x] Ground texture from USGS National Map aerial imagery (NAIP); lakes and ocean show as they do from the air
- [x] Road ribbon with lane markings; terrain levelled under the road so it always sits on the ground
- [x] Low-poly trees placed where the aerial photo shows forest (not on the road, not in sagebrush or water)
- [x] Sky with sun and distance haze; morning, midday and golden-hour presets
- [x] Chase, rider's-eye and drone cameras (C to cycle); smooth movement between data updates; pedalling animated by cadence
- [x] Stats overlay (power, cadence, speed, gear, grade, lap, lap to go, time, HR); full screen (F)
- [x] Preview fly-along before you start riding; any GPX route can also be viewed in 3D
- [x] Attribution for imagery, elevation and map data
- [x] Offline "Save for offline" per route (done in v0.7)
- [x] Reflective lakes and sea; broadleaf trees for Acadia (done in v0.7; water detected from the elevation data + imagery rather than OpenStreetMap)
- [x] On-bike check: ride Grand Teton for an hour, lap after lap — confirmed working
- **Done when:** you can ride Grand Teton for an hour, lap after lap, and it looks and feels like being there

**Dev tools:** `tools/build_park_routes.py` rebuilds the park GPX files; `tools/world-preview.html?park=teton&pos=12000&cam=drone&time=golden&speed=10` previews the 3D world without a trainer.

### v0.7 — Polish: power meter, better ground, real rider, offline *(branch `v0.7`)*
**Goal:** make the 3D ride look and feel finished.

**Power meter (full screen and windowed 3D view)**
- [x] Zone-coloured gauge (Z1–Z6 from your FTP) with 3 s power fill, live needle and trainer target marker
- [x] Big watts, zone, % FTP, W/kg, 3 s / average / target; gear strip under the gauge
- [x] Full screen hides the controls bar and scales the overlay up

**Ground**
- [x] Colour grading of the aerial photos (saturation, contrast, warmth)
- [x] Close-up detail texture so the ground isn't a smear near the camera; rockier look on steep slopes
- [x] Reflective water with ripples and sun glints (lakes are flat in the elevation data; the sea is 0 m)
- [x] Gravel shoulders that fade into the ground
- [x] Ground cover along the road from the photo: grass tufts, sagebrush/shrubs, the odd rock
- [x] Broadleaf trees (mostly in Acadia) alongside conifers

**Rider (modelled in Blender)**
- [x] Cyclist + road bike built in Blender (`tools/build_rider.py`): forward riding position, hands on the hoods, kit, helmet, glasses, shoes; deep-rim wheels, drop bars, saddle
- [x] Separate parts so wheels and crank spin and the legs follow the pedals (two-bone IK with ankling); soft shadow under the bike
- [x] Side camera (C cycles chase → rider's eye → side → drone)
- [x] Blender scene saved as `~/bikefree-export/rider.blend` for further editing; re-export with the script

**Offline**
- [x] "Save for offline" on any route: downloads exactly the terrain/imagery tiles the 3D view uses (Yosemite ≈ 50 MB, Grand Teton ≈ 150 MB)
- [x] Service worker serves the app and saved tiles without internet

### v0.8 — Demo mode *(branch `v0.8`)*
Goal: try every feature without connecting a bike.
- [x] **Demo** button in the top right; banner explains it, **Exit demo** turns it off
- [x] Simulated trainer: the rider holds a constant **15 mph** whatever the grade or gear
- [x] Power follows the physics needed for 15 mph on the current grade (or the workout's ERG target); cadence follows the gear, so shifting is visible; heart rate drifts with effort
- [x] Works with free ride, routes, the 3D view (DEMO badge in the HUD), workouts, laps, pause, save and .fit export; demo rides are named "Demo · …"
- [x] Demo data is generated every session tick, so it never goes stale while the 3D view is busy
- [ ] On-bike check: demo off → trainer connects as before

### v0.9 — Simplify the UI *(branch `v0.9`)*
Goal: a calmer, two-screen app. UI audit by Claude Opus 5.5, with Claude Fable 5.2 as advisor; decisions confirmed by the owner.
- [x] **Menu** (setup): device cards, ride type cards (Free ride / Route / Workout) with one picker each, one **Start riding** button. Load / offline / remove tucked into a **⋯** menu
- [x] **Ride screen**: full window, 3D world behind every ride (routes ride the route; free rides and workouts roll a chosen park loop, or a plain dark background)
- [x] Small HUD, no duplicates: power + cadence + HR + gear in one bottom strip; time / distance / speed top left; grade + lap / to go (or workout step) top right; profile or workout chart along the bottom edge
- [x] Power dial removed → big 3-second number coloured by zone, thin zone bar, workout target marker
- [x] Pause screen: Resume, Finish, Lap, Skip step, Back to menu, and the controls cheat-sheet (replaces the hint paragraph)
- [x] Settings: everyday options up top (incl. camera and time of day); shifting method, difficulty, ratios, start gear and the diagnostics log under *Advanced*
- [x] Banners removed: Bluetooth / demo notes live in the Devices card; errors show as a short toast
- [x] Fixed: "Climbed" counted the jump to a route's starting elevation (3,600 ft in 12 s)
- [x] Fixed: pedalling on the menu after finishing started a new ride — rides now only auto-start from the ride screen
- [ ] On-bike check

### v0.9.1 — Modern layout and sizing *(branch `v0.9.1`)*
Goal: a cleaner, more modern look with information sized for reading from the bike.
- [x] Ride screen: time / distance / speed in one panel; grade panel with **next ½ mi**, lap and to go (or the workout step); grade coloured by steepness
- [x] Power 120–130 px with a bigger "W", a Z1–Z6 badge and a full-width six-segment zone bar (workout target as a tick); gear in white, hidden on ERG steps
- [x] Strip sits at the same height in every mode; label-free elevation profile / workout chart along the bottom with the stretch ahead highlighted
- [x] Status pills merged; loading shown as a thin bar on the top edge; route name fades in under the status pill; camera / pause buttons hide until the mouse moves
- [x] Menu: two columns — devices, ride type and picker on the left; a preview panel (map, profile or workout chart, key facts) with a full-width **Start** on the right
- [x] Route and scenery picture cards (route outlines) and a workout list with mini charts instead of dropdowns
- [x] Device cards with icons and state badges; ride-type cards with icons and a check; one icon set; Demo is a quiet toggle; Start is disabled until the trainer is connected
- [x] **Machine Manager colours**: the same role-named tokens as `mm-theme.css` — warm charcoal dark, off-white light; blue for interaction, amber for attention, greys for everything else; neutral off-white / near-black primary button; 6/10 px radii feel
- [x] **Light and dark modes**: Settings › Appearance — *System* (default, follows macOS live), *Light* or *Dark*; set before first paint so there's no flash (`js/theme.js`, adapted from `mm-theme.js`)
- [x] Ride-screen glass follows the theme (charcoal glass / white frosted glass); power-zone and grade colours kept, darkened on light panels so they stay readable; charts read their colours from the theme
- [ ] On-bike check

### v0.10 — Profiles *(branch `v0.10`)*
Goal: rider profiles that live in this browser and add up your riding.
- [x] Create a profile: name, height (ft/in or cm), weight, gender — first-run "Create your profile" card, profile button in the header (initials, name, rides · distance)
- [x] Profile weight drives the physics (rider weight moved out of Settings; bike weight stays)
- [x] Each saved ride is tagged with its rider; totals (rides, distance, time, climbing) are computed from saved rides, so deleting a ride keeps them right. Rides from before profiles count for the first rider
- [x] Several riders: switch, add or delete riders (not mid-ride); Rides history shows the active rider's rides with totals
- [x] Unit tests for profiles (`test/profiles.test.mjs`)
- [x] Version number shown faintly at the bottom right of the menu (`VERSION` in `js/app.js`)
- [ ] On-bike check

### v0.11 — Six new scenic routes *(branch `v0.11`)*
Goal: more places to ride, each a different kind of day.
- [x] **Monument Valley · Forrest Gump Point** — US-163 to the Valley visitor center, 16.4 mi each way, ~1,800 ft
- [x] **Big Sur · Bixby Bridge & Hurricane Point** — Highway 1, Carmel Highlands to Big Sur village, 20.5 mi each way, ~2,300 ft
- [x] **Going-to-the-Sun Road** — Lake McDonald Lodge to Logan Pass, 21 mi each way, ~3,400 ft (the big climb)
- [x] **Zion Canyon Scenic Drive** — visitor center to Temple of Sinawava, 7.9 mi each way, ~600 ft
- [x] **Overseas Highway · Seven Mile Bridge** — Marathon to Bahia Honda, 12.8 mi each way, flat
- [x] **Route 28 · Old Forge to Eighth Lake** — Fulton Chain of Lakes through Inlet, 17.8 mi each way, ~1,000 ft rolling
- [x] Out-and-back routes: the builder rides A → B → A so laps still work; the road is drawn once and the rider U-turns into the other lane at the far end
- [x] Road profiles cleaned of elevation-model artefacts: bridges filled (Bixby Creek), cliff spikes removed (Going-to-the-Sun hairpins, Zion canyon walls); sea-floor depths held above the water in the Keys
- [x] Demo speed slider, 5–100 mph (menu and ride screen; `,` / `.` keys step 5 mph) to audit routes quickly; demo power capped at 1,500 W
- [x] Route list renamed *Scenic routes — 3D*; the new routes also work as Scenery behind free rides and workouts; offline download works for all of them
- [ ] On-bike check

### v0.11.1 — Stylized scenery *(test branch `v0.11.1`)*
Art direction selected: **C — Stylized 3D**. Target: M4 MacBook Air.
- [x] Big Sur visual prototype: bundled sculpted coast, ocean, regional vegetation, road detail and a Blender-built Bixby-inspired bridge
- [x] Reusable Blender kit and shared app/preview route loader
- [x] GPX + catalog preparation workflow; strict XML, geometry and metadata checks; generated offline manifest
- [x] Fix malformed GPX metadata and out-and-back heading cancellation at the lap seam
- [x] Extend offline planning tests to every scenic route
- [x] Big Sur feedback received; richer artistic scenery and rollout to all other maps authorized
- [x] Regional scenery for the remaining nine scenic routes
- [x] Light / Balanced / High scenery settings, distant tree detail levels, and dense close vegetation
- [x] Big Sur detail pass: ground and water shaders, cast shadows, fitted bridge deck/curbs, signs, reflectors, viewpoint, and expanded coastal kit
- [ ] Adaptive graphics and sustained performance check on M4 Air
- [x] Browser previews for all ten routes, offline reload, app demo and settings persistence
- [ ] On-bike Bluetooth validation and sustained M4 Air performance measurement

### v0.11.2 — Real horizon behind the stylized scenery *(test branch `v0.11.2`)*
Goal: blend the two approaches — Codex's stylized scenery up close, the real landscape in the distance.
- [x] Real elevation + aerial photos beyond **~1.5 km** on all ten scenic routes (e.g. the real Monument Valley mesas, Glacier peaks, the Big Sur coastline), colour-matched to each route's palette; steep real faces painted in the route's rock colour, shaded sides lifted
- [x] Seamless hand-off: the stylized ground eases onto the (smoothed) real heights from ~0.5 km and dithers away over 1.3–1.7 km with the real terrain solid behind it — no step, no gaps; stylized stand-ins beyond the hand-off (formations, lakes) are hidden
- [x] Far terrain is cheap: no trees, detail capped at z14, nothing refined inside the hand-off ring, base tiles fetched first
- [x] Offline (or until the base tiles arrive): stylized all the way to the horizon, exactly as v0.11.1
- [x] Clouds: soft white billboards that travel with you (were grey shaded spheres that read as floating rocks)
- [x] Shadow type: `PCFSoftShadowMap` (removed from three.js) → `PCFShadowMap`, so no console warning
- [ ] Known, pre-existing: off-road vantage points on steep stylized ground show small steps between ground patches (not visible from the road)
- [ ] On-bike check and M4 Air smoothness

### v0.11.3 — FTP in profiles, FTP test, route direction *(test branch `v0.11.3`)*
- [x] **FTP per rider**: FTP moved from Settings into each profile (existing FTP carried over); workouts use the active rider's FTP
- [x] **FTP Test · 20 minutes** workout: warm-up, three openers, 20 minutes all-out in free mode (you pace with the gears), cool-down. The ride screen shows the running test average and the FTP it points to; the summary shows the result (95% of the 20-min average) with a one-tap *Save to my profile*
- [x] **Every route turns around at each end** and rides back, endlessly (loops alternate direction each lap); a lap is one full there-and-back from where you started
- [x] **Forward / Reverse** and **start / ⅓ in / ⅔ in** on the route preview (remembered); Reverse starts from the far end; the map and profile mark the start
- [x] U-turn into the other lane at both ends; tests for mirroring, start points and the FTP maths
- [ ] On-bike check

### v0.11.4 — Demo Hills fix *(test branch `v0.11.4`)*
- [x] Demo Hills rode through a deep trench: its invented hills (150–260 m) sit hundreds of metres below the real ground where the loop is placed (Vermont), so the real terrain was cut down to the road. It now has its own stylized scene (meadow and mixed woods) that shapes itself around the road, with the real horizon turned off (`"realHorizon": false`)
- [ ] On-bike check

### v0.11.5 — Virtual pacer *(test branch `v0.11.5`)*
- [x] **Pacer** selector under the ride preview (Off / 75 / 100 / 125 / 150 / 175 / 200 W), remembered between rides; **P** cycles it on the ride screen.
- [x] Works on every map: routes (follows the real grades), free ride and workouts (uses the same grade you ride, on the scenery loop).
- [x] Same physics as you (your weight and bike), stepped on the session clock; only moves while your ride is running, so it waits when you pause.
- [x] Starts 8 m ahead of you when the ride starts (or when you switch it on mid-ride); a resumed ride keeps its position.
- [x] Second copy of the Blender rider in a **yellow-and-black checkered jersey** (model-space checker shader) with yellow bike accents, a bike-width inside your line so you can ride alongside or pass.
- [x] HUD pill: "Pacer 150 W · 120 ft ahead / behind / alongside".
- [x] `js/pacer.js` + `test/pacer.test.mjs`.
### v0.11.6 — Course QC sweep *(test branch `v0.11.6`, on top of v0.11.5)*
Goal: a repeatable check that rides every course end to end and flags discontinuities.
- [x] `npm run qc` (`tools/qc_course.mjs`): rides each route every metre, out and back and across the lap seam, using the app's own route, rider-placement and scenery code; writes `tools/qc-report.html` (profile charts with flagged spans, findings table, preview links to each spot)
- [x] Checks: GPX spurs/zig-zags, gaps and elevation spikes; rider position, height and heading jumps; grade jolts, ±25 % clamps and grade/elevation mismatch; ground through the road, flooded road, floating road edges, ledges and walls beside the road, ground mesh too coarse for a carve; chase-camera hops
- [x] Rider and pacer placement moved to `js/world/pose.js`, shared by `world.js` and the QC sweep
- [x] Tests for the sweep on synthetic loops (clean, spur, spike, gap) and on the scenic routes
- [x] Fixed everything the first sweep found; every route now passes `npm run qc --strict` (no fails, no warnings), and `npm test` runs the sweep over the whole catalog:
  - **Spurs cut** from the GPX: Yosemite 2.99 km (190 m), Acadia 5.12 km (240 m) and 18.09 km (250 m), Crater Lake 21.13 km (200 m), Going-to-the-Sun 8.92 km (110 m, both legs). The route builder now catches short 30–400 m stubs too; `build_park_routes.py --prune-existing` applies it offline and moves signs, lookouts, roadside rails and the preview position to match
  - **Sideways jogs smoothed** where cuts met and at BRouter junction steps (Yosemite, Acadia, Crater Lake, Monument Valley, Going-to-the-Sun, Seven Mile, Route 28); new `path-jog` QC check
  - **Ground through the road** (Big Sur 15.78 km bridge end, and beside the old spurs): the ground now never rises above the road across an 8 m corridor, and the bridge carve-out fades over the last 12 m of deck instead of switching off
  - **Road edges floating** at bridge ends (Seven Mile 3.6 / 15.0 km, Zion 6.9 km): the ground meets the road where the deck starts
  - **Jagged river banks** beside the road (Snake River, Grand Teton 26–32 km and 47 km; Yosemite; Crater Lake): river channels ease out beside the road over 12–30 m with banks wide enough for the ground mesh
  - **Rider hop** at the Going-to-the-Sun lap seam: the U-turn lane drift now hands back to the road's own direction over 10 m (rider and pacer)
- [ ] On-bike check, especially the five routes whose GPX changed (each 0.1–0.5 km shorter)

### Route 28 rework *(test branch `route28-test`)*
Review: [docs/route28/REVIEW.md](docs/route28/REVIEW.md)
- [ ] Confirm the GPX follows Route 28 through Eagle Bay (not South Shore Road)
- [ ] Real lake shorelines from OSM (`lakes[].outline`) + `road-in-lake` QC check; fix Second Lake causeway and Eighth Lake turnaround
- [ ] Adirondack forest: white pine, spruce/fir, hemlock, maple, birch; forest-edge layout; canopy on far hills
- [ ] Forested hills as formations (Bald Mtn + fire tower, Black Bear, Seventh Lake Mtn)
- [ ] Towns and camps: Old Forge, Inlet, lakeside camps with docks
- [ ] Roadside props, darker lake water, morning mist / golden-hour preset
- [ ] On-bike check

### Later ideas
- Street-level photos alongside the 3D view (Panoramax / Mapillary)
- Route builder (click points → BRouter route → elevation)
- Sync your own ride video to a GPX
- Native trainer virtual shifting via Zwift Protocol (most realistic, most work)
- Ramp/FTP test with automatic FTP estimate

## Running it

Web Bluetooth needs Chrome and either `localhost` or HTTPS.

```sh
cd bikefree
python3 -m http.server 8000
# open http://localhost:8000 in Chrome
```

Close Zwift, Zwift Companion and the Wahoo app before connecting — they can hold the Bluetooth connections.
