import { useMemo } from 'react';
import { useSession } from '../../app/useSession';
import { createTranslator, type TFunction } from '../i18n';

/** Translator bound to the language stored in settings. */
export function useT(): TFunction {
  const { settings } = useSession();
  return useMemo(() => createTranslator(settings.language), [settings.language]);
}
