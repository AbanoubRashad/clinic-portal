import { PageHead } from "@/components/dashboard/bits";
import { paymentsList } from "@/clinic/reception";
import { utcToZoned } from "@/booking-engine";
import { fmtDateShort, fmtMoney, fmtTime } from "@/i18n/format";
import { paymobConfigFromEnv } from "@/payments/paymob";
import { db } from "@/server/db";
import { requireStaff } from "@/server/session";

export const dynamic = "force-dynamic";

const METHOD: Record<string, string> = { card: "كارت", wallet: "محفظة", kiosk: "فوري / منفذ" };
const STATUS: Record<string, [string, string]> = {
  initiated: ["بدأ الدفع", "warn"],
  paid: ["مدفوع", "ok"],
  failed: ["فشل", "bad"],
  refunded: ["اترد", ""],
  needs_refund: ["محتاج رد", "bad"],
};

export default async function PaymentsPage() {
  const { tenant } = await requireStaff(["owner", "receptionist"]);
  const rows = paymentsList(db(), tenant.id, 200);
  const live = Boolean(paymobConfigFromEnv());
  return (
    <>
      <PageHead title="المدفوعات والعرابين" sub={live ? "متصل بـ Paymob" : "وضع تجريبي: Paymob غير مُعدّ، المدفوعات بتتم على صفحة الدفع التجريبية"} />
      <div className="panel table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>الحجز</th>
              <th>المريض</th>
              <th>الطريقة</th>
              <th>المبلغ</th>
              <th>الحالة</th>
              <th>مرجع Paymob</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const l = utcToZoned(new Date(p.created_at), tenant.timezone);
              const [label, tone] = STATUS[p.status] ?? [p.status, ""];
              return (
                <tr key={p.id}>
                  <td>
                    {fmtDateShort(l.date, "ar")} · {fmtTime(l.minutes, "ar")}
                  </td>
                  <td dir="ltr" style={{ textAlign: "right" }}>
                    {p.ref}
                  </td>
                  <td>{p.patient ?? "—"}</td>
                  <td>{METHOD[p.method] ?? p.method}</td>
                  <td>{fmtMoney(p.amount_cents / 100, "ar")}</td>
                  <td>
                    <span className={`badge ${tone}`}>{label}</span>
                  </td>
                  <td dir="ltr" style={{ textAlign: "right", fontSize: 12 }}>
                    {p.provider_ref ?? "—"}
                    {p.kiosk_reference ? ` · ref ${p.kiosk_reference}` : ""}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty">
                  مفيش مدفوعات لسه
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
