import * as db from './db.js';
import { processImage, blobToDataURL, dataURLToBlob } from './image.js';
import {
  icons, esc, el, COLORS, colorHex, textOn,
  openSheet, confirmSheet, menuSheet, toast, formatDate, formatDateTime,
} from './ui.js';

const $header = document.getElementById('topbar');
const $main = document.getElementById('main');
const $fab = document.getElementById('fab');

/* ---------- 路由 ---------- */

const routeStack = [];
let currentView = null; // { cleanup?: () => Promise|void }
let renderToken = 0;

function parseRoute() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const [, type, id] = hash.split('/');
  if (type === 'shelf' && id) return { name: 'shelf', id: decodeURIComponent(id), path: hash };
  if (type === 'book' && id) return { name: 'book', id: decodeURIComponent(id), path: hash };
  return { name: 'home', path: '/' };
}

function go(path) {
  location.hash = '#' + path;
}

// 返回上一層：如果上一頁就是父層就用瀏覽器返回，避免歷史紀錄越疊越多
function goUp(parentPath) {
  if (routeStack.length > 1 && routeStack[routeStack.length - 2] === parentPath) {
    history.back();
  } else {
    routeStack.pop();
    location.replace('#' + parentPath);
  }
}

async function router() {
  const route = parseRoute();
  const n = routeStack.length;
  if (n > 1 && routeStack[n - 2] === route.path) routeStack.pop();
  else if (routeStack[n - 1] !== route.path) routeStack.push(route.path);

  const token = ++renderToken;
  if (currentView?.cleanup) await currentView.cleanup();
  currentView = null;
  if (token !== renderToken) return;

  try {
    if (route.name === 'shelf') currentView = await renderShelf(route.id, token);
    else if (route.name === 'book') currentView = await renderBook(route.id, token);
    else currentView = await renderHome(token);
  } catch (err) {
    console.error(err);
    toast('發生錯誤：' + err.message);
  }
  window.scrollTo(0, 0);
}

/* ---------- 版面工具 ---------- */

function setHeader({ title = '', back = null, menu = null, extra = '' }) {
  $header.innerHTML = `
    ${back ? `<button class="icon-btn" data-back aria-label="返回">${icons.back}</button>` : '<span class="topbar__brand" aria-hidden="true"><i></i><i></i><i></i></span>'}
    <div class="topbar__title">${esc(title)}</div>
    ${extra}
    ${menu ? `<button class="icon-btn" data-menu aria-label="更多選項">${icons.more}</button>` : ''}`;
  if (back) $header.querySelector('[data-back]').addEventListener('click', back);
  if (menu) $header.querySelector('[data-menu]').addEventListener('click', menu);
}

function setFab(label, onClick) {
  if (!onClick) { $fab.hidden = true; $fab.onclick = null; return; }
  $fab.hidden = false;
  $fab.setAttribute('aria-label', label);
  $fab.onclick = onClick;
}

const urlBag = new Set();
function objectURL(blob) {
  const url = URL.createObjectURL(blob);
  urlBag.add(url);
  return url;
}
function revokeAll() {
  urlBag.forEach((u) => URL.revokeObjectURL(u));
  urlBag.clear();
}

function hashColor(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return COLORS[Math.abs(h) % COLORS.length].hex;
}

const isEmptyBook = (b) => !b.title.trim() && !b.author.trim() && !b.notes.trim() && !b.photoIds.length;
const bookTitle = (b) => b.title.trim() || '未命名的書';

/* ---------- 首頁：書架列表 ---------- */

