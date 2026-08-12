# End of the Road 2026 PWA — Handoff Plan

_Written end of day 2026-08-10. Updated 2026-08-11 (dark mode + timetable + chat + DMs/groups + map added then REMOVED + reminders IN PROGRESS). Say "look at plan.md and let's continue" to resume._

---

## 0. ⏸ CURRENT STATUS — resume here

**Set reminders + shared "My Day" picks are BUILT, TESTED (9/9 suites) and ready to deploy.** SW bumped to **`eotr2026-v1.17.0`**.

- **Set reminders** — `reminder-check.mjs` **10/10**. Fixed: fired reminders could no longer be removed (sheet now keys off any stored entry); `setReminder` no longer duplicates.
- **Shared "My Day" picks** (`app/src/favorites.ts`) — when online, your saved sets auto-sync to Firestore `favorites/{uid}` (name + set ids). My Day shows a "Who's going where" live list of everyone else's picks. Strictly online-only + offline-hardened: an 8 s write watchdog + 30 s retry handle Firestore's silent offline buffering; chat/favorites share one deduped Firebase init. **Rules published 2026-08-12.**
- **NEXT STEP:** `npm run build`, deploy `npx --yes gh-pages -d app/dist`, poll until live (`curl -s "…/sw.js" | grep CACHE_VERSION` → `v1.17.0`). Then test on a real phone (installed PWA): set a reminder ~30 min ahead + background the app; confirm two phones see each other's picks on My Day.

---

## 1. Where we are (done, tested, LIVE)

Live at **https://mas-ghub.github.io/eotr-2026/** — SW **v1.16.0**, repo `mas-ghub/eotr-2026` (public).

**Working, verified, deployed:**

- Lineup, Timetable (with fixed 09:00→02:00 hour labels), My Day schedule + clash flags, artist pages, film/Cinema, print views.
- **Chat — public wall + private DMs + groups** ✅ Firebase connected (project `eotr-2026-chat`, Firestore Standard, `europe-west2`). Anonymous sign-in enabled. The **Everyone** wall (public guestbook) plus **private 1:1 DMs** and **group chats** up to 20 people. New messages pop up app-wide with a chime + toast + green badge. Private messages never appear on the public wall.
  - Tap **any name** on the wall to start a DM. **New chat** button opens a picker (pick 1 = DM, pick 2+ = group, with a group name). "Chats" tab lists conversations with unread dots + previews.
  - **Unique names enforced**: first come, first served via a Firestore `names` collection. Trying a name that's taken shows "X is already taken — try another ✨" and blocks it. Graceful fallback offline.
  - Identity is per-device anonymous (no logins).
- **Name greeting**: first-launch welcome card → tappable time-of-day hero pill. Chat composer reuses the name ("Posting as Sam", tap to change).
- **Dark mode**: moon/sun toggle in the header — persists, follows OS until chosen, syncs status-bar theme-color, works offline.
- **Timetable remembers its day** across navigation.
- **Nav active-tab highlight** now works.
- Audio: 684 bundled offline clips, correct-artist audio + links.
- Offline: "Get offline audio" pill; white-screen bug fixed; pill shows "Offline mode" when disconnected.
- Header: offline pill + dark toggle + "?" help sheet. Install button Android-only.
- Audio player: 5-bar equalizer, progress bar + timer, single-track exclusivity.
- Festival-fun: weather strip, countdown, "See them live" (Songkick), "Surprise me", version footer.
- **Map tab REMOVED** (v1.16.0) — Leaflet/location never rendered reliably on iOS/Android; deleted. See §0.

**Verification baseline:** `tsc --noEmit` clean · `vite build` clean · smoke **23/23** · feature **7/7** · greeting **9/9** · chat-check **9/9** · **DM e2e 10/10** · **group e2e 7/7** · **unique-name 6/6** · **reminder 10/10** · **favorites e2e 9/9** · zero console errors. All local e2e runs isolated behind the `devtest_` collection prefix (see §5).

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
node test/reminder-check.mjs # set reminders UI flow (also needs :4173)
node test/favorites-e2e.mjs  # shared "My Day" picks, two devices (needs :4173 + rules published)
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
`europe-west2`, production mode; **Anonymous sign-in enabled** (Security → Authentication →
Sign-in method → Anonymous); `firestore.rules` published (conversations + messages).
Keys in `app/.env` (gitignored). `verify-chat.mjs` → **PASS**. Verified live.

### Backlog (not started)

- **Set reminders (IN PROGRESS, see §0)** — notification before a saved set starts. Local scheduler + SW notification; works while app is open/backgrounded; Notification Triggers on Android Chrome even when closed. iOS limitation (timers suspended when fully closed) documented.
- **Festival Bingo / "I was there" tracker** — tick off artists as you see them → badges, progress, BINGO shout to the wall.
- **Essential info cards** — water refill, first aid, phone charging, quiet camping, toilets (facts, not a map).
- **Official announcements broadcast** — admin posts via the existing chat infra; everyone gets a chime/push.
- **Lost & found board** + **Lift/carpool board** — filtered wall variants.
- **Personal notes** on artists/sets (localStorage).
- **Chat hardening**: Firebase App Check (reCAPTCHA) to block spam/bots, moderation/delete path, per-user rate limit via Cloud Functions. (Unique names are DONE — see §1.)
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

## 6. First thing when resuming

**Both features are built, tested and ready to deploy (see §0).**
1. `npm run build`, deploy `npx --yes gh-pages -d app/dist`, poll until live (`curl -s "…/sw.js" | grep CACHE_VERSION` → `v1.17.0`).
2. Test on a real phone (installed PWA): set a reminder ~30 min ahead + background the app; confirm two phones see each other's picks on My Day.
3. Then pick from the backlog: festival bingo, essential-info cards, official announcements broadcast, lost & found, or chat hardening (App Check / moderation).
