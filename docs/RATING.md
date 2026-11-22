# Rating prediction

CF HUD estimates how much rating you would gain or lose if the contest ended at your current rank. The estimate follows the official Codeforces rating system as described in [MikeMirzayanov's "Open Codeforces Rating System"](https://codeforces.com/blog/entry/20762), with one documented omission (the deflation correction).

The prediction is **unofficial**. It is an estimate of a hypothetical outcome, not a forecast of the final result: ranks move until the last submission, system tests change accepted solutions, and plagiarism re-rulings can rewrite the standings afterwards. CF HUD is not affiliated with Codeforces.

This document covers the derivation, a worked example, the deflation step and why it is skipped, edge cases, and the calibration harness.

## The official algorithm

For a contest with participants `1..n`, let `r_i` be the rating of participant `i` before the contest and `rank_i` the final position.

### 1. Seed (expected rank)

```
seed_i = 1 + Σ_{j ≠ i} 1 / (1 + 10^((r_i - r_j) / 400))
```

The seed is a soft expected rank: it is what ranking you would expect if everyone performed exactly at their rating. A player stronger than the whole field has a seed close to 1; a player weaker than the whole field approaches `n`. The logistic term is the standard Elo win-probability curve, and summing it over the field gives the expected number of participants ahead of you plus one.

For a field where everyone has the same rating, every term is `1/2`, so `seed_i = 1 + (n - 1) / 2`.

### 2. Geometric mean with the actual rank

```
m_i = sqrt(seed_i × rank_i)
```

The geometric mean blends the expectation (seed) with the result (rank). It is the quantity the next step inverts.

### 3. Performance rating

Find the rating `R_i` such that the player's seed would have been `m_i` in this field:

```
R_i such that seed(R_i) = m_i
```

`R_i` is the "performance" of the contest: the rating level that would have made this rank an exactly expected result. There is no closed form, so the HUD solves it by bisection; `seedAt(r)` is monotonically decreasing in `r`, so bisection is stable. The implementation searches `[−2000, 6000]` for 60 iterations, which converges far below display precision.

### 4. Rating change

```
Δ_i = (R_i - r_i) / 2
```

Only half of the performance gap is applied per contest. This is what makes the system gradual: a single great round moves you substantially, but not all the way to the performance level.

The HUD computes this for the user's current rank and for watch-list handles. It does not predict final ranks — ranks depend on other people's submissions and cannot be known — it predicts the delta implied by the rank you hold right now.

## Why the geometric mean, not the raw rank

Using the raw rank directly would ignore the strength of the field. Finishing 100th in a field of 10,000 low-rated players and finishing 100th in a field full of grandmasters are not the same performance, but a raw-rank formula would treat them identically.

The geometric mean fixes this with a useful invariant: **if you finish exactly where you were seeded (`rank_i = seed_i`), then `m_i = seed_i`, the performance equals your current rating, and the delta is zero.** The prediction only becomes positive when you beat your seed, and negative when you fall short of it. Stronger fields give lower seeds, so the same finishing position maps to a lower performance rating.

This is also why the seed must be computed against the whole field, not against a rating band or a sample: the sum over all opponents is the field-strength correction.

## Worked micro example

Three players, all rated 1500. Player A finishes in the middle (rank 2).

**Seed of A.** Against the two other 1500-rated players:

```
seed_A = 1 + 1/(1 + 10^0) + 1/(1 + 10^0)
       = 1 + 0.5 + 0.5
       = 2
```

**Geometric mean.**

```
m_A = sqrt(seed_A × rank_A) = sqrt(2 × 2) = 2
```

**Performance.** We need the rating `R` whose seed is 2. At 1500 the seed is exactly 2 (from above), so `R = 1500`.

**Delta.**

```
Δ_A = (1500 - 1500) / 2 = 0
```

Finishing exactly at your seed pays nothing, as intended. For contrast, the same three-player field with the same seeded player finishing first or last:

| Final rank | `m = sqrt(seed × rank)` | Performance `R` | Delta `(R - 1500)/2` |
| --- | --- | --- | --- |
| 1 | `sqrt(2 × 1) ≈ 1.414` | ≈ 1733.2 | **≈ +116.6** |
| 2 | `sqrt(2 × 2) = 2` | 1500.0 | **0** |
| 3 | `sqrt(2 × 3) ≈ 2.449` | ≈ 1331.8 | **≈ −84.1** |

The asymmetry (a win pays more than a loss costs) is a property of the seed curve and of the halving, not a bug. A three-player field is degenerate — real fields have hundreds of distinct ratings — but the arithmetic is exactly what the code does.

## The deflation step

The official system does not stop at `Δ_i = (R_i - r_i) / 2`. Codeforces applies a correction afterwards to keep the rating pool from inflating:

1. A first pass shifts every delta so the total change across the field is slightly negative (subtracting the mean delta plus about one point).
2. A second pass applies an additional correction of at most 10 points to the highest-rated participants.

The result is that everybody's published delta is a few points lower than the raw formula output, and the effect is capped at roughly 10 points for the top group.

CF HUD **does not apply this correction**. Reasons:

- It is small: typically a few points, at most around 10 for the players it affects most.
- It requires the deltas of the whole field, which the HUD could compute but would make the per-prediction path heavier and more brittle.
- The displayed prediction interval (see below) is wide enough to absorb it, and the interval is what the product asks users to rely on.

Known consequence: for players near a rating boundary (say, trying to cross 1900), the point estimate can be a few points optimistic. Treat the interval, not the point value, as the answer.

## What the HUD shows

The prediction panel is built from the values above:

| Field | Meaning |
| --- | --- |
| Delta | The point estimate `Δ`, rounded for display. |
| New rating | `current rating + Δ`, with its interval. |
| Interval | Conservative range around the point estimate, described below. |
| Confidence | `high` / `medium` / `low`, based on frozen standings, estimated ratings and field size. |
| Notes | `frozen`, `provisional`, `unrated`, `estimatedRatings`, `noRatings`, `smallField`. |

The interval is intentionally conservative. It combines the sensitivity of the delta to a small rank change with an assumed model error:

```
margin    = max(3, round(0.005 × participants))     # ranks on each side
error     = (frozen ? 30 : 20) + 2                  # points
deltaLow  = min(delta, deltaAtRank(rank + margin) - error)
deltaHigh = max(delta, deltaAtRank(rank - margin) + error)
```

So the interval always contains the point estimate and widens when the standings are frozen. Confidence is `low` when the standings are frozen, when more than 5% of the field needed the fallback rating, or when there are fewer than 100 participants; `medium` when any rating was estimated; `high` otherwise. A predicted interval that covers the true delta roughly 90% of the time is the calibration target.

### Needed rank

Goal planning inverts the same math. Given a target rating `r_target`:

```
Δ_target = r_target - r
R_target = r + 2 × Δ_target
m_target = seed(R_target)
rank_needed = m_target² / seed(r)
```

The last line follows from `m² = seed × rank`. The result is clamped to `[1, participants]`; if the required rank falls outside the field, the target is reported as unreachable from that contest. The panel compares the current delta with the target to show `on-track`, `need-up` or `unreachable`, and the UI can phrase the gap as "catch N more people".

## Edge cases

| Case | Behavior |
| --- | --- |
| **Unrated newcomer** | No public rating exists yet. The pool assigns the fallback **1400** and marks the prediction as estimated; the user's own prediction is unavailable when they have no rating at all (`unrated`). Newcomers are seeded through Codeforces' separate provisional system, so their real delta can differ substantially from this formula. Do not rely on a first-contest prediction. |
| **Frozen standings** | During the last part of a contest the standings are frozen and late submissions are hidden. The displayed rank is not the final rank, so the prediction can move significantly either way. The interval error is doubled (20 points), confidence is `low`, and a `frozen` note and badge are shown. |
| **System tests** | Between coding and rating publication, ranks change as submissions fail or pass system tests. Predictions in `PENDING_SYSTEM_TEST` / `SYSTEM_TEST` are marked `provisional`. |
| **Plagiarism re-rulings** | Published rating changes can be revised after the fact (disqualifications, recalculation). Settlement compares against the most recent published changes; an earlier prediction may no longer match. |
| **Participant count** | `participants` is the number of rows in the standings snapshot, not the number of rated participants in `ratingChanges` (which is often larger). The prediction is internally consistent with the snapshot, but copy says "about" for the field size. |
| **Missing ratings** | `user.ratedList` can omit some participants, and a transient failure can make it unavailable entirely. Missing individuals fall back to 1400 (`estimatedRatings`); a completely unavailable list hides the prediction while the rank card keeps working (`noRatings`). |
| **Small fields** | Below 100 participants the formula is noisy and the field is unrepresentative; confidence is `low` and a `smallField` note is added. |
| **Ties** | Tied participants share a `rank`. The formula works with the shared rank, so tied players receive nearly the same prediction. |
| **Deflation omitted** | The published delta can be a few points lower than the point estimate, as described above. |

## Calibration

The formula is public, but its accuracy against the official system is an empirical question. CF HUD ships a harness that answers it on real contests:

```bash
npm run calibrate                  # a few recent finished contests, 2000 participants each
npm run calibrate -- 2226 2200     # explicit contest ids
npm run calibrate -- --limit=500   # quick smoke test
npm run calibrate -- --all         # every rated participant (slow, ~10 min)
```

By default the harness evaluates a deterministic sample of 2000 participants per contest: a full run replays the prediction for every rated participant and takes roughly ten minutes on three large rounds, which is more than a contributor needs for a sanity check.

For each contest the script fetches `contest.standings` and `contest.ratingChanges`, rebuilds the rating pool from `oldRating` (the actual pre-contest ratings), predicts the delta for every rated participant using `rank` and `participants` from the standings, and compares the prediction with `newRating - oldRating`. It runs with `frozen = false` and `phase = FINISHED`, so it measures the formula and interval, not the app's fallback behavior for missing ratings.

This hits the live API and downloads multi-megabyte standings, so it is a manual tool and never runs in CI. It also respects the shared rate limiter.

### Reading the output

The script prints an `=== Overall ===` block with six lines — `samples`, `MAE`, `median |error|`, `p90 |error|`, `bias` and `interval cover` — followed by a `=== By rating band ===` block with one `n` / `MAE` row per rating band.

How to read each line:

- **MAE** — the headline number: on average, how many rating points the prediction is off by, in either direction.
- **median |error|** — the typical case. Much lower than MAE means a few large misses dominate the average.
- **p90 |error|** — the tail. 90% of predictions are at least this close; useful for deciding whether intervals are honest.
- **bias** — systematic error. Positive means predictions are optimistic; negative means pessimistic. A large bias on recent contests usually signals a change in the official system or in the data.
- **interval cover** — the share of real deltas that landed inside the predicted interval. The target is at least 90%; much less means the intervals are too narrow, much more means they are needlessly wide.
- **rating bands** — the same MAE split by pre-contest rating (`0–1200`, `1200–1500`, `1500–1800`, `1800–2100`, `2100–2500`, `2500–4000`). Bands with fewer than 5 samples are suppressed. Accuracy is expected to be worst at the extremes: low-rated and unrated participants are the ones the regular formula models least well.

Reference numbers from development, on a full (non-sampled) run over three rounds in 2026 — Codeforces Round 1095 (Div. 2), Round 1084 (Div. 3) and Round 1109 (Div. 3), **27,639 rated participants**:

| Metric | Value |
| --- | --- |
| Samples | 27,639 |
| MAE | **10.3 points** |
| Median absolute error | 7.7 points |
| p90 absolute error | 21.4 points |
| Bias (predicted − actual) | +0.8 points |
| Interval coverage | **94.7%** (target ≥ 90%) |

| Pre-contest rating | n | MAE |
| --- | --- | --- |
| 0–1200 | 15,776 | 9.9 |
| 1200–1500 | 9,011 | 9.2 |
| 1500–1800 | 2,374 | 15.5 |
| 1800–2100 | 476 | 16.5 |

Bands above 2100 had fewer than five samples in this run and are suppressed by the script. The higher error in the 1500–2100 bands comes from smaller samples and from stronger fields, where a few ranks move the performance rating more.

These are typical observations, not guarantees: contests differ, and the official system can change. If you change the prediction code, run the harness and include before/after numbers in the pull request.

## Accuracy caveats

- **The rank is not final until rating is published.** Late submissions, system tests and re-rulings all change it. The interval exists for this reason; the point value is a convenience.
- **Frozen standings can hide large rank changes.** During the freeze, a player a few ranks below you may already have solved more problems than the visible standings show.
- **The participants denominator is approximate**, as described above.
- **Unrated players are guesses.** The 1400 fallback matches Codeforces' starting point, but newcomers follow a separate provisional system for their first contests.
- **The deflation correction is omitted** (a few points, up to about 10 for the top group).
- **The interval is calibrated on a sample of contests, not a proof.** Coverage around 90% is a target, not a guarantee for every contest or every rating band.
- **Data can be incomplete.** If the rated list is unavailable or stale, the pool is less accurate; the app lowers confidence and flags it.
- **The HUD never predicts final rank.** It predicts the delta implied by the current rank.

## References

- [Open Codeforces Rating System](https://codeforces.com/blog/entry/20762) — the official formula (seed, geometric mean, performance, deflation).
- [New user rating system](https://codeforces.com/blog/entry/77890) — why newcomer predictions are unreliable.
- [Codeforces API documentation](https://codeforces.com/apiHelp) — endpoints, rate limit, response formats.
- [CF-Predictor](https://codeforces.com/blog/entry/50411) — prior art for community rating prediction on Codeforces.
