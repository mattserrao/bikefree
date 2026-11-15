// Bluetooth heart-rate strap (standard Heart Rate service).
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000, 30000];

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
  }

  get connected() { return !!this.device?.gatt?.connected && !!this._char; }

  async connect() {
    this.device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
    this.device.addEventListener('gattserverdisconnected', () => this._onDisconnected());
    this._userDisconnect = false;
    await this._setup();
  }

  disconnect() {
    this._userDisconnect = true;
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
  }

  async _setup() {
    this._char = null;
    const server = await this.device.gatt.connect();
    const svc = await server.getPrimaryService('heart_rate');
    const ch = await svc.getCharacteristic('heart_rate_measurement');
    ch.addEventListener('characteristicvaluechanged', (e) => {
      this.bpm = parseHeartRate(e.target.value);
      this.lastAt = performance.now();
    });
    await ch.startNotifications();
    this._char = ch;
    this.log('hr', `Connected to ${this.device.name}`, 'ok');
    this.dispatchEvent(new Event('status'));
  }

  async _onDisconnected() {
    this._char = null;
    this.bpm = null;
    this.dispatchEvent(new Event('status'));
    if (this._userDisconnect) return;
    this.reconnecting = true;
    this.log('hr', 'Connection lost — reconnecting…', 'warn');
    this.dispatchEvent(new Event('status'));
    for (const delay of RECONNECT_DELAYS) {
      await new Promise((r) => setTimeout(r, delay));
      if (this._userDisconnect) break;
      try { await this._setup(); this.reconnecting = false; this.dispatchEvent(new Event('status')); return; }
      catch { /* keep trying */ }
    }
    this.reconnecting = false;
    this.dispatchEvent(new Event('status'));
  }
}
