import { useSession } from '../../app/useSession';
import { contestClock } from '../../core/contest';
import { formatDelta, formatDuration } from '../../core/format';
import { vpRemainingMs } from '../../core/vp';
import { useT } from '../hooks/useT';
import { useTick } from '../hooks/useTick';
import { deltaColor, formatRating, ratingColor } from '../format';

/**
 * Collapsed ("mini") layout: rank, performance, predicted delta and time left.
 * The problem card is rendered below it, identical to the full layout.
 */
export function MiniBar() {
  const state = useSession();
  const t = useT();
  const now = useTick(1000);

  const { contest, snapshot, prediction, vp } = state;
  const me = snapshot?.me ?? null;
  const predicted = prediction?.ok ? prediction.prediction : null;
  const vpActive = Boolean(vp);

  let timeValue = '—';
  let timeUrgent = false;

  if (vp) {
    const remaining = vpRemainingMs(vp.session, now + state.serverTimeOffsetMs);
    timeValue = formatDuration(remaining);
    timeUrgent = remaining > 0 && remaining <= 15 * 60_000;
  } else if (contest) {
    const serverNow = now + state.serverTimeOffsetMs;
    const clock = contestClock(contest, serverNow);
    const isBefore = contest.phase === 'BEFORE';
    const remaining = isBefore ? Math.max(0, clock.startMs - serverNow) : clock.remainingMs;
    timeValue = formatDuration(remaining);
    timeUrgent = !isBefore && contest.phase === 'CODING' && remaining <= 15 * 60_000;
  }

  const perfValue = predicted ? formatRating(predicted.performance) : t('empty');
  const frozen = vpActive ? false : Boolean(snapshot?.frozen ?? contest?.frozen);

  return (
    <div
      className={`mini-bar ${vpActive ? 'mini-bar--vp' : ''}`}
      aria-label={vpActive ? t('vpMiniHint') : t('miniMode')}
      title={vpActive ? t('vpMiniHint') : undefined}
    >
      <div className="mini-metric">
        <span className="mini-label">{t('miniRank')}</span>
        <span className="mini-value mini-value--rank">
          {me ? `#${me.rank.toLocaleString()}` : t('empty')}
        </span>
      </div>

      <div className="mini-metric">
        <span className="mini-label">{t('miniPerf')}</span>
        <span
          className="mini-value"
          style={{ color: predicted ? ratingColor(predicted.performance) : 'var(--text-dim)' }}
        >
          {perfValue}
        </span>
      </div>

      <div className="mini-metric">
        <span className="mini-label">{t('miniDelta')}</span>
        <span
          className="mini-value"
          style={{ color: predicted ? deltaColor(predicted.delta) : 'var(--text-dim)' }}
        >
          {predicted ? formatDelta(predicted.delta) : t('empty')}
        </span>
      </div>

      <div className={`mini-metric ${timeUrgent ? 'is-urgent' : ''}`}>
        <span className="mini-label">
          {vpActive
            ? vp?.snapshot?.finished
              ? t('vpBadgeFinished')
              : t('vpBadgeActive')
            : t('miniTime')}
          {!vpActive && frozen ? <span className="mini-frozen"> · {t('miniFrozen')}</span> : null}
        </span>
        <span className="mini-value mini-value--time">{timeValue}</span>
      </div>
    </div>
  );
}
