# Architecture

CF HUD is a local-first frontend: a React single-page app that talks directly to the public Codeforces API, plus a thin Tauri 2 shell that turns the same app into a desktop window. There is no backend, no database server and no account system. Everything the HUD knows is either fetched from `codeforces.com` or computed and cached on the user's machine.

This document describes how data moves through the app, where the module boundaries are, how polling and caching work, and which product decisions are forced by the state of the Codeforces API in 2026.

## Design constraints

1. **The 2026 standings restriction.** For regular rounds, `contest.standings` only works as an anonymous GET with exactly one parameter, `contestId`. It returns the full official standings (several megabytes), and the server caches that payload for about 1–3 minutes. There is no way to ask for one row, a page, or a specific set of handles.
2. **The API rate limit.** One request every two seconds. Exceeding it returns `FAILED: Call limit exceeded`, and persistent abuse can get an IP blocked.
3. **A second screen, not a second app.** The window is roughly 380 px wide, sits above the IDE, and must stay cheap: no animations that burn CPU, no background workers, no repeated full-payload parsing between renders.
4. **No backend.** Privacy and simplicity both point the same way: the browser or webview fetches, parses, caches and renders locally. The trade-off is that every client downloads the full standings; the ~90 s polling cadence and long-lived caches are what keep that traffic reasonable.
5. **Two shells, one frontend.** The web build and the desktop build share all application logic. Only window management, global shortcuts and OS notifications are shell-specific.

## Data flow

```
┌──────────────────────────────────────────────────────────────┐
│ codeforces.com/api (public, anonymous, CORS-enabled)         │
│   contest.list · contest.standings · user.ratedList ·        │
│   user.info · contest.ratingChanges · user.rating            │
└──────────────────────────┬───────────────────────────────────┘
                           │ HTTPS; 1 request / 2 s; ~90 s cadence
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ Rate-limited client          src/core/api/client.ts          │
│   • one global queue, ≥1.1 s between request starts          │
│   • in-flight de-duplication by URL                          │
│   • retries for network / call-limit errors                  │
│   • server clock offset from the HTTP Date header            │
│ Typed wrapper                src/core/api/codeforces.ts      │
└──────────────────────────┬───────────────────────────────────┘
                           │ full standings JSON (several MB)
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ Standings parser             src/core/standings.ts           │
│   • one pass over all rows                                   │
│   • Snapshot: me, neighbours, problem cells, phase, frozen   │
│   • handle → row index for the watch list                    │
│   • raw payload is discarded after parsing                   │
└──────────────────────────┬───────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ Session store                src/app/store.ts                │
│   • polling state machine and backoff                        │
│   • IndexedDB / localStorage caches                          │
│   • rating pool, prediction, goal planning                   │
│   • rank history (sparkline), watch list, settlement         │
│   • event detection (overtaken, goal lost, timers, rating)   │
│   • single source of truth; no React inside                  │
└──────────────────────────┬───────────────────────────────────┘
                           │ useSyncExternalStore (src/app/useSession.ts)
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ React UI                      src/ui/                        │
│   pure renderer of SessionState; no fetching, no domain math │
└──────────────┬───────────────────────────────┬───────────────┘
               │                               │
               ▼                               ▼
     Browser: normal page            Desktop: Tauri 2 webview
     + Document Picture-in-Picture   window, always-on-top toggle,
       pop-out window                global shortcut, OS notifications
```

## Module map

| Path | Responsibility |
| --- | --- |
| `src/core/api/client.ts` | `CfClient`, `RateLimiter` and `CfApiError`. Serialises calls, de-duplicates identical in-flight requests, retries transient failures, derives the server clock offset from the `Date` header. |
| `src/core/api/codeforces.ts` | Typed wrapper over the endpoints the HUD uses. `standings()` deliberately sends exactly one parameter. |
| `src/core/types.ts` | Raw Codeforces response shapes plus the normalized model (`Snapshot`, `Prediction`, `GoalPlan`, `WatchEntry`, `Settlement`, `RankPoint`, …). |
| `src/core/standings.ts` | `parseStandings()`: turns the full payload into a `Snapshot` (me, above/below neighbours, per-problem cells, participants, frozen flag, fetched-at) and a lowercase handle → row index. |
| `src/core/contest.ts` | Contest selection (`selectContest`), phase helpers and the wall-clock view (`contestClock`: remaining, elapsed, progress). |
| `src/core/rating/predict.ts` | Rating pool construction, seed/performance/delta math, prediction intervals and confidence, goal planning (`planGoal`). |
| `src/core/format.ts` | Small display helpers: delta sign, durations, clock time, percentiles, relative time, ordinals. |
| `src/data/storage.ts` | `localStorage` settings, IndexedDB cache and rank history, plus graceful degradation when storage is unavailable. |
| `src/app/store.ts` | `SessionStore`: polling loop, cache orchestration, all derivations, event emission, `refresh()` and settings actions. |
| `src/app/useSession.ts` | React subscription to the store via `useSyncExternalStore`. |
| `src/ui/` | React components and styles; reads `SessionState` and renders it, plus shell-specific chrome. |
| `src/main.tsx` | App bootstrap and mount. |
| `scripts/calibrate.ts` | Offline-ish accuracy harness: replays real contests against `contest.ratingChanges`. Not part of the app bundle. |
| `tests/` | Vitest suites for contest selection, formatting, standings parsing and rating math. |
| `src-tauri/` | Tauri 2 desktop shell: window flags, global shortcut and notification plugins, capabilities, icons. The Rust side is intentionally thin; application logic stays in TypeScript. |
| `.github/` | CI and release workflows: typecheck, tests, frontend build, `cargo check`, and tagged desktop bundles. |

