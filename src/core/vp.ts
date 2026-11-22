import type {
  Problem,
  RowLookup,
  Submission,
  VpProblemCell,
  VpSession,
  VpSnapshot,
} from './types';

/**
 * Virtual participation support.
 *
 * Codeforces does not expose virtual participants through the (2026-restricted)
 * anonymous `contest.standings` endpoint: that payload contains official
 * participants only. During a virtual round we therefore reconstruct the
 * user's standing from their own submissions (`contest.status?handle=...`) and
 * compare the resulting score with the official ranklist.
 */

/** Verdicts that do not count as a rejected attempt for the penalty. */
const NOT_PENALIZED = new Set(['COMPILATION_ERROR', 'SKIPPED', 'TESTING']);

export function isVirtualSubmission(submission: Submission): boolean {
  return submission.author?.participantType === 'VIRTUAL';
}

/** Virtual submissions of one contest, oldest first. */
export function virtualSubmissions(submissions: Submission[], contestId?: number): Submission[] {
  return submissions
    .filter(
      (submission) =>
        isVirtualSubmission(submission) &&
        (contestId === undefined || submission.contestId === contestId),
    )
    .sort((a, b) => a.relativeTimeSeconds - b.relativeTimeSeconds);
}

/**
 * The virtual start time is carried by the submission author (`Party`).
 * Returns null while the user has not submitted anything yet.
 */
export function detectVirtualStart(submissions: Submission[]): number | null {
  for (const submission of submissions) {
    if (!isVirtualSubmission(submission)) continue;
    const start = submission.author?.startTimeSeconds;
    if (typeof start === 'number' && start > 0) return start;
  }
  return null;
}

export interface VpTotals {
  problems: VpProblemCell[];
  points: number;
  penalty: number;
  solved: number;
  submissionCount: number;
}

/**
 * Rebuild the score exactly like the standings table does:
 * - a problem is solved by the first `OK` submission;
 * - each rejected attempt before it adds 10 penalty minutes (CE/skipped aside);
 * - the solve time adds floor(seconds / 60) penalty minutes.
 */
export function computeVpTotals(
  submissions: Submission[],
  problems: Array<Pick<Problem, 'index' | 'name'>>,
  pointsPossible: number[],
): VpTotals {
  const cells: VpProblemCell[] = problems.map((problem, index) => ({
    index: problem.index,
    name: problem.name,
    pointsPossible: pointsPossible[index] ?? 0,
    solvedCount: 0,
    myPoints: 0,
    myAttempts: 0,
    mySolved: false,
    submissionCount: 0,
  }));
  const byIndex = new Map<string, VpProblemCell>(
    cells.map((cell) => [cell.index, cell] as const),
  );

  let points = 0;
  let penalty = 0;
  let solved = 0;

  for (const submission of submissions) {
    const cell = byIndex.get(submission.problem.index);
    if (!cell) continue;
    cell.submissionCount += 1;
    cell.lastAttemptTimeSeconds = submission.relativeTimeSeconds;
    if (cell.mySolved) continue;

    if (submission.verdict === 'OK') {
      cell.mySolved = true;
      cell.myTimeSeconds = submission.relativeTimeSeconds;
      cell.myPoints = cell.pointsPossible;
      solved += 1;
      points += cell.pointsPossible;
      penalty += Math.floor(submission.relativeTimeSeconds / 60) + 10 * cell.myAttempts;
    } else if (submission.verdict && !NOT_PENALIZED.has(submission.verdict)) {
      cell.myAttempts += 1;
    }
  }

  return { problems: cells, points, penalty, solved, submissionCount: submissions.length };
}

export interface VpRank {
  rank: number;
  neighbors: { above: RowLookup | null; below: RowLookup | null };
}

/**
 * Insert the virtual score into the official ranklist.
 *
 * `rows` must be in standings order (rank ascending). Ties keep the official
 * convention: only strictly better participants are counted.
 */
export function virtualRank(rows: RowLookup[], points: number, penalty: number): VpRank {
  let better = 0;
  let above: RowLookup | null = null;
  let below: RowLookup | null = null;

  for (const row of rows) {
    const isBetter = row.points > points || (row.points === points && row.penalty < penalty);
    if (isBetter) {
      better += 1;
      above = row;
    } else if (!below) {
      below = row;
    }
  }

  return { rank: better + 1, neighbors: { above, below } };
}

export function isVpFinished(session: Pick<VpSession, 'startTimeSeconds' | 'durationSeconds'>, nowSeconds: number): boolean {
  return nowSeconds >= session.startTimeSeconds + session.durationSeconds;
}

export function vpRemainingMs(session: Pick<VpSession, 'startTimeSeconds' | 'durationSeconds'>, nowMs: number): number {
  return Math.max(0, (session.startTimeSeconds + session.durationSeconds) * 1000 - nowMs);
}

export interface BuildVpSnapshotArgs {
  session: VpSession;
  submissions: Submission[];
  problems: Array<Pick<Problem, 'index' | 'name'>>;
  pointsPossible: number[];
  rows: RowLookup[];
  nowSeconds: number;
  fetchedAt: number;
}

export function buildVpSnapshot(args: BuildVpSnapshotArgs): VpSnapshot {
  const totals = computeVpTotals(args.submissions, args.problems, args.pointsPossible);
  const placed = virtualRank(args.rows, totals.points, totals.penalty);
  return {
    contestId: args.session.contestId,
    handle: args.session.handle,
    fetchedAt: args.fetchedAt,
    startTimeSeconds: args.session.startTimeSeconds,
    durationSeconds: args.session.durationSeconds,
    finished: isVpFinished(args.session, args.nowSeconds),
    problems: totals.problems,
    points: totals.points,
    penalty: totals.penalty,
    solved: totals.solved,
    participants: args.rows.length,
    rank: placed.rank,
    neighbors: placed.neighbors,
    submissionCount: totals.submissionCount,
  };
}

/** Present the virtual score as a row, so cards can be reused unchanged. */
export function vpAsRow(snapshot: VpSnapshot): RowLookup {
  return {
    handle: snapshot.handle,
    rank: snapshot.rank,
    points: snapshot.points,
    penalty: snapshot.penalty,
    solved: snapshot.solved,
    successfulHacks: 0,
    unsuccessfulHacks: 0,
    problemResults: snapshot.problems.map((cell) => ({
      points: cell.myPoints,
      rejectedAttemptCount: cell.myAttempts,
      type: 'FINAL' as const,
      bestSubmissionTimeSeconds: cell.myTimeSeconds,
    })),
  };
}
