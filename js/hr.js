// Bluetooth heart-rate strap (standard Heart Rate service).
import { RECONNECT_DELAYS, init, next, check, watchDevice, listen, sleep, Superseded } from './ble.js';

/** Parse a Heart Rate Measurement (0x2A37). */
export function parseHeartRate(dv) {
  const flags = dv.getUint8(0);
  return flags & 0x01 ? dv.getUint16(1, true) : dv.getUint8(1);
}

export class HeartRate extends EventTarget {
  constructor(log) {
    super();
    this.log = log;
    this.device = null;
    this.bpm = null;
    this.lastAt = 0;
    this.reconnecting = false;
    this._char = null;
    this._userDisconnect = false;
    init(this);   // [review 27 Nov] A6: connection generations, listeners once per device / characteristic (js/ble.js)
  }

  get connected() { return !!this.device?.gatt?.connected && !!this._char; }

  async connect() {
    const device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
    const gen = next(this);   // [review 27 Nov] A6 (as trainer.js)
    this.device = device;
    this._userDisconnect = false;
    this.reconnecting = false;
    watchDevice(this, device);
    try { await this._setup(gen); }
    catch (err) { if (!(err instanceof Superseded)) throw err; }
  }

  disconnect() {
    next(this);
    this._userDisconnect = true;
    if (this.reconnecting) { this.reconnecting = false; this.dispatchEvent(new Event('status')); }
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
  }

  async _setup(gen = this._gen) {
    this._char = null;
    const server = await this.device.gatt.connect();
    check(this, gen);
    const svc = await server.getPrimaryService('heart_rate');
    check(this, gen);
    const ch = await svc.getCharacteristic('heart_rate_measurement');
    check(this, gen);
    listen(this, ch, (e) => {
      this.bpm = parseHeartRate(e.target.value);
      this.lastAt = performance.now();
    });
    await ch.startNotifications();
    check(this, gen);
    this._char = ch;
    this.log('hr', `Connected to ${this.device.name}`, 'ok');
    this.dispatchEvent(new Event('status'));
  }

  async _onDisconnected(device = this.device) {
    if (device !== this.device) return;
    const gen = next(this);
    this._char = null;
    this.bpm = null;
    this.dispatchEvent(new Event('status'));
    if (this._userDisconnect) return;
    this.reconnecting = true;
    this.log('hr', 'Connection lost — reconnecting…', 'warn');
    this.dispatchEvent(new Event('status'));
    for (const delay of RECONNECT_DELAYS) {
      await sleep(delay);
      if (gen !== this._gen) return;
      try { await this._setup(gen); this.reconnecting = false; this.dispatchEvent(new Event('status')); return; }
      catch { if (gen !== this._gen) return; /* keep trying */ }
    }
    this.reconnecting = false;
    this.dispatchEvent(new Event('status'));
  }
}
