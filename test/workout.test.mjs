import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkout, segmentIndexAt, targetWatts, BUILT_IN_WORKOUTS, zoneColor } from '../js/workout.js';

test('zwo: warmup ramp, intervals expand, free ride', () => {
  const w = parseWorkout(`<workout_file><name>T</name><workout>
    <Warmup Duration="300" PowerLow="0.5" PowerHigh="0.7"/>
    <IntervalsT Repeat="2" OnDuration="60" OffDuration="30" OnPower="1.2" OffPower="0.5"/>
    <FreeRide Duration="120" FlatRoad="1"/>
    <SteadyState Duration="60" Power="0.8"><textevent timeoffset="10" message="hi"/></SteadyState>
  </workout></workout_file>`);
  assert.equal(w.name, 'T');
  assert.equal(w.segments.length, 1 + 4 + 1 + 1);
  assert.equal(w.duration, 300 + 180 + 120 + 60);
  assert.equal(targetWatts(w.segments[0], 0, 200), 100);
  assert.equal(targetWatts(w.segments[0], 150, 200), 120);
  assert.equal(targetWatts(w.segments[1], 310, 200), 240);
  assert.equal(w.segments[5].kind, 'free');
  assert.equal(targetWatts(w.segments[5], 500, 200), null);
  assert.equal(segmentIndexAt(w, 0), 0);
  assert.equal(segmentIndexAt(w, 365), 2);
  assert.equal(segmentIndexAt(w, 659), 6);
  assert.equal(segmentIndexAt(w, 660), -1);
  assert.equal(targetWatts(w.segments[6], 630, 200, 1.1), 176);
});

test('erg file in watts', () => {
  const w = parseWorkout(`[COURSE HEADER]
VERSION = 2
UNITS = ENGLISH
DESCRIPTION = Test ERG
MINUTES WATTS
[END COURSE HEADER]
[COURSE DATA]
0 100
5 200
5 250
10 250
[END COURSE DATA]`, 'x.erg');
  assert.equal(w.name, 'Test ERG');
  assert.equal(w.duration, 600);
  assert.equal(w.segments.length, 2);
  assert.equal(targetWatts(w.segments[0], 150, 999), 150);
  assert.equal(targetWatts(w.segments[1], 400, 999), 250);
});

test('mrc file in percent', () => {
  const w = parseWorkout(`[COURSE HEADER]
MINUTES PERCENT
[END COURSE HEADER]
[COURSE DATA]
0 50
10 50
10 90
20 90
[END COURSE DATA]`, 'x.mrc');
  assert.equal(targetWatts(w.segments[1], 700, 250), 225);
});

test('built-ins parse', () => {
  for (const b of BUILT_IN_WORKOUTS) {
    const w = parseWorkout(b.text);
    assert.ok(w.duration >= 1200, `${w.name} ${w.duration}`);
  }
  assert.equal(zoneColor(1.15), '#ff7a1a');
});

test('rejects junk', () => {
  assert.throws(() => parseWorkout('hello'));
});
