/**
 * Calibration harness: reproduce the official rating change on finished
 * contests and report the prediction error.
 *
 *   npm run calibrate            # a few recent contests with published changes
 *   npm run calibrate -- 2226 2200
 *
 * Uses `contest.ratingChanges` as ground truth and the same pipeline as the
 * app (standings -> pool from pre-contest ratings -> prediction).
 *
 * A full run is exact but slow (~10 min for 30k participants), so by default
 * a deterministic sample of 2000 participants per contest is evaluated.
 * Pass `--all` for the exact numbers, or `--limit=500` for a quick smoke test.
 */
import { CodeforcesApi } from '../src/core/api/codeforces';
import { buildRatingPool, predictRating } from '../src/core/rating/predict';
import { parseStandings } from '../src/core/standings';
import type { CfUser } from '../src/core/types';

interface Sample {
  contestId: number;
  handle: string;
  rating: number;
  rank: number;
  predicted: number;
  actual: number;
  low: number;
  high: number;
}

interface ContestWithChanges {
  id: number;
  name: string;
}

const FALLBACK = 1400;

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[index];
}

async function calibrateContest(
  api: CodeforcesApi,
  contest: ContestWithChanges,
  limit: number,
): Promise<Sample[] | null> {
  const standingsCall = await api.standings(contest.id);
  const changesCall = await api.ratingChanges(contest.id);
  const changes = changesCall.result;
  if (changes.length === 0) {
    console.log(`  ! ${contest.id} ${contest.name}: rating changes not published yet, skipped`);
    return null;
  }

  const started = performance.now();
  const parsed = parseStandings(standingsCall.result, 'calibration');
  const parseMs = performance.now() - started;

  // Simulate "ratings at contest start": ratingChanges carries oldRating.
  const changeMap = new Map(changes.map((change) => [change.handle.toLowerCase(), change]));
  const handles = Array.from(parsed.rowIndex.keys());
  const ratedUsers: Pick<CfUser, 'handle' | 'rating'>[] = handles.map((handle) => {
    const change = changeMap.get(handle);
    return { handle, rating: change?.oldRating || FALLBACK };
  });
  const pool = buildRatingPool(handles, ratedUsers);

  const candidates = Array.from(parsed.rowIndex.entries()).filter(([key]) => {
    const change = changeMap.get(key);
    return Boolean(change) && (change?.oldRating ?? 0) > 0;
  });
  const step = limit > 0 ? Math.max(1, Math.ceil(candidates.length / limit)) : 1;
  const sampled = candidates.filter((_, index) => index % step === 0);

  const samples: Sample[] = [];
  for (const [key, row] of sampled) {
    const change = changeMap.get(key);
    if (!change || change.oldRating <= 0) continue;
    const skipIndex = pool.handleIndex.get(key) ?? -1;
    const result = predictRating({
      handle: row.handle,
      rank: row.rank,
      participants: parsed.snapshot.participants,
      oldRating: change.oldRating,
      pool,
      skipIndex,
      frozen: false,
      phase: 'FINISHED',
    });
    if (!result.ok) continue;
    samples.push({
      contestId: contest.id,
      handle: row.handle,
      rating: change.oldRating,
      rank: row.rank,
      predicted: result.prediction.delta,
      actual: change.newRating - change.oldRating,
      low: result.prediction.deltaLow,
      high: result.prediction.deltaHigh,
    });
  }

  console.log(
    `  ${contest.id} ${contest.name}: ${samples.length} sampled of ${candidates.length} rated participants` +
      ` (step ${step}), parse ${parseMs.toFixed(0)} ms, ` +
      `${(standingsCall.result.rows.length / 1000).toFixed(1)}k rows`,
  );
  return samples;
}

function report(samples: Sample[]): void {
  if (samples.length === 0) {
    console.log('\nNo samples; nothing to report.');
    return;
  }
  const errors = samples.map((sample) => Math.abs(sample.predicted - sample.actual));
  const bias = samples.reduce((sum, sample) => sum + (sample.predicted - sample.actual), 0) / samples.length;
  const covered = samples.filter(
    (sample) => sample.actual >= sample.low && sample.actual <= sample.high,
  ).length;
  const meanAbs = errors.reduce((a, b) => a + b, 0) / errors.length;

  console.log('\n=== Overall ===');
  console.log(`samples:        ${samples.length}`);
  console.log(`MAE:            ${meanAbs.toFixed(1)} points`);
  console.log(`median |error|: ${percentile(errors, 50).toFixed(1)} points`);
  console.log(`p90 |error|:    ${percentile(errors, 90).toFixed(1)} points`);
  console.log(`bias:           ${bias.toFixed(1)} points`);
  console.log(`interval cover: ${((covered / samples.length) * 100).toFixed(1)}% (target >= 90%)`);

  console.log('\n=== By rating band ===');
  const bands: [number, number][] = [
    [0, 1200],
    [1200, 1500],
    [1500, 1800],
    [1800, 2100],
    [2100, 2500],
    [2500, 4000],
  ];
  for (const [lo, hi] of bands) {
    const band = samples.filter((sample) => sample.rating >= lo && sample.rating < hi);
    if (band.length < 5) continue;
    const bandMae = band.reduce((sum, sample) => sum + Math.abs(sample.predicted - sample.actual), 0) / band.length;
    console.log(`  ${String(lo).padStart(4)}-${String(hi).padEnd(4)}: n=${String(band.length).padStart(5)}  MAE=${bandMae.toFixed(1)}`);
  }
}

async function discoverContests(api: CodeforcesApi): Promise<ContestWithChanges[]> {
  const { result } = await api.contestList();
  return result
    .filter((contest) => contest.phase === 'FINISHED' && contest.type === 'CF')
    .sort((a, b) => (b.startTimeSeconds ?? 0) - (a.startTimeSeconds ?? 0))
    .slice(0, 4)
    .map((contest) => ({ id: contest.id, name: contest.name }));
}

async function main(): Promise<void> {
  const api = new CodeforcesApi();
  const args = process.argv.slice(2);
  const explicitIds = args.map(Number).filter(Number.isFinite);
  const limitArg = args.find((arg) => arg.startsWith('--limit='));
  const limit = args.includes('--all')
    ? 0
    : Math.max(50, Number(limitArg?.split('=')[1] ?? 2000) || 2000);

  let contests: ContestWithChanges[];
  if (explicitIds.length > 0) {
    const { result } = await api.contestList();
    contests = explicitIds.map((id) => ({
      id,
      name: result.find((contest) => contest.id === id)?.name ?? `contest ${id}`,
    }));
  } else {
    contests = await discoverContests(api);
  }

  console.log(`Calibrating ${contests.length} contest(s), limit ${limit || 'all'}:\n`);
  const all: Sample[] = [];
  for (const contest of contests) {
    try {
      const samples = await calibrateContest(api, contest, limit);
      if (samples) all.push(...samples);
    } catch (error) {
      console.log(`  ! ${contest.id} failed: ${(error as Error).message}`);
    }
  }
  report(all);
}

void main();
