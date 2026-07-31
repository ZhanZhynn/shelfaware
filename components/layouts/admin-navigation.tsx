import type { ComponentType } from "react";
import {
  Activity,
  BarChart3,
  Bell,
  ClipboardList,
  DollarSign,
  FileCode,
  FileText,
  Gauge,
  History,
  LayoutDashboard,
  Mail,
  Megaphone,
  MessageSquare,
  Package,
  Receipt,
  RotateCcw,
  ScanLine,
  ShoppingBag,
  ShoppingCart,
  Star,
  Store,
  TrendingUp,
  Truck,
  Tv,
  Upload,
  UserCircle,
  Users,
  Warehouse,
} from "lucide-react";

export type AdminCountKey =
  | "clientOrders"
  | "clientInvoices"
  | "supportTickets"
  | "productReviews"
  | "products"
  | "warehouses"
  | "suppliers"
  | "clients"
  | "users";

export type AdminNavigationItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  countKey?: AdminCountKey;
  superAdminOnly?: boolean;
  mobileOnly?: boolean;
};

export type AdminNavigationSection = {
  label: string;
  items: AdminNavigationItem[];
};

export const adminNavigationSections: AdminNavigationSection[] = [
  {
    label: "My Store",
    items: [
      { href: "/admin/dashboard-overall-insights", label: "Store Overview", icon: LayoutDashboard },
      { href: "/business-insights", label: "Business Insights", icon: TrendingUp },
      { href: "/admin/executive-kpi", label: "Executive KPI", icon: Gauge },
      { href: "/admin/orders", label: "Orders", icon: ShoppingCart, countKey: "clientOrders" },
      { href: "/admin/invoices", label: "Invoices", icon: FileText, countKey: "clientInvoices" },
      { href: "/admin/support-tickets", label: "Support Tickets", icon: MessageSquare, countKey: "supportTickets" },
      { href: "/admin/product-reviews", label: "Product Reviews", icon: Star, countKey: "productReviews" },
    ],
  },
  {
    label: "Product & System Management",
    items: [
      { href: "/admin/products", label: "Products", icon: Package, countKey: "products" },
      { href: "/admin/warehouses", label: "Warehouses", icon: Warehouse, countKey: "warehouses" },
      { href: "/admin/purchase-orders", label: "Purchase Orders", icon: ClipboardList },
      { href: "/admin/sourcing", label: "Sourcing", icon: ShoppingBag },
      { href: "/admin/receiving", label: "Receiving", icon: ScanLine },
      { href: "/admin/supplier-portal", label: "Supplier Portal", icon: Truck, countKey: "suppliers" },
      { href: "/admin/client-portal", label: "Client Portal", icon: Store, countKey: "clients" },
      { href: "/admin/user-management", label: "User Management", icon: Users, countKey: "users" },
      { href: "/admin/activity-history", label: "Activity History", icon: History },
      { href: "/admin/inventory/abc-analysis", label: "ABC Analysis", icon: BarChart3 },
    ],
  },
  {
    label: "Shopee",
    items: [
      { href: "/admin/shopee", label: "Shopee Overview", icon: ShoppingBag },
      { href: "/admin/shopee/products", label: "Shopee Products", icon: Package },
      { href: "/admin/shopee/orders", label: "Shopee Orders", icon: ShoppingCart },
      { href: "/admin/shopee/analytics", label: "Analytics", icon: TrendingUp },
      { href: "/admin/shopee/profit", label: "Profit Tracking", icon: DollarSign },
      { href: "/admin/shopee/ads", label: "Shopee Ads", icon: Megaphone },
      { href: "/admin/shopee/sync-history", label: "Sync History", icon: History },
      { href: "/admin/shopee/import", label: "Excel Import", icon: Upload },
      { href: "/admin/shopee/returns", label: "Returns", icon: RotateCcw },
    ],
  },
  {
    label: "Lazada",
    items: [
      { href: "/admin/lazada", label: "Lazada Overview", icon: Store },
      { href: "/admin/lazada/products", label: "Lazada Products", icon: Package },
      { href: "/admin/lazada/orders", label: "Lazada Orders", icon: ShoppingCart },
      { href: "/admin/lazada/analytics", label: "Analytics", icon: TrendingUp },
      { href: "/admin/lazada/profit", label: "Profit Tracking", icon: DollarSign },
      { href: "/admin/lazada/sync-history", label: "Sync History", icon: History },
    ],
  },
  {
    label: "TikTok Shop",
    items: [
      { href: "/admin/tiktok", label: "TikTok Overview", icon: Tv },
      { href: "/admin/tiktok/products", label: "TikTok Products", icon: Package },
      { href: "/admin/tiktok/orders", label: "TikTok Orders", icon: ShoppingCart },
      { href: "/admin/tiktok/analytics", label: "Analytics", icon: TrendingUp },
      { href: "/admin/tiktok/profit", label: "Profit Tracking", icon: DollarSign },
      { href: "/admin/tiktok/sync-history", label: "Sync History", icon: History },
    ],
  },
  {
    label: "Shopify",
    items: [
      { href: "/admin/shopify", label: "Overview", icon: Store },
      { href: "/admin/shopify/products", label: "Products", icon: Package },
      { href: "/admin/shopify/orders", label: "Orders", icon: ShoppingCart },
      { href: "/admin/shopify/analytics", label: "Analytics", icon: TrendingUp },
      { href: "/admin/shopify/profit", label: "Profit Tracking", icon: DollarSign },
      { href: "/admin/shopify/sync-history", label: "Sync History", icon: History },
    ],
  },
  { label: "Financials", items: [{ href: "/admin/financials/pnl", label: "P&L Report", icon: Receipt }] },
  { label: "Personal Activity", items: [{ href: "/admin/my-activity", label: "My Activity", icon: UserCircle }] },
  {
    label: "System Settings",
    items: [
      { href: "/admin/settings/email-preferences", label: "Email Preferences", icon: Mail },
      { href: "/admin/settings/notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    label: "Super Admin Tools",
    items: [
      { href: "/api-status", label: "API Status", icon: Activity, superAdminOnly: true, mobileOnly: true },
      { href: "/api-docs", label: "API Documentation", icon: FileCode, superAdminOnly: true, mobileOnly: true },
    ],
  },
];
