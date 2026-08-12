import { loadData, festivalStartMs } from '../data';
import { navigate } from '../router';
import { h, icon } from '../ui';
import { schedule } from '../store';
import { weatherStrip } from '../weather';
import { scheduleButton, reminderControl } from './common';
import {
  favoritesSync,
  syncLabel,
  onSharedFavorites,
  onFavoritesSync,
  sharedFavorites,
  type FavoritesSync
} from '../favorites';
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

  const weatherEl = weatherStrip(meta.days);
  root.appendChild(weatherEl);

  const favStatus = h('p', { class: 'fav-status' });
  root.insertBefore(favStatus, weatherEl);

  const body = h('div', { class: 'myday-body' });
  root.appendChild(body);

  const nextUp = h('div', { class: 'myday-nextup' });
  root.insertBefore(nextUp, body);

  // ---- Shared-picks status pill + "Who's going where" ----
  const actById = new Map(acts.map((a) => [a.id, a]));

  const paintFavStatus = (s: FavoritesSync) => {
    const label = syncLabel();
    if (!label) {
      favStatus.textContent = '';
      favStatus.classList.remove('show');
      return;
    }
    favStatus.textContent = label;
    favStatus.classList.toggle('show', true);
    favStatus.classList.toggle('synced', s === 'synced');
    favStatus.classList.toggle('offline', s === 'offline');
    favStatus.classList.toggle('name-needed', s === 'name-needed');
    favStatus.classList.toggle('error', s === 'error');
  };

  const favSection = h(
    'section',
    { class: 'fav' },
    h(
      'header',
      { class: 'fav__head' },
      h('h3', { class: 'fav__title', html: `${icon('heart', 15)} Who’s going where` }),
      h('p', { class: 'fav__sub' }, 'Everyone’s My Day picks — shared live from their phones while they’re online.')
    ),
    h('div', { class: 'fav__list' })
  );

  const paintFavs = () => {
    const st = favoritesSync();
    favSection.classList.toggle('hidden', st === 'off');
    if (st === 'off') return;
    const listEl = favSection.querySelector('.fav__list')!;
    const list = sharedFavorites();
    listEl.innerHTML = '';
    if (!list.length) {
      listEl.appendChild(
        h(
          'p',
          { class: 'fav__empty' },
          st === 'offline'
            ? 'Offline — picks will appear here when you’re back online.'
            : 'No one else is sharing picks yet — save some sets and they’ll show up here.'
        )
      );
      return;
    }
    for (const p of list) {
      const chips = p.actIds.slice(0, 6).map((id) => {
        const act = actById.get(id);
        return act
          ? h(
              'button',
              { class: 'fav-chip', type: 'button', onclick: () => act.artistSlug && navigate(`#/artist/${act.artistSlug}`) },
              `${act.name} · ${act.stage}`
            )
          : h('span', { class: 'fav-chip fav-chip--stale' }, '—');
      });
      if (p.actIds.length > 6) chips.push(h('span', { class: 'fav-chip fav-chip--more' }, `+${p.actIds.length - 6} more`));
      listEl.appendChild(
        h(
          'div',
          { class: 'fav-person' },
          h('span', { class: 'fav-person__avatar' }, p.name.charAt(0).toUpperCase()),
          h(
            'div',
            { class: 'fav-person__main' },
            h('p', { class: 'fav-person__name' }, p.name),
            h('p', { class: 'fav-person__count' }, `${p.actIds.length} set${p.actIds.length === 1 ? '' : 's'}`)
          ),
          h('div', { class: 'fav-person__chips' }, ...chips)
        )
      );
    }
  };

  const unFavList = onSharedFavorites(() => paintFavs());
  const unFavSync = onFavoritesSync((s) => {
    paintFavStatus(s);
    paintFavs();
  });
  onViewCleanup(() => {
    unFavList();
    unFavSync();
  });
  paintFavStatus(favoritesSync());
  root.appendChild(favSection);

  const paintNextUp = () => {
    const now = Date.now();
    const upcoming = [...schedule.resolved(acts).values()]
      .flat()
      .filter((a: Act) => festivalStartMs(a) > now)
      .sort((a: Act, b: Act) => festivalStartMs(a) - festivalStartMs(b))[0];
    if (!upcoming) {
      nextUp.innerHTML = '';
      return;
    }
    const mins = Math.max(0, Math.round((festivalStartMs(upcoming) - now) / 60000));
    const hh = Math.floor(mins / 60);
    const mm = mins % 60;
    const when = hh > 0 ? `${hh}h ${mm}m` : `${mm}m`;
    nextUp.innerHTML = '';
    nextUp.appendChild(
      h(
        'button',
        { class: 'myday-nextup__btn', type: 'button', onclick: () => upcoming.artistSlug && navigate(`#/artist/${upcoming.artistSlug}`) },
        h('span', { class: 'myday-nextup__label', html: `${icon('clock', 14)} Next up` }),
        h('span', { class: 'myday-nextup__name' }, upcoming.name),
        h('span', { class: 'myday-nextup__meta' }, `${upcoming.stage} · in ${when}`)
      )
    );
  };
  paintNextUp();
  const nextTimer = setInterval(paintNextUp, 30000);
  onViewCleanup(() => clearInterval(nextTimer));

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
          h(
            'div',
            { class: 'myday-row__actions' },
            reminderControl(act),
            scheduleButton(act, render),
            h('button', { class: 'icon-btn remove', type: 'button', 'aria-label': `Remove ${act.name}`, html: icon('trash', 17) })
          )
        );
        row.addEventListener('click', (e) => {
          const target = e.target as HTMLElement;
          if (target.closest('.remove') || target.closest('.sch-btn') || target.closest('.myday-row__actions')) return;
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
    paintNextUp();
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
