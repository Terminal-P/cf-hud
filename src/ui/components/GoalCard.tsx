import { useEffect, useState, type FormEvent } from 'react';
import { session, useSession } from '../../app/useSession';
import { formatDelta } from '../../core/format';
import type { GoalPlan } from '../../core/types';
import { deltaColor, formatRating, ratingColor } from '../format';
import { useT } from '../hooks/useT';
import { IconClose } from './icons';
import { Badge, Card, CardHead, Progress, Stat, type BadgeTone } from './ui';

const MILESTONES = [1200, 1400, 1600, 1900, 2100, 2400, 2600, 3000];

function statusTone(status: GoalPlan['status']): BadgeTone {
  switch (status) {
    case 'on-track':
      return 'good';
    case 'need-up':
      return 'warn';
    case 'unreachable':
      return 'bad';
    default:
      return 'neutral';
  }
}

/** Target rating planner: needed delta, overtakes and progress. */
export function GoalCard() {
  const state = useSession();
  const t = useT();
  const { settings, goal, prediction } = state;
  const predicted = prediction?.ok ? prediction.prediction : null;
  const [draft, setDraft] = useState(settings.targetRating ? String(settings.targetRating) : '');

  useEffect(() => {
    setDraft(settings.targetRating ? String(settings.targetRating) : '');
  }, [settings.targetRating]);

  const applyTarget = (value: number | null) => {
    session.setTargetRating(value);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = Number(draft);
    if (Number.isFinite(parsed) && parsed > 0) applyTarget(Math.round(parsed));
  };

  const statusLabel = goal
    ? goal.status === 'on-track'
      ? t('goalStatusOnTrack')
      : goal.status === 'need-up'
        ? t('goalStatusNeedUp')
        : goal.status === 'unreachable'
          ? t('goalStatusUnreachable')
          : t('goalStatusNoTarget')
    : null;

  const progress = goal
    ? goal.targetDelta > 0
      ? Math.max(0, Math.min(1, goal.currentDelta / goal.targetDelta))
      : goal.currentDelta >= goal.targetDelta
        ? 1
        : 0
    : 0;

  return (
    <Card className="goal-card">
      <CardHead
        title={t('goal')}
        action={
          goal && statusLabel ? (
            <Badge tone={statusTone(goal.status)}>{statusLabel}</Badge>
          ) : settings.targetRating ? (
            <Badge>{t('goalStatusNoTarget')}</Badge>
          ) : null
        }
      />

      <form className="inline-form" onSubmit={submit}>
        <input
          className="input input--number"
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t('targetPlaceholder')}
          aria-label={t('targetRating')}
        />
        <button type="submit" className="btn btn-sm" disabled={!draft.trim()}>
          {t('setTarget')}
        </button>
        {settings.targetRating ? (
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              applyTarget(null);
              setDraft('');
            }}
            aria-label={t('clearTarget')}
            title={t('clearTarget')}
          >
            <IconClose />
          </button>
        ) : null}
      </form>

      <div className="chips" role="group" aria-label={t('milestones')}>
        {predicted ? (
          <>
            <button
              type="button"
              className="chip"
              onClick={() => applyTarget(Math.round(predicted.oldRating) + 50)}
            >
              {t('quickAdd', { n: 50 })}
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => applyTarget(Math.round(predicted.oldRating) + 100)}
            >
              {t('quickAdd', { n: 100 })}
            </button>
          </>
        ) : null}
        {MILESTONES.map((milestone) => (
          <button
            key={milestone}
            type="button"
            className={`chip ${settings.targetRating === milestone ? 'is-active' : ''}`}
            onClick={() => applyTarget(milestone)}
          >
            {milestone}
          </button>
        ))}
      </div>

      {goal ? (
        <>
          <div className="goal-stats">
            <Stat
              label={t('goalCurrentDelta')}
              value={formatDelta(goal.currentDelta)}
              valueColor={deltaColor(goal.currentDelta)}
            />
            <Stat
              label={t('goalTargetDelta')}
              value={formatDelta(goal.targetDelta)}
              valueColor={deltaColor(goal.targetDelta)}
            />
            <Stat
              label={t('goalNeededRankLabel')}
              value={goal.neededRank !== null ? `#${goal.neededRank}` : t('empty')}
            />
          </div>

          <Progress
            value={progress}
            tone={goal.status === 'unreachable' ? 'danger' : 'accent'}
            ariaLabel={t('goalProgressAria')}
          />

          <div className="goal-lines">
            {goal.status === 'on-track' ? (
              <p className="goal-line goal-line--good">{t('goalOnTrackLine')}</p>
            ) : null}
            {goal.status === 'need-up' && goal.neededRank !== null ? (
              <p className="goal-line">
                {goal.currentRank > goal.neededRank
                  ? t('goalOvertake', { n: goal.currentRank - goal.neededRank })
                  : t('goalNeededRankLine', { n: goal.neededRank })}
              </p>
            ) : null}
            {goal.status === 'unreachable' ? (
              <p className="goal-line goal-line--bad">{t('goalUnreachableLine')}</p>
            ) : null}

            <p className="goal-now">
              <span>{t('goalNowLabel')}</span>
              {predicted ? (
                <b style={{ color: ratingColor(predicted.newRating) }}>
                  {formatRating(predicted.newRating)}
                </b>
              ) : (
                <b>{t('empty')}</b>
              )}
              <span aria-hidden="true">→</span>
              <span>{t('goalTargetLabel')}</span>
              <b style={{ color: ratingColor(goal.targetRating ?? 0) }}>
                {goal.targetRating !== null ? formatRating(goal.targetRating) : t('empty')}
              </b>
            </p>
          </div>
        </>
      ) : (
        <p className="hint">{settings.targetRating ? t('goalNoData') : t('goalNoTarget')}</p>
      )}
    </Card>
  );
}
