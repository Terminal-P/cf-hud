import type {
  ProblemCell,
  RanklistRow,
  RowLookup,
  Snapshot,
  StandingsResponse,
} from './types';

export interface ParsedStandings {
  snapshot: Snapshot;
  /** Every participant keyed by lowercase handle, for watch-list lookups. */
  rowIndex: Map<string, RowLookup>;
}

function solveCount(row: RanklistRow): number {
  return row.problemResults.reduce((n, result) => (result.points > 0 ? n + 1 : n), 0);
}

function toRowLookup(row: RanklistRow): RowLookup {
  return {
    handle: row.party.members[0]?.handle ?? '',
    rank: row.rank,
    points: row.points,
    penalty: row.penalty,
    solved: solveCount(row),
    successfulHacks: row.successfulHackCount,
    unsuccessfulHacks: row.unsuccessfulHackCount,
    problemResults: row.problemResults,
  };
}

/**
 * Normalize a `contest.standings` response.
 *
 * The API hands us the full list (several MB), so this is the single place
 * where the heavy payload is turned into the small model the UI renders.
 */
export function parseStandings(
  raw: StandingsResponse,
  handle: string,
  fetchedAt = Date.now(),
): ParsedStandings {
  const { contest, problems, rows } = raw;
  const lowerHandle = handle.trim().toLowerCase();

  const rowIndex = new Map<string, RowLookup>();
  for (const row of rows) {
    const lookup = toRowLookup(row);
    if (lookup.handle) rowIndex.set(lookup.handle.toLowerCase(), lookup);
  }

  const problemCount = problems.length;
  const pointsPossible = new Array<number>(problemCount).fill(0);
  const solvedCounts = new Array<number>(problemCount).fill(0);
  for (const row of rows) {
    for (let i = 0; i < problemCount; i += 1) {
      const result = row.problemResults[i];
      if (!result) continue;
      if (result.points > pointsPossible[i]) pointsPossible[i] = result.points;
      if (result.points > 0) solvedCounts[i] += 1;
    }
  }

  const me = rowIndex.get(lowerHandle) ?? null;
  // The API sometimes advertises the fixed problem points; prefer that value
  // over the maximum we observed (a problem nobody solved would otherwise be 0).
  for (let i = 0; i < problemCount; i += 1) {
    const advertised = problems[i].points;
    if (typeof advertised === 'number' && advertised > 0) pointsPossible[i] = advertised;
  }
  let neighbors: Snapshot['neighbors'] = { above: null, below: null };
  if (me) {
    const myRowIndex = rows.findIndex(
      (row) => row.party.members[0]?.handle.toLowerCase() === lowerHandle,
    );
    const above = myRowIndex > 0 ? toRowLookup(rows[myRowIndex - 1]) : null;
    const below = myRowIndex >= 0 && myRowIndex < rows.length - 1 ? toRowLookup(rows[myRowIndex + 1]) : null;
    neighbors = { above, below };
  }

  const cells: ProblemCell[] = problems.map((problem, i) => {
    const result = me?.problemResults[i];
    return {
      index: problem.index,
      name: problem.name,
      pointsPossible: pointsPossible[i],
      solvedCount: solvedCounts[i],
      myPoints: result?.points ?? 0,
      myAttempts: result?.rejectedAttemptCount ?? 0,
      mySolved: (result?.points ?? 0) > 0,
      myTimeSeconds: result?.bestSubmissionTimeSeconds,
    };
  });

  const snapshot: Snapshot = {
    contestId: contest.id,
    contestName: contest.name,
    contestType: contest.type,
    phase: contest.phase,
    frozen: Boolean(contest.frozen),
    startTimeSeconds: contest.startTimeSeconds ?? 0,
    durationSeconds: contest.durationSeconds,
    fetchedAt,
    participants: rows.length,
    me,
    neighbors,
    problems: cells,
  };

  return { snapshot, rowIndex };
}
