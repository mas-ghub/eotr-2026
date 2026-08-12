import type { Act } from './types';
import { festivalStartMs } from './data';
import { toast } from './ui';

// ====================================================================
// Set reminders — "ping me before this band starts".
// Everything is local (no server): we compare the set's absolute start time
// against the clock and fire a notification when it's time. The app must be
// open or recently backgrounded for the timer to run; on devices/browsers
// that support the Notification Triggers API (Chrome on Android) we also hand
// the reminder to the service worker so it can fire even when closed.
// ====================================================================

export interface Reminder {
  actId: string;
  name: string;
  stage: string;
  dayKey: string;
  start: string; // display time, e.g. "15:05"
  startMs: number; // absolute epoch millis
  artistSlug?: string | null;
  leadMin: number; // 0 = at showtime, 15, 30, 60
  fireAt: number; // epoch millis
  fired: boolean;
}

export interface LeadOption {
  value: number;
  label: string;
}

export const LEAD_OPTIONS: LeadOption[] = [
  { value: 0, label: 'At showtime' },
  { value: 15, label: '15 min before' },
  { value: 30, label: '30 min before' },
  { value: 60, label: '1 hr before' }
];

const STORAGE_KEY = 'eotr2026.reminders.v1';
const CHECK_MS = 15000; // scheduler tick
const PAST_GRACE_MS = 3600000; // purge reminders 1h after their set

type Listener = () => void;
const listeners = new Set<Listener>();

function load(): Reminder[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function save(list: Reminder[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((fn) => fn());
}

export function onRemindersChanged(fn: Listener): () => void {
  listeners.add(fn);
  fn();
  return () => {
    listeners.delete(fn);
  };
}

function leadLabel(leadMin: number): string {
  return LEAD_OPTIONS.find((o) => o.value === leadMin)?.label || `${leadMin} min before`;
}

export function getReminder(actId: string): Reminder | undefined {
  return load().find((r) => r.actId === actId && !r.fired);
}

export function activeReminders(): Reminder[] {
  const now = Date.now();
  return load()
    .filter((r) => !r.fired && r.fireAt > now)
    .sort((a, b) => a.fireAt - b.fireAt);
}

export function allReminders(): Reminder[] {
  return load();
}

/**
 * Set a reminder for a set. Returns true on success, false if the set has
 * already started (or is about to within the lead time).
 */
export async function setReminder(act: Act, leadMin: number): Promise<boolean> {
  const startMs = festivalStartMs(act);
  const now = Date.now();
  const fireAt = startMs - leadMin * 60000;
  if (fireAt <= now) {
    toast('That set is already on — too late to set a reminder for it.', { type: 'info', ms: 3200 });
    return false;
  }
  // One reminder per set — replace any earlier entry for this act (including a
  // fired one that is still lingering until the grace-period purge).
  const list = load().filter((r) => r.actId !== act.id);
  list.push({
    actId: act.id,
    name: act.name,
    stage: act.stage,
    dayKey: act.dayKey,
    start: act.start,
    startMs,
    artistSlug: act.artistSlug,
    leadMin,
    fireAt,
    fired: false
  });
  save(list);

  // Enhancement: on browsers with Notification Triggers, hand it to the SW so
  // it can fire even when the app is fully closed (Chrome on Android).
  if (supportsTriggers() && 'serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      const Trigger = (window as unknown as { TimestampTrigger?: new (t: number) => unknown }).TimestampTrigger;
      if (Trigger) {
        const title = buildTitle(act, leadMin);
        const opts: NotificationOptions & Record<string, unknown> = {
          body: buildBody(act),
          tag: `rem-${act.id}`,
          icon: './icons/icon-192.png',
          data: { url: act.artistSlug ? `./#/artist/${act.artistSlug}` : './' },
          showTrigger: new Trigger(fireAt)
        };
        await reg.showNotification(title, opts);
      }
    } catch {
      /* non-fatal — the in-page scheduler still covers open-app reminders */
    }
  }
  return true;
}

export function removeReminder(actId: string): void {
  save(load().filter((r) => r.actId !== actId));
}

// ---- permission ----

export type PermissionState = 'granted' | 'denied' | 'unsupported' | 'default';

export function notificationState(): PermissionState {
  try {
    if (!('Notification' in window)) return 'unsupported';
    const p = Notification.permission;
    if (p === 'granted') return 'granted';
    if (p === 'denied') return 'denied';
    return 'default';
  } catch {
    return 'unsupported';
  }
}

export async function requestNotificationPermission(): Promise<PermissionState> {
  try {
    if (!('Notification' in window)) return 'unsupported';
    const p = await Notification.requestPermission();
    return p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'default';
  } catch {
    return 'unsupported';
  }
}

// ---- scheduler ----

let schedulerStarted = false;

/** Fire any reminders whose time has come, then clean up the past. Exported so
 *  tests can trigger a tick directly instead of waiting for the interval. */
export function schedulerTick(): void {
  const now = Date.now();
  const list = load();
  let changed = false;

  for (const r of list) {
    if (r.fired) continue;
    if (r.fireAt <= now) {
      r.fired = true;
      showReminderNotification(r);
      changed = true;
    }
  }
  const kept = list.filter((r) => r.fireAt > now - PAST_GRACE_MS);
  if (kept.length !== list.length) changed = true;
  if (changed) save(kept);
}

/** Start the in-page reminder scheduler. Idempotent; call once on boot. */
export function startReminderScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  schedulerTick();
  setInterval(schedulerTick, CHECK_MS);
}

