import { monthCsv } from "@/clinic/reports";
import { tenantById } from "@/clinic/repo";
import { db } from "@/server/db";
import { currentUser } from "@/server/session";

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user || user.role === "doctor") return new Response("Forbidden", { status: 403 });
  const month = new URL(req.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) return new Response("Bad month", { status: 400 });
  const tenant = tenantById(db(), user.tenant_id)!;
  return new Response(monthCsv(db(), tenant, month), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${tenant.slug}-${month}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
