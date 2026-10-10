import { describe, expect, it } from "vitest";
import { all, get, run } from "@/lib/db";
import { signWhatsAppBody, verifyWhatsAppSignature } from "@/messaging";
import { zonedToUtc, addDays } from "@/booking-engine";
import { availabilityDays, completeBooking, createHold, firstAvailable } from "@/clinic/booking";
import { runDueJobs } from "@/clinic/jobs";
import { handleWhatsAppInbound } from "@/clinic/whatsapp-inbound";
import { addToWaitlist } from "@/clinic/waitlist";
import { scoped } from "@/clinic/repo";
import { freshDemo, ids, NOW } from "./helpers";

const TZ = "Africa/Cairo";
const body = (payload: string, id = `wamid.${Math.random()}`) => ({ entry: [{ changes: [{ value: { messages: [{ id, from: "201000000000", type: "button", button: { payload, text: "x" } }] } }] }] });
const textBody = (from: string, text: string) => ({ entry: [{ changes: [{ value: { messages: [{ id: `wamid.${Math.random()}`, from, type: "text", text: { body: text } }] } }] }] });

/** Confirmed booking with Dr. Mariam on Tuesday 13 Oct (booked on Thursday 8 Oct). */
async function bookingOn(date = "2026-10-13") {
  const { db, tenant } = freshDemo();
  const I = ids(db, tenant.id);
  const q = { serviceId: I.service("checkup"), providerId: I.provider("mariam"), branchId: I.branch("nasr-city") };
  const slot = firstAvailable(availabilityDays(db, tenant, q, NOW).filter((d) => d.date === date))!;
  const hold = createHold(db, tenant, { ...q, start: slot.start, lang: "ar" }, NOW);
  const r = await completeBooking(db, tenant, hold.public_token, { name: "سارة إبراهيم", phone: "01256780000", method: "clinic", marketingConsent: false, lang: "ar" }, { origin: "http://x", donePath: "/book/done" }, NOW);
  return { db, tenant, appt: r.appointment, I };
}
const reminders = (db: ReturnType<typeof freshDemo>["db"], id: number) => all(db, "SELECT * FROM message_log WHERE appointment_id = ? AND template = 'reminder_day_before'", id).length;

describe("day-before reminder (time travel)", () => {
  it("fires at the clinic's reminder hour the day before, exactly once", async () => {
    const { db, appt } = await bookingOn("2026-10-13");
    const dayBefore = "2026-10-12";
    await runDueJobs(db, zonedToUtc(dayBefore, 17 * 60 + 59, TZ));
    expect(reminders(db, appt.id)).toBe(0);
    const r = await runDueJobs(db, zonedToUtc(dayBefore, 18 * 60, TZ));
    expect(r.dayReminders).toBeGreaterThanOrEqual(1);
    expect(reminders(db, appt.id)).toBe(1);
    const msg = get<{ body: string; buttons: string }>(db, "SELECT body, buttons FROM message_log WHERE appointment_id = ? AND template = 'reminder_day_before'", appt.id)!;
    expect(msg.body).toContain("بكرة");
    expect(JSON.parse(msg.buttons).map((b: { title: string }) => b.title)).toEqual(["تأكيد", "إلغاء"]);
    await runDueJobs(db, zonedToUtc(dayBefore, 20 * 60, TZ));
    expect(reminders(db, appt.id)).toBe(1);
  });

  it("optional 2-hour reminder", async () => {
    const { db, tenant, appt } = await bookingOn("2026-10-13");
    run(db, "UPDATE tenants SET reminder_2h_enabled = 1 WHERE id = ?", tenant.id);
    const r = await runDueJobs(db, new Date(Date.parse(appt.start_utc) - 119 * 60_000));
    expect(r.twoHourReminders).toBeGreaterThanOrEqual(1);
  });
});

describe("WhatsApp buttons", () => {
  it("verifies Meta's signature", () => {
    const raw = JSON.stringify(body("x"));
    expect(verifyWhatsAppSignature(raw, signWhatsAppBody(raw))).toBe(true);
    expect(verifyWhatsAppSignature(raw + " ", signWhatsAppBody(raw))).toBe(false);
    expect(verifyWhatsAppSignature(raw, null)).toBe(false);
  });

  it("تأكيد marks the appointment confirmed by the patient (once)", async () => {
    const { db, tenant, appt } = await bookingOn();
    const [r] = await handleWhatsAppInbound(db, body(`appt:${appt.public_token}:confirm`, "wamid.1"), NOW);
    expect(r!.action).toBe("confirmed");
    expect(scoped(db, tenant.id).appointment(appt.id)!.patient_confirmed_at).not.toBeNull();
    const [dup] = await handleWhatsAppInbound(db, body(`appt:${appt.public_token}:confirm`, "wamid.1"), NOW);
    expect(dup!.action).toBe("duplicate");
  });

  it("إلغاء cancels, frees the slot and offers it to the waiting list; first acceptance wins", async () => {
    const { db, tenant, appt, I } = await bookingOn();
    const actor = { userId: null, name: "test" };
    addToWaitlist(db, tenant, actor, { name: "عميل أول", phone: "01000000001", providerId: I.provider("mariam"), dateFrom: "2026-10-08", dateTo: "2026-10-20" });
    addToWaitlist(db, tenant, actor, { name: "عميل تاني", phone: "01000000002", dateFrom: "2026-10-08", dateTo: "2026-10-20" });
    const [r] = await handleWhatsAppInbound(db, body(`appt:${appt.public_token}:cancel`), NOW);
    expect(r!.action).toBe("cancelled");
    expect(scoped(db, tenant.id).appointment(appt.id)!.status).toBe("cancelled");
    const offers = all<{ token: string; name: string }>(
      db,
      `SELECT r.token, p.name FROM slot_offer_recipients r JOIN waitlist_entries w ON w.id = r.waitlist_entry_id JOIN patients p ON p.id = w.patient_id ORDER BY r.id`,
    );
    expect(offers.map((o) => o.name)).toEqual(expect.arrayContaining(["عميل أول", "عميل تاني"]));
    const offerMsgs = all(db, "SELECT 1 FROM message_log WHERE template = 'slot_opened_offer'");
    expect(offerMsgs.length).toBeGreaterThanOrEqual(2);

    const [second] = await handleWhatsAppInbound(db, body(`offer:${offers[1]!.token}:accept`), NOW);
    expect(second!.action).toBe("offer_booked");
    const [first] = await handleWhatsAppInbound(db, body(`offer:${offers[0]!.token}:accept`), NOW);
    expect(first!.action).toBe("offer_too_late");
    const booked = all(db, "SELECT 1 FROM appointments WHERE source = 'waitlist' AND start_utc = ? AND status = 'confirmed'", appt.start_utc);
    expect(booked).toHaveLength(1);
  });

  it("STOP opts the patient out; later messages are skipped and logged", async () => {
    const { db, tenant, appt } = await bookingOn("2026-10-13");
    const [r] = await handleWhatsAppInbound(db, textBody("201256780000", "STOP"), NOW);
    expect(r!.action).toBe("opted_out");
    await runDueJobs(db, zonedToUtc(addDays("2026-10-13", -1), 19 * 60, TZ));
    const m = get<{ status: string }>(db, "SELECT status FROM message_log WHERE appointment_id = ? AND template = 'reminder_day_before'", appt.id)!;
    expect(m.status).toBe("skipped_opt_out");
    expect(scoped(db, tenant.id).patient(appt.patient_id!)!.whatsapp_opt_out).toBe(1);
  });
});
