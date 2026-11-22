import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CfClient } from '../src/core/api/client';
import { CodeforcesApi } from '../src/core/api/codeforces';
import { clearMemoryCache } from '../src/data/storage';
import type { Contest, RatingChange, StandingsResponse, Submission } from '../src/core/types';
import { SessionStore } from '../src/app/store';

const NOW = 1_800_000_000_000; // fixed "now" for deterministic clocks

function json(data: unknown): Response {
  return new Response(JSON.stringify({ status: 'OK', result: data }), {
    status: 200,
    headers: { 'content-type': 'application/json', date: new Date(NOW).toUTCString() },
  });
}

function failed(comment: string): Response {
  return new Response(JSON.stringify({ status: 'FAILED', comment }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  });
}

function contest(overrides: Partial<Contest>): Contest {
  return {
    id: 100,
    name: 'Codeforces Round 100 (Div. 2)',
    type: 'CF',
    phase: 'CODING',
    frozen: false,
    durationSeconds: 7200,
    startTimeSeconds: NOW / 1000 - 3600,
    ...overrides,
  };
}

function standings(id: number, phase: Contest['phase']): StandingsResponse {
  return {
    contest: contest({ id, phase }),
    problems: [
      { contestId: id, index: 'A', name: 'Alpha' },
      { contestId: id, index: 'B', name: 'Beta' },
    ],
    rows: [
      {
        party: { members: [{ handle: 'friend' }] },
        rank: 1,
        points: 1500,
        penalty: 50,
        successfulHackCount: 0,
        unsuccessfulHackCount: 0,
        problemResults: [
          { points: 500, rejectedAttemptCount: 0, type: 'FINAL', bestSubmissionTimeSeconds: 100 },
          { points: 1000, rejectedAttemptCount: 0, type: 'FINAL', bestSubmissionTimeSeconds: 900 },
        ],
      },
      {
        party: { members: [{ handle: 'me' }] },
        rank: 2,
        points: 500,
        penalty: 300,
        successfulHackCount: 0,
        unsuccessfulHackCount: 0,
        problemResults: [
          { points: 500, rejectedAttemptCount: 0, type: 'FINAL', bestSubmissionTimeSeconds: 300 },
          { points: 0, rejectedAttemptCount: 1, type: 'FINAL' },
        ],
      },
      {
        party: { members: [{ handle: 'other' }] },
        rank: 3,
        points: 0,
        penalty: 0,
        successfulHackCount: 0,
        unsuccessfulHackCount: 0,
        problemResults: [
          { points: 0, rejectedAttemptCount: 0, type: 'FINAL' },
          { points: 0, rejectedAttemptCount: 0, type: 'FINAL' },
        ],
      },
    ],
  };
}

interface FakeApiOptions {
  contests: Contest[];
  phase: Contest['phase'];
  ratingChanges?: RatingChange[];
  standigsFor?: (contestId: number) => StandingsResponse;
  /** Submissions returned by contest.status (virtual participation). */
  contestStatus?: Submission[];
}

/** Official ranklist without the virtual user (VP is unofficial). */
function vpStandings(id: number): StandingsResponse {
  const base = standings(id, 'FINISHED');
  return {
    ...base,
    contest: contest({ id, phase: 'FINISHED' }),
    rows: [
      {
        party: { members: [{ handle: 'friend' }] },
        rank: 1,
        points: 2000,
        penalty: 50,
        successfulHackCount: 0,
        unsuccessfulHackCount: 0,
        problemResults: [
          { points: 500, rejectedAttemptCount: 0, type: 'FINAL', bestSubmissionTimeSeconds: 100 },
          { points: 1000, rejectedAttemptCount: 0, type: 'FINAL', bestSubmissionTimeSeconds: 900 },
        ],
      },
      {
        party: { members: [{ handle: 'third' }] },
        rank: 2,
        points: 0,
        penalty: 0,
        successfulHackCount: 0,
        unsuccessfulHackCount: 0,
        problemResults: [
          { points: 0, rejectedAttemptCount: 0, type: 'FINAL' },
          { points: 0, rejectedAttemptCount: 0, type: 'FINAL' },
        ],
      },
    ],
  };
}

function virtualSubmission(index: string, verdict: string, time: number): Submission {
  return {
    id: time + 1,
    contestId: 100,
    creationTimeSeconds: NOW / 1000,
    relativeTimeSeconds: time,
    verdict,
    problem: { contestId: 100, index, name: `Problem ${index}` },
    author: {
      members: [{ handle: 'me' }],
      participantType: 'VIRTUAL',
      startTimeSeconds: NOW / 1000 - 1800,
    },
  };
}

