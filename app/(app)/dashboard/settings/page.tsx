import Link from "next/link";
import { BackField, Flash, PageHead } from "@/components/dashboard/bits";
import { scoped } from "@/clinic/repo";
import { db } from "@/server/db";
import { requireStaff } from "@/server/session";
import { contentAction, deleteRowAction, insertRowAction, providerServicesAction, updateRowAction } from "../actions";

export const dynamic = "force-dynamic";

const TABS = [
  ["clinic", "العيادة والسياسات"],
  ["services", "الخدمات"],
  ["doctors", "الأطباء"],
  ["branches", "الفروع"],
  ["reviews", "التقييمات"],
  ["gallery", "معرض الصور"],
  ["content", "نصوص الصفحة"],
] as const;

type V = string | number | null | undefined;

function F({ name, label, value, type = "text", dir, required, step, full }: { name: string; label: string; value?: V; type?: string; dir?: "ltr"; required?: boolean; step?: string; full?: boolean }) {
  return (
    <label className={`field${full ? " full" : ""}`}>
      {label}
      <input name={name} type={type} defaultValue={value ?? ""} dir={dir} required={required} step={step} />
    </label>
  );
}
function T({ name, label, value }: { name: string; label: string; value?: V }) {
  return (
    <label className="field full">
      {label}
      <textarea name={name} defaultValue={value ?? ""} rows={2} />
    </label>
  );
}
function B({ name, label, value }: { name: string; label: string; value?: V }) {
  return (
    <label className="check-inline">
      <input type="hidden" name={`__has_${name}`} value="1" />
      <input type="checkbox" name={name} defaultChecked={Boolean(value)} /> {label}
    </label>
  );
}
function Save({ label = "حفظ" }: { label?: string }) {
  return (
    <button className="tb-btn primary" type="submit">
      {label}
    </button>
  );
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { tenant } = await requireStaff(["owner"]);
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "clinic";
  const back = `/dashboard/settings?tab=${tab}`;
  const d = db();
  const s = scoped(d, tenant.id);
  const t = tenant;

  return (
    <>
      <PageHead title="الإعدادات" sub="كل اللي بيظهر على موقع العيادة والحجز بيتعدل من هنا من غير كود." />
      <nav className="subnav" aria-label="أقسام الإعدادات">
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/dashboard/settings?tab=${k}`} aria-current={k === tab ? "page" : undefined}>
            {l}
          </Link>
        ))}
      </nav>
      <Flash ok={sp.ok} err={sp.err} />

      {tab === "clinic" ? (
        <form action={updateRowAction} className="panel form-grid">
          <BackField value={back} />
          <input type="hidden" name="table" value="tenants" />
          <input type="hidden" name="id" value={t.id} />
          <h2 className="section-title full">بيانات العيادة</h2>
          <F name="name_ar" label="الاسم (عربي)" value={t.name_ar} required />
          <F name="name_en" label="Name (English)" value={t.name_en} dir="ltr" required />
          <F name="short_name_ar" label="الاسم المختصر (عربي)" value={t.short_name_ar} required />
          <F name="short_name_en" label="Short name (English)" value={t.short_name_en} dir="ltr" required />
          <F name="tagline_ar" label="الوصف تحت اللوجو" value={t.tagline_ar} required />
          <F name="tagline_en" label="Tagline (English)" value={t.tagline_en} dir="ltr" required />
          <F name="phone" label="التليفون" value={t.phone} dir="ltr" />
          <F name="whatsapp" label="واتساب" value={t.whatsapp} dir="ltr" />
          <F name="email" label="الإيميل" value={t.email} dir="ltr" type="email" />
          <F name="custom_domain" label="الدومين الخاص" value={t.custom_domain} dir="ltr" />
          <label className="field">
            اللون الأساسي
            <input type="color" name="primary_color" defaultValue={t.primary_color} style={{ padding: 4 }} />
          </label>
          <F name="years_experience" label="سنين الخبرة" value={t.years_experience} type="number" />
          <F name="google_rating" label="تقييم Google" value={t.google_rating} type="number" step="0.1" />
          <F name="google_reviews_count" label="عدد التقييمات" value={t.google_reviews_count} type="number" />
          <F name="google_reviews_url" label="رابط التقييمات" value={t.google_reviews_url} dir="ltr" full />
          <h2 className="section-title full">الحجز والعربون</h2>
          <F name="deposit_amount" label="العربون الافتراضي (ج.م)" value={t.deposit_amount} type="number" required />
          <F name="cancellation_window_hours" label="إلغاء مجاني قبل (ساعة)" value={t.cancellation_window_hours} type="number" required />
          <F name="min_notice_minutes" label="أقل مدة قبل الموعد (دقيقة)" value={t.min_notice_minutes} type="number" required />
          <F name="slot_step_minutes" label="فاصل المواعيد (دقيقة)" value={t.slot_step_minutes} type="number" required />
          <F name="booking_horizon_days" label="الحجز متاح لـ (يوم)" value={t.booking_horizon_days} type="number" required />
          <F name="hold_minutes" label="تثبيت الموعد أثناء الدفع (دقيقة)" value={t.hold_minutes} type="number" required />
          <B name="allow_pay_at_clinic" label="السماح بالدفع في العيادة" value={t.allow_pay_at_clinic} />
          <B name="allow_kiosk" label="السماح بالدفع في منفذ (رقم مرجعي)" value={t.allow_kiosk} />
          <h2 className="section-title full">التذكير على واتساب</h2>
          <F name="reminder_hour" label="ساعة إرسال تذكير اليوم السابق (٠–٢٣)" value={t.reminder_hour} type="number" required />
          <B name="reminder_2h_enabled" label="تذكير إضافي قبل الموعد بساعتين" value={t.reminder_2h_enabled} />
          <F name="whatsapp_phone_number_id" label="WhatsApp phone number ID" value={t.whatsapp_phone_number_id} dir="ltr" />
          <div className="full">
            <Save />
          </div>
        </form>
      ) : null}

      {tab === "services" ? (
        <div className="panel">
          {s.services(false).map((x) => (
            <details key={x.id} className="editor">
              <summary>
                <span>
                  {x.name_ar} · {x.duration_min} د · {x.price_is_from ? "من " : ""}
                  {x.price_egp} ج.م {x.active ? "" : <span className="badge">متوقفة</span>}
                </span>
                <span className="muted" style={{ fontSize: 13 }}>
                  تعديل
                </span>
              </summary>
              <form action={updateRowAction} className="form-grid">
                <BackField value={back} />
                <input type="hidden" name="table" value="services" />
                <input type="hidden" name="id" value={x.id} />
                <ServiceFields x={x} />
                <Save />
              </form>
            </details>
          ))}
          <details className="editor">
            <summary>+ خدمة جديدة</summary>
            <form action={insertRowAction} className="form-grid">
              <BackField value={back} />
              <input type="hidden" name="table" value="services" />
              <ServiceFields x={{ duration_min: 30, buffer_min: 0, price_egp: 0, active: 1, show_on_landing: 1, sort: 99 }} />
              <Save label="إضافة" />
            </form>
          </details>
        </div>
      ) : null}

      {tab === "doctors" ? <DoctorsTab tenantId={t.id} back={back} /> : null}

      {tab === "branches" ? (
        <div className="panel">
          {s.branches().map((b) => (
            <details key={b.id} className="editor">
              <summary>{b.name_ar}</summary>
              <form action={updateRowAction} className="form-grid">
                <BackField value={back} />
                <input type="hidden" name="table" value="branches" />
                <input type="hidden" name="id" value={b.id} />
                <F name="name_ar" label="الاسم" value={b.name_ar} required />
                <F name="name_en" label="Name" value={b.name_en} dir="ltr" required />
                <F name="district_ar" label="المنطقة" value={b.district_ar} required />
                <F name="district_en" label="District" value={b.district_en} dir="ltr" required />
                <F name="address_ar" label="العنوان" value={b.address_ar} required full />
                <F name="address_en" label="Address" value={b.address_en} dir="ltr" required full />
                <F name="lat" label="Latitude" value={b.lat} type="number" step="0.000001" dir="ltr" />
                <F name="lng" label="Longitude" value={b.lng} type="number" step="0.000001" dir="ltr" />
                <F name="google_place_id" label="Google Place ID" value={b.google_place_id} dir="ltr" />
                <F name="phone" label="تليفون الفرع" value={b.phone} dir="ltr" />
                <Save />
              </form>
            </details>
          ))}
          <p className="muted" style={{ fontSize: 14 }}>
            مواعيد عمل الأطباء في كل فرع بتتعدل من صفحة «الأطباء والجداول».
          </p>
        </div>
      ) : null}

      {tab === "reviews" ? (
        <div className="panel">
          {s.reviews().map((r) => (
            <details key={r.id} className="editor">
              <summary>
                <span>
                  {r.author} · {"★".repeat(r.rating)}
                </span>
              </summary>
              <form action={updateRowAction} className="form-grid">
                <BackField value={back} />
                <input type="hidden" name="table" value="reviews" />
                <input type="hidden" name="id" value={r.id} />
                <ReviewFields r={r} />
                <Save />
              </form>
              <form action={deleteRowAction}>
                <BackField value={back} />
                <input type="hidden" name="table" value="reviews" />
                <input type="hidden" name="id" value={r.id} />
                <button className="tb-btn sm danger" type="submit">
                  حذف التقييم
                </button>
              </form>
            </details>
          ))}
          <details className="editor">
            <summary>+ تقييم جديد (منقول من Google بنفس النص)</summary>
            <form action={insertRowAction} className="form-grid">
              <BackField value={back} />
              <input type="hidden" name="table" value="reviews" />
              <ReviewFields r={{ rating: 5, published_on: new Date().toISOString().slice(0, 10), sort: 99 }} />
              <Save label="إضافة" />
            </form>
          </details>
        </div>
      ) : null}

      {tab === "gallery" ? (
        <div className="panel">
          {s.gallery().map((g) => (
            <details key={g.id} className="editor">
              <summary>
                <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <img src={g.image_url} alt="" width={56} height={42} style={{ objectFit: "cover", borderRadius: 8 }} />
                  {g.title_ar}
                  {g.patient_consent ? <span className="badge ok">موافقة مكتوبة</span> : null}
                </span>
              </summary>
              <form action={updateRowAction} className="form-grid">
                <BackField value={back} />
                <input type="hidden" name="table" value="gallery_cases" />
                <input type="hidden" name="id" value={g.id} />
                <GalleryFields g={g} />
                <Save />
              </form>
              <form action={deleteRowAction}>
                <BackField value={back} />
                <input type="hidden" name="table" value="gallery_cases" />
                <input type="hidden" name="id" value={g.id} />
                <button className="tb-btn sm danger" type="submit">
                  حذف الصورة
                </button>
              </form>
            </details>
          ))}
          <details className="editor">
            <summary>+ صورة جديدة</summary>
            <form action={insertRowAction} className="form-grid">
              <BackField value={back} />
              <input type="hidden" name="table" value="gallery_cases" />
              <GalleryFields g={{ image_url: "/img/", sort: 99 }} />
              <Save label="إضافة" />
            </form>
          </details>
          <p className="muted" style={{ fontSize: 14 }}>
            صور المرضى (قبل وبعد) لازم يكون معاها موافقة مكتوبة من المريض قبل النشر.
          </p>
        </div>
      ) : null}

      {tab === "content" ? <ContentTab tenantId={t.id} back={back} /> : null}
    </>
  );
}

function ServiceFields({ x: row }: { x: object }) {
  const x = row as Record<string, V>;
  return (
    <>
      <F name="name_ar" label="اسم الخدمة" value={x.name_ar} required />
      <F name="name_en" label="Service name" value={x.name_en} dir="ltr" required />
      <F name="desc_ar" label="وصف قصير" value={x.desc_ar} full />
      <F name="desc_en" label="Short description" value={x.desc_en} dir="ltr" full />
      <F name="duration_min" label="المدة (دقيقة)" value={x.duration_min} type="number" required />
      <F name="buffer_min" label="وقت تجهيز بعدها (دقيقة)" value={x.buffer_min} type="number" required />
      <F name="price_egp" label="السعر (ج.م)" value={x.price_egp} type="number" required />
      <F name="deposit_egp" label="عربون مختلف (فاضي = الافتراضي، ٠ = بدون)" value={x.deposit_egp} type="number" />
      <F name="sort" label="الترتيب" value={x.sort} type="number" required />
      <B name="price_is_from" label="السعر «يبدأ من»" value={x.price_is_from} />
      <B name="show_on_landing" label="تظهر في الصفحة الرئيسية" value={x.show_on_landing} />
      <B name="active" label="متاحة للحجز" value={x.active} />
    </>
  );
}

function ReviewFields({ r: row }: { r: object }) {
  const r = row as Record<string, V>;
  return (
    <>
      <F name="author" label="اسم صاحب التقييم" value={r.author} required />
      <F name="author_en" label="Name (English)" value={r.author_en} dir="ltr" />
      <T name="text" label="النص (زي ما هو على Google)" value={r.text} />
      <T name="translation_en" label="English translation" value={r.translation_en} />
      <F name="rating" label="النجوم (١–٥)" value={r.rating} type="number" required />
      <F name="published_on" label="تاريخ النشر" value={r.published_on} type="date" required />
      <F name="sort" label="الترتيب" value={r.sort} type="number" required />
    </>
  );
}

function GalleryFields({ g: row }: { g: object }) {
  const g = row as Record<string, V>;
  return (
    <>
      <F name="title_ar" label="العنوان" value={g.title_ar} required />
      <F name="title_en" label="Title" value={g.title_en} dir="ltr" required />
      <F name="caption_ar" label="وصف" value={g.caption_ar} />
      <F name="caption_en" label="Caption" value={g.caption_en} dir="ltr" />
      <F name="image_url" label="رابط الصورة" value={g.image_url} dir="ltr" required />
      <F name="alt_ar" label="نص بديل للصورة" value={g.alt_ar} required />
      <F name="alt_en" label="Alt text" value={g.alt_en} dir="ltr" required />
      <F name="sort" label="الترتيب" value={g.sort} type="number" required />
      <B name="patient_consent" label="صورة مريض بموافقة مكتوبة" value={g.patient_consent} />
    </>
  );
}

function DoctorsTab({ tenantId, back }: { tenantId: number; back: string }) {
  const d = db();
  const s = scoped(d, tenantId);
  const ps = s.providerServices();
  const all = s.providers(false);
  const services = s.services(false);
  return (
    <div className="panel">
      {all.map((p) => {
        const offered = ps.filter((x) => x.provider_id === p.id).map((x) => x.service_id);
        return (
          <details key={p.id} className="editor">
            <summary>
              <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                {p.photo_url ? <img src={p.photo_url} alt="" width={36} height={36} style={{ borderRadius: "50%", objectFit: "cover", objectPosition: "top" }} /> : null}
                {p.name_ar} {p.active ? null : <span className="badge">غير نشط</span>}
              </span>
            </summary>
            <form action={updateRowAction} className="form-grid">
              <BackField value={back} />
              <input type="hidden" name="table" value="providers" />
              <input type="hidden" name="id" value={p.id} />
              <F name="name_ar" label="الاسم" value={p.name_ar} required />
              <F name="name_en" label="Name" value={p.name_en} dir="ltr" required />
              <F name="short_ar" label="الاسم المختصر" value={p.short_ar} required />
              <F name="short_en" label="Short name" value={p.short_en} dir="ltr" required />
              <F name="title_ar" label="التخصص والمؤهل" value={p.title_ar} required full />
              <F name="title_en" label="Title" value={p.title_en} dir="ltr" required full />
              <F name="specialty_ar" label="تخصص مختصر (للاستقبال)" value={p.specialty_ar} required />
              <F name="specialty_en" label="Specialty" value={p.specialty_en} dir="ltr" required />
              <F name="photo_url" label="رابط الصورة" value={p.photo_url} dir="ltr" />
              <F name="rating" label="التقييم" value={p.rating} type="number" step="0.1" />
              <F name="years_experience" label="سنين الخبرة" value={p.years_experience} type="number" />
              <F name="sort" label="الترتيب" value={p.sort} type="number" required />
              <B name="active" label="يظهر ومتاح للحجز" value={p.active} />
              <Save />
            </form>
            <form action={providerServicesAction} style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", paddingTop: 8 }}>
              <BackField value={back} />
              <input type="hidden" name="id" value={p.id} />
              <strong style={{ fontSize: 14 }}>الخدمات:</strong>
              {services.map((x) => (
                <label key={x.id} className="check-inline">
                  <input type="checkbox" name="service" value={x.id} defaultChecked={offered.includes(x.id)} /> {x.name_ar}
                </label>
              ))}
              <Save label="حفظ الخدمات" />
            </form>
          </details>
        );
      })}
      <details className="editor">
        <summary>+ طبيب جديد</summary>
        <form action={insertRowAction} className="form-grid">
          <BackField value={back} />
          <input type="hidden" name="table" value="providers" />
          <F name="name_ar" label="الاسم" required />
          <F name="name_en" label="Name" dir="ltr" required />
          <F name="short_ar" label="الاسم المختصر" required />
          <F name="short_en" label="Short name" dir="ltr" required />
          <F name="title_ar" label="التخصص والمؤهل" required full />
          <F name="title_en" label="Title" dir="ltr" required full />
          <F name="specialty_ar" label="تخصص مختصر" required />
          <F name="specialty_en" label="Specialty" dir="ltr" required />
          <F name="photo_url" label="رابط الصورة" dir="ltr" />
          <F name="sort" label="الترتيب" value={99} type="number" required />
          <input type="hidden" name="__has_active" value="1" />
          <input type="hidden" name="active" value="on" />
          <Save label="إضافة" />
        </form>
        <p className="muted" style={{ fontSize: 14 }}>
          بعد الإضافة: اختار الخدمات من هنا، وضيف الشيفتات من «الأطباء والجداول».
        </p>
      </details>
    </div>
  );
}

const CONTENT_KEYS: [string, string][] = [
  ["hero_title_1", "عنوان الصفحة (السطر الأول)"],
  ["hero_title_2", "عنوان الصفحة (السطر الملوّن)"],
  ["hero_sub", "النص تحت العنوان ({deposit} = قيمة العربون)"],
  ["services_intro", "مقدمة قسم الخدمات"],
  ["seo_title", "عنوان الصفحة في Google"],
  ["seo_description", "وصف الصفحة في Google"],
];

function ContentTab({ tenantId, back }: { tenantId: number; back: string }) {
  const content = scoped(db(), tenantId).content();
  return (
    <form action={contentAction} className="panel form-grid">
      <BackField value={back} />
      {CONTENT_KEYS.map(([key, label]) => (
        <fieldset key={key} className="full" style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          <input type="hidden" name="key" value={key} />
          <legend style={{ fontWeight: 800, marginBottom: 6 }}>{label}</legend>
          <label className="field">
            عربي
            <textarea name={`${key}_ar`} defaultValue={content[key]?.ar ?? ""} rows={2} />
          </label>
          <label className="field">
            English
            <textarea name={`${key}_en`} defaultValue={content[key]?.en ?? ""} rows={2} dir="ltr" />
          </label>
        </fieldset>
      ))}
      <div className="full">
        <Save />
      </div>
    </form>
  );
}
