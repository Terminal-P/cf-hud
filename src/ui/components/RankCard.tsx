import { useSession } from '../../app/useSession';
import { formatDelta, rankPercentile } from '../../core/format';
import type { RowLookup } from '../../core/types';
import type { TFunction } from '../i18n';
import {
  formatPoints,
  formatSolveTime,
  formatTopPercent,
  truncate,
} from '../format';
import { useT } from '../hooks/useT';
import { IconArrowDown, IconArrowUp } from './icons';
import { Badge, Card } from './ui';
import { Sparkline } from './Sparkline';

/** Rank, percentile, score, neighbours and the locally recorded rank trend. */
export function RankCard() {
  const state = useSession();
  const t = useT();
  const vpActive = Boolean(state.vp);
  const snapshot = state.snapshot;
  const me = snapshot?.me ?? null;

  if (!snapshot) return null;

  if (!me) {
    return (
      <Card className="rank-card">
        <div className="rank-empty">
          <p className="empty">{t('notOnBoard')}</p>
          <p className="hint">{t('notOnBoardHint')}</p>
        </div>
      </Card>
    );
  }

  const percentile = rankPercentile(me.rank, snapshot.participants);
  const totalPoints = snapshot.problems.reduce((sum, problem) => sum + problem.pointsPossible, 0);
  const lastSolve = snapshot.problems.reduce(
    (best, problem) =>
      problem.myTimeSeconds !== undefined ? Math.max(best, problem.myTimeSeconds) : best,
    0,
  );
  const history = state.rankHistory;

  return (
    <Card className="rank-card">
      <div className="rank-hero">
        <div className="rank-figure">
          <span className="rank-hash" aria-hidden="true">
            #
          </span>
          <span className="rank-value">{me.rank.toLocaleString()}</span>
          {vpActive ? (
            <Badge tone="info" className="rank-vp-badge">
              {t('vpRankLabel')}
            </Badge>
          ) : null}
        </div>
        <div className="rank-side">
          <span className="rank-total">
            {vpActive
              ? t('vpOfOfficial', { n: snapshot.participants.toLocaleString() })
              : t('rankOf', { n: snapshot.participants.toLocaleString() })}
          </span>
          <Badge tone="info">{t('topPercent', { pct: formatTopPercent(percentile) })}</Badge>
        </div>
      </div>

      <div className="spark-block">
        <div className="spark-head">
          <span className="spark-title">{t('rankTrend')}</span>
          <span className="spark-hint">{t('rankTrendHint')}</span>
        </div>
        {history.length >= 2 ? (
          <Sparkline
            values={history.map((point) => point.rank)}
            invert
            ariaLabel={t('rankTrend')}
          />
        ) : (
          <p className="spark-empty">{t('rankTrendEmpty')}</p>
        )}
      </div>

      <div className="stat-grid">
        <div className="stat">
          <span className="stat-label">{t('points')}</span>
          <span className="stat-value">{formatPoints(me.points)}</span>
          <span className="stat-sub">{t('maxPoints', { n: formatPoints(totalPoints) })}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{t('penalty')}</span>
          <span className="stat-value">{formatPoints(me.penalty)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{t('solved')}</span>
          <span className="stat-value">
            {me.solved}/{snapshot.problems.length}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">{t('lastAC')}</span>
          <span className="stat-value stat-value--time">{formatSolveTime(lastSolve || null)}</span>
        </div>
      </div>

      <div className="neighbors">
        <NeighborRow
          direction="up"
          label={t('above')}
          row={snapshot.neighbors.above}
          mePoints={me.points}
          tf={t}
        />
        <NeighborRow
          direction="down"
          label={t('below')}
          row={snapshot.neighbors.below}
          mePoints={me.points}
          tf={t}
        />
      </div>
    </Card>
  );
}

function NeighborRow({
  direction,
  label,
  row,
  mePoints,
  tf,
}: {
  direction: 'up' | 'down';
  label: string;
  row: RowLookup | null;
  mePoints: number;
  tf: TFunction;
}) {
  if (!row) {
    return (
      <div className="neighbor is-empty">
        <span className="neighbor-label">{label}</span>
        <span className="neighbor-name">{tf('empty')}</span>
      </div>
    );
  }

  const diff = Math.round(mePoints - row.points);
  const tied = diff === 0;
  const gapClass = tied ? 'is-tied' : diff > 0 ? 'is-ahead' : 'is-behind';

  return (
    <div className={`neighbor ${tied ? 'is-tied' : ''}`}>
      <span className="neighbor-label">{label}</span>
      <span className="neighbor-arrow" aria-hidden="true">
        {direction === 'up' ? <IconArrowUp size={10} /> : <IconArrowDown size={10} />}
      </span>
      <span className="neighbor-rank">#{row.rank.toLocaleString()}</span>
      <span className="neighbor-name" title={row.handle}>
        {truncate(row.handle, 18)}
      </span>
      <span className={`neighbor-gap ${gapClass}`}>
        {tied ? tf('tied') : tf('gapPts', { gap: formatDelta(diff) })}
      </span>
    </div>
  );
}
