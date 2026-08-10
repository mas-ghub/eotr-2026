# End of the Road 2026 — Festival Guide PWA

An offline-first Progressive Web App for **End of the Road 2026** (Larmer Tree Gardens, 3–6 September 2026). Browse the full lineup, explore stage times on a clashfinder-style timetable, build your own "My Day" schedule, and listen to 30-second previews of each artist — with the top two tracks bundled into the app so they work with no signal at all.

> Unofficial fan project. Not affiliated with End of the Road Festival. Set times are community-sourced from Clashfinder and may change.

---

## Features

- **Lineup** — every artist with photo, bio, links, genre type and set times. Search + filter by type or day.
- **Timetable** — all 8 stages × 4 days on a scrolling timeline with a live "NOW" line during the festival. Tap a set to add it to My Day.
- **My Day** — your personal schedule, grouped by day, time-sorted, with clash warnings. Add / remove / print.
- **Get a feel** — 30-second previews for ~135 artists (Deezer). The top 2 tracks per artist are bundled **inside the app** as trimmed 20s clips, so they play offline forever. Extract and save your own 10–20s clips in the browser and keep them offline.
- **Print** — print the full programme or your personal schedule with a clean print stylesheet.
- **Offline PWA** — installable on iPhone/Android/desktop; works with no connection after first visit (service worker caches the shell, data, fonts, images and audio).

## Tech

- Vanilla **TypeScript + Vite** (no framework), hand-rolled router/state/animations.
- **Service worker** for offline caching + installability.
- **Node build-time scraper** (no server needed): Clashfinder → set times; official EOTR site → artist pages (bio/photo/links); Deezer API → audio previews; `ffmpeg` → trimmed offline clips.

## Project layout

```
scraper/   Build-time data pipeline (Node + ffmpeg)
app/       The PWA (Vite + TypeScript)
  public/data/      generated JSON (committed so the app works out of the box)
  public/previews/  generated offline audio clips (committed)
test/      Optional headless smoke test (puppeteer-core + Edge)
```

## Prerequisites

- Node.js **18+** (developed on 24.x)
- `ffmpeg` on your PATH (only needed when regenerating the offline audio clips)

## Getting started

```bash
# install deps
npm --prefix scraper install
npm --prefix app install

# 1) regenerate the data + offline clips from the live sources
npm run scrape

# 2) build the app icons (already checked in)
npm run icons

# 3) run the app locally
npm run dev          # http://localhost:5173

# 4) production build
npm run build        # outputs app/dist

# 5) preview the production build
npm run preview
```

`npm run dev` / `npm run build` run inside `app/`; the scraper reads live websites and writes everything the app needs into `app/public/data` and `app/public/previews`.

## Deploying to GitHub Pages

The app builds to a **static folder** (`app/dist`) — no server required.

**Option A — `gh-pages` branch (recommended):**

```bash
npm run build
npx gh-pages -d app/dist
```

**Option B — GitHub Actions:** create `.github/workflows/deploy.yml` that runs the build and publishes `app/dist` with `actions/deploy-pages`, or push `app/dist` to the `gh-pages` branch.

Either way the site will be served at `https://<your-username>.github.io/<repo>/`. Because the PWA uses relative paths (`base: './'`), it works in any sub-path.

### If you need a custom domain

GitHub Pages can host on `https://<user>.github.io` (create a repo named `<user>.github.io`) or use a custom domain in the repo settings. Relative paths keep working either way.

## Re-generating data before the festival

Set times are finalised in the week of the festival. Run `npm run scrape && npm run build` and redeploy to refresh:
- Clashfinder set times (auto-synced each run)
- Fresh Deezer preview URLs (live preview URLs are time-signed and expire within hours, so re-scrape for the freshest online previews; the bundled offline clips never expire)
- Artist pages/bios from the official site

Then **redeploy** — the service worker version bump (`sw.js` → `CACHE_VERSION`) forces clients to refresh.

## Testing

```bash
# type check
npm --prefix app exec tsc --noEmit

# production build
npm --prefix app run build

# optional headless smoke test (uses system Edge via puppeteer-core)
cd test && npm install
node smoke.mjs    # expects `npm run preview` already running on :4173
```

The smoke test checks: lineup renders + search, artist pages with previews, audio playback, clip extraction (MediaRecorder), My Day add/remove, timetable day switching, print sheet, service worker registration, and offline rendering from cache.

## Data sources

| Source | Used for |
| --- | --- |
| `clashfinder.com/s/eotr2026/` | Stage, day and set times (+ MusicBrainz IDs) |
| `endoftheroadfestival.com` | Artist names, photos, bios, social links, type (music/comedy/literature) |
| `api.deezer.com` | 30-second audio previews + track/album artwork |

**Important:** preview audio is used solely for personal discovery/listening. The bundled clips are short excerpts; if you plan to share anything publicly, please check the relevant rights/licences first.
