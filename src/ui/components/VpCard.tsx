import { useState, type UIEvent } from 'react';
import { session, useSession } from '../../app/useSession';
import { formatClockTime, formatDuration } from '../../core/format';
import { vpRemainingMs } from '../../core/vp';
import { currentUtcOffsetLabel, formatPoints, formatShortDate, resolvedTimeZoneName, truncate } from '../format';
import { useT } from '../hooks/useT';
import { useTick } from '../hooks/useTick';
import { IconRefresh, IconSpinner } from './icons';
import { Badge, Card, CardHead, Progress, Stat } from './ui';

const URGENT_MS = 15 * 60_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Virtual participation entry points and the running VP clock.
 *
 * Visibility rules:
 * - an active `state.vp` always renders the tracking card;
 * - a FINISHED selected contest without VP renders the intro/start card;
 * - otherwise, recent finished rounds can be picked for tracking;
 * - with no contest at all and no recent rounds, a small hint is shown.
 */
export function VpCard() {
  const state = useSession();
  const t = useT();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startAt, setStartAt] = useState('');
  const [visibleRounds, setVisibleRounds] = useState(10);

  /** Infinite scroll for the recent-rounds list: load 10 more near the bottom. */
  const handleRoundsScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    if (element.scrollHeight - element.scrollTop - element.clientHeight > 32) return;
    setVisibleRounds((count) => Math.min(count + 10, state.recentFinished.length));
  };

  /**
   * Turn the optional `HH:MM` input into a unix timestamp. Times more than a
   * minute in the future belong to yesterday (the virtual round started late
   * the previous evening). Empty input means "start now".
   */
  const resolveStartAt = (): number | undefined => {
    const value = startAt.trim();
    if (!value) return undefined;
    const [hours, minutes] = value.split(':').map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return undefined;
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    let ms = date.getTime();
    if (ms > Date.now() + 60_000) ms -= 24 * 60 * 60 * 1000;
    return Math.floor(ms / 1000);
  };

  const start = async (contestId?: number) => {
    if (busyId !== null) return;
    setBusyId(contestId ?? -1);
    setError(null);
    try {
      await session.startVirtualParticipation(contestId, resolveStartAt());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(null);
    }
  };

  const chooseRound = async (roundId: number) => {
    if (busyId !== null) return;
    setBusyId(roundId);
    setError(null);
    try {
      await session.selectContest(roundId);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(null);
    }
  };

  if (state.vp) return <ActiveVpCard />;

  const contest = state.contest;
  const tzLabel = currentUtcOffsetLabel();
  const tzName = resolvedTimeZoneName();

  if (contest?.phase === 'FINISHED') {
    const busy = busyId !== null;
    return (
      <Card className="vp-card vp-card--intro">
        <CardHead title={t('vpTitle')} />
        <p className="vp-intro">{t('vpIntro')}</p>
        <p className="hint">{t('vpStartNote')}</p>
        <label className="vp-start-at">
          <span className="vp-start-at-label">
            {t('vpStartAt')}
            <span className="vp-tz" title={tzName || tzLabel}>
              {tzLabel}
            </span>
          </span>
          <input
            type="time"
            className="input"
            value={startAt}
            onChange={(event) => setStartAt(event.target.value)}
            aria-label={`${t('vpStartAt')} (${tzLabel})`}
          />
        </label>
        <p className="hint">{t('vpStartAtHint')}</p>
        <div className="vp-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={() => void start()}
          >
            {busy ? <IconSpinner /> : null}
            {t('vpStart')}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void session.selectContest(null)}
          >
            {t('vpBrowseRounds')}
          </button>
        </div>
        {error ? (
          <p className="vp-error" role="alert">
            <span className="vp-error-label">{t('vpStartError')}</span>
            {error}
          </p>
        ) : null}
      </Card>
    );
  }

  // While an official round is running, do not offer virtual rounds.
  if (contest) return null;

  if (state.recentFinished.length > 0) {
    const total = state.recentFinished.length;
    const shown = state.recentFinished.slice(0, Math.min(visibleRounds, total));
    return (
      <Card className="vp-card vp-card--recent">
        <CardHead
          title={t('vpRecentRounds')}
          action={
            <span className="faint">
              {shown.length}/{total}
            </span>
          }
        />
        <div className="vp-rounds" onScroll={handleRoundsScroll}>
          {shown.map((round) => (
            <div className="vp-round" key={round.id}>
              <div className="vp-round-info">
                <span className="vp-round-name" title={round.name}>
                  {truncate(round.name, 38)}
                </span>
                <span className="vp-round-date">
                  {formatShortDate(round.startTimeSeconds, state.settings.language)}
                </span>
              </div>
              <button
                type="button"
                className="btn btn-sm"
                disabled={busyId !== null}
                onClick={() => void chooseRound(round.id)}
                aria-label={`${t('vpTrackRound')}: ${round.name}`}
                title={t('vpTrackRound')}
              >
                {busyId === round.id ? <IconSpinner /> : null}
                {t('vpTrackRound')}
              </button>
            </div>
          ))}
          {visibleRounds < total ? (
            <button
              type="button"
              className="btn btn-sm vp-load-more"
              onClick={() =>
                setVisibleRounds((count) => Math.min(count + 10, total))
              }
            >
              {t('vpLoadMore')}
            </button>
          ) : null}
        </div>
        {error ? (
          <p className="vp-error" role="alert">
            <span className="vp-error-label">{t('vpStartError')}</span>
            {error}
          </p>
        ) : null}
      </Card>
    );
  }

  if (!contest && state.status !== 'loading') {
    return (
      <Card className="vp-card vp-card--empty">
        <CardHead title={t('vpTitle')} />
        <p className="hint">{t('vpNoRounds')}</p>
      </Card>
    );
  }

  return null;
}

