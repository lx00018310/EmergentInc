import { LanguageSwitch, t as tr, useLanguage } from './i18n';
import { apiRequest } from './api/client';
import { clearLegacyBossStorage } from './features/boss/bossStorage';
import { lazy, Suspense, useEffect, useState } from 'react';
import './features/boss/boss.css';
const BossConsole = lazy(() => import('./features/boss/BossConsole').then(module => ({ default: module.BossConsole })));

export function OwnerEntry() {
  useLanguage();
  const [session, setSession] = useState<{ authenticated: boolean; mode: string; worldsEnabled?:boolean }>();
  const [secret, setSecret] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { clearLegacyBossStorage(); void apiRequest<{authenticated:boolean;mode:string}>('session',{worldScoped:false}).then(setSession).catch(e => setError(e.message)); }, []);
  if (session?.authenticated) return <Suspense fallback={<main className="boss-shell">{tr("正在加载…")}</main>}><BossConsole /></Suspense>;
  return <main className="boss-shell"><header className="boss-header"><div><h1>BOSS:/AFK</h1><p>{tr('甩手掌柜 · 老板不在，生意还在')}</p></div><LanguageSwitch /></header><section><h2>{tr('Sign in to your company')}</h2>
    <p>{tr("使用实例的 Owner 口令登录。会话有效期为 8 小时。")}</p>{error && <p role="alert" className="business-error">{error}</p>}
    <form className="boss-budget" onSubmit={async e => { e.preventDefault(); if(busy)return; setBusy(true); setError(''); try { setSession(await apiRequest('login', { worldScoped:false,method:'POST',body:JSON.stringify({secret}) })); setSecret(''); }
      catch (err) { setError((err as Error).message); } finally { setBusy(false); } }}>
      <label>{tr("Owner 口令")}<input type="password" autoComplete="current-password" required value={secret} onChange={e => setSecret(e.target.value)} /></label>
      <button className="primary" disabled={busy || !session}>{busy ? (tr("登录中…")) : (tr("登录"))}</button></form></section></main>;
}
