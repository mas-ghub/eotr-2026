import type { Firestore } from 'firebase/firestore';
import { getDb, getUid } from './chat';
import { getName } from './greeting';

// ====================================================================
// Presence + location sharing (Firestore-backed).
// Presence is automatic while the app is open. Location is strictly
// opt-in (browser geolocation prompt) and stored per device in the
// `locations` collection; turning it off deletes the record.
// ====================================================================

export interface OnlineUser {
  uid: string;
  name: string;
  lastSeen: number; // epoch millis
}

export interface LocationUser {
  uid: string;
  name: string;
  lat: number;
  lng: number;
  accuracy: number;
  ts: number; // epoch millis
}

export type ShareStatus = 'unsupported' | 'denied' | 'error' | 'off' | 'connecting' | 'on';

const SHARE_KEY = 'eotr2026.shareloc.v1';
const HEARTBEAT_MS = 30000;
const ONLINE_WINDOW_MS = 120000; // 2 min without a heartbeat => offline
const LOCATION_WRITE_MS = 30000; // don't write more than every 30s
const MOVE_M = 20; // only write if moved ~20m or the interval elapsed

let db: Firestore | null = null;
let watchId: number | null = null;
let locTimer: ReturnType<typeof setInterval> | null = null;
let lastWrite = 0;
let lastPos: { lat: number; lng: number } | null = null;
let sharing = false;

const onlineListeners = new Set<(u: OnlineUser[]) => void>();
const locListeners = new Set<(u: LocationUser[]) => void>();
const shareListeners = new Set<(s: ShareStatus) => void>();

let onlineUsers: OnlineUser[] = [];
let locationUsers: LocationUser[] = [];
let lastShare: ShareStatus = 'off';

function emitOnline() {
  onlineListeners.forEach((fn) => fn([...onlineUsers]));
}
function emitLocs() {
  locListeners.forEach((fn) => fn([...locationUsers]));
}
function setShare(s: ShareStatus) {
  lastShare = s;
  shareListeners.forEach((fn) => fn(s));
}

function currentName(): string {
  return getName() || 'Festival-goer';
}

function toMillis(v: unknown): number {
  if (v && typeof v === 'object' && typeof (v as { toMillis?: unknown }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  return Date.now();
}

// ====================================================================
// Presence (automatic "who's online")
// ====================================================================

async function ensureDb(): Promise<Firestore | null> {
  if (db) return db;
  db = await getDb();
  return db;
}

let presenceStarted = false;

/** Start presence heartbeats. Idempotent; safe to call on boot. */
export async function presenceStart(): Promise<void> {
  if (presenceStarted) return;
  const uid = await getUid();
  const firestore = await ensureDb();
  if (!uid || !firestore) return;
  presenceStarted = true;

  const beat = async (online: boolean) => {
    try {
      const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
      const ref = doc(firestore, 'presence', uid);
      await setDoc(
        ref,
        { name: currentName(), online, lastSeen: serverTimestamp() },
        { merge: true }
      );
    } catch {
      /* non-fatal — presence is best-effort */
    }
  };
  void beat(true);
  setInterval(() => void beat(true), HEARTBEAT_MS);

  // Mark offline promptly when the tab is hidden or the page unloads.
  const markOffline = () => void beat(false);
  window.addEventListener('pagehide', markOffline);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') markOffline();
  });

  try {
    const { collection, query, where, onSnapshot } = await import('firebase/firestore');
    const q = query(collection(firestore, 'presence'), where('online', '==', true));
    onSnapshot(
      q,
      (snap) => {
        const now = Date.now();
        onlineUsers = snap.docs
          .map((d) => {
            const data = d.data() as { name?: unknown; lastSeen?: unknown; online?: unknown };
            return {
              uid: d.id,
              name: typeof data.name === 'string' ? data.name : 'Festival-goer',
              lastSeen: toMillis(data.lastSeen)
            };
          })
          .filter((u) => now - u.lastSeen < ONLINE_WINDOW_MS)
          .sort((a, b) => a.name.localeCompare(b.name));
        emitOnline();
      },
      (err) => {
        console.error('[presence] listener error', err);
      }
    );
  } catch (err) {
    console.error('[presence] setup error', err);
  }
}

export function onOnline(fn: (u: OnlineUser[]) => void): () => void {
  onlineListeners.add(fn);
  fn([...onlineUsers]);
  return () => {
    onlineListeners.delete(fn);
  };
}

export function onlineUsersSnapshot(): OnlineUser[] {
  return [...onlineUsers];
}

// ====================================================================
// Location sharing (opt-in)
// ====================================================================

export function sharePref(): boolean {
  try {
    return localStorage.getItem(SHARE_KEY) === '1';
  } catch {
    return false;
  }
}

function setSharePref(v: boolean) {
  try {
    if (v) localStorage.setItem(SHARE_KEY, '1');
    else localStorage.removeItem(SHARE_KEY);
  } catch {
    /* ignore */
  }
}

