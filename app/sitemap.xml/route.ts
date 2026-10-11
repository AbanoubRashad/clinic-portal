import { catalog } from "@/clinic/site";
import { db } from "@/server/db";
import { originOf, resolveTenant } from "@/server/tenant";

export const dynamic = "force-dynamic";

/** Per-tenant sitemap with hreflang alternates (AR default, EN under /en). */
export async function GET(req: Request) {
  const tenant = resolveTenant(req.headers);
  if (!tenant) return new Response("Not found", { status: 404 });
  const origin = originOf(req.headers);
  const cat = catalog(db(), tenant);
  const paths = ["/", "/book", "/privacy"];
  for (const s of cat.services)
    for (const b of cat.branches) if (cat.providers.some((p) => p.serviceIds.includes(s.id) && p.branchIds.includes(b.id))) paths.push(`/services/${s.slug}/${b.slug}`);
  const url = (lang: "ar" | "en", p: string) => (lang === "en" ? `${origin}/en${p === "/" ? "" : p}` : `${origin}${p}`);
  const entries = paths.flatMap((p) =>
    (["ar", "en"] as const).map(
      (lang) => `  <url>
    <loc>${url(lang, p)}</loc>
    <xhtml:link rel="alternate" hreflang="ar" href="${url("ar", p)}"/>
    <xhtml:link rel="alternate" hreflang="en" href="${url("en", p)}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${url("ar", p)}"/>
    <changefreq>${p === "/" ? "daily" : "weekly"}</changefreq>
    <priority>${p === "/" ? "1.0" : p === "/book" ? "0.9" : "0.7"}</priority>
  </url>`,
    ),
  );
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join("\n")}
</urlset>`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
