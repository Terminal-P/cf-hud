/** Presentation-only helpers (formatting and colour). */

import { formatDuration } from '../core/format';
import type { Contest } from '../core/types';
import type { Language, TFunction, TranslationKey } from './i18n';

/**
 * Codeforces rank colour, tuned for dark backgrounds.
 *
 * The canonical palette is: gray, green, cyan, blue, violet, orange, orange-red,
 * red. The pure `#008000` / `#aa00aa` / `#ff0000` values are too dim or too dark
 * on a dark panel, so the brighter variants below are used instead.
 */
export function ratingColor(rating: number): string {
  if (!Number.isFinite(rating) || rating < 1200) return '#98a2b3';
  if (rating < 1400) return '#3fb950';
  if (rating < 1600) return '#03a89e';
  if (rating < 1900) return '#4a7dff';
  if (rating < 2100) return '#c07cff';
  if (rating < 2400) return '#ff9f1a';
  if (rating < 2600) return '#ff7a45';
  return '#ff4d5e';
}

/** Green for gains, red for losses, muted for a flat delta. */
export function deltaColor(delta: number): string {
  if (delta > 0) return 'var(--green)';
  if (delta < 0) return 'var(--red)';
  return 'var(--text-dim)';
}

export function formatRating(rating: number): string {
  if (!Number.isFinite(rating)) return '—';
  return String(Math.round(rating));
}

/** Grouped integer, e.g. "3,933". */
export function formatPoints(points: number): string {
  if (!Number.isFinite(points)) return '—';
  const rounded = Math.round(points * 10) / 10;
  return Number.isInteger(rounded) ? rounded.toLocaleString() : rounded.toFixed(1);
}

/** Compact counter for narrow cells: 812 -> "812", 3_933 -> "3.9k". */
export function formatCompact(count: number): string {
  if (!Number.isFinite(count) || count < 0) return '—';
  if (count >= 100_000) return `${Math.round(count / 1000)}k`;
  if (count >= 10_000) return `${Math.round(count / 1000)}k`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(Math.round(count));
}

/** Seconds from contest start -> "01:23" (or "1:02:05" for very long rounds). */
export function formatSolveTime(seconds: number | undefined | null): string {
  if (seconds === undefined || seconds === null || !Number.isFinite(seconds)) return '—';
  return formatDuration(seconds * 1000);
}

/** Localised "updated 12s ago" fragment (the surrounding sentence lives in i18n). */
export function formatAgo(tr: TFunction, fromMs: number | null, nowMs: number): string {
  if (fromMs === null || !Number.isFinite(fromMs)) return tr('empty');
  const seconds = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  if (seconds < 5) return tr('justNow');
  if (seconds < 60) return tr('secondsAgo', { n: seconds });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return tr('minutesAgo', { n: minutes });
  const hours = Math.round(minutes / 60);
  return tr('hoursAgo', { n: hours });
}

/** Localised short date, e.g. "Nov 22" / "11月22日". */
export function formatShortDate(unixSeconds: number | undefined, language: Language): string {
  if (unixSeconds === undefined || !Number.isFinite(unixSeconds) || unixSeconds <= 0) return '—';
  try {
    return new Date(unixSeconds * 1000).toLocaleDateString(
      language === 'zh' ? 'zh-CN' : 'en-US',
      { month: 'short', day: 'numeric' },
    );
  } catch {
    return '—';
  }
}

/** "top 3.2%" style label. */
export function formatTopPercent(fraction: number): string {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  if (pct < 0.01) return '0.01%';
  if (pct < 0.1) return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(1)}%`;
}

export function truncate(text: string, max = 42): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Turn a 0..1 fraction into a percentage width string. */
export function percentWidth(fraction: number): string {
  const clamped = Math.max(0, Math.min(1, fraction));
  return `${clamped * 100}%`;
}

/** i18n key for a contest phase badge. */
export function phaseLabelKey(phase: Contest['phase']): TranslationKey {
  switch (phase) {
    case 'BEFORE':
      return 'phaseBEFORE';
    case 'CODING':
      return 'phaseCODING';
    case 'PENDING_SYSTEM_TEST':
      return 'phasePENDING_SYSTEM_TEST';
    case 'SYSTEM_TEST':
      return 'phaseSYSTEM_TEST';
    default:
      return 'phaseFINISHED';
  }
}

export function contestUrl(contestId: number): string {
  return `https://codeforces.com/contest/${contestId}`;
}

export function profileUrl(handle: string): string {
  return `https://codeforces.com/profile/${encodeURIComponent(handle)}`;
}

/**
 * Format a timezone offset (minutes east of UTC) as "UTC+8", "UTC-5" or
 * "UTC+5:30". Used to show which zone an `HH:MM` input is interpreted in.
 */
export function formatUtcOffset(offsetMinutes: number): string {
  const rounded = Math.round(offsetMinutes);
  const sign = rounded >= 0 ? '+' : '-';
  const abs = Math.abs(rounded);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return `UTC${sign}${hours}${minutes > 0 ? `:${String(minutes).padStart(2, '0')}` : ''}`;
}

/** The runtime's current UTC offset, e.g. "UTC+8". */
export function currentUtcOffsetLabel(): string {
  return formatUtcOffset(-new Date().getTimezoneOffset());
}

/** IANA zone name when the runtime exposes one, otherwise an empty string. */
export function resolvedTimeZoneName(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
}

export type PhaseTone = 'live' | 'wait' | 'test' | 'done';

export function phaseTone(phase: Contest['phase']): PhaseTone {
  switch (phase) {
    case 'CODING':
      return 'live';
    case 'BEFORE':
      return 'wait';
    case 'PENDING_SYSTEM_TEST':
    case 'SYSTEM_TEST':
      return 'test';
    default:
      return 'done';
  }
}
