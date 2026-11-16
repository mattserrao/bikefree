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
- [x] New scene type `authored-city` (`js/world/city-landscape.js`, `city.js`, `city-bridges.js`, `city-life.js`): real terrain (the Mount Washington bluff), carved rivers with their own water, buildings with procedural windows, PPG Place spires, the Gulf Tower top, streets with sidewalks, lamps and street trees, shop awnings and signs on East Carson
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
- Geography reads as rolling grassland beside a distant sea, not mountains dropping into the Pacific: the land is a synthetic heightfield (`js/world/coast.js`) that rises gently inland; no sea cliffs, coves or surf line
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
- [x] **Real landform** — `tools/build_terrain_grid.py` bakes AWS Terrain Tiles into `routes/scenes/bigsur-terrain.json` (1.7 MB gzipped): 10 m blocks within 900 m of the road, 40 m out to 9 km. The source fills the near-shore ocean with flat 0–3 m "land"; the builder turns that into a shelving sea floor (sea = low ground connected to the open ocean). `js/world/real-coast.js` presses the GPX road in, opens the real gorges under the bridges, traces the creeks down the real valley floors (Bixby, Rocky, Garrapata, Malpaso, Little Sur) and keeps a signed distance to the shore. The real horizon is off for Big Sur (its own grid reaches the horizon; the tile horizon showed the flat fill as a sand plain)
- [x] **Bridges** — `js/world/coast-bridges.js`: open-spandrel arches (Bixby 228 m over a 77 m gorge, Rocky Creek, Garrapata, and the canyon at 9.9 km) with twin ribs, spandrel columns and great piers on the real slopes; deck bridges elsewhere; open balustrade parapets you can see the sea through
- [x] **Vegetation from the ground** — golden grass on ridges and south faces, olive scrub on north faces, redwood / oak / pine in the canyons, cypress on the bluffs, sand by the sea
- [x] **Ocean** — shallows from the sea floor, kelp-dark patches, broken breakers rolling in to the real shoreline, swash, rocks along the true shore; dark at night
- [x] **Weather** (`js/world/weather.js`, all stylized routes; Settings › Weather, **W** on the ride screen): *Clear*, *Marine layer* (fog bank on the sea, upper layers stop at the shore, the lowest creep up the canyons; ride into it and the air closes in; climb Hurricane Point and you're above it), *Clouds* (shadows drifting over the hills), *Rain* (streaks, grey light, wet road that picks up the sky); wind in grass, flowers and trees in every preset; changes ease in
- [x] **Traffic** (`js/world/highway-traffic.js`, scene option `traffic`): cars, SUVs, RVs, motorcycles and other cyclists both ways, ~4 a minute; they overtake when the other lane is clear and wait behind you when it isn't; a cyclist may sit on your wheel; some pull into the overlooks; parked cars at the overlooks; lights at night
- [x] **Life and landmarks** (`js/world/coast-life.js`): pelicans gliding in lines along the shore, gulls over the cliffs, a condor over the ridges, cattle on the Point Sur terrace, Point Sur Lighthouse (lamp and turning beam at night); signs for Rocky Creek, Hurricane Point, Little Sur and Point Sur; a Hurricane Point overlook
- [x] **Rendering** (`js/world/post.js`, scene option `post`): HDR render, soft bloom (sun glint, low sun, lamps), gentle grade and vignette; off on Light detail
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
  - [ ] Per-scene distance fog so the skyline separates from the hills; night river reflections; Big Sur's moon path and headlight (D3)
  - [ ] Measure on the Mac with the **I** overlay (post + fog on Balanced and High)
- [x] **P3 · Real landform** (v0.13.1) — `routes/scenes/pittsburgh-terrain.json` from `tools/build_terrain_grid.py` (new inland "rivers" mode): 10 m near the route, 40 m to 9 km; the three rivers traced from the elevation to the edge of the world (second water surface beyond the city's box; the river fog follows them); banded sandstone on steep city ground. C2: the "buried streets" were low ramp decks beside the route — the ground no longer rises over a ramp deck; a guard adds girder spans for real underpasses (none on this route). Clipping QC 266 warnings (baseline 288), 0 fail; course QC clean
  - [ ] Left: the route's height on the Mount Washington crest (13.3–14.1 km) is 4–6 m above the bare ground
- [ ] **P4 · Signature landmarks** and the Grandview postcard view (C1, C4, C8)
- [ ] **P5 · Rivers** (current, confluence, glint, banks; C3, C6)
- [ ] **P6 · Vegetation** (wooded slopes, park lawns, street trees)
- [ ] **P7 · Traffic and life** (route traffic that overtakes and waits, buses, rowers; C5, C7)
- [ ] **P8 · Check and ship** (both QCs strict, snapshots against the baseline, the Mac check, move to In Progress, PR)

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
  - [ ] creeks and bridges (Avalanche, Logan, Baring, Reynolds creeks)
- [ ] **P4 · Atmosphere and weather**
  - [x] Golden hour by default (*Route's default*), post-processing on, distance fog 1.6–21 km
  - [x] **Valley fog**: the fog bank lies on Lake McDonald (962 m), 45 m deep, treetops and the road above it
  - [x] **Clouds on the peaks**: cloud caps on every summit above 2,200 m within 7 km (one draw call), drifting; low and grey in the rain; plus Big Sur's cloud shadows
  - [x] **Rain and wet road** (shared)
  - [x] **Wildfire smoke**: new preset (`smoke`): a red-orange sun, a brown sky, the far ridges gone in a 5 km haze; offered in `W`, the preview and `npm run snap` (`:smoke`)
  - [ ] Night: a moon and the headlight; measure post + fog on the Air
- [ ] **P5 · Landmarks** — guardwalls, Garden Wall/Weeping Wall/Triple Arches, tunnels, the Loop, Logan Pass, Jackson Glacier, lodges, Wild Goose Island
- [ ] **P6 · Vegetation**
  - [x] Glacier kit (`js/world/glacier-kit.js`) and zoned forest planner: cedar–hemlock west side, spruce–fir–larch slopes, treeline krummholz, aspen and lodgepole east; beargrass, paintbrush, glacier lilies, huckleberry, alder in the chutes
  - [ ] tune density against the budget on the Air
- [ ] **P7 · Traffic and wildlife**
- [ ] **P8 · Check and ship** — `qc --strict`, clipping QC, snapshots against the baseline, the Mac check with the overlay, move to In Progress, PR

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
