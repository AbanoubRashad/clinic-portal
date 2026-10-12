import { all, get, run, transaction, type DB } from "@/lib/db";
import { addDays, generateSlots, utcToZoned, weekdayOf, zonedToUtc } from "@/booking-engine";
import { normalizeEgyptianMobile } from "@/lib/phone";
import { scoped } from "./repo";
import { clinicBookingStore } from "./store";
import { upsertPatient } from "./patients";
import { BookingError, cancelAppointment, confirmAppointment, createHold } from "./booking";
import { notifyBookingConfirmed } from "./notifications";
import { openOfferFor, patientsForOffer, slotStillOpen } from "./waitlist";
import { audit, type Actor } from "./audit";
import type { Appointment, Provider, Tenant } from "./types";

export type Tone = "ok" | "pending" | "cancelled" | "arrived" | "done" | "noshow";

export interface ScheduleCard {
  appt: Appointment;
  startMin: number;
  patientName: string;
  label: string;
  tone: Tone;
  tag: string;
  free: boolean; // cancelled and the time is still open
  offer: { id: number; status: string; recipients: { token: string; status: string; name: string }[] } | null;
  past: boolean;
}

export function statusOf(a: Appointment): { tone: Tone; tag: string } {
  switch (a.status) {
    case "confirmed":
      if (a.patient_confirmed_at) return { tone: "ok", tag: a.deposit_status === "paid" ? "مؤكد · عربون" : "مؤكد" };
      if (a.source === "waitlist") return { tone: "ok", tag: "من قائمة الانتظار" };
      return { tone: "pending", tag: "بانتظار الرد" };
    case "pending_payment":
    case "held":
      return { tone: "pending", tag: "بانتظار الدفع" };
    case "checked_in":
      return { tone: "arrived", tag: "وصل العيادة" };
    case "completed":
      return { tone: "done", tag: "انتهى" };
    case "no_show":
      return { tone: "noshow", tag: "لم يحضر" };
    case "cancelled":
      return { tone: "cancelled", tag: "ألغى" };
  }
}

function dayBounds(tenant: Tenant, date: string) {
  return { from: zonedToUtc(date, 0, tenant.timezone).toISOString(), to: zonedToUtc(addDays(date, 1), 0, tenant.timezone).toISOString() };
}