async function renderHome(token) {
  const [shelves, books] = await Promise.all([db.getAll('shelves'), db.getAll('books')]);
  if (token !== renderToken) return null;
  revokeAll();

  shelves.sort((a, b) => a.createdAt - b.createdAt);
  const byShelf = new Map(shelves.map((s) => [s.id, []]));
  for (const b of books) byShelf.get(b.shelfId)?.push(b);

  setHeader({ title: '閱讀心得圖書館', menu: homeMenu });
  setFab('新增書架', addShelf);

  $main.innerHTML = `
    <section class="hero">
      <p class="eyebrow">My Reading Library</p>
      <h1>我的書房</h1>
      <p class="hero__stats">${shelves.length} 個書架 · ${books.length} 本書</p>
    </section>
    ${shelves.length ? `
      <label class="search">
        <span class="icon">${icons.search}</span>
        <input type="search" placeholder="搜尋書名、作者或心得" autocomplete="off" enterkeyhint="search">
      </label>` : ''}
    <div class="home-content"></div>`;

  const $content = $main.querySelector('.home-content');

  const renderShelves = () => {
    if (!shelves.length) {
      $content.innerHTML = emptyState('還沒有任何書架', '按右下角的 ＋ 建立第一個書架，像資料夾一樣把書分類收好。');
      return;
    }
    $content.innerHTML = `<div class="shelf-grid">${shelves.map((s) => shelfCard(s, byShelf.get(s.id))).join('')}</div>`;
  };

  const renderSearch = (q) => {
    const kw = q.toLowerCase();
    const shelfName = new Map(shelves.map((s) => [s.id, s.name]));
    const hits = books
      .filter((b) => byShelf.has(b.shelfId) && [b.title, b.author, b.notes].some((t) => t.toLowerCase().includes(kw)))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    $content.innerHTML = hits.length
      ? `<p class="section-label">找到 ${hits.length} 本書</p>
         <div class="result-list">${hits.map((b) => `
          <a class="result" href="#/book/${encodeURIComponent(b.id)}">
            <span class="result__swatch" style="background:${hashColor(b.id)}"></span>
            <span class="result__body">
              <strong>${esc(bookTitle(b))}</strong>
              <small>${esc(shelfName.get(b.shelfId))}${b.author ? ' · ' + esc(b.author) : ''}</small>
              ${b.notes ? `<span class="result__snippet">${esc(snippet(b.notes, kw))}</span>` : ''}
            </span>
          </a>`).join('')}</div>`
      : emptyState('找不到相符的書', '換個關鍵字試試看。');
  };

  renderShelves();
  const $search = $main.querySelector('.search input');
  $search?.addEventListener('input', () => {
    const q = $search.value.trim();
    q ? renderSearch(q) : renderShelves();
  });
  return {};
}

function snippet(text, kw) {
  const i = text.toLowerCase().indexOf(kw);
  if (i < 0) return text.slice(0, 60);
  const start = Math.max(0, i - 20);
  return (start > 0 ? '…' : '') + text.slice(start, start + 60).replace(/\s+/g, ' ');
}

function shelfCard(shelf, books) {
  const hex = colorHex(shelf.color);
  const spines = books
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, 9)
    .map((b, i) => `<span style="background:${hashColor(b.id)};height:${58 + ((i * 37) % 36)}%"></span>`)
    .join('');
  return `
    <a class="shelf-card" href="#/shelf/${encodeURIComponent(shelf.id)}" style="--c:${hex};--fg:${textOn(hex)}">
      <div class="shelf-card__top">
        <h2>${esc(shelf.name)}</h2>
        <p>${books.length} 本書</p>
      </div>
      <div class="shelf-card__rack">${spines || '<em>空書架</em>'}</div>
    </a>`;
}

function emptyState(title, text) {
  return `<div class="empty">
      <div class="empty__art"><span></span><span></span><span></span></div>
      <h3>${esc(title)}</h3>
      <p>${esc(text)}</p>
    </div>`;
}

async function homeMenu() {
  const key = await menuSheet([
    { key: 'export', label: '匯出備份', icon: 'download', hint: '把所有書架、心得與照片存成一個檔案' },
    { key: 'import', label: '匯入備份', icon: 'upload', hint: '從備份檔還原，不會刪除現有資料' },
  ]);
  if (key === 'export') exportBackup();
  if (key === 'import') importBackup();
}

