import { LanguageSwitch, t, useLanguage } from './i18n';
import { OwnerEntry } from './OwnerEntry';
import { PublicApp } from './features/public/PublicApp';
import './features/owner/owner.css';

export function Entry() {
  useLanguage();
  if (window.location.pathname === '/') return <PublicApp />;
  const backend = <><div className="owner-language"><LanguageSwitch /><nav className="owner-page-switch" aria-label={t('Backend pages')}>
    <a href="/OWNER">OWNER</a><details><summary>{t('Advanced')}</summary><div className="owner-advanced-links">
    {['QIAN','YUAN','GENE'].map(page=><a key={page} href={'/'+page}>{page}</a>)}
    {window.location.hostname === '127.0.0.1' && <a href={`http://127.0.0.1:${Number(window.location.port || 8765) + 1}`} target="_blank" rel="noopener noreferrer">{t('Publish upgrade')}</a>}
    </div></details></nav></div><OwnerEntry /></>;
  return /^\/owner\/?$/i.test(window.location.pathname) ? <div className="owner-entry">{backend}</div> : backend;
}
