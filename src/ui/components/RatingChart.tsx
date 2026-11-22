import type { HistoryPoint } from '../../core/types';
import { formatRating, ratingColor } from '../format';
import { useT } from '../hooks/useT';

const VIEW_WIDTH = 320;
const VIEW_HEIGHT = 84;
const PAD_Y = 8;

/** Rating history line chart (SVG, no dependencies) with min/max labels. */
export function RatingChart({ points, ariaLabel }: { points: HistoryPoint[]; ariaLabel: string }) {
  const t = useT();
  const data = points.slice(-15);
  const ratings = data.map((point) => point.rating);
  const min = Math.min(...ratings);
  const max = Math.max(...ratings);
  const pad = Math.max(12, (max - min) * 0.18);
  const lo = min - pad;
  const hi = max + pad;
  const span = hi - lo || 1;
  const innerHeight = VIEW_HEIGHT - PAD_Y * 2;
  const step = data.length > 1 ? VIEW_WIDTH / (data.length - 1) : 0;

  const coords = data.map((point, index) => {
    const x = data.length > 1 ? index * step : VIEW_WIDTH / 2;
    const y = VIEW_HEIGHT - PAD_Y - ((point.rating - lo) / span) * innerHeight;
    return [x, y] as const;
  });

  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area =
    coords.length > 1
      ? `${coords[0][0].toFixed(1)},${VIEW_HEIGHT} ${line} ${
          coords[coords.length - 1][0].toFixed(1)
        },${VIEW_HEIGHT}`
      : '';
  const last = data[data.length - 1];
  const lastCoord = coords[coords.length - 1];

  return (
    <div className="rating-chart-wrap">
      <svg
        className="rating-chart"
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        height={VIEW_HEIGHT}
        role="img"
        aria-label={ariaLabel}
        preserveAspectRatio="none"
      >
        <line
          x1="0"
          y1={VIEW_HEIGHT - PAD_Y}
          x2={VIEW_WIDTH}
          y2={VIEW_HEIGHT - PAD_Y}
          stroke="var(--border)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1="0"
          y1={PAD_Y}
          x2={VIEW_WIDTH}
          y2={PAD_Y}
          stroke="var(--border)"
          strokeDasharray="3 4"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        {area ? <polygon points={area} fill="var(--accent)" opacity="0.12" /> : null}
        {line ? (
          <polyline
            points={line}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {lastCoord ? (
          <circle
            cx={lastCoord[0]}
            cy={lastCoord[1]}
            r="2.6"
            fill={last ? ratingColor(last.rating) : 'var(--accent)'}
          />
        ) : null}
      </svg>

      <div className="chart-foot">
        <span>{t('chartMin', { n: formatRating(min) })}</span>
        <span className="chart-last" style={{ color: last ? ratingColor(last.rating) : undefined }}>
          {t('ratingLabel')} {formatRating(last?.rating ?? min)}
        </span>
        <span>{t('chartMax', { n: formatRating(max) })}</span>
      </div>
    </div>
  );
}
