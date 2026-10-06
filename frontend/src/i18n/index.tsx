import { useSyncExternalStore } from 'react';
import { en } from './en';
import { zhCN } from './zh-CN';

export type Language = 'en' | 'zh-CN';
const storageKey = 'emergentinc.language';
const listeners = new Set<() => void>();
export function language(): Language { return localStorage.getItem(storageKey) === 'zh-CN' ? 'zh-CN' : 'en'; }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useLanguage() { return useSyncExternalStore(subscribe, language); }
export function setLanguage(next: Language) {
  localStorage.setItem(storageKey, next);
  document.documentElement.lang = next;
  listeners.forEach(listener => listener());
}
export function t(key: string, values: unknown[] = []): string {
  const dictionary = language() === 'en' ? en : zhCN;
  if (!Object.hasOwn(dictionary, key)) return key;
  const text = dictionary[key]!;
  return text.replace(/\{(\d+)\}/g, (_, index) => String(values[Number(index)]));
}
export function LanguageSwitch() {
  const current = useLanguage();
  return <nav className="language-switch" aria-label="Language">
    <button type="button" aria-pressed={current === 'en'} onClick={() => setLanguage('en')}>EN</button>
    <span aria-hidden="true"> | </span>
    <button type="button" aria-pressed={current === 'zh-CN'} onClick={() => setLanguage('zh-CN')}>中文</button>
  </nav>;
}
