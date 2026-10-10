import { NextResponse, type NextRequest } from "next/server";

/**
 * Public tenant URLs -> internal routes under /t/<lang>/...
 *   https://basma-dental.com/en/book      (custom domain)
 *   https://basma.clinics.example/book     (subdomain)
 *   https://clinics.example/c/basma/book   (path fallback)
 * The tenant itself is resolved server-side (src/server/tenant.ts); this file only rewrites the
 * path and forwards the /c/:slug prefix so links can be built with the same base.
 */
export function proxy(req: NextRequest) {
  const url = req.nextUrl;
  let path = url.pathname;
  const headers = new Headers(req.headers);
  let base = "";

  const m = path.match(/^\/c\/([a-z0-9-]+)(\/.*)?$/);
  if (m) {
    base = `/c/${m[1]}`;
    headers.set("x-tenant-slug", m[1]!);
    path = m[2] || "/";
  } else {
    headers.delete("x-tenant-slug");
  }

  let lang = "ar";
  if (path === "/en" || path.startsWith("/en/")) {
    lang = "en";
    path = path.slice(3) || "/";
  }
  headers.set("x-tenant-base", base);

  const target = url.clone();
  target.pathname = `/t/${lang}${path === "/" ? "" : path}`;
  return NextResponse.rewrite(target, { request: { headers } });
}

export const config = {
  // Everything except APIs, staff app, Next internals and static files.
  matcher: ["/((?!api|_next|img|dashboard|login|pay|t/|sitemap.xml|robots.txt|favicon|icon|.*\\.[a-z0-9]+$).*)"],
};
