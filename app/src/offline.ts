// Offline audio download manager.
//
// Downloads every bundled preview clip into a dedicated cache (CLIPS_CACHE,
// the same one the service worker serves clips from), surfacing live progress
// so the user always knows what is happening. 114 MB of audio is NOT precached
// by the service worker anymore — it is downloaded here, visibly, and the app
// is only "offline ready" once this completes.

export type OfflineState = 'idle' | 'downloading' | 'ready' | 'partial' | 'error';

export interface OfflineStatus {
  state: OfflineState;
  done: number;
  total: number;
  bytes: number;
  error: string | null;
}

const CLIPS_CACHE = 'eotr2026-clips'; // must match sw.js
const CONCURRENCY = 4;

type OfflineListener = (status: OfflineStatus) => void;

export function clipCacheKey(local: string): string {
  return new URL(local, location.href).href;
}

async function openClipsCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null;
  try {
    return await caches.open(CLIPS_CACHE);
  } catch {
    return null;
  }
}

async function loadManifest(): Promise<string[]> {
  const res = await fetch('./data/previews-manifest.json');
  if (!res.ok) throw new Error('Could not load the clip manifest.');
  const list = await res.json();
  return Array.isArray(list) ? (list as string[]) : [];
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

class OfflineManager {
  status: OfflineStatus = { state: 'idle', done: 0, total: 0, bytes: 0, error: null };
  private listeners = new Set<OfflineListener>();
  private running = false;

  subscribe(fn: OfflineListener): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<OfflineStatus>) {
    this.status = { ...this.status, ...patch };
    this.listeners.forEach((fn) => fn(this.status));
  }

  /** Count how many clips are already cached; set the idle/ready baseline. */
  async init(): Promise<void> {
    let manifest: string[];
    try {
      manifest = await loadManifest();
    } catch {
      return;
    }
    const cache = await openClipsCache();
    let done = 0;
    if (cache) {
      for (const local of manifest) {
        if (await cache.match(clipCacheKey(local))) done++;
      }
    }
    this.set({ total: manifest.length, done, bytes: 0, error: null });
    if (done >= manifest.length && manifest.length > 0) {
      this.set({ state: 'ready' });
    } else {
      this.set({ state: 'idle' });
    }
  }

  /** Download any clips that are not cached yet, with progress. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const manifest = await loadManifest();
      const cache = await openClipsCache();
      if (!cache) {
        this.set({ state: 'error', error: 'Offline storage is not available in this browser.' });
        return;
      }
      this.set({ state: 'downloading', total: manifest.length, error: null });

      let done = 0;
      let bytes = 0;
      let failures = 0;
      let index = 0;

      const worker = async () => {
        while (index < manifest.length) {
          const local = manifest[index++];
          const key = clipCacheKey(local);
          try {
            if (await cache.match(key)) {
              done++;
              this.set({ done, bytes });
              continue;
            }
            const res = await fetch(key);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const len = Number(res.headers.get('content-length') || 0);
            await cache.put(key, res);
            done++;
            bytes += len;
            this.set({ done, bytes });
          } catch {
            failures++;
            done++;
            this.set({ done, bytes });
          }
        }
      };

      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, manifest.length) }, () => worker()));

      if (failures > 0) {
        this.set({
          state: 'partial',
          error: `${failures} clip${failures === 1 ? '' : 's'} could not be saved (likely storage space).`
        });
      } else {
        this.set({ state: 'ready', done: manifest.length, error: null });
      }
    } catch (err) {
      this.set({ state: 'error', error: (err as Error).message });
    } finally {
      this.running = false;
    }
  }
}

export const offline = new OfflineManager();
export { fmtBytes };
