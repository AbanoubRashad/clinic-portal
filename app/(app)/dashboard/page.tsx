import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { AutoSubmit } from "@/components/dashboard/Sidebar";
import { Flash, BackField } from "@/components/dashboard/bits";
import { get } from "@/lib/db";
import { addDays, todayIn, utcToZoned, zonedToUtc } from "@/booking-engine";
import { fmtClock, fmtDateLong, fmtDateShort, fmtMoney, fmtNumber, fmtTime, digits } from "@/i18n/format";
import { scoped } from "@/clinic/repo";
import { daySchedule, rescheduleOptions, walkIns, type ScheduleCard } from "@/clinic/reception";
import { activeWaitlist } from "@/clinic/waitlist";
import type { Tenant } from "@/clinic/types";
import { whatsappLive } from "@/messaging";
import { db } from "@/server/db";
import { requireStaff } from "@/server/session";
import {
  addWalkInAction,
  cancelAction,
  checkInAction,
  completeAction,
  noShowAction,
  offerAction,
  rescheduleAction,
  simulateReplyAction,
  walkInStatusAction,
} from "./actions";

export const dynamic = "force-dynamic";

/** Today, unless today has no bookings at this branch; then the next day that does (e.g. after closing or on Friday). */
function defaultDate(tenant: Tenant, branchId: number, now: Date) {
  const today = todayIn(tenant.timezone, now);
  for (let i = 0; i < 14; i++) {
    const d = addDays(today, i);
    const has = get(
      db(),
      "SELECT 1 FROM appointments WHERE tenant_id = ? AND branch_id = ? AND start_utc >= ? AND start_utc < ? AND status NOT IN ('held','cancelled') LIMIT 1",
      tenant.id,
      branchId,
      zonedToUtc(d, 0, tenant.timezone).toISOString(),
      zonedToUtc(addDays(d, 1), 0, tenant.timezone).toISOString(),
    );
    if (has) return d;
  }
  return today;
}

