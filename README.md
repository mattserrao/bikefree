# bikefree
Indoor biking app for Mac. Enjoy $0 biking.

Runs in Chrome and connects directly to a Wahoo KICKR CORE 2 (Bluetooth FTMS) and Zwift Ride handlebars (Zwift controller protocol). See [PLAN.md](PLAN.md) for versions and goals.

## Run it

```sh
python3 -m http.server 8000
```

Open http://localhost:8000 in **Chrome** (Safari doesn't support Web Bluetooth). Quit Zwift, Zwift Companion and the Wahoo app first so they don't hold the Bluetooth connections.

## Tests

```sh
npm test   # Node 18+
```

## Credits

Zwift Ride protocol details come from [BikeControl](https://github.com/jonasbark/swiftcontrol) (MIT) and [ajchellew/zwiftplay](https://github.com/ajchellew/zwiftplay). Not affiliated with Zwift or Wahoo.
