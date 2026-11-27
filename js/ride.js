// Zwift Ride handlebars over Web Bluetooth.
// Protocol details from BikeControl (github.com/jonasbark/swiftcontrol, MIT).
import { RIDE_ON, ZWIFT_OPCODE, decodeRideKeyPad, pressedButtons, toHex } from './parsers.js';
import { RECONNECT_DELAYS, init, next, check, watchDevice, listen, sleep, Superseded } from './ble.js';

const ZWIFT_MANUFACTURER_ID = 0x094a;
const RIDE_LEFT_SIDE = 0x08; // first byte of Zwift manufacturer data; the left hood is the one to connect to
const RIDE_SERVICE = 0xfc82;
const ZWIFT_SERVICE = '00000001-19ca-4651-86e5-fa29dcdd09d1';
const ASYNC_CHAR = '00000002-19ca-4651-86e5-fa29dcdd09d1';   // notifications (button events)
const SYNC_RX_CHAR = '00000003-19ca-4651-86e5-fa29dcdd09d1'; // we write commands here
const SYNC_TX_CHAR = '00000004-19ca-4651-86e5-fa29dcdd09d1'; // indications (responses)
const VIBRATE = new Uint8Array([0x12, 0x12, 0x08, 0x0a, 0x06, 0x08, 0x02, 0x10, 0x00, 0x18, 0x20]);

export class Ride extends EventTarget {
  constructor(log) {
    super();
    this.log = log;
    this.device = null;
    this.firmware = null;
    this.battery = null;
    this.reconnecting = false;
    this.showRaw = false;
    this._syncRx = null;
    this._pressed = new Set();
    this._userDisconnect = false;
    init(this);   // [review 27 Nov] A6: connection generations, listeners once per device / characteristic (js/ble.js)
  }

  get connected() { return !!this.device?.gatt?.connected && !!this._syncRx; }

  /** @param {boolean} anyZwift  show every Zwift device instead of only the Ride's left hood */
  async connect(anyZwift = false) {
    const filters = anyZwift
      ? [{ namePrefix: 'Zwift' }, { manufacturerData: [{ companyIdentifier: ZWIFT_MANUFACTURER_ID }] }]
      : [{ manufacturerData: [{ companyIdentifier: ZWIFT_MANUFACTURER_ID, dataPrefix: new Uint8Array([RIDE_LEFT_SIDE]) }] }];

    const device = await navigator.bluetooth.requestDevice({
      filters,
      optionalServices: [RIDE_SERVICE, ZWIFT_SERVICE, 'device_information', 'battery_service'],
    });
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
    if (this.reconnecting) { this.reconnecting = false; this.log('ride', 'Disconnected'); this.dispatchEvent(new Event('status')); }
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
  }

  async _setup(gen = this._gen) {
    this.log('ride', `Connecting to ${this.device.name}…`);
    this._syncRx = null;
    this._pressed = new Set();
    const server = await this.device.gatt.connect();
    check(this, gen);

    await this._readFirmware(server);
    await this._readBattery(server);
    check(this, gen);

    let service;
    try {
      service = await server.getPrimaryService(RIDE_SERVICE);
    } catch {
      try {
        service = await server.getPrimaryService(ZWIFT_SERVICE);
      } catch {
        this.log('ride',
          'Zwift controller service is hidden. This usually means a Ride V2 (firmware 1.3+) that Zwift has locked. ' +
          'To unlock: open the Zwift app, pair the trainer and the Ride, wait ~30 s and press a button, ' +
          'then fully quit Zwift and connect here again. The unlock lasts about 24 hours.', 'error');
        this.dispatchEvent(new Event('status'));
        return;
      }
    }

    check(this, gen);
    const asyncChar = await service.getCharacteristic(ASYNC_CHAR);
    const syncTx = await service.getCharacteristic(SYNC_TX_CHAR);
    const syncRx = await service.getCharacteristic(SYNC_RX_CHAR);
    check(this, gen);

    listen(this, asyncChar, (e) => this._onMessage('async', e.target.value));
    listen(this, syncTx, (e) => this._onMessage('syncTx', e.target.value));
    await asyncChar.startNotifications();
    await syncTx.startNotifications();
    check(this, gen);

    await syncRx.writeValueWithoutResponse(RIDE_ON);
    check(this, gen);
    this._syncRx = syncRx;

    this.log('ride', `Connected to ${this.device.name}`, 'ok');
    this.dispatchEvent(new Event('status'));
  }

