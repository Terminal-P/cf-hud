import { useCallback, useEffect, useRef, useState } from 'react';
import type { ToastMessage } from '../events';

export interface ToastItem extends ToastMessage {
  id: number;
}

const TOAST_TTL_MS = 5000;
const MAX_TOASTS = 4;

interface UseToastsResult {
  toasts: ToastItem[];
  push: (message: ToastMessage) => void;
  dismiss: (id: number) => void;
}

/** In-app toast queue with auto-dismiss (~5s) and manual dismissal. */
export function useToasts(): UseToastsResult {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, number>());
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback((message: ToastMessage) => {
    const id = nextId.current;
    nextId.current += 1;
    setToasts((prev) => [...prev, { ...message, id }].slice(-MAX_TOASTS));
    const timer = window.setTimeout(() => {
      timers.current.delete(id);
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, TOAST_TTL_MS);
    timers.current.set(id, timer);
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => window.clearTimeout(timer));
      pending.clear();
    };
  }, []);

  return { toasts, push, dismiss };
}
