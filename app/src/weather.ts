// Weather for the festival days (Larmer Tree Gardens).
//
// Offline-first: the last fetched forecast is kept in localStorage so the strip
// still works with no signal. Uses the free Open-Meteo API (no key needed).
// NOTHING here ever throws — a failure just leaves the strip empty, so a
// weather outage can never break the app. Live forecast is used when the
// festival dates are inside the forecast window (~16 days); otherwise the
// long-term climate average for the exact dates is shown (labelled "typical").
import { h, icon } from './ui';
import type { Day } from './types';

export interface WeatherDay {
  date: string; // yyyy-mm-dd
  short: string; // Thu
  label: string; // Thursday 3rd
  iconName: string; // ui icon name
  high: number | null;
  low: number | null;
  rain: number | null;
  source: 'live' | 'typical';
}

const LAT = 50.968;
const LON = -2.083;
const CACHE_KEY = 'eotr2026.weather.v1';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface Cached {
  ts: number;
  days: WeatherDay[];
}

function loadCache(): Cached | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Cached;
    if (!c || !Array.isArray(c.days)) return null;
    return c;
  } catch {
    return null;
  }
}

function saveCache(days: WeatherDay[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), days }));
  } catch {
    /* storage unavailable/full — fine, strip just re-fetches next time */
  }
}

/** WMO weather-code → icon name (see ui.ts). */
function wmoIcon(code: number): string {
  if (code === 0) return 'sun';
  if (code === 1 || code === 2) return 'sunCloud';
  if (code === 3) return 'cloud';
  if (code >= 45 && code <= 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code >= 61 && code <= 67) return 'rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'rain';
  if (code >= 85 && code <= 86) return 'snow';
  if (code >= 95 && code <= 99) return 'thunder';
  return 'sunCloud';
}

async function fetchLive(dates: string[]): Promise<WeatherDay[] | null> {
  const qs = new URLSearchParams({
    latitude: String(LAT),
    longitude: String(LON),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'Europe/London'
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${qs}`);
  if (!res.ok) return null;
  const j = await res.json();
  const daily = j.daily;
  if (!daily || !Array.isArray(daily.time)) return null;
  const byDate = new Map<string, { code: number; high: number | null; low: number | null; rain: number | null }>();
  for (let i = 0; i < daily.time.length; i++) {
    byDate.set(daily.time[i], {
      code: daily.weather_code?.[i] ?? 0,
      high: daily.temperature_2m_max?.[i] ?? null,
      low: daily.temperature_2m_min?.[i] ?? null,
      rain: daily.precipitation_probability_max?.[i] ?? null
    });
  }
  const out: WeatherDay[] = [];
  for (const d of dates) {
    const hit = byDate.get(d);
    // Any date missing = outside the live forecast window → fall back to climate.
    if (!hit) return null;
    out.push({ date: d, short: '', label: '', iconName: wmoIcon(hit.code), high: hit.high, low: hit.low, rain: hit.rain, source: 'live' });
  }
  return out;
}

async function fetchClimate(dates: string[]): Promise<WeatherDay[] | null> {
  const qs = new URLSearchParams({
    latitude: String(LAT),
    longitude: String(LON),
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
    start_date: dates[0],
    end_date: dates[dates.length - 1],
    models: 'EC_Earth3P_HR'
  });
  const res = await fetch(`https://climate-api.open-meteo.com/v1/climate?${qs}`);
  if (!res.ok) return null;
  const j = await res.json();
  const daily = j.daily;
  if (!daily || !Array.isArray(daily.time)) return null;
  const byDate = new Map<string, { high: number | null; low: number | null }>();
  for (let i = 0; i < daily.time.length; i++) {
    byDate.set(daily.time[i], {
      high: daily.temperature_2m_max?.[i] ?? null,
      low: daily.temperature_2m_min?.[i] ?? null
    });
  }
  const out: WeatherDay[] = [];
  for (const d of dates) {
    const hit = byDate.get(d);
    out.push({
      date: d,
      short: '',
      label: '',
      iconName: 'sunCloud', // typical autumn conditions
      high: hit?.high ?? null,
      low: hit?.low ?? null,
      rain: null,
      source: 'typical'
    });
  }
  return out;
}

function attach(days: Day[], data: WeatherDay[]): WeatherDay[] {
  return data.map((w, i) => ({ ...w, short: days[i]?.short || '', label: days[i]?.label || '' }));
}

/**
 * Best-effort weather for the festival days. Returns cached data instantly,
 * refreshes live in the background, and never rejects or throws.
 */
export async function getFestivalWeather(days: Day[]): Promise<WeatherDay[]> {
  const dates = days.map((d) => d.key);
  const cached = loadCache();
  const now = Date.now();
  if (cached && now - cached.ts < CACHE_TTL_MS && cached.days.length === dates.length) {
    return attach(days, cached.days);
  }
  // Try to refresh online (only when connected); keep serving cache on failure.
  if (typeof navigator === 'undefined' || navigator.onLine) {
    try {
      const live = await fetchLive(dates);
      const result = live || (await fetchClimate(dates));
      if (result && result.length === dates.length) {
        saveCache(result);
        return attach(days, result);
      }
    } catch {
      /* ignore — fall through to cache/empty */
    }
  }
  if (cached && cached.days.length === dates.length) return attach(days, cached.days);
  return [];
}

function fmt(v: number | null): string {
  return v == null ? '–' : String(Math.round(v));
}

/**
 * Self-populating weather strip. Renders from cache immediately if present,
 * updates when fresh data arrives, and stays empty (harmlessly) on failure.
 */
export function weatherStrip(days: Day[]): HTMLElement {
  const note = h('span', { class: 'weather-strip__note' }, '…');
  const head = h(
    'div',
    { class: 'weather-strip__head' },
    h('span', { class: 'weather-strip__title' }, 'Weather at Larmer Tree'),
    note
  );
  const daysEl = h('div', { class: 'weather-strip__days' });
  const wrap = h('div', { class: 'weather-strip' }, head, daysEl);

  const render = (list: WeatherDay[]) => {
    daysEl.innerHTML = '';
    for (const d of list) {
      daysEl.appendChild(
        h(
          'div',
          { class: 'weather-day' },
          h('span', { class: 'weather-day__short' }, d.short),
          h('span', { class: 'weather-day__icon', html: icon(d.iconName, 22) }),
          h('span', { class: 'weather-day__temp' }, `${fmt(d.high)}° / ${fmt(d.low)}°`),
          d.rain != null ? h('span', { class: 'weather-day__rain', html: `${icon('droplet', 11)} ${d.rain}%` }) : null
        )
      );
    }
    note.textContent = list.some((x) => x.source === 'live') ? 'live forecast' : 'typical conditions';
  };

  const cached = loadCache();
  if (cached && cached.days.length === days.length) render(attach(days, cached.days));
  void getFestivalWeather(days).then((list) => {
    if (list.length) render(list);
  }).catch(() => {
    /* never surface errors */
  });
  return wrap;
}
