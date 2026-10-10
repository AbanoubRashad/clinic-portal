import { all, get, run, transaction, type DB } from "@/lib/db";
import { randomToken } from "@/lib/crypto";
import { isSlotTakenDbError, utcToZoned } from "@/booking-engine";
import { normalizeEgyptianMobile } from "@/lib/phone";
import { scoped } from "./repo";
import { upsertPatient } from "./patients";
import { notifyBookingConfirmed, notifyOfferTooLate, notifySlotOffer } from "./notifications";
import { audit, type Actor } from "./audit";
import { BookingError } from "./booking";
import { clinicEngine } from "./store";
import type { Appointment, Patient, Tenant } from "./types";

export interface WaitlistEntry {
  id: number;
  tenant_id: number;
  patient_id: number;
  provider_id: number | null;
  service_id: number | null;
  branch_id: number | null;
  date_from: string;
  date_to: string;
  weekdays: string | null;
  after_min: number | null;
  pref_note: string;
  status: "waiting" | "offered" | "booked" | "removed";
  created_at: string;
}

export function addToWaitlist(
  db: DB,
  tenant: Tenant,
  actor: Actor,
  input: {
    name: string;
    phone: string;
    providerId?: number | null;
    serviceId?: number | null;
    branchId?: number | null;
    dateFrom: string;
    dateTo: string;
    weekdays?: string | null;
    afterMin?: number | null;
    note?: string;
  },
) {
  const phone = normalizeEgyptianMobile(input.phone);
  if (!phone) throw new BookingError("INVALID_PHONE");
  const patient = upsertPatient(db, tenant.id, { name: input.name, phoneE164: phone, lang: "ar" });
  const { id } = run(
    db,
    `INSERT INTO waitlist_entries (tenant_id, patient_id, provider_id, service_id, branch_id, date_from, date_to, weekdays, after_min, pref_note)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    tenant.id,
    patient.id,
    input.providerId ?? null,
    input.serviceId ?? null,
    input.branchId ?? null,
    input.dateFrom,
    input.dateTo,
    input.weekdays ?? null,
    input.afterMin ?? null,
    input.note ?? "",
  );
  audit(db, tenant.id, actor, "waitlist.added", "waitlist_entry", id);
  return id;
}

export function activeWaitlist(db: DB, tenantId: number) {
  return all<WaitlistEntry & { name: string }>(
    db,
    `SELECT w.*, p.name FROM waitlist_entries w JOIN patients p ON p.id = w.patient_id
      WHERE w.tenant_id = ? AND w.status IN ('waiting','offered') ORDER BY w.created_at, w.id`,
    tenantId,
  );
}

function matches(e: WaitlistEntry, appt: Appointment, local: { date: string; minutes: number; weekday: number }) {
  if (e.provider_id && e.provider_id !== appt.provider_id) return false;
  if (e.branch_id && e.branch_id !== appt.branch_id) return false;
  if (local.date < e.date_from || local.date > e.date_to) return false;
  if (e.weekdays && !e.weekdays.split(",").map(Number).includes(local.weekday)) return false;
  if (e.after_min != null && local.minutes < e.after_min) return false;
  return true;
}

/** Is the cancelled appointment's time still free (no active booking now overlapping it)? */
export function slotStillOpen(db: DB, appt: Appointment, now: Date = new Date()): boolean {
  if (Date.parse(appt.start_utc) <= now.getTime()) return false;
  const clash = get(
    db,
    `SELECT 1 FROM appointments WHERE provider_id = ? AND id <> ?
        AND status IN ('held','pending_payment','confirmed','checked_in','completed')
        AND NOT (status IN ('held','pending_payment') AND hold_expires_at IS NOT NULL AND hold_expires_at <= ?)
        AND start_utc < ? AND block_end_utc > ?`,
    appt.provider_id,
    appt.id,
    now.toISOString(),
    appt.end_utc,
    appt.start_utc,
  );
  return !clash;
}

export function openOfferFor(db: DB, apptId: number) {
  return get<{ id: number; status: string; created_at: string }>(
    db,
    "SELECT id, status, created_at FROM slot_offers WHERE source_appointment_id = ? ORDER BY id DESC LIMIT 1",
    apptId,
  );
}

/** "Offer this slot to the waiting list": WhatsApp offers to matching entries in order; first to accept gets it. */
export async function offerSlot(db: DB, tenant: Tenant, apptId: number, actor: Actor, now: Date = new Date(), maxRecipients = 5) {
  const s = scoped(db, tenant.id);
  const appt = s.appointment(apptId);
  if (!appt || appt.status !== "cancelled") throw new BookingError("INVALID_STATE");
  if (!slotStillOpen(db, appt, now)) throw new BookingError("SLOT_TAKEN");
  const existing = openOfferFor(db, apptId);
  if (existing?.status === "open") return { offerId: existing.id, sent: 0, already: true };

  const local = utcToZoned(new Date(appt.start_utc), tenant.timezone);
  const candidates = all<WaitlistEntry>(db, "SELECT * FROM waitlist_entries WHERE tenant_id = ? AND status = 'waiting' ORDER BY created_at, id", tenant.id)
    .filter((e) => matches(e, appt, local))
    .slice(0, maxRecipients);

  const { offerId, recipients } = transaction(db, () => {
    const offerId = run(
      db,
      `INSERT INTO slot_offers (tenant_id, source_appointment_id, provider_id, branch_id, service_id, start_utc, end_utc, created_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      tenant.id,
      appt.id,
      appt.provider_id,
      appt.branch_id,
      appt.service_id,
      appt.start_utc,
      appt.end_utc,
      actor.userId,
    ).id;
    const recipients = candidates.map((e) => {
      const token = randomToken();
      run(db, "INSERT INTO slot_offer_recipients (offer_id, waitlist_entry_id, token) VALUES (?,?,?)", offerId, e.id, token);
      run(db, "UPDATE waitlist_entries SET status = 'offered' WHERE id = ?", e.id);
      return { entry: e, token };
    });
    audit(db, tenant.id, actor, "waitlist.offer_sent", "appointment", appt.id, { offerId, recipients: recipients.length });
    return { offerId, recipients };
  });

  for (const r of recipients) {
    const patient = s.patient(r.entry.patient_id)!;
    await notifySlotOffer(db, appt, patient, r.token, now);
  }
  return { offerId, sent: recipients.length, already: false };
}

