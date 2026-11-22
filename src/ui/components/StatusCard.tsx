import { session, useSession } from '../../app/useSession';
import { contestClock } from '../../core/contest';
import { formatDuration } from '../../core/format';
import { formatAgo, phaseLabelKey, phaseTone } from '../format';
import { useT } from '../hooks/useT';
import { useTick } from '../hooks/useTick';
import { IconAlert, IconRefresh, IconSpinner } from './icons';
import { Badge, Card, Progress } from './ui';

const URGENT_MS = 15 * 60_000;

/**
 * Countdown / progress / freshness strip. Ticks locally every second using the
 * server-clock offset maintained by the store.
 */
export function StatusCard() {
  const state = useSession();
  const t = useT();
  const now = useTick(1000);

  const contest = state.contest;
  if (!contest) return null;

  const serverNow = now + state.serverTimeOffsetMs;
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
