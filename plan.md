# End of the Road 2026 PWA — Handoff Plan

_Written end of day 2026-08-10. Updated 2026-08-11 (dark mode + timetable fix + next-up messaging). Say "look at plan.md and let's continue" to resume._

---

## 1. Where we are (all done, tested, LIVE)

Live at **https://mas-ghub.github.io/eotr-2026/** — SW **v1.11.0**, repo `mas-ghub/eotr-2026` (public).

**Working, verified, deployed:**

- Lineup, Timetable (with fixed 09:00→02:00 hour labels), My Day schedule + clash flags, artist pages, film/Cinema, print views.
- **Chat / guestbook — LIVE** ✅ Firebase connected (project `eotr-2026-chat`, Firestore Standard edition, `europe-west2`, rules published from `firestore.rules`). Shared message wall for everyone: new messages pop up app-wide with a chime + toast + green badge on the Chat tab. Verified end-to-end against the deployed site: a message posted on one device appears live on another. The 2-3 test messages from verification ("Hello from Alpha…", "Hello from the live site…") are still in the wall.
- **Name greeting**: first-launch welcome card → tappable time-of-day hero pill. The chat composer reuses the stored name ("Posting as Sam", tap to change).
- **Dark mode**: moon/sun toggle in the header — persists, follows OS until chosen, syncs status-bar theme-color, works offline.
- **Timetable remembers its day** across navigation.
- **Nav active-tab highlight** now works (was comparing `href` to `route.name`).
- Audio: 684 bundled offline clips, correct-artist audio + links.
- Offline: "Get offline audio" pill; white-screen bug fixed; pill shows "Offline mode" when disconnected.
- Header: offline pill + dark toggle + "?" help sheet. Install button Android-only.
- Audio player: 5-bar equalizer, progress bar + timer, single-track exclusivity.
- Festival-fun: weather strip, countdown, "See them live" (Songkick), "Surprise me", version footer.

**Verification baseline:** `tsc --noEmit` clean · `vite build` clean · smoke **23/23** · feature (dark/day) **7/7** · greeting **9/9** · chat **9/9** · **chat e2e 7/7** (local two-device) · **live-site e2e 3/3** · zero console errors.

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

### Chat setup — DONE ✅ (completed 2026-08-11)

Firebase project `eotr-2026-chat` created by the user; Firestore **Standard edition**,
`europe-west2`, production mode; `firestore.rules` published; keys in `app/.env` (gitignored).
`node app/scripts/verify-chat.mjs` → **PASS**. Chat verified live on the deployed site.

If it ever needs re-doing, the steps were: console → Add project → register web app → copy
`firebaseConfig` → Firestore Database (Standard, `europe-west2`) → publish `firestore.rules` →
fill `app/.env` → `node app/scripts/verify-chat.mjs` → `npm run build` + deploy.

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

1. `git status` should be clean. Confirm live SW is v1.11.0.
2. Run `npm run dev`, spot-check: chat (should show Live + existing messages), greeting prompt on fresh profile, dark toggle, timetable day persistence.
3. Try the chat from two phones (or phone + incognito) to feel the real-time arrival + chime + badge.
4. Then pick from the backlog: set reminders, personal notes, or chat hardening (name uniqueness / spam protection).
