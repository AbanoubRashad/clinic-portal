import { completeBooking } from "@/clinic/booking";
import type { PayMethod } from "@/clinic/types";
import { db } from "@/server/db";
import { errorResponse, json, limited, tenantOr404 } from "@/server/api";
import { originOf } from "@/server/tenant";

const METHODS: PayMethod[] = ["card", "wallet", "kiosk", "clinic"];

/** Only same-origin relative paths are accepted as the post-payment return URL. */
const safePath = (v: unknown) => (typeof v === "string" && /^\/(?!\/)[\w\-/]*$/.test(v) ? v : "/book/done");

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; token: string }> }) {
  const block = limited(req, "complete", 10);
  if (block) return block;
  const { slug, token } = await params;
  const tenant = tenantOr404(slug);
  if (!tenant) return json({ error: "NOT_FOUND" }, 404);
  const body = (await req.json().catch(() => null)) as { name?: unknown; phone?: unknown; method?: unknown; marketingConsent?: unknown; lang?: unknown; donePath?: unknown } | null;
  if (!body || typeof body.name !== "string" || typeof body.phone !== "string" || !METHODS.includes(body.method as PayMethod))
    return json({ error: "BAD_REQUEST" }, 400);
  try {
    const r = await completeBooking(
      db(),
      tenant,
      token,
      {
        name: body.name,
        phone: body.phone,
        method: body.method as PayMethod,
        marketingConsent: body.marketingConsent === true,
        lang: body.lang === "en" ? "en" : "ar",
      },
      { origin: originOf(req.headers), donePath: safePath(body.donePath) },
    );
    return json({ kind: r.kind, url: r.kind === "redirect" ? r.url : undefined, token: r.appointment.public_token });
  } catch (err) {
    return errorResponse(err);
  }
}
