# End of the Road 2026 PWA — Handoff Plan

_Written end of day 2026-08-10. Updated 2026-08-11 (dark mode + timetable fix + next-up messaging). Say "look at plan.md and let's continue" to resume._

---

## 1. Where we are (all done, tested, LIVE)

Live at **https://mas-ghub.github.io/eotr-2026/** — SW **v1.10.0**, repo `mas-ghub/eotr-2026` (public).

**Working, verified, deployed:**

- Lineup, Timetable (with fixed 09:00→02:00 hour labels), My Day schedule + clash flags, artist pages, film/Cinema, print views.
- **Chat / guestbook (new)** — a shared message wall for everyone at the festival, built on Firebase Firestore. New messages pop up app-wide with a soft chime + toast and a green badge on the Chat tab. Online only (Firestore needs a connection). **Still shows "Chat is coming soon" until the Firebase setup in §4 is done.**
- **Name greeting**: first-launch welcome card → tappable time-of-day hero pill ("Good morning, Sam — enjoy the festival"). The chat composer reuses the stored name ("Posting as Sam", tap to change).
- **Dark mode**: moon/sun toggle in the header — persists, follows OS until chosen, syncs status-bar theme-color, works offline.
- **Timetable remembers its day** across navigation.
- **Nav active-tab highlight fixed** (was comparing `#/lineup` to `lineup` — never highlighted; now `dataset.route`).
- Audio: 684 bundled offline clips (655 music + 29 film trailers), correct-artist audio + links.
- Offline: "Get offline audio" pill → downloads all clips → "Offline ready ✓"; white-screen bug fixed; pill shows "Offline mode" when disconnected.
- Header: offline pill + dark toggle + "?" help sheet. Install button Android-only.
- Audio player: 5-bar equalizer, progress bar + timer, single-track exclusivity.
- Festival-fun: weather strip, countdown, "See them live" (Songkick), "Surprise me", version footer.

**Verification baseline:** `tsc --noEmit` clean · `vite build` clean · smoke **23/23** · feature (dark/day) **7/7** · greeting **9/9** · chat (not-configured state) **9/9** · zero console errors.

---

## 2. How to run / build / deploy (on this machine)

```bash
npm run dev                 # live dev server → http://localhost:5173
npm run build               # type-check + build app/dist
npm run preview             # serve app/dist → http://localhost:4173
node test/smoke.mjs         # run smoke suite (needs preview running on :4173 first)
node test/feature-check.mjs # dark mode + timetable day persistence (also needs :4173)
node test/greeting-check.mjs # name greeting prompt/pill (also needs :4173)
node test/chat-check.mjs    # chat tab/view + not-configured state (also needs :4173)
node app/scripts/verify-chat.mjs # validates Firebase keys in app/.env once set up
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

## 4. Ideas queued (Phase 2 — additive only, same style)

### Chat setup — THE NEXT ACTION (one-time, ~10 min, needs the user's Google account)

The chat feature is **built, tested and deployed** but sits in a graceful "Chat is coming soon"
state until Firebase is connected. The user must do this (it needs their Google login):

1. **console.firebase.google.com → Add project** (e.g. `eotr-2026-chat`; skip Analytics).
2. Overview → **Web `</>`** → register an app (e.g. `eotr-2026`) → copy the `firebaseConfig`.
3. **Build → Firestore Database → Create database** → *Production mode*, region `europe-west2`.
4. **Rules** tab → paste the contents of **`firestore.rules`** (in this repo) → **Publish**.
5. Copy **`app/.env.example`** → **`app/.env`** and paste the `VITE_FIREBASE_*` values.
6. `node app/scripts/verify-chat.mjs` → expect `PASS`, then `npm run build` + redeploy
   (`npx --yes gh-pages -d app/dist`). No SW bump needed for a data-only change? — **no, always
   bump CACHE_VERSION** so devices pull the new bundle with the keys baked in.
7. Verify on a phone: open Chat → set your name → send a message → a second device/incognito
   sees it arrive with a chime + badge.

The Firebase web keys are public by design; `firestore.rules` is the real protection
(anyone can read/post, nothing editable/deletable, sizes capped).

### Backlog (not started)

- **Set reminders** — notification before a saved set starts (needs opt-in; iOS web notifications only on installed PWAs — flaky, test carefully).
- **Personal notes** on artists/sets (localStorage).
- **Chat hardening** (after the wall is live): name-uniqueness rule (query a `names` collection on create), Firebase App Check (reCAPTCHA) to block spam/bots, moderation/delete path, maybe a per-user rate limit via Cloud Functions.
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

1. `git status` should be clean. Confirm live SW is v1.10.0.
2. Run `npm run dev`, spot-check: chat tab → "Chat is coming soon", greeting prompt on fresh profile, dark toggle, timetable day persistence.
3. **Complete the Firebase chat setup** (§4) with the user — the code is done, only the account-side steps + `.env` remain, then rebuild + redeploy and verify two devices can chat.
