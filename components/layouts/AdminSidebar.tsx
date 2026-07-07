"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  Warehouse,
  ShoppingCart,
  History,
  MessageSquare,
  Star,
  Store,
  Truck,
  Users,
  Mail,
  LogOut,
  User,
  FileText,
  UserCircle,
  ShoppingBag,
  TrendingUp,
  DollarSign,
  Upload,
  Bell,
  RotateCcw,
  BarChart3,
  ClipboardList,
  Gauge,
  Receipt,
  Megaphone,
  ScanLine,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts";
import { Button } from "@/components/ui/button";
import { useAdminCounts } from "@/hooks/queries";

/**
 * Admin sidebar: section headlines + links.
 * Structure per PROJECT_PLAN § 9.16.1: My Store, Product & System Management, Personal Dashboard, System Settings.
 * Dynamic counts beside Client Orders, Client Invoices, Support Tickets, Product Reviews.
 */

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Key in admin counts for badge (optional) */
  countKey?:
    | "clientOrders"
    | "clientInvoices"
    | "supportTickets"
    | "productReviews"
    | "products"
    | "warehouses"
    | "suppliers"
    | "clients"
    | "users";
};

const MY_STORE_ITEMS: NavItem[] = [
  {
    href: "/admin/dashboard-overall-insights",
    label: "Store Overview",
    icon: LayoutDashboard,
  },
  {
    href: "/admin/executive-kpi",
    label: "Executive KPI",
    icon: Gauge,
  },
  {
    href: "/admin/orders",
    label: "Orders",
    icon: ShoppingCart,
    countKey: "clientOrders",
  },
  {
    href: "/admin/invoices",
    label: "Invoices",
    icon: FileText,
    countKey: "clientInvoices",
  },
  {
    href: "/admin/support-tickets",
    label: "Support Tickets",
    icon: MessageSquare,
    countKey: "supportTickets",
  },
  {
    href: "/admin/product-reviews",
    label: "Product Reviews",
    icon: Star,
    countKey: "productReviews",
  },
];

const MANAGEMENT_ITEMS: NavItem[] = [
  {
    href: "/admin/products",
    label: "Products",
    icon: Package,
    countKey: "products",
  },
  {
    href: "/admin/warehouses",
    label: "Warehouses",
    icon: Warehouse,
    countKey: "warehouses",
  },
  {
    href: "/admin/purchase-orders",
    label: "Purchase Orders",
    icon: ClipboardList,
  },
  {
    href: "/admin/receiving",
    label: "Receiving",
    icon: ScanLine,
  },
  {
    href: "/admin/supplier-portal",
    label: "Supplier Portal",
    icon: Truck,
    countKey: "suppliers",
  },
  {
    href: "/admin/client-portal",
    label: "Client Portal",
    icon: Store,
    countKey: "clients",
  },
  {
    href: "/admin/user-management",
    label: "User Management",
    icon: Users,
    countKey: "users",
  },
  {
    href: "/admin/activity-history",
    label: "Activity History",
    icon: History,
  },
  {
    href: "/admin/inventory/abc-analysis",
    label: "ABC Analysis",
    icon: BarChart3,
  },
];

const MY_ACTIVITY_ITEMS: NavItem[] = [
  {
    href: "/admin/my-activity",
    label: "My activity",
    icon: UserCircle,
  },
];

const FINANCIALS_ITEMS: NavItem[] = [
  {
    href: "/admin/financials/pnl",
    label: "P&L Report",
    icon: Receipt,
  },
];

const SHOPEE_ITEMS: NavItem[] = [
  {
    href: "/admin/shopee",
    label: "Shopee Overview",
    icon: ShoppingBag,
  },
  {
    href: "/admin/shopee/products",
    label: "Shopee Products",
    icon: Package,
  },
  {
    href: "/admin/shopee/orders",
    label: "Shopee Orders",
    icon: ShoppingCart,
  },
  {
    href: "/admin/shopee/analytics",
    label: "Analytics",
    icon: TrendingUp,
  },
  {
    href: "/admin/shopee/profit",
    label: "Profit Tracking",
    icon: DollarSign,
  },
  {
    href: "/admin/shopee/ads",
    label: "Shopee Ads",
    icon: Megaphone,
  },
  {
    href: "/admin/shopee/sync-history",
    label: "Sync History",
    icon: History,
  },
  {
    href: "/admin/shopee/import",
    label: "Excel Import",
    icon: Upload,
  },
  {
    href: "/admin/shopee/returns",
    label: "Returns",
    icon: RotateCcw,
  },
];

