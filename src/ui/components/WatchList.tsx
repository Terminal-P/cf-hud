import { useState, type FormEvent } from 'react';
import { session, useSession } from '../../app/useSession';
import { formatDelta } from '../../core/format';
import type { WatchEntry } from '../../core/types';
import { deltaColor, formatPoints, truncate } from '../format';
import { useT } from '../hooks/useT';
import { IconClose } from './icons';
import { Card, CardHead } from './ui';

/** Add/remove + render the watch list; reused by the card and the settings panel. */
export function WatchEditor() {
  const state = useSession();
  const t = useT();
  const [draft, setDraft] = useState('');
  const entries = state.watch;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const handle = draft.trim();
    if (!handle) return;
    session.addWatch(handle);
    setDraft('');
  };

  return (
    <div className="watch-editor">
      <form className="inline-form" onSubmit={submit}>
        <input
          className="input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t('watchPlaceholder')}
          aria-label={t('watchPlaceholder')}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={64}
        />
        <button type="submit" className="btn btn-sm" disabled={!draft.trim()}>
          {t('watchAdd')}
        </button>
      </form>

      {entries.length === 0 ? (
        <p className="empty">{t('watchEmpty')}</p>
      ) : (
        <ul className="watch-list">
          {entries.map((entry) => (
            <WatchRow key={entry.handle.toLowerCase()} entry={entry} removeLabel={t('watchRemove', { handle: entry.handle })} />
          ))}
        </ul>
      )}
    </div>
  );
}

function WatchRow({ entry, removeLabel }: { entry: WatchEntry; removeLabel: string }) {
  const t = useT();
  const { row, prediction } = entry;
  return (
    <li className="watch-row">
      <div className="watch-main">
        <span className="watch-handle" title={entry.handle}>
          {truncate(entry.handle, 22)}
        </span>
        {row ? (
          <span className="watch-meta">
            <span className="watch-rank">#{row.rank.toLocaleString()}</span>
            <span>{formatPoints(row.points)} pts</span>
            <span>
              {row.solved} {t('solved')}
            </span>
          </span>
        ) : (
          <span className="watch-meta watch-meta--missing">{t('watchNotInStandings')}</span>
        )}
      </div>
      <span
        className="watch-delta"
        style={{ color: prediction ? deltaColor(prediction.delta) : 'var(--text-faint)' }}
      >
        {prediction ? formatDelta(prediction.delta) : t('empty')}
      </span>
      <button
        type="button"
        className="icon-btn watch-remove"
        onClick={() => session.removeWatch(entry.handle)}
        aria-label={removeLabel}
        title={removeLabel}
      >
        <IconClose />
      </button>
    </li>
  );
}

/** Watch list card shown in the main HUD. */
export function WatchList() {
  const state = useSession();
  const t = useT();
  return (
    <Card className="watch-card">
      <CardHead
        title={t('watchList')}
        action={<span className="faint">{state.watch.length}</span>}
      />
      <WatchEditor />
    </Card>
  );
}
