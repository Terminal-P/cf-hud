import type {
  CfUser,
  ContestPhase,
  GoalPlan,
  Prediction,
  PredictionConfidence,
  PredictionNote,
} from '../types';

/**
 * Rating prediction that mirrors the official Codeforces algorithm
 * (https://codeforces.com/blog/entry/20762):
 *
 *   seed_i    = 1 + Σ_j 1 / (1 + 10^((r_i - r_j) / 400))
 *   m_i       = sqrt(seed_i × rank_i)              // geometric mean
 *   R_i       = rating whose seed equals m_i      // "performance"
 *   Δ_i       = (R_i - r_i) / 2
 *
 * Codeforces then applies a small deflation correction to keep the rating
 * total stable. That correction is at most a few points and is intentionally
 * omitted here: the published prediction interval absorbs it.
 *
 * Calibration: `npm run calibrate` compares this implementation against
 * `contest.ratingChanges` on real contests.
 */

export const FALLBACK_RATING = 1400;

/**
 * Interval half-width, in rating points.
 *
 * Calibrated on 27,639 samples from three 2026 rounds (Div. 2 + Div. 3):
 * MAE 10.3, median 7.7, p90 21.4. A half-width of 20 keeps the published
 * interval at roughly a 90% empirical coverage while staying readable.
 */
export const MODEL_ERROR_POINTS = 20;
export const MODEL_ERROR_POINTS_FROZEN = 30;

const LN10_OVER_400 = Math.LN10 / 400;

export interface RatingPool {
  /** Ratings of official participants, in standings row order. */
  ratings: Float64Array;
  /** lowercase handle -> rating */
  handleRating: Map<string, number>;
  /** lowercase handle -> index into `ratings` */
  handleIndex: Map<string, number>;
  /** Participants whose rating had to be assumed (unrated / missing). */
  estimated: number;
  /** False when no participant had a known rating. */
  usable: boolean;
}

export interface PredictionArgs {
  handle: string;
  rank: number;
  participants: number;
  oldRating: number | null | undefined;
  pool: RatingPool;
  skipIndex: number;
  frozen: boolean;
  phase: ContestPhase;
  /** Optional pre-computed seed at oldRating (saves one O(n) pass). */
  seed0?: number;
}

export type PredictionResult =
  | { ok: true; prediction: Prediction }
  | { ok: false; reason: Extract<PredictionNote, 'unrated' | 'noRatings'> };

/**
 * Build the seeding pool from the full participant list and `user.ratedList`.
 *
 * Unrated newcomers (first contest) have no public rating yet; Codeforces
 * seeds them around 1400. We do the same and flag the prediction as estimated.
 */
export function buildRatingPool(
  handles: string[],
  ratedUsers: Pick<CfUser, 'handle' | 'rating'>[],
): RatingPool {
  const known = new Map<string, number>();
  for (const user of ratedUsers) {
    const rating = user.rating;
    if (typeof rating === 'number' && Number.isFinite(rating) && rating > 0) {
      known.set(user.handle.toLowerCase(), rating);
    }
  }

  const ratings = new Float64Array(handles.length);
  const handleRating = new Map<string, number>();
  const handleIndex = new Map<string, number>();
  let estimated = 0;
  let real = 0;

  handles.forEach((handle, index) => {
    const key = handle.toLowerCase();
    const rating = known.get(key);
    const value = rating ?? FALLBACK_RATING;
    if (rating === undefined) estimated += 1;
    else real += 1;
    ratings[index] = value;
    handleRating.set(key, value);
    handleIndex.set(key, index);
  });

  return {
    ratings,
    handleRating,
    handleIndex,
    estimated,
    usable: real > 0,
  };
}

/** Pool built directly from ratings, mainly for tests and calibration. */
export function createRatingPool(ratings: number[]): RatingPool {
  const values = Float64Array.from(ratings.filter((r) => Number.isFinite(r) && r > 0));
  const handleRating = new Map<string, number>();
  const handleIndex = new Map<string, number>();
  values.forEach((rating, index) => {
    const handle = `u${index}`;
    handleRating.set(handle, rating);
    handleIndex.set(handle, index);
  });
  return { ratings: values, handleRating, handleIndex, estimated: 0, usable: values.length > 0 };
}

/** Expected rank (seed) of `rating` against the pool. */
export function seedAt(rating: number, pool: Pick<RatingPool, 'ratings'>, skipIndex = -1): number {
  const ratings = pool.ratings;
  let sum = 0;
  for (let i = 0; i < ratings.length; i += 1) {
    if (i === skipIndex) continue;
    sum += 1 / (1 + Math.pow(10, (rating - ratings[i]) / 400));
  }
  return 1 + sum;
}

/**
 * Rating whose seed equals `targetSeed` (the official "performance").
 * `seedAt` is monotonically decreasing in rating, so bisection is stable.
 */
