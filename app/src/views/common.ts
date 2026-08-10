import type { Act, ActType } from '../types';
import { schedule } from '../store';
import { h, icon } from '../ui';

export const TYPE_LABEL: Record<ActType, string> = {
  music: 'Music',
  comedy: 'Comedy',
  literature: 'Literature',
  cinema: 'Cinema',
  dj: 'DJ / Late',
  other: 'Other'
};

export const TYPE_ICON: Record<ActType, string> = {
  music: 'note',
  comedy: 'mic',
  literature: 'book',
  cinema: 'film',
  dj: 'disc',
  other: 'stage'
};

export function typeBadge(type: ActType): HTMLElement {
  return h('span', { class: `type-badge type-${type}` }, h('span', { html: icon(TYPE_ICON[type], 13) }), TYPE_LABEL[type]);
}

export function dayShort(dayKey: string): string {
  return new Date(`${dayKey}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
}

export function actLabel(act: Act): string {
  return `${dayShort(act.dayKey)} · ${act.stage} · ${act.start}`;
}

/**
 * Heart toggle that stays in sync with the schedule store.
 * The `onChanged` callback lets a parent re-render when a set is added/removed.
 */
export function scheduleButton(act: Act, onChanged?: () => void): HTMLElement {
  const btn = h(
    'button',
    {
      class: 'sch-btn' + (schedule.has(act.id) ? ' on' : ''),
      type: 'button',
      'aria-label': schedule.has(act.id) ? `Remove ${act.name} from My Day` : `Add ${act.name} to My Day`,
      'aria-pressed': schedule.has(act.id)
    },
    h('span', { class: 'sch-btn__icon', html: schedule.has(act.id) ? icon('heartFill', 18) : icon('heart', 18) })
  );
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    schedule.toggle(act.id);
    btn.classList.toggle('on', schedule.has(act.id));
    btn.setAttribute('aria-pressed', String(schedule.has(act.id)));
    btn.setAttribute('aria-label', schedule.has(act.id) ? `Remove ${act.name} from My Day` : `Add ${act.name} to My Day`);
    btn.querySelector('.sch-btn__icon')!.innerHTML = schedule.has(act.id) ? icon('heartFill', 18) : icon('heart', 18);
    onChanged?.();
  });
  return btn;
}
