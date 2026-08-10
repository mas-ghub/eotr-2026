import './style.css';
import { loadData } from './data';
import { currentRoute, onRoute, type Route } from './router';
import { runViewCleanup } from './lifecycle';
import { schedule } from './store';
import { player } from './audio';
import { offline, fmtBytes, type OfflineStatus } from './offline';
import { h, icon, toast } from './ui';
import { renderLineup } from './views/lineup';
import { renderTimetable } from './views/timetable';
import { renderSchedule } from './views/schedule';
import { renderArtist } from './views/artist';
import { renderPrint } from './views/print';

let appRoot: HTMLElement;
let mainEl: HTMLElement;
let navBadge: HTMLElement;

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* SW registration blocked (e.g. file://) — app still works online */
    });
  }
}

function installPrompt() {
  let deferred: Event | null = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    const btn = document.getElementById('installBtn') as HTMLButtonElement | null;
    if (btn) btn.hidden = false;
  });
  document.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('#installBtn') && deferred) {
      (deferred as BeforeInstallPromptEvent).prompt();
      deferred = null;
    }
  });
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

const isIOS =
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const isStandalone = (() => {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
})();

/** Small header pill that shows the real offline-download state. */
function buildOfflinePill(): HTMLElement {
  const fill = h('i', { class: 'offline-pill__fill' });
  const label = h('span', { class: 'offline-pill__label' });
  const pill = h('button', { class: 'offline-pill idle', type: 'button', html: `${icon('download', 13)}`, 'aria-label': 'Offline audio status' });
  pill.appendChild(label);
  pill.appendChild(fill);

  const render = (s: OfflineStatus) => {
    const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
    fill.style.width = s.state === 'ready' ? '100%' : `${Math.min(100, pct)}%`;
    pill.title = s.error || '';
    pill.classList.remove('idle', 'downloading', 'ready', 'partial', 'error');
    pill.classList.add(s.state);
    if (s.state === 'ready') {
      pill.classList.add('ready');
      pill.innerHTML = `${icon('check', 13)}`;
      pill.appendChild(label);
      label.textContent = 'Offline ready';
    } else if (s.state === 'downloading') {
      label.textContent = `Offline ${pct}% · ${fmtBytes(s.bytes)}`;
    } else if (s.state === 'partial') {
      label.textContent = `Offline ${pct}% · tap to retry`;
    } else if (s.state === 'error') {
      label.textContent = 'Offline failed · tap to retry';
    } else {
      label.textContent = s.done > 0 ? `Get offline audio · ${pct}%` : 'Get offline audio';
    }
  };
  offline.subscribe(render);

  pill.addEventListener('click', () => {
    if (offline.status.state !== 'downloading') void offline.start();
  });
  return pill;
}

/** One-time hint for iOS Safari, where there is no install prompt. */
function maybeIosHint() {
  if (!isIOS || isStandalone) return;
  if (localStorage.getItem('eotr-ios-hint')) return;
  localStorage.setItem('eotr-ios-hint', '1');
  setTimeout(() => {
    toast('iPhone? Tap Share → "Add to Home Screen" to install this app.', { type: 'info', ms: 6000 });
  }, 1800);
}

function buildShell(updated: string) {
  const header = h(
    'header',
    { class: 'app-header' },
    h('a', { class: 'brand', href: '#/lineup' }, h('span', { class: 'brand__mark' }, 'EOTR'), h('span', { class: 'brand__year' }, '2026')),
    buildOfflinePill(),
    h('button', { id: 'installBtn', class: 'btn btn-ghost small install-btn', type: 'button', hidden: true, html: `${icon('download', 14)} Install` })
  );

  mainEl = h('main', { class: 'app-main' });
  const footer = h(
    'footer',
    { class: 'app-footer' },
    h('p', {}, `Updated ${updated} · unofficial fan guide. Set times from Clashfinder; artists from the official End of the Road site.`),
    h('p', {}, 'Preview clips are 30-second excerpts for discovery purposes.')
  );

  const tabs = h('nav', { class: 'app-nav' });
  const tabsDef = [
    { route: '#/lineup', label: 'Lineup', icon: 'list' },
    { route: '#/timetable', label: 'Timetable', icon: 'clock' },
    { route: '#/myday', label: 'My Day', icon: 'heart' }
  ];
  for (const t of tabsDef) {
    tabs.appendChild(
      h('a', { class: 'app-nav__tab', href: t.route, dataset: { route: t.route }, html: `${icon(t.icon, 22)}<span>${t.label}</span>` })
    );
  }
  navBadge = h('span', { class: 'app-nav__badge' });
  tabs.appendChild(navBadge);

  appRoot = h('div', { class: 'app-root' }, header, mainEl, footer, tabs);
  document.body.appendChild(appRoot);

  const refreshBadge = () => {
    const n = schedule.all().length;
    navBadge.textContent = n ? String(n) : '';
    navBadge.classList.toggle('show', n > 0);
  };
  schedule.subscribe(refreshBadge);
  refreshBadge();
}

async function renderRoute(route: Route) {
  runViewCleanup();
  player.stop();
  mainEl.innerHTML = '';
  const loader = h('div', { class: 'page-loader', html: '<span></span><span></span><span></span>' });
  mainEl.appendChild(loader);

  let view: HTMLElement;
  try {
    switch (route.name) {
      case 'lineup':
        view = await renderLineup();
        break;
      case 'timetable':
        view = await renderTimetable();
        break;
      case 'myday':
        view = await renderSchedule();
        break;
      case 'artist':
        view = await renderArtist(route.slug || '');
        break;
      case 'print-program':
        view = await renderTimetable();
        void renderPrint('program');
        break;
      case 'print-schedule':
        view = await renderSchedule();
        void renderPrint('schedule');
        break;
      default:
        view = await renderLineup();
    }
  } catch (err) {
    console.error(err);
    view = h(
      'div',
      { class: 'empty' },
      h('h3', {}, 'Something went wrong'),
      h('p', {}, 'Could not load the festival data. Please try again.'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => location.reload(), html: 'Reload' })
    );
  }

  const swap = () => {
    mainEl.innerHTML = '';
    mainEl.appendChild(view);
    window.scrollTo({ top: 0 });
  };
  const doc = document as Document & { startViewTransition?: (fn: () => void) => void };
  if (doc.startViewTransition) doc.startViewTransition(swap);
  else swap();

  document.querySelectorAll('.app-nav__tab').forEach((t) => {
    const active = t.getAttribute('href') === route.name || (route.name === 'artist' && t.getAttribute('href') === '#/lineup');
    t.classList.toggle('active', active);
  });
}

async function boot() {
  registerServiceWorker();
  installPrompt();
  maybeIosHint();
  void offline.init();

  try {
    const data = await loadData();
    const updated = new Date(data.meta.generatedAt).toLocaleDateString();
    buildShell(updated);
  } catch (err) {
    console.error(err);
    buildShell('—');
    toast('Could not load festival data. Check your connection.', { type: 'error', ms: 5000 });
  }

  onRoute((route) => void renderRoute(route));
  if (!location.hash) history.replaceState(null, '', '#/lineup');
  void renderRoute(currentRoute);
}

boot();
