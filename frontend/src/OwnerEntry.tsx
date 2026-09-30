import { lazy, Suspense, useEffect, useState } from 'react';
import { businessApi } from './features/business/business_api';
import './features/business/business.css';
const App = lazy(() => import('./App').then(module => ({ default: module.App })));
const BusinessHome = lazy(() => import('./features/business/BusinessHome').then(module => ({ default: module.BusinessHome })));

export function OwnerEntry() {
  const [path, setPath] = useState(window.location.pathname);
  const gene = /^\/gene\/?$/i.test(path);
  useEffect(() => {
    const changed = () => setPath(window.location.pathname);
    window.addEventListener('popstate', changed);
    if (gene && path !== '/GENE') window.history.replaceState(null, '', '/GENE' + window.location.search);
    return () => window.removeEventListener('popstate', changed);
  }, [gene, path]);
  const [session, setSession] = useState<{ authenticated: boolean; mode: string }>();
  const [secret, setSecret] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { void businessApi('session').then(setSession).catch(e => setError(e.message)); }, []);
  if (session?.authenticated) return <Suspense fallback={<main>正在加载…</main>}>{gene ? <BusinessHome /> : <App />}</Suspense>;
  return <main className="business-shell"><section><small>EMERGENTINC{gene ? ' · GENE' : ''}</small><h1>{gene ? '登录经营工作台' : '登录元胞会社'}</h1>
    <p>使用实例的 Owner 口令登录。会话有效期为 8 小时。</p>{error && <p role="alert" className="business-error">{error}</p>}
    <form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { setSession(await businessApi('login', { secret })); setSecret(''); }
      catch (err) { setError((err as Error).message); } finally { setBusy(false); } }}>
      <label>Owner 口令<input type="password" autoComplete="current-password" required value={secret} onChange={e => setSecret(e.target.value)} /></label>
      <button className="primary" disabled={busy || !session}>{busy ? '登录中…' : '登录'}</button></form></section></main>;
}
