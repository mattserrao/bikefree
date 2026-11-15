# bikefree
Indoor biking app for Mac. Enjoy $0 biking.

Runs in Chrome and connects directly to a Wahoo KICKR CORE 2 (Bluetooth FTMS) and Zwift Ride handlebars (Zwift controller protocol). See [PLAN.md](PLAN.md) for versions and goals.

## Run it

```sh
python3 -m http.server 8000
```

Open http://localhost:8000 in **Chrome** (Safari doesn't support Web Bluetooth). Quit Zwift, Zwift Companion and the Wahoo app first so they don't hold the Bluetooth connections.

## Riding (v0.2)

1. Connect the trainer and the handlebars (chips in the top right).
2. Start pedalling — the ride starts automatically.
3. Shift with the hoods: **left = easier, right = harder**. D-pad ▲▼ changes the grade; **A** pauses.
4. Settings (⚙): weights, units, ERG or SIM shifting, difficulty.

Keyboard: ← → shift, ↑ ↓ grade, Space start/pause.

## Tests

```sh
npm test   # Node 18+
```

## Credits

Zwift Ride protocol details come from [BikeControl](https://github.com/jonasbark/swiftcontrol) (MIT) and [ajchellew/zwiftplay](https://github.com/ajchellew/zwiftplay). Not affiliated with Zwift or Wahoo.