function makeStore(options: FakeApiOptions): SessionStore {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/user.info')) {
      return json([{ handle: 'me', rating: 1500, maxRating: 1600, rank: 'expert' }]);
    }
    if (url.includes('/contest.list')) return json(options.contests);
    if (url.includes('/contest.standings')) {
      const contestId = Number(new URL(url).searchParams.get('contestId'));
      return json(options.standigsFor?.(contestId) ?? standings(contestId, options.phase));
    }
    if (url.includes('/contest.status')) return json(options.contestStatus ?? []);
    if (url.includes('/user.ratedList')) {
      return json([
        { handle: 'friend', rating: 1800 },
        { handle: 'me', rating: 1500 },
        { handle: 'other', rating: 1200 },
        { handle: 'third', rating: 1100 },
      ]);
    }
    if (url.includes('/contest.ratingChanges')) return json(options.ratingChanges ?? []);
    if (url.includes('/user.rating')) return json([]);
    return failed(`unexpected url ${url}`);
  }) as typeof fetch;

  const api = new CodeforcesApi(new CfClient({ minIntervalMs: 0, fetchImpl, now: () => NOW }));
  return new SessionStore(api, () => NOW);
}

let store: SessionStore;

beforeEach(() => {
  clearMemoryCache();
});

afterEach(() => {
  store?.stop();
});

describe('SessionStore data pipeline', () => {
  it('binds a handle and builds a snapshot, prediction and goal', async () => {
    store = makeStore({ contests: [contest({})], phase: 'CODING' });
    await store.setHandle('me');

    const state = store.getState();
    expect(state.status).toBe('ready');
    expect(state.handle).toBe('me');
    expect(state.snapshot?.participants).toBe(3);
    expect(state.snapshot?.me?.rank).toBe(2);
    expect(state.snapshot?.neighbors.above?.handle).toBe('friend');
    expect(state.snapshot?.neighbors.below?.handle).toBe('other');

    // Mid-field rank for a 1500 player against [1800, 1500, 1200] = no change.
    expect(state.prediction?.ok).toBe(true);
    if (state.prediction?.ok) {
      expect(state.prediction.prediction.delta).toBeCloseTo(0, 0);
      expect(state.prediction.prediction.newRating).toBeCloseTo(1500, 0);
    }

    store.setTargetRating(1600);
    const goal = store.getState().goal;
    expect(goal?.targetDelta).toBe(100);
    expect(goal?.neededRank).toBeGreaterThan(0);
    expect(goal?.status).toBe('need-up');
  });

  it('exposes active contests and lets the user pick one', async () => {
    const div1 = contest({ id: 101, name: 'Codeforces Round 100 (Div. 1)' });
    const div2 = contest({ id: 100 });
    store = makeStore({ contests: [div2, div1], phase: 'CODING' });
    await store.setHandle('me');

    expect(store.getState().activeContests.map((item) => item.id).sort()).toEqual([100, 101]);

    await store.selectContest(101);
    expect(store.getState().settings.contestId).toBe(101);
    expect(store.getState().contest?.id).toBe(101);
  });

  it('tracks watched players using the standings index', async () => {
    store = makeStore({ contests: [contest({})], phase: 'CODING' });
    await store.setHandle('me');
    store.setWatchList(['Friend', 'stranger', 'friend']);

    const watch = store.getState().watch;
    expect(watch.map((entry) => entry.handle)).toEqual(['Friend', 'stranger']);
    expect(watch[0].row?.rank).toBe(1);
    expect(watch[0].prediction?.delta).toBeGreaterThan(0);
    expect(watch[1].row).toBeNull();

    store.removeWatch('friend');
    expect(store.getState().watch.map((entry) => entry.handle)).toEqual(['stranger']);
  });

  it('records official rating changes after the contest', async () => {
    const changes: RatingChange[] = [
      {
        contestId: 100,
        contestName: 'Codeforces Round 100 (Div. 2)',
        handle: 'me',
        rank: 2,
        ratingUpdateTimeSeconds: NOW / 1000,
        oldRating: 1500,
        newRating: 1524,
      },
    ];
    store = makeStore({ contests: [contest({ phase: 'FINISHED' })], phase: 'FINISHED', ratingChanges: changes });
    await store.setHandle('me');
    await store.selectContest(100);

    const settlement = store.getState().settlement;
    expect(settlement?.actual?.newRating).toBe(1524);
    expect(settlement?.actual ? settlement.actual.newRating - settlement.actual.oldRating : 0).toBe(24);
    // Opened after the fact: there was no live prediction to compare against.
    expect(settlement?.predictedDelta).toBeNull();
  });

  it('keeps running when the rating list is unavailable', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/user.info')) return json([{ handle: 'me', rating: 1500 }]);
      if (url.includes('/contest.list')) return json([contest({})]);
      if (url.includes('/contest.standings')) return json(standings(100, 'CODING'));
      if (url.includes('/user.ratedList')) return failed('Internal server error');
      return failed('unexpected');
    }) as typeof fetch;

    store = new SessionStore(
      new CodeforcesApi(new CfClient({ minIntervalMs: 0, fetchImpl, now: () => NOW })),
    );
    await store.setHandle('me');

    const state = store.getState();
    expect(state.status).toBe('ready');
    expect(state.prediction).toEqual({ ok: false, reason: 'noRatings' });
    expect(state.snapshot?.me?.rank).toBe(2);
  });

  it('reports the next round when nothing is running', async () => {
    const upcoming = contest({
      id: 200,
      phase: 'BEFORE',
      startTimeSeconds: NOW / 1000 + 3600,
    });
    store = makeStore({ contests: [upcoming], phase: 'BEFORE' });
    await store.setHandle('me');

    const state = store.getState();
    expect(state.contest).toBeNull();
    expect(state.upcomingContest?.id).toBe(200);
    expect(state.snapshot).toBeNull();
  });
});

