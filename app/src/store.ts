import type { Act } from './types';

const STORAGE_KEY = 'eotr2026.schedule.v1';

type Listener = () => void;

class ScheduleStore {
  private ids: string[] = [];
  private listeners = new Set<Listener>();

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) this.ids = JSON.parse(raw);
    } catch {
      this.ids = [];
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.ids));
    } catch {
      /* storage unavailable */
    }
    this.listeners.forEach((fn) => fn());
  }

  toggle(actId: string) {
    const i = this.ids.indexOf(actId);
    if (i >= 0) this.ids.splice(i, 1);
    else this.ids.push(actId);
    this.emit();
  }

  add(actId: string) {
    if (!this.ids.includes(actId)) {
      this.ids.push(actId);
      this.emit();
    }
  }

  remove(actId: string) {
    const i = this.ids.indexOf(actId);
    if (i >= 0) {
      this.ids.splice(i, 1);
      this.emit();
    }
  }

  clear() {
    this.ids = [];
    this.emit();
  }

  has(actId: string): boolean {
    return this.ids.includes(actId);
  }

  all(): string[] {
    return [...this.ids];
  }

  /** Resolve saved ids into their acts, time-sorted per day. */
  resolved(acts: Act[]): Map<string, Act[]> {
    const byAct = new Map(acts.map((a) => [a.id, a]));
    const grouped = new Map<string, Act[]>();
    for (const id of this.ids) {
      const act = byAct.get(id);
      if (!act || act.placeholder) continue;
      const list = grouped.get(act.dayKey) || [];
      list.push(act);
      grouped.set(act.dayKey, list);
    }
    for (const list of grouped.values()) list.sort((a, b) => a.startMs - b.startMs);
    return grouped;
  }
}

export const schedule = new ScheduleStore();
