import type { RankPoint, VpSession } from '../core/types';

/* ------------------------------------------------------------------ */
/* Settings (localStorage)                                             */
/* ------------------------------------------------------------------ */

export type ThemeName = 'dark' | 'light';
export type Language = 'en' | 'zh';

export interface Settings {
  handle: string;
  contestId: number | null;
  targetRating: number | null;
  watchList: string[];
  language: Language;
  theme: ThemeName;
  /** 0.4 – 1.0, applied to the panel background. */
  opacity: number;
  mini: boolean;
  notifications: boolean;
  /** Seconds between standings polls. */
  pollSeconds: number;
  hasOnboarded: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  handle: '',
  contestId: null,
  targetRating: null,
  watchList: [],
  language: 'en',
  theme: 'dark',
  opacity: 0.92,
  mini: false,
  notifications: true,
  pollSeconds: 90,
  hasOnboarded: false,
};

const SETTINGS_KEY = 'cf-hud:settings:v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      watchList: Array.isArray(parsed.watchList) ? parsed.watchList.filter(Boolean) : [],
      pollSeconds: Math.min(600, Math.max(30, Number(parsed.pollSeconds) || DEFAULT_SETTINGS.pollSeconds)),
      opacity: Math.min(1, Math.max(0.4, Number(parsed.opacity) || DEFAULT_SETTINGS.opacity)),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable (private mode); settings simply won't persist.
  }
}

/* ------------------------------------------------------------------ */
/* IndexedDB cache                                                     */
/* ------------------------------------------------------------------ */

const DB_NAME = 'cf-hud';
const DB_VERSION = 1;
const STORE_CACHE = 'cache';
const STORE_HISTORY = 'rank-history';

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memoryCache = new Map<string, unknown>();

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_CACHE)) db.createObjectStore(STORE_CACHE);
        if (!db.objectStoreNames.contains(STORE_HISTORY)) db.createObjectStore(STORE_HISTORY);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, mode);
      const request = run(tx.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

interface CachedValue<T> {
  value: T;
  savedAt: number;
}

/** Test hook: IndexedDB is unavailable in Node, so memory is the only layer. */
export function clearMemoryCache(): void {
  memoryCache.clear();
}

export async function cacheGet<T>(key: string, maxAgeMs = Infinity): Promise<T | null> {
  const entry = await withStore<CachedValue<T>>(STORE_CACHE, 'readonly', (store) => store.get(key));
  if (!entry) return (memoryCache.get(key) as T | undefined) ?? null;
  if (Date.now() - entry.savedAt > maxAgeMs) return null;
  memoryCache.set(key, entry.value);
  return entry.value;
}

export async function cacheSet<T>(key: string, value: T): Promise<void> {
  memoryCache.set(key, value);
  await withStore(STORE_CACHE, 'readwrite', (store) =>
    store.put({ value, savedAt: Date.now() } satisfies CachedValue<T>, key),
  );
}

export async function getRankHistory(contestId: number): Promise<RankPoint[]> {
  const points = await withStore<RankPoint[]>(STORE_HISTORY, 'readonly', (store) => store.get(contestId));
  return points ?? [];
}

export async function setRankHistory(contestId: number, points: RankPoint[]): Promise<void> {
  await withStore(STORE_HISTORY, 'readwrite', (store) => store.put(points, contestId));
}

/* ------------------------------------------------------------------ */
/* Virtual participation sessions                                      */
/* ------------------------------------------------------------------ */

const VP_SESSIONS_KEY = 'cf-hud:vp:v1';

type VpSessionMap = Record<string, VpSession>;

function readVpSessions(): VpSessionMap {
  try {
    const raw = localStorage.getItem(VP_SESSIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as VpSessionMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeVpSessions(sessions: VpSessionMap): void {
  try {
    localStorage.setItem(VP_SESSIONS_KEY, JSON.stringify(sessions));
  } catch {
    // Session cannot be persisted in private mode; the in-memory state still works.
  }
}

/** All remembered virtual sessions, newest first. */
export function loadVpSessions(): VpSession[] {
  return Object.values(readVpSessions())
    .filter((session) => session && typeof session.contestId === 'number')
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export function loadVpSession(contestId: number): VpSession | null {
  return readVpSessions()[String(contestId)] ?? null;
}

export function saveVpSession(session: VpSession): void {
  const sessions = readVpSessions();
  sessions[String(session.contestId)] = session;
  writeVpSessions(sessions);
}

export function clearVpSession(contestId: number): void {
  const sessions = readVpSessions();
  delete sessions[String(contestId)];
  writeVpSessions(sessions);
}

const VP_DISMISSED_KEY = 'cf-hud:vp-dismissed:v1';

/** Contests where the user explicitly stopped virtual tracking (survives reload). */
export function loadVpDismissed(): number[] {
  try {
    const raw = localStorage.getItem(VP_DISMISSED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is number => typeof id === 'number') : [];
  } catch {
    return [];
  }
}

export function saveVpDismissed(contestIds: number[]): void {
  try {
    localStorage.setItem(VP_DISMISSED_KEY, JSON.stringify(contestIds));
  } catch {
    // Ignore storage failures; dismissals are then session-only.
  }
}
