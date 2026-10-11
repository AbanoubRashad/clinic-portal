import { appointmentByPublicToken } from "@/clinic/repo";
import { apptView } from "@/clinic/notifications";
import { db } from "@/server/db";

const stamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/[,;]/g, (m) => `\\${m}`).replace(/\n/g, "\\n");

/** "أضف للتقويم": an .ics file for the confirmed appointment. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const d = db();
  const appt = appointmentByPublicToken(d, (await params).token);
  if (!appt || !["confirmed", "checked_in"].includes(appt.status)) return new Response("Not found", { status: 404 });
  const v = apptView(d, appt);
  const lang = appt.lang;
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//clinic-portal//booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${appt.ref}@${v.tenant.slug}`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(appt.start_utc)}`,
    `DTEND:${stamp(appt.end_utc)}`,
    `SUMMARY:${esc(`${lang === "ar" ? v.service.name_ar : v.service.name_en} – ${lang === "ar" ? v.provider.name_ar : v.provider.name_en}`)}`,
    `LOCATION:${esc(`${lang === "ar" ? v.tenant.name_ar : v.tenant.name_en}, ${lang === "ar" ? v.branch.address_ar : v.branch.address_en}`)}`,
    `DESCRIPTION:${esc(`${lang === "ar" ? "رقم الحجز" : "Booking ref"} ${appt.ref}`)}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    "DESCRIPTION:Reminder",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  return new Response(ics, {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="${appt.ref}.ics"`, "Cache-Control": "no-store" },
  });
}
