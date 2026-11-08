// IndexedDB 資料層：書架 shelves、書 books、照片 photos
const DB_NAME = 'reading-library';
const DB_VERSION = 1;

let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('shelves')) {
          db.createObjectStore('shelves', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('books')) {
          const books = db.createObjectStore('books', { keyPath: 'id' });
          books.createIndex('shelfId', 'shelfId');
        }
        if (!db.objectStoreNames.contains('photos')) {
          const photos = db.createObjectStore('photos', { keyPath: 'id' });
          photos.createIndex('bookId', 'bookId');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

// 執行一個交易；fn 內只能同步發出請求。回傳值若為 IDBRequest，完成後回傳其 result。
async function run(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let out;
    tx.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('交易中止'));
    try {
      out = fn(tx);
    } catch (err) {
      tx.abort();
      reject(err);
    }
  });
}

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export const getAll = (store) => run(store, 'readonly', (tx) => tx.objectStore(store).getAll());
export const get = (store, id) => run(store, 'readonly', (tx) => tx.objectStore(store).get(id));
export const put = (store, value) => run(store, 'readwrite', (tx) => { tx.objectStore(store).put(value); return value; });

export const getBooksByShelf = (shelfId) =>
  run('books', 'readonly', (tx) => tx.objectStore('books').index('shelfId').getAll(shelfId));

export async function getPhotos(ids) {
  if (!ids.length) return [];
  const list = await run('photos', 'readonly', (tx) => {
    const store = tx.objectStore('photos');
    return ids.map((id) => store.get(id));
  });
  return list.map((r) => r.result).filter(Boolean);
}

export const putMany = (entries) =>
  run(['shelves', 'books', 'photos'], 'readwrite', (tx) => {
    for (const [store, value] of entries) tx.objectStore(store).put(value);
  });

export const deletePhoto = (id) => run('photos', 'readwrite', (tx) => { tx.objectStore('photos').delete(id); });

function deleteBookIn(tx, bookId) {
  const photos = tx.objectStore('photos');
  tx.objectStore('books').delete(bookId);
  photos.index('bookId').getAllKeys(bookId).onsuccess = (e) => {
    for (const key of e.target.result) photos.delete(key);
  };
}

export const deleteBook = (bookId) =>
  run(['books', 'photos'], 'readwrite', (tx) => deleteBookIn(tx, bookId));

export const deleteShelf = (shelfId) =>
  run(['shelves', 'books', 'photos'], 'readwrite', (tx) => {
    tx.objectStore('shelves').delete(shelfId);
    tx.objectStore('books').index('shelfId').getAllKeys(shelfId).onsuccess = (e) => {
      for (const bookId of e.target.result) deleteBookIn(tx, bookId);
    };
  });
