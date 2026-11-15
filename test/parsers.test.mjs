// Run with: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseIndoorBikeData, encodeTargetPower, encodeSimParams, parseControlPointResponse,
  parseCyclingPower, cadenceFromCrank, decodeRideKeyPad, pressedButtons, shiftDirection, readVarint,
} from '../js/parsers.js';

const dv = (arr) => new DataView(new Uint8Array(arr).buffer);

test('indoor bike data: speed + cadence + power', () => {
  // flags 0x0044: speed present (bit0=0), cadence (bit2), power (bit6)
  // speed 3250 = 32.50 km/h, cadence 180 = 90 rpm, power 215 W
  const d = parseIndoorBikeData(dv([0x44, 0x00, 0xb2, 0x0c, 0xb4, 0x00, 0xd7, 0x00]));
  assert.equal(d.speedKph, 32.5);
  assert.equal(d.cadenceRpm, 90);
  assert.equal(d.powerW, 215);
});

test('indoor bike data: skips avg speed, distance, resistance before power', () => {
  // flags: avg speed(0x02) cadence(0x04) distance(0x10) resistance(0x20) power(0x40) HR(0x200) = 0x0276
  const bytes = [0x76, 0x02,
    0xe8, 0x03,       // speed 10.00
    0x00, 0x00,       // avg speed
    0x50, 0x00,       // cadence 40
    0x10, 0x27, 0x00, // distance 10000 m
    0x05, 0x00,       // resistance 5
    0x2c, 0x01,       // power 300
    0x8c,             // HR 140
  ];
  const d = parseIndoorBikeData(dv(bytes));
  assert.deepEqual(d, { speedKph: 10, cadenceRpm: 40, distanceM: 10000, resistance: 5, powerW: 300, heartRate: 140 });
});

test('indoor bike data: More Data flag means no speed', () => {
  const d = parseIndoorBikeData(dv([0x41, 0x00, 0x64, 0x00]));
  assert.equal(d.speedKph, undefined);
  assert.equal(d.powerW, 100);
});

test('encode ERG target power', () => {
  assert.deepEqual([...encodeTargetPower(250)], [0x05, 0xfa, 0x00]);
});

test('encode SIM params', () => {
  // grade 5.5% → 550 = 0x0226; crr 0.004 → 40; cw 0.51 → 51
  assert.deepEqual([...encodeSimParams(5.5)], [0x11, 0x00, 0x00, 0x26, 0x02, 40, 51]);
  // negative grade -2% → -200 = 0xff38
  assert.deepEqual([...encodeSimParams(-2)].slice(3, 5), [0x38, 0xff]);
});

test('control point response', () => {
  assert.deepEqual(parseControlPointResponse(dv([0x80, 0x05, 0x01])),
    { requestOp: 5, result: 1, ok: true, text: 'Success' });
  assert.equal(parseControlPointResponse(dv([0x80, 0x00, 0x05])).ok, false);
});

test('cycling power crank cadence with rollover', () => {
  const a = parseCyclingPower(dv([0x20, 0x00, 0xc8, 0x00, 0xff, 0xff, 0x00, 0xfc]));
  assert.equal(a.powerW, 200);
  const b = { crankRevs: 0x0000, crankTime: 0xfc00 + 683 - 0x10000 + 0x10000 };
  b.crankTime = (0xfc00 + 683) & 0xffff; // ~0.667 s later, rolled over
  const rpm = cadenceFromCrank(a, b);
  assert.ok(Math.abs(rpm - 90) < 0.5, `rpm ${rpm}`);
});

test('varint', () => {
  assert.deepEqual(readVarint([0xff, 0xff, 0xff, 0xff, 0x0f], 0), [0xffffffff, 5]);
});

test('ride keypad: nothing pressed', () => {
  const s = decodeRideKeyPad(new Uint8Array([0x08, 0xff, 0xff, 0xff, 0xff, 0x0f]));
  assert.deepEqual(pressedButtons(s), []);
});

test('ride keypad: shift up right pressed (bit cleared)', () => {
  // 0xffffffff with 0x1000 cleared = 0xffffefff
  const map = 0xffffefff;
  const bytes = [0x08];
  let v = map;
  while (v >= 0x80) { bytes.push((v % 128) | 0x80); v = Math.floor(v / 128); }
  bytes.push(v);
  const pressed = pressedButtons(decodeRideKeyPad(new Uint8Array(bytes)));
  assert.deepEqual(pressed, ['shiftUpRight']);
  assert.equal(shiftDirection('shiftUpRight'), 1);
});

test('ride keypad: analog paddles', () => {
  // field 1 released map, then two paddles: left value -60 (zigzag 119), right value 10 (zigzag 20)
  const bytes = new Uint8Array([
    0x08, 0xff, 0xff, 0xff, 0xff, 0x0f,
    0x1a, 0x04, 0x08, 0x00, 0x10, 0x77,
    0x1a, 0x04, 0x08, 0x01, 0x10, 0x14,
  ]);
  const s = decodeRideKeyPad(bytes);
  assert.deepEqual(s.paddles, [{ location: 0, value: -60 }, { location: 1, value: 10 }]);
  assert.deepEqual(pressedButtons(s), ['paddleLeft']);
  assert.equal(shiftDirection('paddleLeft'), -1);
});
