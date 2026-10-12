"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomToken } from "@/lib/crypto";
import { signWhatsAppBody, verifyWhatsAppSignature } from "@/messaging";
import { BookingError } from "@/clinic/booking";
import { addToWaitlist, offerSlot, removeFromWaitlist } from "@/clinic/waitlist";
import { addWalkIn, checkIn, createReceptionBooking, markCompleted, markNoShow, receptionCancel, reschedule, setWalkInStatus } from "@/clinic/reception";
import { handleWhatsAppInbound } from "@/clinic/whatsapp-inbound";
import {
  addTimeOff,
  addWorkingHours,
  deleteRow,
  insertRow,
  removeTimeOff,
  removeWorkingHours,
  setContent,
  setProviderServices,
  slugify,
  updateRow,
  ValidationError,
  type AdminTable,
} from "@/clinic/admin";
import { zonedToUtc } from "@/booking-engine";
import type { Role } from "@/clinic/types";
import { db } from "@/server/db";
import { requireStaff } from "@/server/session";

const DESK: Role[] = ["owner", "receptionist"];
const OWNER: Role[] = ["owner"];

const ERRORS: Record<string, string> = {
  SLOT_TAKEN: "الموعد ده اتحجز بالفعل.",
  SLOT_UNAVAILABLE: "الوقت ده مش متاح.",
  INVALID_STATE: "الإجراء ده مش متاح لحالة الموعد الحالية.",
  INVALID_PHONE: "رقم الموبايل غير صحيح.",
  INVALID_NAME: "اكتب الاسم بالكامل.",
  NOT_FOUND: "مش لاقيين الموعد.",
  HOLD_EXPIRED: "انتهت مدة التثبيت.",
};

function backTo(form: FormData) {
  const b = String(form.get("back") ?? "/dashboard");
  return b.startsWith("/dashboard") && !b.startsWith("//") ? b : "/dashboard";
}

function withFlash(url: string, key: "ok" | "err", msg: string) {
  const u = new URL(url, "http://x");
  u.searchParams.delete("ok");
  u.searchParams.delete("err");
  u.searchParams.set(key, msg);
  return `${u.pathname}${u.search}${u.hash}`;
}

/** Runs an action, then redirects back with a flash message. redirect() is called outside try/catch on purpose. */
async function act(form: FormData, roles: Role[], fn: (ctx: Awaited<ReturnType<typeof requireStaff>>) => Promise<string | void> | string | void) {
  const ctx = await requireStaff(roles);
  let flash: ["ok" | "err", string];
  try {
    flash = ["ok", (await fn(ctx)) || "تم الحفظ"];
  } catch (err) {
    if (err instanceof BookingError) flash = ["err", ERRORS[err.code] ?? err.code];
    else if (err instanceof ValidationError) flash = ["err", err.message];
    else {
      console.error(err);
      flash = ["err", "حصلت مشكلة غير متوقعة."];
    }
  }
  revalidatePath("/dashboard", "layout");
  redirect(withFlash(backTo(form), flash[0], flash[1]));
}

const id = (form: FormData, key = "id") => Number(form.get(key));
const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const optInt = (form: FormData, key: string) => (str(form, key) ? Number(str(form, key)) : null);

