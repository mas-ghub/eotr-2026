export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'eotr2026.theme.v1';
const mql = window.matchMedia('(prefers-color-scheme: dark)');

function systemTheme(): Theme {
  try {
    return mql.matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function storedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'dark' || v === 'light' ? v : null;
  } catch {
    return null;
  }
}

function apply(t: Theme) {
  document.documentElement.setAttribute('data-theme', t);
  // Match the OS chrome / status bar to the active theme so the address
  // bar and status bar blend with the header instead of clashing with it.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'dark' ? '#141a16' : '#f6f1e7');
}

/** Apply the persisted (or system) theme on boot. Call once, before first paint. */
export function initTheme(): Theme {
  const t = storedTheme() || systemTheme();
  apply(t);
  try {
    // Only auto-switch when the user has not explicitly chosen a theme.
    mql.addEventListener('change', (e) => {
      if (!localStorage.getItem(STORAGE_KEY)) apply(e.matches ? 'dark' : 'light');
    });
  } catch {
    /* older browsers — static theme only */
  }
  return t;
}

export function currentTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/** Flip theme, persist the choice, and return the new theme. */
export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* storage unavailable — theme applies for this session only */
  }
  apply(next);
  return next;
}
