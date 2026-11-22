# CF HUD

A cross-platform floating HUD for Codeforces contests: live rank, score, problem status and a rating prediction, in a ~380 px window that stays on top of your IDE.

[![CI](https://github.com/cf-hud/cf-hud/actions/workflows/ci.yml/badge.svg)](https://github.com/cf-hud/cf-hud/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Web-lightgrey.svg)](#install-and-run)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

*The repository URL used in the badges and in the clone command is a placeholder (`github.com/cf-hud/cf-hud`) to be replaced when the project is published elsewhere.*

## Why

During a rated round you move between the statement, the editor and the standings dozens of times. Every trip to codeforces.com costs focus, and on a single monitor it costs the whole screen. CF HUD is the second screen for those two hours: a narrow, always-on-top panel that answers the questions you actually ask mid-contest — where am I, what is my score, how long is left, and what am I predicted to gain or lose.

<img src="docs/screenshot.png" alt="CF HUD panel during a live round: rank card with rank trend, rating prediction interval, problem matrix, rating goal and watch list" width="380" />

## Features

### During the contest

- **Handle binding** — enter your Codeforces handle once. Public data only: no login, no API key, no OAuth.
- **Contest discovery** — the HUD detects the round that is running and counts down to the next one. When several rounds run at once (for example Div. 1 and Div. 2 of a combined round), it lets you pick the one you are in instead of guessing.
- **Rank card** — rank, number of participants, top percentile, points, penalty, solved count, the gaps to the rows directly above and below you, and a rank sparkline.
- **Score & penalty details** — the numbers behind the rank card, itemised.
- **Problem matrix** — for each problem: solved, attempts, or untouched; its point value; your solve time; and how many participants solved it.
- **Time & status** — countdown, contest progress, frozen-standings badge, data freshness, and the current phase (before / coding / system test / finished).
- **Rating prediction** — expected rating change from the official formula, a prediction interval, a confidence level, and the rank needed for a given gain. Always labelled as unofficial.
- **Goal planning** — set a target rating and see the rank it requires, how many places you still need to climb ("catch N more people"), and whether you are on track, need to climb, or cannot get there from your current position.
- **Watch list** — keep friends and rivals in the same panel; no API key needed.
- **Notifications** — when you are overtaken, when you lose your goal, and 15 / 5 minutes before the end — an in-app toast, plus an OS notification on desktop.
- **Refresh strategy** — ~90 s polling, manual refresh, exponential backoff on errors, and stale data kept on screen with its age instead of being replaced by a spinner.

### After the contest

- **Settlement** — once Codeforces publishes the official rating changes, the HUD compares them with the prediction it showed and displays the real delta.
- **Rating history** — a chart of your rating over time, refreshed after the rating is updated.
- **Rating published notification** — a toast and an OS notification when your new rating is out.

### Desktop & UI

- **Floating window** — always-on-top toggle, frameless and draggable, position and size remembered by the OS, and a mini mode.
- **Global shortcut** — Ctrl+Shift+H, so you can toggle the overlay from anywhere on desktop without switching windows.
- **Browser pop-out** — in the browser the HUD is a normal page; Document Picture-in-Picture pops it into a small always-on-top window next to your editor.
- **Themes & language** — dark and light themes, adjustable opacity, and an English or Simplified Chinese interface.
- **Cross-platform** — Windows, macOS and Linux desktop apps plus the web app, all from one codebase.

## Install and run

### Prerequisites

- Node.js 20 or newer and npm.
- For the desktop app only: a stable Rust toolchain and the Tauri 2 platform prerequisites — WebView2 on Windows, Xcode command line tools on macOS, and WebKitGTK plus the usual build dependencies on Linux.

### Web app

```bash
git clone https://github.com/cf-hud/cf-hud.git
cd cf-hud
npm install
npm run dev
```

Open <http://127.0.0.1:1420>. The page runs in any current desktop browser; Document Picture-in-Picture needs a Chromium-based browser that implements it (current Chrome and Edge do).

Production build:

```bash
npm run build     # typecheck + production build into dist/
npm run preview   # serve the build at http://127.0.0.1:4173
```

### Desktop app

The desktop app is the same frontend inside a Tauri 2 shell, with a frameless always-on-top window, the global shortcut and OS notifications.

```bash
npm run tauri dev     # desktop window against the dev server
npm run tauri build   # platform installer/bundle
```

The first desktop run compiles the Rust shell, which takes a few minutes. Current release builds are not code-signed, so the OS may show a security warning on first launch.

### Other commands

| Command | What it does |
| --- | --- |
| `npm test` | Run the Vitest suite (32+ tests). |
| `npm run typecheck` | TypeScript check only. |
| `npm run calibrate` | Compare predictions with official rating changes on recent contests. Hits the live API. |

### Project layout

```
src/core/     Codeforces API client, standings parser, contest logic, rating math
src/data/     Settings (localStorage) and IndexedDB caches
src/app/      Session store, polling, and the React store hook
src/ui/       React components and styles
scripts/      calibrate.ts — prediction accuracy harness
tests/        Vitest suites
src-tauri/    Tauri 2 desktop shell
.github/      CI workflows
```

## How rating prediction works

The prediction mirrors the [official Codeforces rating system](https://codeforces.com/blog/entry/20762). For every participant the HUD computes the expected rank (seed) against the ratings of the field, takes the geometric mean of seed and actual rank, solves for the performance rating that seed implies, and halves the difference with the current rating:

```
seed_i = 1 + Σ_j 1 / (1 + 10^((r_i - r_j) / 400))
m_i    = sqrt(seed_i × rank_i)
R_i    = rating whose seed equals m_i        # performance
Δ_i    = (R_i - r_i) / 2
```

The result is shown as an interval with a confidence level rather than a single number, because frozen standings, system tests and plagiarism re-rulings all move the final rank. The official deflation correction (a few points at most) is not applied; the interval is wide enough to absorb it.

`npm run calibrate` replays the prediction against real `contest.ratingChanges` data. On 27,639 rated participants from three 2026 rounds it measured a **mean absolute error of 10.3 points**, median 7.7, p90 21.4, bias +0.8 and **94.7% interval coverage** (per band: ~9.9 below 1200, ~9.2 at 1200–1500, ~15.5 at 1500–1800, ~16.5 at 1800–2100). Treat these as typical observations, not guarantees.

**This is unofficial.** The prediction is an estimate, not a promise, and CF HUD is not affiliated with Codeforces. Read [docs/RATING.md](docs/RATING.md) for the derivation, the worked example, edge cases and the calibration methodology.

## Data sources & API etiquette

- Only public, anonymous Codeforces API endpoints are used. No API key, no login.
- The API allows one request every two seconds; the app serialises requests through a single rate-limited queue and does not poll faster than the data changes.
- Standings are polled about every 90 seconds, because the server caches them for 1–3 minutes.
- Since 2026, `contest.standings` for regular rounds only works as an anonymous GET with exactly one parameter (`contestId`) and returns the full standings — several megabytes, server-cached. CF HUD parses that payload locally and keeps only the small derived model.
- Participant ratings for the prediction come from `user.ratedList` once per contest and are cached in IndexedDB for 12 hours, so repeat traffic is avoided.
- No scraping, no automation, no submission automation, and never other people's source code. The HUD only shows what the public standings already show.
- Respect the API terms: do not hammer the API, do not build a proxy that multiplies requests, and increase the polling interval (poll less often) if you run multiple instances.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the data flow and the cache layers.

## Privacy

- No accounts, no API keys, no cookies for tracking, no telemetry, no backend.
- Everything is computed on your machine. Settings live in `localStorage`; cached data and rank history live in IndexedDB.
- The only network requests are to `codeforces.com` for the public API.
- Clearing site data (web) or the app data folder (desktop) removes everything CF HUD stored.

## Roadmap

Planned, not implemented in v0.1.0:

- **Neighbour standings board** — the rows around you, with their solved sets, penalties and last submission times.
- **OBS overlay** — a browser-source view for streamers.
- **Browser extension** — the HUD embedded in the Codeforces standings page.
- **Auto-update** — signed desktop updates.
- **More languages** — beyond English and Simplified Chinese.

Not planned: submission automation, reading other people's code, bypassing rate limits or frozen standings, or anything else that would help cheat.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup, style rules, test expectations and PR checklist. Bug reports and feature proposals are just as useful as code.

## License

[MIT](LICENSE) © 2026 CF HUD contributors.

## Acknowledgements

- [Codeforces](https://codeforces.com) and its [public API](https://codeforces.com/apiHelp), used within its terms.
- [CF-Predictor](https://codeforces.com/blog/entry/50411) and [Carrot](https://github.com/meooow25/carrot) — prior art for rating prediction in the Codeforces ecosystem.
- [MikeMirzayanov's "Open Codeforces Rating System"](https://codeforces.com/blog/entry/20762) — the formula this project implements.
- Built with [React](https://react.dev), [Vite](https://vite.dev) and [Tauri](https://tauri.app).
