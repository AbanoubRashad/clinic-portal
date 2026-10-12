import { all, get, type DB } from "@/lib/db";
import { addDays, zonedToUtc, utcToZoned } from "@/booking-engine";
import type { Tenant } from "./types";

function monthBounds(tenant: Tenant, month: string) {
  const first = `${month}-01`;
  const [y, m] = month.split("-").map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { from: zonedToUtc(first, 0, tenant.timezone).toISOString(), to: zonedToUtc(next, 0, tenant.timezone).toISOString() };
}

const rate = (num: number, den: number) => (den ? num / den : 0);

/** The numbers we show the next customer: online share, no-shows before vs after deposits, refills, deposits. */
export function monthlyReport(db: DB, tenant: Tenant, month: string) {
  const { from, to } = monthBounds(tenant, month);
  const rows = all<{ status: string; source: string; deposit_status: string; deposit_amount: number }>(
    db,
    `SELECT status, source, deposit_status, deposit_amount FROM appointments
      WHERE tenant_id = ? AND start_utc >= ? AND start_utc < ?
        AND NOT (status = 'cancelled' AND COALESCE(cancel_reason,'') IN ('hold_expired','released','payment_failed')) AND status <> 'held'`,
    tenant.id,
    from,
    to,
  );
  const bookings = rows.length;
  const online = rows.filter((r) => r.source === "web").length;
  const cancelled = rows.filter((r) => r.status === "cancelled").length;
  const refilled = rows.filter((r) => r.source === "waitlist").length;
  const attendedOrNoShow = rows.filter((r) => r.status === "completed" || r.status === "no_show" || r.status === "checked_in");
  const noShows = rows.filter((r) => r.status === "no_show").length;
  const deposits = get<{ total: number; n: number }>(
    db,
    `SELECT COALESCE(SUM(py.amount_cents), 0) / 100 AS total, COUNT(*) AS n FROM payments py JOIN appointments a ON a.id = py.appointment_id
      WHERE py.tenant_id = ? AND py.status IN ('paid','refunded') AND a.start_utc >= ? AND a.start_utc < ?`,
    tenant.id,
    from,
    to,
  ) ?? { total: 0, n: 0 };

  return {
    month,
    bookings,
    online,
    onlineShare: rate(online, bookings),
    cancelled,
    refilled,
    noShows,
    noShowRate: rate(noShows, attendedOrNoShow.length),
    depositsEgp: deposits.total,
    depositsCount: deposits.n,
    beforeAfter: noShowBeforeAfter(db, tenant),
  };
}

/** No-show rate for the 90 days before deposits were switched on vs. everything since. */
export function noShowBeforeAfter(db: DB, tenant: Tenant) {
  if (!tenant.deposits_enabled_at) return null;
  const pivot = tenant.deposits_enabled_at;
  const pivotLocal = utcToZoned(new Date(pivot), tenant.timezone).date;
  const before = zonedToUtc(addDays(pivotLocal, -90), 0, tenant.timezone).toISOString();
  const q = (a: string, b: string) =>
    get<{ ns: number; n: number }>(
      db,
      `SELECT SUM(CASE WHEN status = 'no_show' THEN 1 ELSE 0 END) AS ns, COUNT(*) AS n FROM appointments
        WHERE tenant_id = ? AND status IN ('completed','no_show','checked_in') AND start_utc >= ? AND start_utc < ?`,
      tenant.id,
      a,
      b,
    ) ?? { ns: 0, n: 0 };
  const b = q(before, pivot);
  const a = q(pivot, new Date().toISOString());
  return { since: pivotLocal, before: rate(b.ns ?? 0, b.n), after: rate(a.ns ?? 0, a.n), beforeN: b.n, afterN: a.n };
}

export function monthCsv(db: DB, tenant: Tenant, month: string): string {
  const { from, to } = monthBounds(tenant, month);
  const rows = all<Record<string, string | number | null>>(
    db,
    `SELECT a.ref, a.start_utc, b.name_en AS branch, pr.name_en AS doctor, s.name_en AS service, a.status, a.source,
            a.pay_method, a.deposit_amount, a.deposit_status, CASE WHEN a.patient_confirmed_at IS NULL THEN 0 ELSE 1 END AS confirmed_on_whatsapp
       FROM appointments a JOIN branches b ON b.id = a.branch_id JOIN providers pr ON pr.id = a.provider_id JOIN services s ON s.id = a.service_id
      WHERE a.tenant_id = ? AND a.start_utc >= ? AND a.start_utc < ? AND a.status <> 'held'
      ORDER BY a.start_utc`,
    tenant.id,
    from,
    to,
  );
  const header = ["ref", "start_local", "branch", "doctor", "service", "status", "source", "pay_method", "deposit_egp", "deposit_status", "confirmed_on_whatsapp"];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) => {
    const local = utcToZoned(new Date(String(r.start_utc)), tenant.timezone);
    const hm = `${String(Math.floor(local.minutes / 60)).padStart(2, "0")}:${String(local.minutes % 60).padStart(2, "0")}`;
    return [r.ref, `${local.date} ${hm}`, r.branch, r.doctor, r.service, r.status, r.source, r.pay_method, r.deposit_amount, r.deposit_status, r.confirmed_on_whatsapp].map(esc).join(",");
  });
  return "﻿" + [header.join(","), ...lines].join("\n");
}
