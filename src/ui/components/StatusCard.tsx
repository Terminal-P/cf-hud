import { session, useSession } from '../../app/useSession';
import { contestClock } from '../../core/contest';
import { formatDuration } from '../../core/format';
import { vpRemainingMs } from '../../core/vp';
import { formatAgo, phaseLabelKey, phaseTone } from '../format';
import { useT } from '../hooks/useT';
import { useTick } from '../hooks/useTick';
import { IconAlert, IconRefresh, IconSpinner } from './icons';
import { Badge, Card, Progress } from './ui';

const URGENT_MS = 15 * 60_000;

/**
 * Countdown / progress / freshness strip. Ticks locally every second using the
 * server-clock offset maintained by the store.
 *
 * During virtual participation the official contest clock is replaced by the
 * virtual clock (the selected contest is finished, so its timer is 00:00).
 */
export function StatusCard() {
  const state = useSession();
  const t = useT();
  const now = useTick(1000);

  const contest = state.contest;
  const vp = state.vp;

  if (!contest && !vp) return null;

  const serverNow = now + state.serverTimeOffsetMs;
  const refreshButton = (
    <button
      type="button"
      className="icon-btn refresh-btn"
      onClick={() => void session.refresh(true)}
      disabled={state.refreshing}
      aria-label={state.refreshing ? t('refreshing') : t('refresh')}
      title={state.refreshing ? t('refreshing') : t('refresh')}
    >
      {state.refreshing ? <IconSpinner /> : <IconRefresh />}
    </button>
  );

  if (vp) {
    const remaining = vpRemainingMs(vp.session, serverNow);
    const finished = remaining <= 0 || Boolean(vp.snapshot?.finished);
    const durationMs = vp.session.durationSeconds * 1000;
    const progress = finished
      ? 1
      : durationMs > 0
        ? Math.max(0, Math.min(1, 1 - remaining / durationMs))
        : 0;
    const urgent = !finished && remaining <= URGENT_MS;
    const displayRemaining = finished ? 0 : remaining;

    return (
      <Card className="status-card status-card--vp">
        <div className="status-top">
          <Badge tone="info">
            {finished ? t('vpBadgeFinished') : t('vpBadgeActive')}
          </Badge>
          {refreshButton}
        </div>

        <div className="clock-row">
          <div className="clock-main">
            <span className="clock-label">
              {finished ? t('vpFinishedLabel') : t('vpTimeLeft')}
            </span>
            <span className={`clock-time ${urgent ? 'is-urgent' : ''}`}>
              {formatDuration(displayRemaining)}
            </span>
          </div>
          <div className="clock-meta">
            <span>{t('updatedAgo', { time: formatAgo(t, state.lastUpdated, now) })}</span>
          </div>
        </div>

        <Progress
          value={progress}
          tone={urgent ? 'danger' : 'accent'}
          ariaLabel={t('contestProgress')}
        />

        <p className="hint">{t('vpNoRatingNote')}</p>
      </Card>
    );
  }

  if (!contest) return null;

  const clock = contestClock(contest, serverNow);
  const isBefore = contest.phase === 'BEFORE';
  const remaining = isBefore ? Math.max(0, clock.startMs - serverNow) : clock.remainingMs;
  const urgent = !isBefore && contest.phase === 'CODING' && remaining <= URGENT_MS;
  const progress = isBefore ? 0 : clock.progress;
  const frozen = Boolean(state.snapshot?.frozen ?? contest.frozen);

  return (
    <Card className="status-card">
      <div className="status-top">
        <Badge className={`phase-badge--${phaseTone(contest.phase)}`}>
          {t(phaseLabelKey(contest.phase))}
        </Badge>
        {frozen ? (
          <Badge tone="warn" className="frozen-badge" title={t('frozenHint')}>
            <IconAlert />
            {t('frozenBadge')}
          </Badge>
        ) : null}
        {refreshButton}
      </div>

      <div className="clock-row">
        <div className="clock-main">
          <span className="clock-label">{isBefore ? t('startsInLabel') : t('timeLeft')}</span>
          <span className={`clock-time ${urgent ? 'is-urgent' : ''}`}>
            {formatDuration(remaining)}
          </span>
        </div>
        <div className="clock-meta">
          <span>{t('updatedAgo', { time: formatAgo(t, state.lastUpdated, now) })}</span>
          <span>{t('pollEvery', { n: state.settings.pollSeconds })}</span>
        </div>
      </div>

      <Progress
        value={progress}
        tone={urgent ? 'danger' : 'accent'}
        ariaLabel={t('contestProgress')}
      />

      {frozen ? <p className="hint">{t('frozenHint')}</p> : null}
    </Card>
  );
}
