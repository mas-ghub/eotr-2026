import { schedule } from './store';
import { initFirestore, ensureAuth } from './chat';
import type { Firestore } from 'firebase/firestore';

// ====================================================================
// Shared "My Day" picks.
//
// The user asked for their saved sets (My Day) to appear in Firestore so
// anyone using the app can see what everyone is into and planning to see.
// This is a strictly ONLINE, additive feature:
//   - It only ever writes when the app is online AND Firebase is configured
//     AND an anonymous identity exists. Every failure path silently degrades.
//   - The schedule itself is local (localStorage) and always works offline.
//   - Reading everyone else's picks is also online-only; the section simply
//     stays empty when there is no connection.
//   - "Who's going where" shows a display name + the saved set ids. Nothing
//     else (no location, no private chat data) is shared.
// ====================================================================

export interface SharedFavorites {
  uid: string;
  name: string;
  actIds: string[];
  ts: number;
}

export type FavoritesSync =
  | 'off' // Firebase not configured
  | 'offline' // no connection right now
  | 'connecting' // online but not yet authed / written
  | 'name-needed' // online but no display name set yet
  | 'synced' // our latest picks are live
  | 'error'; // last write failed (will retry)

/** Optional namespace so tests can run against isolated collections. */
const PREFIX = (import.meta.env.VITE_FIRESTORE_PREFIX || '').replace(/[^A-Za-z0-9_]/g, '');
const col = () => PREFIX + 'favorites';

const MAX_FAVS = 200;
const DEBOUNCE_MS = 1200;

const NAME_KEY = 'eotr2026.name.v1';

let started = false;
let online = typeof navigator !== 'undefined' ? navigator.onLine : true;
let unsubList: (() => void) | null = null;
let debounce: number | undefined;

let syncState: FavoritesSync = 'off';
const others: SharedFavorites[] = [];

const listListeners = new Set<(list: SharedFavorites[]) => void>();
const syncListeners = new Set<(s: FavoritesSync) => void>();

function setSync(s: FavoritesSync) {
  syncState = s;
  syncListeners.forEach((fn) => fn(s));
}

function emitList() {
  listListeners.forEach((fn) => fn([...others]));
}

