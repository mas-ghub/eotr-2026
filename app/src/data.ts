import type { Act, Artist, FestivalMeta } from './types';

export interface FestivalData {
  meta: FestivalMeta;
  acts: Act[];
  artists: Artist[];
}

let cache: FestivalData | null = null;

async function loadJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return (await res.json()) as T;
}

export async function loadData(): Promise<FestivalData> {
  if (cache) return cache;
  const [meta, acts, artists] = await Promise.all([
    loadJson<FestivalMeta>('./data/meta.json'),
    loadJson<Act[]>('./data/acts.json'),
    loadJson<Artist[]>('./data/artists.json')
  ]);
  cache = { meta, acts, artists };
  return cache;
}

const stageColors: Record<string, string> = {
  Woods: '#2f6b4f',
  Garden: '#d9b23c',
  'Big Top': '#e8602f',
  'The Folly': '#ef6f8e',
  Boat: '#3a7d83',
  Cinema: '#7c5cbf',
  'Talking Heads': '#8a5a2b',
  'Cider Bus Tent': '#789600'
};

export function stageColor(name: string): string {
  return stageColors[name] || '#2f6b4f';
}

export function timeOfDay(ms: number): number {
  return (ms % 86400000) / 60000;
}

/** Absolute epoch ms for a set, from its day + startMs-as-time-of-day. The data
 *  stores startMs as ms since midnight (UK time), so combine it with the day key
 *  (festival is in BST in September). Falls back to startMs if the parse fails. */
export function festivalStartMs(act: { dayKey: string; startMs: number }): number {
  try {
    const dayMin = (act.startMs % 86400000) / 60000;
    const hh = String(Math.floor(dayMin / 60)).padStart(2, '0');
    const mm = String(Math.floor(dayMin % 60)).padStart(2, '0');
    const ms = new Date(`${act.dayKey}T${hh}:${mm}:00+01:00`).getTime();
    return Number.isFinite(ms) ? ms : act.startMs;
  } catch {
    return act.startMs;
  }
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}
