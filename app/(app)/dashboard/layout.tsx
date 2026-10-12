import { redirect } from "next/navigation";
import { Icon } from "@/components/Icon";
import { DashNav, type NavItem } from "@/components/dashboard/Sidebar";
import { themeStyle } from "@/lib/theme";
import { destroySession, requireStaff, ROLE_LABEL } from "@/server/session";

async function logout() {
  "use server";
  await destroySession();
  redirect("/login");
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, tenant } = await requireStaff();
  const items: NavItem[] =
    user.role === "doctor"
      ? [{ href: "/dashboard", label: "جدولي اليوم", icon: "calendar" }]
      : [
          { href: "/dashboard", label: "جدول اليوم", icon: "calendar" },
          { href: "/dashboard/patients", label: "المرضى", icon: "users" },
          { href: "/dashboard/doctors", label: "الأطباء والجداول", icon: "clock" },
          { href: "/dashboard/payments", label: "المدفوعات والعرابين", icon: "card" },
          { href: "/dashboard/messages", label: "رسائل واتساب", icon: "chat" },
          { href: "/dashboard/reports", label: "التقارير", icon: "chart" },
          ...(user.role === "owner"
            ? ([
                { href: "/dashboard/settings", label: "الإعدادات", icon: "settings" },
                { href: "/dashboard/audit", label: "سجل التعديلات", icon: "list" },
              ] as NavItem[])
            : []),
        ];
  return (
    <div className="dash" style={themeStyle(tenant.primary_color) as React.CSSProperties}>
      <aside className="dash-aside">
        <div className="dash-brand">
          <span className="brand-mark">
            <Icon name="tooth" stroke="#fff" size={20} />
          </span>
          <div>
            <strong>{tenant.short_name_ar}</strong>
            <span>لوحة الاستقبال</span>
          </div>
        </div>
        <DashNav items={items} />
        <div className="dash-user">
          <span className="avatar">{user.name.replace(/^د\.\s*/, "").trim()[0]}</span>
          <span className="who">
            <strong>{user.name}</strong>
            <span>{ROLE_LABEL[user.role]}</span>
          </span>
          <form action={logout}>
            <button className="icon-btn" type="submit" aria-label="تسجيل الخروج" title="تسجيل الخروج">
              <Icon name="logout" size={18} className="flip-ltr" />
            </button>
          </form>
        </div>
      </aside>
      <main className="dash-main" id="main">
        {children}
      </main>
    </div>
  );
}