export function daySchedule(db: DB, tenant: Tenant, q: { branchId: number; date: string; providerId?: number | null }, now: Date = new Date()) {
  const s = scoped(db, tenant.id);
  const { from, to } = dayBounds(tenant, q.date);
  const appts = all<Appointment & { patient_name: string | null; service_name: string }>(
    db,
    `SELECT a.*, p.name AS patient_name, sv.name_ar AS service_name
       FROM appointments a LEFT JOIN patients p ON p.id = a.patient_id JOIN services sv ON sv.id = a.service_id
      WHERE a.tenant_id = ? AND a.branch_id = ? AND a.start_utc >= ? AND a.start_utc < ?
        AND a.status <> 'held'
        AND NOT (a.status = 'cancelled' AND COALESCE(a.cancel_reason, '') IN ('hold_expired', 'released', 'payment_failed'))
      ORDER BY a.start_utc`,
    tenant.id,
    q.branchId,
    from,
    to,
  );
  const wd = weekdayOf(q.date);
  const working = new Set(
    all<{ provider_id: number }>(db, "SELECT DISTINCT provider_id FROM working_hours WHERE tenant_id = ? AND branch_id = ? AND weekday = ?", tenant.id, q.branchId, wd).map(
      (r) => r.provider_id,
    ),
  );
  const providers = s.providers().filter((p) => (working.has(p.id) || appts.some((a) => a.provider_id === p.id)) && (!q.providerId || p.id === q.providerId));

  const cards = (p: Provider): ScheduleCard[] =>
    appts
      .filter((a) => a.provider_id === p.id)
      .map((a) => {
        const { tone, tag } = statusOf(a);
        const free = a.status === "cancelled" && slotStillOpen(db, a, now);
        const offerRow = a.status === "cancelled" ? openOfferFor(db, a.id) : undefined;
        const cancelledLabel = a.cancelled_at
          ? `ألغاه ${a.patient_name ?? ""} الساعة ${fmtLocal(a.cancelled_at, tenant)}`
          : `ألغاه ${a.patient_name ?? ""}`;
        return {
          appt: a,
          startMin: utcToZoned(new Date(a.start_utc), tenant.timezone).minutes,
          patientName: a.status === "cancelled" && free ? "موعد متاح" : (a.patient_name ?? "—"),
          label: a.status === "cancelled" && free ? cancelledLabel : (a.visit_label ?? a.service_name),
          tone,
          tag: a.status === "cancelled" && free ? "ألغى · متاح" : tag,
          free,
          offer: offerRow ? { id: offerRow.id, status: offerRow.status, recipients: patientsForOffer(db, offerRow.id) } : null,
          past: Date.parse(a.start_utc) <= now.getTime(),
        };
      })
      // A cancelled slot that has since been refilled is shown only through its new booking.
      .filter((c) => c.appt.status !== "cancelled" || c.free || !appts.some((o) => o.id !== c.appt.id && o.provider_id === c.appt.provider_id && o.status !== "cancelled" && o.start_utc < c.appt.end_utc && o.block_end_utc > c.appt.start_utc));

  const columns = providers.map((p) => ({ provider: p, cards: cards(p) }));

  const live = appts.filter((a) => a.status !== "cancelled");
  const cancelledByPeople = appts.filter((a) => a.status === "cancelled");
  const openCancelled = cancelledByPeople.filter((a) => slotStillOpen(db, a, now)).length;
  const refilled = live.filter((a) => a.source === "waitlist").length;
  const confirmedOnWa = live.filter((a) => a.patient_confirmed_at).length;
  const awaiting = live.filter((a) => a.status === "confirmed" && !a.patient_confirmed_at && a.source !== "waitlist").length;
  const paid = live.filter((a) => a.deposit_status === "paid");
  return {
    columns,
    kpis: {
      total: live.length,
      online: live.filter((a) => a.source === "web").length,
      confirmedOnWa,
      awaiting,
      depositsEgp: paid.reduce((sum, a) => sum + a.deposit_amount, 0),
      depositsCount: paid.length,
      cancelledOpen: openCancelled,
      refilled,
    },
  };
}

