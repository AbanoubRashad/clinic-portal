import "../globals.css";
import "../dashboard.css";
import "../booking.css";
import type { Metadata, Viewport } from "next";
import { tajawal } from "@/components/fonts";

export const metadata: Metadata = { title: "لوحة العيادة", robots: { index: false, follow: false }, icons: { icon: "/favicon.svg" } };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function StaffRoot({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={tajawal.variable}>
      <body>{children}</body>
    </html>
  );
}
