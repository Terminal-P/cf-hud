import { useSession } from '../../app/useSession';
import { formatDelta } from '../../core/format';
import type { CSSProperties } from 'react';
import { contestUrl, deltaColor, formatRating, ratingColor, truncate } from '../format';
import { useT } from '../hooks/useT';
import { IconLink } from './icons';
import { Card, CardHead } from './ui';
import { RatingChart } from './RatingChart';

const deltaStyle = (delta: number): CSSProperties => ({ color: deltaColor(delta) });

/** Post-contest view: official delta vs the prediction, plus rating history. */
export function SettlementView() {
  const state = useSession();
  const t = useT();
  const settlement = state.settlement;

  if (!settlement) return null;

  const actual = settlement.actual;
  const actualDelta = actual ? actual.newRating - actual.oldRating : null;
  const predicted = settlement.predictedDelta;
  const diff = actualDelta !== null && predicted !== null ? actualDelta - predicted : null;
  const history = state.ratingHistory;
  const contestName = state.contest?.name ?? settlement.actual?.contestName ?? '';

  return (
    <Card className="settlement-card">
      <CardHead
        title={t('settlement')}
        subtitle={contestName ? <span title={contestName}>{truncate(contestName, 28)}</span> : undefined}
        action={
          <a
            className="icon-btn"
            href={contestUrl(settlement.contestId)}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={t('viewContest')}
            title={t('viewContest')}
          >
            <IconLink />
          </a>
        }
      />

      {actual && actualDelta !== null ? (
        <div className="settle-hero">
          <div className="settle-primary">
            <span className="stat-label">{t('officialDelta')}</span>
            <span className="settle-delta" style={deltaStyle(actualDelta)}>
              {formatDelta(actualDelta)}
            </span>
            <span className="settle-rating">
              {t('newRating')}{' '}
              <b style={{ color: ratingColor(actual.newRating) }}>
                {formatRating(actual.newRating)}
              </b>
            </span>
          </div>
          <div className="settle-side">
            <span className="settle-row">
              <span>{t('predictedDeltaShort')}</span>
              <b style={predicted !== null ? deltaStyle(predicted) : undefined}>
                {predicted !== null ? formatDelta(predicted) : t('empty')}
              </b>
            </span>
            <span className="settle-row">
              <span>{t('difference')}</span>
              <b style={diff !== null ? deltaStyle(diff) : undefined}>
                {diff !== null ? formatDelta(diff) : t('empty')}
              </b>
            </span>
          </div>
        </div>
      ) : (
        <div className="settle-pending">
          <p className="empty">{t('settlementPending')}</p>
          {predicted !== null ? (
            <p className="settle-row">
              <span>{t('predictedDeltaShort')}</span>
              <b style={deltaStyle(predicted)}>{formatDelta(predicted)}</b>
            </p>
          ) : null}
          <p className="hint">{t('settlementPendingHint')}</p>
        </div>
      )}

      {history.length > 1 ? (
        <div className="settle-history">
          <div className="spark-head">
            <span className="spark-title">{t('ratingHistory')}</span>
            <span className="spark-hint">{t('ratingHistoryRange', { n: Math.min(history.length, 15) })}</span>
          </div>
          <RatingChart
            points={history}
            ariaLabel={t('chartAria', {
              min: formatRating(Math.min(...history.map((point) => point.rating))),
              max: formatRating(Math.max(...history.map((point) => point.rating))),
            })}
          />
        </div>
      ) : null}
    </Card>
  );
}
