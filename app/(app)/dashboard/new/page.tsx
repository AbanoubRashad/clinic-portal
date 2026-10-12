import { AutoSubmit } from "@/components/dashboard/Sidebar";
import { BackField, Flash, PageHead } from "@/components/dashboard/bits";
import { availabilityDays } from "@/clinic/booking";
import { catalog } from "@/clinic/site";
import { addDays, todayIn } from "@/booking-engine";
import { fmtDateShort, fmtTime } from "@/i18n/format";
import { db } from "@/server/db";
import { requireStaff } from "@/server/session";
import { receptionBookingAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewBooking({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { tenant } = await requireStaff(["owner", "receptionist"]);
  const cat = catalog(db(), tenant);
  const branch = cat.branches.find((b) => String(b.id) === sp.branch) ?? cat.branches[0]!;
  const services = cat.services.filter((s) => cat.providers.some((p) => p.serviceIds.includes(s.id) && p.branchIds.includes(branch.id)));
  const service = services.find((s) => String(s.id) === sp.service) ?? services[0];
  const doctors = cat.providers.filter((p) => service && p.serviceIds.includes(service.id) && p.branchIds.includes(branch.id));
  const doctor = doctors.find((p) => String(p.id) === sp.provider) ?? doctors[0];
  const today = todayIn(tenant.timezone);
  const days = service && doctor ? availabilityDays(db(), tenant, { serviceId: service.id, providerId: doctor.id, branchId: branch.id }) : [];
  const date = days.find((d) => d.date === sp.date)?.date ?? days.find((d) => d.slots.some((s) => s.available))?.date;
  const slots = days.find((d) => d.date === date)?.slots.filter((s) => s.available) ?? [];
  const back = `/dashboard/new?${new URLSearchParams({ branch: String(branch.id), service: String(service?.id ?? ""), provider: String(doctor?.id ?? ""), date: date ?? "" })}`;

  return (
    <>
      <PageHead title="حجز جديد" sub="حجز بالتليفون أو من الاستقبال · بيتأكد فورًا ويتبعت تأكيد على واتساب" />
      <Flash ok={sp.ok} err={sp.err} />
      <form method="get" className="panel form-grid" aria-label="اختيار الخدمة والطبيب">
        <AutoSubmit>
          <label className="field">
            الفرع
            <select name="branch" defaultValue={branch.id}>
              {cat.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.district_ar}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            الخدمة
            <select name="service" defaultValue={service?.id}>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name_ar} · {s.duration_min} د
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            الطبيب
            <select name="provider" defaultValue={doctor?.id}>
              {doctors.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name_ar}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            اليوم
            <select name="date" defaultValue={date}>
              {days.map((d) => (
                <option key={d.date} value={d.date} disabled={!d.slots.some((s) => s.available)}>
                  {d.date === today ? "النهارده · " : d.date === addDays(today, 1) ? "بكرة · " : ""}
                  {fmtDateShort(d.date, "ar")} ({d.slots.filter((s) => s.available).length} متاح)
                </option>
              ))}
            </select>
          </label>
        </AutoSubmit>
        <noscript>
          <button className="tb-btn" type="submit">
            عرض المواعيد
          </button>
        </noscript>
      </form>

      {service && doctor && slots.length ? (
        <form action={receptionBookingAction} className="panel form-grid" aria-label="بيانات الحجز">
          <BackField value={back} />
          <input type="hidden" name="branch" value={branch.id} />
          <input type="hidden" name="service" value={service.id} />
          <input type="hidden" name="provider" value={doctor.id} />
          <label className="field">
            الوقت
            <select name="start" required>
              {slots.map((s) => (
                <option key={s.start} value={s.start}>
                  {fmtTime(s.startMin, "ar")}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            اسم المريض
            <input name="name" required minLength={3} autoComplete="off" />
          </label>
          <label className="field">
            موبايل (واتساب)
            <input name="phone" required inputMode="tel" dir="ltr" placeholder="01xxxxxxxxx" style={{ textAlign: "right" }} />
          </label>
          <label className="field full">
            ملاحظات إدارية (مش طبية)
            <input name="notes" maxLength={200} placeholder="مثال: محتاج كرسي متحرك / هيدفع كاش" />
          </label>
          <label className="check-inline">
            <input type="checkbox" name="walkin" value="1" /> حالة بدون موعد (موجود في العيادة دلوقتي)
          </label>
          <button className="tb-btn primary" type="submit">
            تأكيد الحجز
          </button>
        </form>
      ) : (
        <div className="panel empty">مفيش مواعيد متاحة للاختيار ده خلال الأسابيع الجاية.</div>
      )}
    </>
  );
}
