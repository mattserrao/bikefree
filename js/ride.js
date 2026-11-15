// Zwift Ride handlebars over Web Bluetooth.
// Protocol details from BikeControl (github.com/jonasbark/swiftcontrol, MIT).
import { RIDE_ON, ZWIFT_OPCODE, decodeRideKeyPad, pressedButtons, toHex } from './parsers.js';

const ZWIFT_MANUFACTURER_ID = 0x094a;
const RIDE_LEFT_SIDE = 0x08; // first byte of Zwift manufacturer data; the left hood is the one to connect to
const RIDE_SERVICE = 0xfc82;
const ZWIFT_SERVICE = '00000001-19ca-4651-86e5-fa29dcdd09d1';
const ASYNC_CHAR = '00000002-19ca-4651-86e5-fa29dcdd09d1';   // notifications (button events)
const SYNC_RX_CHAR = '00000003-19ca-4651-86e5-fa29dcdd09d1'; // we write commands here
const SYNC_TX_CHAR = '00000004-19ca-4651-86e5-fa29dcdd09d1'; // indications (responses)

export class Ride extends EventTarget {
  constructor(log) {
    super();
    this.log = log;
    this.device = null;
    this.firmware = null;
    this.battery = null;
    this._lastPressed = '';
    this.showRaw = false;
  }

  get connected() { return !!this.device?.gatt?.connected; }

  /** @param {boolean} anyZwift  show every Zwift device instead of only the Ride's left hood */
  async connect(anyZwift = false) {
    const filters = anyZwift
      ? [{ namePrefix: 'Zwift' }, { manufacturerData: [{ companyIdentifier: ZWIFT_MANUFACTURER_ID }] }]
      : [{ manufacturerData: [{ companyIdentifier: ZWIFT_MANUFACTURER_ID, dataPrefix: new Uint8Array([RIDE_LEFT_SIDE]) }] }];

    this.device = await navigator.bluetooth.requestDevice({
      filters,
      optionalServices: [RIDE_SERVICE, ZWIFT_SERVICE, 'device_information', 'battery_service'],
    });
    this.device.addEventListener('gattserverdisconnected', () => {
      this.log('ride', `Disconnected from ${this.device.name}`, 'warn');
      this.dispatchEvent(new Event('status'));
    });

    this.log('ride', `Connecting to ${this.device.name}…`);
    const server = await this.device.gatt.connect();

    await this._readFirmware(server);
    await this._readBattery(server);

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

    const asyncChar = await service.getCharacteristic(ASYNC_CHAR);
    const syncTx = await service.getCharacteristic(SYNC_TX_CHAR);
    const syncRx = await service.getCharacteristic(SYNC_RX_CHAR);

    asyncChar.addEventListener('characteristicvaluechanged', (e) => this._onMessage('async', e.target.value));
    syncTx.addEventListener('characteristicvaluechanged', (e) => this._onMessage('syncTx', e.target.value));
    await asyncChar.startNotifications();
    await syncTx.startNotifications();

    this.log('ride', 'Sending RideOn handshake');
    await syncRx.writeValueWithoutResponse(RIDE_ON);

    this.log('ride', `Connected to ${this.device.name}. Press a button.`, 'ok');
    this.dispatchEvent(new Event('status'));
  }

  disconnect() {
    if (this.connected) this.device.gatt.disconnect();
  }

  async _readFirmware(server) {
    try {
      const dis = await server.getPrimaryService('device_information');
      const fw = await dis.getCharacteristic('firmware_revision_string');
      this.firmware = new TextDecoder().decode(await fw.readValue()).replace(/\0/g, '').trim();
      const m = this.firmware.match(/^(\d+)\.(\d+)/);
      const v2 = m && (+m[1] > 1 || (+m[1] === 1 && +m[2] >= 3));
      this.log('ride', `Firmware ${this.firmware} → ${v2 ? 'Ride V2 (needs daily Zwift unlock)' : 'Ride V1 (no unlock needed)'}`,
        v2 ? 'warn' : 'ok');
    } catch (err) {
      this.log('ride', `Could not read firmware version (${err.message})`, 'debug');
    }
  }

  async _readBattery(server) {
    try {
      const bs = await server.getPrimaryService('battery_service');
      const lvl = await bs.getCharacteristic('battery_level');
      this.battery = (await lvl.readValue()).getUint8(0);
      this.log('ride', `Battery ${this.battery}%`);
    } catch { /* optional */ }
  }

  _onMessage(source, dv) {
    const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
    if (!bytes.length) return;
    const op = bytes[0];
    const opName = ZWIFT_OPCODE[op] || `0x${op.toString(16).padStart(2, '0')}`;

    if (this.showRaw) this.log('ride', `[${source}] ${opName}: ${toHex(bytes)}`, 'debug');

    if (op === 0x52) { // "R" of RideOn — handshake reply
      this.log('ride', 'Handshake reply received (RideOn)', 'ok');
      return;
    }
    if (op === 0x23) {
      try {
        const status = decodeRideKeyPad(bytes.subarray(1));
        const pressed = pressedButtons(status);
        const key = pressed.join(',');
        // The controller repeats identical frames; only report changes.
        if (key !== this._lastPressed) {
          this._lastPressed = key;
          if (pressed.length) this.log('ride', `Pressed: ${pressed.join(' + ')}`, 'button');
          this.dispatchEvent(new CustomEvent('buttons', { detail: pressed }));
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
      return;
    }
    if (!this.showRaw && op !== 0x15) {
      this.log('ride', `[${source}] ${opName}: ${toHex(bytes)}`, 'debug');
    }
  }
}
