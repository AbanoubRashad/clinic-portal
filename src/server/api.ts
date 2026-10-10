import { NextResponse } from "next/server";
import { tenantBySlug } from "@/clinic/repo";
import { BookingError } from "@/clinic/booking";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { db } from "./db";

export function json(data: unknown, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function tenantOr404(slug: string) {
  return tenantBySlug(db(), slug);
}

export function errorResponse(err: unknown) {
  if (err instanceof BookingError) {
    const status = err.code === "NOT_FOUND" ? 404 : err.code === "SLOT_TAKEN" ? 409 : err.code === "HOLD_EXPIRED" ? 410 : 422;
    return json({ error: err.code }, status);
  }
  console.error(err);
  return json({ error: "generic" }, 500);
}

/** Per-IP limit for the public booking endpoints. Returns a 429 response when exceeded. */
export function limited(req: Request, bucket: string, limit: number, windowMs = 60_000) {
  const r = rateLimit(`${bucket}:${clientIp(req.headers)}`, limit, windowMs);
  return r.ok ? null : json({ error: "RATE_LIMITED" }, 429, { "Retry-After": String(r.retryAfter) });
}

export const intParam = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : NaN);
