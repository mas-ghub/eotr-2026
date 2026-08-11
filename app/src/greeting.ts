import { h, icon, iconEl, toast } from './ui';

const NAME_KEY = 'eotr2026.name.v1';
const ASKED_KEY = 'eotr2026.nameasked.v1';

export function getName(): string | null {
  try {
    const v = localStorage.getItem(NAME_KEY);
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name.trim());
  } catch {
    /* storage unavailable — name applies to this session only */
  }
}

/** Keep letters, numbers, spaces and simple punctuation; collapse runs, cap length. */
function cleanName(raw: string): string {
  return raw
    .replace(/[^\p{L}\p{N} .'-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
}

/** Time-of-day greeting in festival time (Europe/London). Never throws. */
export function greetingForNow(): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false }).formatToParts(new Date());
    const hh = Number(parts.find((p) => p.type === 'hour')?.value || '12');
    if (hh >= 5 && hh < 12) return 'Good morning';
    if (hh >= 12 && hh < 17) return 'Good afternoon';
    if (hh >= 17 && hh < 22) return 'Good evening';
    return 'Good night';
  } catch {
    return 'Hello';
  }
}

/** The tappable "Good morning, Sam" pill for the lineup hero. */
export function greetingEl(): HTMLElement {
  const name = getName();
  const greet = greetingForNow();
  const el = h(
    'button',
    {
      class: 'hero__greeting',
      type: 'button',
      title: name ? 'Change your name' : 'Say hello',
      'aria-label': name ? 'Change your name' : 'Set your name'
    },
    iconEl(greet === 'Good night' ? 'moon' : 'sun', 14),
    h('span', {}, `${greet}${name ? `, ${name}` : ''} — enjoy the festival`)
  );
  el.addEventListener('click', () => {
    void promptForName(true).then((next) => {
      if (next) {
        el.replaceWith(greetingEl());
        toast(`Nice to meet you, ${next}!`, { type: 'success' });
      }
    });
  });
  return el;
}

/**
 * Animated welcome overlay asking for the user's first name.
 * Resolves with the chosen name (persisted) or null if dismissed.
 */
export function promptForName(force = false): Promise<string | null> {
  return new Promise((resolve) => {
    if (getName() && !force) {
      resolve(getName());
      return;
    }

    let settled = false;
    const finish = (name: string | null) => {
      if (settled) return;
      settled = true;
      overlay.classList.remove('open');
      card.classList.remove('open');
      setTimeout(() => {
        overlay.remove();
        resolve(name);
      }, 320);
    };

    const err = h('p', { class: 'welcome-card__err' });
    const input = h('input', {
      class: 'welcome-card__input',
      type: 'text',
      inputmode: 'text',
      maxlength: 24,
      autocomplete: 'given-name',
      spellcheck: 'false',
      placeholder: 'Your first name…',
      'aria-label': 'Your first name'
    }) as HTMLInputElement;

    const submit = () => {
      const name = cleanName(input.value);
      if (!name) {
        err.textContent = 'Tell us your name to get started.';
        input.classList.add('invalid');
        return;
      }
      saveName(name);
      finish(name);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    input.addEventListener('input', () => {
      err.textContent = '';
      input.classList.remove('invalid');
    });

    const card = h(
      'div',
      { class: 'welcome-card' },
      h('div', { class: 'welcome-card__icon', html: icon('ticket', 26) }),
      h('h2', { class: 'welcome-card__title' }, 'Welcome to End of the Road', h('em', {}, '2026')),
      h('p', { class: 'welcome-card__sub' }, 'What should we call you?'),
      input,
      err,
      h('button', { class: 'btn btn-primary welcome-card__go', type: 'button', html: `${icon('sparkle', 15)} Continue` }),
      h('p', { class: 'welcome-card__note' }, 'Just so we can say hello — stored only on this device.')
    );
    card.querySelector('.welcome-card__go')!.addEventListener('click', submit);

    const overlay = h('div', { class: 'welcome-overlay' }, card);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      overlay.classList.add('open');
      card.classList.add('open');
    });
    setTimeout(() => input.focus(), 300);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(null);
    });
  });
}

/** Swap any visible greeting pill for a freshly-rendered one (name may have changed). */
export function refreshGreeting() {
  document.querySelectorAll('.hero__greeting').forEach((el) => el.replaceWith(greetingEl()));
}

/** Ask once on first launch unless a name is already stored. */
export function maybePromptName() {
  try {
    if (localStorage.getItem(ASKED_KEY)) return;
    localStorage.setItem(ASKED_KEY, '1');
  } catch {
    return;
  }
  if (getName()) return;
  setTimeout(() => {
    void promptForName().then((name) => {
      if (name) refreshGreeting();
    });
  }, 900);
}