## Session store and polling state machine

`SessionStore` is a plain TypeScript class, instantiated once and exported as `session`. It owns a `SessionState` object, notifies subscribers on change, and emits domain events. React never computes anything: `useSyncExternalStore(session.subscribe, session.getState, session.getState)` is the whole contract.

A refresh runs this sequence:

1. Load the contest list (IndexedDB, 5 min TTL; otherwise `contest.list?gym=false` and cache it).
2. Pick a contest with `selectContest()`, preferring the user's saved choice, then a single active contest, then the earliest active one. Several active contests (Div. 1 + Div. 2 combined rounds) are surfaced so the UI can ask the user to choose.
3. If there is no contest to watch, go idle and poll again in 5 minutes.
4. If the contest is `BEFORE`, schedule the next poll for kickoff (+5 s) or in 5 minutes, whichever comes first, and show the countdown.
5. Otherwise fetch the full standings, sync the server clock, parse into a `Snapshot`, build or reuse the rating pool, then derive prediction, goal plan, watch entries, rank history and settlement.
6. Emit events for rank drops, lost goals, the 15/5-minute marks and published ratings; schedule the next poll based on the phase.

The scheduling table:

| Situation | Next poll |
| --- | --- |
| No contest to watch | 5 min |
| Contest `BEFORE` | At kickoff (+5 s), but at most 5 min away |
| Contest `CODING` | `pollSeconds` (default 90 s, clamped to 30–600 s) |
| `PENDING_SYSTEM_TEST` / `SYSTEM_TEST` | 2 min |
| `FINISHED`, rating changes not published | 4 min |
| `FINISHED`, rating changes published | 30 min |
| Failed request | Backoff: `max(30 s, pollSeconds) × 2`, capped at 5 min |
| `has not started` error from the API | Retry in 30 s without surfacing an error |

Two rules make the HUD pleasant to leave running:

- **Stale data beats a spinner.** If a refresh fails, the last snapshot stays on screen, the error is shown next to the freshness timestamp, and the poll backs off. `nextRefreshAt` is part of the state, so the UI can show when the next attempt happens.
- **Manual refresh wins.** The refresh button calls `refresh(true)` and bypasses the normal cadence; concurrent refreshes are collapsed.

Phase transitions are detected inside the store, not in components. The events are:

| Event | Trigger |
| --- | --- |
| `rank-dropped` | The user's rank increased by one or more between two polls during `CODING`. |
| `goal-lost` | The predicted post-contest rating crosses below the target rating. |
| `time-left` | 15 and 5 minutes remain; deduplicated per contest. |
| `rating-updated` | `contest.ratingChanges` appears for the watched contest. |
| `contest-finished` | The phase changes from something else to `FINISHED`. |

The UI turns these into in-app toasts; the desktop shell additionally forwards them to OS notifications.

## Cache layers

Three layers, from fastest to most persistent:

| Layer | Key | TTL / retention | Purpose |
| --- | --- | --- | --- |
| In-memory (`SessionStore`) | `poolCache` map by contest id | Session | Avoid rebuilding the rating pool on every poll. |
| In-memory | `lastSnapshot`, `lastRowIndex`, `lastPool` | Session | Serve watch-list lookups between polls. |
| In-memory | `memoryCache` (in `storage.ts`) | Session | Mirror of read values; fallback when IndexedDB is unavailable. |
| `localStorage` | `cf-hud:settings:v1` | Until cleared | Handle, selected contest, target rating, watch list, language, theme, opacity, mini mode, notifications, poll interval, onboarding flag. |
| IndexedDB store `cache` | `contest-list` | 5 min | Contest discovery without re-downloading ~1 MB every poll. |
| IndexedDB store `cache` | `rated:<contestId>` | 12 h | Participant ratings for the prediction pool. |
| IndexedDB store `cache` | `rating-history:<handle>` | 1 h | Rating history chart after settlement. |
| IndexedDB store `rank-history` | contest id | Until cleared; max 720 points | Locally recorded rank/points snapshots for the sparkline. |

