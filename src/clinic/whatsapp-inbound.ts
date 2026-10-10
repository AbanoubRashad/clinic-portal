import { all, run, type DB } from "@/lib/db";
import { blindIndex } from "@/lib/crypto";
import { parseWhatsAppWebhook } from "@/messaging";
import { appointmentByPublicToken, tenantById } from "./repo";
import { cancelAppointment } from "./booking";
import { acceptOffer, offerSlot } from "./waitlist";
import { audit } from "./audit";

const PATIENT = { userId: null, name: "patient:whatsapp" };
const OPT_OUT = /^(stop|unsubscribe|إيقاف|ايقاف|الغاء الاشتراك|إلغاء الاشتراك)$/i;

export type InboundResult = { messageId: string; action: string };

/**
 * Handles quick-reply buttons from WhatsApp templates:
 *  appt:<token>:confirm  -> patient confirmed (shown green/blue at reception)
 *  appt:<token>:cancel   -> cancelled per deposit policy, slot freed, waiting list offered in order
 *  offer:<token>:accept  -> waiting-list patient takes the freed slot (first wins)
 * and "STOP" texts (opt-out). Every message id is processed at most once.
 */
export async function handleWhatsAppInbound(db: DB, body: unknown, now: Date = new Date()): Promise<InboundResult[]> {
  const results: InboundResult[] = [];
  for (const msg of parseWhatsAppWebhook(body)) {
    if (!msg.messageId) continue;
    try {
      run(db, "INSERT INTO webhook_events (provider, event_key) VALUES ('whatsapp', ?)", msg.messageId);
    } catch {
      results.push({ messageId: msg.messageId, action: "duplicate" });
      continue;
    }
    results.push({ messageId: msg.messageId, action: await handleOne(db, msg.payload, msg.text, msg.from, now) });
  }
  return results;
}

async function handleOne(db: DB, payload: string | null, text: string | null, from: string, now: Date): Promise<string> {
  if (payload) {
    const [kind, token, verb] = payload.split(":");
    if (kind === "appt" && token) {
      const appt = appointmentByPublicToken(db, token);
      if (!appt) return "unknown_appointment";
      const tenant = tenantById(db, appt.tenant_id)!;
      if (verb === "confirm") {
        if (appt.status !== "confirmed") return "ignored_state";
        run(db, "UPDATE appointments SET patient_confirmed_at = COALESCE(patient_confirmed_at, ?), updated_at = ? WHERE id = ?", now.toISOString(), now.toISOString(), appt.id);
        audit(db, tenant.id, PATIENT, "appointment.patient_confirmed", "appointment", appt.id);
        return "confirmed";
      }
      if (verb === "cancel") {
        if (!["confirmed", "pending_payment"].includes(appt.status)) return "ignored_state";
        await cancelAppointment(db, tenant, appt.id, PATIENT, { by: "patient", reason: "whatsapp", now });
        // Refill automatically: offer the freed slot to the waiting list in order.
        try {
          await offerSlot(db, tenant, appt.id, PATIENT, now);
        } catch {
          /* slot in the past or already refilled */
        }
        return "cancelled";
      }
    }
    if (kind === "offer" && token && verb === "accept") {
      const r = await acceptOffer(db, token, now);
      return `offer_${r.result}`;
    }
    return "unknown_payload";
  }
  if (text && OPT_OUT.test(text.trim())) {
    const e164 = from.startsWith("+") ? from : `+${from}`;
    const n = run(db, "UPDATE patients SET whatsapp_opt_out = 1 WHERE phone_hash = ?", blindIndex(e164)).changes;
    for (const p of all<{ tenant_id: number; id: number }>(db, "SELECT tenant_id, id FROM patients WHERE phone_hash = ?", blindIndex(e164)))
      audit(db, p.tenant_id, PATIENT, "patient.opt_out", "patient", p.id);
    return n ? "opted_out" : "unknown_sender";
  }
  return "ignored";
}