// ---- notification display ----

function buildTitle(act: Act, leadMin: number): string {
  const when = leadMin === 0 ? 'is about to start' : `starts in ${leadLabel(leadMin).replace(' before', '')}`;
  return `${act.name} ${when}`;
}

function buildBody(act: Act): string {
  return `${act.stage} · ${act.start}`;
}

/** Show a system notification. Prefers the service worker (so it can open the
 *  app on tap); falls back to a plain Notification. */
export async function showReminderNotification(r: Reminder, override?: { title?: string; body?: string; url?: string }): Promise<void> {
  const title = override?.title ?? `${r.name} starts in ${leadLabel(r.leadMin)}`;
  const body = override?.body ?? `${r.stage} · ${r.start}`;
  const url = override?.url ?? (r.artistSlug ? `./#/artist/${r.artistSlug}` : './');
  const options: NotificationOptions = {
    body,
    tag: `rem-${r.actId}`,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    data: { url }
  };

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, options);
      return;
    }
  } catch {
    /* fall through to the plain Notification path */
  }
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      const n = new Notification(title, options);
      n.onclick = () => {
        n.close();
        window.focus();
        location.hash = url.replace(/^\.\//, '') || '#/lineup';
      };
    }
  } catch {
    /* notifications unavailable — degrade to an in-app toast */
    toast(`${title} — ${body}`, { type: 'info', ms: 5000 });
  }
}

function supportsTriggers(): boolean {
  try {
    return 'Notification' in window && 'showTrigger' in Notification.prototype;
  } catch {
    return false;
  }
}

/** Schedule a test notification ~1 minute from now so the user can leave the
 *  app and verify it fires. On Chrome Android we hand it to the service worker
 *  with a TimestampTrigger, so it pops even when the app is fully closed.
 *  Elsewhere an in-app timer covers the open/backgrounded case. Tapping the
 *  notification opens the app at My Day. Returns true if it was scheduled. */
export async function sendTestNotification(): Promise<boolean> {
  try {
    let state = notificationState();
    if (state === 'default') state = await requestNotificationPermission();
    if (state !== 'granted') return false;

    const title = 'EOTR test reminder';
    const body = 'Tap to open My Day — notifications work ✅';
    const url = './#/myday';
    const fireAt = Date.now() + 60000; // 1 minute from now
    const r: Reminder = {
      actId: 'test',
      name: 'Test reminder',
      stage: 'EOTR 2026',
      dayKey: '',
      start: 'now',
      startMs: fireAt,
      artistSlug: null,
      leadMin: 0,
      fireAt,
      fired: false
    };

    // Preferred path: Notification Triggers → fires even when the app is closed.
    if (supportsTriggers() && 'serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.ready;
        const Trigger = (window as unknown as { TimestampTrigger?: new (t: number) => unknown }).TimestampTrigger;
        if (Trigger) {
          const opts: NotificationOptions & Record<string, unknown> = {
            body,
            tag: 'rem-test',
            icon: './icons/icon-192.png',
            badge: './icons/icon-192.png',
            data: { url },
            showTrigger: new Trigger(fireAt)
          };
          await reg.showNotification(title, opts);
          return true;
        }
      } catch {
        /* fall back to the in-app timer below */
      }
    }

    // Fallback: in-app timer. Fires while the app is open or backgrounded (on
    // iOS a fully-closed app suspends timers, so keep it in the foreground).
    window.setTimeout(() => {
      void showReminderNotification(r, { title, body, url });
    }, 60000);
    return true;
  } catch {
    return false;
  }
}
