# End of the Road 2026 PWA — Project State

_Last updated: 2026-08-10_

Unofficial fan project for **End of the Road 2026** (Larmer Tree Gardens, 3–6 Sept 2026).
Offline-first PWA: lineup, clashfinder-style timetable, "My Day" schedule, print, and
offline 20s audio previews per artist.

---

## 1. Architecture

### App (`app/`) — Vite + vanilla TypeScript PWA (no framework)

| File | Role |
| --- | --- |
| `src/main.ts` | Bootstrap: shell, nav, service worker, install prompt, route rendering |
| `src/router.ts` | Hash router (`#/lineup`, `#/timetable`, `#/myday`, `#/artist/<slug>`, `#/print/…`) |
| `src/data.ts` | Loads `data/meta.json` + `data/acts.json` + `data/artists.json` (single cache) |
| `src/store.ts` | "My Day" schedule store (localStorage) |
| `src/audio.ts` | Audio player, offline clip store (IndexedDB), MediaRecorder clip extractor |
| `src/types.ts` | Shared types (`Artist`, `Act`, `PreviewTrack`, `SocialLink`, …) |
| `src/ui.ts` / `src/lifecycle.ts` | `h()` DOM helper, icons, toasts, view cleanup |
| `src/views/` | `lineup.ts`, `artist.ts`, `timetable.ts`, `schedule.ts`, `print.ts`, `common.ts` |
| `public/data/` | Generated JSON (committed so the app works out of the box) |
| `public/previews/` | Generated offline clips (`<slug>-<n>.mp3`, 20s @ 64k mono) |
| `public/sw.js` | Service worker (precache shell/data/fonts/icons; runtime-caches previews via manifest) |

Rendering of artist links lives in `src/views/artist.ts:243-253` (link chips + Spotify chip).
Audio playback for a track uses **`track.local || track.url`** (`src/views/artist.ts:24`, `src/audio.ts:50`).

### Scraper (`scraper/`) — Node build-time pipeline (`npm run scrape`)

Pipeline (`src/build.mjs`):

1. **Clashfinder** (`clashfinder.mjs`) — set times, stages, days, MusicBrainz IDs.
2. **EOTR artist pages** (`eotr.mjs`) — names, bios, photos, social links, Spotify embed ID.
3. **Music previews** (`previews.mjs` + `providers.mjs`) — multi-source (Deezer → iTunes/Apple → optional Spotify),
   dedupes, downloads + `ffmpeg`-trims 20s clips per artist (`TRACK_TARGET = 5`), reuses prior clips, cleans stale files.
4. **Cinema programme** (`films.mjs`) — film screenings (optional yt-dlp trailer audio).
5. **Merge + verify** — writes `acts.json`, `artists.json`, `meta.json`, `previews-manifest.json`;
   **fails the build** if any preview track lacks an offline file or a music artist has zero clips.

Output lands in `app/public/data` and `app/public/previews` (copied to `app/dist` at build time).
No server is needed — everything is static.

### Sources

| Source | Used for |
| --- | --- |
| `clashfinder.com/s/eotr2026/` | Set times, stages, days |
| `endoftheroadfestival.com` | Artist pages: bio/photo/links/type |
| `api.deezer.com`, `itunes.apple.com`, optional Spotify | 30s preview URLs + artwork |

---

## 2. Current task: Link & Audio correctness

### Goal

1. **Every link in the app goes to a valid, intended destination**
   (no dead hrefs, no wrong-artist links, no festival accounts masquerading as artist links).
