import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { MapEmbed } from "@/components/site/MapEmbed";
import { SiteFooter, SiteHeader, alternates } from "@/components/site/chrome";
import { DICT } from "@/i18n/dict";
import { digits, fmtDateShort, fmtDuration, fmtMoney, fmtNumber, fmtOpeningHours, fmtPrice, fmtRating, fmtTime, fmtWeekdays, relativeDay } from "@/i18n/format";
import { catalog, nextAvailable } from "@/clinic/site";
import { scoped } from "@/clinic/repo";
import { clinicJsonLd, JsonLd } from "@/clinic/seo";
import { L, type Lang } from "@/clinic/types";
import { addDays, todayIn } from "@/booking-engine";
import { db } from "@/server/db";
import { href, siteContext } from "@/server/tenant";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  const ctx = await siteContext(lang);
  const content = scoped(db(), ctx.tenant.id).content();
  const title = content.seo_title?.[ctx.lang] ?? L(ctx.tenant, "name", ctx.lang);
  const description = content.seo_description?.[ctx.lang] ?? "";
  return {
    title,
    description,
    alternates: alternates(ctx, "/"),
    openGraph: { title, description, type: "website", locale: lang === "ar" ? "ar_EG" : "en_US", images: ["/img/clinic-room.jpg"] },
  };
}

function reviewAge(published: string, today: string, lang: Lang) {
  const days = Math.round((Date.parse(today) - Date.parse(published)) / 86_400_000);
  const ar = lang === "ar";
  if (days < 7) return ar ? `من ${digits(Math.max(days, 1), lang)} أيام` : `${Math.max(days, 1)} days ago`;
  if (days < 14) return ar ? "من أسبوع" : "a week ago";
  if (days < 21) return ar ? "من أسبوعين" : "2 weeks ago";
  if (days < 28) return ar ? "من ٣ أسابيع" : "3 weeks ago";
  const months = Math.round(days / 30);
  if (months <= 1) return ar ? "من شهر" : "a month ago";
  if (months === 2) return ar ? "من شهرين" : "2 months ago";
  if (months < 12) return ar ? `من ${digits(months, lang)} شهور` : `${months} months ago`;
  return ar ? "من سنة" : "a year ago";
}

