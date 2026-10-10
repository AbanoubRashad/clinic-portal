import { get, getDb, onDbBoot, type DB } from "@/lib/db";
import { seedDemo } from "@/clinic/seed";

onDbBoot((db) => {
  // First run on a fresh database: create the demo clinic so the app is usable immediately.
  if (process.env.SEED_ON_START !== "false" && !get(db, "SELECT 1 FROM tenants LIMIT 1")) {
    const r = seedDemo(db);
    console.log(`[seed] demo tenant created (schedule day ${r.demoDay})`);
  }
});

export function db(): DB {
  return getDb();
}