// ---------- reception ----------
export async function checkInAction(form: FormData) {
  await act(form, DESK, ({ tenant, actor }) => (checkIn(db(), tenant, actor, id(form)), "تم تسجيل الوصول"));
}
export async function completeAction(form: FormData) {
  await act(form, DESK, ({ tenant, actor }) => (markCompleted(db(), tenant, actor, id(form)), "تم إنهاء الزيارة"));
}
export async function noShowAction(form: FormData) {
  await act(form, DESK, ({ tenant, actor }) => (markNoShow(db(), tenant, actor, id(form)), "تم تسجيله «لم يحضر»"));
}
export async function cancelAction(form: FormData) {
  await act(form, DESK, async ({ tenant, actor }) => {
    const r = await receptionCancel(db(), tenant, actor, id(form), str(form, "reason") || "clinic");
    return r.policy === "refund" ? "تم الإلغاء وهيتم رد العربون" : r.policy === "forfeit" ? "تم الإلغاء (العربون غير مسترد حسب السياسة)" : "تم الإلغاء";
  });
}
export async function rescheduleAction(form: FormData) {
  await act(form, DESK, async ({ tenant, actor }) => {
    await reschedule(db(), tenant, actor, id(form), str(form, "start"));
    return "تم تغيير الموعد وإبلاغ المريض";
  });
}
export async function offerAction(form: FormData) {
  await act(form, DESK, async ({ tenant, actor }) => {
    const r = await offerSlot(db(), tenant, id(form), actor);
    if (r.already) return "الموعد معروض بالفعل على قائمة الانتظار";
    return r.sent ? `تم إرسال العرض على واتساب لـ ${r.sent} من قائمة الانتظار — أول واحد يأكد بياخده` : "مفيش حد في قائمة الانتظار يناسبه الموعد ده";
  });
}

/**
 * Demo / local only: simulates the patient tapping a WhatsApp quick-reply button by sending a
 * signed Cloud-API-shaped webhook body through the same verification and handler as production.
 */
export async function simulateReplyAction(form: FormData) {
  await act(form, DESK, async () => {
    if (process.env.WHATSAPP_TOKEN) throw new ValidationError("المحاكاة متاحة بس في وضع التجربة");
    const payload = str(form, "payload");
    const raw = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { messages: [{ id: `wamid.sim.${randomToken(8)}`, from: "201000000000", type: "button", button: { payload, text: str(form, "title") } }] } }] }],
    });
    if (!verifyWhatsAppSignature(raw, signWhatsAppBody(raw))) throw new Error("signature");
    const [r] = await handleWhatsAppInbound(db(), JSON.parse(raw));
    const labels: Record<string, string> = {
      confirmed: "المريض أكّد الموعد ✓",
      cancelled: "المريض ألغى — الموعد اتعرض على قائمة الانتظار",
      offer_booked: "اتحجز الموعد من قائمة الانتظار",
      offer_too_late: "الموعد كان اتحجز قبل الرد",
      ignored_state: "الرد ماغيّرش حاجة (حالة الموعد مختلفة)",
      duplicate: "الرد ده اتسجل قبل كده",
    };
    return labels[r?.action ?? ""] ?? `تم: ${r?.action}`;
  });
}

export async function addWalkInAction(form: FormData) {
  await act(form, DESK, ({ tenant, actor }) => (addWalkIn(db(), tenant, actor, id(form, "branch"), str(form, "name"), str(form, "note")), "تمت إضافة الحالة"));
}
export async function walkInStatusAction(form: FormData) {
  await act(form, DESK, ({ tenant, actor }) => setWalkInStatus(db(), tenant, actor, id(form), str(form, "status") === "left" ? "left" : "seen"));
}

export async function addWaitlistAction(form: FormData) {
  await act(form, DESK, ({ tenant, actor }) => {
    const weekdays = form.getAll("weekday").map(String).filter(Boolean).join(",") || null;
    const after = str(form, "after");
    addToWaitlist(db(), tenant, actor, {
      name: str(form, "name"),
      phone: str(form, "phone"),
      providerId: optInt(form, "provider"),
      serviceId: optInt(form, "service"),
      branchId: optInt(form, "branch"),
      dateFrom: str(form, "from"),
      dateTo: str(form, "to"),
      weekdays,
      afterMin: after ? Number(after.split(":")[0]) * 60 + Number(after.split(":")[1] ?? 0) : null,
      note: str(form, "note"),
    });
    return "تمت الإضافة لقائمة الانتظار";
  });
}
export async function removeWaitlistAction(form: FormData) {
  await act(form, DESK, ({ tenant, actor }) => (removeFromWaitlist(db(), tenant, actor, id(form)), "تم الحذف من قائمة الانتظار"));
}