function shelfForm(initial = {}) {
  const current = initial.color || COLORS[(Math.random() * 6) | 0].id;
  return openSheet({
    title: initial.name ? '編輯書架' : '新增書架',
    html: `
      <label class="field">
        <span>書架名稱</span>
        <input type="text" name="name" maxlength="40" placeholder="例如：文學小說、商業理財" value="${esc(initial.name || '')}" enterkeyhint="done">
      </label>
      <div class="field">
        <span>顏色</span>
        <div class="swatches" role="radiogroup">${COLORS.map((c) => `
          <button type="button" role="radio" class="swatch ${c.id === current ? 'is-on' : ''}" data-color="${c.id}"
            style="--c:${c.hex}" aria-label="${c.name}" aria-checked="${c.id === current}"></button>`).join('')}
        </div>
      </div>`,
    actions: [
      { label: '取消', getValue: () => null },
      {
        label: initial.name ? '儲存' : '建立書架',
        kind: 'wood',
        getValue: ({ root }) => {
          const input = root.querySelector('[name=name]');
          const name = input.value.trim();
          if (!name) { input.focus(); input.classList.add('is-error'); return false; }
          return { name, color: root.querySelector('.swatch.is-on').dataset.color };
        },
      },
    ],
    onMount: ({ root }) => {
      const input = root.querySelector('[name=name]');
      setTimeout(() => input.focus(), 250);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') root.querySelector('.sheet__actions .btn--wood').click();
      });
      root.querySelectorAll('.swatch').forEach((sw) => sw.addEventListener('click', () => {
        root.querySelectorAll('.swatch').forEach((x) => { x.classList.remove('is-on'); x.setAttribute('aria-checked', 'false'); });
        sw.classList.add('is-on');
        sw.setAttribute('aria-checked', 'true');
      }));
    },
  });
}

async function addShelf() {
  const v = await shelfForm();
  if (!v) return;
  const now = Date.now();
  const shelf = { id: db.uid(), name: v.name, color: v.color, createdAt: now, updatedAt: now };
  await db.put('shelves', shelf);
  go('/shelf/' + encodeURIComponent(shelf.id));
}

/* ---------- 書架頁：書本列表 ---------- */

async function renderShelf(shelfId, token) {
  const [shelf, books] = await Promise.all([db.get('shelves', shelfId), db.getBooksByShelf(shelfId)]);
  if (token !== renderToken) return null;
  if (!shelf) { toast('找不到這個書架'); location.replace('#/'); return null; }

  // 先載入封面縮圖
  const coverIds = books.map((b) => b.photoIds[0]).filter(Boolean);
  const covers = new Map((await db.getPhotos(coverIds)).map((p) => [p.id, p]));
  if (token !== renderToken) return null;
  revokeAll();

  books.sort((a, b) => b.updatedAt - a.updatedAt);
  const hex = colorHex(shelf.color);

  setHeader({ title: shelf.name, back: () => goUp('/'), menu: () => shelfMenu(shelf, books.length) });
  setFab('新增一本書', () => addBook(shelf.id));

  $main.innerHTML = `
    <section class="page-head" style="--c:${hex};--fg:${textOn(hex)}">
      <p class="eyebrow">書架</p>
      <h1>${esc(shelf.name)}</h1>
      <p>${books.length} 本書</p>
    </section>
    ${books.length ? `<div class="book-grid">${books.map((b) => {
      const cover = covers.get(b.photoIds[0]);
      const bg = hashColor(b.id);
      return `
        <a class="book-card" href="#/book/${encodeURIComponent(b.id)}">
          <div class="book-card__cover" style="--c:${bg};--fg:${textOn(bg)}">
            ${cover ? `<img src="${objectURL(cover.thumb || cover.blob)}" alt="" loading="lazy">` : `<span class="book-card__ph">${esc(bookTitle(b))}</span>`}
          </div>
          <div class="book-card__title">${esc(bookTitle(b))}</div>
          <div class="book-card__meta">${b.author ? esc(b.author) + ' · ' : ''}${formatDate(b.updatedAt)}${b.photoIds.length ? ` · ${b.photoIds.length} 張照片` : ''}</div>
        </a>`;
    }).join('')}</div>`
    : emptyState('書架還是空的', '按右下角的 ＋ 放進第一本書，拍下書的封面或內頁，寫下你的心得。')}`;
  return {};
}