export function solvePerformance(
  targetSeed: number,
  pool: Pick<RatingPool, 'ratings'>,
  skipIndex = -1,
): number {
  let lo = -2000;
  let hi = 6000;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (seedAt(mid, pool, skipIndex) > targetSeed) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Rating change implied by finishing at `rank` with `oldRating`. */
export function deltaAtRank(
  rank: number,
  oldRating: number,
  seed0: number,
  pool: Pick<RatingPool, 'ratings'>,
  skipIndex = -1,
): number {
  const targetSeed = Math.sqrt(Math.max(1, seed0) * Math.max(1, rank));
  const performance = solvePerformance(targetSeed, pool, skipIndex);
  return (performance - oldRating) / 2;
}

export function predictRating(args: PredictionArgs): PredictionResult {
  const { handle, rank, participants, oldRating, pool, skipIndex, frozen, phase } = args;

  if (!pool.usable) return { ok: false, reason: 'noRatings' };
  if (oldRating === null || oldRating === undefined || !Number.isFinite(oldRating) || oldRating <= 0) {
    return { ok: false, reason: 'unrated' };
  }
  if (!Number.isFinite(rank) || rank < 1 || participants < 1) {
    return { ok: false, reason: 'noRatings' };
  }

  const seed0 = args.seed0 ?? seedAt(oldRating, pool, skipIndex);
  const performance = solvePerformance(
    Math.sqrt(Math.max(1, seed0) * Math.max(1, rank)),
    pool,
    skipIndex,
  );
  const delta = (performance - oldRating) / 2;

  // Sensitivity: how much the delta moves for a small rank change, plus the
  // observed model error. This is intentionally conservative.
  const margin = Math.max(3, Math.round(participants * 0.005));
  const worseRank = Math.min(participants, rank + margin);
  const betterRank = Math.max(1, rank - margin);
  const error = (frozen ? MODEL_ERROR_POINTS_FROZEN : MODEL_ERROR_POINTS) + 2;
  const deltaLow = Math.min(delta, deltaAtRank(worseRank, oldRating, seed0, pool, skipIndex) - error);
  const deltaHigh = Math.max(delta, deltaAtRank(betterRank, oldRating, seed0, pool, skipIndex) + error);

  const notes: PredictionNote[] = [];
  if (frozen) notes.push('frozen');
  if (phase !== 'FINISHED') notes.push('provisional');
  if (pool.estimated > 0) notes.push('estimatedRatings');
  if (participants < 100) notes.push('smallField');

  const estimatedRatio = participants > 0 ? pool.estimated / participants : 1;
  const confidence: PredictionConfidence =
    frozen || estimatedRatio > 0.05 || participants < 100
      ? 'low'
      : estimatedRatio > 0
        ? 'medium'
        : 'high';

  const round = (value: number) => Math.round(value * 10) / 10;

  return {
    ok: true,
    prediction: {
      handle,
      rank,
      participants,
      oldRating,
      seed: round(seed0),
      performance: round(performance),
      delta: round(delta),
      deltaLow: round(deltaLow),
      deltaHigh: round(deltaHigh),
      newRating: round(oldRating + delta),
      newRatingLow: round(oldRating + deltaLow),
      newRatingHigh: round(oldRating + deltaHigh),
      confidence,
      notes,
    },
  };
}

export interface GoalInput {
  targetRating: number;
  oldRating: number;
  rank: number;
  participants: number;
  pool: RatingPool;
  skipIndex: number;
  seed0?: number;
}

/**
 * Rank needed to reach a target rating.
 *
 * Given the target performance R = r + 2Δ, the required rank is obtained
 * directly from the geometric-mean relation:
 *   m = seed(R),  rank = m² / seed(r)
 */
export function planGoal(input: GoalInput): GoalPlan | null {
  const { targetRating, oldRating, rank, participants, pool, skipIndex } = input;
  if (!pool.usable || !Number.isFinite(oldRating) || oldRating <= 0) return null;
  if (!Number.isFinite(targetRating) || targetRating <= 0) return null;

  const seed0 = input.seed0 ?? seedAt(oldRating, pool, skipIndex);
  const targetDelta = targetRating - oldRating;
  const targetPerformance = oldRating + 2 * targetDelta;
  const targetSeed = Math.max(1.000001, seedAt(targetPerformance, pool, skipIndex));
  const rawRank = (targetSeed * targetSeed) / Math.max(1, seed0);
  const clampedRank = Math.min(participants, Math.max(1, Math.round(rawRank)));

  const currentDelta = deltaAtRank(rank, oldRating, seed0, pool, skipIndex);

  let status: GoalPlan['status'];
  if (currentDelta >= targetDelta) status = 'on-track';
  else if (rawRank < 1 || rawRank > participants) status = 'unreachable';
  else status = 'need-up';

  return {
    targetRating,
    targetDelta,
    currentDelta,
    currentRank: rank,
    neededRank: clampedRank,
    status,
    participants,
  };
}
