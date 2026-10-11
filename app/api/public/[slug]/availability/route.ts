import { availabilityDays } from "@/clinic/booking";
import { db } from "@/server/db";
import { intParam, json, limited, tenantOr404 } from "@/server/api";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const block = limited(req, "availability", 120);
  if (block) return block;
  const tenant = tenantOr404((await params).slug);
  if (!tenant) return json({ error: "NOT_FOUND" }, 404);
  const u = new URL(req.url).searchParams;
  const q = { serviceId: intParam(u.get("service")), providerId: intParam(u.get("provider")), branchId: intParam(u.get("branch")) };
  if (Object.values(q).some(Number.isNaN)) return json({ error: "BAD_REQUEST" }, 400);
  return json({ days: availabilityDays(db(), tenant, q) });
}
