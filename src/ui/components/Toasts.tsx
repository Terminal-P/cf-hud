import type { ToastItem } from '../hooks/useToasts';
import { useT } from '../hooks/useT';
import type { ToastKind } from '../events';
import { IconAlert, IconCheck, IconClose, IconInfo } from './icons';

const ICONS: Record<ToastKind, typeof IconInfo> = {
  info: IconInfo,
  good: IconCheck,
  warn: IconAlert,
  bad: IconAlert,
};

/** In-app event notifications (auto-dismissed after ~5 seconds). */
export function Toasts({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  const t = useT();
  if (toasts.length === 0) return null;

  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.kind];
        return (
          <div key={toast.id} className={`toast toast--${toast.kind}`} role="status">
            <span className="toast-icon" aria-hidden="true">
              <Icon />
            </span>
            <div className="toast-body">
              <strong className="toast-title">{toast.title}</strong>
              {toast.body ? <span className="toast-text">{toast.body}</span> : null}
            </div>
            <button
              type="button"
              className="icon-btn toast-close"
              onClick={() => onDismiss(toast.id)}
              aria-label={t('toastDismiss')}
              title={t('toastDismiss')}
            >
              <IconClose />
            </button>
          </div>
        );
      })}
    </div>
  );
}
