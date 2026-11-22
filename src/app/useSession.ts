import { useSyncExternalStore } from 'react';
import { session, type SessionState } from './store';

/** Subscribe a component to the global session store. */
export function useSession(): SessionState {
  return useSyncExternalStore(session.subscribe, session.getState, session.getState);
}

export { session };
