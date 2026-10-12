// Demo seed: "عيادات بسمة لطب الأسنان" exactly as in the approved design. Idempotent: every row is
// keyed (slug / seed_key) and only inserted when missing. All names, numbers and photos are fictional.
import { get, run, transaction, type DB } from "@/lib/db";
import { encryptField, blindIndex, hashPassword, randomToken } from "@/lib/crypto";
import { addDays, utcToZoned, weekdayOf, zonedToUtc } from "@/booking-engine";

const TZ = "Africa/Cairo";
const OPEN_DAYS = [6, 0, 1, 2, 3, 4]; // Saturday – Thursday

export const DEMO_LOGINS = [
  { email: "owner@basma-dental.example", password: "Basma#Owner2026", role: "owner", name: "إدارة عيادات بسمة" },
  { email: "reception@basma-dental.example", password: "Basma#Desk2026", role: "receptionist", name: "نهى السيد" },
  { email: "dr.ahmed@basma-dental.example", password: "Basma#Doctor2026", role: "doctor", name: "د. أحمد سامي", provider: "ahmed" },
] as const;

const SERVICES = [
  { slug: "checkup", ar: "كشف وتشخيص", en: "Check-up & diagnosis", dar: "فحص شامل وأشعة بانوراما رقمية عند الحاجة", den: "Full examination with a digital panoramic X-ray when needed", dur: 30, buf: 0, price: 300, from: 0, landing: 1 },
  { slug: "scaling-polishing", ar: "تنظيف وتلميع", en: "Scaling & polishing", dar: "إزالة الجير والتصبغات بجهاز الألتراسونيك", den: "Ultrasonic removal of tartar and stains", dur: 45, buf: 15, price: 600, from: 0, landing: 1 },
  { slug: "cosmetic-filling", ar: "حشو تجميلي", en: "Cosmetic filling", dar: "حشو بلون السن الطبيعي يدوم سنين", den: "Tooth-coloured fillings that last for years", dur: 45, buf: 15, price: 800, from: 1, landing: 1 },
  { slug: "root-canal", ar: "علاج العصب", en: "Root canal treatment", dar: "بالجهاز الروتاري على جلسة أو اتنين", den: "Rotary root canal treatment in one or two visits", dur: 60, buf: 15, price: 1500, from: 1, landing: 1 },
  { slug: "orthodontics", ar: "تقويم الأسنان", en: "Orthodontics", dar: "تقويم معدني أو شفاف مع متابعة شهرية", den: "Metal braces or clear aligners with monthly follow-up", dur: 30, buf: 0, price: 25000, from: 1, landing: 1 },
  { slug: "dental-implants", ar: "زراعة الأسنان", en: "Dental implants", dar: "زرعات ألماني وكوري مع ضمان مكتوب", den: "German and Korean implants with a written warranty", dur: 60, buf: 15, price: 12000, from: 1, landing: 1 },
  { slug: "ortho-follow-up", ar: "متابعة تقويم", en: "Orthodontic follow-up", dar: "زيارة متابعة وضبط التقويم", den: "Follow-up and adjustment visit", dur: 30, buf: 0, price: 400, from: 0, landing: 0 },
];

