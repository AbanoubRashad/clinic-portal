// Tenant-scoped data access. Every query that touches tenant data goes through `scoped(db, tenantId)`,
// which always filters by tenant_id — callers cannot forget it. Tests assert tenant A cannot read B.
import { all, get, type DB } from "@/lib/db";
import type {
  Appointment,
  Branch,
  BranchHours,
  GalleryCase,
  Patient,
  Provider,
  Review,
  Service,
  Tenant,
  WorkingHours,
} from "./types";

export function tenantBySlug(db: DB, slug: string): Tenant | undefined {
  return get<Tenant>(db, "SELECT * FROM tenants WHERE slug = ?", slug);
}

export function tenantByDomain(db: DB, domain: string): Tenant | undefined {
  return get<Tenant>(db, "SELECT * FROM tenants WHERE custom_domain = ?", domain.toLowerCase());
}

export function tenantById(db: DB, id: number): Tenant | undefined {
  return get<Tenant>(db, "SELECT * FROM tenants WHERE id = ?", id);
}

export function allTenants(db: DB): Tenant[] {
  return all<Tenant>(db, "SELECT * FROM tenants ORDER BY id");
}

export function scoped(db: DB, tenantId: number) {
  const t = tenantId;
  return {
    tenantId: t,
    branches: () => all<Branch>(db, "SELECT * FROM branches WHERE tenant_id = ? ORDER BY sort, id", t),
    branch: (id: number) => get<Branch>(db, "SELECT * FROM branches WHERE tenant_id = ? AND id = ?", t, id),
    branchBySlug: (slug: string) => get<Branch>(db, "SELECT * FROM branches WHERE tenant_id = ? AND slug = ?", t, slug),
    branchHours: () =>
      all<BranchHours>(db, "SELECT bh.* FROM branch_hours bh WHERE bh.tenant_id = ? ORDER BY branch_id, weekday", t),

    providers: (activeOnly = true) =>
      all<Provider>(db, `SELECT * FROM providers WHERE tenant_id = ? ${activeOnly ? "AND active = 1" : ""} ORDER BY sort, id`, t),
    provider: (id: number) => get<Provider>(db, "SELECT * FROM providers WHERE tenant_id = ? AND id = ?", t, id),
    providerServices: () =>
      all<{ provider_id: number; service_id: number }>(
        db,
        "SELECT ps.* FROM provider_services ps JOIN providers p ON p.id = ps.provider_id WHERE p.tenant_id = ?",
        t,
      ),
    providerBranches: () =>
      all<{ provider_id: number; branch_id: number }>(
        db,
        "SELECT pb.* FROM provider_branches pb JOIN providers p ON p.id = pb.provider_id WHERE p.tenant_id = ?",
        t,
      ),
    workingHours: (providerId?: number) =>
      providerId
        ? all<WorkingHours>(db, "SELECT * FROM working_hours WHERE tenant_id = ? AND provider_id = ? ORDER BY weekday, start_min", t, providerId)
        : all<WorkingHours>(db, "SELECT * FROM working_hours WHERE tenant_id = ? ORDER BY provider_id, weekday, start_min", t),

    services: (activeOnly = true) =>
      all<Service>(db, `SELECT * FROM services WHERE tenant_id = ? ${activeOnly ? "AND active = 1" : ""} ORDER BY sort, id`, t),
    service: (id: number) => get<Service>(db, "SELECT * FROM services WHERE tenant_id = ? AND id = ?", t, id),
    serviceBySlug: (slug: string) => get<Service>(db, "SELECT * FROM services WHERE tenant_id = ? AND slug = ?", t, slug),

    reviews: () => all<Review>(db, "SELECT * FROM reviews WHERE tenant_id = ? ORDER BY sort, id", t),
    gallery: () => all<GalleryCase>(db, "SELECT * FROM gallery_cases WHERE tenant_id = ? ORDER BY sort, id", t),
    content: () => {
      const rows = all<{ key: string; value_ar: string; value_en: string }>(
        db,
        "SELECT key, value_ar, value_en FROM content_blocks WHERE tenant_id = ?",
        t,
      );
      return Object.fromEntries(rows.map((r) => [r.key, { ar: r.value_ar, en: r.value_en }])) as Record<string, { ar: string; en: string }>;
    },

    appointment: (id: number) => get<Appointment>(db, "SELECT * FROM appointments WHERE tenant_id = ? AND id = ?", t, id),
    appointmentByToken: (token: string) =>
      get<Appointment>(db, "SELECT * FROM appointments WHERE tenant_id = ? AND public_token = ?", t, token),
    appointmentsBetween: (fromIso: string, toIso: string) =>
      all<Appointment>(
        db,
        "SELECT * FROM appointments WHERE tenant_id = ? AND start_utc >= ? AND start_utc < ? ORDER BY start_utc",
        t,
        fromIso,
        toIso,
      ),
    patient: (id: number) => get<Patient>(db, "SELECT * FROM patients WHERE tenant_id = ? AND id = ?", t, id),
    patientByPhoneHash: (hash: string) =>
      get<Patient>(db, "SELECT * FROM patients WHERE tenant_id = ? AND phone_hash = ?", t, hash),
  };
}

export type Scoped = ReturnType<typeof scoped>;

/** Looks up an appointment by its unguessable public token across tenants (for links in messages). */
export function appointmentByPublicToken(db: DB, token: string): Appointment | undefined {
  return get<Appointment>(db, "SELECT * FROM appointments WHERE public_token = ?", token);
}
