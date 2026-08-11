import './style.css';
import { loadData } from './data';
import { currentRoute, onRoute, type Route } from './router';
import { runViewCleanup } from './lifecycle';
import { schedule } from './store';
import { player } from './audio';
import { offline, fmtBytes, type OfflineStatus } from './offline';
import { h, icon, toast, sheet } from './ui';
import { initTheme, toggleTheme, currentTheme } from './theme';
import { maybePromptName, getName } from './greeting';
import { renderLineup } from './views/lineup';
import { renderTimetable } from './views/timetable';
import { renderSchedule } from './views/schedule';
import { renderArtist } from './views/artist';
import { renderPrint } from './views/print';
import { renderChat } from './views/chat';
import { chatStart, onUnread, onChatMessages, unlockAudio, playChatSound } from './chat';

let appRoot: HTMLElement;
let mainEl: HTMLElement;
let navBadge: HTMLElement;
let chatBadge: HTMLElement;
let lastMsgSignature = '';

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
    // iOS Safari has no install prompt, and a standalone app is already installed.
    if (isIOS || isStandalone) return;
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

  let isOnline = navigator.onLine;
  window.addEventListener('online', () => { isOnline = true; render(offline.status); });
  window.addEventListener('offline', () => { isOnline = false; render(offline.status); });

  const render = (s: OfflineStatus) => {
    pill.classList.remove('idle', 'downloading', 'ready', 'partial', 'error', 'offline');
    if (s.state === 'ready') {
      // Offline-ready is reassuring even when disconnected, so show it first.
      pill.classList.add('ready');
      fill.style.width = '100%';
      pill.title = 'All previews downloaded — works with no signal.';
      pill.innerHTML = `${icon('check', 13)}`;
      pill.appendChild(label);
      label.textContent = 'Offline ready';
      return;
    }
    if (!isOnline) {
      pill.classList.add('offline');
      fill.style.width = '0%';
      pill.title = 'No connection. Everything you already downloaded still works.';
      pill.innerHTML = `${icon('wifiOff', 13)}`;
      pill.appendChild(label);
      label.textContent = 'Offline mode';
      return;
    }
    const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
    fill.style.width = `${Math.min(100, pct)}%`;
    pill.title = s.error || '';
    pill.classList.add(s.state);
    if (s.state === 'downloading') {
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
    if (!isOnline) return;
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

/** Help sheet: install/uninstall/offline so the user always knows what is going on. */
function openHelp() {
  const body = h('div', { class: 'help-body' });
  const sec = (title: string, lines: string[]) => {
    const s = h('section', { class: 'help-sec' }, h('h4', {}, title));
    for (const ln of lines) s.appendChild(h('p', {}, ln));
    return s;
  };
  body.appendChild(
    sec('Install', [
      'iPhone/iPad (Safari): tap the Share button (square with up arrow), then "Add to Home Screen", then Add.',
      'Android (Chrome): tap the "Install app" prompt, or the ⋮ menu → "Install app".'
    ])
  );
  body.appendChild(
    sec('Uninstall & reinstall', [
      'iPhone/iPad: press and hold the EOTR 2026 icon on the home screen → Remove App / Delete App. Reinstall with the steps above.',
      'Android: press and hold the icon → Uninstall / Remove. Reinstall from the same link.'
    ])
  );
  body.appendChild(
    sec('Offline audio', [
      'Tap the pill at the top ("Get offline audio") to download every preview clip. It fills up as it downloads and turns green "Offline ready" when done.',
      'Once it says "Offline ready", everything (lineup, timetable, all previews) works with no signal.',
      'Each device downloads its own copy — do it once per phone/tablet on Wi-Fi.'
    ])
  );
  sheet({ title: 'EOTR 2026 · help', body });
}

function buildShell(updated: string) {
  const helpBtn = h('button', { class: 'header-help', type: 'button', 'aria-label': 'Help', title: 'Help: install, uninstall, offline audio', html: icon('help', 18) });
  helpBtn.addEventListener('click', openHelp);

  const themeBtn = h('button', {
    class: 'header-help theme-toggle',
    type: 'button',
    'aria-label': currentTheme() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
    title: 'Toggle dark / light mode',
    html: icon(currentTheme() === 'dark' ? 'sun' : 'moon', 18)
  });
  themeBtn.addEventListener('click', () => {
    const t = toggleTheme();
    themeBtn.innerHTML = icon(t === 'dark' ? 'sun' : 'moon', 18);
    themeBtn.setAttribute('aria-label', t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  });

  const header = h(
    'header',
    { class: 'app-header' },
    h('a', { class: 'brand', href: '#/lineup' }, h('span', { class: 'brand__mark' }, 'EOTR'), h('span', { class: 'brand__year' }, '2026')),
    buildOfflinePill(),
    themeBtn,
    helpBtn,
    h('button', { id: 'installBtn', class: 'btn btn-ghost small install-btn', type: 'button', hidden: true, html: `${icon('download', 14)} Install` })
  );

  mainEl = h('main', { class: 'app-main' });
  const footer = h(
    'footer',
    { class: 'app-footer' },
    h('p', {}, `Updated ${updated} · unofficial fan guide. Set times from Clashfinder; artists from the official End of the Road site.`),
    h('p', {}, 'Preview clips are 30-second excerpts for discovery purposes.'),
    h('p', { class: 'app-footer__version' }, 'EOTR 2026 PWA · version 1.0.0')
  );

  const tabs = h('nav', { class: 'app-nav' });
  navBadge = h('span', { class: 'app-nav__badge', 'aria-label': 'Saved sets' });
  chatBadge = h('span', { class: 'app-nav__badge chat-badge', 'aria-label': 'New chat messages' });
  const tabsDef = [
    { route: '#/lineup', label: 'Lineup', icon: 'list' },
    { route: '#/timetable', label: 'Timetable', icon: 'clock' },
    { route: '#/myday', label: 'My Day', icon: 'heart', badge: () => navBadge },
    { route: '#/chat', label: 'Chat', icon: 'chat', badge: () => chatBadge }
  ];
  for (const t of tabsDef) {
    const tab = h('a', { class: 'app-nav__tab', href: t.route, dataset: { route: t.route }, html: `${icon(t.icon, 22)}<span>${t.label}</span>` });
    if (t.badge) tab.appendChild(t.badge());
    tabs.appendChild(tab);
  }

  const refreshBadge = () => {
    const n = schedule.all().length;
    navBadge.textContent = n ? String(n) : '';
    navBadge.classList.toggle('show', n > 0);
  };
  schedule.subscribe(refreshBadge);
  refreshBadge();

  const refreshChatBadge = (n: number) => {
    chatBadge.textContent = n ? String(n) : '';
    chatBadge.classList.toggle('show', n > 0);
  };
  onUnread(refreshChatBadge);

  appRoot = h('div', { class: 'app-root' }, header, mainEl, footer, tabs);
  document.body.appendChild(appRoot);
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
      case 'chat':
        view = await renderChat();
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
    // artist pages keep the Lineup tab highlighted; everything else matches its route.
    const activeHref = route.name === 'artist' ? '#/lineup' : `#/${route.name}`;
    t.classList.toggle('active', (t as HTMLElement).dataset.route === activeHref);
  });
}

/** Pop a toast + chime when a NEW message arrives while the user isn't on the chat page. */
function wireChatNotifications() {
  chatStart();
  onChatMessages((msgs) => {
    if (!msgs.length) return;
    const last = msgs[msgs.length - 1];
    const sig = `${last.id}:${last.ts}`;
    if (sig === lastMsgSignature) return;
    const isFirstLoad = lastMsgSignature === '';
    lastMsgSignature = sig;
    // Never toast on the first load (that would greet users with stale messages).
    if (!isFirstLoad && currentRoute.name !== 'chat') {
      const isMine = getName()?.toLowerCase() === last.name.toLowerCase();
      if (!isMine) {
        playChatSound();
        toast(`New message from ${last.name}`, { type: 'info', ms: 3200 });
      }
    }
  });
}

/** Browsers block audio until the first user gesture — unlock it then. */
function unlockAudioOnGesture() {
  const unlock = () => {
    unlockAudio();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    window.removeEventListener('touchstart', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  window.addEventListener('touchstart', unlock);
}

async function boot() {
  initTheme();
  registerServiceWorker();
  installPrompt();
  maybeIosHint();
  maybePromptName();
  wireChatNotifications();
  unlockAudioOnGesture();
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
