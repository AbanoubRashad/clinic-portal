import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, type DB } from "@/lib/db";
import { seedDemo } from "@/clinic/seed";
import { tenantBySlug } from "@/clinic/repo";

delete process.env.PAYMOB_SECRET_KEY;
delete process.env.WHATSAPP_TOKEN;
process.env.PAYMOB_HMAC_SECRET = "test-hmac-secret";
process.env.WHATSAPP_APP_SECRET = "test-app-secret";

/** Thursday 8 Oct 2026, 12:00 Cairo (UTC+3, summer time). */
export const NOW = new Date("2026-10-08T09:00:00.000Z");

export function tempDbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "clinic-test-")), "test.db");
}

export function freshDemo(now: Date = NOW): { db: DB; file: string; tenant: NonNullable<ReturnType<typeof tenantBySlug>> } {
  const file = tempDbPath();
  const db = openDb(file);
  seedDemo(db, now);
  return { db, file, tenant: tenantBySlug(db, "basma")! };
}

export function ids(db: DB, tenantId: number) {
  const q = (sql: string, slug: string) => (db.prepare(sql).get(tenantId, slug) as { id: number }).id;
  return {
    provider: (slug: string) => q("SELECT id FROM providers WHERE tenant_id = ? AND slug = ?", slug),
    service: (slug: string) => q("SELECT id FROM services WHERE tenant_id = ? AND slug = ?", slug),
    branch: (slug: string) => q("SELECT id FROM branches WHERE tenant_id = ? AND slug = ?", slug),
  };
}
