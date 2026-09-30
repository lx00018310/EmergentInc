import { MemoryPoint, lifeText, memoryPoint } from "@emergentinc/protocol";
import { LineageStore } from "@emergentinc/persistence";

const allowed = new Set(["body_rollback", "generation_birth", "generation_failure", "generation_rollback", "owner_correction", "security_boundary", "business_outcome"]);
export class MemoryGate {
  constructor(readonly lineage: LineageStore, private generation: () => string) {}
  record(kind: string, point: MemoryPoint, sourceRef: string, pixelId?: string, generationId = this.generation()) {
    if (!allowed.has(kind)) throw new Error("MEMORY_GATE_EVENT_DENIED");
    return this.lineage.remember(generationId, kind, memoryPoint(point), lifeText(sourceRef, 300), pixelId, 4);
  }
  ownerCorrection(id: string, value: unknown, pixelId?: string) {
    const p = memoryPoint(value);
    this.lineage.lifeEvent(this.generation(), "owner_correction", p, `owner-correction:${id}`, pixelId);
    return this.record("owner_correction", p, `owner-correction:${id}`, pixelId);
  }
  confirmedPayment(id: string) {
    const payment = this.lineage.db.prepare("SELECT * FROM business_payment_events WHERE id=? AND payer_kind='external' AND source='owner_confirmed'").get(id);
    if (!payment) return null;
    return this.record("business_outcome", {
      point: `${payment.kind === "refund" ? "已确认外部客户退款" : "已确认外部客户付款"} ${payment.amount_micros} CNY 百万分之一`,
      reason: String(payment.evidence).slice(0, 1000),
      effect: `订单 ${payment.order_id} 的真实收退款事实保留；核验来源为 Owner，并非平台自动核验`,
    }, `payment-memory:${id}`, "business");
  }
  syncConfirmedPayments() {
    for (const payment of this.lineage.db.prepare(`SELECT p.id FROM business_payment_events p WHERE payer_kind='external'
      AND source='owner_confirmed' AND NOT EXISTS (SELECT 1 FROM memories m WHERE m.source_ref='payment-memory:' || p.id)
      ORDER BY created_at LIMIT 100`).all()) this.confirmedPayment(String(payment.id));
  }
}
