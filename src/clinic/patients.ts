import { get, run, type DB } from "@/lib/db";
import { blindIndex, decryptField, encryptField } from "@/lib/crypto";
import type { Lang, Patient } from "./types";

export function upsertPatient(
  db: DB,
  tenantId: number,
  input: { name: string; phoneE164: string; lang: Lang; marketingConsent?: boolean; email?: string | null },
): Patient {
  const hash = blindIndex(input.phoneE164);
  const existing = get<Patient>(db, "SELECT * FROM patients WHERE tenant_id = ? AND phone_hash = ?", tenantId, hash);
  if (existing) {
    run(
      db,
      `UPDATE patients SET name = ?, lang = ?, email = COALESCE(?, email),
              marketing_consent = CASE WHEN ? = 1 THEN 1 ELSE marketing_consent END
        WHERE id = ?`,
      input.name.trim() || existing.name,
      input.lang,
      input.email ?? null,
      input.marketingConsent ? 1 : 0,
      existing.id,
    );
    return get<Patient>(db, "SELECT * FROM patients WHERE id = ?", existing.id)!;
  }
  const { id } = run(
    db,
    `INSERT INTO patients (tenant_id, name, phone_enc, phone_hash, phone_last4, email, lang, marketing_consent)
     VALUES (?,?,?,?,?,?,?,?)`,
    tenantId,
    input.name.trim(),
    encryptField(input.phoneE164),
    hash,
    input.phoneE164.slice(-4),
    input.email ?? null,
    input.lang,
    input.marketingConsent ? 1 : 0,
  );
  return get<Patient>(db, "SELECT * FROM patients WHERE id = ?", id)!;
}

export function patientPhone(p: Pick<Patient, "phone_enc">): string {
  try {
    return decryptField(p.phone_enc);
  } catch {
    return "";
  }
}
