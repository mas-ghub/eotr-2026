import { parse } from 'node-html-parser';
import { fetchText } from './lib/http.mjs';

export const CLASHFINDER_URL = 'https://clashfinder.com/s/eotr2026/';

const DAYS = [
  { key: '2026-09-03', label: 'Thursday 3rd September', short: 'Thu' },
  { key: '2026-09-04', label: 'Friday 4th September', short: 'Fri' },
  { key: '2026-09-05', label: 'Saturday 5th September', short: 'Sat' },
  { key: '2026-09-06', label: 'Sunday 6th September', short: 'Sun' }
];

function formatTime(ms) {
  // data-start/data-end are milliseconds since the festival's opening midnight;
  // reduce to the current day's time of day.
  const totalMin = Math.round((ms % 86400000) / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Scrape the EOTR 2026 clashfinder HTML. Returns:
 * {
 *   stages: string[],
 *   days: [{ key, label, short, acts: [{ name, stage, startMs, endMs, start, end, mbid, short }] }]
 * }
 */
export async function scrapeClashfinder() {
  const html = await fetchText(CLASHFINDER_URL, { delay: 0 });
  const root = parse(html);

  const dayEls = root.querySelectorAll('div.day');
  const stageSet = new Set();
  const days = [];

  dayEls.forEach((dayEl, idx) => {
    const dayInfo = DAYS[idx] || {
      key: String(idx),
      label: dayEl.querySelector('span.headingDayName')?.text?.trim() || `Day ${idx + 1}`,
      short: `Day ${idx + 1}`
    };
    const acts = [];
    dayEl.querySelectorAll('div.stageContainer').forEach((stageEl) => {
      const stageName = stageEl.querySelector('p.stageName')?.text?.trim() || 'Stage';
      if (stageName) stageSet.add(stageName);
      stageEl.querySelectorAll('div.act').forEach((actEl) => {
        const name = actEl.querySelector('h6.actNm')?.text?.trim() || '';
        const startMs = Number(actEl.getAttribute('data-start')) || 0;
        const endMs = Number(actEl.getAttribute('data-end')) || 0;
        const mbid = actEl.getAttribute('data-mbid') || null;
        const short = actEl.getAttribute('data-short') || null;
        if (!name) return;
        acts.push({
          name,
          stage: stageName,
          startMs,
          endMs,
          start: formatTime(startMs),
          end: formatTime(endMs),
          mbid,
          short
        });
      });
    });
    acts.sort((a, b) => a.startMs - b.startMs);
    days.push({ key: dayInfo.key, label: dayInfo.label, short: dayInfo.short, acts });
  });

  return { stages: [...stageSet], days };
}
