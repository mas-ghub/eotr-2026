import { initFirestore, ensureAuth, getApp } from './chat';
import { onRemindersChanged, allReminders, type Reminder } from './reminders';

// ====================================================================
// Web Push (FCM) reminders.
//
// The in-page scheduler only runs while the app is open, and iOS suspends it
// in the background — so on iPhones reminders can't fire from a timer alone.
// This module hands each device's upcoming reminders to the browser's push
// service (via FCM), and a scheduled sender (GitHub Actions cron, see
// scripts/push-sender.mjs) pushes them at the right moment — even when the
// app is fully closed.
//
// Strictly additive + online-only: if Firebase, FCM, or the network is
// unavailable, everything degrades silently (the local scheduler still works
// while the app is open). No writes happen unless a reminder exists.
// ====================================================================

const PREFIX = (import.meta.env.VITE_FIRESTORE_PREFIX || '').replace(/[^A-Za-z0-9_]/g, '');
const col = () => PREFIX + 'pushReminders';

// Unique per install, so one person can have several devices registered.
const DEVICE_KEY = 'eotr2026.push.device.v1';

const NAME_KEY = 'eotr2026.name.v1';

let started = false;
let online = typeof navigator !== 'undefined' ? navigator.onLine : true;
let debounce: number | undefined;
let lastSync = '';

interface PushReminderRecord {
  actId: string;
  name: string;
  stage: string;
  start: string;
  startMs: number;
  fireAt: number;
  leadMin: number;
  artistSlug: string | null;
}

function configured(): boolean {
  try {
    return !!(import.meta.env.VITE_FIREBASE_API_KEY && import.meta.env.VITE_FIREBASE_VAPID_KEY);
  } catch {
    return false;
  }
}

function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = `d${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return 'device';
  }
}

function myName(): string {
  try {
    const v = localStorage.getItem(NAME_KEY);
    if (v && v.trim()) return v.trim();
  } catch {
    /* ignore */
  }
  return 'Me';
}

function signature(list: Reminder[]): string {
  return list
    .map((r) => `${r.actId}:${r.fireAt}:${r.leadMin}:${r.fired ? 1 : 0}`)
    .sort()
    .join('|');
}

// ====================================================================
// Lifecycle
// ====================================================================

/** Start syncing reminders for web push. Idempotent; call once on boot.
 *  Never throws. */
export function pushStart(): void {
  if (started) return;
  started = true;
  if (!configured()) return;
  window.addEventListener('online', () => {
    online = true;
    void syncNow();
  });
  window.addEventListener('offline', () => {
    online = false;
  });
  onRemindersChanged(() => scheduleSync());
  void syncNow();
}

function scheduleSync() {
  if (debounce) window.clearTimeout(debounce);
  debounce = window.setTimeout(() => void syncNow(), 1200);
}

// ====================================================================
// Sync (write our reminders + push subscription to Firestore)
// ====================================================================

async function syncNow(): Promise<void> {
  if (!online || !configured()) return;
  const firestore = await initFirestore();
  if (!firestore) return;
  const uid = await ensureAuth();
  if (!uid) return;
  const app = getApp();
  if (!app) return;

  // Skip if nothing changed (avoids pointless writes each reload).
  const list = allReminders().filter((r) => !r.fired);
  const sig = signature(list);
  if (sig === lastSync) return;

  try {
    // Get the FCM push subscription token. Requires notification permission;
    // if it's missing we still store reminders (the sender just has no token
    // to push to yet, and will get one the moment permission is granted).
    let token: string | null = null;
    try {
      const { getMessaging, getToken } = await import('firebase/messaging');
      const messaging = getMessaging(app);
      token = await getToken(messaging, {
        vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY
      });
    } catch {
      token = null;
    }

    const records: PushReminderRecord[] = list.map((r) => ({
      actId: r.actId,
      name: r.name,
      stage: r.stage,
      start: r.start,
      startMs: r.startMs,
      fireAt: r.fireAt,
      leadMin: r.leadMin,
      artistSlug: r.artistSlug || null
    }));

    const { doc, setDoc } = await import('firebase/firestore');
    await setDoc(
      doc(firestore, col(), deviceId()),
      {
        uid,
        name: myName(),
        token: token || '',
        reminders: records,
        ts: Date.now()
      },
      { merge: true }
    );
    lastSync = sig;
  } catch {
    /* non-fatal — retried on the next reminder change / online event */
  }
}

/** Forget this device's push registration (called if the user revokes
 *  notification permission, so the sender stops trying a dead token). */
export async function pushForgetDevice(): Promise<void> {
  try {
    const firestore = await initFirestore();
    if (!firestore) return;
    const { doc, deleteDoc } = await import('firebase/firestore');
    await deleteDoc(doc(firestore, col(), deviceId()));
  } catch {
    /* ignore */
  }
}
