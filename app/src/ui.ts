export type Child = Node | string | null | undefined | Child[];

/** Tiny DOM builder. */
export function h(tag: string, props: Record<string, unknown> = {}, ...children: Child[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class' || key === 'className') node.className = String(value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value as CSSStyleDeclaration);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'dataset' && typeof value === 'object') {
      Object.assign(node.dataset, value as Record<string, string>);
    } else if (key === 'html' && typeof value === 'string') {
      node.innerHTML = value;
    } else if (key === 'tabindex') {
      node.setAttribute('tabindex', String(value));
    } else {
      node.setAttribute(key, String(value));
    }
  }
  append(node, children);
  return node;
}

function append(node: HTMLElement, children: Child[]) {
  for (const child of children) {
    if (child == null) continue;
    if (Array.isArray(child)) append(node, child);
    else if (child instanceof Node) node.appendChild(child);
    else node.appendChild(document.createTextNode(String(child)));
  }
}

/** Inline SVG icons (stroke-based, currentColor). */
const ICONS: Record<string, string> = {
  play: '<path d="M8 5v14l11-7z"/>',
  pause: '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/>',
  heartFill:
    '<path fill="currentColor" stroke="none" d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  stage: '<path d="M4 10a8 3 0 0 0 16 0"/><path d="M2 13l1.5 8M22 13l-1.5 8M12 13v8M7 21h10"/>',
  print: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  chevronRight: '<path d="M9 6l6 6-6 6"/>',
  arrowLeft: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  note: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  film: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>',
  sparkle:
    '<path d="M12 2l1.9 5.7L20 9.5l-6.1 1.8L12 17l-1.9-5.7L4 9.5l6.1-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 21h16"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17.5v.5"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.3"/><path d="M21 3v6h-6"/>',
  disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/>',
  wifi: '<path d="M5 12.6a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M2 9.5a15 15 0 0 1 20 0"/><circle cx="12" cy="19" r="1"/>',
  wifiOff: '<path d="M1 1l22 22"/><path d="M5 12.6a10 10 0 0 1 3-2.1M10.2 8.3A13.7 13.7 0 0 1 12 7.9M16.7 11.6a10 10 0 0 1 2.3 1M8.5 15.5a5 5 0 0 1 3.4-1.4M2 9.5a15 15 0 0 1 5.2-2.4M12 17h.01"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9a2.5 2.5 0 1 1 3.3 2.4c-.7.3-1 .9-1 1.7v.4M12 17h.01"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  sunCloud: '<path d="M7 17.5h9.5a4 4 0 0 0 0-8A5.5 5.5 0 0 0 6 11a3.5 3.5 0 0 0 1 6.5z"/><circle cx="16.5" cy="7.5" r="3"/><path d="M16.5 2v1.5M20 3.5l-1 1M16.5 9v.5"/>',
  cloud: '<path d="M7 18h9.5a4 4 0 0 0 0-8A5.5 5.5 0 0 0 6 11.5 3.5 3.5 0 0 0 7 18z"/>',
  drizzle: '<path d="M7 16.5h9.5a4 4 0 0 0 0-8A5.5 5.5 0 0 0 6 10 3.5 3.5 0 0 0 7 16.5z"/><path d="M8.5 20v.5M12 20.5v.5M15.5 20v.5"/>',
  rain: '<path d="M7 16.5h9.5a4 4 0 0 0 0-8A5.5 5.5 0 0 0 6 10 3.5 3.5 0 0 0 7 16.5z"/><path d="M8.5 20l-.8 1.8M12.2 20l-.8 1.8M15.5 20l-.8 1.8"/>',
  snow: '<path d="M7 16.5h9.5a4 4 0 0 0 0-8A5.5 5.5 0 0 0 6 10 3.5 3.5 0 0 0 7 16.5z"/><path d="M8.5 20.5h.01M12 20.5h.01M15.5 20.5h.01M8.5 17.5h.01M12 17.5h.01M15.5 17.5h.01"/>',
  thunder: '<path d="M7 16.5h9.5a4 4 0 0 0 0-8A5.5 5.5 0 0 0 6 10 3.5 3.5 0 0 0 7 16.5z"/><path d="M12.5 16.5l-2 4h3l-1.5 4"/>',
  fog: '<path d="M7 13h10M5 10h14M7 16h10M9 7h6"/>',
  droplet: '<path d="M12 3s6 6.5 6 11a6 6 0 1 1-12 0c0-4.5 6-11 6-11z"/>',
  shuffle: '<path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  ticket: '<path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/><path d="M13 6v12"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  chat: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/>',
  send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  offline: '<path d="M5 12.6a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M2 9.5a15 15 0 0 1 20 0M12 20h.01"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  bellFill: '<path fill="currentColor" stroke="none" d="M12 22a2.98 2.98 0 0 0 2.83-2h-5.66A2.98 2.98 0 0 0 12 22zm7-8v-6a7 7 0 0 0-4-6.3V1a1 1 0 1 0-2 0v.7A7 7 0 0 0 9 8v6l-2 3h10l-2-3z"/>'
};

