import { createContext } from 'react';
import zh from './locales/zh';
import en from './locales/en';

export type Language = 'zh' | 'en';

export type Dict = typeof zh;

export const translations: Record<Language, Dict> = { zh, en };

export interface I18nContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

export const I18nContext = createContext<I18nContextValue | null>(null);

export function resolveKey(dict: Record<string, any>, path: string): string {
  const val = path.split('.').reduce((acc, k) => acc?.[k], dict);
  return typeof val === 'string' ? val : path;
}
