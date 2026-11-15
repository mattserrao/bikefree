import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Profiles, initials, cmToFtIn, ftInToCm } from '../js/profiles.js';

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const ride = (profileId, distanceM, timerS = 600, ascentM = 10, startedAt = 1) => ({ profileId, startedAt, summary: { distanceM, timerS, ascentM } });

test('first run creates one profile with the fallback weight, and it persists', () => {
  const store = memory();
  const a = new Profiles(store, 72);
  assert.equal(a.all.length, 1);
  assert.equal(a.active.weightKg, 72);
  a.update(a.active.id, { name: 'Matt', heightCm: 180, gender: 'male' });
  const b = new Profiles(store, 99);
  assert.equal(b.active.name, 'Matt');
  assert.equal(b.active.weightKg, 72);
  assert.equal(b.active.heightCm, 180);
});

test('stats count rides and distance per profile; old untagged rides belong to the first profile', () => {
  const p = new Profiles(memory());
  const first = p.active.id;
  const second = p.create({ name: 'Guest' }).id;
  assert.equal(p.active.id, second);
  const rides = [ride(undefined, 1000), ride(first, 2000), ride(second, 5000), ride('gone', 300)];
  assert.deepEqual(
    { r: p.stats(first, rides).rides, d: p.stats(first, rides).distanceM },
    { r: 3, d: 3300 },
  );
  assert.equal(p.stats(second, rides).rides, 1);
  assert.equal(p.stats(second, rides).distanceM, 5000);
});

test('removing a profile keeps at least one and moves its rides to the first', () => {
  const p = new Profiles(memory());
  const first = p.active.id;
  assert.equal(p.remove(first), false);
  const second = p.create().id;
  assert.equal(p.remove(second), true);
  assert.equal(p.active.id, first);
  assert.equal(p.stats(first, [ride(second, 400)]).rides, 1);
});

test('helpers', () => {
  assert.equal(initials('matt serrao'), 'MS');
  assert.equal(initials(''), '?');
  assert.deepEqual(cmToFtIn(180), [5, 11]);
  assert.ok(Math.abs(ftInToCm(5, 11) - 180.34) < 0.01);
});