/** The active virtual round: countdown, progress and current virtual standing. */
function ActiveVpCard() {
  const state = useSession();
  const t = useT();
  const now = useTick(1000);

  const vp = state.vp;
  if (!vp) return null;

  const serverNow = now + state.serverTimeOffsetMs;
  const snapshot = vp.snapshot;
  const remaining = vpRemainingMs(vp.session, serverNow);
  // The local clock can run past the end before the next refresh updates the
  // snapshot, so either signal is enough to show the finished state.
  const finished = remaining <= 0 || Boolean(snapshot?.finished);
  const durationMs = vp.session.durationSeconds * 1000;
  const progress = finished
    ? 1
    : durationMs > 0
      ? Math.max(0, Math.min(1, 1 - remaining / durationMs))
      : 0;
  const urgent = !finished && remaining <= URGENT_MS;
  const displayRemaining = finished ? 0 : remaining;

  return (
    <Card className="vp-card vp-card--active">
      <CardHead
        title={t('vpTitle')}
        action={
          <Badge tone={finished ? 'neutral' : 'info'}>
            {finished ? t('vpBadgeFinished') : t('vpBadgeActive')}
          </Badge>
        }
      />

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
          <span>
            {t('vpStartedAt', { time: formatClockTime(vp.session.startTimeSeconds * 1000) })} ·{' '}
            {currentUtcOffsetLabel()}
          </span>
        </div>
      </div>

      <Progress
        value={progress}
        tone={urgent ? 'danger' : 'accent'}
        ariaLabel={t('vpTimeLeft')}
      />

      {snapshot ? (
        <div className="vp-stats">
          <Stat
            label={t('rank')}
            value={`#${snapshot.rank.toLocaleString()}`}
            sub={t('vpOfOfficial', { n: snapshot.participants.toLocaleString() })}
          />
          <Stat label={t('vpSubmissions')} value={snapshot.submissionCount.toLocaleString()} />
          <Stat label={t('points')} value={formatPoints(snapshot.points)} />
        </div>
      ) : (
        <p className="hint">{vp.loading ? t('loadingStandings') : t('noSnapshot')}</p>
      )}

      <p className="vp-source">
        {vp.session.source === 'detected' ? t('vpSourceDetected') : t('vpSourceManual')}
      </p>
      <p className="vp-not-counted">{t('vpNoRatingNote')}</p>
      {vp.error ? <p className="vp-error">{vp.error}</p> : null}

      <div className="vp-actions">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => void session.refresh(true)}
          disabled={state.refreshing}
          title={t('refresh')}
          aria-label={t('refresh')}
        >
          {state.refreshing ? <IconSpinner /> : <IconRefresh />}
          {t('refresh')}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => void session.stopVirtualParticipation()}
        >
          {t('vpStop')}
        </button>
      </div>
    </Card>
  );
}
