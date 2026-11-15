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

### v0.2 — Virtual shifting + dashboard *(branch `v0.2`)*
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
- [ ] On-bike check: 30-minute ride; pick ERG or SIM; tune gear ratios and difficulty
- **Done when:** a 30-minute ride feels natural with shifting

### v0.3 — Save rides *(branch `v0.5`)*
**Goal:** keep a record of every ride.
- [x] Record 1-second samples (power, cadence, speed, distance, altitude, HR, grade, position on routes)
- [x] Export `.fit` file (verified with Garmin's FIT SDK decoder); upload to Strava/Garmin manually
- [x] Heart-rate strap support (direct Bluetooth), or HR relayed by the trainer (KICKR Bridge)
- [x] Finish ride → summary (time, distance, avg/normalized/max power, cadence, speed, climb, kJ, HR) and lap table
- [x] Laps: Lap button, Y button or `L`; automatic laps on workout steps and ride-type changes
- [x] Ride history (saved in the browser) with re-download and delete
- [x] Crash recovery: in-progress ride autosaved every 15 s and offered back on reload
- [ ] On-bike check: upload a real ride to Strava and confirm the data
- **Done when:** a ride uploads to Strava with correct data

### v0.4 — GPX routes *(branch `v0.5`)*
**Goal:** ride real roads with terrain-based resistance.
- [x] Load a `.gpx` file (tracks or routes); resample every 10 m; smooth elevation; grade along the route
- [x] Distance moves you along the route; trainer resistance follows the grade
- [x] Elevation profile coloured by grade with position marker; route outline; grade now, next ½ mi, to go, climb left, % done
- [x] Route position, altitude and grade in the `.fit` export (shows as a Virtual Ride with a map on Strava)
- [x] Routes saved in your library; built-in "Demo Hills" route for testing
- [x] Finishing a route opens the ride summary (or keep riding)
- [ ] On-bike check: a known local climb feels right
- **Done when:** a known local climb feels right

### v0.5 — Structured workouts *(branch `v0.5`)*
**Goal:** follow interval workouts in ERG mode.
- [x] Import `.zwo` (Zwift), `.erg` (watts) and `.mrc` (% FTP) files; saved in your library
- [x] Four built-in workouts (Endurance 45, Sweet Spot 3×10, VO2 Max 5×3, Quick Spin 20)
- [x] FTP setting; trainer holds each step's target in ERG; ramps follow smoothly
- [x] Free-ride steps (and after the workout ends) go back to virtual shifting
- [x] Workout chart coloured by zone with progress; target, step time left, next step, time left
- [x] Intensity −/+ 5% (D-pad ▲▼, arrow keys); skip step (D-pad ▶); handlebar buzz on each new step
- [x] One lap per workout step in the `.fit` file
- [ ] On-bike check: complete a built-in workout end to end
- **Done when:** a full workout runs cleanly and the laps show up on Strava

### Later ideas
- Direct Strava upload
- Map view of the route (real map tiles)
- Visual scene (three.js or pixel art)
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
