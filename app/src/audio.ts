// Audio preview player + 10-20s clip extractor + offline clip store (IndexedDB).

export type TrackRef = { url: string; local: string | null };

export interface SavedClip {
  id: string;
  slug: string;
  artistName: string;
  track: string;
  seconds: number;
  mime: string;
  size: number;
  createdAt: number;
  blob: Blob;
}

type StateListener = (url: string | null) => void;

class Player {
  private audio: HTMLAudioElement;
  private current: string | null = null;
  private listeners = new Set<StateListener>();

  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'none';
    this.audio.addEventListener('playing', () => this.emit());
    this.audio.addEventListener('pause', () => this.emit());
    this.audio.addEventListener('ended', () => this.emit());
    this.audio.addEventListener('error', () => this.emit());
  }

  subscribe(fn: StateListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Always emit the current state so every button re-syncs (only one can be playing). */
  private emit() {
    const playing = !this.audio.paused && !this.audio.ended && this.current !== null;
    const url = playing ? this.current : null;
    this.current = url;
    this.listeners.forEach((fn) => fn(url));
  }

  isPlaying(url: string): boolean {
    return !this.audio.paused && !this.audio.ended && this.current === url;
  }

  /** Current playhead for a url (0/0 when not playing). */
  progress(url: string): { current: number; duration: number } {
    if (!this.isPlaying(url)) return { current: 0, duration: 0 };
    return { current: this.audio.currentTime || 0, duration: this.audio.duration || 0 };
  }

  /** Subscribe to playback clock ticks (timeupdate / ended / play). */
  subscribeTick(fn: () => void): () => void {
    const h = () => fn();
    this.audio.addEventListener('timeupdate', h);
    this.audio.addEventListener('ended', h);
    this.audio.addEventListener('play', h);
    return () => {
      this.audio.removeEventListener('timeupdate', h);
      this.audio.removeEventListener('ended', h);
      this.audio.removeEventListener('play', h);
    };
  }

  async toggle(track: TrackRef): Promise<void> {
    const url = track.local || track.url;
    if (this.isPlaying(url)) {
      this.audio.pause();
      this.emit();
      return;
    }
    await this.play(url);
  }

  async play(url: string): Promise<void> {
    try {
      if (this.audio.src !== url) {
        // Switching sources fires 'pause' on the old element; announce it first
        // so the previously-playing row stops animating immediately.
        const prev = this.current;
        this.current = null;
        if (prev) this.listeners.forEach((fn) => fn(null));
        this.audio.src = url;
      }
      this.current = url;
      await this.audio.play();
      this.emit();
    } catch {
      this.current = null;
      this.listeners.forEach((fn) => fn(null));
      throw new Error('Playback failed — the preview may be offline or expired.');
    }
  }

  stop() {
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.current = null;
    this.listeners.forEach((fn) => fn(null));
  }
}

export const player = new Player();

// ---------- IndexedDB clip store ----------

const DB_NAME = 'eotr2026';
const DB_VERSION = 1;
const STORE = 'clips';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveClip(clip: SavedClip): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(clip);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listClips(slug?: string): Promise<SavedClip[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const all = (req.result as SavedClip[]).sort((a, b) => b.createdAt - a.createdAt);
      resolve(slug ? all.filter((c) => c.slug === slug) : all);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteClip(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- Clip extraction (10-20s) ----------

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

const canExtract = (() => {
  if (typeof window === 'undefined') return false;
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof AudioContext !== 'undefined' &&
    typeof MediaStreamAudioDestinationNode !== 'undefined'
  );
})();

let ctx: AudioContext | null = null;
function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/**
 * Extract `seconds` of audio starting at `startSec` from a preview, re-encoded
 * via MediaRecorder so it can be saved offline. Throws with a friendly message
 * when the browser or the source does not support it.
 */
export async function extractClip(url: string, seconds: number, startSec = 0): Promise<{ blob: Blob; mime: string }> {
  const mime = pickMimeType();
  if (!mime || !canExtract) {
    throw new Error('This browser cannot record clips. Try a recent Chrome, Edge, Firefox or Safari.');
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not download the preview audio.');
  const arrayBuffer = await res.arrayBuffer();
  const audioCtx = getCtx();
  const decoded = await audioCtx.decodeAudioData(arrayBuffer);

  const total = decoded.duration;
  const offset = Math.min(startSec, Math.max(0, total - seconds));
  const duration = Math.min(seconds, total - offset);

  const dest = audioCtx.createMediaStreamDestination();
  const source = audioCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(dest);
  source.start(0, offset, duration);

  const recorder = new MediaRecorder(dest.stream, { mimeType: mime });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size) chunks.push(e.data);
  };

  const stopPromise = new Promise<{ blob: Blob; mime: string }>((resolve, reject) => {
    recorder.onstop = () => {
      source.stop();
      try {
        source.disconnect();
      } catch {
        /* noop */
      }
      const blob = new Blob(chunks, { type: mime });
      resolve({ blob, mime });
    };
    recorder.onerror = () => reject(new Error('Recording failed.'));
  });

  recorder.start();
  setTimeout(() => {
    if (recorder.state !== 'inactive') recorder.stop();
  }, duration * 1000 + 300);

  return stopPromise;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function clipExtension(mime: string): string {
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}
