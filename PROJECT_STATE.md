# End of the Road 2026 PWA — Project State

_Last updated: 2026-08-11_

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
| `src/theme.ts` | Dark/light theme: `data-theme` on `<html>`, persisted choice, system-pref fallback |
| `src/greeting.ts` | Name greeting: first-launch welcome prompt, time-of-day hero pill, localStorage name |
| `src/chat.ts` | Firebase chat engine: lazy Firestore init (code-split), anonymous auth, realtime wall + conversations, DMs/groups, unread badge, Web Audio chime |
| `src/views/chat.ts` | `#/chat` view: Everyone wall + Chats list + conversation threads, composer ("Posting as …"), tap-name-to-DM, New chat picker, status pill |
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

## 7. iOS header fix + help (2026-08-10)

- **Notch fix**: `.app-header` now uses `height: calc(var(--header-h) + env(safe-area-inset-top))`
  + `padding-top: env(safe-area-inset-top)` so installed fullscreen on iPhone/iPad the header
  sits below the camera notch/status bar instead of being squashed under it.
- **Install button**: only ever shown when a real `beforeinstallprompt` fires (Android/Chrome).
  Explicitly guarded so it can never appear on iOS or when already standalone.
- **Help sheet** (`?` button in header, via existing `sheet()`): explains install, uninstall/reinstall
  (iOS: hold icon → Remove App; Android: hold → Uninstall), and offline audio — so the user always
  knows what is happening and how to remove/reinstall.
- Offline pill is intentionally kept on both platforms — it is the live progress/"offline ready"
  indicator the user asked for. On ≤400px screens its label truncates to avoid crowding the header.

## 8. Install-button + single-track player fixes (deployed 2026-08-10)

- **Install button hidden on iOS**: added `button[hidden] { display: none !important; }` so the
  `hidden` attribute always wins over `.btn` display. Verified in a browser with an iPhone UA —
  the Install button stays hidden (`#installBtn.hidden === true`). The only place it can appear is
  Android/Chrome where a real `beforeinstallprompt` fires.
- **Single-track player exclusivity**: `audio.ts` now emits a `null` state whenever switching sources
  or pausing, so every play button re-syncs — exactly one row can be in the animated "playing" state
  at a time. Verified: click track A (playing), click track B → B playing, A no longer animating,
  `playingCount === 1`.
- Both verified in a headless browser with zero console errors; smoke test **23/23**. Deployed to
  GitHub Pages (bundle `index-CPxqiZBh.js`). On a device, reload the app once (the updated SW v1.5.0
  serves the new assets).

## 8b. White-screen-on-offline fix (SW v1.6.0) — 2026-08-10

- **Bug**: cold-launching the installed PWA with no signal produced a white screen. Root causes in
  `app/public/sw.js`:
  1. The hashed JS/CSS bundles (`./assets/index-*.js`) were **not** in `PRECACHE` (they change each
     build), so on a fresh install they only reached cache if requested *through* the SW — which
     often didn't happen before `clients.claim()`. Offline, `index.html` loaded but the bundle
     returned `Response.error()` → blank page.
  2. `cacheFirst` only looked in `RUNTIME_CACHE`, never the versioned `APP_CACHE` where precache lives.
  3. The `activate` handler deleted **every** cache except APP/RUNTIME — including
     `eotr2026-clips`, so each SW update silently wiped the user's 114 MB of downloaded offline audio.
- **Fixes**: `install` now scans `index.html` and precaches all referenced `./assets/*` bundles;
  `cacheFirst` falls back to `APP_CACHE`; `activate` whitelists `CLIPS_CACHE` so downloaded audio
  survives updates. SW bumped to `eotr2026-v1.6.0`.
- **Verified**: fresh isolated browser context → first-ever online load → go offline → cold launch
  renders **197 artist cards, 0 console errors, no white screen**. Full smoke suite still 23/23.

## 8c. Offline pill states + raw-SVG leak fix (2026-08-10)

- **Offline pill**: when the device has no connection the pill now shows **"Offline mode"** with a
  wifi-off icon — non-clickable, no error on tap — instead of the misleading "Get offline audio"
  button. It listens to `online`/`offline` events (no polling needed) and reverts to
  "Get offline audio"/progress when back online. `offline.start()` also guards against running
  without a connection. If clips are fully downloaded it still shows "Offline ready" even offline.
