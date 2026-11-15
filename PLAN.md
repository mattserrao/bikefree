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
- [ ] Strava: connect a profile and upload rides directly — researched in [docs/STRAVA.md](docs/STRAVA.md), next up

### Later ideas
- Direct Strava upload (see v0.10 / docs/STRAVA.md)
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
