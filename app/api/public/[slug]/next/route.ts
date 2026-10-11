import { availabilityDays, firstAvailable } from "@/clinic/booking";
import { catalog } from "@/clinic/site";
import { db } from "@/server/db";
import { intParam, json, limited, tenantOr404 } from "@/server/api";

/** Earliest available day per doctor for a service at a branch ("متاح النهارده" chips). */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const block = limited(req, "availability", 120);
  if (block) return block;
  const tenant = tenantOr404((await params).slug);
  if (!tenant) return json({ error: "NOT_FOUND" }, 404);
  const u = new URL(req.url).searchParams;
  const serviceId = intParam(u.get("service"));
  const branchId = intParam(u.get("branch"));
  if (Number.isNaN(serviceId) || Number.isNaN(branchId)) return json({ error: "BAD_REQUEST" }, 400);
  const d = db();
  const next: Record<number, string | null> = {};
  for (const p of catalog(d, tenant).providers.filter((x) => x.serviceIds.includes(serviceId) && x.branchIds.includes(branchId)))
    next[p.id] = firstAvailable(availabilityDays(d, tenant, { serviceId, providerId: p.id, branchId }))?.date ?? null;
  return json({ next });
}
