import { loadData } from '../data';
import { navigate } from '../router';
import { h, icon, toast } from '../ui';
import { typeBadge, scheduleButton, dayShort } from './common';
import { player, extractClip, saveClip, listClips, deleteClip, downloadBlob, clipExtension, type SavedClip } from '../audio';
import { onViewCleanup } from '../lifecycle';
import type { Artist, PreviewTrack } from '../types';

const LINK_ICONS: Record<string, string> = {
  website: 'stage',
  instagram: 'camera',
  facebook: 'camera',
  youtube: 'play',
  tiktok: 'note',
  bluesky: 'refresh',
  spotify: 'disc'
};

function eq(): string {
  return '<span class="eq"><i></i><i></i><i></i><i></i><i></i></span>';
}

function fmtTime(sec: number): string {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function trackRow(artist: Artist, track: PreviewTrack): HTMLElement {
  const src = track.local || track.url;
  const row = h('div', { class: 'track-row' });
  const isLocal = !!track.local;

  const btn = h(
    'button',
    { class: 'track-play', type: 'button', 'aria-label': `Play ${track.track}`, html: icon('play', 20) },
    h('span', { class: 'track-play__eq', html: eq() })
  );

  const progressBar = h('span', { class: 'track-progress' });
  const timeEl = h('span', { class: 'track-time' }, '0:00');

  const update = () => {
    const playing = player.isPlaying(src);
    btn.classList.toggle('playing', playing);
    btn.innerHTML = playing ? eq() : icon('play', 20);
    progressBar.classList.toggle('visible', playing);
    if (!playing) {
      progressBar.style.width = '0%';
      timeEl.textContent = '0:00';
    }
  };

  const tick = () => {
    const { current, duration } = player.progress(src);
    if (!player.isPlaying(src)) return;
    progressBar.classList.add('visible');
    const pct = duration ? Math.min(100, (current / duration) * 100) : 0;
    progressBar.style.width = `${pct}%`;
    timeEl.textContent = `${fmtTime(current)} / ${fmtTime(duration)}`;
  };

  btn.addEventListener('click', async () => {
    try {
      await player.toggle({ url: track.url, local: track.local });
      update();
      tick();
    } catch (err) {
      toast((err as Error).message, { type: 'error' });
    }
  });
  const unsub = player.subscribe(update);
  const unsubTick = player.subscribeTick(tick);
  onViewCleanup(unsub);
  onViewCleanup(unsubTick);

  const clipBtn = h(
    'button',
    { class: 'track-clip', type: 'button', 'aria-label': `Extract a clip of ${track.track}`, html: icon('sparkle', 17) }
  );
  clipBtn.addEventListener('click', () => {
    if (row.querySelector('.clip-panel')) {
      row.querySelector('.clip-panel')!.remove();
      return;
    }
    row.appendChild(clipPanel(artist, track, src));
  });

  row.appendChild(btn);
  row.appendChild(
    h(
      'div',
      { class: 'track-meta' },
      h('p', { class: 'track-meta__name' }, track.track, isLocal ? h('span', { class: 'track-meta__offline', title: 'Available offline' }, '●') : null),
      h('p', { class: 'track-meta__album' }, track.album || 'Preview')
    )
  );
  row.appendChild(timeEl);
  row.appendChild(clipBtn);
  row.appendChild(progressBar);
  return row;
}

function clipPanel(artist: Artist, track: PreviewTrack, src: string): HTMLElement {
  const panel = h('div', { class: 'clip-panel' });
  const state = h('p', { class: 'clip-panel__state' }, 'Pick a length — we\'ll record a clip you can keep offline.');
  const durations = [10, 15, 20];
  let seconds = 15;

  const chips = h(
    'div',
    { class: 'clip-panel__chips' },
    ...durations.map((d) =>
      h('button', {
        class: 'chip small' + (d === seconds ? ' active' : ''),
        type: 'button',
        dataset: { s: String(d) },
        html: `${d}s`
      })
    )
  );
  chips.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      seconds = Number((b as HTMLElement).dataset.s);
      chips.querySelectorAll('button').forEach((c) => c.classList.toggle('active', c === b));
    });
  });

  const recordBtn = h('button', { class: 'btn btn-primary small', type: 'button', html: `${icon('sparkle', 15)} Record ${seconds}s clip` }) as HTMLButtonElement;
  const action = async () => {
    recordBtn.disabled = true;
    state.textContent = 'Recording…';
    try {
      const { blob, mime } = await extractClip(src, seconds);
      const clip: SavedClip = {
        id: `${artist.slug}-${track.track}-${seconds}`,
        slug: artist.slug,
        artistName: artist.name,
        track: track.track,
        seconds,
        mime,
        size: blob.size,
        createdAt: Date.now(),
        blob
      };
      await saveClip(clip);
      const file = `${artist.slug}-${track.track.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40)}-${seconds}s.${clipExtension(mime)}`;
      downloadBlob(blob, file);
      state.textContent = 'Saved to your clips and downloaded.';
      toast(`Clip saved (${Math.round(blob.size / 1024)} KB)`, { type: 'success' });
      refreshSaved();
    } catch (err) {
      state.textContent = (err as Error).message;
      const fallback = h(
        'button',
        { class: 'btn btn-ghost small', type: 'button', onclick: () => downloadPreview(artist, track), html: `${icon('download', 14)} Download full preview instead` }
      );
      panel.appendChild(fallback);
    } finally {
      recordBtn.disabled = false;
    }
  };
  recordBtn.addEventListener('click', action);

  const refreshSaved = async () => {
    const saved = (await listClips(artist.slug)).filter((c) => c.track === track.track);
    const wrap = panel.querySelector('.clip-saved') as HTMLElement | null;
    if (saved.length) {
      const list = h(
        'ul',
        { class: 'clip-saved' },
        h('li', { class: 'clip-saved__head' }, 'Saved clips'),
        ...saved.map((c) =>
          h(
            'li',
            { class: 'clip-saved__item' },
            h('span', {}, `${c.seconds}s · ${Math.round(c.size / 1024)} KB`),
            h('button', { class: 'icon-btn', type: 'button', title: 'Play', html: icon('play', 15), onclick: () => playClip(c) }),
            h('button', { class: 'icon-btn', type: 'button', title: 'Download', html: icon('download', 15), onclick: () => downloadBlob(c.blob, `${c.slug}-${c.seconds}s.${clipExtension(c.mime)}`) }),
            h('button', { class: 'icon-btn danger', type: 'button', title: 'Delete', html: icon('trash', 15), onclick: async () => { await deleteClip(c.id); refreshSaved(); } })
          )
        )
      );
      if (wrap) wrap.replaceWith(list);
      else panel.appendChild(list);
    } else if (wrap) {
      wrap.remove();
    }
  };

  panel.appendChild(state);
  panel.appendChild(chips);
  panel.appendChild(recordBtn);
  void refreshSaved();
  return panel;
}

