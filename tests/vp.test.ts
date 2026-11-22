import { describe, expect, it } from 'vitest';
import {
  buildVpSnapshot,
  computeVpTotals,
  detectVirtualStart,
  isVpFinished,
  vpAsRow,
  vpRemainingMs,
  virtualRank,
  virtualSubmissions,
} from '../src/core/vp';
import type { RowLookup, Submission, VpSession } from '../src/core/types';

const PROBLEMS = [
  { index: 'A', name: 'Alpha' },
  { index: 'B', name: 'Beta' },
  { index: 'C', name: 'Gamma' },
];
const POINTS = [500, 1000, 1500];

function submission(
  index: string,
  verdict: string | undefined,
  time: number,
  participantType = 'VIRTUAL',
  startTimeSeconds?: number,
): Submission {
  return {
    id: time + 1,
    contestId: 7,
    creationTimeSeconds: 1_800_000_000,
    relativeTimeSeconds: time,
    verdict,
    problem: { contestId: 7, index, name: `Problem ${index}` },
    author: {
      members: [{ handle: 'me' }],
      participantType,
      startTimeSeconds: startTimeSeconds ?? 1_799_998_200,
    },
  };
}

function row(handle: string, rank: number, points: number, penalty: number): RowLookup {
  return {
    handle,
    rank,
    points,
    penalty,
    solved: points > 0 ? 1 : 0,
    successfulHacks: 0,
    unsuccessfulHacks: 0,
    problemResults: [],
  };
}

const SESSION: VpSession = {
  contestId: 7,
  handle: 'me',
  startTimeSeconds: 1_799_998_200,
  durationSeconds: 7200,
  source: 'detected',
  createdAt: 1_799_998_200_000,
};

describe('virtual submissions', () => {
  it('keeps only virtual ones and sorts them by relative time', () => {
    const list = [
      submission('B', 'OK', 900),
      submission('A', 'OK', 100),
      submission('C', 'WRONG_ANSWER', 400, 'PRACTICE'),
    ];
    const virtual = virtualSubmissions(list, 7);
    expect(virtual.map((item) => item.problem.index)).toEqual(['A', 'B']);
  });

  it('reads the virtual start from the author party', () => {
    expect(detectVirtualStart([submission('A', 'OK', 100)])).toBe(1_799_998_200);
    expect(detectVirtualStart([submission('A', 'OK', 100, 'PRACTICE')])).toBeNull();
    expect(detectVirtualStart([])).toBeNull();
  });
});

describe('computeVpTotals', () => {
  it('scores solved problems and penalties like the standings', () => {
    const totals = computeVpTotals(
      [submission('A', 'OK', 300), submission('B', 'WRONG_ANSWER', 900), submission('B', 'OK', 1200)],
      PROBLEMS,
      POINTS,
    );
    expect(totals.points).toBe(1500);
    // A: floor(300/60)=5; B: floor(1200/60)=20 + 1 rejected * 10
    expect(totals.penalty).toBe(35);
    expect(totals.solved).toBe(2);
    expect(totals.problems[0].mySolved).toBe(true);
    expect(totals.problems[0].myTimeSeconds).toBe(300);
    expect(totals.problems[1].myAttempts).toBe(1);
    expect(totals.problems[2].mySolved).toBe(false);
  });

  it('does not penalize compilation errors', () => {
    const totals = computeVpTotals(
      [submission('A', 'COMPILATION_ERROR', 100), submission('A', 'OK', 200)],
      PROBLEMS,
      POINTS,
    );
    expect(totals.penalty).toBe(Math.floor(200 / 60));
    expect(totals.problems[0].myAttempts).toBe(0);
  });

  it('counts rejected attempts on unsolved problems', () => {
    const totals = computeVpTotals(
      [submission('C', 'WRONG_ANSWER', 100), submission('C', 'TIME_LIMIT_EXCEEDED', 200)],
      PROBLEMS,
      POINTS,
    );
    expect(totals.problems[2].myAttempts).toBe(2);
    expect(totals.problems[2].myPoints).toBe(0);
    expect(totals.points).toBe(0);
  });

  it('ignores submissions after the first accepted one', () => {
    const totals = computeVpTotals(
      [submission('A', 'OK', 100), submission('A', 'WRONG_ANSWER', 300), submission('A', 'OK', 400)],
      PROBLEMS,
      POINTS,
    );
    expect(totals.points).toBe(500);
    expect(totals.penalty).toBe(Math.floor(100 / 60));
    expect(totals.problems[0].submissionCount).toBe(3);
  });
});

