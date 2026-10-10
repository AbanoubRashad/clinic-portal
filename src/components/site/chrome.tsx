import Link from "next/link";
import { Icon } from "@/components/Icon";
import { DICT } from "@/i18n/dict";
import { digits } from "@/i18n/format";
import { href, type SiteContext } from "@/server/tenant";
import { L } from "@/clinic/types";

export function SiteHeader({ ctx, altPath = "/" }: { ctx: SiteContext; altPath?: string }) {
  const t = DICT[ctx.lang];
  const home = href(ctx, "/");
  const section = (id: string) => `${home === "/" ? "" : home}/#${id}`.replace("//#", "/#");
  return (
    <header className="site-header">
      <a className="skip-link" href="#main">
        {ctx.lang === "ar" ? "تخطي إلى المحتوى" : "Skip to content"}
      </a>
      <div className="container">
        <Link prefetch={false} href={home} className="brand" aria-label={L(ctx.tenant, "name", ctx.lang)}>
          <span className="brand-mark">
            <Icon name="tooth" stroke="#FFFFFF" />
          </span>
          <span className="brand-text">
            <strong>{L(ctx.tenant, "short_name", ctx.lang)}</strong>
            <span>{L(ctx.tenant, "tagline", ctx.lang)}</span>
          </span>
        </Link>
        <nav className="main-nav" aria-label={ctx.lang === "ar" ? "الأقسام" : "Sections"}>
          <a href={section("services")}>{t.nav.services}</a>
          <a href={section("doctors")}>{t.nav.doctors}</a>
          <a href={section("gallery")}>{t.nav.gallery}</a>
          <a href={section("branches")}>{t.nav.branches}</a>
        </nav>
        <div className="header-actions">
          <a className="lang-switch" href={href(ctx, altPath, ctx.lang === "ar" ? "en" : "ar")} hrefLang={ctx.lang === "ar" ? "en" : "ar"} lang={ctx.lang === "ar" ? "en" : "ar"} title={t.switchLangLabel}>
            {t.switchLang}
          </a>
          <Link prefetch={false} className="btn btn-primary" href={href(ctx, "/book")}>
            {t.bookCta}
          </Link>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter({ ctx, altPath = "/" }: { ctx: SiteContext; altPath?: string }) {
  const t = DICT[ctx.lang];
  const tn = ctx.tenant;
  return (
    <footer className="site-footer">
      <div className="container">
        <div>
          <strong>{L(tn, "name", ctx.lang)}</strong>
          {tn.phone ? (
            <>
              {" · "}
              <a href={`tel:${tn.phone}`} dir="ltr">
                {digits(tn.phone, ctx.lang)}
              </a>
            </>
          ) : null}
          {tn.email ? (
            <>
              {" · "}
              <a href={`mailto:${tn.email}`}>{tn.email}</a>
            </>
          ) : null}
        </div>
        <nav aria-label={ctx.lang === "ar" ? "روابط" : "Links"}>
          <Link prefetch={false} href={href(ctx, "/privacy")}>{t.footer.privacy}</Link>
          <Link prefetch={false} href={href(ctx, "/privacy") + "#terms"}>{t.footer.terms}</Link>
          <a href={href(ctx, altPath, ctx.lang === "ar" ? "en" : "ar")} hrefLang={ctx.lang === "ar" ? "en" : "ar"} lang={ctx.lang === "ar" ? "en" : "ar"}>
            {t.footer.other}
          </a>
        </nav>
      </div>
    </footer>
  );
}

/** hreflang alternates + canonical for a tenant page */
export function alternates(ctx: SiteContext, path: string) {
  const abs = (lang: "ar" | "en") => `${ctx.origin}${href(ctx, path, lang)}`;
  return {
    canonical: abs(ctx.lang),
    languages: { ar: abs("ar"), en: abs("en"), "x-default": abs("ar") },
  };
}
