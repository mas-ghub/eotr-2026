import { loadData } from '../data';
import { navigate } from '../router';
import { h, icon, imageEl, debounce, iconEl } from '../ui';
import { schedule } from '../store';
import { typeBadge, dayShort } from './common';
import type { Artist, Act, ActType } from '../types';

interface Filters {
  q: string;
  type: ActType | 'all';
  day: string; // 'all' | dayKey
}

const TYPE_FILTERS: { key: ActType | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'music', label: 'Music' },
  { key: 'cinema', label: 'Cinema' },
  { key: 'comedy', label: 'Comedy' },
  { key: 'literature', label: 'Literature' },
  { key: 'dj', label: 'DJ / Late' },
  { key: 'other', label: 'Other' }
];

function matches(artist: Artist, f: Filters, dayKeys: Set<string>): boolean {
  if (f.type !== 'all' && artist.type !== f.type) return false;
  if (f.day !== 'all' && !dayKeys.has(f.day)) return false;
  if (f.q && !artist.name.toLowerCase().includes(f.q.toLowerCase())) return false;
  return true;
}

function artistCard(artist: Artist, actsByDay: Map<string, Act>, index: number): HTMLElement {
  const hasPreview = artist.previews.length > 0;
  const days = [...new Set(artist.sets.map((s) => s.dayKey))].sort();
  const primarySet = artist.sets[0];

  const card = h(
    'article',
    {
      class: 'artist-card reveal',
      style: { animationDelay: `${(index % 10) * 45}ms` },
      tabindex: 0,
      role: 'button',
      'aria-label': artist.name
    },
    imageEl(artist.image || artist.artwork, artist.name, 'artist-card__img'),
    h(
      'div',
      { class: 'artist-card__body' },
      h('div', { class: 'artist-card__head' }, typeBadge(artist.type)),
      h(
        'h3',
        { class: 'artist-card__name' },
        artist.name,
        hasPreview ? h('span', { class: 'artist-card__previews', html: icon('note', 14) }) : null
      ),
      primarySet
        ? h(
            'p',
            { class: 'artist-card__set' },
            h('span', { class: 'artist-card__clock', html: icon('clock', 13) }),
            `${dayShort(primarySet.dayKey)} · ${primarySet.stage} · ${primarySet.start}–${primarySet.end}`,
            days.length > 1 ? h('span', { class: 'artist-card__more' }, `+${days.length - 1} set${days.length > 2 ? 's' : ''}`) : null
          )
        : h('p', { class: 'artist-card__set muted' }, 'Set times TBA'),
      h(
        'div',
        { class: 'artist-card__foot' },
        h(
          'span',
          { class: 'artist-card__meta' },
          hasPreview ? `${artist.previews.length} preview${artist.previews.length > 1 ? 's' : ''}` : iconEl('note', 13)
        ),
        primarySet ? addButton(artist.name, actsByDay.get(primarySet.dayKey)) : h('span', { class: 'artist-card__meta muted' }, '—')
      )
    )
  );

  card.addEventListener('click', () => navigate(`#/artist/${artist.slug}`));
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      navigate(`#/artist/${artist.slug}`);
    }
  });
  return card;
}

function addButton(artistName: string, act: Act | undefined): HTMLElement | null {
  if (!act) return null;
  const btn = h('button', {
    class: 'artist-card__add' + (schedule.has(act.id) ? ' on' : ''),
    type: 'button',
    'aria-label': `${schedule.has(act.id) ? 'Remove' : 'Add'} ${artistName} from My Day`,
    html: schedule.has(act.id) ? icon('heartFill', 18) : icon('heart', 18)
  });
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    schedule.toggle(act.id);
    btn.classList.toggle('on', schedule.has(act.id));
    btn.innerHTML = schedule.has(act.id) ? icon('heartFill', 18) : icon('heart', 18);
  });
  return btn;
}

