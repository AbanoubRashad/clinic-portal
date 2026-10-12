import { PageHead } from "@/components/dashboard/bits";
import { Icon } from "@/components/Icon";
import { monthlyReport } from "@/clinic/reports";
import { todayIn } from "@/booking-engine";
import { fmtMoney, fmtNumber, MONTHS, digits, fmtDateLong } from "@/i18n/format";
import { db } from "@/server/db";
import { requireStaff } from "@/server/session";

export const dynamic = "force-dynamic";

const pct = (r: number) => `${digits((r * 100).toFixed(1).replace(/\.0$/, ""), "ar")}٪`;

function lastMonths(today: string, n: number) {
  const [y, m] = today.split("-").map(Number) as [number, number];
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return d.toISOString().slice(0, 7);
  });
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const sp = await searchParams;
  const { tenant } = await requireStaff(["owner", "receptionist"]);
  const months = lastMonths(todayIn(tenant.timezone), 6);
  const month = sp.month && months.includes(sp.month) ? sp.month : months[0]!;
  const r = monthlyReport(db(), tenant, month);
  const label = (m: string) => `${MONTHS.ar[Number(m.slice(5)) - 1]} ${digits(m.slice(0, 4), "ar")}`;
  const ba = r.beforeAfter;

  return (
    <>
      <PageHead title="التقارير" sub={`تقرير شهر ${label(month)}`}>
        <form method="get" className="toolbar">
          <label className="inline-label">
            الشهر
            <select name="month" defaultValue={month}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {label(m)}
                </option>
              ))}
            </select>
          </label>
          <button className="tb-btn" type="submit">
            عرض
          </button>
        </form>
        <a className="tb-btn primary" href={`/api/dashboard/reports?month=${month}`} download>
          <Icon name="download" size={18} /> تصدير CSV
        </a>
      </PageHead>

      <section className="kpis" aria-label="أرقام الشهر">
        <div className="panel kpi">
          <div className="l">إجمالي الحجوزات</div>
          <div className="v">{fmtNumber(r.bookings, "ar")}</div>
          <div className="s muted">{fmtNumber(r.cancelled, "ar")} ملغي</div>
        </div>
        <div className="panel kpi">
          <div className="l">نسبة الحجز أونلاين</div>
          <div className="v">{pct(r.onlineShare)}</div>
          <div className="s" style={{ color: "var(--primary-dark)" }}>
            {fmtNumber(r.online, "ar")} حجز من الموقع
          </div>
        </div>
        <div className="panel kpi">
          <div className="l">نسبة عدم الحضور</div>
          <div className="v">{pct(r.noShowRate)}</div>
          <div className="s muted">{fmtNumber(r.noShows, "ar")} حالة</div>
        </div>
        <div className="panel kpi">
          <div className="l">مواعيد اتملت من الانتظار</div>
          <div className="v">{fmtNumber(r.refilled, "ar")}</div>
          <div className="s" style={{ color: "var(--success)" }}>
            بدل ما تفضل فاضية
          </div>
        </div>
        <div className="panel kpi">
          <div className="l">عرابين محصّلة</div>
          <div className="v">{fmtMoney(r.depositsEgp, "ar")}</div>
          <div className="s" style={{ color: "var(--success)" }}>
            {fmtNumber(r.depositsCount, "ar")} دفعة
          </div>
        </div>
      </section>

      {ba ? (
        <section className="panel" style={{ display: "flex", flexDirection: "column", gap: 12 }} aria-labelledby="ba">
          <h2 id="ba" className="section-title">
            عدم الحضور قبل وبعد العربون
          </h2>
          <div className="muted" style={{ fontSize: 14 }}>
            العربون اتفعّل يوم {fmtDateLong(ba.since, "ar")}. المقارنة بين ٩٠ يوم قبلها وكل اللي بعدها.
          </div>
          {[
            ["قبل العربون", ba.before, ba.beforeN, "var(--danger)"],
            ["بعد العربون", ba.after, ba.afterN, "var(--success)"],
          ].map(([l, rate, n, color]) => (
            <div key={String(l)} style={{ display: "grid", gridTemplateColumns: "120px 1fr 90px", gap: 12, alignItems: "center" }}>
              <strong>{l}</strong>
              <div className="bar" role="img" aria-label={`${l}: ${pct(Number(rate))}`}>
                <span style={{ width: `${Math.min(100, Number(rate) * 400)}%`, background: String(color) }} />
              </div>
              <span>
                {pct(Number(rate))} <span className="muted" style={{ fontSize: 12 }}>({fmtNumber(Number(n), "ar")} زيارة)</span>
              </span>
            </div>
          ))}
          {ba.before > 0 ? (
            <div style={{ fontWeight: 800, color: "var(--success)" }}>
              نسبة عدم الحضور قلّت {pct(Math.max(0, (ba.before - ba.after) / ba.before))} بعد تفعيل العربون والتذكير على واتساب.
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
