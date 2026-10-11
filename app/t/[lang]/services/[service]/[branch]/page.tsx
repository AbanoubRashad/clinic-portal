import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader, alternates } from "@/components/site/chrome";
import { DICT } from "@/i18n/dict";
import { fmtDuration, fmtOpeningHours, fmtPrice, fmtRating, fmtWeekdays } from "@/i18n/format";
import { catalog } from "@/clinic/site";
import { scoped } from "@/clinic/repo";
import { JsonLd } from "@/clinic/seo";
import { L } from "@/clinic/types";
import { db } from "@/server/db";
import { href, siteContext } from "@/server/tenant";

export const dynamic = "force-dynamic";

async function load(params: Promise<{ lang: string; service: string; branch: string }>) {
  const { lang, service: serviceSlug, branch: branchSlug } = await params;
  const ctx = await siteContext(lang);
  const s = scoped(db(), ctx.tenant.id);
  const service = s.serviceBySlug(serviceSlug);
  const branch = s.branchBySlug(branchSlug);
  if (!service || !branch || !service.active) notFound();
  return { ctx, service, branch };
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string; service: string; branch: string }> }): Promise<Metadata> {
  const { ctx, service, branch } = await load(params);
  const lang = ctx.lang;
  const name = L(service, "name", lang);
  const district = L(branch, "district", lang);
  const clinic = L(ctx.tenant, "name", lang);
  const price = fmtPrice(service.price_egp, service.price_is_from, lang);
  return {
    title: `${name} ${DICT[lang].servicePage.in} ${district} | ${clinic}`,
    description:
      lang === "ar"
        ? `${name} في ${district} عند ${clinic}: ${L(service, "desc", lang)}. السعر ${price}، احجز أونلاين واختار الدكتور والموعد.`
        : `${name} in ${district} at ${clinic}: ${L(service, "desc", lang)}. ${price}. Book online and choose your dentist and time.`,
    alternates: alternates(ctx, `/services/${service.slug}/${branch.slug}`),
  };
}

export default async function ServicePage({ params }: { params: Promise<{ lang: string; service: string; branch: string }> }) {
  const { ctx, service, branch } = await load(params);
  const lang = ctx.lang;
  const t = DICT[lang];
  const cat = catalog(db(), ctx.tenant);
  const b = cat.branches.find((x) => x.id === branch.id)!;
  const doctors = cat.providers.filter((p) => p.serviceIds.includes(service.id) && p.branchIds.includes(branch.id));
  const others = cat.branches.filter((x) => x.id !== branch.id && cat.providers.some((p) => p.serviceIds.includes(service.id) && p.branchIds.includes(x.id)));
  const path = `/services/${service.slug}/${branch.slug}`;
  const url = `${ctx.origin}${href(ctx, path)}`;
  const title = `${L(service, "name", lang)} ${t.servicePage.in} ${L(branch, "district", lang)}`;

  return (
    <>
      <SiteHeader ctx={ctx} altPath={path} />
      <main id="main" className="container page">
        <nav className="crumbs" aria-label="breadcrumb">
          <Link prefetch={false} href={href(ctx, "/")}>{t.servicePage.breadcrumbHome}</Link>
          <span aria-hidden="true">/</span>
          <span>{L(service, "name", lang)}</span>
        </nav>
        <h1>{title}</h1>
        <p className="muted" style={{ margin: 0, fontSize: 19 }}>
          {L(service, "desc", lang)}
        </p>
        <div className="facts">
          <div className="card fact">
            <span>{t.servicePage.duration}</span>
            <strong>{fmtDuration(service.duration_min, lang)}</strong>
          </div>
          <div className="card fact">
            <span>{t.servicePage.price}</span>
            <strong>{fmtPrice(service.price_egp, service.price_is_from, lang)}</strong>
          </div>
          <div className="card fact">
            <span>{L(branch, "name", lang)}</span>
            <strong style={{ fontSize: 16 }}>{L(branch, "address", lang)}</strong>
          </div>
        </div>
        <div className="muted">{fmtOpeningHours(b.hours, lang).join(" · ")}</div>
        <Link prefetch={false} className="btn btn-primary btn-lg" style={{ alignSelf: "flex-start" }} href={`${href(ctx, "/book")}?service=${service.id}&branch=${branch.id}`}>
          {t.servicePage.bookThis}
        </Link>
        {doctors.length ? (
          <section className="section" style={{ paddingBlock: 16, gap: 14 }} aria-labelledby="sd">
            <h2 id="sd" style={{ fontSize: 24 }}>
              {t.servicePage.doctors}
            </h2>
            <div className="mini-doctors">
              {doctors.map((p) => (
                <Link prefetch={false} key={p.id} className="card mini-doctor" href={`${href(ctx, "/book")}?service=${service.id}&branch=${branch.id}&provider=${p.id}`}>
                  {p.photo_url ? <Image src={p.photo_url} alt={L(p, "name", lang)} width={112} height={128} /> : null}
                  <span style={{ display: "flex", flexDirection: "column" }}>
                    <strong>
                      {L(p, "name", lang)} {p.rating ? <span className="chip chip-rating">★ {fmtRating(p.rating, lang)}</span> : null}
                    </strong>
                    <span className="muted" style={{ fontSize: 15 }}>
                      {L(p, "title", lang)}
                    </span>
                    <span style={{ color: "var(--primary-dark)", fontWeight: 700, fontSize: 14 }}>{fmtWeekdays(p.weekdays, lang)}</span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
        {others.length ? (
          <section aria-labelledby="ob">
            <h2 id="ob" style={{ fontSize: 20, margin: "0 0 8px" }}>
              {t.servicePage.otherBranches}
            </h2>
            {others.map((o) => (
              <Link prefetch={false} key={o.id} href={href(ctx, `/services/${service.slug}/${o.slug}`)} style={{ display: "inline-block", paddingBlock: 10, fontWeight: 700 }}>
                {L(service, "name", lang)} {t.servicePage.in} {L(o, "district", lang)}
              </Link>
            ))}
          </section>
        ) : null}
      </main>
      <SiteFooter ctx={ctx} altPath={path} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "MedicalProcedure",
          name: title,
          url,
          description: L(service, "desc", lang),
          howPerformed: L(service, "desc", lang),
          offers: { "@type": "Offer", price: service.price_egp, priceCurrency: "EGP" },
          provider: { "@id": `${ctx.origin}/#branch-${branch.slug}` },
        }}
      />
    </>
  );
}
