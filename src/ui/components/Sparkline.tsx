interface SparklineProps {
  values: number[];
  /** When true a lower value is drawn higher (ranks: 1 is best). */
  invert?: boolean;
  height?: number;
  ariaLabel: string;
  tone?: string;
}

const VIEW_WIDTH = 320;
const MAX_POINTS = 60;

/** Small dependency-free SVG line chart. */
export function Sparkline({
  values,
  invert = false,
  height = 34,
  ariaLabel,
  tone = 'var(--accent)',
}: SparklineProps) {
  const data = values.slice(-MAX_POINTS);
  const pad = 3;
  const innerHeight = Math.max(1, height - pad * 2);

  let points: Array<[number, number]> = [];
  if (data.length === 1) {
    points = [
      [0, height / 2],
      [VIEW_WIDTH, height / 2],
    ];
  } else if (data.length > 1) {
    const min = Math.min(...data);
    const max = Math.max(...data);
    const span = max - min || 1;
    const step = VIEW_WIDTH / (data.length - 1);
    points = data.map((value, index) => {
      const normalised = (value - min) / span;
      const y = invert
        ? pad + normalised * innerHeight
        : height - pad - normalised * innerHeight;
      return [index * step, y] as [number, number];
    });
  }

  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area =
    points.length > 1
      ? `${points[0][0].toFixed(1)},${height} ${line} ${points[points.length - 1][0].toFixed(1)},${height}`
      : '';
  const last = points[points.length - 1];

  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${VIEW_WIDTH} ${height}`}
      height={height}
      role="img"
      aria-label={ariaLabel}
      preserveAspectRatio="none"
    >
      {area ? <polygon points={area} fill={tone} opacity="0.12" /> : null}
      {line ? (
        <polyline
          points={line}
          fill="none"
          stroke={tone}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {last ? <circle cx={last[0]} cy={last[1]} r="2.2" fill={tone} /> : null}
    </svg>
  );
}
