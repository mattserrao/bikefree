// [review 27 Nov] Saving rides (js/store.js) on a small hand-written fake IndexedDB: a ride's summary and track go in
// one transaction; a full disk (the transaction aborts, QuotaExceededError, with no error event) rejects instead of
// hanging; the crash-recovery copy is cleared only once the ride is saved, and kept (as the finished ride) if not (A2);
// the browser is asked once to keep the site's storage (A4).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fake } from './idb-fake.mjs';

// navigator.storage: counts the persist() requests
const storage = { asked: 0, persisted: async () => false, persist: async () => { storage.asked++; return true; } };
Object.defineProperty(globalThis, 'navigator', { value: { storage }, configurable: true, writable: true });

const store = await import('../js/store.js');

const ride = (id = 1000) => ({ id, startedAt: id, endedAt: id + 3600e3, name: 'Test ride', samples: [[id, 200, 90, 8, 8, 100, 0, 0, null, null]],
  events: [], laps: [], summary: { timerS: 1, distanceM: 8 } });
/** Settles, or 'hung' after a while (the old tx() never settled on an abort). */
const within = (p, ms = 500) => Promise.race([p.then(() => 'ok', (e) => e), new Promise((r) => setTimeout(() => r('hung'), ms))]);

beforeEach(() => { for (const m of fake.stores.values()) m.clear(); fake.txs.length = 0; fake.abortIf = null; });

test('a ride\'s summary and track are saved in one transaction', async () => {
  await store.saveRide(ride(1));
  assert.equal(fake.txs.length, 1);
  assert.deepEqual(fake.txs[0].scope, ['rides', 'tracks']);
  assert.equal(fake.stores.get('rides').get(1).lapCount, 0);
  assert.equal(fake.stores.get('rides').get(1).samples, undefined);   // (the summary store has no samples)
  assert.equal(fake.stores.get('tracks').get(1).samples.length, 1);
  assert.equal((await store.listRides()).length, 1);
  assert.equal((await store.getRide(1)).name, 'Test ride');
  await store.deleteRide(1);
  assert.equal(fake.stores.get('rides').size + fake.stores.get('tracks').size, 0);
});

test('a full disk (the transaction aborts) rejects instead of hanging, and saves nothing', async () => {
  fake.abortIf = (t) => t.scope.includes('tracks');
  const res = await within(store.saveRide(ride(2)));
  assert.notEqual(res, 'hung', 'saveRide never settled');
  assert.equal(res?.name, 'QuotaExceededError');
  assert.equal(fake.stores.get('rides').size, 0, 'a summary without its track');
});

test('a finished ride: saved, and then (in the same transaction) the crash-recovery copy is cleared', async () => {
  await store.saveCurrent({ ...ride(3), recovered: true });
  await store.saveFinishedRide(ride(3));
  assert.equal(fake.stores.get('tracks').size, 1);
  assert.equal(await store.getCurrent(), undefined);
  assert.ok(fake.txs.at(-2).scope.includes('rides') && fake.txs.at(-2).scope.includes('state'));
});

test('a finished ride that can\'t be saved: the error comes back, and the ride is kept as the recovery copy', async () => {
  await store.saveCurrent({ ...ride(4), recovered: true, samples: [] });   // the last 15 s snapshot
  fake.abortIf = (t) => t.scope.includes('tracks');
  const res = await within(store.saveFinishedRide(ride(4)));
  assert.equal(res?.name, 'QuotaExceededError');
  fake.abortIf = null;
  const cur = await store.getCurrent();
  assert.ok(cur, 'the recovery copy was deleted');
  assert.equal(cur.samples.length, 1, 'the recovery copy is the finished ride');
  assert.equal(fake.stores.get('tracks').size, 0);
});

test('an error thrown while queuing the writes rejects (and aborts the transaction)', async () => {
  await store.saveRide(ride(5));
  const res = await within(store.saveRide(null));   // (rideMeta can't spread null)
  assert.ok(res instanceof Error && res !== 'hung');
});

test('the browser is asked once to keep the site\'s storage (the first ride saved)', async () => {
  assert.ok(storage.asked <= 1);
  await store.saveRide(ride(6));
  await store.saveRide(ride(7));
  await store.persistStorage();
  assert.equal(storage.asked, 1);
});
