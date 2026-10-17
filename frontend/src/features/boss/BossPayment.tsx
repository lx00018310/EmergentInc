import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../api/client';
import { ownerError } from '../../api/owner';
import { t, useLanguage } from '../../i18n';
interface Rail { rail_id: string; chain: string; recipient_address: string; config_revision: number; status: string }
export function BossPayment({ onDone }: { onDone: () => void }) {
  useLanguage();
  const [rails, setRails] = useState<Rail[]>(), [chain, setChain] = useState('solana'), [address, setAddress] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const flight = useRef(false);
  useEffect(() => { void apiRequest<{ items: Rail[] }>('payments/rails', { worldScoped: false }).then(result => { setRails(result.items); setAddress(result.items.find(rail => rail.chain === 'solana')?.recipient_address ?? ''); }).catch(e => setError(ownerError(e))); }, []);
  async function save() {
    if (!rails || flight.current || !address.trim()) return; flight.current = true; setBusy(true); setError('');
    const old = rails.find(rail => rail.chain === chain);
    try {
      await apiRequest('payments/rails', { worldScoped: false, method: 'PUT', body: JSON.stringify({ rail_id: old?.rail_id ?? chain, chain, network: 'mainnet', recipient_address: address.trim(), status: 'ENABLED', expected_revision: old?.config_revision ?? 0, rpc_id: chain + '-mainnet' }) });
      onDone();
    } catch (e) {
      setError(ownerError(e));
      // Refresh the real revision after an unknown HTTP result; never silently resubmit.
      try { setRails((await apiRequest<{ items: Rail[] }>('payments/rails', { worldScoped: false })).items); } catch { /* The error remains visible and another write stays explicit. */ }
    } finally { flight.current = false; setBusy(false); }
  }
  return <form className="boss-budget" onSubmit={e => { e.preventDefault(); void save(); }}>
    <p>{t('Configure a mainnet USDT recipient before selling. No wallet signing or outgoing transfers are available.')}</p>
    <label>{t('Payment chain')}<select disabled={busy} value={chain} onChange={e => { setChain(e.target.value); setAddress(rails?.find(rail => rail.chain === e.target.value)?.recipient_address ?? ''); }}>{[['solana','Solana · USDT'],['bsc','BSC · Binance-Peg USDT'],['polygon','Polygon PoS · USDT0'],['tron','TRON · TRC-20 USDT']].map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    <label>{t('Mainnet recipient address')}<input disabled={busy} value={address} required maxLength={100} onChange={e => setAddress(e.target.value)} /></label>
    <button disabled={!rails || busy || !address.trim()}>{t(busy ? 'Submitting…' : 'Enable receive-only payments')}</button>
    {!!error && <p role="alert">{error}</p>}
  </form>;
}
