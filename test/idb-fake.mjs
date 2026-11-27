// A small hand-written fake IndexedDB for the store and DOM tests: object stores of Maps, transactions that commit
// (or abort) after their requests. `fake.abortIf(t)`: a transaction to abort at commit (a full disk: QuotaExceededError,
// no error event, as browsers do); `fake.failOpen`: open() fails. Installs itself as globalThis.indexedDB.
export const fake = { stores: new Map(), txs: [], abortIf: null, failOpen: false };
function request(run) {
  const req = { result: undefined, error: null, onsuccess: null, onerror: null };
  req.run = () => { req.result = run(); req.onsuccess?.({ target: req }); };
  return req;
}
const db = {
  createObjectStore(name) { fake.stores.set(name, new Map()); },
  transaction(names, mode) {
    const scope = [].concat(names);
    for (const n of scope) if (!fake.stores.has(n)) throw new DOMException(`No store ${n}`, 'NotFoundError');
    const ops = [], reqs = [];
    const t = { mode, scope, error: null, oncomplete: null, onerror: null, onabort: null, aborted: false,
      abort() { t.aborted = true; },
      objectStore(n) {
        if (!scope.includes(n)) throw new DOMException(`${n} is not in this transaction`, 'NotFoundError');
        const m = fake.stores.get(n);
        const keyOf = (v, k) => k ?? v.id;
        const add = (req) => { reqs.push(req); return req; };
        return {
          put: (v, k) => add(request(() => { ops.push(() => m.set(keyOf(v, k), structuredClone(v))); return keyOf(v, k); })),
          delete: (k) => add(request(() => { ops.push(() => m.delete(k)); })),
          get: (k) => add(request(() => structuredClone(m.get(k)))),
          getAll: () => add(request(() => [...m.values()].map((v) => structuredClone(v)))),
        };
      } };
    fake.txs.push(t);
    setTimeout(() => {
      if (t.aborted) { t.error = new DOMException('aborted', 'AbortError'); return t.onabort?.(); }
      for (const r of reqs) r.run();
      setTimeout(() => {   // (the commit comes in a later task than the requests' success events, as in a browser)
        // a full disk: the commit fails, the transaction aborts — no error event (as browsers do for QuotaExceededError)
        if (fake.abortIf?.(t)) { t.error = new DOMException('The quota has been exceeded.', 'QuotaExceededError'); return t.onabort?.(); }
        for (const op of ops) op();
        t.oncomplete?.();
      }, 0);
    }, 0);
    return t;
  },
};
export const indexedDB = {
  open() {
    const req = { result: null, error: null };
    setTimeout(() => {
      if (fake.failOpen) { req.error = new DOMException('no', 'UnknownError'); return req.onerror?.(); }
      req.result = db;
      if (!fake.stores.size) req.onupgradeneeded?.();
      req.onsuccess?.();
    }, 0);
    return req;
  },
};
globalThis.indexedDB = indexedDB;
