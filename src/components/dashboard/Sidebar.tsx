"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/Icon";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

export function DashNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav className="dash-nav" aria-label="القائمة">
      {items.map((i) => {
        const active = i.href === "/dashboard" ? path === "/dashboard" || path === "/dashboard/new" || path === "/dashboard/waitlist" : path.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined}>
            <Icon name={i.icon} size={20} />
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Submits its form as soon as the value changes (branch/date pickers). Works without JS via the submit button. */
export function AutoSubmit({ children }: { children: React.ReactNode }) {
  return (
    <span
      onChange={(e) => {
        (e.target as HTMLSelectElement).form?.requestSubmit();
      }}
      style={{ display: "contents" }}
    >
      {children}
    </span>
  );
}
