import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface TauriGlobals {
  isTauri?: boolean;
  __TAURI_INTERNALS__?: unknown;
}

/** True when the page runs inside a Tauri webview (Tauri v2 exposes `isTauri`). */
export function detectTauri(): boolean {
  if (typeof window === 'undefined') return false;
  const globals = window as unknown as TauriGlobals;
  return Boolean(globals.isTauri ?? globals.__TAURI_INTERNALS__);
}

const ALWAYS_ON_TOP_SHORTCUT = 'Control+Shift+H';

export interface TauriShell {
  isTauri: boolean;
  alwaysOnTop: boolean;
  toggleAlwaysOnTop: () => void;
}

/**
 * Tauri window affordances: always-on-top state plus the Ctrl+Shift+H global
 * shortcut that toggles it. All Tauri imports are dynamic and guarded, so the
 * plain web build silently skips this hook's side effects.
 */
export function useTauriShell(): TauriShell {
  const isTauri = useMemo(() => detectTauri(), []);
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const alwaysOnTopRef = useRef(true);

  const applyAlwaysOnTop = useCallback(async (next: boolean) => {
    alwaysOnTopRef.current = next;
    setAlwaysOnTop(next);
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().setAlwaysOnTop(next);
    } catch {
      // Not running in Tauri (or the capability is missing).
    }
  }, []);

  const toggleAlwaysOnTop = useCallback(() => {
    void applyAlwaysOnTop(!alwaysOnTopRef.current);
  }, [applyAlwaysOnTop]);

  useEffect(() => {
    if (!isTauri) return;
    let disposed = false;
    let disposeShortcut: (() => void) | null = null;

    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const currentWindow = getCurrentWindow();

        try {
          const initial = await currentWindow.isAlwaysOnTop();
          if (!disposed) {
            alwaysOnTopRef.current = initial;
            setAlwaysOnTop(initial);
          }
        } catch {
          // Older Tauri builds may not expose this; keep the default.
        }

        const shortcut = await import('@tauri-apps/plugin-global-shortcut');
        await shortcut.register(ALWAYS_ON_TOP_SHORTCUT, (event) => {
          if (event.state !== 'Pressed') return;
          const next = !alwaysOnTopRef.current;
          alwaysOnTopRef.current = next;
          setAlwaysOnTop(next);
          void currentWindow.setAlwaysOnTop(next).catch(() => undefined);
        });

        if (disposed) {
          await shortcut.unregister(ALWAYS_ON_TOP_SHORTCUT).catch(() => undefined);
        } else {
          disposeShortcut = () => {
            void shortcut.unregister(ALWAYS_ON_TOP_SHORTCUT).catch(() => undefined);
          };
        }
      } catch {
        // Web build or plugin unavailable: silently skip.
      }
    })();

    return () => {
      disposed = true;
      disposeShortcut?.();
    };
  }, [isTauri]);

  return { isTauri, alwaysOnTop, toggleAlwaysOnTop };
}
