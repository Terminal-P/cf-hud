import { useEffect, useState } from 'react';

/**
 * Wall-clock tick used by countdowns, "updated Xs ago" and anything else that
 * needs to re-render on a timer. Components that only need static data never
 * subscribe to it, so the HUD does not re-render wholesale every second.
 */
export function useTick(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return now;
}