async function shelfMenu(shelf, count) {
  const key = await menuSheet([
    { key: 'edit', label: '編輯書架名稱與顏色', icon: 'edit' },
    { key: 'delete', label: '刪除書架', icon: 'trash', danger: true, hint: count ? `包含 ${count} 本書與所有照片` : '' },
  ], shelf.name);
  if (key === 'edit') {
    const v = await shelfForm(shelf);
    if (!v) return;
    await db.put('shelves', { ...shelf, ...v, updatedAt: Date.now() });
    router();
  }
  if (key === 'delete') {
    const ok = await confirmSheet({
      title: `刪除「${shelf.name}」？`,
      message: count ? `書架中的 ${count} 本書、心得與照片都會一起刪除，且無法復原。` : '這個動作無法復原。',
      ok: '刪除',
      danger: true,
    });
    if (!ok) return;
    await db.deleteShelf(shelf.id);
    toast('已刪除書架');
    goUp('/');
  }
}

async function addBook(shelfId) {
  const now = Date.now();
  const book = { id: db.uid(), shelfId, title: '', author: '', notes: '', photoIds: [], createdAt: now, updatedAt: now, isNew: true };
  await db.put('books', book);
  go('/book/' + encodeURIComponent(book.id));
}

/* ---------- 書本頁：照片 + 心得 ---------- */

