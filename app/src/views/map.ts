import { h, icon, toast } from '../ui';
import { onViewCleanup } from '../lifecycle';
import { navigate } from '../router';
import { openDm, PENDING_CONV_KEY, currentUid } from '../chat';
import {
  presenceStart,
  onOnline,
  onShareStatus,
  onLocations,
  subscribeLocations,
  resumeSharingIfPref,
  startSharing,
  stopSharing,
  shareStatus,
  onlineUsersSnapshot,
  locationUsersSnapshot,
  colorForUid,
  type OnlineUser,
  type LocationUser,
  type ShareStatus
} from '../location';
import type * as L from 'leaflet';

const FESTIVAL_CENTER: [number, number] = [51.0, -2.1]; // Dorset / Larmer Tree-ish
const FESTIVAL_ZOOM = 13;

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return 'now';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function shareLabel(s: ShareStatus): { text: string; cls: string } {
  switch (s) {
    case 'unsupported':
      return { text: 'Location not supported on this device', cls: 'denied' };
    case 'denied':
      return { text: 'Location blocked — allow it in browser settings', cls: 'denied' };
    case 'error':
      return { text: 'Couldn’t get a fix — tap to retry', cls: 'denied' };
    case 'connecting':
      return { text: 'Getting your location…', cls: 'conn' };
    case 'on':
      return { text: 'Sharing your location', cls: 'on' };
    default:
      return { text: 'Not sharing', cls: 'off' };
  }
}

