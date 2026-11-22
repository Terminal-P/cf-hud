import { useState, type FormEvent } from 'react';
import { session, useSession } from '../../app/useSession';
import { useT } from '../hooks/useT';
import { IconInfo, IconLink, IconSpinner } from './icons';

/** Handle entry shown until a Codeforces account is connected. */
export function Onboarding() {
  const t = useT();
  const state = useSession();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const handle = draft.trim();
    if (!handle || busy) return;
    setBusy(true);
    try {
      await session.setHandle(handle);
    } catch {
      // The store exposes the failure through `state.error` (error banner).
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onboard">
      <div className="onboard-hero">
        <div className="onboard-logo" aria-hidden="true">
          CF
        </div>
        <div className="onboard-heading">
          <h1 className="onboard-title">{t('onboardTitle')}</h1>
          <p className="onboard-sub">{t('onboardSubtitle')}</p>
        </div>
      </div>

      <form className="onboard-form" onSubmit={submit}>
        <label className="field-label" htmlFor="cf-handle-input">
          {t('handleLabel')}
        </label>
        <div className="inline-form">
          <input
            id="cf-handle-input"
            className="input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t('handlePlaceholder')}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={64}
            disabled={busy}
            aria-describedby="cf-onboard-note"
            aria-invalid={Boolean(state.error) || undefined}
          />
          <button type="submit" className="btn btn-primary" disabled={busy || !draft.trim()}>
            {busy ? (
              <>
                <IconSpinner /> {t('connecting')}
              </>
            ) : (
              t('connect')
            )}
          </button>
        </div>
      </form>

      <p className="onboard-note" id="cf-onboard-note">
        <IconInfo /> {t('onboardNote')}
      </p>

      <a
        className="onboard-link"
        href="https://codeforces.com/profile"
        target="_blank"
        rel="noreferrer noopener"
      >
        {t('openProfile')}
        <IconLink />
      </a>
    </div>
  );
}