export default async function SchedulePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { user, tenant } = await requireStaff();
  const d = db();
  const s = scoped(d, tenant.id);
  const branches = s.branches();
  const branch = branches.find((b) => String(b.id) === sp.branch) ?? branches[0]!;
  const now = new Date();
  const today = todayIn(tenant.timezone, now);
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : defaultDate(tenant, branch.id, now);
  const isDoctor = user.role === "doctor";
  const canAct = !isDoctor;
  const sched = daySchedule(d, tenant, { branchId: branch.id, date, providerId: isDoctor ? user.provider_id : null }, now);
  const k = sched.kpis;
  const waiting = activeWaitlist(d, tenant.id);
  const walks = walkIns(d, tenant.id, branch.id, date, tenant.timezone);
  const qs = (patch: Record<string, string>) => {
    const u = new URLSearchParams({ branch: String(branch.id), date, ...patch });
    return `/dashboard?${u}`;
  };
  const back = qs({});
  const sim = !whatsappLive();
  const providerName = (id: number | null) => (id ? (s.provider(id)?.short_ar ?? "") : "");

  const title = date === today ? "جدول اليوم" : date === addDays(today, 1) ? "جدول بكرة" : "جدول يوم";

  return (
    <>
      <AutoRefresh seconds={20} />
      <div className="dash-top">
        <div>
          <h1>{isDoctor ? "جدولي" : title}</h1>
          <div className="muted">
            {fmtDateLong(date, "ar")} · {branch.name_ar}
          </div>
        </div>
        <div className="toolbar">
          <form method="get" action="/dashboard" className="toolbar">
            <input type="hidden" name="date" value={date} />
            <label className="inline-label">
              الفرع
              <AutoSubmit>
                <select name="branch" defaultValue={branch.id}>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.district_ar}
                    </option>
                  ))}
                </select>
              </AutoSubmit>
            </label>
            <noscript>
              <button className="tb-btn sm" type="submit">
                عرض
              </button>
            </noscript>
          </form>
          <nav className="toolbar" aria-label="التنقل بين الأيام">
            <Link className="tb-btn sm" href={qs({ date: addDays(date, -1) })} aria-label="اليوم السابق">
              ›
            </Link>
            {date !== today ? (
              <Link className="tb-btn sm" href={qs({ date: today })}>
                النهارده
              </Link>
            ) : null}
            <Link className="tb-btn sm" href={qs({ date: addDays(date, 1) })} aria-label="اليوم التالي">
              ‹
            </Link>
          </nav>
          {canAct ? (
            <>
              <a className="tb-btn" href="#walkin-form">
                + حالة بدون موعد
              </a>
              <Link className="tb-btn primary" href={`/dashboard/new?branch=${branch.id}&date=${date}`}>
                + حجز جديد
              </Link>
            </>
          ) : null}
        </div>
      </div>

      <Flash ok={sp.ok} err={sp.err} />

      <section className="kpis" aria-label="مؤشرات اليوم">
        <div className="panel kpi">
          <div className="l">مواعيد اليوم</div>
          <div className="v">{fmtNumber(k.total, "ar")}</div>
          <div className="s" style={{ color: "var(--primary-dark)" }}>
            {fmtNumber(k.online, "ar")} أونلاين
          </div>
        </div>
        <div className="panel kpi">
          <div className="l">أكّدوا على واتساب</div>
          <div className="v">{fmtNumber(k.confirmedOnWa, "ar")}</div>
          <div className="s" style={{ color: "var(--chip-ink)" }}>
            {fmtNumber(k.awaiting, "ar")} بانتظار الرد
          </div>
        </div>
        <div className="panel kpi">
          <div className="l">عرابين محصّلة</div>
          <div className="v">{fmtMoney(k.depositsEgp, "ar")}</div>
          <div className="s" style={{ color: "var(--success)" }}>
            {fmtNumber(k.depositsCount, "ar")} دفعة
          </div>
        </div>
        <div className="panel kpi">
          <div className="l">مواعيد ملغاة</div>
          <div className="v">{fmtNumber(k.cancelledOpen, "ar")}</div>
          <div className="s" style={{ color: k.cancelledOpen ? "var(--danger)" : "var(--success)" }}>
            {k.cancelledOpen ? "متاح للانتظار" : k.refilled ? "اتملى من الانتظار" : "—"}
          </div>
        </div>
      </section>

      <div className="board">
        <div className="board-cols">
          {sched.columns.length === 0 ? (
            <div className="panel empty">مفيش أطباء أو مواعيد في الفرع ده في اليوم ده.</div>
          ) : (
            <div className="cols">
              {sched.columns.map((c) => (
                <section key={c.provider.id} className="col" aria-label={c.provider.name_ar}>
                  <div className="col-head">
                    {c.provider.photo_url ? <img src={c.provider.photo_url} alt="" width={38} height={38} /> : null}
                    <span>
                      <strong>{c.provider.name_ar}</strong>
                      <span>{c.provider.specialty_ar}</span>
                    </span>
                  </div>
                  {c.cards.length === 0 ? <div className="empty">مفيش مواعيد</div> : null}
                  {c.cards.map((card) => (
                    <Card key={card.appt.id} card={card} tenant={tenant} canAct={canAct} back={back} sim={sim} now={now} />
                  ))}
                </section>
              ))}
            </div>
          )}
        </div>

        <aside className="side" aria-label="قوائم جانبية">
          <div className="panel">
            <h2>قائمة الانتظار ({fmtNumber(waiting.length, "ar")})</h2>
            {waiting.length === 0 ? <div className="empty">القائمة فاضية</div> : null}
            {waiting.map((w) => (
              <div key={w.id} className="row-line">
                <span>
                  {w.name}
                  {w.status === "offered" ? (
                    <span className="badge warn" style={{ marginInlineStart: 6 }}>
                      اتبعتله عرض
                    </span>
                  ) : null}
                </span>
                <span className="sub">{w.pref_note || (w.provider_id ? `${providerName(w.provider_id)} فقط` : "أي وقت")}</span>
              </div>
            ))}
            {canAct ? (
              <Link href="/dashboard/waitlist" style={{ fontWeight: 700, fontSize: 14, paddingBlock: 8 }}>
                إدارة قائمة الانتظار
              </Link>
            ) : null}
          </div>

          <div className="panel" id="walkins">
            <h2>حالات بدون موعد ({fmtNumber(walks.length, "ar")})</h2>
            {walks.length === 0 ? <div className="empty">مفيش حالات منتظرة</div> : null}
            {walks.map((w) => (
              <div key={w.id} className="row-line">
                <span>
                  {w.name}
                  <span className="sub" style={{ display: "block" }}>
                    {w.note} · وصل {fmtTime(utcToZoned(new Date(w.arrived_at), tenant.timezone).minutes, "ar")}
                  </span>
                </span>
                {canAct ? (
                  <span style={{ display: "flex", gap: 4 }}>
                    <form action={walkInStatusAction}>
                      <BackField value={back} />
                      <input type="hidden" name="id" value={w.id} />
                      <input type="hidden" name="status" value="seen" />
                      <button className="tb-btn sm" type="submit">
                        اتكشف
                      </button>
                    </form>
                    <form action={walkInStatusAction}>
                      <BackField value={back} />
                      <input type="hidden" name="id" value={w.id} />
                      <input type="hidden" name="status" value="left" />
                      <button className="tb-btn sm" type="submit" aria-label={`${w.name} مشي`}>
                        مشي
                      </button>
                    </form>
                  </span>
                ) : null}
              </div>
            ))}
            {canAct ? (
              <form action={addWalkInAction} id="walkin-form" style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 8, borderTop: "1px solid var(--line-soft)" }}>
                <BackField value={back} />
                <input type="hidden" name="branch" value={branch.id} />
                <label className="field">
                  الاسم
                  <input name="name" required minLength={2} />
                </label>
                <label className="field">
                  سبب الزيارة (إداري مختصر)
                  <input name="note" maxLength={80} placeholder="كشف / طوارئ" />
                </label>
                <button className="tb-btn" type="submit">
                  + إضافة حالة
                </button>
              </form>
            ) : null}
          </div>

          <div className="panel">
            <h2>ألوان الحالة</h2>
            <div className="legend">
              <i style={{ background: "var(--primary)" }} />
              أكّد على واتساب + عربون مدفوع
            </div>
            <div className="legend">
              <i style={{ background: "var(--warning)" }} />
              لم يرد على التذكير بعد / بانتظار الدفع
            </div>
            <div className="legend">
              <i style={{ background: "var(--danger)" }} />
              ألغى · الموعد متاح
            </div>
            <div className="legend">
              <i style={{ background: "var(--success)" }} />
              وصل العيادة
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

