import { LanguageSwitch, useLanguage } from './i18n';
import { OwnerEntry } from './OwnerEntry';
import { PublicApp } from './features/public/PublicApp';

export function Entry() {
  useLanguage();
  if (window.location.pathname === '/') return <PublicApp />;
  return <><div className="owner-language"><LanguageSwitch /></div><OwnerEntry /></>;
}