export async function receptionBookingAction(form: FormData) {
  await act(form, DESK, async ({ tenant, actor }) => {
    const appt = await createReceptionBooking(db(), tenant, actor, {
      name: str(form, "name"),
      phone: str(form, "phone"),
      serviceId: id(form, "service"),
      providerId: id(form, "provider"),
      branchId: id(form, "branch"),
      start: str(form, "start"),
      walkIn: form.get("walkin") === "1",
      notes: str(form, "notes"),
    });
    return `تم الحجز ${appt.ref} وإرسال التأكيد على واتساب`;
  });
}

// ---------- schedules (owner + reception) ----------
export async function addHoursAction(form: FormData) {
  await act(form, DESK, ({ tenant, actor }) =>
    addWorkingHours(db(), tenant.id, actor, id(form, "provider"), id(form, "branch"), id(form, "weekday"), str(form, "start"), str(form, "end")),
  );
}
export async function removeHoursAction(form: FormData) {
  await act(form, DESK, ({ tenant, actor }) => removeWorkingHours(db(), tenant.id, actor, id(form)));
}
export async function addTimeOffAction(form: FormData) {
  await act(form, DESK, ({ tenant, actor }) => {
    const from = str(form, "from");
    const to = str(form, "to") || from;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new ValidationError("اختار التاريخ");
    const toTime = (d: string, t: string) => {
      const [h, m] = (t || "00:00").split(":").map(Number) as [number, number];
      return zonedToUtc(d, h * 60 + m, tenant.timezone).toISOString();
    };
    addTimeOff(db(), tenant.id, actor, {
      providerId: optInt(form, "provider"),
      startsAt: toTime(from, str(form, "fromTime") || "00:00"),
      endsAt: str(form, "toTime") ? toTime(to, str(form, "toTime")) : toTime(to, "24:00"),
      reason: str(form, "reason"),
    });
    return "تمت إضافة الإجازة — المواعيد دي اتقفلت للحجز";
  });
}
export async function removeTimeOffAction(form: FormData) {
  await act(form, DESK, ({ tenant, actor }) => removeTimeOff(db(), tenant.id, actor, id(form)));
}

// ---------- owner admin ----------
const EDITABLE: AdminTable[] = ["tenants", "services", "providers", "branches", "reviews", "gallery_cases"];

export async function updateRowAction(form: FormData) {
  await act(form, OWNER, ({ tenant, actor }) => {
    const table = str(form, "table") as AdminTable;
    if (!EDITABLE.includes(table)) throw new ValidationError("جدول غير معروف");
    updateRow(db(), tenant.id, actor, table, id(form), form);
  });
}

export async function insertRowAction(form: FormData) {
  await act(form, OWNER, ({ tenant, actor }) => {
    const table = str(form, "table") as Exclude<AdminTable, "tenants">;
    if (!EDITABLE.includes(table) || (table as string) === "tenants") throw new ValidationError("جدول غير معروف");
    const extra: Record<string, string> = table === "services" || table === "providers" || table === "branches" ? { slug: slugify(str(form, "name_en")) } : {};
    insertRow(db(), tenant.id, actor, table, form, extra);
    return "تمت الإضافة";
  });
}

export async function deleteRowAction(form: FormData) {
  await act(form, OWNER, ({ tenant, actor }) => {
    const table = str(form, "table");
    if (table !== "reviews" && table !== "gallery_cases") throw new ValidationError("غير مسموح");
    deleteRow(db(), tenant.id, actor, table, id(form));
    return "تم الحذف";
  });
}

export async function providerServicesAction(form: FormData) {
  await act(form, OWNER, ({ tenant, actor }) => setProviderServices(db(), tenant.id, actor, id(form), form.getAll("service").map(Number)));
}

export async function contentAction(form: FormData) {
  await act(form, OWNER, ({ tenant, actor }) => {
    for (const key of form.getAll("key").map(String)) setContent(db(), tenant.id, actor, key, str(form, `${key}_ar`), str(form, `${key}_en`));
  });
}
