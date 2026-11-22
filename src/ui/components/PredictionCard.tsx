import { useSession } from '../../app/useSession';
import { formatDelta } from '../../core/format';
import type { PredictionNote } from '../../core/types';
import type { TranslationKey, TFunction } from '../i18n';
import { deltaColor, formatRating, ratingColor } from '../format';
import { useT } from '../hooks/useT';
import { IconAlert, IconInfo } from './icons';
import { Badge, Card, CardHead } from './ui';

function noteText(t: TFunction, note: PredictionNote): string {
  const keys: Record<PredictionNote, TranslationKey> = {
    frozen: 'noteFrozen',
    provisional: 'noteProvisional',
    unrated: 'reasonUnrated',
    estimatedRatings: 'noteEstimatedRatings',
    noRatings: 'reasonNoRatings',
    smallField: 'noteSmallField',
  };
  return t(keys[note]);
}

/** Rating estimate with interval, confidence and the model's caveats. */
export function PredictionCard() {
  const state = useSession();
  const t = useT();
  const result = state.prediction;

  if (!result) return null;

  if (!result.ok) {
    return (
      <Card className="prediction-card">
        <CardHead title={t('prediction')} />
        <p className="empty">{t('predictionUnavailable')}</p>
        <p className="hint">
          {result.reason === 'unrated' ? t('reasonUnrated') : t('reasonNoRatings')}
        </p>
        <p className="disclaimer">{t('disclaimer')}</p>
      </Card>
    );
  }

  const prediction = result.prediction;
  const confidenceKey: Record<typeof prediction.confidence, TranslationKey> = {
    high: 'confidenceHigh',
    medium: 'confidenceMedium',
    low: 'confidenceLow',
  };
  const confidenceTone =
    prediction.confidence === 'high' ? 'good' : prediction.confidence === 'medium' ? 'warn' : 'bad';

  return (
    <Card className="prediction-card">
      <CardHead
        title={t('prediction')}
        action={
          <Badge tone={confidenceTone} title={t('confidence')}>
            {t('confidence')} {t(confidenceKey[prediction.confidence])}
          </Badge>
        }
      />

      <div className="delta-hero">
        <span className="delta-value" style={{ color: deltaColor(prediction.delta) }}>
          {formatDelta(prediction.delta)}
        </span>
        <div className="delta-side">
          <span className="delta-interval">
            {t('intervalLabel')} {formatDelta(prediction.deltaLow)} …{' '}
            {formatDelta(prediction.deltaHigh)}
          </span>
          <span className="delta-rating">
            {t('newRatingLabel')}{' '}
            <b style={{ color: ratingColor(prediction.newRating) }}>
              {formatRating(prediction.newRating)}
            </b>
            <span className="faint">
              {' '}
              ({formatRating(prediction.newRatingLow)}–{formatRating(prediction.newRatingHigh)})
            </span>
          </span>
        </div>
      </div>

      <div className="pred-meta">
        <span>{t('seedLabel', { n: Math.round(prediction.seed) })}</span>
        <span>{t('performanceLabel', { n: formatRating(prediction.performance) })}</span>
        <span>{t('oldRatingLabel', { n: formatRating(prediction.oldRating) })}</span>
      </div>

      {prediction.notes.length > 0 ? (
        <ul className="notes">
          {prediction.notes.map((note) => {
            const warning = note === 'frozen';
            return (
              <li key={note} className={`note ${warning ? 'note--warn' : 'note--info'}`}>
                {warning ? <IconAlert /> : <IconInfo />}
                <span>{noteText(t, note)}</span>
              </li>
            );
          })}
        </ul>
      ) : null}

      <p className="disclaimer">{t('disclaimer')}</p>
    </Card>
  );
}
