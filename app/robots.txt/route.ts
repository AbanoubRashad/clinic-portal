import { originOf } from "@/server/tenant";

export async function GET(req: Request) {
  const origin = originOf(req.headers);
  const body = ["User-agent: *", "Allow: /", "Disallow: /dashboard", "Disallow: /login", "Disallow: /api/", "Disallow: /pay/", "Disallow: /book/done", "Disallow: /en/book/done", "", `Sitemap: ${origin}/sitemap.xml`, ""].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