async function renderBook(bookId, token) {
  let book = await db.get('books', bookId);
  if (token !== renderToken) return null;
  if (!book) { toast('找不到這本書'); location.replace('#/'); return null; }
  const shelf = await db.get('shelves', book.shelfId);
  let photos = await db.getPhotos(book.photoIds);
  if (token !== renderToken) return null;
  revokeAll();

  const parentPath = '/shelf/' + encodeURIComponent(book.shelfId);
  const wasNew = !!book.isNew;
  if (wasNew) { delete book.isNew; await db.put('books', book); }

  setHeader({
    title: shelf ? shelf.name : '',
    back: () => goUp(parentPath),
    menu: () => bookMenu(),
    extra: '<span class="save-state" aria-live="polite"></span>',
  });
  setFab(null);

  $main.innerHTML = `
    <article class="book">
      <input class="book__title" name="title" placeholder="書名" maxlength="120" value="${esc(book.title)}" autocomplete="off" enterkeyhint="next">
      <input class="book__author" name="author" placeholder="作者（選填）" maxlength="80" value="${esc(book.author)}" autocomplete="off" enterkeyhint="next">

      <section class="block">
        <header class="block__head">
          <h2>照片記錄</h2>
          <span class="block__count" data-photo-count></span>
        </header>
        <div class="photo-grid" data-photos></div>
        <div class="photo-actions">
          <label class="btn btn--wood">
            <span class="icon">${icons.camera}</span>拍照
            <input type="file" accept="image/*" capture="environment" data-file hidden>
          </label>
          <label class="btn btn--light">
            <span class="icon">${icons.image}</span>上傳照片
            <input type="file" accept="image/*" multiple data-file hidden>
          </label>
        </div>
      </section>

      <section class="block">
        <header class="block__head"><h2>閱讀心得</h2><span class="block__count" data-char-count></span></header>
        <textarea class="notes" name="notes" placeholder="寫下你的閱讀心得、喜歡的句子、想記住的觀點…">${esc(book.notes)}</textarea>
      </section>

      <p class="book__dates" data-dates></p>
    </article>`;

  const $title = $main.querySelector('[name=title]');
  const $author = $main.querySelector('[name=author]');
  const $notes = $main.querySelector('[name=notes]');
  const $photos = $main.querySelector('[data-photos]');
  const $saveState = $header.querySelector('.save-state');
  const $dates = $main.querySelector('[data-dates]');

  /* 自動儲存 */
  let saveTimer = null;
  let dirty = false;
  const updateDates = () => {
    $dates.textContent = `建立於 ${formatDateTime(book.createdAt)} · 最後編輯 ${formatDateTime(book.updatedAt)}`;
    $main.querySelector('[data-char-count]').textContent = book.notes.length ? `${book.notes.length} 字` : '';
  };
  const save = async () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!dirty) return;
    dirty = false;
    book.updatedAt = Date.now();
    await db.put('books', book);
    $saveState.textContent = '已儲存';
    $saveState.classList.add('is-on');
    updateDates();
  };
  const scheduleSave = () => {
    dirty = true;
    $saveState.textContent = '編輯中…';
    $saveState.classList.remove('is-on');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 600);
  };

  $title.addEventListener('input', () => { book.title = $title.value; scheduleSave(); });
  $author.addEventListener('input', () => { book.author = $author.value; scheduleSave(); });
  $notes.addEventListener('input', () => { book.notes = $notes.value; autosize($notes); scheduleSave(); });
  $title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $author.focus(); } });
  $author.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $notes.focus(); } });
  const onHide = () => { if (document.visibilityState === 'hidden') save(); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', save);

  /* 照片 */
  const renderPhotos = (pending = 0) => {
    revokeAll();
    $photos.innerHTML = photos.map((p, i) => `
      <button type="button" class="photo" data-i="${i}" aria-label="查看第 ${i + 1} 張照片">
        <img src="${objectURL(p.thumb || p.blob)}" alt="">
        ${i === 0 ? '<span class="photo__badge">封面</span>' : ''}
      </button>`).join('') + '<div class="photo is-loading"><span></span></div>'.repeat(pending);
    $photos.hidden = !photos.length && !pending;
    $main.querySelector('[data-photo-count]').textContent = photos.length ? `${photos.length} 張` : '';
    $photos.querySelectorAll('[data-i]').forEach((b) =>
      b.addEventListener('click', () => openViewer(+b.dataset.i)));
  };

  $main.querySelectorAll('[data-file]').forEach((input) => input.addEventListener('change', async () => {
    const files = [...input.files];
    input.value = '';
    if (!files.length) return;
    let remaining = files.length;
    renderPhotos(remaining);
    let failed = 0;
    for (const file of files) {
      try {
        const { blob, thumb } = await processImage(file);
        const photo = { id: db.uid(), bookId: book.id, blob, thumb, createdAt: Date.now() };
        book.photoIds.push(photo.id);
        book.updatedAt = Date.now();
        await db.putMany([['photos', photo], ['books', book]]);
        photos.push(photo);
      } catch (err) {
        console.error(err);
        failed++;
      }
      renderPhotos(--remaining);
    }
    updateDates();
    if (failed) toast(`有 ${failed} 張照片無法讀取`);
    else toast(files.length > 1 ? `已加入 ${files.length} 張照片` : '已加入照片');
  }));

  async function openViewer(start) {
    await save();
    await photoViewer({
      photos,
      start,
      onSetCover: async (i) => {
        const [p] = photos.splice(i, 1);
        photos.unshift(p);
        book.photoIds = photos.map((x) => x.id);
        book.updatedAt = Date.now();
        await db.put('books', book);
        renderPhotos();
        toast('已設為封面');
        return 0;
      },
      onDelete: async (i) => {
        const [p] = photos.splice(i, 1);
        book.photoIds = photos.map((x) => x.id);
        book.updatedAt = Date.now();
        await db.putMany([['books', book]]);
        await db.deletePhoto(p.id);
        renderPhotos();
        updateDates();
        toast('已刪除照片');
      },
    });
  }

  async function bookMenu() {
    await save();
    const key = await menuSheet([
      { key: 'move', label: '移動到其他書架', icon: 'move' },
      { key: 'delete', label: '刪除這本書', icon: 'trash', danger: true },
    ], bookTitle(book));
    if (key === 'move') {
      const shelves = (await db.getAll('shelves')).filter((s) => s.id !== book.shelfId).sort((a, b) => a.createdAt - b.createdAt);
      if (!shelves.length) { toast('目前沒有其他書架'); return; }
      const target = await menuSheet(shelves.map((s) => ({ key: s.id, label: s.name, icon: 'book' })), '移動到…');
      if (!target) return;
      book.shelfId = target;
      book.updatedAt = Date.now();
      await db.put('books', book);
      toast('已移動到「' + shelves.find((s) => s.id === target).name + '」');
      router();
    }
    if (key === 'delete') {
      const ok = await confirmSheet({ title: `刪除「${bookTitle(book)}」？`, message: '心得與所有照片都會一起刪除，且無法復原。', ok: '刪除', danger: true });
      if (!ok) return;
      deleted = true;
      await db.deleteBook(book.id);
      toast('已刪除');
      goUp('/shelf/' + encodeURIComponent(book.shelfId));
    }
  }

  let deleted = false;
  renderPhotos();
  updateDates();
  autosize($notes);
  if (wasNew) setTimeout(() => $title.focus(), 50);

  return {
    async cleanup() {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', save);
      if (deleted) return;
      await save();
      // 什麼都沒寫的新書就自動移除，避免留下空白項目
      if (isEmptyBook(book)) await db.deleteBook(book.id);
    },
  };
}