export default async function Landing({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const ctx = await siteContext(lang);
  const { tenant } = ctx;
  const L_ = ctx.lang;
  const t = DICT[L_];
  const d = db();
  const s = scoped(d, tenant.id);
  const cat = catalog(d, tenant);
  const content = s.content();
  const reviews = s.reviews();
  const gallery = s.gallery();
  const now = new Date();
  const today = todayIn(tenant.timezone, now);
  const next = nextAvailable(d, tenant, cat, now);
  const deposit = fmtMoney(tenant.deposit_amount, L_);
  const districts = cat.branches.map((b) => L(b, "district", L_));
  const branchesLabel = districts.length > 1 ? districts.slice(0, -1).join("، ") + t.and + districts[districts.length - 1] : (districts[0] ?? "");
  const c = (key: string, fallback = "") => content[key]?.[L_] ?? fallback;
  const landingServices = cat.services.filter((x) => x.show_on_landing);
  const pageUrl = `${ctx.origin}${href(ctx, "/")}`;
  const trustIcons = ["calendar", "card", "chat", "pin"] as const;
  const firstBranch = cat.branches[0];

  return (
    <>
      <SiteHeader ctx={ctx} />
      <main id="main">
        <section className="container hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            {tenant.google_rating ? (
              <div className="rating-badge">
                <span className="stars" aria-hidden="true">
                  ★★★★★
                </span>
                {t.ratingBadge(fmtRating(tenant.google_rating, L_), fmtNumber(tenant.google_reviews_count ?? 0, L_))}
              </div>
            ) : null}
            <h1 id="hero-title">
              {c("hero_title_1")}
              <br />
              <span className="accent">{c("hero_title_2")}</span>
            </h1>
            <p className="hero-sub">{c("hero_sub").replace("{deposit}", deposit)}</p>
            <div className="hero-ctas">
              <Link prefetch={false} className="btn btn-primary btn-lg" href={href(ctx, "/book")}>
                {t.bookNow}
              </Link>
              {tenant.whatsapp ? (
                <a className="btn btn-outline btn-lg" href={`https://wa.me/20${tenant.whatsapp.replace(/^0/, "")}`} rel="noopener">
                  <Icon name="chat" size={20} stroke="#1E7A4A" />
                  {t.whatsapp} <span dir="ltr">{digits(tenant.whatsapp, L_)}</span>
                </a>
              ) : null}
            </div>
            <form className="quick-card" action={href(ctx, "/book")} method="get" aria-labelledby="quick-title">
              <div className="quick-title" id="quick-title">
                {t.quick.title}
              </div>
              <label className="field">
                {t.quick.service}
                <select name="service" defaultValue={cat.services[0]?.id}>
                  {cat.services.map((x) => (
                    <option key={x.id} value={x.id}>
                      {L(x, "name", L_)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                {t.quick.branch}
                <select name="branch" defaultValue={firstBranch?.id}>
                  {cat.branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {L(b, "district", L_)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                {t.quick.date}
                <select name="date" defaultValue="">
                  <option value="">{t.quick.anyDate}</option>
                  {Array.from({ length: 7 }, (_, i) => addDays(today, i)).map((dt) => (
                    <option key={dt} value={dt}>
                      {i18nDay(dt, today, L_)}
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn btn-primary" type="submit">
                {t.quick.submit}
              </button>
            </form>
            <div className="hero-stats">
              {tenant.years_experience ? (
                <div>
                  <strong>+{digits(tenant.years_experience, L_)}</strong>
                  <span>{t.stats.years}</span>
                </div>
              ) : null}
              <div>
                <strong>{digits(cat.providers.length, L_)}</strong>
                <span>{t.stats.doctors}</span>
              </div>
              <div>
                <strong>{digits(cat.branches.length, L_)}</strong>
                <span>{t.stats.branches(cat.branches.length)}</span>
              </div>
            </div>
          </div>
          <div className="hero-media">
            <Image
              className="hero-img"
              src="/img/clinic-room.jpg"
              alt={L_ === "ar" ? `غرفة الكشف في ${tenant.name_ar}` : `Treatment room at ${tenant.name_en}`}
              width={1200}
              height={960}
              priority
              sizes="(max-width: 860px) 100vw, 560px"
            />
            <div className="next-card">
              {next ? (
                <>
                  {next.provider.photo_url ? <Image src={next.provider.photo_url} alt="" width={96} height={96} /> : null}
                  <div className="txt">
                    <strong>{t.nextSlot}</strong>
                    <span>
                      {L(next.provider, "name", L_)} · {relativeDay(next.date, today, L_)} {fmtTime(next.startMin, L_)}
                    </span>
                  </div>
                  <Link prefetch={false}
                    className="btn btn-tint"
                    href={`${href(ctx, "/book")}?service=${next.service.id}&provider=${next.provider.id}&branch=${next.branch.id}&date=${next.date}&start=${encodeURIComponent(next.start)}`}
                    aria-label={`${t.nextSlotBook}: ${L(next.provider, "name", L_)} ${fmtTime(next.startMin, L_)}`}
                  >
                    {t.nextSlotBook}
                  </Link>
                </>
              ) : (
                <Link prefetch={false} className="btn btn-tint" href={href(ctx, "/book")}>
                  {t.noSlot}
                </Link>
              )}
            </div>
          </div>
        </section>

        <section className="trust" aria-label={L_ === "ar" ? "مميزات الحجز" : "Why book with us"}>
          <div className="container">
            {t.trust.map(([title, sub], i) => (
              <div className="trust-item" key={i}>
                <Icon name={trustIcons[i]!} size={26} stroke="var(--on-dark-icon)" />
                <div>
                  <strong>{title.replace("{branches}", branchesLabel)}</strong>
                  <span>{sub.replace("{deposit}", deposit)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="services" className="container section section-first" aria-labelledby="services-title">
          <div className="section-head">
            <h2 id="services-title">{t.servicesTitle}</h2>
            <p>{c("services_intro")}</p>
          </div>
          <div className="grid grid-services">
            {landingServices.map((x, i) => (
              <Link prefetch={false} key={x.id} className="card service-card" href={firstBranch ? href(ctx, `/services/${x.slug}/${firstBranch.slug}`) : href(ctx, "/book")}>
                <span className="service-num" aria-hidden="true">
                  {digits(i + 1, L_)}
                </span>
                <h3>{L(x, "name", L_)}</h3>
                <p>{L(x, "desc", L_)}</p>
                <span className="service-meta">
                  <span className="muted">{fmtDuration(x.duration_min, L_)}</span>
                  <span className="price">{fmtPrice(x.price_egp, x.price_is_from, L_)}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section id="doctors" className="container section" aria-labelledby="doctors-title">
          <h2 id="doctors-title">{t.doctorsTitle}</h2>
          <div className="grid grid-doctors">
            {cat.providers.map((p) => (
              <article key={p.id} className="card doctor-card">
                {p.photo_url ? <Image className="photo" src={p.photo_url} alt={L(p, "name", L_)} width={600} height={600} sizes="(max-width: 640px) 100vw, 380px" /> : null}
                <div className="body">
                  <div className="title-row">
                    <h3>{L(p, "name", L_)}</h3>
                    {p.rating ? (
                      <span className="chip chip-rating">
                        <span aria-hidden="true">★ </span>
                        <span className="sr-only">{L_ === "ar" ? "التقييم" : "Rating"} </span>
                        {fmtRating(p.rating, L_)}
                      </span>
                    ) : null}
                  </div>
                  <div className="role">{L(p, "title", L_)}</div>
                  <div className="days">{fmtWeekdays(p.weekdays, L_)}</div>
                  <div className="btn-wrap">
                    <Link prefetch={false} className="btn btn-tint btn-block" href={`${href(ctx, "/book")}?provider=${p.id}`}>
                      {t.bookWith(L(p, "short", L_))}
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="gallery" className="container section" aria-labelledby="gallery-title">
          <h2 id="gallery-title">{t.galleryTitle}</h2>
          <div className="grid grid-gallery">
            {gallery.map((g) => (
              <figure key={g.id} className="card gallery-card" style={{ margin: 0 }}>
                <Image src={g.image_url} alt={L(g, "alt", L_)} width={800} height={600} sizes="(max-width: 760px) 100vw, 580px" />
                <figcaption className="cap">
                  <strong>{L(g, "title", L_)}</strong>
                  <span>{L(g, "caption", L_)}</span>
                </figcaption>
              </figure>
            ))}
          </div>
          {gallery.some((g) => g.patient_consent) ? <div className="note">{t.consentNote}</div> : null}
        </section>

        <section className="container section" aria-labelledby="reviews-title">
          <div className="section-head row">
            <h2 id="reviews-title">{t.reviewsTitle}</h2>
            {tenant.google_reviews_url ? (
              <a href={tenant.google_reviews_url} rel="noopener" target="_blank">
                {t.allReviews}
              </a>
            ) : null}
          </div>
          <div className="grid grid-reviews">
            {reviews.map((r) => {
              const showTranslation = L_ === "en" && r.text_lang !== "en" && r.translation_en;
              const name = L_ === "en" && r.author_en ? r.author_en : r.author;
              return (
                <figure key={r.id} className="card review-card">
                  <div className="stars" role="img" aria-label={L_ === "ar" ? `${digits(r.rating, L_)} من ٥ نجوم` : `${r.rating} out of 5 stars`}>
                    {"★".repeat(r.rating)}
                  </div>
                  <blockquote lang={showTranslation ? "en" : r.text_lang}>{showTranslation ? r.translation_en : r.text}</blockquote>
                  {showTranslation ? <div className="note">{t.translated}</div> : null}
                  <figcaption className="who">
                    <span className="avatar" aria-hidden="true">
                      {name.trim()[0]}
                    </span>
                    <span className="who-text">
                      <strong>{name}</strong>
                      <span>{reviewAge(r.published_on, today, L_)}</span>
                    </span>
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </section>

        <section id="branches" className="container branches-wrap" aria-labelledby="branches-title">
          <div className="branches-list">
            <h2 id="branches-title" style={{ margin: 0, fontSize: "clamp(28px, 4vw, 36px)", fontWeight: 800 }}>
              {t.branchesTitle}
            </h2>
            {cat.branches.map((b) => (
              <div key={b.id} className="card branch-card">
                <strong>{L(b, "name", L_)}</strong>
                <span>{L(b, "address", L_)}</span>
                {fmtOpeningHours(b.hours, L_).map((line) => (
                  <span key={line}>{line}</span>
                ))}
                {b.lat != null ? (
                  <a href={`https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lng}`} target="_blank" rel="noopener">
                    {t.directions}
                  </a>
                ) : null}
              </div>
            ))}
          </div>
          <MapEmbed
            title={t.mapLabel}
            loadLabel={L_ === "ar" ? "افتح الخريطة التفاعلية" : "Load interactive map"}
            caption={L_ === "ar" ? "خريطة Google Maps (معاينة)" : "Google Maps (preview)"}
            pins={cat.branches
              .filter((b) => b.lat != null && b.lng != null)
              .map((b) => ({ label: `${L(tenant, "short_name", L_)} · ${L(b, "district", L_)}`, lat: b.lat!, lng: b.lng!, href: `https://www.google.com/maps?q=${b.lat},${b.lng}` }))}
          />
        </section>
      </main>
      <SiteFooter ctx={ctx} />
      <JsonLd data={clinicJsonLd(tenant, cat, reviews, L_, ctx.origin, pageUrl)} />
    </>
  );
}

function i18nDay(date: string, today: string, lang: Lang) {
  if (date === today) return lang === "ar" ? "النهارده" : "Today";
  if (date === addDays(today, 1)) return lang === "ar" ? "بكرة" : "Tomorrow";
  return fmtDateShort(date, lang);
}
