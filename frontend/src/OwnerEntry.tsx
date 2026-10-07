import { t as tr, useLanguage } from './i18n';
import {enableWorlds} from './api/worldScope';
import { lazy, Suspense, useEffect, useState } from 'react';
import { businessApi } from './features/business/business_api';
import './features/business/business.css';
const App = lazy(() => import('./App').then(module => ({ default: module.App })));
const BusinessHome = lazy(() => import('./features/business/BusinessHome').then(module => ({ default: module.BusinessHome })));
const OwnerConsole = lazy(() => import('./features/owner/OwnerConsole').then(module => ({ default: module.OwnerConsole })));

export function OwnerEntry() {
  useLanguage();
  const [path, setPath] = useState(window.location.pathname);
  const gene = /^\/gene\/?$/i.test(path);
  const owner = /^\/owner\/?$/i.test(path);
  useEffect(() => {
    const changed = () => setPath(window.location.pathname);
    window.addEventListener('popstate', changed);
    if (gene && path !== '/GENE') window.history.replaceState(null, '', '/GENE' + window.location.search);
    if (owner && path !== '/OWNER') window.history.replaceState(null, '', '/OWNER' + window.location.search);
    return () => window.removeEventListener('popstate', changed);
  }, [gene, owner, path]);
  const [session, setSession] = useState<{ authenticated: boolean; mode: string; worldsEnabled?:boolean }>();
  const [secret, setSecret] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { void businessApi('session').then(setSession).catch(e => setError(e.message)); }, []);
  if (session?.authenticated) {enableWorlds(session.worldsEnabled===true); return <Suspense fallback={<main>{tr("正在加载…")}</main>}>{owner ? <OwnerConsole /> : gene ? <BusinessHome /> : <App />}</Suspense>;}
  return <main className="business-shell"><section><small>EMERGENTINC{gene ? ' · GENE' : ''}</small><h1>{gene ? (tr("登录经营工作台")) : (tr("登录元胞会社"))}</h1>
    <p>{tr("使用实例的 Owner 口令登录。会话有效期为 8 小时。")}</p>{error && <p role="alert" className="business-error">{error}</p>}
    <form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { setSession(await businessApi('login', { secret })); setSecret(''); }
      catch (err) { setError((err as Error).message); } finally { setBusy(false); } }}>
      <label>{tr("Owner 口令")}<input type="password" autoComplete="current-password" required value={secret} onChange={e => setSecret(e.target.value)} /></label>
      <button className="primary" disabled={busy || !session}>{busy ? (tr("登录中…")) : (tr("登录"))}</button></form></section></main>;
}
