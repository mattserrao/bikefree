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

### v0.3 — Save rides
**Goal:** keep a record of every ride.
- [ ] Record 1-second samples
- [ ] Export `.fit` file (upload to Strava/Garmin manually)
- [ ] Heart-rate strap support (direct, or via KICKR Bridge)
- [ ] Ride summary at the end (avg/max power, time, distance, elevation)
- **Done when:** a ride uploads to Strava with correct data

### v1.0 — GPX routes
**Goal:** ride real roads with terrain-based resistance.
- [ ] Load a `.gpx` file; smooth elevation; calculate grade along the route
- [ ] Distance moves you along the route; trainer resistance follows the grade
- [ ] Elevation profile with position marker, upcoming grade, distance remaining
- [ ] Route grade included in the `.fit` export
- **Done when:** a known local climb feels right

### Later ideas
- Structured ERG workouts (`.zwo`, `.erg`, `.mrc` import)
- Map view of the route
- Visual scene (three.js or pixel art)
- Native trainer virtual shifting via Zwift Protocol (most realistic, most work)
- Direct Strava upload

## Running it

Web Bluetooth needs Chrome and either `localhost` or HTTPS.

```sh
cd bikefree
python3 -m http.server 8000
# open http://localhost:8000 in Chrome
```

Close Zwift, Zwift Companion and the Wahoo app before connecting — they can hold the Bluetooth connections.
