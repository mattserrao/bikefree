// IndexedDB storage: ride history, in-progress ride (crash recovery), loaded routes/workouts.
const DB_NAME = 'bikefree';
const VERSION = 1;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('rides', { keyPath: 'id' });   // summaries
      db.createObjectStore('tracks', { keyPath: 'id' });  // full ride data
      db.createObjectStore('state');                      // 'current' in-progress ride
      db.createObjectStore('library', { keyPath: 'id' }); // user routes/workouts {id, kind, name, text}
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };   // [review 27 Nov] (the next call tries again)
  });
  return dbPromise;
}

/**
 * One transaction over `stores` (a name, or a list: `fn` gets the object stores in that order). [review 27 Nov] It
 * rejects on abort too: a full disk (QuotaExceededError) aborts the transaction without an error event, and the
 * await hung, so a finished ride was neither saved nor kept.
 */
async function tx(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    const s = Array.isArray(stores) ? stores.map((n) => t.objectStore(n)) : t.objectStore(stores);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new DOMException('The transaction was aborted', 'AbortError'));
    try {
      Promise.resolve(fn(s)).then((r) => { result = r; }, () => {});   // (a request's error reaches t.onerror / onabort)
    } catch (err) {
      try { t.abort(); } catch { /* already finished */ }
      reject(err);
    }
  });
}

const req2p = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/**
 * [review 27 Nov] Ask the browser to keep this site's storage (saved rides, offline tiles) when the disk runs low,
 * once a page: on the first ride saved and the first offline download. Best effort (a browser may say no, or ask).
 */
let persistAsked = null;
export function persistStorage() {
  if (persistAsked) return persistAsked;
  const st = globalThis.navigator?.storage;
  if (!st?.persist) return (persistAsked = Promise.resolve(false));
  persistAsked = Promise.resolve(st.persisted ? st.persisted() : false)
    .then((done) => done || st.persist()).catch(() => false);
  return persistAsked;
}

function rideMeta(ride) {
  const { samples, events, laps, ...meta } = ride;
  return { ...meta, lapCount: laps?.length ?? 0 };
}

/**
 * Save a ride: its summary and its track in one transaction ([review 27 Nov]: it was two, so a failure could leave a
 * summary without a track). `clearCurrent`: the crash-recovery copy goes in the same transaction — only once the
 * ride is safely saved.
 */
export async function saveRide(ride, { clearCurrent = false } = {}) {
  await tx(clearCurrent ? ['rides', 'tracks', 'state'] : ['rides', 'tracks'], 'readwrite', ([rides, tracks, state]) => {
    rides.put(rideMeta(ride));
    tracks.put(ride);
    state?.delete('current');
  });
  persistStorage();
}

/**
 * Save a finished ride and only then drop its crash-recovery copy ([review 27 Nov]: the copy was deleted first, so a
 * failed save lost the ride). If the save fails, the finished ride itself becomes the recovery copy (best effort:
 * offered again at the next start) and the error is thrown, so the app can offer the .fit download.
 */
export async function saveFinishedRide(ride) {
  try {
    await saveRide(ride, { clearCurrent: true });
  } catch (err) {
    await saveCurrent(ride).catch(() => {});
    throw err;
  }
}

export async function listRides() {
  const all = await tx('rides', 'readonly', (s) => req2p(s.getAll()));
  return (all || []).sort((a, b) => b.startedAt - a.startedAt);
}

export async function getRide(id) {
  return tx('tracks', 'readonly', (s) => req2p(s.get(id)));
}

export async function deleteRide(id) {
  await tx(['rides', 'tracks'], 'readwrite', ([rides, tracks]) => { rides.delete(id); tracks.delete(id); });
}

export async function saveCurrent(ride) {
  return tx('state', 'readwrite', (s) => (ride ? s.put(ride, 'current') : s.delete('current')));
}

export async function getCurrent() {
  return tx('state', 'readonly', (s) => req2p(s.get('current')));
}

export async function saveLibraryItem(item) {
  return tx('library', 'readwrite', (s) => s.put(item));
}

export async function listLibrary(kind) {
  const all = await tx('library', 'readonly', (s) => req2p(s.getAll()));
  return (all || []).filter((x) => !kind || x.kind === kind).sort((a, b) => a.name.localeCompare(b.name));
}

export async function deleteLibraryItem(id) {
  return tx('library', 'readwrite', (s) => s.delete(id));
}
