import { describe, expect, it } from 'vitest';
import { parseStandings } from '../src/core/standings';
import type { StandingsResponse } from '../src/core/types';

function fixture(): StandingsResponse {
  return {
    contest: {
      id: 1234,
      name: 'Codeforces Round 999 (Div. 2)',
      type: 'CF',
      phase: 'CODING',
      frozen: false,
      durationSeconds: 7200,
      startTimeSeconds: 1_800_000_000,
    },
    problems: [
      { contestId: 1234, index: 'A', name: 'Alpha' },
      { contestId: 1234, index: 'B', name: 'Beta' },
      { contestId: 1234, index: 'C', name: 'Gamma' },
    ],
    rows: [
      {
        party: { members: [{ handle: 'top' }] },
        rank: 1,
        points: 1500,
        penalty: 100,
        successfulHackCount: 2,
        unsuccessfulHackCount: 0,
        problemResults: [
          { points: 500, rejectedAttemptCount: 0, type: 'FINAL', bestSubmissionTimeSeconds: 300 },
          { points: 1000, rejectedAttemptCount: 1, type: 'FINAL', bestSubmissionTimeSeconds: 1200 },
          { points: 0, rejectedAttemptCount: 2, type: 'PRELIMINARY' },
        ],
      },
      {
        party: { members: [{ handle: 'Me' }] },
        rank: 42,
        points: 500,
        penalty: 350,
        successfulHackCount: 0,
        unsuccessfulHackCount: 1,
        problemResults: [
          { points: 500, rejectedAttemptCount: 0, type: 'FINAL', bestSubmissionTimeSeconds: 350 },
          { points: 0, rejectedAttemptCount: 1, type: 'FINAL' },
          { points: 0, rejectedAttemptCount: 0, type: 'FINAL' },
        ],
      },
      {
        party: { members: [{ handle: 'tail' }] },
        rank: 99,
        points: 0,
        penalty: 0,
        successfulHackCount: 0,
        unsuccessfulHackCount: 0,
        problemResults: [
          { points: 0, rejectedAttemptCount: 0, type: 'FINAL' },
          { points: 0, rejectedAttemptCount: 0, type: 'FINAL' },
          { points: 0, rejectedAttemptCount: 0, type: 'FINAL' },
        ],
      },
    ],
  };
}

describe('parseStandings', () => {
  it('extracts the current row case-insensitively', () => {
    const { snapshot } = parseStandings(fixture(), 'me', 1_000);
    expect(snapshot.me?.handle).toBe('Me');
    expect(snapshot.me?.rank).toBe(42);
    expect(snapshot.me?.solved).toBe(1);
    expect(snapshot.participants).toBe(3);
    expect(snapshot.fetchedAt).toBe(1_000);
  });

  it('keeps problem order and computes max points and solve counts', () => {
    const { snapshot } = parseStandings(fixture(), 'me');
    expect(snapshot.problems.map((cell) => cell.index)).toEqual(['A', 'B', 'C']);
    expect(snapshot.problems.map((cell) => cell.pointsPossible)).toEqual([500, 1000, 0]);
    expect(snapshot.problems.map((cell) => cell.solvedCount)).toEqual([2, 1, 0]);
  });

  it('fills the per-problem cells for the current user', () => {
    const { snapshot } = parseStandings(fixture(), 'me');
    const [a, b, c] = snapshot.problems;
    expect(a.mySolved).toBe(true);
    expect(a.myTimeSeconds).toBe(350);
    expect(b.mySolved).toBe(false);
    expect(b.myAttempts).toBe(1);
    expect(c.myAttempts).toBe(0);
  });

  it('indexes every participant by lowercase handle', () => {
    const { rowIndex } = parseStandings(fixture(), 'me');
    expect(rowIndex.size).toBe(3);
    expect(rowIndex.get('top')?.rank).toBe(1);
    expect(rowIndex.get('tail')?.solved).toBe(0);
  });

  it('exposes the rows directly above and below the user', () => {
    const { snapshot } = parseStandings(fixture(), 'me');
    expect(snapshot.neighbors.above?.handle).toBe('top');
    expect(snapshot.neighbors.below?.handle).toBe('tail');
  });

  it('returns null me when the handle is not in the standings', () => {
    const { snapshot } = parseStandings(fixture(), 'ghost');
    expect(snapshot.me).toBeNull();
    expect(snapshot.participants).toBe(3);
  });
});
