import { useEffect, useRef, useState } from 'react';
import { language, t, useLanguage } from '../../i18n';
import { publicApi, PublicApiError, type Payment, type Product } from './api';

type OrderLink = { order_id: string; public_order_token: string };
type Rail = { rail_id: string; chain: string; asset: string };
const chainLabels: Record<string, string> = { solana: 'Solana · USDT', bsc: 'BSC · Binance-Peg USDT', polygon: 'Polygon PoS · USDT0', tron: 'TRON · TRC-20 USDT' };
export function savedOrder(): OrderLink | undefined {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const id = params.get('order'), token = params.get('token');
  if (id && /^order_[a-f0-9-]{36}$/.test(id) && token && /^[a-f0-9]{64}$/.test(token)) return { order_id: id, public_order_token: token };
}
export function Checkout({ product }: { product?: Product }) {
  useLanguage();
  const [rails, setRails] = useState<Rail[]>([]), [order, setOrder] = useState<OrderLink | undefined>(savedOrder);
  const [payment, setPayment] = useState<Payment>(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  // An uncertain POST is retried only with exactly the same intent and key, including after a refresh.
  const [intent, setIntent] = useState<{ key: string; body: Record<string, unknown> } | undefined>(() => {
    const raw = sessionStorage.getItem('emergentinc.checkout-intent');
    if (!raw) return undefined;
    try { return JSON.parse(raw); } catch { sessionStorage.removeItem('emergentinc.checkout-intent'); return undefined; }
  });
  const inFlight = useRef(false);
  const [details, setDetails] = useState<Record<string, unknown>>(intent?.body ?? {});
  useEffect(() => {
    if (!order) void publicApi<{ items: Rail[] }>('payment-rails').then(r => setRails(r.items)).catch(e => setError(e.message));
  }, [order]);
  useEffect(() => {
    if (!order) return;
    let active = true;
    const refresh = () => publicApi<Payment>(`orders/${order.order_id}/payment`, undefined, order.public_order_token)
      .then(p => { if (active) { setPayment(p); setError(''); } }).catch(e => { if (active) setError(e.message); });
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 10000);
    return () => { active = false; clearInterval(timer); };
  }, [order]);
  async function submit(body: Record<string, unknown>, key: string) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const next = await publicApi<OrderLink>('orders', { ...body, idempotency_key: key });
      setOrder(next); setIntent(undefined); sessionStorage.removeItem('emergentinc.checkout-intent');
      const params = new URLSearchParams({ order: next.order_id, token: next.public_order_token });
      window.history.replaceState(null, '', '/#' + params.toString());
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof PublicApiError && [400,404,409].includes(e.status) && e.message !== 'ORDER_IDEMPOTENCY_CONFLICT') {
        setIntent(undefined); sessionStorage.removeItem('emergentinc.checkout-intent');
      }
    } finally { inFlight.current = false; setBusy(false); }
  }
  return <div className="public-checkout">
    {error && <p role="alert">{t(error)}</p>}
    {order ? <><h3>{t('Your payment')}</h3><p>{t('Keep this private order link to check your payment after closing the browser.')}</p>
      <a href={window.location.href}>{t('Private order link')}</a>
      {payment ? <><p role="status">{t(payment.invoice_status === 'PAID' ? 'Payment received. We will contact you using your order details.' : payment.invoice_status === 'REVIEW_REQUIRED' ? 'Payment requires Owner review. Please contact the service provider.' : payment.invoice_status === 'EXPIRED' ? 'This invoice has expired. Do not send payment; contact the service provider.' : payment.invoice_status === 'CANCELLED' ? 'This order was cancelled. Do not send payment.' : 'Awaiting confirmed payment.')}</p>
        <dl><dt>{t('Order')}</dt><dd><code>{payment.order_id}</code></dd><dt>{t('Chain')}</dt><dd>{chainLabels[payment.chain]} · mainnet</dd>
          <dt>{t('Quoted price')}</dt><dd>{payment.quoted_amount} USDT</dd><dt>{t('Exact amount due')}</dt><dd><strong>{payment.amount} USDT</strong></dd>
          <dt>{t('Receiving address')}</dt><dd><code>{payment.recipient_address}</code></dd><dt>{t('Token contract')}</dt><dd><code>{payment.token_contract}</code></dd>
          <dt>{t('Expires')}</dt><dd>{new Date(payment.expires_at).toLocaleString(language())}</dd></dl>
        {['WAITING', 'OBSERVED'].includes(payment.invoice_status) && <><p>{t('Pay the exact amount on the stated chain. Include every decimal place.')}</p>
          <img width="280" height="280" src={payment.qr_data_url} alt={t('Payment QR code')} />
          {payment.wallet_url && <p><a href={payment.wallet_url}>{t('Open compatible wallet')}</a></p>}
          {payment.chain === 'tron' && <p>{t('The TRON QR contains only the receiving address. Choose TRC-20 USDT and enter the exact amount manually.')}</p>}</>}
      </> : <p>{t('Loading…')}</p>}</> : intent ? <><p>{t('An order request is pending. Retry the same request to avoid duplicate orders.')}</p>
      <button disabled={busy} onClick={() => void submit(intent.body, intent.key)}>{t('Retry order request')}</button></> : <form onSubmit={e => {
      e.preventDefault(); const form = new FormData(e.currentTarget);
      const body = { product_id: product?.product_id, customer_name: form.get('name'), customer_contact: form.get('contact'), customer_requirement: form.get('requirement'), rail_id: form.get('rail'), language: language() };
      setDetails(body);
      const next = { key: crypto.randomUUID(), body }; setIntent(next); sessionStorage.setItem('emergentinc.checkout-intent', JSON.stringify(next));
      void submit(body, next.key);
    }}><h3>{t('Tell us what you need')}</h3>
      <label>{t('Your name')}<input name="name" required maxLength={120} autoComplete="name" defaultValue={String(details.customer_name ?? '')} /></label>
      <label>{t('Email or other contact')}<input name="contact" required maxLength={320} autoComplete="email" defaultValue={String(details.customer_contact ?? '')} /></label>
      <label>{t('What would you like to build?')}<textarea name="requirement" required maxLength={4000} rows={4} defaultValue={String(details.customer_requirement ?? '')} /></label>
      <label>{t('Payment chain')}<select name="rail" required>{rails.map(r => <option key={r.rail_id} value={r.rail_id}>{chainLabels[r.chain]}</option>)}</select></label>
      {!rails.length && <p>{t('No payment rail is available. Please contact the service provider.')}</p>}
      <p>{t('An invoice is created before you pay. Your contact details are visible only to the instance Owner.')}</p>
      <button className="public-primary" disabled={busy || !rails.length || !product}>{t('Create order and USDT invoice')}</button>
    </form>}
  </div>;
}
