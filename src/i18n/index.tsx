import { useCallback, type ReactNode } from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { I18nContext, translations, resolveKey, type Language } from './context';

export type { Language, Dict } from './context';

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useLocalStorage<Language>('app-language', 'zh');

  const t = useCallback((key: string) => {
    return resolveKey(translations[language] as unknown as Record<string, any>, key);
  }, [language]);

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
}
