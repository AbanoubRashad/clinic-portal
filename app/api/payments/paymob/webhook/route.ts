import { handlePaymobCallback } from "@/clinic/payment-webhook";
import { db } from "@/server/db";
import { json } from "@/server/api";

/**
 * Paymob "transaction processed" callback (POST, JSON body { type, obj }, ?hmac=...).
 * This is the ONLY place a paid deposit confirms an appointment.
 */
export async function POST(req: Request) {
  const hmac = new URL(req.url).searchParams.get("hmac");
  const body = await req.json().catch(() => null);
  const outcome = await handlePaymobCallback(db(), body, hmac);
  return json({ result: outcome.result }, outcome.status);
}
