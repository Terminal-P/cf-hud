import { describe, expect, it } from 'vitest';
import { contestClock, selectContest } from '../src/core/contest';
import type { Contest } from '../src/core/types';

function contest(overrides: Partial<Contest> = {}): Contest {
  return {
    id: 1,
    name: 'Codeforces Round 1',
    type: 'CF',
    phase: 'CODING',
    frozen: false,
    durationSeconds: 7200,
    startTimeSeconds: 1_800_000_000,
    ...overrides,
  };
}

describe('selectContest', () => {
  it('picks the single active contest automatically', () => {
    const selection = selectContest([contest()]);
    expect(selection.current?.id).toBe(1);
    expect(selection.active).toHaveLength(1);
  });

  it('honours an explicit preference', () => {
    const selection = selectContest(
      [contest({ id: 1 }), contest({ id: 2, name: 'Div. 2' })],
      2,
    );
    expect(selection.current?.id).toBe(2);
    expect(selection.active).toHaveLength(2);
  });

  it('exposes all active contests so the UI can ask the user', () => {
    const selection = selectContest([contest({ id: 1 }), contest({ id: 2 })], null);
    expect(selection.active.map((item) => item.id)).toEqual([1, 2]);
    expect(selection.current?.id).toBe(1);
  });

  it('finds the next upcoming contest', () => {
    const selection = selectContest([
      contest({ id: 3, phase: 'BEFORE', startTimeSeconds: 1_900_000_000 }),
    ]);
    expect(selection.current).toBeNull();
    expect(selection.upcoming?.id).toBe(3);
  });
});

describe('contestClock', () => {
  it('reports remaining time and progress', () => {
    const clock = contestClock(contest(), (1_800_000_000 + 3600) * 1000);
    expect(clock.remainingMs).toBe(3600 * 1000);
    expect(clock.progress).toBeCloseTo(0.5, 5);
    expect(clock.frozen).toBe(false);
  });

  it('clamps before the start and after the end', () => {
    const before = contestClock(contest(), (1_800_000_000 - 100) * 1000);
    expect(before.elapsedMs).toBe(0);
    expect(before.remainingMs).toBe(7200 * 1000 + 100_000);

    const after = contestClock(contest(), (1_800_000_000 + 9999) * 1000);
    expect(after.elapsedMs).toBe(7200 * 1000);
    expect(after.remainingMs).toBe(0);
  });
});
