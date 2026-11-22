import { useSession } from '../../app/useSession';
import type { ProblemCell } from '../../core/types';
import { formatCompact, formatPoints, formatSolveTime } from '../format';
import { useT } from '../hooks/useT';
import type { TFunction } from '../i18n';
import { Card, CardHead } from './ui';

function cellAriaLabel(problem: ProblemCell, t: TFunction): string {
  const points = formatPoints(problem.pointsPossible);
  const solvers = formatCompact(problem.solvedCount);
  if (problem.mySolved) {
    return t('problemAriaSolved', {
      index: problem.index,
      time: formatSolveTime(problem.myTimeSeconds),
      points,
      solvers,
    });
  }
  if (problem.myAttempts > 0) {
    return t('problemAriaAttempted', {
      index: problem.index,
      attempts: problem.myAttempts,
      points,
      solvers,
    });
  }
  return t('problemAriaUntouched', { index: problem.index, points, solvers });
}

/** Per-problem grid: my status, accepted time, attempts and field solve count. */
export function ProblemMatrix() {
  const state = useSession();
  const t = useT();
  const snapshot = state.snapshot;

  if (!snapshot) return null;

  const problems = snapshot.problems;
  const solved = problems.filter((problem) => problem.mySolved).length;
  const columns = Math.min(Math.max(problems.length, 2), 6);

  return (
    <Card className="problems-card">
      <CardHead
        title={t('problems')}
        action={
          <span className="faint">
            {solved}/{problems.length}
          </span>
        }
      />

      {problems.length === 0 ? (
        <p className="empty">{t('noProblems')}</p>
      ) : (
        <div
          className="problem-grid"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {problems.map((problem) => {
            const burnt = !problem.mySolved && problem.myAttempts >= 3;
            const state_ = problem.mySolved
              ? 'is-solved'
              : problem.myAttempts > 0
                ? burnt
                  ? 'is-burnt'
                  : 'is-attempted'
                : 'is-untouched';
            const aria = cellAriaLabel(problem, t);
            return (
              <div
                key={problem.index}
                className={`problem-cell ${state_}`}
                role="img"
                aria-label={aria}
                title={aria}
              >
                <div className="problem-top">
                  <span className="problem-index">{problem.index}</span>
                  <span className="problem-solvers">{formatCompact(problem.solvedCount)}</span>
                </div>
                <span className="problem-points">{formatPoints(problem.pointsPossible)}</span>
                <span className="problem-status">
                  {problem.mySolved
                    ? formatSolveTime(problem.myTimeSeconds)
                    : problem.myAttempts > 0
                      ? t('attemptsShort', { n: problem.myAttempts })
                      : t('empty')}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="legend">
        <span className="legend-item">
          <i className="legend-dot legend-dot--solved" aria-hidden="true" />
          {t('legendSolved')}
        </span>
        <span className="legend-item">
          <i className="legend-dot legend-dot--attempted" aria-hidden="true" />
          {t('legendAttempted')}
        </span>
        <span className="legend-item">
          <i className="legend-dot legend-dot--untouched" aria-hidden="true" />
          {t('legendUntouched')}
        </span>
      </div>
    </Card>
  );
}