const DOCTORS = [
  {
    slug: "ahmed", ar: "د. أحمد سامي", en: "Dr. Ahmed Samy", sar: "د. أحمد", sen: "Dr. Ahmed",
    tar: "استشاري تقويم الأسنان · ماجستير جامعة القاهرة", ten: "Orthodontics consultant · MSc, Cairo University",
    spar: "تقويم", spen: "Orthodontics", gender: "m", photo: "/img/doc-ahmed.jpg", rating: 4.9, years: 14,
    services: ["checkup", "orthodontics", "ortho-follow-up"],
    hours: [ [6, "nasr-city", 16, 21], [1, "new-cairo", 17, 22], [3, "nasr-city", 16, 21] ],
  },
  {
    slug: "mariam", ar: "د. مريم عادل", en: "Dr. Mariam Adel", sar: "د. مريم", sen: "Dr. Mariam",
    tar: "أخصائية تجميل الأسنان والفينير", ten: "Cosmetic dentistry & veneers specialist",
    spar: "تجميل", spen: "Cosmetic", gender: "f", photo: "/img/doc-mariam.jpg", rating: 5.0, years: 9,
    services: ["checkup", "scaling-polishing", "cosmetic-filling"],
    hours: [ [0, "nasr-city", 16, 21], [2, "nasr-city", 16, 21], [4, "nasr-city", 16, 21] ],
  },
  {
    slug: "hany", ar: "د. هاني فؤاد", en: "Dr. Hany Fouad", sar: "د. هاني", sen: "Dr. Hany",
    tar: "استشاري زراعة وجراحة الفم · ٢٥ سنة خبرة", ten: "Implants & oral surgery consultant · 25 years' experience",
    spar: "زراعة", spen: "Implants", gender: "m", photo: "/img/doc-hany.jpg", rating: 4.8, years: 25,
    services: ["checkup", "root-canal", "dental-implants"],
    hours: [ [1, "new-cairo", 17, 22], [4, "nasr-city", 16, 21] ],
  },
] as const;

const BRANCHES = [
  { slug: "nasr-city", ar: "فرع مدينة نصر", en: "Nasr City branch", dar: "مدينة نصر", den: "Nasr City", aar: "١٢ شارع عباس العقاد، الدور الثالث", aen: "12 Abbas El-Akkad St, 3rd floor", lat: 30.0596, lng: 31.3434, open: 12, close: 22 },
  { slug: "new-cairo", ar: "فرع التجمع الخامس", en: "Fifth Settlement branch", dar: "التجمع الخامس", den: "Fifth Settlement", aar: "شارع التسعين الشمالي، مبنى ٤٥", aen: "North 90th St, building 45", lat: 30.0285, lng: 31.4705, open: 14, close: 23 },
];

const REVIEWS = [
  { author: "منى خالد", en: "Mona Khaled", daysAgo: 14, text: "الحجز أونلاين سهل جدًا، ودخلت في ميعادي بالظبط. د. مريم شاطرة ومريحة.", tr: "Booking online was really easy and I went in exactly on time. Dr. Mariam is skilled and gentle." },
  { author: "كريم حسن", en: "Karim Hassan", daysAgo: 30, text: "عملت زراعة مع د. هاني، شرح كل خطوة والأسعار كانت واضحة من الأول.", tr: "I had an implant with Dr. Hany. He explained every step and the prices were clear from the start." },
  { author: "سارة إبراهيم", en: "Sara Ibrahim", daysAgo: 90, text: "رسالة التذكير على واتساب أنقذتني، كنت ناسية الميعاد خالص!", tr: "The WhatsApp reminder saved me, I had completely forgotten the appointment!" },
];

const CONTENT: Record<string, [string, string]> = {
  hero_title_1: ["ابتسامة صحية وجميلة،", "A healthy, beautiful smile,"],
  hero_title_2: ["وموعدك في دقيقة", "booked in a minute"],
  hero_sub: [
    "اختار الخدمة والدكتور والوقت المناسب، وثبّت حجزك بعربون {deposit} بالكارت أو فودافون كاش. هنفكّرك على واتساب قبلها بيوم.",
    "Pick the service, the doctor and a time that suits you, then secure it with a {deposit} deposit by card or Vodafone Cash. We'll remind you on WhatsApp the day before.",
  ],
  services_intro: [
    "كل خدمة ليها مدة محددة، فالمواعيد اللي بتظهر لك مظبوطة على وقت الدكتور.",
    "Every service has a set duration, so the times you see match the doctor's real schedule.",
  ],
  seo_title: ["عيادات بسمة لطب الأسنان في مدينة نصر والتجمع | احجز أونلاين", "Basma Dental Clinics in Nasr City & New Cairo | Book online"],
  seo_description: [
    "احجز كشف أسنان، تقويم، زراعة أو تجميل مع أطباء بسمة في مدينة نصر والتجمع الخامس. مواعيد حقيقية، عربون ٢٠٠ ج.م، وتذكير على واتساب.",
    "Book a dental check-up, braces, implants or cosmetic dentistry with Basma's dentists in Nasr City and the Fifth Settlement. Live availability, EGP 200 deposit, WhatsApp reminders.",
  ],
};

