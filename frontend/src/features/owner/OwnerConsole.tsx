import { useCallback, useEffect, useRef, useState } from 'react';
import { t, useLanguage } from '../../i18n';
import { fetchOwnerOverview, ownerError, type OwnerOverview } from '../../api/owner';
import { OwnerChat } from './OwnerChat';
import { OwnerDashboard } from './OwnerDashboard';
import { companyStatus, ownerTime, validOwnerOverview } from './ownerPresentation';
import './owner.css';

type OwnerTab = 'owner-chat' | 'owner-dashboard';
const parseHash = (): OwnerTab => !window.location.hash && !window.location.search ||
  window.location.hash === '#owner-chat' ? 'owner-chat' : 'owner-dashboard';

export function OwnerConsole() {
  useLanguage();
  const [tab, setTab] = useState<OwnerTab>(parseHash), [data, setData] = useState<OwnerOverview>(),
    [error, setError] = useState<unknown>(null), [refreshing, setRefreshing] = useState(false);
  const request = useRef(0), controller = useRef<AbortController>();
  const refresh = useCallback(async () => {
    const serial = ++request.current;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setRefreshing(true);
    try {
      const next = await fetchOwnerOverview(current.signal);
      if (serial !== request.current || current.signal.aborted) return;
      if (!validOwnerOverview(next))
        throw new Error('The dashboard response is invalid. Try refreshing.');
      setData(next); setError(null);
    } catch (e) {
      if (serial === request.current && !current.signal.aborted) setError(e);
    } finally {
      if (serial === request.current && !current.signal.aborted) setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    let flight = false;
    const poll = async () => {
      if (flight) return;
      flight = true;
      try { await refresh(); } finally { flight = false; }
    };
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => { clearInterval(timer); ++request.current; controller.current?.abort(); };
  }, [refresh]);
  useEffect(() => {
    const sync = () => setTab(parseHash());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  const status = companyStatus(data);
  return <main className="owner-console">
    <header className="owner-topbar">
      <div className="owner-brand"><strong>EmergentInc</strong></div>
      <nav className="owner-tabs" aria-label={t('On this page')}>
        {(['owner-chat', 'owner-dashboard'] as const).map(key => <a key={key} className="owner-tab"
          href={'#' + key} aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}>
          {t(key === 'owner-chat' ? 'Boss chat' : 'AI company dashboard')}</a>)}
      </nav>
      <div className="owner-console-status">
        <p className="owner-topbar-status" role="status"><span>{t('Company status')}</span>
          <span className={'owner-badge owner-badge--' + status.tone}>{status.label}</span></p>
        <div className="owner-refresh-line"><span>{t('Last refreshed')}: {data ? ownerTime(data.asOf) : '—'}
          {' · '}{t('Asia/Shanghai')}</span>
          <button className="owner-btn owner-btn--ghost owner-btn--sm" disabled={refreshing}
            onClick={() => void refresh()}>{t(refreshing ? 'Refreshing…' : 'Refresh')}</button></div>
      </div>
    </header>
    {!!error && <div className="owner-alert owner-alert--danger" role="alert">
      <strong>{t(data ? 'Overview unavailable. Previously displayed data may be stale.' : 'The dashboard could not be loaded.')}</strong>
      <p>{ownerError(error)}</p>
      <button className="owner-btn owner-btn--ghost owner-btn--sm" disabled={refreshing}
        onClick={() => void refresh()}>{t('Retry')}</button>
      {error instanceof Error && <details className="owner-technical"><summary>{t('Technical details')}</summary>
        <pre>{error.message}</pre></details>}
    </div>}
    <div className="owner-workspace">
      <section id="owner-chat" className="owner-page owner-page--chat" hidden={tab !== 'owner-chat'}>
        <h1>{t('Boss chat')}</h1><OwnerChat missionControl onDone={() => void refresh()} /></section>
      <section id="owner-dashboard" className="owner-page" hidden={tab !== 'owner-dashboard'}
        aria-busy={!data && refreshing}><h1>{t('AI company dashboard')}</h1>
        {data ? <OwnerDashboard data={data} onDone={() => void refresh()} /> :
          <p className="owner-empty">{t(error ? 'No dashboard data has been received.' : 'Loading the company dashboard…')}</p>}
      </section>
    </div>
  </main>;
}