describe('SessionStore virtual participation', () => {
  it('detects an active virtual round from submissions', async () => {
    store = makeStore({
      contests: [contest({ phase: 'FINISHED' })],
      phase: 'FINISHED',
      standigsFor: () => vpStandings(100),
      contestStatus: [
        virtualSubmission('A', 'OK', 300),
        virtualSubmission('B', 'WRONG_ANSWER', 900),
        virtualSubmission('B', 'OK', 1200),
      ],
    });
    await store.setHandle('me');
    await store.selectContest(100);

    const state = store.getState();
    expect(state.vp).not.toBeNull();
    expect(state.vp?.session.source).toBe('detected');
    expect(state.vp?.session.startTimeSeconds).toBe(NOW / 1000 - 1800);
    expect(state.vp?.snapshot?.points).toBe(1500);
    expect(state.vp?.snapshot?.penalty).toBe(35);
    expect(state.vp?.snapshot?.rank).toBe(2);
    expect(state.vp?.snapshot?.finished).toBe(false);

    // The cards consume the merged snapshot.
    expect(state.snapshot?.me?.handle).toBe('me');
    expect(state.snapshot?.me?.points).toBe(1500);
    expect(state.snapshot?.me?.rank).toBe(2);
    expect(state.snapshot?.neighbors.above?.handle).toBe('friend');
    expect(state.prediction?.ok).toBe(true);
  });

  it('starts a manual timer and syncs it from the first submission', async () => {
    const submissions: Submission[] = [];
    store = makeStore({
      contests: [contest({ phase: 'FINISHED' })],
      phase: 'FINISHED',
      standigsFor: () => vpStandings(100),
      contestStatus: submissions,
    });
    await store.setHandle('me');
    await store.selectContest(100);
    expect(store.getState().vp).toBeNull();

    await store.startVirtualParticipation();
    let state = store.getState();
    expect(state.vp?.session.source).toBe('manual');
    expect(state.vp?.session.startTimeSeconds).toBe(NOW / 1000);
    expect(state.vp?.snapshot?.points).toBe(0);

    submissions.push(virtualSubmission('A', 'OK', 120));
    await store.refresh(true);
    state = store.getState();
    expect(state.vp?.session.source).toBe('detected');
    expect(state.vp?.session.startTimeSeconds).toBe(NOW / 1000 - 1800);
    expect(state.vp?.snapshot?.points).toBe(500);
    expect(state.vp?.snapshot?.penalty).toBe(2);
  });

  it('accepts an explicit virtual start time', async () => {
    store = makeStore({
      contests: [contest({ phase: 'FINISHED' })],
      phase: 'FINISHED',
      standigsFor: () => vpStandings(100),
      contestStatus: [],
    });
    await store.setHandle('me');
    await store.selectContest(100);

    const activeStart = NOW / 1000 - 900;
    await store.startVirtualParticipation(undefined, activeStart);
    let state = store.getState();
    expect(state.vp?.session.startTimeSeconds).toBe(activeStart);
    expect(state.vp?.session.source).toBe('manual');
    expect(state.vp?.snapshot?.finished).toBe(false);

    // Backfill an already finished virtual round.
    const finishedStart = NOW / 1000 - 9000;
    await store.startVirtualParticipation(undefined, finishedStart);
    state = store.getState();
    expect(state.vp?.session.startTimeSeconds).toBe(finishedStart);
    expect(state.vp?.snapshot?.finished).toBe(true);
  });

  it('stops tracking and suppresses auto-detection', async () => {
    store = makeStore({
      contests: [contest({ phase: 'FINISHED' })],
      phase: 'FINISHED',
      standigsFor: () => vpStandings(100),
      contestStatus: [virtualSubmission('A', 'OK', 300)],
    });
    await store.setHandle('me');
    await store.selectContest(100);
    expect(store.getState().vp).not.toBeNull();

    await store.stopVirtualParticipation();
    expect(store.getState().vp).toBeNull();
    expect(store.getState().snapshot?.me).toBeNull();

    await store.refresh(true);
    expect(store.getState().vp).toBeNull();
    expect(store.getState().snapshot?.me).toBeNull();
  });
});
