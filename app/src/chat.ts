import type { FirebaseApp } from 'firebase/app';
import type { Firestore } from 'firebase/firestore';
import type { Auth, User } from 'firebase/auth';

// ====================================================================
// Types
// ====================================================================

export interface ChatMessage {
  id: string;
  name: string;
  text: string;
  ts: number; // epoch millis
  senderId?: string;
}

export interface Conversation {
  id: string;
  type: 'dm' | 'group';
  participants: string[]; // uids
  names: Record<string, string>; // uid -> display name
  title?: string;
  lastAt: number;
  lastText: string;
  createdBy: string;
}

export type ChatStatus =
  | { state: 'not-configured' }
  | { state: 'connecting' }
  | { state: 'online'; count: number }
  | { state: 'offline' }
  | { state: 'error'; message: string };

export type AuthState = 'unknown' | 'ready' | 'failed';

export interface IncomingNotice {
  name: string;
  source: 'wall' | 'dm' | 'group';
}

// ====================================================================
// Constants
// ====================================================================

const MAX_MESSAGES = 50;
const SEEN_KEY = 'eotr2026.chat.seen.v1';
const CONV_SEEN_PREFIX = 'eotr2026.chat.seen.conv.v1.';
const MSG_LIMIT = 280;
const NAME_LIMIT = 24;
const GROUP_MAX = 20;

/**
 * Optional collection namespace so tests can run against isolated collections
 * (VITE_FIRESTORE_PREFIX=devtest_) and never write to the live app data.
 */
const PREFIX = (import.meta.env.VITE_FIRESTORE_PREFIX || '').replace(/[^A-Za-z0-9_]/g, '');
const c = (name: string) => PREFIX + name;
const convPath = (convId: string) => c('conversations') + '/' + convId + '/messages';
const convDoc = (convId: string) => c('conversations') + '/' + convId;

/** Returns the Firebase config from app/.env, or null if chat isn't set up yet. */
function chatConfig(): Record<string, string> | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  if (!apiKey || !projectId) return null;
  return {
    apiKey,
    projectId,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: import.meta.env.VITE_FIREBASE_APP_ID || ''
  };
}

// ====================================================================
// State
// ====================================================================

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;
let myUid: string | null = null;
let authState: AuthState = 'unknown';
let initPromise: Promise<Firestore | null> | null = null;
let authPromise: Promise<string | null> | null = null;
let unsubWall: (() => void) | null = null;
let unsubConvs: (() => void) | null = null;
let started = false;
let online = navigator.onLine;

let messages: ChatMessage[] = [];
let convs: Conversation[] = [];

const msgListeners = new Set<(msgs: ChatMessage[]) => void>();
const statusListeners = new Set<(s: ChatStatus) => void>();
const unreadListeners = new Set<(n: number) => void>();
const authListeners = new Set<(s: AuthState) => void>();
const convListeners = new Set<(list: Conversation[]) => void>();
const incomingListeners = new Set<(n: IncomingNotice) => void>();

let lastStatus: ChatStatus = chatConfig() ? { state: online ? 'connecting' : 'offline' } : { state: 'not-configured' };

let wallSig = '';
const convSig = new Map<string, string>();

// ====================================================================
// Emitters
// ====================================================================

function emitMessages() {
  msgListeners.forEach((fn) => fn([...messages]));
}
function setStatus(s: ChatStatus) {
  lastStatus = s;
  statusListeners.forEach((fn) => fn(s));
}
function setAuthState(s: AuthState) {
  authState = s;
  authListeners.forEach((fn) => fn(s));
}
function emitConvs() {
  convListeners.forEach((fn) => fn([...convs]));
}
function emitUnread() {
  unreadListeners.forEach((fn) => fn(unreadTotal()));
}
function emitIncoming(n: IncomingNotice) {
  incomingListeners.forEach((fn) => fn(n));
}

// ====================================================================
// Firebase bootstrap (lazy, code-split)
// ====================================================================