function Hidden({ id, back }: { id: number; back: string }) {
  return (
    <>
      <BackField value={back} />
      <input type="hidden" name="id" value={id} />
    </>
  );
}

function Card({ card, tenant, canAct, back, sim, now }: { card: ScheduleCard; tenant: Tenant; canAct: boolean; back: string; sim: boolean; now: Date }) {
  const a = card.appt;
  const active = a.status === "confirmed" || a.status === "pending_payment";
  const options = canAct && active && !card.past ? rescheduleOptions(db(), tenant, a, now).slice(0, 40) : [];
  return (
    <article className={`appt tone-${card.tone}`} aria-label={`${fmtTime(card.startMin, "ar")} ${card.patientName} — ${card.tag}`}>
      <div className="top">
        <span className="time">{fmtClock(card.startMin, "ar")}</span>
        <span className="tag">{card.tag}</span>
      </div>
      <div className="name">{card.patientName}</div>
      <div className="svc">{card.label}</div>
      {a.admin_notes ? <div className="svc">ملاحظة إدارية: {a.admin_notes}</div> : null}

      {canAct && card.free && !card.offer?.status ? (
        <form action={offerAction}>
          <Hidden id={a.id} back={back} />
          <button className="fill-btn" type="submit">
            اعرضه على قائمة الانتظار
          </button>
        </form>
      ) : null}
      {canAct && card.free && card.offer?.status === "open" ? (
        <div className="svc" style={{ marginTop: 6 }}>
          {card.offer.recipients.length ? `اتبعت عرض على واتساب لـ ${digits(card.offer.recipients.length, "ar")} · أول واحد يأكد بياخده` : "مفيش حد مناسب في قائمة الانتظار"}
          {sim
            ? card.offer.recipients
                .filter((r) => r.status === "sent")
                .map((r) => (
                  <form key={r.token} action={simulateReplyAction} style={{ marginTop: 6 }}>
                    <BackField value={back} />
                    <input type="hidden" name="payload" value={`offer:${r.token}:accept`} />
                    <input type="hidden" name="title" value="احجزه" />
                    <button className="tb-btn sm" type="submit" style={{ width: "100%" }}>
                      محاكاة: {r.name} ضغط «احجزه»
                    </button>
                  </form>
                ))
            : null}
        </div>
      ) : null}

      {canAct && (active || a.status === "checked_in") ? (
        <details className="appt-actions">
          <summary>إجراءات ▾</summary>
          <div className="menu">
            {active ? (
              <form action={checkInAction}>
                <Hidden id={a.id} back={back} />
                <button className="tb-btn sm" type="submit">
                  وصل العيادة
                </button>
              </form>
            ) : null}
            {a.status === "checked_in" ? (
              <form action={completeAction}>
                <Hidden id={a.id} back={back} />
                <button className="tb-btn sm" type="submit">
                  انتهت الزيارة
                </button>
              </form>
            ) : null}
            {a.status === "confirmed" && card.past ? (
              <form action={noShowAction}>
                <Hidden id={a.id} back={back} />
                <button className="tb-btn sm danger" type="submit">
                  لم يحضر
                </button>
              </form>
            ) : null}
            {options.length ? (
              <form action={rescheduleAction}>
                <Hidden id={a.id} back={back} />
                <label className="sr-only" htmlFor={`rs-${a.id}`}>
                  موعد جديد
                </label>
                <select id={`rs-${a.id}`} name="start" required defaultValue="">
                  <option value="" disabled>
                    تغيير الموعد…
                  </option>
                  {options.map((o) => (
                    <option key={o.start.toISOString()} value={o.start.toISOString()}>
                      {fmtDateShort(o.date, "ar")} · {fmtTime(o.startMin, "ar")}
                    </option>
                  ))}
                </select>
                <button className="tb-btn sm" type="submit">
                  نقل
                </button>
              </form>
            ) : null}
            {active ? (
              <form action={cancelAction}>
                <Hidden id={a.id} back={back} />
                <label className="sr-only" htmlFor={`cr-${a.id}`}>
                  سبب الإلغاء
                </label>
                <select id={`cr-${a.id}`} name="reason" defaultValue="patient_called">
                  <option value="patient_called">المريض اتصل وألغى</option>
                  <option value="clinic">العيادة ألغت (رد العربون)</option>
                </select>
                <button className="tb-btn sm danger" type="submit">
                  إلغاء
                </button>
              </form>
            ) : null}
          </div>
        </details>
      ) : null}
    </article>
  );
}
