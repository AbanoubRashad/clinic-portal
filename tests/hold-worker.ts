// Runs in a worker thread with its OWN database connection, so the race is real.
import { parentPort, workerData } from "node:worker_threads";
import { openDb } from "@/lib/db";
import { createHold } from "@/clinic/booking";
import { tenantBySlug } from "@/clinic/repo";

const { file, input, now, startAt } = workerData as { file: string; input: { serviceId: number; providerId: number; branchId: number; start: string }; now: string; startAt: number };
const db = openDb(file);
const tenant = tenantBySlug(db, "basma")!;
// all workers fire at the same moment
while (Date.now() < startAt) {
  /* spin */
}
try {
  const appt = createHold(db, tenant, { ...input, lang: "ar" }, new Date(now));
  parentPort!.postMessage({ ok: true, id: appt.id });
} catch (err) {
  parentPort!.postMessage({ ok: false, code: (err as { code?: string }).code ?? String(err) });
}