/** A waitlisted patient tapped "احجزه". Exactly one acceptance can win (offer row + DB overlap trigger). */
export async function acceptOffer(db: DB, recipientToken: string, now: Date = new Date()) {
  const rec = get<{ id: number; offer_id: number; waitlist_entry_id: number; status: string }>(
    db,
    "SELECT * FROM slot_offer_recipients WHERE token = ?",
    recipientToken,
  );
  if (!rec || rec.status !== "sent") return { result: "invalid" as const };
  const offer = get<{ id: number; tenant_id: number; source_appointment_id: number; status: string; start_utc: string }>(
    db,
    "SELECT * FROM slot_offers WHERE id = ?",
    rec.offer_id,
  )!;
  const s = scoped(db, offer.tenant_id);
  const entry = get<WaitlistEntry>(db, "SELECT * FROM waitlist_entries WHERE id = ?", rec.waitlist_entry_id)!;
  const patient = s.patient(entry.patient_id)!;
  const source = s.appointment(offer.source_appointment_id)!;

  const tooLate = async () => {
    run(db, "UPDATE slot_offer_recipients SET status = 'too_late', responded_at = ? WHERE id = ?", now.toISOString(), rec.id);
    run(db, "UPDATE waitlist_entries SET status = 'waiting' WHERE id = ? AND status = 'offered'", entry.id);
    await notifyOfferTooLate(db, source, patient);
    return { result: "too_late" as const };
  };
  if (offer.status !== "open" || Date.parse(offer.start_utc) <= now.getTime()) return tooLate();

  const serviceId = entry.service_id ?? source.service_id;
  const service = s.service(serviceId) ?? s.service(source.service_id)!;
  const start = Date.parse(source.start_utc);
  const end = new Date(start + service.duration_min * 60_000);
  const blockEnd = new Date(end.getTime() + service.buffer_min * 60_000);

  let newAppt: Appointment;
  try {
    newAppt = transaction(db, () => {
      clinicEngine(db).expireHolds(now);
      const fresh = get<{ status: string }>(db, "SELECT status FROM slot_offers WHERE id = ?", offer.id)!;
      if (fresh.status !== "open") throw new Error("SLOT_TAKEN");
      const token = randomToken();
      const tenant = get<{ ref_prefix: string }>(db, "SELECT ref_prefix FROM tenants WHERE id = ?", offer.tenant_id)!;
      const { id } = run(
        db,
        `INSERT INTO appointments (tenant_id, ref, public_token, branch_id, provider_id, service_id, patient_id, start_utc, end_utc, block_end_utc,
                                   status, source, pay_method, lang)
         VALUES (?,?,?,?,?,?,?,?,?,?, 'confirmed', 'waitlist', 'clinic', ?)`,
        offer.tenant_id,
        `tmp_${token}`,
        token,
        source.branch_id,
        source.provider_id,
        service.id,
        patient.id,
        source.start_utc,
        end.toISOString(),
        blockEnd.toISOString(),
        patient.lang,
      );
      run(db, "UPDATE appointments SET ref = ? WHERE id = ?", `${tenant.ref_prefix}-${20000 + id}`, id);
      run(db, "UPDATE slot_offers SET status = 'taken', taken_by_appointment_id = ? WHERE id = ?", id, offer.id);
      run(db, "UPDATE slot_offer_recipients SET status = 'accepted', responded_at = ? WHERE id = ?", now.toISOString(), rec.id);
      run(db, "UPDATE waitlist_entries SET status = 'booked' WHERE id = ?", entry.id);
      // Everyone else who got this offer goes back to waiting.
      run(
        db,
        `UPDATE waitlist_entries SET status = 'waiting'
          WHERE status = 'offered' AND id IN (SELECT waitlist_entry_id FROM slot_offer_recipients WHERE offer_id = ? AND id <> ?)`,
        offer.id,
        rec.id,
      );
      audit(db, offer.tenant_id, { userId: null, name: "patient:whatsapp" }, "waitlist.offer_accepted", "appointment", id, { offerId: offer.id });
      return s.appointment(id)!;
    });
  } catch (err) {
    if (isSlotTakenDbError(err)) return tooLate();
    throw err;
  }
  await notifyBookingConfirmed(db, newAppt);
  return { result: "booked" as const, appointment: newAppt };
}

export function removeFromWaitlist(db: DB, tenant: Tenant, actor: Actor, entryId: number) {
  run(db, "UPDATE waitlist_entries SET status = 'removed' WHERE tenant_id = ? AND id = ?", tenant.id, entryId);
  audit(db, tenant.id, actor, "waitlist.removed", "waitlist_entry", entryId);
}

export function patientsForOffer(db: DB, offerId: number) {
  return all<{ token: string; status: string; name: string; patient: Patient }>(
    db,
    `SELECT r.token, r.status, p.name FROM slot_offer_recipients r
       JOIN waitlist_entries w ON w.id = r.waitlist_entry_id JOIN patients p ON p.id = w.patient_id
      WHERE r.offer_id = ? ORDER BY r.id`,
    offerId,
  );
}