function autosize(ta) {
  if (CSS.supports?.('field-sizing', 'content')) return;
  ta.style.height = 'auto';
  ta.style.height = Math.max(ta.scrollHeight, 200) + 'px';
}

/* ---------- 全螢幕照片檢視 ---------- */

function photoViewer({ photos, start, onSetCover, onDelete }) {
  return new Promise((resolve) => {
    let index = start;
    const urls = [];
    const root = el(`
      <div class="viewer" role="dialog" aria-modal="true" aria-label="照片檢視">
        <div class="viewer__bar">
          <button class="icon-btn" data-close aria-label="關閉">${icons.close}</button>
          <span class="viewer__count"></span>
          <span></span>
        </div>
        <div class="viewer__stage">
          <button class="viewer__nav is-prev" data-prev aria-label="上一張">${icons.left}</button>
          <img alt="">
          <button class="viewer__nav is-next" data-next aria-label="下一張">${icons.right}</button>
        </div>
        <div class="viewer__tools">
          <button class="btn btn--ghost" data-cover><span class="icon">${icons.cover}</span>設為封面</button>
          <button class="btn btn--ghost is-danger" data-delete><span class="icon">${icons.trash}</span>刪除</button>
        </div>
      </div>`);
    document.body.appendChild(root);
    document.body.classList.add('has-sheet');
    requestAnimationFrame(() => root.classList.add('is-open'));
    const $img = root.querySelector('img');

    const show = () => {
      if (!photos.length) return close();
      index = Math.max(0, Math.min(index, photos.length - 1));
      const url = URL.createObjectURL(photos[index].blob);
      urls.push(url);
      $img.src = url;
      root.querySelector('.viewer__count').textContent = `${index + 1} / ${photos.length}`;
      root.querySelector('[data-prev]').hidden = index === 0;
      root.querySelector('[data-next]').hidden = index === photos.length - 1;
      root.querySelector('[data-cover]').disabled = index === 0;
    };
    const step = (d) => { const n = index + d; if (n >= 0 && n < photos.length) { index = n; show(); } };
    const onKey = (e) => {
      if (document.querySelector('.sheet-backdrop')) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    };
    const close = () => {
      document.removeEventListener('keydown', onKey);
      root.classList.remove('is-open');
      setTimeout(() => {
        root.remove();
        urls.forEach((u) => URL.revokeObjectURL(u));
        if (!document.querySelector('.sheet-backdrop')) document.body.classList.remove('has-sheet');
      }, 200);
      resolve();
    };

    root.querySelector('[data-close]').addEventListener('click', close);
    root.querySelector('[data-prev]').addEventListener('click', () => step(-1));
    root.querySelector('[data-next]').addEventListener('click', () => step(1));
    root.querySelector('[data-cover]').addEventListener('click', async () => { index = await onSetCover(index); show(); });
    root.querySelector('[data-delete]').addEventListener('click', async () => {
      const ok = await confirmSheet({ title: '刪除這張照片？', message: '刪除後無法復原。', ok: '刪除', danger: true });
      if (!ok) return;
      await onDelete(index);
      show();
    });
    document.addEventListener('keydown', onKey);

    // 左右滑動切換
    let sx = null, sy = 0;
    const stage = root.querySelector('.viewer__stage');
    stage.addEventListener('touchstart', (e) => { if (e.touches.length === 1) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; } }, { passive: true });
    stage.addEventListener('touchend', (e) => {
      if (sx === null) return;
      const dx = e.changedTouches[0].clientX - sx;
      const dy = e.changedTouches[0].clientY - sy;
      sx = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
    });

    show();
  });
}