function fmtLocal(iso: string, tenant: Tenant) {
  const m = utcToZoned(new Date(iso), tenant.timezone).minutes;
  const h = Math.floor(m / 60);
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m % 60).padStart(2, "0")} ${h >= 12 ? "م" : "ص"}`.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]!);
}

function requireAppt(db: DB, tenant: Tenant, id: number) {
  const a = scoped(db, tenant.id).appointment(id);
  if (!a) throw new BookingError("NOT_FOUND");
  return a;
}

export function checkIn(db: DB, tenant: Tenant, actor: Actor, id: number, now = new Date()) {
  const a = requireAppt(db, tenant, id);
  if (a.status !== "confirmed" && a.status !== "pending_payment") throw new BookingError("INVALID_STATE");
  transaction(db, () => {
    run(db, "UPDATE appointments SET status = 'checked_in', checked_in_at = ?, hold_expires_at = NULL, updated_at = ? WHERE id = ?", now.toISOString(), now.toISOString(), id);
    audit(db, tenant.id, actor, "appointment.checked_in", "appointment", id);
  });
}

export function markNoShow(db: DB, tenant: Tenant, actor: Actor, id: number, now = new Date()) {
  const a = requireAppt(db, tenant, id);
  if (a.status !== "confirmed") throw new BookingError("INVALID_STATE");
  if (Date.parse(a.start_utc) > now.getTime()) throw new BookingError("INVALID_STATE", "Cannot mark a future appointment as no-show");
  transaction(db, () => {
    run(db, "UPDATE appointments SET status = 'no_show', deposit_status = CASE WHEN deposit_status = 'paid' THEN 'forfeited' ELSE deposit_status END, updated_at = ? WHERE id = ?", now.toISOString(), id);
    audit(db, tenant.id, actor, "appointment.no_show", "appointment", id);
  });
}

export function markCompleted(db: DB, tenant: Tenant, actor: Actor, id: number, now = new Date()) {
  const a = requireAppt(db, tenant, id);
  if (a.status !== "checked_in") throw new BookingError("INVALID_STATE");
  transaction(db, () => {
    run(db, "UPDATE appointments SET status = 'completed', updated_at = ? WHERE id = ?", now.toISOString(), id);
    audit(db, tenant.id, actor, "appointment.completed", "appointment", id);
  });
}

export async function receptionCancel(db: DB, tenant: Tenant, actor: Actor, id: number, reason: string, now = new Date()) {
  return cancelAppointment(db, tenant, id, actor, { by: reason === "patient_called" ? "patient" : "clinic", reason, now });
}

/** Free slots for moving an appointment (its own current time does not count as busy). */
export function rescheduleOptions(db: DB, tenant: Tenant, appt: Appointment, now = new Date(), days = 14) {
  const store = clinicBookingStore(db);
  const key = { tenantId: tenant.id, resourceId: appt.provider_id, serviceId: appt.service_id, locationId: appt.branch_id };
  const ctx = store.loadContext(key);
  if (!ctx) return [];
  const today = utcToZoned(now, tenant.timezone).date;
  const dates = Array.from({ length: days }, (_, i) => addDays(today, i));
  const from = new Date(Date.parse(`${dates[0]}T00:00:00Z`) - 86_400_000);
  const to = new Date(Date.parse(`${dates[dates.length - 1]}T00:00:00Z`) + 2 * 86_400_000);
  const own = { start: Date.parse(appt.start_utc), end: Date.parse(appt.block_end_utc) };
  const blocked = store.blockedIntervals(key, from, to, now).filter((b) => !(b.start === own.start && b.end === own.end));
  return generateSlots({ ...ctx, dates, locationId: appt.branch_id, blocked, now }).filter((s) => s.available && s.start.getTime() !== own.start);
}

export async function reschedule(db: DB, tenant: Tenant, actor: Actor, id: number, newStartIso: string, now = new Date()) {
  const a = requireAppt(db, tenant, id);
  if (a.status !== "confirmed" && a.status !== "pending_payment") throw new BookingError("INVALID_STATE");
  const slot = rescheduleOptions(db, tenant, a, now).find((s) => s.start.toISOString() === newStartIso);
  if (!slot) throw new BookingError("SLOT_UNAVAILABLE");
  try {
    transaction(db, () => {
      clinicBookingStore(db).expireHolds(now);
      run(
        db,
        "UPDATE appointments SET start_utc = ?, end_utc = ?, block_end_utc = ?, patient_confirmed_at = NULL, reminder_day_sent_at = NULL, reminder_2h_sent_at = NULL, updated_at = ? WHERE id = ?",
        slot.start.toISOString(),
        slot.end.toISOString(),
        slot.blockEnd.toISOString(),
        now.toISOString(),
        id,
      );
      audit(db, tenant.id, actor, "appointment.rescheduled", "appointment", id, { from: a.start_utc, to: slot.start.toISOString() });
    });
  } catch (err) {
    if ((err as Error).message.includes("SLOT_TAKEN")) throw new BookingError("SLOT_TAKEN");
    throw err;
  }
  await notifyBookingConfirmed(db, scoped(db, tenant.id).appointment(id)!);
}

/** Phone / front-desk booking: confirmed immediately, deposit (if any) collected at the clinic. */
export async function createReceptionBooking(
  db: DB,
  tenant: Tenant,
  actor: Actor,
  input: { name: string; phone: string; serviceId: number; providerId: number; branchId: number; start: string; walkIn?: boolean; notes?: string },
  now = new Date(),
) {
  const phone = normalizeEgyptianMobile(input.phone);
  if (!phone) throw new BookingError("INVALID_PHONE");
  if (input.name.trim().length < 3) throw new BookingError("INVALID_NAME");
  const hold = createHold(
    db,
    tenant,
    { serviceId: input.serviceId, providerId: input.providerId, branchId: input.branchId, start: input.start, lang: "ar", source: input.walkIn ? "walk_in" : "reception" },
    now,
  );
  const patient = upsertPatient(db, tenant.id, { name: input.name, phoneE164: phone, lang: "ar" });
  transaction(db, () => {
    run(db, "UPDATE appointments SET patient_id = ?, pay_method = 'clinic', admin_notes = ? WHERE id = ?", patient.id, input.notes?.slice(0, 200) || null, hold.id);
    if (!confirmAppointment(db, hold.id, {}, now)) throw new BookingError("SLOT_TAKEN");
    audit(db, tenant.id, actor, "booking.created_by_reception", "appointment", hold.id, { walkIn: Boolean(input.walkIn) });
  });
  const appt = scoped(db, tenant.id).appointment(hold.id)!;
  await notifyBookingConfirmed(db, appt);
  return appt;
}

export function walkIns(db: DB, tenantId: number, branchId: number, date: string, tz: string) {
  const from = zonedToUtc(date, 0, tz).toISOString();
  const to = zonedToUtc(addDays(date, 1), 0, tz).toISOString();
  return all<{ id: number; name: string; note: string; status: string; arrived_at: string }>(
    db,
    "SELECT * FROM walk_ins WHERE tenant_id = ? AND branch_id = ? AND arrived_at >= ? AND arrived_at < ? AND status = 'waiting' ORDER BY arrived_at",
    tenantId,
    branchId,
    from,
    to,
  );
}

export function addWalkIn(db: DB, tenant: Tenant, actor: Actor, branchId: number, name: string, note: string) {
  if (name.trim().length < 2) throw new BookingError("INVALID_NAME");
  const { id } = run(db, "INSERT INTO walk_ins (tenant_id, branch_id, name, note) VALUES (?,?,?,?)", tenant.id, branchId, name.trim(), note.trim().slice(0, 80));
  audit(db, tenant.id, actor, "walk_in.added", "walk_in", id);
}

export function setWalkInStatus(db: DB, tenant: Tenant, actor: Actor, id: number, status: "seen" | "left") {
  run(db, "UPDATE walk_ins SET status = ? WHERE tenant_id = ? AND id = ?", status, tenant.id, id);
  audit(db, tenant.id, actor, `walk_in.${status}`, "walk_in", id);
}

export function patientsList(db: DB, tenantId: number, search = "") {
  return all<{ id: number; name: string; phone_last4: string; lang: string; marketing_consent: number; whatsapp_opt_out: number; visits: number; last_visit: string | null; no_shows: number }>(
    db,
    `SELECT p.id, p.name, p.phone_last4, p.lang, p.marketing_consent, p.whatsapp_opt_out,
            COUNT(a.id) AS visits, MAX(a.start_utc) AS last_visit, SUM(CASE WHEN a.status = 'no_show' THEN 1 ELSE 0 END) AS no_shows
       FROM patients p LEFT JOIN appointments a ON a.patient_id = p.id AND a.status NOT IN ('held','cancelled')
      WHERE p.tenant_id = ? AND (? = '' OR p.name LIKE '%' || ? || '%' OR p.phone_last4 = ?)
      GROUP BY p.id ORDER BY last_visit DESC NULLS LAST LIMIT 200`,
    tenantId,
    search,
    search,
    search,
  );
}

export function auditTrail(db: DB, tenantId: number, limit = 100) {
  return all<{ id: number; actor: string; action: string; entity: string; entity_id: number | null; details: string | null; created_at: string }>(
    db,
    "SELECT * FROM audit_log WHERE tenant_id = ? ORDER BY id DESC LIMIT ?",
    tenantId,
    limit,
  );
}

export function messageLog(db: DB, tenantId: number, limit = 100) {
  return all<{ id: number; channel: string; template: string; recipient: string; lang: string; body: string; buttons: string | null; status: string; created_at: string; appointment_id: number | null }>(
    db,
    "SELECT * FROM message_log WHERE tenant_id = ? ORDER BY id DESC LIMIT ?",
    tenantId,
    limit,
  );
}

export function paymentsList(db: DB, tenantId: number, limit = 100) {
  return all<{ id: number; method: string; amount_cents: number; status: string; provider_ref: string | null; kiosk_reference: string | null; created_at: string; ref: string; patient: string | null }>(
    db,
    `SELECT py.*, a.ref, p.name AS patient FROM payments py JOIN appointments a ON a.id = py.appointment_id LEFT JOIN patients p ON p.id = a.patient_id
      WHERE py.tenant_id = ? ORDER BY py.id DESC LIMIT ?`,
    tenantId,
    limit,
  );
}

export function appointmentCount(db: DB, tenantId: number) {
  return get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ?", tenantId)?.n ?? 0;
}
