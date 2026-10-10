import { get, run, transaction, type DB } from "@/lib/db";
import { normalizeEgyptianMobile } from "@/lib/phone";
import { createIntention, refundTransaction, type PaymobMethod } from "@/payments/paymob";
import { dateRange, isSlotTakenDbError, todayIn, type Slot } from "@/booking-engine";
import { scoped } from "./repo";
import { clinicEngine, holdMinutes } from "./store";
import { upsertPatient } from "./patients";
import { notifyBookingConfirmed, notifyCancelled } from "./notifications";
import { audit, SYSTEM, type Actor } from "./audit";
import type { Appointment, Lang, PayMethod, Service, Tenant } from "./types";

export class BookingError extends Error {
  constructor(
    public code:
      | "SLOT_TAKEN"
      | "SLOT_UNAVAILABLE"
      | "HOLD_EXPIRED"
      | "NOT_FOUND"
      | "INVALID_PHONE"
      | "INVALID_NAME"
      | "METHOD_NOT_ALLOWED"
      | "KIOSK_TOO_LATE"
      | "INVALID_STATE",
    message?: string,
  ) {
    super(message ?? code);
  }
}

export function depositFor(t: Tenant, s: Service): number {
  return s.deposit_egp ?? t.deposit_amount;
}

export interface DayAvailability {
  date: string;
  slots: { start: string; startMin: number; available: boolean }[];
}

/** Working days of the provider at the branch within the booking horizon, each with its slots. */
export function availabilityDays(
  db: DB,
  tenant: Tenant,
  q: { serviceId: number; providerId: number; branchId: number },
  now: Date = new Date(),
): DayAvailability[] {
  const engine = clinicEngine(db);
  const dates = dateRange(todayIn(tenant.timezone, now), tenant.booking_horizon_days);
  const slots = engine.availability(
    { tenantId: tenant.id, resourceId: q.providerId, serviceId: q.serviceId, locationId: q.branchId },
    dates,
    now,
  );
  const byDate = new Map<string, Slot[]>();
  for (const s of slots) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  return [...byDate.entries()].map(([date, list]) => ({
    date,
    slots: list.map((s) => ({ start: s.start.toISOString(), startMin: s.startMin, available: s.available })),
  }));
}

export function firstAvailable(days: DayAvailability[]) {
  for (const d of days) {
    const s = d.slots.find((x) => x.available);
    if (s) return { date: d.date, ...s };
  }
  return null;
}

export function createHold(
  db: DB,
  tenant: Tenant,
  input: { serviceId: number; providerId: number; branchId: number; start: string; lang: Lang; source?: Appointment["source"] },
  now: Date = new Date(),
): Appointment {
  const start = new Date(input.start);
  if (Number.isNaN(start.getTime())) throw new BookingError("SLOT_UNAVAILABLE");
  try {
    return clinicEngine(db).placeHold(
      { tenantId: tenant.id, resourceId: input.providerId, serviceId: input.serviceId, locationId: input.branchId },
      start,
      { holdMinutes: holdMinutes(tenant), now, meta: { source: input.source ?? "web", lang: input.lang } },
    );
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "SLOT_TAKEN" || code === "SLOT_UNAVAILABLE") throw new BookingError(code);
    throw err;
  }
}

export function releaseHold(db: DB, tenant: Tenant, token: string, now: Date = new Date()) {
  run(
    db,
    `UPDATE appointments SET status = 'cancelled', cancel_reason = 'released', cancelled_by = 'patient', cancelled_at = ?, updated_at = ?
      WHERE tenant_id = ? AND public_token = ? AND status = 'held'`,
    now.toISOString(),
    now.toISOString(),
    tenant.id,
    token,
  );
}

function liveHold(db: DB, tenant: Tenant, token: string, now: Date): Appointment {
  const appt = scoped(db, tenant.id).appointmentByToken(token);
  if (!appt) throw new BookingError("NOT_FOUND");
  if (appt.status !== "held" && appt.status !== "pending_payment") throw new BookingError("HOLD_EXPIRED");
  if (appt.hold_expires_at && appt.hold_expires_at <= now.toISOString()) {
    clinicEngine(db).expireHolds(now);
    throw new BookingError("HOLD_EXPIRED");
  }
  return appt;
}

