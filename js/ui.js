// 共用 UI：圖示、跳出面板、確認框、提示訊息

const svg = (body, extra = '') =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}>${body}</svg>`;

export const icons = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  more: svg('<circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/>', 'class="fill"'),
  camera: svg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  image: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="9" cy="9" r="1.6"/><path d="M20 15l-5-5L5 20"/>'),
  search: svg('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  left: svg('<path d="M15 5l-7 7 7 7"/>'),
  right: svg('<path d="M9 5l7 7-7 7"/>'),
  trash: svg('<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>'),
  edit: svg('<path d="M5 19h4L19 9l-4-4L5 15z"/>'),
  move: svg('<path d="M4 7h16M4 12h10M4 17h7M17 14l3 3-3 3M20 17h-6"/>'),
  palette: svg('<path d="M12 4a8 8 0 1 0 0 16c1.1 0 1.5-.8 1.2-1.6-.4-1 .2-2 1.3-2H17a3 3 0 0 0 3-3c0-5-3.6-9.4-8-9.4z"/><circle cx="8" cy="11" r="1"/><circle cx="12" cy="8" r="1"/><circle cx="16" cy="11" r="1"/>'),
  cover: svg('<path d="M6 4h12v16l-6-4-6 4z"/>'),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  upload: svg('<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>'),
  book: svg('<path d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4z"/><path d="M5 16a4 4 0 0 1 4-4h10"/>'),
};

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC_MAP[c]);

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// 木質調色票
export const COLORS = [
  { id: 'maple', hex: '#D8B78E', name: '楓木' },
  { id: 'oak', hex: '#BE8C5C', name: '橡木' },
  { id: 'teak', hex: '#9B6B43', name: '柚木' },
  { id: 'walnut', hex: '#6B4A31', name: '胡桃木' },
  { id: 'moss', hex: '#8C9A76', name: '苔綠' },
  { id: 'clay', hex: '#B9765C', name: '陶土' },
  { id: 'linen', hex: '#E6D8C1', name: '亞麻' },
  { id: 'ink', hex: '#4A5560', name: '墨灰' },
];

export function colorHex(id) {
  return (COLORS.find((c) => c.id === id) || COLORS[1]).hex;
}

// 根據底色亮度決定文字顏色
export function textOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#3A2A1F' : '#FBF5EA';
}

let openSheets = 0;

export function openSheet({ title, html = '', actions = [], onMount, className = '' }) {
  return new Promise((resolve) => {
    const root = el(`
      <div class="sheet-backdrop">
        <div class="sheet ${className}" role="dialog" aria-modal="true" ${title ? `aria-label="${esc(title)}"` : ''}>
          <div class="sheet__grip"></div>
          ${title ? `<h2 class="sheet__title">${esc(title)}</h2>` : ''}
          <div class="sheet__body">${html}</div>
          ${actions.length ? `<div class="sheet__actions">${actions
            .map((a, i) => `<button type="button" class="btn btn--${a.kind || 'light'}" data-action="${i}">${esc(a.label)}</button>`)
            .join('')}</div>` : ''}
        </div>
      </div>`);
    document.body.appendChild(root);
    openSheets++;
    document.body.classList.add('has-sheet');
    requestAnimationFrame(() => root.classList.add('is-open'));

    let closed = false;
    const onKey = (e) => { if (e.key === 'Escape') close(undefined); };
    const close = (value) => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey);
      root.classList.remove('is-open');
      setTimeout(() => {
        root.remove();
        if (--openSheets === 0) document.body.classList.remove('has-sheet');
      }, 220);
      resolve(value);
    };
    const api = { root, close };

    document.addEventListener('keydown', onKey);
    root.addEventListener('click', (e) => { if (e.target === root) close(undefined); });
    root.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const a = actions[+btn.dataset.action];
        const value = a.getValue ? a.getValue(api) : a.value;
        if (value !== false) close(value);
      });
    });
    onMount && onMount(api);
  });
}

export function confirmSheet({ title, message, ok = '確定', danger = false }) {
  return openSheet({
    title,
    html: message ? `<p class="sheet__text">${esc(message)}</p>` : '',
    actions: [
      { label: '取消', value: false, getValue: () => null },
      { label: ok, kind: danger ? 'danger' : 'wood', value: true },
    ],
  }).then((v) => v === true);
}

// items: [{ key, label, icon, danger, hint }]
export function menuSheet(items, title) {
  return openSheet({
    title,
    className: 'sheet--menu',
    html: `<div class="menu-list">${items
      .map((it) => `<button type="button" class="menu-item ${it.danger ? 'is-danger' : ''}" data-key="${esc(it.key)}">
          <span class="icon">${icons[it.icon] || ''}</span>
          <span class="menu-item__label">${esc(it.label)}${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</span>
        </button>`)
      .join('')}</div>`,
    onMount: ({ root, close }) => {
      root.querySelectorAll('[data-key]').forEach((b) => b.addEventListener('click', () => close(b.dataset.key)));
    },
  });
}

let toastTimer;
export function toast(message) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = el('<div class="toast" role="status" aria-live="polite"></div>');
    document.body.appendChild(t);
  }
  t.textContent = message;
  t.classList.add('is-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-show'), 2200);
}

export function formatDate(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

export function formatDateTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${formatDate(ts)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