function playClip(c: SavedClip) {
  const url = URL.createObjectURL(c.blob);
  player.play(url).catch(() => toast('Could not play this clip.', { type: 'error' }));
}

async function downloadPreview(artist: Artist, track: PreviewTrack) {
  const src = track.local || track.url;
  try {
    const res = await fetch(src);
    const blob = await res.blob();
    const ext = blob.type.includes('mp3') ? 'mp3' : 'm4a';
    downloadBlob(blob, `${artist.slug}-preview.${ext}`);
    toast('Preview downloaded.', { type: 'success' });
  } catch {
    toast('Download failed — check your connection.', { type: 'error' });
  }
}

export async function renderArtist(slug: string): Promise<HTMLElement> {
  const { artists, acts, meta } = await loadData();
  const artist = artists.find((a) => a.slug === slug);
  const root = h('div', { class: 'view artist-view' });

  if (!artist) {
    root.appendChild(h('div', { class: 'empty' }, h('h3', {}, 'Artist not found'), h('button', { class: 'btn btn-primary', type: 'button', onclick: () => navigate('#/lineup'), html: 'Back to lineup' })));
    return root;
  }

  const myActs = acts.filter((a) => a.artistSlug === slug);

  const back = h('button', { class: 'btn back-btn', type: 'button', html: `${icon('arrowLeft', 18)} Lineup` });
  back.addEventListener('click', () => (history.length > 2 ? history.back() : navigate('#/lineup')));

  const heroImage = artist.image || artist.artwork;
  const hero = h(
    'header',
    { class: 'artist-hero' },
    heroImage
      ? h('div', { class: 'artist-hero__img', style: { backgroundImage: `url("${heroImage}")` } })
      : h('div', { class: 'artist-hero__img placeholder' }, h('span', { class: 'hero-initial' }, (artist.name.trim()[0] || '?').toUpperCase())),
    h('div', { class: 'artist-hero__scrim' }),
    back
  );

  const hasSets = myActs.length > 0;
  const body = h('div', { class: 'artist-body' });
  body.appendChild(h('div', { class: 'artist-head' }, typeBadge(artist.type)));
  body.appendChild(h('h1', { class: 'artist-name' }, artist.name));

  if (hasSets) {
    const setBox = h('div', { class: 'set-list' });
    for (const act of myActs) {
      const dayInfo = meta.days.find((d) => d.key === act.dayKey);
      const dayNum = dayInfo?.label.match(/\d+/)?.[0] || '';
      setBox.appendChild(
        h(
          'div',
          { class: 'set-row' },
          h('div', { class: 'set-row__info' },
            h('span', { class: 'set-row__day' }, `${dayShort(act.dayKey)} ${dayNum}`.trim()),
            h('span', { class: 'set-row__time' }, `${act.start} – ${act.end}`),
            h('span', { class: 'set-row__stage' }, act.stage)
          ),
          scheduleButton(act)
        )
      );
    }
    body.appendChild(setBox);
  } else {
    body.appendChild(h('p', { class: 'muted' }, 'Set time to be announced.'));
  }

  const links = artist.links.filter((l) => !/^https?:\/\/endoftheroadfestival\.com/i.test(l.url));
  let chips: HTMLElement | null = null;
  if (links.length || artist.spotifyId) {
    chips = h('div', { class: 'link-chips' });
    for (const link of links) {
      chips.appendChild(h('a', { class: 'link-chip', href: link.url, target: '_blank', rel: 'noopener' }, h('span', { html: icon(LINK_ICONS[link.label] || 'stage', 15) }), link.label));
    }
    if (artist.spotifyId) {
      chips.appendChild(h('a', { class: 'link-chip', href: `https://open.spotify.com/artist/${artist.spotifyId}`, target: '_blank', rel: 'noopener' }, h('span', { html: icon('disc', 15) }), 'Listen on Spotify'));
    }
    body.appendChild(chips);
  }

  // "See them live" — opens Songkick search for this artist. Network-only:
  // hidden when the device is offline (the page can't load anyway).
  const liveChip = h(
    'a',
    { class: 'link-chip', href: `https://www.songkick.com/search?query=${encodeURIComponent(artist.name)}`, target: '_blank', rel: 'noopener' },
    h('span', { html: icon('ticket', 15) }),
    'See them live'
  );
  const applyOnline = () => liveChip.classList.toggle('is-offline', !navigator.onLine);
  window.addEventListener('online', applyOnline);
  window.addEventListener('offline', applyOnline);
  onViewCleanup(() => {
    window.removeEventListener('online', applyOnline);
    window.removeEventListener('offline', applyOnline);
  });
  if (chips) {
    chips.appendChild(liveChip);
  } else {
    const c = h('div', { class: 'link-chips' }, liveChip);
    body.appendChild(c);
  }

  if (artist.bio) {
    const bio = h('div', { class: 'artist-bio' });
    for (const p of artist.bio.split('\n\n')) {
      if (p.trim()) bio.appendChild(h('p', {}, p));
    }
    body.appendChild(bio);
  }

  // ---- Preview section ----
  const isFilm = artist.isFilm === true || artist.type === 'cinema';
  const prevSection = h('section', { class: 'preview-section' });
  prevSection.appendChild(
    h('h2', { class: 'preview-title' }, h('span', { html: icon(isFilm ? 'film' : 'note', 20) }), isFilm ? 'Trailer audio' : 'Get a feel')
  );
  prevSection.appendChild(
    h(
      'p',
      { class: 'preview-sub' },
      isFilm
        ? 'A short taste of the film. Run the clip-refresh CLI to add 20s trailer clips.'
        : '30-second previews of a few tracks. Play a track, then extract a 10–20s clip to keep offline.'
    )
  );

  if (artist.previews.length) {
    const list = h('div', { class: 'track-list' });
    artist.previews.forEach((t) => list.appendChild(trackRow(artist, t)));
    prevSection.appendChild(list);

    const savedSection = h('div', { class: 'saved-section' });
    prevSection.appendChild(savedSection);
    const renderSaved = async () => {
      const saved = await listClips(artist.slug);
      savedSection.innerHTML = '';
      if (!saved.length) return;
      savedSection.appendChild(h('h3', { class: 'saved-title' }, 'Your saved clips'));
      const grid = h('div', { class: 'saved-grid' });
      for (const c of saved) {
        grid.appendChild(
          h(
            'div',
            { class: 'saved-chip' },
            h('span', { class: 'saved-chip__label' }, c.track, h('em', {}, ` · ${c.seconds}s`)),
            h('button', { class: 'icon-btn', type: 'button', title: 'Play', html: icon('play', 15), onclick: () => playClip(c) }),
            h('button', { class: 'icon-btn', type: 'button', title: 'Download', html: icon('download', 15), onclick: () => downloadBlob(c.blob, `${c.slug}-${c.seconds}s.${clipExtension(c.mime)}`) }),
            h('button', { class: 'icon-btn danger', type: 'button', title: 'Delete', html: icon('trash', 15), onclick: async () => { await deleteClip(c.id); renderSaved(); } })
          )
        );
      }
      savedSection.appendChild(grid);
    };
    void renderSaved();
  } else {
    prevSection.appendChild(
      h(
        'div',
        { class: 'empty small empty-previews' },
        h('div', { class: 'empty-previews__icon', html: icon(isFilm ? 'film' : 'note', 26) }),
        h('p', { class: 'empty-previews__title' }, isFilm ? 'No trailer audio yet' : 'No audio previews yet'),
        h('p', { class: 'empty-previews__sub' }, isFilm ? 'Run `npm run clips -- --films` to add 20s trailer clips.' : 'Run `npm run clips` to refresh previews from more sources.'),
        artist.spotifyId ? h('a', { class: 'btn btn-ghost small', href: `https://open.spotify.com/artist/${artist.spotifyId}`, target: '_blank', rel: 'noopener' }, 'Open on Spotify') : null
      )
    );
  }
  body.appendChild(prevSection);

  root.appendChild(hero);
  root.appendChild(body);
  return root;
}
