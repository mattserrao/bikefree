// [review 27 Nov] A6: what the Bluetooth links (trainer.js, hr.js, ride.js) share about connecting and reconnecting.
// requestDevice() hands back the same BluetoothDevice each time you pick the same trainer, and Chrome keeps its
// characteristic objects across reconnects: so a device's 'gattserverdisconnected' and a characteristic's
// notifications are listened to once (WeakSets), not once per connect. Each connect, drop and user disconnect starts
// a new generation; a reconnect loop or a setup from an older one stops at its next await (no two loops racing, no
// duplicate 'reconnected').
export const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000, 30000];

/** Thrown by `check()` when a newer connect, drop or disconnect has superseded the work in hand. */
export class Superseded extends Error {
  constructor() { super('superseded by a newer connection'); this.name = 'Superseded'; }
}

/** The per-link state: call `init(link)` in the constructor. */
export function init(link) {
  link._gen = 0;
  link._watched = new WeakSet();
  link._listening = new WeakSet();
}

/** A new generation (a connect, a drop, a disconnect): returns its token. */
export const next = (link) => ++link._gen;
/** Throws Superseded unless `gen` is still the link's generation. */
export function check(link, gen) { if (gen !== link._gen) throw new Superseded(); }

/** Listen for this device's drops once, however many times it is connected. */
export function watchDevice(link, device) {
  if (link._watched.has(device)) return;
  link._watched.add(device);
  device.addEventListener('gattserverdisconnected', () => link._onDisconnected(device));
}

/** Listen to this characteristic's notifications once, however many times it is set up. */
export function listen(link, ch, fn) {
  if (link._listening.has(ch)) return;
  link._listening.add(ch);
  ch.addEventListener('characteristicvaluechanged', fn);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
