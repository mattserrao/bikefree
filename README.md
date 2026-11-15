# bikefree
Indoor biking app for Mac. Enjoy $0 biking.

Runs in Chrome and connects directly to a Wahoo KICKR CORE 2 (Bluetooth FTMS) and Zwift Ride handlebars (Zwift controller protocol). See [PLAN.md](PLAN.md) for versions and goals.

## Run it

```sh
python3 -m http.server 8000
```

Open http://localhost:8000 in **Chrome** (Safari doesn't support Web Bluetooth). Quit Zwift, Zwift Companion and the Wahoo app first so they don't hold the Bluetooth connections.

## Riding

1. Connect the trainer, the handlebars and (optionally) a heart-rate strap — chips in the top right.
2. Pick a ride type: **Free ride** (set the grade yourself), **Route** (GPX file) or **Workout** (.zwo/.erg/.mrc).
3. Start pedalling — the ride starts and records automatically.
4. Shift with the hoods: **left = easier, right = harder**. ▲▼ = grade or workout intensity, ▶ = skip workout step, **A** = pause, **Y** = lap.
5. **Finish ride** → summary → *Save & download .fit* → upload at strava.com/upload/select.

Settings (⚙): weights, units, FTP, ERG or SIM shifting, difficulty. Past rides: **Rides**.

Keyboard: ← → shift, ↑ ↓ grade/intensity, Space start/pause, L lap.

## Tests

```sh
npm install   # once, for the FIT decoder used in tests
npm test      # Node 18+
```

## Credits

Zwift Ride protocol details come from [BikeControl](https://github.com/jonasbark/swiftcontrol) (MIT) and [ajchellew/zwiftplay](https://github.com/ajchellew/zwiftplay). Not affiliated with Zwift or Wahoo.