  async _onDisconnected(device = this.device) {
    if (device !== this.device) return;
    const gen = next(this);   // [review 27 Nov] A6
    this._syncRx = null;
    this.dispatchEvent(new Event('status'));
    if (this._userDisconnect) {
      this.log('ride', 'Disconnected');
      return;
    }
    this.log('ride', 'Connection lost — reconnecting…', 'warn');
    this.reconnecting = true;
    this.dispatchEvent(new Event('status'));
    for (const delay of RECONNECT_DELAYS) {
      await sleep(delay);
      if (gen !== this._gen) return;
      try {
        await this._setup(gen);
        if (this.connected) {
          this.reconnecting = false;
          this.dispatchEvent(new Event('status'));
          return;
        }
      } catch (err) {
        if (gen !== this._gen) return;
        this.log('ride', `Reconnect failed: ${err.message}`, 'debug');
      }
    }
    this.reconnecting = false;
    this.log('ride', 'Could not reconnect. Press a button to wake the handlebars, then click Connect.', 'error');
    this.dispatchEvent(new Event('status'));
  }

  /** Short buzz in the handlebars. */
  async vibrate() {
    if (!this._syncRx) return;
    try { await this._syncRx.writeValueWithoutResponse(VIBRATE); }
    catch (err) { this.log('ride', `Vibrate failed: ${err.message}`, 'debug'); }
  }

  async _readFirmware(server) {
    try {
      const dis = await server.getPrimaryService('device_information');
      const fw = await dis.getCharacteristic('firmware_revision_string');
      this.firmware = new TextDecoder().decode(await fw.readValue()).replace(/\0/g, '').trim();
      const m = this.firmware.match(/^(\d+)\.(\d+)/);
      const v2 = m && (+m[1] > 1 || (+m[1] === 1 && +m[2] >= 3));
      this.log('ride', `Firmware ${this.firmware} → ${v2 ? 'Ride V2 (needs daily Zwift unlock)' : 'Ride V1 (no unlock needed)'}`,
        v2 ? 'warn' : 'debug');
    } catch (err) {
      this.log('ride', `Could not read firmware version (${err.message})`, 'debug');
    }
  }

  async _readBattery(server) {
    try {
      const bs = await server.getPrimaryService('battery_service');
      const lvl = await bs.getCharacteristic('battery_level');
      this.battery = (await lvl.readValue()).getUint8(0);
    } catch { /* optional */ }
  }

  _onMessage(source, dv) {
    const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
    if (!bytes.length) return;
    const op = bytes[0];
    const opName = ZWIFT_OPCODE[op] || `0x${op.toString(16).padStart(2, '0')}`;

    if (this.showRaw) this.log('ride', `[${source}] ${opName}: ${toHex(bytes)}`, 'debug');

    if (op === 0x52) return; // RideOn handshake reply
    if (op === 0x23) {
      try {
        const now = new Set(pressedButtons(decodeRideKeyPad(bytes.subarray(1))));
        // Only newly pressed buttons count as a press (the controller repeats frames).
        const newly = [...now].filter((b) => !this._pressed.has(b));
        this._pressed = now;
        this.dispatchEvent(new CustomEvent('buttons', { detail: [...now] }));
        for (const name of newly) {
          this.log('ride', `Pressed: ${name}`, 'button');
          this.dispatchEvent(new CustomEvent('press', { detail: name }));
        }
      } catch (err) {
        this.log('ride', `Could not decode buttons: ${err.message} (${toHex(bytes)})`, 'error');
      }
      return;
    }
    if (op === 0x19) {
      // BatteryNotification protobuf; field 2 (tag 0x10) = new percent level.
      const idx = bytes.indexOf(0x10, 1);
      if (idx > 0 && idx + 1 < bytes.length) {
        this.battery = bytes[idx + 1];
        this.dispatchEvent(new Event('status'));
      }
    }
  }
}
