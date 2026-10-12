import { BackField, Flash, PageHead } from "@/components/dashboard/bits";
import { activeWaitlist } from "@/clinic/waitlist";
import { scoped } from "@/clinic/repo";
import { addDays, todayIn } from "@/booking-engine";
import { WEEKDAYS, WEEK_ORDER, fmtDateShort, fmtTime } from "@/i18n/format";
import { db } from "@/server/db";
import { requireStaff } from "@/server/session";
import { addWaitlistAction, removeWaitlistAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function WaitlistPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { tenant } = await requireStaff(["owner", "receptionist"]);
  const s = scoped(db(), tenant.id);
  const list = activeWaitlist(db(), tenant.id);
  const providers = s.providers();
  const services = s.services();
  const branches = s.branches();
  const today = todayIn(tenant.timezone);
  const back = "/dashboard/waitlist";
  const name = (rows: { id: number; name_ar: string }[], id: number | null) => (id ? rows.find((r) => r.id === id)?.name_ar : null);

  return (
    <>
      <PageHead title="قائمة الانتظار" sub="لما موعد يتلغي، بنبعت عرض على واتساب للي يناسبهم بالترتيب، وأول واحد يأكد بياخده." />
      <Flash ok={sp.ok} err={sp.err} />
      <div className="panel table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>#</th>
              <th>الاسم</th>
              <th>الطبيب / الخدمة / الفرع</th>
              <th>الفترة</th>
              <th>تفضيلات</th>
              <th>الحالة</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty">
                  القائمة فاضية
                </td>
              </tr>
            ) : null}
            {list.map((w, i) => (
              <tr key={w.id}>
                <td>{i + 1}</td>
                <td>{w.name}</td>
                <td>{[name(providers, w.provider_id) ?? "أي طبيب", name(services, w.service_id) ?? "أي خدمة", name(branches, w.branch_id) ?? "أي فرع"].join(" · ")}</td>
                <td>
                  {fmtDateShort(w.date_from, "ar")} – {fmtDateShort(w.date_to, "ar")}
                </td>
                <td>
                  {[w.pref_note, w.weekdays ? w.weekdays.split(",").map((d) => WEEKDAYS.ar[Number(d)]).join("، ") : "", w.after_min != null ? `بعد ${fmtTime(w.after_min, "ar")}` : ""]
                    .filter(Boolean)
                    .join(" · ")}
                </td>
                <td>{w.status === "offered" ? <span className="badge warn">اتبعتله عرض</span> : <span className="badge">منتظر</span>}</td>
                <td>
                  <form action={removeWaitlistAction}>
                    <BackField value={back} />
                    <input type="hidden" name="id" value={w.id} />
                    <button className="tb-btn sm danger" type="submit">
                      حذف
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form action={addWaitlistAction} className="panel form-grid" aria-label="إضافة لقائمة الانتظار">
        <h2 className="section-title full">إضافة مريض</h2>
        <BackField value={back} />
        <label className="field">
          الاسم
          <input name="name" required minLength={3} />
        </label>
        <label className="field">
          موبايل (واتساب)
          <input name="phone" required dir="ltr" inputMode="tel" placeholder="01xxxxxxxxx" style={{ textAlign: "right" }} />
        </label>
        <label className="field">
          الطبيب
          <select name="provider" defaultValue="">
            <option value="">أي طبيب</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name_ar}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          الخدمة
          <select name="service" defaultValue="">
            <option value="">نفس خدمة الموعد المتاح</option>
            {services.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name_ar}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          الفرع
          <select name="branch" defaultValue="">
            <option value="">أي فرع</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.district_ar}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          من
          <input type="date" name="from" defaultValue={today} required />
        </label>
        <label className="field">
          إلى
          <input type="date" name="to" defaultValue={addDays(today, 14)} required />
        </label>
        <label className="field">
          أي وقت بعد
          <input type="time" name="after" step={1800} />
        </label>
        <fieldset className="full" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 700, fontSize: 14 }}>أيام بعينها (اختياري)</legend>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {WEEK_ORDER.filter((d) => d !== 5).map((d) => (
              <label key={d} className="check-inline">
                <input type="checkbox" name="weekday" value={d} /> {WEEKDAYS.ar[d]}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="field full">
          ملاحظة
          <input name="note" maxLength={60} placeholder="مثال: د. مريم فقط" />
        </label>
        <button className="tb-btn primary" type="submit">
          إضافة للقائمة
        </button>
      </form>
    </>
  );
}
