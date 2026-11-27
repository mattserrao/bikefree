// [review 27 Nov] Stored settings are checked (A11): a numeric setting that isn't a finite number falls back to its
// default and one out of range is clamped, so a NaN bike weight, gear, difficulty, hill feel or gear ratio can't
// poison the ride's physics. A profile's weight (the ride's riderKg) too.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, sanitizeSettings } from '../js/settings.js';
import { Profiles } from '../js/profiles.js';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const KEY = 'bikefree.settings.v1';
beforeEach(() => mem.clear());

test('non-numbers fall back to the defaults (JSON turns NaN into null)', () => {
  mem.set(KEY, JSON.stringify({ bikeKg: NaN, startGear: 'x', difficulty: null, hillFeel: {}, realRatio: 'NaN', riderKg: true, ftp: [] }));
  const s = loadSettings();
  for (const k of ['bikeKg', 'startGear', 'difficulty', 'hillFeel', 'realRatio', 'riderKg', 'ftp']) assert.equal(s[k], DEFAULT_SETTINGS[k], k);
});

test('out of range is clamped; numeric strings are read; whole numbers rounded', () => {
  mem.set(KEY, JSON.stringify({ bikeKg: -5, startGear: 99.4, difficulty: 1000, hillFeel: '75', realRatio: 40, ftp: 251.6 }));
  const s = loadSettings();
  assert.deepEqual([s.bikeKg, s.startGear, s.difficulty, s.hillFeel, s.realRatio, s.ftp], [1, 24, 150, 75, 6, 252]);
});

test('good values are kept as they are', () => {
  mem.set(KEY, JSON.stringify({ bikeKg: 8.4, startGear: 7, difficulty: 85, hillFeel: 25, realRatio: 0, riderKg: 71.3, ftp: 240 }));
  const s = loadSettings();
  assert.deepEqual([s.bikeKg, s.startGear, s.difficulty, s.hillFeel, s.realRatio, s.riderKg, s.ftp], [8.4, 7, 85, 25, 0, 71.3, 240]);
});

test('saving checks the settings in place too (an empty form field reads as NaN)', () => {
  const s = { ...DEFAULT_SETTINGS, difficulty: Number(''), startGear: NaN };
  s.difficulty = NaN;
  saveSettings(s);
  assert.equal(s.difficulty, DEFAULT_SETTINGS.difficulty);
  assert.equal(s.startGear, DEFAULT_SETTINGS.startGear);
  assert.equal(JSON.parse(mem.get(KEY)).difficulty, DEFAULT_SETTINGS.difficulty);
  assert.equal(sanitizeSettings(s), s);
});

test('a profile whose weight is not a number takes the fallback weight', () => {
  const p = { activeId: 'a', firstId: 'a', profiles: [{ id: 'a', name: 'A', weightKg: null, ftp: 210 }, { id: 'b', name: 'B', weightKg: 'heavy', ftp: 200 }] };
  mem.set('bikefree.profiles.v1', JSON.stringify(p));
  const profiles = new Profiles(localStorage, 77);
  assert.deepEqual(profiles.all.map((x) => x.weightKg), [77, 77]);
});
