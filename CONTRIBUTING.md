# Contributing to CF HUD

Thanks for wanting to help. CF HUD is a small, dependency-light project, and the goal is to keep it that way: one frontend codebase, no backend, no accounts, and a narrow feature set focused on the two hours of a Codeforces round.

## Before you start

- For a bug or a small fix, open a pull request directly.
- For a larger change or a new feature, open an issue first so the scope can be agreed before you spend time on it. See [Proposing features](#proposing-features).
- Please read the [no-cheating policy](#policy-no-cheating-features) — it is not negotiable.

## Development setup

Prerequisites: Node.js 20 or newer and npm. The desktop shell additionally needs a stable Rust toolchain and the Tauri 2 platform prerequisites (WebView2 on Windows, Xcode command line tools on macOS, WebKitGTK and build tools on Linux).

```bash
git clone https://github.com/cf-hud/cf-hud.git
cd cf-hud
npm install
npm run dev        # web app at http://127.0.0.1:1420
npm test           # Vitest suite
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production build into dist/
npm run tauri dev  # desktop window (first run compiles the Rust shell)
```

`npm run calibrate` hits the live Codeforces API and prints prediction error statistics. It is a manual accuracy check, not part of CI:

```bash
npm run calibrate              # a few recent finished contests
npm run calibrate -- 2226 2200 # specific contest ids
```

## Project conventions

The code is split so that data and math stay testable without React:

- `src/core/` — API client, standings parser, contest selection, rating prediction. Pure TypeScript, no React, no DOM.
- `src/data/` — `localStorage` settings and the IndexedDB cache.
- `src/app/` — the single `SessionStore` (polling, caching, derivations) and the React hook that subscribes to it.
- `src/ui/` — React components and styles. The UI is a renderer; it should not fetch or compute domain data itself.
- `tests/` — Vitest suites, run in a Node environment.

Keep new logic in the layer where it belongs, and keep the UI dumb.

## Code style

- TypeScript is strict. `npm run typecheck` must pass.
- Follow the style of the surrounding file: two-space indentation, single quotes, semicolons, explicit return types on exported functions where it helps.
- Avoid `any`. If an escape hatch is needed, narrow it at the boundary (for example the raw API response) and convert to the normalized model immediately.
- **Do not add a runtime dependency without discussing it in an issue first.** The project intentionally has very few: React, the Tauri API packages, and nothing else at runtime. Dev dependencies (Vite, Vitest, TypeScript, tsx) are equally deliberate.
- No backend, no telemetry, no analytics, no account system. A pull request that adds any of these will not be merged.

## Tests

- Any change to `src/core` logic needs a test. Bug fixes should come with a regression test.
- Tests must be deterministic and offline. The API client accepts an injectable `fetch` implementation and clock, so mock at that boundary rather than calling the network.
- Run `npm test` before opening a pull request; the suite must stay green.
- If you change prediction math or interval widths, also run `npm run calibrate` and include the before/after numbers (MAE, bias, interval coverage) in the pull request.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(rating): add goal planning for target rating
fix(standings): handle rows without a handle
docs: document the 2026 standings restriction
test(core): cover contest selection for combined rounds
```

Allowed types include `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `ci`, `chore`. Keep commits focused — one logical change each, imperative mood, no "wip" commits in a pull request.

## Pull request checklist

- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] New behavior has tests; bug fixes have a regression test.
- [ ] User-facing changes are reflected in `README.md` and `README.zh-CN.md` (and in `docs/` when the change is architectural or mathematical).
- [ ] No new dependency unless it was agreed in an issue.
- [ ] No unrelated refactors or formatting noise in the same pull request.
- [ ] No secrets, tokens, local paths or logs committed.
- [ ] The pull request description says what changed and why; UI changes include a screenshot.
- [ ] The commit title follows Conventional Commits.

## Policy: no cheating features

CF HUD only displays information that is already public in the Codeforces standings, and it must stay that way. Pull requests will be rejected if they add or enable:

- automatic submission or any form of contest automation;
- reading, displaying or scraping other participants' source code;
- bypassing rate limits, the standings cache, or frozen standings;
- predicting or revealing hidden submissions during the freeze;
- anything else that gives a competitor an unfair advantage.

Predictions must remain clearly labelled as unofficial. This policy applies to discussions and feature proposals as well as code.

## Proposing features

Open an issue and describe:

1. **The problem** — what a contestant cannot do today, and when it matters.
2. **The proposed behavior** — what the HUD should show or do.
3. **The data** — which public Codeforces API method (if any) provides it, and at what frequency. Features that need polling faster than the API allows will not be accepted.
4. **The scope** — web, desktop, or both, and whether it fits the current roadmap.

Features from the roadmap (neighbour board, OBS overlay, browser extension, auto-update, more languages) are welcome. Features that require a backend, accounts or API keys for private data are out of scope for now.

## Issue labels

Maintainers use these labels; feel free to suggest the right one in your issue:

| Label | Meaning |
| --- | --- |
| `bug` | Something behaves incorrectly. |
| `enhancement` | A new feature or improvement. |
| `docs` | Documentation only. |
| `prediction` | Rating math, calibration or intervals. |
| `good first issue` | Small, self-contained, suitable for a first contribution. |
| `help wanted` | Maintainers would like someone to pick it up. |
| `needs discussion` | Scope or approach is not settled yet. |
| `wontfix` | Out of scope, including anything covered by the no-cheating policy. |

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