/** Lazy-initialise Firestore (single app-wide instance). Exported so the
 *  favorites-sharing module can reuse the same connection + identity. */
export async function initFirestore(): Promise<Firestore | null> {
  if (db) return db;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const cfg = chatConfig();
    if (!cfg) return null;
    try {
      const { initializeApp } = await import('firebase/app');
      app = initializeApp(cfg);
      const { getFirestore } = await import('firebase/firestore');
      db = getFirestore(app);
      return db;
    } catch (err) {
      setStatus({ state: 'error', message: err instanceof Error ? err.message : 'Could not connect' });
      return null;
    }
  })();
  return initPromise;
}

/** Restore or create the anonymous identity (same uid persists across reloads).
 *  Exported so favorites sharing can reuse the same identity. */
export async function ensureAuth(): Promise<string | null> {
  if (myUid) return myUid;
  if (!app) return null;
  if (authPromise) return authPromise;
  authPromise = (async () => {
    try {
      const { getAuth, onAuthStateChanged, signInAnonymously } = await import('firebase/auth');
      auth = getAuth(app);
      await new Promise<void>((resolve) => {
        const un = onAuthStateChanged(auth!, () => {
          un();
          resolve();
        });
      });
      let user: User | null = auth.currentUser;
      if (!user) {
        const cred = await signInAnonymously(auth);
        user = cred.user;
      }
      myUid = user.uid;
      setAuthState('ready');
      return myUid;
    } catch (err) {
      // Reset so a later retry (e.g. after reconnecting) can try again.
      authPromise = null;
      setAuthState('failed');
      return null;
    }
  })();
  return authPromise;
}

