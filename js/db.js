// IndexedDB 資料層
//   shelves：書架
//   books：書的文字資料與照片 id 清單（常常修改，體積小）
//   photos：照片位元組 { id, bookId, data: ArrayBuffer, thumb: ArrayBuffer, type, createdAt }
//           （很少修改，體積大；只在新增或刪除照片時寫入）
//   meta：資料格式版本等設定
//
// 照片一律以 ArrayBuffer 儲存，不存 File / Blob 參照：
// iOS Safari 的 File / Blob 可能指向會被系統刪除的暫存檔，存成參照之後就讀不到了。
import { toArrayBuffer } from './image.js?v=2';

const DB_NAME = 'reading-library';
const DB_VERSION = 2;
const PHOTO_FORMAT = 2;

let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
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
        if (!db.objectStoreNames.contains('meta')) {
          const meta = db.createObjectStore('meta', { keyPath: 'key' });
          // 全新的資料庫不需要轉換舊照片
          if (e.oldVersion === 0) meta.put({ key: 'photoFormat', value: PHOTO_FORMAT });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // 其他分頁升級資料庫時，關閉舊連線並重新載入
        db.onversionchange = () => { db.close(); location.reload(); };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => console.warn('資料庫升級被其他分頁擋住，請關閉其他分頁');
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

// 在同一個交易中寫入與刪除多筆資料（例如：新增照片 + 更新書的照片清單）
export const commit = ({ puts = [], dels = [] }) =>
  run(['shelves', 'books', 'photos'], 'readwrite', (tx) => {
    for (const [store, value] of puts) tx.objectStore(store).put(value);
    for (const [store, key] of dels) tx.objectStore(store).delete(key);
  });

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

/* ---------- 舊資料轉換（v1：照片存成 Blob → v2：照片存成 ArrayBuffer） ---------- */

async function readBlob(blob) {
  if (!(blob instanceof Blob)) throw new Error('不是 Blob');
  const buf = await toArrayBuffer(blob);
  if (!buf.byteLength) throw new Error('空的圖片');
  return buf;
}

// 回傳 { converted, broken }。讀不到的照片標記為 broken，畫面上會提示重新上傳，不會默默消失。
export async function migratePhotos() {
  const format = await get('meta', 'photoFormat');
  if (format?.value >= PHOTO_FORMAT) return { converted: 0, broken: 0 };

  const keys = await run('photos', 'readonly', (tx) => tx.objectStore('photos').getAllKeys());
  let converted = 0, broken = 0;
  // 一張一張轉，避免一次把所有照片載入記憶體
  for (const id of keys) {
    const old = await get('photos', id);
    if (!old || old.data instanceof ArrayBuffer || old.broken) continue;
    const next = { id: old.id, bookId: old.bookId, createdAt: old.createdAt || Date.now() };
    try {
      next.data = await readBlob(old.blob);
      next.type = old.blob.type || 'image/jpeg';
      try { next.thumb = await readBlob(old.thumb); } catch { next.thumb = next.data; }
      converted++;
    } catch (err) {
      console.warn('照片無法讀取，標記為損壞', id, err);
      next.broken = true;
      broken++;
    }
    await put('photos', next);
  }
  await put('meta', { key: 'photoFormat', value: PHOTO_FORMAT });
  return { converted, broken };
}
