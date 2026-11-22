import { formatDuration } from '../../core/format';
import { session, useSession } from '../../app/useSession';
import { useT } from '../hooks/useT';
import { useTick } from '../hooks/useTick';
import { contestUrl, phaseLabelKey, phaseTone, truncate } from '../format';
import { IconLink } from './icons';
import { Badge, Card, SkeletonCard } from './ui';

/**
 * Contest discovery strip: current contest name (with a selector when a
 * combined round exposes several contests), or a countdown to the next round.
 */
export function ContestBar() {
  const state = useSession();
  const t = useT();
  const now = useTick(1000);
  const { contest, activeContests, upcomingContest, status } = state;

  if (status === 'loading' && !contest) {
    return <SkeletonCard lines={2} />;
  }

  if (!contest) {
    const serverNow = now + state.serverTimeOffsetMs;
    const startMs = upcomingContest?.startTimeSeconds ? upcomingContest.startTimeSeconds * 1000 : 0;
    const remaining = Math.max(0, startMs - serverNow);
    return (
      <Card className="contest-card contest-card--idle">
        <div className="contest-top">
          <span className="contest-kicker">
            {upcomingContest ? t('nextContest') : t('noContestTitle')}
          </span>
          {upcomingContest ? (
            <Badge tone="warn">{t('startsInLabel')} {formatDuration(remaining)}</Badge>
          ) : null}
        </div>
        {upcomingContest ? (
          <a
            className="contest-name"
            href={contestUrl(upcomingContest.id)}
            target="_blank"
            rel="noreferrer noopener"
            title={upcomingContest.name}
          >
            {truncate(upcomingContest.name, 48)}
            <IconLink />
          </a>
        ) : null}
        <p className="hint">{upcomingContest ? t('standingsWillAppear') : t('noContestHint')}</p>
      </Card>
    );
  }

  const multiple = activeContests.length > 1;

  return (
    <Card className="contest-card">
      <div className="contest-top">
        <span className="contest-kicker">
          {multiple ? t('selectContest') : t('contest')}
        </span>
        <Badge tone="neutral" className={`phase-badge--${phaseTone(contest.phase)}`}>
          {t(phaseLabelKey(contest.phase))}
        </Badge>
        <a
          className="icon-btn contest-link"
          href={contestUrl(contest.id)}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={t('viewContest')}
          title={t('viewContest')}
        >
          <IconLink />
        </a>
      </div>

      {multiple ? (
        <label className="contest-select-wrap">
          <span className="sr-only">{t('selectContest')}</span>
          <select
            className="contest-select"
            value={contest.id}
            aria-label={t('selectContest')}
            onChange={(event) => {
              const nextId = Number(event.target.value);
              if (Number.isFinite(nextId)) void session.selectContest(nextId);
            }}
          >
            {activeContests.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <a
          className="contest-name"
          href={contestUrl(contest.id)}
          target="_blank"
          rel="noreferrer noopener"
          title={contest.name}
        >
          {truncate(contest.name, 52)}
        </a>
      )}
    </Card>
  );
}
