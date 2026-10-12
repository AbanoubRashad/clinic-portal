import { BackField, Flash, PageHead } from "@/components/dashboard/bits";
import { messageLog } from "@/clinic/reception";
import { utcToZoned } from "@/booking-engine";
import { fmtDateShort, fmtTime } from "@/i18n/format";
import { whatsappLive } from "@/messaging";
import { db } from "@/server/db";
import { requireStaff } from "@/server/session";
import { simulateReplyAction } from "../actions";

export const dynamic = "force-dynamic";

const TEMPLATE: Record<string, string> = {
  booking_confirmation: "تأكيد حجز",
  reminder_day_before: "تذكير قبلها بيوم",
  reminder_2h: "تذكير قبلها بساعتين",
  cancellation_confirmation: "تأكيد إلغاء",
  slot_opened_offer: "عرض موعد اتفتح",
  offer_too_late: "الموعد اتحجز",
};
const STATUS: Record<string, [string, string]> = {
  simulated: ["تجريبي", "warn"],
  sent: ["اتبعت", "ok"],
  delivered: ["وصل", "ok"],
  read: ["اتقرا", "ok"],
  failed: ["فشل", "bad"],
  skipped_opt_out: ["موقف الرسائل", "bad"],
  queued: ["في الطابور", ""],
};

export default async function MessagesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { tenant } = await requireStaff(["owner", "receptionist"]);
  const rows = messageLog(db(), tenant.id, 150);
  const sim = !whatsappLive();
  return (
    <>
      <PageHead
        title="رسائل واتساب"
        sub={
          sim
            ? "وضع تجريبي: WhatsApp Business غير مُعدّ، الرسائل بتتسجل هنا. تقدر تضغط أزرار الرد نيابة عن المريض لتجربة التأكيد والإلغاء."
            : "متصل بـ WhatsApp Business Platform (قوالب معتمدة)."
        }
      />
      <Flash ok={sp.ok} err={sp.err} />
      <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {rows.length === 0 ? <div className="empty">مفيش رسائل لسه</div> : null}
        {rows.map((m) => {
          const l = utcToZoned(new Date(m.created_at), tenant.timezone);
          const buttons = m.buttons ? (JSON.parse(m.buttons) as { id: string; title: string }[]) : [];
          const [label, tone] = STATUS[m.status] ?? [m.status, ""];
          return (
            <div key={m.id} className="row-line" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 360px", display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
                  <strong>{TEMPLATE[m.template] ?? m.template}</strong>
                  <span className={`badge ${tone}`}>{label}</span>
                  <span className="badge">{m.channel === "email" ? "إيميل" : "واتساب"}</span>
                  <span className="muted" dir="ltr">
                    {m.recipient}
                  </span>
                  <span className="muted">
                    {fmtDateShort(l.date, "ar")} · {fmtTime(l.minutes, "ar")}
                  </span>
                </div>
                <div className="wa-bubble" lang={m.lang}>
                  {m.body}
                </div>
              </div>
              {buttons.length ? (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignSelf: "center" }}>
                  {buttons.map((b) =>
                    sim ? (
                      <form key={b.id} action={simulateReplyAction}>
                        <BackField value="/dashboard/messages" />
                        <input type="hidden" name="payload" value={b.id} />
                        <input type="hidden" name="title" value={b.title} />
                        <button className={`tb-btn sm${b.id.endsWith(":cancel") ? " danger" : ""}`} type="submit" title="محاكاة ضغط المريض على الزر">
                          {b.title}
                        </button>
                      </form>
                    ) : (
                      <span key={b.id} className="badge">
                        {b.title}
                      </span>
                    ),
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}