- **Raw `<svg>` text leak (family's "clashes showing weird")**: `schedule.ts:85` passed
  `icon('alert', 12)` — an SVG *string* — as a child node, so `h()` inserted it as a literal text
  node ("<svg viewBox=…>…clashes with another set"). Fixed by passing it via the `html:` prop so it
  renders as a real SVG element. Verified: clash tag innerHTML is a real `<svg>` with zero literal
  `<svg` text; full scan of all `icon()` call sites confirmed this was the only occurrence.
- **Timetable hour labels**: `timetable.ts` computed labels with `hh % 24` where `hh` is in minutes,
  producing alternating `12:00`/`00:00`. Fixed to `Math.floor(hh / 60) % 24`. Labels now render
  correctly 09:00→02:00 across the festival day (including the post-midnight hours).

## 10. Festival-fun additions (weather, countdown, live dates, surprise me, version)

All additive — no existing layout/behavior changed, nothing can break if a source fails.

- **Weather strip** (`app/src/weather.ts`, new): shows the 4 festival days (icon, high/low °C,
  rain %) at the top of the **Timetable** and **My Day** pages. Uses the free Open-Meteo API
  (no key): live forecast when within ~16 days, otherwise the long-term climate average for the
  exact festival dates (labelled "typical conditions"). Results are cached in localStorage so it
  works offline. Every failure path is caught — the strip simply stays empty.
- **Festival countdown** (My Day header): "23 days · 16 hrs until Thursday" in Europe/London,
  ticking each minute, hidden once gates open. Fully error-trapped.
- **"See them live"** (artist pages): a link chip that opens Songkick search for that artist in a
  new tab. Network-only — hidden automatically when the device is offline.
- **"Surprise me"** (Lineup): a shuffle chip that jumps to a random artist that has previews.
- **Version number**: "EOTR 2026 PWA · version 1.0.0" in the footer.
- **Icons added** to `ui.ts`: sun, sunCloud, cloud, drizzle, rain, snow, thunder, fog, droplet,
  shuffle, ticket.
- SW bumped to `eotr2026-v1.7.0`; smoke suite still 23/23; all features verified in a headless
  browser with zero console errors.

## 11. Dark mode + timetable day persistence (2026-08-11)

- **Dark mode** (`app/src/theme.ts`, new): header moon/sun toggle button in `main.ts`.
  - Theme is applied as `data-theme` on `<html>`; choice persists in localStorage
    (`eotr2026.theme.v1`); when the user hasn't chosen, it follows `prefers-color-scheme` live.
  - `style.css` gained a `[data-theme='dark']` variable override block + a few new base
    variables (`--header-bg`, `--nav-bg`, `--ghost-hover-bg`, `--imgwrap-bg`, `--shimmer`,
    `--partial-ink`) so the hardcoded cream `rgba(246,241,231,·)` glass backgrounds and the
    `#ece4d4` image placeholder swap too. `color-scheme` follows the theme so scrollbars/form
    controls match. Body/header/nav get a 0.25s background transition for a smooth flip.
  - The `theme-color` meta is updated at runtime to match (`#f6f1e7` light / `#141a16` dark).
  - Print styles keep hardcoded light colours inside `@media print` — printing is always light.
  - `initTheme()` runs first thing in `boot()` so dark-mode users never see a light flash.
- **Timetable day persistence** (`app/src/views/timetable.ts`): the active day tab is saved to
  localStorage (`eotr2026.ttday.v1`) and restored on render, so the timetable no longer resets
  to Thursday every time you navigate away and back. Falls back to the first day if the saved
  key no longer exists in `meta.days`.
- SW bumped to `eotr2026-v1.8.0`. Smoke suite still **23/23**; new feature suite
  `test/feature-check.mjs` **7/7** (toggle flips + persists across reload, body bg matches theme,
  day persists across navigation, zero console errors). Deployed to GitHub Pages.

## 12. Name greeting (2026-08-11)

- **First-launch welcome prompt** (`app/src/greeting.ts`, new): a spring-animated centered card
  (`welcome-overlay`/`welcome-card` CSS) slides up ~0.9s after boot asking for a first name.
  Input is sanitised (`cleanName`: strips everything except letters/numbers/spaces/`.-'`,
  collapses whitespace, trims, caps at 24 chars — XSS-safe), validates non-empty (shake + error),
  persists to localStorage (`eotr2026.name.v1`), and only ever asks once
  (`eotr2026.nameasked.v1` marker). Dismissing by tapping the backdrop skips it.
- **Time-of-day hero pill** (Lineup): "Good morning / Good afternoon / Good evening / Good night,
  <name> — enjoy the festival", computed in Europe/London. Tapping it re-opens the prompt so the
  name can be changed later (the pill updates in place + success toast). Renders via
  `greetingEl()` in `views/lineup.ts`; `refreshGreeting()` swaps the visible pill after the
  first-launch save.
- Notes: browsers cannot read the device owner's name — the prompt is the way in. Avatar/images
  and a "name must be unique" rule were explicitly deferred by the user; the user's next ask is a
  live multi-user chat (backend, online-only, with a notification sound) — see `plan.md` Phase 2.
- SW bumped to `eotr2026-v1.9.0`. Smoke **23/23**, feature **7/7**, new greeting suite
  `test/greeting-check.mjs` **9/9**. Deployed to GitHub Pages.

## 13. Live chat / guestbook via Firebase (2026-08-11)

- **Backend**: Firebase Cloud Firestore (SDK **12.17.1** — latest stable, verified on npm
  2026-08-11). One shared `messages` collection for the whole festival — "message each other or all".
  Config comes from Vite env vars (`app/.env`, gitignored; `app/.env.example` committed).
  `firestore.rules` (repo root) is the security model: anyone may read + create, updates/deletes
  forbidden, name/text size-capped. Public web keys are not secrets; rules are the protection.
- **`src/chat.ts`** (new): lazy, idempotent Firestore init via **dynamic import** — the Firebase
  chunks (~460 KB raw / ~135 KB gzip) are only fetched when the app is *configured*; with no
  `.env` the app never downloads them (verified: main bundle has zero firebase code, 61 KB).
  Exposes a realtime message store (`onSnapshot`, `orderBy ts asc`, `limitToLast(50)`), status
  stream (connecting/online/offline/error/not-configured), `sendMessage` (server timestamps),
  unread tracking (localStorage `eotr2026.chat.seen.v1`), and a Web Audio two-note chime
  (`playChatSound`) synthesized with zero asset files.
- **`src/views/chat.ts`** (new): `#/chat` route. Flex-column layout sized to the viewport
  (`100dvh − header − nav`) with an inner scrolling wall, chat bubbles (own = green/right),
  relative timestamps ticking every 30 s, auto-scroll near-bottom, and a composer that reuses the
  saved greeting name ("Posting as Sam", tap to change; "Set your name to post" if unset). Status
  pill shows Live/Connecting/Offline/Connection issue/Chat is coming soon.
- **`main.ts`**: Chat nav tab (4 tabs) with a green unread badge (`onUnread`); new-message toast +
  chime app-wide whenever a message arrives while the user isn't on the Chat page (never on first
  load, never for your own messages); audio unlocked on the first user gesture (autoplay policy).