const LAZADA_ITEMS: NavItem[] = [
  {
    href: "/admin/lazada",
    label: "Lazada Overview",
    icon: Store,
  },
  {
    href: "/admin/lazada/products",
    label: "Lazada Products",
    icon: Package,
  },
  {
    href: "/admin/lazada/orders",
    label: "Lazada Orders",
    icon: ShoppingCart,
  },
  {
    href: "/admin/lazada/sync-history",
    label: "Sync History",
    icon: History,
  },
];

export default function AdminSidebar({ collapsed = false }: { collapsed?: boolean } = {}) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { data: counts } = useAdminCounts();

  const handleLogout = async () => {
    await logout();
    window.location.href = "/login";
  };

  const linkClass = (href: string, isSub = false) =>
    cn(
      "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
      isSub && !collapsed ? "pl-8" : "",
      collapsed ? "justify-center px-0 w-9 h-9 mx-auto" : "",
      pathname === href || (href !== "/admin" && pathname.startsWith(href))
        ? "bg-sky-500/15 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300"
        : "hover:bg-gray-100 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300",
    );

  const getCount = (key: NavItem["countKey"]): number | undefined => {
    if (!counts || !key) return undefined;
    return counts[key];
  };

  const renderNavItems = (items: NavItem[], isSub = true) =>
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
        >
          <Icon className="h-4 w-4 flex-shrink-0" />
          {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
          {!collapsed && showBadge && (
            <span
              className={cn(
                "flex-shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium",
                "bg-muted text-muted-foreground",
              )}
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
      <nav className="flex min-h-0 flex-col items-center py-3 gap-1" aria-label="Admin navigation">
        {renderNavItems(MY_STORE_ITEMS)}
        <div className="w-6 border-t border-gray-200/50 dark:border-white/10 my-1" />
        {renderNavItems(MANAGEMENT_ITEMS)}
        <div className="w-6 border-t border-gray-200/50 dark:border-white/10 my-1" />
        {renderNavItems(SHOPEE_ITEMS)}
        <div className="w-6 border-t border-gray-200/50 dark:border-white/10 my-1" />
        {renderNavItems(LAZADA_ITEMS)}
        <div className="w-6 border-t border-gray-200/50 dark:border-white/10 my-1" />
        {renderNavItems(FINANCIALS_ITEMS)}
        <div className="w-6 border-t border-gray-200/50 dark:border-white/10 my-1" />
        {renderNavItems(MY_ACTIVITY_ITEMS)}
        <div className="w-6 border-t border-gray-200/50 dark:border-white/10 my-1" />
        <Link
          href="/admin/settings/email-preferences"
          className={linkClass("/admin/settings/email-preferences", true)}
          title="Email Preferences"
        >
          <Mail className="h-4 w-4 flex-shrink-0" />
        </Link>
      </nav>
    );
  }

  return (
    <nav className="flex min-h-0 flex-col p-2 gap-1">
      {/* My Store */}
      <p className="px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        My Store
      </p>
      {renderNavItems(MY_STORE_ITEMS)}

      {/* Product & System Management */}
      <p className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Product & System Management
      </p>
      {renderNavItems(MANAGEMENT_ITEMS)}

      {/* Shopee Integration */}
      <p className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Shopee
      </p>
      {renderNavItems(SHOPEE_ITEMS)}

      {/* Lazada Integration */}
      <p className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Lazada
      </p>
      {renderNavItems(LAZADA_ITEMS)}

      {/* Financials */}
      <p className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Financials
      </p>
      {renderNavItems(FINANCIALS_ITEMS)}

      {/* My Activity */}
      <p className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Personal activity
      </p>
      {renderNavItems(MY_ACTIVITY_ITEMS)}

      {/* System Settings */}
      <p className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        System Settings
      </p>
      <Link
        href="/admin/settings/email-preferences"
        className={linkClass("/admin/settings/email-preferences", true)}
      >
        <Mail className="h-4 w-4 flex-shrink-0" />
        Email Preferences
      </Link>
      <Link
        href="/admin/settings/notifications"
        className={linkClass("/admin/settings/notifications", true)}
      >
        <Bell className="h-4 w-4 flex-shrink-0" />
        Notifications
      </Link>

      {/* Spacer to push user + logout to bottom */}
      {/* <div className="flex-1 min-h-4" /> */}

      {/* User login info */}
      {/* {user && (
        <div className="rounded-lg px-3 py-2 border border-gray-200/50 dark:border-white/10 bg-gray-50/50 dark:bg-white/5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <User className="h-4 w-4 flex-shrink-0" />
            <div className="min-w-0 truncate">
              <p className="font-medium text-foreground truncate">
                {user.name || "User"}
              </p>
              <p className="text-xs truncate">{user.email}</p>
            </div>
          </div>
        </div>
      )} */}

      {/* Logout */}
      {/* <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start gap-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
        onClick={handleLogout}
      >
        <LogOut className="h-4 w-4 flex-shrink-0" />
        Logout
      </Button> */}
    </nav>
  );
}
