/**
 * Cache Utilities
 * Utility functions for Redis caching with graceful degradation
 */

import { getRedis } from "./redis";
import { logger } from "@/lib/logger";
import { trackCacheHit, trackCacheMiss } from "@/lib/monitoring/system-metrics";

/**
 * Cache key prefix for namespacing
 */
const CACHE_PREFIX = "stock-inventory";

/**
 * Generate cache key with prefix
 *
 * @param key - Cache key
 * @returns string - Prefixed cache key
 */
function getCacheKey(key: string): string {
  return `${CACHE_PREFIX}:${key}`;
}

/**
 * Get value from cache
 *
 * @param key - Cache key
 * @returns Promise<T | null> - Cached value or null
 */
export async function getCache<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  if (!redis) {
    return null; // Graceful degradation: return null if Redis not available
  }

  try {
    const cacheKey = getCacheKey(key);
    const value = await redis.get<T>(cacheKey);

    // Track cache hit/miss for metrics (non-blocking)
    if (value !== null) {
      trackCacheHit().catch(() => {
        // Non-critical, silently fail
      });
    } else {
      trackCacheMiss().catch(() => {
        // Non-critical, silently fail
      });
    }

    return value;
  } catch (error) {
    logger.error(`Failed to get cache for key ${key}:`, error);
    // Track as miss on error
    trackCacheMiss().catch(() => {
      // Non-critical, silently fail
    });
    return null; // Graceful degradation: return null on error
  }
}

/**
 * Set value in cache with TTL
 *
 * @param key - Cache key
 * @param value - Value to cache
 * @param ttlSeconds - Time to live in seconds (default: 300 = 5 minutes)
 * @returns Promise<boolean> - True if successful
 */
export async function setCache<T>(
  key: string,
  value: T,
  ttlSeconds: number = 300,
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) {
    return false; // Graceful degradation: return false if Redis not available
  }

  try {
    const cacheKey = getCacheKey(key);
    await redis.setex(cacheKey, ttlSeconds, value);
    return true;
  } catch (error) {
    logger.error(`Failed to set cache for key ${key}:`, error);
    return false; // Graceful degradation: return false on error
  }
}

/**
 * Delete value from cache
 *
 * @param key - Cache key
 * @returns Promise<boolean> - True if successful
 */
export async function deleteCache(key: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) {
    return false; // Graceful degradation: return false if Redis not available
  }

  try {
    const cacheKey = getCacheKey(key);
    await redis.del(cacheKey);
    return true;
  } catch (error) {
    logger.error(`Failed to delete cache for key ${key}:`, error);
    return false; // Graceful degradation: return false on error
  }
}

/**
 * Delete multiple cache keys by pattern
 *
 * @param pattern - Cache key pattern (e.g., "products:*")
 * @returns Promise<number> - Number of keys deleted
 */
export async function deleteCacheByPattern(pattern: string): Promise<number> {
  const redis = getRedis();
  if (!redis) {
    return 0; // Graceful degradation: return 0 if Redis not available
  }

  try {
    const cachePattern = getCacheKey(pattern);
    // Note: Upstash Redis doesn't support KEYS command directly
    // We'll use SCAN pattern matching instead
    const keys: string[] = [];
    let cursor: number = 0;

    do {
      const result = await redis.scan(cursor, { match: cachePattern });
      cursor = typeof result[0] === "number" ? result[0] : 0;
      const resultKeys = Array.isArray(result[1]) ? result[1] : [];
      keys.push(...resultKeys);
    } while (cursor !== 0);

    if (keys.length === 0) {
      return 0;
    }

    await redis.del(...keys);
    return keys.length;
  } catch (error) {
    logger.error(`Failed to delete cache by pattern ${pattern}:`, error);
    return 0; // Graceful degradation: return 0 on error
  }
}

/**
 * Invalidate cache by key pattern
 * Common patterns:
 * - "products:*" - All product caches
 * - "categories:*" - All category caches
 * - "suppliers:*" - All supplier caches
 *
 * @param pattern - Cache key pattern
 * @returns Promise<number> - Number of keys invalidated
 */
