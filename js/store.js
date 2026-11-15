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
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
  });
}

const req2p = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

function rideMeta(ride) {
  const { samples, events, laps, ...meta } = ride;
  return { ...meta, lapCount: laps?.length ?? 0 };
}

export async function saveRide(ride) {
  await tx('rides', 'readwrite', (s) => s.put(rideMeta(ride)));
  await tx('tracks', 'readwrite', (s) => s.put(ride));
}

export async function listRides() {
  const all = await tx('rides', 'readonly', (s) => req2p(s.getAll()));
  return (all || []).sort((a, b) => b.startedAt - a.startedAt);
}

export async function getRide(id) {
  return tx('tracks', 'readonly', (s) => req2p(s.get(id)));
}

export async function deleteRide(id) {
  await tx('rides', 'readwrite', (s) => s.delete(id));
  await tx('tracks', 'readwrite', (s) => s.delete(id));
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
