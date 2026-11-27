// [review 27 Nov] The heart-rate strap over Web Bluetooth (js/hr.js), on the fake navigator.bluetooth of
// test/trainer-fakes.mjs. P13: its setup had no tests. A6: one 'gattserverdisconnected' listener per device and one
// notification listener per characteristic however often it's connected; a user disconnect or a new connect ends an
// old reconnect loop (a connection generation checked after every await).
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { HeartRate, parseHeartRate } from '../js/hr.js';
import { FakeChar, FakeDevice, installBluetooth, flush } from './trainer-fakes.mjs';

const tick = async (ms) => { mock.timers.tick(ms); await flush(); };
beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
afterEach(() => mock.timers.reset());
function strap() {
  const ch = new FakeChar('heart_rate_measurement');
  const device = new FakeDevice('HRM-Pro', { heart_rate: { heart_rate_measurement: ch } });
  installBluetooth(device);
  return { ch, device, hr: new HeartRate(() => {}) };
}

test('P13: the strap connects, subscribes and reads 8- and 16-bit heart rates', async () => {
  const { ch, hr } = strap();
  await hr.connect();
  assert.ok(hr.connected);
  assert.equal(ch.notifying, 1);
  ch.notify([0x00, 142]);
  assert.equal(hr.bpm, 142);
  ch.notify([0x01, 0x2c, 0x01]);
  assert.equal(hr.bpm, 300);
  assert.equal(parseHeartRate(new DataView(Uint8Array.from([0, 60]).buffer)), 60);
});

test('A6: connect → disconnect → connect, then a drop: one reconnect loop, one listener each', async () => {
  const { ch, device, hr } = strap();
  await hr.connect();
  hr.disconnect();
  await hr.connect();
  device.drop();
  assert.ok(hr.reconnecting);
  await tick(1000);
  assert.ok(hr.connected && !hr.reconnecting);
  await tick(120_000);
  assert.equal(device.connects, 3);
  assert.equal(device.disconnectListeners, 1);
  assert.equal(ch.listeners, 1);
});

test('A6: a user disconnect during the backoff cancels the loop; a connect during it supersedes the loop', async () => {
  const { device, hr } = strap();
  await hr.connect();
  device.drop();
  await tick(300);
  hr.disconnect();
  assert.ok(!hr.reconnecting);
  await tick(120_000);
  assert.equal(device.connects, 1);
  device.failNext = 0;
  await hr.connect();
  device.drop();
  await tick(300);
  hr.disconnect();
  await hr.connect();
  await tick(120_000);
  assert.equal(device.connects, 3, 'only the two connects: the old loop stayed stopped');
});
