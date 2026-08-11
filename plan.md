# End of the Road 2026 PWA — Handoff Plan

_Written end of day 2026-08-10. Updated 2026-08-11 (dark mode + timetable + chat + DMs/groups). Say "look at plan.md and let's continue" to resume._

---

## 1. Where we are (all done, tested, LIVE)

Live at **https://mas-ghub.github.io/eotr-2026/** — SW **v1.14.0**, repo `mas-ghub/eotr-2026` (public).

**Working, verified, deployed:**

- Lineup, Timetable (with fixed 09:00→02:00 hour labels), My Day schedule + clash flags, artist pages, film/Cinema, print views.
- **Find Your Friends map (new)** — a 5th **Map** tab: Leaflet map showing everyone who's opted in to **location sharing**, plus a **"who's online"** chip strip from automatic presence heartbeats. Tap an online name or a map marker → jumps straight into a **DM**. Sharing is strictly opt-in (browser permission), stops on demand (deletes your pin), and the privacy note is right there. Presence stays while you browse; location fades after 30 min.
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

**Verification baseline:** `tsc --noEmit` clean · `vite build` clean · smoke **23/23** · feature **7/7** · greeting **9/9** · chat-check **9/9** · **DM e2e 10/10** (local + live) · **group e2e 7/7** · **unique-name 6/6** (local + live) · **map-check 10/10** · **map-e2e 8/8** (local + live) · zero console errors.

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
`europe-west2`, production mode; **Anonymous sign-in enabled** (Security → Authentication →
Sign-in method → Anonymous); `firestore.rules` published (conversations + messages).
Keys in `app/.env` (gitignored). `verify-chat.mjs` → **PASS**. Verified live.

### Backlog (not started)

- **Set reminders** — notification before a saved set starts (needs opt-in; iOS web notifications only on installed PWAs — flaky, test carefully).
- **Personal notes** on artists/sets (localStorage).
- **Chat hardening**: Firebase App Check (reCAPTCHA) to block spam/bots, moderation/delete path, per-user rate limit via Cloud Functions. (Unique names are DONE — see §1.)
- **Map privacy**: location data is opt-in and self-deleting; if wanted, add a "clear my history" or a friends-only (allowlist) mode. Also note iOS is stricter about background location.
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

1. `git status` should be clean. Confirm live SW is v1.14.0.
2. Run `npm run dev`, spot-check: chat (wall + Chats list + a DM from a name tap + a group), greeting prompt on fresh profile (try taking an existing name → rejected), dark toggle, timetable day persistence, and the **Map** tab (share location, see yourself + who's online, tap a name → DM).
3. Try the map from two phones: both share location → each sees the other's pin + online chip; tap to DM.
3. Try DMs/groups from two phones (or phone + incognito): tap a name on the wall → DM, send → it lands on the other phone with chime + badge.
4. Then pick from the backlog: set reminders, personal notes, or chat hardening (name uniqueness / spam protection / moderation).