export function shareStatus(): ShareStatus {
  return lastShare;
}

export function onShareStatus(fn: (s: ShareStatus) => void): () => void {
  shareListeners.add(fn);
  fn(lastShare);
  return () => {
    shareListeners.delete(fn);
  };
}

function geoSupported(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator;
}

async function writeLocation(pos: { lat: number; lng: number; accuracy: number }) {
  const firestore = await ensureDb();
  const uid = await getUid();
  if (!firestore || !uid || !sharing) return;
  try {
    const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
    await setDoc(
      doc(firestore, 'locations', uid),
      { name: currentName(), lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy, ts: serverTimestamp() },
      { merge: true }
    );
    lastWrite = Date.now();
  } catch {
    /* rules may not be published yet — non-fatal */
  }
}

function onFix(pos: GeolocationPosition) {
  const { latitude: lat, longitude: lng, accuracy } = pos.coords;
  const moved = lastPos ? Math.hypot(lat - lastPos.lat, lng - lastPos.lng) * 111000 : Infinity;
  const elapsed = Date.now() - lastWrite;
  lastPos = { lat, lng };
  if (elapsed >= LOCATION_WRITE_MS || moved >= MOVE_M) {
    void writeLocation({ lat, lng, accuracy });
  }
}

/** Turn location sharing on (asks the browser for permission). */
export function startSharing(): void {
  if (!geoSupported()) {
    setShare('unsupported');
    return;
  }
  sharing = true;
  setSharePref(true);
  setShare('connecting');
  try {
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        onFix(pos);
        setShare('on');
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          sharing = false;
          setSharePref(false);
          setShare('denied');
        } else {
          setShare('error');
        }
      },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
    );
    // Interval fallback in case watchPosition never fires a fix.
    locTimer = setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        (pos) => onFix(pos),
        () => {
          /* ignore */
        },
        { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
      );
    }, LOCATION_WRITE_MS);
  } catch {
    setShare('error');
  }
}

/** Turn location sharing off and delete the stored location. */
export function stopSharing(): void {
  sharing = false;
  setSharePref(false);
  if (watchId !== null) {
    try {
      navigator.geolocation.clearWatch(watchId);
    } catch {
      /* ignore */
    }
    watchId = null;
  }
  if (locTimer) {
    clearInterval(locTimer);
    locTimer = null;
  }
  lastPos = null;
  setShare('off');
  void (async () => {
    const firestore = await ensureDb();
    const uid = await getUid();
    if (!firestore || !uid) return;
    try {
      const { doc, deleteDoc } = await import('firebase/firestore');
      await deleteDoc(doc(firestore, 'locations', uid));
    } catch {
      /* ignore */
    }
  })();
}

/** If the user opted in before, resume sharing on next visit. */
export async function resumeSharingIfPref(): Promise<void> {
  if (sharePref() && !sharing) startSharing();
}

// Live location of everyone who is sharing.
export function onLocations(fn: (u: LocationUser[]) => void): () => void {
  locListeners.add(fn);
  fn([...locationUsers]);
  return () => {
    locListeners.delete(fn);
  };
}

export async function subscribeLocations(): Promise<void> {
  // Wait for auth before attaching so the listener never fires an
  // unauthenticated (permission-denied) attempt — the SDK would recover, but
  // it logs an ugly uncaught error.
  await getUid();
  const firestore = await ensureDb();
  if (!firestore) return;
  try {
    const { collection, onSnapshot } = await import('firebase/firestore');
    onSnapshot(
      collection(firestore, 'locations'),
      (snap) => {
        const now = Date.now();
        locationUsers = snap.docs
          .map((d) => {
            const data = d.data() as { name?: unknown; lat?: unknown; lng?: unknown; accuracy?: unknown; ts?: unknown };
            return {
              uid: d.id,
              name: typeof data.name === 'string' ? data.name : 'Festival-goer',
              lat: typeof data.lat === 'number' ? data.lat : 0,
              lng: typeof data.lng === 'number' ? data.lng : 0,
              accuracy: typeof data.accuracy === 'number' ? data.accuracy : 0,
              ts: toMillis(data.ts)
            };
          })
          .filter((u) => now - u.ts < 30 * 60000 && u.lat !== 0)
          .sort((a, b) => a.name.localeCompare(b.name));
        emitLocs();
      },
      (err) => console.error('[locations] listener error', err)
    );
  } catch {
    /* ignore */
  }
}

export function locationUsersSnapshot(): LocationUser[] {
  return [...locationUsers];
}

// ====================================================================
// Misc helpers
// ====================================================================

/** Stable marker colour from a uid so each person keeps one colour. */
export function colorForUid(uid: string): string {
  const palette = ['#e8602f', '#d9a93a', '#2f6b4f', '#3a7ca5', '#8e44ad', '#c0392b', '#16a085', '#e67e22'];
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
