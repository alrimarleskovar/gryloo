// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { portuguese } from './pt';
export type Language = 'EN' | 'PT';
export const LANGUAGE_KEY = 'flofi.language';
const templates = Object.entries(portuguese).filter(([key]) => key.includes('{0}')).map(([key, value]) => ({
  pattern: new RegExp('^' + key.split(/(\{\d+\})/).map(part => /^\{\d+\}$/.test(part) ? '(.+?)' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('') + '$'), value,
}));
/** Translate only catalog messages. Unlisted symbols, addresses, hashes, IDs and user names pass through unchanged. */
export function translate<T>(language: Language, input: T, ...parameters: readonly (string | number)[]): T {
  if (typeof input !== 'string') return input;
  const text = input.trim();
  let value = language === 'PT' && Object.hasOwn(portuguese, text) ? portuguese[text] : undefined;
  if (parameters.length) {
    const message = (value ?? text).replace(/\{(\d+)\}/g, (placeholder, i: string) => String(parameters[Number(i)] ?? placeholder));
    return input.replace(text, () => message) as T;
  }
  if (language !== 'PT') return input;
  if (!value) for (const template of templates) { const match = template.pattern.exec(text); if (match) { value = template.value.replace(/\{(\d+)\}/g, (_, i: string) => match[Number(i) + 1] ?? ''); break; } }
  return (value === undefined ? input : input.replace(text, () => value!)) as T;
}
const defaults = { language: 'EN' as Language, setLanguage: (_value: Language) => { void _value; }, t: <T,>(value: T, ...parameters: readonly (string | number)[]) => translate('EN', value, ...parameters) };
const Context = createContext(defaults);
/** Presentation preference only: no dependency on workflow, wallet, quote, authorization or execution stores. */
export function LocaleProvider({ children, initialLanguage = 'EN' }: { children: ReactNode; initialLanguage?: Language }) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);
  useEffect(() => { try { const saved = localStorage.getItem(LANGUAGE_KEY); if (saved === 'PT' || saved === 'EN') setLanguageState(saved); } catch { /* Optional preference storage. */ } }, []);
  useEffect(() => { document.documentElement.lang = language === 'PT' ? 'pt' : 'en'; }, [language]);
  const value = useMemo(() => ({ language, setLanguage: (next: Language) => {
    setLanguageState(next); try { localStorage.setItem(LANGUAGE_KEY, next); } catch { /* Still applies this visit. */ }
  }, t: <T,>(input: T, ...parameters: readonly (string | number)[]) => translate(language, input, ...parameters) }), [language]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useLocale = () => useContext(Context);
