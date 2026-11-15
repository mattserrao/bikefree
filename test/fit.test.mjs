import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Decoder, Stream } from '@garmin/fitsdk';
import { Recorder, rideToFit, summarize, S } from '../js/recorder.js';

function fakeRide({ gps = false, seconds = 600, pauseAt = 300, pauseLen = 60 } = {}) {
  const r = new Recorder();
  const t0 = Date.UTC(2026, 10, 14, 22, 0, 0);
  r.start(t0);
  r.setLapLabel('Warmup');
  let t = t0, dist = 0, alt = 100;
  for (let i = 0; i < seconds; i++) {
    if (i === pauseAt) { r.stop(t); t += pauseLen * 1000; r.start(t); }
    if (i === 200) r.lap(t, 'Main');
    t += 1000;
    const speed = 8 + Math.sin(i / 30);
    dist += speed;
    alt += 0.05;
    r.add([t, 150 + (i % 60), 88, speed, dist, alt, 130 + (i % 10), 2.5,
      gps ? 44 + dist / 111000 : null, gps ? -74 + i * 1e-5 : null]);
  }
  return r.finish(t + 1000, { name: 'Test ride' });
}

function decode(bytes) {
  const stream = Stream.fromByteArray(Array.from(bytes));
  const decoder = new Decoder(stream);
  assert.ok(decoder.isFIT(), 'is FIT');
  assert.ok(decoder.checkIntegrity(), 'CRC integrity');
  return decoder.read();
}

test('indoor ride decodes with Garmin SDK', () => {
  const ride = fakeRide();
  const { messages, errors } = decode(rideToFit(ride));
  assert.deepEqual(errors, []);
  assert.equal(messages.fileIdMesgs[0].type, 'activity');
  assert.equal(messages.recordMesgs.length, 600);
  const rec = messages.recordMesgs[10];
  assert.equal(rec.power, ride.samples[10][S.POWER]);
  assert.equal(rec.cadence, 88);
  assert.ok(Math.abs(rec.distance - ride.samples[10][S.DIST]) < 0.01);
  assert.ok(Math.abs(rec.altitude - ride.samples[10][S.ALT]) < 0.2);
  assert.equal(rec.positionLat, undefined);
  const session = messages.sessionMesgs[0];
  assert.equal(session.sport, 'cycling');
  assert.equal(session.subSport, 'indoorCycling');
  assert.equal(session.totalTimerTime, 600);
  assert.equal(session.totalElapsedTime, 661);
  assert.equal(session.numLaps, 2);
  assert.equal(messages.lapMesgs.length, 2);
  assert.equal(messages.lapMesgs[0].totalTimerTime, 200);
  assert.equal(messages.activityMesgs[0].numSessions, 1);
  const stops = messages.eventMesgs.filter((e) => e.eventType === 'stopAll').length;
  assert.equal(stops, 2); // the pause and the finish
});

test('route ride carries GPS and is a virtual activity', () => {
  const ride = fakeRide({ gps: true });
  const { messages, errors } = decode(rideToFit(ride));
  assert.deepEqual(errors, []);
  assert.equal(messages.sessionMesgs[0].subSport, 'virtualActivity');
  const rec = messages.recordMesgs[0];
  const lat = (rec.positionLat * 180) / 2 ** 31;
  assert.ok(Math.abs(lat - ride.samples[0][S.LAT]) < 1e-6);
});

test('summary math', () => {
  const ride = fakeRide();
  const s = ride.summary;
  assert.equal(s.timerS, 600);
  assert.ok(s.avgPower > 150 && s.avgPower < 210);
  assert.equal(s.maxPower, 209);
  assert.equal(s.maxHr, 139);
  assert.ok(s.np >= s.avgPower);
  assert.ok(Math.abs(s.distanceM - ride.samples[599][S.DIST]) < 0.01);
  const lap2 = summarize(ride.samples, 200, 600);
  assert.equal(lap2.timerS, 400);
});
