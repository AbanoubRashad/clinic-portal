import type { DB } from "@/lib/db";
import { scoped } from "./repo";
import { availabilityDays, firstAvailable } from "./booking";
import type { Branch, BranchHours, Provider, Service, Tenant } from "./types";

export interface ProviderView extends Provider {
  serviceIds: number[];
  branchIds: number[];
  weekdays: number[];
}

export interface Catalog {
  branches: (Branch & { hours: BranchHours[] })[];
  services: Service[];
  providers: ProviderView[];
}

export function catalog(db: DB, tenant: Tenant): Catalog {
  const s = scoped(db, tenant.id);
  const hours = s.branchHours();
  const ps = s.providerServices();
  const wh = s.workingHours();
  return {
    branches: s.branches().map((b) => ({ ...b, hours: hours.filter((h) => h.branch_id === b.id) })),
    services: s.services(),
    providers: s.providers().map((p) => ({
      ...p,
      serviceIds: ps.filter((x) => x.provider_id === p.id).map((x) => x.service_id),
      branchIds: [...new Set(wh.filter((w) => w.provider_id === p.id).map((w) => w.branch_id))],
      weekdays: [...new Set(wh.filter((w) => w.provider_id === p.id).map((w) => w.weekday))],
    })),
  };
}

/** Earliest bookable slot across all doctors (for the hero card), using each doctor's first service. */
export function nextAvailable(db: DB, tenant: Tenant, cat: Catalog, now: Date = new Date()) {
  let best: { provider: ProviderView; branch: Branch; service: Service; date: string; startMin: number; start: string } | null = null;
  for (const p of cat.providers) {
    const service = cat.services.find((s) => p.serviceIds.includes(s.id));
    if (!service) continue;
    for (const bId of p.branchIds) {
      const branch = cat.branches.find((b) => b.id === bId);
      if (!branch) continue;
      const first = firstAvailable(availabilityDays(db, tenant, { serviceId: service.id, providerId: p.id, branchId: bId }, now));
      if (first && (!best || first.start < best.start)) best = { provider: p, branch, service, date: first.date, startMin: first.startMin, start: first.start };
    }
  }
  return best;
}