export async function renderLineup(): Promise<HTMLElement> {
  const { meta, acts, artists } = await loadData();

  const actsBySlug = new Map<string, Act[]>();
  for (const act of acts) {
    if (!act.artistSlug) continue;
    const list = actsBySlug.get(act.artistSlug) || [];
    list.push(act);
    actsBySlug.set(act.artistSlug, list);
  }
  const actsByDayFor = (slug: string): Map<string, Act> =>
    new Map((actsBySlug.get(slug) || []).map((a) => [a.dayKey, a]));
  const dayKeysFor = (slug: string): Set<string> => new Set((actsBySlug.get(slug) || []).map((a) => a.dayKey));

  const filters: Filters = { q: '', type: 'all', day: 'all' };

  const root = h('div', { class: 'view lineup-view' });

  const hero = h(
    'header',
    { class: 'hero' },
    h('div', {
      class: 'hero__shapes',
      html: `<span class="shape shape-a"></span><span class="shape shape-b"></span><span class="shape shape-c"></span>`
    }),
    h('p', { class: 'hero__eyebrow' }, 'Larmer Tree Gardens · Dorset'),
    h('h1', { class: 'hero__title' }, 'End of the Road', h('em', {}, '2026')),
    h('p', { class: 'hero__dates' }, meta.dates),
    h(
      'p',
      { class: 'hero__stats' },
      h('span', {}, `${meta.stats.artists} artists`),
      h('span', { class: 'dot' }, '·'),
      h('span', {}, `${meta.stats.acts} sets`),
      h('span', { class: 'dot' }, '·'),
      h('span', {}, `${meta.stats.artistsWithPreviews} with previews`)
    )
  );
  root.appendChild(hero);

  const search = h(
    'div',
    { class: 'controls' },
    h('div', { class: 'search-wrap' },
      h('span', { class: 'search-wrap__icon', html: icon('search', 18) }),
      h('input', { class: 'search', type: 'search', placeholder: 'Search artists…', autocomplete: 'off', 'aria-label': 'Search artists' })
    ),
    h(
      'div',
      { class: 'chip-row type-chips' },
      TYPE_FILTERS.map((f) =>
        h('button', { class: 'chip' + (filters.type === f.key ? ' active' : ''), type: 'button', dataset: { type: f.key }, html: f.label })
      )
    ),
    h(
      'div',
      { class: 'chip-row day-chips' },
      [h('button', { class: 'chip' + (filters.day === 'all' ? ' active' : ''), type: 'button', dataset: { day: 'all' }, html: 'All days' })].concat(
        meta.days.map((d) =>
          h('button', { class: 'chip day-chip' + (filters.day === d.key ? ' active' : ''), type: 'button', dataset: { day: d.key }, html: d.short })
        )
      )
    )
  );
  root.appendChild(search);

  const countEl = h('p', { class: 'results-count' });
  const grid = h('div', { class: 'artist-grid' });
  root.appendChild(countEl);
  root.appendChild(grid);

  const rerender = () => {
    grid.innerHTML = '';
    let i = 0;
    const filtered = artists.filter((a) => matches(a, filters, dayKeysFor(a.slug)));
    countEl.textContent = `${filtered.length} artist${filtered.length === 1 ? '' : 's'}`;
    for (const artist of filtered) {
      grid.appendChild(artistCard(artist, actsByDayFor(artist.slug), i++));
    }
    observeReveals(grid);
  };

  const onSearch = debounce((v: string) => {
    filters.q = v;
    rerender();
  }, 160);

  search.querySelector('input')!.addEventListener('input', (e) => onSearch((e.target as HTMLInputElement).value));
  search.querySelectorAll('button.chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const { type, day } = (btn as HTMLElement).dataset;
      if (type) {
        filters.type = type as ActType | 'all';
        search.querySelectorAll('.type-chips .chip').forEach((c) => c.classList.toggle('active', c === btn));
      }
      if (day) {
        filters.day = day;
        search.querySelectorAll('.day-chips .chip').forEach((c) => c.classList.toggle('active', c === btn));
      }
      rerender();
    });
  });

  rerender();
  return root;
}

let revealObserver: IntersectionObserver | null = null;
export function observeReveals(container: HTMLElement) {
  if (!revealObserver) {
    revealObserver = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) {
            (en.target as HTMLElement).classList.add('in');
            revealObserver!.unobserve(en.target);
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 }
    );
  }
  container.querySelectorAll('.reveal').forEach((n) => {
    if (!n.classList.contains('in')) revealObserver!.observe(n);
    else n.classList.add('in');
  });
}
