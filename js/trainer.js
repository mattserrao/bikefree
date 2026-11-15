// KICKR CORE 2 (or any FTMS trainer) over Web Bluetooth.
import {
  parseIndoorBikeData, parseControlPointResponse, parseCyclingPower, cadenceFromCrank,
  encodeRequestControl, encodeStart, encodeTargetPower, encodeSimParams, FTMS_OP, toHex,
} from './parsers.js';

const FTMS = 0x1826;
const INDOOR_BIKE_DATA = 0x2ad2;
const CONTROL_POINT = 0x2ad9;
const MACHINE_STATUS = 0x2ada;
const CYCLING_POWER = 0x1818;
const CP_MEASUREMENT = 0x2a63;

const OP_NAMES = Object.fromEntries(Object.entries(FTMS_OP).map(([k, v]) => [v, k]));
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000, 30000];

export class Trainer extends EventTarget {
  constructor(log) {
    super();
    this.log = log;
    this.device = null;
    this.controlPoint = null;
    this.hasControl = false;
    this.reconnecting = false;
    this.data = {};
    this.lastDataAt = 0;
    this._lastCrank = null;
    this._ftmsHasCadence = false;
    this._queue = Promise.resolve();
    this._inFlight = 0;
    this._userDisconnect = false;
  }

  get connected() { return !!this.device?.gatt?.connected && !!this.controlPoint; }
  /** True while a control point write is waiting for the trainer's answer. */
  get busy() { return this._inFlight > 0; }