export async function invalidateCache(pattern: string): Promise<number> {
  return deleteCacheByPattern(pattern);
}

/**
 * Cache key generators for common entities
 */
export const cacheKeys = {
  stockAllocation: {
    list: (userId: string) => `stock-allocation:list:${userId}`,
    byProduct: (productId: string) => `stock-allocation:product:${productId}`,
    byWarehouse: (warehouseId: string) =>
      `stock-allocation:warehouse:${warehouseId}`,
    summary: (userId: string) => `stock-allocation:summary:${userId}`,
    pattern: "stock-allocation:*",
  },
  /**
   * Product cache keys
   */
  products: {
    all: "products:all",
    list: (filters?: Record<string, unknown>) => {
      const filterStr = filters ? JSON.stringify(filters) : "default";
      // v2: catalog filter includes legacy rows without deletedAt (see product-query.ts)
      return `products:list:v2:${filterStr}`;
    },
    detail: (id: string) => `products:detail:${id}`,
    pattern: "products:*",
  },

  /**
   * Category cache keys
   */
  categories: {
    all: "categories:all",
    list: (filters?: Record<string, unknown>) => {
      const filterStr = filters ? JSON.stringify(filters) : "default";
      return `categories:list:${filterStr}`;
    },
    detail: (id: string) => `categories:detail:${id}`,
    pattern: "categories:*",
  },

  /**
   * Supplier cache keys
   */
  suppliers: {
    all: "suppliers:all",
    list: (filters?: Record<string, unknown>) => {
      const filterStr = filters ? JSON.stringify(filters) : "default";
      return `suppliers:list:${filterStr}`;
    },
    detail: (id: string) => `suppliers:detail:${id}`,
    pattern: "suppliers:*",
  },

  /**
   * Session cache keys
   */
  sessions: {
    user: (userId: string) => `sessions:user:${userId}`,
    pattern: "sessions:*",
  },

  /**
   * Order cache keys
   */
  orders: {
    all: "orders:all",
    lists: () => "orders:lists",
    list: (filters?: Record<string, unknown>) => {
      const filterStr = filters ? JSON.stringify(filters) : "default";
      return `orders:list:${filterStr}`;
    },
    detail: (id: string) => `orders:detail:${id}`,
    pattern: "orders:*",
  },

  /**
   * Notification cache keys
   */
  notifications: {
    all: "notifications:all",
    list: (userId: string, filters?: Record<string, unknown>) => {
      const filterStr = filters ? JSON.stringify(filters) : "default";
      return `notifications:list:${userId}:${filterStr}`;
    },
    unreadCount: (userId: string) => `notifications:unread-count:${userId}`,
    detail: (id: string) => `notifications:detail:${id}`,
    pattern: "notifications:*",
  },

  /**
   * Invoice cache keys
   */
  invoices: {
    all: "invoices:all",
    list: (filters?: Record<string, unknown>) => {
      const filterStr = filters ? JSON.stringify(filters) : "default";
      return `invoices:list:${filterStr}`;
    },
    detail: (id: string) => `invoices:detail:${id}`,
    byOrder: (orderId: string) => `invoices:order:${orderId}`,
    pattern: "invoices:*",
  },

  /**
   * Import History (Admin History) cache keys
   */
  history: {
    all: "history:all",
    list: (filters?: Record<string, unknown>) => {
      const filterStr = filters ? JSON.stringify(filters) : "default";
      return `history:list:${filterStr}`;
    },
    detail: (id: string) => `history:detail:${id}`,
    pattern: "history:*",
  },

  /**
   * Support Ticket cache keys
   */
  supportTickets: {
    all: "supportTickets:all",
    list: (filters?: Record<string, unknown>) => {
      const filterStr = filters ? JSON.stringify(filters) : "default";
      return `supportTickets:list:${filterStr}`;
    },
    detail: (id: string) => `supportTickets:detail:${id}`,
    pattern: "supportTickets:*",
  },

  /**
   * Product Review cache keys
   */
  productReviews: {
    all: "productReviews:all",
    list: (filters?: Record<string, unknown>) => {
      const filterStr = filters ? JSON.stringify(filters) : "default";
      return `productReviews:list:${filterStr}`;
    },
    detail: (id: string) => `productReviews:detail:${id}`,
    pattern: "productReviews:*",
  },

  /**
   * Dashboard (admin overview) cache keys — per-admin (userId) for homepage
   */
  dashboard: {
    overview: (userId?: string) =>
      userId
        ? `dashboard:overview:v2:${userId}`
        : "dashboard:overview:v2",
    pattern: "dashboard:*",
  },

  /**
   * Business Insights page cache keys — per-user (userId)
   */
  businessInsights: {
    combinedInsights: (userId: string) =>
      `businessInsights:combinedInsights:${userId}`,
    pattern: "businessInsights:*",
  },

  /**
   * User Management (admin) cache keys
   */
  userManagement: {
    all: "userManagement:all",
    list: (filters?: Record<string, unknown>) => {
      const filterStr = filters ? JSON.stringify(filters) : "default";
      return `userManagement:list:${filterStr}`;
    },
    detail: (id: string) => `userManagement:detail:${id}`,
    pattern: "userManagement:*",
  },

  /**
   * Admin Client Portal cache keys
   */
  clientPortal: {
    overview: "clientPortal:overview",
    pattern: "clientPortal:*",
  },

  /**
   * Admin Supplier Portal cache keys (per admin userId)
   */
  supplierPortal: {
    overview: (userId: string) => `supplierPortal:overview:${userId}`,
    pattern: "supplierPortal:*",
  },

  /**
   * Portal (supplier/client logged-in dashboard) cache keys
   * Used by GET /api/portal/supplier and similar
   */
  portal: {
    pattern: "portal:*",
  },

  /**
   * ABC Analysis cache keys
   */
  abcAnalysis: {
    report: (userId: string, params?: string) =>
      `abc-analysis:${userId}:${params || "default"}`,
    pattern: "abc-analysis:*",
  },

  /**
   * P&L Report cache keys
   */
  pnl: {
    report: (userId: string, period?: string) =>
      `pnl:${userId}:${period || "default"}`,
    pattern: "pnl:*",
  },

  /**
   * Purchase Orders cache keys
   */
  purchaseOrders: {
    all: "purchaseOrders:all",
    list: (filters?: Record<string, unknown>) => {
      const filterStr = filters ? JSON.stringify(filters) : "default";
      return `purchaseOrders:list:${filterStr}`;
    },
    detail: (id: string) => `purchaseOrders:detail:${id}`,
    pattern: "purchaseOrders:*",
  },

  /**
   * Executive KPI cache keys
   */
  executiveKpi: {
    overview: (userId: string, params?: string) =>
      `executive-kpi:${userId}:${params || "default"}`,
    pattern: "executive-kpi:*",
  },

  /**
   * Shopee integration cache keys
   */
  shopee: {
    all: "shopee:all",
    shops: (userId: string) => `shopee:shops:${userId}`,
    shopDetail: (id: string) => `shopee:shop:${id}`,
    products: (shopId: string, filters?: Record<string, unknown>) => {
      const filterStr = filters ? JSON.stringify(filters) : "default";
      return `shopee:products:${shopId}:${filterStr}`;
    },
    productDetail: (id: string) => `shopee:product:${id}`,
    orders: (shopId: string, filters?: Record<string, unknown>) => {
      const filterStr = filters ? JSON.stringify(filters) : "default";
      return `shopee:orders:${shopId}:${filterStr}`;
    },
    orderDetail: (id: string) => `shopee:order:${id}`,
    stats: (shopId: string, dateRange?: string) => `shopee:stats:${shopId}:${dateRange || "all"}`,
    revenueTrend: (shopId: string, granularity: string) => `shopee:revenue-trend:${shopId}:${granularity}`,
    buyers: (shopId: string) => `shopee:buyers:${shopId}`,
    productPerformance: (shopId: string) => `shopee:product-performance:${shopId}`,
    profit: (shopId: string) => `shopee:profit:${shopId}`,
    syncLogs: (shopId: string) => `shopee:sync-logs:${shopId}`,
    importData: (shopId: string) => `shopee:import:${shopId}`,
    nearSla: (shopId: string | null, hours: number) =>
      `shopee:near-sla:${shopId || "all"}:${hours}`,
    ads: (userId: string, dateRange?: string) => `shopee:ads:${userId}:${dateRange || "all"}`,
    pattern: "shopee:*",
  },

  /**
   * Lazada integration cache keys
   */
  lazada: {
    all: "lazada:all",
    shops: (userId: string) => `lazada:shops:${userId}`,
    shopDetail: (id: string) => `lazada:shop:${id}`,
    products: (sellerId: string, filters?: Record<string, unknown>) => {
      const filterStr = filters ? JSON.stringify(filters) : "default";
      return `lazada:products:${sellerId}:${filterStr}`;
    },
    productDetail: (id: string) => `lazada:product:${id}`,
    orders: (sellerId: string, filters?: Record<string, unknown>) => {
      const filterStr = filters ? JSON.stringify(filters) : "default";
      return `lazada:orders:${sellerId}:${filterStr}`;
    },
    orderDetail: (id: string) => `lazada:order:${id}`,
    stats: (sellerId: string, dateRange?: string) => `lazada:stats:${sellerId}:${dateRange || "all"}`,
    syncLogs: (sellerId: string) => `lazada:sync-logs:${sellerId}`,
    pattern: "lazada:*",
  },
} as const;