/** Moves an appointment to confirmed. The DB trigger re-checks overlaps, so a late confirmation of an expired hold cannot double-book. */
export function confirmAppointment(db: DB, apptId: number, patch: { depositStatus?: Appointment["deposit_status"] }, now: Date = new Date()) {
  try {
    run(
      db,
      `UPDATE appointments
          SET status = 'confirmed', hold_expires_at = NULL, cancel_reason = NULL, cancelled_at = NULL, cancelled_by = NULL,
              deposit_status = COALESCE(?, deposit_status), updated_at = ?
        WHERE id = ?`,
      patch.depositStatus ?? null,
      now.toISOString(),
      apptId,
    );
    return true;
  } catch (err) {
    if (isSlotTakenDbError(err)) return false;
    throw err;
  }
}

export interface CompleteInput {
  name: string;
  phone: string;
  method: PayMethod;
  marketingConsent: boolean;
  lang: Lang;
}

export type CompleteResult = { kind: "confirmed"; appointment: Appointment } | { kind: "redirect"; url: string; appointment: Appointment };

/**
 * Step 3 of the booking flow. Pay-at-clinic (when allowed) or a zero deposit confirms immediately;
 * card / wallet / kiosk move the hold to pending_payment and redirect to Paymob. Confirmation for
 * paid deposits happens ONLY in the verified webhook, never here and never on the browser redirect.
 */
export async function completeBooking(
  db: DB,
  tenant: Tenant,
  token: string,
  input: CompleteInput,
  urls: { origin: string; donePath: string },
  now: Date = new Date(),
): Promise<CompleteResult> {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 3 || name.length > 80) throw new BookingError("INVALID_NAME");
  const phone = normalizeEgyptianMobile(input.phone);
  if (!phone) throw new BookingError("INVALID_PHONE");

  const s = scoped(db, tenant.id);
  const appt = liveHold(db, tenant, token, now);
  const service = s.service(appt.service_id)!;
  const deposit = depositFor(tenant, service);
  const method = input.method;
  if (method === "clinic" && deposit > 0 && !tenant.allow_pay_at_clinic) throw new BookingError("METHOD_NOT_ALLOWED");
  if (method === "kiosk" && !tenant.allow_kiosk) throw new BookingError("METHOD_NOT_ALLOWED");

  const patient = upsertPatient(db, tenant.id, { name, phoneE164: phone, lang: input.lang, marketingConsent: input.marketingConsent });

  if (method === "clinic" || deposit === 0) {
    transaction(db, () => {
      run(db, "UPDATE appointments SET patient_id = ?, pay_method = ?, deposit_amount = 0, deposit_status = 'none', lang = ? WHERE id = ?", patient.id, "clinic", input.lang, appt.id);
      if (!confirmAppointment(db, appt.id, {}, now)) throw new BookingError("SLOT_TAKEN");
      audit(db, tenant.id, { userId: null, name: "patient:web" }, "booking.confirmed", "appointment", appt.id, { method });
    });
    const confirmed = s.appointment(appt.id)!;
    await notifyBookingConfirmed(db, confirmed);
    return { kind: "confirmed", appointment: confirmed };
  }

  // Paid deposit: extend the hold while the patient pays. Kiosk references get a longer hold,
  // capped so an unpaid reference never blocks the slot close to the appointment.
  const start = Date.parse(appt.start_utc);
  let expires = now.getTime() + 15 * 60_000;
  if (method === "kiosk") {
    expires = Math.min(now.getTime() + 24 * 3_600_000, start - 3 * 3_600_000);
    if (expires < now.getTime() + 30 * 60_000) throw new BookingError("KIOSK_TOO_LATE");
  }
  const paymentId = transaction(db, () => {
    run(
      db,
      `UPDATE appointments SET patient_id = ?, status = 'pending_payment', pay_method = ?, deposit_amount = ?, deposit_status = 'pending',
              hold_expires_at = ?, lang = ?, updated_at = ? WHERE id = ?`,
      patient.id,
      method,
      deposit,
      new Date(expires).toISOString(),
      input.lang,
      now.toISOString(),
      appt.id,
    );
    return run(
      db,
      "INSERT INTO payments (tenant_id, appointment_id, method, amount_cents, status) VALUES (?,?,?,?, 'initiated')",
      tenant.id,
      appt.id,
      method,
      deposit * 100,
    ).id;
  });

  const merchantRef = `pay_${paymentId}`;
  const [first, ...rest] = name.split(" ");
  const intention = await createIntention(
    {
      amountCents: deposit * 100,
      method: method as PaymobMethod,
      merchantReference: merchantRef,
      itemName: `${tenant.name_en} deposit ${appt.ref}`,
      customer: { firstName: first ?? name, lastName: rest.join(" "), phone, email: patient.email ?? "na@example.com" },
      notificationUrl: `${urls.origin}/api/payments/paymob/webhook`,
      redirectionUrl: `${urls.origin}${urls.donePath}?t=${appt.public_token}`,
    },
    `${urls.origin}/pay/sandbox?p=${paymentId}&t=${appt.public_token}&r=${encodeURIComponent(urls.donePath)}`,
  );
  run(db, "UPDATE payments SET provider_order_id = ?, intention_id = ? WHERE id = ?", merchantRef, intention.intentionId, paymentId);
  return { kind: "redirect", url: intention.checkoutUrl, appointment: s.appointment(appt.id)! };
}

