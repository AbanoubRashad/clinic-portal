import { describe, expect, it } from "vitest";
import { Worker } from "node:worker_threads";
import path from "node:path";
import { all, run } from "@/lib/db";
import { normalizeEgyptianMobile } from "@/lib/phone";
import { availabilityDays, completeBooking, createHold, firstAvailable, releaseHold } from "@/clinic/booking";
import { clinicEngine } from "@/clinic/store";
import { scoped } from "@/clinic/repo";
import { patientPhone } from "@/clinic/patients";
import { freshDemo, ids, NOW } from "./helpers";

function firstFreeSlot(db: ReturnType<typeof freshDemo>["db"], tenant: ReturnType<typeof freshDemo>["tenant"], provider = "mariam", service = "checkup") {
  const I = ids(db, tenant.id);
  const q = { serviceId: I.service(service), providerId: I.provider(provider), branchId: I.branch("nasr-city") };
  const slot = firstAvailable(availabilityDays(db, tenant, q, NOW))!;
  return { q, slot };
}

describe("phone numbers", () => {
  it.each([
    ["01012345678", "+201012345678"],
    ["+20 101 234 5678", "+201012345678"],
    ["00201512345678", "+201512345678"],
    ["٠١١٢٣٤٥٦٧٨٩", "+201123456789"],
    ["0127-123-4567", "+201271234567"],
  ])("normalises %s", (input, out) => expect(normalizeEgyptianMobile(input)).toBe(out));
  it.each(["0101234567", "01312345678", "0201012345678", "hello", "+44 7700 900123"])("rejects %s", (input) => expect(normalizeEgyptianMobile(input)).toBeNull());
});

describe("holds and double booking", () => {
  it("a held slot shows as taken and frees again when the hold expires", () => {
    const { db, tenant } = freshDemo();
    const { q, slot } = firstFreeSlot(db, tenant);
    const hold = createHold(db, tenant, { ...q, start: slot.start, lang: "ar" }, NOW);
    expect(hold.status).toBe("held");
    const taken = () => availabilityDays(db, tenant, q, NOW).flatMap((d) => d.slots).find((s) => s.start === slot.start)!.available === false;
    expect(taken()).toBe(true);
    expect(() => createHold(db, tenant, { ...q, start: slot.start, lang: "ar" }, NOW)).toThrow(/SLOT_TAKEN/);
    const expired = clinicEngine(db).expireHolds(new Date(NOW.getTime() + 11 * 60_000));
    expect(expired).toBe(1);
    expect(taken()).toBe(false);
  });

  it("releasing a hold frees the slot immediately", () => {
    const { db, tenant } = freshDemo();
    const { q, slot } = firstFreeSlot(db, tenant);
    const hold = createHold(db, tenant, { ...q, start: slot.start, lang: "ar" }, NOW);
    releaseHold(db, tenant, hold.public_token, NOW);
    expect(createHold(db, tenant, { ...q, start: slot.start, lang: "ar" }, NOW).status).toBe("held");
  });

  it("rejects a start time that is not a generated slot", () => {
    const { db, tenant } = freshDemo();
    const { q, slot } = firstFreeSlot(db, tenant);
    const odd = new Date(Date.parse(slot.start) + 7 * 60_000).toISOString();
    expect(() => createHold(db, tenant, { ...q, start: odd, lang: "ar" }, NOW)).toThrow(/SLOT_UNAVAILABLE/);
  });

  it("the database itself refuses overlapping rows, whatever code path writes them", () => {
    const { db, tenant } = freshDemo();
    const existing = all<{ provider_id: number; branch_id: number; service_id: number; start_utc: string; end_utc: string; block_end_utc: string }>(
      db,
      "SELECT * FROM appointments WHERE tenant_id = ? AND status = 'confirmed' LIMIT 1",
      tenant.id,
    )[0]!;
    expect(() =>
      run(
        db,
        `INSERT INTO appointments (tenant_id, ref, public_token, branch_id, provider_id, service_id, start_utc, end_utc, block_end_utc, status, source)
         VALUES (?, 'x1', 'tok-x1', ?, ?, ?, ?, ?, ?, 'confirmed', 'reception')`,
        tenant.id,
        existing.branch_id,
        existing.provider_id,
        existing.service_id,
        new Date(Date.parse(existing.start_utc) + 10 * 60_000).toISOString(),
        new Date(Date.parse(existing.end_utc) + 10 * 60_000).toISOString(),
        new Date(Date.parse(existing.block_end_utc) + 10 * 60_000).toISOString(),
      ),
    ).toThrow(/SLOT_TAKEN/);
  });

  it("20 parallel requests for the same slot: exactly one wins", async () => {
    const { db, tenant, file } = freshDemo();
    const { q, slot } = firstFreeSlot(db, tenant);
    db.close();
    const startAt = Date.now() + 2500;
    const results = await Promise.all(
      Array.from(
        { length: 20 },
        () =>
          new Promise<{ ok: boolean; code?: string }>((resolve, reject) => {
            const w = new Worker(path.join(__dirname, "hold-worker.ts"), {
              execArgv: ["--import", "tsx"],
              workerData: { file, input: { ...q, start: slot.start }, now: NOW.toISOString(), startAt },
            });
            w.once("message", resolve);
            w.once("error", reject);
          }),
      ),
    );
    const winners = results.filter((r) => r.ok);
    expect(winners).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => r.code === "SLOT_TAKEN")).toBe(true);
  });
});

