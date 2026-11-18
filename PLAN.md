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

### v0.12 — Pittsburgh · Three Rivers Loop, a living city *(test branch `v0.12`, on top of v0.11.6)*
Goal: the first city course — a loop full of life: riverside trails, famous bridges, downtown, the South Side and the climb up Mount Washington.
- [x] **The loop** (18.3 km / 11.4 mi, ~185 m / 610 ft climbing; clockwise from the North Shore Water Steps): General Robinson and Federal Streets → **Roberto Clemente Bridge** → the Allegheny riverfront trail under the Fort Duquesne Bridge → **Point State Park** promenades and the fountain → the Mon Wharf → Market Street past PPG Place → **Market Square** → Forbes → Smithfield Street → **Smithfield Street Bridge** → Station Square → **East Carson Street** to SouthSide Works → South Side riverfront trail → South 10th → **P.J. McArdle Roadway** climb → **Grandview Avenue** overlooks past the Duquesne Incline → Greenleaf Street descent → West Carson → **West End Bridge** → North Shore Trail past the Science Center and USS Requin
- [x] `tools/build_city.py` + `tools/city/pittsburgh.json`: routes on our own OSM street/trail graph (legs prefer trails, roads or park paths; one ramp link where OSM has a gap), folds waypoint stubs, terrain-tile elevation with bridge decks interpolated, rideable profile; writes the GPX and `routes/scenes/pittsburgh-city.json` (height grid, land use incl. the three rivers, 12k buildings with heights, streets, bridge decks, rail lines, trees)
- [x] New scene type `authored-city` (`js/world/toolbox/city/landscape.js`, `city.js`, `city-bridges.js`, `city-life.js`): real terrain (the Mount Washington bluff), carved rivers with their own water, buildings with procedural windows, PPG Place spires, the Gulf Tower top, streets with sidewalks, lamps and street trees, shop awnings and signs on East Carson
- [x] **Bridges in their own styles**: the Three Sisters' gold self-anchored suspension, Smithfield's blue lenticular trusses and buff portals, the gold through-arches of the West End and Fort Duquesne, Fort Pitt's double-deck tied arch, the Liberty, 10th Street, Hot Metal and Birmingham bridges
- [x] **Life**: walkers, joggers and people gathered at Market Square, the Point, Station Square, Carson Street and the overlooks; cyclists on the trails; cars and buses on the streets (oncoming traffic on the route's own streets, kept off the rider's lane); light-rail trains and a freight train; both **inclines** running; barges, the riverboat, motorboats with wakes and kayaks; gulls over the rivers; the Point fountain's jet; PNC Park and Acrisure Stadium
- [x] **Night** time of day (all routes): moon, stars and a city glow on the horizon; in the city the windows, street lamps, bridge lights, stadium lights, aircraft beacons, the Gulf Tower beacon, car head/tail lights, shop signs and light on the rivers; a front light on the bike
- [x] Route surface follows the route: streets keep lane paint, trails and park paths get a plain surface; concrete sidewalks instead of gravel shoulders
- [x] Menu: **Scenery** renamed **Routes**; route lists (free ride, Route and the workout scenery picker) split into **In Progress** and **Rough Drafts** (`"stage": "draft"` in `routes/catalog.json`) — Rough Drafts: Overseas Highway, Route 28, Pittsburgh
- [x] Course QC (`npm run qc`) runs on the city; `test/city.test.mjs`
- [x] Merged main (v0.11.6 QC fixes, strict whole-catalog QC test): the city builder now rounds corners (2 m resample, smoothing that never strays more than 16 m from the mapped line and keeps the road 3 m clear of buildings), and the loop avoids the Point's switchback paths and the wharf switchback (two short ramp links). Pittsburgh: 0 fail, 0 warn
- [x] Fixed: other carriageways, ramps and bridge decks were drawn up to 4 m above the route's road (Point ramps, Smithfield, West End Bridge), hiding the rider's legs. Streets over or beside the route now stay just under it (no railings or lamp posts in the road); new QC check **street-over-road** (it found 16 spots before the fix, 0 after)
- [ ] On-bike check and M4 Air smoothness (Light / Balanced / High)

### Route 28 rework *(test branch `route28-test`)*
Review, plan and screenshots: [docs/route28/REVIEW.md](docs/route28/REVIEW.md) · listed under **Rough Drafts** (`"stage": "draft"`)
- [x] **Phase 0** — Rerouted on NY-28 through Eagle Bay (29.2 km each way); signs, lookout and towns re-placed
- [x] **Phase 1** — Real terrain + lakes baked from USGS elevation (`tools/build_scene_terrain.py`, `route28.terrain.bin`); lakes at their real levels and shorelines; QC `road-in-lake`, `lake-side`, `building-on-road`, `building-in-water`, `dock-on-land`
- [x] **Phase 2** — Procedural Adirondack kit (white pine, spruce, hemlock, maple, birch × 3 LODs); forest-edge layout ~180 trees/ha; nested tiers built a few per frame; canopy shell on far hills; smaller, local ground cover; lake view corridors
- [x] **Phase 3** — Per-scene fog, lake water shader (no surf, treeline reflection), morning/golden-hour mist, darker far tint
- [x] **Phase 4** — Old Forge, Eagle Bay, Inlet; ~70 lakeside camps with docks/boathouses/canoes; boats; poles + wires; mailboxes; guardrails; DEC + deer signs
- [x] **Phase 5** — Fall palette (`season: "fall"`, preview `&season=fall`)
- [ ] On-bike check on the M4 Air: frame rate on Balanced, tile-edge hitching, lake/horizon seams online
- [ ] Later: Bald Mountain fire tower, Old Forge landmarks, measured performance overlay
### v0.12.1 — Clipping & overlap QC, Pittsburgh cleaned up *(test branch `v0.12.1`, on top of v0.12 + the Route 28 rework)*
Goal: a second QC tool that looks for things drawn through each other, and a Pittsburgh with nothing in the rider's way.
- [x] **`npm run qc:clipping`** (`tools/qc_clipping.mjs` + `tools/qc-clipping.js`): opens a route's real 3D scene in headless Chrome, streams in every building, indexes all geometry (three-mesh-bvh) and checks the rider's body and the chase camera along the whole ride; trees, lamp posts and scattered scenery in streets or buildings; structures through buildings; overlapping buildings; flickering coplanar surfaces and grass over streets beside the route; a simulated ride with traffic, people, trains and boats. Report with pictures: `tools/qc-clipping-report.html`
- [x] Pittsburgh: **0 fails** (was 34). The rider and the chase camera no longer pass through overpass decks, ramps, bridge members and piers, rail beds or buildings: nothing is drawn in the space over the route's road up to 4.1 m (decks over the trail get thinner, piers stay off the route, members that pierce it are left out, buildings on the road aren't drawn)
- [x] Street trees, lamp posts and scattered rocks/shrubs no longer stand in streets, on sidewalks or in buildings (they were checked against the nearest route *point*, 10 m apart, and never against other streets): 266 + 303 → 0
- [x] The ground is graded to the city's streets (they are drawn level from side to side), so hillsides no longer cover them; crossing streets get their own heights; bridge decks have a top, so lamps on the edge stand on it
- [x] Buildings that a ramp, incline or raised railway runs through aren't drawn
- [x] Traffic, people and trains give way to the rider: they wait at the kerb (or before a level crossing) while the rider is near, and hurry across or step aside if already on the road — nothing passes through the rider in a full simulated ride (was 11)
- [ ] Left as accepted or for later: streets that pass under the route where it runs on an embankment disappear into it (no bridge in the data; 9 spots); flickering where some crossing streets meet (~40) and along a few river banks; lamp posts touching the Clemente Bridge's gold railing; traffic passing through traffic and people through posts (accepted as background life)
- [ ] On-bike check

### Big Sur hero map *(test branch `bigsur-test`, on top of v0.12; main merged in, with the snapshot and clipping QC tools)*
Goal: make Big Sur the showcase course — visually stunning, the one you open to show someone the app. A testbed for graphics, weather, traffic and realism that can later roll out to other maps.

**Baseline review (15 Nov 2026, preview renders at High)**
- Geography reads as rolling grassland beside a distant sea, not mountains dropping into the Pacific: the land is a synthetic heightfield (`js/world/toolbox/core/random.js`) that rises gently inland; no sea cliffs, coves or surf line
- Bixby Creek reads as a shallow green valley with a stray lagoon; the real gorge is deep, narrow and opens onto a beach right below the bridge
- Bridge: parapet posts and a large beige wall beside the deck look oversized; the arch is hard to see from the road
- Bright white patches beside the road at the overlook (15.2 km) and on the bridge (15.7 km), and a hard dark seam where the sea meets land — to confirm on the Mac (renders here use a software GPU)
- Trees and bushes floating above hillsides at golden hour and night (likely placed before the real far terrain arrives)
- Night: headlight is a flat disc; no surf glow, moon path on the sea, or distant car lights
- Nothing moves except the rider and pacer: no traffic, birds, surf, fog or wind

**Decisions (15 Nov 2026)**
- Landform: real high-resolution elevation for the route corridor, bundled for offline, stylized materials on top
- Art style: stylized but richer — keep the low-poly look; add real light, weather and motion
- Weather: marine layer fog, clouds with shadows, wind, and rain with a wet road
- Traffic: light and realistic — a car every 20–40 s each way, some RVs, motorcycles and cyclists; some pull into the overlooks

