import { CfApiError } from '../core/api/client';
import { CodeforcesApi } from '../core/api/codeforces';
import { selectContest } from '../core/contest';
import { buildRatingPool, planGoal, predictRating, type RatingPool, type PredictionResult } from '../core/rating/predict';
import { parseStandings } from '../core/standings';
import type {
  Contest,
  GoalPlan,
  HistoryPoint,
  Prediction,
  RankPoint,
  RowLookup,
  Settlement,
  Snapshot,
  WatchEntry,
} from '../core/types';
import {
  cacheGet,
  cacheSet,
  getRankHistory,
  loadSettings,
  saveSettings,
  setRankHistory,
  type Settings,
} from '../data/storage';

export type SessionStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface SessionState {
  status: SessionStatus;
  error: string | null;
  handle: string;
  contest: Contest | null;
  activeContests: Contest[];
  upcomingContest: Contest | null;
  snapshot: Snapshot | null;
  prediction: PredictionResult | null;
  goal: GoalPlan | null;
  watch: WatchEntry[];
  rankHistory: RankPoint[];
  settlement: Settlement | null;
  ratingHistory: HistoryPoint[];
  lastUpdated: number | null;
  nextRefreshAt: number | null;
  refreshing: boolean;
  serverTimeOffsetMs: number;
  settings: Settings;
}

export type SessionEvent =
  | { type: 'rank-dropped'; by: number; rank: number }
  | { type: 'goal-lost'; predicted: number; target: number }
  | { type: 'time-left'; minutes: number }
  | { type: 'rating-updated'; delta: number; newRating: number }
  | { type: 'contest-finished'; contest: Contest };

type Listener = (state: SessionState) => void;
type EventListener = (event: SessionEvent) => void;

const RANK_HISTORY_LIMIT = 720;
const CONTEST_LIST_TTL = 5 * 60_000;
const RATED_LIST_TTL = 12 * 60 * 60_000;

function initialState(settings: Settings): SessionState {
  return {
    status: 'idle',
    error: null,
    handle: settings.handle,
    contest: null,
    activeContests: [],
    upcomingContest: null,
    snapshot: null,
    prediction: null,
    goal: null,
    watch: [],
    rankHistory: [],
    settlement: null,
    ratingHistory: [],
    lastUpdated: null,
    nextRefreshAt: null,
    refreshing: false,
    serverTimeOffsetMs: 0,
    settings,
  };
}

/**
 * The single source of truth for the HUD.
 *
 * Keeps polling, caching and all derivations (prediction, goal, watch list,
 * settlement) outside React so the UI can stay a pure renderer.
 */
export class SessionStore {
  private state: SessionState;
  private readonly api: CodeforcesApi;
  private readonly listeners = new Set<Listener>();
  private readonly eventListeners = new Set<EventListener>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private refreshing = false;

  private poolCache = new Map<number, RatingPool>();
  private lastRowIndex = new Map<string, RowLookup>();
  private lastPool: RatingPool | null = null;
  private lastSnapshot: Snapshot | null = null;
  private notifiedTimeMarkers = new Set<string>();
  private lastContestPhase: string | null = null;
  private settlementCheckedAt = 0;

  constructor(api: CodeforcesApi = new CodeforcesApi()) {
    this.api = api;
    const settings = loadSettings();
    this.state = initialState(settings);
  }

  /* ---------------------------------------------------------------- */
  /* Public surface                                                    */
  /* ---------------------------------------------------------------- */

  getState = (): SessionState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  onEvent = (listener: EventListener): (() => void) => {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  };

  get serverNow(): number {
    return Date.now() + this.state.serverTimeOffsetMs;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    if (this.state.settings.handle) {
      void this.refresh(true);
    } else {
      this.setState({ status: 'idle' });
    }
  }

  stop(): void {
    this.stopped = true;
    this.clearTimer();
    this.setState({ nextRefreshAt: null });
  }