- **Regression fixed en route**: the bottom-nav active highlight was comparing `href="#/lineup"`
  against `route.name` (`lineup`) — never matched, so no tab ever appeared active. Now compares
  `dataset.route` (artist pages keep Lineup highlighted). Covered by `chat-check.mjs`.
- **Configured + LIVE (2026-08-11)**: user created Firebase project `eotr-2026-chat`, enabled
  Firestore (Standard edition, `europe-west2`, production mode), published `firestore.rules`,
  and keys now live in `app/.env` (gitignored). `verify-chat.mjs` → **PASS**.
  - **SW bumped to `eotr2026-v1.11.0`** so installed clients fetch the bundle with config baked in.
  - New suites: `test/chat-e2e.mjs` **7/7** (local two-device realtime), `test/chat-live-e2e.mjs`
    **3/3** (against the deployed site), `chat-check.mjs` **9/9** (status now accepts
    live/connecting/coming-soon). Full regression still green: smoke **23/23**, feature **7/7**,
    greeting **9/9**, zero console errors.
  - Note: the security rules deliberately forbid deletes, so the handful of verification test
    messages ("Hello from Alpha…", "Hello from the live site…") remain in the wall. Harmless.

## 14. Private DMs + group chats (2026-08-11)

- **Identity**: Firebase **Anonymous Auth** (user enabled it in the console — needed for the
  participant-scoped rules). Each device silently signs in with a stable uid (same across
  reloads); no logins, no passwords. Free on Spark (50k anonymous users/mo).
- **Data model** (`firestore.rules` + `src/chat.ts`): a new top-level `conversations`
  collection. Each doc: `type` (`dm`/`group`), `participants` (uid array), `names` (uid→name
  map), `createdBy`, `lastAt`/`lastText` (for the Chats list previews + reordering). Messages
  live in a `conversations/{id}/messages` subcollection (same shape as the wall + `senderId`).
  Rules: read/create only for members (checked via `request.auth.uid in participants`),
  `senderId` locked to the authed uid, sizes capped, no edit/delete.
