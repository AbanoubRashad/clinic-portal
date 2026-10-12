// Owner admin: edit clinic content and settings without code. Every write is tenant-scoped,
// limited to whitelisted columns and audited.
import { get, run, transaction, type DB, type Param } from "@/lib/db";
import { audit, type Actor } from "./audit";

type Kind = "text" | "int" | "num" | "bool" | "color" | "nullable_text" | "nullable_int";

const TABLES = {
  tenants: {
    name_ar: "text", name_en: "text", short_name_ar: "text", short_name_en: "text", tagline_ar: "text", tagline_en: "text",
    primary_color: "color", phone: "nullable_text", whatsapp: "nullable_text", email: "nullable_text", custom_domain: "nullable_text",
    google_rating: "num", google_reviews_count: "nullable_int", google_reviews_url: "nullable_text", years_experience: "nullable_int",
    deposit_amount: "int", allow_pay_at_clinic: "bool", allow_kiosk: "bool", cancellation_window_hours: "int", min_notice_minutes: "int",
    slot_step_minutes: "int", booking_horizon_days: "int", hold_minutes: "int", reminder_hour: "int", reminder_2h_enabled: "bool",
    whatsapp_phone_number_id: "nullable_text",
  },
  services: {
    name_ar: "text", name_en: "text", desc_ar: "text", desc_en: "text", duration_min: "int", buffer_min: "int", price_egp: "int",
    price_is_from: "bool", deposit_egp: "nullable_int", active: "bool", show_on_landing: "bool", sort: "int",
  },
  providers: {
    name_ar: "text", name_en: "text", short_ar: "text", short_en: "text", title_ar: "text", title_en: "text", specialty_ar: "text",
    specialty_en: "text", photo_url: "nullable_text", rating: "num", years_experience: "nullable_int", active: "bool", sort: "int",
  },
  branches: {
    name_ar: "text", name_en: "text", district_ar: "text", district_en: "text", address_ar: "text", address_en: "text",
    lat: "num", lng: "num", google_place_id: "nullable_text", phone: "nullable_text", sort: "int",
  },
  reviews: { author: "text", author_en: "text", text: "text", translation_en: "nullable_text", rating: "int", published_on: "text", sort: "int" },
  gallery_cases: {
    title_ar: "text", title_en: "text", caption_ar: "text", caption_en: "text", image_url: "text", alt_ar: "text", alt_en: "text",
    patient_consent: "bool", sort: "int",
  },
} as const satisfies Record<string, Record<string, Kind>>;

export type AdminTable = keyof typeof TABLES;

export class ValidationError extends Error {}

function coerce(kind: Kind, raw: FormDataEntryValue | null, field: string): Param {
  const v = typeof raw === "string" ? raw.trim() : "";
  switch (kind) {
    case "bool":
      return raw === "on" || raw === "1" || raw === "true" ? 1 : 0;
    case "int":
    case "nullable_int": {
      if (v === "") {
        if (kind === "nullable_int") return null;
        throw new ValidationError(`${field} مطلوب`);
      }
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) throw new ValidationError(`${field}: رقم غير صحيح`);
      return n;
    }
    case "num": {
      if (v === "") return null;
      const n = Number(v);
      if (!Number.isFinite(n)) throw new ValidationError(`${field}: رقم غير صحيح`);
      return n;
    }
    case "color":
      if (!/^#[0-9a-fA-F]{6}$/.test(v)) throw new ValidationError("اللون لازم يكون بصيغة #RRGGBB");
      return v.toUpperCase();
    case "nullable_text":
      return v === "" ? null : v.slice(0, 500);
    case "text":
      if (v === "") throw new ValidationError(`${field} مطلوب`);
      return v.slice(0, 2000);
  }
}

/** Reads whitelisted fields present in the form (checkbox fields are always read). */
function fieldsFrom(table: AdminTable, form: FormData) {
  const spec = TABLES[table] as Record<string, Kind>;
  const out: Record<string, Param> = {};
  for (const [field, kind] of Object.entries(spec)) {
    if (kind === "bool" ? form.has(`__has_${field}`) || form.has(field) : form.has(field)) out[field] = coerce(kind, form.get(field), field);
  }
  return out;
}

export function updateRow(db: DB, tenantId: number, actor: Actor, table: AdminTable, id: number, form: FormData) {
  const data = fieldsFrom(table, form);
  const cols = Object.keys(data);
  if (!cols.length) return;
  const where = table === "tenants" ? "id = ?" : "tenant_id = ? AND id = ?";
  const keys = table === "tenants" ? [tenantId] : [tenantId, id];
  const r = run(db, `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE ${where}`, ...(Object.values(data) as Param[]), ...keys);
  if (r.changes) audit(db, tenantId, actor, `${table}.updated`, table, table === "tenants" ? tenantId : id, { fields: cols });
}

