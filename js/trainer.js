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

export class Trainer extends EventTarget {
  constructor(log) {
    super();
    this.log = log;
    this.device = null;
    this.controlPoint = null;
    this.hasControl = false;
    this.data = {};
    this._lastCrank = null;
    this._ftmsHasCadence = false;
    this._queue = Promise.resolve();
  }

  get connected() { return !!this.device?.gatt?.connected; }

  async connect() {
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [FTMS] }],
      optionalServices: [CYCLING_POWER, 'device_information'],
    });
    this.device.addEventListener('gattserverdisconnected', () => {
      this.hasControl = false;
      this.log('trainer', `Disconnected from ${this.device.name}`, 'warn');
      this.dispatchEvent(new Event('status'));
    });
    this.log('trainer', `Connecting to ${this.device.name}…`);
    const server = await this.device.gatt.connect();

    const ftms = await server.getPrimaryService(FTMS);

    const bikeData = await ftms.getCharacteristic(INDOOR_BIKE_DATA);
    bikeData.addEventListener('characteristicvaluechanged', (e) => this._onBikeData(e.target.value));
    await bikeData.startNotifications();

    this.controlPoint = await ftms.getCharacteristic(CONTROL_POINT);
    this.controlPoint.addEventListener('characteristicvaluechanged', (e) => this._onControlResponse(e.target.value));
    await this.controlPoint.startNotifications(); // indications

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
      this.log('trainer', 'Cycling Power service available (cadence fallback)', 'debug');
    } catch { /* optional */ }

    this.log('trainer', `Connected to ${this.device.name}`, 'ok');
    this.dispatchEvent(new Event('status'));
  }

  disconnect() {
    if (this.connected) this.device.gatt.disconnect();
  }

  _onBikeData(dv) {
    const d = parseIndoorBikeData(dv);
    if (d.cadenceRpm != null) this._ftmsHasCadence = true;
    Object.assign(this.data, d);
    this.dispatchEvent(new CustomEvent('data', { detail: this.data }));
  }

  _onCyclingPower(dv) {
    if (this._ftmsHasCadence) return;
    const cur = parseCyclingPower(dv);
    const rpm = cadenceFromCrank(this._lastCrank, cur);
    if (cur.crankRevs != null) {
      if (rpm != null) { this.data.cadenceRpm = rpm; this._lastCrankChange = performance.now(); }
      else if (performance.now() - (this._lastCrankChange || 0) > 3000) this.data.cadenceRpm = 0;
      this._lastCrank = cur;
      this.dispatchEvent(new CustomEvent('data', { detail: this.data }));
    }
  }

  _onControlResponse(dv) {
    const r = parseControlPointResponse(dv);
    if (!r) return;
    const name = OP_NAMES[r.requestOp] || `0x${r.requestOp.toString(16)}`;
    this.log('trainer', `${name} → ${r.text}`, r.ok ? 'debug' : 'warn');
    if (r.requestOp === FTMS_OP.REQUEST_CONTROL && r.ok) {
      this.hasControl = true;
      this.dispatchEvent(new Event('status'));
    }
  }

  // Writes are serialized; the control point only handles one op at a time.
  _write(bytes) {
    this._queue = this._queue.then(async () => {
      if (!this.controlPoint) throw new Error('Trainer not connected');
      await this.controlPoint.writeValueWithResponse(bytes);
    }).catch((err) => this.log('trainer', `Write failed: ${err.message}`, 'error'));
    return this._queue;
  }

  async takeControl() {
    await this._write(encodeRequestControl());
    await this._write(encodeStart());
  }

  async setErgWatts(watts) {
    if (!this.hasControl) await this.takeControl();
    this.log('trainer', `ERG target ${watts} W`);
    await this._write(encodeTargetPower(watts));
  }

  async setGrade(gradePct) {
    if (!this.hasControl) await this.takeControl();
    this.log('trainer', `SIM grade ${gradePct.toFixed(1)}%`);
    await this._write(encodeSimParams(gradePct));
  }
}
