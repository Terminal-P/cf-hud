/** Map session events to toasts and (optionally) system notifications. */

import type { SessionEvent } from '../app/store';
import { formatDelta } from '../core/format';
import { formatRating } from './format';
import type { TFunction } from './i18n';

export type ToastKind = 'info' | 'good' | 'warn' | 'bad';

export interface ToastMessage {
  kind: ToastKind;
  title: string;
  body?: string;
}

export function describeEvent(event: SessionEvent, t: TFunction): ToastMessage {
  switch (event.type) {
    case 'rank-dropped':
      return {
        kind: 'bad',
        title: t('eventRankDropped'),
        body: t('eventRankDroppedBody', { by: event.by, rank: event.rank }),
      };
    case 'goal-lost':
      return {
        kind: 'warn',
        title: t('eventGoalLost'),
        body: t('eventGoalLostBody', {
          predicted: formatRating(event.predicted),
          target: formatRating(event.target),
        }),
      };
    case 'time-left':
      return {
        kind: event.minutes <= 5 ? 'bad' : 'warn',
        title: t('eventTimeLeft', { minutes: event.minutes }),
        body: t('eventTimeLeftBody'),
      };
    case 'rating-updated':
      return {
        kind: 'good',
        title: t('eventRatingUpdated'),
        body: t('eventRatingUpdatedBody', {
          delta: formatDelta(event.delta),
          rating: formatRating(event.newRating),
        }),
      };
    case 'contest-finished':
      return {
        kind: 'info',
        title: t('eventContestFinished'),
        body: t('eventContestFinishedBody', { name: event.contest.name }),
      };
    default:
      return { kind: 'info', title: t('appName') };
  }
}

/**
 * Fire a system notification when the user allowed them. Everything is wrapped
 * in try/catch: the Web Notification API is unavailable in some webviews and
 * constructor calls can throw.
 */
export function notifySystem(message: ToastMessage, enabled: boolean): void {
  if (!enabled || typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  try {
    new Notification(message.title, {
      body: message.body,
      tag: 'cf-hud',
      silent: true,
    });
  } catch {
    // Browser/webview does not support notifications — the toast still shows.
  }
}

export type NotificationPermissionState = NotificationPermission | 'unsupported';

export function notificationPermission(): NotificationPermissionState {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}
