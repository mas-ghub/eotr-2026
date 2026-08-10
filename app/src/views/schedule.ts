import { loadData } from '../data';
import { navigate } from '../router';
import { h, icon } from '../ui';
import { schedule } from '../store';
import { weatherStrip } from '../weather';
import { onViewCleanup } from '../lifecycle';
import type { Act } from '../types';

function overlaps(a: Act, b: Act): boolean {
  const as = (a.startMs % 86400000) / 60000;
  const ae = as + (a.endMs - a.startMs) / 60000;
  const bs = (b.startMs % 86400000) / 60000;
  const be = bs + (b.endMs - b.startMs) / 60000;
  return as < be && bs < ae;
}

/** "Gates open in N days · H hrs" in festival-local time. Never throws. */
function festivalCountdown(): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(new Date());
    const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
    const now = new Date(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:00+01:00`);
    const start = new Date('2026-09-03T12:00:00+01:00');
    const diffMs = start.getTime() - now.getTime();
    if (diffMs <= 0) return '';
    const days = Math.floor(diffMs / 86400000);
    const hrs = Math.floor((diffMs % 86400000) / 3600000);
    const mins = Math.floor((diffMs % 3600000) / 60000);
    if (days > 0) return `${days} day${days > 1 ? 's' : ''} · ${hrs} hr${hrs !== 1 ? 's' : ''} until Thursday`;
    if (hrs > 0) return `${hrs} hr${hrs !== 1 ? 's' : ''} · ${mins} min until gates open`;
    return `${mins} min until gates open`;
  } catch {
    return '';
  }
}

export async function renderSchedule(): Promise<HTMLElement> {
  const { meta, acts } = await loadData();
  const root = h('div', { class: 'view myday-view' });

  const head = h(
    'header',
    { class: 'myday-head' },
    h('div', {},
      h('h2', { class: 'myday-title' }, 'My Day'),
      h('p', { class: 'myday-sub' }, 'Your personal timetable'),
      (() => {
        const el = h('p', { class: 'myday-countdown' });
        const update = () => {
          const text = festivalCountdown();
          el.innerHTML = text ? `${icon('clock', 12)} ${text}` : '';
        };
        update();
        const t = setInterval(update, 60000);
        onViewCleanup(() => clearInterval(t));
        return el;
      })()
    ),
    h(
      'div',
      { class: 'myday-actions' },
      h('button', { class: 'btn btn-ghost', type: 'button', html: `${icon('print', 15)} Print` }),
      h('button', { class: 'btn btn-ghost danger', type: 'button', html: `${icon('trash', 15)} Clear` })
    )
  );
  root.appendChild(head);

  root.appendChild(weatherStrip(meta.days));

  const body = h('div', { class: 'myday-body' });
  root.appendChild(body);

  const render = () => {
    const grouped = schedule.resolved(acts);
    body.innerHTML = '';

    if (!schedule.all().length) {
      body.appendChild(
        h(
          'div',
          { class: 'empty' },
          h('div', { class: 'empty__icon', html: icon('heart', 34) }),
          h('h3', {}, 'No sets saved yet'),
          h('p', {}, 'Browse the lineup or timetable and tap the heart to build your own festival plan.'),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => navigate('#/lineup'), html: 'Explore the lineup' })
        )
      );
      return;
    }

    let total = 0;
    for (const day of meta.days) {
      const list = grouped.get(day.key);
      if (!list || !list.length) continue;
      total += list.length;

      const dayBlock = h('section', { class: 'myday-day' });
      dayBlock.appendChild(
        h('header', { class: 'myday-day__head' }, h('h3', { class: 'myday-day__title' }, day.label), h('span', { class: 'myday-day__count' }, `${list.length}`))
      );

      const conflictIds = new Set<string>();
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (overlaps(list[i], list[j])) {
            conflictIds.add(list[i].id);
            conflictIds.add(list[j].id);
          }
        }
      }

      for (const act of list) {
        const clash = conflictIds.has(act.id);
        const row = h(
          'div',
          { class: 'myday-row' + (clash ? ' clash' : ''), role: 'button', tabindex: 0 },
          h('div', { class: 'myday-row__time' }, h('span', { class: 'myday-row__start' }, act.start), h('span', { class: 'myday-row__end' }, act.end)),
          h(
            'div',
            { class: 'myday-row__info' },
            h('p', { class: 'myday-row__name' }, act.name),
            h('p', { class: 'myday-row__meta' }, h('span', { class: 'myday-row__stage' }, act.stage), clash ? h('span', { class: 'clash-tag', html: `${icon('alert', 12)} clashes with another set` }) : null)
          ),
          h('button', { class: 'icon-btn remove', type: 'button', 'aria-label': `Remove ${act.name}`, html: icon('trash', 17) })
        );
        row.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('.remove')) return;
          if (act.artistSlug) navigate(`#/artist/${act.artistSlug}`);
        });
        row.querySelector('.remove')!.addEventListener('click', () => schedule.remove(act.id));
        dayBlock.appendChild(row);
      }
      body.appendChild(dayBlock);
    }

    if (total === 0) {
      body.appendChild(
        h('div', { class: 'empty' }, h('div', { class: 'empty__icon', html: icon('heart', 34) }), h('h3', {}, 'Nothing on this day yet'))
      );
    }
  };

  head.querySelector('.myday-actions button:first-child')!.addEventListener('click', () => navigate('#/print/schedule'));
  head.querySelector('.myday-actions button.danger')!.addEventListener('click', () => {
    if (confirm('Clear all sets from My Day?')) {
      schedule.clear();
      render();
    }
  });

  onViewCleanup(schedule.subscribe(render));
  render();
  return root;
}
