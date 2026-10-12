import { BackField, Flash, PageHead } from "@/components/dashboard/bits";
import { all } from "@/lib/db";
import { scoped } from "@/clinic/repo";
import { todayIn, utcToZoned } from "@/booking-engine";
import { WEEKDAYS, WEEK_ORDER, fmtDateShort, fmtTime } from "@/i18n/format";
import { db } from "@/server/db";
import { requireStaff } from "@/server/session";
import { addHoursAction, addTimeOffAction, removeHoursAction, removeTimeOffAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function DoctorsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { tenant } = await requireStaff(["owner", "receptionist"]);
  const d = db();
  const s = scoped(d, tenant.id);
  const providers = s.providers(false);
  const branches = s.branches();
  const hours = s.workingHours();
  const today = todayIn(tenant.timezone);
  const timeOff = all<{ id: number; provider_id: number | null; starts_at: string; ends_at: string; reason: string | null }>(
    d,
    "SELECT * FROM time_off WHERE tenant_id = ? AND ends_at > ? ORDER BY starts_at",
    tenant.id,
    new Date().toISOString(),
  );
  const back = "/dashboard/doctors";
  const branchName = (id: number) => branches.find((b) => b.id === id)?.district_ar ?? "";
  const at = (iso: string) => {
    const l = utcToZoned(new Date(iso), tenant.timezone);
    return `${fmtDateShort(l.date, "ar")} ${fmtTime(l.minutes, "ar")}`;
  };

  return (
    <>
      <PageHead title="الأطباء والجداول" sub="المواعيد المتاحة للحجز بتتحسب من الشيفتات دي ناقص الإجازات والحجوزات." />
      <Flash ok={sp.ok} err={sp.err} />
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(360px, 100%), 1fr))" }}>
        {providers.map((p) => (
          <section key={p.id} className="panel" style={{ display: "flex", flexDirection: "column", gap: 8 }} aria-labelledby={`p-${p.id}`}>
            <div className="col-head">
              {p.photo_url ? <img src={p.photo_url} alt="" width={38} height={38} /> : null}
              <span>
                <strong id={`p-${p.id}`}>{p.name_ar}</strong>
                <span>
                  {p.title_ar} {p.active ? "" : "· غير نشط"}
                </span>
              </span>
            </div>
            {WEEK_ORDER.map((wd) => hours.filter((h) => h.provider_id === p.id && h.weekday === wd))
              .flat()
              .map((h) => (
                <div key={h.id} className="row-line">
                  <span>
                    <strong>{WEEKDAYS.ar[h.weekday]}</strong> · {fmtTime(h.start_min, "ar")} – {fmtTime(h.end_min, "ar")}
                    <span className="sub"> · {branchName(h.branch_id)}</span>
                  </span>
                  <form action={removeHoursAction}>
                    <BackField value={back} />
                    <input type="hidden" name="id" value={h.id} />
                    <button className="tb-btn sm danger" type="submit" aria-label={`حذف شيفت ${WEEKDAYS.ar[h.weekday]}`}>
                      حذف
                    </button>
                  </form>
                </div>
              ))}
            <details className="editor">
              <summary>+ إضافة شيفت</summary>
              <form action={addHoursAction} className="form-grid">
                <BackField value={back} />
                <input type="hidden" name="provider" value={p.id} />
                <label className="field">
                  اليوم
                  <select name="weekday">
                    {WEEK_ORDER.map((wd) => (
                      <option key={wd} value={wd}>
                        {WEEKDAYS.ar[wd]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  الفرع
                  <select name="branch">
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.district_ar}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  من
                  <input type="time" name="start" defaultValue="16:00" required />
                </label>
                <label className="field">
                  إلى
                  <input type="time" name="end" defaultValue="21:00" required />
                </label>
                <button className="tb-btn primary" type="submit">
                  إضافة
                </button>
              </form>
            </details>
          </section>
        ))}
      </div>

      <section className="panel" style={{ display: "flex", flexDirection: "column", gap: 8 }} aria-labelledby="to">
        <h2 id="to" className="section-title">
          الإجازات والإغلاق
        </h2>
        {timeOff.length === 0 ? <div className="empty">مفيش إجازات جاية</div> : null}
        {timeOff.map((t) => (
          <div key={t.id} className="row-line">
            <span>
              <strong>{t.provider_id ? providers.find((p) => p.id === t.provider_id)?.name_ar : "العيادة كلها"}</strong> · {at(t.starts_at)} → {at(t.ends_at)}
              {t.reason ? <span className="sub"> · {t.reason}</span> : null}
            </span>
            <form action={removeTimeOffAction}>
              <BackField value={back} />
              <input type="hidden" name="id" value={t.id} />
              <button className="tb-btn sm danger" type="submit">
                حذف
              </button>
            </form>
          </div>
        ))}
        <form action={addTimeOffAction} className="form-grid" style={{ paddingTop: 8, borderTop: "1px solid var(--line-soft)" }}>
          <BackField value={back} />
          <label className="field">
            الطبيب
            <select name="provider" defaultValue="">
              <option value="">العيادة كلها (إجازة رسمية)</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name_ar}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            من يوم
            <input type="date" name="from" defaultValue={today} required />
          </label>
          <label className="field">
            الساعة (اختياري)
            <input type="time" name="fromTime" />
          </label>
          <label className="field">
            إلى يوم
            <input type="date" name="to" defaultValue={today} />
          </label>
          <label className="field">
            الساعة (اختياري)
            <input type="time" name="toTime" />
          </label>
          <label className="field">
            السبب
            <input name="reason" maxLength={120} placeholder="مؤتمر / إجازة / استراحة" />
          </label>
          <button className="tb-btn primary" type="submit">
            إضافة إجازة
          </button>
        </form>
      </section>
    </>
  );
}
