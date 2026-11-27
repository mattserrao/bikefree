// KICKR CORE 2 (or any FTMS trainer) over Web Bluetooth.
import {
  parseIndoorBikeData, parseControlPointResponse, parseCyclingPower, cadenceFromCrank,
  encodeRequestControl, encodeStart, encodeTargetPower, encodeSimParams, FTMS_OP, toHex,
} from './parsers.js';
import { RECONNECT_DELAYS, init, next, check, watchDevice, listen, sleep, Superseded } from './ble.js';

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
    this.reconnecting = false;
    this.data = {};
    this.lastDataAt = 0;
    this._lastCrank = null;
    this._ftmsHasCadence = false;
    this._queue = Promise.resolve();
    this._inFlight = 0;
    this._userDisconnect = false;
    init(this);   // [review 27 Nov] A6: connection generations, listeners once per device / characteristic (js/ble.js)
  }

  get connected() { return this.demo || (!!this.device?.gatt?.connected && !!this.controlPoint); }
  /** True while a control point write is waiting for the trainer's answer. */
  get busy() { return this._inFlight > 0; }

  async connect() {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [FTMS] }],
      optionalServices: [CYCLING_POWER, 'device_information'],
    });
    // [review 27 Nov] A6: a new generation (an old reconnect loop stops), the device's drops listened to once
    const gen = next(this);
    this.device = device;
    this._userDisconnect = false;
    this.reconnecting = false;
    watchDevice(this, device);
    try { await this._setup(gen); }
    catch (err) { if (!(err instanceof Superseded)) throw err; }   // (it dropped meanwhile: its reconnect loop carries on)
  }

  /**
   * Demo mode: no Bluetooth. `generate()` is called 4× a second and returns the bike data
   * ({powerW, cadenceRpm, speedKph, heartRate}) a real trainer would send.
   */
  // One simulated sample. The session also calls this every tick, so demo data is never stale
  // even when the 3D view keeps the page busy.
  pollDemo() {
    if (!this.demo) return;
    Object.assign(this.data, this._demoGenerate());
    this.lastDataAt = performance.now();
    this.dispatchEvent(new CustomEvent('data', { detail: this.data }));
  }

  startDemo(generate) {
    if (this.device?.gatt?.connected) this.disconnect();
    next(this); this.reconnecting = false;   // [review 27 Nov] A6: (a reconnect loop in its backoff stops)
    this.demo = true;
    this.device = { name: 'Demo trainer' };
    this.hasControl = true;
    this.data = {};
    this.lastTarget = null;
    this._demoGenerate = generate;
    this._demoTimer = setInterval(() => this.pollDemo(), 250);
    this.log('trainer', 'Demo mode on — simulated trainer', 'ok');
    this.dispatchEvent(new Event('status'));
  }

  stopDemo() {
    if (!this.demo) return;
    clearInterval(this._demoTimer);
    this.demo = false;
    this.device = null;
    this.hasControl = false;
    this.data = {};
    this.log('trainer', 'Demo mode off');
    this.dispatchEvent(new Event('status'));
  }

  disconnect() {
    if (this.demo) { this.stopDemo(); return; }
    next(this);   // [review 27 Nov] A6: a reconnect loop sleeping in its backoff stops there
    this._userDisconnect = true;
    if (this.reconnecting) {
      this.reconnecting = false;
      this.log('trainer', 'Disconnected');
      this.dispatchEvent(new Event('status'));
    }
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
  }

  /** Connect and subscribe. `gen`: the connection generation this belongs to (A6: it stops if superseded). */
  async _setup(gen = this._gen) {
    this.log('trainer', `Connecting to ${this.device.name}…`);
    this.controlPoint = null;
    this.hasControl = false;
    this._ftmsHasCadence = false;
    this._lastCrank = null;
    const server = await this.device.gatt.connect();
    check(this, gen);
    const ftms = await server.getPrimaryService(FTMS);
    check(this, gen);

    // ([review 27 Nov] A6: each characteristic's listener once — Chrome hands back the same objects on a reconnect)
    const bikeData = await ftms.getCharacteristic(INDOOR_BIKE_DATA);
    check(this, gen);
    listen(this, bikeData, (e) => this._onBikeData(e.target.value));
    await bikeData.startNotifications();
    check(this, gen);

    const cp = await ftms.getCharacteristic(CONTROL_POINT);
    check(this, gen);
    listen(this, cp, (e) => this._onControlResponse(e.target.value));
    await cp.startNotifications(); // indications
    check(this, gen);

    try {
      const status = await ftms.getCharacteristic(MACHINE_STATUS);
      listen(this, status, (e) =>
        this.log('trainer', `Machine status: ${toHex(new Uint8Array(e.target.value.buffer))}`, 'debug'));
      await status.startNotifications();
    } catch { /* optional */ }
    check(this, gen);

    // Cycling Power as a cadence fallback, in case FTMS bike data doesn't include cadence.
    try {
      const cps = await server.getPrimaryService(CYCLING_POWER);
      const meas = await cps.getCharacteristic(CP_MEASUREMENT);
      listen(this, meas, (e) => this._onCyclingPower(e.target.value));
      await meas.startNotifications();
    } catch { /* optional */ }
    check(this, gen);

    this.controlPoint = cp;
    this.log('trainer', `Connected to ${this.device.name}`, 'ok');
    this.dispatchEvent(new Event('status'));
  }

  async _onDisconnected(device = this.device) {
    if (device !== this.device || this.demo) return;   // (a trainer you've since switched from)
    // [review 27 Nov] A6: one loop per drop: a newer connect, drop or disconnect ends this one at its next await
    const gen = next(this);
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
      await sleep(delay);
      if (gen !== this._gen) return;
      try {
        await this._setup(gen);
        this.reconnecting = false;
        this.dispatchEvent(new Event('reconnected'));
        this.dispatchEvent(new Event('status'));
        return;
      } catch (err) {
        if (gen !== this._gen) return;
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
    if (this.demo) { this.lastTarget = { mode: 'ERG', value: watts }; return; }
    if (!this.hasControl) await this.takeControl();
    await this._write(encodeTargetPower(watts));
  }

  /** @param {number} gradePct @param {{windMps?:number, crr?:number, cw?:number}} [opts] */
  async setGrade(gradePct, opts) {
    if (this.demo) { this.lastTarget = { mode: 'SIM', value: gradePct }; return; }
    if (!this.hasControl) await this.takeControl();
    await this._write(encodeSimParams(gradePct, opts));
  }
}
