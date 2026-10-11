import { createHold } from "@/clinic/booking";
import { db } from "@/server/db";
import { errorResponse, json, limited, tenantOr404 } from "@/server/api";

/** Reserve a slot for `hold_minutes` while the patient fills in details and pays. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const block = limited(req, "hold", 15);
  if (block) return block;
  const tenant = tenantOr404((await params).slug);
  if (!tenant) return json({ error: "NOT_FOUND" }, 404);
  const body = (await req.json().catch(() => null)) as { serviceId?: unknown; providerId?: unknown; branchId?: unknown; start?: unknown; lang?: unknown } | null;
  if (!body || ![body.serviceId, body.providerId, body.branchId].every((v) => Number.isInteger(v)) || typeof body.start !== "string")
    return json({ error: "BAD_REQUEST" }, 400);
  try {
    const appt = createHold(db(), tenant, {
      serviceId: body.serviceId as number,
      providerId: body.providerId as number,
      branchId: body.branchId as number,
      start: body.start,
      lang: body.lang === "en" ? "en" : "ar",
    });
    return json({ token: appt.public_token, ref: appt.ref, expiresAt: appt.hold_expires_at }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
