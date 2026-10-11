import type { Metadata } from "next";
import { SiteFooter, SiteHeader, alternates } from "@/components/site/chrome";
import { DICT } from "@/i18n/dict";
import { digits } from "@/i18n/format";
import { L } from "@/clinic/types";
import { siteContext } from "@/server/tenant";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  const ctx = await siteContext(lang);
  return { title: `${DICT[ctx.lang].privacy.title} | ${L(ctx.tenant, "name", ctx.lang)}`, alternates: alternates(ctx, "/privacy") };
}

export default async function Privacy({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const ctx = await siteContext(lang);
  const t = DICT[ctx.lang];
  const ar = ctx.lang === "ar";
  return (
    <>
      <SiteHeader ctx={ctx} altPath="/privacy" />
      <main id="main" className="container page prose">
        <h1>{t.privacy.title}</h1>
        {t.privacy.body.map((p) => (
          <p key={p}>{p}</p>
        ))}
        <h2 id="terms">{ar ? "شروط الحجز" : "Booking terms"}</h2>
        <p>
          {ar
            ? `العربون (${digits(ctx.tenant.deposit_amount, "ar")} ج.م) بيتخصم من قيمة الكشف. الإلغاء مجاني قبل الموعد بـ ${digits(ctx.tenant.cancellation_window_hours, "ar")} ساعة على الأقل ويتم رد العربون؛ الإلغاء بعد كده أو عدم الحضور بيخلّي العربون غير قابل للاسترداد. لو العيادة لغت الموعد بيترد العربون كامل.`
            : `The deposit (EGP ${ctx.tenant.deposit_amount}) is deducted from your visit. Cancelling at least ${ctx.tenant.cancellation_window_hours} hours before the appointment is free and the deposit is refunded; later cancellations or no-shows forfeit the deposit. If the clinic cancels, the deposit is refunded in full.`}
        </p>
      </main>
      <SiteFooter ctx={ctx} altPath="/privacy" />
    </>
  );
}
