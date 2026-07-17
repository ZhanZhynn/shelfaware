/**
 * API Endpoint definitions
 * Centralized endpoint paths for type safety and consistency
 */

/**
 * API endpoint paths
 * All API routes are defined here for consistency
 */
export const API_ENDPOINTS = {
  // Authentication endpoints
  auth: {
    login: "/auth/login",
    logout: "/auth/logout",
    register: "/auth/register",
    session: "/auth/session",
  },

  // Product endpoints
  products: {
    base: "/products",
  },

  // Category endpoints
  categories: {
    base: "/categories",
  },

  // Supplier endpoints
  suppliers: {
    base: "/suppliers",
  },

  // User endpoints
  user: {
    emailPreferences: "/user/email-preferences",
  },

  // Users (admin User Management) endpoints
  users: {
    base: "/users",
  },

  // Order endpoints
  orders: {
    base: "/orders",
  },

  // Admin: client orders/invoices and sidebar counts
  admin: {
    clientOrders: "/admin/client-orders",
    clientInvoices: "/admin/client-invoices",
    counts: "/admin/counts",
  },

  // Notification endpoints
  notifications: {
    inApp: "/notifications/in-app",
    unreadCount: "/notifications/in-app/unread-count",
  },

  // Invoice endpoints
  invoices: {
    base: "/invoices",
  },

  // Warehouse endpoints
  warehouses: {
    base: "/warehouses",
  },

  // Import History (Admin History) endpoints
  importHistory: {
    base: "/import-history",
  },

  // Support Tickets endpoints
  supportTickets: {
    base: "/support-tickets",
  },

  // Product Reviews endpoints
  productReviews: {
    base: "/product-reviews",
  },

  // Dashboard (admin overview) — safe path; avoid blocked keywords
  dashboard: {
    base: "/dashboard",
  },

  // Admin Client Portal
  clientPortal: {
    base: "/client-portal",
  },

  // Admin Supplier Portal
  supplierPortal: {
    base: "/supplier-portal",
  },

  // Stock Allocations
  stockAllocations: {
    base: "/stock-allocations",
  },

  // Forecasting
  forecasting: {
    base: "/forecasting",
  },

  // Inventory (ABC Analysis)
  inventory: {
    abcAnalysis: "/inventory/abc-analysis",
  },

  // Financials (P&L)
  financials: {
    pnl: "/financials/pnl",
  },

  // Purchase Orders
  purchaseOrders: {
    base: "/purchase-orders",
    detail: (id: string) => `/purchase-orders/${id}`,
    approve: (id: string) => `/purchase-orders/${id}/approve`,
    generate: "/purchase-orders/generate",
  },

  // Executive KPI
  executiveKpi: {
    base: "/executive-kpi",
  },

  // External Portals
  portal: {
    supplier: "/portal/supplier",
    client: "/portal/client",
    clientCatalog: "/portal/client/catalog",
    clientBrowseMeta: "/portal/client/browse-meta",
    clientBrowseProducts: "/portal/client/browse-products",
  },

  // Payments
  payments: {
    checkout: "/payments/checkout",
    webhook: "/payments/webhook",
  },

  // Shipping
  shipping: {
    rates: "/shipping/rates",
    labels: "/shipping/labels",
    tracking: "/shipping/tracking",
    webhook: "/shipping/webhook",
  },
  systemConfig: {
    base: "/system-config",
  },
  auditLogs: {
    base: "/audit-logs",
  },

  // Lazada Integration
  lazada: {
    auth: "/lazada/auth",
    callback: "/lazada/callback",
    shops: "/lazada/shops",
    sync: "/lazada/sync",
    syncLogs: "/lazada/sync/logs",
    products: "/lazada/products",
    orders: "/lazada/orders",
    stats: "/lazada/stats",
    revenueTrend: "/lazada/stats/revenue-trend",
  },

  // TikTok Shop Integration
  tiktok: {
    auth: "/tiktok/auth",
    callback: "/tiktok/callback",
    shops: "/tiktok/shops",
    shopDetail: (id: string) => `/tiktok/shops/${id}`,
    sync: "/tiktok/sync",
    syncLogs: "/tiktok/sync/logs",
    products: "/tiktok/products",
    productDetail: (id: string) => `/tiktok/products/${id}`,
    orders: "/tiktok/orders",
    orderDetail: (id: string) => `/tiktok/orders/${id}`,
  },

  // Shopify Integration
  shopify: {
    auth: "/shopify/auth",
    callback: "/shopify/callback",
    shops: "/shopify/shops",
    shopDetail: (id: string) => `/shopify/shops/${id}`,
    sync: "/shopify/sync",
    syncLogs: "/shopify/sync/logs",
    products: "/shopify/products",
    productDetail: (id: string) => `/shopify/products/${id}`,
    orders: "/shopify/orders",
    orderDetail: (id: string) => `/shopify/orders/${id}`,
    stats: "/shopify/stats",
    revenueTrend: "/shopify/stats/revenue-trend",
  },

  // Shopee Integration
  shopee: {
    auth: "/shopee/auth",
    callback: "/shopee/callback",
    shops: "/shopee/shops",
    shopDetail: (id: string) => `/shopee/shops/${id}`,
    sync: "/shopee/sync",
    syncLogs: "/shopee/sync/logs",
    products: "/shopee/products",
    productDetail: (id: string) => `/shopee/products/${id}`,
    orders: "/shopee/orders",
    orderDetail: (id: string) => `/shopee/orders/${id}`,
    stats: "/shopee/stats",
    revenueTrend: "/shopee/stats/revenue-trend",
    buyers: "/shopee/stats/buyers",
    productPerformance: "/shopee/stats/products",
    profit: "/shopee/stats/profit",
    shippingDiscrepancy: "/shopee/stats/shipping-discrepancy",
    webhook: "/shopee/webhook",
    import: "/shopee/import",
    nearSlaOrders: "/shopee/orders/near-sla",
    slaAlert: "/shopee/alerts/sla",
    lowStockAlert: "/shopee/alerts/low-stock",
    digest: "/shopee/digest",
    clv: "/shopee/stats/clv",
    returns: "/shopee/returns",
    returnsStats: "/shopee/stats/returns",
    createWmsProduct: "/shopee/products/create-wms-product",
    ads: "/shopee/ads",
  },

  // Notification settings
  settings: {
    notifications: "/settings/notifications",
    testNotification: "/settings/notifications/test",
  },

  // Receiving (warehouse stock-in by scan)
  receiving: {
    base: "/receiving",
    movements: "/receiving/movements",
  },

  // Product lookup (by scan)
  productLookup: "/products/lookup",
} as const;

/**
 * API endpoint type
 * For type-safe endpoint references
 */
export type ApiEndpoint = typeof API_ENDPOINTS;
