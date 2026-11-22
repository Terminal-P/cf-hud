import { useSession } from '../../app/useSession';
import { contestClock } from '../../core/contest';
import { formatDelta, formatDuration } from '../../core/format';
import { useT } from '../hooks/useT';
import { useTick } from '../hooks/useTick';
import { deltaColor } from '../format';

/**
 * Collapsed ("mini") layout: rank, predicted delta, time left and solved count
 * in a single compact strip (~60px tall inside the panel).
 */
export function MiniBar() {
  const state = useSession();
  const t = useT();
  const now = useTick(1000);

  const { contest, snapshot, prediction } = state;
  const me = snapshot?.me ?? null;
  const predicted = prediction?.ok ? prediction.prediction : null;

  let timeValue = '—';
  let timeUrgent = false;
  if (contest) {
    const serverNow = now + state.serverTimeOffsetMs;
    const clock = contestClock(contest, serverNow);
    const isBefore = contest.phase === 'BEFORE';
    const remaining = isBefore ? Math.max(0, clock.startMs - serverNow) : clock.remainingMs;
    timeValue = formatDuration(remaining);
    timeUrgent = !isBefore && contest.phase === 'CODING' && remaining <= 15 * 60_000;
  }

  const solvedValue =
    me && snapshot ? `${me.solved}/${snapshot.problems.length}` : t('empty');
  const frozen = Boolean(snapshot?.frozen ?? contest?.frozen);

  return (
    <div className="mini-bar" aria-label={t('miniMode')}>
      <div className="mini-metric">
        <span className="mini-label">{t('miniRank')}</span>
        <span className="mini-value mini-value--rank">
          {me ? `#${me.rank.toLocaleString()}` : t('empty')}
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
          {t('miniTime')}
          {frozen ? <span className="mini-frozen"> · {t('miniFrozen')}</span> : null}
        </span>
        <span className="mini-value mini-value--time">{timeValue}</span>
      </div>
      <div className="mini-metric">
        <span className="mini-label">{t('miniSolved')}</span>
        <span className="mini-value">{solvedValue}</span>
      </div>
    </div>
  );
}