  async setHandle(rawHandle: string): Promise<void> {
    const handle = rawHandle.trim();
    if (!handle) {
      this.patchSettings({ handle: '' });
      this.setState({ status: 'idle', handle: '', error: null });
      return;
    }

    this.setState({ status: this.state.snapshot ? this.state.status : 'loading', error: null });
    try {
      const { result, serverTimeMs } = await this.api.userInfo([handle]);
      const user = result[0];
      if (!user) throw new Error(`User "${handle}" not found`);
      this.patchSettings({ handle: user.handle, hasOnboarded: true });
      this.setState({ handle: user.handle, status: 'loading', error: null });
      await this.refresh(true);
    } catch (error) {
      const message = errorMessage(error);
      this.setState({ status: this.state.snapshot ? 'ready' : 'error', error: message });
      throw error;
    }
  }

  async selectContest(contestId: number | null): Promise<void> {
    this.patchSettings({ contestId });
    this.setState({ rankHistory: [], settlement: null });
    await this.refresh(true);
  }

  async refresh(force = false): Promise<void> {
    if (this.refreshing && !force) return;
    if (this.refreshing) return;
    this.refreshing = true;
    this.setState({ refreshing: true, error: null });
    this.clearTimer();

    try {
      const contests = await this.getContests();
      const selection = selectContest(contests, this.state.settings.contestId, this.serverNow / 1000);
      const activeContests = selection.active;
      const upcomingContest = selection.upcoming;

      if (!selection.current) {
        this.setState({
          status: 'idle',
          contest: null,
          activeContests,
          upcomingContest,
          nextRefreshAt: Date.now() + 5 * 60_000,
        });
        this.schedule(5 * 60_000);
        return;
      }

      const contest = selection.current;
      if (contest.phase === 'BEFORE') {
        this.setState({
          status: 'ready',
          contest,
          activeContests,
          upcomingContest: contest,
          nextRefreshAt: Date.now() + 30_000,
        });
        const untilStart = Math.max(10_000, ((contest.startTimeSeconds ?? 0) * 1000 - this.serverNow) + 5_000);
        this.schedule(Math.min(untilStart, 5 * 60_000));
        return;
      }

      const standingsCall = await this.api.standings(contest.id);
      if (standingsCall.serverTimeMs !== null) {
        this.state = {
          ...this.state,
          serverTimeOffsetMs: standingsCall.serverTimeMs - Date.now(),
        };
      }

      const parsed = parseStandings(standingsCall.result, this.state.handle, Date.now());
      const snapshot = parsed.snapshot;
      this.lastRowIndex = parsed.rowIndex;
      this.lastSnapshot = snapshot;

      const handles = Array.from(parsed.rowIndex.keys());
      const pool = await this.ensurePool(contest.id, handles);
      this.lastPool = pool;

      const myKey = this.state.handle.toLowerCase();
      const myRow = parsed.rowIndex.get(myKey) ?? null;
      const skipIndex = pool?.handleIndex.get(myKey) ?? -1;
      const oldRating = pool?.handleRating.get(myKey) ?? null;

      // After the round is finished the public ratings may already contain the
      // new result, so a fresh prediction would use the wrong baseline. Keep the
      // last live prediction (used by the settlement card) and stop recomputing.
      const finished = snapshot.phase === 'FINISHED';
      const prediction = finished
        ? this.state.prediction
        : this.computePrediction(myRow, oldRating, pool, snapshot, skipIndex);
      const goal = finished ? this.state.goal : this.computeGoal(myRow, oldRating, pool, snapshot, skipIndex);
      const watch = this.computeWatch(pool, snapshot);
      const rankHistory = await this.updateRankHistory(snapshot);
      const settlement = await this.ensureSettlement(contest, prediction);
      const ratingHistory = settlement?.actual ? await this.loadRatingHistory() : this.state.ratingHistory;

      const previousPrediction = this.state.prediction;
      const previousRank = this.state.snapshot?.me?.rank ?? null;
      const previousPhase = this.state.contest?.phase ?? null;
      const previousSettlement = this.state.settlement;

      this.state = {
        ...this.state,
        status: 'ready',
        error: null,
        contest: { ...contest, ...standingsCall.result.contest },
        activeContests,
        upcomingContest,
        snapshot,
        prediction,
        goal,
        watch,
        rankHistory,
        settlement,
        ratingHistory,
        lastUpdated: snapshot.fetchedAt,
        refreshing: false,
      };
      this.emit();

      this.detectEvents({
        previousRank,
        previousPrediction,
        previousPhase,
        previousSettlement,
        snapshot,
        settlement,
      });
      this.lastContestPhase = snapshot.phase;
      this.schedule(this.nextDelay(snapshot));
    } catch (error) {
      const message = errorMessage(error);
      const backoff = Math.min(5 * 60_000, Math.max(30_000, this.state.settings.pollSeconds * 1000) * 2);
      const isNotStarted = error instanceof CfApiError && error.isNotStarted;
      this.setState({
        status: snapshotOrIdle(this.state),
        error: isNotStarted ? null : message,
        refreshing: false,
        nextRefreshAt: Date.now() + (isNotStarted ? 30_000 : backoff),
      });
      this.schedule(isNotStarted ? 30_000 : backoff);
    } finally {
      this.refreshing = false;
    }
  }

