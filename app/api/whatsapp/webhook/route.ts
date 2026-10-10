import { handleWhatsAppInbound } from "@/clinic/whatsapp-inbound";
import { verifyWhatsAppSignature } from "@/messaging";
import { db } from "@/server/db";
import { json } from "@/server/api";

/** Meta webhook verification handshake. */
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  if (u.get("hub.mode") === "subscribe" && u.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN && u.get("hub.challenge"))
    return new Response(u.get("hub.challenge"), { status: 200 });
  return new Response("Forbidden", { status: 403 });
}

/** Button replies (تأكيد / إلغاء / احجزه) and opt-out texts. Signature verified with the app secret. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyWhatsAppSignature(raw, req.headers.get("x-hub-signature-256"))) return json({ error: "invalid_signature" }, 401);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const results = await handleWhatsAppInbound(db(), body);
  return json({ results });
}