/**
 * Cancels an appointment and applies the clinic's deposit policy: cancelled at least
 * `cancellation_window_hours` before the start -> refund (or credit); later -> forfeited.
 */
export async function cancelAppointment(
  db: DB,
  tenant: Tenant,
  apptId: number,
  actor: Actor,
  opts: { by: "patient" | "clinic"; reason?: string; now?: Date; notify?: boolean } = { by: "clinic" },
) {
  const now = opts.now ?? new Date();
  const s = scoped(db, tenant.id);
  const appt = s.appointment(apptId);
  if (!appt) throw new BookingError("NOT_FOUND");
  if (!["held", "pending_payment", "confirmed"].includes(appt.status)) throw new BookingError("INVALID_STATE");

  const hoursBefore = (Date.parse(appt.start_utc) - now.getTime()) / 3_600_000;
  // The clinic cancelling never costs the patient their deposit.
  const refundable = opts.by === "clinic" || hoursBefore >= tenant.cancellation_window_hours;
  const policy: "refund" | "forfeit" | "none" = appt.deposit_status === "paid" ? (refundable ? "refund" : "forfeit") : "none";

  transaction(db, () => {
    run(
      db,
      `UPDATE appointments SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?, updated_at = ?,
              deposit_status = CASE WHEN deposit_status = 'paid' THEN ? WHEN deposit_status = 'pending' THEN 'none' ELSE deposit_status END
        WHERE id = ?`,
      now.toISOString(),
      opts.by,
      opts.reason ?? null,
      now.toISOString(),
      policy === "refund" ? "refund_due" : "forfeited",
      appt.id,
    );
    audit(db, tenant.id, actor, "appointment.cancelled", "appointment", appt.id, { by: opts.by, policy, hoursBefore: Math.round(hoursBefore) });
  });

  if (policy === "refund") {
    const pay = get<{ id: number; provider_ref: string | null; amount_cents: number }>(
      db,
      "SELECT id, provider_ref, amount_cents FROM payments WHERE appointment_id = ? AND status = 'paid' ORDER BY id DESC LIMIT 1",
      appt.id,
    );
    if (pay?.provider_ref) {
      const r = await refundTransaction(pay.provider_ref, pay.amount_cents);
      if (r.ok) {
        run(db, "UPDATE payments SET status = 'refunded', updated_at = ? WHERE id = ?", now.toISOString(), pay.id);
        run(db, "UPDATE appointments SET deposit_status = 'refunded' WHERE id = ?", appt.id);
        audit(db, tenant.id, SYSTEM, "payment.refunded", "payment", pay.id, { sandbox: r.sandbox });
      }
    }
  }
  if (opts.notify !== false) await notifyCancelled(db, s.appointment(appt.id)!, policy, tenant.cancellation_window_hours);
  return { policy };
}