The rank-history store is append-only with deduplication: a point is added only when the rank or points changed, or when the previous point is more than 5 minutes old. 720 points is roughly 18 hours at a 90-second cadence, far more than a contest needs, and it caps growth.

Storage is treated as optional. `localStorage` can throw in private mode; IndexedDB can be missing or blocked. In both cases the app keeps working, settings simply do not persist and caches fall back to memory. This is why `storage.ts` never rejects: every helper resolves to `null` on failure.

The raw standings payload is never cached. It is parsed immediately after download and then dropped; only the derived `Snapshot` and the handle index are kept between polls, because the payload is several megabytes while the derived model is a few kilobytes.

## Why the 2026 standings restriction shapes the design

The restriction is not a detail; it defines the architecture.

- **Full-payload fetch only.** The client cannot request `from`/`count`, `handles`, `showUnofficial`, or a signed call for a regular round. Every refresh downloads the whole official standings, so the app must parse it in one linear pass and throw the raw JSON away. `parseStandings()` is the only place that touches the heavy structure; every later computation works on the small model.
- **No client-side pagination.** There is nothing to paginate: the app cannot ask for page 2. The rank card, neighbours, problem matrix and watch list are all derived from the same `Snapshot`.
- **Polling cannot beat the cache.** The server caches standings for 1–3 minutes, so polling faster than that only wastes the rate-limit budget and bandwidth. The default 90 s interval (configurable, minimum 30 s) is a compromise between freshness and etiquette.
- **`participants` is approximate.** It is the number of rows in the standings snapshot, which is not necessarily the number of rated participants in `ratingChanges` (that list can be larger, typically including unrated and low-rated users). Documentation and UI copy therefore say "about" where it matters.
- **Some contests are simply unavailable.** Hidden or non-public standings fail; "has not started" is expected before kickoff and handled as a wait state rather than an error.
- **Handle lookup is a map build.** Since a row cannot be requested directly, locating the user means indexing all rows by lowercase handle once per poll. The same index serves the watch list for free.
- **Rating data is fetched once per contest.** `user.ratedList?contestId=…` is about 5 MB, so it is fetched at most once per contest and cached for 12 hours. Calibration reconstructs the pre-contest ratings from `ratingChanges` instead, because that is more accurate and avoids the dependency.

The rate limiter enforces one request at a time with at least 1.1 s between starts (the API allows one per 2 s, so there is margin). Identical in-flight URLs are de-duplicated, and call-limit failures are retried once after a pause. This is also why the app has no "download everything in parallel" shortcuts: they would violate the API terms and make the tool part of the problem the restriction was introduced to solve.

## Rating pool construction

The prediction needs the pre-contest rating of every participant.

1. The participant list comes from the standings snapshot (one handle per row, in rank order).
2. Ratings come from `user.ratedList?contestId=<id>` (`activeOnly=false`, `includeRetired=true`), fetched once and cached in IndexedDB for 12 hours.
3. `buildRatingPool()` maps lowercase handles to ratings. Any participant without a public rating — first contest, unrated, or missing from the list — is assigned `FALLBACK_RATING = 1400`, the same starting point Codeforces uses for newcomers, and counted as `estimated`.
4. The pool is `usable` only if at least one real rating was found. If the rated list cannot be fetched at all (rate limit, transient failure, offline), the pool is `null`, the prediction is hidden, and the rank card keeps working from the standings alone. This degradation is deliberate: the HUD's core value must not depend on a second 5 MB request.
5. When seeding, the evaluated player is excluded from their own opponent set (`skipIndex`), so a player with rating 1500 is not seeded against themselves.

The pool also drives conservative confidence and interval widths:

- Interval margin is `max(3, round(0.5% of participants))` ranks on each side, combined with an assumed model error of 20 points (30 when the standings are frozen), plus 2 points of slack. The constants were calibrated to reach ~90% empirical interval coverage; the current run covers 94.7% of deltas on 27,639 participants. The interval is at least as wide as the point estimate.
- Confidence is `low` if the standings are frozen, if more than 5% of the field needed the fallback rating, or if there are fewer than 100 participants; `medium` if any rating was estimated; `high` otherwise.
- Notes attached to the prediction make the caveats explicit: `frozen`, `provisional` (contest not finished), `unrated` (no rating for the user), `estimatedRatings`, `noRatings`, `smallField`.

