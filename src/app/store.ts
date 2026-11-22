import { CfApiError } from '../core/api/client';
import { CodeforcesApi } from '../core/api/codeforces';
import { recentFinished as pickRecentFinished, selectContest } from '../core/contest';
import { buildRatingPool, planGoal, predictRating, type RatingPool, type PredictionResult } from '../core/rating/predict';
import { parseStandings } from '../core/standings';
import {
  buildVpSnapshot,
  detectVirtualStart,
  isVpFinished,
  vpAsRow,
  virtualSubmissions,
} from '../core/vp';
import type {
  Contest,
  GoalPlan,
  HistoryPoint,
  Prediction,
  RankPoint,
  RatingChange,
  RowLookup,
  Settlement,
  Snapshot,
  Submission,
  VpSession,
  VpSnapshot,
  WatchEntry,
} from '../core/types';
import {
  cacheGet,
  cacheSet,
  clearVpSession,
  getRankHistory,
  loadSettings,
  loadVpDismissed,
  loadVpSession,
  loadVpSessions,
  saveSettings,
  saveVpDismissed,
  saveVpSession,
  setRankHistory,
  type Settings,
} from '../data/storage';

export type SessionStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface VpState {
  session: VpSession;
  snapshot: VpSnapshot | null;
  prediction: PredictionResult | null;
  goal: GoalPlan | null;
  loading: boolean;
  error: string | null;
}

export interface SessionState {
  status: SessionStatus;
  error: string | null;
  handle: string;
  contest: Contest | null;
  activeContests: Contest[];
  upcomingContest: Contest | null;
  /** Finished rounds available for virtual participation. */
  recentFinished: Contest[];
  snapshot: Snapshot | null;
  prediction: PredictionResult | null;
  goal: GoalPlan | null;
  /** Virtual participation state for the selected finished round. */
  vp: VpState | null;
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
    recentFinished: [],
    snapshot: null,
    prediction: null,
    goal: null,
    vp: null,
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
  /** Refresh queue: forced calls run after the in-flight refresh finishes. */
  private refreshQueue: Promise<void> = Promise.resolve();

  private poolCache = new Map<number, RatingPool>();
  private lastRowIndex = new Map<string, RowLookup>();
  private lastPool: RatingPool | null = null;
  private lastSnapshot: Snapshot | null = null;
  private notifiedTimeMarkers = new Set<string>();
  private lastContestPhase: string | null = null;
  private settlementCheckedAt = 0;
  /** Contests whose virtual tracking the user explicitly stopped. */
  private vpDismissed = new Set<number>();
  /** One-shot contest override used when starting a virtual round. */
  private forcedContestId: number | null = null;
  private rcCache = new Map<number, RatingChange[]>();
  private userRatingCache = new Map<string, RatingChange[]>();
  private myRatingCache: { handle: string; rating: number | null; at: number } | null = null;

  constructor(
    api: CodeforcesApi = new CodeforcesApi(),
    private readonly clock: () => number = () => Date.now(),
  ) {
    this.api = api;
    const settings = loadSettings();
    this.state = initialState(settings);
    for (const contestId of loadVpDismissed()) this.vpDismissed.add(contestId);
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
    return this.clock() + this.state.serverTimeOffsetMs;
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
      this.setState({ status: 'idle', handle: '', error: null, vp: null });
      return;
    }

