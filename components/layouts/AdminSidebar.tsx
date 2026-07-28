"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts";
import { useAdminCounts } from "@/hooks/queries";
import {
  adminNavigationSections,
  type AdminCountKey,
  type AdminNavigationItem,
} from "./admin-navigation";

type AdminSidebarProps = {
  collapsed?: boolean;
  isSuperAdmin?: boolean;
  mobileDrawer?: boolean;
  onNavigate?: () => void;
};

export default function AdminSidebar({
  collapsed = false,
  isSuperAdmin,
  mobileDrawer = false,
  onNavigate,
}: AdminSidebarProps = {}) {
  const pathname = usePathname();
  const { user } = useAuth();
  const { data: counts } = useAdminCounts();
  const canUseSuperAdminTools = isSuperAdmin ?? user?.isSuperAdmin !== false;
  const sections = adminNavigationSections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) =>
          (!item.superAdminOnly || canUseSuperAdminTools) &&
          (!item.mobileOnly || mobileDrawer),
      ),
    }))
    .filter((section) => section.items.length > 0);

  const linkClass = (href: string, isSub = false) =>
    cn(
      "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
      isSub && !collapsed ? "pl-8" : "",
      collapsed ? "justify-center px-0 w-9 h-9 mx-auto" : "",
      pathname === href || (href !== "/admin" && pathname.startsWith(href))
        ? "bg-sky-500/15 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300"
        : "hover:bg-gray-100 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300",
    );

  const getCount = (key: AdminCountKey | undefined): number | undefined =>
    !counts || !key ? undefined : counts[key];

  const renderNavItems = (items: AdminNavigationItem[], isSub = true) =>
    items.map((item) => {
      const Icon = item.icon;
      const count = getCount(item.countKey);
      const showBadge = count !== undefined && count > 0;
      return (
        <Link
          key={item.href}
          href={item.href}
          className={linkClass(item.href, isSub)}
          title={collapsed ? item.label : undefined}
          onClick={onNavigate}
        >
          <Icon className="h-4 w-4 flex-shrink-0" />
          {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
          {!collapsed && showBadge && (
            <span
              className="flex-shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
              aria-label={`${count} items`}
            >
              {count > 99 ? "99+" : count}
            </span>
          )}
        </Link>
      );
    });

  if (collapsed) {
    return (
      <nav className="flex min-h-0 flex-col items-center gap-1 py-3" aria-label="Admin navigation">
        {sections.map((section, index) => (
          <div className="contents" key={section.label}>
            {index > 0 && <div className="my-1 w-6 border-t border-gray-200/50 dark:border-white/10" />}
            {renderNavItems(section.items)}
          </div>
        ))}
      </nav>
    );
  }

  return (
    <nav className="flex min-h-0 flex-col gap-1 p-2" aria-label="Admin navigation">
      {sections.map((section) => (
        <section key={section.label}>
          <p className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground first:pt-2">
            {section.label}
          </p>
          {renderNavItems(section.items)}
        </section>
      ))}
    </nav>
  );
}