Goal planning reuses the same seed values: the target performance is `r + 2Δ`, its seed gives the required geometric mean, and the required rank is `m² / seed(r)`. The status compares the current delta with the target and flags impossible targets. The full derivation lives in [RATING.md](RATING.md).

## Window model

### Browser

In the browser, CF HUD is an ordinary single-page app. `npm run dev` serves it at `http://127.0.0.1:1420`; the production build is static files under `dist/` and can be hosted anywhere, including locally.

The always-on-top experience comes from **Document Picture-in-Picture**. A user gesture (the pop-out button) calls `documentPictureInPicture.requestWindow()`, and the same React tree is rendered into the returned window. That window stays above other windows, so it plays the role of the desktop overlay without an install. Feature detection is required: unsupported browsers keep the normal page, and there is no fallback that can fake always-on-top. No browser permission is needed beyond the user gesture.

### Desktop (Tauri 2)

The desktop build embeds the same frontend in a Tauri 2 webview. The shell adds what the browser cannot provide:

- a frameless, transparent window (400 px wide by default, 320 px minimum) with an always-on-top toggle;
- dragging through designated drag regions, with position and size remembered by the operating system;
- a mini mode that reduces the panel to the essentials;
- a global shortcut (Ctrl+Shift+H) for quick overlay control without focusing the window;
- OS notifications for the same events that produce in-app toasts.

The Rust side is intentionally minimal: window management, the global shortcut and notification plumbing. It must not grow business logic — that stays in `src/app` so the web build keeps working unchanged. Shell capabilities (window, shortcut, notification permissions) are declared in `src-tauri/capabilities/`; window flags and content security policy live in the Tauri configuration under `src-tauri/`.

Two configuration consequences follow from the local-first design:

- The webview must be allowed to make HTTPS requests to `codeforces.com`; everything else is served from the bundle. Production builds should not load remote scripts at all.
- The frontend detects the shell before calling desktop-only APIs, so a missing Tauri plugin degrades to the web behavior instead of crashing.

Platform behavior is worth testing rather than assuming: always-on-top over macOS full-screen Spaces and over Windows exclusive-fullscreen games can differ from the windowed case.

## Testing and calibration

### Test suite

`npm test` runs Vitest in a Node environment. The suites cover:

| Suite | Focus |
| --- | --- |
| `tests/contest.test.ts` | Contest selection for active/upcoming/combined rounds, clock and progress math. |
| `tests/standings.test.ts` | Parsing, handle indexing, neighbours, problem aggregation, frozen flag. |
| `tests/rating.test.ts` | Seed/performance/delta values, fallback 1400, interval behavior, goal planning, edge cases. |
| `tests/format.test.ts` | Delta signs, durations, percentiles, ordinals. |
| `tests/store.test.ts` | Store polling with a mocked API: contest selection, prediction wiring, backoff and error retention. |

The domain logic is deliberately pure so it can be tested without a DOM or a network. `CfClient` accepts an injected `fetch` implementation, clock and base URL, and `SessionStore` accepts an injected `CodeforcesApi`; that is how polling, caching and error handling are tested without touching the real API. There are 32+ tests.

CI runs `npm run typecheck`, `npm test` and `npm run build` on every push to `main` and every pull request, plus a `cargo check` of the desktop shell. The release workflow under `.github/workflows/` builds desktop bundles when a version tag is pushed.

### Calibration harness

Predicting rating is the one part of the product that can be wrong in a way users care about, so it has a dedicated harness rather than only unit tests:

```bash
npm run calibrate              # recent finished contests
npm run calibrate -- 2226 2200 # explicit contest ids
```

The script fetches the standings and `contest.ratingChanges` for each contest, rebuilds the rating pool from `oldRating` (the actual pre-contest ratings, not a cached `ratedList`), replays the prediction for rated participants (a deterministic sample of 2000 per contest by default; `--all` for every participant), and reports mean absolute error, median and p90 absolute error, bias, interval coverage, and per-rating-band accuracy. It hits the live API, downloads multi-megabyte standings, and therefore is manual only — never part of CI. The output format and how to interpret it are documented in [RATING.md](RATING.md#calibration).

## Limitations

- **No backend means no aggregation.** Each client pays for its own full standings downloads. The ~90 s cadence keeps this acceptable for personal use; it is not a design for thousands of simultaneous users. A shared cache proxy would be the next step if usage grows, but it is explicitly out of scope for v0.1.0.
- **The data is only as fresh as the server cache.** A rank shown on screen can be up to a few minutes behind submissions.
- **Participant counts are approximate**, for the reasons above.
- **UI shell is the newest layer.** The data, caching and rating layers are the stable core; the components under `src/ui/` are still evolving.