describe('virtualRank', () => {
  const rows = [
    row('first', 1, 2000, 50),
    row('second', 2, 1500, 100),
    row('third', 3, 1000, 30),
    row('last', 4, 0, 0),
  ];

  it('inserts the score by points then penalty', () => {
    const placed = virtualRank(rows, 1500, 80);
    expect(placed.rank).toBe(2);
    expect(placed.neighbors.above?.handle).toBe('first');
    expect(placed.neighbors.below?.handle).toBe('second');
  });

  it('keeps ties on the official convention', () => {
    const placed = virtualRank(rows, 1000, 30);
    expect(placed.rank).toBe(3);
    expect(placed.neighbors.below?.handle).toBe('third');
  });

  it('places a zero score behind everyone with points', () => {
    const placed = virtualRank(rows, 0, 0);
    expect(placed.rank).toBe(4);
    expect(placed.neighbors.above?.handle).toBe('third');
  });
});

describe('virtual participation snapshot', () => {
  it('marks an active session and counts the official field', () => {
    const snapshot = buildVpSnapshot({
      session: SESSION,
      submissions: [submission('A', 'OK', 300)],
      problems: PROBLEMS,
      pointsPossible: POINTS,
      rows: [row('first', 1, 2000, 50), row('last', 2, 0, 0)],
      nowSeconds: 1_799_999_000,
      fetchedAt: 1_799_999_000_000,
    });
    expect(snapshot.finished).toBe(false);
    expect(snapshot.rank).toBe(2);
    expect(snapshot.participants).toBe(2);
    expect(snapshot.points).toBe(500);
    expect(snapshot.handle).toBe('me');
  });

  it('marks the session finished after the virtual clock runs out', () => {
    const snapshot = buildVpSnapshot({
      session: SESSION,
      submissions: [],
      problems: PROBLEMS,
      pointsPossible: POINTS,
      rows: [row('first', 1, 2000, 50)],
      nowSeconds: SESSION.startTimeSeconds + SESSION.durationSeconds + 1,
      fetchedAt: 1_800_000_000_000,
    });
    expect(snapshot.finished).toBe(true);
  });

  it('renders the virtual score as a standings row', () => {
    const snapshot = buildVpSnapshot({
      session: SESSION,
      submissions: [submission('A', 'OK', 300), submission('B', 'WRONG_ANSWER', 400)],
      problems: PROBLEMS,
      pointsPossible: POINTS,
      rows: [],
      nowSeconds: 1_799_999_000,
      fetchedAt: 1_799_999_000_000,
    });
    const asRow = vpAsRow(snapshot);
    expect(asRow.handle).toBe('me');
    expect(asRow.points).toBe(500);
    expect(asRow.problemResults[0]).toMatchObject({ points: 500, type: 'FINAL', bestSubmissionTimeSeconds: 300 });
    expect(asRow.problemResults[1]).toMatchObject({ points: 0, rejectedAttemptCount: 1 });
  });
});

describe('virtual clock helpers', () => {
  it('is finished only after start + duration', () => {
    expect(isVpFinished(SESSION, SESSION.startTimeSeconds + 10)).toBe(false);
    expect(isVpFinished(SESSION, SESSION.startTimeSeconds + SESSION.durationSeconds)).toBe(true);
  });

  it('reports remaining milliseconds', () => {
    expect(vpRemainingMs(SESSION, (SESSION.startTimeSeconds + 100) * 1000)).toBe(7100 * 1000);
    expect(vpRemainingMs(SESSION, (SESSION.startTimeSeconds + 99999) * 1000)).toBe(0);
  });
});