export async function renderMap(): Promise<HTMLElement> {
  void presenceStart();
  void resumeSharingIfPref();
  void subscribeLocations();
  const myUid = currentUid();

  const root = h('div', { class: 'view map-view' });
  const status = h('span', { class: 'chat-status' });
  const head = h(
    'header',
    { class: 'chat-head map-head' },
    h('div', {},
      h('h2', { class: 'chat-title' }, 'Find your friends'),
      h('p', { class: 'chat-sub' }, 'Who’s online, and where everyone’s pitched up.')
    ),
    status
  );
  root.appendChild(head);

  const onlineRow = h('div', { class: 'map-online' });
  root.appendChild(onlineRow);

  const mapWrap = h('div', { class: 'map-wrap' }, h('div', { id: 'leafmap', class: 'map-canvas' }));
  root.appendChild(mapWrap);

  const controls = h('div', { class: 'map-controls' });
  root.appendChild(controls);

  const renderStatus = (n: number) => {
    status.textContent = n > 0 ? `${n} online` : 'Nobody online';
    status.className = `chat-status ${n > 0 ? 'on' : ''}`;
  };

  // ---- share toggle + controls ----
  let shareState = shareStatus();
  const shareBtn = h('button', { class: 'btn map-share', type: 'button', html: `${icon('share', 15)} Share my location` }) as HTMLButtonElement;
  const shareNote = h('p', { class: 'map-share-note' });
  const refreshShare = () => {
    const { text, cls } = shareLabel(shareState);
    shareNote.textContent = text;
    shareNote.className = `map-share-note ${cls}`;
    if (shareState === 'on') {
      shareBtn.innerHTML = `${icon('pinOff', 15)} Stop sharing`;
      shareBtn.classList.add('map-share--on');
    } else {
      shareBtn.innerHTML = `${icon('share', 15)} ${shareState === 'connecting' ? 'Sharing…' : 'Share my location'}`;
      shareBtn.classList.remove('map-share--on');
    }
    shareBtn.disabled = shareState === 'connecting';
  };
  shareBtn.addEventListener('click', () => {
    if (shareState === 'on') stopSharing();
    else startSharing();
  });
  const privacy = h('p', { class: 'map-privacy' }, 'Only you decide to share. Your location disappears when you stop or leave. Others see only people who chose to share.');
  controls.appendChild(shareBtn);
  controls.appendChild(shareNote);
  controls.appendChild(privacy);

  // ---- online list ----
  const renderOnline = (list: OnlineUser[]) => {
    onlineRow.innerHTML = '';
    if (!list.length) {
      onlineRow.appendChild(h('p', { class: 'map-online__empty' }, 'No one’s online right now.'));
      return;
    }
    for (const u of list) {
      const chip = h(
        'button',
        { class: 'map-online__chip', type: 'button', title: `Message ${u.name}` },
        h('span', { class: 'map-online__dot' }),
        h('span', {}, u.name)
      );
      chip.addEventListener('click', () => void dmPerson(u.uid, u.name));
      onlineRow.appendChild(chip);
    }
  };

  async function dmPerson(uid: string, name: string) {
    const conv = await openDm(uid, name);
    if (!conv) {
      toast('Could not start a chat. Check your connection.', { type: 'error' });
      return;
    }
    try {
      sessionStorage.setItem(PENDING_CONV_KEY, conv.id);
    } catch {
      /* ignore */
    }
    navigate('#/chat');
  }

  // ---- Leaflet map ----
  let map: L.Map | null = null;
  let mapInitDone = false;
  let ro: ResizeObserver | null = null;
  let onResize: (() => void) | null = null;
  let Lmod: typeof L | null = null;
  const markers = new Map<string, L.CircleMarker>();
  let centerDone = false;

  const ensureMap = async (): Promise<L.Map | null> => {
    const container = document.getElementById('leafmap');
    if (!container) return null; // view not in the DOM yet — retry on next snapshot
    const L = await import('leaflet');
    Lmod = L;
    if (mapInitDone && map) return map;
    // The container is inside a view transition and may briefly have zero
    // height on iOS. Wait until it actually has real pixels before creating the
    // map — creating it at 0×0 is what produces the diagonal/partial tiles.
    const h = container.clientHeight;
    if (h < 10) return null;
    map = L.map(container, { zoomControl: true, attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    map.setView(FESTIVAL_CENTER, FESTIVAL_ZOOM);
    mapInitDone = true;

    // Re-measure whenever the container resizes (flex/layout settling after the
    // view transition, URL-bar show/hide on iOS, etc.).
    const invalidate = () => {
      try {
        map?.invalidateSize(false);
      } catch {
        /* ignore */
      }
    };
    onResize = invalidate;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(invalidate);
      ro.observe(container);
    }
    // Safety net for browsers/transitions that don't fire RO or fire it too early.
    window.setTimeout(invalidate, 120);
    window.setTimeout(invalidate, 500);
    window.setTimeout(invalidate, 1500);
    window.addEventListener('resize', invalidate);
    return map;
  };

  const paint = async (users: LocationUser[]) => {
    const m = await ensureMap();
    if (!m) return;
    // Remove markers no longer present
    for (const [uid, mk] of markers) {
      if (!users.some((u) => u.uid === uid)) {
        mk.remove();
        markers.delete(uid);
      }
    }
    const isMine = (uid: string) => myUid === uid;
    for (const u of users) {
      const mine = isMine(u.uid);
      const existing = markers.get(u.uid);
      const color = mine ? '#2f6b4f' : colorForUid(u.uid);
      if (existing) {
        existing.setLatLng([u.lat, u.lng]);
        existing.setStyle({ color, fillColor: color });
        existing.bindPopup(bindPopup(u, mine));
        continue;
      }
      const mk = (Lmod ?? (await import('leaflet'))).circleMarker([u.lat, u.lng], {
        radius: mine ? 14 : 10,
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.35
      }).addTo(m);
      mk.bindPopup(bindPopup(u, mine));
      markers.set(u.uid, mk);
      if (mine && !centerDone && myUid) {
        m.setView([u.lat, u.lng], FESTIVAL_ZOOM);
        centerDone = true;
      }
    }
  };

  const bindPopup = (u: LocationUser, mine: boolean) => {
    const p = document.createElement('div');
    p.className = 'map-pop';
    const nameEl = h('div', { class: 'map-pop__name' }, mine ? 'You' : u.name);
    const time = h('div', { class: 'map-pop__time' }, `updated ${timeAgo(u.ts)}`);
    p.appendChild(nameEl);
    p.appendChild(time);
    if (!mine) {
      const btn = h('button', { class: 'btn btn-primary small map-pop__msg', type: 'button', html: `${icon('chat', 13)} Message` });
      btn.addEventListener('click', () => void dmPerson(u.uid, u.name));
      p.appendChild(btn);
    }
    return p;
  };

  // ---- subscriptions ----
  const offOnline = onOnline((list) => {
    renderStatus(list.length);
    renderOnline(list);
  });
  const offShare = onShareStatus((s) => {
    shareState = s;
    refreshShare();
  });
  const offLocs = onLocations((list) => void paint(list));

  renderStatus(onlineUsersSnapshot().length);
  renderOnline(onlineUsersSnapshot());
  refreshShare();

  // The initial onLocations fire can happen before the view is laid out (view
  // transition / zero-height container on iOS). Keep retrying until the map is
  // actually built, so it never sits as a blank/partial-tile square.
  const initRetry = window.setInterval(() => {
    if (mapInitDone) {
      window.clearInterval(initRetry);
      return;
    }
    void paint(locationUsersSnapshot());
  }, 250);
  window.setTimeout(() => window.clearInterval(initRetry), 10000);

  onViewCleanup(() => {
    offOnline();
    offShare();
    offLocs();
    window.clearInterval(initRetry);
    if (ro) ro.disconnect();
    if (onResize) window.removeEventListener('resize', onResize);
    if (map) {
      map.remove();
      map = null;
    }
    markers.clear();
    // NOTE: if the user is actively sharing we deliberately keep sharing while
    // they browse the rest of the app — that's the point of "find me". They can
    // stop any time from this view's toggle.
  });

  return root;
}
