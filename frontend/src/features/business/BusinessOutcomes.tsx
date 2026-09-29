import { businessApi } from './business_api';

const money = (n: number) => `¥${(n / 1000000).toFixed(2)}`;
const sales: Record<string, string> = { unconfirmed: '未确认', confirmed: '已确认', cancelled: '已取消' };
const delivery: Record<string, string> = { pending: '未交付', delivered: '已交付', accepted: '已接受', changes_requested: '需修改' };
const payments: Record<string, string> = { unpaid: '未付款', partially_paid: '部分到账', paid: '已到账', refunded: '已退款', partially_refunded: '部分退款' };
export function BusinessOutcomes({ data, busy, act }: { data: any; busy: boolean; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  return <section><h2>经营结果与凭据</h2><p>收款凭据均由 Owner 确认，尚未对接支付平台核验。这里记录事实，不会发起付款或退款。</p>
    <p>外部客户收款（人工确认）：{money(data.receipts?.ownerConfirmedReceivedMicros ?? 0)}；对应退款：{money(data.receipts?.ownerConfirmedRefundedMicros ?? 0)}。不包含测试款或 Owner 自付款，未据此认定利润。</p>
    <details><summary>记录一笔订单</summary><form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget);
      const plan = data.plans.find((p: any) => p.id === f.get('plan'));
      void act(() => businessApi('business/orders', { key: crypto.randomUUID(), planId: plan?.id, revision: plan?.revision,
        description: f.get('description'), customerRef: f.get('customer'), amountMicros: Math.round(Number(f.get('amount')) * 1000000), currency: 'CNY', attributionEvidence: f.get('attribution') })); }}>
      <label>归属方案<select name="plan" required><option value="">选择已批准过的方案</option>{data.plans.filter((p: any) => p.state !== 'AWAITING_APPROVAL').map((p: any) => <option key={p.id} value={p.id}>{p.plan.title}（第 {p.revision} 版）</option>)}</select></label>
      <label>商品 / 服务<input name="description" required maxLength={4000} /></label><label>客户标识<input name="customer" required maxLength={500} /></label>
      <label>订单金额（元）<input name="amount" type="number" min="0.01" step="0.01" required /></label>
      <label>获客来源证据（无法证明可留空）<input name="attribution" maxLength={4000} /></label><button disabled={busy}>记录订单</button>
    </form></details>
    {(data.orders ?? []).map((order: any) => <details key={order.id}><summary>{order.description} · {money(order.amount_micros)} · {payments[order.paymentState]}</summary>
      <p>客户：{order.customer_ref}；销售：{sales[order.sales_state]}；交付：{delivery[order.delivery_state]}。</p>
      <p>来源依据：{order.attribution_evidence || '来源未知，尚无归因证据'}。到账 {money(order.paidMicros)}；退款 {money(order.refundedMicros)}。</p>
      <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void act(() => businessApi(`business/orders/${encodeURIComponent(order.id)}/status`,
        { version: order.version, salesState: f.get('sales'), deliveryState: f.get('delivery'), evidence: f.get('evidence') })); }}>
        <div className="business-grid"><label>销售状态<select name="sales" defaultValue={order.sales_state}>{Object.entries(sales).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
          <label>交付状态<select name="delivery" defaultValue={order.delivery_state}>{Object.entries(delivery).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label></div>
        <label>变更依据<input name="evidence" required /></label><button disabled={busy}>保存销售 / 交付状态</button></form>
      <details><summary>记录收款或退款凭据</summary><form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget);
        void act(() => businessApi('business/payment-evidence', { orderId: order.id, provider: f.get('provider'), account: f.get('account'),
          externalEventId: f.get('event'), kind: f.get('kind'), amountMicros: Math.round(Number(f.get('amount')) * 1000000), currency: 'CNY',
          originalEventId: f.get('original') || undefined, payerKind: f.get('payer'), evidence: f.get('evidence') })); }}>
        <div className="business-grid"><label>凭据类型<select name="kind"><option value="payment">收款</option><option value="refund">退款</option></select></label>
          <label>付款人类型<select name="payer"><option value="external">真实外部客户</option><option value="owner">Owner 自付</option><option value="test">测试款</option></select></label>
          <label>渠道名称<input name="provider" required maxLength={300} /></label><label>收款账号标识（不要填写密码）<input name="account" required maxLength={300} /></label>
          <label>平台交易 / 凭证编号<input name="event" required maxLength={300} /></label><label>本次金额（元）<input name="amount" type="number" min="0.01" step="0.01" required /></label></div>
        <label>退款对应的原收款<select name="original"><option value="">收款时留空</option>{order.paymentEvents.filter((p: any) => p.kind === 'payment').map((p: any) =>
          <option key={p.id} value={p.id}>{p.provider} · {p.external_event_id} · {money(p.amount_micros)}</option>)}</select></label>
        <label>核验依据 / 凭证位置<input name="evidence" required maxLength={4000} /></label><button disabled={busy}>确认并记录凭据</button>
      </form></details>
      {order.paymentEvents.map((p: any) => <p key={p.id}>{p.kind === 'refund' ? '退款' : '收款'} {money(p.amount_micros)} · {p.external_event_id} · {p.payer_kind === 'external' ? '外部客户' : p.payer_kind === 'owner' ? 'Owner 自付' : '测试款'} · 人工确认，未平台核验</p>)}
    </details>)}
  </section>;
}
