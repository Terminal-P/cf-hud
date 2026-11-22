import { useEffect, useState } from 'react';
import { session, useSession } from '../../app/useSession';
import { DEFAULT_SETTINGS } from '../../data/storage';
import {
  notificationPermission,
  requestNotificationPermission,
  type NotificationPermissionState,
} from '../events';
import { profileUrl } from '../format';
import { useT } from '../hooks/useT';
import { IconClose, IconLink, IconSpinner } from './icons';
import { Card, CardHead } from './ui';
import { WatchEditor } from './WatchList';

/** Collapsible settings: account, appearance, polling, notifications, goal, watch. */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const state = useSession();
  const t = useT();
  const { settings } = state;

  const [handleDraft, setHandleDraft] = useState(settings.handle);
  const [handleBusy, setHandleBusy] = useState(false);
  const [targetDraft, setTargetDraft] = useState(
    settings.targetRating ? String(settings.targetRating) : '',
  );
  const [resetArmed, setResetArmed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermissionState>(() =>
    notificationPermission(),
  );

  useEffect(() => {
    setHandleDraft(settings.handle);
  }, [settings.handle]);

  useEffect(() => {
    setTargetDraft(settings.targetRating ? String(settings.targetRating) : '');
  }, [settings.targetRating]);

  const saveHandle = async () => {
    const handle = handleDraft.trim();
    if (!handle || handleBusy) return;
    setHandleBusy(true);
    try {
      await session.setHandle(handle);
    } catch {
      // The store surfaces the message through the error banner.
    } finally {
      setHandleBusy(false);
    }
  };

  const applyTarget = () => {
    const parsed = Number(targetDraft);
    if (Number.isFinite(parsed) && parsed > 0) session.setTargetRating(Math.round(parsed));
  };

  const toggleNotifications = async () => {
    const next = !settings.notifications;
    session.updateSettings({ notifications: next });
    if (next) {
      const result = await requestNotificationPermission();
      setPermission(result);
    }
  };

  const resetEverything = () => {
    if (!resetArmed) {
      setResetArmed(true);
      return;
    }
    session.setTargetRating(null);
    session.updateSettings({
      ...DEFAULT_SETTINGS,
      handle: settings.handle,
      hasOnboarded: settings.hasOnboarded,
    });
    void session.selectContest(null);
    setResetArmed(false);
  };

  return (
    <Card className="settings-card">
      <CardHead
        title={t('settingsTitle')}
        action={
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label={t('closeSettings')}
            title={t('closeSettings')}
          >
            <IconClose />
          </button>
        }
      />

      {/* Account */}
      <div className="settings-section">
        <span className="settings-heading">{t('sectionAccount')}</span>
        <div className="settings-row">
          <span className="settings-value">
            {settings.handle ? (
              <a
                className="settings-link"
                href={profileUrl(settings.handle)}
                target="_blank"
                rel="noreferrer noopener"
                title={t('openProfile')}
              >
                {settings.handle}
                <IconLink />
              </a>
            ) : (
              t('empty')
            )}
          </span>
          {settings.handle ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void session.setHandle('')}
            >
              {t('disconnect')}
            </button>
          ) : null}
        </div>
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveHandle();
          }}
        >
          <input
            className="input"
            value={handleDraft}
            onChange={(event) => setHandleDraft(event.target.value)}
            placeholder={t('handlePlaceholder')}
            aria-label={t('changeHandle')}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={64}
            disabled={handleBusy}
          />
          <button
            type="submit"
            className="btn btn-sm"
            disabled={handleBusy || !handleDraft.trim()}
          >
            {handleBusy ? <IconSpinner /> : null}
            {t('saveHandle')}
          </button>
        </form>
      </div>

      {/* Appearance */}
      <div className="settings-section">
        <span className="settings-heading">{t('sectionAppearance')}</span>

        <div className="settings-row">
          <span className="settings-label">{t('language')}</span>
          <div className="segmented" role="group" aria-label={t('language')}>
            <button
              type="button"
              className={settings.language === 'en' ? 'is-active' : ''}
              aria-pressed={settings.language === 'en'}
              onClick={() => session.updateSettings({ language: 'en' })}
            >
              EN
            </button>
            <button
              type="button"
              className={settings.language === 'zh' ? 'is-active' : ''}
              aria-pressed={settings.language === 'zh'}
              onClick={() => session.updateSettings({ language: 'zh' })}
            >
              中文
            </button>
          </div>
        </div>

        <div className="settings-row">
          <span className="settings-label">{t('theme')}</span>
          <div className="segmented" role="group" aria-label={t('theme')}>
            <button
              type="button"
              className={settings.theme === 'dark' ? 'is-active' : ''}
              aria-pressed={settings.theme === 'dark'}
              onClick={() => session.updateSettings({ theme: 'dark' })}
            >
              {t('themeDark')}
            </button>
            <button
              type="button"
              className={settings.theme === 'light' ? 'is-active' : ''}
              aria-pressed={settings.theme === 'light'}
              onClick={() => session.updateSettings({ theme: 'light' })}
            >
              {t('themeLight')}
            </button>
          </div>
        </div>

        <label className="settings-row settings-row--range">
          <span className="settings-label">{t('opacity')}</span>
          <span className="settings-range">
            <input
              type="range"
              min={0.4}
              max={1}
              step={0.02}
              value={settings.opacity}
              aria-label={t('opacity')}
              onChange={(event) =>
                session.updateSettings({ opacity: Number(event.target.value) })
              }
            />
            <span className="settings-value">{Math.round(settings.opacity * 100)}%</span>
          </span>
        </label>
      </div>

      {/* Data */}
      <div className="settings-section">
        <span className="settings-heading">{t('sectionData')}</span>
        <label className="settings-row settings-row--range">
          <span className="settings-label">{t('pollInterval')}</span>
          <span className="settings-range">
            <input
              type="range"
              min={30}
              max={300}
              step={10}
              value={settings.pollSeconds}
              aria-label={t('pollInterval')}
              onChange={(event) =>
                session.updateSettings({ pollSeconds: Number(event.target.value) })
              }
            />
            <span className="settings-value">
              {t('pollIntervalValue', { n: settings.pollSeconds })}
            </span>
          </span>
        </label>
      </div>

      {/* Notifications */}
      <div className="settings-section">
        <span className="settings-heading">{t('sectionNotifications')}</span>
        <div className="settings-row">
          <div className="settings-label-group">
            <span className="settings-label">{t('notifications')}</span>
            <span className="settings-hint">{t('notificationsHint')}</span>
          </div>
          <button
            type="button"
            className="switch"
            role="switch"
            aria-checked={settings.notifications}
            aria-label={t('notifications')}
            onClick={() => void toggleNotifications()}
          />
        </div>
        {settings.notifications && permission === 'denied' ? (
          <p className="settings-note settings-note--warn">{t('notificationsBlocked')}</p>
        ) : null}
        {permission === 'unsupported' ? (
          <p className="settings-note">{t('notificationsUnsupported')}</p>
        ) : null}
        {permission === 'granted' && settings.notifications ? (
          <p className="settings-note settings-note--good">{t('notificationsGranted')}</p>
        ) : null}
      </div>

      {/* Goal */}
      <div className="settings-section">
        <span className="settings-heading">{t('sectionGoal')}</span>
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            applyTarget();
          }}
        >
          <input
            className="input"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={targetDraft}
            onChange={(event) => setTargetDraft(event.target.value)}
            placeholder={t('targetPlaceholder')}
            aria-label={t('targetRating')}
          />
          <button type="submit" className="btn btn-sm" disabled={!targetDraft.trim()}>
            {t('setTarget')}
          </button>
          {settings.targetRating ? (
            <button
              type="button"
              className="icon-btn"
              onClick={() => {
                session.setTargetRating(null);
                setTargetDraft('');
              }}
              aria-label={t('clearTarget')}
              title={t('clearTarget')}
            >
              <IconClose />
            </button>
          ) : null}
        </form>
      </div>

      {/* Watch list */}
      <div className="settings-section">
        <span className="settings-heading">{t('sectionWatch')}</span>
        <WatchEditor />
      </div>

      {/* Reset */}
      <div className="settings-section">
        <span className="settings-heading">{t('sectionDanger')}</span>
        <p className="settings-hint">{t('resetHint')}</p>
        <div className="settings-row">
          <button
            type="button"
            className={`btn btn-sm ${resetArmed ? 'btn-danger' : ''}`}
            onClick={resetEverything}
          >
            {resetArmed ? t('resetConfirm') : t('resetButton')}
          </button>
          {resetArmed ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setResetArmed(false)}>
              {t('cancel')}
            </button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
