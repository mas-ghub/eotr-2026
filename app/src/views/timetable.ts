import { loadData, stageColor } from '../data';
import { navigate } from '../router';
import { h, sheet, icon } from '../ui';
import { schedule } from '../store';
import { scheduleButton } from './common';
import { weatherStrip } from '../weather';
import { onViewCleanup } from '../lifecycle';
import type { Act } from '../types';

const RANGE_START = 9 * 60; // 09:00
const RANGE_END = 27 * 60; // 03:00 next morning
const ROW_H = 56;
const STAGE_W = 118;

function festivalNowMinutes(): { minutes: number; dayKey: string } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(new Date());
    const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
    const day = get('weekday');
    const hh = Number(get('hour'));
    const mm = Number(get('minute'));
    const dayMap: Record<string, string> = { Thu: '2026-09-03', Fri: '2026-09-04', Sat: '2026-09-05', Sun: '2026-09-06' };
    const dayKey = dayMap[day];
    if (!dayKey) return null;
    return { minutes: hh * 60 + mm, dayKey };
  } catch {
    return null;
  }
}

function actStartMin(act: Act): number {
  return (act.startMs % 86400000) / 60000;
}
function actEndMin(act: Act): number {
  return actStartMin(act) + (act.endMs - act.startMs) / 60000;
}

function buildAct(act: Act): HTMLElement {
  const start = actStartMin(act);
  const end = actEndMin(act);
  const left = ((start - RANGE_START) / (RANGE_END - RANGE_START)) * 100;
  const width = ((end - start) / (RANGE_END - RANGE_START)) * 100;
  const saved = schedule.has(act.id);

  const block = h(
    'button',
    {
      class: 'act-block' + (saved ? ' saved' : '') + (act.placeholder ? ' placeholder' : ''),
      type: 'button',
      dataset: { id: act.id },
      style: { left: `${left}%`, width: `calc(${width}% - 3px)` },
      tabindex: 0
    },
    h('span', { class: 'act-block__name' }, act.name),
    h('span', { class: 'act-block__time' }, `${act.start}–${act.end}`)
  );

  block.addEventListener('click', () => {
    if (act.artistSlug) {
      navigate(`#/artist/${act.artistSlug}`);
      return;
    }
    const body = h(
      'div',
      { class: 'act-sheet' },
      h('div', { class: 'act-sheet__time' }, h('span', { html: icon('clock', 15) }), `${act.start} – ${act.end}`),
      h('p', { class: 'act-sheet__stage' }, h('span', { html: icon('stage', 15) }), act.stage),
      h('p', { class: 'act-sheet__note' }, act.placeholder ? 'To be announced.' : 'No artist page available.')
    );
    const footer = act.placeholder
      ? h('p', { class: 'act-sheet__footer-note' }, 'This slot is not added to My Day.')
      : h('div', { class: 'act-sheet__actions' }, scheduleButton(act));
    sheet({ title: act.name, body, footer });
  });

  return block;
}

export async function renderTimetable(): Promise<HTMLElement> {
  const { meta, acts } = await loadData();
  let selected = meta.days[0].key;
  const now = festivalNowMinutes();

  const root = h('div', { class: 'view tt-view' });
  const head = h('header', { class: 'tt-head' }, h('h2', { class: 'tt-title' }, 'Timetable'), h('p', { class: 'tt-sub' }, 'Tap a set for details or to add it to My Day.'));
  root.appendChild(head);

  root.appendChild(weatherStrip(meta.days));

  const tabs = h('nav', { class: 'tt-tabs', role: 'tablist' }, ...meta.days.map((d) => {
    const isToday = now && now.dayKey === d.key;
    return h('button', {
      class: 'tt-tab' + (d.key === selected ? ' active' : ''),
      type: 'button',
      role: 'tab',
      dataset: { day: d.key },
      html: `${d.short}${isToday ? '<span class="live-chip">● Live</span>' : ''}`
    });
  }));
  root.appendChild(tabs);

  const boardHost = h('div', { class: 'tt-boardhost' });
  root.appendChild(boardHost);

  const renderDay = () => {
    const dayActs = acts.filter((a) => a.dayKey === selected);
    const stages = meta.stages;
    boardHost.innerHTML = '';

    const board = h('div', {
      class: 'tt-board',
      style: { height: `${stages.length * ROW_H}px` }
    });

    // hour markers (hh is in MINUTES; the label is the hour of day)
    for (let hh = RANGE_START; hh < RANGE_END; hh += 60) {
      const left = ((hh - RANGE_START) / (RANGE_END - RANGE_START)) * 100;
      board.appendChild(h('div', { class: 'tt-hour', style: { left: `${left}%` } }));
      board.appendChild(
        h('div', { class: 'tt-hour-label', style: { left: `${left}%` } }, `${String(Math.floor(hh / 60) % 24).padStart(2, '0')}:00`)
      );
    }

    stages.forEach((stage, i) => {
      const row = h('div', { class: 'tt-row', style: { top: `${i * ROW_H}px`, height: `${ROW_H}px` } });
      const color = stageColor(stage);
      row.style.setProperty('--stage-color', color);
      for (const act of dayActs.filter((a) => a.stage === stage)) {
        row.appendChild(buildAct(act));
      }
      board.appendChild(row);
    });

    // "now" line
    if (now && now.dayKey === selected) {
      const left = ((now.minutes - RANGE_START) / (RANGE_END - RANGE_START)) * 100;
      if (left >= 0 && left <= 100) {
        board.appendChild(h('div', { class: 'tt-now', style: { left: `${left}%` } }, h('span', { class: 'tt-now__dot' })));
      }
    }

    const scroll = h('div', { class: 'tt-scroll' }, h('div', { class: 'tt-inner', style: { minWidth: `${STAGE_W + 1440 * 0.72}px` } },
      h('div', { class: 'tt-stages-col', style: { width: `${STAGE_W}px` } },
        stages.map((s) => h('div', { class: 'tt-stages-col__cell', style: { height: `${ROW_H}px` } }, s))
      ),
      h('div', { class: 'tt-board-col' }, board)
    ));
    (scroll.querySelector('.tt-inner') as HTMLElement).style.setProperty('--tt-stage-w', `${STAGE_W}px`);
    boardHost.appendChild(scroll);

    const syncSaves = () => {
      boardHost.querySelectorAll('.act-block').forEach((b) => {
        b.classList.toggle('saved', schedule.has((b as HTMLElement).dataset.id!));
      });
    };
    onViewCleanup(schedule.subscribe(syncSaves));
  };

  tabs.querySelectorAll('.tt-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      selected = (tab as HTMLElement).dataset.day!;
      tabs.querySelectorAll('.tt-tab').forEach((t) => t.classList.toggle('active', t === tab));
      renderDay();
    });
  });

  renderDay();
  return root;
}
