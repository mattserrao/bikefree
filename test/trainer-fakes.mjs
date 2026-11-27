// [review 27 Nov] A6 / P13: a hand-written fake of Web Bluetooth for the trainer, heart-rate and handlebar tests.
// requestDevice() returns the same FakeDevice each time (as Chrome does for the same trainer), and its server hands
// back the same characteristic objects on every reconnect; listener registrations are counted.

export class FakeChar extends EventTarget {
  constructor(uuid, { respond } = {}) {
    super();
    this.uuid = uuid; this.value = null; this.notifying = 0; this.writes = []; this.listeners = 0;
    this.respond = respond;   // (control point: answers each write)
  }
  addEventListener(type, fn, o) { if (type === 'characteristicvaluechanged') this.listeners++; super.addEventListener(type, fn, o); }
  async startNotifications() { this.notifying++; return this; }
  async readValue() { return this.value; }
  async writeValueWithResponse(bytes) { this.writes.push([...bytes]); this.respond?.(this, [...bytes]); }
  async writeValueWithoutResponse(bytes) { this.writes.push([...bytes]); }
  /** The device sends a notification / indication. */
  notify(bytes) {
    this.value = new DataView(Uint8Array.from(bytes).buffer);
    this.dispatchEvent(new Event('characteristicvaluechanged'));
  }
}

export class FakeDevice extends EventTarget {
  /** `services`: { [uuid]: { [charUuid]: FakeChar } } */
  constructor(name, services) {
    super();
    this.name = name; this.services = services; this.connects = 0; this.failNext = 0; this.disconnectListeners = 0;
    const server = {
      getPrimaryService: async (uuid) => {
        const chars = services[uuid];
        if (!chars) throw Object.assign(new Error(`No service ${uuid}`), { name: 'NotFoundError' });
        return { getCharacteristic: async (c) => { if (!chars[c]) throw Object.assign(new Error(`No characteristic ${c}`), { name: 'NotFoundError' }); return chars[c]; } };
      },
    };
    this.gatt = {
      connected: false,
      connect: async () => {
        this.connects++;
        if (this.failNext > 0) { this.failNext--; throw new Error('Connection attempt failed'); }
        this.gatt.connected = true;
        return server;
      },
      disconnect: () => { if (this.gatt.connected) this.drop(); },
    };
  }
  addEventListener(type, fn, o) { if (type === 'gattserverdisconnected') this.disconnectListeners++; super.addEventListener(type, fn, o); }
  /** The link drops (out of range, powered off), or gatt.disconnect(). */
  drop() { this.gatt.connected = false; this.dispatchEvent(new Event('gattserverdisconnected')); }
}

/** Install navigator.bluetooth returning `device`; returns the requestDevice calls. */
export function installBluetooth(device) {
  const calls = [];
  const bluetooth = { requestDevice: async (opts) => { calls.push(opts); return device; } };
  Object.defineProperty(globalThis, 'navigator', { value: { ...(globalThis.navigator || {}), bluetooth }, configurable: true, writable: true });
  return calls;
}

/** A KICKR-like FTMS trainer: bike data, control point (answers Success unless `results` says otherwise), machine status. */
export function fakeTrainer({ results = {}, autoRespond = true } = {}) {
  const cp = new FakeChar(0x2ad9, {
    respond: (ch, bytes) => {
      if (!autoRespond) return;
      Promise.resolve().then(() => ch.notify([0x80, bytes[0], results[bytes[0]] ?? 0x01]));
    },
  });
  const chars = { bikeData: new FakeChar(0x2ad2), cp, status: new FakeChar(0x2ada) };
  const device = new FakeDevice('KICKR CORE 2', { 0x1826: { 0x2ad2: chars.bikeData, 0x2ad9: cp, 0x2ada: chars.status } });
  return { device, chars };
}

/** Indoor Bike Data: speed, cadence and power present (flags 0x0044). */
export function bikeData({ kph = 30, rpm = 90, watts = 200 } = {}) {
  const b = new Uint8Array(8), dv = new DataView(b.buffer);
  dv.setUint16(0, 0x0044, true); dv.setUint16(2, Math.round(kph * 100), true); dv.setUint16(4, rpm * 2, true); dv.setInt16(6, watts, true);
  return [...b];
}

/** Let pending promise chains run (the fake timers leave setImmediate real). */
export async function flush(n = 20) { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); }