- **`src/chat.ts`**: `ensureAuth()` (lazy `signInAnonymously`), `subscribeConvs()`
  (`array-contains` my uid), `listenConversation(convId)` for a thread, `openDm(otherUid,name)`
  (deterministic `dm_<a>_<b>` id via a **merge-upsert** — no `getDoc` first, because the read
  rule correctly denies reads of docs that don't exist yet), `createGroup(title,members)`
  (random `grp_` id), `sendConversationMessage` (adds to subcollection + touches `lastAt`/
  `lastText`), `knownPeople()` dedupes wall/conversation names **by name** since each anonymous
  device has a unique uid (otherwise the picker shows one row per device). Unread tracking is
  per conversation (`eotr2026.chat.seen.conv.v1.<id>`) and folded into the nav badge total via
  `onUnread`/`unreadTotal`. A single `onIncoming` event feeds the app-wide toast + chime for
  wall, DM, and group messages.
- **`src/views/chat.ts`**: three screens — Everyone wall, Chats list (avatar initial, unread
  dot, last-message preview, relative time), and a conversation thread (back button, bubbles,
  auto-scroll). The wall's tappable name buttons open a DM (asking for a name first if unset).
  "New chat" opens a bottom-sheet picker: pick 1 = DM, pick 2+ = group with an optional name.
- **Two real bugs found during verification**: (1) `messageEl` attached the tap handler via
  `instanceof HTMLButtonElement`, but `h()` always returns a generic `HTMLElement` — switched to
  a class check. (2) `openDm` did `getDoc` on a not-yet-existing doc, which the read rule
  correctly denied → silently returned null. Both fixed; `firestore.rules` also now allows
  `resource == null` reads so future code can safely check existence.
- **Status**: SW bumped to `eotr2026-v1.12.0`. New suites: `test/chat-e2e.mjs` **10/10**
  (wall + DM cross-device + privacy), `test/chat-e2e-live.mjs` **10/10** (against the deployed
  site), `test/group-e2e.mjs` **7/7** (3-device group). Full regression green: smoke **23/23**,
  feature **7/7**, greeting **9/9**, chat-check **9/9**. Deployed to GitHub Pages.

## 15. Unique display names (2026-08-11)

- **Problem**: each anonymous device has a unique uid but people could pick the same display
  name, so DMs/pick names could point at the wrong person.
- **Fix**: a Firestore **`names`** collection enforces first-come-first-served uniqueness.
  Doc id = lowercased name; fields `{ name, uid, ts }`. Rules: read any, create only when the
  name is free and `uid == request.auth.uid` (atomic), update only for the owner, no delete.
- **`src/chat.ts` → `claimName()`**: `getDoc` to check, then `setDoc`; the create's atomicity
  covers the race (a concurrent claim makes one of them fail). Returns
  `'ok' | 'taken' | 'unavailable'` — `unavailable` (offline / rules not published) still
  accepts the name locally so a guestbook message is never blocked.
- **`src/greeting.ts`**: the welcome prompt's submit is now async — it shows a "Checking…"
  button state, calls `claimName`, and on `'taken'` shows
  `"X is already taken — try another ✨"` and blocks saving. Same path when changing names via
  the hero pill.
- **Status**: SW bumped to `eotr2026-v1.13.0`. New suites `test/name-unique-check.mjs` **6/6**
  (local) and `test/name-unique-live.mjs` **6/6** (deployed site): claim, taken rejection with
  no save, fallback acceptance. greeting-check updated for permanent claims (**9/9**), DM e2e
  **10/10**, group e2e **7/7** still green. Deployed to GitHub Pages.

- Set times live in **static JSON built by the scraper** (`scraper/src/clashfinder.mjs` pulls from
  Clashfinder). They are NOT fetched live by the PWA.
- **To update when we're closer to the date**: edit the timetable source, re-run
  `npm run scrape` (or `npm run clips`), then `npm run build` + deploy to gh-pages. Do this on the
  computer (the repo), not inside the PWA.
- Users don't need to reinstall — the service worker picks up the new data on next load (cache
  version bumps to force it). On-device: open the app → it updates automatically in the background.

## 8. Player exclusivity + Install button bug (2026-08-10)

- **Install button truly hidden**: `.btn { display: inline-flex }` was overriding the `hidden`
  attribute, so the Install button stayed visible on iPhone even though JS never shows it.
  Added `.btn[hidden], button[hidden] { display: none !important }`. Verified `display:none`.
- **Only one track animates**: the player's `notify()` only fired on pause/ended/error and never
  when playback *started*, so the previously-playing button could stay stuck in the animated state.
  Rewrote `Player` to always `emit()` the current url on `playing`/`pause`/`ended`/`error` and to
  announce the old url as null *before* swapping sources. Verified: start track 1 → 1 row playing;
  switch to track 2 → exactly 1 row + 1 progress bar; stop → 0.
