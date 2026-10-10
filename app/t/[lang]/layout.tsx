import "../../globals.css";
import type { Metadata, Viewport } from "next";
import { tajawal } from "@/components/fonts";
import { siteContext } from "@/server/tenant";
import { themeStyle } from "@/lib/theme";

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#FFFFFF" };

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  const ctx = await siteContext(lang);
  return {
    metadataBase: new URL(ctx.origin),
    icons: { icon: "/favicon.svg" },
    applicationName: lang === "ar" ? ctx.tenant.name_ar : ctx.tenant.name_en,
  };
}

export default async function TenantLayout({ children, params }: { children: React.ReactNode; params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const ctx = await siteContext(lang);
  return (
    <html lang={lang} dir={lang === "ar" ? "rtl" : "ltr"} className={tajawal.variable}>
      <body style={themeStyle(ctx.tenant.primary_color) as React.CSSProperties}>{children}</body>
    </html>
  );
}
