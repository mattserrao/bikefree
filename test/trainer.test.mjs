// [review 27 Nov] The trainer over Web Bluetooth (js/trainer.js), on a fake navigator.bluetooth (test/trainer-fakes.mjs).
// P13: setup and the FTMS control point's request/response flow had no tests. A6: every connect() added another
// 'gattserverdisconnected' listener to the same BluetoothDevice and a new connect() reset the flag an old reconnect
// loop checked, so loops raced and characteristic listeners / 'reconnected' events doubled. Now one listener per
// device and characteristic, and a connection generation each loop checks after every await.
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Trainer } from '../js/trainer.js';
import { installBluetooth, fakeTrainer, bikeData, flush } from './trainer-fakes.mjs';

let logs;
const makeTrainer = () => { logs = []; return new Trainer((src, msg, lvl = 'info') => logs.push([lvl, msg])); };
const count = (t, type) => { const n = { v: 0 }; t.addEventListener(type, () => n.v++); return n; };
const tick = async (ms) => { mock.timers.tick(ms); await flush(); };

beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
afterEach(() => mock.timers.reset());

test('P13: connect subscribes to bike data and the control point; bike data is parsed into data events', async () => {
  const { device, chars } = fakeTrainer();
  const calls = installBluetooth(device);
  const t = makeTrainer();
  const status = count(t, 'status');
  await t.connect();
  assert.deepEqual(calls[0].filters, [{ services: [0x1826] }]);
  assert.ok(t.connected);
  assert.equal(chars.bikeData.notifying, 1);
  assert.equal(chars.cp.notifying, 1);
  assert.equal(chars.status.notifying, 1);
  assert.ok(status.v >= 1);
  const data = [];
  t.addEventListener('data', (e) => data.push({ ...e.detail }));
  chars.bikeData.notify(bikeData({ kph: 32.5, rpm: 88, watts: 210 }));
  assert.equal(data.length, 1);
  assert.deepEqual(data[0], { speedKph: 32.5, cadenceRpm: 88, powerW: 210 });
  assert.ok(t.lastDataAt > 0);
});

test('P13: the first target requests control and starts, then sends it; each write waits for its response', async () => {
  const { device, chars } = fakeTrainer({ autoRespond: false });
  installBluetooth(device);
  const t = makeTrainer();
  await t.connect();
  const done = t.setErgWatts(150);
  await flush();
  assert.deepEqual(chars.cp.writes, [[0x00]], 'only Request Control, until the trainer answers it');
  assert.ok(t.busy);
  chars.cp.notify([0x80, 0x00, 0x01]); await flush();
  assert.ok(t.hasControl);
  assert.deepEqual(chars.cp.writes, [[0x00], [0x07]]);
  chars.cp.notify([0x80, 0x07, 0x01]); await flush();
  assert.deepEqual(chars.cp.writes.at(-1), [0x05, 150, 0]);
  chars.cp.notify([0x80, 0x05, 0x01]);
  await done;
  assert.ok(!t.busy);
  // a SIM grade now goes straight out (control held): 5 % grade, crr 0.004
  const g = t.setGrade(5, { windMps: 0, crr: 0.004, cw: 0 });
  await flush();
  assert.deepEqual(chars.cp.writes.at(-1), [0x11, 0, 0, 0xf4, 0x01, 40, 0]);
  chars.cp.notify([0x80, 0x11, 0x01]);
  await g;
});

test('P13: "control not permitted" drops control (re-requested next time); no answer times out after 3 s', async () => {
  const { device, chars } = fakeTrainer({ results: { 0x05: 0x05 } });
  installBluetooth(device);
  const t = makeTrainer();
  await t.connect();
  await t.setErgWatts(100);
  assert.ok(!t.hasControl, 'Control not permitted');
  assert.ok(logs.some(([lvl, m]) => lvl === 'warn' && /SET_TARGET_POWER → Control not permitted/.test(m)));
  const n = chars.cp.writes.length;
  chars.cp.respond = null;   // the trainer stops answering
  const p = t.setErgWatts(120);
  await flush();
  assert.deepEqual(chars.cp.writes.slice(n), [[0x00]], 'control is requested again');
  await tick(3000);
  await tick(3000);
  await tick(3000);
  await p;
  assert.equal(logs.filter(([lvl, m]) => lvl === 'warn' && /No response from trainer/.test(m)).length, 3);
  assert.ok(!t.busy, 'the queue moves on after a timeout');
});

