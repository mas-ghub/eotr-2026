import type { FirebaseApp } from 'firebase/app';
import type { Firestore } from 'firebase/firestore';

export interface ChatMessage {
  id: string;
  name: string;
  text: string;
  ts: number; // epoch millis
}

export type ChatStatus =
  | { state: 'not-configured' }
  | { state: 'connecting' }
  | { state: 'online'; count: number }
  | { state: 'offline' }
  | { state: 'error'; message: string };

const MAX_MESSAGES = 50;
const SEEN_KEY = 'eotr2026.chat.seen.v1';
const MSG_LIMIT = 280;
const NAME_LIMIT = 24;

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

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let unsub: (() => void) | null = null;
let started = false;
let messages: ChatMessage[] = [];
let online = navigator.onLine;

const msgListeners = new Set<(msgs: ChatMessage[]) => void>();
const statusListeners = new Set<(s: ChatStatus) => void>();
const unreadListeners = new Set<(n: number) => void>();

let lastStatus: ChatStatus = chatConfig() ? { state: online ? 'connecting' : 'offline' } : { state: 'not-configured' };

function emitMessages() {
  msgListeners.forEach((fn) => fn([...messages]));
}
function setStatus(s: ChatStatus) {
  lastStatus = s;
  statusListeners.forEach((fn) => fn(s));
}
function emitUnread() {
  unreadListeners.forEach((fn) => fn(unreadCount()));
}

async function initFirestore(): Promise<Firestore | null> {
  if (db) return db;
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
}

function toMillis(v: unknown): number {
  if (v && typeof v === 'object' && typeof (v as { toMillis?: unknown }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  return Date.now();
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
  try {
    const { collection, query, orderBy, limitToLast, onSnapshot } = await import('firebase/firestore');
    const q = query(collection(firestore, 'messages'), orderBy('ts', 'asc'), limitToLast(MAX_MESSAGES));
    unsub = onSnapshot(
      q,
      (snap) => {
        messages = snap.docs.map((d) => {
          const data = d.data() as { name?: unknown; text?: unknown; ts?: unknown };
          return {
            id: d.id,
            name: typeof data.name === 'string' ? data.name : '?',
            text: typeof data.text === 'string' ? data.text : '',
            ts: toMillis(data.ts)
          };
        });
        setStatus({ state: 'online', count: messages.length });
        emitMessages();
        emitUnread();
      },
      (err) => setStatus({ state: 'error', message: err.message || 'Could not load messages' })
    );
  } catch (err) {
    setStatus({ state: 'error', message: err instanceof Error ? err.message : 'Could not load messages' });
  }
}

/** Kick off the chat connection. Safe to call repeatedly; idempotent. */
export function chatStart() {
  void start();
}

/** Stop listening (e.g. when leaving the chat view) but keep the connection. */
export function chatStop() {
  if (unsub) {
    unsub();
    unsub = null;
  }
}

export function chatMessages(): ChatMessage[] {
  return [...messages];
}

export function chatStatus(): ChatStatus {
  return lastStatus;
}

export function isConfigured(): boolean {
  return chatConfig() !== null;
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

/** Post a message. Returns false if chat isn't configured or the text is invalid. */
export async function sendMessage(name: string, text: string): Promise<boolean> {
  const clean = text.trim().slice(0, MSG_LIMIT);
  const who = name.trim().slice(0, NAME_LIMIT);
  if (!clean || !who) return false;
  const firestore = await initFirestore();
  if (!firestore) return false;
  try {
    const { collection, addDoc, serverTimestamp } = await import('firebase/firestore');
    await addDoc(collection(firestore, 'messages'), { name: who, text: clean, ts: serverTimestamp() });
    return true;
  } catch {
    return false;
  }
}

// ---- unread tracking (badge) ----

export function markChatSeen() {
  try {
    localStorage.setItem(SEEN_KEY, String(Date.now()));
  } catch {
    /* storage unavailable */
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

export function unreadCount(): number {
  const max = messages.reduce((m, x) => (x.ts > m ? x.ts : m), 0);
  return max > seenTs() ? 1 : 0;
}

export function onUnread(fn: (n: number) => void): () => void {
  unreadListeners.add(fn);
  fn(unreadCount());
  return () => {
    unreadListeners.delete(fn);
  };
}

// ---- sound (Web Audio, no asset file needed) ----

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

/** A friendly two-note "pop" for incoming messages. Silently no-ops if locked. */
export function playChatSound() {
  try {
    if (!audioCtx || audioCtx.state !== 'running') return;
    const t0 = audioCtx.currentTime + 0.01;
    const notes = [659.25, 987.77];
    notes.forEach((freq, i) => {
      const osc = audioCtx!.createOscillator();
      const gain = audioCtx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = t0 + i * 0.09;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.22, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
      osc.connect(gain);
      gain.connect(audioCtx!.destination);
      osc.start(t);
      osc.stop(t + 0.42);
    });
  } catch {
    /* sound unavailable — badge still shows */
  }
}