function toMillis(v: unknown): number {
  if (v && typeof v === 'object' && typeof (v as { toMillis?: unknown }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  return Date.now();
}

function mapWallDoc(id: string, data: { name?: unknown; text?: unknown; ts?: unknown; senderId?: unknown }): ChatMessage {
  return {
    id,
    name: typeof data.name === 'string' ? data.name : '?',
    text: typeof data.text === 'string' ? data.text : '',
    ts: toMillis(data.ts),
    senderId: typeof data.senderId === 'string' ? data.senderId : undefined
  };
}

function mapConvDoc(id: string, data: Record<string, unknown>): Conversation {
  const names: Record<string, string> = {};
  const rawNames = data.names;
  if (rawNames && typeof rawNames === 'object') {
    for (const [k, v] of Object.entries(rawNames)) if (typeof v === 'string') names[k] = v;
  }
  const parts = Array.isArray(data.participants) ? data.participants.filter((p): p is string => typeof p === 'string') : [];
  return {
    id,
    type: data.type === 'group' ? 'group' : 'dm',
    participants: parts,
    names,
    title: typeof data.title === 'string' ? data.title : undefined,
    lastAt: toMillis(data.lastAt),
    lastText: typeof data.lastText === 'string' ? data.lastText : '',
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : ''
  };
}

async function subscribeWall() {
  if (!db || unsubWall) return;
  const { collection, query, orderBy, limitToLast, onSnapshot } = await import('firebase/firestore');
  const q = query(collection(db, c('messages')), orderBy('ts', 'asc'), limitToLast(MAX_MESSAGES));
  unsubWall = onSnapshot(
    q,
    (snap) => {
      messages = snap.docs.map((d) => mapWallDoc(d.id, d.data() as Parameters<typeof mapWallDoc>[1]));
      setStatus({ state: 'online', count: messages.length });
      emitMessages();
      emitUnread();
      const last = messages[messages.length - 1];
      if (last) {
        const sig = last.id;
        if (wallSig && sig !== wallSig && last.senderId && last.senderId !== myUid) {
          emitIncoming({ name: last.name, source: 'wall' });
        }
        wallSig = sig;
      }
    },
    (err) => setStatus({ state: 'error', message: err.message || 'Could not load messages' })
  );
}

async function subscribeConvs() {
  if (!db || !myUid || unsubConvs) return;
  try {
    const { collection, query, where, onSnapshot } = await import('firebase/firestore');
    const q = query(collection(db, c('conversations')), where('participants', 'array-contains', myUid));
    unsubConvs = onSnapshot(
      q,
      (snap) => {
        const seen = new Set<string>();
        for (const d of snap.docs) {
          const c = mapConvDoc(d.id, d.data() as Record<string, unknown>);
          seen.add(c.id);
          void ensureConvIncoming(c);
        }
        for (const [id, un] of convIncoming) {
          if (!seen.has(id)) {
            un();
            convIncoming.delete(id);
          }
        }
        convs = snap.docs
          .map((d) => mapConvDoc(d.id, d.data() as Record<string, unknown>))
          .sort((a, b) => b.lastAt - a.lastAt);
        emitConvs();
        emitUnread();
      },
      () => {
        /* conversation list errors are non-fatal — wall still works */
      }
    );
  } catch {
    /* ignore */
  }
}

const convIncoming = new Map<string, () => void>();

/** Watch a conversation's newest message once, for the incoming-notification path. */
async function ensureConvIncoming(c: Conversation) {
  if (convIncoming.has(c.id) || !db) return;
  try {
    const { collection, query, orderBy, limitToLast, onSnapshot } = await import('firebase/firestore');
    const q = query(collection(db, convPath(c.id)), orderBy('ts', 'asc'), limitToLast(1));
    const un = onSnapshot(
      q,
      (snap) => {
        const last = snap.docs[snap.docs.length - 1];
        if (!last) return;
        const sig = last.id;
        const prev = convSig.get(c.id);
        const data = last.data() as { senderId?: unknown; name?: unknown };
        const senderId = typeof data.senderId === 'string' ? data.senderId : undefined;
        if (prev && sig !== prev && senderId && senderId !== myUid) {
          emitIncoming({ name: typeof data.name === 'string' ? data.name : 'Someone', source: c.type });
        }
        convSig.set(c.id, sig);
      },
      () => {
        /* ignore */
      }
    );
    convIncoming.set(c.id, () => un());
  } catch {
    /* ignore */
  }
}

async function start() {
  if (started) return;
  started = true;
  window.addEventListener('online', () => {
    online = true;
    void start();
  });
  window.addEventListener('offline', () => {
    online = false;
    setStatus({ state: 'offline' });
  });
  if (!online) {
    setStatus({ state: 'offline' });
    return;
  }
  const firestore = await initFirestore();
  if (!firestore) return;
  setStatus({ state: 'connecting' });
  const uid = await ensureAuth();
  if (!uid) {
    // Still allow reading the wall even if anonymous auth failed (rules block writes).
    setStatus({ state: 'online', count: messages.length });
    void subscribeWall();
    return;
  }
  void subscribeWall();
  void subscribeConvs();
}

// ====================================================================
// Public API — lifecycle
// ====================================================================

/** Kick off the chat connection. Safe to call repeatedly; idempotent. */
export function chatStart() {
  void start();
}

/** Stop the wall listener (e.g. when leaving the chat view) but keep the connection. */
export function chatStop() {
  if (unsubWall) {
    unsubWall();
    unsubWall = null;
  }
}

// ====================================================================
// Public API — state + subscriptions
// ====================================================================

export function chatMessages(): ChatMessage[] {
  return [...messages];
}

export function chatStatus(): ChatStatus {
  return lastStatus;
}

export function isConfigured(): boolean {
  return chatConfig() !== null;
}

export function currentUid(): string | null {
  return myUid;
}

export function currentAuth(): AuthState {
  return authState;
}

export function onChatMessages(fn: (msgs: ChatMessage[]) => void): () => void {
  msgListeners.add(fn);
  fn([...messages]);
  return () => {
    msgListeners.delete(fn);
  };
}

export function onChatStatus(fn: (s: ChatStatus) => void): () => void {
  statusListeners.add(fn);
  fn(lastStatus);
  return () => {
    statusListeners.delete(fn);
  };
}

export function onAuth(fn: (s: AuthState) => void): () => void {
  authListeners.add(fn);
  fn(authState);
  return () => {
    authListeners.delete(fn);
  };
}

/** Fires for NEW messages that aren't yours (wall or private). Never on initial load. */
export function onIncoming(fn: (n: IncomingNotice) => void): () => void {
  incomingListeners.add(fn);
  return () => {
    incomingListeners.delete(fn);
  };
}

export function conversations(): Conversation[] {
  return [...convs];
}

export function onConversations(fn: (list: Conversation[]) => void): () => void {
  convListeners.add(fn);
  fn([...convs]);
  return () => {
    convListeners.delete(fn);
  };
}

/** Subscribe to a specific conversation's messages. Returns an unsubscribe fn. */
export function listenConversation(convId: string, fn: (msgs: ChatMessage[]) => void): () => void {
  let unsub: (() => void) | null = null;
  if (db) {
    void (async () => {
      const f = await import('firebase/firestore');
      const q = f.query(f.collection(db!, convPath(convId)), f.orderBy('ts', 'asc'), f.limitToLast(MAX_MESSAGES));
      unsub = f.onSnapshot(
        q,
        (snap) => {
          fn(snap.docs.map((d) => mapWallDoc(d.id, d.data() as Parameters<typeof mapWallDoc>[1])));
        },
        () => {
          /* non-fatal */
        }
      );
    })();
  }
  return () => {
    unsub?.();
  };
}

// ====================================================================
// Public API — sending
// ====================================================================

/** Post a message to the public wall. Requires anonymous auth. */
export async function sendMessage(name: string, text: string): Promise<boolean> {
  const clean = text.trim().slice(0, MSG_LIMIT);
  const who = name.trim().slice(0, NAME_LIMIT);
  if (!clean || !who || !myUid) return false;
  const firestore = await initFirestore();
  if (!firestore) return false;
  try {
    const { collection, addDoc, serverTimestamp } = await import('firebase/firestore');
    await addDoc(collection(firestore, c('messages')), { name: who, text: clean, ts: serverTimestamp(), senderId: myUid });
    return true;
  } catch {
    return false;
  }
}

// ====================================================================
// Unique-name claiming (the `names` collection)
// ====================================================================

export type ClaimResult = 'ok' | 'taken' | 'unavailable';

/**
 * Claim a display name so it can't be used by two people at once.
 * Names are case-insensitively unique (doc id = lowercased name). Only the
 * device that first claims a name may keep using/changing it; a second device
 * trying the same name gets 'taken'. Returns 'unavailable' when the check
 * can't run (offline / rules not published yet) so the app can still fall back
 * to a purely local name rather than blocking a guestbook message.
 */
export async function claimName(displayName: string): Promise<ClaimResult> {
  const name = displayName.trim().slice(0, NAME_LIMIT);
  if (!name) return 'taken';
  const firestore = await initFirestore();
  if (!firestore) return 'unavailable';
  const uid = await ensureAuth();
  if (!uid) return 'unavailable';
  const id = name.toLowerCase();
  try {
    const { doc, getDoc, setDoc, serverTimestamp } = await import('firebase/firestore');
    const ref = doc(firestore, c('names'), id);
    let exists = false;
    let mine = false;
    try {
      const snap = await getDoc(ref);
      exists = snap.exists();
      mine = exists && snap.data()?.uid === uid;
    } catch {
      // Can't read the names collection — rules may not include it yet.
      return 'unavailable';
    }
    if (exists) {
      if (mine) {
        try {
          await setDoc(ref, { name, uid, ts: serverTimestamp() }, { merge: true });
          return 'ok';
        } catch {
          return 'unavailable';
        }
      }
      return 'taken';
    }
    await setDoc(ref, { name, uid, ts: serverTimestamp() });
    return 'ok';
  } catch {
    // Create failed — someone else grabbed the name in the race window.
    return 'taken';
  }
}

/** Open (or create) a DM with another user. Returns the conversation or null. */
export async function openDm(otherUid: string, otherName: string): Promise<Conversation | null> {
  const myName = currentName();
  if (!myUid || !otherUid || otherUid === myUid || !myName) return null;
  const firestore = await initFirestore();
  if (!firestore) return null;
  const sorted = [myUid, otherUid].sort();
  const convId = `dm_${sorted[0]}_${sorted[1]}`;
  try {
    const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
    const ref = doc(firestore, convDoc(convId));
    // Merge upsert: creates if missing, otherwise preserves existing fields
    // (e.g. the other participant's name). No getDoc — reading a doc that
    // doesn't exist yet is denied by the read rule (resource is null).
    await setDoc(ref, {
      type: 'dm',
      participants: sorted,
      names: { [myUid]: myName, [otherUid]: otherName },
      createdBy: myUid,
      lastAt: serverTimestamp(),
      lastText: ''
    }, { merge: true });
    return { id: convId, type: 'dm', participants: sorted, names: { [myUid]: myName, [otherUid]: otherName }, lastAt: Date.now(), lastText: '', createdBy: myUid };
  } catch (err) {
    console.error('[openDm] failed', err);
    return null;
  }
}

/** Create a group conversation. Returns the conversation or null. */
export async function createGroup(title: string, members: Array<{ uid: string; name: string }>): Promise<Conversation | null> {
  const myName = currentName();
  if (!myUid || !myName) return null;
  const clean = title.trim().slice(0, 40);
  if (!clean) return null;
  const unique = members.filter((m) => m.uid && m.uid !== myUid);
  if (unique.length < 1) return null;
  const people = [...unique.slice(0, GROUP_MAX - 1)];
  const participants = [...people.map((p) => p.uid), myUid];
  const names: Record<string, string> = { [myUid]: myName };
  for (const p of people) names[p.uid] = p.name.slice(0, NAME_LIMIT);
  const firestore = await initFirestore();
  if (!firestore) return null;
  const convId = `grp_${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.floor(Math.random() * 1e6)}`}`;
  try {
    const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
    await setDoc(doc(firestore, convDoc(convId)), {
      type: 'group',
      title: clean,
      participants,
      names,
      createdBy: myUid,
      lastAt: serverTimestamp(),
      lastText: ''
    });
    return { id: convId, type: 'group', participants, names, title: clean, lastAt: Date.now(), lastText: '', createdBy: myUid };
  } catch {
    return null;
  }
}

/** Send a message inside a conversation. */
export async function sendConversationMessage(convId: string, name: string, text: string): Promise<boolean> {
  const clean = text.trim().slice(0, MSG_LIMIT);
  const who = name.trim().slice(0, NAME_LIMIT);
  if (!clean || !who || !myUid) return false;
  const firestore = await initFirestore();
  if (!firestore) return false;
  try {
    const { collection, addDoc, serverTimestamp, updateDoc, doc } = await import('firebase/firestore');
    await addDoc(collection(firestore, convPath(convId)), {
      name: who,
      text: clean,
      ts: serverTimestamp(),
      senderId: myUid
    });
    // Touch the conversation header so the Chats list reorders + previews.
    await updateDoc(doc(firestore, convDoc(convId)), {
      lastAt: serverTimestamp(),
      lastText: clean,
      [`names.${myUid}`]: who
    });
    return true;
  } catch {
    return false;
  }
}

/** Display name from the greeting store, or the name we last used in chat. */
function currentName(): string | null {
  try {
    const v = localStorage.getItem('eotr2026.name.v1');
    if (v && v.trim()) return v.trim();
  } catch {
    /* ignore */
  }
  return null;
}

/** People we know about (from the wall + conversations), for the picker.
 *  Dedupes by display name (case-insensitive), keeping the most recently seen
 *  identity — each anonymous device has a unique uid, so the same name would
 *  otherwise appear once per device. */
export function knownPeople(): Array<{ uid: string; name: string }> {
  const map = new Map<string, { uid: string; name: string }>();
  const seen = new Map<string, number>(); // lower-name -> wall position (higher = newer)
  let pos = 0;
  for (const m of messages) {
    pos++;
    if (m.senderId && m.senderId !== myUid) {
      const key = m.name.toLowerCase();
      if (!seen.has(key) || seen.get(key)! < pos) {
        seen.set(key, pos);
        map.set(key, { uid: m.senderId, name: m.name });
      }
    }
  }
  for (const c of convs) {
    for (const uid of c.participants) {
      if (uid !== myUid && c.names[uid]) {
        const name = c.names[uid];
        const key = name.toLowerCase();
        map.set(key, { uid, name });
      }
    }
  }
  return [...map.values()];
}

/** Title for a conversation from the viewer's perspective. */
export function conversationTitle(c: Conversation): string {
  if (c.type === 'group') return c.title || `Group · ${c.participants.length}`;
  const other = c.participants.find((p) => p !== myUid);
  return other && c.names[other] ? c.names[other] : 'Conversation';
}

// ====================================================================
// Unread tracking (wall + conversations) for the nav badge
// ====================================================================

export function markChatSeen() {
  try {
    localStorage.setItem(SEEN_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
  emitUnread();
}

export function markConversationSeen(convId: string) {
  try {
    const c = convs.find((x) => x.id === convId);
    if (c) localStorage.setItem(CONV_SEEN_PREFIX + convId, String(c.lastAt));
  } catch {
    /* ignore */
  }
  emitUnread();
}

function seenTs(): number {
  try {
    const v = Number(localStorage.getItem(SEEN_KEY));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

function convSeenTs(convId: string): number {
  try {
    const v = Number(localStorage.getItem(CONV_SEEN_PREFIX + convId));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

/** 0 or 1 for the wall (any unseen message), plus one per unseen conversation. */
export function unreadTotal(): number {
  const max = messages.reduce((m, x) => (x.ts > m ? x.ts : m), 0);
  let n = max > seenTs() ? 1 : 0;
  for (const c of convs) {
    if (c.lastAt > convSeenTs(c.id)) n += 1;
  }
  return n;
}

/** Kept for compatibility — the old wall-only count. */
export function unreadCount(): number {
  const max = messages.reduce((m, x) => (x.ts > m ? x.ts : m), 0);
  return max > seenTs() ? 1 : 0;
}

export function onUnread(fn: (n: number) => void): () => void {
  unreadListeners.add(fn);
  fn(unreadTotal());
  return () => {
    unreadListeners.delete(fn);
  };
}

// ====================================================================
// Sound (Web Audio, no asset files)
// ====================================================================

let audioCtx: AudioContext | null = null;

/** Unlock audio on the first user gesture (autoplay policies). */
export function unlockAudio() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') void audioCtx.resume().catch(() => {});
  } catch {
    /* audio unavailable */
  }
}

/** Synthesise a soft bell tone (fundamental + warm partials, exponential decay). */
function bellNote(ctx: AudioContext, freq: number, t: number, dur: number, vol: number) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  gain.connect(ctx.destination);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = Math.min(freq * 4, 12000);
  filter.connect(gain);
  const partials: Array<[number, number]> = [
    [1, 1],
    [2, 0.32],
    [2.76, 0.13]
  ];
  for (const [ratio, _level] of partials) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq * ratio;
    osc.connect(filter);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
}

/** A warm "ding-bong" for incoming messages. Silently no-ops if audio is locked. */
export function playChatSound() {
  try {
    if (!audioCtx || audioCtx.state !== 'running') return;
    const t0 = audioCtx.currentTime + 0.01;
    bellNote(audioCtx, 988, t0, 0.6, 0.26); // ding (B5)
    bellNote(audioCtx, 659, t0 + 0.18, 0.8, 0.2); // bong (E5)
  } catch {
    /* sound unavailable — badge still shows */
  }
}