test('A6: a dropped trainer reconnects once, with one reconnected event and one set of listeners', async () => {
  const { device, chars } = fakeTrainer();
  installBluetooth(device);
  const t = makeTrainer();
  const reconnected = count(t, 'reconnected');
  await t.connect();
  device.failNext = 1;   // the first attempt fails
  device.drop();
  assert.ok(t.reconnecting && !t.connected);
  await tick(1000);
  assert.ok(t.reconnecting);
  await tick(2000);
  assert.ok(t.connected && !t.reconnecting);
  assert.equal(reconnected.v, 1);
  assert.equal(device.connects, 3);
  const data = count(t, 'data');
  chars.bikeData.notify(bikeData());
  assert.equal(data.v, 1, 'one data event per notification');
  assert.equal(chars.bikeData.listeners, 1);
  assert.equal(chars.cp.listeners, 1);
});

test('A6: a user disconnect during the backoff cancels the reconnect loop', async () => {
  const { device } = fakeTrainer();
  installBluetooth(device);
  const t = makeTrainer();
  const status = count(t, 'status');
  await t.connect();
  device.drop();
  await tick(500);
  t.disconnect();
  assert.ok(!t.reconnecting);
  assert.ok(status.v > 0);
  await tick(120_000);
  assert.equal(device.connects, 1, 'the loop reconnected after the user disconnected');
  assert.ok(!logs.some(([lvl]) => lvl === 'error'), 'no "Could not reconnect" error after a user disconnect');
});

test('A6: connect → disconnect → connect, then a drop: exactly one loop and one set of listeners', async () => {
  const { device, chars } = fakeTrainer();
  installBluetooth(device);
  const t = makeTrainer();
  const reconnected = count(t, 'reconnected');
  await t.connect();
  t.disconnect();
  await t.connect();
  assert.equal(device.disconnectListeners, 1, 'one gattserverdisconnected listener on the device');
  device.drop();
  await tick(1000);
  assert.ok(t.connected);
  await tick(120_000);
  assert.equal(device.connects, 3, `${device.connects} gatt.connect() calls (two connects + one reconnect)`);
  assert.equal(reconnected.v, 1);
  for (const k of ['bikeData', 'cp', 'status']) assert.equal(chars[k].listeners, 1, `${k} listeners`);
  const data = count(t, 'data');
  chars.bikeData.notify(bikeData());
  assert.equal(data.v, 1);
});

test('A6: connecting again while an old loop sleeps (disconnect, connect during its backoff): the old loop stops', async () => {
  const { device } = fakeTrainer();
  installBluetooth(device);
  const t = makeTrainer();
  const reconnected = count(t, 'reconnected');
  await t.connect();
  device.drop();
  await tick(400);
  t.disconnect();
  await t.connect();   // (this reset the flag the old loop checked: it went on to set up again)
  assert.ok(t.connected);
  await tick(120_000);
  assert.equal(device.connects, 2);
  assert.equal(reconnected.v, 0);
  assert.ok(t.connected && !t.reconnecting);
});

test('A6: giving up after every delay still says so (not after a user disconnect)', async () => {
  const { device } = fakeTrainer();
  installBluetooth(device);
  const t = makeTrainer();
  await t.connect();
  device.failNext = 99;
  device.drop();
  for (const d of [1000, 2000, 4000, 8000, 15000, 30000]) await tick(d);
  assert.ok(!t.reconnecting);
  assert.ok(logs.some(([lvl, m]) => lvl === 'error' && /Could not reconnect/.test(m)));
  assert.equal(device.connects, 7);
});
