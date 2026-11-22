import type { Language, TFunction } from '../i18n';
import { IconCollapse, IconExpand, IconGear, IconPin, IconPopOut } from './icons';

export interface HeaderProps {
  t: TFunction;
  mini: boolean;
  isTauri: boolean;
  alwaysOnTop: boolean;
  pipSupported: boolean;
  pipOpen: boolean;
  settingsOpen: boolean;
  language: Language;
  onToggleAlwaysOnTop: () => void;
  onToggleMini: () => void;
  onTogglePip: () => void;
  onToggleLanguage: () => void;
  onToggleSettings: () => void;
}

/**
 * App header. Doubles as the Tauri drag region and hosts the window
 * affordances (always-on-top, mini mode, PiP, language, settings).
 */
export function Header({
  t,
  mini,
  isTauri,
  alwaysOnTop,
  pipSupported,
  pipOpen,
  settingsOpen,
  language,
  onToggleAlwaysOnTop,
  onToggleMini,
  onTogglePip,
  onToggleLanguage,
  onToggleSettings,
}: HeaderProps) {
  return (
    <header className="hud-header" data-tauri-drag-region>
      <div className="hud-brand" data-tauri-drag-region>
        <span className="hud-logo" aria-hidden="true">
          CF
        </span>
        <span className="hud-brand-text" data-tauri-drag-region>
          <span className="hud-name">{t('appName')}</span>
          <span className="hud-tag">{t('footerVersion')}</span>
        </span>
      </div>

      <div className="hud-actions">
        {isTauri ? (
          <button
            type="button"
            className={`icon-btn ${alwaysOnTop ? 'is-on' : ''}`}
            onClick={onToggleAlwaysOnTop}
            aria-pressed={alwaysOnTop}
            aria-label={t('alwaysOnTop')}
            title={t('alwaysOnTopShortcut')}
          >
            <IconPin />
          </button>
        ) : null}

        {!isTauri && pipSupported ? (
          <button
            type="button"
            className={`icon-btn ${pipOpen ? 'is-on' : ''}`}
            onClick={onTogglePip}
            disabled={pipOpen}
            aria-label={t('popOut')}
            title={t('popOutTitle')}
          >
            <IconPopOut />
          </button>
        ) : null}

        <button
          type="button"
          className={`icon-btn ${mini ? 'is-on' : ''}`}
          onClick={onToggleMini}
          aria-pressed={mini}
          aria-label={mini ? t('exitMiniMode') : t('enterMiniMode')}
          title={mini ? t('exitMiniMode') : t('enterMiniMode')}
        >
          {mini ? <IconExpand /> : <IconCollapse />}
        </button>

        <button
          type="button"
          className="icon-btn icon-btn--text"
          onClick={onToggleLanguage}
          aria-label={t('switchLanguage')}
          title={t('switchLanguage')}
        >
          {language === 'en' ? '中' : 'EN'}
        </button>

        <button
          type="button"
          className={`icon-btn ${settingsOpen ? 'is-on' : ''}`}
          onClick={onToggleSettings}
          aria-expanded={settingsOpen}
          aria-label={t('settings')}
          title={t('settings')}
        >
          <IconGear />
        </button>
      </div>
    </header>
  );
}
