import { runDueJobs } from "@/clinic/jobs";
import { db } from "./db";

const g = globalThis as unknown as { __clinicScheduler?: NodeJS.Timeout };

/** Runs due jobs every minute. Single-instance by design; use a real queue/cron when scaling out (see TODO.md). */
export function startScheduler(intervalMs = 60_000) {
  if (g.__clinicScheduler) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runDueJobs(db());
      if (r.expiredHolds || r.dayReminders || r.twoHourReminders || r.expiredOffers) console.log("[jobs]", JSON.stringify(r));
    } catch (err) {
      console.error("[jobs] failed", err);
    } finally {
      running = false;
    }
  };
  g.__clinicScheduler = setInterval(tick, intervalMs);
  setTimeout(tick, 5_000);
}