/* ---------- 備份 ---------- */

async function exportBackup() {
  try {
    toast('正在準備備份…');
    const [shelves, books, photos] = await Promise.all([db.getAll('shelves'), db.getAll('books'), db.getAll('photos')]);
    const outPhotos = [];
    for (const p of photos) {
      outPhotos.push({
        id: p.id, bookId: p.bookId, createdAt: p.createdAt,
        data: await blobToDataURL(p.blob),
        thumb: p.thumb ? await blobToDataURL(p.thumb) : null,
      });
    }
    const payload = { app: 'reading-library', version: 1, exportedAt: Date.now(), shelves, books, photos: outPhotos };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const d = new Date();
    const name = `閱讀心得備份-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
    const a = el(`<a download="${esc(name)}"></a>`);
    a.href = URL.createObjectURL(blob);
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast(`已匯出 ${shelves.length} 個書架、${books.length} 本書`);
  } catch (err) {
    console.error(err);
    toast('匯出失敗：' + err.message);
  }
}

function importBackup() {
  const input = el('<input type="file" accept="application/json,.json" hidden>');
  document.body.appendChild(input);
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.remove();
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'reading-library' || !Array.isArray(data.shelves) || !Array.isArray(data.books)) {
        throw new Error('這不是閱讀心得圖書館的備份檔');
      }
      const ok = await confirmSheet({
        title: '匯入備份？',
        message: `將匯入 ${data.shelves.length} 個書架、${data.books.length} 本書。相同的項目會以備份檔內容覆蓋，其餘資料保留不變。`,
        ok: '匯入',
      });
      if (!ok) return;
      toast('正在匯入…');
      const entries = [];
      for (const s of data.shelves) entries.push(['shelves', s]);
      for (const b of data.books) entries.push(['books', { ...b, photoIds: b.photoIds || [] }]);
      for (const p of data.photos || []) {
        const blob = await dataURLToBlob(p.data);
        const thumb = p.thumb ? await dataURLToBlob(p.thumb) : blob;
        entries.push(['photos', { id: p.id, bookId: p.bookId, createdAt: p.createdAt, blob, thumb }]);
      }
      await db.putMany(entries);
      toast('匯入完成');
      router();
    } catch (err) {
      console.error(err);
      toast('匯入失敗：' + err.message);
    }
  });
  input.click();
}

/* ---------- 啟動 ---------- */

window.addEventListener('hashchange', router);
router();

// 請求瀏覽器保留資料，不要在空間不足時自動清除
navigator.storage?.persist?.().catch(() => {});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
