import type { CSSProperties, ReactNode } from 'react';
import { percentWidth } from '../format';

/* ------------------------------------------------------------------ */
/* Cards                                                               */
/* ------------------------------------------------------------------ */

export function Card({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section className={className ? `card ${className}` : 'card'} style={style}>
      {children}
    </section>
  );
}

export function CardHead({
  title,
  action,
  subtitle,
}: {
  title: string;
  action?: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <div className="card-head">
      <h2 className="card-title">{title}</h2>
      {subtitle ? <span className="card-subtitle">{subtitle}</span> : null}
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Badges, progress, stats                                             */
/* ------------------------------------------------------------------ */

export type BadgeTone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';

export function Badge({
  children,
  tone = 'neutral',
  title,
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  title?: string;
  className?: string;
}) {
  const classes = ['badge', tone !== 'neutral' ? `badge--${tone}` : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <span className={classes} title={title}>
      {children}
    </span>
  );
}

export function Progress({
  value,
  tone = 'accent',
  ariaLabel,
}: {
  /** 0..1 */
  value: number;
  tone?: 'accent' | 'danger';
  ariaLabel: string;
}) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <div
      className={`progress progress--${tone}`}
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
    >
      <div className="progress-fill" style={{ width: percentWidth(clamped) }} />
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  valueColor,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  valueColor?: string;
  className?: string;
}) {
  return (
    <div className={className ? `stat ${className}` : 'stat'}>
      <span className="stat-label">{label}</span>
      <span className="stat-value" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </span>
      {sub ? <span className="stat-sub">{sub}</span> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Loading skeletons                                                   */
/* ------------------------------------------------------------------ */

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card skeleton-card" aria-hidden="true">
      <div className="sk sk-title" />
      {Array.from({ length: lines }, (_, index) => (
        <div key={index} className="sk sk-line" style={{ width: `${92 - index * 14}%` }} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Error banner                                                        */
/* ------------------------------------------------------------------ */

export function ErrorBanner({
  title,
  message,
  hint,
  onDismiss,
  dismissLabel,
}: {
  title?: string;
  message: string;
  hint?: string;
  onDismiss: () => void;
  dismissLabel: string;
}) {
  return (
    <div className="error-banner" role="alert">
      <div className="error-body">
        {title ? <strong className="error-title">{title}</strong> : null}
        <span className="error-message">{message}</span>
        {hint ? <span className="error-hint">{hint}</span> : null}
      </div>
      <button
        type="button"
        className="icon-btn error-close"
        onClick={onDismiss}
        aria-label={dismissLabel}
        title={dismissLabel}
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
