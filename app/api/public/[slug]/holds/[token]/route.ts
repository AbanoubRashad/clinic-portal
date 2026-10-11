import { releaseHold } from "@/clinic/booking";
import { db } from "@/server/db";
import { json, tenantOr404 } from "@/server/api";

/** Patient went back from step 3: free the held slot immediately. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  const tenant = tenantOr404(slug);
  if (!tenant) return json({ error: "NOT_FOUND" }, 404);
  releaseHold(db(), tenant, token);
  return json({ ok: true });
}