  setTargetRating(target: number | null): void {
    this.patchSettings({ targetRating: target && target > 0 ? Math.round(target) : null });
    const row = this.lastSnapshot?.me ?? null;
    const myKey = this.state.handle.toLowerCase();
    const pool = this.lastPool;
    const oldRating = pool?.handleRating.get(myKey) ?? null;
    this.setState({
      goal: this.computeGoal(row, oldRating, pool, this.lastSnapshot, pool?.handleIndex.get(myKey) ?? -1),
    });
  }

  setWatchList(handles: string[]): void {
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const raw of handles) {
      const handle = raw.trim();
      if (!handle) continue;
      const key = handle.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(handle);
    }
    this.patchSettings({ watchList: unique });
    this.setState({ watch: this.computeWatch(this.lastPool, this.lastSnapshot) });
  }

  addWatch(handle: string): void {
    this.setWatchList([...this.state.settings.watchList, handle]);
  }

  removeWatch(handle: string): void {
    const key = handle.toLowerCase();
    this.setWatchList(this.state.settings.watchList.filter((item) => item.toLowerCase() !== key));
  }

  updateSettings(patch: Partial<Settings>): void {
    this.patchSettings(patch);
    if (patch.pollSeconds !== undefined) this.schedule(this.nextDelay(this.lastSnapshot));
  }

  /* ---------------------------------------------------------------- */
  /* Internals                                                         */
  /* ---------------------------------------------------------------- */

  private computePrediction(
    row: RowLookup | null,
    oldRating: number | null,
    pool: RatingPool | null,
    snapshot: Snapshot,
    skipIndex: number,
  ): PredictionResult | null {
    if (!row) return null;
    // Without the participant rating pool a seed cannot be built at all.
    if (!pool) return { ok: false, reason: 'noRatings' };
    return predictRating({
      handle: row.handle,
      rank: row.rank,
      participants: snapshot.participants,
      oldRating,
      pool,
      skipIndex,
      frozen: snapshot.frozen,
      phase: snapshot.phase,
    });
  }

  private computeGoal(
    row: RowLookup | null,
    oldRating: number | null,
    pool: RatingPool | null,
    snapshot: Snapshot | null,
    skipIndex: number,
  ): GoalPlan | null {
    const target = this.state.settings.targetRating;
    if (!row || !pool || !snapshot || !oldRating || !target) return null;
    return planGoal({
      targetRating: target,
      oldRating,
      rank: row.rank,
      participants: snapshot.participants,
      pool,
      skipIndex,
    });
  }

  private computeWatch(pool: RatingPool | null, snapshot: Snapshot | null): WatchEntry[] {
    return this.state.settings.watchList.map((handle) => {
      const key = handle.toLowerCase();
      const row = this.lastRowIndex.get(key) ?? null;
      if (!row || !snapshot) return { handle, row: null, prediction: null };
      // Deltas are meaningless once official ratings are published.
      if (!pool || snapshot.phase === 'FINISHED') return { handle, row, prediction: null };
      const skipIndex = pool.handleIndex.get(key) ?? -1;
      const oldRating = pool.handleRating.get(key) ?? null;
      const result = predictRating({
        handle: row.handle,
        rank: row.rank,
        participants: snapshot.participants,
        oldRating,
        pool,
        skipIndex,
        frozen: snapshot.frozen,
        phase: snapshot.phase,
      });
      return { handle, row, prediction: result.ok ? result.prediction : null };
    });
  }

  private async getContests(): Promise<Contest[]> {
    const current = this.state.contest;
    const startPassed =
      current?.phase === 'BEFORE' &&
      current.startTimeSeconds !== undefined &&
      this.serverNow / 1000 > current.startTimeSeconds + 15;
    const cached = startPassed ? null : await cacheGet<Contest[]>('contest-list', CONTEST_LIST_TTL);
    if (cached) return cached;
    const { result, serverTimeMs } = await this.api.contestList();
    if (serverTimeMs !== null) this.state = { ...this.state, serverTimeOffsetMs: serverTimeMs - Date.now() };
    await cacheSet('contest-list', result);
    return result;
  }

  private async ensurePool(contestId: number, handles: string[]): Promise<RatingPool | null> {
    const cached = this.poolCache.get(contestId);
    if (cached) return cached;

    try {
      let users = await cacheGet<Parameters<typeof buildRatingPool>[1]>(
        `rated:${contestId}`,
        RATED_LIST_TTL,
      );
      if (!users) {
        const { result } = await this.api.ratedList(contestId);
        users = result;
        await cacheSet(`rated:${contestId}`, result);
      }
      const pool = buildRatingPool(handles, users);
      if (!pool.usable) return null;
      this.poolCache.set(contestId, pool);
      return pool;
    } catch {
      // Rating list unavailable (rate limit / transient): rank card still works.
      return null;
    }
  }

  private async updateRankHistory(snapshot: Snapshot): Promise<RankPoint[]> {
    const row = snapshot.me;
    if (!row) return this.state.rankHistory;

    let history = this.state.rankHistory;
    if (history.length === 0) history = await getRankHistory(snapshot.contestId);

    const last = history[history.length - 1];
    const changed = !last || last.rank !== row.rank || last.points !== row.points;
    const stale = !last || snapshot.fetchedAt - last.t > 5 * 60_000;
    if (!changed && !stale) return history;

    const next = [...history, { t: snapshot.fetchedAt, rank: row.rank, points: row.points, solved: row.solved }];
    const trimmed = next.length > RANK_HISTORY_LIMIT ? next.slice(next.length - RANK_HISTORY_LIMIT) : next;
    void setRankHistory(snapshot.contestId, trimmed);
    return trimmed;
  }

  private async ensureSettlement(
    contest: Contest,
    prediction: PredictionResult | null,
  ): Promise<Settlement | null> {
    if (contest.phase !== 'FINISHED') return null;
    const now = Date.now();
    const existing = this.state.settlement;
    if (existing?.actual && existing.contestId === contest.id) return existing;
    if (now - this.settlementCheckedAt < 4 * 60_000 && existing?.contestId === contest.id) return existing;
    this.settlementCheckedAt = now;

    try {
      const { result } = await this.api.ratingChanges(contest.id);
      const actual = result.find((change) => change.handle.toLowerCase() === this.state.handle.toLowerCase()) ?? null;
      const predictedDelta = prediction?.ok ? prediction.prediction.delta : existing?.predictedDelta ?? null;
      return {
        contestId: contest.id,
        checkedAt: now,
        actual,
        predictedDelta,
        history: existing?.history ?? [],
      };
    } catch {
      return existing;
    }
  }

  private async loadRatingHistory(): Promise<HistoryPoint[]> {
    if (!this.state.handle) return [];
    const cacheKey = `rating-history:${this.state.handle.toLowerCase()}`;
    const cached = await cacheGet<HistoryPoint[]>(cacheKey, 60 * 60_000);
    if (cached) return cached;
    try {
      const { result } = await this.api.userRating(this.state.handle);
      const points: HistoryPoint[] = result.map((change) => ({
        t: change.ratingUpdateTimeSeconds,
        rating: change.newRating,
        contestName: change.contestName,
        contestId: change.contestId,
      }));
      await cacheSet(cacheKey, points);
      return points;
    } catch {
      return [];
    }
  }

  private detectEvents(args: {
    previousRank: number | null;
    previousPrediction: PredictionResult | null;
    previousPhase: string | null;
    previousSettlement: Settlement | null;
    snapshot: Snapshot;
    settlement: Settlement | null;
  }): void {
    const {
      previousRank,
      previousPrediction,
      previousPhase,
      previousSettlement,
      snapshot,
      settlement,
    } = args;

    if (previousPhase && previousPhase !== 'FINISHED' && snapshot.phase === 'FINISHED') {
      this.emitEvent({ type: 'contest-finished', contest: this.state.contest as Contest });
    }

    if (snapshot.phase === 'CODING' && previousRank !== null && snapshot.me) {
      const delta = snapshot.me.rank - previousRank;
      if (delta > 0) this.emitEvent({ type: 'rank-dropped', by: delta, rank: snapshot.me.rank });
    }

    const target = this.state.settings.targetRating;
    if (
      target &&
      previousPrediction?.ok &&
      this.state.prediction?.ok &&
      previousPrediction.prediction.newRating >= target &&
      this.state.prediction.prediction.newRating < target
    ) {
      this.emitEvent({
        type: 'goal-lost',
        predicted: this.state.prediction.prediction.newRating,
        target,
      });
    }

    if (snapshot.phase === 'CODING' && snapshot.startTimeSeconds > 0) {
      const endMs = (snapshot.startTimeSeconds + snapshot.durationSeconds) * 1000;
      const remainingMinutes = (endMs - this.serverNow) / 60_000;
      for (const minutes of [15, 5]) {
        const marker = `${snapshot.contestId}:${minutes}`;
        if (remainingMinutes <= minutes && remainingMinutes > 0 && !this.notifiedTimeMarkers.has(marker)) {
          this.notifiedTimeMarkers.add(marker);
          this.emitEvent({ type: 'time-left', minutes });
        }
      }
    }

    if (settlement?.actual && !previousSettlement?.actual) {
      this.emitEvent({
        type: 'rating-updated',
        delta: settlement.actual.newRating - settlement.actual.oldRating,
        newRating: settlement.actual.newRating,
      });
    }
  }

  private nextDelay(snapshot: Snapshot | null): number {
    const phase = snapshot?.phase ?? this.state.contest?.phase;
    if (!phase) return 5 * 60_000;
    if (phase === 'CODING') return Math.max(30, this.state.settings.pollSeconds) * 1000;
    if (phase === 'PENDING_SYSTEM_TEST' || phase === 'SYSTEM_TEST') return 120_000;
    if (phase === 'FINISHED') {
      return this.state.settlement?.actual ? 30 * 60_000 : 4 * 60_000;
    }
    return 60_000;
  }

  private schedule(delayMs: number): void {
    this.clearTimer();
    if (this.stopped) return;
    const delay = Math.max(5_000, delayMs);
    this.timer = setTimeout(() => {
      void this.refresh(true);
    }, delay);
    this.setState({ nextRefreshAt: Date.now() + delay });
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private patchSettings(patch: Partial<Settings>): void {
    const settings = { ...this.state.settings, ...patch };
    saveSettings(settings);
    this.setState({ settings });
  }

  private setState(patch: Partial<SessionState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }

  private emitEvent(event: SessionEvent): void {
    for (const listener of this.eventListeners) listener(event);
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof CfApiError) return error.comment;
  if (error instanceof Error) return error.message;
  return String(error);
}

function snapshotOrIdle(state: SessionState): SessionStatus {
  return state.snapshot ? 'ready' : 'error';
}

export const session = new SessionStore();
