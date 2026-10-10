import { describe, expect, it } from "vitest";
import { get, run } from "@/lib/db";
import { computeTransactionHmac, sandboxTransaction } from "@/payments/paymob";
import { availabilityDays, cancelAppointment, completeBooking, createHold, firstAvailable } from "@/clinic/booking";
import { handlePaymobCallback } from "@/clinic/payment-webhook";
import { scoped } from "@/clinic/repo";
import { freshDemo, ids, NOW } from "./helpers";

async function pendingCardBooking(daysAhead = 0) {
  const { db, tenant } = freshDemo();
  const I = ids(db, tenant.id);
  const q = { serviceId: I.service("checkup"), providerId: I.provider("mariam"), branchId: I.branch("nasr-city") };
  const days = availabilityDays(db, tenant, q, NOW).filter((d) => d.date >= new Date(NOW.getTime() + daysAhead * 86_400_000).toISOString().slice(0, 10));
  const slot = firstAvailable(days)!;
  const hold = createHold(db, tenant, { ...q, start: slot.start, lang: "ar" }, NOW);
  const r = await completeBooking(db, tenant, hold.public_token, { name: "كريم حسن", phone: "01289123456", method: "card", marketingConsent: false, lang: "ar" }, { origin: "http://localhost:3000", donePath: "/book/done" }, NOW);
  const pay = get<{ id: number; provider_order_id: string; amount_cents: number }>(db, "SELECT * FROM payments WHERE appointment_id = ?", hold.id)!;
  return { db, tenant, appt: hold, r, pay };
}

const txnFor = (pay: { id: number; provider_order_id: string; amount_cents: number }, over: Partial<{ success: boolean; amount: number; id: number }> = {}) =>
  sandboxTransaction({ id: over.id ?? 555001, orderId: 9001, merchantOrderId: pay.provider_order_id, amountCents: over.amount ?? pay.amount_cents, method: "card", success: over.success ?? true });

describe("Paymob deposits", () => {
  it("card payment moves the booking to pending_payment and redirects to checkout, never confirming on its own", async () => {
    const { db, tenant, appt, r } = await pendingCardBooking();
    expect(r.kind).toBe("redirect");
    expect(scoped(db, tenant.id).appointment(appt.id)!.status).toBe("pending_payment");
  });

  it("rejects a forged webhook and changes nothing", async () => {
    const { db, tenant, appt, pay } = await pendingCardBooking();
    const txn = txnFor(pay);
    const out = await handlePaymobCallback(db, { type: "TRANSACTION", obj: txn }, "deadbeef".repeat(16), NOW);
    expect(out.status).toBe(401);
    const tampered = { ...txn, amount_cents: 1 };
    const out2 = await handlePaymobCallback(db, { type: "TRANSACTION", obj: tampered }, computeTransactionHmac(txn, "test-hmac-secret"), NOW);
    expect(out2.status).toBe(401);
    expect(scoped(db, tenant.id).appointment(appt.id)!.status).toBe("pending_payment");
  });

  it("a verified webhook confirms; a replay does nothing", async () => {
    const { db, tenant, appt, pay } = await pendingCardBooking();
    const txn = txnFor(pay);
    const hmac = computeTransactionHmac(txn, "test-hmac-secret");
    expect((await handlePaymobCallback(db, { type: "TRANSACTION", obj: txn }, hmac, NOW)).result).toBe("confirmed");
    const a = scoped(db, tenant.id).appointment(appt.id)!;
    expect(a.status).toBe("confirmed");
    expect(a.deposit_status).toBe("paid");
    const msgCount = () => (get<{ n: number }>(db, "SELECT COUNT(*) n FROM message_log WHERE appointment_id = ?", appt.id)!.n);
    const before = msgCount();
    expect((await handlePaymobCallback(db, { type: "TRANSACTION", obj: txn }, hmac, NOW)).result).toBe("duplicate");
    expect(msgCount()).toBe(before);
  });

  it("an amount mismatch does not confirm", async () => {
    const { db, tenant, appt, pay } = await pendingCardBooking();
    const txn = txnFor(pay, { amount: 100 });
    const out = await handlePaymobCallback(db, { type: "TRANSACTION", obj: txn }, computeTransactionHmac(txn, "test-hmac-secret"), NOW);
    expect(out.result).toBe("amount_mismatch");
    expect(scoped(db, tenant.id).appointment(appt.id)!.status).toBe("pending_payment");
  });

  it("a declined payment frees the slot", async () => {
    const { db, tenant, appt, pay } = await pendingCardBooking();
    const txn = txnFor(pay, { success: false });
    expect((await handlePaymobCallback(db, { type: "TRANSACTION", obj: txn }, computeTransactionHmac(txn, "test-hmac-secret"), NOW)).result).toBe("failed");
    expect(scoped(db, tenant.id).appointment(appt.id)!.status).toBe("cancelled");
  });

  it("payment arriving after the hold expired and the slot was re-booked is flagged for refund, never double-booked", async () => {
    const { db, tenant, appt, pay } = await pendingCardBooking();
    run(db, "UPDATE appointments SET status = 'cancelled', cancel_reason = 'hold_expired' WHERE id = ?", appt.id);
    const a = scoped(db, tenant.id).appointment(appt.id)!;
    createHold(db, tenant, { serviceId: a.service_id, providerId: a.provider_id, branchId: a.branch_id, start: a.start_utc, lang: "ar" }, NOW);
    const txn = txnFor(pay);
    expect((await handlePaymobCallback(db, { type: "TRANSACTION", obj: txn }, computeTransactionHmac(txn, "test-hmac-secret"), NOW)).result).toBe("needs_refund");
    expect(scoped(db, tenant.id).appointment(appt.id)!.status).toBe("cancelled");
  });
});

describe("cancellation policy", () => {
  async function paidBooking(daysAhead: number) {
    const b = await pendingCardBooking(daysAhead);
    const txn = txnFor(b.pay);
    await handlePaymobCallback(b.db, { type: "TRANSACTION", obj: txn }, computeTransactionHmac(txn, "test-hmac-secret"), NOW);
    return b;
  }
  const actor = { userId: null, name: "test" };

  it("more than 24h before: deposit refunded", async () => {
    const { db, tenant, appt } = await paidBooking(3);
    const r = await cancelAppointment(db, tenant, appt.id, actor, { by: "patient", now: NOW });
    expect(r.policy).toBe("refund");
    expect(scoped(db, tenant.id).appointment(appt.id)!.deposit_status).toBe("refunded");
  });

  it("less than 24h before: deposit forfeited", async () => {
    const { db, tenant, appt } = await paidBooking(0);
    const a = scoped(db, tenant.id).appointment(appt.id)!;
    const lateNow = new Date(Date.parse(a.start_utc) - 3 * 3_600_000);
    const r = await cancelAppointment(db, tenant, appt.id, actor, { by: "patient", now: lateNow });
    expect(r.policy).toBe("forfeit");
    expect(scoped(db, tenant.id).appointment(appt.id)!.deposit_status).toBe("forfeited");
  });

  it("clinic cancelling always refunds", async () => {
    const { db, tenant, appt } = await paidBooking(0);
    const a = scoped(db, tenant.id).appointment(appt.id)!;
    const r = await cancelAppointment(db, tenant, appt.id, actor, { by: "clinic", now: new Date(Date.parse(a.start_utc) - 3_600_000) });
    expect(r.policy).toBe("refund");
  });
});