// Reception design: today's schedule at Nasr City. state: ok = confirmed on WhatsApp + deposit; pending = reminder sent, no reply.
const TODAY: [doctor: string, time: string, patient: string, phone: string, service: string, label: string | null, state: "ok" | "pending" | "cancelled"][] = [
  ["ahmed", "16:00", "منى خالد", "01012345678", "orthodontics", "تركيب تقويم شفاف", "ok"],
  ["ahmed", "16:30", "يوسف عماد", "01023456789", "ortho-follow-up", null, "pending"],
  ["ahmed", "17:30", "عمر شريف", "01034567891", "ortho-follow-up", null, "cancelled"],
  ["ahmed", "18:00", "نادين أشرف", "01145678912", "checkup", null, "ok"],
  ["mariam", "16:00", "سارة إبراهيم", "01256789123", "cosmetic-filling", null, "ok"],
  ["mariam", "17:00", "دينا فاروق", "01067891234", "scaling-polishing", "تبييض بالليزر", "ok"],
  ["mariam", "18:30", "خالد منصور", "01178912345", "cosmetic-filling", "فينير · قياس", "pending"],
  ["hany", "17:00", "كريم حسن", "01289123456", "dental-implants", "زراعة · مرحلة ٢", "ok"],
  ["hany", "19:00", "سمير لطفي", "01590123456", "root-canal", "علاج عصب", "pending"],
];

const WAITLIST = [
  { name: "ياسمين طارق", phone: "01111223344", service: "ortho-follow-up", doctor: null, weekdays: null, after: 17 * 60, note: "أي وقت بعد ٥" },
  { name: "محمود رضا", phone: "01222334455", service: null, doctor: "mariam", weekdays: null, after: null, note: "د. مريم فقط" },
  { name: "هبة مصطفى", phone: "01533445566", service: null, doctor: null, weekdays: "4", after: null, note: "الخميس" },
];

const FIRST = ["أحمد", "محمد", "مصطفى", "عمرو", "حسام", "شريف", "ياسر", "تامر", "وليد", "إسلام", "نورا", "ريم", "هالة", "منة", "آية", "شيماء", "دعاء", "مروة", "رحاب", "نهال"];
const LAST = ["عبد الله", "حسن", "إبراهيم", "السيد", "منصور", "فهمي", "الشناوي", "عزت", "رشاد", "جلال", "سليمان", "عثمان"];

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const toE164 = (local: string) => `+20${local.slice(1)}`;
const hm = (s: string) => {
  const [h, m] = s.split(":").map(Number) as [number, number];
  return h * 60 + m;
};

/** First day (today or later) the clinic is open, skipping today once the afternoon schedule has started. */
export function demoDay(now: Date): string {
  const local = utcToZoned(now, TZ);
  let d = local.minutes < 16 * 60 ? local.date : addDays(local.date, 1);
  while (!OPEN_DAYS.includes(weekdayOf(d))) d = addDays(d, 1);
  return d;
}

export function resetDemo(db: DB) {
  run(db, "DELETE FROM tenants WHERE slug = 'basma'");
}

export function seedDemo(db: DB, now: Date = new Date()) {
  return transaction(db, () => seedInner(db, now));
}

