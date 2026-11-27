// [review 27 Nov] A6, the Zwift Ride handlebars (js/ride.js; the trainer's and strap's links are in trainer.test.mjs
// and hr.test.mjs): the same once-per-device / once-per-characteristic listeners and connection generations.
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Ride } from '../js/ride.js';
import { FakeChar, FakeDevice, installBluetooth, flush } from './trainer-fakes.mjs';

const tick = async (ms) => { mock.timers.tick(ms); await flush(); };
beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
afterEach(() => mock.timers.reset());

test('A6: handlebars: connect → disconnect → connect, then a drop: one loop, one listener per characteristic', async () => {
  const chars = { a: new FakeChar('async'), tx: new FakeChar('syncTx'), rx: new FakeChar('syncRx') };
  const device = new FakeDevice('Zwift Ride', { 0xfc82: {
    '00000002-19ca-4651-86e5-fa29dcdd09d1': chars.a, '00000004-19ca-4651-86e5-fa29dcdd09d1': chars.tx, '00000003-19ca-4651-86e5-fa29dcdd09d1': chars.rx } });
  installBluetooth(device);
  const ride = new Ride(() => {});
  await ride.connect();
  assert.ok(ride.connected);
  assert.deepEqual(chars.rx.writes[0], [...new TextEncoder().encode('RideOn')]);
  ride.disconnect();
  await ride.connect();
  device.drop();
  await tick(1000);
  assert.ok(ride.connected && !ride.reconnecting);
  await tick(120_000);
  assert.equal(device.connects, 3);
  assert.equal(device.disconnectListeners, 1);
  assert.equal(chars.a.listeners, 1);
  assert.equal(chars.tx.listeners, 1);
  // a user disconnect during the backoff: no further attempts
  device.drop();
  await tick(200);
  ride.disconnect();
  await tick(120_000);
  assert.equal(device.connects, 3);
  assert.ok(!ride.reconnecting);
});
