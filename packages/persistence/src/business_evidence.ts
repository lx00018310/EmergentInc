import { createHash, randomUUID } from "node:crypto";
import { SqliteDatabase } from "./sqlite/db.js";

type Row = Record<string, any>;
const text = (value: unknown, max = 4000): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const amount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 1_000_000_000_000;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export class BusinessEvidence {
  constructor(private db: SqliteDatabase) {}
  createOrder(input: { key: string; planId: string; revision: number; description: string; customerRef: string;
    amountMicros: number; currency: "CNY"; attributionEvidence?: string }) {
    if (!text(input?.key, 100) || !/^[\w-]{8,100}$/.test(input.key) || !text(input.description) || !text(input.customerRef, 500) ||
      !amount(input.amountMicros) || input.currency !== "CNY" || !Number.isSafeInteger(input.revision) ||
      (input.attributionEvidence !== undefined && (typeof input.attributionEvidence !== "string" || input.attributionEvidence.length > 4000))) throw new Error("INVALID_ORDER");
    return this.db.transaction(() => {
      const id = `order:${input.key}`;
      const value = { planId: input.planId, revision: input.revision, description: input.description, customerRef: input.customerRef,
        amountMicros: input.amountMicros, currency: input.currency, attributionEvidence: input.attributionEvidence ?? "" };
      const previous = this.db.prepare("SELECT payload FROM business_events WHERE id=?").get(id) as Row | undefined;
      if (previous) { if (hash(JSON.parse(previous.payload)) !== hash(value)) throw new Error("IDEMPOTENCY_CONFLICT"); return this.order(id); }
      if (!this.db.prepare("SELECT id FROM business_grants WHERE plan_id=? AND revision=?").get(input.planId, input.revision)) throw new Error("APPROVED_PLAN_REQUIRED");
      this.db.prepare("INSERT INTO business_orders VALUES(?,?,?,?,?,?,'CNY','unconfirmed','pending',1,?,?)")
        .run(id, input.planId, input.revision, input.description, input.customerRef, input.amountMicros, value.attributionEvidence, Date.now());
      this.db.prepare("INSERT INTO business_events VALUES(?,?,'owner_order_recorded',?,?)").run(id, input.planId, JSON.stringify(value), Date.now());
      return this.order(id);
    });
  }
  order(id: string): Row {
    const order = this.db.prepare("SELECT * FROM business_orders WHERE id=?").get(id) as Row | undefined;
    if (!order) throw new Error("ORDER_NOT_FOUND");
    const events = this.db.prepare("SELECT * FROM business_payment_events WHERE order_id=? ORDER BY created_at").all(id) as Row[];
    const paid = events.filter(e => e.kind === "payment").reduce((sum, e) => sum + e.amount_micros, 0);
    const refunded = events.filter(e => e.kind === "refund").reduce((sum, e) => sum + e.amount_micros, 0);
    if (!Number.isSafeInteger(paid) || !Number.isSafeInteger(refunded)) throw new Error("LEDGER_INTEGER_RANGE_EXCEEDED");
    return { ...order, paidMicros: paid, refundedMicros: refunded, paymentState: paid === 0 ? "unpaid" :
      refunded === paid ? "refunded" : refunded > 0 ? "partially_refunded" : paid >= order.amount_micros ? "paid" : "partially_paid", paymentEvents: events };
  }
  orders() { return (this.db.prepare("SELECT id FROM business_orders ORDER BY created_at DESC").all() as Row[]).map(o => this.order(o.id)); }
  updateOrder(id: string, input: { version: number; salesState: string; deliveryState: string; evidence: string }) {
    if (!input || !["unconfirmed", "confirmed", "cancelled"].includes(input.salesState) ||
      !["pending", "delivered", "accepted", "changes_requested"].includes(input.deliveryState) || !text(input.evidence) ||
      !Number.isSafeInteger(input.version)) throw new Error("INVALID_ORDER_STATE");
    return this.db.transaction(() => {
      const old = this.order(id);
      if (old.version !== input.version) throw new Error("ORDER_VERSION_CONFLICT");
      this.db.prepare("UPDATE business_orders SET sales_state=?,delivery_state=?,version=version+1 WHERE id=?")
        .run(input.salesState, input.deliveryState, id);
      this.db.prepare("INSERT INTO business_events VALUES(?,?,'owner_order_updated',?,?)").run(randomUUID(), old.plan_id,
        JSON.stringify({ orderId: id, previous: { sales: old.sales_state, delivery: old.delivery_state, version: old.version }, ...input, source: "owner_confirmed" }), Date.now());
      return this.order(id);
    });
  }
  recordPayment(input: { orderId: string; provider: string; account: string; externalEventId: string; kind: "payment" | "refund";
    amountMicros: number; currency: "CNY"; originalEventId?: string; payerKind: "external" | "owner" | "test"; evidence: string }) {
    if (!input || ![input.orderId, input.provider, input.account, input.externalEventId].every(v => text(v, 300)) ||
      !["payment", "refund"].includes(input.kind) || !amount(input.amountMicros) || input.currency !== "CNY" ||
      !["external", "owner", "test"].includes(input.payerKind) || !text(input.evidence) ||
      (input.originalEventId !== undefined && !text(input.originalEventId, 300))) throw new Error("INVALID_PAYMENT_EVIDENCE");
    return this.db.transaction(() => {
      const order = this.order(input.orderId);
      const normalized = { orderId: input.orderId, provider: input.provider, account: input.account, externalEventId: input.externalEventId,
        kind: input.kind, amountMicros: input.amountMicros, currency: input.currency, originalEventId: input.originalEventId ?? null,
        payerKind: input.payerKind, evidence: input.evidence };
      const requestHash = hash(normalized);
      const previous = this.db.prepare("SELECT * FROM business_payment_events WHERE provider=? AND account=? AND external_event_id=?")
        .get(input.provider, input.account, input.externalEventId) as Row | undefined;
      if (previous) { if (previous.request_hash !== requestHash) throw new Error("IDEMPOTENCY_CONFLICT"); return previous; }
      let payerKind = input.payerKind;
      if (input.kind === "refund") {
        const original = this.db.prepare("SELECT * FROM business_payment_events WHERE id=? AND kind='payment'").get(input.originalEventId ?? "") as Row | undefined;
        if (!original || original.order_id !== input.orderId || original.currency !== input.currency ||
          original.provider !== input.provider || original.account !== input.account) throw new Error("ORIGINAL_PAYMENT_REQUIRED");
        const refunded = Number((this.db.prepare("SELECT COALESCE(SUM(amount_micros),0) total FROM business_payment_events WHERE original_event_id=? AND kind='refund'").get(original.id) as Row).total);
        if (refunded + input.amountMicros > original.amount_micros) throw new Error("REFUND_EXCEEDS_PAYMENT");
        payerKind = original.payer_kind;
      } else if (input.originalEventId) throw new Error("PAYMENT_CANNOT_REFERENCE_REFUND");
      const id = randomUUID();
      this.db.prepare("INSERT INTO business_payment_events VALUES(?,?,?,?,?,?,?,?,?,?,'owner_confirmed',?,?,?)")
        .run(id, input.orderId, input.provider, input.account, input.externalEventId, input.kind, input.amountMicros,
          input.currency, input.originalEventId ?? null, payerKind, input.evidence, requestHash, Date.now());
      this.db.prepare("INSERT INTO business_events VALUES(?,?,'payment_evidence_recorded',?,?)").run(`payment:${id}`, order.plan_id,
        JSON.stringify({ orderId: order.id, eventId: id, kind: input.kind, source: "owner_confirmed", payerKind }), Date.now());
      return this.db.prepare("SELECT * FROM business_payment_events WHERE id=?").get(id);
    });
  }
  receiptsSummary() {
    const row = this.db.prepare(`SELECT COALESCE(SUM(CASE WHEN kind='payment' THEN amount_micros ELSE 0 END),0) received,
      COALESCE(SUM(CASE WHEN kind='refund' THEN amount_micros ELSE 0 END),0) refunded
      FROM business_payment_events WHERE payer_kind='external' AND source='owner_confirmed'`).get() as Row;
    if (!Number.isSafeInteger(row.received) || !Number.isSafeInteger(row.refunded)) throw new Error("LEDGER_INTEGER_RANGE_EXCEEDED");
    return { ownerConfirmedReceivedMicros: row.received, ownerConfirmedRefundedMicros: row.refunded,
      currency: "CNY", verification: "owner_confirmed", providerVerificationAvailable: false };
  }
}
