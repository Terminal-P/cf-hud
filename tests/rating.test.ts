import { describe, expect, it } from 'vitest';
import {
  buildRatingPool,
  createRatingPool,
  deltaAtRank,
  planGoal,
  predictRating,
  seedAt,
  solvePerformance,
  MODEL_ERROR_POINTS,
  FALLBACK_RATING,
} from '../src/core/rating/predict';

describe('seed', () => {
  it('is 1 + n/2 for an evenly rated field', () => {
    const pool = createRatingPool([1500, 1500, 1500]);
    expect(seedAt(1500, pool)).toBeCloseTo(2.5, 10);
  });

  it('applies the Elo win probability for a 400 point gap', () => {
    const pool = createRatingPool([1500]);
    // seed = 1 + P(the other player beats you)
    expect(seedAt(1900, pool)).toBeCloseTo(1 + 1 / 11, 10);
    expect(seedAt(1100, pool)).toBeCloseTo(1 + 10 / 11, 10);
  });

  it('excludes the participant itself via skipIndex', () => {
    const pool = createRatingPool([1500, 1500]);
    expect(seedAt(1500, pool, 0)).toBeCloseTo(1.5, 10);
  });

  it('is monotonically decreasing in rating', () => {
    const pool = createRatingPool([1200, 1400, 1600, 2000]);
    let previous = Infinity;
    for (let rating = 800; rating <= 2600; rating += 100) {
      const seed = seedAt(rating, pool);
      expect(seed).toBeLessThan(previous);
      previous = seed;
    }
  });
});

describe('solvePerformance', () => {
  it('inverts seedAt', () => {
    const pool = createRatingPool([1200, 1400, 1600, 1800, 2000]);
    for (const rating of [1000, 1400, 1700, 2300]) {
      const seed = seedAt(rating, pool);
      expect(solvePerformance(seed, pool)).toBeCloseTo(rating, 3);
    }
  });
});

describe('deltaAtRank', () => {
  it('is zero when the actual rank equals the seed', () => {
    const pool = createRatingPool([1300, 1500, 1700, 1900, 2100]);
    const oldRating = 1700;
    const seed0 = seedAt(oldRating, pool);
    expect(deltaAtRank(seed0, oldRating, seed0, pool)).toBeCloseTo(0, 6);
  });

  it('is positive for a better-than-expected rank', () => {
    const pool = createRatingPool([1300, 1500, 1700, 1900, 2100]);
    const oldRating = 1700;
    const seed0 = seedAt(oldRating, pool);
    expect(deltaAtRank(1, oldRating, seed0, pool)).toBeGreaterThan(0);
    expect(deltaAtRank(seed0 * 2, oldRating, seed0, pool)).toBeLessThan(0);
  });
});

describe('predictRating', () => {
  const ratings = [1000, 1200, 1400, 1600, 1800, 2000, 2200];

  it('produces a delta inside its own interval', () => {
    const pool = createRatingPool(ratings);
    const result = predictRating({
      handle: 'u3',
      rank: 4,
      participants: 7,
      oldRating: 1600,
      pool,
      skipIndex: 3,
      frozen: false,
      phase: 'CODING',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { prediction } = result;
    expect(prediction.deltaLow).toBeLessThanOrEqual(prediction.delta);
    expect(prediction.deltaHigh).toBeGreaterThanOrEqual(prediction.delta);
    expect(prediction.newRating).toBeCloseTo(1600 + prediction.delta, 6);
  });

  it('flags frozen standings and lowers confidence', () => {
    const pool = createRatingPool(ratings);
    const result = predictRating({
      handle: 'u3',
      rank: 2,
      participants: 7,
      oldRating: 1600,
      pool,
      skipIndex: 3,
      frozen: true,
      phase: 'CODING',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prediction.notes).toContain('frozen');
    expect(result.prediction.confidence).toBe('low');
  });

  it('reports unrated users instead of guessing', () => {
    const pool = createRatingPool(ratings);
    const result = predictRating({
      handle: 'newbie',
      rank: 5,
      participants: 7,
      oldRating: null,
      pool,
      skipIndex: -1,
      frozen: false,
      phase: 'CODING',
    });
    expect(result).toEqual({ ok: false, reason: 'unrated' });
  });

  it('reports missing ratings', () => {
    const pool = createRatingPool([]);
    const result = predictRating({
      handle: 'u0',
      rank: 5,
      participants: 7,
      oldRating: 1500,
      pool,
      skipIndex: -1,
      frozen: false,
      phase: 'CODING',
    });
    expect(result).toEqual({ ok: false, reason: 'noRatings' });
  });

  it('keeps the interval at least the model error wide', () => {
    const pool = createRatingPool(ratings);
    const result = predictRating({
      handle: 'u3',
      rank: 4,
      participants: 7,
      oldRating: 1600,
      pool,
      skipIndex: 3,
      frozen: false,
      phase: 'CODING',
    });
    if (!result.ok) throw new Error('expected prediction');
    expect(result.prediction.deltaHigh - result.prediction.deltaLow).toBeGreaterThanOrEqual(
      MODEL_ERROR_POINTS,
    );
  });
});

describe('planGoal', () => {
  const pool = createRatingPool([1200, 1400, 1500, 1600, 1700, 1800, 1900, 2000]);
  const oldRating = 1600;
  const seed0 = seedAt(oldRating, pool);

  it('needs the expected rank to keep the same rating', () => {
    const goal = planGoal({
      targetRating: oldRating,
      oldRating,
      rank: 4,
      participants: 8,
      pool,
      skipIndex: 3,
    });
    expect(goal).not.toBeNull();
    expect(goal?.neededRank).toBeCloseTo(Math.round(seed0), 0);
  });

  it('requires a better rank for a higher target', () => {
    const safe = planGoal({ targetRating: 1600, oldRating, rank: 4, participants: 8, pool, skipIndex: 3 });
    const ambitious = planGoal({
      targetRating: 1800,
      oldRating,
      rank: 4,
      participants: 8,
      pool,
      skipIndex: 3,
    });
    expect(ambitious?.neededRank).toBeLessThan(safe?.neededRank ?? Infinity);
    expect(ambitious?.targetDelta).toBe(200);
  });

  it('marks unreachable targets', () => {
    const goal = planGoal({
      targetRating: 5000,
      oldRating,
      rank: 4,
      participants: 8,
      pool,
      skipIndex: 3,
    });
    expect(goal?.status).toBe('unreachable');
  });
});

describe('buildRatingPool', () => {
  it('falls back to 1400 for unrated participants and counts them', () => {
    const pool = buildRatingPool(['a', 'b', 'c'], [
      { handle: 'A', rating: 1800 },
      { handle: 'b', rating: 1600 },
    ]);
    expect(pool.ratings[0]).toBe(1800);
    expect(pool.ratings[2]).toBe(FALLBACK_RATING);
    expect(pool.estimated).toBe(1);
    expect(pool.usable).toBe(true);
    expect(pool.handleIndex.get('c')).toBe(2);
  });

  it('is unusable without any known rating', () => {
    const pool = buildRatingPool(['a', 'b'], []);
    expect(pool.usable).toBe(false);
  });
});
