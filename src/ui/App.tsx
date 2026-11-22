import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { session, useSession } from '../app/useSession';
import { ContestBar } from './components/ContestBar';
import { Footer } from './components/Footer';
import { GoalCard } from './components/GoalCard';
import { Header } from './components/Header';
import { MiniBar } from './components/MiniBar';
import { Onboarding } from './components/Onboarding';
import { PredictionCard } from './components/PredictionCard';
import { ProblemMatrix } from './components/ProblemMatrix';
import { RankCard } from './components/RankCard';
import { SettlementView } from './components/SettlementView';
import { SettingsPanel } from './components/SettingsPanel';
import { StatusCard } from './components/StatusCard';
import { Toasts } from './components/Toasts';
import { VpCard } from './components/VpCard';
import { WatchList } from './components/WatchList';
import { ErrorBanner, SkeletonCard } from './components/ui';
import { describeEvent, notifySystem } from './events';
import { useT } from './hooks/useT';
import { useTauriShell } from './hooks/useTauriShell';
import { useToasts } from './hooks/useToasts';
import { isPiPOpen, isPiPSupported, openPiP, syncPiPTheme } from './pip';

const panelStyle = (opacity: number): CSSProperties =>
  ({ '--panel-alpha': String(opacity) }) as CSSProperties;

/**
 * Root HUD shell.
 *
 * Owns only window-level state (settings panel, PiP, toasts, theme tokens);
 * every piece of domain data comes from `useSession()` / `session`.
 */
export function App() {
  const state = useSession();
  const t = useT();
  const shell = useTauriShell();
  const { toasts, push, dismiss } = useToasts();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [pipOpen, setPipOpen] = useState(false);
  const [popOutError, setPopOutError] = useState<string | null>(null);

  const pipSupported = useMemo(() => isPiPSupported(), []);
  const { settings } = state;

  /* Session lifecycle: poll while mounted. */
  useEffect(() => {
    session.start();
    return () => session.stop();
  }, []);

  /* Session events -> in-app toast + optional system notification. */
  useEffect(() => {
    const off = session.onEvent((event) => {
      const message = describeEvent(event, t);
      push(message);
      notifySystem(message, settings.notifications);
    });
    return off;
  }, [t, push, settings.notifications]);

  /* Theme / shell tokens on the document (and the PiP document). */
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.dataset.shell = shell.isTauri ? 'tauri' : 'web';
    root.lang = settings.language === 'zh' ? 'zh-CN' : 'en';
    syncPiPTheme(settings.theme);
  }, [settings.theme, settings.language, shell.isTauri]);

  /* Forget the dismissed error when the store clears it. */
  useEffect(() => {
    if (!state.error) setDismissedError(null);
  }, [state.error]);

  /* Escape closes the settings panel. */
  useEffect(() => {
    if (!settingsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [settingsOpen]);

  const togglePip = useCallback(async () => {
    if (isPiPOpen()) return;
    setPopOutError(null);
    const opened = await openPiP({
      theme: settings.theme,
      placeholderTitle: t('pipPlaceholderTitle'),
      placeholderHint: t('pipPlaceholderHint'),
      onClose: () => setPipOpen(false),
    });
    if (opened) setPipOpen(true);
    else setPopOutError(t('popOutError'));
  }, [settings.theme, t]);

  const hasHandle = Boolean(state.handle);
  const contest = state.contest;
  const snapshot = state.snapshot;
  const isBefore = contest?.phase === 'BEFORE';
  const standingsReady = Boolean(
    snapshot && contest && !isBefore && snapshot.contestId === contest.id,
  );
  const loading = state.status === 'loading';
  const errorVisible = Boolean(state.error) && state.error !== dismissedError;
  const mini = settings.mini;

  return (
    <div
      className={`hud ${mini ? 'is-mini' : ''}`}
      data-theme={settings.theme}
      style={panelStyle(settings.opacity)}
    >
      <Header
        t={t}
        mini={mini}
        isTauri={shell.isTauri}
        alwaysOnTop={shell.alwaysOnTop}
        pipSupported={pipSupported}
        pipOpen={pipOpen}
        settingsOpen={settingsOpen}
        language={settings.language}
        onToggleAlwaysOnTop={shell.toggleAlwaysOnTop}
        onToggleMini={() => session.updateSettings({ mini: !settings.mini })}
        onTogglePip={() => void togglePip()}
        onToggleLanguage={() =>
          session.updateSettings({ language: settings.language === 'en' ? 'zh' : 'en' })
        }
        onToggleSettings={() => setSettingsOpen((open) => !open)}
      />

      <div className="hud-body">
        {errorVisible && state.error ? (
          <ErrorBanner
            title={t('errorTitle')}
            message={state.error}
            hint={t('errorHint')}
            onDismiss={() => setDismissedError(state.error)}
            dismissLabel={t('dismiss')}
          />
        ) : null}

        {popOutError ? (
          <ErrorBanner
            message={popOutError}
            onDismiss={() => setPopOutError(null)}
            dismissLabel={t('dismiss')}
          />
        ) : null}

        {!hasHandle ? (
          <Onboarding />
        ) : (
          <>
            {settingsOpen ? <SettingsPanel onClose={() => setSettingsOpen(false)} /> : null}

            {mini ? (
              <>
                <MiniBar />
                <ProblemMatrix />
              </>
            ) : (
              <>
                <ContestBar />
                <VpCard />
                {contest && !state.vp ? <StatusCard /> : null}
                {state.settlement && !state.vp ? <SettlementView /> : null}

                {standingsReady && snapshot ? (
                  <>
                    <RankCard />
                    {contest?.phase === 'FINISHED' && !state.vp ? null : (
                      <>
                        <PredictionCard />
                        <GoalCard />
                      </>
                    )}
                    <ProblemMatrix />
                    <WatchList />
                  </>
                ) : loading ? (
                  <>
                    <SkeletonCard lines={3} />
                    <SkeletonCard lines={4} />
                  </>
                ) : (
                  <>
                    <GoalCard />
                    <WatchList />
                  </>
                )}
              </>
            )}
          </>
        )}

        <Footer />
      </div>

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
