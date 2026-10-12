// npm run seed            -> create the demo clinic if missing (idempotent)
// npm run seed -- --reset -> delete and recreate the demo clinic
import path from "node:path";
import { openDb } from "@/lib/db";
import { DEMO_LOGINS, resetDemo, seedDemo } from "@/clinic/seed";

const db = openDb(process.env.DATABASE_PATH || path.join(process.cwd(), "data", "clinic.db"));
if (process.argv.includes("--reset")) resetDemo(db);
const r = seedDemo(db);
console.log(`Demo clinic ready (tenant ${r.tenantId}); design schedule placed on ${r.demoDay}.`);
for (const u of DEMO_LOGINS) console.log(`  ${u.role.padEnd(12)} ${u.email}  ${u.password}`);
