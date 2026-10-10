import { all, get, run, transaction, type DB } from "@/lib/db";
import { randomToken } from "@/lib/crypto";
import {
  createBookingEngine,
  isSlotTakenDbError,
  SlotTakenError,
  type BookableContext,
  type BookableKey,
  type BookingStore,
  type HoldRequest,
  type Interval,
} from "@/booking-engine";
import type { Appointment, Tenant } from "./types";

const ACTIVE = "('held','pending_payment','confirmed','checked_in','completed')";

export interface HoldMeta {
  source?: Appointment["source"];
  lang?: "ar" | "en";
}

/** SQLite implementation of the generic booking store for clinics (resource = doctor, location = branch). */
export function clinicBookingStore(db: DB): BookingStore<Appointment> {
  const expire = (now: Date, providerId?: number) => {
    const nowIso = now.toISOString();
    return run(
      db,
      `UPDATE appointments
          SET status = 'cancelled', cancel_reason = 'hold_expired', cancelled_by = 'system', cancelled_at = ?, updated_at = ?,
              deposit_status = CASE WHEN deposit_status = 'pending' THEN 'none' ELSE deposit_status END
        WHERE status IN ('held','pending_payment') AND hold_expires_at IS NOT NULL AND hold_expires_at <= ?
          AND (? IS NULL OR provider_id = ?)`,
      nowIso,
      nowIso,
      nowIso,
      providerId ?? null,
      providerId ?? null,
    ).changes;
  };
  return {
    loadContext(key: BookableKey): BookableContext | null {
      const row = get<{ timezone: string; slot_step_minutes: number; min_notice_minutes: number; duration_min: number; buffer_min: number }>(
        db,
        `SELECT t.timezone, t.slot_step_minutes, t.min_notice_minutes, s.duration_min, s.buffer_min
           FROM tenants t
           JOIN services s ON s.tenant_id = t.id AND s.id = :service AND s.active = 1
           JOIN providers p ON p.tenant_id = t.id AND p.id = :provider AND p.active = 1
           JOIN provider_services ps ON ps.provider_id = p.id AND ps.service_id = s.id
           JOIN branches b ON b.tenant_id = t.id AND b.id = :branch
          WHERE t.id = :tenant`,
        { tenant: key.tenantId, service: key.serviceId, provider: key.resourceId, branch: key.locationId },
      );
      if (!row) return null;
      const windows = all<{ weekday: number; start_min: number; end_min: number; branch_id: number }>(
        db,
        "SELECT weekday, start_min, end_min, branch_id FROM working_hours WHERE tenant_id = ? AND provider_id = ?",
        key.tenantId,
        key.resourceId,
      ).map((w) => ({ weekday: w.weekday, startMin: w.start_min, endMin: w.end_min, locationId: w.branch_id }));
      return {
        timezone: row.timezone,
        durationMin: row.duration_min,
        bufferMin: row.buffer_min,
        stepMin: row.slot_step_minutes,
        minNoticeMin: row.min_notice_minutes,
        windows,
      };
    },

    blockedIntervals(key, from, to, now): Interval[] {
      const nowIso = now.toISOString();
      const appts = all<{ start_utc: string; block_end_utc: string }>(
        db,
        `SELECT start_utc, block_end_utc FROM appointments
          WHERE tenant_id = :tenant AND provider_id = :provider
            AND status IN ${ACTIVE}
            AND NOT (status IN ('held','pending_payment') AND hold_expires_at IS NOT NULL AND hold_expires_at <= :now)
            AND start_utc < :to AND block_end_utc > :from`,
        { tenant: key.tenantId, provider: key.resourceId, now: nowIso, from: from.toISOString(), to: to.toISOString() },
      );
      const off = all<{ starts_at: string; ends_at: string }>(
        db,
        `SELECT starts_at, ends_at FROM time_off
          WHERE tenant_id = :tenant
            AND (provider_id = :provider OR provider_id IS NULL)
            AND (branch_id IS NULL OR branch_id = :branch OR provider_id IS NOT NULL)
            AND starts_at < :to AND ends_at > :from`,
        { tenant: key.tenantId, provider: key.resourceId, branch: key.locationId, from: from.toISOString(), to: to.toISOString() },
      );
      return [...appts.map((a) => ({ start: Date.parse(a.start_utc), end: Date.parse(a.block_end_utc) })), ...off.map((o) => ({ start: Date.parse(o.starts_at), end: Date.parse(o.ends_at) }))];
    },

    insertHold(req: HoldRequest): Appointment {
      const meta = req.meta as HoldMeta;
      try {
        return transaction(db, () => {
          // Release this doctor's lapsed holds first, in the same write transaction.
          expire(req.now, req.resourceId);
          const token = randomToken();
          const { id } = run(
            db,
            `INSERT INTO appointments (tenant_id, ref, public_token, branch_id, provider_id, service_id, start_utc, end_utc, block_end_utc,
                                       status, source, hold_expires_at, lang)
             VALUES (?,?,?,?,?,?,?,?,?, 'held', ?, ?, ?)`,
            req.tenantId,
            `tmp_${token}`,
            token,
            req.locationId,
            req.resourceId,
            req.serviceId,
            req.start.toISOString(),
            req.end.toISOString(),
            req.blockEnd.toISOString(),
            meta.source ?? "web",
            req.expiresAt.toISOString(),
            meta.lang ?? "ar",
          );
          const prefix = get<{ ref_prefix: string }>(db, "SELECT ref_prefix FROM tenants WHERE id = ?", req.tenantId)?.ref_prefix ?? "BK";
          run(db, "UPDATE appointments SET ref = ? WHERE id = ?", `${prefix}-${20000 + id}`, id);
          return get<Appointment>(db, "SELECT * FROM appointments WHERE id = ?", id)!;
        });
      } catch (err) {
        if (isSlotTakenDbError(err)) throw new SlotTakenError();
        throw err;
      }
    },

    expireHolds(now: Date): number {
      return expire(now);
    },
  };
}

export function clinicEngine(db: DB) {
  return createBookingEngine(clinicBookingStore(db));
}

export function holdMinutes(t: Tenant) {
  return t.hold_minutes || 10;
}
