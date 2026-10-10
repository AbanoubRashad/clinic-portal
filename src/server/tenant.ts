import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { tenantByDomain, tenantBySlug } from "@/clinic/repo";
import type { Lang, Tenant } from "@/clinic/types";
import { db } from "./db";

export interface SiteContext {
  tenant: Tenant;
  lang: Lang;
  /** Path prefix in front of every tenant URL: "" on a custom domain / subdomain, "/c/<slug>" on the fallback. */
  base: string;
  origin: string;
}

function hostOf(h: Headers) {
  return (h.get("x-forwarded-host") ?? h.get("host") ?? "localhost").split(",")[0]!.trim().toLowerCase();
}

/**
 * Tenant resolution order: custom domain -> subdomain of ROOT_DOMAIN -> /c/:slug path (set by proxy.ts)
 * -> DEFAULT_TENANT_SLUG on the platform host (local development).
 */
export function resolveTenant(h: Headers): Tenant | undefined {
  const d = db();
  const host = hostOf(h).replace(/:\d+$/, "");
  const byDomain = tenantByDomain(d, host);
  if (byDomain) return byDomain;
  const root = (process.env.ROOT_DOMAIN ?? "localhost").toLowerCase();
  if (host.endsWith(`.${root}`)) {
    const sub = host.slice(0, -root.length - 1);
    if (sub && !sub.includes(".") && sub !== "www") {
      const t = tenantBySlug(d, sub);
      if (t) return t;
    }
  }
  const pathSlug = h.get("x-tenant-slug");
  if (pathSlug) return tenantBySlug(d, pathSlug);
  return tenantBySlug(d, process.env.DEFAULT_TENANT_SLUG ?? "basma");
}

export function originOf(h: Headers) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const proto = h.get("x-forwarded-proto") ?? (hostOf(h).startsWith("localhost") || hostOf(h).startsWith("127.") ? "http" : "https");
  return `${proto}://${hostOf(h)}`;
}

export async function siteContext(lang: string): Promise<SiteContext> {
  if (lang !== "ar" && lang !== "en") notFound();
  const h = await headers();
  const tenant = resolveTenant(h);
  if (!tenant) notFound();
  return { tenant, lang, base: h.get("x-tenant-base") ?? "", origin: originOf(h) };
}

/** Builds a tenant URL for the given language: href(ctx, "/book") -> "/c/basma/en/book" */
export function href(ctx: Pick<SiteContext, "base" | "lang">, path = "/", lang: Lang = ctx.lang) {
  const p = path === "/" ? "" : path;
  const l = lang === "en" ? "/en" : "";
  return `${ctx.base}${l}${p}` || "/";
}