function seedInner(db: DB, now: Date) {
  const today = utcToZoned(now, TZ).date;
  let tenant = get<{ id: number }>(db, "SELECT id FROM tenants WHERE slug = 'basma'");
  if (!tenant) {
    const id = run(
      db,
      `INSERT INTO tenants (slug, name_ar, name_en, short_name_ar, short_name_en, tagline_ar, tagline_en, primary_color, ref_prefix, vertical, timezone,
         phone, whatsapp, email, google_rating, google_reviews_count, google_reviews_url, years_experience, deposit_amount, deposits_enabled_at,
         allow_pay_at_clinic, allow_kiosk, cancellation_window_hours, min_notice_minutes, slot_step_minutes, booking_horizon_days, hold_minutes,
         reminder_hour, reminder_2h_enabled, demo)
       VALUES ('basma', 'عيادات بسمة لطب الأسنان', 'Basma Dental Clinics', 'بسمة', 'Basma', 'عيادات طب وتجميل الأسنان', 'Dental & cosmetic dentistry clinics',
         '#1458C2', 'BS', 'dental', ?, '01001234567', '01001234567', 'info@basma-dental.example', 4.9, 312,
         'https://www.google.com/maps/search/?api=1&query=Basma+Dental+Clinics', 12, 200, ?, 1, 1, 24, 60, 30, 21, 10, 18, 0, 1)`,
      TZ,
      zonedToUtc(addDays(today, -75), 0, TZ).toISOString(),
    ).id;
    tenant = { id };
  }
  const T = tenant.id;

  const branchId: Record<string, number> = {};
  BRANCHES.forEach((b, i) => {
    let row = get<{ id: number }>(db, "SELECT id FROM branches WHERE tenant_id = ? AND slug = ?", T, b.slug);
    if (!row) {
      row = {
        id: run(
          db,
          `INSERT INTO branches (tenant_id, slug, name_ar, name_en, district_ar, district_en, address_ar, address_en, lat, lng, phone, sort)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          T, b.slug, b.ar, b.en, b.dar, b.den, b.aar, b.aen, b.lat, b.lng, "01001234567", i,
        ).id,
      };
      for (const wd of OPEN_DAYS) run(db, "INSERT INTO branch_hours (tenant_id, branch_id, weekday, open_min, close_min) VALUES (?,?,?,?,?)", T, row.id, wd, b.open * 60, b.close * 60);
    }
    branchId[b.slug] = row.id;
  });

  const serviceId: Record<string, number> = {};
  SERVICES.forEach((s, i) => {
    let row = get<{ id: number }>(db, "SELECT id FROM services WHERE tenant_id = ? AND slug = ?", T, s.slug);
    if (!row)
      row = {
        id: run(
          db,
          `INSERT INTO services (tenant_id, slug, name_ar, name_en, desc_ar, desc_en, duration_min, buffer_min, price_egp, price_is_from, show_on_landing, sort)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          T, s.slug, s.ar, s.en, s.dar, s.den, s.dur, s.buf, s.price, s.from, s.landing, i,
        ).id,
      };
    serviceId[s.slug] = row.id;
  });

  const providerId: Record<string, number> = {};
  DOCTORS.forEach((d, i) => {
    let row = get<{ id: number }>(db, "SELECT id FROM providers WHERE tenant_id = ? AND slug = ?", T, d.slug);
    if (!row) {
      row = {
        id: run(
          db,
          `INSERT INTO providers (tenant_id, slug, name_ar, name_en, short_ar, short_en, title_ar, title_en, specialty_ar, specialty_en, gender, photo_url, rating, years_experience, sort)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          T, d.slug, d.ar, d.en, d.sar, d.sen, d.tar, d.ten, d.spar, d.spen, d.gender, d.photo, d.rating, d.years, i,
        ).id,
      };
      for (const s of d.services) run(db, "INSERT INTO provider_services (provider_id, service_id) VALUES (?,?)", row.id, serviceId[s]!);
      const branches = new Set<string>();
      for (const [wd, b, from, to] of d.hours) {
        run(db, "INSERT INTO working_hours (tenant_id, provider_id, branch_id, weekday, start_min, end_min) VALUES (?,?,?,?,?,?)", T, row.id, branchId[b]!, wd, from * 60, to * 60);
        branches.add(b);
      }
      for (const b of branches) run(db, "INSERT INTO provider_branches (provider_id, branch_id) VALUES (?,?)", row.id, branchId[b]!);
    }
    providerId[d.slug] = row.id;
  });

  if (!get(db, "SELECT 1 FROM gallery_cases WHERE tenant_id = ?", T)) {
    run(db, `INSERT INTO gallery_cases (tenant_id, title_ar, title_en, caption_ar, caption_en, image_url, alt_ar, alt_en, patient_consent, sort) VALUES (?,?,?,?,?,?,?,?,1,0)`,
      T, "تبييض بالليزر + فينير للأمامية", "Laser whitening + front veneers", "جلستين · مع د. مريم عادل", "Two sessions · with Dr. Mariam Adel", "/img/smile.jpg", "ابتسامة بعد التبييض", "Smile after whitening");
    run(db, `INSERT INTO gallery_cases (tenant_id, title_ar, title_en, caption_ar, caption_en, image_url, alt_ar, alt_en, patient_consent, sort) VALUES (?,?,?,?,?,?,?,?,0,1)`,
      T, "غرف علاج معقمة ومجهزة بالكامل", "Sterile, fully equipped treatment rooms", "أشعة رقمية بانوراما داخل العيادة", "In-house digital panoramic X-ray", "/img/clinic-room.jpg", "غرفة العلاج", "Treatment room");
  }
  if (!get(db, "SELECT 1 FROM reviews WHERE tenant_id = ?", T))
    REVIEWS.forEach((r, i) =>
      run(db, "INSERT INTO reviews (tenant_id, author, author_en, text, text_lang, translation_en, rating, source, published_on, sort) VALUES (?,?,?,?, 'ar', ?, 5, 'google', ?, ?)",
        T, r.author, r.en, r.text, r.tr, addDays(today, -r.daysAgo), i),
    );
  for (const [key, [ar, en]] of Object.entries(CONTENT))
    run(db, "INSERT INTO content_blocks (tenant_id, key, value_ar, value_en) VALUES (?,?,?,?) ON CONFLICT (tenant_id, key) DO NOTHING", T, key, ar, en);

  for (const u of DEMO_LOGINS) {
    if (get(db, "SELECT 1 FROM users WHERE email = ?", u.email)) continue;
    run(db, "INSERT INTO users (tenant_id, name, email, password_hash, role, provider_id) VALUES (?,?,?,?,?,?)",
      T, u.name, u.email, hashPassword(u.password), u.role, "provider" in u ? providerId[u.provider]! : null);
  }

  // ---- patients & appointments ----
  const patientIds = new Map<string, number>();
  const patient = (name: string, local: string) => {
    const e164 = toE164(local);
    const cached = patientIds.get(e164);
    if (cached) return cached;
    const hash = blindIndex(e164);
    let row = get<{ id: number }>(db, "SELECT id FROM patients WHERE tenant_id = ? AND phone_hash = ?", T, hash);
    if (!row) row = { id: run(db, "INSERT INTO patients (tenant_id, name, phone_enc, phone_hash, phone_last4, lang) VALUES (?,?,?,?,?, 'ar')", T, name, encryptField(e164), hash, e164.slice(-4)).id };
    patientIds.set(e164, row.id);
    return row.id;
  };

  const svc = (slug: string) => SERVICES.find((s) => s.slug === slug)!;
  const insertAppt = (a: {
    key: string; date: string; startMin: number; doctor: string; branch: string; service: string; patientId: number;
    status: string; source: string; label?: string | null; depositPaid?: boolean; confirmedAt?: string | null;
    reminderSentAt?: string | null; cancelledAt?: string | null; cancelReason?: string | null; checkedInAt?: string | null;
  }) => {
    if (get(db, "SELECT 1 FROM appointments WHERE tenant_id = ? AND seed_key = ?", T, a.key)) return null;
    const s = svc(a.service);
    const start = zonedToUtc(a.date, a.startMin, TZ);
    const end = new Date(start.getTime() + s.dur * 60_000);
    const blockEnd = new Date(end.getTime() + s.buf * 60_000);
    const token = randomToken();
    const deposit = a.depositPaid ? 200 : 0;
    const depositStatus = a.depositPaid ? (a.status === "cancelled" ? "forfeited" : a.status === "no_show" ? "forfeited" : "paid") : "none";
    let id: number;
    try {
      id = run(
        db,
        `INSERT INTO appointments (tenant_id, ref, public_token, branch_id, provider_id, service_id, patient_id, start_utc, end_utc, block_end_utc, status, source,
           pay_method, deposit_amount, deposit_status, patient_confirmed_at, visit_label, reminder_day_sent_at, checked_in_at, cancelled_at, cancelled_by, cancel_reason, seed_key, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        T, `tmp_${token}`, token, branchId[a.branch]!, providerId[a.doctor]!, serviceId[a.service]!, a.patientId,
        start.toISOString(), end.toISOString(), blockEnd.toISOString(), a.status, a.source,
        a.depositPaid ? (a.source === "web" ? "card" : "wallet") : "clinic", deposit, depositStatus,
        a.confirmedAt ?? null, a.label ?? null, a.reminderSentAt ?? null, a.checkedInAt ?? null,
        a.cancelledAt ?? null, a.cancelledAt ? "patient" : null, a.cancelReason ?? null, a.key,
        new Date(start.getTime() - 3 * 86_400_000).toISOString(),
      ).id;
    } catch (err) {
      if (/SLOT_TAKEN/.test((err as Error).message)) return null; // never double-book demo data either
      throw err;
    }
    run(db, "UPDATE appointments SET ref = ? WHERE id = ?", `BS-${20000 + id}`, id);
    if (a.depositPaid)
      run(db, "INSERT INTO payments (tenant_id, appointment_id, method, amount_cents, status, provider_ref, provider_order_id, created_at) VALUES (?,?,?,?,?,?,?,?)",
        T, id, a.source === "web" ? "card" : "wallet", 20000, "paid", `seed_txn_${id}`, `seed_${id}`, new Date(start.getTime() - 3 * 86_400_000).toISOString());
    return id;
  };

  // Today's schedule from the reception design (on the next clinic day if the afternoon has started).
  const day = demoDay(now);
  const nowIso = now.toISOString();
  for (const [doctor, time, name, phone, service, label, state] of TODAY) {
    const id = insertAppt({
      key: `demo:${day}:${doctor}:${time}`, date: day, startMin: hm(time), doctor, branch: "nasr-city", service,
      patientId: patient(name, phone), status: state === "cancelled" ? "cancelled" : "confirmed", source: state === "pending" ? "reception" : "web",
      label, depositPaid: state !== "pending", confirmedAt: state === "ok" ? nowIso : null, reminderSentAt: nowIso,
      cancelledAt: state === "cancelled" ? zonedToUtc(day <= utcToZoned(now, TZ).date ? day : utcToZoned(now, TZ).date, 11 * 60, TZ).toISOString() : null,
      cancelReason: state === "cancelled" ? "patient_called" : null,
    });
    if (id && state !== "cancelled") {
      const a = get<{ public_token: string }>(db, "SELECT public_token FROM appointments WHERE id = ?", id)!;
      const first = name.split(" ")[0];
      const time12 = `${Number(time.split(":")[0]) - 12}:${time.split(":")[1]}`.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]!);
      run(db, `INSERT INTO message_log (tenant_id, appointment_id, patient_id, channel, template, recipient, lang, body, buttons, status, provider_message_id)
               VALUES (?,?,?, 'whatsapp', 'reminder_day_before', ?, 'ar', ?, ?, 'simulated', ?)`,
        T, id, patient(name, phone), `+2010•••••${phone.slice(-3)}`,
        `أهلًا ${first}، تذكير بموعدك بكرة الساعة ${time12} م مع ${DOCTORS.find((d) => d.slug === doctor)!.ar} في عيادات بسمة، فرع مدينة نصر.`,
        JSON.stringify([{ id: `appt:${a.public_token}:confirm`, title: "تأكيد" }, { id: `appt:${a.public_token}:cancel`, title: "إلغاء" }]),
        `sim_seed_${id}`);
    }
  }

  // Waiting list and walk-in from the design.
  if (!get(db, "SELECT 1 FROM waitlist_entries WHERE tenant_id = ?", T))
    WAITLIST.forEach((w, i) =>
      run(db, `INSERT INTO waitlist_entries (tenant_id, patient_id, provider_id, service_id, branch_id, date_from, date_to, weekdays, after_min, pref_note, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        T, patient(w.name, w.phone), w.doctor ? providerId[w.doctor]! : null, w.service ? serviceId[w.service]! : null, branchId["nasr-city"]!,
        today, addDays(today, 21), w.weekdays, w.after, w.note, new Date(now.getTime() - (10 - i) * 3_600_000).toISOString()),
    );
  if (!get(db, "SELECT 1 FROM walk_ins WHERE tenant_id = ? AND seed_key = ?", T, `walkin:${day}`))
    run(db, "INSERT INTO walk_ins (tenant_id, branch_id, name, note, arrived_at, seed_key) VALUES (?,?,?,?,?,?)",
      T, branchId["nasr-city"]!, "علي حسين", "ألم ضرس · طوارئ", zonedToUtc(day, 16 * 60 + 10, TZ).toISOString(), `walkin:${day}`);

  // Generated history (for the monthly report) and upcoming bookings (so the booking flow shows taken slots).
  const rnd = mulberry32(20417);
  const fake = () => {
    const n = `${FIRST[Math.floor(rnd() * FIRST.length)]} ${LAST[Math.floor(rnd() * LAST.length)]}`;
    const phone = `01${["0", "1", "2", "5"][Math.floor(rnd() * 4)]}${String(Math.floor(rnd() * 1e8)).padStart(8, "0")}`;
    return { n, phone };
  };
  const pivot = addDays(today, -75);
  for (let offset = -120; offset <= 14; offset++) {
    const date = addDays(today, offset);
    if (offset === 0 || date === day) continue;
    for (const d of DOCTORS) {
      for (const [wd, branch, from, to] of d.hours) {
        if (weekdayOf(date) !== wd) continue;
        const slots: number[] = [];
        for (let m = from * 60; m + 60 <= to * 60; m += 60) slots.push(m);
        const take = offset > 0 ? 2 + Math.floor(rnd() * 2) : 3 + Math.floor(rnd() * 3);
        const chosen = slots.sort(() => rnd() - 0.5).slice(0, take);
        for (const m of chosen) {
          const service = d.services[Math.floor(rnd() * d.services.length)]!;
          const after = date >= pivot;
          const web = rnd() < (after ? 0.55 : 0.3);
          let status = "confirmed";
          if (offset < 0) {
            const r = rnd();
            const noShow = after ? (web ? 0.03 : 0.07) : 0.16;
            status = r < noShow ? "no_show" : r < noShow + 0.06 ? "cancelled" : "completed";
          }
          const p = fake();
          const fromWaitlist = offset < 0 && after && status === "completed" && rnd() < 0.08;
          insertAppt({
            key: `gen:${date}:${d.slug}:${m}`, date, startMin: m, doctor: d.slug, branch, service, patientId: patient(p.n, p.phone),
            status, source: fromWaitlist ? "waitlist" : web ? "web" : "reception",
            depositPaid: after && web && !fromWaitlist, confirmedAt: offset < 0 || rnd() < 0.5 ? nowIso : null,
            reminderSentAt: offset <= 1 ? nowIso : null,
            cancelledAt: status === "cancelled" ? zonedToUtc(addDays(date, -1), 12 * 60, TZ).toISOString() : null,
            cancelReason: status === "cancelled" ? "patient_called" : null,
            checkedInAt: status === "completed" ? zonedToUtc(date, m - 5, TZ).toISOString() : null,
          });
        }
      }
    }
  }
  return { tenantId: T, demoDay: day };
}
