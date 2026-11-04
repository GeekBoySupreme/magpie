// Tiny IndexedDB layer. The service worker and the side panel share this
// origin, so both read and write the same database.
const NAME = 'magpie';
const VERSION = 1;
let _db = null;

export function openDB() {
  if (_db) return _db;
  _db = new Promise((resolve, reject) => {
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('items')) {
        const s = d.createObjectStore('items', { keyPath: 'id' });
        s.createIndex('platform', 'platform');
        s.createIndex('status', 'status');
        s.createIndex('savedAt', 'savedAt');
      }
      if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
      if (!d.objectStoreNames.contains('threads')) d.createObjectStore('threads', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('plans')) d.createObjectStore('plans', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
    };
    r.onsuccess = () => {
      const d = r.result;
      d.onversionchange = () => { d.close(); _db = null; };
      resolve(d);
    };
    r.onerror = () => { _db = null; reject(r.error); };
  });
  return _db;
}

function run(store, mode, fn) {
  return openDB().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    const req = fn(s, v => { out = v; });
    if (req && typeof req === 'object' && 'onsuccess' in req) req.onsuccess = () => { out = req.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new DOMException('Transaction aborted', 'AbortError'));
  }));
}

function makeStore(store, hasKeyPath) {
  return {
    get: k => run(store, 'readonly', s => s.get(k)),
    put: hasKeyPath ? v => run(store, 'readwrite', s => s.put(v)) : (k, v) => run(store, 'readwrite', s => s.put(v, k)),
    del: k => run(store, 'readwrite', s => s.delete(k)),
    all: () => run(store, 'readonly', s => s.getAll()),
    keys: () => run(store, 'readonly', s => s.getAllKeys()),
    clear: () => run(store, 'readwrite', s => s.clear()),
    byIndex: (index, value) => run(store, 'readonly', s => s.index(index).getAll(value)),
    getMany: keys => run(store, 'readonly', (s, set) => {
      const out = new Array(keys.length);
      keys.forEach((k, i) => { const r = s.get(k); r.onsuccess = () => { out[i] = r.result; }; });
      set(out);
    }),
    // Read-modify-write in a single transaction.
    patch: (k, fn) => run(store, 'readwrite', (s, set) => {
      const r = s.get(k);
      r.onsuccess = () => {
        if (!r.result) { set(null); return; }
        const next = typeof fn === 'function' ? fn(r.result) : { ...r.result, ...fn };
        s.put(next);
        set(next);
      };
    }),
  };
}

export const items = makeStore('items', true);
export const blobs = makeStore('blobs', false);
export const threads = makeStore('threads', true);
export const plans = makeStore('plans', true);
export const kv = makeStore('kv', false);