export function icon(name: string, size = 20): string {
  const body = ICONS[name] || ICONS.note;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function iconEl(name: string, size = 20): HTMLElement {
  const el = h('span', { class: 'icon', html: icon(name, size) });
  return el;
}

/** Fancy lazy image with shimmer placeholder and a designed gradient+initial fallback. */
export function imageEl(src: string | null, alt: string, className = ''): HTMLElement {
  const wrap = h(
    'div',
    { class: `imgwrap ${className}` },
    h('div', { class: 'imgwrap__shimmer' }),
    h('span', { class: 'imgwrap__initial', 'aria-hidden': 'true' }, (alt.trim()[0] || '?').toUpperCase()),
    h('img', { class: 'imgwrap__img', alt, loading: 'lazy', decoding: 'async' })
  );
  const img = wrap.querySelector('img')!;
  img.onload = () => wrap.classList.add('loaded');
  img.onerror = () => {
    wrap.classList.add('loaded', 'nophoto');
  };
  if (src) img.src = src;
  else wrap.classList.add('loaded', 'nophoto');
  return wrap;
}

let toastRoot: HTMLElement | null = null;

export function toast(message: string, opts: { type?: 'info' | 'success' | 'error' | 'chat'; ms?: number } = {}) {
  if (!toastRoot) {
    toastRoot = h('div', { class: 'toastroot' });
    document.body.appendChild(toastRoot);
  }
  const node = h(
    'div',
    { class: `toast ${opts.type || 'info'}` },
    opts.type === 'success' ? iconEl('check', 16) : opts.type === 'error' ? iconEl('alert', 16) : opts.type === 'chat' ? iconEl('chat', 16) : iconEl('note', 16),
    h('span', { html: message })
  );
  toastRoot.appendChild(node);
  requestAnimationFrame(() => node.classList.add('show'));
  setTimeout(() => {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 300);
  }, opts.ms || 2600);
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms = 200): (...args: A) => void {
  let t: ReturnType<typeof setTimeout>;
  return (...args: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Escape a string for safe insertion as innerHTML. */
export function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

export function formatDateKey(dayKey: string): string {
  const d = new Date(`${dayKey}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Bottom sheet / modal overlay. */
export function sheet(opts: { title: string; body: HTMLElement; footer?: HTMLElement }) {
  const overlay = h('div', { class: 'sheet-overlay' });
  const closeBtn = h('button', { class: 'sheet-close', type: 'button', 'aria-label': 'Close', html: icon('close', 20) });
  const header = h('header', { class: 'sheet-header' }, h('h3', { class: 'sheet-title' }, opts.title), closeBtn);
  const sheetEl = h('div', { class: 'sheet' }, header, h('div', { class: 'sheet-body' }, opts.body));
  if (opts.footer) sheetEl.appendChild(h('footer', { class: 'sheet-footer' }, opts.footer));
  overlay.appendChild(sheetEl);
  document.body.appendChild(overlay);

  const close = () => {
    sheetEl.classList.remove('open');
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 260);
  };
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  requestAnimationFrame(() => {
    overlay.classList.add('open');
    sheetEl.classList.add('open');
  });
  return { close, el: sheetEl };
}