export function insertRow(db: DB, tenantId: number, actor: Actor, table: Exclude<AdminTable, "tenants">, form: FormData, extra: Record<string, Param> = {}) {
  const data = { ...fieldsFrom(table, form), ...extra, tenant_id: tenantId };
  const cols = Object.keys(data);
  const { id } = run(db, `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, ...(Object.values(data) as Param[]));
  audit(db, tenantId, actor, `${table}.created`, table, id);
  return id;
}

export function deleteRow(db: DB, tenantId: number, actor: Actor, table: "reviews" | "gallery_cases", id: number) {
  if (run(db, `DELETE FROM ${table} WHERE tenant_id = ? AND id = ?`, tenantId, id).changes) audit(db, tenantId, actor, `${table}.deleted`, table, id);
}

export function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50) || `item-${Date.now().toString(36)}`
  );
}

export function setProviderServices(db: DB, tenantId: number, actor: Actor, providerId: number, serviceIds: number[]) {
  if (!get(db, "SELECT 1 FROM providers WHERE tenant_id = ? AND id = ?", tenantId, providerId)) return;
  transaction(db, () => {
    run(db, "DELETE FROM provider_services WHERE provider_id = ?", providerId);
    for (const s of serviceIds)
      if (get(db, "SELECT 1 FROM services WHERE tenant_id = ? AND id = ?", tenantId, s)) run(db, "INSERT INTO provider_services (provider_id, service_id) VALUES (?,?)", providerId, s);
    audit(db, tenantId, actor, "providers.services_set", "providers", providerId, { serviceIds });
  });
}

const hm = (v: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) throw new ValidationError("الوقت لازم يكون بصيغة 16:00");
  const n = Number(m[1]) * 60 + Number(m[2]);
  if (n < 0 || n > 24 * 60) throw new ValidationError("وقت غير صحيح");
  return n;
};

export function addWorkingHours(db: DB, tenantId: number, actor: Actor, providerId: number, branchId: number, weekday: number, start: string, end: string) {
  const s = hm(start);
  const e = hm(end);
  if (e <= s) throw new ValidationError("نهاية الشيفت لازم تكون بعد البداية");
  if (!get(db, "SELECT 1 FROM providers WHERE tenant_id = ? AND id = ?", tenantId, providerId)) return;
  if (!get(db, "SELECT 1 FROM branches WHERE tenant_id = ? AND id = ?", tenantId, branchId)) return;
  transaction(db, () => {
    const id = run(db, "INSERT INTO working_hours (tenant_id, provider_id, branch_id, weekday, start_min, end_min) VALUES (?,?,?,?,?,?)", tenantId, providerId, branchId, weekday, s, e).id;
    run(db, "INSERT OR IGNORE INTO provider_branches (provider_id, branch_id) VALUES (?,?)", providerId, branchId);
    audit(db, tenantId, actor, "working_hours.added", "working_hours", id);
  });
}

export function removeWorkingHours(db: DB, tenantId: number, actor: Actor, id: number) {
  if (run(db, "DELETE FROM working_hours WHERE tenant_id = ? AND id = ?", tenantId, id).changes) audit(db, tenantId, actor, "working_hours.removed", "working_hours", id);
}

export function addTimeOff(db: DB, tenantId: number, actor: Actor, input: { providerId: number | null; startsAt: string; endsAt: string; reason: string }) {
  if (!(input.endsAt > input.startsAt)) throw new ValidationError("نهاية الإجازة لازم تكون بعد بدايتها");
  const id = run(db, "INSERT INTO time_off (tenant_id, provider_id, starts_at, ends_at, reason) VALUES (?,?,?,?,?)", tenantId, input.providerId, input.startsAt, input.endsAt, input.reason.slice(0, 120)).id;
  audit(db, tenantId, actor, "time_off.added", "time_off", id);
}

export function removeTimeOff(db: DB, tenantId: number, actor: Actor, id: number) {
  if (run(db, "DELETE FROM time_off WHERE tenant_id = ? AND id = ?", tenantId, id).changes) audit(db, tenantId, actor, "time_off.removed", "time_off", id);
}

export function setContent(db: DB, tenantId: number, actor: Actor, key: string, ar: string, en: string) {
  run(
    db,
    "INSERT INTO content_blocks (tenant_id, key, value_ar, value_en) VALUES (?,?,?,?) ON CONFLICT (tenant_id, key) DO UPDATE SET value_ar = excluded.value_ar, value_en = excluded.value_en",
    tenantId,
    key,
    ar.trim(),
    en.trim(),
  );
  audit(db, tenantId, actor, "content.updated", "content_blocks", null, { key });
}
