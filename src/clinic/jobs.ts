import { all, run, type DB } from "@/lib/db";
import { addDays, utcToZoned, zonedToUtc } from "@/booking-engine";
import { allTenants } from "./repo";
import { clinicEngine } from "./store";
import { notifyReminder } from "./notifications";
import type { Appointment } from "./types";

export interface JobReport {
  expiredHolds: number;
  dayReminders: number;
  twoHourReminders: number;
  expiredOffers: number;
}

/**
 * Background work, run every minute by the scheduler (and directly with a fake `now` in tests):
 *  - expire unpaid holds (frees slots)
 *  - day-before reminder at the clinic's reminder hour, with تأكيد / إلغاء buttons
 *  - optional 2-hour reminder
 *  - close waiting-list offers whose time has passed
 */
export async function runDueJobs(db: DB, now: Date = new Date()): Promise<JobReport> {
  const report: JobReport = { expiredHolds: 0, dayReminders: 0, twoHourReminders: 0, expiredOffers: 0 };
  report.expiredHolds = clinicEngine(db).expireHolds(now);
  const iso = now.toISOString();

  for (const t of allTenants(db)) {
    const local = utcToZoned(now, t.timezone);
    if (local.minutes >= t.reminder_hour * 60) {
      const tomorrow = addDays(local.date, 1);
      const from = zonedToUtc(tomorrow, 0, t.timezone).toISOString();
      const to = zonedToUtc(addDays(tomorrow, 1), 0, t.timezone).toISOString();
      const due = all<Appointment>(
        db,
        `SELECT * FROM appointments WHERE tenant_id = ? AND status = 'confirmed' AND reminder_day_sent_at IS NULL
            AND patient_id IS NOT NULL AND start_utc >= ? AND start_utc < ?`,
        t.id,
        from,
        to,
      );
      for (const a of due) {
        // Claim first so overlapping runs never double-send.
        if (run(db, "UPDATE appointments SET reminder_day_sent_at = ? WHERE id = ? AND reminder_day_sent_at IS NULL", iso, a.id).changes === 0) continue;
        await notifyReminder(db, a, "day", now);
        report.dayReminders++;
      }
    }
    if (t.reminder_2h_enabled) {
      const due = all<Appointment>(
        db,
        `SELECT * FROM appointments WHERE tenant_id = ? AND status = 'confirmed' AND reminder_2h_sent_at IS NULL
            AND patient_id IS NOT NULL AND start_utc > ? AND start_utc <= ?`,
        t.id,
        iso,
        new Date(now.getTime() + 2 * 3_600_000).toISOString(),
      );
      for (const a of due) {
        if (run(db, "UPDATE appointments SET reminder_2h_sent_at = ? WHERE id = ? AND reminder_2h_sent_at IS NULL", iso, a.id).changes === 0) continue;
        await notifyReminder(db, a, "2h", now);
        report.twoHourReminders++;
      }
    }
  }
  report.expiredOffers = run(db, "UPDATE slot_offers SET status = 'expired' WHERE status = 'open' AND start_utc <= ?", iso).changes;
  if (report.expiredOffers)
    run(
      db,
      `UPDATE waitlist_entries SET status = 'waiting' WHERE status = 'offered'
         AND id NOT IN (SELECT r.waitlist_entry_id FROM slot_offer_recipients r JOIN slot_offers o ON o.id = r.offer_id WHERE o.status = 'open')`,
    );
  return report;
}
