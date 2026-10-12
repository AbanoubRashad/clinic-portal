import { PageHead } from "@/components/dashboard/bits";
import { patientsList } from "@/clinic/reception";
import { utcToZoned } from "@/booking-engine";
import { fmtDateShort } from "@/i18n/format";
import { db } from "@/server/db";
import { requireStaff } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function PatientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const { tenant } = await requireStaff(["owner", "receptionist"]);
  const rows = patientsList(db(), tenant.id, q.trim());
  return (
    <>
      <PageHead title="المرضى" sub="بيانات تواصل وحجوزات فقط · مفيش أي بيانات طبية. الموبايل متخزّن مشفّر.">
        <form method="get" className="toolbar" role="search">
          <label className="sr-only" htmlFor="q">
            بحث
          </label>
          <input id="q" name="q" defaultValue={q} placeholder="اسم أو آخر ٤ أرقام" className="select" style={{ minWidth: 220 }} />
          <button className="tb-btn" type="submit">
            بحث
          </button>
        </form>
      </PageHead>
      <div className="panel table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>الاسم</th>
              <th>الموبايل</th>
              <th>الزيارات</th>
              <th>آخر/أقرب موعد</th>
              <th>لم يحضر</th>
              <th>واتساب</th>
              <th>عروض تسويقية</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td dir="ltr" style={{ textAlign: "right" }}>
                  •••• {p.phone_last4}
                </td>
                <td>{p.visits}</td>
                <td>{p.last_visit ? fmtDateShort(utcToZoned(new Date(p.last_visit), tenant.timezone).date, "ar") : "—"}</td>
                <td>{p.no_shows ? <span className="badge bad">{p.no_shows}</span> : "0"}</td>
                <td>{p.whatsapp_opt_out ? <span className="badge bad">أوقف الرسائل</span> : <span className="badge ok">مفعّل</span>}</td>
                <td>{p.marketing_consent ? <span className="badge ok">موافق</span> : <span className="badge">لا</span>}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty">
                  مفيش نتائج
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