    this.poolCache.clear();
    this.rcCache.clear();
    this.myRatingCache = null;
    this.vpDismissed.clear();
    this.setState({
      status: this.state.snapshot ? this.state.status : 'loading',
      error: null,
      vp: null,
      recentFinished: [],
    });
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
    // Switching to another round means leaving the virtual session behind.
    if (this.state.vp && contestId !== this.state.vp.session.contestId) {
      clearVpSession(this.state.vp.session.contestId);
      this.vpDismissed.add(this.state.vp.session.contestId);
      saveVpDismissed([...this.vpDismissed]);
    }
    this.patchSettings({ contestId });
    const sameContest = contestId !== null && this.state.contest?.id === contestId;
    const keepVp = contestId !== null && this.state.vp?.session.contestId === contestId;
    this.setState({
      rankHistory: [],
      settlement: null,
      vp: keepVp ? this.state.vp : null,
      prediction: sameContest ? this.state.prediction : null,
      goal: sameContest ? this.state.goal : null,
    });
    await this.refresh(true);
  }

  /**
   * Queue a refresh. Forced refreshes are not dropped while another refresh is
   * in flight; they run right after it, so UI actions never observe a stale
   * snapshot that was produced before the action.
   */
  refresh(force = false): Promise<void> {
    if (!force && this.refreshing) return this.refreshQueue;
    const run = this.refreshQueue.then(() => this.performRefresh());
    this.refreshQueue = run.catch(() => undefined);
    return run;
  }

  private async performRefresh(): Promise<void> {
    this.refreshing = true;
    this.setState({ refreshing: true, error: null });
    this.clearTimer();

    try {
      const contests = await this.getContests();
      // Keep a long list of finished rounds; the UI lazy-loads it while scrolling.
      const recentRounds = pickRecentFinished(contests, 200);
      const myHandleKey = this.state.handle.toLowerCase();
      // Resume an active virtual round after a reload even when no official
      // round is running (VP happens on finished contests).
      const activeVp =
        loadVpSessions().find(
          (session) =>
            session.handle.toLowerCase() === myHandleKey &&
            !isVpFinished(session, this.serverNow / 1000),
        ) ?? null;
      const preferredId = this.state.settings.contestId ?? activeVp?.contestId ?? null;
      let selection = selectContest(contests, preferredId, this.serverNow / 1000);
      // A one-shot override lets "track this finished round" work even when an
      // official round is running.
      if (this.forcedContestId !== null) {
        const forced = contests.find((item) => item.id === this.forcedContestId) ?? null;
        this.forcedContestId = null;
        if (forced) {
          selection = { current: forced, active: selection.active, upcoming: selection.upcoming };
        }
      }
      // An explicit virtual round wins over a newly started official round until
      // the user stops it; otherwise a remembered finished round never pins the HUD.
      const resumeVpId = this.state.vp?.session.contestId ?? activeVp?.contestId ?? null;
      if (resumeVpId !== null && selection.current?.id !== resumeVpId) {
        const vpContest = contests.find((item) => item.id === resumeVpId) ?? null;
        if (vpContest) {
          selection = { current: vpContest, active: selection.active, upcoming: selection.upcoming };
        }
      }
      const activeContests = selection.active;
      const upcomingContest = selection.upcoming;

      if (!selection.current) {
        this.setState({
          status: 'idle',
          contest: null,
          activeContests,
          upcomingContest,
          recentFinished: recentRounds,
          vp: null,
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
          recentFinished: recentRounds,
          vp: null,
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
          serverTimeOffsetMs: standingsCall.serverTimeMs - this.clock(),
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

      const previousPrediction = this.state.prediction;
      const previousRank = this.state.snapshot?.me?.rank ?? null;
      const previousPhase = this.state.contest?.phase ?? null;
      const previousSettlement = this.state.settlement;

      // After the round is finished the public ratings may already contain the
      // new result, so a fresh prediction would use the wrong baseline. Keep the
      // last live prediction and stop recomputing; virtual rounds get their own.
      const finished = snapshot.phase === 'FINISHED';
      const vp = finished ? await this.ensureVp(contest, parsed.rowIndex, snapshot, pool) : null;
      const mergedSnapshot = vp?.snapshot ? this.mergeVpSnapshot(snapshot, vp.snapshot) : snapshot;

      const prediction: PredictionResult | null = vp
        ? vp.prediction
        : finished
          ? this.state.prediction
          : this.computePrediction(myRow, oldRating, pool, snapshot, skipIndex);
      const goal: GoalPlan | null = vp
        ? vp.goal
        : finished
          ? this.state.goal
          : this.computeGoal(myRow, oldRating, pool, snapshot, skipIndex);
      const watch = this.computeWatch(pool, snapshot);
      const rankHistory = await this.updateRankHistory(mergedSnapshot, !vp);
      const settlement = await this.ensureSettlement(contest, vp ? null : prediction);
      const ratingHistory = settlement?.actual ? await this.loadRatingHistory() : this.state.ratingHistory;

      this.state = {
        ...this.state,
        status: 'ready',
        error: null,
        contest: { ...contest, ...standingsCall.result.contest },
        activeContests,
        upcomingContest,
        recentFinished: recentRounds,
        snapshot: mergedSnapshot,
        prediction,
        goal,
        vp,
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
        snapshot: mergedSnapshot,
        settlement,
      });
      this.lastContestPhase = snapshot.phase;
      this.schedule(this.nextDelay(mergedSnapshot));
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
      if (this.state.refreshing) this.setState({ refreshing: false });
    }
  }

  /**
   * Start (or resume) virtual participation tracking for a finished round.
   *
   * The timer starts now by default; as soon as the user submits something the
   * store syncs the real virtual start time from the submission metadata.
   */
  async startVirtualParticipation(contestId?: number, startAtSeconds?: number): Promise<void> {
    if (!this.state.handle) throw new Error('Connect your Codeforces handle first.');
    if (contestId !== undefined) {
      // Select the finished round even if an official round is running.
      this.forcedContestId = contestId;
      if (contestId !== this.state.contest?.id) await this.selectContest(contestId);
      this.forcedContestId = null;
    }
    const contest = this.state.contest;
    if (!contest) throw new Error('Select a finished round first.');
    if (contest.phase !== 'FINISHED') {
      throw new Error('Virtual participation is only available for finished rounds.');
    }

    this.vpDismissed.delete(contest.id);
    saveVpDismissed([...this.vpDismissed]);
    const stored = loadVpSession(contest.id);
    const storedForHandle =
      stored && stored.handle.toLowerCase() === this.state.handle.toLowerCase() ? stored : null;
    const existing =
      this.state.vp && this.state.vp.session.contestId === contest.id
        ? this.state.vp.session
        : null;
    const baseSession: VpSession = existing ??
      storedForHandle ?? {
        contestId: contest.id,
        handle: this.state.handle,
        startTimeSeconds: Math.floor(this.serverNow / 1000),
        durationSeconds: contest.durationSeconds,
        source: 'manual',
        createdAt: Date.now(),
      };
    // A user-provided start time aligns the timer with the official virtual round
    // before the first submission exists (or with an already finished VP).
    const providedStart =
      typeof startAtSeconds === 'number' && Number.isFinite(startAtSeconds) && startAtSeconds > 0
        ? Math.floor(startAtSeconds)
        : null;
    const session: VpSession =
      providedStart === null
        ? baseSession
        : {
            ...baseSession,
            startTimeSeconds: providedStart,
            source: 'manual',
            createdAt: Date.now(),
          };
    saveVpSession(session);
    this.setState({
      vp: { session, snapshot: null, prediction: null, goal: null, loading: true, error: null },
    });
    await this.refresh(true);
  }

  /** Stop tracking the virtual round and return to the official post-contest view. */
  async stopVirtualParticipation(): Promise<void> {
    const vp = this.state.vp;
    if (!vp) return;
    if (vp.session.handle.toLowerCase() !== this.state.handle.toLowerCase()) return;
    clearVpSession(vp.session.contestId);
    this.vpDismissed.add(vp.session.contestId);
    saveVpDismissed([...this.vpDismissed]);
    this.setState({ vp: null, prediction: null, goal: null });
    await this.refresh(true);
  }

  setTargetRating(target: number | null): void {
    this.patchSettings({ targetRating: target && target > 0 ? Math.round(target) : null });
    if (this.state.vp) {
      // Recompute the virtual goal (needs the VP rank and pool).
      void this.refresh(true);
      return;
    }
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

  /**
   * Rebuild the virtual-participation view for the selected finished round.
   *
   * Virtual participants are absent from the anonymous standings, so the score
   * comes from `contest.status?handle=...` and the rank is an insertion into the
   * official ranklist.
   */
  private async ensureVp(
    contest: Contest,
    rowIndex: Map<string, RowLookup>,
    snapshot: Snapshot,
    officialPool: RatingPool | null,
  ): Promise<VpState | null> {
    if (this.vpDismissed.has(contest.id)) return null;
    const handle = this.state.handle;
    if (!handle) return null;

    const existing =
      this.state.vp && this.state.vp.session.contestId === contest.id ? this.state.vp : null;
    const stored = loadVpSession(contest.id);
    const storedForHandle =
      stored && stored.handle.toLowerCase() === handle.toLowerCase() ? stored : null;

    let submissions: Submission[] = [];
    let fetchError: string | null = null;
    try {
      const { result } = await this.api.contestStatus(contest.id, handle);
      submissions = result;
    } catch (error) {
      fetchError = errorMessage(error);
    }

    const virtuals = virtualSubmissions(submissions, contest.id);
    const detectedStart = detectVirtualStart(virtuals);

    let session = existing?.session ?? storedForHandle ?? null;
    if (!session && detectedStart !== null) {
      const candidate: VpSession = {
        contestId: contest.id,
        handle,
        startTimeSeconds: detectedStart,
        durationSeconds: contest.durationSeconds,
        source: 'detected',
        createdAt: Date.now(),
      };
      if (!isVpFinished(candidate, this.serverNow / 1000)) {
        session = candidate;
        saveVpSession(candidate);
      }
    }
    if (!session) return null;

    // The server-side start time is authoritative once submissions exist.
    if (detectedStart !== null && Math.abs(detectedStart - session.startTimeSeconds) > 2) {
      session = { ...session, startTimeSeconds: detectedStart, source: 'detected' };
      saveVpSession(session);
    }

    if (fetchError && virtuals.length === 0) {
      return {
        session,
        snapshot: existing?.snapshot ?? null,
        prediction: existing?.prediction ?? null,
        goal: existing?.goal ?? null,
        loading: false,
        error: fetchError,
      };
    }

    const problems = snapshot.problems.map((cell) => ({ index: cell.index, name: cell.name }));
    const pointsPossible = snapshot.problems.map((cell) => cell.pointsPossible);
    const rows = Array.from(rowIndex.values());
    const vpSnapshot = buildVpSnapshot({
      session,
      submissions: virtuals,
      problems,
      pointsPossible,
      rows,
      nowSeconds: this.serverNow / 1000,
      fetchedAt: Date.now(),
    });

    const handles = Array.from(rowIndex.keys());
    const changes = await this.getRatingChanges(contest.id).catch(() => [] as RatingChange[]);
    const oldRatings = new Map<string, number>();
    for (const change of changes) oldRatings.set(change.handle.toLowerCase(), change.oldRating);
    const vpPool = this.buildVpPool(handles, officialPool, oldRatings);
    // Virtual participants have no rating change in that contest, so derive the
    // pre-contest rating from their rating history instead of "current rating".
    const myRating =
      oldRatings.get(handle.toLowerCase()) ??
      (await this.resolveRatingAt(handle, contest.startTimeSeconds ?? 0)) ??
      (await this.resolveMyRating(handle, officialPool));
    const prediction: PredictionResult | null =
      vpPool && myRating !== null
        ? predictRating({
            handle,
            rank: vpSnapshot.rank,
            participants: vpSnapshot.participants,
            oldRating: myRating,
            pool: vpPool,
            skipIndex: -1,
            frozen: false,
            phase: 'FINISHED',
          })
        : { ok: false, reason: myRating === null ? 'unrated' : 'noRatings' };

    const target = this.state.settings.targetRating;
    const goal =
      target && vpPool && myRating !== null
        ? planGoal({
            targetRating: target,
            oldRating: myRating,
            rank: vpSnapshot.rank,
            participants: vpSnapshot.participants,
            pool: vpPool,
            skipIndex: -1,
          })
        : null;

    return { session, snapshot: vpSnapshot, prediction, goal, loading: false, error: fetchError };
  }

  private mergeVpSnapshot(snapshot: Snapshot, vp: VpSnapshot): Snapshot {
    return {
      ...snapshot,
      me: vpAsRow(vp),
      neighbors: vp.neighbors,
      problems: vp.problems,
      frozen: false,
    };
  }

  /** Pre-contest ratings make virtual performance comparable to the real round. */
  private buildVpPool(
    handles: string[],
    officialPool: RatingPool | null,
    oldRatings: Map<string, number>,
  ): RatingPool | null {
    const users = handles.map((handle) => {
      const key = handle.toLowerCase();
      return { handle, rating: oldRatings.get(key) ?? officialPool?.handleRating.get(key) };
    });
    const pool = buildRatingPool(handles, users);
    return pool.usable ? pool : null;
  }

  /** The user's rating immediately before a given contest, from `user.rating`. */
  private async resolveRatingAt(handle: string, beforeSeconds: number): Promise<number | null> {
    if (!beforeSeconds) return null;
    const changes = await this.getUserRatingChanges(handle);
    let rating: number | null = null;
    for (const change of changes) {
      if (change.ratingUpdateTimeSeconds < beforeSeconds) rating = change.newRating;
      else break;
    }
    return rating;
  }

  private async getUserRatingChanges(handle: string): Promise<RatingChange[]> {
    const key = handle.toLowerCase();
    const cached = this.userRatingCache.get(key);
    if (cached) return cached;
    const disk = await cacheGet<RatingChange[]>(`user-rating:${key}`, 60 * 60_000);
    if (disk) {
      this.userRatingCache.set(key, disk);
      return disk;
    }
    try {
      const { result } = await this.api.userRating(handle);
      this.userRatingCache.set(key, result);
      await cacheSet(`user-rating:${key}`, result);
      return result;
    } catch {
      return [];
    }
  }

  private async resolveMyRating(
    handle: string,
    officialPool: RatingPool | null,
  ): Promise<number | null> {
    const key = handle.toLowerCase();
    const fromPool = officialPool?.handleRating.get(key);
    if (fromPool) return fromPool;
    const now = Date.now();
    if (
      this.myRatingCache &&
      this.myRatingCache.handle === key &&
      now - this.myRatingCache.at < 60 * 60_000
    ) {
      return this.myRatingCache.rating;
    }
    try {
      const { result } = await this.api.userInfo([handle]);
      const rating = result[0]?.rating ?? null;
      this.myRatingCache = { handle: key, rating, at: now };
      return rating;
    } catch {
      return null;
    }
  }

  private async getRatingChanges(contestId: number): Promise<RatingChange[]> {
    const cached = this.rcCache.get(contestId);
    if (cached) return cached;
    const disk = await cacheGet<RatingChange[]>(`rating-changes:${contestId}`, 12 * 60 * 60_000);
    if (disk) {
      this.rcCache.set(contestId, disk);
      return disk;
    }
    const { result } = await this.api.ratingChanges(contestId);
    this.rcCache.set(contestId, result);
    await cacheSet(`rating-changes:${contestId}`, result);
    return result;
  }

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
    if (serverTimeMs !== null) this.state = { ...this.state, serverTimeOffsetMs: serverTimeMs - this.clock() };
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

  private async updateRankHistory(snapshot: Snapshot, persist = true): Promise<RankPoint[]> {
    const row = snapshot.me;
    if (!row) return this.state.rankHistory;

    let history = this.state.rankHistory;
    if (persist && history.length === 0) history = await getRankHistory(snapshot.contestId);

    const last = history[history.length - 1];
    const changed = !last || last.rank !== row.rank || last.points !== row.points;
    const stale = !last || snapshot.fetchedAt - last.t > 5 * 60_000;
    if (!changed && !stale) return history;

    const next = [...history, { t: snapshot.fetchedAt, rank: row.rank, points: row.points, solved: row.solved }];
    const trimmed = next.length > RANK_HISTORY_LIMIT ? next.slice(next.length - RANK_HISTORY_LIMIT) : next;
    // Virtual ranks must never pollute the official rank history of a contest.
    if (persist) void setRankHistory(snapshot.contestId, trimmed);
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
      const result = await this.getRatingChanges(contest.id);
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
      !this.state.vp &&
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
    const vp = this.state.vp;
    if (vp) {
      // Virtual rounds need fresh submissions every half minute; once the
      // virtual clock is over nothing changes any more.
      return vp.snapshot && vp.snapshot.finished ? 10 * 60_000 : 30_000;
    }
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