function toMillis(v: unknown): number {
  if (v && typeof v === 'object' && typeof (v as { toMillis?: unknown }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  return Date.now();
}

function myName(): string | null {
  try {
    const v = localStorage.getItem(NAME_KEY);
    if (v && v.trim()) return v.trim();
  } catch {
    /* ignore */
  }
  return null;
}

function configured(): boolean {
  try {
    return !!(import.meta.env.VITE_FIREBASE_API_KEY && import.meta.env.VITE_FIREBASE_PROJECT_ID);
  } catch {
    return false;
  }
}

/** Is an error the "no network / can't reach Firestore" kind rather than a
 *  genuine app/permission failure? Firestore wraps offline writes in an
 *  `unavailable` error with a hint about operating in offline mode. */
function isLikelyOffline(err?: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return /unavailable|offline mode|could not reach|network/i.test(msg);
}

/** While the Firestore SDK is disconnected it silently BUFFERS writes and the
 *  promise never settles, so we can't wait forever. Race the operation against
 *  a timeout: rejections still propagate to the caller's try/catch; a timeout
 *  resolves with 'timeout' so the caller can degrade gracefully. */
function withWatchdog<T>(promise: Promise<T>, ms = 8000): Promise<T | 'timeout'> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve('timeout'), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

// ====================================================================
// Lifecycle
// ====================================================================

/** Start the favorites sync + "who's going where" listener. Idempotent;
 *  call once on boot. Never throws. */
export function favoritesStart(): void {
  if (started) return;
  started = true;
  if (!configured()) {
    setSync('off');
    return;
  }
  window.addEventListener('online', () => {
    online = true;
    setSync('connecting');
    void connect();
  });
  window.addEventListener('offline', () => {
    online = false;
    setSync('offline');
  });
  schedule.subscribe(() => scheduleChanged());
  // Self-heal: if a sync was deferred (offline / error / name-missing), retry
  // periodically so a brief connection blip recovers without user action.
  window.setInterval(() => {
    if (online && (syncState === 'offline' || syncState === 'error')) void connect();
  }, 30000);
  if (online) {
    setSync('connecting');
    void connect();
  } else {
    setSync('offline');
  }
}

// ====================================================================
// Sync (write our picks)
// ====================================================================

function scheduleChanged() {
  if (debounce) window.clearTimeout(debounce);
  debounce = window.setTimeout(() => void pushMyFavorites(), DEBOUNCE_MS);
}

/** Push the current My Day list to Firestore (debounced by the caller).
 *  Deletes the doc when the list is empty so stale "0 sets" entries vanish. */
async function pushMyFavorites(): Promise<void> {
  if (!online) {
    setSync('offline');
    return;
  }
  const name = myName();
  if (!name) {
    setSync('name-needed');
    return;
  }
  const firestore = await initFirestore();
  if (!firestore) {
    setSync('off');
    return;
  }
  const uid = await ensureAuth();
  if (!uid) {
    setSync('error');
    return;
  }
  setSync('connecting');
  try {
    const { doc, setDoc, deleteDoc, serverTimestamp } = await import('firebase/firestore');
    const ref = doc(firestore, col(), uid);
    const ids = schedule.all().slice(0, MAX_FAVS);
    // Always delete when empty: our Firestore rules allow an own-doc delete even
    // if the doc was never created, and a stale doc must never linger after a
    // reload just because this session hasn't written yet.
    const op = ids.length === 0 ? deleteDoc(ref) : setDoc(ref, { name, actIds: ids, ts: serverTimestamp() }, { merge: true });
    const result = await withWatchdog(op);
    if (result === 'timeout') {
      // The SDK is buffering the write because we're actually offline (or the
      // network is too flaky to settle). Show the graceful offline pill; the
      // next `online` event, schedule change, or periodic retry will recover.
      setSync('offline');
      return;
    }
    setSync('synced');
  } catch (err) {
    // A failed write with no connection shouldn't look like an app error.
    setSync(isLikelyOffline(err) ? 'offline' : 'error');
  }
}

// ====================================================================
// Read (everyone else's picks)
// ====================================================================

async function connect(): Promise<void> {
  if (!online) {
    setSync('offline');
    return;
  }
  const firestore = await initFirestore();
  if (!firestore) {
    setSync('off');
    return;
  }
  const uid = await ensureAuth();
  if (!uid) {
    // Couldn't get an identity. Without the error we can't tell offline from
    // a real auth failure, so be conservative and show the retry state.
    setSync('error');
    return;
  }
  void subscribeOthers(firestore, uid);
  void pushMyFavorites();
}

/** Live list of other people's shared picks (excludes our own uid). */
async function subscribeOthers(db: Firestore, uid: string): Promise<void> {
  if (unsubList) return;
  try {
    const { collection, query, orderBy, limit, onSnapshot } = await import('firebase/firestore');
    const q = query(collection(db, col()), orderBy('ts', 'desc'), limit(MAX_FAVS));
    unsubList = onSnapshot(
      q,
      (snap) => {
        const next: SharedFavorites[] = [];
        for (const d of snap.docs) {
          if (d.id === uid) continue;
          const data = d.data() as { name?: unknown; actIds?: unknown; ts?: unknown };
          const actIds = Array.isArray(data.actIds)
            ? data.actIds.filter((x): x is string => typeof x === 'string')
            : [];
          if (!actIds.length) continue;
          next.push({
            uid: d.id,
            name: typeof data.name === 'string' ? data.name : '?',
            actIds,
            ts: toMillis(data.ts)
          });
        }
        next.sort((a, b) => b.actIds.length - a.actIds.length || a.name.localeCompare(b.name));
        others.length = 0;
        others.push(...next);
        emitList();
      },
      () => {
        /* non-fatal — the section just stays as it was */
      }
    );
  } catch {
    /* ignore */
  }
}

// ====================================================================
// Public API — state + subscriptions
// ====================================================================

export function favoritesSync(): FavoritesSync {
  return syncState;
}

export function sharedFavorites(): SharedFavorites[] {
  return [...others];
}

export function onSharedFavorites(fn: (list: SharedFavorites[]) => void): () => void {
  listListeners.add(fn);
  fn([...others]);
  return () => {
    listListeners.delete(fn);
  };
}

export function onFavoritesSync(fn: (s: FavoritesSync) => void): () => void {
  syncListeners.add(fn);
  fn(syncState);
  return () => {
    syncListeners.delete(fn);
  };
}

/** Small human line for the My Day status pill. Empty = don't render. */
export function syncLabel(): string {
  switch (syncState) {
    case 'off':
      return '';
    case 'offline':
      return 'Picks will share when you’re back online';
    case 'connecting':
      return 'Connecting…';
    case 'name-needed':
      return 'Set your name to share your picks';
    case 'synced':
      return 'Sharing my picks · live';
    case 'error':
      return 'Sharing paused — will retry';
  }
}
