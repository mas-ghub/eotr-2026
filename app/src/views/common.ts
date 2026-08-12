import type { Act, ActType } from '../types';
import { schedule } from '../store';
import { h, icon, sheet, toast } from '../ui';
import {
  LEAD_OPTIONS,
  getReminder,
  allReminders,
  removeReminder,
  setReminder,
  sendTestNotification,
  notificationState,
  requestNotificationPermission,
  type LeadOption
} from '../reminders';

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

/**
 * "Remind me" bell. Tapping it opens a sheet to pick a lead time (at showtime /
 * 15/30/60 min before) or clear an active reminder. Self-contained: reads the
 * latest state from localStorage each time, so it needs no subscriptions.
 */
export function reminderControl(act: Act): HTMLElement {
  const refresh = (btn: HTMLButtonElement) => {
    const rem = getReminder(act.id);
    const on = !!rem;
    btn.classList.toggle('rem-on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.querySelector('.sch-btn__icon')!.innerHTML = on ? icon('bellFill', 18) : icon('bell', 18);
    btn.setAttribute('aria-label', on ? `Reminder set for ${act.name} — tap to change` : `Remind me about ${act.name}`);
  };

  const btn = h(
    'button',
    { class: 'sch-btn rem', type: 'button', 'aria-pressed': 'false', 'aria-label': `Remind me about ${act.name}` },
    h('span', { class: 'sch-btn__icon', html: icon('bell', 18) })
  ) as HTMLButtonElement;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openReminderSheet(act, () => refresh(btn));
  });
  refresh(btn);
  return btn;
}

function openReminderSheet(act: Act, onDone: () => void) {
  // `active` is a live reminder; `anyStored` also covers a reminder that has
  // already fired (still in storage until the grace-period purge) so the user
  // can always clear it. The bell itself only lights up for `active`.
  const active = getReminder(act.id);
  const anyStored = allReminders().find((r) => r.actId === act.id);
  const body = h('div', { class: 'rem-sheet' });

  if (active) {
    body.appendChild(
      h('p', { class: 'rem-sheet__current' }, `${icon('bellFill', 14)} Reminder on — ${LEAD_OPTIONS.find((o) => o.value === active.leadMin)?.label ?? ''}`)
    );
  }

  const list = h('div', { class: 'rem-sheet__list' });
  const perm = notificationState();

  const pick = async (opt: LeadOption) => {
    let state = perm;
    if (state === 'default') {
      state = await requestNotificationPermission();
    }
    if (state === 'denied' || state === 'unsupported') {
      toast('Notifications are blocked — allow them in your phone/browser settings to get reminders.', { type: 'error', ms: 4600 });
      return;
    }
    const ok = await setReminder(act, opt.value);
    if (ok) {
      closeSheet();
      onDone();
      toast(`Reminder set — we’ll nudge you ${opt.label.toLowerCase()}.`, { type: 'success', ms: 3000 });
    }
  };

  for (const opt of LEAD_OPTIONS) {
    const isCurrent = active && active.leadMin === opt.value;
    const row = h(
      'button',
      { class: 'rem-sheet__opt' + (isCurrent ? ' on' : ''), type: 'button' },
      h('span', {}, opt.label),
      isCurrent ? h('span', { class: 'rem-sheet__check', html: icon('check', 14) }) : null
    );
    row.addEventListener('click', () => void pick(opt));
    list.appendChild(row);
  }
  body.appendChild(list);

  if (anyStored) {
    const remove = h('button', { class: 'rem-sheet__remove', type: 'button' }, 'Remove reminder');
    remove.addEventListener('click', () => {
      removeReminder(act.id);
      closeSheet();
      onDone();
      toast('Reminder removed.', { type: 'info', ms: 2200 });
    });
    body.appendChild(remove);
  }

  body.appendChild(
    h('p', { class: 'rem-sheet__note' }, 'We’ll ping you just before the set starts. For this to work in your pocket, keep the app installed and notifications allowed.')
  );

  // Dev-only test link (shows for Mark so he can verify notifications work on
  // his phone without waiting for a real set in September).
  const isOwner = (localStorage.getItem('eotr2026.name.v1') || '').trim().toLowerCase() === 'mark';
  if (isOwner) {
    const test = h(
      'button',
      { class: 'rem-sheet__test', type: 'button', html: `${icon('bell', 13)} Send test notification` }
    );
    test.addEventListener('click', async () => {
      const sent = await sendTestNotification();
      if (sent) {
        toast('Test notification coming in ~1 min — leave the app, then tap it to open My Day.', { type: 'success', ms: 6000 });
      } else {
        toast('Notifications are blocked — allow them in your phone settings first.', { type: 'error', ms: 4600 });
      }
    });
    body.appendChild(test);
  }

  const closeSheet = sheet({ title: act.name, body }).close;
}
