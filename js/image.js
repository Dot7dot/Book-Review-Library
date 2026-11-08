// 照片處理
// 重點：iOS Safari 選到的 File 指向暫存檔，下一次選檔時舊的暫存檔會被刪除。
// 所以選完檔案要「立刻」把位元組讀進記憶體（ArrayBuffer），之後只用這份複本。

export function toArrayBuffer(blob) {
  if (blob.arrayBuffer) return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(blob);
  });
}

// 一選完檔案就呼叫：把每個 File 的內容複製出來。讀不到的回傳 null。
export function readFiles(files) {
  return Promise.all(files.map(async (file) => {
    try {
      const data = await toArrayBuffer(file);
      return data.byteLength ? { data, type: file.type || 'image/jpeg' } : null;
    } catch (err) {
      console.error('讀取檔案失敗', err);
      return null;
    }
  }));
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('無法讀取這張圖片')); };
    img.src = url;
  });
}

function resize(img, maxSize, quality) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const scale = Math.min(1, maxSize / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

// 輸入記憶體中的原始位元組，輸出壓縮後的完整圖與縮圖（都是 ArrayBuffer）
export async function processImage({ data, type }) {
  const img = await loadImage(new Blob([data], { type }));
  const [full, small] = await Promise.all([resize(img, 1800, 0.85), resize(img, 480, 0.78)]);
  if (!full) throw new Error('無法處理這張圖片');
  const fullBuf = await toArrayBuffer(full);
  const thumbBuf = small ? await toArrayBuffer(small) : fullBuf;
  return { data: fullBuf, thumb: thumbBuf, type: 'image/jpeg' };
}

// 從資料庫的照片紀錄產生顯示用的 Blob（顯示時才轉換）
export function photoBlob(photo, which = 'data') {
  if (!photo || photo.broken) return null;
  const buf = photo[which] || photo.data;
  return buf ? new Blob([buf], { type: photo.type || 'image/jpeg' }) : null;
}

export function bufferToDataURL(buf, type = 'image/jpeg') {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(new Blob([buf], { type }));
  });
}

export function dataURLToBuffer(dataURL) {
  const [head, body] = dataURL.split(',');
  const type = (head.match(/^data:([^;]+)/) || [])[1] || 'image/jpeg';
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { data: bytes.buffer, type };
}
