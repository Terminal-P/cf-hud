import type { Contest, ContestPhase } from './types';

export const ACTIVE_PHASES: ContestPhase[] = ['CODING', 'PENDING_SYSTEM_TEST', 'SYSTEM_TEST'];

export function isActivePhase(phase: ContestPhase): boolean {
  return ACTIVE_PHASES.includes(phase);
}

export function isUpcoming(phase: ContestPhase): boolean {
  return phase === 'BEFORE';
}

export interface ContestClock {
  /** Server time in ms. */
  nowMs: number;
  startMs: number;
  endMs: number;
  remainingMs: number;
  elapsedMs: number;
  /** 0..1 progress, clamped. */
  progress: number;
  isRunning: boolean;
  /** Contest is in its (typically) last hour with frozen standings. */
  frozen: boolean;
}

/** Convert an API contest into a wall-clock view. `nowMs` must be server time. */
export function contestClock(contest: Contest, nowMs: number): ContestClock {
  const startMs = (contest.startTimeSeconds ?? 0) * 1000;
  const durationMs = contest.durationSeconds * 1000;
  const endMs = startMs + durationMs;
  const elapsedMs = Math.min(durationMs, Math.max(0, nowMs - startMs));
  const remainingMs = Math.max(0, endMs - nowMs);
  return {
    nowMs,
    startMs,
    endMs,
    remainingMs,
    elapsedMs,
    progress: durationMs > 0 ? elapsedMs / durationMs : 0,
    isRunning: contest.phase === 'CODING',
    frozen: Boolean(contest.frozen),
  };
}

export interface ContestSelection {
  /** Contest currently being watched (running, pending tests, or finished). */
  current: Contest | null;
  /** Contests in an active phase; more than one means the user must choose. */
  active: Contest[];
  /** Next contest that has not started yet. */
  upcoming: Contest | null;
}

/**
 * Pick the contest the HUD should show.
 *
 * Combined rounds expose multiple contests (Div. 1 + Div. 2) at the same time
 * and registration is not public, so when several are active the UI asks the
 * user to pick one instead of guessing.
 */
export function selectContest(
  contests: Contest[],
  preferredId?: number | null,
  nowSeconds = Date.now() / 1000,
): ContestSelection {
  const active = contests
    .filter((contest) => isActivePhase(contest.phase))
    .sort((a, b) => (a.startTimeSeconds ?? 0) - (b.startTimeSeconds ?? 0));

  const upcoming =
    contests
      .filter((contest) => isUpcoming(contest.phase) && (contest.startTimeSeconds ?? 0) > nowSeconds - 60)
      .sort((a, b) => (a.startTimeSeconds ?? 0) - (b.startTimeSeconds ?? 0))[0] ?? null;

  if (preferredId) {
    const preferred =
      active.find((contest) => contest.id === preferredId) ??
      contests.find((contest) => contest.id === preferredId) ??
      null;
    if (preferred) return { current: preferred, active, upcoming };
  }

  if (active.length === 1) {
    return { current: active[0], active, upcoming };
  }

  return { current: active[0] ?? null, active, upcoming };
}

/** The most recent finished contest, useful right after the round ends. */
export function recentFinished(contests: Contest[], limit = 5): Contest[] {
  return contests
    .filter((contest) => contest.phase === 'FINISHED' && contest.type === 'CF')
    .sort((a, b) => (b.startTimeSeconds ?? 0) - (a.startTimeSeconds ?? 0))
    .slice(0, limit);
}
