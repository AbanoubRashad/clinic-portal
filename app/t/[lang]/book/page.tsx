import "../../../booking.css";
import type { Metadata } from "next";
import { BookingFlow } from "@/components/booking/BookingFlow";
import { alternates } from "@/components/site/chrome";
import { catalog } from "@/clinic/site";
import { L } from "@/clinic/types";
import { todayIn } from "@/booking-engine";
import { db } from "@/server/db";
import { href, siteContext } from "@/server/tenant";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  const ctx = await siteContext(lang);
  const name = L(ctx.tenant, "name", ctx.lang);
  return {
    title: ctx.lang === "ar" ? `احجز موعدك | ${name}` : `Book an appointment | ${name}`,
    description: ctx.lang === "ar" ? `اختار الخدمة والدكتور والوقت المتاح في ${name} وثبّت حجزك أونلاين.` : `Choose a service, a dentist and a free time at ${name} and book online.`,
    alternates: alternates(ctx, "/book"),
  };
}

const num = (v: string | string[] | undefined) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined);
const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function BookPage({ params, searchParams }: { params: Promise<{ lang: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { lang } = await params;
  const sp = await searchParams;
  const ctx = await siteContext(lang);
  const { tenant } = ctx;
  const cat = catalog(db(), tenant);
  const date = str(sp.date);
  return (
    <main>
      <BookingFlow
        lang={ctx.lang}
        slug={tenant.slug}
        clinicShort={ctx.lang === "ar" ? `عيادات ${tenant.short_name_ar}` : tenant.short_name_en}
        homeHref={href(ctx, "/")}
        doneHref={href(ctx, "/book/done")}
        privacyHref={href(ctx, "/privacy")}
        today={todayIn(tenant.timezone)}
        holdMinutes={tenant.hold_minutes}
        cancellationHours={tenant.cancellation_window_hours}
        defaultDeposit={tenant.deposit_amount}
        allowClinic={Boolean(tenant.allow_pay_at_clinic)}
        allowKiosk={Boolean(tenant.allow_kiosk)}
        branches={cat.branches.map((b) => ({ id: b.id, name: L(b, "name", ctx.lang), district: L(b, "district", ctx.lang) }))}
        services={cat.services.map((s) => ({ id: s.id, name: L(s, "name", ctx.lang), duration: s.duration_min, price: s.price_egp, isFrom: Boolean(s.price_is_from), deposit: s.deposit_egp }))}
        providers={cat.providers.map((p) => ({
          id: p.id,
          name: L(p, "name", ctx.lang),
          role: L(p, "title", ctx.lang).split(" · ")[0]!,
          rating: p.rating,
          photo: p.photo_url,
          female: p.gender === "f",
          serviceIds: p.serviceIds,
          branchIds: p.branchIds,
        }))}
        initial={{
          serviceId: num(sp.service),
          providerId: num(sp.provider),
          branchId: num(sp.branch),
          date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined,
          start: str(sp.start),
        }}
      />
    </main>
  );
}
