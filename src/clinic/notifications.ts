// Patient messages. Each template mirrors a pre-approved WhatsApp template (same name, same
// ordered variables); `body` is the rendered text kept in MessageLog and used for email fallback.
import type { DB } from "@/lib/db";
import { sendMessage, type QuickReply, type SendResult } from "@/messaging";
import { addDays, utcToZoned } from "@/booking-engine/time";
import { fmtDateLong, fmtMoney, fmtTime, relativeDay } from "@/i18n/format";
import { scoped, tenantById } from "./repo";
import { patientPhone } from "./patients";
import { L, type Appointment, type Lang, type Patient } from "./types";

export function apptView(db: DB, appt: Appointment) {
  const tenant = tenantById(db, appt.tenant_id)!;
  const s = scoped(db, tenant.id);
  const service = s.service(appt.service_id)!;
  const provider = s.provider(appt.provider_id)!;
  const branch = s.branch(appt.branch_id)!;
  const patient = appt.patient_id ? s.patient(appt.patient_id) : undefined;
  const local = utcToZoned(new Date(appt.start_utc), tenant.timezone);
  return { tenant, service, provider, branch, patient, local };
}

const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? n;

function buildContext(db: DB, appt: Appointment, lang: Lang, now: Date) {
  const v = apptView(db, appt);
  const today = utcToZoned(now, v.tenant.timezone).date;
  return {
    v,
    name: v.patient ? firstName(v.patient.name) : "",
    clinic: L(v.tenant, "name", lang),
    service: L(v.service, "name", lang),
    doctor: L(v.provider, "name", lang),
    branch: lang === "ar" ? `فرع ${L(v.branch, "district", lang)}` : `${L(v.branch, "district", lang)} branch`,
    date: fmtDateLong(v.local.date, lang, false),
    time: fmtTime(v.local.minutes, lang),
    rel: relativeDay(v.local.date, today, lang),
    isTomorrow: v.local.date === addDays(today, 1),
  };
}

export type TemplateName =
  | "booking_confirmation"
  | "reminder_day_before"
  | "reminder_2h"
  | "cancellation_confirmation"
  | "slot_opened_offer"
  | "offer_too_late";

export function renderTemplate(
  name: TemplateName,
  lang: Lang,
  c: ReturnType<typeof buildContext>,
  extra: { ref?: string; depositLine?: string } = {},
): { params: string[]; body: string } {
  const ar = lang === "ar";
  switch (name) {
    case "booking_confirmation":
      return {
        params: [c.name, c.clinic, c.service, c.doctor, c.date, c.time, c.branch, extra.ref ?? ""],
        body: ar
          ? `أهلًا ${c.name}، تم تأكيد حجزك في ${c.clinic}: ${c.service} مع ${c.doctor} يوم ${c.date} الساعة ${c.time}، ${c.branch}. رقم الحجز ${extra.ref}. هنفكّرك قبلها بيوم.`
          : `Hi ${c.name}, your booking at ${c.clinic} is confirmed: ${c.service} with ${c.doctor} on ${c.date} at ${c.time}, ${c.branch}. Booking ref ${extra.ref}. We'll remind you the day before.`,
      };
    case "reminder_day_before":
      return {
        params: [c.name, c.time, c.doctor, c.clinic, c.branch],
        body: ar
          ? `أهلًا ${c.name}، تذكير بموعدك ${c.isTomorrow ? "بكرة" : c.date} الساعة ${c.time} مع ${c.doctor} في ${c.clinic}، ${c.branch}.`
          : `Hi ${c.name}, a reminder of your appointment ${c.isTomorrow ? "tomorrow" : c.date} at ${c.time} with ${c.doctor} at ${c.clinic}, ${c.branch}.`,
      };
    case "reminder_2h":
      return {
        params: [c.name, c.time, c.doctor, c.clinic, c.branch],
        body: ar
          ? `أهلًا ${c.name}، موعدك النهارده الساعة ${c.time} مع ${c.doctor} في ${c.clinic}، ${c.branch}. في انتظارك!`
          : `Hi ${c.name}, your appointment is today at ${c.time} with ${c.doctor} at ${c.clinic}, ${c.branch}. See you soon!`,
      };
    case "cancellation_confirmation":
      return {
        params: [c.name, c.date, c.time, c.doctor, extra.depositLine ?? ""],
        body: ar
          ? `أهلًا ${c.name}، تم إلغاء موعدك يوم ${c.date} الساعة ${c.time} مع ${c.doctor}. ${extra.depositLine ?? ""}`.trim()
          : `Hi ${c.name}, your appointment on ${c.date} at ${c.time} with ${c.doctor} has been cancelled. ${extra.depositLine ?? ""}`.trim(),
      };
    case "slot_opened_offer":
      return {
        params: [c.name, c.rel, c.time, c.doctor, c.clinic, c.branch],
        body: ar
          ? `أهلًا ${c.name}، فيه موعد اتفتح ${c.rel} الساعة ${c.time} مع ${c.doctor} في ${c.clinic}، ${c.branch}. لو يناسبك اضغط «احجزه»، وأول واحد يأكّد بياخده.`
          : `Hi ${c.name}, a slot just opened ${c.rel} at ${c.time} with ${c.doctor} at ${c.clinic}, ${c.branch}. Tap "Book it" if it suits you: first to confirm gets it.`,
      };
    case "offer_too_late":
      return {
        params: [c.name],
        body: ar
          ? `أهلًا ${c.name}، للأسف الموعد اتحجز قبل ردك. لسه في قائمة الانتظار وهنبلغك بأي موعد جديد.`
          : `Hi ${c.name}, sorry, that slot was taken before your reply. You're still on the waiting list and we'll message you about the next one.`,
      };
  }
}

