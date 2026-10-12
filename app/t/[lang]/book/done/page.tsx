import "../../../../booking.css";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Icon } from "@/components/Icon";
import { DICT } from "@/i18n/dict";
import { digits, fmtDateShort, fmtTime } from "@/i18n/format";
import { scoped } from "@/clinic/repo";
import { apptView, reminderPreview } from "@/clinic/notifications";
import { L } from "@/clinic/types";
import { get } from "@/lib/db";
import { utcToZoned } from "@/booking-engine";
import { paymobConfigFromEnv } from "@/payments/paymob";
import { db } from "@/server/db";
import { href, siteContext } from "@/server/tenant";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function DonePage({ params, searchParams }: { params: Promise<{ lang: string }>; searchParams: Promise<{ t?: string }> }) {
  const { lang } = await params;
  const { t: token } = await searchParams;
  const ctx = await siteContext(lang);
  const L_ = ctx.lang;
  const t = DICT[L_].booking;
  if (!token) notFound();
  const d = db();
  const appt = scoped(d, ctx.tenant.id).appointmentByToken(token);
  if (!appt) notFound();
  const v = apptView(d, appt);
  const confirmed = ["confirmed", "checked_in", "completed"].includes(appt.status);
  const pending = appt.status === "pending_payment" || appt.status === "held";
  const pay = get<{ id: number; kiosk_reference: string | null; status: string }>(d, "SELECT id, kiosk_reference, status FROM payments WHERE appointment_id = ? ORDER BY id DESC LIMIT 1", appt.id);
  const when = `${fmtDateShort(v.local.date, L_)} · ${fmtTime(v.local.minutes, L_)}`;
  const holdUntil = appt.hold_expires_at ? new Date(appt.hold_expires_at) : null;
  const sandbox = !paymobConfigFromEnv();

  return (
    <main className="bk">
      <div className="bk-shell">
        <div className="bk-head">
          <div className="bk-head-row">
            <Link className="icon-btn" href={href(ctx, "/")} aria-label={t.home}>
              <Icon name="back" size={20} strokeWidth={2} className="flip-ltr" />
            </Link>
            <div className="bk-title">
              <strong>{confirmed ? t.titles[3] : t.titles[2]}</strong>
              <span>
                {L_ === "ar" ? `عيادات ${ctx.tenant.short_name_ar}` : ctx.tenant.short_name_en} · {t.step(4)}
              </span>
            </div>
            <div style={{ width: 44 }} />
          </div>
          <div className="bk-progress" aria-hidden="true">
            {[1, 2, 3, 4].map((i) => (
              <span key={i} className={i <= (confirmed ? 4 : 3) ? "on" : ""} />
            ))}
          </div>
        </div>
        <div className="bk-body" aria-live="polite">
          {confirmed ? (
            <>
              <div className="done-icon">
                <Icon name="check" size={38} strokeWidth={2.4} stroke="var(--primary)" />
              </div>
              <h1 className="done-title">{t.confirmedTitle}</h1>
              <div className="done-sub">
                {L(v.service, "name", L_)} {L_ === "ar" ? "مع" : "with"} {L(v.provider, "name", L_)}
                <br />
                {when} · {t.refLabel} <span dir="ltr">{appt.ref}</span>
                <br />
                {L(v.branch, "name", L_)} — {L(v.branch, "address", L_)}
              </div>
              <div style={{ fontWeight: 800, fontSize: 14, marginTop: 4 }}>{t.reminderPreview}</div>
              <div className="wa-preview">
                <div className="msg">{reminderPreview(d, appt, v.patient?.name ?? "", L_)}</div>
                <div className="btns" aria-hidden="true">
                  <div>{t.confirmBtn}</div>
                  <div className="cancel">{t.cancelBtn}</div>
                </div>
              </div>
              <a className="btn btn-outline btn-block" style={{ minHeight: 50, borderRadius: 14 }} href={`/api/public/bookings/${appt.public_token}/ics`} download>
                <Icon name="calendar" size={20} />
                {t.addToCalendar}
              </a>
              <Link className="link-btn" href={href(ctx, "/book")}>
                {t.another}
              </Link>
            </>
          ) : pending ? (
            <>
              <AutoRefresh seconds={3} />
              <div className="done-icon">
                <Icon name="clock" size={36} strokeWidth={2} stroke="var(--primary)" />
              </div>
              {appt.pay_method === "kiosk" && pay?.kiosk_reference ? (
                <>
                  <h1 className="done-title">{t.kioskTitle}</h1>
                  <div className="done-sub">
                    {t.kioskBody(digits(pay.kiosk_reference, L_), holdUntil ? `${fmtDateShort(utcToZoned(holdUntil, ctx.tenant.timezone).date, L_)} ${fmtTime(utcToZoned(holdUntil, ctx.tenant.timezone).minutes, L_)}` : "")}
                  </div>
                  {sandbox && pay.id ? (
                    <a className="btn btn-outline btn-block" style={{ borderRadius: 14 }} href={`/pay/sandbox?p=${pay.id}&t=${appt.public_token}&r=${encodeURIComponent(href(ctx, "/book/done"))}`}>
                      {L_ === "ar" ? "(تجريبي) ادفع في المنفذ" : "(Sandbox) pay at the outlet"}
                    </a>
                  ) : null}
                </>
              ) : (
                <>
                  <h1 className="done-title">{t.pendingTitle}</h1>
                  <div className="done-sub">{t.pendingBody}</div>
                </>
              )}
              <div className="done-sub">
                {L(v.service, "name", L_)} · {L(v.provider, "name", L_)} · {when}
              </div>
            </>
          ) : (
            <>
              <h1 className="done-title">{t.failedTitle}</h1>
              <div className="done-sub">{t.failedBody}</div>
              <Link className="btn btn-primary btn-block" href={`${href(ctx, "/book")}?service=${appt.service_id}&provider=${appt.provider_id}&branch=${appt.branch_id}`}>
                {t.another}
              </Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