  async connect() {
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [FTMS] }],
      optionalServices: [CYCLING_POWER, 'device_information'],
    });
    this.device.addEventListener('gattserverdisconnected', () => this._onDisconnected());
    this._userDisconnect = false;
    await this._setup();
  }

  disconnect() {
    this._userDisconnect = true;
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
  }

  async _setup() {
    this.log('trainer', `Connecting to ${this.device.name}…`);
    this.controlPoint = null;
    this.hasControl = false;
    this._ftmsHasCadence = false;
    this._lastCrank = null;
    const server = await this.device.gatt.connect();
    const ftms = await server.getPrimaryService(FTMS);

    const bikeData = await ftms.getCharacteristic(INDOOR_BIKE_DATA);
    bikeData.addEventListener('characteristicvaluechanged', (e) => this._onBikeData(e.target.value));
    await bikeData.startNotifications();

    const cp = await ftms.getCharacteristic(CONTROL_POINT);
    cp.addEventListener('characteristicvaluechanged', (e) => this._onControlResponse(e.target.value));
    await cp.startNotifications(); // indications

    try {
      const status = await ftms.getCharacteristic(MACHINE_STATUS);
      status.addEventListener('characteristicvaluechanged', (e) =>
        this.log('trainer', `Machine status: ${toHex(new Uint8Array(e.target.value.buffer))}`, 'debug'));
      await status.startNotifications();
    } catch { /* optional */ }

    // Cycling Power as a cadence fallback, in case FTMS bike data doesn't include cadence.
    try {
      const cps = await server.getPrimaryService(CYCLING_POWER);
      const meas = await cps.getCharacteristic(CP_MEASUREMENT);
      meas.addEventListener('characteristicvaluechanged', (e) => this._onCyclingPower(e.target.value));
      await meas.startNotifications();
    } catch { /* optional */ }

    this.controlPoint = cp;
    this.log('trainer', `Connected to ${this.device.name}`, 'ok');
    this.dispatchEvent(new Event('status'));
  }

  async _onDisconnected() {
    this.controlPoint = null;
    this.hasControl = false;
    this.data = {};
    this.dispatchEvent(new Event('status'));
    if (this._userDisconnect) {
      this.log('trainer', 'Disconnected');
      return;
    }
    this.log('trainer', 'Connection lost — reconnecting…', 'warn');
    this.reconnecting = true;
    this.dispatchEvent(new Event('status'));
    for (const delay of RECONNECT_DELAYS) {
      await new Promise((r) => setTimeout(r, delay));
      if (this._userDisconnect) break;
      try {
        await this._setup();
        this.reconnecting = false;
        this.dispatchEvent(new Event('reconnected'));
        this.dispatchEvent(new Event('status'));
        return;
      } catch (err) {
        this.log('trainer', `Reconnect failed: ${err.message}`, 'debug');
      }
    }
    this.reconnecting = false;
    this.log('trainer', 'Could not reconnect. Click Connect to try again.', 'error');
    this.dispatchEvent(new Event('status'));
  }

  _onBikeData(dv) {
    const d = parseIndoorBikeData(dv);
    if (d.cadenceRpm != null) this._ftmsHasCadence = true;
    Object.assign(this.data, d);
    this.lastDataAt = performance.now();
    this.dispatchEvent(new CustomEvent('data', { detail: this.data }));
  }

  _onCyclingPower(dv) {
    if (this._ftmsHasCadence) return;
    const cur = parseCyclingPower(dv);
    if (cur.crankRevs == null) return;
    const rpm = cadenceFromCrank(this._lastCrank, cur);
    if (rpm != null) { this.data.cadenceRpm = rpm; this._lastCrankChange = performance.now(); }
    else if (performance.now() - (this._lastCrankChange || 0) > 3000) this.data.cadenceRpm = 0;
    this._lastCrank = cur;
  }

  _onControlResponse(dv) {
    const r = parseControlPointResponse(dv);
    if (!r) return;
    const name = OP_NAMES[r.requestOp] || `0x${r.requestOp.toString(16)}`;
    if (!r.ok) this.log('trainer', `${name} → ${r.text}`, 'warn');
    else if (r.requestOp !== FTMS_OP.SET_TARGET_POWER && r.requestOp !== FTMS_OP.SET_SIM_PARAMS) {
      this.log('trainer', `${name} → ${r.text}`, 'debug');
    }
    if (r.requestOp === FTMS_OP.REQUEST_CONTROL && r.ok) {
      this.hasControl = true;
      this.dispatchEvent(new Event('status'));
    }
    if (r.result === 0x05) this.hasControl = false; // control not permitted → re-request next time
    if (this._pending && this._pending.op === r.requestOp) {
      this._pending.resolve(r);
      this._pending = null;
    }
  }

  // Writes are serialized: FTMS says to wait for the control point's response
  // indication before sending the next op, or the trainer may drop it.
  _write(bytes) {
    const op = bytes[0];
    this._inFlight++;
    this._queue = this._queue.then(async () => {
      if (!this.controlPoint) throw new Error('Trainer not connected');
      const response = new Promise((resolve) => {
        this._pending = { op, resolve };
        setTimeout(() => resolve(null), 3000);
      });
      await this.controlPoint.writeValueWithResponse(bytes);
      const r = await response;
      if (!r) {
        this._pending = null;
        this.log('trainer', `No response from trainer for ${OP_NAMES[op] || op} (3 s timeout)`, 'warn');
      }
    }).catch((err) => this.log('trainer', `Write failed: ${err.message}`, 'error'))
      .finally(() => { this._inFlight--; });
    return this._queue;
  }

  async takeControl() {
    if (this._taking) return this._taking;
    this._taking = (async () => {
      await this._write(encodeRequestControl());
      await this._write(encodeStart());
    })().finally(() => { this._taking = null; });
    return this._taking;
  }

  async setErgWatts(watts) {
    if (!this.hasControl) await this.takeControl();
    await this._write(encodeTargetPower(watts));
  }

  /** @param {number} gradePct @param {{windMps?:number, crr?:number, cw?:number}} [opts] */
  async setGrade(gradePct, opts) {
    if (!this.hasControl) await this.takeControl();
    await this._write(encodeSimParams(gradePct, opts));
  }
}