describe("booking completion", () => {
  it("pay at clinic confirms immediately and stores the phone encrypted", async () => {
    const { db, tenant } = freshDemo();
    const { q, slot } = firstFreeSlot(db, tenant);
    const hold = createHold(db, tenant, { ...q, start: slot.start, lang: "ar" }, NOW);
    const r = await completeBooking(db, tenant, hold.public_token, { name: "منى خالد", phone: "01099988877", method: "clinic", marketingConsent: false, lang: "ar" }, { origin: "http://x", donePath: "/book/done" }, NOW);
    expect(r.kind).toBe("confirmed");
    const p = scoped(db, tenant.id).patient(r.appointment.patient_id!)!;
    expect(p.phone_enc).not.toContain("1099988877");
    expect(patientPhone(p)).toBe("+201099988877");
    const msgs = all<{ template: string }>(db, "SELECT template FROM message_log WHERE appointment_id = ?", r.appointment.id);
    expect(msgs.map((m) => m.template)).toContain("booking_confirmation");
  });

  it("invalid phone is rejected", async () => {
    const { db, tenant } = freshDemo();
    const { q, slot } = firstFreeSlot(db, tenant);
    const hold = createHold(db, tenant, { ...q, start: slot.start, lang: "ar" }, NOW);
    await expect(
      completeBooking(db, tenant, hold.public_token, { name: "منى خالد", phone: "12345", method: "clinic", marketingConsent: false, lang: "ar" }, { origin: "http://x", donePath: "/book/done" }, NOW),
    ).rejects.toThrow(/INVALID_PHONE/);
  });

  it("pay at clinic is refused when the clinic disabled it", async () => {
    const { db, tenant } = freshDemo();
    run(db, "UPDATE tenants SET allow_pay_at_clinic = 0 WHERE id = ?", tenant.id);
    const t2 = { ...tenant, allow_pay_at_clinic: 0 };
    const { q, slot } = firstFreeSlot(db, tenant);
    const hold = createHold(db, t2, { ...q, start: slot.start, lang: "ar" }, NOW);
    await expect(
      completeBooking(db, t2, hold.public_token, { name: "منى خالد", phone: "01012345678", method: "clinic", marketingConsent: false, lang: "ar" }, { origin: "http://x", donePath: "/book/done" }, NOW),
    ).rejects.toThrow(/METHOD_NOT_ALLOWED/);
  });
});

describe("tenant isolation", () => {
  it("tenant B cannot read or book tenant A's data", () => {
    const { db, tenant } = freshDemo();
    const b = run(db, "INSERT INTO tenants (slug, name_ar, name_en, short_name_ar, short_name_en, vertical) VALUES ('other','أخرى','Other','أ','O','derma')").id;
    const tenantB = { ...tenant, id: b, slug: "other" };
    const apptA = all<{ id: number; public_token: string }>(db, "SELECT id, public_token FROM appointments WHERE tenant_id = ? LIMIT 1", tenant.id)[0]!;
    const sB = scoped(db, b);
    expect(sB.appointment(apptA.id)).toBeUndefined();
    expect(sB.appointmentByToken(apptA.public_token)).toBeUndefined();
    expect(sB.providers()).toEqual([]);
    expect(sB.services()).toEqual([]);
    expect(sB.patient(1)).toBeUndefined();
    const { q, slot } = firstFreeSlot(db, tenant);
    expect(availabilityDays(db, tenantB, q, NOW)).toEqual([]);
    expect(() => createHold(db, tenantB, { ...q, start: slot.start, lang: "ar" }, NOW)).toThrow(/SLOT_UNAVAILABLE/);
  });
});
