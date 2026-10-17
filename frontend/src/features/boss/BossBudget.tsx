import { useRef, useState } from 'react';
import type { CompanyBudget } from '../../../../packages/protocol/src/types/owner';
import { ownerGoalRequest, ownerError } from '../../api/owner';
import { ApiError } from '../../api/client';
import { t, useLanguage } from '../../i18n';

/** Same amount-budget protocol, including revision and a retry-stable idempotency key. */
export function BossBudget({ budget, instanceId, onDone }: { budget: CompanyBudget; instanceId: string; onDone: () => void }) {
  useLanguage();
  type Authorization = { tokenMillions: number; unitPrice: number; priceCurrency: 'CNY'; expectedRevision: number; idempotencyKey: string };
  const storageKey = `boss.v34.budget.${instanceId}.pending`;
  const pending = useRef<Authorization>();
  const [restoring, setRestoring] = useState(() => { try { const row = JSON.parse(localStorage.getItem(storageKey) || 'null'); if (row && Number.isSafeInteger(row.tokenMillions) && row.tokenMillions > 0 && typeof row.unitPrice === 'number' && row.unitPrice > 0 && row.priceCurrency === 'CNY' && Number.isSafeInteger(row.expectedRevision) && /^[a-zA-Z0-9_-]{1,128}$/.test(row.idempotencyKey)) { pending.current = row; return true; } } catch { /* Invalid storage authorizes nothing. */ } return false; });
  const [quantity, setQuantity] = useState(pending.current?.tokenMillions ?? budget.configuration?.tokenMillions ?? 100), [price, setPrice] = useState(pending.current?.unitPrice ?? (budget.configuration?.unitPriceCnyMicros ?? 2000000) / 1000000);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const flight = useRef(false);
  function persist() { try { pending.current ? localStorage.setItem(storageKey, JSON.stringify(pending.current)) : localStorage.removeItem(storageKey); } catch { /* The current-page request still has a stable key. */ } }
  const amount = quantity * Math.round(price * 1000000), valid = Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 10000 && price > 0 && Number.isSafeInteger(amount) && amount > 0;
  async function save() {
    if (!valid || flight.current) return; flight.current = true; setBusy(true); setError('');
    if (!pending.current || pending.current.tokenMillions !== quantity || pending.current.unitPrice !== price) pending.current = { tokenMillions: quantity, unitPrice: price, priceCurrency: 'CNY', expectedRevision: budget.revision, idempotencyKey: crypto.randomUUID() };
    persist(); setRestoring(true);
    try { await ownerGoalRequest('budget', 'POST', pending.current); pending.current = undefined; persist(); setRestoring(false); onDone(); }
    catch (e) { if (e instanceof ApiError && ['OWNER_REVISION_CONFLICT','OWNER_MONEY_INVALID','OWNER_GOAL_INPUT_INVALID','OWNER_BUDGET_TOKEN_CHANGE_REQUIRED'].includes(e.detail)) { pending.current = undefined; persist(); setRestoring(false); } setError(ownerError(e)); }
    finally { flight.current = false; setBusy(false); }
  }
  return <form className="boss-budget" onSubmit={e => { e.preventDefault(); void save(); }}>
    <p>{t('Authorize a shared CNY allowance. Saving does not start the company.')}</p>
    {restoring && !busy && <p role="status">{t('Retry the pending authorization with its original amount and key.')}</p>}
    <label>{t('Token quantity (M)')}<input type="number" min="1" max="10000" step="1" value={quantity} disabled={busy || restoring} required onChange={e => setQuantity(Number(e.target.value))} /></label>
    <label>{t('Unit price (CNY / 1M Tokens)')}<input type="number" min="0.000001" step="any" value={price} disabled={busy || restoring} required onChange={e => setPrice(Number(e.target.value))} /></label>
    <p>{t('Calculated allowance')}: <output>{valid ? (amount / 1000000).toLocaleString() + ' CNY' : '—'}</output></p>
    <p>{t('Settled cost')}: {budget.spentMicros / 1000000} CNY · {t('Reserved cost')}: {budget.reservedMicros / 1000000} CNY</p>
    <button disabled={busy || !valid}>{t(busy ? 'Submitting…' : 'Save company budget')}</button>
    {!!error && <p role="alert">{error}</p>}
  </form>;
}
