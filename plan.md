# End of the Road 2026 PWA — Handoff Plan

_Written end of day 2026-08-10. Say "look at plan.md and let's continue" to resume._

---

## 1. Where we are (all done, tested, LIVE)

Live at **https://mas-ghub.github.io/eotr-2026/** — SW **v1.7.0**, repo `mas-ghub/eotr-2026` (public).

**Working, verified, deployed:**

- Lineup, Timetable (with fixed 09:00→02:00 hour labels), My Day schedule + clash flags, artist pages, film/Cinema, print views.
- Audio: 684 bundled offline clips (655 music + 29 film trailers). Correct-artist audio + correct links (DJ Crenshaw/Sunil Patel festival-link leak fixed; WARBY/Spanish Horses/DJ Crenshaw/Rose of Nevada correctly show "no previews" empty state).
- Offline: tap "Get offline audio" pill → downloads all clips → "Offline ready ✓". SW white-screen bug fixed (precache hashed bundles, keep clips cache across updates). Pill shows "Offline mode" when disconnected.
- Header: offline pill + "?" help sheet (install/uninstall/offline). Install button Android-only (hidden on iOS).
- Audio player: 5-bar equalizer inside play button, live progress bar + timer, single-track exclusivity (only one row animates).
- **Today's additions (all additive, no layout changes):**
  - Weather strip on Timetable + My Day (Open-Meteo, no key; climate average for 3–6 Sept now, auto-switches to live forecast within ~16 days; cached for offline; never errors).
  - Festival countdown on My Day ("23 days · 16 hrs until Thursday", Europe/London).
  - "See them live" → Songkick search chip on artist pages (hidden offline).
  - "Surprise me" shuffle chip on Lineup (jumps to a random artist with previews).
  - Version "EOTR 2026 PWA · version 1.0.0" in footer.

**Verification baseline:** `tsc --noEmit` clean · `vite build` clean · smoke suite `test/smoke.mjs` **23/23** · zero console errors in headless browser checks.

---

## 2. How to run / build / deploy (on this machine)

```bash
npm run dev                 # live dev server → http://localhost:5173
npm run build               # type-check + build app/dist
npm run preview             # serve app/dist → http://localhost:4173
node test/smoke.mjs         # run smoke suite (needs preview running on :4173 first)
npm --prefix scraper run clips -- --films   # full re-scrape incl. film trailers (needs ffmpeg + yt-dlp)
node scraper/src/rebundle-one.mjs <slug>    # re-bundle one artist's audio (after adding an override)
```

**Deploy (source → live):**
```bash
npm run build
npx --yes gh-pages -d app/dist      # deploys app/dist to gh-pages branch
# wait ~1-3 min, then verify:
curl -s "https://mas-ghub.github.io/eotr-2026/sw.js" | grep CACHE_VERSION
```

**Important rule every deploy:** bump `CACHE_VERSION` in `app/public/sw.js` so installed devices refresh. Users do NOT reinstall — they just open the app online for a few seconds.

---

## 3. Project shape (quick reminder)

- `app/` — Vite + vanilla TS PWA. Views in `app/src/views/`. Shell/nav in `app/src/main.ts`. Router in `app/src/router.ts`. Audio in `app/src/audio.ts` + `app/src/offline.ts` (offline download manager). Weather in `app/src/weather.ts` (new).
- `scraper/` — build-time pipeline: clashfinder set times → EOTR artist pages → previews (Deezer/iTunes, `AUDIO_OVERRIDES` in `providers.mjs` for name-collision artists) → film trailers. Output = static JSON + mp3 clips in `app/public/`.
- `test/` — puppeteer smoke suite against the built app on :4173.
- `PROJECT_STATE.md` — full architecture + change log. `plan.md` = this handoff.

---

## 4. Ideas queued (Phase 2, not started — additive only, same style)

- **Set reminders** — notification before a saved set starts (needs opt-in; iOS web notifications only on installed PWAs — flaky, test carefully).
- **Personal notes** on artists/sets (localStorage).
- **Dark mode** toggle.
- Consider **auto-deploy GitHub Action** (push to main → build → deploy to gh-pages) so future updates are one `git push`.
- When we're closer (within ~16 days): weather strip switches to live forecast automatically — no action needed. Set times will change → re-run scraper + deploy.

---

## 5. Gotchas / honest notes

- A few niche artists have <5 clips (Big Red 1, Milkweed 1, SLAG 1, Fine 1, Lichen 2) — that's all their catalog exposes; every present clip is the correct artist.
- `npm run preview`/`smoke.mjs` must run from `app/` for preview and `test/` for smoke (paths).
- gh-pages deploy can lag 1–3 min on the CDN after "Published" — don't panic, poll with cache-buster (`?t=$(date +%s)`).
- Windows shell mangles `$$eval` in inline node -e — write test scripts as files.
- Do NOT re-run the full `clips` pipeline casually: it re-scrapes live sites and would revert the manual http→https link normalizations unless `LINK_NORMALIZE` in `scraper/src/eotr.mjs` covers them (it does for the 3 known ones).

---

## 6. First thing tomorrow if resuming

1. `git status` should be clean (it is now). Confirm live SW still v1.7.0.
2. Run `npm run dev`, spot-check lineup/timetable/myday/artist + weather strip + countdown.
3. Then pick from the Phase 2 list above or the user's next request.
