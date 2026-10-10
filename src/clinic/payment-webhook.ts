import { get, run, transaction, type DB } from "@/lib/db";
import { secret } from "@/lib/crypto";
import { redactTransaction, verifyTransactionHmac, type PaymobTransaction } from "@/payments/paymob";
import { confirmAppointment } from "./booking";
import { notifyBookingConfirmed } from "./notifications";
import { scoped } from "./repo";
import { audit, SYSTEM } from "./audit";

export type WebhookOutcome =
  | { status: 401; result: "invalid_signature" }
  | { status: 400; result: "bad_request" }
  | { status: 200; result: "duplicate" | "ignored" | "confirmed" | "failed" | "pending" | "needs_refund" | "amount_mismatch" };

interface PaymentRow {
  id: number;
  tenant_id: number;
  appointment_id: number;
  amount_cents: number;
  status: string;
}

/**
 * Paymob "transaction processed" callback. Order of checks:
 * 1. HMAC (forged -> 401, nothing written)  2. idempotency key (replay -> no-op)
 * 3. amount matches what we asked for  4. state transition inside a transaction.
 */
export async function handlePaymobCallback(db: DB, body: unknown, hmac: string | null, now: Date = new Date()): Promise<WebhookOutcome> {
  const obj = (body as { obj?: PaymobTransaction })?.obj;
  if (!obj || typeof obj !== "object" || obj.id === undefined) return { status: 400, result: "bad_request" };
  if (!verifyTransactionHmac(obj, hmac, secret("PAYMOB_HMAC_SECRET"))) return { status: 401, result: "invalid_signature" };

  const eventKey = `txn:${obj.id}:${obj.success}:${obj.pending}`;
  try {
    run(db, "INSERT INTO webhook_events (provider, event_key) VALUES ('paymob', ?)", eventKey);
  } catch {
    return { status: 200, result: "duplicate" };
  }

  const merchantRef = String(obj.order?.merchant_order_id ?? "");
  const paymentId = Number(merchantRef.replace(/^pay_/, ""));
  const payment = get<PaymentRow>(db, "SELECT * FROM payments WHERE id = ? AND provider_order_id = ?", paymentId, merchantRef);
  if (!payment) return { status: 200, result: "ignored" };
  const raw = JSON.stringify(redactTransaction(obj));
  const iso = now.toISOString();

  if (Number(obj.amount_cents) !== payment.amount_cents) {
    run(db, "UPDATE payments SET raw_payload = ?, updated_at = ? WHERE id = ?", raw, iso, payment.id);
    audit(db, payment.tenant_id, SYSTEM, "payment.amount_mismatch", "payment", payment.id, { got: obj.amount_cents, want: payment.amount_cents });
    return { status: 200, result: "amount_mismatch" };
  }

  if (obj.pending && !obj.success) {
    // Kiosk reference issued; the patient pays later at an outlet.
    run(
      db,
      "UPDATE payments SET kiosk_reference = ?, provider_ref = ?, raw_payload = ?, updated_at = ? WHERE id = ?",
      obj.data?.bill_reference != null ? String(obj.data.bill_reference) : null,
      String(obj.id),
      raw,
      iso,
      payment.id,
    );
    return { status: 200, result: "pending" };
  }

  if (!obj.success) {
    transaction(db, () => {
      run(db, "UPDATE payments SET status = 'failed', provider_ref = ?, raw_payload = ?, updated_at = ? WHERE id = ? AND status = 'initiated'", String(obj.id), raw, iso, payment.id);
      // Free the slot right away instead of waiting for the hold to expire.
      run(
        db,
        `UPDATE appointments SET status = 'cancelled', cancel_reason = 'payment_failed', cancelled_by = 'system', cancelled_at = ?, deposit_status = 'none', updated_at = ?
          WHERE id = ? AND status = 'pending_payment'`,
        iso,
        iso,
        payment.appointment_id,
      );
      audit(db, payment.tenant_id, SYSTEM, "payment.failed", "payment", payment.id);
    });
    return { status: 200, result: "failed" };
  }

  const outcome = transaction(db, () => {
    run(db, "UPDATE payments SET status = 'paid', provider_ref = ?, raw_payload = ?, updated_at = ? WHERE id = ?", String(obj.id), raw, iso, payment.id);
    const appt = scoped(db, payment.tenant_id).appointment(payment.appointment_id)!;
    if (appt.status === "confirmed") return "confirmed" as const;
    const revivable = appt.status === "held" || appt.status === "pending_payment" || (appt.status === "cancelled" && appt.cancel_reason === "hold_expired");
    if (revivable && confirmAppointment(db, appt.id, { depositStatus: "paid" }, now)) {
      audit(db, payment.tenant_id, SYSTEM, "booking.confirmed", "appointment", appt.id, { via: "paymob", txn: String(obj.id) });
      return "confirmed" as const;
    }
    // Paid after the hold lapsed and someone else took the slot: never double-book, refund instead.
    run(db, "UPDATE payments SET status = 'needs_refund' WHERE id = ?", payment.id);
    run(db, "UPDATE appointments SET deposit_status = 'refund_due' WHERE id = ?", appt.id);
    audit(db, payment.tenant_id, SYSTEM, "payment.needs_refund", "payment", payment.id, { reason: "slot_no_longer_available" });
    return "needs_refund" as const;
  });

  if (outcome === "confirmed") {
    const appt = scoped(db, payment.tenant_id).appointment(payment.appointment_id)!;
    await notifyBookingConfirmed(db, appt);
  }
  return { status: 200, result: outcome };
}
