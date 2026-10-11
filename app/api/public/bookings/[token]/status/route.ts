import { appointmentByPublicToken } from "@/clinic/repo";
import { db } from "@/server/db";
import { json } from "@/server/api";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const appt = appointmentByPublicToken(db(), (await params).token);
  if (!appt) return json({ error: "NOT_FOUND" }, 404);
  return json({ status: appt.status, ref: appt.ref, deposit: appt.deposit_status });
}
