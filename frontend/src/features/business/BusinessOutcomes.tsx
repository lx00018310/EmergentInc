import { t as tr, useLanguage } from '../../i18n';
import { businessApi } from './business_api';

const money = (n: number) => `¥${(n / 1000000).toFixed(2)}`;
const sales: Record<string, string> = { get unconfirmed() { return tr("未确认"); }, get confirmed() { return tr("已确认"); }, get cancelled() { return tr("已取消"); } };
const delivery: Record<string, string> = { get pending() { return tr("未交付"); }, get delivered() { return tr("已交付"); }, get accepted() { return tr("已接受"); }, get changes_requested() { return tr("需修改"); } };
const payments: Record<string, string> = { get unpaid() { return tr("未付款"); }, get partially_paid() { return tr("部分到账"); }, get paid() { return tr("已到账"); }, get refunded() { return tr("已退款"); }, get partially_refunded() { return tr("部分退款"); } };
export function BusinessOutcomes({ data, busy, act }: { data: any; busy: boolean; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  useLanguage();
  return <section><h2>{tr("经营结果与凭据")}</h2><p>{tr("收款凭据均由 Owner 确认，尚未对接支付平台核验。这里记录事实，不会发起付款或退款。")}</p>
    <p>{tr("外部客户收款（人工确认）：")}{money(data.receipts?.ownerConfirmedReceivedMicros ?? 0)}{tr("；对应退款：")}{money(data.receipts?.ownerConfirmedRefundedMicros ?? 0)}{tr("。不包含测试款或 Owner 自付款，未据此认定利润。")}</p>
    <details><summary>{tr("记录一笔订单")}</summary><form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget);
      const plan = data.plans.find((p: any) => p.id === f.get('plan'));
      void act(() => businessApi('business/orders', { key: crypto.randomUUID(), planId: plan?.id, revision: plan?.revision,
        description: f.get('description'), customerRef: f.get('customer'), amountMicros: Math.round(Number(f.get('amount')) * 1000000), currency: 'CNY', attributionEvidence: f.get('attribution') })); }}>
      <label>{tr("归属方案")}<select name="plan" required><option value="">{tr("选择已批准过的方案")}</option>{data.plans.filter((p: any) => p.state !== 'AWAITING_APPROVAL').map((p: any) => <option key={p.id} value={p.id}>{p.plan.title}{tr("（第") + " "}{p.revision} {" " + tr("版）")}</option>)}</select></label>
      <label>{tr("商品 / 服务")}<input name="description" required maxLength={4000} /></label><label>{tr("客户标识")}<input name="customer" required maxLength={500} /></label>
      <label>{tr("订单金额（元）")}<input name="amount" type="number" min="0.01" step="0.01" required /></label>
      <label>{tr("获客来源证据（无法证明可留空）")}<input name="attribution" maxLength={4000} /></label><button disabled={busy}>{tr("记录订单")}</button>
    </form></details>
    {(data.orders ?? []).map((order: any) => <details key={order.id}><summary>{order.description} · {money(order.amount_micros)} · {payments[order.paymentState]}</summary>
      <p>{tr("客户：")}{order.customer_ref}{tr("；销售：")}{sales[order.sales_state]}{tr("；交付：")}{delivery[order.delivery_state]}。</p>
      <p>{tr("来源依据：")}{order.attribution_evidence || (tr("来源未知，尚无归因证据"))}{tr("。到账") + " "}{money(order.paidMicros)}{tr("；退款") + " "}{money(order.refundedMicros)}。</p>
      <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void act(() => businessApi(`business/orders/${encodeURIComponent(order.id)}/status`,
        { version: order.version, salesState: f.get('sales'), deliveryState: f.get('delivery'), evidence: f.get('evidence') })); }}>
        <div className="business-grid"><label>{tr("销售状态")}<select name="sales" defaultValue={order.sales_state}>{Object.entries(sales).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
          <label>{tr("交付状态")}<select name="delivery" defaultValue={order.delivery_state}>{Object.entries(delivery).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label></div>
        <label>{tr("变更依据")}<input name="evidence" required /></label><button disabled={busy}>{tr("保存销售 / 交付状态")}</button></form>
      <details><summary>{tr("记录收款或退款凭据")}</summary><form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget);
        void act(() => businessApi('business/payment-evidence', { orderId: order.id, provider: f.get('provider'), account: f.get('account'),
          externalEventId: f.get('event'), kind: f.get('kind'), amountMicros: Math.round(Number(f.get('amount')) * 1000000), currency: 'CNY',
          originalEventId: f.get('original') || undefined, payerKind: f.get('payer'), evidence: f.get('evidence') })); }}>
        <div className="business-grid"><label>{tr("凭据类型")}<select name="kind"><option value="payment">{tr("收款")}</option><option value="refund">{tr("退款")}</option></select></label>
          <label>{tr("付款人类型")}<select name="payer"><option value="external">{tr("真实外部客户")}</option><option value="owner">{tr("Owner 自付")}</option><option value="test">{tr("测试款")}</option></select></label>
          <label>{tr("渠道名称")}<input name="provider" required maxLength={300} /></label><label>{tr("收款账号标识（不要填写密码）")}<input name="account" required maxLength={300} /></label>
          <label>{tr("平台交易 / 凭证编号")}<input name="event" required maxLength={300} /></label><label>{tr("本次金额（元）")}<input name="amount" type="number" min="0.01" step="0.01" required /></label></div>
        <label>{tr("退款对应的原收款")}<select name="original"><option value="">{tr("收款时留空")}</option>{order.paymentEvents.filter((p: any) => p.kind === 'payment').map((p: any) =>
          <option key={p.id} value={p.id}>{p.provider} · {p.external_event_id} · {money(p.amount_micros)}</option>)}</select></label>
        <label>{tr("核验依据 / 凭证位置")}<input name="evidence" required maxLength={4000} /></label><button disabled={busy}>{tr("确认并记录凭据")}</button>
      </form></details>
      {order.paymentEvents.map((p: any) => <p key={p.id}>{p.kind === 'refund' ? (tr("退款")) : (tr("收款"))} {money(p.amount_micros)} · {p.external_event_id} · {p.payer_kind === 'external' ? (tr("外部客户")) : p.payer_kind === 'owner' ? (tr("Owner 自付")) : (tr("测试款"))} {" " + tr("· 人工确认，未平台核验")}</p>)}
    </details>)}
  </section>;
}
