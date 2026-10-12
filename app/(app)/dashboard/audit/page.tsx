import { PageHead } from "@/components/dashboard/bits";
import { auditTrail } from "@/clinic/reception";
import { utcToZoned } from "@/booking-engine";
import { fmtDateShort, fmtTime } from "@/i18n/format";
import { db } from "@/server/db";
import { requireStaff } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const { tenant } = await requireStaff(["owner"]);
  const rows = auditTrail(db(), tenant.id, 300);
  return (
    <>
      <PageHead title="سجل التعديلات" sub="كل تغيير على المواعيد والإعدادات مسجّل باسم اللي عمله" />
      <div className="panel table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>الوقت</th>
              <th>بواسطة</th>
              <th>الإجراء</th>
              <th>العنصر</th>
              <th>تفاصيل</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const l = utcToZoned(new Date(r.created_at), tenant.timezone);
              return (
                <tr key={r.id}>
                  <td>
                    {fmtDateShort(l.date, "ar")} · {fmtTime(l.minutes, "ar")}
                  </td>
                  <td>{r.actor}</td>
                  <td dir="ltr" style={{ textAlign: "right" }}>
                    {r.action}
                  </td>
                  <td dir="ltr" style={{ textAlign: "right" }}>
                    {r.entity}
                    {r.entity_id ? ` #${r.entity_id}` : ""}
                  </td>
                  <td dir="ltr" style={{ textAlign: "right", fontSize: 12, maxWidth: 360, wordBreak: "break-word" }}>
                    {r.details}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
