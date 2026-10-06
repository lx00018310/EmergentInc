import { LanguageSwitch, t, useLanguage } from './i18n';
import { OwnerEntry } from './OwnerEntry';
import { PublicApp } from './features/public/PublicApp';

export function Entry() {
  useLanguage();
  if (window.location.pathname === '/') return <PublicApp />;
  return <><div className="owner-language"><LanguageSwitch /><nav className="owner-page-switch" aria-label={t('Backend pages')}>
    {['QIAN','YUAN','GENE'].map(page=><a key={page} href={'/'+page}>{page}</a>)}
    {window.location.hostname === '127.0.0.1' && <a href={`http://127.0.0.1:${Number(window.location.port || 8765) + 1}`} target="_blank" rel="noopener noreferrer">{t('Publish upgrade')}</a>}
  </nav></div><OwnerEntry /></>;
}
