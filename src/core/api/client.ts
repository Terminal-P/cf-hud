/**
 * Minimal promise-based queue that keeps Codeforces happy.
 *
 * The public API allows at most one request every two seconds. We space calls
 * slightly above that (default 1100 ms) and never fire more than one at a time.
 */

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class RateLimiter {
  private lastStartedAt = 0;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(readonly minIntervalMs = 1100) {}

  /** Queue `task` behind every previously queued task. */
  run<T>(task: () => Promise<T>): Promise<T> {
    const started = this.chain.then(async () => {
      const wait = Math.max(0, this.lastStartedAt + this.minIntervalMs - Date.now());
      if (wait > 0) await sleep(wait);
      try {
        return await task();
      } finally {
        this.lastStartedAt = Date.now();
      }
    });
    // Keep the chain alive even when a task rejects.
    this.chain = started.then(
      () => undefined,
      () => undefined,
    );
    return started;
  }
}

export interface CfApiErrorInfo {
  comment: string;
  httpStatus?: number;
}

export class CfApiError extends Error {
  readonly comment: string;
  readonly httpStatus?: number;

  constructor(info: CfApiErrorInfo) {
    super(info.comment || 'Codeforces API request failed');
    this.name = 'CfApiError';
    this.comment = info.comment;
    this.httpStatus = info.httpStatus;
  }

  /** `Call limit exceeded` — retry after a short pause. */
  get isRateLimit(): boolean {
    return /call limit exceeded/i.test(this.comment);
  }

  /** Contest has not started yet (standings unavailable). */
  get isNotStarted(): boolean {
    return /has not started/i.test(this.comment);
  }

  /** Standings hidden / contest not public. */
  get isUnavailable(): boolean {
    return /not available|hidden/i.test(this.comment);
  }
}

export interface CfCall<T> {
  result: T;
  /** Server clock derived from the HTTP Date header, if present. */
  serverTimeMs: number | null;
}

export interface CfClientOptions {
  minIntervalMs?: number;
  timeoutMs?: number;
  baseUrl?: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

type ParamValue = string | number | boolean | undefined | null;

export class CfClient {
  readonly limiter: RateLimiter;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly inflight = new Map<string, Promise<CfCall<unknown>>>();

  constructor(options: CfClientOptions = {}) {
    this.limiter = new RateLimiter(options.minIntervalMs ?? 1100);
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.baseUrl = options.baseUrl ?? 'https://codeforces.com/api';
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Call an anonymous API method. Never pass authentication parameters:
   * regular-contest standings only work as a plain anonymous GET.
   */
  async call<T>(method: string, params: Record<string, ParamValue> = {}): Promise<CfCall<T>> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      search.set(key, String(value));
    }
    const url = `${this.baseUrl}/${method}${search.size ? `?${search.toString()}` : ''}`;

    const existing = this.inflight.get(url);
    if (existing) return existing as Promise<CfCall<T>>;

    const promise = this.limiter.run(() => this.execute<T>(url)).finally(() => {
      this.inflight.delete(url);
    });
    this.inflight.set(url, promise as Promise<CfCall<unknown>>);
    return promise;
  }

  private async execute<T>(url: string, attempt = 0): Promise<CfCall<T>> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (attempt < 2) {
        await sleep(1500 * (attempt + 1));
        return this.execute<T>(url, attempt + 1);
      }
      throw new Error(`Network error while calling ${url}: ${(error as Error).message}`);
    }

    const serverTimeHeader = response.headers.get('date');
    const serverTimeMs = serverTimeHeader ? Date.parse(serverTimeHeader) : null;
    const dateOffset = serverTimeMs !== null && !Number.isNaN(serverTimeMs) ? serverTimeMs - this.now() : null;
    const serverTime = dateOffset === null ? null : this.now() + dateOffset;

    let payload: { status: string; comment?: string; result?: T };
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      throw new CfApiError({ comment: `Invalid JSON from ${url}`, httpStatus: response.status });
    }

    if (payload.status !== 'OK') {
      const error = new CfApiError({
        comment: payload.comment ?? `HTTP ${response.status}`,
        httpStatus: response.status,
      });
      // Transient call-limit failure: back off once and retry.
      if (error.isRateLimit && attempt < 2) {
        await sleep(2500 * (attempt + 1));
        return this.execute<T>(url, attempt + 1);
      }
      throw error;
    }

    return { result: payload.result as T, serverTimeMs: serverTime };
  }
}
