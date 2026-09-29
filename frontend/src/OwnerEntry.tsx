import { useEffect, useState } from 'react';
import { App } from './App';
import { BusinessHome } from './features/business/BusinessHome';
import { businessApi } from './features/business/business_api';

export function OwnerEntry() {
  const [session, setSession] = useState<{ authenticated: boolean; mode: string }>();
  const [secret, setSecret] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { void businessApi('session').then(setSession).catch(e => setError(e.message)); }, []);
  if (session?.authenticated) return session.mode === 'business' ? <BusinessHome /> : <App />;
  return <main className="business-shell"><section><small>EMERGENTINC</small><h1>登录经营工作台</h1>
    <p>使用实例的 Owner 口令登录。会话有效期为 8 小时。</p>{error && <p role="alert" className="business-error">{error}</p>}
    <form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { setSession(await businessApi('login', { secret })); setSecret(''); }
      catch (err) { setError((err as Error).message); } finally { setBusy(false); } }}>
      <label>Owner 口令<input type="password" autoComplete="current-password" required value={secret} onChange={e => setSecret(e.target.value)} /></label>
      <button className="primary" disabled={busy || !session}>{busy ? '登录中…' : '登录'}</button></form></section></main>;
}