export const BUTTONS = {
  reminder: (token: string, lang: Lang): QuickReply[] => [
    { id: `appt:${token}:confirm`, title: lang === "ar" ? "تأكيد" : "Confirm" },
    { id: `appt:${token}:cancel`, title: lang === "ar" ? "إلغاء" : "Cancel" },
  ],
  offer: (token: string, lang: Lang): QuickReply[] => [{ id: `offer:${token}:accept`, title: lang === "ar" ? "احجزه" : "Book it" }],
};

async function sendToPatient(
  db: DB,
  appt: Appointment,
  patient: Patient,
  template: TemplateName,
  opts: { now?: Date; buttons?: QuickReply[]; extra?: { ref?: string; depositLine?: string } } = {},
): Promise<SendResult> {
  const lang = patient.lang;
  const ctx = buildContext(db, { ...appt }, lang, opts.now ?? new Date());
  const { params, body } = renderTemplate(template, lang, { ...ctx, name: firstName(patient.name) }, opts.extra);
  return sendMessage(db, {
    tenantId: appt.tenant_id,
    template,
    lang,
    to: patientPhone(patient),
    email: patient.email,
    params,
    body,
    buttons: opts.buttons,
    optedOut: Boolean(patient.whatsapp_opt_out),
    appointmentId: appt.id,
    patientId: patient.id,
    phoneNumberId: ctx.v.tenant.whatsapp_phone_number_id,
  });
}

export async function notifyBookingConfirmed(db: DB, appt: Appointment) {
  const p = appt.patient_id ? scoped(db, appt.tenant_id).patient(appt.patient_id) : undefined;
  if (p) return sendToPatient(db, appt, p, "booking_confirmation", { extra: { ref: appt.ref } });
}

export async function notifyReminder(db: DB, appt: Appointment, kind: "day" | "2h", now: Date) {
  const p = appt.patient_id ? scoped(db, appt.tenant_id).patient(appt.patient_id) : undefined;
  if (!p) return;
  return sendToPatient(db, appt, p, kind === "day" ? "reminder_day_before" : "reminder_2h", {
    now,
    buttons: kind === "day" ? BUTTONS.reminder(appt.public_token, p.lang) : undefined,
  });
}

export async function notifyCancelled(db: DB, appt: Appointment, deposit: "refund" | "forfeit" | "none", windowHours: number) {
  const p = appt.patient_id ? scoped(db, appt.tenant_id).patient(appt.patient_id) : undefined;
  if (!p) return;
  const ar = p.lang === "ar";
  const amount = fmtMoney(appt.deposit_amount, p.lang);
  const depositLine =
    deposit === "refund"
      ? ar
        ? `هيتم رد العربون ${amount} خلال ٥–٧ أيام عمل.`
        : `Your ${amount} deposit will be refunded within 5–7 working days.`
      : deposit === "forfeit"
        ? ar
          ? `العربون غير قابل للاسترداد لأن الإلغاء كان قبل الموعد بأقل من ${windowHours} ساعة.`
          : `The deposit is non-refundable because the cancellation was less than ${windowHours} hours before the appointment.`
        : "";
  return sendToPatient(db, appt, p, "cancellation_confirmation", { extra: { depositLine } });
}

export async function notifySlotOffer(db: DB, slotAppt: Appointment, patient: Patient, recipientToken: string, now: Date) {
  return sendToPatient(db, slotAppt, patient, "slot_opened_offer", { now, buttons: BUTTONS.offer(recipientToken, patient.lang) });
}

export async function notifyOfferTooLate(db: DB, slotAppt: Appointment, patient: Patient) {
  return sendToPatient(db, slotAppt, patient, "offer_too_late");
}

/** Text preview of the day-before reminder, shown on the booking confirmation screen. */
export function reminderPreview(db: DB, appt: Appointment, patientName: string, lang: Lang) {
  const ctx = buildContext(db, appt, lang, new Date(Date.parse(appt.start_utc) - 86_400_000));
  return renderTemplate("reminder_day_before", lang, { ...ctx, name: firstName(patientName), isTomorrow: true }).body;
}
