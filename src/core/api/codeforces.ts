import type {
  CfUser,
  Contest,
  RatingChange,
  StandingsResponse,
  Submission,
} from '../types';
import { CfClient, type CfCall } from './client';

/**
 * Thin typed wrapper around the public Codeforces API.
 *
 * Notes on the 2026 API restrictions:
 * - `contest.standings` for regular contests only accepts an anonymous GET
 *   with exactly one query parameter (`contestId`). Do not add anything else.
 * - The response is a full standings list and is cached server-side for
 *   roughly 1-3 minutes, so polling faster than ~60 s is pointless.
 */
export class CodeforcesApi {
  constructor(readonly client: CfClient = new CfClient()) {}

  userInfo(handles: string[]): Promise<CfCall<CfUser[]>> {
    return this.client.call<CfUser[]>('user.info', { handles: handles.join(';') });
  }

  contestList(): Promise<CfCall<Contest[]>> {
    return this.client.call<Contest[]>('contest.list', { gym: false });
  }

  standings(contestId: number): Promise<CfCall<StandingsResponse>> {
    // Keep the query string to exactly `?contestId=...`.
    return this.client.call<StandingsResponse>('contest.standings', { contestId });
  }

  ratedList(contestId: number): Promise<CfCall<CfUser[]>> {
    return this.client.call<CfUser[]>('user.ratedList', {
      contestId,
      activeOnly: false,
      includeRetired: true,
    });
  }

  ratingChanges(contestId: number): Promise<CfCall<RatingChange[]>> {
    return this.client.call<RatingChange[]>('contest.ratingChanges', { contestId });
  }

  userRating(handle: string): Promise<CfCall<RatingChange[]>> {
    return this.client.call<RatingChange[]>('user.rating', { handle });
  }

  userStatus(handle: string, count = 30): Promise<CfCall<Submission[]>> {
    return this.client.call<Submission[]>('user.status', { handle, from: 1, count });
  }
}

export const defaultApi = new CodeforcesApi();