/**
 * Nuclear server-side cache invalidation: wipe ALL Redis caches so every
 * stat card, badge, table, detail page, and portal dashboard shows fresh
 * data on the next client-side refetch.
 *
 * Call from every mutation API route (create/update/delete) so the
 * subsequent TanStack Query refetch (triggered by invalidateAllRelatedQueries
 * on the client) always hits the database, not stale Redis.
 */
export async function invalidateAllServerCaches(): Promise<void> {
  await Promise.all([
    invalidateCache(cacheKeys.products.pattern),
    invalidateCache(cacheKeys.categories.pattern),
    invalidateCache(cacheKeys.suppliers.pattern),
    invalidateCache(cacheKeys.orders.pattern),
    invalidateCache(cacheKeys.invoices.pattern),
    invalidateCache(cacheKeys.dashboard.pattern),
    invalidateCache(cacheKeys.notifications.pattern),
    invalidateCache(cacheKeys.supportTickets.pattern),
    invalidateCache(cacheKeys.productReviews.pattern),
    invalidateCache(cacheKeys.userManagement.pattern),
    invalidateCache(cacheKeys.stockAllocation.pattern),
    invalidateCache(cacheKeys.history.pattern),
    invalidateCache(cacheKeys.portal.pattern),
    invalidateCache(cacheKeys.clientPortal.pattern),
    invalidateCache(cacheKeys.supplierPortal.pattern),
    invalidateCache(cacheKeys.sessions.pattern),
    invalidateCache(cacheKeys.shopee.pattern),
    invalidateCache(cacheKeys.lazada.pattern),
    invalidateCache("forecasting:*"),
    invalidateCache("system-config:*"),
    invalidateCache(cacheKeys.abcAnalysis.pattern),
    invalidateCache(cacheKeys.pnl.pattern),
    invalidateCache(cacheKeys.purchaseOrders.pattern),
    invalidateCache(cacheKeys.executiveKpi.pattern),
  ]);
}

/** @deprecated Use invalidateAllServerCaches instead */
export async function invalidateOnOrderChange(): Promise<void> {
  await invalidateAllServerCaches();
}

/** @deprecated Use invalidateAllServerCaches instead */
export async function invalidateOnProductChange(): Promise<void> {
  await invalidateAllServerCaches();
}

/** @deprecated Use invalidateAllServerCaches instead */
export async function invalidateOnCategoryOrSupplierChange(): Promise<void> {
  await invalidateAllServerCaches();
}
