/**
 * Codeforces API response shapes and the app's normalized domain model.
 *
 * Only the fields the HUD actually consumes are typed; the API returns more.
 */

export type ContestPhase =
  | 'BEFORE'
  | 'CODING'
  | 'PENDING_SYSTEM_TEST'
  | 'SYSTEM_TEST'
  | 'FINISHED';

export type ContestType = 'CF' | 'IOI' | 'ICPC' | (string & {});

export interface CfUser {
  handle: string;
  email?: string;
  vkId?: string;
  openId?: string;
  firstName?: string;
  lastName?: string;
  country?: string;
  city?: string;
  organization?: string;
  contribution?: number;
  rank?: string;
  rating?: number;
  maxRank?: string;
  maxRating?: number;
  lastOnlineTimeSeconds?: number;
  registrationTimeSeconds?: number;
  friendOfCount?: number;
  avatar?: string;
  titlePhoto?: string;
}

export interface Contest {
  id: number;
  name: string;
  type: ContestType;
  phase: ContestPhase;
  frozen: boolean;
  durationSeconds: number;
  startTimeSeconds?: number;
  relativeTimeSeconds?: number;
  preparedBy?: string;
  websiteUrl?: string;
  description?: string;
  difficulty?: number;
  kind?: string;
  icpcRegion?: string;
  country?: string;
  city?: string;
  season?: string;
}

export interface Problem {
  contestId?: number;
  index: string;
  name: string;
  type?: string;
  points?: number;
  rating?: number;
  tags?: string[];
}

export interface ProblemResult {
  points: number;
  rejectedAttemptCount: number;
  type: 'PRELIMINARY' | 'FINAL';
  bestSubmissionTimeSeconds?: number;
}

export interface Party {
  contestId?: number;
  members: { handle: string }[];
  participantType?: string;
  ghost?: boolean;
  room?: number;
  startTimeSeconds?: number;
  teamId?: number;
  teamName?: string;
}

export interface RanklistRow {
  party: Party;
  rank: number;
  points: number;
  penalty: number;
  successfulHackCount: number;
  unsuccessfulHackCount: number;
  problemResults: ProblemResult[];
}

export interface StandingsResponse {
  contest: Contest;
  problems: Problem[];
  rows: RanklistRow[];
}

export interface RatingChange {
  contestId: number;
  contestName: string;
  handle: string;
  rank: number;
  ratingUpdateTimeSeconds: number;
  oldRating: number;
  newRating: number;
}

export interface Submission {
  id: number;
  contestId?: number;
  creationTimeSeconds: number;
  /** Seconds since the start of the participation (official or virtual). */
  relativeTimeSeconds: number;
  verdict?: string;
  programmingLanguage?: string;
  problem: Problem;
  author?: Party;
}

/* ------------------------------------------------------------------ */
/* Normalized model used by the UI                                     */
/* ------------------------------------------------------------------ */

export interface ProblemCell {
  /** Problem index, e.g. "A", "B1". */
  index: string;
  name: string;
  /** Maximum points this problem is worth (500, 1000, ...). */
  pointsPossible: number;
  /** How many official participants solved it (points > 0). */
  solvedCount: number;
  myPoints: number;
  myAttempts: number;
  mySolved: boolean;
  /** Seconds from contest start to the accepted submission. */
  myTimeSeconds?: number;
}

export interface RowLookup {
  handle: string;
  rank: number;
  points: number;
  penalty: number;
  solved: number;
  successfulHacks: number;
  unsuccessfulHacks: number;
  problemResults: ProblemResult[];
}

/** A point in the locally recorded rank history (for the sparkline). */
export interface RankPoint {
  t: number;
  rank: number;
  points: number;
  solved: number;
}

export interface Snapshot {
  contestId: number;
  contestName: string;
  contestType: ContestType;
  phase: ContestPhase;
  frozen: boolean;
  startTimeSeconds: number;
  durationSeconds: number;
  fetchedAt: number;
  participants: number;
  me: RowLookup | null;
  /** The rows directly above/below the current user (for score gaps). */
  neighbors: { above: RowLookup | null; below: RowLookup | null };
  problems: ProblemCell[];
}

export type PredictionNote =
  | 'frozen'
  | 'provisional'
  | 'unrated'
  | 'estimatedRatings'
  | 'noRatings'
  | 'smallField';

export type PredictionConfidence = 'high' | 'medium' | 'low';

export interface Prediction {
  handle: string;
  rank: number;
  participants: number;
  oldRating: number;
  /** Expected rank before the contest (official seed). */
  seed: number;
  /** Rating performance implied by the current rank (official R). */
  performance: number;
  /** Estimated rating change, official formula. */
  delta: number;
  deltaLow: number;
  deltaHigh: number;
  newRating: number;
  newRatingLow: number;
  newRatingHigh: number;
  confidence: PredictionConfidence;
  notes: PredictionNote[];
}

export interface WatchEntry {
  handle: string;
  row: RowLookup | null;
  prediction: Prediction | null;
}

export type GoalStatus =
  | 'no-target'
  | 'on-track'
  | 'need-up'
  | 'unreachable';

export interface GoalPlan {
  targetRating: number | null;
  targetDelta: number;
  currentDelta: number;
  currentRank: number;
  /** Rank that would deliver targetDelta (1 = first place). */
  neededRank: number | null;
  status: GoalStatus;
  participants: number;
}

export interface Settlement {
  contestId: number;
  checkedAt: number;
  /** Official rating change, once Codeforces publishes it. */
  actual: RatingChange | null;
  /** Prediction that was shown right before the contest finished. */
  predictedDelta: number | null;
  history: RatingChange[];
}

export interface HistoryPoint {
  /** Contest end time (unix seconds). */
  t: number;
  rating: number;
  contestName: string;
  contestId: number;
}

/* ------------------------------------------------------------------ */
/* Virtual participation                                              */
/* ------------------------------------------------------------------ */

export interface VpSession {
  contestId: number;
  handle: string;
  /** Unix seconds when the virtual participation was started. */
  startTimeSeconds: number;
  durationSeconds: number;
  /** `manual` = started from the HUD, `detected` = derived from a submission. */
  source: 'manual' | 'detected';
  createdAt: number;
}

export interface VpProblemCell extends ProblemCell {
  /** Submissions sent to this problem during the virtual participation. */
  submissionCount: number;
  /** Relative seconds of the latest submission (solved or not). */
  lastAttemptTimeSeconds?: number;
}

export interface VpSnapshot {
  contestId: number;
  handle: string;
  fetchedAt: number;
  startTimeSeconds: number;
  durationSeconds: number;
  /** True once the virtual clock has run out. */
  finished: boolean;
  problems: VpProblemCell[];
  points: number;
  penalty: number;
  solved: number;
  /** Number of official participants the virtual rank is compared against. */
  participants: number;
  /** Rank the user would have had among official participants. */
  rank: number;
  neighbors: { above: RowLookup | null; below: RowLookup | null };
  submissionCount: number;
}