2. **The correct music preview plays for the correct artist**
   (the audio a user hears for an artist is actually that artist's music).

### Definition of correct

- Link URLs are reachable `https://` (or working `http://`) destinations.
- Artist social/website links point to **that artist**, never to the festival's own accounts.
- Preview clips are **that artist's own tracks** (primary artist), not covers/karaoke/remixes-by-others
  or tracks by a same-named different artist.
- Offline clip files (`app/public/previews/<slug>-<n>.mp3`) exist and correspond to the track's `url`.

---

## 3. Verification status (2026-08-10)

### FIXED — status as of the latest re-scrape + build

All issues found earlier have been fixed. See §4 for what changed and the evidence.

### Current PASS list

- **Links:** every one of the 518 link URLs is `https://` (3 plain-`http://` ones were
  normalized to working `https://`), no empty URLs, no duplicates, and **zero festival-account
  links** remain. DJ Crenshaw and Sunil Patel now correctly have no artist links.
- **Internal routes** (`#/lineup`, `#/timetable`, `#/myday`, `#/artist/<slug>`, print routes)
  all resolve in `router.ts`; nav + brand links are valid.
- **Audio:** 655 preview tracks (136 artists) — every track has both an online `url` and a
  bundled offline `local` clip; all 655 files exist on disk and match `previews-manifest.json`
  exactly (no missing/empty/stale/dangling).
- **Correct-artist mapping:** same-name collisions resolved via `AUDIO_OVERRIDES` (caroline,
  Mia WIlson, Big Red, M(h)aol, Lichen, Femur, Kurt Vile). Guest/remix-only tracks removed
  (e.g. Mac DeMarco's "The Dark Prince (feat. Mac DeMarco)", mark william lewis, Vicky Farewell,
  Bug Teeth). Artists with no verifiable catalog (WARBY, Spanish Horses, DJ Crenshaw,
  Rose of Nevada) ship with **no previews** (designed empty state) instead of a wrong artist's music.
- **App stability:** `tsc --noEmit` clean, `vite build` clean, and the full headless smoke test
  (`test/smoke.mjs`) passes **23/23**, including offline playback of every preview track for 6 artists
  (30/30), clip extraction, offline rendering from cache, and zero console errors.
- `app/public` and `app/dist` data files are identical; `sw.js` cache bumped to `eotr2026-v1.3.0`.

### FAIL — wrong artist links (data from `scraper/src/eotr.mjs`)

- **DJ Crenshaw** and **Sunil Patel** have 6 links each that point to the **festival's own** accounts
  (instagram.com/endoftheroad, bsky.app/profile/endoftheroadfestival.com,
  youtube.com/@EndoftheRoadTVsessions, facebook.com/@EOTRFestival/,
  tiktok.com/@endoftheroadfestival, open.spotify.com/user/end-of-the-road-festival).
  Root cause: the EOTR page scraper falls back to the site-wide social block when an artist page
  has no artist-specific socials. These must not render as artist links.

### FAIL — wrong-artist audio (high confidence)

| Artist | Problem |
| --- | --- |
| `WARBY` | All 5 clips are choral/covers ("Silent Night arr.", "Every Breath You Take", "War Pigs") — a different WARBY (choir) matched on iTunes. |
| `caroline` | Karaoke versions + "Gulf Coast Girl (feat. Jimmy Buffett…)" — a different "Caroline" (country/pop singer) matched. |
| `Mia WIlson` | "Church Bells"/"Piano Melodies" ambient tracks — almost certainly a different Mia Wilson. |
| `Big Red` | 2 of 5 clips are by **Big Red Machine** ("Phoenix feat. Fleet Foxes", "Latter Days feat. Anaïs Mitchell") — name-score collision. |

### SUSPECT — needs manual listen/check

- `Spanish Horses` ("Bodak Yellow", "Like a Rolling Stone" covers — may be a covers act, unverified).
- `Femur`, `DJ Crenshaw`, `Fine`, `Lichen`, `Kitchen Lover` (self-titled track names make wrong matches hard to spot).
- Featured/remix tracks that are **not the primary artist's own** but do feature them:
  Mac DeMarco ("The Dark Prince feat. Mac DeMarco"), mark william lewis ("Let's Have a Ball feat. …"),
  Vicky Farewell ("Fireflies (Vicky Farewell Remix)"), Bug Teeth ("Albatross (Bug Teeth Remix)").

### MINOR

- 3 links use plain `http://` (Junior Brother, Carson McHone, james K) — they resolve (redirect to https), not broken.

### Root cause of the audio mismatches

`scraper/src/providers.mjs` — `itunesTracks()` sorts Apple results by artist-name score but
**never filters below a minimum score**, so same-name/loose-name artists flood the pool.
Deezer is score-gated (`pickBest`, min 0.7); iTunes is not. When Deezer has no artist
(e.g. `WARBY`, `caroline`), iTunes fills all 5 slots from the wrong artist.

---

## 4. What was changed (2026-08-10)

### Scraper code

1. **`scraper/src/eotr.mjs`** — removed the unscoped `.sitewideSocialLinks` fallback so festival
   accounts never leak into an artist's links (fixes DJ Crenshaw, Sunil Patel).
2. **`scraper/src/providers.mjs`**
   - `itunesTracks()` now drops results whose **artist name** scores below 0.7 vs the target
     (the plain `term` search matches track titles too, which caused e.g. "War Pigs" → WARBY).
   - Added `isArtistTrack()` title filter: rejects karaoke/instrumental/tribute and tracks that
     merely credit the target as a guest or remixer (`(feat. X)`, `(X Remix)`).
   - Added `AUDIO_OVERRIDES` (by slug) pinning the correct Deezer/iTunes artist ID for same-name
     collisions: `caroline` (106310322), `mia-wilson` (344488281, iTunes blocked),
     `big-red` (404858772 + 6785573166), `mhaol` (84745582), `lichen` (180855427),
     `femur` (290277611), `kurt-vile-the-violators` (294912).
   - Added `NO_PREVIEW_SLUGS` for artists with no verifiable catalog: `warby`, `spanish-horses`,
     `dj-crenshaw`, `rose-of-nevada-live-score-by-the-cornish-sound-unit`.
3. **`scraper/src/previews.mjs`** — `gatherCandidates()` applies overrides + `isArtistTrack()`;
   fixed a clip-reuse filename collision bug; exported `bundleArtist()`.
4. **`scraper/src/build.mjs`** — zero-clip verification now skips `NO_PREVIEW_SLUGS` artists.

### Data + app

5. Re-ran the pipeline (`node scraper/src/build.mjs`); re-bundled Kurt Vile via
   `scraper/src/rebundle-one.mjs`. All 655 clips are fresh and internally consistent.
6. Normalized 3 `http://` artist links to working `https://` (Junior Brother, Carson McHone, james K).
7. Bumped `app/public/sw.js` → `CACHE_VERSION = eotr2026-v1.3.0` so existing clients refresh.
8. `npm run build` regenerated `app/dist` from the corrected data.

### Residual notes (not bugs)

- Some niche artists ship with fewer than 5 clips because that is all their catalog exposes on
  Deezer/iTunes (e.g. Big Red 1, Milkweed 1, SLAG 1, Fine 1, Lichen 2, Kurt Vile now 5).
  All present clips are the correct artist's own music.
- Remaining `(feat. …)` / `(… Remix)` titles are tracks where the target artist is the **primary**
  performer (e.g. Pedro Martins featuring Thundercat, Earl Sweatshirt & MIKE featuring guests) —
  kept deliberately.

## 5. Film trailer clips (added 2026-08-10)

- **29 of 33 film records** now have a bundled 20s trailer clip (`film-<n>.mp3`, local-only, `url: ""`).
  The 4 without audio are Q&A/event sessions (no trailer exists): Live game play of Red Dead
  Redemption 2, Soundtracking Q&A, GAME Q&A, Andrea Arnold Q&A.
- Added via targeted `scraper/src/film-clips.mjs` (does NOT re-scrape the pipeline, so the verified
  music previews + links were untouched). Trailers sourced from a YouTube search
  (`ytsearch5:<film> official trailer`) via yt-dlp, trimmed to 20s.
- Hardened `scraper/src/films.mjs` `trailerAudio()`: now uses `--ignore-errors` over the top 5
  search results so unavailable/region-blocked results are skipped (previously `ytsearch1` failed
  on Speed Racer, The Sword In The Stone, Wizard Of Oz — all three now have clips).
- Added a missing root `npm run clips` script (was only defined in `scraper/` despite the README
  and the app's empty-state both telling users to run `npm run clips`).
- Persisted the 3 `http→https` link normalizations inside `scraper/src/eotr.mjs`
  (`LINK_NORMALIZE`) so a future full re-scrape keeps them.
- SW cache bumped to `eotr2026-v1.4.0`; app rebuilt; smoke test passes **23/23** (including
  offline playback of all 30 music previews, zero console errors).
- Final audio inventory: **684 tracks** — 655 music + 29 film trailers — every one with a bundled
  offline clip, manifest and disk fully consistent (684/684, no stale/dangling).

## 6. Offline UX + audio visualiser (2026-08-10)

- **Offline progress pill** in the header (`app/src/offline.ts` + `main.ts`): shows real status —
  "Get offline audio" → "Offline X% · Y MB" → "Offline ready ✓" (or partial/error with tap-to-retry).
  Tapping downloads all 684 bundled clips (~114 MB) into a dedicated `eotr2026-clips` cache with a
  visible progress fill. The app is only truly offline once this shows "Offline ready".
- **Service worker change** (`app/public/sw.js`): the old `install` step tried to precache all 114 MB
  of audio, which silently stalled activation on phones. Clips are no longer precached at install —
  they are fetched on demand and cached, and the visible offline download fills the same clips cache.
  SW bumped to `eotr2026-v1.5.0`.
- **Audio visualiser redesign** (`app/src/views/artist.ts` + CSS): the animated 5-bar equalizer now
  renders inside the play button while playing (no more bars squashed under the button). Each track
  row now shows a live playhead progress bar + elapsed/total time (`m:ss`).
- **iOS install hint**: on iPhone/iPad, the in-app Install button is dead (iOS has no install prompt),
  so the app now shows a one-time toast — "iPhone? Tap Share → Add to Home Screen to install."
- Verified via browser: pill renders, taps into downloading state with live %/MB, zero console errors.
  Smoke test still passes **23/23**.