**Passes**
- [x] **Real landform** — `tools/build_terrain_grid.py` bakes AWS Terrain Tiles into `routes/scenes/bigsur-terrain.json` (1.7 MB gzipped): 10 m blocks within 900 m of the road, 40 m out to 9 km. The source fills the near-shore ocean with flat 0–3 m "land"; the builder turns that into a shelving sea floor (sea = low ground connected to the open ocean). `js/world/toolbox/landscape/real-terrain.js` presses the GPX road in, opens the real gorges under the bridges, traces the creeks down the real valley floors (Bixby, Rocky, Garrapata, Malpaso, Little Sur) and keeps a signed distance to the shore. The real horizon is off for Big Sur (its own grid reaches the horizon; the tile horizon showed the flat fill as a sand plain)
- [x] **Bridges** — `js/world/toolbox/structures/arch-bridges.js`: open-spandrel arches (Bixby 228 m over a 77 m gorge, Rocky Creek, Garrapata, and the canyon at 9.9 km) with twin ribs, spandrel columns and great piers on the real slopes; deck bridges elsewhere; open balustrade parapets you can see the sea through
- [x] **Vegetation from the ground** — golden grass on ridges and south faces, olive scrub on north faces, redwood / oak / pine in the canyons, cypress on the bluffs, sand by the sea
- [x] **Ocean** — shallows from the sea floor, kelp-dark patches, broken breakers rolling in to the real shoreline, swash, rocks along the true shore; dark at night
- [x] **Weather** (`js/world/toolbox/atmosphere/weather.js`, all stylized routes; Settings › Weather, **W** on the ride screen): *Clear*, *Marine layer* (fog bank on the sea, upper layers stop at the shore, the lowest creep up the canyons; ride into it and the air closes in; climb Hurricane Point and you're above it), *Clouds* (shadows drifting over the hills), *Rain* (streaks, grey light, wet road that picks up the sky); wind in grass, flowers and trees in every preset; changes ease in
- [x] **Traffic** (`js/world/toolbox/life/traffic.js`, scene option `traffic`): cars, SUVs, RVs, motorcycles and other cyclists both ways, ~4 a minute; they overtake when the other lane is clear and wait behind you when it isn't; a cyclist may sit on your wheel; some pull into the overlooks; parked cars at the overlooks; lights at night
- [x] **Life and landmarks** (`js/world/toolbox/life/coast-life.js`): pelicans gliding in lines along the shore, gulls over the cliffs, a condor over the ridges, cattle on the Point Sur terrace, Point Sur Lighthouse (lamp and turning beam at night); signs for Rocky Creek, Hurricane Point, Little Sur and Point Sur; a Hurricane Point overlook
- [x] **Rendering** (`js/world/toolbox/atmosphere/post.js`, scene option `post`): HDR render, soft bloom (sun glint, low sun, lamps), gentle grade and vignette; off on Light detail
- [x] Fix: the ground vanished for a frame when the real horizon arrived (the sea plane showed through as white — the "white patches" in the baseline review)
- [x] Course QC: Big Sur passes `--strict` (0 fail, 0 warn); `npm test` passes (96)
- [x] **QC pass (15 Nov 2026)** — merged main (Route 28, v0.12) plus the snapshot tool (`npm run snap`, from `route28-test`) and the clipping tool (`npm run qc:clipping`, from `v0.12.1`); ran all three on Big Sur and fixed every finding:
  - **Course QC** (`npm run qc -- --strict`): every route clean, including the four that failed on the v0.12 base (main already had their fixes). New checks `lookout-floating` / `lookout-buried` found the Bixby overlook pad 2.2 m above the ground at one corner and Going-to-the-Sun's Logan Pass pad tilting off the road's grade: overlook pads now follow the road in 4 m pieces, and Big Sur levels the ground under them
  - **Clipping QC** (`npm run qc:clipping -- bigsur`): it now simulates highway traffic and birds (not just city life) and treats the sea and creeks as water. It found cars and RVs overlapping each other, a camper passing through you, a car through the reflector posts at the Hurricane Point turnout, a gull through the Garrapata bridge, a rock in the Malpaso creek mouth and Rocky Creek's water ribbon folding over itself. Fixed: traffic keeps a hard gap to whatever is ahead in its path (you, cyclists, other cars, parked cars), overtakes abort for oncoming traffic, slower vehicles ahead of you move over to let you by, cars pull into free bays only, campers hug the centre line; no reflector posts across overlook entrances; gulls keep clear of bridges; no shore rocks in creek mouths; creek traces drop their loops. Now 0 fail, 0 warn
  - **Snapshots** (`npm run snap`, now with a weather tag and the app's post-processing): 12 fixed views (overlook, Bixby vista golden and marine layer, Hurricane Point, rain, clouds, Point Sur, night, Little Sur, Malpaso, Garrapata). The first run was over the triangle budget (up to 3.0 M at the Bixby vista, 2.2 M riding at Little Sur); Big Sur's vegetation is now 1.3× (was 1.6×) with fewer redwoods, shrubs and shore rocks, and distant (LOD) trees no longer cast shadows on any route. Now 250–450 draw calls and 0.8–1.9 M triangles per view
- [ ] On the Mac: frame rate on Balanced and High (post-processing, fog layers, traffic), the marine layer from the road, rain on the road
- [ ] On-bike check

### v0.12.2 — Performance overlay *(test branch `v0.12.2`)*
Goal: make the M4 Air checks measurable before the Pittsburgh hero work.
- [x] **I** on the ride screen (or `?perf=1` / **I** in the preview): fps, frame time (median, 95th percentile, worst in the last 10 s), draw calls and triangles summed over every render pass (post-processing included), drawing-buffer size and pixel ratio, detail level, time, weather and camera. Amber over budget, red at 1.5× over (budget: 600 draw calls, 2M triangles, 60 fps, no frame over 25 ms)
- [x] Closing it writes a one-line summary of the stretch to the log (average fps, frames over 25 ms, worst frame, peak draw calls and triangles), so a test ride leaves numbers behind
- [x] Offline manifest regenerated (it was stale on `main` after the Big Sur merge)
- [ ] **Mac test session** with the overlay, one checklist for every open on-bike item: trainer + handlebars with demo off (v0.8), virtual shifting and the FTP test (v0.11.3); one stylized route at Light/Balanced/High (v0.11.1–2); Route 28 on Balanced (tile edges, lake and horizon seams); Big Sur (marine layer, rain, traffic, post); Pittsburgh at Light/Balanced/High, day and night (v0.12–v0.12.1); Demo Hills (v0.11.4); one route whose GPX changed in v0.11.6. Paste the summary lines into this section

### Pittsburgh hero map *(test branch `pittsburgh-test`, from v0.12.2)*
Goal: give Pittsburgh the Big Sur treatment. The full plan is in the Project doc *open-items-and-pittsburgh-hero-plan*; the review with pictures is in `docs/pittsburgh/REVIEW.md`.

**Decisions (15 Nov 2026)**
- Default time: golden hour. Weather: river fog and clouds only (no rain or snow). Season: summer by default, fall as an option
- Route traffic: light, like Big Sur (about 4 a minute)
- Landmarks: the downtown towers, the Point (fountain, Blockhouse, confluence), the inclines and Grandview overlooks, and the stadiums as shapes only, with no logos
- The PR #14 leftovers fold into the phases: C2 → P3; C1, C4, C8 → P4; C3, C6 → P5; C5, C7 → P7

**Phases**
- [x] **P1 · Baseline** — 13 snapshots at golden hour, midday and night (`docs/pittsburgh/REVIEW.md`). 315–578 draw calls and 0.8–1.6 M triangles on Balanced; the hillside at 11.5 km is closest to the 600-call budget
- [ ] **P2 · Atmosphere and post**
  - [x] *Route's default* time of day (new default in Settings); Pittsburgh opens at golden hour, other routes at midday; a saved *Midday* moves to *Route's default* once
  - [x] River fog: the fog bank uses a distance-to-river field and the river level, about 30 m deep and thinner than Big Sur's, so the bridges and the city rise out of it. **W** and the scene only offer *Clear*, *River fog* and *Clouds*
  - [x] Post-processing on (bloom, grade, vignette; off on Light)
  - [ ] Per-scene distance fog so the skyline separates from the hills; Big Sur's moon path and headlight (D3) (night river reflections: done in P5)
  - [ ] Measure on the Mac with the **I** overlay (post + fog on Balanced and High)
- [x] **P3 · Real landform** (v0.13.1) — `routes/scenes/pittsburgh-terrain.json` from `tools/build_terrain_grid.py` (new inland "rivers" mode): 10 m near the route, 40 m to 9 km; the three rivers traced from the elevation to the edge of the world (second water surface beyond the city's box; the river fog follows them); banded sandstone on steep city ground. C2: the "buried streets" were low ramp decks beside the route — the ground no longer rises over a ramp deck; a guard adds girder spans for real underpasses (none on this route). Clipping QC 266 warnings (baseline 288), 0 fail; course QC clean
  - [ ] Left: the route's height on the Mount Washington crest (13.3–14.1 km) is 4–6 m above the bare ground
- [x] **P4 · Signature landmarks** (v0.13.3) — `js/world/toolbox/city/heroes.js`: U.S. Steel (triangle, Cor-Ten columns), BNY Mellon (crown, de-duplicated), Fifth Avenue Place (stepped lit crown, mast), the Gulf Tower (was missing; stepped pyramid lit as the weather beacon), the Grant Building's Morse beacon, faceted PPG Place; the Blockhouse, the Flag and Monongahela bastions in brick and the others traced in granite; four Grandview Avenue overlook decks; incline station decks and car colours; both stadiums (their outlines were lost in the data: now from the scene, with tiers, scoreboards and no trees on the field); postcard views for the scenic camera (scene `views`). C1 whole-member culling, C4 no street lamps on styled bridges, C8 duplicate footprints hidden. New `npm run snap:cam` (free-camera close-ups). Clipping QC 0 fail, 262 warnings
  - [ ] Left: the stadium outlines and the bastions are fitted, not surveyed (the OSM source isn't reachable from the build machine); rebuild the city data with real stadium outlines when it is
- [x] **P5 · Rivers** (v0.13.4) — the rivers flow (along-river distance fields, flow-mapped ripples and slick lines); the Allegheny green and the Mon brown, running side by side down the Ohio below the Point and blending slowly; golden-hour glint and sparkles; bank lights stretched across the water at night; river walls on the urban banks (ground steps down at the waterline). The map's bridge decks had cut the rivers at every bridge: water now closed across them. C3: level junctions + each road ribbon's height slot settles overlaps in the depth test; ground kept off the water's level — z-fight 45 → 11. C6: boats keep the whole hull over real water and steer round piers and low decks — boats on land 5 → 1. Clipping QC 0 fail, 235 warnings (baseline 288)
- [ ] **P6 · Vegetation** (wooded slopes, park lawns, street trees)
- [ ] **P7 · Traffic and life** (route traffic that overtakes and waits, buses, rowers; C5, C7)
- [ ] **P8 · Check and ship** (both QCs strict, snapshots against the baseline, the Mac check, move to In Progress, PR)

### v0.13.2 — Route 28 opens again *(test branch `v0.13.2`, on top of main / v0.13.1)*
- [x] Route 28 froze the browser for ~100 s after Start (looked like a hang). Building the lake water asked "is the road within 3.2 km?" for every lake cell using the 40 m road index (~26,000 grid lookups each). Now a coarse road index, with whole ~800 m chunks settled at once when clearly near or far. Same lakes (139 meshes, identical geometry); lake build 102.6 s → 0.06 s headless, Start → 3D view 103 s → 0.8 s
- [ ] On the Mac: Route 28 opens promptly

### Going-to-the-Sun hero map *(test branch `goingtothesun-test`, from `main` after PR #17)*
Goal: give Going-to-the-Sun Road the Big Sur / Pittsburgh hero treatment, over the whole road. Review with pictures: `docs/goingtothesun/REVIEW.md`. Listed under **Rough Drafts** until P8.

**Decisions (15 Nov 2026)**
- Route: the full road, **Apgar → St. Mary** and back (about 80 km each way; was Apgar → Logan Pass)
- Real landform: bundled real elevation (10 m near the road, 40 m to 9 km), real Lake McDonald and St. Mary Lake
- Default: **midsummer, golden hour** (snowbanks and waterfalls at the pass, beargrass and wildflowers); fall as an option
- Weather presets: **valley fog** on Lake McDonald, **clouds on the peaks** (with shadows), **rain and wet road**, **wildfire smoke haze**
- Landmarks, hand-built: Garden Wall, Weeping Wall and Triple Arches; West Side Tunnel (window galleries), East Side Tunnel and the Loop; Logan Pass (visitor center, snowfields) and the Jackson Glacier overlook; Lake McDonald Lodge, Sun Point, Rising Sun and Wild Goose Island. The 1930s stone guardwalls along the whole road
- Traffic: light (about 4 a minute), generic vehicles, like Big Sur
- Wildlife: mountain goats and bighorn sheep; marmots, pikas and ground squirrels; a distant grizzly or black bear; ravens, a golden eagle, ducks on the lakes

**Phases**
- [x] **P1 · Road** — GPX Apgar → St. Mary on the real road (75.5 km each way), profile re-fitted to the real ground (max 8.5%); course QC clean
- [x] **P2 · Baseline** — snapshots at fixed spots, `docs/goingtothesun/REVIEW.md`, second pass. 270–362 draw calls, 0.76–1.43 M triangles
- [x] **P3 · Real landform and lakes** — `goingtothesun-terrain.json` (build_terrain_grid.py new "lakes" mode: 10 m near the road, 40 m to 9 km, 86 lakes each at its own level); new `real-mountain` landscape; formation-banded cliffs and midsummer snowfields
  - [x] stone bridges at Baring Creek and Siyeh Creek; the Triple Arches
- [ ] **P4 · Atmosphere and weather**
  - [x] Golden hour by default (*Route's default*), post-processing on, distance fog 1.6–21 km
  - [x] **Valley fog**: the fog bank lies on Lake McDonald (962 m), 45 m deep, treetops and the road above it
  - [x] **Clouds on the peaks**: cloud caps on every summit above 2,200 m within 7 km (one draw call), drifting; low and grey in the rain; plus Big Sur's cloud shadows
  - [x] **Rain and wet road** (shared)
  - [x] **Wildfire smoke**: new preset (`smoke`): a red-orange sun, a brown sky, the far ridges gone in a 5 km haze; offered in `W`, the preview and `npm run snap` (`:smoke`)
  - [ ] Measure post + fog on the Air with the overlay
- [x] **P5 · Landmarks** (`js/world/toolbox/structures/mountain-road.js`): guardwalls, both tunnels, the Triple Arches, six waterfalls, Logan Pass Visitor Center and parking, Lake McDonald Lodge, Rising Sun, St. Mary, snowbanks, seven glaciers, Wild Goose Island, NPS signs and five overlooks
- [ ] **P6 · Vegetation**
  - [x] Glacier kit (`js/world/toolbox/packs/northern-rockies.js`) and zoned forest planner: cedar–hemlock west side, spruce–fir–larch slopes, treeline krummholz, aspen and lodgepole east; beargrass, paintbrush, glacier lilies, huckleberry, alder in the chutes
  - [x] tuned to the budget: 312–496 draw calls, 1.57–1.98 M triangles (overlook pads/rails/posts and sign supports now instanced, lakes in 2.4 km chunks, lighter near trees)
- [x] **P7 · Traffic and wildlife** (`js/world/toolbox/life/wildlife.js`): light traffic; goats, bighorn, marmots, ground squirrels, a grizzly, ducks, ravens, a golden eagle
- [ ] **P8 · Check and ship**
  - [x] `qc --strict` clean; clipping QC 0 fail (8 shoreline z-fight warnings accepted); snapshots against the baseline in REVIEW.md
  - [ ] Mac check with the `I` overlay at Light/Balanced/High, golden hour, midday and night; then move to In Progress and merge

### Route list cleanup *(test branch `routes-test`, from `main`)*
- [x] New **Deprecated** section (catalog `"stage": "deprecated"`): Grand Teton, Acadia, Seven Mile Bridge, Crater Lake, Monument Valley
- [x] Yosemite moved to **Rough Drafts**
- [x] New collapsible **Ideas** section at the bottom of the route list (`routes/ideas.json`): top 10 with notes, then 11–25
- [ ] Check on the Mac

### perf-test — Graphics performance and fidelity pass *(test branch `perf-test`, from `main` after PR #20; main merged in after #22)*
Goal: the 3D view was unoptimized. Cut GPU and CPU cost on every route, then spend some of the savings on looks. How it works: ROUTES.md → *Rendering performance*.

**Performance**
- [x] **P1 · Reversed depth buffer** instead of the logarithmic one (it wrote depth per pixel, so the GPU shaded every hidden pixel); every stylized scene renders through `post.js` into a target with a 32-bit float depth buffer. Non-hero scenes look exactly as before (pixel-compared)
- [x] **P2 · One anti-aliasing, not two**: no canvas MSAA when the scene has its own; samples per detail level
- [x] **P3 · No hitches at tile edges**: ground, plants, ground cover and forest tiles are resumable jobs built within `buildMs` a frame and swapped in whole
- [x] **P4 · Pooled scenery** (`pools.js`): ground patches share a mesh per 4.6 km block; plants an InstancedMesh per kind and sector around the camera (was a mesh per tile per kind)
- [x] **P5 · Shadows**: box moved in whole texels; map redrawn when it moves or every other frame; only trees and rocks within ~260 m cast
- [x] **P6 · Water**: sea and lakes drawn after the land (hidden water skipped); authored coastline as a lookup texture
- [x] **P7 · Acadia under budget**: ground cover in 96 m tiles within 220 m, half density past 110 m
- [x] **P8 · Clouds**: the 26 cloud sprites are one mesh
- [x] **P9 · Smaller terrain downloads**: `<id>-terrain.grid.bin.gz` (binary rows, gzipped) for Going-to-the-Sun 3.86 → 3.40 MB, Big Sur 1.67 → 1.43 MB, Pittsburgh 0.71 → 0.62 MB (gzipped sizes), no base64/JSON parse
- [x] **P10 · No per-frame allocations** in the camera, rider placement and fog bank

**Fidelity**
- [x] **F1 · Sharper Balanced**: 2× pixel ratio (was 1.5×), 2× MSAA
- [x] **F2 · Steady shadows** (P5's texel snapping)
- [x] **F3 · Tree cards**: beyond the real trees, one camera-facing silhouette per tree out to 1.6 km (Balanced) / 2.2 km (High); not in forest-canopy or city scenes
- [x] **F4 · Valley haze**: the fog thickens low in the valleys (strongest in the morning); `atmosphere.haze`, `hazeM`, `hazeBaseM`

**Measured** (headless software GPU, Balanced, each route's preview spot; draw calls · triangles, before → after)

| Route | Draw calls | Triangles |
|---|---|---|
| Yosemite | 337 → 214 | 1.46 → 1.68 M |
| Acadia | 360 → 202 | 2.10 → 1.78 M |
| Teton | 289 → 186 | 1.10 → 1.20 M |
| Crater Lake | 318 → 209 | 1.05 → 1.08 M |
| Monument Valley | 218 → 115 | 0.37 → 0.41 M |
| Zion | 248 → 158 | 0.38 → 0.46 M |
| Seven Mile Bridge | 200 → 107 | 0.20 → 0.24 M |
| Big Sur | 345 → 245 | 1.19 → 1.38 M |
| Going-to-the-Sun | 325 → 244 | 1.58 → 1.59 M |
| Route 28 | 396 → 275 | 0.94 → 1.01 M |
| Pittsburgh | 393 → 297 | 1.11 → 1.16 M |

Worst scenery-streaming frame over 600 m of riding (headless CPU, slower than the M4): Yosemite 409 → 17 ms, Acadia 291 → 12 ms, Route 28 272 → 19 ms, Going-to-the-Sun 153 → 25 ms, Pittsburgh 141 → 8 ms, Big Sur 67 → 15 ms. Triangles rise a little on most routes (tree cards; pooled plants cull by sector, not tile); they are off-screen vertices, cheap next to the draw calls saved. `npm test` 96/96, routes:check clean; Pittsburgh clipping QC 0 fail (127 warnings, was 128).

- [ ] **Mac check**: the `I` overlay at Light / Balanced / High on a few routes; GPU frame time can only be measured there (Balanced now renders at 2×: if it is over budget, set `balanced.pixelRatio` back to 1.5 in COASTAL_QUALITY)
### Route 28 lean cartoon *(test branch `route28-cartoon`, from `main`)*
Goal: cut graphical demand as far as possible while improving the feel. Style guide, Route 28 measurements and plan: the "bikefree style guide: lean cartoon (Route 28 pass)" doc (project doc `claude/lean-cartoon-style.md`). Baseline before perf-test: about 430 draw calls on Balanced (ground 87, far trees 69, lakes 67, mid trees 54); only 11–18% of the trees built are ever seen. After perf-test (#23): 275 at the preview spot, 354 in Old Forge.

**Decisions (16 Nov 2026)**
- One pre-rendered time of day per route (two may come later, not now)
- Side-by-side look test first (gentle vs bold) before rebuilding anything → **chosen: cartoon gentle at midday** (Route 28's one time of day)
- Outlines: a full-screen edge pass (the one post pass allowed)
- Rider: cartoon treatment, but with more triangles and better texturing than first proposed
- Chase camera only: drone, scenic, side and eye retired

**Passes**
- [x] Chase camera only: app, settings, HUD button, <kbd>C</kbd>, preview and snapshot tool
- [x] Look test: `?look=gentle|bold` in the preview, `:gentle` / `:bold` in `npm run snap` (`js/world/toolbox/atmosphere/look.js`: toon bands from direct sun with cool shadows, colour grade, smooth crowns, flat road, depth-edge outlines). New `afternoon` time (sun 24°) as a candidate signature time. Results: [docs/route28/look-test/](docs/route28/look-test/README.md)
- [x] Look chosen: gentle at midday. Route 28's scene has `"look": "gentle"` and `"timeOfDay": "midday"`; `?look=none` (preview) or `:current` (snap) shows the old look
- [x] Merged perf-test (#23): outlines moved into `post.js`'s final pass (reads the scene target's depth, reversed or logarithmic; no extra full-screen pass); the chase-only camera kept through its allocation-free camera and texel-snapped shadows
- [ ] 1. Tools and baseline: `perf:calls` (exact draw calls) and `qc:visibility` (ID-buffer test)
- [ ] 3. Quick wins: 2.4 km lake chunks with mist in the lake shader, far plane at the fog, single-sided ground, rider blob shadow (perf-test already did one cloud mesh, pooled ground per 4.6 km block, near-only shadow casters, water after land)
- [ ] 4. Trees in one `BatchedMesh`
- [ ] 5. Visibility bake: build only trees seen from the chase camera
- [ ] 6. Fixed light: toon material, pre-rendered tile shadows, baked AO, no shadow map
- [ ] 7. Cartoon kit, towns merged, sign atlas, ground rings, cartoon rider
- [ ] 8. Check and ship: under 80 calls on Balanced, M4 Air ride

### Going-to-the-Sun visual pass: vista kit *(test branch `goingtothesun-visual-test`, from `main` + `route28-cartoon`)*
Goal: at a distance the map looked flat and uninteresting, with mountain faces as smooth colour ramps and
bare peaks, evenly spread trees, and little depth. Make it immersive without making it more photorealistic,
in pieces other routes can reuse, and balanced against the graphics cost. Review with pictures:
[docs/goingtothesun/vista/](docs/goingtothesun/vista/README.md).

**Decisions (Matt, 16 Nov 2026)**
- Cartoon look, as on Route 28 (gentle), at **midday** (golden hour is gone as the default)
- Distance priorities: rock detail on the faces, snowfields, stronger depth haze, better sky and clouds
- Forest far off: denser, even cover. The valley gets occasional views to Lake McDonald and the peaks
- Believable but generic (not mapped rock bands and named snowfields)
- Portable: one kit, switched on per scene (`"vista"`)
- Budget: up to 450 draw calls on this hero route
- Fewer weather presets: kept clear, valley fog and clouds on the peaks; dropped rain and wildfire smoke
- No look test: build it directly

**Done**
- [x] Merged `route28-cartoon` (cartoon look, chase camera only). Going-to-the-Sun: `"look": "gentle"`,
  `"timeOfDay": "midday"`. The Glacier kit is built with smooth crowns in the cartoon look (`withSmooth`).
- [x] `js/world/toolbox/atmosphere/vista.js`, the vista kit: ground-shader rock (gullies and spurs, ledges, loose rock), snow
  in the gullies and on the ledges, meadow patches, the distant canopy as crowns, cartoon cumulus. Aerial
  perspective in the shared fog chunk (`haze.js`: `AERIAL`), ridge ink in `post.js`. ROUTES.md → *Vista kit*.
- [x] `forest.js`: `tierKeep` (denser outer tiers) and `windows` (gaps toward the lake and down the valley)
- [x] Going-to-the-Sun scene: `vista` block, `palette.scree` / `palette.shrub`, slightly muted grass and
  meadow, `forestDensity` 0.82, `tierKeep [1, .66, .5]`, windows every ~850 m
- [x] Checks: `npm test` 96/96; `qc --strict` clean; `routes:check` clean; clipping QC 0 fail, 8 shoreline
  z-fight warnings (unchanged); 231–353 draw calls and 1.59–2.09 M triangles headless (main: 230–357 and
  1.59–2.02 M)

- [x] Guardwalls reworked: rubble-masonry parapets (`js/world/toolbox/materials/stonework.js`), knee-high with a rounded cap
  and regular openings. They follow the grade, sit on masonry footings and are culled by stretch. Triangles
  went down: 1.48–1.90 M at the checked spots.
- [x] Road surface by area and condition (`js/world/toolbox/materials/road-surface.js`, the scene's `road` zones):
  - fresh at Apgar and on the east side
  - worn along Lake McDonald
  - chip seal up McDonald Creek
  - alpine (bleached, frost cracks, patches, snowmelt) from the Loop to Logan Pass, wet at the Weeping Wall
  - tunnel grime
  - patched on the east descent
  - The rain preset's wet road now chains onto it.

**Life and interest pass** (Matt, 16 Nov 2026)
Matt picked rock cuts, water, buses and people, roadside detail, a burn, wildlife set pieces and the real
viewpoints. Not picked: sound, camera feel, timber guardrail.

*Decisions*
- The road only looks narrower (no geometry change).
- No centre line up high, faded where it returns.
- Paved but rougher up high (gravel shoulders, loose gravel, patching).
- No construction zone.
- Rock cuts with debris.
- The full water set.
- Red Jammers plus walking people.
- Mile markers in miles.
- A ride-through burn plus burned slopes across the lake.
- Animals at fixed spots, no bear jam.
- The real overlooks plus a few random lake windows.
- Same budget; build it all, then review.

*Done*
- [x] **Road:**
  - paved 5.9–6.4 m from 30 to 56.5 km, with gravel shoulders and the edge lines moved in
  - no centre line from 34.7 to 52.5 km, faded 1 km either side
  - loose gravel in the alpine and east-descent zones (`road-surface.js`: `pavedM`, `centre`, `gravel`)
- [x] **Rock cuts:** ground attribute `aVk` (cut depth, burn). Blasted grey faces with seeps, and the ribs calmed on the cut.
- [x] **Verge** (`verge.js`): miles 1–46, snow poles 30.5–56.5 km, delineators in the valley and on the east side, fallen rock below the deeper cuts.
- [x] **Water:**
  - Weeping Wall strands arcing onto the road
  - 31 culverts found from the terrain, with masonry headwalls, pipes and cascades in the steep gullies
  - McDonald Creek traced 16.8–23.2 km
  - white water on every creek where it drops
- [x] **Traffic and people:**
  - Red Jammers about 1 vehicle in 4, and parked at overlooks
  - visitors at Logan Pass, Lake McDonald Lodge, Rising Sun, St. Mary, Avalanche and every overlook (`visitors.js`)
- [x] **Burns:** a 1.8 km ride-through above Lake McDonald (14–15.6 km) and the slopes across the lake. Snags, regrowth and fireweed.
- [x] **Wildlife:** goats above the road at 43.5 km, bighorn at Logan Pass (one on the shoulder), a marmot on the wall at about 45.5 km.
- [x] **Views:** windows at 11 real viewpoints. Random windows toward the lake only.

*Leftovers fixed (16 Nov 2026)*
- The "floating rock" before Logan Pass was a snowbank lying flat on a steep slope. Snowbanks now skip slopes over 0.45, tilt with the ground and sink by the slope.
- **Garden Wall smear:** near the camera, steepness is judged per triangle, so the grass and rock edges are crisp. Tile skirts are left out of this. Rock covers 93%.
- **Tree-shadow blotches on steep faces:** object shadows on the ground fade on steep slopes (`vkShadowK`, patched into three's directional shadow line).

**Trees, grass and flowers pass** (Matt, 16 Nov 2026)

*Decisions*
- All of it:
  - real heights with an age mix
  - layered limbs
  - crown character
  - logs and stumps
  - bark by species
  - foliage clumps
  - aspen flutter
  - lichen and moss
  - grass in shades
  - more shrubs
  - grass close to the rider
  - moss, rocks and deadfall
  - flower drifts with more species, by zone, plus a roadside strip
- Detail goes in the near band.
- Going-to-the-Sun only for now.
- A little more budget (up to about 2.5 M triangles).
- Build it, then review.

*Done*
- [x] Glacier kit trees, floor items, grasses, shrubs and flowers.
- [x] `decorateTreeMaterial`.
- [x] Planting in `forest.js` (`vegetation.rich`).
- [x] Cover by zone, near-road tufts and flower drifts.
- [x] **Draw calls:**
  - lakes beyond 7.5 km aren't drawn (`water.lakeReachM`)
  - talus is in the near tier only
  - small floor items cast no shadows
  - one variant each for the floor items
- [x] **Results:** 217–355 calls and 1.67–2.28 M triangles headless on Balanced. Clipping QC: 0 fail, 4 shoreline z-fight warnings. A camera-inside warning from a big cedar crown by the road was fixed: crowns near the road are capped, and giants stay more than 22 m away.

*Known leftovers*
- The Garden Wall's base reads as low-poly facets (crisp) rather than a smear.

**Still to check**
- [ ] A ride on the M4 Air with the `I` overlay: the ground shader is heavier (about 40 value-noise lookups
  per pixel on mountain faces, fewer on flat ground). If it's over budget, drop `rock.ledges` or `meadow`
  first.
- [ ] Roll the kit out: Big Sur (haze, clouds, rock), Route 28 (haze, clouds, forest crowns)

### Rider improvements *(test branch `rider-test`, from `main` after PR #24)*
Goal: a bigger, better rider: closer camera, a semi-realistic model with more triangles and real textures, and riding postures that follow the road.

**Decisions (16 Nov 2026)**
- Size: the rider stays life-size (it still matches cars, people and doorways); the chase camera comes in instead
- Camera: 4.5 m back (was 6.5 m), 2.1 m up, aimed a little lower → the rider is about 1.4× bigger on screen
- Model: semi-realistic, ~60k triangles (this overrides the Route 28 pass's "cartoon rider"; the cartoon look leaves the rider's shading alone)
- Animation triggers: grade + effort. Stand and pump on climbs of 7 % or more at 90 % of FTP or more; tuck on descents of 4 % or more when coasting or soft-pedalling

**Passes**
- [x] Chase camera at 4.5 m (`CHASE` in `js/world/pose.js`, shared by the app, the course QC and the clipping QC)
- [x] New rider + bike (`tools/build_rider.py`, run with the `bpy` module: `pip install bpy pillow numpy`, then `python tools/build_rider.py`): **one skinned mesh, one draw call** (was 11 meshes, 12 calls plus 12 in the shadow pass), 64.9k triangles (was 26.6k)
  - body: metaball trunk, legs, head and gloved hands with smooth skin weights between neighbouring bones (19 bones: bike, wheels, crank, pelvis, chest, head, arms, legs)
  - bike: aero frame with dropped seatstays, aero fork, integrated cockpit with taped drop bars and hoods, head unit, two bottles in cages, 50 mm carbon rims with bladed spokes, disc rotors, 2× chainrings with teeth, 11-speed cassette, derailleurs and chain
  - texture atlas painted from code (`models/rider-atlas.png`, 2048×1536): kit with side panels, pockets and back print, bib shorts with grippers, socks, shoes, helmet with vents, frame and rim decals, bar tape, chain, bottle label, screen. Baked ambient occlusion and a specular strength per vertex
  - the pacer shares the mesh and has its own atlas (`models/pacer-atlas.png`: yellow-and-black checks, black bike with yellow accents)
- [x] Postures (`js/world/rider.js`): seated; standing and pumping (hips forward over the bottom bracket, bob and sway over the pushing pedal, heel lifts through the bottom of the stroke, bike rocks about 7° under the rider); the tuck (flat back, hands in the drops, knees in, pedals level when coasting). Blended over about half a second; minimum 1.2 s in a posture; looser limits to stay in one; standing comes in bouts (sit after ~25 s, stand again after 8 s). Rules: `POSTURE_RULES`, tested in `test/rider.test.mjs`
- [x] The app feeds the rider grade, 3 s power and FTP; the pacer gets its grade, its set power and your FTP
- [x] Rider workshop: `tools/rider-preview.html` (postures, grade/power/FTP/cadence/speed sliders, cameras, pacer kit) and `npm run snap:rider -- seated:chase standing:side@1.57 tuck:quarter pacer/standing:back` (PNGs in `tools/snapshots/rider/`)
- [x] `npm run snap` waits for the rider model before the shot

**Measured (headless, software GL)**: Route 28 at 10.65 km: 207 draw calls, 1.05M triangles with the new rider. Going-to-the-Sun at 3 km: 332 calls, 2.03M triangles. Download: `rider.json` 1.9 MB (was 0.4 MB) + 0.5 MB atlas (pacer atlas 0.46 MB, only when the pacer is on).

**To check on the Mac**: the look in motion (standing rock and bob, tuck in/out), frame time on the Air, and whether 4.5 m is the right distance.

### Alpe d'Huez — Tour de France 2026 Stage 19 *(test branch `alpedhuez-test`, from `main`)*
**Goal:** a new route that matches the real Tour stage's distance and elevation, as a wireframe first (scenery comes later). In **Rough Drafts**.

**Decisions (16 Nov 2026)**
- Stage: **2026 Stage 19, Gap → Alpe d'Huez** (official 127.9 km, about 3,500 m climbing; Col Bayard, Col du Noyer, Col d'Ornon, then the 21 hairpins)
- Look for now: **road + wire terrain**: the real road on the real ground, drawn as contour and grid lines on a dark fill; no scenery
- **One way** like the real stage (catalog `"oneWay": true`); the app still turns at the summit and rides back down, like every route

**Passes**
- [x] **P1 · Road** — routed on the official roads (N85, D17, D817, D117, D937, D537, D1085, D212B, D26A, D526, D1091, D211) with waypoints at every point of the ASO *itinéraire horaire*; checked against a published stage GPX (no point more than 60 m off)
- [x] **P2 · Profile** — elevation from AWS Terrain Tiles, filled from z13 where z14 has holes (near Valbonnais); grades over 13 % eased (`profile_opts.max_grade`), smoothing 200 m, ends held level
- [x] **P3 · Wireframe** — scene `"style": "wireframe"` (`js/world/terrain.js`, `scene.wire`): streamed real terrain, contours every 10/50/250 m, 25/100 m grid, dark sky; offline download is elevation only
- [x] **P4 · Check** — `qc --strict` clean (hairpins now reported as *switchback* info), `npm test` 98/98, `routes:check` clean
- [ ] Ride it on the Mac (githack link)
- [ ] Next: baked terrain, then scenery (hairpin numbers, villages, crowds)

**Measured against the official stage**

| | Official | bikefree |
|---|---|---|
| Distance | 127.9 km | 127.0 km |
| Climbing | ~3,500 m | 3,358 m |
| Start / finish | 905 m / 1,850 m (profile 1,835 m) | 902 m / 1,834 m |
| Col Bayard (km 4.8) | 1,246 m | km 4.8, 1,246 m |
| Col du Noyer (km 25.2) | 1,664 m | km 25.0, 1,660 m |
| Col d'Ornon (km 99.2) | 1,371 m | km 98.7, 1,366 m |
| Alpe d'Huez climb | 13.8 km at 8.1 % | 13.8 km at 8.1 % |

The 0.9 km gap builds up evenly (about 0.7 %): the organisers measure on the road, the map line cuts corners. Every checkpoint is within 1 km of its official distance.

### Endless option for point-to-point routes *(test branch `endless-test`, from `main` after PR #26)*
**Goal:** a point-to-point route can end at the finish, or ride on endlessly (turn at the finish and ride back). **Off by default.**

**Decisions (16 Nov 2026)**
- Applies to point-to-point routes: one-way stages (Alpe d'Huez) and your own GPX files that don't come back to their start. Built-in there-and-back routes and loops stay endless
- With Endless off, the ride ends at the finish: the rider stops on the line, resistance goes flat, and the ride summary opens (as if you pressed Finish)
- The switch sits in the route options (*Ends at the finish* / *Endless*), next to Forward/Reverse and the start point, and is remembered like them

**Passes**
- [x] `isPointToPoint` / `finishDistanceM` (`js/gpx.js`); the session takes a finish distance (`setRoute(route, start, finishM)`), clamps the rider and pacer to the line, and fires *routeFinished* once
- [x] Route options: *Ends at the finish* / *Endless* (shown only for point-to-point routes); preview facts and tag; ride screen shows *to the finish* instead of the lap
- [x] Works with Reverse and ⅓ / ⅔ starts (Reverse finishes back at the start)
- [x] Ends at the finish: the elevation charts (preview and ride screen) show just the leg being ridden, start to finish
- [x] Tests (`test/endless.test.mjs`); `npm test` 109/109
- [ ] Ride it on the Mac (githack link)

### Route selector *(test branch `route-selector-test`, from `main` after PR #30)*
**Goal:** replace the *From the start / ⅓ in / ⅔ in* start options with a real choice of where a ride starts along a route and how long it lasts.

**Decisions (17 Nov 2026)**
- Build: drag the start on the elevation profile, tap a named place to start there, and set the length by time, distance or climbing (with *Stop at the finish* / *Keep riding*)
- Later, maybe: auto-detected climbs as start points, a second handle for the end, saved favourite sections, *turn around halfway so you finish where you started*

**Passes**
- [x] `js/route-plan.js`: start = direction + metres along the leg; named stops (catalog `routing.pois`, or `<wpt>`s in your own GPX) placed on the way out by `routes:build`; a ride simulated at a steady power on the session's physics turns a time / distance / climbing goal into a finish line
- [x] Route options: start chips (Beginning / Far end + named stops, and an "x mi in" chip after a drag); length *Open (Full on a stage) · Time · Distance · Climb* with a stepper and the power the estimate assumes (your setting, else the pacer's, else 65% of FTP); the estimate (distance, climbing, time, where it ends)
- [x] Preview profile: the leg being ridden in riding order, the planned stretch bright, a chequered finish line, stop ticks; drag (or tap) to move the start, snapping to stops. Map: the planned stretch and its end
- [x] *Stop at the finish* ends the ride on the line (summary opens); *Keep riding* turns the goal into a toast and the ride goes on (a stage then turns and rides back, like Endless before). Ride screen: *to the finish* / *to your goal*, and the finish line on the profile strip
- [x] Start is remembered per route; the length, end choice and power are remembered globally
- [x] Tests (`test/route-plan.test.mjs`); `npm test` 136/136
- [x] Start and finish arches (`js/world/toolbox/roadside/course-arches.js`, `world.setCourseMarks`): an inflatable START arch about 10 s of easy pedalling from a standstill (90 W on the road's own grades, 15–60 m) after you load in, named for the nearest stop (else the route); a FINISH arch over the planned finish line (GOAL with *Keep riding*), named for the stop there, else the distance. Painted line under each (white / chequered). Legs reach the ground beside the road; on a bridge or drop-off the arch slides a few metres or stands narrower on the shoulders. No second arch on a race-day finish (Alpe d'Huez has its own gantry). ~5k triangles and 3 draw calls per arch
- [x] Design renders: `node tools/snap_arches.mjs` (plain road, `tools/arch-preview.html`); in scenes `npm run snap -- --arches "22350:START:Avalanche Creek,47310:FINISH:Logan Pass" goingtothesun@22330`
- [ ] Ride it on the Mac (githack link)

### Toolbox: shared kits for every route *(test branch `toolbox-test`, from `main` after PR #28)*
**Goal:** review every route's tools, textures and methods, and centralize them into one toolbox that every route (and every future map) builds from, to cut rework and improve what riders see. See TOOLBOX.md and docs/toolbox/INVENTORY.md.

**Decisions (16 Nov 2026)**
- Active routes move onto the toolbox: Route 28, Big Sur, Going-to-the-Sun, Pittsburgh, Zion and Alpe d'Huez. Deprecated and rough-draft routes keep working but aren't migrated
- Refactor only: no visual change on any route. Upgrades come later, route by route
- The default for new routes is the gentle cartoon look with baked light (one time of day, midday), the chase camera, the vista kit where there's distance, and a regional pack
- Extras: an asset gallery, a scene linter, a new-route scaffold and biome presets

**Passes**
- [x] Inventory of every module against every route; duplicates and gaps (docs/toolbox/INVENTORY.md)
- [x] Refactor guard: `snap --png --fingerprint` (frozen clock, seeded random, no streamed horizon) and `npm run guard`
- [x] Kits moved into `js/world/toolbox/` by category, with generic names. The model builder, random, tree cards and guardrail split out of route kits and the scene builder
- [x] Pack registry: `packs: ["northeast" | "northern-rockies"]`, replacing `kitExtensions: ["adirondack" | "glacier"]`
- [x] Scene schema and `normalizeScene`: `glacier` → `mountainRoad`, `life.kit`
- [x] Scene linter (`npm run lint:scenes`, in `npm test`)
- [x] Five biome presets (`routes/presets`, `npm run presets`)
- [x] `npm run new-route`
- [x] Toolbox gallery (`tools/toolbox-gallery.html`, `npm run gallery`)
- [x] `snap … :standard` and `?standard=1`: any route with the toolbox standard look
- [x] Fix: baked light works with the vista kit's ground material (found by trying the standard on Going-to-the-Sun)
- [x] Guard: identical pixels and objects on every route (Pittsburgh: fountain spray seeds differ run to run on the old code too); `npm test` and `routes:check` clean
- [ ] Ride a route on the Mac (githack link) to confirm nothing moved
- [ ] Later (visual changes): merge the duplicates listed in INVENTORY.md, an `alps` pack, and the standard look on Big Sur, Zion and Pittsburgh

### Alpe d'Huez hero — race day, the whole stage *(test branch `alpedhuez-hero-test`, from `main` after the toolbox)*
**Goal:** fill in the Alpe d'Huez wireframe at hero detail with the toolbox: all 127 km of Stage 19, on race day, at real places drawn in the cartoon style. Full plan: `docs/alpedhuez/HERO_PLAN.md`.

**Decisions (16 Nov 2026)**
- Hero detail everywhere (not just the final climb)
- Race day always: crowds, Dutch Corner, road paint, barriers, camper vans, banners, finish arch; roads closed (no traffic)
- Real places, stylized: villages, churches, the Sautet dam, the Beaume tunnel and the resort from OpenStreetMap; bend signs 21 → 1 at the real bends
- Claude builds it alone, in phases, with snapshots after each
- Toolbox standard (gentle look, baked midday, chase camera, vista); 2.5M triangles allowed on the Alpe with crowds; under 600 draw calls

**Passes**
- [x] P0 · Scene onto the mountain preset; OSM corridor fetch (`tools/fetch_osm_corridor.py`, OSM API tiles) + census (`docs/alpedhuez/osm-census.md`)
- [x] P1 · Terrain bake: Terrain Tiles holes filled from z13; lakes checked against the map (Sautet, Laffrey, Saint-Pierre-Cognet, Lac Blanc…); tunnels (Beaume, Huez galleries); baked light in a 6 km window that follows the rider
- [x] P2 · Map land cover, buildings, lifts, power lines and dams baked into `alpedhuez-places.bin.gz` (`tools/build_places.py`); real-terrain uses the land cover
- [x] P3 · `alps` pack (106 models) + data-driven `vegetation.zones` (Going-to-the-Sun keeps its defaults)
- [x] P4 · Palette and planting by elevation band, aspect and land cover
- [x] P5 · Atmosphere: vista, haze, clear and cloud presets, midday bake
- [x] P6 · 7,300 buildings from map footprints in six regional styles, the tent church, 78 lifts, 71 power lines, 5 dams
- [x] P7 · Bend boards 21 → 1 at the mapped *virages* (number, altitude, winners), town and col boards, French bornes, EU road markings
- [x] P8 · Race day (`raceDay`): crowds by stretch, Dutch Corner, flags, vans and tents, road paint, barriers, KOM banners, km-to-go, flamme rouge, finish gantry, helicopter. Not built: runners beside the rider, podium and team buses
- [x] P9 · Cows, sheep, marmots, ravens and an eagle (no dog, no vultures yet); the ride ends at the line (Endless off)
- [x] P10 · Strict QC clean (switchback banks, 3 m ground on hairpins, retaining walls); guard on the other routes; snapshots; moved to In Progress. Still to do on your side: a githack ride on the Mac and the Air

### Figures: people and cars *(test branch `figures-test`, from `main` after PR #30)*
**Goal:** replace the blocky box people and box cars with models that look better, and keep them cheap to draw and animate. One shared kit (`js/world/toolbox/life/figures/`) for every route that shows people or vehicles.

**Decisions (17 Nov 2026)**
- Soft cartoon style: rounded limbs, round heads with a simple face, toy-like cars with round wheels, to match the gentle look
- Baked motion clips: walk cycles and poses authored in `rig.js`, baked by `npm run figures` into `clips.js`, played in the vertex shader from a float texture
- Variety: clothing (sleeves, shorts, skirts, caps, packs), body types and kids, and extras (dogs on leads, strollers, people holding phones and cameras)
- All vehicles, one shared kit, on this test branch

**Passes**
- [x] Rig (person + bike bones, dog) and 19 clips: idle, look, stroll, walk, jog, cheer, clap, wave, photo, phone, push (stroller), leash (dog), flag, sit, cycle, moto, ride, dog-walk, dog-idle. Two-bone IK keeps feet planted and hands on bars and handles; playback rate = speed / stride, so feet don't slide
- [x] People: three detail levels (near ≈ 600 triangles as seen, mid ≈ 170, far ≈ 60), outfits and kids per instance, all in one draw call per level; shadows use the same skinning
- [x] Vehicles: sedan, hatchback, SUV, pickup, van, taxi, city bus, motorhome, camper van, motorbike (with rider) and the Red Jammer (with passengers). Round wheels that turn with the distance driven, glass on every side, brake lights. A light version (under 200 triangles) for parked cars
- [x] City life (Pittsburgh), visitors (Going-to-the-Sun), highway traffic (Big Sur, Going-to-the-Sun), race-day crowds and camps (Alpe d'Huez), the Pittsburgh street kit's parked cars and the Logan Pass car park all use the kit
- [x] Race-day crowds drawn in three bands around the camera (detailed within 20 m, light chunks to 70 m, lightest beyond) to stay inside the Alpe's budget
- [x] Fix: a city walker, cyclist or car spawned at the route's edge could get a NaN position while waiting at the kerb (QC showed it passing through the rider)
- [x] `npm run snap:figures` (gallery views), `test/figures.test.mjs` (clips up to date, triangle budgets, feet on the ground)
- [ ] Ride Pittsburgh, Big Sur, Going-to-the-Sun and the Alpe on the Mac and the Air (githack link)

### Building kit *(test branch `buildings-test`, from `main` after PR #33)*
**Goal:** buildings are the weakest part of the scenery: one flat colour, windows on a grid, plain roofs, one box per building, nothing at the base. Build a generic kit that recombines automatically, on top of the map-footprint buildings, and try it on Alpe d'Huez only. Proposals: the Project doc `claude/building-kit-proposals.md`.

**Decisions (17 Nov 2026)**
- Alpe d'Huez only for now; the kit is added on top (`footprints.js` stays as it is for scenes without `buildingKit`)
- All six layers: wall surfaces and weathering, windows and doors, roofs, massing modules, ground dressing, the recombination engine; plus the gallery and checks

**Passes**
- [x] Facade shader: 13 wall surfaces, 9 roof surfaces, 7 window sets with shutters, curtains, sills, surrounds, flower boxes; doors, barn doors, shopfronts, quoins, ivy, sundials; weathering by age and upkeep; fade-to-average far off
- [x] Recipes: archetypes from footprint size and density, regional presets (Provence, Hautes-Alpes, Dauphiné, Oisans, ski resort), colour schemes that never repeat next door, age / upkeep / wealth
- [x] Massing: L/T/U footprints cut into rectangles with cross gables; gable, half-hip, hip, shed, flat and crow-stepped roofs; farmhouses with barn ends; balconies, galleries, dormers, chimneys, lean-tos, garages, outside stairs, génoise, bell towers, solar panels, the tent church
- [x] Ground dressing near the road, kept off the road and out of buildings; near detail built lazily per stretch
- [x] Duplicate map footprints dropped (they z-fought once each copy had its own windows)
- [x] `npm run gallery:buildings`, `test/building-kit.test.mjs`, snapshots before/after at 8 spots (`docs/buildings/`)
- [ ] Ride the Alpe on the Mac and the Air (githack link); check load time on the Air
- [ ] Later: bring the kit to Route 28's villages

**Pittsburgh pass (17 Nov 2026, same branch)**
- Decisions:
  - Homes get the full kit and everything else gets textures only; towers and heroes are untouched.
  - The street kit's storefronts, cornices and bays stay.
  - Pittsburgh may use 2.5 M triangles.
  - The work goes into PR #34.
- [x] Presets `pittsburgh-rowhouse` and `pittsburgh-frame`, styles picked by map kind. Also added: asphalt shingles, front porches, party walls with ridges along the street, stone lintels, a cornice on flat-roofed rows, a spindle railing.
- [x] `CityBuildingKit`:
  - homes from the city's streaming, folded into its sectors
  - fronts toward the nearest street; clearances from street edges and sidewalks
  - detail tiers by distance to the route
  - lamps and trees keep clear of eaves, porches and dressing
- [x] City facades through `FACADE_GLSL`:
  - brick, stone, painted brick, concrete and metal by kind, plus weathering
  - windows with frames, sashes, blinds and curtains, lintels and sills, on the street kit's grid
- [x] Budget:
  - far homes skip soffits, fascias and chimneys
  - near detail per sector, shown within 550 m
  - High busiest spots are now 2.24 M and 2.16 M
- [x] Tests: row houses get party walls; fronts face streets; porches and dressing stay off streets and out of buildings
- [x] Clipping QC: the same findings as main
- [ ] Ride Pittsburgh on the Mac and the Air

### Pittsburgh life: keep people and traffic off the route *(test branch `pittsburgh-life-test`, from `main` after PR #34)*
**Goal:** pedestrians and cars visibly jumped out of the way as the rider came up. Decision: keep them off the route (people on sidewalks, cars in their own lane), so no sudden avoidance is ever needed. Nothing snaps, teleports or lurches sideways in view.

**Why they jumped (main):** `_yield` in `city/life.js` stepped people on the road out to its edge in one frame, held anything entering it at its previous spot, and sped vehicles on it up 2.5×; a "step aside" rule moved walkers within 4.6 m of a route point out to 4.8 m; trail walkers sat inside `_yield`'s 5.5 m edge (stepped out at 16 m); oncoming trail cyclists rode in the rider's half; sidewalk offsets came from each 7 m segment's own direction (a step at every bend, a 9 m hop round corners, a hop across the street at a dead end); people and cars were respawned inside the view (a 120 m spawn cell can sit next to the camera; hotspot people anywhere in the square).

- [x] Load time: walk and drive ways that run along the route's road, or end on it with nowhere to go, are cut out; where one crosses it, the crossing is kept with its route distance
- [x] Crossings: people, cyclists, cars and buses decide ahead (9 / 25 / 55 m) and stop smoothly at the kerb or the stop line until the rider is 70 m past or far enough off to need its crossing time + 5 s (+ 40 m) to arrive; cars queue 7.5 m apart; once committed they carry on at their own pace
- [x] Continuous moves: speeds ease (no hurry), sideways offsets use a smoothed heading, and the drawn position follows the agent's place on its way at no more than 1.25 × its speed + a little (corners, turning round); headings turn at a set rate
- [x] Trails: walkers keep a side of their own 4.3–5.3 m off the centre line (outside the ribbon); cyclists ride the half away from the rider
- [x] Oncoming cars only appear 260–640 m ahead (and 220 m off in a straight line) where the street runs on unbroken to the rider; their lane is square to the smoothed heading
- [x] New people, cyclists and cars appear 165 m (people) / 231 m (cars) off or behind the camera; hotspot people (standing or strolling) keep off the route's road
- [x] `test/city-life.test.mjs`: a whole ride Forward and Reverse. main: 4977 / 5151 jumps (worst 19.9 m in a 0.1 s step), 85 / 59 people in the carriageway, 24 / 25 vehicles in the rider's lane, 388 / 420 pop-ins in view; this branch: 0 of each, with about as much life near the rider
- [x] Clipping QC with life: main 3 fail (vehicle-through-rider) · 445 warn; this branch 0 fail · 420 warn (person-in-water 17 → 0, vehicle-clips-solid 356 → 350)
- [x] Only Pittsburgh uses `city/life.js` (the `authored-city` terrain), so no other route changes
- [ ] Ride Pittsburgh on the Mac (githack link)


### Pittsburgh network: choose your turns *(test branch `pittsburgh-network-test`, from `main` after PR #35; one PR at the end)*
**Goal:** a more explorable Pittsburgh. Rides are built from segments joined at junctions where you choose left / straight / right / back, so routes can be grouped by goal (flat, hilly, short, long, varied, new areas). Plans: Project docs `claude/pittsburgh-expansion-routes.md` (the 11 suggested segments) and `claude/pittsburgh-connections-plan.md` (junctions A–Q).

**Decisions (17 Nov 2026)**
- No choice made at a junction: follow the planned route; with no plan (or once off it), go straight (the main arm at a T)
- Choose with the handlebar ◀ ▶ buttons and keyboard <kbd>A</kbd> / <kbd>D</kbd> (no on-screen buttons); arrows stay on shifting and grade
- Sharp turns (over ~60°): gentle speed cap through the corner, then pedal back up
- U-turns: "Back" is an option at every junction; dead-end segments end in a turnaround
- Turn prompt ~15 s ahead (never under 120 m), locks 30 m out; each option shows where it goes, distance and climb to the next junction
- Free ride: no set end (ride until you stop)
- Planning: goal presets first; tap-the-map planner in phase 4
- Turns not taken: route quality for ~150 m, then the normal city street
- Every segment rideable both ways (real one-way streets ignored; traffic keeps its real direction)
- Minimap: the whole network faint, your path bold, the next junction's options highlighted
- One branch, one PR at the end; on-bike review stops after phase 1 and phase 3

**City card: one Pittsburgh card with a map picker** *(branch `sprint-card`, 18 Nov 2026)*
- Asked: one Pittsburgh card on the main page instead of every preset; clicked, it opens a map where you pick the route. Chosen (mockup approved): a full-screen panel (back arrow / <kbd>Esc</kbd>); list + map both tappable; goal chips inside the panel; Free ride and Plan your own at the top; your saved routes listed with the presets (marked *yours*, removable); 44 px tap targets on a phone
- Built: `js/city-routes.js` (no DOM, `test/city-routes.test.mjs`): a network's items folded into one card (any catalog route with a `network`, not just Pittsburgh), segment → routes index, tap-to-cycle, goal filter, the map projection, rivers merged from each area's scene. `js/views.js` `drawCityMap` (rivers, every segment faint, the goal's segments brighter and the rest dimmed, the selected route bold with an arrow per step, the tapped segment haloed, junction dots); the card's thumbnail is the same map. Panel in `index.html` (`#cityDlg`, a `<dialog>`), logic in `js/app.js` ("City panel"), styles in `css/style.css`
- Behaviour: the card shows "8 areas · 36 routes · free ride" (+ "· n yours") and the selected Pittsburgh route; with a goal on the main page it counts that goal's routes and hides when none (nor the free ride) suits it. The panel's goal starts at the main page's and doesn't change it. Tapping a line lists the routes that ride it (of the goal's), selects the first, tapping it again selects the next; "Show all" (or a tap off the lines) clears it. **Ride** chooses the route and returns to the menu with its preview, start options and Start button, as picking its card did (it doesn't start the ride); on a narrow screen it scrolls to the preview. Keyboard: the card opens with Enter, the list moves with ↑ ↓, the map takes ← → (segments the goal lights) and Enter. The app keeps no browser history, so Back in the browser doesn't close the panel
- QC: `node tools/snap_city.mjs` (headless Chrome, 1440×900 and 390×844, `--theme light`): screenshots of the main page, the panel, a route picked, a line tapped twice, a goal, after Ride → `tools/snapshots/card/` (not committed); it fails on page errors or if Escape doesn't close back onto the card
- Follow-ups (F100–F109 kept for this card):
- [ ] F100 City card: the browser's Back doesn't close the panel (the app keeps no history); add a `pushState` for the panel if it's wanted on a phone
- [ ] F101 City card map: the rivers are the scenes' `rivers` (the Allegheny stops at ~-79.98, short of the East End and Lawrenceville); a fuller river outline (from the city data's water, baked small for the map) would read better. No labels yet (rivers, neighbourhoods, the Point)
- [ ] F102 City card map: no zoom or pan; on a phone the Polish Hill / North Side tangle is tight to tap (22 px tap radius). Pinch-zoom, or zoom to the selected route
- [ ] F103 City card: the list keeps the network's preset order (presets, then yours); sort by length / climb or group by area if the list grows (Dirty Dozen)
- [ ] F104 City card: Ride only chooses the route (the menu's Start starts it, with the start/length options); a one-tap "ride now" from the panel would skip those — keep as is unless asked
- [ ] F105 City card: hovering a line on the desktop could preview which routes ride it (tooltip) before the tap
- [ ] F106 `sw-assets.js` (the offline app files) doesn't list `js/city-routes.js` yet: it was already stale on `pittsburgh-network-test` (01a4c0c), so it's left for one `npm run routes:build` after the parallel branches merge

**Action items, in order**

*Phase 1 — Turns on the current loop (junction G, East Carson & 10th)* — review stop
- [x] 1.1 Network data: nodes, edges (intervals of the loop's GPX), presets; `tools/build_network.mjs` finds the nodes on the GPX → `routes/cities/pittsburgh-network.json`
- [x] 1.2 `js/network.js` (pure): arms and bearings, path made of edge traversals, options at a node (left/straight/right/back), default rule, a rolling linear "path route" the session rides, path → loop position mapping, smooth turn pose, turn ahead (for the speed cap), laps on the plan
- [x] 1.3 Session: network routes, corner speed cap, laps, choice API; handlebar ◀ ▶ and <kbd>A</kbd>/<kbd>D</kbd>
- [x] 1.4 World: built from the loop as today; rider, pacer, arches and route traffic follow the path
- [x] 1.5 Turn prompt on the ride screen
- [x] 1.6 Route list: test entries for the 18.3 km loop and the 13.7 km South Side short loop; route selector fits network routes (no Reverse, starts at named junctions, ride length on the path)
- [x] 1.7 Tests (`test/network.test.mjs`): mapping, every in/out pair at every node (position, height, heading), default rule, laps, speed cap
- [x] 1.8 Course QC rides every turn at every node (`npm run qc:network`: 20 ways through 2 junctions, all clean; Pittsburgh course QC still 0 fail / 0 warn)
- [x] 1.9 Snapshots of junction G: right, left and back from East Carson (`npm run snap -- --path e1+,e3+ pittsburgh@6008 …`)
- [x] 1.10 githack link → on-bike review (17 Nov: worked as intended)
- Built: `routes/cities/pittsburgh-network.json` (junctions: North Shore Water Steps, East Carson & 10th; 3 edges; presets "Three Rivers Loop · choose your turns" 18.3 km and "South Side Short Loop" 13.7 km). Turns are curves through the junction (right 8 m, left 13 m, back 9 m); speed cap only on turns sharper than 60° (a right turn at East Carson & 10th: ~21 km/h). `window.bikefree` (session, world) serves headless checks; `snap --path` follows a network path.

*Phase 2 — Presets and minimap*
- [x] 2.1 Goal presets: Three Rivers Loop and South Side Short Loop both ways, South Side Flat Loop, Mount Washington There & Back, Three Rivers There & Back; Pittsburgh is listed as its presets (the old loop entry stays a scenery choice). Goal filter over the whole route list (All · Flat · Hilly · Short · Long · Varied): presets carry their own tags, every route also gets flat/hilly from climbing per km (<6 / ≥12 m) and short/long from length (<15 / ≥30 km)
- [x] 2.2 Minimap: network + path + next options (`drawNetworkMinimap`); card thumbnails and the preview map draw one lap
- [x] 2.3 Ride-screen profile follows the path (current lap, or to the next junctions off-plan)
- [x] 2.4 Off-plan handling: rejoin the plan where it next rides a plan step; the finish arch moves with the path; "lap to go" becomes "to <next junction>" off the plan

*Phase 3 — First new segments: Jail Trail (1) + Hot Metal link (2), junctions E, H, I* — review stop
- [x] 3.1 New edges: Pittsburgh's GPX is now one open tour — the Jail Trail & Hot Metal Bridge (Smithfield & Fort Pitt → SouthSide Works riverfront, 4.9 km) then the old loop from SouthSide Works round to it (23.2 km); every edge is ridden once, so the world is still built around one line. `tools/city/pittsburgh.json` legs pin the Jail Trail with waypoints on the trail; `"open": true` builds an open line
- [x] 3.2 City data rebuilt from OSM for the tour (13,995 buildings, was 12,182; 4,064 streets, was 3,609); terrain grid rebuilt; `build_city.py` also cuts longer out-and-back stubs. Scene metre keys moved with `tools/remap_scene_metres.mjs` (by geometry, 0 unmapped)
- [x] 3.3 Every network edge is route quality (the tour is the route), so every way on at a junction looks rideable
- [x] 3.4 New junctions E (Smithfield St & Fort Pitt Blvd: the Jail Trail is a left off Smithfield, the bridge straight on) and H (SouthSide Works riverfront: a Y where the trails meet); turn curves fit tight mapped corners (wider up to +9 m), hairpins over 150° turn like U-turns. Junction I (Hot Metal ramp) waits for the Junction Hollow spur (5.2)
- [x] 3.5 Hot Metal Bridge rideable (dark truss); the Jail Trail runs under the parkway walls; the ground keeps under a gentle bank beside trails on a ledge
- [x] 3.6 New presets: Jail Trail & South Side Loop (9.2 km), Point & Jail Trail Loop (17.4 km), Jail Trail & Mount Washington Loop (19.1 km); "New areas" goal
- [x] 3.7 QC: `qc --strict` clean (8 reviewed corridor warnings accepted, F8), `qc:network` 38 ways through 4 junctions clean, clipping 0 fail (F11), life sim clean; 194–307 draw calls, 1.1–2.1 M triangles in snapshots; tests 165 pass
- [x] 3.8 githack link → on-bike review (17 Nov: on to phase 4)

*Phase 4 — Free ride and the map planner*
- [x] 4.1 Free ride: "Free Ride · choose every turn" per network (spec `freeRide`): no plan, straight on unless you turn, no laps, no set end; start at any junction (start chips); a ride length still sets a finish that moves with your turns
- [x] 4.2 Map planner ("Plan your own route on the map…" under a network route's preview): tap a junction, then each segment (the ways on are dashed; the one you just rode turns back); distance, climb, time at your plan power, loop or one way; saved in settings by segment names (`settings.netRoutes`), listed with the presets, removable. A loop laps; a one-way route finishes at its end (Keep riding turns it into a free ride)
- [x] 4.3 Recording follows the path (the .fit track is where you rode); laps only on a plan; the summary as for any route

*Phase 5 — Remaining segments, in build order*
- [x] 5.1 West End Overlook spur (9): a dead end O up the hill from junction D (West End Bridge, north end of the West End); the base GPX is now an open tour (26.74 km) and its ride back down the spur is a **ghost stretch** (city data `routeGhosts`, 14.19–15.94 km): never drawn, never placed beside, never a network edge (js/world/ghost.js). Network 6 junctions, 8 segments, 11 presets; "Back" at the overlook. Bench dressing on porches kept off sidewalks; walkers keep to the new way's sidewalk when they turn a corner; the life sim skips ghost stretches
- [x] 5.2 Oakland & Schenley Park (3): junction I at the Hot Metal Bridge's north end (the Jail Trail carries on), I>J along Second Ave and up the Junction Hollow Trail, through Oakland (Boundary St, Joncaire, Forbes past the Cathedral of Learning and Schenley Plaza) to J (Schenley Drive by Phipps); a loop through Schenley Park: J>K Schenley Drive to Forbes, K>J Serpentine Drive's switchback, round the Schenley Oval and up Panther Hollow. The tour is 40.0 km; the ride back from J to I is a ghost. 9 junctions, 12 segments, 14 presets (new: Schenley Park Loop 4.6 km, Jail Trail, Oakland & Schenley 21.1 km, Oakland & South Side Loop 30.6 km). The OSM area now reaches east to -79.925; a short link joins the Eliza Furnace Trail to the Second Ave path past a switchback ramp. Course QC: findings on a ghost stretch are info; on a switchback only the road's centre line is checked for buried road; reviewed corners and streets accepted (F17)
- [x] 5.3 Troy Hill & Rialto (7) + close gap P: N>P (2.76 km, +61 m) from the North Shore Trail at N along River Ave onto the 31st Street Bridge's north end, straight up Rialto Street (Pig Hill: ridden as mapped, the rider's choice — 24–25 % over ~60 m, ~20 % over 200 m; `steepGrades` lifts the profile's 20 % limit there and lets it start off the bridge as abruptly as it does), Ley St to Lowrie St along the top of Troy Hill, Gardner St and down Troy Hill Rd; gap P closed by the real streets below the Heinz plant — Peralta, Phineas and Chestnut St past the 16th Street Bridge's north end, Progress and Heinz St to River Ave and the path to the trail at P. Streets only (the Troy Hill steps are left out). The tour (58.1 km) rides it as P>N, N>P, then a ghost P→N (the trail again, 1.27 km). River Ave is held level with the trail 13 m beside it until the bridge (`heightPins`). The tour's last sample is now H itself (the 10 m grid and the eased line's end fell ~18 m short: a 31 m hop in path routes there and a 0.64 m pose jump on the river trail → East Carson turn). 13 junctions, 18 segments, 20 presets (new: Troy Hill Climb Loop 4.0 km +63 m, Water Steps & Troy Hill 7.6 km +72 m, Allegheny Loop + Troy Hill 16.2 km +105 m; all hilly). QC: tests 167 of 168 (the life sim's Reverse ride, F27), `qc:network` 106 ways clean, course QC strict 0 fail / 0 warn (reviewed: Rialto's abrupt start, a Troy Hill side street, and older Oakland/Jail Trail spots that moved a few metres), clipping 0 fail · 1,196 warn. Draw calls 240–447 and 1.3–2.4 M triangles on Troy Hill, 207 / 1.16 M in Oakland
- [x] 5.4 Area loading (the city built by area instead of around one line) — needed before 10, 6, 8, 5 → design, recipe and results below. Pittsburgh (the 58.06 km tour merged from 5.3/5.6) is four areas: the core (`pittsburgh`, 29.10 km line: downtown, the North Shore, the South Side, Mount Washington, the Jail Trail and the bridges), the Allegheny & Troy Hill (`pittsburgh-allegheny`, 16.00 km), Oakland & Schenley (`pittsburgh-oakland`, 13.99 km) and the West End (`pittsburgh-westend`, 4.30 km); portals A and B (Allegheny), I (Oakland), D (West End). Every segment, preset lap and climb is exactly as on the one tour (47.67 km of segments, 20 presets, the same edge keys: saved routes carry on); the core's ghosts are four short returns to its portals and the tour's B→E repeat (the J→I and O→D returns live in Oakland and the West End). Engine: `bikefree-network-2` (js/network.js `areaS` / `worldAt` / `areaFor` / `areasNear`), the world's areas (js/world/world.js: one drawn, the plan's areas built behind the start loader and kept, others 1.5 km ahead, released 600 m behind, swap inside an apron 200 m past a portal — or 200 m before it where only the next area has the apron —, fade only if not ready), tools (build_network areas + aprons, build_city `slice` / `lattice` / apron legs / `osmCache`, build_terrain_grid `box`, `tools/slice_scene.mjs`, qc_network rides every preset across the areas, snap `--area`), tests (`test/network-areas.test.mjs`: a two-area fixture; the city life per area and across them). Oncoming route traffic no longer spawns across a ghost (an area line's ghost can end in a sharp join). Results (18 Nov): tests 196 of 198 (the core's Forward/Reverse life rides each meet one cross-street car in the rider's lane — a random draw main shows too with `seed: 3`, F38), `qc:network` clean (every preset across the areas: worst jump at a swap 0.06 m, never a ghost under the rider), course QC strict 0 fail / 0 warn on all four areas (two new accepted spots, F36), clipping 0 fail on every area — 709 · 374 · 122 · 201 warnings (core · Allegheny · Oakland · West End; aprons counted in both areas; main's one tour today: 1,191). At a portal with both areas resident: 200–241 draw calls and 0.9–1.7 M triangles (one area drawn; the tour's worst view was ~467 / 2.9 M), the JS heap 1.2–1.6 GB headless (the 40 km single world: 1.3 GB). Snapshots at the same spot in both areas (A/B, I, D) show the same streets, buildings and road
- [x] 5.5 Great Allegheny Passage to Homestead (10): a new area, the GAP & Homestead (`pittsburgh-homestead`, 15.96 km line), built with legs (the recipe below). The GAP leaves the Hot Metal Bridge's south end, not H: the bridge comes down onto Hot Metal St and the trail splits there, 0.3 km before H (SouthSide Works riverfront, where the South Side Trail goes on west) — so the portal is a new junction **S** (Hot Metal Bridge south end) on the core's line, which splits I>H into I>S (Hot Metal Bridge, 0.52 km) and S>H (SouthSide Works riverfront, 0.31 km); saved routes with I>H map onto both, and the core's presets list them. S>W, the Great Allegheny Passage (7.13 km, +16 m): along the Mon below South Water St, past Hazelwood Green across the river, under the Glenwood Bridge and past Sandcastle, beside Waterfront Drive West to **W** (the Waterfront by the AMC, where the GAP turns off the drive for the river). The loop: W>U, Homestead riverfront (1.86 km): the trail along the river under the Homestead Grays Bridge to **U** (East Waterfront Drive by the Pump House, where the trail comes onto the drive); U>V, Eighth Avenue (3.75 km, +22 m): past the Pump House, River Road over the railroad, Eighth Avenue through Homestead and down Amity St to **V** (Amity St & Waterfront Drive); W>V, Waterfront Drive (0.51 km), and V>U, East Waterfront Drive past the shops (1.23 km), so there are two loops from W and every junction has three real ways. From H to the Pump House corner: 9.3 km, flat. New presets: Homestead Loop (W>U, U>V, W>V back: 6.1 km, +30 m), Waterfront Loop (W>U, V>U back, W>V back: 3.6 km, +10 m), Great Allegheny Passage to Homestead (from SouthSide Works out and back with the Homestead Loop: 21.0 km, +65 m, flat), Jail Trail & the GAP to Homestead (from the Clemente Bridge: the Point, the Jail Trail, the GAP and the Homestead Loop, home on the South Side river trail: 35.8 km, +152 m, long and flat). 17 junctions, 24 segments (62.15 km), 24 presets, 5 areas. The area's line: an apron over the Hot Metal Bridge to S and on to H, a ghost back to S, then the GAP, W>V, V>U, U>V, a ghost V→W and W>U to its end at U — ordered so the line runs through every junction without turning round at one (a ghost's turn-round rounds 20 m short of the junction and drops off its height). Tools: `osmOrigin` (an area's OSM box reaching south or west of the shared cache's first box still shares its tiles: Homestead's reaches 40.382 S and −79.875 E), `trimStartM` (a line that starts in an apron: its first sample moved so the app's 10 m chord samples fall on the neighbour's — a 1.1 m phase was a 1.1 m pose jump at the swap), apron ends rounded to the nearest sample (an apron starting 2 m past a portal left 10 m uncovered: the area drawn flipped five times at S), the opt-in `streetKit.clearRouteCrossings` (no sidewalk across another pass of the route: the GAP's end crossing East Waterfront Drive's sidewalk at U was a rider clip). The terrain box is the shared one (Homestead sits ~5 km inside its south-east corner; extending it would rebuild every area's grid, F44). QC (18 Nov): tests 194 of 197 (the two F38 core life rides, and the new area's Reverse life ride: one walker in the carriageway at S, F47; Forward clean, ~170k people / ~40k vehicle steps near the rider), `qc:network` clean (every way through S, W, U, V; worst swap jump 0.02 m; widest path-route sample gap 26 m, at W), course QC strict 0 fail / 0 warn on the new area (one hillside path dropped, `dropStreets`), clipping 0 fail · 105 warn (88 vehicle-clips-solid). Draw calls / triangles: 174–321 and 0.8–1.5 M along the area (8th Avenue the busiest), at the portal S 343–353 / 1.6 M with the GAP area drawn and 158–162 / 1.1 M with the core drawn (the GAP area keeps SouthSide Works and Hazelwood both within its building radius)
- [x] 5.6 Allegheny loop (4): from the Water Steps (A) east on the North Shore Trail past PNC Park to P (the 16th Street Bridge's north end, where a path leaves for River Ave), by Washington's Landing to N (the 31st Street Bridge's north end, the River Ave link), on the Millvale Riverfront Trail to Millvale Riverfront Park, up the switchback to the 40th Street Bridge, down Butler St through Lawrenceville and Penn Ave to M (Smallman & 29th), Smallman St through the Strip past the Heinz History Center, Penn Ave's bike lane into downtown and 6th St to B, the Clemente Bridge's south end. It joins there because Penn Ave and 6th St lead straight onto the bridge end where the loop already turns down to the riverfront, at street level; E (Smithfield & Fort Pitt) has no free real arm (Smithfield north is the loop's own approach, Fort Pitt west of it is reached only across the loop). A>E is now A>B (Clemente Bridge, 1.00 km) + B>E (the Point and downtown, 3.09 km); saved routes with A>E map onto both. New edges: A>P 1.78 km (+6 m), P>N 1.27 km (+2 m), N>M 4.94 km (+27 m), M>B 3.14 km (+7 m): the loop from the Water Steps is 12.1 km, +43 m. The tour (54.0 km) now starts at the Water Steps and ends at H; its ghost is B→E (the Point and downtown again), so the Water Steps is the scenery start again (F10). H moved 180 m east to where the 27th St path meets the riverfront trail (the tour's last 140 m ran on top of the I>H / H>G pass: a cusp on the East Carson → Hot Metal Bridge turn). OSM area north to 40.486, ground grid to 40.488: 32,397 buildings, 7,541 streets, city data 2.9 MB (was 2.0). build_city: `heightPins` (the Clemente Bridge's south end level with Fort Duquesne Blvd — the z14 ground falls off the river wall there — and the Water Steps ramp leaving the trail level), `dropStreets` (F21), ghost bridges still shape the profile, a deck that runs into a ghost keeps only its real part, and profile keeps sit on the profile's own samples (they were off by the chord drift, ~100 m by 50 km). 13 junctions, 17 segments, 17 presets (new: Allegheny Loop and its reverse 12.1 km, Allegheny & Jail Trail Loop 27.6 km +132 m). QC: tests 168 pass, `qc:network` 96 ways clean, course QC strict 0 fail / 0 warn (two reviewed Millvale spots accepted, F23), clipping 0 fail · 1,157 warn (813 on 40 km; F11). Draw calls 151–467 and 1.0–2.9 M triangles on the new streets (Butler St the busiest), 204 calls / 1.17 M in Oakland (was 205 / 1.10 M)
- [x] 5.7 Polish Hill & Bloomfield (11) + close gap L: a fifth area, `pittsburgh-polish` (10.71 km line, built from legs: the recipe's first new area). Junctions M (Smallman & 29th, the Allegheny's portal as it was), X (Liberty Ave & 29th St), T (Dobson St & Herron Ave, Polish Hill) and L (Forbes & Bigelow by Schenley Plaza, a portal on Oakland's line: I>J split into I>L 3.43 km and L>J 0.87 km, the Oakland line itself unchanged; saved routes with I>J map onto both, `keysToIds`). Segments: M>X 29th Street 0.18 km; X>T Liberty Ave, the 28th Street Bridge, up Brereton St past Immaculate Heart of Mary and Dobson St 1.13 km (+49 m); T>X down Herron Avenue's hairpin and its bridge, Liberty Ave back to 29th 1.23 km (−43 m); T>L Herron, Bethoven St and the Bloomfield Bridge, Liberty Ave through Bloomfield, S Millvale Ave, Centre Ave, N Craig St, Fifth Ave past the Cathedral of Learning and Bigelow to Forbes 4.62 km (+65 / −58 m). Gap L closes at Forbes & Bigelow itself (the crosstown ends on the Oakland line). Streets as mapped, no steps. Presets (all new): Polish Hill Climb Loop (X>T, T>X) 2.4 km +50 m short/hilly; Polish Hill, Bloomfield & Oakland Loop (from the Strip, down Junction Hollow and the Jail Trail, Penn Ave home) 19.6 km +173 m varied; Allegheny, Polish Hill & Oakland Loop (from the Water Steps) 25.4 km +202 m long/varied. The line: aprons N>M and M>B through M, a ghost back to M, the area's segments (a ghost repeats X>T so T>L leaves T), then aprons I>L (back) and L>J with a ghost between. Aprons are the neighbours' own samples: `build_city.py` legs with `"samplesOf"` (`splice_samples`: routed like any leg for the city data, then replaced by the neighbour line's points; a zig in the routed ghost makes the length up to a whole 10 m step, routed ghost ends snap to their junction, `heightPins` with `"everyPass"` level the passes of a steep junction — T and X). QC: tests 196 of 196, `qc:network` clean (16 junctions, 138 ways; swaps on the new presets worst jump 0.02 m, never a ghost under the rider), course QC strict 0 fail / 0 warn on every route and area (7 reviewed spots accepted in the area's `qcAccept`, F61/F62), clipping 0 fail · 75 warn (polish; Oakland's line and scene unchanged). Performance (snapshots, balanced): 182–241 draw calls and 0.9–1.2 M triangles on the area's streets (Bethoven St / Bloomfield Bridge the busiest), 150–217 calls and 0.86–1.36 M at the portals with both areas resident (heap 1.2–1.8 GB headless); L and M seen from both areas show the same streets and road
- [x] 5.8 North Side (6): a new area `pittsburgh-northside` (18.64 km line). It joins the core at two new portals on the core's old D>A, which split into D>C (0.82 km), C>R (0.31) and R>A (1.43): **C** West End Bridge north end (the bridge ramp meets Western Ave; Fulton St leaves for the riverfront) and **R** Ridge Ave by the Rivers Casino (the riverfront path leaves Ridge Ave). The Water Steps (A) has no way north of its own (the trail both ways and A>B's path; the rest are steps), so the loops leave it along R>A. Edges: R>Y Allegheny Commons & Mexican War Streets (2.34 km, +70 m: Ridge Ave past West Park, Arch St by the National Aviary, Randyland at Arch & Jacksonia, up Federal St), Y>Z Fineview (1.83 km, +94 m: Belleau St, down Meadville St to the Fineview Overlook on Catoma St, up Lanark St, Marsonia St, Mountford and Lafayette Aves, Federal St Extension), Z>Y Perrysville Avenue (1.44 km, −56 m: its bends down to Federal St), Z>C Riverview Park & Brighton Road (10.17 km, +91 / −205 m: Perrysville Ave north, Riverview Ave round Observatory Hill below the Allegheny Observatory, Riverview Drive, the Davis Avenue Bridge, Davis Ave, Brighton Rd down through Marshall-Shadeland, Western Ave to the bridge). Junctions Y (Federal St & Perrysville Ave) and Z (Perrysville Ave & Federal St Extension). Streets only, steep ones as mapped (Fineview to ~18 %). Presets: North Side Hills Loop and its reverse (17.5 km, +272 m), Fineview Climb Loop (10.8 km, +191 m, short), Three Rivers & North Side Loop (32.4 km, +476 m, long/varied); every old preset with D>A rides D>C, C>R, R>A (the same metres). After the merge with 5.5 and 5.7: 24 junctions, 35 segments, 31 presets, 7 areas. The line: an apron copied sample for sample from the core (D>C's last 400 m, C>R, R>A's first 460 m: build_city `copy`), a ghost back to R, R>Y, Y>Z, a ghost round the block north of Z, Z>Y, a ghost up Federal St Extension, Z>C. QC (after the merge): tests 202 pass, `qc:network` 210 ways through 24 junctions clean, every preset across the areas (worst jump at a swap 0.03 m), course QC strict 0 fail / 0 warn on every route (10 reviewed North Side spots accepted), clipping 0 fail · 284 warn (F59). Draw calls 149–380 and 1.0–1.75 M triangles in snapshots along the area; at the portals with the North Side drawn 234 calls / 1.47 M (R) and 188 / 1.04 M (C)
- [ ] 5.9 Dirty Dozen south (8) + close gap Q; cobblestone surface for Canton Ave
- [x] 5.10 East End (5): an area of its own, the East End (`pittsburgh-eastend`, 27.14 km line built from legs; its own segments 19.46 km). Junctions **LB** (Butler St & 40th St, Lawrenceville: a portal on the Allegheny's line at the 40th Street Bridge's south end, N>M split into N>LB 3.28 km and LB>M 1.67 km; the Allegheny line itself unchanged, saved routes with N>M map onto both), **HE** (Highland Park: Bunkerhill St & One Wild Place, where Mellon Terrace, Bunkerhill and the zoo road meet), **HP** (N Highland Ave & Stanton Ave), **EL** (Penn Ave & Shady Ave, East Liberty), **SQ** (Forbes & Shady, Squirrel Hill) and K (Schenley Drive & Forbes, a portal on Oakland's line, apron-free there: Oakland's data untouched). Two-letter junction ids: build_network and js/network.js already parse any id ("LB>HE+": `/^(.+)>(.+)([+-])$/`), now tested (split chain N>M → N>LB, LB>M; the planner at HP). Segments: LB>HE Stanton Avenue & N Negley Avenue 5.89 km (+136 / −71 m: Butler St, the long steady climb up Stanton Ave over Stanton Heights, down to N Negley and up Mellon Terrace to the park gates); HP>HE Highland Park Reservoir & Lake Drive 3.75 km (+48 / −39 m: Stanton Ave along the park, Lake Drive past Lake Carnegie and round Reservoir No. 1 to the zoo gates); HE>HP N Highland Avenue: the park entrance 1.38 km (+19 / −28 m); HP>EL N Highland Avenue: East Liberty 1.35 km; EL>SQ Bakery Square & Beechwood Boulevard 3.29 km (+72 / −10 m: Penn Ave past Bakery Square, Fifth Ave, Beechwood Blvd up past Mellon Park, Forbes to Shady); SQ>EL Shady Avenue 2.54 km (+8 / −69 m); SQ>K Forbes Avenue: Squirrel Hill 1.26 km (+11 / −24 m). Streets and park roads only, no steps. Presets (all new): East End Loop from Schenley Park (K) 16.2 km +203 m varied; Squirrel Hill & Bakery Square Loop 8.3 km +116 m short/hilly; Highland Park Reservoir Loop 5.1 km +67 m short/hilly; Stanton Heights & Highland Park Climb (from Lawrenceville, there and back with a reservoir lap) 16.9 km +274 m hilly; Allegheny, East End & Oakland Loop (from the Water Steps) 36.9 km +377 m long/varied. The line: aprons N>LB (the whole 40th Street Bridge, 1,000 m) and LB>M with a ghost back to LB, then LB>HE, a ghost HE→HP (N Highland), HP>HE, HE>HP, HP>EL, EL>SQ, SQ>EL, a ghost EL→SQ (the Bakery Square way), SQ>K, and Oakland's J>K (back) and K>J aprons with a ghost between — ordered so the straight-on ways at HP (N Highland) and EL (Penn Ave) are ridden on one pass (junction passes 10–14 m apart where a corner is rounded; two passes of a junction that both turn put a straight-on across them, a 0.6–0.7 m hop in the pose). build_city: `inlandWaterAboveM` (water polygons up on the hills — Highland Park's reservoirs, Lake Carnegie, the zoo's pools — were pressed down to the rivers' level: 100 m pits; off by default, F81). QC (18 Nov, after merging the North Side): tests 204 of 204, `qc:network` clean (29 junctions, 260 ways; every preset across the areas), course QC strict 0 fail / 0 warn on every route and area (7 reviewed spots accepted, F83), clipping 0 fail · 68 warn. Performance (snapshots, balanced): 141–397 draw calls and 0.8–2.0 M triangles along the area (Stanton Ave's climb by the Stanton Heights apartments the busiest), at LB 260–322 / 1.5–1.8 M, at K 231–242 / 1.0–1.1 M (heap 0.6–1.7 GB headless); LB seen from both areas shows the same streets
- [ ] 5.11 Final QC, performance check on the Air, PR

*5.4 Area loading design (18 Nov 2026 — "areas, short load")*
- **An area** is a piece of a city built exactly like today's single world, from its own files: a base line (`routes/cities/<city>-<area>.gpx`: one open line, 10 m samples), a city config (`tools/city/<city>-<area>.json` → city data `routes/scenes/<city>-<area>-city.json`), a terrain grid (`…-terrain.grid.bin.gz`), a scene (`routes/scenes/<city>-<area>.json`, its metre keys on its own line, its own `qcAccept`) and a network fragment (`tools/city/<city>-<area>.network.json`: its junctions, segments and presets). Each area has a catalog entry `<city>-<area>` with `"area": "<city>"`: not in the route list, but the QC tools, snapshots and the preview open it like any route. An agent building an area touches only its own files, plus one line in the city's network spec (`areas`) and presets that cross into it.
- **One frame per city.** The city spec sets `origin` (lat/lon): every area of the city is projected around it, so the same street is at the same x/z whichever area draws it. City data and terrain grids are built on a city lattice (`lattice` in the city config: an anchor and the cell sizes; grids snap to it), so where two areas overlap their heights are the same samples.
- **The network spans areas** (`bikefree-network-2`): each segment (edge) belongs to one area and is an interval of that area's line; a junction where segments of two areas meet is a **portal**, found on both lines (`passes` per area). An area's line also runs an **apron** along every other area's segment at its portals (≥ 400 m, the whole segment if shorter): drawn as route — road, kerbs, street kit, junction curves — but not a segment of this area (`routeAprons` in the city data; `aprons` in the network: which segment, which way, from where). Ghost stretches stay the way a line repeats itself; areas shorten them (no line has to go back through another area).
- **Which area is drawn:** one at a time. The area drawn keeps drawing while it covers the rider's place and the next 200 m of the path (its own segments or its aprons); when it doesn't, the area that covers the rider and reaches furthest ahead takes over — so the swap happens inside an apron, 200 m beyond the portal, with the junction itself seen whole on either side of it, and where both areas show the same streets. Poses are taken on the drawn area's line (the path maps onto aprons too: `worldAt(p, area)`), so the rider always rides the road that is drawn; a turn between segments of two areas is a curve like any other (straight on is seamless where the drawn line runs straight on).
- **Residency:** the area drawn is always loaded; an area the path (and the pacer's) enters within 1.5 km ahead is loaded and built hidden (scenery data, its ground and city chunks streamed around the camera at a small frame budget, life not ticked), so it is ready at the swap; an area not drawn, not within 1.5 km ahead and not within 600 m behind is released (disposed). If the swap comes before the area is ready: a short fade to the sky colour, wait, swap, fade back — the ride carries on underneath. All areas' GPX lines load with the network (small): path routes, minimap, planner, thumbnails and recording need them; the heavy scenery (city data, terrain grid, scene) only when the world needs it.
- **Shared in the world:** renderer, sky, lights, post and look, weather (one set of scenery uniforms for all areas), rider, pacer, course arches (placed on the drawn area's line, else their own). Per area: scenery (StylizedTerrain: ground, city, buildings, life), road and shoulder ribbons, route index, junction plan. Baked light bakes the drawn area; after a swap the ride re-bake (time-sliced, the old bake in use until it's done) takes over — around the swap both areas are the same streets, so the old bake fits there.
- **Unchanged for the rider:** the path route (samples copied from each segment's own line), prompt, lock, curves, speed cap, laps, profile, pacer (`PathFollower`), presets, free ride, planner, recording — all network-level, area-agnostic. Minimap, planner and thumbnails draw each segment from its own line. Life: each area's people and traffic run while it is drawn; nothing is carried across a swap (it happens 200 m past a junction, where the life of both is placed from the same streets).
- **Catalog and saved routes:** the city keeps one catalog entry (`pittsburgh`) with its presets; its `file`/`scene` are the first area's (the scenery choice and previews). Segment keys ("E>I") are city-wide, so presets, free ride and saved routes (`settings.netRoutes`, `keysToIds`) carry on.
- **QC per area:** `qc_course --strict <city>-<area>` and `qc_clipping <city>-<area>` on each area's line; `qc_network` rides every way through every junction, portals included (poses on the drawn area at each step, crossing the swap); `build_network --check`; unit tests ride across each portal (no jump, road under the rider in the drawn area, prompt and minimap continuous); `snap --path` across a portal.
- **Performance:** one area drawn → draw calls and triangles at a boundary are one area's (≤ today's whole tour; target ≤ +25 %); memory: two areas' scenery resident near a portal (each smaller than today's tour). Building an area is main-thread work, done ≥ 1.5 km before the portal.
- **Migration (Pittsburgh):** Core — downtown, the North Shore, the South Side, Mount Washington, the Jail Trail, the Hot Metal and West End bridges; West End — Elliott and the overlook (D>O); Oakland & Schenley (I>J, J>K, K>J); Allegheny & Troy Hill (A>P, P>N, N>P, N>M, M>B). Portals: I (Core / Oakland), D (Core / West End), A and B (Core / Allegheny). Core: A>B, B>E, E>G, G>H, H>G, G>D, D>A, E>I, I>H. Each area's line is cut from today's tour on its own 10 m samples (`tools/build_city.py` `slice`: the master legs routed as today, then the pieces kept), so every segment keeps its exact length and every preset its lap, and scene metre keys move by an offset. Allegheny & Troy Hill arrived on the tour (5.3/5.6) before the split and became the fourth area the same way.

*Adding an area (the recipe — an agent touches only its own files and two shared lines)*
1. **Plan its line**: one open line (`legs`, as any city config) through the area's own segments, plus an **apron** — a leg with `"apron": true`, ≥ 400 m — along every other area's segment at each of its portals, and `"ghost": true` legs where the line has to go back to a junction. A portal is an existing junction: use its id and name as the neighbour's network fragment has them. The neighbour's files need no change: where the neighbour has no apron on the new area's arm, the swap happens 200 m before the portal, inside the new area's apron.
2. **City config** `tools/city/<city>-<area>.json`: the legs, `"lattice": "<city>"` (heights on the city's grid lattice), the city's settings (water, radii, styles); `"osmCache": "<city>"` while its OSM box covers the area (a new box: its own cache). Build: `python3 tools/build_city.py <city>-<area>` → `routes/cities/<city>-<area>.gpx` and `routes/scenes/<city>-<area>-city.json` (with `routeAprons`, `routeGhosts`).
3. **Scene** `routes/scenes/<city>-<area>.json`: a sibling's city-wide settings (look, lighting, palette, weather, `origin`, `terrainBuild` with the shared `box` and `lat0`), its own metre-keyed items (road zones, street-kit zones, signs, views, `qcAccept`) on its own line, its `preview`. Then `python3 tools/build_terrain_grid.py <city>-<area>`.
4. **Catalog**: an entry in `routes/catalog.json` — `id`, `name`, `park`, `file`, `scene`, `expectedKm`, `eleSmoothM` as the city's, `"area": "<city>"` (not listed; QC, snapshots and the preview open it).
5. **Network**: `tools/city/<city>-<area>.network.json` (`nodes` it passes — portals included —, `edges` it owns with names both ways, presets inside it), one line in `tools/city/<city>-network.spec.json` `areas`, and presets that cross areas there. `node tools/build_network.mjs` (checks a portal is the same place and height on both lines, matches every apron to its segment), then `npm run routes:build`.
6. **QC**: `npm test`, `npm run qc:network` (every way through every junction; every preset across the areas: no jump at a swap, never a ghost under the rider), `node tools/qc_course.mjs --strict <city>-<area>`, `node tools/qc_clipping.mjs <city>-<area>`, snapshots either side of each portal and of the same spot in both areas: `npm run snap -- --path <ids> --area <a> <city>@<m>`.
7. **Legs-built areas** (5.5): start the line in an apron at a portal and set `trimStartM` so the app's samples (10 m along the GPX chords, `buildCatalogRoute`) coincide with the neighbour's along the apron (measure the phase and re-trim after every change of the line's start); order the legs so the line passes each junction on through rather than turning round at it; an OSM box reaching past the shared cache's first box gives `osmOrigin` (the cache's lattice corner).
(Pittsburgh's four were cut from the one tour instead: `"slice"` in their city configs and `tools/slice_scene.mjs` for their scenes — the migration's way of keeping every metre; new areas use legs.)

**Follow-ups found along the way**
- [x] F1 Minimap and card thumbnails draw the path route, laps on top of each other (→ 2.2)
- [x] F2 The classic "Three Rivers Loop" and the network "Three Rivers Loop · choose your turns" are both listed (→ 2.1: one entry)
- [x] F3 The pacer follows your path as it is now; if you change a turn after the pacer has passed that junction it jumps to the new path → the pacer rides its own copy of the path (`PathFollower`, js/network.js): it takes your path while the way up to 30 m ahead of it is still yours (turns you change ahead of it included); a turn you change behind it (or in its curve) leaves it on its way, carrying on along the plan (else straight on), and it takes your path up again if you change the turn back. Its grade, its place in the world and its minimap dot follow its own way; test in `test/network.test.mjs`
- [x] F4 Route traffic (cars that overtake / wait behind you) follows the loop's direction; check on the bike that it behaves after a turn onto the other half of the loop
- [ ] F5 At the Water Steps the loop's start/finish is a junction with only straight on or back (kept: "Back" is offered at every junction; it gains real arms with segments 4 and 6)
- [x] F6 Headless runs can't ride in real time (software rendering): the on-bike check covers the feel of the turn, the camera swing and the prompt timing
- [x] F7 Road meets near the route: 36 sites with issues within 25 m (was 20 on the loop; the Jail Trail corridor's parkway ramps and bridge ends added most). The QC budget is 36 for now; fix the sources the s2 way and bring it back down → 29 in the course QC (27 in the unit test), budget 30. Left: street-ribbon overlaps with no junction (0.03, 0.52, 0.78, 21.6, 25.6, 33.1, 34.3, 36.1, 36.6 km), other ribbons inside junctions (25.75–25.95, 29.94, 34.55, 35.83, 39.02 km), street-vs-road steps (17.2, 30.44, 34.57 km), path ends by 17.65 km
- [ ] F8 Reviewed corridor warnings accepted in the scene (`qcAccept`): street creases beside the Jail Trail (1.60, 2.42, 3.98, 4.71 km), the ground mesh beside its ledge (2.48, 2.72, 3.72 km), the mapped jog from 27th St to the riverfront (23.05 km)
- [ ] F9 Fort Pitt Blvd's first 100 m from Smithfield are mapped as a bridge (a girder deck is drawn): check it looks right
- [ ] F11 Clipping QC: 0 fail, 551 warnings (main 420 on an 18.3 km loop; the tour is 23.2 km): mostly vehicles clipping solids (416), streets under ground (63), trees in solids (33) — review the corridor's share
- [x] F12 Where the Jail Trail leaves Smithfield St the two route ribbons overlap and show a dark V-shaped seam for a few metres → not the ribbons: the road-surface shader (road-surface.js decorateRoad) padded its unused zone slots with THREE.Vector4() = (0, 0, 0, 1), so they never ended its zone loop and read as zones at 0–0 m with every setting 0, blended over the first 20 m of every decorated road — a 0 m paved width drew the gravel shoulder and edge lines in a V. Slots are now all zero
- [ ] F13 A saved route whose segments disappear in a rebuilt network (a segment split by a new junction) shows "plan it again"; map the old segment onto its new pieces instead
- [ ] F14 West End hillside: steep side streets beside the spur sit off their ground in places (accepted in `qcAccept`: 5.18, 12.70, 13.24, 13.42, 13.43, 14.95, 16.13, 26.54 km) — rework their heights from the terrain
- [x] F15 Road meets: a 0.5 m lip at a side-street junction beside the route at 12.43 km (by the West End Bridge); own-junction bound 7, near budget 38 for now (with F7) → own-junction issues 11 → 0 (bound 1): no route arm into a ghost repeat (the 0.47 m lip at J, 12.87 km); route junctions under the road as drawn (its curve), not its 10 m chords (lips at the route's mouths, 12.33, 26.60 km); street ends sunk under the road where their mouth reaches onto it (6.51, 20.38, 25.68, 35.83 km); mouths of streets passing above the road not capped down to it (34.25 km); no crosswalk inside its own junction (12.39, 34.55 km); an end eased by alignAlongRoute leads the street carrying on from it (the 0.82 m link step, 1.48 km)
- [x] F16 Clipping QC after 5.1: 1 fail — a bus passes through the rider at 12.34 km on the return (by junction D, West End Bridge south); the life sim harness also shows cross-street cars passing within 1 m of the rider at 0.5, 5.6 and 20.0 km (not flagged by its in-lane check). Hold cross traffic at the route's junctions while the rider is near; 740 warnings (F11) → root cause on the 40 km tour: a side street that ends on the route (a T) is cut back to the route's kerb, and a vehicle at that dead end stopped with its *middle* at the cut end to turn round — a bus's nose (6 m) reached ~1 m from the rider (the life sim's one finding, 39.0 km on the return at 9 m/s; the 12.34 km QC fail by junction D was the same kind of T). Now it stops with its front at the end. The kerb/stop-line logic itself held at crossings, turns through junctions and edges ridden backwards; network rides add one more case: after a turn at a junction the rider's base-route place jumps, and oncoming traffic on the street they left vanished in view — it now drives on until out of sight. Life-sim harness: no vehicle body within 1.5 m of the rider's (oncoming in its own lane: 0.5 m), debug lines with `LIFE_SIM_DEBUG=1`; `simulate(…, {plan})` rides a network lap as the world places it (`test/city-life-network.test.mjs`: Oakland & South Side, Mount Washington there and back — all clean). (Riding the base route at 5 or 14 m/s instead of 9 still shows a few older person/jump findings — trail walkers, not vehicles — left for a later pass) Clipping QC after 5.3/5.6 (58 km tour): a bus through the rider at 22.81 km on Second Ave — a bus street cut back short of the route beside it (running close and almost parallel) left a 42 m dead end; turning round, a vehicle pivots about its middle and swaps lanes, and the bus's nose swung into the road. Now vehicles turn round where that swing stays a lane + room clear of the route's road (`_turnRound`, also at ways that end on the road), and never drive into a dead end without room to turn and brake for it (`_turnOk`, spawns too). Harness: every dead end near the route driven into by a car and a bus, left to turn round — no corner on the route's road (`deadEndTurns`; 9 failed before); `simulate(…, {seed})` draws the life anew
- [ ] F17 Oakland & Schenley accepted warnings (`qcAccept`): tight real corners (Joncaire, the Serpentine Drive switchback, Panther Hollow Rd link), a street by Phipps the ground hides (8.53 km), Second Ave and the bridge ramp at junction I (17.2 km), a downtown street crease (34.55 km). Road meets: own-junction bound 11 (a 0.47 m lip at J, paint inside the Panther Hollow link junction) — part of F15
- [x] F18 Forbes Ave through Oakland is one-way outbound: riding I>J backwards (Phipps to Junction Hollow) uses the same carriageway against its traffic → **decision (17 Nov): Forbes stays the route both ways** (no Fifth Ave reverse). Traffic handling: the city life finds the route's one-way stretches from the map (a one-way street under the route's centre line, running along it: Forbes 7.17–7.53 and 8.00–8.18 km, and a few in Schenley Park, downtown and East Carson) and draws no oncoming traffic on them, whichever way you ride — it would drive against the one-way or meet you head-on. Cross traffic is unchanged (it waits at the kerb), and the route's own streets carry no other traffic in Pittsburgh (the overtaking / waiting-behind traffic kit, `toolbox/life/traffic.js`, is the highway scenes'). Life sim: no oncoming car on a one-way stretch near the rider (Forward, Reverse, and the Oakland & South Side lap, which rides I>J backwards)
- [x] F19 Boundary St (6.43–6.60 km) looks pale in snapshots, as if the rider's lane were paved like a sidewalk, though the route road is the top surface there; find what draws it. → The route shoulder of a ghost repeat: cutting the shoulder at junctions (cutRouteRibbon) rebuilt its index and put back the quads makeRibbon leaves out (ghost stretches, hairpin apexes); the ghost pass's pale shoulder lay a few cm above the real pass's road. Cut now keeps them out (also a pale band through the junction at 7.40 km). Clipping QC after 5.2: 0 fail, 813 warnings (F11); the street kit no longer lays sidewalks, trees or trail furniture along ghost stretches
- [x] F10 The tour's Water Steps start is no longer the route's start: Pittsburgh as free-ride scenery now rolls along the tour from Smithfield & Fort Pitt (→ 5.6: the tour starts at the Water Steps again)
- [ ] F20 Road meets the Allegheny Loop added near the route: 5–7 m junction steps where the 31st Street Bridge's ramps meet River Ave beside the trail at N (3.30, 3.35 km), a link gap on the Millvale ramp (5.03 km), a 0.89 m step at the Clemente Bridge's south end (46.94 km). Budgets raised to fit this map: `nearBudget` 52 (course QC counts 45, the unit test 51), own-junction bound 14, sites with issues < 85 — re-base them with the F7/F15 fixes
- [ ] F21 The stylized ground's 96 m patches are laid from the projection's centre, which moved 1.45 km north with the map: marginal ground spots on the old tour moved with it. The West End spur below Chartiers Ave (40.89 km) buried its shoulder by 4 cm under the 6 m mesh, pulled up by Janewood Way's flat grading 12 m uphill; that alley is left out of the city data (`dropStreets`). Rework the hillside streets' heights (F14) and bring it back
- [ ] F22 Heights set by hand (`heightPins`): the Clemente Bridge's south end at 223.6 m (z14 ground 220.3, on the river wall) so B is one height from 6th St and off the bridge; the Water Steps ramp to General Robinson St level with the trail for ~45 m, then ~9 % (otherwise the North Shore Trail's shoulder is buried where the two part). Check both on the bike
- [ ] F23 Millvale: the trail climbs to the 40th Street Bridge by a service road and the sidewalk beside the Route 28 ramp — a real switchback (heading-jitter at 5.02 km accepted), its ramp roads overlap (road-meet overlaps 5.01–5.13 km), and the bridge's north approach floats over Route 28 (5.42 km accepted)
- [ ] F24 Busier city: up to 467 draw calls and 2.9 M triangles on Butler St (6.5 km; the loop's busiest was ~307 / 2.1 M); the clipping QC builds 7.3 M triangles and once crashed headless Chrome when run beside snapshots — check frame rate on the Air (5.11)
- [ ] F25 The free ride (from the Water Steps over the Clemente Bridge) now runs straight on into Penn Ave and the Strip, the Allegheny Loop backwards; the junction test's street-overlap bound is 16,500 m (~18 m per km of street, as before)
- [ ] F26 Troy Hill: the 31st Street Bridge's north end is a knot of Route 28 ramps — River Ave rides up its viaduct 13 m from the trail, and the junction surfaces there have 5–7 m lips (3.30, 3.38, 7.37 km); a Troy Hill side street off Troy Hill Rd sits in a trench (4.51 km, accepted). Road-meet budgets with Troy Hill: `nearBudget` 58 (course QC 54, unit test 57), own-junction bound 21 (F20)
- [ ] F27 The life sim's Reverse ride on this branch's code puts a car in the rider's lane at McArdle's foot (39.89 km, t = 2015 s); with the main line's F16/F18 traffic fixes and this map it passes (checked in a throwaway copy) — recheck after the merge
- [ ] F30 Building an area is main-thread work, seconds long: here (headless Chrome, Linux) Oakland's landscape 2.5 s and city 5.6 s, the core's landscape 5.3 s (Node). A planned ride builds its areas at the start, behind the loader, and keeps them, so it never stalls; off the plan (a free ride, a turn into an area the plan doesn't visit) the area is built 1.5 km ahead and the view stalls for that long. Most of it is the street processing chain (road-meets: resolveOverlaps, followMovedNodes, joinCrossings, planJunctions — ~60 % in a profile): bake its result into the city data at build time (it is deterministic from the data), or build in a worker / in frame-sized slices
- [ ] F31 Life isn't carried across a swap: the people and traffic of the area drawn before vanish and the new area's are there (200 m past a portal, where both are placed from the same streets). The life sim judges each area alone and doesn't count the swap step (`test/city-life.test.mjs`); a fade-in of the new area's life near the rider would hide it
- [ ] F32 Baked light after a swap: the new area re-bakes in the ride's time slices (the old bake meanwhile: right near the portal, unshadowed far off until done)
- [ ] F33 An apron ends 400 m from its portal where the street carries on: the route-quality ribbon stops there (seen from the swap point, 200 m off); fade it into the street, or end aprons at the next junction
- [ ] F34 The shared frame (the city `origin`) moved Pittsburgh's random scatter (plants and trees are seeded by tile, in the frame): a different layout, about as dense; review the hero spots' planting
- [ ] F35 Free ride: only the areas within 1.5 km of the start are built at the start (there is no plan); a free ride builds the others as it reaches them (F30)
- [ ] F36 Area QC: two accepted warnings new with the areas — a mesh-coarse spot beside Troy Hill Rd (Allegheny 3.98 km, the shared frame moved the ground patches) and the West End Bridge approach's street crease 10 m earlier on the West End's apron than the core's accepted one; the junctions test skips route points on a ghost (the merged tour's 0.59 m junction at E sat on the B→E ghost's end)
- [x] F38 The life sim's cross-street cars: one in the rider's lane ahead on the core's Forward and Reverse rides (way 971, McArdle's foot/Second Ave side; main shows the same kind with `seed: 3`, way 1012) — a random draw of the dead-end/stop-line logic, the traffic agent's area → causes: (1) a car only looks for the route's road on its own way and the next (55 m): on a fast street (McArdle's foot, 22 m/s) into a short junction way it first saw the crossing 22 m off, with the rider near, and could not stop — cars now drive no faster than they could stop at the kerb for the nearest crossing on any way beyond (`_roadAhead`, while it isn't clear); (2) a car placed at the start of a ride just before the road (main's seed 3) — spawns keep a braking distance from it; (3) on a network lap, oncoming traffic that passed the rider just before a "Back" was then ahead in their own lane — the world passes the next U-turn on the path (`NetRide.uturnAhead`, `rider.uturn`) and oncoming traffic doesn't meet the rider within 80 m of it. The harness's lane check skips ghost stretches (a car at its kerb beside an undrawn ghost was flagged). Core Forward/Reverse clean (seed 3 too); tests 194
- [ ] F37 Pittsburgh's scenery choice (no route: workouts, free time) is the core area alone; the Allegheny, Oakland and the West End are reached only by network rides
- [ ] F40 A route saved before junction I (with E>H, the Jail Trail and the Hot Metal Bridge) now maps onto E>G, G>H (the Smithfield Street Bridge and East Carson): `splitChain` takes the fewest segments, and with S the Jail Trail way is three. Keep a key history (old key → its pieces) in the network, or the lengths in saved routes. Routes saved with I>H map right (I>S, S>H)
- [ ] F41 `streetKit.clearRouteCrossings` (no route sidewalk across another pass of the route) is on for the GAP area only; the same overlap is in the core (11.6 km, at G), Oakland (3.0, 6.6, 8.8 km) and the Allegheny (River Ave beside the trail at N, 3.5 km: there the trail runs alongside, so limit it to crossings) — review the snapshots and turn it on city-wide
- [ ] F42 The Homestead Grays Bridge isn't ridden: the loop passes under it, on the trail and on Waterfront Drive. A loop over it needs the Glenwood Bridge as well (the Grays Bridge, Browns Hill Rd or Beechwood Blvd down to Second Ave through Hazelwood, the Glenwood Bridge, whose south end is a Route 837/885 interchange above the GAP): ~8 km, a segment of its own later (the GAP's 7 km from S to W has no junction: the Glenwood Bridge would give it one)
- [ ] F43 Two short links fill gaps in the map: the GAP's end to East Waterfront Drive at U (13 m; the mapped way is a sidewalk and a crossing a few metres west) and Waterfront Drive West to the GAP at W (26 m, by the trail's steps; the mapped crossing is a driveway 60 m south-west). Look at both on the bike
- [ ] F44 The shared terrain box ends 5.5 km south and 5.9 km east of the Pump House (the other areas sit ≥ 9 km inside it): the far ground to the south-east (West Mifflin, Kennywood) stops there. Kept, as a bigger box means rebuilding every area's terrain grid; do it with the next box change
- [ ] F45 At S's swap (riding from H, 110 m from H) the core paints the South Side Trail with a double yellow centre line, white edge lines and a darker patch, the GAP area with white dashes: the paint changes at the swap, though the stretch is `trail` in both areas' route kinds (the GAP area itself shows both kinds of paint on its trails: dashes on the GAP, double yellow on the Homestead riverfront). Find what picks the paint and make the two areas agree
- [ ] F46 Junction W's two passes on the GAP area's line are 17 m apart (the line rounds the GAP's turn off the drive one way and the link to the drive the other; the area's `maxDriftM` is 12, the tour's 16 put them 21 m apart and gave a 0.6 m pose step on the river → GAP turn): curves and the turn prompt look right in `qc:network`; check them on the bike
- [ ] F47 The life sim's Reverse ride on the GAP area (default draw, and `seed: 3`) puts one walker in the route's carriageway at S (t ≈ 1722 s, life way 381, 4 m from the line where the GAP leaves the Hot Metal St / South Water St knot); Forward and seeds 1–2 are clean. The same family as F38 (people crossing at a junction while the rider is near) — for the life agent; `npm test` shows it as a third failing life ride until then
- [ ] F48 The shared OSM cache (`tools/.cache/osm-pittsburgh`, not in git) gained tiles south and east of the old box (lattice indices x 6–16, y −5–2): another checkout fetches them on its first `build_city.py pittsburgh-homestead`
- [ ] F49 Clipping on the GAP area: 0 fail, 105 warnings — 88 vehicles clipping solids (F11's kind), 5 trees in solids, 3 posts in solids, 3 streets under the ground, 2 floating, 2 building overlaps, a structure through a building, a z-fight on overlapping street ribbons (8.97 km): review the non-vehicle ones
- [ ] F60 Aprons built from legs (5.7: `samplesOf` / `splice_samples` in `tools/build_city.py`): the GAP (5.5, `trimStartM`) and North Side (5.8, `copy` on the first leg) branches solve the same problem their own way — merge onto one mechanism (splice handles copies anywhere on the line, as long as a routed ghost sits before each copy that follows a routed stretch)
- [ ] F61 Junction L: the area's line turns from Bigelow onto Forbes right at the portal, where its apron is Oakland's own samples, so the line's corner there is not rounded (heading-sharp/jitter accepted at 9.48–9.52 km and 11.88–11.92 mirrored); the ride turns on the junction curve. Same kind of join at M (29th St off Smallman), not flagged. Check the drawn ribbon at both on the bike
- [ ] F62 Craig St & Fifth Ave: a right-angle corner with buildings on it; the line rounds it only ~1 m (lateral-jump / heading-jitter accepted at 8.72–8.78 km) and the centre line kinks in snapshots — ease it (a `links` entry or a corner waypoint) or accept on the bike
- [ ] F63 Other accepted spots: a side street at the Herron Ave bridge meets its junction 0.3 m off (2.72 km), a Polish Hill side street by Bethoven St at −44 % in the map (5.51 km); neither is the route
- [ ] F64 Junction X (Liberty & 29th) sits 180 m from M: the M>X segment is short (the prompt for X shows just after M). It exists because 29th St between Smallman and Liberty is the only real way between the Strip and the Polish Hill loop that isn't the Allegheny's own Smallman/Penn
- [ ] F65 Herron Avenue's hairpin (T>X) and Polish Hill's steep streets are kept as mapped (~8–12 %); T and X are levelled across their passes (`heightPins` `everyPass`, ±1 m eased over 40 m): check the grades feel right on the bike
- [ ] F66 The Oakland area has no apron on the Polish Hill arm at L (its line wasn't touched): riding into T>L from Oakland, the swap is 200 m before L inside this area's I>L / L>J aprons, as the recipe allows
- [ ] F67 Fifth Ave (westbound one-way) and Bigelow are ridden with the traffic; Forbes west of L is the Oakland line's as before (F18). T>L backward rides Fifth eastbound against its one-way — check the life sim's one-way handling picks it up (no oncoming traffic there)
- [ ] F68 The area's scene is Oakland's settings (look, palette, kit, heroes); no signs, views or road zones yet (Bloomfield's Liberty Ave business district and the Immaculate Heart of Mary church could get dressing)
- [ ] F69 Unit tests list the areas and the network total by hand (`test/city.test.mjs`, `test/network.test.mjs`): each new area edits them — the merge of 5.5/5.7/5.8 has to sum all three
- [ ] F50 Junction letters C, R, Y, Z: C as planned (the West End Bridge's north end); R, Y, Z free after the Polish Hill and GAP merges (Q and F reserved for the Dirty Dozen)
- [ ] F51 No North Side arm at the Water Steps itself: its only non-step ways are the trail both ways and A>B's path north, so the loops from A ride R>A out and back (1.43 km). A cleaner A-side junction would be the Clemente Bridge's north end (Federal St & General Robinson, splitting A>B) with Federal St through Allegheny Center as a second way in
- [ ] F52 build_city (additive, only for a config whose first leg has `copy`): `copy` {gpx, data, fromM, toM, portals} copies a neighbour's samples as the apron (the line's end and ghost ends meet the portals on the copy's own samples, the end runs on the copy's line), ghost ends snapped to their legs' end waypoints, `heightPins` levelled on every pass (`"level": "first"`: the other passes take the first one's grade), portals levelled just under the copy; `routeBridgeMinM` (a 30 m Brighton Rd deck over the railway). The GAP area may need the same: merge the two
- [ ] F53 build_network: an apron that runs through two of the neighbour's junctions is matched edge by edge (the North Side's apron covers D>C, C>R and R>A)
- [ ] F54 QC and the city ground: `junction-over-road` counts only the road's other passes (60 m along it is the same pass, as the junction planner counts it: a tight corner up a steep street flagged its own chords); the course QC's draped city mesh honours `groundMesh.fineCells`, and a city scene can ask for it along `groundMesh.fineRanges` (js/world/toolbox/city/landscape.js `fineGroundAt`): 3 m ground on Riverview Ave's cut into Observatory Hill and the Riverview Drive switchback
- [ ] F55 Riverview Park: Riverview Ave climbs round Observatory Hill with a hairpin loop, and the Davis Avenue Bridge path leaves Riverview Drive at a switchback (ridden with the corner cap): check both on the bike. Z>C is one 10.2 km segment; a junction at Brighton Rd & Marshall Ave (Marshall Ave back to Perrysville) would give a shorter loop
- [ ] F56 Fineview's hill junctions Y and Z: graded flat (Z) or on Federal St's grade (Y) where the line passes them more than once; the overlook is a zigzag of Meadville, Catoma and Lanark Sts (a lateral step of 2.5 m in the curve, accepted)
- [ ] F57 OSM: a new row of tiles north to 40.494 (t_0_8 … t_6_8 in tools/.cache/osm-pittsburgh) for Riverview Park; the other configs' boxes are unchanged
- [ ] F58 Saved routes with D>A map onto D>C, C>R, R>A (keysToIds' split chain; tested). Edge ids moved (e7 on): saved routes are by key
- [ ] F59 Clipping on the North Side: 0 fail, 284 warnings — 239 vehicles clipping solids (F11's kind), 25 streets under the ground, 13 trees and 4 posts in solids, 3 z-fights. Brighton Rd's 30 m deck over the Fort Wayne Line (17.6 km) sits ~3 m over the z14 ground, which fills the railway's cut: a freight train drawn on that ground ran through the road, so the tracks are left out under the deck (`railGaps`); trains following real cuts belong to the life sim (life.js)
- [ ] F80 Junction ids of two letters (LB, HE, HP, EL, SQ): nothing needed changing (build_network and js/network.js take any id); the minimap and planner don't print ids. The free ride from the Water Steps now carries straight on at LB up Butler St to Stanton Ave (it went over the 40th Street Bridge to Millvale): the free-ride test follows it
- [ ] F81 `inlandWaterAboveM` (build_city, the East End only): reservoirs and ponds more than 10 m above the rivers' level are drawn as park, not water pressed to the rivers' level. The same pits are in other areas — Panther Hollow Lake and Westinghouse Pond (Oakland), Herron Hill Reservoir (Polish Hill), Lampher Reservoir (Allegheny/North Side box) — turn it on city-wide (rebuild those areas) and give hill water its own level later (a reservoir drawn as water at its own height)
- [ ] F82 Penn Ave meets Fifth Ave by Bakery Square in a real acute V: EL>SQ turns a ~140° hairpin there inside the intersection (heading-sharp accepted at 16.49 km, 37.77 mirrored). No junction, so no corner speed cap: check it on the bike (a cap for sharp route corners off junctions, or a junction there)
- [ ] F83 East End accepted spots (`qcAccept`): a hillside carve beside Stanton Ave (3.79 km), the Stanton/Negley and Fifth/Beechwood right-angle corners (6.45, 16.73 km), the K portal join where the routed Forbes link meets Oakland's own samples (a 2 m wobble, path-jog 25.93 km; the same kind as F61)
- [ ] F84 Junction passes: the straight-on ways at HE (Mellon Terrace–Bunkerhill) and SQ (Forbes) are each split across two passes 9–14 m apart (a curve, clean in `qc:network`); the line's order keeps N Highland at HP and Penn Ave at EL on one pass. Turn labels there come out as "bear left/right" ~40° for what is straight on in the street (the arms' headings are taken on rounded corners): check the prompt on the bike
- [ ] F85 The area's `maxDriftM` is 8 (Polish Hill 16): with 16 the passes of HP sat 21 m apart and the Stanton straight-on hopped 0.76 m; 8 keeps corners tighter (89 samples still tight in road-align, all at real corners)
- [ ] F86 K is a portal without an apron on Oakland's side (Oakland's line untouched): riding into SQ>K from Oakland the swap happens 200 m before K inside this area's J>K / K>J aprons, as the recipe allows. LB likewise on the Allegheny's side (no apron on LB>HE)
- [ ] F87 Clipping on the East End: 0 fail, 68 warnings — 38 vehicles clipping solids (F11's kind), 29 ground over streets/sidewalks/paths (hillside side streets and park paths), 1 tree in a solid: review the ground ones
- [ ] F88 The area's scene is Polish Hill's settings (look, palette, kit, downtown heroes); no signs, views or road zones yet (East Liberty's Penn Ave, Bakery Square, the Highland Park entrance garden and its statues, Forbes in Squirrel Hill could get dressing). Lake Drive is drawn as a two-lane city street with sidewalks (it is a park drive)
- [ ] F89 Not routed: Stanton Ave between N Negley and N Highland (a junction HN there put two turning passes on opposite corners, 22 m apart: path-route gaps over 30 m) and N Negley south to Penn; the Highland Park Bridge/Butler St (Route 28 trunk) and Washington Blvd are left out. The zoo's pedestrian paths and the entrance garden's cycleways stay in the city data beside the route

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

### hud-test — Minimap and power bar size *(test branch `hud-test`, on top of v0.12.1)*
- [x] Ride-screen minimap (bottom-left): route outline, this leg's progress, rider arrow, pacer dot; on routes and scenery loops
- [x] Settings → Minimap: Whole course (default) · Zoomed in, follows you · Off; <kbd>M</kbd> cycles it on the ride screen
- [x] Settings → Power bar size: Small (default, ~50% of the old size) · Medium · Large (original); labels keep a readable minimum
